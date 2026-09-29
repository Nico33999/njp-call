/**
 * Canal de rappels SIMULÉ, pour les bancs de contrat : il n'envoie rien, et
 * se déclare comme simulation. Il sert d'étalon à `tests/provider-contract`,
 * que tout adaptateur de prestataire réel (SMS, voix) devra passer.
 */
import {
  ReminderNotSent,
  ReminderOutcomeUnknown,
  type Reminder,
  type ReminderChannel,
} from "../reminders";

export class SimulatedReminderChannel implements ReminderChannel {
  readonly environment = "simulator" as const;
  readonly accepted = new Map<string, string>();
  /** Prochaine issue forcée : panne connue, ou issue inconnue après envoi. */
  next: "ok" | "down" | "lost" = "ok";

  async send(_r: Reminder, text: string, idempotencyKey: string) {
    if (!text || text.length > 320) throw new ReminderNotSent("texte refusé");
    const mode = this.next;
    this.next = "ok";
    if (mode === "down") throw new ReminderNotSent("prestataire indisponible");
    const known = this.accepted.get(idempotencyKey);
    const providerRef = known ?? `sim_${this.accepted.size + 1}`;
    this.accepted.set(idempotencyKey, providerRef);
    if (mode === "lost")
      throw new ReminderOutcomeUnknown("délai dépassé après envoi");
    return { providerRef };
  }
}
