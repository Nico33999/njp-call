/**
 * NJP CALL — les rappels automatiques de rendez-vous.
 *
 * À ne pas confondre avec la **demande de rappel** (`callback.request`), où
 * c'est le cabinet qui rappelle une personne. Ici, NJP CALL prévient un
 * patient d'un rendez-vous **confirmé** dans NJP CARE.
 *
 * ## Invariants
 *
 * - Un rappel naît d'un rendez-vous confirmé, et d'une **version** de ce
 *   rendez-vous. Déplacé : l'ancien rappel devient obsolète, un nouveau naît.
 *   Annulé : les rappels à venir sont annulés.
 * - Un rappel n'est envoyé qu'une fois : un verrou à expiration empêche deux
 *   travailleurs de l'envoyer ensemble, et l'état est revérifié juste avant.
 * - Avant l'envoi, la version du rendez-vous est relue : un rappel pour un
 *   horaire qui n'est plus le bon n'est jamais envoyé.
 * - L'envoi respecte une fenêtre horaire (Europe/Paris).
 * - Un **répondeur** n'est pas une confirmation du patient.
 * - Le canal (SMS, voix) est une interface : aucun prestataire n'est câblé ici.
 */
import { parisDateOf, parisLocalToInstant } from "./datetime";

export type ReminderChannelKind = "sms" | "voice";

export type ReminderStatus =
  | "scheduled"
  | "sending"
  | "sent" // remis au prestataire
  | "delivered" // SMS remis au téléphone
  | "answered" // appel décroché par une personne
  | "voicemail" // appel tombé sur un répondeur
  | "confirmed_by_patient"
  | "failed"
  | "cancelled"
  | "obsolete";

export interface AppointmentFact {
  appointmentRef: string;
  /** Version du rendez-vous dans NJP CARE : change à chaque déplacement. */
  version: number;
  start: string;
  phone: string;
  status: "confirmed" | "cancelled";
}

export interface Reminder {
  id: string;
  appointmentRef: string;
  appointmentVersion: number;
  appointmentStart: string;
  phone: string;
  channel: ReminderChannelKind;
  dueAt: string;
  status: ReminderStatus;
  attempts: number;
  lockedBy?: string;
  lockedUntil?: string;
  history: { at: string; event: string; detail?: string }[];
}

export interface ReminderPolicy {
  hoursBefore: number;
  channel: ReminderChannelKind;
  /** Fenêtre d'envoi, heure de Paris, « HH:MM ». */
  window: { from: string; to: string };
  maxAttempts: number;
  retryMinutes: number;
  lockSeconds: number;
}

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  hoursBefore: 24,
  channel: "sms",
  window: { from: "09:00", to: "19:00" },
  maxAttempts: 3,
  retryMinutes: 60,
  lockSeconds: 120,
};

export interface ReminderChannel {
  /** Rend l'identifiant du prestataire, ou lève. N'envoie rien en test. */
  send(reminder: Reminder, text: string): Promise<{ providerRef: string }>;
}

/** Ce que NJP CARE dit d'un rendez-vous, au moment de l'envoi. */
export interface AppointmentLookup {
  current(appointmentRef: string): Promise<AppointmentFact | null>;
}

export interface ReminderStore {
  get(id: string): Promise<Reminder | undefined>;
  put(r: Reminder): Promise<void>;
  byAppointment(ref: string): Promise<Reminder[]>;
  due(nowIso: string): Promise<Reminder[]>;
  /** Compare-et-échange : ne pose le verrou que si l'état n'a pas bougé. */
  tryLock(
    id: string,
    expectedStatus: ReminderStatus,
    worker: string,
    until: string,
    nowIso: string
  ): Promise<boolean>;
}

