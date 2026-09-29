/**
 * NJP CALL — le relais DURABLE entre le service 24/7 et le poste NJP CARE.
 *
 * Le poste est derrière un routeur, parfois éteint : c'est lui qui relève
 * (`GET /v1/care/next`) et rend chaque verdict (`POST /v1/care/result`).
 *
 * ## Protocole à bail
 *
 * ```text
 *   ready ──next()──► leased (jeton, échéance) ──result(jeton)──► done
 *     ▲                    │ échéance dépassée
 *     └── temporisation ◄──┘ (tentatives bornées ; au-delà : dead, visible)
 *   ready ── commande effective non relevée à temps ──► expired
 * ```
 *
 * - Relever ne SUPPRIME rien : l'élément est réservé. Une coupure du poste
 *   entre la relève et le verdict ne perd pas le travail ; il revient.
 * - Le verdict n'est accusé (204) qu'APRÈS son enregistrement durable. Un
 *   verdict déjà enregistré, rendu de nouveau à l'identique, est accusé ; un
 *   verdict différent est refusé (409).
 * - Identifiant stable dérivé de (cabinet, clé d'idempotence) : une même
 *   commande ne peut exister qu'une fois par cabinet (contrainte UNIQUE).
 * - Seul le cabinet du jeton de poste relève et répond pour ses éléments.
 * - Le poste rejoue une commande déjà appliquée ? NJP CARE rend le verdict
 *   enregistré (idempotence du coffre) : pas de double effet, sans promettre
 *   une livraison réseau « exactement une fois ».
 * - Réponse tardive (après l'attente d'une session) : conservée ; toute
 *   nouvelle soumission de la même clé la reçoit. Rien n'est réécrit dans le
 *   journal d'une session déjà rejouable (déterminisme de la reprise).
 */
import { createHash, randomBytes } from "node:crypto";
import {
  ACTION_STATUSES,
  IDEMPOTENCY_KEY,
  validateCommand,
  type CommandEnvelope,
  type CommandResult,
} from "../core/commands";
import {
  EFFECTIVE_COMMANDS,
  NotDelivered,
  OutcomeUnknown,
  type AvailabilityQuery,
  type AvailabilityReader,
  type AvailabilityResult,
  type CareTransport,
  type CommandQueue,
} from "../core/gateway";
import type { ServiceStore } from "./store";

export type RelayItem =
  | { kind: "command"; id: string; lease: string; envelope: CommandEnvelope }
  | {
      kind: "availability";
      id: string;
      lease: string;
      query: AvailabilityQuery;
    };

export const ITEM_ID = /^it_[0-9a-f]{24}$/;
export const LEASE = /^[0-9a-f]{32}$/;

export interface RelayOptions {
  /** Durée d'un bail (le poste doit rendre son verdict avant). */
  leaseMs: number;
  /** Attente d'un verdict par une session en ligne. */
  verdictTimeoutMs: number;
  maxAttempts: number;
  /** Une commande EFFECTIVE non relevée dans ce délai n'est jamais remise. */
  effectiveTtlMs: number;
  availabilityTtlMs: number;
  /** Le poste est « joignable » s'il a relevé depuis moins que ceci. */
  onlineWindowMs: number;
}

export const DEFAULT_RELAY: RelayOptions = {
  leaseMs: 30_000,
  verdictTimeoutMs: 8_000,
  maxAttempts: 8,
  effectiveTtlMs: 60_000,
  availabilityTtlMs: 15_000,
  onlineWindowMs: 35_000,
};

export type ResultAck =
  | "stored"
  | "already"
  | "stale_lease"
  | "conflict"
  | "not_found"
  | "invalid";

export const backoffMs = (attempts: number) =>
  Math.min(1000 * 2 ** Math.max(0, attempts - 1), 300_000);

const itemId = (cabinetId: string, key: string) =>
  `it_${createHash("sha256").update(`${cabinetId}\u0000${key}`).digest("hex").slice(0, 24)}`;

/** Validation STRICTE d'un verdict de commande rendu par le poste. */
export const validCommandVerdict = (
  v: unknown,
  key: string
): v is CommandResult => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const allowed = [
    "idempotencyKey",
    "status",
    "reference",
    "reason",
    "replayed",
    "detail",
  ];
  if (Object.keys(o).some(k => !allowed.includes(k))) return false;
  if (o.idempotencyKey !== key) return false;
  if (
    typeof o.status !== "string" ||
    !(ACTION_STATUSES as readonly string[]).includes(o.status)
  )
    return false;
  if (o.status === "simulated") return false; // jamais depuis un poste réel
  if (
    o.reference !== undefined &&
    (typeof o.reference !== "string" ||
      !/^[A-Za-z0-9_-]{3,64}$/.test(o.reference))
  )
    return false;
  if (
    o.reason !== undefined &&
    (typeof o.reason !== "string" ||
      o.reason.length > 80 ||
      /[^\w:.\-]/.test(o.reason))
  )
    return false;
  if (o.replayed !== undefined && typeof o.replayed !== "boolean") return false;
  if (o.status === "confirmed" && typeof o.reference !== "string") return false;
  return (
    o.detail === undefined ||
    (typeof o.detail === "object" &&
      o.detail !== null &&
      JSON.stringify(o.detail).length < 2048)
  );
};

