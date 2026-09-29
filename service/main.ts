/**
 * Démarrage du service. Toute la configuration sensible vient de
 * l'environnement (ou d'un coffre qui le remplit) ; rien n'est lu du dépôt.
 *
 * | Variable | Contenu |
 * |---|---|
 * | `NJP_CALL_TELEPHONY_WEBHOOK_SECRET` | secret HMAC du fournisseur |
 * | `NJP_CALL_DEVICE_TOKENS` | `cabinetId=sha256(jeton);…` — empreintes seulement |
 * | `NJP_CALL_NUMBER_ROUTES` | `+33XXXXXXXXX=cabinetId;…` |
 * | `NJP_CALL_CONFIG_DIR` | dossier de configurations PUBLIQUES `<cabinetId>.json` |
 * | `NJP_CALL_LLM_*` | fournisseur d'IA, désactivé si absent (voir llm.ts) |
 * | `PORT` | port d'écoute |
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sanitizeConfig, type CabinetConfig } from "../core/config";
import { FallbackUnderstander } from "../core/session";
import { LlmUnderstander, llmFromEnv } from "./llm";
import { parseDeviceTokens } from "./security";
import { createService } from "./server";

const env = process.env;
const secret = env.NJP_CALL_TELEPHONY_WEBHOOK_SECRET ?? "";
if (secret.length < 32) {
  console.error(
    "NJP_CALL_TELEPHONY_WEBHOOK_SECRET absent ou trop court : le service refuse de démarrer."
  );
  process.exit(1);
}

const configs = new Map<string, CabinetConfig>();
const dir = env.NJP_CALL_CONFIG_DIR;
if (dir) {
  for (const f of readdirSync(dir).filter(x =>
    /^[A-Za-z0-9_-]{3,64}\.json$/.test(x)
  )) {
    configs.set(
      f.replace(/\.json$/, ""),
      sanitizeConfig(JSON.parse(readFileSync(path.join(dir, f), "utf8")))
    );
  }
}
const numberRoutes = new Map(
  (env.NJP_CALL_NUMBER_ROUTES ?? "")
    .split(";")
    .map(p => p.trim().split("="))
    .filter(
      ([n, c]) =>
        /^\+[1-9]\d{7,14}$/.test(n ?? "") &&
        /^[A-Za-z0-9_-]{3,64}$/.test(c ?? "")
    )
    .map(([n, c]) => [n, c] as [string, string])
);
const llm = llmFromEnv(env);

const { server } = createService({
  webhookSecret: secret,
  deviceTokens: parseDeviceTokens(env.NJP_CALL_DEVICE_TOKENS),
  numberRoutes,
  configs,
  understander: llm ? new LlmUnderstander(llm) : new FallbackUnderstander(),
});
server.listen(Number(env.PORT ?? 8787), () => {
  console.log(
    JSON.stringify({
      event: "listening",
      cabinets: configs.size,
      llm: llm ? "configured" : "fallback",
    })
  );
});
