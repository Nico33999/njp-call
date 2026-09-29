/**
 * NJP CALL — la téléphonie, sans fournisseur imposé.
 *
 * ```text
 *   fournisseur (SIP / opérateur)   ←→   TelephonyProvider   ←→   CallSession
 *     audio entrant/sortant,              traduit les webhooks       décide
 *     reconnaissance, synthèse            en TelephonyEvent,
 *                                         exécute say/transfer/hangup
 * ```
 *
 * Aucun fournisseur réel n'est intégré : le choix dépend d'un cadre
 * contractuel, géographique et de protection des données qui n'est pas
 * vérifiable depuis ce dépôt (voir docs/TELEPHONIE.md). Ce module fixe ce
 * qu'un fournisseur devra satisfaire, et un simulateur l'implémente pour les
 * bancs.
 *
 * Par défaut, **aucun audio n'est conservé** : seuls les textes reconnus
 * nécessaires à la décision traversent la session.
 */
import type { SessionOutput, TelephonyEvent } from "./session";

export interface SpeechOptions {
  /** L'appelant peut interrompre la synthèse (barge-in). */
  interruptible: boolean;
  language: string;
}

/** Ce qu'un fournisseur doit offrir. */
export interface TelephonyProvider {
  readonly name: string;
  say(callId: string, text: string, options: SpeechOptions): Promise<void>;
  /** `destinationRef` est résolu en numéro côté service, jamais par l'IA. */
  transfer(callId: string, destinationRef: string): Promise<void>;
  hangup(callId: string): Promise<void>;
}

/** Capacités attendues d'un fournisseur réel, vérifiées avant sélection. */
export const PROVIDER_REQUIREMENTS = [
  "Audio bidirectionnel en flux (streaming) avec interruption par l'appelant",
  "Reconnaissance vocale française en flux, avec score de confiance",
  "Détection des silences et des touches DTMF",
  "Transfert vers un numéro du cabinet, avec compte rendu de réussite ou d'échec",
  "Webhooks signés, horodatés, rejouables sans effet de bord",
  "Aucun enregistrement audio par défaut, désactivable contractuellement",
  "Traitement et stockage dans l'Union européenne ; hébergement compatible HDS si des données de santé transitent",
  "Contrat de sous-traitance (article 28 RGPD) et liste des sous-traitants ultérieurs",
] as const;

// ---------------------------------------------------------------------------
// Simulateur
// ---------------------------------------------------------------------------

export interface SimulatedAction {
  callId: string;
  kind: "say" | "transfer" | "hangup";
  text?: string;
  destinationRef?: string;
  interrupted?: boolean;
}

/** Fournisseur simulé : enregistre ce qu'on lui demande, n'appelle personne. */
export class SimulatedProvider implements TelephonyProvider {
  readonly name = "simulateur";
  readonly actions: SimulatedAction[] = [];
  async say(callId: string, text: string) {
    this.actions.push({ callId, kind: "say", text });
  }
  async transfer(callId: string, destinationRef: string) {
    this.actions.push({ callId, kind: "transfer", destinationRef });
  }
  async hangup(callId: string) {
    this.actions.push({ callId, kind: "hangup" });
  }
}

/** Relaie la sortie d'une session vers le fournisseur. */
export const dispatch = async (
  provider: TelephonyProvider,
  callId: string,
  out: SessionOutput,
  language = "fr"
) => {
  for (const text of out.say)
    await provider.say(callId, text, { interruptible: true, language });
  if (out.transferTo) await provider.transfer(callId, out.transferTo);
  if (out.hangup) await provider.hangup(callId);
};

/** Étapes d'un scénario de banc. */
export type ScenarioStep =
  | { caller: string; bargeIn?: boolean; confidence?: number }
  | { dtmf: string }
  | { silence: number }
  | { transfer: "connected" | "failed" }
  | { hangup: true }
  | { duplicateLast: true };

let counter = 0;
const eventId = (callId: string) => `${callId}-ev${++counter}`;

/**
 * Transforme un scénario en événements, horodatés à partir de `startMs`
 * (une seconde par étape). `duplicateLast` rejoue exactement le même
 * événement — ce que fait un fournisseur dont le webhook n'a pas été acquitté.
 */
export const scenarioEvents = (
  callId: string,
  startMs: number,
  open: boolean,
  steps: ScenarioStep[]
): TelephonyEvent[] => {
  const at = (i: number) => new Date(startMs + i * 1000).toISOString();
  const events: TelephonyEvent[] = [
    { id: eventId(callId), type: "call.started", at: at(0), open },
  ];
  steps.forEach((s, i) => {
    const t = at(i + 1);
    if ("caller" in s)
      events.push({
        id: eventId(callId),
        type: "caller.utterance",
        at: t,
        text: s.caller,
        bargeIn: s.bargeIn,
        confidence: s.confidence,
      });
    else if ("dtmf" in s)
      events.push({
        id: eventId(callId),
        type: "caller.dtmf",
        at: t,
        digits: s.dtmf,
      });
    else if ("silence" in s)
      events.push({
        id: eventId(callId),
        type: "caller.silence",
        at: t,
        ms: s.silence,
      });
    else if ("transfer" in s)
      events.push({
        id: eventId(callId),
        type: "transfer.result",
        at: t,
        connected: s.transfer === "connected",
      });
    else if ("hangup" in s)
      events.push({
        id: eventId(callId),
        type: "call.ended",
        at: t,
        reason: "hangup",
      });
    else if ("duplicateLast" in s)
      events.push(structuredClone(events[events.length - 1]));
  });
  return events;
};
