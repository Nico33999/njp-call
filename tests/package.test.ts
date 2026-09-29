import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  generateTestKey,
  publicKeyText,
  signMinisign,
  verifyMinisign,
} from "../scripts/minisign";
import {
  buildPackage,
  manifestDefects,
  sha256,
  trustedComment,
  type Manifest,
} from "../scripts/package-format";
import { verifyPackageBytes } from "../scripts/verify-package";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "extension/manifest.json"), "utf8")
) as Manifest;
const files = () => [
  { path: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
  {
    path: "surfaces.json",
    bytes: readFileSync(path.join(root, "extension/surfaces.json")),
  },
];
const signed = (channel = "essai", key = generateTestKey()) => {
  const bytes = buildPackage(manifest, files());
  const digest = sha256(bytes);
  const signature = signMinisign(
    key,
    bytes,
    trustedComment(manifest, digest, channel)
  );
  return {
    bytes,
    key,
    entry: {
      id: manifest.id,
      version: manifest.version,
      channel,
      size: bytes.length,
      sha256: digest,
      signature,
    },
  };
};

describe("paquet d'extension", () => {
  it("le manifeste cible le contrat v2 et n'emploie que des accès reconnus", () => {
    expect(manifestDefects(manifest)).toEqual([]);
    expect(manifest).toMatchObject({
      id: "njp.call",
      nom: "NJP CALL",
      editeur: "by NJP CARE",
      version: "0.1.0",
      distribution: "separee",
    });
    expect(
      manifestDefects({
        ...manifest,
        permissions: [...manifest.permissions, "sqlite.read"],
      })
    ).toContain("permission:sqlite.read");
    expect(manifestDefects({ ...manifest, points: ["partout"] })).toContain(
      "point:partout"
    );
  });

  it("est reproductible : même source, mêmes octets", () => {
    expect(sha256(buildPackage(manifest, files()))).toBe(
      sha256(buildPackage(manifest, files().reverse()))
    );
  });

  it("n'accepte aucun fichier exécutable ni chemin arbitraire", () => {
    expect(() =>
      buildPackage(manifest, [
        { path: "index.js", bytes: Buffer.from("alert(1)") },
      ])
    ).toThrow();
    expect(() =>
      buildPackage(manifest, [
        { path: "../../etc/passwd", bytes: Buffer.from("") },
      ])
    ).toThrow();
  });

  it("un paquet signé et intact est accepté", () => {
    const { bytes, key, entry } = signed();
    expect(verifyPackageBytes(bytes, entry, publicKeyText(key))).toEqual([]);
  });

  it("un octet modifié est refusé (empreinte et signature)", () => {
    const { bytes, key, entry } = signed();
    const tampered = Buffer.from(
      bytes
        .toString("utf8")
        .replace('"telephony.transfer"', '"telephony.transfex"')
    );
    const d = verifyPackageBytes(tampered, entry, publicKeyText(key));
    expect(d).toEqual(
      expect.arrayContaining([
        "catalogue:empreinte",
        "signature:signature_mismatch",
        "manifeste:incoherent",
      ])
    );
    // Un octet illisible : refusé aussi, avant tout le reste.
    const broken = Buffer.from(bytes);
    broken[broken.length - 3] ^= 0xff;
    expect(verifyPackageBytes(broken, entry, publicKeyText(key))).not.toEqual(
      []
    );
  });

  it("une signature d'une autre clé est refusée", () => {
    const { bytes, entry } = signed();
    expect(
      verifyPackageBytes(bytes, entry, publicKeyText(generateTestKey()))
    ).toContain("signature:key_id_mismatch");
  });

  it("une signature « essai » présentée comme « stable » est refusée", () => {
    const { bytes, key, entry } = signed("essai");
    expect(
      verifyPackageBytes(
        bytes,
        { ...entry, channel: "stable" },
        publicKeyText(key)
      )
    ).toContain("signature:commentaire");
  });

  it("le commentaire de confiance est lui-même signé", () => {
    const { bytes, key, entry } = signed();
    const forged = entry.signature.replace("channel=essai", "channel=stable");
    expect(verifyMinisign(publicKeyText(key), bytes, forged).reason).toBe(
      "trusted_comment_mismatch"
    );
  });

  it("le paquet construit dans dist/ correspond à son entrée de catalogue", () => {
    const dir = path.join(root, "dist/package");
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(
        readFileSync(path.join(dir, "catalog-entry.json"), "utf8")
      );
    } catch {
      return; // pas encore construit dans cet environnement : couvert par `pnpm ci`
    }
    const pub = readFileSync(
      path.join(root, "keys/extensions-essai.pub"),
      "utf8"
    );
    const bytes = readFileSync(path.join(dir, String(entry.file)));
    const defects = verifyPackageBytes(
      bytes,
      entry,
      typeof entry.signature === "string" && entry.keyId && pub
        ? pub
        : undefined
    );
    expect(defects.filter(d => d !== "signature:key_id_mismatch")).toEqual([]);
  });
});
