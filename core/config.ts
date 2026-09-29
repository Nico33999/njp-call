/**
 * NJP CALL — la configuration PUBLIQUE d'un cabinet.
 *
 * ## Ce qui n'est plus jamais ici
 *
 * Clés Resend, identifiants d'agenda, secrets de téléphonie, secrets et URL
 * de webhook, numéros de transfert, adresses de destination : ce sont des
 * **données de connecteur**. Elles vivent côté service, dans un coffre, et
 * sont désignées ici par une **référence** opaque (`transferDestinations[].ref`).
 *
 * La configuration est construite par **liste blanche** : un champ inconnu —
 * ancien secret compris — ne survit ni au chargement, ni à l'export, ni à
 * l'import.
 */
import { DEFAULT_URGENCY_NOTICE, type UrgencyPolicy } from "./emergency";

export const CONFIG_SCHEMA = 2 as const;

export interface OpeningPeriod {
  /** 0 = dimanche … 6 = samedi */
  weekday: number;
  from: string; // "HH:MM"
  to: string;
}

export interface CabinetConfig {
  schema: typeof CONFIG_SCHEMA;
  assistantName: string;
  cabinetName: string;
  greeting: string;
  closedGreeting: string;
  languages: string[];
  openingHours: OpeningPeriod[];
  practitioners: { ref: string; displayName: string; aliases: string[] }[];
  appointmentTypes: {
    ref: string;
    label: string;
    durationMin: number;
    newPatientAllowed: boolean;
  }[];
  /** Destinations de transfert : un libellé et une référence, jamais un numéro. */
  transferDestinations: { ref: string; label: string }[];
  urgency: UrgencyPolicy;
  afterHours: "message" | "callback" | "notice_only";
  /** Comportement si l'IA est indisponible. */
  degradedMode: "message_only" | "notice_only";
  reminders: {
    enabled: boolean;
    hoursBefore: number;
    channel: "sms" | "voice";
  };
  retention: { callRecordDays: number; storeAudio: false };
  cabinetInstructions: string;
  cabinetKnowledge: string;
  /** Mode simulation : ne peut être activé que par un geste explicite. */
  simulation: boolean;
  /**
   * Proposer des créneaux au téléphone. Faux quand le cabinet n'a pas activé
   * la réservation : l'appelant n'entend pas « je ne peux pas consulter le
   * planning », il dépose directement une demande. Posé par l'hôte (NJP CARE)
   * d'après ses réglages, jamais deviné.
   */
  offerSlots: boolean;
}

export const defaultConfig = (): CabinetConfig => ({
  schema: CONFIG_SCHEMA,
  assistantName: "Clara",
  cabinetName: "",
  greeting: "",
  closedGreeting: "",
  languages: ["fr"],
  openingHours: [1, 2, 3, 4, 5].map(weekday => ({
    weekday,
    from: "09:00",
    to: "18:00",
  })),
  practitioners: [],
  appointmentTypes: [],
  transferDestinations: [],
  urgency: { validatedByCabinet: false },
  afterHours: "message",
  degradedMode: "message_only",
  reminders: { enabled: false, hoursBefore: 24, channel: "sms" },
  retention: { callRecordDays: 90, storeAudio: false },
  cabinetInstructions: "",
  cabinetKnowledge: "",
  simulation: false,
  offerSlots: true,
});

const REF = /^[A-Za-z0-9_-]{3,64}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const s = (v: unknown, max: number, fallback = "") =>
  typeof v === "string" ? v.slice(0, max) : fallback;

