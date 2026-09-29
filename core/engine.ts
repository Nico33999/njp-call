/**
 * NJP CALL — le moteur de règles.
 *
 * Fonctions PURES : un état et une compréhension en entrée, un nouvel état et
 * une décision en sortie. Aucun réseau, aucune horloge implicite. C'est ici,
 * et nulle part ailleurs, que se décide :
 *
 * - ce qui manque encore ;
 * - quand reformuler et demander la confirmation ;
 * - quelle commande proposer — uniquement après un « oui » explicite à une
 *   reformulation complète ;
 * - ce que l'on dit après un résultat, **d'après le statut réel**.
 *
 * Le modèle de langage n'est qu'une source de `Understanding`. Il ne peut ni
 * émettre une commande, ni annoncer une réussite.
 */
import type {
  CommandResult,
  Command,
  SlotChoice,
  AppointmentRequestPayload,
  Recipient,
} from "./commands";
import type { CabinetConfig } from "./config";
import { urgencyNotice } from "./config";
import { assessUtterance } from "./emergency";
import { fold, readDateTime, speakInstant, speakPhone } from "./datetime";
import { guardFreeReply, looksLikeInjection } from "./rules";
import {
  type ConversationState,
  type Field,
  type Intent,
  type Understanding,
  windowsFrom,
} from "./conversation";
import type { AvailabilityQuery, AvailabilityResult } from "./gateway";

export interface EngineContext {
  config: CabinetConfig;
  nowMs: number;
}

export interface Decision {
  state: ConversationState;
  /** Ce que l'assistante dit, dans l'ordre. */
  say: string[];
  /** Commande à soumettre à NJP CARE (au plus une par tour). */
  command?: Command;
  /** Recherche de créneaux à faire auprès de NJP CARE. */
  availability?: AvailabilityQuery;
  /** Fin d'appel demandée. */
  end?: boolean;
}

const MAX_OFFERED = 3;

const clone = (s: ConversationState): ConversationState => structuredClone(s);

const QUESTIONS: Record<Field, string> = {
  callerName: "Pouvez-vous me donner votre nom et votre prénom ?",
  relation: "L'appel concerne-t-il vous-même ou une autre personne ?",
  concernedName: "Quel est le nom et le prénom de la personne concernée ?",
  phone: "À quel numéro le cabinet peut-il vous joindre ?",
  newPatient: "Êtes-vous déjà venu au cabinet ?",
  preference: "Quel jour et à quel moment vous conviendrait le mieux ?",
  preferenceText: "Quel jour et à quel moment vous conviendrait le mieux ?",
  currentStart:
    "Pour retrouver votre rendez-vous : à quelle date et quelle heure est-il prévu ?",
  messageText: "Je vous écoute : quel message souhaitez-vous laisser ?",
  reason: "Pouvez-vous m'indiquer brièvement le motif, sans détail médical ?",
};

/** Champs requis, dans l'ordre où on les demande. */
export const requiredFields = (
  intent: Intent | null,
  c: ConversationState["collected"]
): Field[] => {
  const who: Field[] = ["callerName"];
  if (c.relation && c.relation !== "self" && !c.concernedName)
    who.push("concernedName");
  const need = (fields: Field[]) =>
    fields.filter(f => {
      if (f === "preference") return !c.windows;
      return c[f as keyof typeof c] === undefined;
    });
  switch (intent) {
    case "message":
    case "medical_question":
    case "renewal":
      return need([...who, "phone", "messageText"]);
    case "callback":
      return need([...who, "phone", "reason"]);
    case "appointment_new":
      return need([...who, "phone", "newPatient", "preference"]);
    case "appointment_reschedule":
      return need([...who, "phone", "currentStart", "preference"]);
    case "appointment_cancel":
      return need([...who, "phone", "currentStart"]);
    default:
      return [];
  }
};

