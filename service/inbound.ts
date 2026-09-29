/**
 * NJP CALL — l'entrée téléphonique, indépendante du fournisseur.
 *
 * Un fournisseur réel (non choisi, voir docs/TELEPHONIE.md) devra fournir un
 * adaptateur qui satisfait `TelephonyInbound` ET passe le banc de contrat
 * `tests/provider-contract.test.ts` : signature vérifiée, horodatage borné,
 * événements rejouables sans effet de bord, format inconnu refusé, réponse
 * rendue dans le format du fournisseur.
 *
 * Trois environnements, jamais confondus :
 *
 * | Environnement | Adaptateur | Où |
 * |---|---|---|
 * | simulateur | `SimulatorInbound` | bancs et recette (`NJP_CALL_MODE=recette`) |
 * | bac à sable du fournisseur | adaptateur du fournisseur, compte d'essai | à brancher après choix |
 * | exploitation réelle | adaptateur du fournisseur, compte contractuel | refusé tant qu'aucun adaptateur n'existe |
 */
import type { SessionOutput, TelephonyEvent } from "../core/session";
import { verifyWebhook } from "./security";

export class InboundError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

export interface InboundCall {
  callId: string;
  /** Numéro appelé (E.164) : il désigne le cabinet côté service. */
  to: string;
  event: TelephonyEvent;
}

export interface TelephonyInbound {
  readonly name: string;
  readonly environment: "simulator" | "provider_sandbox" | "production";
  /** Authentifie la requête (signature, horodatage). Faux ⇒ 401, sans détail. */
  verify(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    nowS: number
  ): boolean;
  /** Traduit le corps en événement neutre ; tout format inconnu lève `InboundError(400)`. */
  parse(body: string): InboundCall;
  /** Traduit la sortie de session dans le format attendu par le fournisseur. */
  render(out: SessionOutput): { status: number; body: unknown };
}

const REF = /^[A-Za-z0-9_-]{3,64}$/;

/** Le simulateur : HMAC horodaté, JSON minimal. N'appelle personne. */
export class SimulatorInbound implements TelephonyInbound {
  readonly name = "simulateur";
  readonly environment = "simulator" as const;
  constructor(private readonly secret: string) {}

  verify(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    nowS: number
  ) {
    const h = headers["x-njp-signature"];
    return verifyWebhook(
      this.secret,
      typeof h === "string" ? h : undefined,
      body,
      nowS
    );
  }

  parse(body: string): InboundCall {
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new InboundError(400, "invalid_json");
    }
    const o = raw as Record<string, unknown>;
    const e = (o?.event ?? {}) as Record<string, unknown>;
    if (
      typeof o?.callId !== "string" ||
      !REF.test(o.callId) ||
      typeof o.to !== "string" ||
      typeof e.id !== "string" ||
      !REF.test(e.id) ||
      typeof e.at !== "string" ||
      Number.isNaN(Date.parse(e.at))
    ) {
      throw new InboundError(400, "invalid_event");
    }
    const base = { id: e.id, at: e.at };
    const call = (event: TelephonyEvent): InboundCall => ({
      callId: o.callId as string,
      to: o.to as string,
      event,
    });
    switch (e.type) {
      case "call.started":
        return call({ ...base, type: "call.started", open: e.open === true });
      case "caller.utterance":
        if (typeof e.text !== "string" || e.text.length > 2000)
          throw new InboundError(400, "invalid_event");
        return call({
          ...base,
          type: "caller.utterance",
          text: e.text,
          bargeIn: e.bargeIn === true,
        });
      case "caller.dtmf":
        if (typeof e.digits !== "string" || !/^[0-9*#]{1,20}$/.test(e.digits))
          throw new InboundError(400, "invalid_event");
        return call({ ...base, type: "caller.dtmf", digits: e.digits });
      case "caller.silence":
        return call({
          ...base,
          type: "caller.silence",
          ms: Math.max(0, Math.min(Number(e.ms) || 0, 600_000)),
        });
      case "transfer.result":
        return call({
          ...base,
          type: "transfer.result",
          connected: e.connected === true,
        });
      case "call.ended":
        return call({ ...base, type: "call.ended", reason: "hangup" });
      default:
        throw new InboundError(400, "invalid_event");
    }
  }

  render(out: SessionOutput) {
    return {
      status: 200,
      body: {
        actions: [
          ...out.say.map(text => ({ say: text })),
          ...(out.transferTo ? [{ transfer: out.transferTo }] : []),
          ...(out.hangup ? [{ hangup: true }] : []),
        ],
        duplicate: out.duplicate === true,
      },
    };
  }
}