/** Reconstruit une configuration à partir de n'importe quel objet, par liste blanche. */
export const sanitizeConfig = (raw: unknown): CabinetConfig => {
  const d = defaultConfig();
  const o =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const obj = (v: unknown) =>
    typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const urgency = obj(o.urgency);
  const reminders = obj(o.reminders);
  const retention = obj(o.retention);
  return {
    schema: CONFIG_SCHEMA,
    assistantName: s(o.assistantName, 40, d.assistantName) || d.assistantName,
    cabinetName: s(o.cabinetName, 120),
    greeting: s(o.greeting, 500),
    closedGreeting: s(o.closedGreeting, 500),
    languages: arr(o.languages)
      .filter((l): l is string => typeof l === "string" && /^[a-z]{2}$/.test(l))
      .slice(0, 5).length
      ? arr(o.languages)
          .filter(
            (l): l is string => typeof l === "string" && /^[a-z]{2}$/.test(l)
          )
          .slice(0, 5)
      : d.languages,
    openingHours: arr(o.openingHours)
      .map(obj)
      .filter(
        p =>
          Number.isInteger(p.weekday) &&
          (p.weekday as number) >= 0 &&
          (p.weekday as number) <= 6 &&
          HHMM.test(String(p.from)) &&
          HHMM.test(String(p.to)) &&
          String(p.from) < String(p.to)
      )
      .map(p => ({
        weekday: p.weekday as number,
        from: String(p.from),
        to: String(p.to),
      }))
      .slice(0, 21),
    practitioners: arr(o.practitioners)
      .map(obj)
      .filter(
        p =>
          typeof p.ref === "string" &&
          REF.test(p.ref) &&
          typeof p.displayName === "string"
      )
      .map(p => ({
        ref: p.ref as string,
        displayName: s(p.displayName, 80),
        aliases: arr(p.aliases)
          .filter((a): a is string => typeof a === "string")
          .map(a => a.slice(0, 80))
          .slice(0, 5),
      }))
      .slice(0, 30),
    appointmentTypes: arr(o.appointmentTypes)
      .map(obj)
      .filter(
        t =>
          typeof t.ref === "string" &&
          REF.test(t.ref) &&
          Number.isInteger(t.durationMin) &&
          (t.durationMin as number) >= 5 &&
          (t.durationMin as number) <= 240
      )
      .map(t => ({
        ref: t.ref as string,
        label: s(t.label, 80),
        durationMin: t.durationMin as number,
        newPatientAllowed: t.newPatientAllowed !== false,
      }))
      .slice(0, 30),
    transferDestinations: arr(o.transferDestinations)
      .map(obj)
      .filter(t => typeof t.ref === "string" && REF.test(t.ref))
      .map(t => ({ ref: t.ref as string, label: s(t.label, 80) }))
      .slice(0, 10),
    urgency: {
      notice:
        typeof urgency.notice === "string" && urgency.notice.trim()
          ? urgency.notice.slice(0, 600)
          : undefined,
      validatedByCabinet: urgency.validatedByCabinet === true,
      humanDestinationRef:
        typeof urgency.humanDestinationRef === "string" &&
        REF.test(urgency.humanDestinationRef)
          ? urgency.humanDestinationRef
          : undefined,
    },
    afterHours:
      o.afterHours === "callback" || o.afterHours === "notice_only"
        ? o.afterHours
        : "message",
    degradedMode:
      o.degradedMode === "notice_only" ? "notice_only" : "message_only",
    reminders: {
      enabled: reminders.enabled === true,
      hoursBefore:
        Number.isInteger(reminders.hoursBefore) &&
        (reminders.hoursBefore as number) >= 2 &&
        (reminders.hoursBefore as number) <= 96
          ? (reminders.hoursBefore as number)
          : 24,
      channel: reminders.channel === "voice" ? "voice" : "sms",
    },
    retention: {
      callRecordDays:
        Number.isInteger(retention.callRecordDays) &&
        (retention.callRecordDays as number) >= 1 &&
        (retention.callRecordDays as number) <= 3650
          ? (retention.callRecordDays as number)
          : 90,
      storeAudio: false,
    },
    cabinetInstructions: s(o.cabinetInstructions, 4000),
    cabinetKnowledge: s(o.cabinetKnowledge, 4000),
    simulation: o.simulation === true,
    offerSlots: o.offerSlots !== false,
  };
};

/** Propriétés de l'ancien prototype qui portaient des secrets ou des données de connecteur. */
export const LEGACY_SENSITIVE_KEYS = [
  "resendApiKey",
  "googleCalendarCredentials",
  "webhookUrl",
  "emailFrom",
  "emailMain",
  "emailProvider",
  "calendarId",
  "calendarProvider",
  "crmTool",
  "telephonyProvider",
  "services",
] as const;

/**
 * Migre l'ancienne configuration (`assistant-config`, schéma 1) : les réglages
 * publics sont conservés, les données de connecteur sont **abandonnées** — et
 * la liste de ce qui a été abandonné est rendue pour être dite au praticien.
 */
export const migrateLegacyConfig = (
  legacy: unknown
): { config: CabinetConfig; dropped: string[] } => {
  const o =
    typeof legacy === "object" && legacy !== null
      ? (legacy as Record<string, unknown>)
      : {};
  if (o.schema === CONFIG_SCHEMA)
    return {
      config: sanitizeConfig(o),
      dropped: Object.keys(o).filter(k =>
        (LEGACY_SENSITIVE_KEYS as readonly string[]).includes(k)
      ),
    };
  const dropped = LEGACY_SENSITIVE_KEYS.filter(
    k =>
      k in o &&
      o[k] !== "" &&
      !(Array.isArray(o[k]) && (o[k] as unknown[]).length === 0)
  );
  const config = sanitizeConfig({
    assistantName: o.assistantName,
    cabinetName: o.companyName,
    greeting: o.customGreeting,
    closedGreeting: o.customClosedGreeting,
    cabinetInstructions: o.customSystemPrompt,
    cabinetKnowledge: o.companyKnowledge,
  });
  return { config, dropped: [...dropped] };
};

/** Export JSON : exactement la configuration publique. */
export const exportConfig = (config: CabinetConfig): string =>
  JSON.stringify(sanitizeConfig(config), null, 2);

/** Import JSON : liste blanche ; les anciens secrets sont ignorés et nommés. */
export const importConfig = (json: string) =>
  migrateLegacyConfig(JSON.parse(json));

/** Ce qui manque avant l'activation finale (§12 Réglages). */
export const activationBlockers = (c: CabinetConfig): string[] => {
  const out: string[] = [];
  if (!c.cabinetName.trim()) out.push("cabinet_name");
  if (!c.openingHours.length) out.push("opening_hours");
  if (!c.urgency.validatedByCabinet) out.push("urgency_notice_not_validated");
  if (c.simulation) out.push("simulation_enabled");
  return out;
};

export const urgencyNotice = (c: CabinetConfig) =>
  c.urgency.notice ?? DEFAULT_URGENCY_NOTICE;
