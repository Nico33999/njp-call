import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeEnvelope, type CommandEnvelope } from "../core/commands";
import { OutcomeUnknown } from "../core/gateway";
import {
  backoffMs,
  DurableRelay,
  validAvailabilityVerdict,
  validCommandVerdict,
} from "../service/relay";
import { ServiceStore } from "../service/store";
import FIXTURE from "../contract/fixtures/message-call.json";

const MSG = FIXTURE[0];

const KEY = Buffer.alloc(32, 5);
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }))
);

const book = (cabinetId: string, callId: string): CommandEnvelope =>
  makeEnvelope(
    cabinetId,
    callId,
    1,
    1,
    {
      type: "appointment.book",
      payload: {
        person: {
          declaredName: "Camille Durand",
          phone: "+33612345678",
          relation: "self",
        },
        newPatient: false,
        slot: {
          slotRef: "slot_001",
          start: "2026-10-01T14:00:00+02:00",
          end: "2026-10-01T14:30:00+02:00",
          practitionerRef: "prac_a",
        },
      },
    },
    "2026-09-29T08:00:00.000Z"
  );

const message = (cabinetId: string, callId: string): CommandEnvelope => ({
  ...(MSG as CommandEnvelope),
  cabinetId,
  callId,
  idempotencyKey: `${callId}/message.create/1`,
});

const setup = (
  file = ":memory:",
  clock = { t: Date.parse("2026-09-29T08:00:00Z") },
  opts = {}
) => {
  const store = new ServiceStore({ path: file, key: KEY, now: () => clock.t });
  return {
    store,
    clock,
    relay: new DurableRelay(store, { verdictTimeoutMs: 100, ...opts }),
  };
};

