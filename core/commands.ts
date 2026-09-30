/**
 * NJP CALL — les commandes structurées envoyées à NJP CARE.
 *
 * ## Pourquoi des commandes typées
 *
 * Le prototype laissait le modèle de langage écrire `send_email("...")` ou
 * `calendar_create_event(...)` en texte libre, puis un point d'entrée tentait
 * de deviner l'intention par expression régulière. Rien n'empêchait une
 * opération inventée, un paramètre injecté par l'appelant, ni une réussite
 * annoncée alors que rien ne s'était passé.
 *
 * Ici :
 * - l'ensemble des commandes est **fermé** (`COMMAND_TYPES`) ;
 * - chaque charge utile est validée champ par champ (`validateCommand`) ;
 * - chaque commande porte une **clé d'idempotence stable** ;
 * - le résultat distingue `simulated`, `requested`, `pending`, `confirmed`,
 *   `refused`, `failed`, `unsupported` — et seul le moteur compétent (NJP
 *   CARE) peut rendre `confirmed`.
 *
 * Le même contrat est tenu côté Rust dans NJP CARE
 * (`vault-engine/src/secretariat.rs`) ; c'est ce côté-là qui fait foi.
 */

export const COMMAND_FORMAT = "njp.call.command" as const;
export const COMMAND_FORMAT_VERSION = 1 as const;
export const EXTENSION_ID = "njp.call" as const;

