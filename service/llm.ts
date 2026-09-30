/**
 * NJP CALL — compréhension par un modèle de langage, sans fournisseur imposé.
 *
 * Interface « chat completions » générique (compatible avec plusieurs
 * fournisseurs). **Désactivée** tant que le cabinet/l'éditeur n'a pas retenu un
 * fournisseur dont la localisation, le contrat de sous-traitance et, si des
 * données de santé transitent, l'hébergement HDS sont vérifiés. En son absence,
 * la session utilise la lecture de repli (sans IA).
 *
 * Ce que le modèle reçoit :
 * - les règles obligatoires, puis les consignes du cabinet (bloc délimité) ;
 * - l'état structuré, présenté comme des faits ;
 * - l'historique utile : tours de l'appelant (`user`) et de l'assistante
 *   (`assistant`) uniquement — jamais un résultat technique déguisé en propos.
 *
 * Ce qu'il rend est validé par `validateUnderstanding` : aucune clé ne peut
 * ajouter une action.
 */
import { createHash } from "node:crypto";
import type { CabinetConfig } from "../core/config";
import {
  validateUnderstanding,
  type ConversationState,
  type Understanding,
} from "../core/conversation";
import { composeSystemPrompt } from "../core/rules";
import type { Understander } from "../core/session";
import { allowedOutbound } from "./security";

export interface LlmSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  allowHosts: string[];
  timeoutMs: number;
}

export const MAX_HISTORY_TURNS = 24;

export const buildMessages = (
  utterance: string,
  state: ConversationState,
  config: CabinetConfig
) => [
  {
    role: "system" as const,
    content: composeSystemPrompt(
      {
        assistantName: config.assistantName,
        cabinetName: config.cabinetName,
        languages: config.languages,
        cabinetInstructions: config.cabinetInstructions,
        cabinetKnowledge: config.cabinetKnowledge,
      },
      state
    ),
  },
  ...state.turns.slice(-MAX_HISTORY_TURNS).map(t => ({
    role: t.role === "caller" ? ("user" as const) : ("assistant" as const),
    content: t.text,
  })),
  { role: "user" as const, content: utterance.slice(0, 2000) },
];

export class LlmUnderstander implements Understander {
  constructor(
    private readonly settings: LlmSettings,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    if (!allowedOutbound(settings.endpoint, settings.allowHosts))
      throw new Error("Point d'accès IA non autorisé (liste blanche HTTPS).");
  }

  async understand(
    utterance: string,
    state: ConversationState,
    config: CabinetConfig
  ): Promise<Understanding> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.settings.timeoutMs);
    try {
      const res = await this.fetchImpl(this.settings.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.settings.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.settings.model,
          messages: buildMessages(utterance, state, config),
          temperature: 0,
          max_tokens: 400,
          response_format: { type: "json_object" },
        }),
        signal: ctrl.signal,
        redirect: "error",
      });
      if (!res.ok) throw new Error(`llm_http_${res.status}`);
      const text = await res.text();
      if (text.length > 64 * 1024) throw new Error("llm_response_too_large");
      const content = JSON.parse(text)?.choices?.[0]?.message?.content;
      return validateUnderstanding(JSON.parse(String(content)));
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Empreinte d'une configuration d'IA : ce qu'une validation (contrat de
 * sous-traitance, localisation, rétention, non-réutilisation des données)
 * approuve. La clé d'API n'y entre pas : elle peut tourner sans nouvelle
 * validation ; l'hôte, le modèle ou la liste blanche, non.
 */
export const llmApprovalFingerprint = (
  s: Pick<LlmSettings, "endpoint" | "model" | "allowHosts">
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        endpoint: s.endpoint,
        model: s.model,
        allowHosts: [...s.allowHosts].sort(),
      })
    )
    .digest("hex");

export type LlmGate =
  | { state: "absent" }
  | { state: "not_approved"; fingerprint: string }
  | { state: "approved"; settings: LlmSettings };

/**
 * L'IA reste DÉSACTIVÉE tant que sa configuration n'a pas été approuvée :
 * `NJP_CALL_LLM_APPROVED_FINGERPRINT` doit valoir l'empreinte exacte de
 * (point d'accès, modèle, hôtes autorisés). Sans cela : repli déterministe,
 * et le démarrage le dit (`llm: "not_approved"`), empreinte à faire valider.
 */
export const llmGateFromEnv = (env: NodeJS.ProcessEnv): LlmGate => {
  if (
    !env.NJP_CALL_LLM_ENDPOINT ||
    !env.NJP_CALL_LLM_API_KEY ||
    !env.NJP_CALL_LLM_MODEL
  )
    return { state: "absent" };
  const settings: LlmSettings = {
    endpoint: env.NJP_CALL_LLM_ENDPOINT,
    apiKey: env.NJP_CALL_LLM_API_KEY,
    model: env.NJP_CALL_LLM_MODEL,
    allowHosts: (env.NJP_CALL_LLM_ALLOWED_HOSTS ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
    timeoutMs: Number(env.NJP_CALL_LLM_TIMEOUT_MS ?? 6000),
  };
  const fingerprint = llmApprovalFingerprint(settings);
  return env.NJP_CALL_LLM_APPROVED_FINGERPRINT === fingerprint
    ? { state: "approved", settings }
    : { state: "not_approved", fingerprint };
};

export const llmFromEnv = (env: NodeJS.ProcessEnv): LlmSettings | null => {
  const g = llmGateFromEnv(env);
  return g.state === "approved" ? g.settings : null;
};