/** Validation STRICTE d'une réponse de disponibilité. */
export const validAvailabilityVerdict = (
  v: unknown
): v is AvailabilityResult => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some(k => !["status", "slots", "reason"].includes(k)))
    return false;
  if (!["confirmed", "failed", "unsupported"].includes(String(o.status)))
    return false;
  if (!Array.isArray(o.slots) || o.slots.length > 3) return false;
  if (
    o.reason !== undefined &&
    (typeof o.reason !== "string" || o.reason.length > 80)
  )
    return false;
  // Chaque créneau doit être un créneau valide au sens du contrat de commande.
  return o.slots.every(
    s =>
      validateCommand({
        type: "appointment.book",
        payload: {
          person: {
            declaredName: "x",
            phone: "+33600000000",
            relation: "self",
          },
          newPatient: false,
          slot: s,
        },
      }).length === 0
  );
};

interface Row {
  item_id: string;
  cabinet_id: string;
  idem_key: string;
  kind: "command" | "availability";
  payload: Uint8Array;
  state: string;
  lease_token: string | null;
  lease_until: number | null;
  attempts: number;
  result: Uint8Array | null;
}

export class DurableRelay implements CommandQueue {
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly verdicts = new Map<string, Array<(v: unknown) => void>>();
  private readonly lastSeen = new Map<string, number>();
  readonly opts: RelayOptions;

  constructor(
    private readonly store: ServiceStore,
    opts: Partial<RelayOptions> = {},
    private readonly log: (
      event: string,
      fields?: Record<string, string>
    ) => void = () => {}
  ) {
    this.opts = { ...DEFAULT_RELAY, ...opts };
  }

  private now() {
    return this.store.now();
  }
  private aad(r: { cabinet_id: string; item_id: string }, part: string) {
    return `relay|${part}|${r.cabinet_id}|${r.item_id}`;
  }

  isOnline(cabinetId: string) {
    return (
      (this.waiters.get(cabinetId)?.length ?? 0) > 0 ||
      this.now() - (this.lastSeen.get(cabinetId) ?? -Infinity) <
        this.opts.onlineWindowMs
    );
  }

  /** Arrêt : toutes les attentes longues rendent la main. */
  wakeAll() {
    for (const c of [...this.waiters.keys()]) this.notify(c);
  }

  private notify(cabinetId: string) {
    const list = this.waiters.get(cabinetId) ?? [];
    this.waiters.set(cabinetId, []);
    for (const w of list) w();
  }

  private insert(
    cabinetId: string,
    key: string,
    kind: "command" | "availability",
    payload: unknown,
    expiresAt: number | null
  ): string {
    const id = itemId(cabinetId, key);
    const now = this.now();
    this.store.db
      .prepare(
        "INSERT INTO relay_items(item_id, cabinet_id, idem_key, kind, payload, state, attempts, next_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', 0, ?, ?, ?, ?) ON CONFLICT(cabinet_id, idem_key) DO NOTHING"
      )
      .run(
        id,
        cabinetId,
        key,
        kind,
        this.store.seal(
          this.aad({ cabinet_id: cabinetId, item_id: id }, "payload"),
          payload
        ),
        now,
        expiresAt,
        now,
        now
      );
    this.notify(cabinetId);
    return id;
  }

  private row(cabinetId: string, id: string): Row | undefined {
    return this.store.db
      .prepare("SELECT * FROM relay_items WHERE item_id = ? AND cabinet_id = ?")
      .get(id, cabinetId) as Row | undefined;
  }

  private resultOf(r: Row): unknown {
    return r.result
      ? this.store.open(this.aad(r, "result"), r.result)
      : undefined;
  }

