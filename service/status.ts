/**
 * NJP CALL — ce que le poste NJP CARE déclare au service, et la prudence
 * quand cette déclaration manque ou vieillit.
 *
 * Le service 24/7 ne lit pas le coffre : il ne sait que ce que le poste lui
 * dit (`POST /v1/care/status`) à chaque relève réussie. Cette déclaration a
 * une durée de validité courte, bornée à 24 h.
 *
 * | État | Commandes effectives (réserver) | Demandes, messages | Rappels |
 * |---|---|---|---|
 * | jamais déclaré | converties en demande (`authorization_stale`) | transmises au relais | aucun |
 * | déclaré, valide, activé | relayées ; NJP CARE décide | relayées | selon réglage |
 * | déclaré, valide, **désactivé** | `unsupported` | `unsupported` | suspendus ou annulés (réglage) |
 * | déclaré, **périmé** | converties en demande (`authorization_stale`) | transmises au relais | aucun envoi |
 *
 * Le poste reste l'autorité : une déclaration fraîche n'autorise rien que le
 * coffre refuserait. Elle sert à NE PAS promettre ce qui ne pourra pas être
 * tenu (appelant informé honnêtement, rappels arrêtés après désactivation).
 */
import type { CommandEnvelope, CommandResult } from "../core/commands";
import {
  EFFECTIVE_COMMANDS,
  type AvailabilityReader,
  type CareGateway,
} from "../core/gateway";
import type { ServiceStore } from "./store";

export interface CabinetStatus {
  v: 1;
  extensionEnabled: boolean;
  permissions: string[];
  bookingEnabled: boolean;
  remindersOnDisable: "suspend" | "cancel";
  issuedAt: string;
  validForSeconds: number;
}

export const MAX_STATUS_VALIDITY_S = 86_400;
const PERMISSION = /^[a-z]+(\.[a-z]+){1,3}$/;

/** Validation stricte : champ inconnu, type faux, durée hors bornes ⇒ refus. */
export const parseStatus = (raw: unknown): CabinetStatus | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const o = raw as Record<string, unknown>;
  const keys = [
    "v",
    "extensionEnabled",
    "permissions",
    "bookingEnabled",
    "remindersOnDisable",
    "issuedAt",
    "validForSeconds",
  ];
  if (Object.keys(o).length !== keys.length || keys.some(k => !(k in o)))
    return null;
  if (o.v !== 1) return null;
  if (typeof o.extensionEnabled !== "boolean") return null;
  if (typeof o.bookingEnabled !== "boolean") return null;
  if (o.remindersOnDisable !== "suspend" && o.remindersOnDisable !== "cancel")
    return null;
  if (
    !Array.isArray(o.permissions) ||
    o.permissions.length > 32 ||
    !o.permissions.every(p => typeof p === "string" && PERMISSION.test(p))
  )
    return null;
  if (typeof o.issuedAt !== "string" || Number.isNaN(Date.parse(o.issuedAt)))
    return null;
  if (
    !Number.isInteger(o.validForSeconds) ||
    (o.validForSeconds as number) < 60 ||
    (o.validForSeconds as number) > MAX_STATUS_VALIDITY_S
  )
    return null;
  return o as unknown as CabinetStatus;
};

export type StatusVerdict = "unknown" | "fresh" | "stale" | "disabled";

/**
 * La validité court depuis la RÉCEPTION par le service (son horloge), pas
 * depuis `issuedAt` (horloge du poste) : un poste à l'heure fausse ne peut
 * pas prolonger son autorisation.
 */
export const statusVerdict = (
  store: ServiceStore,
  cabinetId: string
): { verdict: StatusVerdict; status: CabinetStatus | null } => {
  const s = store.cabinetStatus<CabinetStatus>(cabinetId);
  if (!s) return { verdict: "unknown", status: null };
  if (!s.status.extensionEnabled)
    return { verdict: "disabled", status: s.status };
  if (s.validUntil < store.now()) return { verdict: "stale", status: s.status };
  return { verdict: "fresh", status: s.status };
};

export const recordStatus = (
  store: ServiceStore,
  cabinetId: string,
  status: CabinetStatus
) => {
  store.setCabinetStatus(
    cabinetId,
    status,
    store.now() + status.validForSeconds * 1000
  );
};

/** Les rappels ne partent que si la déclaration est fraîche ET l'extension activée. */
export const remindersAllowed = (store: ServiceStore, cabinetId: string) =>
  statusVerdict(store, cabinetId).verdict === "fresh";

/** Enveloppe la passerelle réelle : prudence selon la déclaration du poste. */
export class StatusGate implements CareGateway {
  readonly mode = "live" as const;
  constructor(
    private readonly store: ServiceStore,
    private readonly inner: CareGateway
  ) {}

  async submit(envelope: CommandEnvelope): Promise<CommandResult> {
    const { verdict } = statusVerdict(this.store, envelope.cabinetId);
    if (verdict === "disabled")
      return {
        idempotencyKey: envelope.idempotencyKey,
        status: "unsupported",
        reason: "extension_disabled",
      };
    if (
      verdict !== "fresh" &&
      EFFECTIVE_COMMANDS.includes(envelope.command.type)
    )
      return {
        idempotencyKey: envelope.idempotencyKey,
        status: "failed",
        reason: "authorization_stale",
      };
    return this.inner.submit(envelope);
  }
}

/** Même prudence pour la lecture des créneaux : pas de proposition sans autorisation fraîche. */
export const gatedAvailability = (
  store: ServiceStore,
  inner: AvailabilityReader
): AvailabilityReader => ({
  findSlots: async (cabinetId, query) => {
    const { verdict, status } = statusVerdict(store, cabinetId);
    if (verdict === "disabled")
      return { status: "unsupported", slots: [], reason: "extension_disabled" };
    if (verdict !== "fresh" || !status?.bookingEnabled)
      return { status: "failed", slots: [], reason: "authorization_stale" };
    return inner.findSlots(cabinetId, query);
  },
});
