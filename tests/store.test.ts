import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReminderEngine, type AppointmentFact } from "../core/reminders";
import { remindersAllowed, recordStatus } from "../service/status";
import {
  ServiceStore,
  STORE_SCHEMA,
  StoreError,
  storageKeyFromEnv,
} from "../service/store";

const KEY = Buffer.alloc(32, 3);
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "njp-call-store-"));
  dirs.push(d);
  return d;
};
afterEach(() =>
  dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }))
);

const ev = (id: string, text: string) => ({
  k: "event" as const,
  event: {
    id,
    type: "caller.utterance" as const,
    at: "2026-09-29T08:00:00Z",
    text,
  },
});

describe("stockage durable du service", () => {
  it("deux cabinets, le même identifiant d'appel : journaux séparés, survivent à la réouverture", async () => {
    const file = path.join(tmp(), "svc.db");
    const s1 = new ServiceStore({ path: file, key: KEY });
    const j = s1.journal();
    await j.append(
      { cabinetId: "cab_aaaa", callId: "call_same" },
      ev("e1", "pour A")
    );
    await j.append(
      { cabinetId: "cab_bbbb", callId: "call_same" },
      ev("e1", "pour B")
    );
    await j.append(
      { cabinetId: "cab_aaaa", callId: "call_same" },
      ev("e2", "encore A")
    );
    s1.close();
    const s2 = new ServiceStore({ path: file, key: KEY });
    const a = await s2
      .journal()
      .load({ cabinetId: "cab_aaaa", callId: "call_same" });
    const b = await s2
      .journal()
      .load({ cabinetId: "cab_bbbb", callId: "call_same" });
    expect(a.map(e => (e as ReturnType<typeof ev>).event.text)).toEqual([
      "pour A",
      "encore A",
    ]);
    expect(b.map(e => (e as ReturnType<typeof ev>).event.text)).toEqual([
      "pour B",
    ]);
    s2.close();
  });

  it("contenus chiffrés au repos ; un contenu déplacé vers un autre cabinet ne se déchiffre pas ; mauvaise clé refusée", async () => {
    const file = path.join(tmp(), "svc.db");
    const s = new ServiceStore({ path: file, key: KEY });
    await s
      .journal()
      .append(
        { cabinetId: "cab_aaaa", callId: "call_1" },
        ev("e1", "Camille Durand 0612345678")
      );
    await s
      .journal()
      .append({ cabinetId: "cab_bbbb", callId: "call_1" }, ev("e1", "autre"));
    s.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const raw = readFileSync(file);
    expect(raw.includes(Buffer.from("Durand"))).toBe(false);
    expect(raw.includes(Buffer.from("0612345678"))).toBe(false);
    // Copie du contenu de A dans la ligne de B : l'authentification (AAD) échoue.
    s.db.exec(
      "UPDATE journal SET entry = (SELECT entry FROM journal WHERE cabinet_id = 'cab_aaaa') WHERE cabinet_id = 'cab_bbbb'"
    );
    await expect(
      s.journal().load({ cabinetId: "cab_bbbb", callId: "call_1" })
    ).rejects.toThrow();
    s.close();
    const wrong = new ServiceStore({ path: file, key: Buffer.alloc(32, 9) });
    await expect(
      wrong.journal().load({ cabinetId: "cab_aaaa", callId: "call_1" })
    ).rejects.toThrow();
    wrong.close();
    expect(
      () => new ServiceStore({ path: file, key: Buffer.alloc(16) })
    ).toThrow(StoreError);
    expect(storageKeyFromEnv("zz")).toBeNull();
    expect(storageKeyFromEnv("ab".repeat(32))?.length).toBe(32);
  });

  it("migration : schéma courant posé ; un stockage plus récent est refusé avant toute écriture", () => {
    const file = path.join(tmp(), "svc.db");
    const s = new ServiceStore({ path: file, key: KEY });
    expect(s.schema()).toBe(STORE_SCHEMA);
    s.db
      .prepare("UPDATE store_meta SET v = ? WHERE k = 'schema'")
      .run(String(STORE_SCHEMA + 1));
    s.close();
    expect(() => new ServiceStore({ path: file, key: KEY })).toThrow(
      /refus avant toute écriture/
    );
  });

  it("sauvegarde à chaud puis restauration : le contenu revient, toujours chiffré", async () => {
    const d = tmp();
    const s = new ServiceStore({ path: path.join(d, "svc.db"), key: KEY });
    await s
      .journal()
      .append(
        { cabinetId: "cab_aaaa", callId: "call_1" },
        ev("e1", "à sauvegarder")
      );
    s.backup(path.join(d, "backup.db"));
    await s
      .journal()
      .append(
        { cabinetId: "cab_aaaa", callId: "call_1" },
        ev("e2", "après la sauvegarde")
      );
    s.close();
    expect(
      readFileSync(path.join(d, "backup.db")).includes(
        Buffer.from("sauvegarder")
      )
    ).toBe(false);
    const restored = new ServiceStore({
      path: path.join(d, "backup.db"),
      key: KEY,
    });
    const log = await restored
      .journal()
      .load({ cabinetId: "cab_aaaa", callId: "call_1" });
    expect(log).toHaveLength(1);
    restored.close();
  });

  it("vérification d'une sauvegarde : tout se déchiffre ; un contenu altéré est compté, jamais lu", async () => {
    const d = tmp();
    const s = new ServiceStore({ path: path.join(d, "svc.db"), key: KEY });
    await s
      .journal()
      .append({ cabinetId: "cab_aaaa", callId: "call_1" }, ev("e1", "x"));
    s.setCabinetStatus("cab_aaaa", { v: 1 }, s.now() + 1000);
    expect(s.verifyAll()).toEqual({
      schema: STORE_SCHEMA,
      checked: 2,
      unreadable: 0,
    });
    s.db.exec(
      "UPDATE journal SET entry = substr(entry, 1, length(entry) - 1) || x'00'"
    );
    expect(s.verifyAll().unreadable).toBe(1);
    s.close();
  });

  it("purge : appels clos et éléments terminés anciens supprimés, travail en cours gardé", async () => {
    let now = Date.parse("2026-09-01T00:00:00Z");
    const s = new ServiceStore({ path: ":memory:", key: KEY, now: () => now });
    const j = s.journal();
    await j.append(
      { cabinetId: "cab_aaaa", callId: "call_old" },
      ev("e1", "x")
    );
    await j.compact(
      { cabinetId: "cab_aaaa", callId: "call_old" },
      { k: "closed", at: "2026-09-01T00:00:00Z", eventIds: ["e1"] }
    );
    await j.append(
      { cabinetId: "cab_aaaa", callId: "call_open" },
      ev("e1", "y")
    );
    now += 40 * 86400_000;
    await j.append(
      { cabinetId: "cab_aaaa", callId: "call_recent" },
      ev("e1", "z")
    );
    const n = s.purge(30);
    expect(n.calls).toBe(2); // clos ancien + ouvert abandonné
    expect(
      await j.load({ cabinetId: "cab_aaaa", callId: "call_recent" })
    ).toHaveLength(1);
    expect(
      await j.load({ cabinetId: "cab_aaaa", callId: "call_old" })
    ).toHaveLength(0);
    expect(s.health()).toMatchObject({ openCalls: 1 });
    s.close();
  });

  it("rappels : magasin durable par cabinet, verrou compare-et-échange, suspendus sans autorisation fraîche", async () => {
    let now = Date.parse("2026-09-29T08:00:00Z");
    const s = new ServiceStore({ path: ":memory:", key: KEY, now: () => now });
    const fact: AppointmentFact = {
      appointmentRef: "appt_0001",
      version: 1,
      start: "2026-10-01T14:00:00+02:00",
      phone: "+33612345678",
      status: "confirmed",
    };
    const sent: string[] = [];
    const engine = new ReminderEngine(
      s.reminders("cab_aaaa"),
      {
        sms: { send: async r => (sent.push(r.id), { providerRef: "p1" }) },
        voice: undefined,
      },
      { current: async () => fact }
    );
    const r = await engine.onAppointmentConfirmed(fact, "2026-09-29T08:00:00Z");
    expect(r).not.toBeNull();
    // Un autre cabinet ne voit rien.
    expect(await s.reminders("cab_bbbb").get(r!.id)).toBeUndefined();
    const due = "2026-09-30T12:00:00Z";
    // Aucune déclaration du poste : le travailleur n'envoie rien.
    expect(remindersAllowed(s, "cab_aaaa")).toBe(false);
    expect(
      await engine.runDue(due, "w1", remindersAllowed(s, "cab_aaaa"))
    ).toEqual([]);
    recordStatus(s, "cab_aaaa", {
      v: 1,
      extensionEnabled: true,
      permissions: [],
      bookingEnabled: true,
      remindersOnDisable: "suspend",
      issuedAt: "2026-09-29T08:00:00Z",
      validForSeconds: 3600,
    });
    expect(remindersAllowed(s, "cab_aaaa")).toBe(true);
    // Deux travailleurs concurrents : un seul envoi.
    const store = s.reminders("cab_aaaa");
    expect(
      await store.tryLock(r!.id, "scheduled", "w1", "2026-09-30T12:02:00Z", due)
    ).toBe(true);
    expect(
      await store.tryLock(r!.id, "scheduled", "w2", "2026-09-30T12:02:00Z", due)
    ).toBe(false);
    now += 2 * 3600_000;
    expect(remindersAllowed(s, "cab_aaaa")).toBe(false); // déclaration périmée
    expect(sent).toEqual([]);
    s.close();
  });
});