  /** Échéances : baux expirés remis en file (ou abandonnés), commandes effectives périmées. */
  private sweep(cabinetId: string) {
    const now = this.now();
    const db = this.store.db;
    // Seul un élément JAMAIS remis peut être déclaré « non appliqué » : un
    // élément déjà relevé a peut-être été appliqué, il reste à réconcilier
    // (NJP CARE refuse d'appliquer une commande effective trop ancienne et
    // rend le verdict déjà enregistré sinon).
    const expired = db
      .prepare(
        "SELECT * FROM relay_items WHERE cabinet_id = ? AND state = 'ready' AND expires_at IS NOT NULL AND expires_at < ? AND (attempts = 0 OR kind = 'availability')"
      )
      .all(cabinetId, now) as unknown as Row[];
    for (const r of expired) {
      const env = this.store.open<CommandEnvelope | AvailabilityQuery>(
        this.aad(r, "payload"),
        r.payload
      );
      const result =
        r.kind === "command"
          ? {
              idempotencyKey: (env as CommandEnvelope).idempotencyKey,
              status: "failed",
              reason: "care_offline",
            }
          : { status: "failed", slots: [], reason: "care_offline" };
      db.prepare(
        "UPDATE relay_items SET state = 'expired', result = ?, updated_at = ? WHERE item_id = ?"
      ).run(this.store.seal(this.aad(r, "result"), result), now, r.item_id);
      this.resolve(r.item_id, result);
    }
    const lapsed = db
      .prepare(
        "SELECT * FROM relay_items WHERE cabinet_id = ? AND state = 'leased' AND lease_until < ?"
      )
      .all(cabinetId, now) as unknown as Row[];
    for (const r of lapsed) {
      if (r.attempts >= this.opts.maxAttempts) {
        db.prepare(
          "UPDATE relay_items SET state = 'dead', updated_at = ? WHERE item_id = ?"
        ).run(now, r.item_id);
        this.log("relay_dead", { cabinetId, type: r.kind });
      } else {
        db.prepare(
          "UPDATE relay_items SET state = 'ready', next_at = ?, updated_at = ? WHERE item_id = ?"
        ).run(now + backoffMs(r.attempts), now, r.item_id);
        this.log("relay_lease_expired", { cabinetId, type: r.kind });
      }
    }
  }

  /** Réserve le prochain élément, ou rien. */
  private lease(cabinetId: string): RelayItem | null {
    return this.store.tx(() => {
      this.sweep(cabinetId);
      const now = this.now();
      const r = this.store.db
        .prepare(
          "SELECT * FROM relay_items WHERE cabinet_id = ? AND state = 'ready' AND next_at <= ? ORDER BY created_at LIMIT 1"
        )
        .get(cabinetId, now) as Row | undefined;
      if (!r) return null;
      const token = randomBytes(16).toString("hex");
      this.store.db
        .prepare(
          "UPDATE relay_items SET state = 'leased', lease_token = ?, lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE item_id = ?"
        )
        .run(token, now + this.opts.leaseMs, now, r.item_id);
      const payload = this.store.open<CommandEnvelope | AvailabilityQuery>(
        this.aad(r, "payload"),
        r.payload
      );
      return r.kind === "command"
        ? {
            kind: "command",
            id: r.item_id,
            lease: token,
            envelope: payload as CommandEnvelope,
          }
        : {
            kind: "availability",
            id: r.item_id,
            lease: token,
            query: payload as AvailabilityQuery,
          };
    });
  }

  /** Le poste relève. Attente longue bornée ; rend un élément réservé, ou `null`. */
  async next(cabinetId: string, waitMs: number): Promise<RelayItem | null> {
    this.lastSeen.set(cabinetId, this.now());
    const first = this.lease(cabinetId);
    if (first || waitMs <= 0) return first;
    await new Promise<void>(resolve => {
      const timer = setTimeout(done, waitMs);
      const list = this.waiters.get(cabinetId) ?? [];
      function done() {
        clearTimeout(timer);
        resolve();
      }
      list.push(done);
      this.waiters.set(cabinetId, list);
    });
    this.waiters.set(
      cabinetId,
      (this.waiters.get(cabinetId) ?? []).filter(Boolean)
    );
    this.lastSeen.set(cabinetId, this.now());
    return this.lease(cabinetId);
  }

  /** Le poste rend un verdict. Enregistré AVANT d'être accusé. */
  result(
    cabinetId: string,
    id: string,
    lease: string,
    value: unknown
  ): ResultAck {
    if (!ITEM_ID.test(id) || !LEASE.test(lease)) return "invalid";
    const ack = this.store.tx((): ResultAck => {
      const r = this.row(cabinetId, id); // un autre cabinet ne « trouve » rien
      if (!r) return "not_found";
      const payload = this.store.open<CommandEnvelope | AvailabilityQuery>(
        this.aad(r, "payload"),
        r.payload
      );
      const valid =
        r.kind === "command"
          ? validCommandVerdict(
              value,
              (payload as CommandEnvelope).idempotencyKey
            )
          : validAvailabilityVerdict(value);
      if (!valid) return "invalid";
      if (r.state === "done")
        return JSON.stringify(this.resultOf(r)) === JSON.stringify(value)
          ? "already"
          : "conflict";
      if (r.lease_token !== lease) return "stale_lease";
      if (r.state !== "leased" && r.state !== "ready") return "conflict";
      this.store.db
        .prepare(
          "UPDATE relay_items SET state = 'done', result = ?, lease_until = NULL, updated_at = ? WHERE item_id = ?"
        )
        .run(this.store.seal(this.aad(r, "result"), value), this.now(), id);
      return "stored";
    });
    if (ack === "stored" || ack === "already") this.resolve(id, value);
    if (ack === "invalid" || ack === "conflict" || ack === "stale_lease")
      this.log("relay_result_rejected", { cabinetId, reason: ack });
    return ack;
  }

