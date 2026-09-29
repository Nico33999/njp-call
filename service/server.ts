/**
 * NJP CALL — le service téléphonique disponible 24/7.
 *
 * Il décroche même quand le poste du cabinet est éteint : la conversation, la
 * prise de message et la mise en file se font ici ; l'écriture dans NJP CARE
 * se fait quand le poste se reconnecte (voir `relay.ts`).
 *
 * Routes :
 *
 * | Route | Qui | Authentification |
 * |---|---|---|
 * | `GET  /healthz` | supervision | aucune (ne dit rien d'un cabinet) |
 * | `POST /v1/telephony/sim/webhook` | fournisseur (ici : simulateur) | HMAC horodaté |
 * | `GET  /v1/care/next` | poste NJP CARE | jeton de poste → cabinet |
 * | `POST /v1/care/result` | poste NJP CARE | jeton de poste → cabinet |
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
  InMemoryJournal,
  type JournalStore,
  type TelephonyEvent,
  type Understander,
} from "../core/session";
import { CareRelay } from "./relay";
import {
  cabinetForBearer,
  makeLogger,
  MAX_BODY_BYTES,
  RateLimiter,
  verifyWebhook,
  type LogLine,
} from "./security";

export interface ServiceOptions {
  webhookSecret: string;
  /** Empreinte du jeton de poste → cabinet. */
  deviceTokens: Map<string, string>;
  /** Numéro appelé (E.164) → cabinet. Donnée de connecteur, côté serveur. */
  numberRoutes: Map<string, string>;
  configs: Map<string, CabinetConfig>;
  understander?: Understander;
  journal?: JournalStore;
  relay?: CareRelay;
  log?: (l: LogLine) => void;
  now?: () => number;
  maxWaitMs?: number;
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

const send = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

const REF = /^[A-Za-z0-9_-]{3,64}$/;

