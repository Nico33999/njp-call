/**
 * Vérifie un fichier de stockage (après restauration, ou une sauvegarde) :
 * il s'ouvre avec la clé, son schéma est compris, chaque contenu chiffré se
 * déchiffre (authentification AES-GCM). Ne rend que des comptes.
 *
 *   NJP_CALL_STORAGE_KEY=… pnpm store:verify /var/backups/njp-call/service-2026-09-29.db
 *
 * Restauration (service ARRÊTÉ) : copier la sauvegarde vérifiée à la place
 * de NJP_CALL_DB_PATH (et supprimer les fichiers -wal / -shm résiduels),
 * puis redémarrer. Les appels en cours au moment de la sauvegarde reprennent
 * là où ils étaient ; les éléments du relais déjà remis au poste sont
 * rejoués sans double effet (idempotence de NJP CARE).
 */
import { ServiceStore, storageKeyFromEnv } from "../service/store";

const file = process.argv[2];
const key = storageKeyFromEnv(process.env.NJP_CALL_STORAGE_KEY);
if (!file || !key) {
  console.error("usage : NJP_CALL_STORAGE_KEY=<64 hex> store-verify <fichier>");
  process.exit(2);
}
const store = new ServiceStore({ path: file, key });
const report = store.verifyAll();
store.close();
console.log(JSON.stringify({ event: "store_verified", ...report }));
process.exit(report.unreadable === 0 ? 0 : 1);