export class InMemoryReminderStore implements ReminderStore {
  readonly items = new Map<string, Reminder>();
  async get(id: string) {
    const r = this.items.get(id);
    return r && structuredClone(r);
  }
  async put(r: Reminder) {
    this.items.set(r.id, structuredClone(r));
  }
  async byAppointment(ref: string) {
    return [...this.items.values()]
      .filter(r => r.appointmentRef === ref)
      .map(r => structuredClone(r));
  }
  async due(nowIso: string) {
    const now = Date.parse(nowIso);
    return [...this.items.values()]
      .filter(
        r =>
          (r.status === "scheduled" ||
            (r.status === "sending" &&
              r.lockedUntil &&
              Date.parse(r.lockedUntil) < now)) &&
          Date.parse(r.dueAt) <= now
      )
      .map(r => structuredClone(r));
  }
  async tryLock(
    id: string,
    expected: ReminderStatus,
    worker: string,
    until: string,
    nowIso: string
  ) {
    const r = this.items.get(id);
    if (!r) return false;
    const expiredLock =
      r.status === "sending" &&
      r.lockedUntil !== undefined &&
      Date.parse(r.lockedUntil) < Date.parse(nowIso);
    if (r.status !== expected && !expiredLock) return false;
    r.status = "sending";
    r.lockedBy = worker;
    r.lockedUntil = until;
    return true;
  }
}

const iso = (ms: number) =>
  new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return { h, min: m };
};

/** Prochain instant d'envoi autorisé à partir de `ms` (fenêtre de Paris). */
export const nextAllowed = (
  ms: number,
  window: ReminderPolicy["window"]
): number => {
  for (let day = 0; day < 8; day++) {
    const d = parisDateOf(ms + day * 86400000);
    const open = parisLocalToInstant(d, hm(window.from));
    const close = parisLocalToInstant(d, hm(window.to));
    if (open.kind !== "ok" || close.kind !== "ok") continue;
    if (ms <= open.utcMs) return open.utcMs;
    if (ms < close.utcMs) return ms;
  }
  return ms;
};

export class ReminderEngine {
  constructor(
    private readonly store: ReminderStore,
    private readonly channels: Record<
      ReminderChannelKind,
      ReminderChannel | undefined
    >,
    private readonly lookup: AppointmentLookup,
    private readonly policy: ReminderPolicy = DEFAULT_REMINDER_POLICY
  ) {}

  private idFor(a: AppointmentFact) {
    return `${a.appointmentRef}:v${a.version}:${this.policy.channel}`;
  }

  /** Rendez-vous confirmé (ou nouvelle version) : programme un rappel, une seule fois. */
  async onAppointmentConfirmed(
    a: AppointmentFact,
    nowIso: string
  ): Promise<Reminder | null> {
    if (a.status !== "confirmed") return null;
    // Les versions précédentes deviennent obsolètes.
    for (const old of await this.store.byAppointment(a.appointmentRef)) {
      if (
        old.appointmentVersion < a.version &&
        ["scheduled", "sending"].includes(old.status)
      ) {
        old.status = "obsolete";
        old.history.push({
          at: nowIso,
          event: "obsolete",
          detail: `version ${a.version}`,
        });
        await this.store.put(old);
      }
    }
    const id = this.idFor(a);
    const existing = await this.store.get(id);
    if (existing) return existing; // idempotent
    const startMs = Date.parse(a.start);
    const target = Math.max(
      startMs - this.policy.hoursBefore * 3600000,
      Date.parse(nowIso)
    );
    const due = nextAllowed(target, this.policy.window);
    if (due >= startMs - 3600000) {
      // Trop tard pour prévenir utilement : on ne programme pas, et on le dit.
      const r: Reminder = this.base(
        a,
        iso(Date.parse(nowIso)),
        "failed",
        nowIso,
        "no_window_before_appointment"
      );
      await this.store.put(r);
      return r;
    }
    const r = this.base(a, iso(due), "scheduled", nowIso, "scheduled");
    await this.store.put(r);
    return r;
  }

  private base(
    a: AppointmentFact,
    dueAt: string,
    status: ReminderStatus,
    nowIso: string,
    event: string
  ): Reminder {
    return {
      id: this.idFor(a),
      appointmentRef: a.appointmentRef,
      appointmentVersion: a.version,
      appointmentStart: a.start,
      phone: a.phone,
      channel: this.policy.channel,
      dueAt,
      status,
      attempts: 0,
      history: [{ at: nowIso, event }],
    };
  }

  async onAppointmentCancelled(appointmentRef: string, nowIso: string) {
    for (const r of await this.store.byAppointment(appointmentRef)) {
      if (["scheduled", "sending"].includes(r.status)) {
        r.status = "cancelled";
        r.history.push({
          at: nowIso,
          event: "cancelled",
          detail: "appointment_cancelled",
        });
        await this.store.put(r);
      }
    }
  }