const practitionerFrom = (
  hint: string | undefined,
  config: CabinetConfig
): string | undefined => {
  if (!hint) return undefined;
  const h = fold(hint);
  const hits = config.practitioners.filter(p =>
    [p.displayName, ...p.aliases].some(
      n => h.includes(fold(n)) || fold(n).includes(h)
    )
  );
  return hits.length === 1 ? hits[0].ref : undefined; // deux candidats : on ne choisit pas
};

const recipientOf = (c: ConversationState["collected"]): Recipient =>
  c.practitionerRef
    ? { kind: "practitioner", practitionerRef: c.practitionerRef }
    : { kind: "secretariat" };

const who = (c: ConversationState["collected"]) =>
  c.relation && c.relation !== "self" && c.concernedName
    ? `${c.concernedName}, de la part de ${c.callerName}`
    : `${c.callerName}`;

const person = (c: ConversationState["collected"]) => ({
  declaredName: c.callerName!,
  ...(c.phone ? { phone: c.phone } : {}),
  relation: c.relation ?? "self",
  ...(c.relation && c.relation !== "self" && c.concernedName
    ? { concernedName: c.concernedName }
    : {}),
});

/** Construit la commande à proposer, et sa reformulation. */
const propose = (
  state: ConversationState,
  ctx: EngineContext
): { command: Command; text: string } | null => {
  const c = state.collected;
  switch (state.intent) {
    case "message":
    case "medical_question":
    case "renewal": {
      const category =
        state.intent === "medical_question"
          ? "question_medicale"
          : state.intent === "renewal"
            ? "renouvellement"
            : (c.category ?? "administratif");
      const summary = `${category === "administratif" ? "Message" : category === "renouvellement" ? "Demande de renouvellement, à traiter par le professionnel" : "Question médicale, à traiter par le professionnel"} de ${who(c)}.`;
      return {
        command: {
          type: "message.create",
          payload: {
            caller: person(c),
            recipient: recipientOf(c),
            confirmedText: c.messageText!,
            aiSummary: summary,
            category,
            level: "normal",
          },
        },
        text: `Je récapitule : message de ${who(c)}, à rappeler au ${speakPhone(c.phone!)}. Votre message : « ${c.messageText} ». Est-ce exact ?`,
      };
    }
    case "callback":
      return {
        command: {
          type: "callback.request",
          payload: {
            person: { ...person(c), phone: c.phone! },
            reason: c.reason!,
            preferences: {
              windows: c.windows ?? [],
              ...(c.preferenceText ? { note: c.preferenceText } : {}),
            },
            recipient: recipientOf(c),
            priority: "normal",
          },
        },
        text: `Je récapitule : demande de rappel pour ${who(c)}, au ${speakPhone(c.phone!)}, motif : « ${c.reason} ». Est-ce exact ?`,
      };
    case "appointment_new": {
      if (c.chosenSlot) {
        return {
          command: {
            type: "appointment.book",
            payload: {
              person: person(c),
              newPatient: c.newPatient!,
              slot: c.chosenSlot,
            },
          },
          text: `Je récapitule : rendez-vous pour ${who(c)}, le ${speakInstant(c.chosenSlot.start)}${practitionerLabel(c.chosenSlot, ctx)}. Numéro : ${speakPhone(c.phone!)}. Je réserve ce créneau ?`,
        };
      }
      const payload: AppointmentRequestPayload = {
        person: person(c),
        newPatient: c.newPatient!,
        ...(c.practitionerRef ? { practitionerRef: c.practitionerRef } : {}),
        ...(c.appointmentTypeRef
          ? { appointmentTypeRef: c.appointmentTypeRef }
          : {}),
        preferences: {
          windows: c.windows ?? [],
          ...(c.preferenceText ? { note: c.preferenceText } : {}),
        },
      };
      return {
        command: { type: "appointment.request", payload },
        text: `Je récapitule : demande de rendez-vous pour ${who(c)}, au ${speakPhone(c.phone!)}${c.preferenceText ? `, de préférence ${c.preferenceText}` : ""}. Le cabinet vous recontactera pour fixer l'horaire. Je transmets cette demande ?`,
      };
    }
    case "appointment_reschedule":
      if (!c.chosenSlot) return null;
      return {
        command: {
          type: "appointment.reschedule",
          payload: {
            verification: {
              currentStart: c.currentStart!,
              declaredName: c.callerName!,
              phone: c.phone!,
            },
            newSlot: c.chosenSlot,
          },
        },
        text: `Je récapitule : déplacer le rendez-vous du ${speakInstant(c.currentStart!)} au ${speakInstant(c.chosenSlot.start)}. L'ancien rendez-vous ne sera libéré qu'une fois le nouveau réservé. Je fais ce changement ?`,
      };
    case "appointment_cancel":
      return {
        command: {
          type: "appointment.cancel",
          payload: {
            verification: {
              currentStart: c.currentStart!,
              declaredName: c.callerName!,
              phone: c.phone!,
            },
          },
        },
        text: `Je récapitule : annuler le rendez-vous du ${speakInstant(c.currentStart!)}, au nom de ${who(c)}. Je confirme l'annulation ?`,
      };
    default:
      return null;
  }
};

