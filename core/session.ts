/**
 * NJP CALL — le moteur de session d'un appel.
 *
 * ## Un journal, pas un état mutable
 *
 * Tout ce qui arrive à un appel est écrit dans un journal ordonné :
 * événements téléphoniques, compréhension produite, créneaux reçus,
 * commandes soumises, résultats reçus. L'état se **recalcule** en rejouant le
 * journal ; une session interrompue (redémarrage du service, panne) reprend
 * exactement où elle était, sans rappeler l'IA ni NJP CARE pour ce qui a déjà
 * été obtenu.
 *
 * ## Idempotence
 *
 * - Un événement téléphonique porte l'identifiant du fournisseur. Il n'est
 *   tenu pour EXÉCUTÉ que lorsque la réponse faite à l'appelant (`output`)
 *   est journalisée. Reçu de nouveau après cela, la même réponse est
 *   **rejouée** (`duplicate: true`) : si la réponse HTTP au fournisseur s'est
 *   perdue, l'appelant entend la même chose, et rien n'est refait. Reçu de
 *   nouveau AVANT cela (panne en cours de traitement), il est retraité — avec
 *   la même compréhension et les mêmes clés de commande.
 * - Le journal est adressé par (cabinet, appel) : deux cabinets peuvent
 *   recevoir le même identifiant d'appel sans jamais se mélanger.
 * - À la clôture, le journal est compacté : il ne garde que les identifiants
 *   d'événements, sans aucun propos de l'appelant.
 * - Une commande porte une clé stable (`callId/type/rang`). Si le service
 *   tombe entre l'envoi et la réponse, la reprise renvoie **la même clé** :
 *   NJP CARE rend le résultat déjà enregistré au lieu de créer un doublon.
 */
import {
  type ActionStatus,
  type CallReportPayload,
  type Command,
  type CommandEnvelope,
  type CommandResult,
  type CommandType,
  makeEnvelope,
} from "./commands";
import type { CabinetConfig } from "./config";
import {
  fallbackUnderstand,
  initialState,
  validateUnderstanding,
  type ConversationState,
  type Understanding,
  expectOf,
  type Expect,
} from "./conversation";
import { DEGRADED_NOTICE } from "./emergency";
import {
  greet,
  onAvailability,
  onCallerTurn,
  onResult,
  onTransferResult,
  type Decision,
  type EngineContext,
} from "./engine";
import type {
  AvailabilityReader,
  AvailabilityResult,
  CareGateway,
} from "./gateway";
import { readFrenchPhone } from "./datetime";

// ---------------------------------------------------------------------------
// Événements téléphoniques (indépendants du fournisseur)
// ---------------------------------------------------------------------------

export type TelephonyEvent =
  | { id: string; type: "call.started"; at: string; open: boolean }
  | {
      id: string;
      type: "caller.utterance";
      at: string;
      text: string;
      bargeIn?: boolean;
      confidence?: number;
    }
  | { id: string; type: "caller.dtmf"; at: string; digits: string }
  | { id: string; type: "caller.silence"; at: string; ms: number }
  | { id: string; type: "transfer.result"; at: string; connected: boolean }
  | {
      id: string;
      type: "call.ended";
      at: string;
      reason: "hangup" | "completed" | "network" | "error";
    };

export type JournalEntry =
  | { k: "event"; event: TelephonyEvent }
  | { k: "understanding"; eventId: string; u: Understanding; degraded: boolean }
  | { k: "availability"; result: AvailabilityResult }
  | { k: "submitted"; envelope: CommandEnvelope }
  | { k: "result"; result: CommandResult }
  /** L'événement est exécuté : voici exactement ce qui a été répondu. */
  | { k: "output"; eventId: string; out: SessionOutput }
  /** Appel clos et compacté : plus aucun propos conservé. */
  | { k: "closed"; at: string; eventIds: string[] };

/** Ce que le fournisseur doit faire après un événement. */
export interface SessionOutput {
  say: string[];
  transferTo?: string;
  hangup: boolean;
  /** Vrai si l'événement était un doublon déjà traité : la réponse est REJOUÉE. */
  duplicate?: boolean;
  /** Ce qu'on attend de l'appelant ensuite (réglage de la fin de parole). */
  expect?: Expect;
}

/** Une session est désignée par son cabinet ET son appel. */
export interface SessionKey {
  cabinetId: string;
  callId: string;
}

// ---------------------------------------------------------------------------
// Compréhension
// ---------------------------------------------------------------------------

