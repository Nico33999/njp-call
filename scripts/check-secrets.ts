/**
 * Aucun secret dans le dépôt, le paquet, ni le bundle du navigateur.
 *
 *   pnpm check:secrets
 *
 * Cherche des motifs de clés (privées, API) dans les fichiers suivis par Git
 * et dans `dist/`. Les fixtures de test utilisent des valeurs manifestement
 * factices (`FAUSSE`, `FAUX`, `test`) et sont autorisées nommément.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const PATTERNS: [string, RegExp][] = [
  [
    "clé privée PEM",
    /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  ["clé minisign privée", /untrusted comment: minisign encrypted secret key/],
  ["clé d'essai NJP (pkcs8)", /"pkcs8"\s*:\s*"MC4CAQAw/],
  ["clé Resend", /\bre_[A-Za-z0-9]{20,}\b/],
  ["clé OpenAI/Groq", /\b(?:sk|gsk)_[A-Za-z0-9]{20,}\b/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["clé AWS", /\bAKIA[0-9A-Z]{16}\b/],
];
const ALLOWED_FIXTURES = new Set([
  "tests/config.test.ts",
  "scripts/check-secrets.ts",
]);
const FORBIDDEN_FILES = [/\.key(\.json)?$/, /\.pem$/, /(^|\/)\.env(\.|$)/];

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean);
const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap(f =>
        statSync(path.join(dir, f)).isDirectory()
          ? walk(path.join(dir, f))
          : [path.join(dir, f)]
      )
    : [];
const built = walk(path.join(root, "dist")).map(f => path.relative(root, f));

const findings: string[] = [];
for (const rel of [...tracked, ...built]) {
  if (FORBIDDEN_FILES.some(r => r.test(rel)))
    findings.push(`${rel} : fichier de clé ou d'environnement suivi`);
  if (ALLOWED_FIXTURES.has(rel) || rel.endsWith("pnpm-lock.yaml")) continue;
  const abs = path.join(root, rel);
  if (!existsSync(abs) || statSync(abs).size > 5_000_000) continue;
  const text = readFileSync(abs, "utf8");
  for (const [name, re] of PATTERNS)
    if (re.test(text)) findings.push(`${rel} : ${name}`);
}
if (findings.length) {
  console.error(`secrets détectés :\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(
  JSON.stringify({ scanned: tracked.length + built.length, findings: 0 })
);
