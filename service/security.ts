/**
 * NJP CALL — service : authentification, limites, journaux.
 *
 * - Webhooks téléphoniques : HMAC-SHA256 sur `horodatage.corps`, fenêtre de
 *   5 minutes, comparaison à temps constant.
 * - Postes NJP CARE : jeton porteur par poste ; le service ne garde que son
 *   **empreinte** SHA-256, associée à UN cabinet. Le cabinet d'une requête
 *   vient du jeton, jamais d'un paramètre.
 * - Limites : taille de corps, fréquence par clé, délai d'attente.
 * - Journaux : identifiants et statuts ; numéros, noms et textes expurgés.
 * - Sorties : HTTPS uniquement, hôtes en liste blanche (protection SSRF).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MAX_BODY_BYTES = 32 * 1024;
export const WEBHOOK_TOLERANCE_S = 300;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const signWebhook = (secret: string, timestamp: number, body: string) =>
  `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

export const verifyWebhook = (
  secret: string,
  header: string | undefined,
  body: string,
  nowS: number
): boolean => {
  if (!secret || !header) return false;
  const m = header.match(/^t=(\d{9,11}),v1=([0-9a-f]{64})$/);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowS - t) > WEBHOOK_TOLERANCE_S) return false;
  return safeEqual(signWebhook(secret, t, body), header);
};

export const tokenHash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** `cabinetId=sha256hex;cabinetId2=…` — jamais le jeton lui-même. */
export const parseDeviceTokens = (
  spec: string | undefined
): Map<string, string> => {
  const byHash = new Map<string, string>();
  for (const part of (spec ?? "")
    .split(";")
    .map(s => s.trim())
    .filter(Boolean)) {
    const [cabinet, hash] = part.split("=");
    if (
      /^[A-Za-z0-9_-]{3,64}$/.test(cabinet ?? "") &&
      /^[0-9a-f]{64}$/.test(hash ?? "")
    )
      byHash.set(hash, cabinet);
  }
  return byHash;
};

export const cabinetForBearer = (
  header: string | undefined,
  byHash: Map<string, string>
): string | null => {
  const m = header?.match(/^Bearer ([A-Za-z0-9._~-]{32,256})$/);
  if (!m) return null;
  const h = tokenHash(m[1]);
  for (const [known, cabinet] of byHash)
    if (safeEqual(known, h)) return cabinet;
  return null;
};

/**
 * Authentifie un poste : empreinte connue ET non révoquée. Rend aussi
 * l'empreinte (pour une révocation), jamais le jeton.
 */
export const authenticateBearer = (
  header: string | undefined,
  byHash: Map<string, string>,
  isRevoked: (hash: string) => boolean
): { cabinetId: string; tokenHash: string } | null => {
  const m = header?.match(/^Bearer ([A-Za-z0-9._~-]{32,256})$/);
  if (!m) return null;
  const h = tokenHash(m[1]);
  let cabinetId: string | null = null;
  for (const [known, cabinet] of byHash)
    if (safeEqual(known, h)) cabinetId = cabinet;
  if (!cabinetId || isRevoked(h)) return null;
  return { cabinetId, tokenHash: h };
};

/** Seau à jetons simple, par clé. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly capacity: number,
    private readonly perMs: number
  ) {}
  /** Reste-t-il de la réserve, sans rien consommer ? */
  peek(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key);
    if (!b) return true;
    return (
      Math.min(
        this.capacity,
        b.tokens + ((now - b.at) / this.perMs) * this.capacity
      ) >= 1
    );
  }
  allow(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(
      this.capacity,
      b.tokens + ((now - b.at) / this.perMs) * this.capacity
    );
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
}

/** Expurge ce qui ressemble à une donnée personnelle avant d'écrire un journal. */
export const redact = (s: string) =>
  s
    .replace(/\+?\d[\d .-]{7,}\d/g, "[numéro]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[courriel]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/g, "$1[jeton]")
    .replace(/(v1=)[0-9a-f]{64}/g, "$1[signature]");

export interface LogLine {
  at: string;
  event: string;
  cabinetId?: string;
  callId?: string;
  type?: string;
  status?: string;
  reason?: string;
}

/** Seuls des champs nommés et courts sortent ; aucun texte d'appelant. */
export const makeLogger = (sink: (line: string) => void) => (l: LogLine) =>
  sink(
    redact(
      JSON.stringify({
        at: l.at,
        event: l.event.slice(0, 60),
        ...(l.cabinetId ? { cabinetId: l.cabinetId.slice(0, 64) } : {}),
        ...(l.callId ? { callId: l.callId.slice(0, 64) } : {}),
        ...(l.type ? { type: l.type.slice(0, 40) } : {}),
        ...(l.status ? { status: l.status.slice(0, 20) } : {}),
        ...(l.reason ? { reason: l.reason.slice(0, 60) } : {}),
      })
    )
  );

/** Protection SSRF : HTTPS, hôte en liste blanche, pas d'adresse littérale ni de port exotique. */
export const allowedOutbound = (raw: string, allowHosts: string[]): boolean => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  if (
    /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ||
    u.hostname.includes(":") ||
    u.hostname === "localhost"
  )
    return false;
  return allowHosts
    .map(h => h.toLowerCase())
    .includes(u.hostname.toLowerCase());
};
