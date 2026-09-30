/**
 * Doublure de NJP CARE pour les bancs NJP CALL.
 *
 * Elle applique les MÊMES règles que le moteur Rust
 * (`njp-care/desktop/crates/vault-engine/src/secretariat.rs`) : portes
 * d'installation, d'activation et d'accès ; cabinet ; idempotence avec
 * contrôle d'empreinte ; créneau pris ⇒ refus ; réservation confirmée
 * seulement par l'AUTORITÉ des créneaux (le cloud NJP CARE), sinon demande ;
 * réservation trop ancienne (> 2 min) jamais appliquée ; déplacement et
 * annulation ENREGISTRÉS comme demandes (identité de l'appelant non prouvée),
 * même réponse que le rendez-vous existe ou non.
 *
 * Elle ne remplace pas la preuve Rust : elle permet d'exercer le moteur de
 * conversation sans poste. Aucune donnée réelle, aucun envoi.
 */
import {
  COMMAND_PERMISSION,
  validateEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type SlotChoice,
} from "../commands";
import {
  NotDelivered,
  OutcomeUnknown,
  type AvailabilityQuery,
  type AvailabilityReader,
  type AvailabilityResult,
  type CareTransport,
} from "../gateway";

export interface FakeAppointment {
  ref: string;
  start: string;
  end: string;
  practitionerRef: string;
  declaredName: string;
  phone: string;
  status: "confirmed" | "cancelled";
  version: number;
}

export class FakeCare implements CareTransport, AvailabilityReader {
  online = true;
  installed = true;
  enabled = true;
  permissions = new Set(
    Object.values(COMMAND_PERMISSION).concat("planning.availability.read")
  );
  /** Échec simulé APRÈS écriture, avant réponse (coupure pendant une réservation). */
  dropResponseOnce = false;
  /**
   * L'autorité des créneaux (cloud NJP CARE) : `up` confirme, `down` ⇒ la
   * réservation devient une demande (`requested/authority_unreachable`),
   * `unknown` ⇒ `pending/outcome_unknown`.
   */
  authority: "up" | "down" | "unknown" = "up";
  /** Horloge du poste : si posée, une réservation de plus de 2 min est refusée. */
  now?: () => number;
  readonly records = new Map<string, { hash: string; result: CommandResult }>();
  readonly messages: { ref: string; envelope: CommandEnvelope }[] = [];
  readonly requests: { ref: string; envelope: CommandEnvelope }[] = [];
  readonly appointments: FakeAppointment[] = [];
  /** Demande → rendez-vous correspondant (indice pour le cabinet seulement). */
  readonly hints = new Map<string, string | null>();
  readonly audit: { key: string; type: string; status: string }[] = [];
  private n = 0;

  constructor(
    readonly cabinetId: string,
    public freeSlots: SlotChoice[]
  ) {}

  private ref(prefix: string) {
    return `${prefix}_${(++this.n).toString().padStart(4, "0")}`;
  }

  async findSlots(
    cabinetId: string,
    q: AvailabilityQuery
  ): Promise<AvailabilityResult> {
    if (!this.online) throw new NotDelivered("offline");
    if (
      cabinetId !== this.cabinetId ||
      !this.installed ||
      !this.enabled ||
      !this.permissions.has("planning.availability.read")
    ) {
      return { status: "failed", slots: [], reason: "forbidden" };
    }
    const taken = (s: SlotChoice) =>
      this.appointments.some(
        a =>
          a.status === "confirmed" &&
          a.practitionerRef === s.practitionerRef &&
          a.start < s.end &&
          s.start < a.end
      );
    const inWindow = (s: SlotChoice) =>
      !q.windows.length ||
      q.windows.some(
        w =>
          Date.parse(s.start) >= Date.parse(w.from) &&
          Date.parse(s.end) <= Date.parse(w.to)
      );
    const slots = this.freeSlots
      .filter(
        s =>
          !taken(s) &&
          inWindow(s) &&
          (!q.practitionerRef || s.practitionerRef === q.practitionerRef)
      )
      .slice(0, Math.min(q.limit, 3));
    return { status: "confirmed", slots };
  }

  async send(envelope: CommandEnvelope): Promise<unknown> {
    if (!this.online) throw new NotDelivered("offline");
    const result = this.apply(envelope);
    if (this.dropResponseOnce) {
      this.dropResponseOnce = false;
      throw new OutcomeUnknown("connection reset after write");
    }
    return result;
  }

