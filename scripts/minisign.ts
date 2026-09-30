/**
 * Signatures au format minisign (algorithme « ED » : Ed25519 sur l'empreinte
 * BLAKE2b-512 du fichier), produites avec `node:crypto` seul.
 *
 * C'est le format que NJP CARE vérifie déjà pour ses mises à jour
 * (`minisign-verify`, crate `njp-update-guard`) : un paquet d'extension passe
 * par le même mécanisme de signature, pas par un chargeur ad hoc.
 *
 * ```text
 *   clé publique : base64("Ed" ‖ keyId[8] ‖ pk[32])
 *   signature    : base64("ED" ‖ keyId[8] ‖ Ed25519(sk, BLAKE2b-512(fichier)))
 *   commentaire de confiance, signé : base64(Ed25519(sk, signature ‖ commentaire))
 * ```
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

const b64 = (b: Buffer) => b.toString("base64");
const blake = (data: Buffer) => createHash("blake2b512").update(data).digest();

export interface TestKey {
  /** Toujours « essai » : cette clé ne signe jamais le canal stable. */
  usage: "essai";
  keyId: string; // hex, 8 octets
  pkcs8: string; // base64
}

export const generateTestKey = (): TestKey => {
  const { privateKey } = generateKeyPairSync("ed25519");
  return {
    usage: "essai",
    keyId: randomBytes(8).toString("hex"),
    pkcs8: b64(privateKey.export({ type: "pkcs8", format: "der" }) as Buffer),
  };
};

const privateOf = (k: TestKey): KeyObject =>
  createPrivateKey({
    key: Buffer.from(k.pkcs8, "base64"),
    format: "der",
    type: "pkcs8",
  });

/** Les 32 octets bruts de la clé publique Ed25519. */
const rawPublic = (k: TestKey): Buffer => {
  const der = createPublicKey(privateOf(k)).export({
    type: "spki",
    format: "der",
  }) as Buffer;
  return der.subarray(der.length - 32);
};

export const publicKeyText = (
  k: TestKey,
  comment = "NJP CALL — clé d'ESSAI des paquets d'extension"
) =>
  `untrusted comment: ${comment}\n${b64(Buffer.concat([Buffer.from("Ed"), Buffer.from(k.keyId, "hex"), rawPublic(k)]))}\n`;

export const signMinisign = (
  k: TestKey,
  data: Buffer,
  trustedComment: string
): string => {
  if (/[\r\n]/.test(trustedComment))
    throw new Error("commentaire de confiance sur une ligne");
  const sk = privateOf(k);
  const sig = sign(null, blake(data), sk);
  const global = sign(
    null,
    Buffer.concat([sig, Buffer.from(trustedComment, "utf8")]),
    sk
  );
  return [
    "untrusted comment: signature NJP CALL",
    b64(Buffer.concat([Buffer.from("ED"), Buffer.from(k.keyId, "hex"), sig])),
    `trusted comment: ${trustedComment}`,
    b64(global),
    "",
  ].join("\n");
};

export interface MinisignCheck {
  ok: boolean;
  reason?: string;
  keyId?: string;
  trustedComment?: string;
}

/** Vérification complète : identifiant de clé, signature du fichier, signature du commentaire. */
export const verifyMinisign = (
  publicText: string,
  data: Buffer,
  signatureText: string
): MinisignCheck => {
  const pubLine = publicText.trim().split("\n").pop()!;
  const pub = Buffer.from(pubLine, "base64");
  if (pub.length !== 42 || pub.subarray(0, 2).toString() !== "Ed")
    return { ok: false, reason: "public_key_malformed" };
  const lines = signatureText.split("\n");
  if (lines.length < 4 || !lines[2].startsWith("trusted comment: "))
    return { ok: false, reason: "signature_malformed" };
  const sigBlock = Buffer.from(lines[1], "base64");
  if (sigBlock.length !== 74)
    return { ok: false, reason: "signature_malformed" };
  const alg = sigBlock.subarray(0, 2).toString();
  const keyId = sigBlock.subarray(2, 10);
  const sig = sigBlock.subarray(10);
  if (!keyId.equals(pub.subarray(2, 10)))
    return {
      ok: false,
      reason: "key_id_mismatch",
      keyId: keyId.toString("hex"),
    };
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      pub.subarray(10),
    ]),
    format: "der",
    type: "spki",
  });
  const signed = alg === "ED" ? blake(data) : alg === "Ed" ? data : null;
  if (!signed) return { ok: false, reason: "algorithm_unknown" };
  if (!verify(null, signed, key, sig))
    return { ok: false, reason: "signature_mismatch" };
  const trusted = lines[2].slice("trusted comment: ".length);
  if (
    !verify(
      null,
      Buffer.concat([sig, Buffer.from(trusted, "utf8")]),
      key,
      Buffer.from(lines[3], "base64")
    )
  ) {
    return { ok: false, reason: "trusted_comment_mismatch" };
  }
  return { ok: true, keyId: keyId.toString("hex"), trustedComment: trusted };
};
