/**
 * NJP CALL — la passerelle vers NJP CARE.
 *
 * NJP CARE est l'autorité : il décide si une commande est permise, et lui
 * seul peut rendre `confirmed`. Cette couche ne fait que transporter et
 * **borner** ce qui revient :
 *
 * - `UnsupportedGateway` : aucun connecteur configuré. Tout est `unsupported`.
 *   C'est le comportement **par défaut** — pas une simulation déguisée.
 * - `SimulationGateway` : activée explicitement (recette, démonstration).
 *   Rend `simulated`, **jamais** `confirmed`, et le dit.
 * - `QueueingGateway` : NJP CARE injoignable ⇒ la commande est mise en file
 *   durable et rend `pending` ; une réservation définitive n'est jamais
 *   annoncée hors ligne.
 * - `guardResult` : toute passerelle passe par elle ; un résultat incohérent
 *   (clé différente, statut inconnu, `confirmed` sans référence) devient
 *   `failed`.
 */
import {
  ACTION_STATUSES,
  type CommandEnvelope,
  type CommandResult,
  type CommandType,
  validateEnvelope,
} from "./commands";

export interface CareGateway {
  readonly mode: "none" | "simulation" | "live";
  submit(envelope: CommandEnvelope): Promise<CommandResult>;
}

/** Commandes qui modifient réellement le planning : jamais confirmées hors ligne. */
export const EFFECTIVE_COMMANDS: readonly CommandType[] = [
  "appointment.book",
  "appointment.reschedule",
  "appointment.cancel",
];

/**
 * Normalise un résultat reçu. Une passerelle défaillante ou un service
 * compromis ne peut pas faire annoncer une réussite qui n'a pas eu lieu.
 */
export const guardResult = (
  envelope: CommandEnvelope,
  raw: unknown,
  mode: CareGateway["mode"]
): CommandResult => {
  const failed = (reason: string): CommandResult => ({
    idempotencyKey: envelope.idempotencyKey,
    status: "failed",
    reason,
  });
  if (typeof raw !== "object" || raw === null)
    return failed("result_malformed");
  const r = raw as Partial<CommandResult>;
  if (r.idempotencyKey !== envelope.idempotencyKey)
    return failed("result_key_mismatch");
  if (
    typeof r.status !== "string" ||
    !(ACTION_STATUSES as readonly string[]).includes(r.status)
  ) {
    return failed("result_status_unknown");
  }
  if (r.status === "confirmed") {
    if (mode !== "live") return failed("confirmed_outside_live");
    if (typeof r.reference !== "string" || !r.reference)
      return failed("confirmed_without_reference");
  }
  if (r.status === "simulated" && mode !== "simulation")
    return failed("simulated_outside_simulation");
  return {
    idempotencyKey: r.idempotencyKey,
    status: r.status,
    ...(typeof r.reference === "string" ? { reference: r.reference } : {}),
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    ...(r.replayed === true ? { replayed: true } : {}),
    ...(r.detail && typeof r.detail === "object" ? { detail: r.detail } : {}),
  };
};

const invalid = (envelope: CommandEnvelope): CommandResult | null => {
  const defects = validateEnvelope(envelope);
  return defects.length
    ? {
        idempotencyKey: envelope.idempotencyKey,
        status: "refused",
        reason: `invalid:${defects[0]}`,
      }
    : null;
};

export class UnsupportedGateway implements CareGateway {
  readonly mode = "none" as const;
  async submit(envelope: CommandEnvelope): Promise<CommandResult> {
    return (
      invalid(envelope) ?? {
        idempotencyKey: envelope.idempotencyKey,
        status: "unsupported",
        reason: "no_care_connector",
      }
    );
  }
}

/**
 * Simulation explicite. Les créneaux proposés sont fictifs et marqués comme
 * tels ; aucune commande n'est jamais `confirmed`.
 */
export class SimulationGateway implements CareGateway {
  readonly mode = "simulation" as const;
  readonly log: CommandEnvelope[] = [];
  private readonly seen = new Map<string, CommandResult>();

  constructor(enabledExplicitly: boolean) {
    if (!enabledExplicitly)
      throw new Error("La simulation doit être activée explicitement.");
  }

  async submit(envelope: CommandEnvelope): Promise<CommandResult> {
    const bad = invalid(envelope);
    if (bad) return bad;
    const known = this.seen.get(envelope.idempotencyKey);
    if (known) return { ...known, replayed: true };
    this.log.push(envelope);
    const result: CommandResult = {
      idempotencyKey: envelope.idempotencyKey,
      status: "simulated",
      reference: `sim_${this.log.length}`,
      reason: "simulation_only",
    };
    this.seen.set(envelope.idempotencyKey, result);
    return guardResult(envelope, result, this.mode);
  }
}