const practitionerLabel = (slot: SlotChoice, ctx: EngineContext) => {
  const p = ctx.config.practitioners.find(x => x.ref === slot.practitionerRef);
  return p ? `, avec ${p.displayName}` : "";
};

/** Fusionne ce qui a été compris dans l'état. Ne remplace pas une donnée par du vide. */
const merge = (
  state: ConversationState,
  u: Understanding,
  ctx: EngineContext
): string | null => {
  const c = state.collected;
  const e = u.entities;
  // Un nom acquis n'est remplacé que sur demande ou correction explicite.
  if (
    e.callerName &&
    (!c.callerName ||
      state.asking === "callerName" ||
      state.phase === "confirming")
  )
    c.callerName = e.callerName;
  if (e.relation) c.relation = e.relation;
  if (e.concernedName) c.concernedName = e.concernedName;
  if (e.phone) c.phone = e.phone;
  if (e.newPatient !== undefined) c.newPatient = e.newPatient;
  if (e.messageText) c.messageText = e.messageText;
  if (e.reason) c.reason = e.reason;
  const pr = practitionerFrom(e.practitionerHint, ctx.config);
  if (pr) c.practitionerRef = pr;
  if (e.dateTimeText) {
    const reading = readDateTime(e.dateTimeText, ctx.nowMs);
    const wantsCurrent =
      state.asking === "currentStart" ||
      (c.currentStart === undefined &&
        (state.intent === "appointment_cancel" ||
          state.intent === "appointment_reschedule") &&
        state.asking !== "preference");
    if (reading.ambiguities.length)
      return clarification(reading.ambiguities[0]);
    if (wantsCurrent && reading.date && reading.time) {
      const w = windowsFrom(reading, ctx.nowMs);
      if (w) c.currentStart = w[0].from;
    } else if (!wantsCurrent) {
      const w = windowsFrom(reading, ctx.nowMs);
      if (w && (reading.date || reading.time || reading.period)) {
        c.windows = w;
        c.preferenceText = e.dateTimeText.slice(0, 120);
      }
    } else if (wantsCurrent) {
      return "Pouvez-vous me préciser la date et l'heure exactes du rendez-vous actuel ?";
    }
  }
  return null;
};

const clarification = (code: string) =>
  ({
    heure_matin_ou_apres_midi: "S'agit-il du matin ou de l'après-midi ?",
    jour_de_semaine_aujourdhui:
      "Parlez-vous d'aujourd'hui, ou de la semaine prochaine ?",
    mois_non_precise: "De quel mois s'agit-il ?",
    date_invalide: "Cette date ne semble pas exister. Pouvez-vous la redire ?",
    heure_inexistante_changement_heure:
      "Avec le changement d'heure, cet horaire n'existe pas ce jour-là. Pouvez-vous en proposer un autre ?",
    heure_double_changement_heure:
      "Avec le changement d'heure, cet horaire existe deux fois ce jour-là. Pouvez-vous choisir un autre horaire ?",
  })[code] ?? "Pouvez-vous préciser la date et l'heure ?";

