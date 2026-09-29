import { describe, expect, it } from "vitest";
import {
  InMemoryReminderStore,
  nextAllowed,
  ReminderEngine,
  reminderText,
  type AppointmentFact,
  type Reminder,
  type ReminderChannel,
} from "../core/reminders";

const appt = (over: Partial<AppointmentFact> = {}): AppointmentFact => ({
  appointmentRef: "appt_0001",
  version: 1,
  start: "2026-10-08T10:00:00+02:00",
  phone: "+33600000001",
  status: "confirmed",
  ...over,
});

const setup = (facts: Map<string, AppointmentFact>, failing = 0) => {
  const store = new InMemoryReminderStore();
  const sent: { id: string; text: string }[] = [];
  let fails = failing;
  const sms: ReminderChannel = {
    async send(r: Reminder, text: string) {
      if (fails-- > 0) throw new Error("provider down");
      sent.push({ id: r.id, text });
      return { providerRef: `sim_${sent.length}` };
    },
  };
  const engine = new ReminderEngine(
    store,
    { sms, voice: undefined },
    { current: async ref => facts.get(ref) ?? null }
  );
  return { store, sent, engine };
};

const NOW = "2026-10-01T08:00:00Z";

describe("rappels automatiques", () => {
  it("un rendez-vous confirmé programme un seul rappel, la veille, dans la fenêtre", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine, store } = setup(facts);
    const r = await engine.onAppointmentConfirmed(appt(), NOW);
    expect(r?.status).toBe("scheduled");
    expect(r?.dueAt).toBe("2026-10-07T08:00:00Z"); // 10 h de Paris la veille
    await engine.onAppointmentConfirmed(appt(), NOW);
    expect(store.items.size).toBe(1);
  });

  it("hors fenêtre : reporté à l'ouverture (Europe/Paris, changement d'heure compris)", () => {
    // Dimanche 25 octobre 2026, 7 h UTC = 8 h de Paris (heure d'hiver) → 9 h de Paris = 8 h UTC.
    expect(
      new Date(
        nextAllowed(Date.parse("2026-10-25T07:00:00Z"), {
          from: "09:00",
          to: "19:00",
        })
      ).toISOString()
    ).toBe("2026-10-25T08:00:00.000Z");
    // 20 h de Paris : lendemain 9 h.
    expect(
      new Date(
        nextAllowed(Date.parse("2026-10-01T18:00:00Z"), {
          from: "09:00",
          to: "19:00",
        })
      ).toISOString()
    ).toBe("2026-10-02T07:00:00.000Z");
  });

  it("rendez-vous déplacé après programmation : l'ancien rappel devient obsolète, jamais envoyé", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine, store, sent } = setup(facts);
    await engine.onAppointmentConfirmed(appt(), NOW);
    const moved = appt({ version: 2, start: "2026-10-09T15:00:00+02:00" });
    facts.set("appt_0001", moved);
    await engine.onAppointmentConfirmed(moved, NOW);
    const all = [...store.items.values()];
    expect(all.find(r => r.appointmentVersion === 1)!.status).toBe("obsolete");
    await engine.runDue("2026-10-09T08:00:00Z", "w1", true);
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toContain(":v2:");
  });

  it("déjà rappelé puis modifié : le nouveau rappel part, l'ancien reste tel quel", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine, store, sent } = setup(facts);
    await engine.onAppointmentConfirmed(appt(), NOW);
    await engine.runDue("2026-10-07T08:00:00Z", "w1", true);
    expect(sent).toHaveLength(1);
    const moved = appt({ version: 2, start: "2026-10-12T10:00:00+02:00" });
    facts.set("appt_0001", moved);
    await engine.onAppointmentConfirmed(moved, "2026-10-07T09:00:00Z");
    expect(store.items.get("appt_0001:v1:sms")!.status).toBe("sent");
    await engine.runDue("2026-10-11T08:00:00Z", "w1", true);
    expect(sent).toHaveLength(2);
  });

  it("annulé : le rappel à venir est annulé ; revérifié juste avant l'envoi s'il a été oublié", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine, store, sent } = setup(facts);
    await engine.onAppointmentConfirmed(appt(), NOW);
    facts.set("appt_0001", appt({ status: "cancelled" })); // NJP CARE sait, l'événement est perdu
    await engine.runDue("2026-10-07T08:00:00Z", "w1", true);
    expect(sent).toHaveLength(0);
    expect(store.items.get("appt_0001:v1:sms")!.status).toBe("cancelled");
    await engine.onAppointmentConfirmed(
      appt({ appointmentRef: "appt_0002" }),
      NOW
    );
    await engine.onAppointmentCancelled("appt_0002", NOW);
    expect(store.items.get("appt_0002:v1:sms")!.status).toBe("cancelled");
  });

  it("deux travailleurs en même temps : un seul envoi", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine, sent } = setup(facts);
    await engine.onAppointmentConfirmed(appt(), NOW);
    await Promise.all([
      engine.runDue("2026-10-07T08:00:00Z", "w1", true),
      engine.runDue("2026-10-07T08:00:00Z", "w2", true),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("échec du prestataire : nouvelle tentative bornée, puis échec nommé", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine, store } = setup(facts, 5);
    await engine.onAppointmentConfirmed(appt(), NOW);
    for (const t of [
      "2026-10-07T08:00:00Z",
      "2026-10-07T09:00:00Z",
      "2026-10-07T10:00:00Z",
    ])
      await engine.runDue(t, "w1", true);
    const r = store.items.get("appt_0001:v1:sms")!;
    expect(r.attempts).toBe(3);
    expect(r.status).toBe("failed");
  });

  it("un répondeur ne vaut pas confirmation du patient", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine } = setup(facts);
    await engine.onAppointmentConfirmed(appt(), NOW);
    await engine.runDue("2026-10-07T08:00:00Z", "w1", true);
    const r = await engine.onDeliveryReport(
      "appt_0001:v1:sms",
      "voicemail",
      "2026-10-07T08:01:00Z"
    );
    expect(r!.status).toBe("voicemail");
    expect(r!.status).not.toBe("confirmed_by_patient");
    const c = await engine.onDeliveryReport(
      "appt_0001:v1:sms",
      "patient_confirmed",
      "2026-10-07T09:00:00Z"
    );
    expect(c!.status).toBe("confirmed_by_patient");
  });

  it("extension désactivée : rien ne part", async () => {
    const facts = new Map([["appt_0001", appt()]]);
    const { engine, sent } = setup(facts);
    await engine.onAppointmentConfirmed(appt(), NOW);
    expect(await engine.runDue("2026-10-07T08:00:00Z", "w1", false)).toEqual(
      []
    );
    expect(sent).toHaveLength(0);
  });

  it("trop tard pour prévenir : pas de rappel, et c'est dit", async () => {
    const { engine } = setup(new Map());
    const r = await engine.onAppointmentConfirmed(
      appt({ start: "2026-10-01T10:30:00+02:00" }),
      NOW
    );
    expect(r?.status).toBe("failed");
    expect(r?.history[0].event).toBe("no_window_before_appointment");
  });

  it("le texte ne contient ni motif ni praticien, et se dit automatique", () => {
    const text = reminderText({
      appointmentStart: "2026-10-08T10:00:00+02:00",
    } as Reminder);
    expect(text).toContain("jeudi 8 octobre");
    expect(text).toContain("Message automatique");
  });
});
