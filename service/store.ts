/**
 * NJP CALL — le stockage durable du service.
 *
 * ## Ce qu'il contient, et ce qu'il ne contient pas
 *
 * | Table | Contenu | Durée |
 * |---|---|---|
 * | `journal` | journal des appels EN COURS (événements, compréhension, commandes, résultats, réponses) | jusqu'à la clôture ; ensuite une pierre tombale sans propos |
 * | `relay_items` | file du relais vers le poste (commandes, disponibilités), baux, résultats | purgée après `NJP_CALL_RETENTION_DAYS` |
 * | `cabinet_status` | dernier état déclaré par le poste (activation, accès, expiration) | remplacé à chaque déclaration |
 * | `reminders` | rappels automatiques programmés | purgés une fois terminés et échus |
 *
 * Ce n'est ni un fichier patients, ni un agenda : le service ne garde que le
 * travail en cours et ce qu'il doit encore remettre à NJP CARE, qui fait foi.
 *
 * ## Garanties
 *
 * - **Transactions** : SQLite (WAL, `BEGIN IMMEDIATE`) ; toute écriture
 *   composée est atomique.
 * - **Isolation par cabinet** dans les CLÉS : `(cabinet_id, call_id, seq)`,
 *   `(cabinet_id, idem_key)`, `(cabinet_id, id)`. Aucune lecture ne se fait
 *   sans le cabinet.
 * - **Chiffrement au repos** des contenus (AES-256-GCM, clé
 *   `NJP_CALL_STORAGE_KEY`, données associées = table + cabinet + clé) : un
 *   contenu déplacé d'un cabinet à un autre ne se déchiffre pas.
 * - **Migrations** numérotées, transactionnelles, refus d'un schéma plus récent.
 * - **Sauvegarde** cohérente (`VACUUM INTO`), **restauration** hors service,
 *   **purge** par ancienneté.
 *
 * ## Limite assumée
 *
 * Un fichier SQLite = UNE instance de service. Les baux protègent contre deux
 * relèves concurrentes, mais les attentes longues et le cache de sessions
 * vivent dans le processus : plusieurs instances derrière un répartiteur
 * exigent une base partagée (PostgreSQL) et un bus de notifications. Voir
 * `docs/EXPLOITATION.md`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { JournalEntry, JournalStore, SessionKey } from "../core/session";
import type {
  Reminder,
  ReminderStatus,
  ReminderStore,
} from "../core/reminders";

// `node:sqlite` est chargé à l'exécution : le résolveur de Vite (bancs) ne le
// connaît pas encore comme module intégré.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");

export const STORE_SCHEMA = 1;

const MIGRATIONS: string[] = [
  // 1 — schéma initial
  `
  CREATE TABLE journal (
    cabinet_id TEXT NOT NULL,
    call_id    TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    entry      BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (cabinet_id, call_id, seq)
  );
  CREATE TABLE calls (
    cabinet_id TEXT NOT NULL,
    call_id    TEXT NOT NULL,
    state      TEXT NOT NULL CHECK (state IN ('open','closed')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (cabinet_id, call_id)
  );
  CREATE TABLE relay_items (
    item_id     TEXT PRIMARY KEY,
    cabinet_id  TEXT NOT NULL,
    idem_key    TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('command','availability')),
    payload     BLOB NOT NULL,
    state       TEXT NOT NULL CHECK (state IN ('ready','leased','done','expired','dead')),
    lease_token TEXT,
    lease_until INTEGER,
    attempts    INTEGER NOT NULL DEFAULT 0,
    next_at     INTEGER NOT NULL,
    expires_at  INTEGER,
    result      BLOB,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE (cabinet_id, idem_key)
  );
  CREATE INDEX relay_ready ON relay_items(cabinet_id, state, next_at);
  CREATE TABLE cabinet_status (
    cabinet_id  TEXT PRIMARY KEY,
    status      BLOB NOT NULL,
    received_at INTEGER NOT NULL,
    valid_until INTEGER NOT NULL
  );
  CREATE TABLE reminders (
    cabinet_id  TEXT NOT NULL,
    id          TEXT NOT NULL,
    appointment TEXT NOT NULL,
    data        BLOB NOT NULL,
    status      TEXT NOT NULL,
    due_at      INTEGER NOT NULL,
    lock_until  INTEGER,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (cabinet_id, id)
  );
  CREATE TABLE revoked_tokens (
    token_hash TEXT PRIMARY KEY,
    cabinet_id TEXT NOT NULL,
    revoked_at INTEGER NOT NULL
  );
  CREATE INDEX reminders_due ON reminders(cabinet_id, status, due_at);
  `,
];

export class StoreError extends Error {}

export interface StoreOptions {
  path: string;
  /** 32 octets. Sans clé, le stockage refuse de s'ouvrir. */
  key: Buffer;
  now?: () => number;
}

