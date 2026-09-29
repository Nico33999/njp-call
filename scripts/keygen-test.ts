/**
 * Engendre une clé d'ESSAI pour signer des paquets d'extension.
 *
 *   pnpm tsx scripts/keygen-test.ts <dossier-hors-depot>
 *
 * Écrit `<dossier>/njp-call-extensions-essai.key.json` (privée) et
 * `<dossier>/njp-call-extensions-essai.pub` (publique, format minisign).
 * Refuse d'écrire dans un dépôt Git. Une clé d'essai ne signe jamais le canal
 * stable (`build-package.ts` et NJP CARE le refusent tous deux).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateTestKey, publicKeyText } from "./minisign";
import { insideGitRepo } from "./paths";

const dir = process.argv[2];
if (!dir) {
  console.error("usage : tsx scripts/keygen-test.ts <dossier-hors-depot>");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
const abs = path.resolve(dir);
if (insideGitRepo(abs)) {
  console.error(`refusé : ${abs} est dans un dépôt Git.`);
  process.exit(3);
}
const key = generateTestKey();
writeFileSync(
  path.join(abs, "njp-call-extensions-essai.key.json"),
  `${JSON.stringify(key)}\n`,
  { mode: 0o600 }
);
writeFileSync(
  path.join(abs, "njp-call-extensions-essai.pub"),
  publicKeyText(key)
);
console.log(publicKeyText(key));
