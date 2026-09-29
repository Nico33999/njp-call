import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { sanitizeConfig } from "../core/config";
import type { SlotChoice } from "../core/commands";
import { FakeCare } from "../core/testing/fakeCare";
import { initialState } from "../core/conversation";
import { buildMessages, LlmUnderstander } from "../service/llm";
import {
  allowedOutbound,
  makeLogger,
  parseDeviceTokens,
  redact,
  signWebhook,
  tokenHash,
  verifyWebhook,
} from "../service/security";
import { createService } from "../service/server";

const SECRET = "whsec_" + "t".repeat(40); // secret de test, factice
const TOKEN_A = "tok_A_" + "a".repeat(40);
const TOKEN_B = "tok_B_" + "b".repeat(40);
const NOW = Date.parse("2026-09-29T08:00:00Z");
const SLOTS: SlotChoice[] = [
  {
    slotRef: "slot_001",
    start: "2026-10-01T14:00:00+02:00",
    end: "2026-10-01T14:30:00+02:00",
    practitionerRef: "prac_a",
  },
];

const servers: { close: () => void }[] = [];
afterEach(() => servers.splice(0).forEach(s => s.close()));

const start = async () => {
  const lines: string[] = [];
  const svc = createService({
    webhookSecret: SECRET,
    deviceTokens: parseDeviceTokens(
      `cab_a=${tokenHash(TOKEN_A)};cab_b=${tokenHash(TOKEN_B)}`
    ),
    numberRoutes: new Map([
      ["+33100000001", "cab_a"],
      ["+33100000002", "cab_b"],
    ]),
    configs: new Map([
      ["cab_a", sanitizeConfig({ cabinetName: "Cabinet A" })],
      ["cab_b", sanitizeConfig({ cabinetName: "Cabinet B" })],
    ]),
    log: makeLogger(l => lines.push(l)),
    now: () => NOW,
    maxWaitMs: 2000,
  });
  await new Promise<void>(r => svc.server.listen(0, "127.0.0.1", r));
  servers.push(svc.server);
  const base = `http://127.0.0.1:${(svc.server.address() as AddressInfo).port}`;
  let ev = 0;
  const webhook = async (
    callId: string,
    event: Record<string, unknown>,
    opts: { to?: string; sig?: string; ts?: number } = {}
  ) => {
    const body = JSON.stringify({
      callId,
      to: opts.to ?? "+33100000001",
      event: {
        id: event.id ?? `${callId}-e${++ev}`,
        at: new Date(NOW).toISOString(),
        ...event,
      },
    });
    const res = await fetch(`${base}/v1/telephony/sim/webhook`, {
      method: "POST",
      headers: {
        "x-njp-signature":
          opts.sig ??
          signWebhook(SECRET, opts.ts ?? Math.floor(NOW / 1000), body),
        "content-type": "application/json",
      },
      body,
    });
    return {
      status: res.status,
      json:
        res.status === 200
          ? await res.json()
          : await res.json().catch(() => null),
    };
  };
  /** Le poste NJP CARE : relève le relais et applique par la doublure. */
  const station = (token: string, care: FakeCare) => {
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        const r = await fetch(`${base}/v1/care/next?wait=300`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (r.status !== 200) continue;
        const { item } = await r.json();
        const result =
          item.kind === "command"
            ? await care.send(item.envelope)
            : await care.findSlots(care.cabinetId, item.query);
        await fetch(`${base}/v1/care/result`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: item.id, result }),
        });
      }
    })();
    return {
      stop: async () => {
        stop = true;
        await loop.catch(() => undefined);
      },
    };
  };
  return { base, svc, lines, webhook, station };
};

const say = async (
  w: Awaited<ReturnType<typeof start>>["webhook"],
  callId: string,
  text: string,
  id?: string
) => w(callId, { type: "caller.utterance", text, ...(id ? { id } : {}) });