  private resolve(id: string, value: unknown) {
    const list = this.verdicts.get(id) ?? [];
    this.verdicts.delete(id);
    for (const f of list) f(value);
  }

  private awaitVerdict(
    id: string,
    timeoutMs: number
  ): Promise<unknown | typeof TIMEOUT> {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.verdicts.set(
          id,
          (this.verdicts.get(id) ?? []).filter(f => f !== done)
        );
        resolve(TIMEOUT);
      }, timeoutMs);
      const done = (v: unknown) => {
        clearTimeout(timer);
        resolve(v);
      };
      const list = this.verdicts.get(id) ?? [];
      list.push(done);
      this.verdicts.set(id, list);
    });
  }

  // -- Transport des commandes (QueueingGateway) --------------------------------

  transport(): CareTransport {
    return {
      send: async envelope => {
        this.store.tx(() => this.sweep(envelope.cabinetId));
        const existing = this.store.db
          .prepare(
            "SELECT * FROM relay_items WHERE cabinet_id = ? AND idem_key = ?"
          )
          .get(envelope.cabinetId, envelope.idempotencyKey) as Row | undefined;
        if (existing && ["done", "expired", "dead"].includes(existing.state)) {
          const stored = this.resultOf(existing);
          if (stored) return stored; // réponse tardive ou déjà connue : rendue telle quelle
          throw new OutcomeUnknown("relay item abandoned");
        }
        if (!existing && !this.isOnline(envelope.cabinetId))
          throw new NotDelivered("care station not connected");
        const effective = EFFECTIVE_COMMANDS.includes(envelope.command.type);
        const id =
          existing?.item_id ??
          this.insert(
            envelope.cabinetId,
            envelope.idempotencyKey,
            "command",
            envelope,
            effective ? this.now() + this.opts.effectiveTtlMs : null
          );
        const v = await this.awaitVerdict(id, this.opts.verdictTimeoutMs);
        if (v === TIMEOUT) throw new OutcomeUnknown("no verdict in time");
        return v;
      },
    };
  }

  // -- File des demandes en attente (poste absent) ------------------------------

  async put(envelope: CommandEnvelope) {
    if (!IDEMPOTENCY_KEY.test(envelope.idempotencyKey))
      throw new Error("clé invalide");
    this.insert(
      envelope.cabinetId,
      envelope.idempotencyKey,
      "command",
      envelope,
      null
    );
  }

  async has(cabinetId: string, key: string) {
    return !!this.store.db
      .prepare(
        "SELECT 1 FROM relay_items WHERE cabinet_id = ? AND idem_key = ?"
      )
      .get(cabinetId, key);
  }

  // -- Disponibilités ------------------------------------------------------------

  availability(): AvailabilityReader {
    return {
      findSlots: async (cabinetId, query): Promise<AvailabilityResult> => {
        if (!this.isOnline(cabinetId))
          return { status: "failed", slots: [], reason: "care_offline" };
        const id = this.insert(
          cabinetId,
          `avail/${randomBytes(8).toString("hex")}`,
          "availability",
          query,
          this.now() + this.opts.availabilityTtlMs
        );
        const v = await this.awaitVerdict(id, this.opts.verdictTimeoutMs);
        if (v === TIMEOUT || !validAvailabilityVerdict(v))
          return {
            status: "failed",
            slots: [],
            reason: "availability_timeout",
          };
        return v;
      },
    };
  }

  queuedCount(cabinetId: string) {
    return (
      this.store.db
        .prepare(
          "SELECT count(*) AS n FROM relay_items WHERE cabinet_id = ? AND state IN ('ready','leased')"
        )
        .get(cabinetId) as { n: number }
    ).n;
  }

  stateOf(cabinetId: string, key: string): string | null {
    const r = this.store.db
      .prepare(
        "SELECT state FROM relay_items WHERE cabinet_id = ? AND idem_key = ?"
      )
      .get(cabinetId, key) as { state: string } | undefined;
    return r?.state ?? null;
  }
}

const TIMEOUT = Symbol("timeout");
