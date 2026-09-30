/**
 * NJP CALL — l'état d'une conversation, et la compréhension d'une réplique.
 *
 * ```text
 *   réplique de l'appelant
 *        ↓ compréhension (IA, ou lecture de repli sans IA)   → Understanding
 *        ↓ moteur de règles (engine.ts)                       → Decision
 *        ↓ commande NJP CARE (gateway.ts)                     → CommandResult
 *        ↓ réponse à l'appelant, écrite à partir du résultat RÉEL
 * ```
 *
 * `Understanding` est ce que l'IA a le droit de produire : une intention, des
 * informations entendues, un oui/non. Rien qui ressemble à un ordre.
 */
import type {
  ActionStatus,
  Command,
  CommandType,
  Relation,
  SlotChoice,
  TimeWindow,
} from "./commands";
import {
  fold,
  parisLocalToInstant,
  readDateTime,
  readFrenchPhone,
  type DateTimeReading,
} from "./datetime";

export const INTENTS = [
  "message",
  "callback",
  "appointment_new",
  "appointment_reschedule",
  "appointment_cancel",
  "information",
  "human",
  "medical_question",
  "renewal",
  "unknown",
] as const;
export type Intent = (typeof INTENTS)[number];

export type Phase =
  | "greeting"
  | "intent"
  | "collecting"
  | "offering"
  | "confirming"
  | "executing"
  | "closing"
  | "handoff"
  | "ended";

export interface Collected {
  callerName?: string;
  relation?: Relation;
  concernedName?: string;
  phone?: string;
  newPatient?: boolean;
  practitionerRef?: string;
  appointmentTypeRef?: string;
  windows?: TimeWindow[];
  preferenceText?: string;
  /** Pour un déplacement ou une annulation : l'horaire actuel déclaré. */
  currentStart?: string;
  messageText?: string;
  reason?: string;
  category?: "administratif" | "question_medicale" | "renouvellement" | "autre";
  chosenSlot?: SlotChoice;
}

export type Field =
  | Exclude<
      keyof Collected,
      | "category"
      | "windows"
      | "chosenSlot"
      | "practitionerRef"
      | "appointmentTypeRef"
    >
  | "preference";

export interface Turn {
  role: "caller" | "assistant";
  text: string;
}

export interface ConversationState {
  intent: Intent | null;
  phase: Phase;
  collected: Collected;
  missing: Field[];
  offeredSlots: SlotChoice[];
  proposed: Command | null;
  confirmation: "none" | "pending" | "yes" | "no";
  lastResult: {
    type: CommandType;
    status: ActionStatus;
    reference?: string;
    reason?: string;
  } | null;
  /** Historique utile : l'appelant et l'assistante, rien d'autre. */
  turns: Turn[];
  injectionAttempts: number;
  handoffReason?: string;
  /** Question en cours : sert à interpréter une réponse courte (« Dupont »). */
  asking?: Field | "confirmation" | "slot" | "anything_else" | "clarify_time";
}

/**
 * Ce que la prochaine réplique de l'appelant devrait contenir. Sert au poste
 * à régler la fin de parole (une réponse courte se clôt plus vite qu'un
 * numéro dicté par groupes ou qu'un message libre). N'influe pas sur la
 * compréhension.
 */
export type Expect = "short" | "digits" | "name" | "date" | "free";

export const expectOf = (s: ConversationState): Expect => {
  switch (s.asking) {
    case "confirmation":
    case "anything_else":
    case "newPatient":
    case "relation":
    case "slot":
      return "short";
    case "phone":
      return "digits";
    case "callerName":
    case "concernedName":
      return "name";
    case "preference":
    case "currentStart":
    case "clarify_time":
      return "date";
    default:
      return "free";
  }
};

export const initialState = (): ConversationState => ({
  intent: null,
  phase: "greeting",
  collected: {},
  missing: [],
  offeredSlots: [],
  proposed: null,
  confirmation: "none",
  lastResult: null,
  turns: [],
  injectionAttempts: 0,
});