/** Traduit le format du simulateur en événement neutre. Tout le reste est refusé. */
const parseSimEvent = (
  raw: unknown
): { callId: string; to: string; event: TelephonyEvent } => {
  const o = raw as Record<string, unknown>;
  const e = (o?.event ?? {}) as Record<string, unknown>;
  if (
    typeof o?.callId !== "string" ||
    !REF.test(o.callId) ||
    typeof o.to !== "string" ||
    typeof e.id !== "string" ||
    !REF.test(e.id) ||
    typeof e.at !== "string" ||
    Number.isNaN(Date.parse(e.at))
  ) {
    throw new HttpError(400, "invalid_event");
  }
  const base = { id: e.id, at: e.at };
  switch (e.type) {
    case "call.started":
      return {
        callId: o.callId,
        to: o.to,
        event: { ...base, type: "call.started", open: e.open === true },
      };
    case "caller.utterance":
      if (typeof e.text !== "string" || e.text.length > 2000)
        throw new HttpError(400, "invalid_event");
      return {
        callId: o.callId,
        to: o.to,
        event: {
          ...base,
          type: "caller.utterance",
          text: e.text,
          bargeIn: e.bargeIn === true,
        },
      };
    case "caller.dtmf":
      if (typeof e.digits !== "string" || !/^[0-9*#]{1,20}$/.test(e.digits))
        throw new HttpError(400, "invalid_event");
      return {
        callId: o.callId,
        to: o.to,
        event: { ...base, type: "caller.dtmf", digits: e.digits },
      };
    case "caller.silence":
      return {
        callId: o.callId,
        to: o.to,
        event: { ...base, type: "caller.silence", ms: Number(e.ms) || 0 },
      };
    case "transfer.result":
      return {
        callId: o.callId,
        to: o.to,
        event: {
          ...base,
          type: "transfer.result",
          connected: e.connected === true,
        },
      };
    case "call.ended":
      return {
        callId: o.callId,
        to: o.to,
        event: { ...base, type: "call.ended", reason: "hangup" },
      };
    default:
      throw new HttpError(400, "invalid_event");
  }
};

export const createService = (
  opts: ServiceOptions
): { server: Server; relay: CareRelay; sessions: Map<string, CallSession> } => {
  const relay = opts.relay ?? new CareRelay();
  const journal = opts.journal ?? new InMemoryJournal();
  const understander = opts.understander ?? new FallbackUnderstander();
  const log = opts.log ?? makeLogger(l => process.stdout.write(`${l}\n`));
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, CallSession>();
  const webhookLimit = new RateLimiter(60, 10_000);
  const careLimit = new RateLimiter(120, 10_000);
  /** Sérialise les événements d'un même appel : jamais deux traitements concurrents. */
  const chains = new Map<string, Promise<unknown>>();

  const sessionFor = async (callId: string, cabinetId: string) => {
    const key = `${cabinetId}/${callId}`;
    let s = sessions.get(key);
    if (s) return s;
    const deps = {
      cabinetId,
      callId,
      config: opts.configs.get(cabinetId)!,
      understander,
      gateway: new QueueingGateway(relay.transport(), relay),
      availability: relay.availability(),
      journal,
      now,
    };
    // Reprise : si le service a redémarré en cours d'appel, le journal fait foi.
    s = (await journal.load(callId)).length
      ? await CallSession.resume(deps)
      : CallSession.create(deps);
    sessions.set(key, s);
    return s;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://service.invalid");
    const at = new Date(now()).toISOString();

    if (req.method === "GET" && url.pathname === "/healthz")
      return send(res, 200, { ok: true });

    if (req.method === "POST" && url.pathname === "/v1/telephony/sim/webhook") {
      const ip = req.socket.remoteAddress ?? "?";
      if (!webhookLimit.allow(ip, now()))
        throw new HttpError(429, "rate_limited");
      const body = await readBody(req);
      if (
        !verifyWebhook(
          opts.webhookSecret,
          req.headers["x-njp-signature"] as string | undefined,
          body,
          Math.floor(now() / 1000)
        )
      ) {
        log({ at, event: "webhook_rejected", reason: "bad_signature" });
        throw new HttpError(401, "bad_signature");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new HttpError(400, "invalid_json");
      }
      const { callId, to, event } = parseSimEvent(parsed);
      const cabinetId = opts.numberRoutes.get(to);
      if (!cabinetId || !opts.configs.has(cabinetId))
        throw new HttpError(404, "unknown_number");
      const key = `${cabinetId}/${callId}`;
      const run = (chains.get(key) ?? Promise.resolve()).then(async () => {
        const session = await sessionFor(callId, cabinetId);
        return session.handle(event);
      });
      chains.set(
        key,
        run.catch(() => undefined)
      );
      const out = await run;
      log({
        at,
        event: out.duplicate ? "webhook_duplicate" : "webhook_handled",
        cabinetId,
        callId,
        type: event.type,
      });
      return send(res, 200, {
        actions: [
          ...out.say.map(text => ({ say: text })),
          ...(out.transferTo ? [{ transfer: out.transferTo }] : []),
          ...(out.hangup ? [{ hangup: true }] : []),
        ],
        duplicate: out.duplicate === true,
      });
    }

    if (
      url.pathname === "/v1/care/next" ||
      url.pathname === "/v1/care/result"
    ) {
      const cabinetId = cabinetForBearer(
        req.headers.authorization,
        opts.deviceTokens
      );
      if (!cabinetId) {
        log({ at, event: "care_rejected", reason: "bad_token" });
        throw new HttpError(401, "bad_token");
      }
      if (!careLimit.allow(cabinetId, now()))
        throw new HttpError(429, "rate_limited");
      if (req.method === "GET" && url.pathname === "/v1/care/next") {
        const wait = Math.min(
          Math.max(Number(url.searchParams.get("wait") ?? 0) || 0, 0),
          opts.maxWaitMs ?? 25_000
        );
        const item = await relay.next(cabinetId, wait);
        return item ? send(res, 200, { item }) : send(res, 204);
      }
      if (req.method === "POST" && url.pathname === "/v1/care/result") {
        const body = JSON.parse(await readBody(req)) as {
          id?: unknown;
          result?: unknown;
        };
        if (typeof body.id !== "string" || !/^[rq]\d{1,12}$/.test(body.id))
          throw new HttpError(400, "invalid_result");
        // Le cabinet du jeton est le seul qui puisse répondre pour ses éléments.
        if (!relay.result(cabinetId, body.id, body.result))
          throw new HttpError(404, "unknown_item");
        log({
          at,
          event: "care_result",
          cabinetId,
          status: String((body.result as { status?: unknown })?.status ?? ""),
        });
        return send(res, 204);
      }
    }
    throw new HttpError(404, "not_found");
  };

  const server = createHttpServer((req, res) => {
    req.setTimeout(30_000);
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code });
      if (e instanceof SyntaxError)
        return send(res, 400, { error: "invalid_json" });
      log({ at: new Date(now()).toISOString(), event: "internal_error" });
      send(res, 500, { error: "internal" });
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 35_000;
  return { server, relay, sessions };
};
