/**
 * NJP CALL — le relais entre le service 24/7 et le poste NJP CARE.
 *
 * Le poste du cabinet est derrière un routeur, parfois éteint. Le service ne
 * l'appelle donc jamais : c'est le **poste** qui ouvre une requête sortante
 * authentifiée (`GET /v1/care/next`, longue attente) et reçoit les commandes à
 * appliquer, puis rend chaque verdict (`POST /v1/care/result`).
 *
 * ```text
 *   session ──send()──► relais ──(requête longue du poste)──► NJP CARE (moteur Rust)
 *                         ▲                                        │
 *                         └────────── POST /v1/care/result ◄───────┘
 * ```
 *
 * - Aucun poste en attente ⇒ `NotDelivered` : on SAIT que rien n'est parti.
 * - Commande remise, pas de verdict à temps ⇒ `OutcomeUnknown` : la session
 *   rejouera la même clé ; NJP CARE rendra le verdict déjà enregistré.
 * - Les commandes non effectives en attente (messages, demandes) restent en
 *   file par cabinet et partent au retour du poste.
 */
import type { CommandEnvelope } from "../core/commands";
import {
  NotDelivered,
  OutcomeUnknown,
  type AvailabilityQuery,
  type AvailabilityReader,
  type AvailabilityResult,
  type CareTransport,
  type CommandQueue,
} from "../core/gateway";

export type RelayItem =
  | { kind: "command"; id: string; envelope: CommandEnvelope }
  | { kind: "availability"; id: string; query: AvailabilityQuery };

interface Waiter {
  resolve: (item: RelayItem | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CareRelay implements CommandQueue {
  /** File durable par cabinet (en mémoire ici ; une base en production). */
  private readonly queued = new Map<string, Map<string, RelayItem>>();
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly pending = new Map<
    string,
    {
      cabinetId: string;
      resolve: (v: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly lastSeen = new Map<string, number>();
  /** Éléments de file remis au poste, dont le verdict est attendu (réconciliation). */
  private readonly delivered = new Map<
    string,
    { cabinetId: string; key: string }
  >();
  /** Verdicts obtenus pour des commandes parties de la file : clé d'idempotence → résultat. */
  readonly reconciled = new Map<string, unknown>();
  private n = 0;

  constructor(private readonly verdictTimeoutMs = 8000) {}

  private queue(cabinetId: string) {
    let q = this.queued.get(cabinetId);
    if (!q) this.queued.set(cabinetId, (q = new Map()));
    return q;
  }

  isOnline(cabinetId: string, now = Date.now()) {
    return (
      (this.waiters.get(cabinetId)?.length ?? 0) > 0 ||
      now - (this.lastSeen.get(cabinetId) ?? 0) < 2000
    );
  }

  /** Le poste attend du travail. Rend un élément, ou `null` à expiration. */
  next(cabinetId: string, waitMs: number): Promise<RelayItem | null> {
    this.lastSeen.set(cabinetId, Date.now());
    const q = this.queue(cabinetId);
    const first = q.values().next();
    if (!first.done) {
      q.delete(first.value.id);
      if (first.value.kind === "command")
        this.delivered.set(first.value.id, {
          cabinetId,
          key: first.value.envelope.idempotencyKey,
        });
      return Promise.resolve(first.value);
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(cabinetId) ?? [];
        this.waiters.set(
          cabinetId,
          list.filter(w => w.timer !== timer)
        );
        this.lastSeen.set(cabinetId, Date.now());
        resolve(null);
      }, waitMs);
      const list = this.waiters.get(cabinetId) ?? [];
      list.push({ resolve, timer });
      this.waiters.set(cabinetId, list);
    });
  }

  /** Le poste rend un verdict. Seul le cabinet du jeton peut répondre pour ses éléments. */
  result(cabinetId: string, id: string, value: unknown): boolean {
    const d = this.delivered.get(id);
    if (d && d.cabinetId === cabinetId) {
      this.delivered.delete(id);
      this.reconciled.set(d.key, value);
      return true;
    }
    const p = this.pending.get(id);
    if (!p || p.cabinetId !== cabinetId) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(value);
    return true;
  }

  private deliver(cabinetId: string, item: RelayItem): boolean {
    const list = this.waiters.get(cabinetId) ?? [];
    const w = list.shift();
    this.waiters.set(cabinetId, list);
    if (!w) return false;
    clearTimeout(w.timer);
    w.resolve(item);
    return true;
  }

  private await(
    cabinetId: string,
    item: RelayItem,
    onTimeout: () => Error
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(item.id);
        reject(onTimeout());
      }, this.verdictTimeoutMs);
      this.pending.set(item.id, { cabinetId, resolve, timer });
    });
  }

  /** Transport des commandes, pour `QueueingGateway`. */
  transport(): CareTransport {
    return {
      send: async envelope => {
        const item: RelayItem = {
          kind: "command",
          id: `r${++this.n}`,
          envelope,
        };
        const verdict = this.await(
          envelope.cabinetId,
          item,
          () => new OutcomeUnknown("no verdict in time")
        );
        if (!this.deliver(envelope.cabinetId, item)) {
          this.pending.get(item.id) &&
            clearTimeout(this.pending.get(item.id)!.timer);
          this.pending.delete(item.id);
          verdict.catch(() => undefined);
          throw new NotDelivered("care station not connected");
        }
        return verdict;
      },
    };
  }

  /** Lecture des disponibilités, par le même chemin. */
  availability(): AvailabilityReader {
    return {
      findSlots: async (
        cabinetId: string,
        query: AvailabilityQuery
      ): Promise<AvailabilityResult> => {
        const item: RelayItem = {
          kind: "availability",
          id: `r${++this.n}`,
          query,
        };
        const verdict = this.await(
          cabinetId,
          item,
          () => new Error("availability timeout")
        );
        if (!this.deliver(cabinetId, item)) {
          clearTimeout(this.pending.get(item.id)!.timer);
          this.pending.delete(item.id);
          verdict.catch(() => undefined);
          return { status: "failed", slots: [], reason: "care_offline" };
        }
        try {
          const r = (await verdict) as AvailabilityResult;
          if (
            !r ||
            !Array.isArray(r.slots) ||
            (r.status !== "confirmed" &&
              r.status !== "failed" &&
              r.status !== "unsupported")
          ) {
            return {
              status: "failed",
              slots: [],
              reason: "availability_malformed",
            };
          }
          return {
            status: r.status,
            slots: r.slots.slice(0, 3),
            ...(r.reason ? { reason: r.reason } : {}),
          };
        } catch {
          return {
            status: "failed",
            slots: [],
            reason: "availability_timeout",
          };
        }
      },
    };
  }

  // -- CommandQueue : ce qui attend le retour du poste ----------------------

  async put(envelope: CommandEnvelope) {
    const q = this.queue(envelope.cabinetId);
    for (const item of q.values())
      if (
        item.kind === "command" &&
        item.envelope.idempotencyKey === envelope.idempotencyKey
      )
        return;
    const id = `q${++this.n}`;
    q.set(id, { kind: "command", id, envelope });
  }

  async has(key: string) {
    for (const q of this.queued.values())
      for (const item of q.values())
        if (item.kind === "command" && item.envelope.idempotencyKey === key)
          return true;
    return false;
  }

  queuedCount(cabinetId: string) {
    return this.queue(cabinetId).size;
  }
}