export interface Understander {
  understand(
    utterance: string,
    state: ConversationState,
    config: CabinetConfig
  ): Promise<Understanding>;
}

export class FallbackUnderstander implements Understander {
  async understand(utterance: string, state: ConversationState) {
    return fallbackUnderstand(utterance, state);
  }
}

// ---------------------------------------------------------------------------
// Journal durable
// ---------------------------------------------------------------------------

export interface JournalStore {
  append(key: SessionKey, entry: JournalEntry): Promise<void>;
  load(key: SessionKey): Promise<JournalEntry[]>;
  /** Remplace le journal d'un appel clos par une pierre tombale sans propos. */
  compact(
    key: SessionKey,
    tombstone: Extract<JournalEntry, { k: "closed" }>
  ): Promise<void>;
}

const keyOf = (k: SessionKey) => `${k.cabinetId}\u0000${k.callId}`;

/** Pour les tests seulement : le service refuse de démarrer sans stockage durable. */
export class InMemoryJournal implements JournalStore {
  readonly calls = new Map<string, JournalEntry[]>();
  async append(key: SessionKey, entry: JournalEntry) {
    const list = this.calls.get(keyOf(key)) ?? [];
    list.push(structuredClone(entry));
    this.calls.set(keyOf(key), list);
  }
  async load(key: SessionKey) {
    return structuredClone(this.calls.get(keyOf(key)) ?? []);
  }
  async compact(
    key: SessionKey,
    tombstone: Extract<JournalEntry, { k: "closed" }>
  ) {
    this.calls.set(keyOf(key), [structuredClone(tombstone)]);
  }
}

export interface SessionDeps {
  cabinetId: string;
  callId: string;
  config: CabinetConfig;
  understander: Understander;
  gateway: CareGateway;
  availability: AvailabilityReader;
  journal: JournalStore;
  now: () => number;
  /**
   * Points d'observation nommés (bancs de panne uniquement) : le service de
   * recette peut y interrompre le processus pour prouver la reprise.
   */
  probe?: (point: SessionProbe) => void;
}

export type SessionProbe =
  | "event_recorded"
  | "command_recorded"
  | "result_recorded"
  | "output_recorded";

interface Tracked {
  envelope: CommandEnvelope;
  result?: CommandResult;
}

export class CallSession {
  state: ConversationState = initialState();
  readonly commands: Tracked[] = [];
  private seen = new Set<string>();
  /** Réponse faite pour chaque événement exécuté, rejouée en cas de doublon. */
  private outputs = new Map<string, SessionOutput>();
  /** Appel clos et compacté : les doublons n'obtiennent qu'un raccrochage. */
  private closedTombstone = false;
  /** Ce qu'un traitement interrompu avait déjà obtenu, réutilisé à la reprise. */
  private carried = {
    understandings: new Map<string, { u: Understanding; degraded: boolean }>(),
    results: new Map<string, CommandResult>(),
  };
  private ordinals = new Map<CommandType, number>();
  private seq = 0;
  private silences = 0;
  private startedAt?: string;
  private reported = false;
  degraded = false;

  private constructor(private readonly deps: SessionDeps) {}

  static create(deps: SessionDeps) {
    return new CallSession(deps);
  }

  /** Reconstruit une session depuis son journal, puis termine ce qui était en vol. */
  static async resume(deps: SessionDeps): Promise<CallSession> {
    const s = new CallSession(deps);
    const log = await deps.journal.load(s.key);
    await s.replay(log);
    // Une commande soumise sans résultat connu : on la renvoie avec la MÊME clé.
    for (const t of s.commands) {
      if (!t.result) {
        const result = await deps.gateway.submit(t.envelope);
        await s.record({ k: "result", result });
        s.applyResult(result);
      }
    }
    return s;
  }

  /** Instant de l'événement en cours : le rejeu calcule avec l'heure d'origine. */
  private eventAt?: string;

  private ctx(): EngineContext {
    const at = this.eventAt ? Date.parse(this.eventAt) : NaN;
    return {
      config: this.deps.config,
      nowMs: Number.isNaN(at) ? this.deps.now() : at,
    };
  }

  get key(): SessionKey {
    return { cabinetId: this.deps.cabinetId, callId: this.deps.callId };
  }

  private async record(entry: JournalEntry) {
    await this.deps.journal.append(this.key, entry);
  }

