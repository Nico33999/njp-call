/**
 * Bancs de panne avec de VRAIS redémarrages de processus.
 *
 * Le service réel (`service/main.ts`) tourne dans un processus enfant, sur un
 * stockage SQLite chiffré. Un point de panne nommé (`NJP_CALL_TEST_FAULT`,
 * honoré en recette seulement) le tue par SIGKILL — sans fermeture propre —
 * entre réception, journalisation, envoi au poste, écriture NJP CARE et
 * accusé. On le relance sur le même fichier ; le « fournisseur » rejoue
 * l'événement non acquitté ; le « poste » se reconnecte seul.
 *
 * Ce qui est prouvé à chaque fois : UN seul rendez-vous dans NJP CARE, une
 * seule application (les autres passages sont des rejeux idempotents), et
 * une réponse à l'appelant qui dit la vérité.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SlotChoice } from "../core/commands";
import { parisDateOf, parisLocalToInstant } from "../core/datetime";
import { FakeCare } from "../core/testing/fakeCare";
import { signWebhook, tokenHash } from "../service/security";
import { Station } from "./helpers/station";

const ROOT = path.resolve(__dirname, "..");
const SECRET = "whsec_" + "c".repeat(40); // factice
const TOKEN = "tok_crash_" + "d".repeat(40); // factice
const KEY_HEX = "11".repeat(32); // clé de banc
const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const dirs: string[] = [];
const children = new Set<ChildProcess>();
afterAll(() => {
  for (const c of children) c.kill("SIGKILL");
  dirs.forEach(d => rmSync(d, { recursive: true, force: true }));
});

const freePort = () =>
  new Promise<number>(resolve => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

/** Un créneau dans 8 jours à 14 h (Paris), et la phrase qui le désigne. */
const slotIn8Days = (): { slot: SlotChoice; phrase: string } => {
  const d = parisDateOf(Date.now() + 8 * 86400_000);
  const start = parisLocalToInstant(d, { h: 14, min: 0 });
  const end = parisLocalToInstant(d, { h: 14, min: 30 });
  if (start.kind !== "ok" || end.kind !== "ok")
    throw new Error("heure de Paris inattendue");
  return {
    slot: {
      slotRef: "slot_crash",
      start: start.iso,
      end: end.iso,
      practitionerRef: "prac_a",
    },
    phrase: `le ${d.d} ${MONTHS[d.m - 1]} après-midi`,
  };
};

interface Svc {
  proc: ChildProcess;
  exited: Promise<number | null>;
  stderr: string[];
  stdout: string[];
}

const launch = (env: Record<string, string>): Promise<Svc> =>
  new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ["--no-warnings", "--import", "tsx", "service/main.ts"],
      {
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? "", TZ: "UTC", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    children.add(proc);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exited = new Promise<number | null>(r =>
      proc.on("exit", code => {
        children.delete(proc);
        r(code);
      })
    );
    proc.stderr!.on("data", d => stderr.push(String(d)));
    proc.stdout!.on("data", d => {
      stdout.push(String(d));
      if (String(d).includes('"event":"listening"'))
        resolve({ proc, exited, stderr, stdout });
    });
    void exited.then(code =>
      reject(
        new Error(`service arrêté avant écoute (${code}) : ${stderr.join("")}`)
      )
    );
  });

const setup = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "njp-call-crash-"));
  dirs.push(dir);
  writeFileSync(
    path.join(dir, "cab_crash.json"),
    JSON.stringify({ cabinetName: "Cabinet de banc" })
  );
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = (extra: Record<string, string> = {}) => ({
    NJP_CALL_MODE: "recette",
    NJP_CALL_DB_PATH: path.join(dir, "service.db"),
    NJP_CALL_STORAGE_KEY: KEY_HEX,
    NJP_CALL_TELEPHONY_WEBHOOK_SECRET: SECRET,
    NJP_CALL_DEVICE_TOKENS: `cab_crash=${tokenHash(TOKEN)}`,
    NJP_CALL_NUMBER_ROUTES: "+33100000009=cab_crash",
    NJP_CALL_CONFIG_DIR: dir,
    NJP_CALL_RELAY_LEASE_MS: "1000",
    PORT: String(port),
    ...extra,
  });
  const { slot, phrase } = slotIn8Days();
  const care = new FakeCare("cab_crash", [slot]);
  const station = new Station(() => base, TOKEN, care, { waitMs: 200 });
  let n = 0;
  /** Le fournisseur : un événement signé ; `null` si le service est tombé pendant la requête. */
  const event = async (callId: string, e: Record<string, unknown>) => {
    const body = JSON.stringify({
      callId,
      to: "+33100000009",
      event: {
        id: e.id ?? `${callId}-${++n}`,
        at: new Date().toISOString(),
        ...e,
      },
    });
    try {
      const r = await fetch(`${base}/v1/telephony/sim/webhook`, {
        method: "POST",
        headers: {
          "x-njp-signature": signWebhook(
            SECRET,
            Math.floor(Date.now() / 1000),
            body
          ),
          "content-type": "application/json",
        },
        body,
      });
      return {
        status: r.status,
        json: (await r.json()) as {
          actions: { say?: string }[];
          duplicate: boolean;
        },
      };
    } catch {
      return null;
    }
  };
  const words = (r: { json: { actions: { say?: string }[] } } | null) =>
    r ? r.json.actions.map(a => a.say ?? "").join(" ") : "";
  /** Tout l'appel jusqu'à la confirmation (exclue). */
  const upToConfirm = async (callId: string) => {
    await event(callId, { type: "call.started", open: true });
    for (const t of [
      "je voudrais un rendez-vous",
      "Camille Fictive",
      "06 00 00 00 01",
      "oui je suis déjà venue",
    ])
      await event(callId, { type: "caller.utterance", text: t });
    const offer = await event(callId, {
      type: "caller.utterance",
      text: phrase,
    });
    expect(words(offer)).toContain("14 h");
    await event(callId, { type: "caller.utterance", text: "le premier" });
  };
  const confirm = (callId: string) =>
    event(callId, {
      id: `${callId}-confirm`,
      type: "caller.utterance",
      text: "oui",
    });
  /** Attend que le poste ait relevé au moins une fois le service en cours. */
  const stationBack = async () => {
    const before = station.polls;
    const end = Date.now() + 8000;
    while (station.polls <= before + 1 && Date.now() < end)
      await new Promise(r => setTimeout(r, 25));
  };
  return {
    env,
    care,
    station,
    event,
    words,
    upToConfirm,
    confirm,
    stationBack,
  };
};

