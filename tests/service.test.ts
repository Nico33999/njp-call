import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { sanitizeConfig } from "../core/config";
import type { SlotChoice } from "../core/commands";
import { FakeCare } from "../core/testing/fakeCare";
import { initialState } from "../core/conversation";
import { SimulatorInbound } from "../service/inbound";
import { buildMessages, LlmUnderstander } from "../service/llm";
import type { RelayOptions } from "../service/relay";
import {
  allowedOutbound,
  makeLogger,
  parseDeviceTokens,
  redact,
  signWebhook,
  tokenHash,
  verifyWebhook,
} from "../service/security";
import { createService, type Service } from "../service/server";
import { ServiceStore } from "../service/store";
import { Station, STATUS_OK } from "./helpers/station";

const SECRET = "whsec_" + "t".repeat(40); // secret de test, factice
const TOKEN_A = "tok_A_" + "a".repeat(40);
const TOKEN_A2 = "tok_A2_" + "c".repeat(40);
const TOKEN_B = "tok_B_" + "b".repeat(40);
const KEY = Buffer.alloc(32, 7); // clé de stockage de banc
const NOW = Date.parse("2026-09-29T08:00:00Z");
const SLOTS: SlotChoice[] = [
  {
    slotRef: "slot_001",
    start: "2026-10-01T14:00:00+02:00",
    end: "2026-10-01T14:30:00+02:00",
    practitionerRef: "prac_a",
  },
];

const running: Service[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.shutdown().catch(() => undefined);
});