/** Étape suivante une fois l'état à jour : demander, chercher, ou reformuler. */
const advance = (
  state: ConversationState,
  ctx: EngineContext,
  say: string[]
): Decision => {
  state.missing = requiredFields(state.intent, state.collected);
  if (state.missing.length) {
    const f = state.missing[0];
    state.phase = "collecting";
    state.asking = f;
    say.push(QUESTIONS[f]);
    return { state, say };
  }
  const needsSlots =
    (state.intent === "appointment_new" ||
      state.intent === "appointment_reschedule") &&
    !state.collected.chosenSlot &&
    !state.offeredSlots.length &&
    state.confirmation !== "no";
  if (needsSlots) {
    state.phase = "offering";
    state.asking = undefined;
    say.push("Je regarde les disponibilités du cabinet.");
    return {
      state,
      say,
      availability: {
        ...(state.collected.practitionerRef
          ? { practitionerRef: state.collected.practitionerRef }
          : {}),
        ...(state.collected.appointmentTypeRef
          ? { appointmentTypeRef: state.collected.appointmentTypeRef }
          : {}),
        windows: state.collected.windows ?? [],
        limit: MAX_OFFERED,
      },
    };
  }
  const p = propose(state, ctx);
  if (!p) {
    state.phase = "closing";
    state.asking = "anything_else";
    say.push(
      "Je ne peux pas faire cette opération. Souhaitez-vous laisser un message au cabinet ?"
    );
    return { state, say };
  }
  state.proposed = p.command;
  state.confirmation = "pending";
  state.phase = "confirming";
  state.asking = "confirmation";
  say.push(p.text);
  return { state, say };
};

export const greet = (
  state0: ConversationState,
  ctx: EngineContext,
  open: boolean
): Decision => {
  const state = clone(state0);
  const cfg = ctx.config;
  const disclosure =
    `Bonjour, vous êtes bien au cabinet ${cfg.cabinetName || ""}. Je suis ${cfg.assistantName}, l'assistante vocale automatisée du cabinet.`.replace(
      "  ",
      " "
    );
  const custom = open ? cfg.greeting : cfg.closedGreeting;
  const lines = [disclosure];
  if (custom.trim()) lines.push(custom.trim());
  if (!open) lines.push("Le cabinet est actuellement fermé.");
  lines.push("Que puis-je faire pour vous ?");
  state.phase = "intent";
  state.turns.push({ role: "assistant", text: lines.join(" ") });
  return { state, say: lines };
};

