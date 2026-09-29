/*
 * NJP CALL — comptes rendus des appels de recette.
 *
 * En mémoire seulement : rien n'est écrit dans le navigateur. Les comptes
 * rendus des vrais appels vivent dans NJP CARE (espace Secrétariat).
 */
import { useRecetteContext } from "@/contexts/RecetteContext";

export default function History() {
  const { reports } = useRecetteContext();
  return (
    <div className="container py-8 max-w-4xl space-y-4">
      <h1 className="text-3xl font-bold">Comptes rendus de recette</h1>
      <p className="text-sm text-muted-foreground">Conservés le temps de cette page. Aucun n'a été transmis à un cabinet.</p>
      {reports.length === 0 ? (
        <p className="border-[3px] border-foreground p-4">Aucun appel de recette terminé.</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.callId} className="border-[3px] border-foreground bg-card p-4 text-sm space-y-1">
              <p className="font-heading font-semibold">{new Date(r.at).toLocaleString("fr-FR")} — issue : {r.report.outcome}</p>
              <p>{r.report.summary}</p>
              <ul className="list-disc pl-5">
                {r.report.commands.map((c) => (
                  <li key={c.idempotencyKey}>{c.type} : {c.status}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