const appliedOnce = (care: FakeCare) => {
  expect(care.appointments).toHaveLength(1);
  // Une seule APPLICATION : un rejeu éventuel rend le verdict enregistré sans rien créer.
  expect(care.audit.filter(a => a.type === "appointment.book")).toHaveLength(1);
};

describe("pannes du service avec redémarrage réel du processus", () => {
  // Le rendez-vous est la 1re commande ; la disponibilité est le 1er élément
  // relevé, la réservation le 2e ; l'événement de confirmation est le 8e.
  const cases: { point: string; expectDuplicate: boolean; why: string }[] = [
    {
      point: "event_recorded@8",
      expectDuplicate: false,
      why: "événement journalisé, rien d'exécuté : retraité avec la même clé",
    },
    {
      point: "command_recorded@1",
      expectDuplicate: false,
      why: "commande journalisée, jamais envoyée : envoyée une fois",
    },
    {
      point: "item_leased@2",
      expectDuplicate: false,
      why: "élément réservé, jamais reçu par le poste : bail expiré, redistribué",
    },
    {
      point: "result_stored@2",
      expectDuplicate: false,
      why: "verdict enregistré, accusé perdu : le poste rejoue, « déjà »",
    },
    {
      point: "result_recorded@1",
      expectDuplicate: false,
      why: "verdict journalisé, réponse perdue : réutilisé sans resoumettre",
    },
    {
      point: "output_recorded@8",
      expectDuplicate: true,
      why: "réponse journalisée, jamais envoyée : rejouée à l'identique",
    },
  ];

  for (const c of cases) {
    it(`panne « ${c.point} » — ${c.why}`, async () => {
      const t = await setup();
      const first = await launch(t.env({ NJP_CALL_TEST_FAULT: c.point }));
      t.station.start();
      await t.stationBack();
      const callId = `call_${c.point.replace(/[^a-z0-9]/g, "_")}`;
      await t.upToConfirm(callId);
      const lost = await t.confirm(callId);
      expect(lost).toBeNull(); // le service est mort pendant la requête
      expect(await first.exited).not.toBe(0);
      expect(first.stderr.join("")).toContain("fault_injected");

      await launch(t.env());
      await t.stationBack(); // le poste s'est reconnecté seul
      const retried = await t.confirm(callId); // le fournisseur rejoue l'événement
      expect(retried?.status).toBe(200);
      expect(t.words(retried)).toContain("C'est confirmé");
      expect(retried!.json.duplicate).toBe(c.expectDuplicate);
      appliedOnce(t.care);
      // Un nouveau rejeu ne change rien.
      const again = await t.confirm(callId);
      expect(again!.json.duplicate).toBe(true);
      expect(t.words(again)).toBe(t.words(retried));
      appliedOnce(t.care);
      await t.station.stop();
    }, 40_000);
  }

  it("poste pas encore revenu après le redémarrage : jamais « confirmé », demande explicite, remise une fois au retour", async () => {
    const t = await setup();
    const first = await launch(
      t.env({ NJP_CALL_TEST_FAULT: "event_recorded@8" })
    );
    t.station.start();
    await t.stationBack();
    await t.upToConfirm("call_absent");
    expect(await t.confirm("call_absent")).toBeNull();
    await first.exited;
    await t.station.stop(); // le poste est éteint pendant le redémarrage

    const second = await launch(t.env());
    const retried = await t.confirm("call_absent");
    expect(t.words(retried)).toContain("Je ne peux pas modifier le planning");
    expect(t.words(retried)).not.toContain("C'est confirmé");
    // L'appelant accepte la demande à la place.
    const accepted = await t.event("call_absent", {
      type: "caller.utterance",
      text: "oui",
    });
    expect(t.words(accepted)).toContain("Votre demande est transmise");
    await t.event("call_absent", { type: "call.ended" });
    expect(t.care.appointments).toHaveLength(0);

    // Le poste revient : la demande arrive, UNE fois ; aucun rendez-vous créé.
    const station2 = new Station(
      () => `http://127.0.0.1:${t.env().PORT}`,
      TOKEN,
      t.care,
      { waitMs: 200 }
    ).start();
    const end = Date.now() + 8000;
    while (t.care.requests.length === 0 && Date.now() < end)
      await new Promise(r => setTimeout(r, 25));
    await new Promise(r => setTimeout(r, 300));
    await station2.stop();
    expect(t.care.requests).toHaveLength(1);
    expect(t.care.appointments).toHaveLength(0);
    second.proc.kill("SIGTERM");
    expect(await second.exited).toBe(0);
  }, 40_000);

  it("arrêt propre (SIGTERM) : sortie 0 rapide, l'appel en cours reprend après redémarrage", async () => {
    const t = await setup();
    const one = await launch(t.env());
    await t.event("call_term", { type: "call.started", open: false });
    await t.event("call_term", {
      type: "caller.utterance",
      text: "je voudrais laisser un message",
    });
    const t0 = Date.now();
    one.proc.kill("SIGTERM");
    expect(await one.exited).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
    await launch(t.env());
    const next = await t.event("call_term", {
      type: "caller.utterance",
      text: "Camille Fictive",
    });
    expect(next?.status).toBe(200);
    expect(t.words(next).toLowerCase()).toContain("numéro");
  }, 30_000);
});