/** Une réplique de l'appelant. */
export const onCallerTurn = (
  state0: ConversationState,
  utterance: string,
  u: Understanding,
  ctx: EngineContext
): Decision => {
  const state = clone(state0);
  state.turns.push({ role: "caller", text: utterance.slice(0, 2000) });
  const say: string[] = [];
  const done = (d: Decision): Decision => {
    d.state.turns.push(
      ...d.say.map(text => ({ role: "assistant" as const, text }))
    );
    return d;
  };

  if (state.phase === "ended" || state.phase === "handoff")
    return done({ state, say: [] });

  // 1. Détresse exprimée : on sort du parcours automatisé.
  const urgency = assessUtterance(utterance);
  if (urgency.handOff) {
    state.phase = "handoff";
    state.handoffReason = "distress_expressed";
    say.push(urgencyNotice(ctx.config));
    const dest = ctx.config.urgency.humanDestinationRef;
    if (dest) {
      say.push("Je vous mets en relation avec une personne du cabinet.");
      return done({
        state,
        say,
        command: {
          type: "call.transfer",
          payload: { destinationRef: dest, reason: "distress_expressed" },
        },
      });
    }
    return done({ state, say, end: true });
  }

  // 2. Tentative de détournement : tracée, refusée, sans effet sur l'état.
  if (looksLikeInjection(utterance)) {
    state.injectionAttempts += 1;
    say.push(
      "Je ne peux pas modifier mon fonctionnement. Je peux vous aider pour un rendez-vous, un message ou une demande de rappel."
    );
    return done({ state, say });
  }

  // 3. Demande d'un humain.
  if (u.intent === "human") {
    const dest = ctx.config.transferDestinations[0]?.ref;
    if (dest) {
      state.phase = "handoff";
      state.handoffReason = "caller_request";
      say.push("Je vous transfère vers le cabinet.");
      return done({
        state,
        say,
        command: {
          type: "call.transfer",
          payload: { destinationRef: dest, reason: "caller_request" },
        },
      });
    }
    say.push(
      "Personne n'est disponible pour prendre l'appel pour le moment. Je peux prendre un message pour le cabinet."
    );
    state.intent = "message";
    return done(advance(state, ctx, say));
  }

  // 4. Confirmation d'une reformulation.
  if (state.phase === "confirming") {
    if (u.confirmation === "yes") {
      state.confirmation = "yes";
      state.phase = "executing";
      state.asking = undefined;
      return done({ state, say, command: state.proposed! });
    }
    if (u.confirmation === "no" || u.confirmation === "correction") {
      state.confirmation = "no";
      state.proposed = null;
      const hadEntities = Object.keys(u.entities).length > 0;
      if (hadEntities) {
        const ask = merge(state, u, ctx);
        if (ask) return done({ state, say: [ask] });
        state.confirmation = "none";
        return done(advance(state, ctx, say));
      }
      state.phase = "collecting";
      state.asking = undefined;
      say.push("D'accord. Qu'est-ce qui doit être corrigé ?");
      return done({ state, say });
    }
    if (Object.keys(u.entities).length) {
      const ask = merge(state, u, ctx);
      if (ask) return done({ state, say: [ask] });
      state.confirmation = "none";
      state.proposed = null;
      return done(advance(state, ctx, say));
    }
    say.push("Pouvez-vous me répondre par oui ou par non ?");
    return done({ state, say });
  }

  // 5. Choix d'un créneau proposé.
  if (state.phase === "offering" && state.offeredSlots.length) {
    if (u.slotChoice && state.offeredSlots[u.slotChoice - 1]) {
      state.collected.chosenSlot = state.offeredSlots[u.slotChoice - 1];
      return done(advance(state, ctx, say));
    }
    if (u.confirmation === "no") {
      // Aucun créneau ne convient : une demande, pas une réservation.
      state.offeredSlots = [];
      state.confirmation = "no";
      if (state.intent === "appointment_reschedule") {
        say.push("Je laisse votre rendez-vous actuel inchangé.");
        state.intent = "message";
        state.collected.messageText = `Souhaite déplacer le rendez-vous du ${speakInstant(state.collected.currentStart!)} ; aucun créneau proposé ne convient.`;
      }
      state.confirmation = "none";
      return done(advance(state, ctx, say));
    }
    say.push(
      "Lequel de ces créneaux préférez-vous : le premier, le deuxième ou le troisième ?"
    );
    return done({ state, say });
  }

  // 6. Après un résultat : autre chose ?
  if (state.phase === "closing") {
    if (u.intent && u.intent !== "unknown") {
      const keep = {
        callerName: state.collected.callerName,
        phone: state.collected.phone,
      };
      state.collected = { ...keep };
      state.offeredSlots = [];
      state.proposed = null;
      state.confirmation = "none";
    } else {
      state.phase = "ended";
      say.push("Merci de votre appel. Au revoir.");
      return done({ state, say, end: true });
    }
  }

  // 7. Intention.
  if (
    u.intent &&
    u.intent !== "unknown" &&
    (state.intent === null ||
      state.phase === "intent" ||
      state.phase === "closing")
  ) {
    state.intent = u.intent;
    if (u.intent === "medical_question" || u.intent === "renewal") {
      say.push(
        "Je ne peux pas répondre aux questions médicales. Je transmets votre demande au professionnel, qui vous répondra."
      );
    }
  }
  if (state.intent === "information") {
    const reply = guardFreeReply(u.informationReply);
    say.push(
      reply ??
        "Je n'ai pas cette information. Souhaitez-vous laisser un message au cabinet ?"
    );
    state.phase = "closing";
    state.asking = "anything_else";
    state.intent = null;
    return done({ state, say });
  }
  if (!state.intent) {
    say.push(
      "Je peux prendre un rendez-vous, un message, ou une demande de rappel. Que souhaitez-vous ?"
    );
    state.phase = "intent";
    return done({ state, say });
  }

  const ask = merge(state, u, ctx);
  if (ask) {
    state.asking = "clarify_time";
    return done({ state, say: [...say, ask] });
  }
  return done(advance(state, ctx, say));
};

