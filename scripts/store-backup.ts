/**
 * Sauvegarde À CHAUD du stockage du service (le service peut tourner).
 *
 *   NJP_CALL_DB_PATH=/var/lib/njp-call/service.db \
 *     pnpm store:backup /var/backups/njp-call/service-$(date +%F).db
 *
 * `VACUUM INTO` produit une copie cohérente. Les contenus restent chiffrés
 * (AES-256-GCM, NJP_CALL_STORAGE_KEY) : la sauvegarde ne contient aucun
 * texte d'appelant en clair, mais elle est INUTILISABLE sans la clé — la clé
 * se sauvegarde à part, dans le coffre de secrets de l'hébergement.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");

const src = process.env.NJP_CALL_DB_PATH;
const dest = process.argv[2];
if (!src || !dest) {
  console.error(
    "usage : NJP_CALL_DB_PATH=… store-backup <fichier de destination>"
  );
  process.exit(2);
}
if (existsSync(dest)) {
  console.error(
    JSON.stringify({ event: "backup_refused", reason: "destination_exists" })
  );
  process.exit(1);
}
const db = new DatabaseSync(src, { readOnly: true });
db.prepare("VACUUM INTO ?").run(dest);
db.close();
console.log(JSON.stringify({ event: "backup_written", destination: dest }));
