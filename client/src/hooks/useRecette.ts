/**
 * Banc de recette dans le navigateur.
 *
 * Il exécute le VRAI moteur (session, règles, reformulation, idempotence),
 * mais contre une passerelle de **simulation explicite** : rien n'est envoyé
 * à NJP CARE, aucun rendez-vous n'est pris, aucun message ne part. Chaque
 * résultat porte le statut `simulated`, et l'assistante le dit.
 *
 * Les créneaux proposés sont fictifs et marqués comme tels.
 */
import { useCallback, useRef, useState } from "react";
import type { CallReportPayload, CommandEnvelope, CommandResult, SlotChoice } from "../../../core/commands";
import type { CabinetConfig } from "../../../core/config";
import type { ConversationState } from "../../../core/conversation";
import { SimulationGateway, type AvailabilityReader } from "../../../core/gateway";
import { CallSession, FallbackUnderstander, InMemoryJournal, type TelephonyEvent } from "../../../core/session";

export interface RecetteLine {
  role: "caller" | "assistant" | "system";
  text: string;
}

export interface RecetteReport {
  callId: string;
  at: string;
  report: CallReportPayload;
}

/** Créneaux fictifs, à partir de demain, pour exercer le parcours de rendez-vous. */
const simulatedAvailability = (config: CabinetConfig): AvailabilityReader => ({
  async findSlots(_cabinet, query) {
    const practitionerRef = query.practitionerRef ?? config.practitioners[0]?.ref ?? "prac_demo";
    const base = new Date();
    base.setDate(base.getDate() + 1);
    const slots: SlotChoice[] = [10, 14, 16].map((h, i) => {
      const s = new Date(base);
      s.setHours(h, 0, 0, 0);
      const e = new Date(s.getTime() + 30 * 60000);
      return { slotRef: `sim_slot_${i + 1}`, start: s.toISOString().replace(/\.\d{3}Z$/, "Z"), end: e.toISOString().replace(/\.\d{3}Z$/, "Z"), practitionerRef };
    });
    const inWindow = slots.filter((s) => !query.windows.length || query.windows.some((w) => s.start >= w.from && s.end <= w.to));
    return { status: "simulated", slots: (inWindow.length ? inWindow : slots).slice(0, query.limit) };
  },
});

export function useRecette(config: CabinetConfig) {
  const [lines, setLines] = useState<RecetteLine[]>([]);
  const [state, setState] = useState<ConversationState | null>(null);
  const [commands, setCommands] = useState<{ envelope: CommandEnvelope; result?: CommandResult }[]>([]);
  const [reports, setReports] = useState<RecetteReport[]>([]);
  const [active, setActive] = useState(false);
  const session = useRef<CallSession | null>(null);
  const callId = useRef("");
  const n = useRef(0);

  const push = (l: RecetteLine[]) => setLines((prev) => [...prev, ...l]);
  const sync = () => {
    const s = session.current;
    if (!s) return;
    setState(structuredClone(s.state));
    setCommands(s.commands.map((c) => ({ envelope: c.envelope, result: c.result })));
  };

  const emit = useCallback(async (event: TelephonyEvent) => {
    const s = session.current;
    if (!s) return;
    const out = await s.handle(event);
    push(out.say.map((text) => ({ role: "assistant" as const, text })));
    if (out.transferTo) push([{ role: "system", text: `Transfert demandé vers « ${out.transferTo} » (simulé).` }]);
    sync();
    if (out.hangup || s.ended) {
      setActive(false);
      const report = s.commands.find((c) => c.envelope.command.type === "call.report");
      if (report) setReports((r) => [{ callId: callId.current, at: new Date().toISOString(), report: report.envelope.command.payload as CallReportPayload }, ...r]);
      push([{ role: "system", text: "Appel terminé." }]);
    }
  }, []);

  const start = useCallback(
    async (open: boolean) => {
      callId.current = `recette_${Date.now().toString(36)}`;
      session.current = CallSession.create({
        cabinetId: "cabinet_recette",
        callId: callId.current,
        config,
        understander: new FallbackUnderstander(),
        gateway: new SimulationGateway(true),
        availability: simulatedAvailability(config),
        journal: new InMemoryJournal(),
        now: () => Date.now(),
      });
      setLines([{ role: "system", text: "Simulation : aucune opération réelle ne sera effectuée." }]);
      setActive(true);
      await emit({ id: `${callId.current}-${++n.current}`, type: "call.started", at: new Date().toISOString(), open });
    },
    [config, emit],
  );

  const at = () => new Date().toISOString();
  const id = () => `${callId.current}-${++n.current}`;
  return {
    lines,
    state,
    commands,
    reports,
    active,
    start,
    say: async (text: string) => {
      push([{ role: "caller", text }]);
      await emit({ id: id(), type: "caller.utterance", at: at(), text });
    },
    dtmf: (digits: string) => emit({ id: id(), type: "caller.dtmf", at: at(), digits }),
    silence: () => emit({ id: id(), type: "caller.silence", at: at(), ms: 5000 }),
    transferResult: (connected: boolean) => emit({ id: id(), type: "transfer.result", at: at(), connected }),
    hangup: () => emit({ id: id(), type: "call.ended", at: at(), reason: "hangup" }),
  };
}