/** Les créneaux rendus par NJP CARE. */
export const onAvailability = (
  state0: ConversationState,
  result: AvailabilityResult,
  ctx: EngineContext
): Decision => {
  const state = clone(state0);
  const say: string[] = [];
  const slots =
    result.status === "confirmed" || result.status === "simulated"
      ? result.slots.slice(0, MAX_OFFERED)
      : [];
  if (!slots.length) {
    say.push(
      result.status === "confirmed"
        ? "Je ne trouve pas de créneau disponible sur cette période."
        : "Je ne peux pas consulter le planning pour le moment."
    );
    if (state.intent === "appointment_reschedule") {
      say.push(
        "Je laisse votre rendez-vous actuel inchangé et je transmets votre demande au cabinet."
      );
      state.intent = "message";
      state.collected.messageText = `Souhaite déplacer le rendez-vous du ${speakInstant(state.collected.currentStart!)}${state.collected.preferenceText ? `, de préférence ${state.collected.preferenceText}` : ""}.`;
    }
    state.confirmation = "no"; // pas de nouvelle recherche : une demande
    const d = advance(state, ctx, say);
    d.state.turns.push(
      ...d.say.map(text => ({ role: "assistant" as const, text }))
    );
    return d;
  }
  state.offeredSlots = slots;
  state.phase = "offering";
  state.asking = "slot";
  const list = slots
    .map(
      (s, i) =>
        `${["premier", "deuxième", "troisième"][i]} : ${speakInstant(s.start)}${practitionerLabel(s, ctx)}`
    )
    .join(" ; ");
  say.push(
    `${result.status === "simulated" ? "[Simulation] " : ""}Je peux vous proposer : ${list}. Lequel vous convient ?`
  );
  state.turns.push(...say.map(text => ({ role: "assistant" as const, text })));
  return { state, say };
};