  /**
   * Découpe le journal en segments (un événement et ce qu'il a produit).
   * Seuls les segments TERMINÉS (réponse journalisée) sont rejoués ; un
   * segment interrompu laisse sa compréhension et ses résultats en réserve,
   * et l'événement sera retraité quand le fournisseur le renverra.
   */
  private async replay(full: JournalEntry[]) {
    const closed = full.find(
      (e): e is Extract<JournalEntry, { k: "closed" }> => e.k === "closed"
    );
    if (closed) {
      this.closedTombstone = true;
      this.reported = true;
      this.state.phase = "ended";
      for (const id of closed.eventIds) this.seen.add(id);
      return;
    }
    const segments: JournalEntry[][] = [];
    for (const e of full) {
      if (e.k === "event") segments.push([e]);
      else if (segments.length) segments[segments.length - 1].push(e);
    }
    const log: JournalEntry[] = [];
    for (const seg of segments) {
      const done = seg.find(
        (e): e is Extract<JournalEntry, { k: "output" }> => e.k === "output"
      );
      if (done) {
        log.push(...seg);
        this.outputs.set(done.eventId, done.out);
      } else {
        for (const e of seg) {
          if (e.k === "understanding")
            this.carried.understandings.set(e.eventId, {
              u: e.u,
              degraded: e.degraded,
            });
          if (e.k === "result")
            this.carried.results.set(e.result.idempotencyKey, e.result);
        }
      }
    }
    await this.replayLog(log);
  }

  /** Rejoue sans appeler ni l'IA, ni NJP CARE. */
  private async replayLog(log: JournalEntry[]) {
    const understandings = new Map<
      string,
      { u: Understanding; degraded: boolean }
    >();
    for (const e of log)
      if (e.k === "understanding") understandings.set(e.eventId, e);
    let pendingAvailability: AvailabilityResult[] = log
      .filter(
        (e): e is Extract<JournalEntry, { k: "availability" }> =>
          e.k === "availability"
      )
      .map(e => e.result);
    const results = new Map<string, CommandResult>();
    for (const e of log)
      if (e.k === "result") results.set(e.result.idempotencyKey, e.result);
    for (const e of log) {
      if (e.k === "submitted") {
        this.seq = Math.max(this.seq, e.envelope.seq);
        this.ordinals.set(
          e.envelope.command.type,
          Math.max(
            this.ordinals.get(e.envelope.command.type) ?? 0,
            Number(e.envelope.idempotencyKey.split("/")[2])
          )
        );
        // L'enveloppe du journal fait foi : c'est elle qui a été envoyée.
        const existing = this.commands.find(
          c => c.envelope.idempotencyKey === e.envelope.idempotencyKey
        );
        if (existing) existing.envelope = e.envelope;
        else this.commands.push({ envelope: e.envelope });
      }
      if (e.k !== "event") continue;
      this.seen.add(e.event.id);
      const pre = understandings.get(e.event.id);
      await this.apply(e.event, {
        understanding: pre,
        availability: () => {
          const [first, ...rest] = pendingAvailability;
          pendingAvailability = rest;
          return first;
        },
        results,
      });
    }
  }

  /** Point d'entrée : un événement du fournisseur téléphonique. */
  async handle(event: TelephonyEvent): Promise<SessionOutput> {
    if (this.seen.has(event.id)) {
      const previous = this.outputs.get(event.id);
      if (previous) return { ...structuredClone(previous), duplicate: true };
      // Appel clos (compacté) ou traitement concurrent : rien n'est refait.
      return { say: [], hangup: this.closedTombstone, duplicate: true };
    }
    if (this.closedTombstone) return { say: [], hangup: true, duplicate: true };
    this.seen.add(event.id);
    await this.record({ k: "event", event });
    this.deps.probe?.("event_recorded");
    const out = await this.apply(event);
    if (!out.hangup && !out.transferTo && out.say.length) out.expect = expectOf(this.state);
    // L'événement n'est EXÉCUTÉ qu'à partir d'ici.
    this.outputs.set(event.id, structuredClone(out));
    await this.record({ k: "output", eventId: event.id, out });
    this.deps.probe?.("output_recorded");
    if (this.ended && this.reported) {
      await this.deps.journal.compact(this.key, {
        k: "closed",
        at: event.at,
        eventIds: Array.from(this.seen),
      });
      this.closedTombstone = true;
    }
    return out;
  }

