import { describe, expect, it } from "vitest";
import {
  COMMAND_PERMISSION,
  COMMAND_TYPES,
  idempotencyKey,
  makeEnvelope,
  validateCommand,
  validateEnvelope,
  type Command,
} from "../core/commands";
import {
  guardResult,
  InMemoryCommandQueue,
  NotDelivered,
  OutcomeUnknown,
  QueueingGateway,
  SimulationGateway,
  UnsupportedGateway,
} from "../core/gateway";

const message: Command = {
  type: "message.create",
  payload: {
    caller: {
      declaredName: "Camille Test",
      phone: "+33600000001",
      relation: "self",
    },
    recipient: { kind: "secretariat" },
    confirmedText: "Je souhaite recevoir une facture.",
    aiSummary: "Message administratif de Camille Test.",
    category: "administratif",
    level: "normal",
  },
};
const book: Command = {
  type: "appointment.book",
  payload: {
    person: {
      declaredName: "Camille Test",
      phone: "+33600000001",
      relation: "self",
    },
    newPatient: false,
    slot: {
      slotRef: "slot_001",
      start: "2026-10-05T14:00:00+02:00",
      end: "2026-10-05T14:30:00+02:00",
      practitionerRef: "prac_a",
    },
  },
};
const env = (c: Command, n = 1) =>
  makeEnvelope("cab_test", "call_0001", n, 1, c, "2026-09-29T10:00:00Z");

describe("commandes structurées", () => {
  it("l'ensemble des commandes est fermé et chacune exige un accès nommé", () => {
    expect(COMMAND_TYPES).toContain("message.create");
    expect(COMMAND_TYPES).toContain("callback.request");
    expect(COMMAND_TYPES).toContain("appointment.request");
    expect(COMMAND_TYPES).toContain("call.transfer");
    for (const t of COMMAND_TYPES)
      expect(COMMAND_PERMISSION[t]).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    expect(validateCommand({ type: "send_email", payload: {} })).toContain(
      "command.type:inconnu"
    );
  });

  it("une commande valide passe, un champ inconnu est refusé", () => {
    expect(validateCommand(message)).toEqual([]);
    const extra = structuredClone(message) as unknown as {
      payload: Record<string, unknown>;
    };
    extra.payload.webhookUrl = "https://evil.example";
    expect(validateCommand(extra)).toContain("payload.webhookUrl:inconnu");
  });

  it("refuse numéro invalide, caractère de contrôle, texte trop long, proche sans nom", () => {
    const bad = structuredClone(message) as Extract<
      Command,
      { type: "message.create" }
    >;
    bad.payload.caller.phone = "0600000001";
    bad.payload.confirmedText = "a\u0007b";
    bad.payload.aiSummary = "x".repeat(700);
    bad.payload.caller.relation = "parent";
    const e = validateCommand(bad);
    expect(e).toEqual(
      expect.arrayContaining([
        "payload.caller.phone:telephone",
        "payload.confirmedText:caractere_controle",
        "payload.aiSummary:trop_long",
        "payload.caller.concernedName:requis_pour_un_proche",
      ])
    );
  });

  it("un créneau dont la fin précède le début est refusé", () => {
    const b = structuredClone(book) as Extract<
      Command,
      { type: "appointment.book" }
    >;
    b.payload.slot.end = "2026-10-05T13:00:00+02:00";
    expect(validateCommand(b)).toContain("payload.slot:ordre");
  });

  it("la clé d'idempotence est stable et cohérente avec l'enveloppe", () => {
    expect(idempotencyKey("call_0001", "message.create", 1)).toBe(
      "call_0001/message.create/1"
    );
    expect(env(message).idempotencyKey).toBe(env(message).idempotencyKey);
    expect(validateEnvelope(env(message))).toEqual([]);
    const e = env(message);
    e.idempotencyKey = "call_9999/message.create/1";
    expect(validateEnvelope(e)).toContain(
      "envelope.idempotencyKey:incoherente"
    );
    expect(() => idempotencyKey("bad id!", "message.create", 1)).toThrow();
  });
});