/** Le résultat réel d'une commande. La phrase dépend du STATUT, rien d'autre. */
export const onResult = (
  state0: ConversationState,
  result: CommandResult,
  ctx: EngineContext
): Decision => {
  const state = clone(state0);
  const cmd = state.proposed;
  const say: string[] = [];
  const type = cmd?.type ?? "call.transfer";
  state.lastResult = {
    type,
    status: result.status,
    ...(result.reference ? { reference: result.reference } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };

  const finish = () => {
    state.phase = "closing";
    state.asking = "anything_else";
    state.proposed = null;
    state.confirmation = "none";
    say.push("Puis-je faire autre chose pour vous ?");
  };

  switch (result.status) {
    case "confirmed":
      say.push(
        {
          "message.create": "Votre message est enregistré pour le cabinet.",
          "callback.request":
            "Votre demande de rappel est enregistrée. Le cabinet vous rappellera.",
          "appointment.request":
            "Votre demande de rendez-vous est enregistrée. Le cabinet vous recontactera pour fixer l'horaire.",
          "appointment.book": `C'est confirmé : votre rendez-vous est réservé le ${state.collected.chosenSlot ? speakInstant(state.collected.chosenSlot.start) : ""}.`,
          "appointment.reschedule": `C'est confirmé : votre rendez-vous est déplacé au ${state.collected.chosenSlot ? speakInstant(state.collected.chosenSlot.start) : ""}.`,
          "appointment.cancel": "C'est confirmé : le rendez-vous est annulé.",
          "call.transfer": "",
          "call.report": "",
        }[type]
      );
      finish();
      break;
    case "simulated":
      say.push(
        "[Simulation] Aucune opération réelle n'a été effectuée : le cabinet n'a rien reçu."
      );
      finish();
      break;
    case "requested":
    case "pending":
      say.push(
        type === "message.create" ||
          type === "callback.request" ||
          type === "appointment.request"
          ? "Votre demande est transmise. Le cabinet la recevra dès que son logiciel sera disponible."
          : "Votre demande est transmise au cabinet ; elle n'est pas encore confirmée."
      );
      finish();
      break;
    case "refused":
      if (
        result.reason === "slot_unavailable" &&
        (type === "appointment.book" || type === "appointment.reschedule")
      ) {
        say.push(
          "Ce créneau vient d'être pris. Je cherche d'autres disponibilités."
        );
        state.collected.chosenSlot = undefined;
        state.offeredSlots = [];
        state.proposed = null;
        state.confirmation = "none";
        const d = advance(state, ctx, say);
        d.state.turns.push(
          ...d.say.map(text => ({ role: "assistant" as const, text }))
        );
        return d;
      }
      if (result.reason === "verification_failed") {
        say.push(
          "Je ne retrouve pas ce rendez-vous avec ces informations. Je ne peux donc pas le modifier. Je peux transmettre un message au cabinet."
        );
      } else {
        say.push(
          "Le cabinet n'autorise pas cette opération par téléphone. Je peux transmettre un message."
        );
      }
      finish();
      break;
    case "failed":
      if (
        result.reason === "care_offline" &&
        (type === "appointment.book" ||
          type === "appointment.reschedule" ||
          type === "appointment.cancel")
      ) {
        // Hors ligne : jamais de modification effective ; une demande à la place.
        say.push(
          "Je ne peux pas modifier le planning pour le moment. Aucun rendez-vous n'a été réservé, déplacé ni annulé."
        );
        const c = state.collected;
        if (type === "appointment.book" && c.chosenSlot) {
          c.preferenceText = `le créneau du ${speakInstant(c.chosenSlot.start)}`;
          c.windows = [{ from: c.chosenSlot.start, to: c.chosenSlot.end }];
          c.chosenSlot = undefined;
          state.offeredSlots = [];
          state.confirmation = "no";
        } else {
          state.intent = "message";
          c.messageText =
            type === "appointment.cancel"
              ? `Souhaite annuler le rendez-vous du ${speakInstant(c.currentStart!)}.`
              : `Souhaite déplacer le rendez-vous du ${speakInstant(c.currentStart!)}${c.chosenSlot ? ` au ${speakInstant(c.chosenSlot.start)}` : ""}.`;
          c.chosenSlot = undefined;
        }
        state.proposed = null;
        const p = propose(state, ctx);
        if (p) {
          state.proposed = p.command;
          state.confirmation = "pending";
          state.phase = "confirming";
          state.asking = "confirmation";
          say.push(p.text);
        } else finish();
        break;
      }
      say.push(
        "Une erreur m'empêche d'enregistrer cette demande. Rien n'a été enregistré."
      );
      finish();
      break;
    case "unsupported":
      say.push(
        "Le cabinet n'a pas activé cette fonction. Rien n'a été enregistré ; merci de rappeler le cabinet aux heures d'ouverture."
      );
      finish();
      break;
  }
  state.turns.push(...say.map(text => ({ role: "assistant" as const, text })));
  return { state, say };
};

/** Résultat d'un transfert téléphonique : un échec ramène à la prise de message. */
export const onTransferResult = (
  state0: ConversationState,
  connected: boolean,
  ctx: EngineContext
): Decision => {
  const state = clone(state0);
  if (connected) {
    state.phase = "ended";
    return { state, say: [], end: true };
  }
  const say = [
    "Le transfert n'a pas abouti. Je peux prendre un message pour le cabinet.",
  ];
  state.phase = "collecting";
  state.intent = "message";
  const d = advance(state, ctx, say);
  d.state.turns.push(
    ...d.say.map(text => ({ role: "assistant" as const, text }))
  );
  return d;
};