  private async apply(
    event: TelephonyEvent,
    replay?: {
      understanding?: { u: Understanding; degraded: boolean };
      availability: () => AvailabilityResult | undefined;
      results: Map<string, CommandResult>;
    }
  ): Promise<SessionOutput> {
    const out: SessionOutput = { say: [], hangup: false };
    this.eventAt = event.at;
    switch (event.type) {
      case "call.started": {
        this.startedAt = event.at;
        const d = greet(this.state, this.ctx(), event.open);
        this.state = d.state;
        out.say.push(...d.say);
        return out;
      }
      case "caller.silence": {
        this.silences += 1;
        if (this.silences >= 3) {
          out.say.push(
            "Je n'entends plus rien. Je vais raccrocher ; n'hésitez pas à rappeler."
          );
          out.hangup = true;
          await this.close(event.at, "abandoned", !!replay);
        } else out.say.push("Êtes-vous toujours là ?");
        return out;
      }
      case "caller.dtmf": {
        // Touche 0 : un humain. Dix chiffres pendant la demande de numéro : le numéro.
        const text =
          event.digits === "0"
            ? "je veux parler à quelqu'un"
            : readFrenchPhone(event.digits)
              ? event.digits
              : "";
        if (!text) return out;
        return this.apply(
          { id: event.id, type: "caller.utterance", at: event.at, text },
          replay
        );
      }
      case "caller.utterance": {
        this.silences = 0;
        let u: Understanding;
        if (replay?.understanding) {
          u = replay.understanding.u;
          this.degraded = replay.understanding.degraded;
        } else if (replay) {
          u = fallbackUnderstand(event.text, this.state);
        } else if (this.carried.understandings.has(event.id)) {
          // Traitement interrompu puis repris : la compréhension déjà obtenue
          // est réutilisée (pas de second appel à l'IA, même décision).
          const c = this.carried.understandings.get(event.id)!;
          u = c.u;
          this.degraded ||= c.degraded;
          await this.record({
            k: "understanding",
            eventId: event.id,
            u,
            degraded: c.degraded,
          });
        } else {
          let degraded = false;
          try {
            u = validateUnderstanding(
              await this.deps.understander.understand(
                event.text,
                this.state,
                this.deps.config
              )
            );
          } catch {
            degraded = true;
            if (this.deps.config.degradedMode === "notice_only") {
              out.say.push(DEGRADED_NOTICE);
              out.hangup = true;
              await this.close(event.at, "failed", false);
              return out;
            }
            u = fallbackUnderstand(event.text, this.state);
          }
          this.degraded ||= degraded;
          await this.record({
            k: "understanding",
            eventId: event.id,
            u,
            degraded,
          });
        }
        const d = onCallerTurn(this.state, event.text, u, this.ctx());
        return this.follow(d, event.at, out, replay);
      }
      case "transfer.result": {
        const d = onTransferResult(this.state, event.connected, this.ctx());
        this.state = d.state;
        out.say.push(...d.say);
        if (d.end) {
          out.hangup = true;
          await this.close(event.at, "transfer", !!replay);
        }
        return out;
      }
      case "call.ended": {
        await this.close(event.at, this.outcome(), !!replay);
        out.hangup = true;
        return out;
      }
    }
  }

  /** Exécute ce que le moteur a décidé : recherche de créneaux, commande, fin. */
  private async follow(
    d: Decision,
    at: string,
    out: SessionOutput,
    replay?: {
      availability: () => AvailabilityResult | undefined;
      results: Map<string, CommandResult>;
    }
  ): Promise<SessionOutput> {
    this.state = d.state;
    out.say.push(...d.say);
    if (d.availability) {
      let result = replay?.availability();
      if (!result) {
        if (replay) return out; // coupure pendant la recherche : on s'arrête là, la reprise redemandera
        try {
          result = await this.deps.availability.findSlots(
            this.deps.cabinetId,
            d.availability
          );
        } catch {
          result = {
            status: "failed",
            slots: [],
            reason: "availability_unreachable",
          };
        }
        await this.record({ k: "availability", result });
      }
      return this.follow(
        onAvailability(this.state, result, this.ctx()),
        at,
        out,
        replay
      );
    }
    if (d.command) {
      if (d.command.type === "call.transfer") {
        const tracked = await this.submit(d.command, at, replay?.results);
        if (
          tracked.result &&
          (tracked.result.status === "confirmed" ||
            tracked.result.status === "requested")
        ) {
          out.transferTo = d.command.payload.destinationRef;
        } else {
          return this.follow(
            onTransferResult(this.state, false, this.ctx()),
            at,
            out,
            replay
          );
        }
        return out;
      }
      const tracked = await this.submit(d.command, at, replay?.results);
      if (!tracked.result) return out; // coupure : la reprise renverra la même clé
      return this.follow(
        onResult(this.state, tracked.result, this.ctx()),
        at,
        out,
        replay
      );
    }
    if (d.end) {
      out.hangup = true;
      await this.close(at, this.outcome(), !!replay);
    }
    return out;
  }