// ---------------------------------------------------------------------------
// Ce que la compréhension peut rendre
// ---------------------------------------------------------------------------

export interface Understanding {
  intent?: Intent;
  entities: {
    callerName?: string;
    concernedName?: string;
    relation?: Relation;
    phone?: string;
    newPatient?: boolean;
    practitionerHint?: string;
    appointmentTypeHint?: string;
    dateTimeText?: string;
    messageText?: string;
    reason?: string;
  };
  confirmation?: "yes" | "no" | "correction";
  slotChoice?: 1 | 2 | 3;
  informationReply?: string;
}

const RELATIONS: readonly Relation[] = [
  "self",
  "parent",
  "proche",
  "professionnel",
  "autre",
];
const str = (v: unknown, max = 300) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * Valide la sortie d'un modèle de langage. Tout ce qui n'est pas prévu est
 * ignoré ; aucune clé ne peut ajouter une « action ».
 */
export const validateUnderstanding = (raw: unknown): Understanding => {
  const o =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const e =
    typeof o.entities === "object" && o.entities !== null
      ? (o.entities as Record<string, unknown>)
      : {};
  const u: Understanding = { entities: {} };
  if (
    typeof o.intent === "string" &&
    (INTENTS as readonly string[]).includes(o.intent)
  )
    u.intent = o.intent as Intent;
  u.entities = {
    callerName: str(e.callerName, 120),
    concernedName: str(e.concernedName, 120),
    relation:
      typeof e.relation === "string" &&
      RELATIONS.includes(e.relation as Relation)
        ? (e.relation as Relation)
        : undefined,
    phone: str(e.phone, 40),
    newPatient: typeof e.newPatient === "boolean" ? e.newPatient : undefined,
    practitionerHint: str(e.practitionerHint, 120),
    appointmentTypeHint: str(e.appointmentTypeHint, 120),
    dateTimeText: str(e.dateTimeText, 200),
    messageText: str(e.messageText, 2000),
    reason: str(e.reason, 300),
  };
  for (const k of Object.keys(
    u.entities
  ) as (keyof Understanding["entities"])[]) {
    if (u.entities[k] === undefined) delete u.entities[k];
  }
  if (
    o.confirmation === "yes" ||
    o.confirmation === "no" ||
    o.confirmation === "correction"
  )
    u.confirmation = o.confirmation;
  if (o.slotChoice === 1 || o.slotChoice === 2 || o.slotChoice === 3)
    u.slotChoice = o.slotChoice;
  u.informationReply = str(o.informationReply, 400);
  if (!u.informationReply) delete u.informationReply;
  return u;
};

// ---------------------------------------------------------------------------
// Lecture de repli, sans IA
// ---------------------------------------------------------------------------

