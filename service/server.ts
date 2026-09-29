/**
 * NJP CALL — le service téléphonique disponible 24/7.
 *
 * Il décroche même quand le poste du cabinet est éteint : la conversation, la
 * prise de message et la mise en file se font ici ; l'écriture dans NJP CARE
 * se fait quand le poste se reconnecte (voir `relay.ts`). Tout l'état est
 * DURABLE (`store.ts`) : un redémarrage ne perd ni appel en cours, ni file.
 *
 * Routes :
 *
 * | Route | Qui | Authentification |
 * |---|---|---|
 * | `GET  /healthz` | supervision | aucune (des comptes, rien d'un cabinet) |
 * | `POST /v1/telephony/<adaptateur>/webhook` | fournisseur (ici : simulateur) | propre à l'adaptateur |
 * | `GET  /v1/care/next` | poste NJP CARE | jeton de poste → cabinet |
 * | `POST /v1/care/result` | poste NJP CARE | jeton de poste → cabinet, bail |
 * | `POST /v1/care/status` | poste NJP CARE | jeton de poste → cabinet |
 * | `POST /v1/care/revoke` | poste NJP CARE (désinstallation) | jeton de poste → révoqué |
 *
 * Tout ce qui arrive est borné (taille, fréquence, délai) et validé. Aucune
 * route n'est destinée à un navigateur : pas de CORS.
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { CabinetConfig } from "../core/config";
import { QueueingGateway } from "../core/gateway";
import {
  CallSession,
  FallbackUnderstander,
  type SessionProbe,
  type Understander,
} from "../core/session";
import { InboundError, type TelephonyInbound } from "./inbound";
import { DurableRelay, ITEM_ID, LEASE, type RelayOptions } from "./relay";
import {
  authenticateBearer,
  makeLogger,
  MAX_BODY_BYTES,
  RateLimiter,
  type LogLine,
} from "./security";
import {
  gatedAvailability,
  parseStatus,
  recordStatus,
  StatusGate,
} from "./status";
import type { ServiceStore } from "./store";

/** Points où un banc de panne peut interrompre le processus (recette uniquement). */
export type FaultPoint = SessionProbe | "result_stored" | "item_leased";