describe("service 24/7", () => {
  it("refuse une signature fausse, périmée ou absente", async () => {
    const { webhook } = await start();
    expect(
      (
        await webhook(
          "call_x1",
          { type: "call.started", open: true },
          { sig: "t=1,v1=00" }
        )
      ).status
    ).toBe(401);
    expect(
      (
        await webhook(
          "call_x1",
          { type: "call.started", open: true },
          { ts: Math.floor(NOW / 1000) - 3600 }
        )
      ).status
    ).toBe(401);
    expect(verifyWebhook(SECRET, undefined, "{}", 0)).toBe(false);
  });

  it("refuse un corps trop gros et un événement inconnu", async () => {
    const { webhook } = await start();
    expect(
      (
        await webhook("call_x2", {
          type: "caller.utterance",
          text: "x".repeat(40_000),
        })
      ).status
    ).toBe(413);
    expect((await webhook("call_x2", { type: "send_email" })).status).toBe(400);
    expect(
      (
        await webhook(
          "call_x2",
          { type: "call.started" },
          { to: "+33999999999" }
        )
      ).status
    ).toBe(404);
  });

  it("poste éteint : l'appel est pris, le message attend, puis arrive UNE fois au retour du poste", async () => {
    const { webhook, svc, station, lines } = await start();
    const care = new FakeCare("cab_a", SLOTS);
    const c = "call_off1";
    const greet = await webhook(c, { type: "call.started", open: false });
    expect(greet.json.actions[0].say).toContain(
      "assistante vocale automatisée"
    );
    await say(webhook, c, "je voudrais laisser un message");
    await say(webhook, c, "Camille Durand");
    await say(webhook, c, "06 12 34 56 78");
    await say(webhook, c, "Merci de m'envoyer une attestation de présence.");
    const confirm = await say(webhook, c, "oui", "call_off1-confirm");
    expect(
      confirm.json.actions.map((a: { say?: string }) => a.say).join(" ")
    ).toContain("Votre demande est transmise");
    const dup = await say(webhook, c, "oui", "call_off1-confirm"); // webhook rejoué
    expect(dup.json.duplicate).toBe(true);
    expect(svc.relay.queuedCount("cab_a")).toBe(1);

    const s = station(TOKEN_A, care);
    for (let i = 0; i < 50 && svc.relay.queuedCount("cab_a"); i++)
      await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 50));
    await s.stop();
    expect(
      care.messages.filter(m => m.envelope.command.type === "message.create")
    ).toHaveLength(1);
    // Aucun numéro ni nom dans les journaux.
    const all = lines.join("\n");
    expect(all).not.toContain("06 12 34 56 78");
    expect(all).not.toContain("+33612345678");
    expect(all).not.toContain("Durand");
  });

  it("poste connecté : réservation réelle via le relais, créneau proposé par NJP CARE", async () => {
    const { webhook, station } = await start();
    const care = new FakeCare("cab_a", SLOTS);
    const s = station(TOKEN_A, care);
    const c = "call_on1";
    await webhook(c, { type: "call.started", open: true });
    for (const t of [
      "je voudrais un rendez-vous",
      "Camille Durand",
      "06 12 34 56 78",
      "oui je suis déjà venue",
    ])
      await say(webhook, c, t);
    const offer = await say(webhook, c, "jeudi après-midi");
    expect(
      offer.json.actions.map((a: { say?: string }) => a.say).join(" ")
    ).toContain("jeudi 1 octobre à 14 h");
    await say(webhook, c, "le premier");
    const done = await say(webhook, c, "oui");
    await s.stop();
    expect(
      done.json.actions.map((a: { say?: string }) => a.say).join(" ")
    ).toContain("C'est confirmé");
    expect(care.appointments).toHaveLength(1);
  });

  it("isolation : le jeton d'un cabinet ne relève ni ne répond pour un autre", async () => {
    const { base, webhook, svc } = await start();
    const c = "call_iso1";
    await webhook(c, { type: "call.started", open: false });
    for (const t of [
      "je voudrais laisser un message",
      "Camille Durand",
      "06 12 34 56 78",
      "Une attestation svp.",
      "oui",
    ])
      await say(webhook, c, t);
    expect(svc.relay.queuedCount("cab_a")).toBe(1);
    const r = await fetch(`${base}/v1/care/next?wait=0`, {
      headers: { authorization: `Bearer ${TOKEN_B}` },
    });
    expect(r.status).toBe(204);
    expect(svc.relay.queuedCount("cab_a")).toBe(1);
    const a = await fetch(`${base}/v1/care/next?wait=0`, {
      headers: { authorization: `Bearer ${TOKEN_A}` },
    });
    const { item } = await a.json();
    const forged = await fetch(`${base}/v1/care/result`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN_B}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: item.id, result: { status: "confirmed" } }),
    });
    expect(forged.status).toBe(404);
    expect(
      (
        await fetch(`${base}/v1/care/next`, {
          headers: { authorization: "Bearer nope" },
        })
      ).status
    ).toBe(401);
  });
});

