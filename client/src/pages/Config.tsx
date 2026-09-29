/*
 * NJP CALL — configuration publique du cabinet.
 *
 * Tout ce qui est ici peut être exporté sans risque : aucun secret, aucun
 * numéro de transfert (une destination est un libellé et une référence ; le
 * numéro vit côté service).
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { activationBlockers, exportConfig, importConfig, type CabinetConfig } from "../../../core/config";
import { DEFAULT_URGENCY_NOTICE } from "../../../core/emergency";

const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const BLOCKERS: Record<string, string> = {
  cabinet_name: "Nom du cabinet manquant",
  opening_hours: "Horaires d'ouverture manquants",
  urgency_notice_not_validated: "Consigne d'urgence non validée par le cabinet",
  simulation_enabled: "Mode simulation encore actif",
};

const field = "w-full border-2 border-foreground bg-background px-3 py-2 text-sm";
const label = "block text-sm font-heading font-semibold mb-1";
const card = "border-[3px] border-foreground bg-card p-5 space-y-4";

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "ref";

export default function Config() {
  const { config, update, replace, reset, dropped } = useConfig();
  const [draft, setDraft] = useState({ practitioner: "", type: "", typeDuration: 30, destination: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const blockers = activationBlockers(config);

  const setHours = (weekday: number, from: string, to: string, on: boolean) => {
    const rest = config.openingHours.filter((p) => p.weekday !== weekday);
    update({ openingHours: on ? [...rest, { weekday, from, to }].sort((a, b) => a.weekday - b.weekday) : rest });
  };

  const download = () => {
    const blob = new Blob([exportConfig(config)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "njp-call-configuration.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (f: File) => {
    try {
      const { config: next, dropped: d } = importConfig(await f.text());
      replace(next);
      toast.success(d.length ? `Configuration importée. Données sensibles ignorées : ${d.join(", ")}.` : "Configuration importée.");
    } catch {
      toast.error("Fichier illisible.");
    }
  };

  return (
    <div className="container py-8 max-w-4xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold mb-2">Configuration</h1>
        <p className="text-muted-foreground text-sm">Réglages publics de l'assistante. Les accès téléphoniques et les secrets sont gérés côté service, jamais dans ce navigateur.</p>
      </header>

      {dropped.length > 0 && (
        <div role="status" className="border-[3px] border-foreground bg-secondary/40 p-4 text-sm">
          L'ancienne configuration contenait des données de connexion (<code>{dropped.join(", ")}</code>). Elles ont été supprimées de ce navigateur ; elles se configurent désormais côté service.
        </div>
      )}

      <section className={card}>
        <h2 className="text-xl font-bold">Assistante</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label} htmlFor="assistantName">Nom de l'assistante</label>
            <input id="assistantName" className={field} value={config.assistantName} onChange={(e) => update({ assistantName: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="cabinetName">Nom du cabinet</label>
            <input id="cabinetName" className={field} value={config.cabinetName} onChange={(e) => update({ cabinetName: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">L'assistante s'annonce toujours comme automatisée ; ce message ne peut pas être retiré.</p>
        <div>
          <label className={label} htmlFor="greeting">Complément d'accueil (heures d'ouverture)</label>
          <textarea id="greeting" className={field} rows={2} value={config.greeting} onChange={(e) => update({ greeting: e.target.value })} />
        </div>
        <div>
          <label className={label} htmlFor="closedGreeting">Complément d'accueil (cabinet fermé)</label>
          <textarea id="closedGreeting" className={field} rows={2} value={config.closedGreeting} onChange={(e) => update({ closedGreeting: e.target.value })} />
        </div>
        <div>
          <label className={label} htmlFor="afterHours">Hors horaires</label>
          <select id="afterHours" className={field} value={config.afterHours} onChange={(e) => update({ afterHours: e.target.value as CabinetConfig["afterHours"] })}>
            <option value="message">Prendre un message</option>
            <option value="callback">Enregistrer une demande de rappel</option>
            <option value="notice_only">Informer seulement</option>
          </select>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Horaires</h2>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const p = config.openingHours.find((x) => x.weekday === d);
          return (
            <div key={d} className="flex items-center gap-3 text-sm">
              <label className="w-28 flex items-center gap-2">
                <input type="checkbox" checked={!!p} onChange={(e) => setHours(d, p?.from ?? "09:00", p?.to ?? "18:00", e.target.checked)} /> {DAYS[d]}
              </label>
              {p && (
                <>
                  <input type="time" aria-label={`Ouverture ${DAYS[d]}`} className="border-2 border-foreground px-2 py-1" value={p.from} onChange={(e) => setHours(d, e.target.value, p.to, true)} />
                  <span>–</span>
                  <input type="time" aria-label={`Fermeture ${DAYS[d]}`} className="border-2 border-foreground px-2 py-1" value={p.to} onChange={(e) => setHours(d, p.from, e.target.value, true)} />
                </>
              )}
            </div>
          );
        })}
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Praticiens, rendez-vous, transferts</h2>
        <p className="text-xs text-muted-foreground">Dans NJP CARE, ces références sont reprises du logiciel. Ici, elles servent à la recette.</p>
        <ListEditor
          title="Praticiens"
          items={config.practitioners.map((p) => ({ ref: p.ref, label: p.displayName }))}
          value={draft.practitioner}
          onChange={(v) => setDraft({ ...draft, practitioner: v })}
          onAdd={() => {
            update({ practitioners: [...config.practitioners, { ref: `prac_${slug(draft.practitioner)}`, displayName: draft.practitioner, aliases: [] }] });
            setDraft({ ...draft, practitioner: "" });
          }}
          onRemove={(ref) => update({ practitioners: config.practitioners.filter((p) => p.ref !== ref) })}
        />
        <ListEditor
          title="Types de rendez-vous"
          items={config.appointmentTypes.map((t) => ({ ref: t.ref, label: `${t.label} (${t.durationMin} min)` }))}
          value={draft.type}
          onChange={(v) => setDraft({ ...draft, type: v })}
          onAdd={() => {
            update({ appointmentTypes: [...config.appointmentTypes, { ref: `type_${slug(draft.type)}`, label: draft.type, durationMin: draft.typeDuration, newPatientAllowed: true }] });
            setDraft({ ...draft, type: "" });
          }}
          onRemove={(ref) => update({ appointmentTypes: config.appointmentTypes.filter((t) => t.ref !== ref) })}
        />
        <ListEditor
          title="Destinations de transfert (libellé seulement)"
          items={config.transferDestinations.map((t) => ({ ref: t.ref, label: t.label }))}
          value={draft.destination}
          onChange={(v) => setDraft({ ...draft, destination: v })}
          onAdd={() => {
            update({ transferDestinations: [...config.transferDestinations, { ref: `dest_${slug(draft.destination)}`, label: draft.destination }] });
            setDraft({ ...draft, destination: "" });
          }}
          onRemove={(ref) => update({ transferDestinations: config.transferDestinations.filter((t) => t.ref !== ref) })}
        />
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Consigne en cas de détresse exprimée</h2>
        <p className="text-sm text-muted-foreground">NJP CALL n'évalue aucune situation médicale. Quand un appelant exprime une détresse, l'assistante lit cette consigne et propose un humain si une destination est prévue.</p>
        <textarea aria-label="Consigne d'urgence" className={field} rows={3} value={config.urgency.notice ?? DEFAULT_URGENCY_NOTICE} onChange={(e) => update({ urgency: { ...config.urgency, notice: e.target.value, validatedByCabinet: false } })} />
        <select aria-label="Destination humaine" className={field} value={config.urgency.humanDestinationRef ?? ""} onChange={(e) => update({ urgency: { ...config.urgency, humanDestinationRef: e.target.value || undefined } })}>
          <option value="">Aucun transfert</option>
          {config.transferDestinations.map((d) => (
            <option key={d.ref} value={d.ref}>{d.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.urgency.validatedByCabinet} onChange={(e) => update({ urgency: { ...config.urgency, validatedByCabinet: e.target.checked } })} />
          Le cabinet a relu et valide cette consigne
        </label>
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Rappels, conservation, secours</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.reminders.enabled} onChange={(e) => update({ reminders: { ...config.reminders, enabled: e.target.checked } })} /> Rappels automatiques de rendez-vous
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={label} htmlFor="hoursBefore">Délai du rappel (heures avant)</label>
            <input id="hoursBefore" type="number" min={2} max={96} className={field} value={config.reminders.hoursBefore} onChange={(e) => update({ reminders: { ...config.reminders, hoursBefore: Number(e.target.value) } })} />
          </div>
          <div>
            <label className={label} htmlFor="retention">Conservation des comptes rendus (jours)</label>
            <input id="retention" type="number" min={1} max={3650} className={field} value={config.retention.callRecordDays} onChange={(e) => update({ retention: { callRecordDays: Number(e.target.value), storeAudio: false } })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">L'audio des appels n'est pas conservé.</p>
        <div>
          <label className={label} htmlFor="degraded">Si la compréhension automatique est indisponible</label>
          <select id="degraded" className={field} value={config.degradedMode} onChange={(e) => update({ degradedMode: e.target.value as CabinetConfig["degradedMode"] })}>
            <option value="message_only">Continuer en prise de message guidée</option>
            <option value="notice_only">Informer et raccrocher</option>
          </select>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Consignes et connaissances du cabinet</h2>
        <p className="text-sm text-muted-foreground">Elles complètent les règles de NJP CALL (secrétariat administratif, aucune donnée inventée, aucun conseil médical…) et ne peuvent pas les remplacer.</p>
        <textarea aria-label="Consignes du cabinet" className={field} rows={4} value={config.cabinetInstructions} onChange={(e) => update({ cabinetInstructions: e.target.value })} />
        <textarea aria-label="Connaissances du cabinet" className={field} rows={4} placeholder="Accès, parking, documents à apporter…" value={config.cabinetKnowledge} onChange={(e) => update({ cabinetKnowledge: e.target.value })} />
      </section>

      <section className={card}>
        <h2 className="text-xl font-bold">Activation</h2>
        {blockers.length ? (
          <ul className="list-disc pl-5 text-sm">{blockers.map((b) => <li key={b}>{BLOCKERS[b] ?? b}</li>)}</ul>
        ) : (
          <p className="text-sm">Aucun point bloquant côté configuration. L'activation se fait dans NJP CARE, après installation depuis le Store.</p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="brutal-btn" onClick={download}>Exporter</button>
          <button type="button" className="brutal-btn" onClick={() => fileRef.current?.click()}>Importer</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button type="button" className="brutal-btn" onClick={reset}>Réinitialiser</button>
        </div>
      </section>
    </div>
  );
}

function ListEditor(props: {
  title: string;
  items: { ref: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (ref: string) => void;
}) {
  return (
    <div>
      <p className={label}>{props.title}</p>
      <ul className="text-sm mb-2 space-y-1">
        {props.items.map((i) => (
          <li key={i.ref} className="flex items-center justify-between border-2 border-foreground px-2 py-1">
            <span>{i.label} <code className="text-xs text-muted-foreground">{i.ref}</code></span>
            <button type="button" className="text-xs underline" onClick={() => props.onRemove(i.ref)}>Retirer</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input aria-label={`Ajouter — ${props.title}`} className={field} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
        <button type="button" className="brutal-btn" disabled={!props.value.trim()} onClick={props.onAdd}>Ajouter</button>
      </div>
    </div>
  );
}
