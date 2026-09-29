/**
 * Le format du paquet d'extension NJP CARE (`.njpx`), version 1.
 *
 * Un paquet est **déclaratif** : un manifeste, des déclarations de surfaces,
 * des réglages par défaut, des règles publiées. Il ne contient aucun code
 * exécutable : NJP CARE ne charge pas de JavaScript distant. Les surfaces
 * déclarées sont rendues par le code de l'hôte, activé seulement quand un
 * paquet authentique, compatible et autorisé est installé.
 *
 * ```json
 * {
 *   "format": "njp-extension-package",
 *   "formatVersion": 1,
 *   "manifest": { … },
 *   "files": [ { "path": "…", "size": n, "sha256": "…", "content": "<base64>" } ]
 * }
 * ```
 *
 * Sérialisation canonique : clés triées, aucun espace, fichiers triés par
 * chemin, un saut de ligne final. Même source ⇒ mêmes octets ⇒ même empreinte.
 */
import { createHash } from "node:crypto";

export const PACKAGE_FORMAT = "njp-extension-package";
export const PACKAGE_FORMAT_VERSION = 1;
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_FILE =
  /^(manifest\.json|surfaces\.json|defaults\/[a-z0-9-]+\.json|rules\/[a-z0-9-]+\.json)$/;

/** Les accès du contrat NJP CARE v2 — miroir de `KNOWN_PERMISSIONS` (Rust). */
export const CONTRACT_V2_PERMISSIONS = [
  "patient.basic.read",
  "patient.exercise.write",
  "planning.read",
  "documents.create",
  "billing.read",
  "planning.availability.read",
  "appointments.requests.create",
  "appointments.book",
  "appointments.reschedule",
  "appointments.cancel",
  "secretariat.messages.create",
  "secretariat.messages.read",
  "secretariat.messages.update",
  "secretariat.callbacks.create",
  "secretariat.callbacks.update",
  "secretariat.calls.write",
  "notifications.create",
  "telephony.transfer",
  "telephony.answer",
] as const;

export const CONTRACT_V2_POINTS = [
  "shell.today",
  "shell.sidebar",
  "shell.secretariat",
  "patient.tabs",
  "planning.actions",
  "billing.panels",
] as const;

export const sha256 = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");

/** JSON canonique : clés triées récursivement. */
export const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map(
        k =>
          `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(v);
};

export interface PackageFile {
  path: string;
  size: number;
  sha256: string;
  content: string;
}

export interface Manifest {
  contrat: number;
  id: string;
  nom: string;
  editeur: string;
  version: string;
  resume: string;
  hote: { protocoleMin: number; protocoleMax: number };
  permissions: string[];
  points: string[];
  distribution: "embarquee" | "separee";
  clinique: boolean;
}

export const manifestDefects = (m: Manifest): string[] => {
  const d: string[] = [];
  if (m.contrat !== 2) d.push("contrat");
  if (!/^[a-z][a-z0-9.-]{2,63}$/.test(m.id)) d.push("id");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(m.version))
    d.push("version");
  if (m.distribution !== "separee") d.push("distribution");
  if (!(m.hote?.protocoleMin >= 1) || m.hote.protocoleMax < m.hote.protocoleMin)
    d.push("hote");
  for (const p of m.permissions)
    if (!(CONTRACT_V2_PERMISSIONS as readonly string[]).includes(p))
      d.push(`permission:${p}`);
  for (const p of m.points)
    if (!(CONTRACT_V2_POINTS as readonly string[]).includes(p))
      d.push(`point:${p}`);
  if (new Set(m.permissions).size !== m.permissions.length)
    d.push("permissions:doublon");
  return d;
};

export const buildPackage = (
  manifest: Manifest,
  files: { path: string; bytes: Buffer }[]
): Buffer => {
  const entries: PackageFile[] = files
    .map(f => {
      if (!ALLOWED_FILE.test(f.path))
        throw new Error(`fichier non autorisé dans un paquet : ${f.path}`);
      return {
        path: f.path,
        size: f.bytes.length,
        sha256: sha256(f.bytes),
        content: f.bytes.toString("base64"),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const out = Buffer.from(
    `${canonical({ format: PACKAGE_FORMAT, formatVersion: PACKAGE_FORMAT_VERSION, manifest, files: entries })}\n`,
    "utf8"
  );
  if (out.length > MAX_PACKAGE_BYTES) throw new Error("paquet trop volumineux");
  return out;
};

/** Le commentaire de confiance lie la signature à l'identité et à l'empreinte du paquet. */
export const trustedComment = (m: Manifest, digest: string, channel: string) =>
  `njp-extension id=${m.id} version=${m.version} sha256=${digest} channel=${channel} contrat=${m.contrat}`;