const YES =
  /^(oui|ouais|c'est (ca|bien ca|exact|correct|bon)|exact(ement)?|d'accord|parfait|tout a fait|ok|oui c'est (ca|bon|parfait)|absolument|volontiers|je confirme)\b/;
const NO =
  /^(non|pas du tout|pas (ca|exactement)|c'est faux|erreur|ce n'est pas (ca|exact))\b/;

const intentOf = (s: string): Intent | undefined => {
  if (
    /\b(parler|passer) (a|au|avec) (quelqu'un|une personne|un humain|la secretaire|un conseiller|un etre humain|le docteur|la docteure?|le medecin)/.test(
      s
    ) ||
    /\bun humain\b/.test(s)
  )
    return "human";
  if (/\b(renouvel|ordonnance)/.test(s)) return "renewal";
  if (
    /\b(annuler|annulation)\b/.test(s) &&
    /\b(rendez-vous|rdv|consultation|seance)\b/.test(s)
  )
    return "appointment_cancel";
  if (
    /\b(deplacer|decaler|reporter|changer|modifier) (mon|le|un|son|sa) (rendez-vous|rdv|seance|consultation)/.test(
      s
    )
  )
    return "appointment_reschedule";
  if (/\b(rendez-vous|rdv|consultation|prendre un creneau|seance)\b/.test(s))
    return "appointment_new";
  if (
    /\b(me rappeler|qu'on me rappelle|me recontacter|etre rappele|rappelle-moi)/.test(
      s
    )
  )
    return "callback";
  if (
    /\b(laisser|transmettre|passer) (un )?(message|mot)\b|\bun message\b/.test(
      s
    )
  )
    return "message";
  if (
    /\b(resultat|symptome|j'ai mal|douleur|fievre|medicament|traitement|effet secondaire)/.test(
      s
    )
  )
    return "medical_question";
  if (
    /\b(horaire|adresse|ouvert|ferme|parking|acces|tarif|venir au cabinet)/.test(
      s
    )
  )
    return "information";
  return undefined;
};

/** Toujours explicites : « je m'appelle », « mon nom est », « de la part de ». */
const NAME_EXPLICIT =
  /(?:je m'appelle|mon nom est|de la part de)\s+((?:m(?:adame|onsieur)\s+)?[a-zà-ÿ][a-zà-ÿ'-]+(?:\s+[a-zà-ÿ][a-zà-ÿ'-]+){0,2})/i;
/** Ambigus (« je suis déjà venue ») : lus seulement quand on vient de demander le nom. */
const NAME_WHEN_ASKED =
  /(?:je suis|c'est|ici|moi c'est)\s+((?:m(?:adame|onsieur)\s+)?[a-zà-ÿ][a-zà-ÿ'-]+(?:\s+[a-zà-ÿ][a-zà-ÿ'-]+){0,2})/i;
const STOP_NAME =
  /^(pour|au|a|le|la|les|un|une|pas|bien|tres|urgent|possible|moi|madame|monsieur|deja|venu|venue|disponible|nouveau|nouvelle|patient|patiente|en|malade|suivi|suivie|oui|non|d'accord|desole|desolee|la|ici)$/i;
const acceptName = (raw: string) => {
  const words = fold(raw).split(/\s+/);
  return !words.some(w => STOP_NAME.test(w));
};

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

const relationOf = (
  s: string
): { relation: Relation; concerned?: string } | undefined => {
  if (/\b(mon fils|ma fille|mon enfant|mon bebe|mes enfants)\b/.test(s))
    return { relation: "parent" };
  if (
    /\b(ma mere|mon pere|mon mari|ma femme|mon epouse|mon conjoint|ma conjointe|ma grand-mere|mon grand-pere|mon frere|ma soeur)\b/.test(
      s
    )
  )
    return { relation: "proche" };
  if (/\b(pour moi|moi-meme|me concerne)\b/.test(s))
    return { relation: "self" };
  return undefined;
};

/**
 * Lecture sans IA : prudente, littérale, et suffisante pour les bancs et le
 * mode dégradé. Elle utilise la question en cours pour lire une réponse
 * courte.
 */
export const fallbackUnderstand = (
  utterance: string,
  state: ConversationState
): Understanding => {
  const s = fold(utterance);
  const u: Understanding = { entities: {} };
  const intent = intentOf(s);
  if (intent) u.intent = intent;

  if (
    state.asking === "confirmation" ||
    state.asking === "anything_else" ||
    state.asking === "newPatient"
  ) {
    if (YES.test(s)) u.confirmation = "yes";
    else if (NO.test(s))
      u.confirmation =
        /\bnon,? (c'est|mon|le|la|il|elle)\b/.test(s) || s.split(" ").length > 3
          ? "correction"
          : "no";
  }
  if (state.asking === "newPatient") {
    if (u.confirmation === "yes") u.entities.newPatient = false; // « Êtes-vous déjà venu ? » — oui
    if (u.confirmation === "no") u.entities.newPatient = true;
    delete u.confirmation;
  }
  if (
    /\b(premiere fois|jamais venue?|nouveau patient|nouvelle patiente)\b/.test(
      s
    )
  )
    u.entities.newPatient = true;
  if (
    /\b(deja venue?|deja patiente?|je suis suivie?|suivie? par|je viens deja|deja consulte)\b/.test(
      s
    )
  )
    u.entities.newPatient = false;

  if (state.asking === "slot") {
    const n = s.match(
      /\b(premier|premiere|1er|un|deuxieme|second|seconde|2|troisieme|3|dernier)\b/
    );
    if (n)
      u.slotChoice = /prem|1|^un$/.test(n[1])
        ? 1
        : /deux|second|2/.test(n[1])
          ? 2
          : 3;
    if (/\b(aucun|aucune|pas possible|ne (me )?convien)/.test(s))
      u.confirmation = "no";
  }

  const explicit = utterance.match(NAME_EXPLICIT);
  const asked =
    state.asking === "callerName" ? utterance.match(NAME_WHEN_ASKED) : null;
  const name = explicit ?? asked;
  if (name && acceptName(name[1])) u.entities.callerName = titleCase(name[1]);
  else if (
    state.asking === "callerName" &&
    utterance.trim().split(/\s+/).length <= 4
  ) {
    const bare = utterance
      .replace(/^(c'est|je suis|moi c'est)\s+/i, "")
      .replace(/[.!?,]/g, "")
      .trim();
    if (acceptName(bare)) u.entities.callerName = titleCase(bare);
  }
  if (
    state.asking === "concernedName" &&
    utterance.trim().split(/\s+/).length <= 4
  ) {
    u.entities.concernedName = titleCase(
      utterance
        .replace(/^(c'est|il s'appelle|elle s'appelle)\s+/i, "")
        .replace(/[.!?,]/g, "")
        .trim()
    );
  }

  const rel = relationOf(s);
  if (rel) u.entities.relation = rel.relation;

  const phone = readFrenchPhone(
    utterance.replace(/^.*?(?=(\+33|0[1-9]|zero))/i, "")
  );
  if (phone) u.entities.phone = phone;
  else if (state.asking === "phone") {
    const p = readFrenchPhone(utterance);
    if (p) u.entities.phone = p;
  }

  if (
    /\d|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|matin|apres-midi|apres midi|midi|soir|semaine|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre/.test(
      s
    ) &&
    !u.entities.phone
  ) {
    u.entities.dateTimeText = utterance;
  }

  // Pendant la dictée d'un message, ce qui est dit EST le message, même s'il
  // contient « traitement » ou « me rappeler » : sinon la réplique suivante
  // (« oui ») serait prise pour le message.
  if (state.asking === "messageText" && u.intent !== "human") {
    u.entities.messageText = utterance.trim();
    delete u.intent;
  }
  if (state.asking === "reason") u.entities.reason = utterance.trim();
  return u;
};

// ---------------------------------------------------------------------------
// Fenêtres de préférence
// ---------------------------------------------------------------------------

const PERIODS = {
  matin: [8, 12],
  "apres-midi": [12, 18],
  soir: [18, 20],
} as const;

/**
 * Transforme une lecture de date en fenêtres. Une lecture ambiguë ne rend
 * rien : on fait préciser.
 */
export const windowsFrom = (
  reading: DateTimeReading,
  nowMs: number
): TimeWindow[] | null => {
  if (reading.ambiguities.length) return null;
  const at = (d: NonNullable<DateTimeReading["date"]>, h: number, min = 0) => {
    const r = parisLocalToInstant(d, { h, min });
    return r.kind === "ok" ? r.iso : null;
  };
  if (reading.date && reading.time) {
    const from = at(reading.date, reading.time.h, reading.time.min);
    const endH = reading.time.h + 1;
    const to =
      endH <= 23
        ? at(reading.date, endH, reading.time.min)
        : at(reading.date, 23, 59);
    return from && to ? [{ from, to }] : null;
  }
  if (reading.date) {
    const [a, b] = reading.period ? PERIODS[reading.period] : [8, 20];
    const from = at(reading.date, a);
    const to = at(reading.date, b);
    return from && to ? [{ from, to }] : null;
  }
  if (reading.period || reading.time) return null; // « à 15 h » sans jour : on fait préciser
  // Aucune préférence : les quatorze prochains jours.
  const from = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  const to = new Date(nowMs + 14 * 86400000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  return [{ from, to }];
};

export { readDateTime };