export class ServiceStore {
  readonly db: DatabaseSyncType;
  readonly now: () => number;
  private readonly key: Buffer;

  constructor(opts: StoreOptions) {
    if (opts.key.length !== 32)
      throw new StoreError("clé de stockage invalide (32 octets attendus)");
    this.key = opts.key;
    this.now = opts.now ?? Date.now;
    this.db = new DatabaseSync(opts.path);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"
    );
    this.migrate();
  }

  private migrate() {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS store_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
    );
    const row = this.db
      .prepare("SELECT v FROM store_meta WHERE k = 'schema'")
      .get() as { v: string } | undefined;
    const current = row ? Number(row.v) : 0;
    if (current > STORE_SCHEMA) {
      throw new StoreError(
        `stockage en schéma ${current}, ce service ne comprend que ${STORE_SCHEMA} : refus avant toute écriture`
      );
    }
    for (let v = current; v < STORE_SCHEMA; v++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db
          .prepare(
            "INSERT INTO store_meta(k, v) VALUES ('schema', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
          )
          .run(String(v + 1));
      });
    }
  }

  schema(): number {
    return Number(
      (
        this.db
          .prepare("SELECT v FROM store_meta WHERE k = 'schema'")
          .get() as { v: string }
      ).v
    );
  }

  /** Transaction immédiate : tout ou rien. */
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // -- Chiffrement ------------------------------------------------------------

  seal(aad: string, value: unknown): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(aad));
    const body = Buffer.concat([
      c.update(JSON.stringify(value), "utf8"),
      c.final(),
    ]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]);
  }

  open<T>(aad: string, blob: Uint8Array): T {
    const b = Buffer.from(blob);
    if (b[0] !== 1) throw new StoreError("format chiffré inconnu");
    const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(1, 13));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(b.subarray(13, 29));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(29)), d.final()]).toString("utf8")
    ) as T;
  }

  // -- Journal ----------------------------------------------------------------

  journal(): JournalStore {
    const aad = (k: SessionKey) => `journal|${k.cabinetId}|${k.callId}`;
    return {
      append: async (k, entry) => {
        this.tx(() => {
          const next = (
            this.db
              .prepare(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM journal WHERE cabinet_id = ? AND call_id = ?"
              )
              .get(k.cabinetId, k.callId) as { n: number }
          ).n;
          this.db
            .prepare(
              "INSERT INTO journal(cabinet_id, call_id, seq, entry, created_at) VALUES (?, ?, ?, ?, ?)"
            )
            .run(
              k.cabinetId,
              k.callId,
              next,
              this.seal(aad(k), entry),
              this.now()
            );
          this.db
            .prepare(
              "INSERT INTO calls(cabinet_id, call_id, state, updated_at) VALUES (?, ?, 'open', ?) ON CONFLICT(cabinet_id, call_id) DO UPDATE SET updated_at = excluded.updated_at"
            )
            .run(k.cabinetId, k.callId, this.now());
        });
      },
      load: async k => {
        const rows = this.db
          .prepare(
            "SELECT entry FROM journal WHERE cabinet_id = ? AND call_id = ? ORDER BY seq"
          )
          .all(k.cabinetId, k.callId) as { entry: Uint8Array }[];
        return rows.map(r => this.open<JournalEntry>(aad(k), r.entry));
      },
      compact: async (k, tombstone) => {
        this.tx(() => {
          this.db
            .prepare("DELETE FROM journal WHERE cabinet_id = ? AND call_id = ?")
            .run(k.cabinetId, k.callId);
          this.db
            .prepare(
              "INSERT INTO journal(cabinet_id, call_id, seq, entry, created_at) VALUES (?, ?, 1, ?, ?)"
            )
            .run(
              k.cabinetId,
              k.callId,
              this.seal(aad(k), tombstone),
              this.now()
            );
          this.db
            .prepare(
              "UPDATE calls SET state = 'closed', updated_at = ? WHERE cabinet_id = ? AND call_id = ?"
            )
            .run(this.now(), k.cabinetId, k.callId);
        });
      },
    };
  }

  // -- État déclaré par le poste ---------------------------------------------

  setCabinetStatus(cabinetId: string, status: unknown, validUntil: number) {
    this.db
      .prepare(
        "INSERT INTO cabinet_status(cabinet_id, status, received_at, valid_until) VALUES (?, ?, ?, ?) ON CONFLICT(cabinet_id) DO UPDATE SET status = excluded.status, received_at = excluded.received_at, valid_until = excluded.valid_until"
      )
      .run(
        cabinetId,
        this.seal(`status|${cabinetId}`, status),
        this.now(),
        validUntil
      );
  }

  cabinetStatus<T>(
    cabinetId: string
  ): { status: T; receivedAt: number; validUntil: number } | null {
    const r = this.db
      .prepare(
        "SELECT status, received_at, valid_until FROM cabinet_status WHERE cabinet_id = ?"
      )
      .get(cabinetId) as
      | { status: Uint8Array; received_at: number; valid_until: number }
      | undefined;
    return r
      ? {
          status: this.open<T>(`status|${cabinetId}`, r.status),
          receivedAt: r.received_at,
          validUntil: r.valid_until,
        }
      : null;
  }

  // -- Révocation des jetons de poste -----------------------------------------

  /** Révocation durable : le jeton reste refusé même s'il figure encore dans la configuration. */
  revokeToken(tokenHash: string, cabinetId: string) {
    this.db
      .prepare(
        "INSERT INTO revoked_tokens(token_hash, cabinet_id, revoked_at) VALUES (?, ?, ?) ON CONFLICT(token_hash) DO NOTHING"
      )
      .run(tokenHash, cabinetId, this.now());
  }

  isRevoked(tokenHash: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM revoked_tokens WHERE token_hash = ?")
      .get(tokenHash);
  }

  // -- Rappels ----------------------------------------------------------------

  /** Un magasin de rappels limité à UN cabinet (la clé de stockage le porte). */
  reminders(cabinetId: string): ReminderStore {
    const aad = (id: string) => `reminder|${cabinetId}|${id}`;
    const read = (row: { id: string; data: Uint8Array } | undefined) =>
      row ? this.open<Reminder>(aad(row.id), row.data) : undefined;
    const store: ReminderStore = {
      get: async id =>
        read(
          this.db
            .prepare(
              "SELECT id, data FROM reminders WHERE cabinet_id = ? AND id = ?"
            )
            .get(cabinetId, id) as { id: string; data: Uint8Array } | undefined
        ),
      put: async r => {
        this.db
          .prepare(
            "INSERT INTO reminders(cabinet_id, id, appointment, data, status, due_at, lock_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cabinet_id, id) DO UPDATE SET data = excluded.data, status = excluded.status, due_at = excluded.due_at, lock_until = excluded.lock_until, updated_at = excluded.updated_at"
          )
          .run(
            cabinetId,
            r.id,
            r.appointmentRef,
            this.seal(aad(r.id), r),
            r.status,
            Date.parse(r.dueAt),
            r.lockedUntil ? Date.parse(r.lockedUntil) : null,
            this.now()
          );
      },
      byAppointment: async ref =>
        (
          this.db
            .prepare(
              "SELECT id, data FROM reminders WHERE cabinet_id = ? AND appointment = ?"
            )
            .all(cabinetId, ref) as { id: string; data: Uint8Array }[]
        ).map(r => read(r)!),
      due: async nowIso => {
        const now = Date.parse(nowIso);
        return (
          this.db
            .prepare(
              "SELECT id, data FROM reminders WHERE cabinet_id = ? AND due_at <= ? AND (status = 'scheduled' OR (status = 'sending' AND lock_until < ?)) ORDER BY due_at"
            )
            .all(cabinetId, now, now) as { id: string; data: Uint8Array }[]
        ).map(r => read(r)!);
      },
      tryLock: async (id, expected: ReminderStatus, worker, until, nowIso) =>
        this.tx(() => {
          const now = Date.parse(nowIso);
          const row = this.db
            .prepare(
              "SELECT id, data, status, lock_until FROM reminders WHERE cabinet_id = ? AND id = ?"
            )
            .get(cabinetId, id) as
            | {
                id: string;
                data: Uint8Array;
                status: string;
                lock_until: number | null;
              }
            | undefined;
          if (!row) return false;
          const expiredLock =
            row.status === "sending" &&
            row.lock_until !== null &&
            row.lock_until < now;
          if (row.status !== expected && !expiredLock) return false;
          const r = read(row)!;
          r.status = "sending";
          r.lockedBy = worker;
          r.lockedUntil = until;
          this.db
            .prepare(
              "UPDATE reminders SET data = ?, status = 'sending', lock_until = ?, updated_at = ? WHERE cabinet_id = ? AND id = ?"
            )
            .run(
              this.seal(aad(id), r),
              Date.parse(until),
              this.now(),
              cabinetId,
              id
            );
          return true;
        }),
    };
    return store;
  }

  /** Tous les cabinets qui ont des rappels (pour le travailleur). */
  reminderCabinets(): string[] {
    return (
      this.db.prepare("SELECT DISTINCT cabinet_id FROM reminders").all() as {
        cabinet_id: string;
      }[]
    ).map(r => r.cabinet_id);
  }

  // -- Exploitation -------------------------------------------------------------

  /** Purge par ancienneté. Rend les nombres supprimés, par table. */
  purge(retentionDays: number): Record<string, number> {
    const limit = this.now() - retentionDays * 86400000;
    return this.tx(() => {
      const closed = this.db
        .prepare(
          "SELECT cabinet_id, call_id FROM calls WHERE state = 'closed' AND updated_at < ?"
        )
        .all(limit) as { cabinet_id: string; call_id: string }[];
      // Un appel ouvert depuis plus longtemps que la rétention est abandonné : on ne le garde pas.
      const stale = this.db
        .prepare(
          "SELECT cabinet_id, call_id FROM calls WHERE state = 'open' AND updated_at < ?"
        )
        .all(limit) as { cabinet_id: string; call_id: string }[];
      let journal = 0;
      for (const c of [...closed, ...stale]) {
        journal += Number(
          this.db
            .prepare("DELETE FROM journal WHERE cabinet_id = ? AND call_id = ?")
            .run(c.cabinet_id, c.call_id).changes
        );
        this.db
          .prepare("DELETE FROM calls WHERE cabinet_id = ? AND call_id = ?")
          .run(c.cabinet_id, c.call_id);
      }
      const relay = Number(
        this.db
          .prepare(
            "DELETE FROM relay_items WHERE state IN ('done','expired','dead') AND updated_at < ?"
          )
          .run(limit).changes
      );
      const reminders = Number(
        this.db
          .prepare(
            "DELETE FROM reminders WHERE status NOT IN ('scheduled','sending') AND updated_at < ?"
          )
          .run(limit).changes
      );
      return { calls: closed.length + stale.length, journal, relay, reminders };
    });
  }

  /** Sauvegarde cohérente, à chaud. Le fichier produit reste chiffré par contenu. */
  backup(destination: string) {
    this.db.prepare("VACUUM INTO ?").run(destination);
  }

  /** Comptes sans contenu, pour la supervision. */
  health(): Record<string, number> {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      schema: this.schema(),
      openCalls: n("SELECT count(*) AS n FROM calls WHERE state = 'open'"),
      relayReady: n(
        "SELECT count(*) AS n FROM relay_items WHERE state = 'ready'"
      ),
      relayLeased: n(
        "SELECT count(*) AS n FROM relay_items WHERE state = 'leased'"
      ),
      relayDead: n(
        "SELECT count(*) AS n FROM relay_items WHERE state = 'dead'"
      ),
      relayExpired: n(
        "SELECT count(*) AS n FROM relay_items WHERE state = 'expired'"
      ),
      remindersScheduled: n(
        "SELECT count(*) AS n FROM reminders WHERE status = 'scheduled'"
      ),
    };
  }

  close() {
    this.db.close();
  }
}

/** Lit la clé de stockage : 64 caractères hexadécimaux, ou rien. */
export const storageKeyFromEnv = (hex: string | undefined): Buffer | null =>
  hex && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