const start = async (
  o: {
    clock?: { t: number };
    relay?: Partial<RelayOptions>;
    tokens?: () => Map<string, string>;
  } = {}
) => {
  const lines: string[] = [];
  const clock = o.clock ?? { t: NOW };
  const store = new ServiceStore({
    path: ":memory:",
    key: KEY,
    now: () => clock.t,
  });
  const svc = createService({
    store,
    inbound: new SimulatorInbound(SECRET),
    deviceTokens:
      o.tokens ??
      parseDeviceTokens(
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
    maxWaitMs: 2000,
    relay: { verdictTimeoutMs: 1500, ...o.relay },
  });
  await new Promise<void>(r => svc.server.listen(0, "127.0.0.1", r));
  running.push(svc);
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
        at: new Date(clock.t).toISOString(),
        ...event,
      },
    });
    const res = await fetch(`${base}/v1/telephony/sim/webhook`, {
      method: "POST",
      headers: {
        "x-njp-signature":
          opts.sig ??
          signWebhook(SECRET, opts.ts ?? Math.floor(clock.t / 1000), body),
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
  const station = (
    token: string,
    care: FakeCare,
    opts: ConstructorParameters<typeof Station>[3] = {}
  ) =>
    new Station(() => base, token, care, {
      status: STATUS_OK(new Date(clock.t).toISOString()),
      ...opts,
    }).start();
  const get = (path: string, token: string) =>
    fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const post = (path: string, token: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return { base, svc, store, clock, lines, webhook, station, get, post };
};

type Env = Awaited<ReturnType<typeof start>>;

const say = async (
  w: Env["webhook"],
  callId: string,
  text: string,
  id?: string
) => w(callId, { type: "caller.utterance", text, ...(id ? { id } : {}) });

const spoken = (r: { json: { actions: { say?: string }[] } }) =>
  r.json.actions.map(a => a.say ?? "").join(" ");

const leaveMessage = async (
  w: Env["webhook"],
  c: string,
  confirmId?: string
) => {
  await w(c, { type: "call.started", open: false });
  for (const t of [
    "je voudrais laisser un message",
    "Camille Durand",
    "06 12 34 56 78",
    "Merci de m'envoyer une attestation de présence.",
  ])
    await say(w, c, t);
  return say(w, c, "oui", confirmId);
};

const bookUntilConfirm = async (w: Env["webhook"], c: string) => {
  await w(c, { type: "call.started", open: true });
  for (const t of [
    "je voudrais un rendez-vous",
    "Camille Durand",
    "06 12 34 56 78",
    "oui je suis déjà venue",
  ])
    await say(w, c, t);
  const offer = await say(w, c, "jeudi après-midi");
  await say(w, c, "le premier");
  return offer;
};

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 20));
  return cond();
};

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
    const confirm = await leaveMessage(webhook, c, "call_off1-confirm");
    expect(spoken(confirm)).toContain("Votre demande est transmise");
    const dup = await say(webhook, c, "oui", "call_off1-confirm"); // webhook rejoué
    expect(dup.json.duplicate).toBe(true);
    expect(spoken(dup)).toBe(spoken(confirm)); // rejeu explicite de la même réponse
    expect(svc.relay.queuedCount("cab_a")).toBe(1);

    const s = station(TOKEN_A, care);
    expect(await until(() => svc.relay.queuedCount("cab_a") === 0)).toBe(true);
    await s.stop();
    expect(
      care.messages.filter(m => m.envelope.command.type === "message.create")
    ).toHaveLength(1);
    // Aucun numéro ni nom dans les journaux.
    const all = lines.join("\n");
    expect(all).not.toContain("06 12 34 56 78");
    expect(all).not.toContain("+33612345678");
    expect(all).not.toContain("Durand");
    expect(all).not.toContain("attestation");
  });

  it("poste connecté, autorisation fraîche : réservation réelle via le relais", async () => {
    const { webhook, station } = await start();
    const care = new FakeCare("cab_a", SLOTS);
    const s = station(TOKEN_A, care);
    await until(() => s.acked >= 0 && s.networkErrors === 0, 100);
    const offer = await bookUntilConfirm(webhook, "call_on1");
    expect(spoken(offer)).toContain("jeudi 1 octobre à 14 h");
    const done = await say(webhook, "call_on1", "oui");
    await s.stop();
    expect(spoken(done)).toContain("C'est confirmé");
    expect(care.appointments).toHaveLength(1);
  });

  it("aucune déclaration du poste : pas de créneau proposé, jamais « confirmé »", async () => {
    const { webhook, station } = await start();
    const care = new FakeCare("cab_a", SLOTS);
    const s = station(TOKEN_A, care, { status: null });
    await new Promise(r => setTimeout(r, 50));
    const c = "call_nostatus";
    await webhook(c, { type: "call.started", open: true });
    for (const t of [
      "je voudrais un rendez-vous",
      "Camille Durand",
      "06 12 34 56 78",
      "oui je suis déjà venue",
    ])
      await say(webhook, c, t);
    const r = await say(webhook, c, "jeudi après-midi");
    await s.stop();
    expect(spoken(r)).not.toContain("C'est confirmé");
    expect(care.appointments).toHaveLength(0);
  });

  it("autorisation périmée : la réservation devient une demande, rien n'est réservé", async () => {
    const clock = { t: NOW };
    const { webhook, station, store } = await start({ clock });
    const care = new FakeCare("cab_a", SLOTS);
    const s = station(TOKEN_A, care);
    await until(() => store.cabinetStatus("cab_a") !== null);
    await bookUntilConfirm(webhook, "call_stale");
    clock.t += 2 * 3600_000; // la déclaration (1 h) a expiré entre-temps
    // Le poste ne redéclare pas (arrêté) : il ne reste que le service.
    await s.stop();
    const done = await say(webhook, "call_stale", "oui");
    expect(spoken(done)).toContain("Je ne peux pas modifier le planning");
    expect(care.appointments).toHaveLength(0);
  });

  it("extension désactivée côté poste : le service ne promet plus rien", async () => {
    const { webhook, post } = await start();
    expect(
      (
        await post(
          "/v1/care/status",
          TOKEN_A,
          STATUS_OK(new Date(NOW).toISOString(), { extensionEnabled: false })
        )
      ).status
    ).toBe(204);
    const c = "call_disabled";
    const r = await leaveMessage(webhook, c);
    expect(spoken(r)).toContain("Le cabinet n'a pas activé cette fonction");
  });

  it("déclaration invalide refusée (champ inconnu, durée > 24 h, type faux)", async () => {
    const { post } = await start();
    const at = new Date(NOW).toISOString();
    for (const bad of [
      { ...STATUS_OK(at), extra: 1 },
      STATUS_OK(at, { validForSeconds: 90_000 }),
      STATUS_OK(at, { extensionEnabled: "yes" }),
      STATUS_OK(at, { permissions: ["../../etc"] }),
      [],
    ])
      expect((await post("/v1/care/status", TOKEN_A, bad)).status).toBe(400);
  });

  it("isolation : le jeton d'un cabinet ne relève ni ne répond pour un autre", async () => {
    const { webhook, svc, get, post } = await start();
    await leaveMessage(webhook, "call_iso1");
    expect(svc.relay.queuedCount("cab_a")).toBe(1);
    expect((await get("/v1/care/next?wait=0", TOKEN_B)).status).toBe(204);
    const { item } = await (await get("/v1/care/next?wait=0", TOKEN_A)).json();
    const forged = await post("/v1/care/result", TOKEN_B, {
      id: item.id,
      lease: item.lease,
      result: {
        idempotencyKey: item.envelope.idempotencyKey,
        status: "confirmed",
        reference: "msg_0001",
      },
    });
    expect(forged.status).toBe(404);
    expect(svc.relay.stateOf("cab_a", item.envelope.idempotencyKey)).toBe(
      "leased"
    );
    expect((await get("/v1/care/next", "nope")).status).toBe(401);
  });
});