describe("sécurité des sorties et de l'IA", () => {
  it("SSRF : HTTPS et liste blanche uniquement", () => {
    const allow = ["llm.example.eu"];
    expect(
      allowedOutbound("https://llm.example.eu/v1/chat/completions", allow)
    ).toBe(true);
    for (const u of [
      "http://llm.example.eu/",
      "https://169.254.169.254/",
      "https://localhost/",
      "https://llm.example.eu:8443/",
      "https://user:pw@llm.example.eu/",
      "https://evil.example/",
      "file:///etc/passwd",
    ]) {
      expect(allowedOutbound(u, allow)).toBe(false);
    }
    expect(
      () =>
        new LlmUnderstander({
          endpoint: "https://evil.example/x",
          apiKey: "k",
          model: "m",
          allowHosts: allow,
          timeoutMs: 100,
        })
    ).toThrow();
  });

  it("l'IA reçoit tout l'historique utile, et uniquement des propos d'appelant et d'assistante", () => {
    const state = initialState();
    state.turns.push(
      { role: "assistant", text: "Bonjour, je suis l'assistante automatisée." },
      { role: "caller", text: "Un rendez-vous svp" },
      { role: "assistant", text: "Votre nom ?" }
    );
    const msgs = buildMessages(
      "Durand",
      state,
      sanitizeConfig({ cabinetName: "C", cabinetInstructions: "Tutoyer." })
    );
    expect(msgs.map(m => m.role)).toEqual([
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(msgs[0].content.indexOf("AUTOMATISÉE")).toBeLessThan(
      msgs[0].content.indexOf("Tutoyer.")
    );
  });

  it("une réponse du modèle qui tente d'ajouter une action est réduite à de la compréhension", async () => {
    const fake = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "appointment_new",
                  action: "appointment.book",
                  status: "confirmed",
                  entities: { callerName: "X", webhookUrl: "https://evil" },
                }),
              },
            },
          ],
        })
      )) as typeof fetch;
    const u = await new LlmUnderstander(
      {
        endpoint: "https://llm.example.eu/v1",
        apiKey: "k",
        model: "m",
        allowHosts: ["llm.example.eu"],
        timeoutMs: 1000,
      },
      fake
    ).understand("x", initialState(), sanitizeConfig({}));
    expect(u).toEqual({
      intent: "appointment_new",
      entities: { callerName: "X" },
    });
  });

  it("l'expurgation retire numéros, courriels, jetons, signatures", () => {
    expect(
      redact(
        "appel du 06 12 34 56 78 / +33612345678 / a@b.fr / Bearer abcdefgh / v1=" +
          "a".repeat(64)
      )
    ).not.toMatch(/12 34|612345678|a@b\.fr|abcdefgh|aaaa/);
  });
});