describe("relais durable", () => {
  it("temporisation bornée et exponentielle", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(30)).toBe(300_000);
  });

  it("tentatives épuisées ⇒ élément « dead », visible en supervision, jamais redistribué", async () => {
    const { relay, clock, store } = setup(undefined, undefined, {
      maxAttempts: 2,
      leaseMs: 1000,
    });
    await relay.put(message("cab_a", "call_1"));
    for (let i = 1; i <= 2; i++) {
      expect(await relay.next("cab_a", 0)).not.toBeNull();
      clock.t += 1001; // bail écoulé, verdict jamais rendu
      expect(await relay.next("cab_a", 0)).toBeNull(); // balaye : temporisé, puis dead
      clock.t += backoffMs(i);
    }
    expect(store.health().relayDead).toBe(1);
    clock.t += 3600_000;
    expect(await relay.next("cab_a", 0)).toBeNull();
  });

  it("commande effective jamais relevée à temps ⇒ « non appliquée » (care_offline) ; déjà relevée ⇒ réconciliée, pas déclarée non appliquée", async () => {
    const { relay, clock } = setup(undefined, undefined, {
      effectiveTtlMs: 60_000,
      leaseMs: 5_000,
      verdictTimeoutMs: 50,
    });
    await relay.next("cab_a", 0); // le poste vient d'être vu : en ligne
    const t = relay.transport();
    const e1 = book("cab_a", "call_1");
    await expect(t.send(e1)).rejects.toBeInstanceOf(OutcomeUnknown);
    clock.t += 61_000;
    await relay.next("cab_b", 0); // rien pour cab_a ne se passe ici
    relay["lastSeen"].set("cab_a", clock.t);
    expect(await t.send(e1)).toMatchObject({
      status: "failed",
      reason: "care_offline",
    });

    const e2 = book("cab_a", "call_2");
    await expect(t.send(e2)).rejects.toBeInstanceOf(OutcomeUnknown);
    const item = await relay.next("cab_a", 0); // relevé (peut-être appliqué)
    expect(item?.kind).toBe("command");
    clock.t += 120_000; // bail et TTL écoulés
    expect(await relay.next("cab_a", 0)).toBeNull(); // temporisation
    clock.t += backoffMs(1);
    const again = await relay.next("cab_a", 0);
    expect(again?.id).toBe(item!.id); // redistribué pour RÉCONCILIATION, pas « expired »
    expect(
      relay.result("cab_a", again!.id, again!.lease, {
        idempotencyKey: e2.idempotencyKey,
        status: "refused",
        reason: "command_expired",
      })
    ).toBe("stored");
    expect(await t.send(e2)).toMatchObject({
      status: "refused",
      reason: "command_expired",
    });
  });

  it("verdict tardif (après l'attente de la session) : conservé, rendu à la soumission suivante de la même clé", async () => {
    const { relay } = setup();
    await relay.next("cab_a", 0);
    const t = relay.transport();
    const e = book("cab_a", "call_late");
    await expect(t.send(e)).rejects.toBeInstanceOf(OutcomeUnknown);
    const item = (await relay.next("cab_a", 0))!;
    expect(
      relay.result("cab_a", item.id, item.lease, {
        idempotencyKey: e.idempotencyKey,
        status: "confirmed",
        reference: "appt_0001",
      })
    ).toBe("stored");
    expect(await t.send(e)).toEqual({
      idempotencyKey: e.idempotencyKey,
      status: "confirmed",
      reference: "appt_0001",
    });
  });

  it("verdict d'un autre cabinet : introuvable ; identifiant stable par (cabinet, clé)", async () => {
    const { relay } = setup();
    await relay.put(book("cab_a", "call_1"));
    await relay.put(book("cab_b", "call_1")); // même clé, autre cabinet : autre élément
    const a = (await relay.next("cab_a", 0))!;
    const b = (await relay.next("cab_b", 0))!;
    expect(a.id).not.toBe(b.id);
    expect(
      relay.result("cab_b", a.id, a.lease, {
        idempotencyKey: (a as { envelope: CommandEnvelope }).envelope
          .idempotencyKey,
        status: "refused",
        reason: "x",
      })
    ).toBe("not_found");
    await relay.put(book("cab_a", "call_1")); // doublon : pas de second élément
    expect(relay.queuedCount("cab_a")).toBe(1);
  });

  it("le bail et la file survivent au redémarrage du service", async () => {
    const d = mkdtempSync(path.join(tmpdir(), "njp-relay-"));
    dirs.push(d);
    const file = path.join(d, "svc.db");
    const clock = { t: Date.parse("2026-09-29T08:00:00Z") };
    const one = setup(file, clock);
    await one.relay.put(book("cab_a", "call_r"));
    const item = (await one.relay.next("cab_a", 0))!;
    one.store.close();
    const two = setup(file, clock);
    // Le verdict rendu avec le bail d'avant le redémarrage est accepté.
    expect(
      two.relay.result("cab_a", item.id, item.lease, {
        idempotencyKey: (item as { envelope: CommandEnvelope }).envelope
          .idempotencyKey,
        status: "confirmed",
        reference: "appt_0001",
      })
    ).toBe("stored");
    expect(
      two.relay.stateOf(
        "cab_a",
        (item as { envelope: CommandEnvelope }).envelope.idempotencyKey
      )
    ).toBe("done");
    two.store.close();
  });

  it("validateurs stricts", () => {
    const k = "call_1/appointment.book/1";
    expect(
      validCommandVerdict(
        { idempotencyKey: k, status: "confirmed", reference: "appt_1" },
        k
      )
    ).toBe(true);
    expect(
      validCommandVerdict(
        { idempotencyKey: k, status: "refused", reason: "a b" },
        k
      )
    ).toBe(false);
    expect(
      validCommandVerdict(
        {
          idempotencyKey: k,
          status: "requested",
          detail: { x: "y".repeat(3000) },
        },
        k
      )
    ).toBe(false);
    const slot = {
      slotRef: "slot_001",
      start: "2026-10-01T14:00:00+02:00",
      end: "2026-10-01T14:30:00+02:00",
      practitionerRef: "prac_a",
    };
    expect(
      validAvailabilityVerdict({ status: "confirmed", slots: [slot] })
    ).toBe(true);
    expect(
      validAvailabilityVerdict({
        status: "confirmed",
        slots: [slot, slot, slot, slot],
      })
    ).toBe(false);
    expect(
      validAvailabilityVerdict({
        status: "confirmed",
        slots: [{ ...slot, start: "demain" }],
      })
    ).toBe(false);
    expect(validAvailabilityVerdict({ status: "simulated", slots: [] })).toBe(
      false
    );
  });
});
