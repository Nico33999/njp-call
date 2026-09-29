/**
 * NJP CALL — situations qui demandent un humain, sans jouer au médecin.
 *
 * NJP CALL est **administratif**. Il ne diagnostique pas, ne trie pas, ne
 * « détecte » pas d'urgence. Il repère seulement des formulations qui
 * justifient de ne pas poursuivre un échange automatisé, et applique alors la
 * consigne **validée par le cabinet** : passage à un humain, et rappel prudent
 * des numéros d'urgence.
 *
 * L'ancien prototype déclenchait une « ALERTE URGENCE » dès qu'un message
 * contenait 15, 17 ou 18 — donc sur « un rendez-vous à 15 h » ou « le 18
 * septembre ». Aucun chiffre n'est plus lu ici.
 */
import { fold } from "./datetime";

/**
 * Formulations explicites. Volontairement courtes et littérales : une liste
 * qu'un cabinet peut relire et compléter, pas un classifieur opaque.
 */
const DISTRESS_PATTERNS: readonly RegExp[] = [
  /\b(ne|n') ?(respire|respirons) (plus|pas|mal)\b/,
  /\b(il|elle|je|on) (s'est |a )?(evanoui|perdu connaissance)/,
  /\binconscient/,
  /\bdouleur(s)? (a|dans|de) la poitrine\b/,
  /\bmal (a|dans) la poitrine\b/,
  /\bsaigne (beaucoup|enormement|abondamment)\b/,
  /\bhemorragie\b/,
  /\bconvuls/,
  /\b(avc|accident vasculaire)\b/,
  /\bvisage (paralyse|tombe)\b/,
  /\b(envie|idees?) de (mourir|suicide|me tuer)\b|\bme suicider\b/,
  /\bc'est (une )?urgen(ce|t)\b/,
  /\bappelez (les secours|le samu|une ambulance)\b/,
];

/** « ce n'est pas une urgence », « rien d'urgent », « pas urgent du tout ». */
const NEGATED_URGENCY =
  /\b(pas|rien|aucune?) (d'|une? )?urgen(ce|t)|\bn'est pas (une )?urgen(ce|t)|\bpas (du tout )?urgent/;

export interface UrgencyAssessment {
  /** Faut-il sortir du parcours automatisé ? */
  handOff: boolean;
  /** Motifs lisibles par le cabinet (jamais présentés comme un diagnostic). */
  matched: string[];
}

export const assessUtterance = (utterance: string): UrgencyAssessment => {
  const s = fold(utterance);
  const matched: string[] = [];
  for (const p of DISTRESS_PATTERNS) {
    const m = s.match(p);
    if (!m) continue;
    // « c'est urgent » est neutralisé par une négation explicite.
    if (/urgen/.test(m[0]) && NEGATED_URGENCY.test(s)) continue;
    matched.push(m[0]);
  }
  return { handOff: matched.length > 0, matched };
};

/**
 * Consigne par défaut, **à valider par le cabinet** avant activation. Elle ne
 * dit pas qu'une urgence a été détectée.
 */
export const DEFAULT_URGENCY_NOTICE =
  "Je suis une assistante automatisée et je ne peux pas évaluer une situation médicale. " +
  "En cas d'urgence médicale immédiate, raccrochez et appelez le 15, ou le 112.";

/** Phrase de secours quand le service conversationnel est indisponible. */
export const DEGRADED_NOTICE =
  "Notre assistante automatisée est momentanément indisponible. " +
  "En cas d'urgence médicale immédiate, appelez le 15 ou le 112. " +
  "Sinon, merci de rappeler le cabinet ultérieurement.";

export interface UrgencyPolicy {
  /** Texte validé par le cabinet ; absent ⇒ la consigne par défaut. */
  notice?: string;
  /** Le cabinet a relu et validé la consigne. Requis pour l'activation. */
  validatedByCabinet: boolean;
  /** Destination de transfert humain autorisée, si le cabinet en a une. */
  humanDestinationRef?: string;
}
