/**
 * Vérifie un paquet construit : format, empreintes internes, manifeste,
 * empreinte déclarée au catalogue, et signature si présente (clé publique
 * d'essai versionnée dans `keys/`). Échoue bruyamment.
 *
 *   pnpm package:verify [dossier]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { verifyMinisign } from "./minisign";
import {
  ALLOWED_FILE,
  canonical,
  manifestDefects,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  sha256,
  trustedComment,
  type Manifest,
  type PackageFile,
} from "./package-format";

export const verifyPackageBytes = (
  bytes: Buffer,
  entry: Record<string, unknown>,
  publicKey?: string
): string[] => {
  const defects: string[] = [];
  let pkg: {
    format: string;
    formatVersion: number;
    manifest: Manifest;
    files: PackageFile[];
  };
  try {
    pkg = JSON.parse(bytes.toString("utf8"));
  } catch {
    return ["json"];
  }
  if (`${canonical(pkg)}\n` !== bytes.toString("utf8"))
    defects.push("non_canonique");
  if (
    pkg.format !== PACKAGE_FORMAT ||
    pkg.formatVersion !== PACKAGE_FORMAT_VERSION
  )
    defects.push("format");
  defects.push(...manifestDefects(pkg.manifest).map(d => `manifeste:${d}`));
  for (const f of pkg.files ?? []) {
    const content = Buffer.from(f.content, "base64");
    if (!ALLOWED_FILE.test(f.path)) defects.push(`fichier:${f.path}`);
    if (content.length !== f.size || sha256(content) !== f.sha256)
      defects.push(`empreinte:${f.path}`);
  }
  const embedded = pkg.files?.find(f => f.path === "manifest.json");
  if (
    !embedded ||
    canonical(
      JSON.parse(Buffer.from(embedded.content, "base64").toString())
    ) !== canonical(pkg.manifest)
  )
    defects.push("manifeste:incoherent");
  const digest = sha256(bytes);
  if (entry.sha256 !== digest) defects.push("catalogue:empreinte");
  if (entry.size !== bytes.length) defects.push("catalogue:taille");
  if (entry.id !== pkg.manifest.id || entry.version !== pkg.manifest.version)
    defects.push("catalogue:identite");
  if (typeof entry.signature === "string") {
    if (!publicKey) defects.push("signature:cle_absente");
    else {
      const check = verifyMinisign(publicKey, bytes, entry.signature);
      if (!check.ok) defects.push(`signature:${check.reason}`);
      else if (
        check.trustedComment !==
        trustedComment(pkg.manifest, digest, String(entry.channel))
      )
        defects.push("signature:commentaire");
    }
  }
  return defects;
};

if (process.argv[1]?.endsWith("verify-package.ts")) {
  const root = path.resolve(import.meta.dirname, "..");
  const dir = path.resolve(process.argv[2] ?? path.join(root, "dist/package"));
  const entry = JSON.parse(
    readFileSync(path.join(dir, "catalog-entry.json"), "utf8")
  );
  const bytes = readFileSync(path.join(dir, entry.file));
  const pub = path.join(root, "keys/extensions-essai.pub");
  const defects = verifyPackageBytes(
    bytes,
    entry,
    existsSync(pub) ? readFileSync(pub, "utf8") : undefined
  );
  if (defects.length) {
    console.error(`paquet refusé : ${defects.join(", ")}`);
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      verified: entry.file,
      sha256: entry.sha256,
      signed: typeof entry.signature === "string",
    })
  );
}