describe("aucune fuite dans les sorties du processus", () => {
  it("ni jeton, ni secret, ni clé, ni nom, ni numéro dans stdout/stderr du service", async () => {
    const t = await setup();
    const svc = await launch(t.env());
    t.station.start();
    await t.stationBack();
    await t.upToConfirm("call_leak");
    await t.confirm("call_leak");
    // Tentatives hostiles : mauvais jeton, signature fausse.
    await fetch(`http://127.0.0.1:${t.env().PORT}/v1/care/next`, {
      headers: { authorization: `Bearer ${TOKEN}x` },
    });
    await fetch(`http://127.0.0.1:${t.env().PORT}/v1/telephony/sim/webhook`, {
      method: "POST",
      headers: { "x-njp-signature": "t=1,v1=" + "0".repeat(64) },
      body: "{}",
    });
    await t.station.stop();
    svc.proc.kill("SIGTERM");
    await svc.exited;
    const all = svc.stdout.join("") + svc.stderr.join("");
    expect(all.length).toBeGreaterThan(100);
    for (const secret of [
      TOKEN,
      SECRET,
      KEY_HEX,
      "Camille",
      "Fictive",
      "0600000001",
      "06 00 00 00 01",
      "+33600000001",
    ])
      expect(all).not.toContain(secret);
  }, 40_000);
});

describe("démarrage : refus prudents", () => {
  const refused = async (env: Record<string, string>) => {
    const t = await setup();
    const proc = spawn(
      process.execPath,
      ["--no-warnings", "--import", "tsx", "service/main.ts"],
      {
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? "", ...t.env(), ...env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let err = "";
    proc.stderr.on("data", d => (err += String(d)));
    const code = await new Promise<number | null>(r => proc.on("exit", r));
    return { code, err };
  };

  it("mode opérationnel sans persistance : refus", async () => {
    const r = await refused({
      NJP_CALL_MODE: "operationnel",
      NJP_CALL_DB_PATH: "",
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("NJP_CALL_DB_PATH");
  }, 20_000);

  it("mode opérationnel sans fournisseur téléphonique réel : refus (le simulateur n'est pas une exploitation)", async () => {
    const r = await refused({ NJP_CALL_MODE: "operationnel" });
    expect(r.code).toBe(1);
    expect(r.err).toContain("aucun fournisseur téléphonique réel");
  }, 20_000);

  it("points de panne interdits hors recette ; clé de stockage absente refusée", async () => {
    const f = await refused({
      NJP_CALL_MODE: "operationnel",
      NJP_CALL_TEST_FAULT: "event_recorded",
    });
    expect(f.code).toBe(1);
    expect(f.err).toContain("NJP_CALL_TEST_FAULT");
    const noKey = await refused({ NJP_CALL_STORAGE_KEY: "" });
    expect(noKey.code).toBe(1);
    expect(noKey.err).toContain("NJP_CALL_STORAGE_KEY");
  }, 20_000);
});
