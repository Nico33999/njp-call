/**
 * Démarrage du service. Toute la configuration sensible vient de
 * l'environnement (ou d'un coffre qui le remplit) ; rien n'est lu du dépôt.
 * Référence d'exploitation : docs/EXPLOITATION.md.
 *
 * | Variable | Contenu |
 * |---|---|
 * | `NJP_CALL_MODE` | `recette` (simulateur) ou `operationnel` |
 * | `NJP_CALL_DB_PATH` | fichier SQLite du service (obligatoire en `operationnel`) |
 * | `NJP_CALL_STORAGE_KEY` | 64 caractères hexadécimaux : chiffrement des contenus stockés |
 * | `NJP_CALL_RETENTION_DAYS` | purge des éléments terminés (défaut 30, borné 1–90) |
 * | `NJP_CALL_TELEPHONY_WEBHOOK_SECRET` | secret HMAC du simulateur / fournisseur |
 * | `NJP_CALL_DEVICE_TOKENS` | `cabinetId=sha256(jeton);…` — empreintes seulement ; plusieurs par cabinet pendant une rotation |
 * | `NJP_CALL_DEVICE_TOKENS_FILE` | même format, dans un fichier relu sur `SIGHUP` (rotation, révocation sans redémarrage) |
 * | `NJP_CALL_NUMBER_ROUTES` | `+33XXXXXXXXX=cabinetId;…` |
 * | `NJP_CALL_CONFIG_DIR` | dossier de configurations PUBLIQUES `<cabinetId>.json` |
 * | `NJP_CALL_LLM_*` | fournisseur d'IA, désactivé si absent (voir llm.ts) |
 * | `NJP_CALL_TLS_CERT` / `NJP_CALL_TLS_KEY` | recette : TLS terminé par le service (PEM) ; en exploitation, un frontal TLS |
 * | `NJP_CALL_TEST_FAULT` | bancs de panne : `point` ou `point@n` — honoré en `recette` SEULEMENT |
 * | `PORT` | port d'écoute |
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sanitizeConfig, type CabinetConfig } from "../core/config";
import { FallbackUnderstander } from "../core/session";
import { SimulatorInbound } from "./inbound";
import { LlmUnderstander, llmFromEnv } from "./llm";
import { parseDeviceTokens } from "./security";
import { createService, type FaultPoint } from "./server";
import { ServiceStore, storageKeyFromEnv } from "./store";

const env = process.env;
const fail = (message: string): never => {
  console.error(JSON.stringify({ event: "startup_refused", reason: message }));
  process.exit(1);
};

const mode = env.NJP_CALL_MODE ?? "recette";
if (mode !== "recette" && mode !== "operationnel")
  fail("NJP_CALL_MODE doit valoir recette ou operationnel");
if (env.NJP_CALL_TEST_FAULT && mode !== "recette")
  fail("NJP_CALL_TEST_FAULT est interdit hors recette");

const secret = env.NJP_CALL_TELEPHONY_WEBHOOK_SECRET ?? "";
if (secret.length < 32)
  fail("NJP_CALL_TELEPHONY_WEBHOOK_SECRET absent ou trop court");

// -- Persistance : obligatoire en exploitation --------------------------------
const dbPath = env.NJP_CALL_DB_PATH;
const key = storageKeyFromEnv(env.NJP_CALL_STORAGE_KEY);
if (mode === "operationnel") {
  if (!dbPath)
    fail(
      "mode operationnel sans NJP_CALL_DB_PATH : refus (aucun état en mémoire seule)"
    );
  if (!key)
    fail("mode operationnel sans NJP_CALL_STORAGE_KEY (64 hex) : refus");
  // Aucun adaptateur de fournisseur téléphonique réel n'existe encore : le
  // simulateur n'est jamais présenté comme une exploitation.
  fail(
    "aucun fournisseur téléphonique réel n'est branché : le mode operationnel reste fermé (voir docs/TELEPHONIE.md)"
  );
}
if (dbPath && !key) fail("NJP_CALL_DB_PATH sans NJP_CALL_STORAGE_KEY : refus");
const store = new ServiceStore({
  path: dbPath ?? ":memory:",
  key: key ?? randomBytes(32),
});
if (!dbPath)
  console.warn(
    JSON.stringify({
      event: "volatile_storage",
      mode,
      note: "recette sans NJP_CALL_DB_PATH : tout est perdu à l'arrêt",
    })
  );

const retention = Math.min(
  Math.max(Number(env.NJP_CALL_RETENTION_DAYS ?? 30) || 30, 1),
  90
);

// -- Configuration publique des cabinets -------------------------------------
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

// -- Jetons de poste : rotation et révocation à chaud ------------------------
const tokenFile = env.NJP_CALL_DEVICE_TOKENS_FILE;
const loadTokens = () => {
  const spec = [
    env.NJP_CALL_DEVICE_TOKENS ?? "",
    tokenFile ? readFileSync(tokenFile, "utf8").replace(/\s+/g, ";") : "",
  ].join(";");
  return parseDeviceTokens(spec);
};
let deviceTokens = loadTokens();
process.on("SIGHUP", () => {
  try {
    deviceTokens = loadTokens();
    console.log(
      JSON.stringify({
        event: "device_tokens_reloaded",
        count: deviceTokens.size,
      })
    );
  } catch {
    console.error(JSON.stringify({ event: "device_tokens_reload_failed" }));
  }
});

// -- Bancs de panne (recette seulement) ---------------------------------------
let fault: ((p: FaultPoint) => void) | undefined;
if (env.NJP_CALL_TEST_FAULT) {
  const [point, nth] = env.NJP_CALL_TEST_FAULT.split("@");
  let remaining = Number(nth ?? 1) || 1;
  fault = p => {
    if (p === point && --remaining === 0) {
      // Arrêt brutal, sans fermeture propre : c'est une panne.
      process.stderr.write(
        `${JSON.stringify({ event: "fault_injected", point })}\n`
      );
      process.kill(process.pid, "SIGKILL");
    }
  };
}

const llm = llmFromEnv(env);
const service = createService({
  store,
  inbound: new SimulatorInbound(secret),
  deviceTokens: () => deviceTokens,
  numberRoutes,
  configs,
  understander: llm ? new LlmUnderstander(llm) : new FallbackUnderstander(),
  fault,
  ...(env.NJP_CALL_TLS_CERT && env.NJP_CALL_TLS_KEY
    ? {
        tls: {
          cert: readFileSync(env.NJP_CALL_TLS_CERT, "utf8"),
          key: readFileSync(env.NJP_CALL_TLS_KEY, "utf8"),
        },
      }
    : {}),
  ...(env.NJP_CALL_RELAY_LEASE_MS
    ? {
        relay: { leaseMs: Math.max(1000, Number(env.NJP_CALL_RELAY_LEASE_MS)) },
      }
    : {}),
});

const purge = () => {
  try {
    const n = store.purge(retention);
    console.log(JSON.stringify({ event: "purge", ...n }));
  } catch {
    console.error(JSON.stringify({ event: "purge_failed" }));
  }
};
purge();
const purgeTimer = setInterval(purge, 6 * 3600_000);
purgeTimer.unref();

service.server.listen(Number(env.PORT ?? 8787), env.HOST ?? "127.0.0.1", () => {
  const addr = service.server.address();
  console.log(
    JSON.stringify({
      event: "listening",
      mode,
      port: typeof addr === "object" && addr ? addr.port : null,
      storage: dbPath ? "durable" : "volatile",
      tls: env.NJP_CALL_TLS_CERT ? "service" : "frontal",
      cabinets: configs.size,
      llm: llm ? "configured" : "fallback",
    })
  );
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(JSON.stringify({ event: "shutdown", signal: sig }));
    const hard = setTimeout(() => process.exit(1), 10_000);
    hard.unref();
    service.shutdown().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  });
}