  /**
   * Désactivation de l'extension : politique explicite pour les rappels à
   * venir. `suspend` les garde (reprise à la réactivation), `cancel` les annule.
   */
  async onExtensionDisabled(
    policy: "suspend" | "cancel",
    nowIso: string,
    all: Reminder[]
  ) {
    for (const r of all) {
      if (r.status !== "scheduled") continue;
      r.status = policy === "cancel" ? "cancelled" : "scheduled";
      r.history.push({
        at: nowIso,
        event: policy === "cancel" ? "cancelled" : "suspended",
        detail: "extension_disabled",
      });
      await this.store.put(r);
    }
  }

  /** Envoie ce qui est dû. Sûr à appeler depuis plusieurs travailleurs. */
  async runDue(
    nowIso: string,
    worker: string,
    enabled: boolean
  ): Promise<Reminder[]> {
    if (!enabled) return [];
    const handled: Reminder[] = [];
    for (const candidate of await this.store.due(nowIso)) {
      const until = iso(Date.parse(nowIso) + this.policy.lockSeconds * 1000);
      if (
        !(await this.store.tryLock(
          candidate.id,
          "scheduled",
          worker,
          until,
          nowIso
        ))
      )
        continue;
      const r = (await this.store.get(candidate.id))!;
      const fact = await this.lookup.current(r.appointmentRef);
      if (
        !fact ||
        fact.status !== "confirmed" ||
        fact.version !== r.appointmentVersion ||
        fact.start !== r.appointmentStart
      ) {
        r.status = fact?.status === "cancelled" ? "cancelled" : "obsolete";
        r.history.push({
          at: nowIso,
          event: r.status,
          detail: "rechecked_before_send",
        });
        await this.store.put(r);
        handled.push(r);
        continue;
      }
      const allowed = nextAllowed(Date.parse(nowIso), this.policy.window);
      if (allowed > Date.parse(nowIso)) {
        r.status = "scheduled";
        r.dueAt = iso(allowed);
        r.history.push({ at: nowIso, event: "deferred_to_window" });
        await this.store.put(r);
        continue;
      }
      const channel = this.channels[r.channel];
      r.attempts += 1;
      if (!channel) {
        r.status = "failed";
        r.history.push({
          at: nowIso,
          event: "failed",
          detail: "no_channel_configured",
        });
      } else {
        try {
          const { providerRef } = await channel.send(r, reminderText(r));
          r.status = "sent";
          r.history.push({ at: nowIso, event: "sent", detail: providerRef });
        } catch {
          if (r.attempts >= this.policy.maxAttempts) {
            r.status = "failed";
            r.history.push({
              at: nowIso,
              event: "failed",
              detail: "max_attempts",
            });
          } else {
            r.status = "scheduled";
            r.dueAt = iso(
              nextAllowed(
                Date.parse(nowIso) + this.policy.retryMinutes * 60000,
                this.policy.window
              )
            );
            r.history.push({ at: nowIso, event: "retry_scheduled" });
          }
        }
      }
      r.lockedBy = undefined;
      r.lockedUntil = undefined;
      await this.store.put(r);
      handled.push(r);
    }
    return handled;
  }

  /**
   * Compte rendu du prestataire. Un répondeur reste un répondeur : seule une
   * réponse explicite du patient (touche, réponse SMS) vaut confirmation.
   */
  async onDeliveryReport(
    id: string,
    outcome:
      | "delivered"
      | "answered"
      | "voicemail"
      | "no_answer"
      | "failed"
      | "patient_confirmed",
    nowIso: string
  ) {
    const r = await this.store.get(id);
    if (!r || ["cancelled", "obsolete"].includes(r.status)) return r;
    const map: Record<typeof outcome, ReminderStatus> = {
      delivered: "delivered",
      answered: "answered",
      voicemail: "voicemail",
      no_answer: "failed",
      failed: "failed",
      patient_confirmed: "confirmed_by_patient",
    };
    // Une confirmation déjà reçue ne régresse pas.
    if (r.status !== "confirmed_by_patient") r.status = map[outcome];
    r.history.push({ at: nowIso, event: `report:${outcome}` });
    await this.store.put(r);
    return r;
  }
}

/** Texte minimal : ni motif, ni praticien, ni information de santé. */
export const reminderText = (r: Reminder) => {
  const d = new Date(r.appointmentStart);
  const when = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `Rappel : vous avez rendez-vous au cabinet le ${when}. Pour annuler ou déplacer, appelez le cabinet. Message automatique.`;
};