  private nextOrdinal(type: CommandType) {
    const n = (this.ordinals.get(type) ?? 0) + 1;
    this.ordinals.set(type, n);
    return n;
  }

  private async submit(
    command: Command,
    at: string,
    replayResults?: Map<string, CommandResult>
  ): Promise<Tracked> {
    const ordinal = this.nextOrdinal(command.type);
    this.seq += 1;
    const envelope = makeEnvelope(
      this.deps.cabinetId,
      this.deps.callId,
      this.seq,
      ordinal,
      command,
      at
    );
    let tracked = this.commands.find(
      c => c.envelope.idempotencyKey === envelope.idempotencyKey
    );
    if (!tracked) {
      tracked = { envelope };
      this.commands.push(tracked);
      if (!replayResults) {
        await this.record({ k: "submitted", envelope });
        this.deps.probe?.("command_recorded");
      }
    }
    if (replayResults) {
      const r = replayResults.get(envelope.idempotencyKey);
      if (r) tracked.result = r;
      return tracked;
    }
    // Un résultat obtenu avant une interruption est réutilisé tel quel ; sinon
    // on (re)soumet avec la même clé, et NJP CARE rejoue son verdict.
    const result =
      this.carried.results.get(envelope.idempotencyKey) ??
      (await this.deps.gateway.submit(envelope));
    tracked.result = result;
    await this.record({ k: "result", result });
    this.deps.probe?.("result_recorded");
    return tracked;
  }

  private applyResult(result: CommandResult) {
    const t = this.commands.find(
      c => c.envelope.idempotencyKey === result.idempotencyKey
    );
    if (t) t.result = result;
    if (
      t &&
      t.envelope.command.type !== "call.report" &&
      t.envelope.command.type !== "call.transfer"
    ) {
      this.state = onResult(this.state, result, this.ctx()).state;
    }
  }

  private outcome(): CallReportPayload["outcome"] {
    const done = this.commands.filter(
      c => c.result && c.envelope.command.type !== "call.report"
    );
    const last = done[done.length - 1];
    if (!last) return this.state.handoffReason ? "transfer" : "abandoned";
    return (
      {
        "message.create": "message",
        "callback.request": "callback",
        "appointment.request": "appointment",
        "appointment.book": "appointment",
        "appointment.reschedule": "appointment",
        "appointment.cancel": "appointment",
        "call.transfer": "transfer",
        "call.report": "information",
      } as const
    )[last.envelope.command.type];
  }

  /** Compte rendu administratif : ce qui a été demandé, et ce qui a RÉELLEMENT eu lieu. */
  report(
    endedAt: string,
    outcome: CallReportPayload["outcome"]
  ): CallReportPayload {
    const commands = this.commands
      .filter(c => c.envelope.command.type !== "call.report")
      .map(c => ({
        idempotencyKey: c.envelope.idempotencyKey,
        type: c.envelope.command.type,
        status: (c.result?.status ?? "failed") as ActionStatus,
        ...(c.result?.reference ? { reference: c.result.reference } : {}),
      }));
    const lines = commands.map(c => `${c.type} : ${c.status}`);
    const summary = [
      `Appel traité par l'assistante automatisée.`,
      this.state.intent ? `Demande : ${this.state.intent}.` : "",
      lines.length ? `Opérations : ${lines.join(" ; ")}.` : "Aucune opération.",
      this.state.handoffReason
        ? `Passage à un humain : ${this.state.handoffReason}.`
        : "",
      this.state.injectionAttempts
        ? `Tentatives de détournement refusées : ${this.state.injectionAttempts}.`
        : "",
      this.degraded ? "Compréhension en mode dégradé." : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 600);
    return {
      startedAt: this.startedAt ?? endedAt,
      endedAt,
      outcome,
      summary,
      commands,
    };
  }

  private async close(
    at: string,
    outcome: CallReportPayload["outcome"],
    replaying: boolean
  ) {
    if (this.reported) return;
    this.reported = true;
    this.state.phase = "ended";
    if (
      replaying &&
      this.commands.some(c => c.envelope.command.type === "call.report")
    )
      return;
    await this.submit(
      { type: "call.report", payload: this.report(at, outcome) },
      at,
      replaying ? new Map() : undefined
    );
  }

  /** Appel clos et compacté : la session peut quitter le cache. */
  get closed() {
    return this.closedTombstone;
  }

  get ended() {
    return this.state.phase === "ended";
  }
}