describe("relais à bail", () => {
  it("relever ne supprime rien ; bail expiré ⇒ redistribué ; ancien bail refusé ; verdict accusé une fois enregistré", async () => {
    const clock = { t: NOW };
    const { webhook, svc, get, post } = await start({
      clock,
      relay: { leaseMs: 30_000 },
    });
    await leaveMessage(webhook, "call_lease");
    const first = (await (await get("/v1/care/next?wait=0", TOKEN_A)).json())
      .item;
    expect(first.id).toMatch(/^it_[0-9a-f]{24}$/);
    // Réservé : pas redistribué pendant le bail.
    expect((await get("/v1/care/next?wait=0", TOKEN_A)).status).toBe(204);
    expect(svc.relay.stateOf("cab_a", first.envelope.idempotencyKey)).toBe(
      "leased"
    );
    // Le poste disparaît ; le bail expire ; temporisation ; redistribution.
    clock.t += 31_000;
    expect((await get("/v1/care/next?wait=0", TOKEN_A)).status).toBe(204); // temporisation 1 s
    clock.t += 1_000;
    const second = (await (await get("/v1/care/next?wait=0", TOKEN_A)).json())
      .item;
    expect(second.id).toBe(first.id); // identifiant stable
    expect(second.lease).not.toBe(first.lease);
    const verdict = {
      idempotencyKey: first.envelope.idempotencyKey,
      status: "confirmed",
      reference: "msg_0001",
    };
    expect(
      (
        await post("/v1/care/result", TOKEN_A, {
          id: first.id,
          lease: first.lease,
          result: verdict,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await post("/v1/care/result", TOKEN_A, {
          id: second.id,
          lease: second.lease,
          result: verdict,
        })
      ).status
    ).toBe(204);
    // Même verdict rendu de nouveau (accusé perdu) : accusé ; verdict différent : conflit.
    expect(
      (
        await post("/v1/care/result", TOKEN_A, {
          id: second.id,
          lease: second.lease,
          result: verdict,
        })
      ).status
    ).toBe(204);
    expect(
      (
        await post("/v1/care/result", TOKEN_A, {
          id: second.id,
          lease: second.lease,
          result: { ...verdict, reference: "msg_0002" },
        })
      ).status
    ).toBe(409);
    expect(svc.relay.stateOf("cab_a", first.envelope.idempotencyKey)).toBe(
      "done"
    );
  });

  it("validation stricte des verdicts du poste", async () => {
    const { webhook, get, post } = await start();
    await leaveMessage(webhook, "call_strict");
    const { item } = await (await get("/v1/care/next?wait=0", TOKEN_A)).json();
    const key = item.envelope.idempotencyKey;
    for (const bad of [
      { idempotencyKey: key, status: "simulated", reference: "x_001" },
      {
        idempotencyKey: "autre/message.create/1",
        status: "confirmed",
        reference: "msg_1",
      },
      { idempotencyKey: key, status: "confirmed" }, // confirmé sans référence
      {
        idempotencyKey: key,
        status: "confirmed",
        reference: "msg_1",
        injected: "<script>",
      },
      { idempotencyKey: key, status: "whatever" },
      "confirmed",
    ])
      expect(
        (
          await post("/v1/care/result", TOKEN_A, {
            id: item.id,
            lease: item.lease,
            result: bad,
          })
        ).status
      ).toBe(400);
    expect(
      (
        await post("/v1/care/result", TOKEN_A, {
          id: item.id,
          lease: "0".repeat(31),
          result: {},
        })
      ).status
    ).toBe(400);
    expect(
      (
        await post("/v1/care/result", TOKEN_A, {
          id: item.id,
          lease: item.lease,
          result: {},
          x: 1,
        })
      ).status
    ).toBe(400);
  });

  it("panne du POSTE après application, avant verdict : redistribué, rejoué par NJP CARE, un seul effet", async () => {
    const clock = { t: NOW };
    const { webhook, svc, station } = await start({
      clock,
      relay: { leaseMs: 200 },
    });
    const care = new FakeCare("cab_a", SLOTS);
    await leaveMessage(webhook, "call_stcrash");
    const s = station(TOKEN_A, care);
    s.crashAfterApplyOnce = true;
    await until(() => care.messages.length === 1);
    clock.t += 1_000; // bail écoulé : l'élément revient, temporisé
    expect(
      await until(
        () =>
          svc.relay.stateOf(
            "cab_a",
            care.messages[0].envelope.idempotencyKey
          ) === "ready"
      )
    ).toBe(true);
    clock.t += 2_000; // temporisation écoulée : redistribué, NJP CARE rejoue
    expect(await until(() => svc.relay.queuedCount("cab_a") === 0)).toBe(true);
    await s.stop();
    expect(care.messages).toHaveLength(1);
    expect(care.audit.filter(a => a.type === "message.create")).toHaveLength(1);
  });
});

describe("jetons de poste : rotation, révocation, essais", () => {
  it("rotation : ancien et nouveau jetons valides pendant la bascule, puis l'ancien est retiré", async () => {
    let spec = `cab_a=${tokenHash(TOKEN_A)};cab_a=${tokenHash(TOKEN_A2)}`;
    const { get } = await start({ tokens: () => parseDeviceTokens(spec) });
    expect((await get("/v1/care/next?wait=0", TOKEN_A)).status).toBe(204);
    expect((await get("/v1/care/next?wait=0", TOKEN_A2)).status).toBe(204);
    spec = `cab_a=${tokenHash(TOKEN_A2)}`;
    expect((await get("/v1/care/next?wait=0", TOKEN_A)).status).toBe(401);
    expect((await get("/v1/care/next?wait=0", TOKEN_A2)).status).toBe(204);
  });

  it("révocation (désinstallation) : jeton refusé ensuite, extension déclarée désactivée", async () => {
    const { get, post, webhook } = await start();
    expect((await post("/v1/care/revoke", TOKEN_A, {})).status).toBe(204);
    expect((await get("/v1/care/next?wait=0", TOKEN_A)).status).toBe(401);
    expect(spoken(await leaveMessage(webhook, "call_revoked"))).toContain(
      "n'a pas activé"
    );
    // L'autre cabinet n'est pas touché.
    expect((await get("/v1/care/next?wait=0", TOKEN_B)).status).toBe(204);
  });

  it("essais de jetons répétés : freinés par adresse", async () => {
    const { get } = await start();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++)
      codes.push(
        (await get("/v1/care/next?wait=0", `tok_bad_${"x".repeat(40)}${i}`))
          .status
      );
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("exploitation", () => {
  it("santé : des comptes, aucun identifiant de cabinet ni contenu", async () => {
    const { base, webhook } = await start();
    await leaveMessage(webhook, "call_health");
    const h = await (await fetch(`${base}/healthz`)).json();
    expect(h).toMatchObject({
      ok: true,
      telephony: "simulator",
      schema: 1,
      relayReady: 1,
    });
    expect(JSON.stringify(h)).not.toMatch(/cab_|call_|Durand|\+33/);
  });

  it("arrêt propre : une relève en attente rend la main, le stockage se ferme", async () => {
    const { get, svc, store } = await start();
    const pending = get("/v1/care/next?wait=2000", TOKEN_A);
    await new Promise(r => setTimeout(r, 50));
    const t0 = Date.now();
    running.splice(running.indexOf(svc), 1);
    await svc.shutdown();
    expect((await pending).status).toBe(204);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(() => store.health()).toThrow();
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
