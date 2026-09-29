/**
 * Produit les enveloppes de commande qu'un appel simulé envoie réellement à
 * NJP CARE, pour les tests de contrat du moteur Rust (`njp-care`).
 *
 *   pnpm tsx scripts/export-contract-fixtures.ts
 *
 * Données entièrement fictives. Écrit `contract/fixtures/*.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sanitizeConfig } from "../core/config";
import type { CommandEnvelope, SlotChoice } from "../core/commands";
import { InMemoryCommandQueue, QueueingGateway } from "../core/gateway";
import {
  CallSession,
  FallbackUnderstander,
  InMemoryJournal,
} from "../core/session";
import { scenarioEvents, type ScenarioStep } from "../core/telephony";
import { FakeCare } from "../core/testing/fakeCare";

const root = path.resolve(import.meta.dirname, "..");
const START = Date.parse("2026-09-29T08:00:00Z");
const SLOTS: SlotChoice[] = [
  {
    slotRef: "slot_001",
    start: "2026-10-01T14:00:00+02:00",
    end: "2026-10-01T14:30:00+02:00",
    practitionerRef: "prac_a",
  },
];
const config = sanitizeConfig({
  cabinetName: "Cabinet Fictif",
  practitioners: [
    { ref: "prac_a", displayName: "Docteur Fictif", aliases: [] },
  ],
  urgency: { validatedByCabinet: true },
});

const record = async (
  callId: string,
  steps: ScenarioStep[]
): Promise<CommandEnvelope[]> => {
  const care = new FakeCare("cab_fixture", SLOTS);
  const sent: CommandEnvelope[] = [];
  const transport = {
    send: async (e: CommandEnvelope) => (sent.push(e), care.send(e)),
  };
  const s = CallSession.create({
    cabinetId: "cab_fixture",
    callId,
    config,
    understander: new FallbackUnderstander(),
    gateway: new QueueingGateway(transport, new InMemoryCommandQueue()),
    availability: care,
    journal: new InMemoryJournal(),
    now: () => START,
  });
  for (const e of scenarioEvents(callId, START, true, steps)) await s.handle(e);
  return sent;
};

const out = path.join(root, "contract/fixtures");
mkdirSync(out, { recursive: true });
const write = (name: string, v: unknown) =>
  writeFileSync(path.join(out, name), `${JSON.stringify(v, null, 2)}\n`);

const message = await record("call_fixture_msg", [
  { caller: "je voudrais laisser un message" },
  { caller: "Camille Fictive" },
  { caller: "06 00 00 00 01" },
  { caller: "Merci de m'envoyer une attestation." },
  { caller: "oui" },
  { hangup: true },
]);
write("message-call.json", message);
const callback = await record("call_fixture_cbk", [
  { caller: "pouvez-vous me rappeler" },
  { caller: "Paul Fictif" },
  { caller: "06 00 00 00 02" },
  { caller: "Question sur une facture" },
  { caller: "oui" },
  { hangup: true },
]);
write("callback-call.json", callback);
const booking = await record("call_fixture_rdv", [
  { caller: "je voudrais un rendez-vous" },
  { caller: "Léa Fictive" },
  { caller: "06 00 00 00 03" },
  { caller: "oui je suis déjà venue" },
  { caller: "jeudi après-midi" },
  { caller: "le premier" },
  { caller: "oui" },
  { hangup: true },
]);
write("booking-call.json", booking);
console.log(
  JSON.stringify({
    message: message.length,
    callback: callback.length,
    booking: booking.length,
  })
);