export const COMMAND_TYPES = [
  "message.create",
  "callback.request",
  "appointment.request",
  "appointment.book",
  "appointment.reschedule",
  "appointment.cancel",
  "call.transfer",
  "call.report",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

/**
 * Accès NJP CARE qu'exige chaque commande. Une commande dont l'accès n'a pas
 * été accordé par le praticien est refusée par le moteur Rust.
 */
export const COMMAND_PERMISSION: Record<CommandType, string> = {
  "message.create": "secretariat.messages.create",
  "callback.request": "secretariat.callbacks.create",
  "appointment.request": "appointments.requests.create",
  "appointment.book": "appointments.book",
  "appointment.reschedule": "appointments.reschedule",
  "appointment.cancel": "appointments.cancel",
  "call.transfer": "telephony.transfer",
  "call.report": "secretariat.calls.write",
};

export const ACTION_STATUSES = [
  "simulated",
  "requested",
  "pending",
  "confirmed",
  "refused",
  "failed",
  "unsupported",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Seul statut qui autorise à dire à l'appelant « c'est fait ». */
export const isConfirmed = (status: ActionStatus): boolean =>
  status === "confirmed";

export type Relation = "self" | "parent" | "proche" | "professionnel" | "autre";
export type RecipientKind = "practitioner" | "secretariat";
export type MessageCategory =
  | "administratif"
  | "question_medicale"
  | "renouvellement"
  | "autre";
export type AdministrativeLevel = "normal" | "prioritaire";

export interface DeclaredPerson {
  /** Nom tel que déclaré par l'appelant, jamais complété. */
  declaredName: string;
  /** Numéro de rappel au format E.164 (+33…). */
  phone?: string;
  /** Lien entre l'appelant et la personne concernée. */
  relation: Relation;
  /** Si l'appel concerne un enfant ou un proche : son nom déclaré. */
  concernedName?: string;
  /** Date de naissance déclarée (AAAA-MM-JJ), aide au rattachement manuel. */
  declaredBirthDate?: string;
}

export interface Recipient {
  kind: RecipientKind;
  /** Référence opaque d'un praticien NJP CARE, si connue. */
  practitionerRef?: string;
}

export interface TimeWindow {
  /** ISO 8601 avec décalage, ex. 2026-10-05T14:00:00+02:00 */
  from: string;
  to: string;
}

export interface MessageCreatePayload {
  caller: DeclaredPerson;
  recipient: Recipient;
  /** Texte relu à l'appelant et confirmé par lui : le verbatim. */
  confirmedText: string;
  /** Résumé produit par l'IA, séparé du verbatim et marqué comme tel. */
  aiSummary: string;
  category: MessageCategory;
  level: AdministrativeLevel;
}

export interface CallbackRequestPayload {
  person: DeclaredPerson & { phone: string };
  reason: string;
  preferences: { windows: TimeWindow[]; note?: string };
  recipient: Recipient;
  priority: AdministrativeLevel;
}

export interface AppointmentRequestPayload {
  person: DeclaredPerson;
  newPatient: boolean;
  practitionerRef?: string;
  appointmentTypeRef?: string;
  locationRef?: string;
  preferences: { windows: TimeWindow[]; note?: string };
}

export interface SlotChoice {
  /** Identifiant opaque du créneau proposé par NJP CARE. */
  slotRef: string;
  start: string;
  end: string;
  practitionerRef: string;
  appointmentTypeRef?: string;
  locationRef?: string;
}

export interface AppointmentBookPayload {
  person: DeclaredPerson;
  newPatient: boolean;
  slot: SlotChoice;
}

/**
 * Ce que l'appelant a fourni pour prouver qu'il peut agir sur un rendez-vous.
 * NJP CARE compare ; NJP CALL ne décide jamais.
 */
export interface CallerVerification {
  /** Horaire actuel du rendez-vous, tel que l'appelant le donne. */
  currentStart: string;
  declaredName: string;
  phone: string;
}

export interface AppointmentReschedulePayload {
  verification: CallerVerification;
  newSlot: SlotChoice;
}

export interface AppointmentCancelPayload {
  verification: CallerVerification;
  reason?: string;
}

export interface CallTransferPayload {
  /** Référence d'une destination autorisée par le cabinet, jamais un numéro libre. */
  destinationRef: string;
  reason: string;
}

export interface CallReportPayload {
  startedAt: string;
  endedAt: string;
  outcome:
    | "message"
    | "callback"
    | "appointment"
    | "transfer"
    | "information"
    | "abandoned"
    | "failed";
  /** Compte rendu administratif, sans donnée clinique. */
  summary: string;
  commands: {
    idempotencyKey: string;
    type: CommandType;
    status: ActionStatus;
    reference?: string;
  }[];
}

export interface CommandPayloads {
  "message.create": MessageCreatePayload;
  "callback.request": CallbackRequestPayload;
  "appointment.request": AppointmentRequestPayload;
  "appointment.book": AppointmentBookPayload;
  "appointment.reschedule": AppointmentReschedulePayload;
  "appointment.cancel": AppointmentCancelPayload;
  "call.transfer": CallTransferPayload;
  "call.report": CallReportPayload;
}

export type Command = {
  [K in CommandType]: { type: K; payload: CommandPayloads[K] };
}[CommandType];

/** L'enveloppe qui transporte une commande jusqu'à NJP CARE. */
export interface CommandEnvelope {
  format: typeof COMMAND_FORMAT;
  v: typeof COMMAND_FORMAT_VERSION;
  extensionId: typeof EXTENSION_ID;
  cabinetId: string;
  callId: string;
  /** Rang de la commande dans l'appel (1, 2, …). */
  seq: number;
  idempotencyKey: string;
  issuedAt: string;
  command: Command;
}

export interface CommandResult {
  idempotencyKey: string;
  status: ActionStatus;
  /** Référence opaque de l'objet créé dans NJP CARE, si créé. */
  reference?: string;
  /** Code de refus ou d'échec, nommé. */
  reason?: string;
  /** Vrai si NJP CARE a reconnu une commande déjà traitée. */
  replayed?: boolean;
  /** Données de retour typées (ex. créneaux proposés). */
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Clés d'idempotence
// ---------------------------------------------------------------------------

const REF = /^[A-Za-z0-9_-]{3,64}$/;
export const IDEMPOTENCY_KEY =
  /^[A-Za-z0-9_-]{3,64}\/[a-z.]{4,32}\/[1-9][0-9]{0,4}$/;

/**
 * Clé stable : même appel, même type, même rang ⇒ même clé, quelle que soit
 * la machine ou le nombre de tentatives. Un événement téléphonique rejoué
 * redonne la même clé, et NJP CARE rend le résultat déjà enregistré.
 */
export const idempotencyKey = (
  callId: string,
  type: CommandType,
  ordinal: number
): string => {
  if (!REF.test(callId)) throw new Error("callId invalide");
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 99999)
    throw new Error("rang invalide");
  return `${callId}/${type}/${ordinal}`;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const E164 = /^\+[1-9][0-9]{7,14}$/;
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIONS: readonly Relation[] = [
  "self",
  "parent",
  "proche",
  "professionnel",
  "autre",
];
const CATEGORIES: readonly MessageCategory[] = [
  "administratif",
  "question_medicale",
  "renouvellement",
  "autre",
];
const LEVELS: readonly AdministrativeLevel[] = ["normal", "prioritaire"];
const OUTCOMES = [
  "message",
  "callback",
  "appointment",
  "transfer",
  "information",
  "abandoned",
  "failed",
] as const;

export const LIMITS = {
  name: 120,
  text: 2000,
  summary: 600,
  reason: 300,
  windows: 6,
  reportCommands: 32,
} as const;

type Errors = string[];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Rejette tout champ non prévu : un champ inconnu ne passe pas « par accident ». */
const onlyKeys = (
  o: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
  e: Errors
) => {
  for (const k of Object.keys(o))
    if (!allowed.includes(k)) e.push(`${at}.${k}:inconnu`);
};

const text = (
  v: unknown,
  max: number,
  at: string,
  e: Errors,
  required = true
) => {
  if (v === undefined && !required) return;
  if (typeof v !== "string" || !v.trim()) return void e.push(`${at}:requis`);
  if (v.length > max) e.push(`${at}:trop_long`);
  // Aucun caractère de contrôle (hors saut de ligne) : ni injection de terminal, ni de journal.
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(v))
    e.push(`${at}:caractere_controle`);
};

const ref = (v: unknown, at: string, e: Errors, required = true) => {
  if (v === undefined && !required) return;
  if (typeof v !== "string" || !REF.test(v)) e.push(`${at}:reference`);
};

const phone = (v: unknown, at: string, e: Errors, required: boolean) => {
  if (v === undefined && !required) return;
  if (typeof v !== "string" || !E164.test(v)) e.push(`${at}:telephone`);
};

const iso = (v: unknown, at: string, e: Errors) => {
  if (
    typeof v !== "string" ||
    !ISO_WITH_OFFSET.test(v) ||
    Number.isNaN(Date.parse(v))
  )
    e.push(`${at}:horodatage`);
};

const oneOf = <T extends string>(
  v: unknown,
  values: readonly T[],
  at: string,
  e: Errors
) => {
  if (typeof v !== "string" || !values.includes(v as T)) e.push(`${at}:valeur`);
};

const person = (v: unknown, at: string, e: Errors, phoneRequired: boolean) => {
  if (!isObj(v)) return void e.push(`${at}:requis`);
  onlyKeys(
    v,
    ["declaredName", "phone", "relation", "concernedName", "declaredBirthDate"],
    at,
    e
  );
  text(v.declaredName, LIMITS.name, `${at}.declaredName`, e);
  phone(v.phone, `${at}.phone`, e, phoneRequired);
  oneOf(v.relation, RELATIONS, `${at}.relation`, e);
  text(v.concernedName, LIMITS.name, `${at}.concernedName`, e, false);
  if (
    v.relation !== "self" &&
    v.relation !== undefined &&
    v.concernedName === undefined
  ) {
    e.push(`${at}.concernedName:requis_pour_un_proche`);
  }
  if (
    v.declaredBirthDate !== undefined &&
    (typeof v.declaredBirthDate !== "string" || !DATE.test(v.declaredBirthDate))
  ) {
    e.push(`${at}.declaredBirthDate:date`);
  }
};

const recipient = (v: unknown, at: string, e: Errors) => {
  if (!isObj(v)) return void e.push(`${at}:requis`);
  onlyKeys(v, ["kind", "practitionerRef"], at, e);
  oneOf(v.kind, ["practitioner", "secretariat"] as const, `${at}.kind`, e);
  if (v.kind === "practitioner")
    ref(v.practitionerRef, `${at}.practitionerRef`, e);
  else ref(v.practitionerRef, `${at}.practitionerRef`, e, false);
};

const windows = (v: unknown, at: string, e: Errors) => {
  if (!isObj(v)) return void e.push(`${at}:requis`);
  onlyKeys(v, ["windows", "note"], at, e);
  if (!Array.isArray(v.windows) || v.windows.length > LIMITS.windows)
    return void e.push(`${at}.windows:liste`);
  v.windows.forEach((w, i) => {
    if (!isObj(w)) return void e.push(`${at}.windows[${i}]:requis`);
    onlyKeys(w, ["from", "to"], `${at}.windows[${i}]`, e);
    iso(w.from, `${at}.windows[${i}].from`, e);
    iso(w.to, `${at}.windows[${i}].to`, e);
    if (
      typeof w.from === "string" &&
      typeof w.to === "string" &&
      Date.parse(w.to) <= Date.parse(w.from)
    ) {
      e.push(`${at}.windows[${i}]:ordre`);
    }
  });
  text(v.note, LIMITS.reason, `${at}.note`, e, false);
};

const slot = (v: unknown, at: string, e: Errors) => {
  if (!isObj(v)) return void e.push(`${at}:requis`);
  onlyKeys(
    v,
    [
      "slotRef",
      "start",
      "end",
      "practitionerRef",
      "appointmentTypeRef",
      "locationRef",
    ],
    at,
    e
  );
  ref(v.slotRef, `${at}.slotRef`, e);
  iso(v.start, `${at}.start`, e);
  iso(v.end, `${at}.end`, e);
  ref(v.practitionerRef, `${at}.practitionerRef`, e);
  ref(v.appointmentTypeRef, `${at}.appointmentTypeRef`, e, false);
  ref(v.locationRef, `${at}.locationRef`, e, false);
  if (
    typeof v.start === "string" &&
    typeof v.end === "string" &&
    Date.parse(v.end) <= Date.parse(v.start)
  ) {
    e.push(`${at}:ordre`);
  }
};

const verification = (v: unknown, at: string, e: Errors) => {
  if (!isObj(v)) return void e.push(`${at}:requis`);
  onlyKeys(v, ["currentStart", "declaredName", "phone"], at, e);
  iso(v.currentStart, `${at}.currentStart`, e);
  text(v.declaredName, LIMITS.name, `${at}.declaredName`, e);
  phone(v.phone, `${at}.phone`, e, true);
};

const VALIDATORS: {
  [K in CommandType]: (p: Record<string, unknown>, e: Errors) => void;
} = {
  "message.create": (p, e) => {
    onlyKeys(
      p,
      [
        "caller",
        "recipient",
        "confirmedText",
        "aiSummary",
        "category",
        "level",
      ],
      "payload",
      e
    );
    person(p.caller, "payload.caller", e, false);
    recipient(p.recipient, "payload.recipient", e);
    text(p.confirmedText, LIMITS.text, "payload.confirmedText", e);
    text(p.aiSummary, LIMITS.summary, "payload.aiSummary", e);
    oneOf(p.category, CATEGORIES, "payload.category", e);
    oneOf(p.level, LEVELS, "payload.level", e);
  },
  "callback.request": (p, e) => {
    onlyKeys(
      p,
      ["person", "reason", "preferences", "recipient", "priority"],
      "payload",
      e
    );
    person(p.person, "payload.person", e, true);
    text(p.reason, LIMITS.reason, "payload.reason", e);
    windows(p.preferences, "payload.preferences", e);
    recipient(p.recipient, "payload.recipient", e);
    oneOf(p.priority, LEVELS, "payload.priority", e);
  },
  "appointment.request": (p, e) => {
    onlyKeys(
      p,
      [
        "person",
        "newPatient",
        "practitionerRef",
        "appointmentTypeRef",
        "locationRef",
        "preferences",
      ],
      "payload",
      e
    );
    person(p.person, "payload.person", e, true);
    if (typeof p.newPatient !== "boolean") e.push("payload.newPatient:booleen");
    ref(p.practitionerRef, "payload.practitionerRef", e, false);
    ref(p.appointmentTypeRef, "payload.appointmentTypeRef", e, false);
    ref(p.locationRef, "payload.locationRef", e, false);
    windows(p.preferences, "payload.preferences", e);
  },
  "appointment.book": (p, e) => {
    onlyKeys(p, ["person", "newPatient", "slot"], "payload", e);
    person(p.person, "payload.person", e, true);
    if (typeof p.newPatient !== "boolean") e.push("payload.newPatient:booleen");
    slot(p.slot, "payload.slot", e);
  },
  "appointment.reschedule": (p, e) => {
    onlyKeys(p, ["verification", "newSlot"], "payload", e);
    verification(p.verification, "payload.verification", e);
    slot(p.newSlot, "payload.newSlot", e);
  },
  "appointment.cancel": (p, e) => {
    onlyKeys(p, ["verification", "reason"], "payload", e);
    verification(p.verification, "payload.verification", e);
    text(p.reason, LIMITS.reason, "payload.reason", e, false);
  },
  "call.transfer": (p, e) => {
    onlyKeys(p, ["destinationRef", "reason"], "payload", e);
    ref(p.destinationRef, "payload.destinationRef", e);
    text(p.reason, LIMITS.reason, "payload.reason", e);
  },
  "call.report": (p, e) => {
    onlyKeys(
      p,
      ["startedAt", "endedAt", "outcome", "summary", "commands"],
      "payload",
      e
    );
    iso(p.startedAt, "payload.startedAt", e);
    iso(p.endedAt, "payload.endedAt", e);
    oneOf(p.outcome, OUTCOMES, "payload.outcome", e);
    text(p.summary, LIMITS.summary, "payload.summary", e);
    if (!Array.isArray(p.commands) || p.commands.length > LIMITS.reportCommands)
      e.push("payload.commands:liste");
    else
      p.commands.forEach((c, i) => {
        if (!isObj(c)) return void e.push(`payload.commands[${i}]:requis`);
        onlyKeys(
          c,
          ["idempotencyKey", "type", "status", "reference"],
          `payload.commands[${i}]`,
          e
        );
        if (
          typeof c.idempotencyKey !== "string" ||
          !IDEMPOTENCY_KEY.test(c.idempotencyKey)
        )
          e.push(`payload.commands[${i}].idempotencyKey:format`);
        oneOf(c.type, COMMAND_TYPES, `payload.commands[${i}].type`, e);
        oneOf(c.status, ACTION_STATUSES, `payload.commands[${i}].status`, e);
        ref(c.reference, `payload.commands[${i}].reference`, e, false);
      });
  },
};

/** Les défauts d'une commande, nommés. Vide = valide. */
export const validateCommand = (c: unknown): string[] => {
  const e: Errors = [];
  if (!isObj(c)) return ["command:requis"];
  onlyKeys(c, ["type", "payload"], "command", e);
  if (
    typeof c.type !== "string" ||
    !(COMMAND_TYPES as readonly string[]).includes(c.type)
  )
    return [...e, "command.type:inconnu"];
  if (!isObj(c.payload)) return [...e, "payload:requis"];
  VALIDATORS[c.type as CommandType](c.payload, e);
  return e;
};

/** Les défauts d'une enveloppe complète. */
export const validateEnvelope = (env: unknown): string[] => {
  const e: Errors = [];
  if (!isObj(env)) return ["envelope:requis"];
  onlyKeys(
    env,
    [
      "format",
      "v",
      "extensionId",
      "cabinetId",
      "callId",
      "seq",
      "idempotencyKey",
      "issuedAt",
      "command",
    ],
    "envelope",
    e
  );
  if (env.format !== COMMAND_FORMAT) e.push("envelope.format");
  if (env.v !== COMMAND_FORMAT_VERSION) e.push("envelope.v");
  if (env.extensionId !== EXTENSION_ID) e.push("envelope.extensionId");
  ref(env.cabinetId, "envelope.cabinetId", e);
  ref(env.callId, "envelope.callId", e);
  if (!Number.isInteger(env.seq) || (env.seq as number) < 1)
    e.push("envelope.seq");
  if (
    typeof env.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY.test(env.idempotencyKey)
  )
    e.push("envelope.idempotencyKey");
  iso(env.issuedAt, "envelope.issuedAt", e);
  e.push(...validateCommand(env.command));
  if (
    typeof env.idempotencyKey === "string" &&
    isObj(env.command) &&
    typeof env.callId === "string" &&
    !env.idempotencyKey.startsWith(`${env.callId}/${String(env.command.type)}/`)
  ) {
    e.push("envelope.idempotencyKey:incoherente");
  }
  return e;
};

export const makeEnvelope = (
  cabinetId: string,
  callId: string,
  seq: number,
  ordinal: number,
  command: Command,
  issuedAt: string
): CommandEnvelope => ({
  format: COMMAND_FORMAT,
  v: COMMAND_FORMAT_VERSION,
  extensionId: EXTENSION_ID,
  cabinetId,
  callId,
  seq,
  idempotencyKey: idempotencyKey(callId, command.type, ordinal),
  issuedAt,
  command,
});