  private apply(env: CommandEnvelope): CommandResult {
    const key = env.idempotencyKey;
    const refuse = (reason: string): CommandResult => ({
      idempotencyKey: key,
      status: "refused",
      reason,
    });
    if (validateEnvelope(env).length) return refuse("invalid_envelope");
    if (env.cabinetId !== this.cabinetId) return refuse("wrong_cabinet");
    if (!this.installed) return refuse("extension_not_installed");
    if (!this.enabled) return refuse("extension_disabled");
    if (!this.permissions.has(COMMAND_PERMISSION[env.command.type]))
      return refuse("extension_forbidden");
    const hash = JSON.stringify(env.command);
    const known = this.records.get(key);
    if (known)
      return known.hash === hash
        ? { ...known.result, replayed: true }
        : refuse("idempotency_conflict");

    let result: CommandResult;
    const c = env.command;
    switch (c.type) {
      case "message.create":
      case "callback.request":
      case "call.report": {
        const ref = this.ref(
          c.type === "message.create"
            ? "msg"
            : c.type === "callback.request"
              ? "cbk"
              : "rpt"
        );
        this.messages.push({ ref, envelope: env });
        result = { idempotencyKey: key, status: "confirmed", reference: ref };
        break;
      }
      case "appointment.request": {
        const ref = this.ref("areq");
        this.requests.push({ ref, envelope: env });
        result = { idempotencyKey: key, status: "confirmed", reference: ref };
        break;
      }
      case "call.transfer":
        result = {
          idempotencyKey: key,
          status: "requested",
          reference: this.ref("xfer"),
        };
        break;
      case "appointment.book": {
        const s = c.payload.slot;
        if (
          this.now &&
          Math.abs(this.now() - Date.parse(env.issuedAt)) > 120_000
        )
          return this.store(key, hash, refuse("command_expired"));
        const offered = this.freeSlots.some(
          f => f.slotRef === s.slotRef && f.start === s.start && f.end === s.end
        );
        if (!offered) return this.store(key, hash, refuse("slot_not_offered"));
        if (this.overlaps(s))
          return this.store(key, hash, refuse("slot_unavailable"));
        if (this.authority === "down") {
          const ref = this.ref("areq");
          this.requests.push({ ref, envelope: env });
          result = {
            idempotencyKey: key,
            status: "requested",
            reference: ref,
            reason: "authority_unreachable",
          };
          break;
        }
        const ref = this.ref("appt");
        this.appointments.push({
          ref,
          start: s.start,
          end: s.end,
          practitionerRef: s.practitionerRef,
          declaredName: c.payload.person.declaredName,
          phone: c.payload.person.phone!,
          status: "confirmed",
          version: 1,
        });
        result =
          this.authority === "unknown"
            ? {
                idempotencyKey: key,
                status: "pending",
                reference: ref,
                reason: "outcome_unknown",
              }
            : { idempotencyKey: key, status: "confirmed", reference: ref };
        break;
      }
      case "appointment.reschedule":
      case "appointment.cancel": {
        // Une demande, jamais une modification ; l'indice de correspondance
        // n'est visible que du cabinet, la réponse ne le trahit pas.
        const ref = this.ref("areq");
        this.requests.push({ ref, envelope: env });
        this.hints.set(ref, this.verify(c.payload.verification)?.ref ?? null);
        result = {
          idempotencyKey: key,
          status: "requested",
          reference: ref,
          reason: "recorded_as_request",
        };
        break;
      }
    }
    return this.store(key, hash, result);
  }

  private store(key: string, hash: string, result: CommandResult) {
    this.records.set(key, { hash, result });
    this.audit.push({ key, type: key.split("/")[1], status: result.status });
    return result;
  }

  private overlaps(s: SlotChoice, except?: string) {
    return this.appointments.some(
      a =>
        a.ref !== except &&
        a.status === "confirmed" &&
        a.practitionerRef === s.practitionerRef &&
        a.start < s.end &&
        s.start < a.end
    );
  }

  /** Nom ET numéro ET horaire : un numéro partagé ne suffit pas. */
  private verify(v: {
    currentStart: string;
    declaredName: string;
    phone: string;
  }) {
    const norm = (x: string) =>
      x
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const hits = this.appointments.filter(
      a =>
        a.status === "confirmed" &&
        Date.parse(a.start) === Date.parse(v.currentStart) &&
        a.phone === v.phone &&
        norm(a.declaredName) === norm(v.declaredName)
    );
    return hits.length === 1 ? hits[0] : undefined;
  }
}