export interface ServiceOptions {
  store: ServiceStore;
  inbound: TelephonyInbound;
  /** Empreinte du jeton de poste → cabinet. Relue à chaque requête (rotation à chaud). */
  deviceTokens: Map<string, string> | (() => Map<string, string>);
  /** Numéro appelé (E.164) → cabinet. Donnée de connecteur, côté serveur. */
  numberRoutes: Map<string, string>;
  configs: Map<string, CabinetConfig>;
  understander?: Understander;
  relay?: Partial<RelayOptions>;
  log?: (l: LogLine) => void;
  maxWaitMs?: number;
  /** Bancs de panne : appelé aux points nommés. Jamais branché en exploitation. */
  fault?: (point: FaultPoint) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // On cesse de garder les octets, on laisse le client finir d'envoyer,
        // et on répond : détruire la socket priverait le client de la réponse.
        req.removeAllListeners("data");
        req.resume();
        reject(new HttpError(413, "body_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const readJson = async (
  req: IncomingMessage
): Promise<Record<string, unknown>> => {
  let v: unknown;
  try {
    v = JSON.parse(await readBody(req));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "invalid_json");
  }
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new HttpError(400, "invalid_json");
  return v as Record<string, unknown>;
};

const send = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

export interface Service {
  server: Server;
  relay: DurableRelay;
  sessions: Map<string, CallSession>;
  /** Arrêt propre : plus de nouvelles requêtes, fin des traitements en cours, fermeture du stockage. */
  shutdown(): Promise<void>;
}

export const createService = (opts: ServiceOptions): Service => {
  const store = opts.store;
  const log = opts.log ?? makeLogger(l => process.stdout.write(`${l}\n`));
  const now = store.now;
  const relay = new DurableRelay(store, opts.relay, (event, fields) =>
    log({ at: new Date(now()).toISOString(), event, ...fields })
  );
  const journal = store.journal();
  const understander = opts.understander ?? new FallbackUnderstander();
  const tokens =
    typeof opts.deviceTokens === "function"
      ? opts.deviceTokens
      : () => opts.deviceTokens as Map<string, string>;
  const sessions = new Map<string, CallSession>();
  const webhookLimit = new RateLimiter(60, 10_000);
  const careLimit = new RateLimiter(120, 10_000);
  /** Échecs d'authentification par adresse : freine l'essai de jetons. */
  const authFailLimit = new RateLimiter(10, 60_000);
  /** Sérialise les événements d'un même appel : jamais deux traitements concurrents. */
  const chains = new Map<string, Promise<unknown>>();
  const inFlight = new Set<Promise<unknown>>();
  let stopping = false;

  const sessionFor = async (callId: string, cabinetId: string) => {
    const key = `${cabinetId}\u0000${callId}`;
    let s = sessions.get(key);
    if (s) return s;
    const deps = {
      cabinetId,
      callId,
      config: opts.configs.get(cabinetId)!,
      understander,
      gateway: new StatusGate(
        store,
        new QueueingGateway(relay.transport(), relay)
      ),
      availability: gatedAvailability(store, relay.availability()),
      journal,
      now,
      probe: opts.fault,
    };
    // Reprise : si le service a redémarré en cours d'appel, le journal fait foi.
    s = (await journal.load({ cabinetId, callId })).length
      ? await CallSession.resume(deps)
      : CallSession.create(deps);
    sessions.set(key, s);
    return s;
  };

  const care = (req: IncomingMessage, at: string) => {
    const ip = req.socket.remoteAddress ?? "?";
    if (!authFailLimit.peek(ip, now()))
      throw new HttpError(429, "rate_limited");
    const auth = authenticateBearer(req.headers.authorization, tokens(), h =>
      store.isRevoked(h)
    );
    if (!auth) {
      // Chaque échec consomme la réserve de cette adresse.
      authFailLimit.allow(ip, now());
      log({ at, event: "care_rejected", reason: "bad_token" });
      throw new HttpError(401, "bad_token");
    }
    if (!careLimit.allow(auth.cabinetId, now()))
      throw new HttpError(429, "rate_limited");
    return auth;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://service.invalid");
    const at = new Date(now()).toISOString();

    if (req.method === "GET" && url.pathname === "/healthz") {
      try {
        return send(res, stopping ? 503 : 200, {
          ok: !stopping,
          telephony: opts.inbound.environment,
          ...store.health(),
        });
      } catch {
        return send(res, 503, { ok: false, store: "unavailable" });
      }
    }
    if (stopping) throw new HttpError(503, "shutting_down");

    if (
      req.method === "POST" &&
      url.pathname ===
        `/v1/telephony/${opts.inbound.name === "simulateur" ? "sim" : opts.inbound.name}/webhook`
    ) {
      const ip = req.socket.remoteAddress ?? "?";
      if (!webhookLimit.allow(ip, now()))
        throw new HttpError(429, "rate_limited");
      const body = await readBody(req);
      if (!opts.inbound.verify(req.headers, body, Math.floor(now() / 1000))) {
        log({ at, event: "webhook_rejected", reason: "bad_signature" });
        throw new HttpError(401, "bad_signature");
      }
      const { callId, to, event } = opts.inbound.parse(body);
      const cabinetId = opts.numberRoutes.get(to);
      if (!cabinetId || !opts.configs.has(cabinetId))
        throw new HttpError(404, "unknown_number");
      const key = `${cabinetId}\u0000${callId}`;
      const run = (chains.get(key) ?? Promise.resolve()).then(async () => {
        const session = await sessionFor(callId, cabinetId);
        const out = await session.handle(event);
        if (session.closed) sessions.delete(key);
        return out;
      });
      const settled = run.catch(() => undefined);
      chains.set(key, settled);
      inFlight.add(settled);
      void settled.finally(() => {
        inFlight.delete(settled);
        if (chains.get(key) === settled) chains.delete(key);
      });
      const out = await run;
      log({
        at,
        event: out.duplicate ? "webhook_duplicate" : "webhook_handled",
        cabinetId,
        callId,
        type: event.type,
      });
      const r = opts.inbound.render(out);
      return send(res, r.status, r.body);
    }

    if (url.pathname.startsWith("/v1/care/")) {
      const { cabinetId, tokenHash } = care(req, at);

      if (req.method === "GET" && url.pathname === "/v1/care/next") {
        const wait = Math.min(
          Math.max(Number(url.searchParams.get("wait") ?? 0) || 0, 0),
          opts.maxWaitMs ?? 25_000
        );
        const item = await relay.next(cabinetId, wait);
        if (item) opts.fault?.("item_leased");
        return item ? send(res, 200, { item }) : send(res, 204);
      }

      if (req.method === "POST" && url.pathname === "/v1/care/result") {
        const body = await readJson(req);
        if (Object.keys(body).some(k => !["id", "lease", "result"].includes(k)))
          throw new HttpError(400, "invalid_result");
        if (
          typeof body.id !== "string" ||
          !ITEM_ID.test(body.id) ||
          typeof body.lease !== "string" ||
          !LEASE.test(body.lease)
        )
          throw new HttpError(400, "invalid_result");
        // Le cabinet du jeton est le seul qui puisse répondre pour ses éléments.
        const ack = relay.result(cabinetId, body.id, body.lease, body.result);
        log({ at, event: "care_result", cabinetId, status: ack });
        switch (ack) {
          case "stored":
          case "already":
            // Enregistré durablement AVANT l'accusé.
            opts.fault?.("result_stored");
            return send(res, 204);
          case "not_found":
            throw new HttpError(404, "unknown_item");
          case "invalid":
            throw new HttpError(400, "invalid_result");
          default:
            throw new HttpError(409, ack);
        }
      }

      if (req.method === "POST" && url.pathname === "/v1/care/status") {
        const status = parseStatus(await readJson(req));
        if (!status) throw new HttpError(400, "invalid_status");
        recordStatus(store, cabinetId, status);
        log({
          at,
          event: "care_status",
          cabinetId,
          status: status.extensionEnabled ? "enabled" : "disabled",
        });
        return send(res, 204);
      }

      if (req.method === "POST" && url.pathname === "/v1/care/revoke") {
        // Désinstallation : le jeton cesse d'exister, l'extension est déclarée désactivée.
        store.tx(() => {
          recordStatus(store, cabinetId, {
            v: 1,
            extensionEnabled: false,
            permissions: [],
            bookingEnabled: false,
            remindersOnDisable: "cancel",
            issuedAt: at,
            validForSeconds: 86_400,
          });
          store.revokeToken(tokenHash, cabinetId);
        });
        log({ at, event: "care_revoked", cabinetId });
        return send(res, 204);
      }
    }
    throw new HttpError(404, "not_found");
  };

  const server = createHttpServer((req, res) => {
    req.setTimeout(30_000);
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError || e instanceof InboundError)
        return send(res, e.status, { error: e.code });
      log({ at: new Date(now()).toISOString(), event: "internal_error" });
      send(res, 500, { error: "internal" });
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 35_000;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    // Les attentes longues du poste rendent la main tout de suite (204) ;
    // les traitements d'appel en cours se terminent ; puis le stockage ferme.
    relay.wakeAll();
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    // Les connexions redeviennent inactives à mesure que les réponses partent.
    const sweep = setInterval(() => server.closeIdleConnections(), 25);
    const hard = setTimeout(() => server.closeAllConnections(), 5_000);
    server.closeIdleConnections();
    await Promise.allSettled([...inFlight]);
    await closed;
    clearInterval(sweep);
    clearTimeout(hard);
    store.close();
  };

  return { server, relay, sessions, shutdown };
};