/**
 * La commande n'a pas quitté le service (NJP CARE injoignable, connexion
 * refusée) : on SAIT qu'elle n'a rien modifié.
 */
export class NotDelivered extends Error {}
/**
 * La commande est peut-être arrivée (coupure après envoi, délai dépassé) :
 * on NE SAIT PAS. Seul un rejeu avec la même clé peut le dire.
 */
export class OutcomeUnknown extends Error {}

/** Transport vers NJP CARE (relais 24/7 → poste). Implémenté par le service. */
export interface CareTransport {
  /** Lève `NotDelivered` ou `OutcomeUnknown` ; sinon rend le résultat brut. */
  send(envelope: CommandEnvelope): Promise<unknown>;
}

/** File durable de commandes en attente d'un NJP CARE joignable. */
export interface CommandQueue {
  put(envelope: CommandEnvelope): Promise<void>;
  has(idempotencyKey: string): Promise<boolean>;
}

export class InMemoryCommandQueue implements CommandQueue {
  readonly items = new Map<string, CommandEnvelope>();
  async put(envelope: CommandEnvelope) {
    if (!this.items.has(envelope.idempotencyKey))
      this.items.set(envelope.idempotencyKey, envelope);
  }
  async has(key: string) {
    return this.items.has(key);
  }
}

/**
 * Passerelle réelle : NJP CARE joignable ⇒ son verdict ; injoignable ⇒ la
 * demande attend en file et l'appelant entend « transmis », pas « confirmé ».
 */
export class QueueingGateway implements CareGateway {
  readonly mode = "live" as const;
  constructor(
    private readonly transport: CareTransport,
    private readonly queue: CommandQueue,
    /** Rejeux immédiats (même clé) quand l'issue est inconnue. */
    private readonly retries = 2
  ) {}

  async submit(envelope: CommandEnvelope): Promise<CommandResult> {
    const bad = invalid(envelope);
    if (bad) return bad;
    const effective = EFFECTIVE_COMMANDS.includes(envelope.command.type);
    let unknown = false;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const raw = await this.transport.send(envelope);
        return guardResult(envelope, raw, this.mode);
      } catch (e) {
        if (e instanceof OutcomeUnknown) {
          unknown = true;
          continue; // même clé : NJP CARE rendra le résultat déjà enregistré
        }
        if (unknown) break; // une tentative a peut-être abouti : on ne conclut pas « rien fait »
        // Non remise : une modification effective n'est JAMAIS mise en file —
        // elle serait appliquée plus tard, sur un planning qui a pu changer,
        // sans que l'appelant connaisse le résultat. Le moteur de session la
        // convertit en demande.
        if (effective)
          return {
            idempotencyKey: envelope.idempotencyKey,
            status: "failed",
            reason: "care_offline",
          };
        await this.queue.put(envelope);
        return {
          idempotencyKey: envelope.idempotencyKey,
          status: "pending",
          reason: "care_offline_queued",
        };
      }
    }
    // Issue inconnue : la commande part en file de RÉCONCILIATION (même clé),
    // qui ne peut rien créer de plus — seulement apprendre ce qui s'est passé.
    await this.queue.put(envelope);
    return {
      idempotencyKey: envelope.idempotencyKey,
      status: "pending",
      reason: "outcome_unknown",
    };
  }
}

// ---------------------------------------------------------------------------
// Lecture des disponibilités (accès `planning.availability.read`)
// ---------------------------------------------------------------------------

export interface AvailabilityQuery {
  practitionerRef?: string;
  appointmentTypeRef?: string;
  locationRef?: string;
  /** Fenêtres acceptables pour l'appelant. */
  windows: { from: string; to: string }[];
  /** Nombre maximal de créneaux proposés (borné par NJP CARE). */
  limit: number;
}

export interface AvailabilityResult {
  status: "confirmed" | "simulated" | "unsupported" | "failed";
  slots: import("./commands").SlotChoice[];
  reason?: string;
}

/** Ce que NJP CALL peut lire de NJP CARE : des créneaux autorisés, rien d'autre. */
export interface AvailabilityReader {
  findSlots(
    cabinetId: string,
    query: AvailabilityQuery
  ): Promise<AvailabilityResult>;
}

export class NoAvailability implements AvailabilityReader {
  async findSlots(): Promise<AvailabilityResult> {
    return { status: "unsupported", slots: [], reason: "no_care_connector" };
  }
}
