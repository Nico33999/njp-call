/*
 * NJP CALL — banc de recette.
 *
 * Le vrai moteur, une passerelle de simulation explicite. L'état structuré
 * (intention, phase, données obtenues, manquantes, action proposée,
 * confirmation, résultat) est affiché à côté de la conversation : c'est
 * lui, et non le texte, qui décide.
 */
import { useState } from "react";
import { useRecetteContext } from "@/contexts/RecetteContext";

const STATUS_LABEL: Record<string, string> = {
  simulated: "simulé",
  requested: "demandé",
  pending: "en attente",
  confirmed: "confirmé",
  refused: "refusé",
  failed: "échec",
  unsupported: "non pris en charge",
};

export default function Simulation() {
  const r = useRecetteContext();
  const [input, setInput] = useState("");

  const send = async () => {
    const t = input.trim();
    if (!t || !r.active) return;
    setInput("");
    await r.say(t);
  };

  return (
    <div className="container py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold mb-2">Recette</h1>
        <p role="note" className="border-[3px] border-foreground bg-secondary/40 p-3 text-sm">
          Simulation explicite : le moteur réel tourne, mais aucune opération n'atteint NJP CARE. Les créneaux proposés sont fictifs.
          N'utilisez pas de données réelles.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="border-[3px] border-foreground bg-card flex flex-col min-h-[480px]">
          <div className="border-b-[3px] border-foreground p-3 flex flex-wrap gap-2">
            {!r.active ? (
              <>
                <button type="button" className="brutal-btn" onClick={() => r.start(true)}>Appel (cabinet ouvert)</button>
                <button type="button" className="brutal-btn" onClick={() => r.start(false)}>Appel (cabinet fermé)</button>
              </>
            ) : (
              <>
                <button type="button" className="brutal-btn" onClick={() => r.dtmf("0")}>Touche 0</button>
                <button type="button" className="brutal-btn" onClick={() => r.silence()}>Silence</button>
                <button type="button" className="brutal-btn" onClick={() => r.transferResult(false)}>Transfert échoué</button>
                <button type="button" className="brutal-btn" onClick={() => r.hangup()}>Raccrocher</button>
              </>
            )}
          </div>
          <ol className="flex-1 overflow-y-auto p-4 space-y-2" aria-live="polite">
            {r.lines.map((l, i) => (
              <li key={i} className={`text-sm max-w-[85%] border-2 border-foreground px-3 py-2 ${l.role === "caller" ? "ml-auto bg-primary text-primary-foreground" : l.role === "system" ? "mx-auto bg-muted text-muted-foreground text-xs" : "bg-background"}`}>
                {l.text}
              </li>
            ))}
          </ol>
          <form className="border-t-[3px] border-foreground p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input aria-label="Réplique de l'appelant" className="flex-1 border-2 border-foreground px-3 py-2 text-sm" disabled={!r.active} value={input} onChange={(e) => setInput(e.target.value)} placeholder={r.active ? "Ce que dit l'appelant…" : "Démarrez un appel"} />
            <button type="submit" className="brutal-btn" disabled={!r.active || !input.trim()}>Envoyer</button>
          </form>
        </section>

        <aside className="space-y-4">
          <section className="border-[3px] border-foreground bg-card p-4 text-sm space-y-1">
            <h2 className="font-bold text-base mb-2">État structuré</h2>
            <p>Intention : <strong>{r.state?.intent ?? "—"}</strong></p>
            <p>Phase : <strong>{r.state?.phase ?? "—"}</strong></p>
            <p>Obtenu : {r.state ? Object.keys(r.state.collected).join(", ") || "—" : "—"}</p>
            <p>Manquant : {r.state?.missing.join(", ") || "—"}</p>
            <p>Action proposée : {r.state?.proposed?.type ?? "—"}</p>
            <p>Confirmation : {r.state?.confirmation ?? "—"}</p>
            <p>Dernier résultat : {r.state?.lastResult ? `${r.state.lastResult.type} — ${STATUS_LABEL[r.state.lastResult.status]}` : "—"}</p>
          </section>
          <section className="border-[3px] border-foreground bg-card p-4 text-sm">
            <h2 className="font-bold text-base mb-2">Commandes</h2>
            {r.commands.length === 0 ? (
              <p className="text-muted-foreground">Aucune.</p>
            ) : (
              <ul className="space-y-1">
                {r.commands.map((c) => (
                  <li key={c.envelope.idempotencyKey}>
                    <code className="text-xs">{c.envelope.idempotencyKey}</code> — {c.result ? STATUS_LABEL[c.result.status] : "en cours"}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