describe("passerelles vers NJP CARE", () => {
  it("sans connecteur : unsupported, jamais une réussite", async () => {
    const r = await new UnsupportedGateway().submit(env(message));
    expect(r.status).toBe("unsupported");
  });

  it("la simulation doit être explicite et ne rend jamais confirmed", async () => {
    expect(() => new SimulationGateway(false)).toThrow();
    const g = new SimulationGateway(true);
    const r = await g.submit(env(book));
    expect(r.status).toBe("simulated");
    const again = await g.submit(env(book));
    expect(again.replayed).toBe(true);
    expect(g.log).toHaveLength(1);
  });

  it("un résultat incohérent devient failed", () => {
    const e = env(message);
    expect(
      guardResult(
        e,
        { idempotencyKey: e.idempotencyKey, status: "confirmed" },
        "live"
      ).reason
    ).toBe("confirmed_without_reference");
    expect(
      guardResult(
        e,
        {
          idempotencyKey: e.idempotencyKey,
          status: "confirmed",
          reference: "x",
        },
        "simulation"
      ).reason
    ).toBe("confirmed_outside_live");
    expect(
      guardResult(
        e,
        {
          idempotencyKey: "autre/message.create/1",
          status: "confirmed",
          reference: "x",
        },
        "live"
      ).reason
    ).toBe("result_key_mismatch");
    expect(
      guardResult(
        e,
        { idempotencyKey: e.idempotencyKey, status: "done" },
        "live"
      ).reason
    ).toBe("result_status_unknown");
    expect(guardResult(e, null, "live").status).toBe("failed");
  });

  it("NJP CARE hors ligne : un message attend en file ; une réservation n'y entre jamais", async () => {
    const queue = new InMemoryCommandQueue();
    const g = new QueueingGateway(
      {
        send: async () => {
          throw new NotDelivered("down");
        },
      },
      queue
    );
    const m = await g.submit(env(message));
    expect(m).toMatchObject({
      status: "pending",
      reason: "care_offline_queued",
    });
    const b = await g.submit(env(book, 2));
    expect(b).toMatchObject({ status: "failed", reason: "care_offline" });
    expect([...queue.items.keys()]).toEqual([env(message).idempotencyKey]);
  });

  it("issue inconnue : rejeu avec la même clé, puis réconciliation — jamais « rien n'a été fait »", async () => {
    const seen: string[] = [];
    let calls = 0;
    const g = new QueueingGateway(
      {
        send: async e => {
          seen.push(e.idempotencyKey);
          calls += 1;
          if (calls === 1) throw new OutcomeUnknown("reset");
          return {
            idempotencyKey: e.idempotencyKey,
            status: "confirmed",
            reference: "appt_1",
            replayed: true,
          };
        },
      },
      new InMemoryCommandQueue()
    );
    const r = await g.submit(env(book));
    expect(r.status).toBe("confirmed");
    expect(new Set(seen).size).toBe(1);

    const queue = new InMemoryCommandQueue();
    const never = new QueueingGateway(
      {
        send: async () => {
          throw new OutcomeUnknown("reset");
        },
      },
      queue
    );
    const u = await never.submit(env(book));
    expect(u).toMatchObject({ status: "pending", reason: "outcome_unknown" });
    expect(queue.items.size).toBe(1);
  });

  it("une enveloppe invalide est refusée avant tout transport", async () => {
    let sent = false;
    const g = new QueueingGateway(
      {
        send: async () => {
          sent = true;
          return {};
        },
      },
      new InMemoryCommandQueue()
    );
    const e = env(message);
    (e as { cabinetId: string }).cabinetId = "../etc";
    expect((await g.submit(e)).status).toBe("refused");
    expect(sent).toBe(false);
  });
});
