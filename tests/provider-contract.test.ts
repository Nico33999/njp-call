/**
 * Bancs de CONTRAT, indépendants du fournisseur.
 *
 * Aucun fournisseur réel n'est branché. Ces suites fixent ce qu'un
 * adaptateur réel devra prouver avant d'être utilisé, d'abord dans le bac à
 * sable du fournisseur, jamais directement en exploitation. Elles tournent
 * ici contre les simulateurs, qui servent d'étalon.
 */
import { describe, expect, it } from "vitest";
import {
  ReminderNotSent,
  ReminderOutcomeUnknown,
  type Reminder,
  type ReminderChannel,
} from "../core/reminders";
import type { SessionOutput } from "../core/session";
import { SimulatedReminderChannel } from "../core/testing/simulatedReminderChannel";
import {
  InboundError,
  SimulatorInbound,
  type TelephonyInbound,
} from "../service/inbound";
import { llmApprovalFingerprint, llmGateFromEnv } from "../service/llm";
import { signWebhook } from "../service/security";

const NOW_S = Math.floor(Date.parse("2026-09-29T08:00:00Z") / 1000);

// ---------------------------------------------------------------------------
// Téléphonie entrante
// ---------------------------------------------------------------------------

interface InboundHarness {
  name: string;
  make: () => TelephonyInbound;
  /** En-têtes d'une requête correctement signée par le fournisseur. */
  signed: (body: string, ts: number) => Record<string, string>;
  /** Corps natif du fournisseur pour un événement neutre. */
  body: (callId: string, event: Record<string, unknown>) => string;
}

const telephonyInboundContract = (h: InboundHarness) =>
  describe(`contrat téléphonie entrante — ${h.name}`, () => {
    const inbound = h.make();
    const at = "2026-09-29T08:00:00Z";
    const valid = h.body("call_contract", {
      id: "ev_0001",
      at,
      type: "call.started",
      open: true,
    });

    it("déclare son environnement ; un simulateur ne se présente jamais comme exploitation", () => {
      expect(["simulator", "provider_sandbox", "production"]).toContain(
        inbound.environment
      );
      if (inbound.name === "simulateur")
        expect(inbound.environment).toBe("simulator");
    });

    it("authentifie : signature valide acceptée ; absente, fausse, altérée ou périmée refusée", () => {
      expect(inbound.verify(h.signed(valid, NOW_S), valid, NOW_S)).toBe(true);
      expect(inbound.verify({}, valid, NOW_S)).toBe(false);
      expect(
        inbound.verify(
          h.signed(valid, NOW_S),
          valid.replace("call_contract", "call_autre"),
          NOW_S
        )
      ).toBe(false);
      expect(inbound.verify(h.signed(valid, NOW_S - 3600), valid, NOW_S)).toBe(
        false
      );
      expect(inbound.verify(h.signed(valid, NOW_S + 3600), valid, NOW_S)).toBe(
        false
      );
    });

    it("traduit chaque événement neutre, et rien d'autre", () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ type: "call.started", open: false }, "call.started"],
        [{ type: "caller.utterance", text: "bonjour" }, "caller.utterance"],
        [{ type: "caller.dtmf", digits: "0" }, "caller.dtmf"],
        [{ type: "caller.silence", ms: 4000 }, "caller.silence"],
        [{ type: "transfer.result", connected: false }, "transfer.result"],
        [{ type: "call.ended" }, "call.ended"],
      ];
      for (const [e, type] of cases) {
        const parsed = inbound.parse(
          h.body("call_contract", { id: "ev_0002", at, ...e })
        );
        expect(parsed.event.type).toBe(type);
        expect(parsed.event.id).toBe("ev_0002");
        expect(parsed.callId).toBe("call_contract");
      }
    });

    it("refuse le format inconnu, l'identifiant invalide, le texte démesuré, le JSON cassé", () => {
      const bad = [
        h.body("call_contract", { id: "ev_0003", at, type: "send_email" }),
        h.body("x", { id: "ev_0003", at, type: "call.started" }),
        h.body("call_contract", { id: "../../etc", at, type: "call.started" }),
        h.body("call_contract", {
          id: "ev_0003",
          at,
          type: "caller.utterance",
          text: "x".repeat(5000),
        }),
        h.body("call_contract", {
          id: "ev_0003",
          at,
          type: "caller.dtmf",
          digits: "12; DROP",
        }),
        h.body("call_contract", {
          id: "ev_0003",
          at: "hier",
          type: "call.started",
        }),
        "{pas du json",
      ];
      for (const b of bad)
        expect(() => inbound.parse(b), b.slice(0, 60)).toThrow(InboundError);
    });

    it("rend la sortie de session dans son format : dire, transférer, raccrocher, doublon signalé", () => {
      const out: SessionOutput = {
        say: ["Bonjour."],
        transferTo: "dest_accueil",
        hangup: true,
        duplicate: true,
      };
      const r = inbound.render(out);
      expect(r.status).toBe(200);
      const s = JSON.stringify(r.body);
      expect(s).toContain("Bonjour.");
      expect(s).toContain("dest_accueil");
      expect(s).toContain("hangup");
      expect(s).toContain("duplicate");
    });
  });

