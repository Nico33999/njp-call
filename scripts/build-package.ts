/**
 * Construit le paquet NJP CALL, de façon reproductible.
 *
 *   pnpm package:build
 *
 * Produit dans `dist/package/` :
 * - `njp.call-<version>.njpx`        le paquet (canonique)
 * - `njp.call-<version>.njpx.minisig` la signature, si une clé est fournie
 * - `catalog-entry.json`              l'entrée de catalogue (empreinte, taille,
 *                                     compatibilité, accès, signature)
 *
 * Signature : `NJP_CALL_SIGNING_KEY_FILE` désigne une clé d'ESSAI, HORS du
 * dépôt (voir `scripts/keygen-test.ts`). Le canal `stable` est refusé avec une
 * clé d'essai : la clé de distribution est une décision externe.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultConfig } from "../core/config";
import { MANDATORY_RULES } from "../core/rules";
import {
  signMinisign,
  verifyMinisign,
  publicKeyText,
  type TestKey,
} from "./minisign";
import {
  buildPackage,
  manifestDefects,
  sha256,
  trustedComment,
  type Manifest,
} from "./package-format";
import { insideGitRepo } from "./paths";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist/package");
const manifest = JSON.parse(
  readFileSync(path.join(root, "extension/manifest.json"), "utf8")
) as Manifest;
const pkgVersion = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8")
).version;

const defects = manifestDefects(manifest);
if (defects.length) throw new Error(`manifeste refusé : ${defects.join(", ")}`);
if (manifest.version !== pkgVersion)
  throw new Error(
    `version du manifeste (${manifest.version}) ≠ package.json (${pkgVersion})`
  );

const json = (v: unknown) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
const bytes = buildPackage(manifest, [
  { path: "manifest.json", bytes: json(manifest) },
  {
    path: "surfaces.json",
    bytes: readFileSync(path.join(root, "extension/surfaces.json")),
  },
  { path: "defaults/config.json", bytes: json(defaultConfig()) },
  {
    path: "rules/mandatory-rules.json",
    bytes: json({ version: 1, rules: MANDATORY_RULES }),
  },
]);
const digest = sha256(bytes);
const channel = process.env.NJP_CALL_CHANNEL ?? "essai";
if (!/^(essai|beta|stable)$/.test(channel)) throw new Error("canal inconnu");

mkdirSync(out, { recursive: true });
const name = `${manifest.id}-${manifest.version}.njpx`;
writeFileSync(path.join(out, name), bytes);

const entry: Record<string, unknown> = {
  id: manifest.id,
  version: manifest.version,
  channel,
  contrat: manifest.contrat,
  hote: manifest.hote,
  permissions: manifest.permissions,
  file: name,
  size: bytes.length,
  sha256: digest,
};

const keyFile = process.env.NJP_CALL_SIGNING_KEY_FILE;
if (keyFile) {
  const abs = path.resolve(keyFile);
  if (insideGitRepo(abs))
    throw new Error("refusé : la clé de signature est dans un dépôt Git");
  const key = JSON.parse(readFileSync(abs, "utf8")) as TestKey;
  const testPub = readFileSync(
    path.join(root, "keys/extensions-essai.pub"),
    "utf8"
  );
  const isTestKey =
    key.usage === "essai" ||
    publicKeyText(key).split("\n")[1] === testPub.trim().split("\n").pop();
  if (channel === "stable" && isTestKey)
    throw new Error(
      "refusé : le canal stable ne peut pas être signé par une clé d'essai"
    );
  const sig = signMinisign(
    key,
    bytes,
    trustedComment(manifest, digest, channel)
  );
  const check = verifyMinisign(publicKeyText(key), bytes, sig);
  if (!check.ok) throw new Error(`signature invérifiable : ${check.reason}`);
  writeFileSync(path.join(out, `${name}.minisig`), sig);
  entry.signature = sig;
  entry.keyId = key.keyId;
}
writeFileSync(
  path.join(out, "catalog-entry.json"),
  `${JSON.stringify(entry, null, 2)}\n`
);
console.log(
  JSON.stringify({
    package: name,
    size: bytes.length,
    sha256: digest,
    channel,
    signed: Boolean(keyFile),
  })
);
if (!existsSync(path.join(out, name))) process.exit(1);