const SECRET = "whsec_" + "k".repeat(40); // factice
telephonyInboundContract({
  name: "simulateur",
  make: () => new SimulatorInbound(SECRET),
  signed: (body, ts) => ({ "x-njp-signature": signWebhook(SECRET, ts, body) }),
  body: (callId, event) =>
    JSON.stringify({ callId, to: "+33100000001", event }),
});

// ---------------------------------------------------------------------------
// Rappels (SMS / voix)
// ---------------------------------------------------------------------------

const reminder = (): Reminder => ({
  id: "appt_0001:v1:sms",
  appointmentRef: "appt_0001",
  appointmentVersion: 1,
  appointmentStart: "2026-10-08T10:00:00+02:00",
  phone: "+33600000001",
  channel: "sms",
  dueAt: "2026-10-07T08:00:00Z",
  status: "sending",
  attempts: 1,
  history: [],
});

const reminderChannelContract = (
  name: string,
  make: () => ReminderChannel & { next?: "ok" | "down" | "lost" }
) =>
  describe(`contrat canal de rappels — ${name}`, () => {
    it("« accepté » rend une référence de prestataire ; même clé ⇒ même référence (pas de double envoi)", async () => {
      const c = make();
      const a = await c.send(
        reminder(),
        "Rappel : rendez-vous demain à 10 h.",
        "appt_0001:v1:sms#1"
      );
      const b = await c.send(
        reminder(),
        "Rappel : rendez-vous demain à 10 h.",
        "appt_0001:v1:sms#1"
      );
      expect(a.providerRef).toMatch(/^[A-Za-z0-9_-]{3,128}$/);
      expect(b.providerRef).toBe(a.providerRef);
    });

    it("indisponible ⇒ ReminderNotSent (nouvel essai permis) ; délai après envoi ⇒ ReminderOutcomeUnknown", async () => {
      const c = make();
      c.next = "down";
      await expect(c.send(reminder(), "x", "k#1")).rejects.toBeInstanceOf(
        ReminderNotSent
      );
      c.next = "lost";
      await expect(c.send(reminder(), "x", "k#2")).rejects.toBeInstanceOf(
        ReminderOutcomeUnknown
      );
    });

    it("refuse un texte vide ou démesuré sans rien envoyer", async () => {
      const c = make();
      await expect(c.send(reminder(), "", "k#3")).rejects.toBeInstanceOf(
        ReminderNotSent
      );
      await expect(
        c.send(reminder(), "x".repeat(1000), "k#4")
      ).rejects.toBeInstanceOf(ReminderNotSent);
    });
  });

reminderChannelContract("simulateur", () => new SimulatedReminderChannel());

// ---------------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------------

describe("contrat IA — désactivée sans configuration approuvée", () => {
  const base = {
    NJP_CALL_LLM_ENDPOINT: "https://llm.example.eu/v1/chat/completions",
    NJP_CALL_LLM_API_KEY: "cle_factice",
    NJP_CALL_LLM_MODEL: "modele-x",
    NJP_CALL_LLM_ALLOWED_HOSTS: "llm.example.eu",
  };
  it("absente ⇒ repli ; présente sans approbation ⇒ désactivée ; empreinte exacte ⇒ activée", () => {
    expect(llmGateFromEnv({}).state).toBe("absent");
    const g = llmGateFromEnv(base);
    expect(g.state).toBe("not_approved");
    const fp = (g as { fingerprint: string }).fingerprint;
    expect(
      llmGateFromEnv({
        ...base,
        NJP_CALL_LLM_APPROVED_FINGERPRINT: "0".repeat(64),
      }).state
    ).toBe("not_approved");
    expect(
      llmGateFromEnv({ ...base, NJP_CALL_LLM_APPROVED_FINGERPRINT: fp }).state
    ).toBe("approved");
  });
  it("l'approbation couvre hôte, modèle, liste blanche — pas la clé (qui peut tourner)", () => {
    const s = {
      endpoint: base.NJP_CALL_LLM_ENDPOINT,
      model: base.NJP_CALL_LLM_MODEL,
      allowHosts: ["llm.example.eu"],
    };
    const fp = llmApprovalFingerprint(s);
    expect(
      llmGateFromEnv({
        ...base,
        NJP_CALL_LLM_API_KEY: "autre",
        NJP_CALL_LLM_APPROVED_FINGERPRINT: fp,
      }).state
    ).toBe("approved");
    expect(
      llmGateFromEnv({
        ...base,
        NJP_CALL_LLM_MODEL: "autre-modele",
        NJP_CALL_LLM_APPROVED_FINGERPRINT: fp,
      }).state
    ).toBe("not_approved");
    expect(
      llmGateFromEnv({
        ...base,
        NJP_CALL_LLM_ALLOWED_HOSTS: "llm.example.eu,evil.example",
        NJP_CALL_LLM_APPROVED_FINGERPRINT: fp,
      }).state
    ).toBe("not_approved");
  });
});
