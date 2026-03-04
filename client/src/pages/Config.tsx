/*
 * Design: Signal — Néo-Brutaliste Télécom
 * Page de configuration avec formulaire structuré en sections
 * Bordures épaisses, ombres décalées, inputs avec style brutal
 */
import { useConfig } from "@/contexts/ConfigContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  User, Building2, Clock, Globe, Mail, Calendar, Phone, Headphones,
  Plus, Trash2, RotateCcw, Save, ChevronDown, ChevronUp
} from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";

interface SectionProps {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, icon: Icon, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="brutal-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 bg-secondary/50 border-b-2 border-foreground hover:bg-secondary transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary flex items-center justify-center border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground">
            <Icon className="w-5 h-5 text-primary-foreground" />
          </div>
          <h2 className="font-heading text-lg font-bold">{title}</h2>
        </div>
        {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="p-5 space-y-5"
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

function FieldRow({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div className={`grid gap-5 ${cols === 3 ? "sm:grid-cols-3" : cols === 1 ? "grid-cols-1" : "sm:grid-cols-2"}`}>
      {children}
    </div>
  );
}

export default function Config() {
  const { config, updateConfig, updateService, addService, removeService, resetConfig } = useConfig();

  const handleExport = () => {
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.companyName || "assistant"}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Configuration exportée !");
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          updateConfig(data);
          toast.success("Configuration importée !");
        } catch {
          toast.error("Fichier invalide.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b-[3px] border-foreground bg-secondary/30">
        <div className="container py-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl lg:text-4xl font-bold mb-2">Configuration</h1>
              <p className="text-muted-foreground">
                Personnalisez votre assistant d'accueil téléphonique.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={handleImport} className="brutal-btn bg-card text-foreground px-4 py-2 text-sm flex items-center gap-2">
                <Save className="w-4 h-4" />
                Importer
              </button>
              <button onClick={handleExport} className="brutal-btn bg-primary text-primary-foreground px-4 py-2 text-sm flex items-center gap-2">
                <Save className="w-4 h-4" />
                Exporter
              </button>
              <button
                onClick={() => { resetConfig(); toast.info("Configuration réinitialisée."); }}
                className="brutal-btn bg-accent text-accent-foreground px-4 py-2 text-sm flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="container py-8 space-y-6">
        {/* Identity */}
        <Section title="Identité de l'assistant" icon={User}>
          <FieldRow>
            <div className="space-y-2">
              <Label htmlFor="assistantName" className="font-heading font-semibold">Nom de l'assistant(e)</Label>
              <Input
                id="assistantName"
                value={config.assistantName}
                onChange={(e) => updateConfig({ assistantName: e.target.value })}
                placeholder="Ex: Clara"
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground focus:shadow-[3px_3px_0px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyName" className="font-heading font-semibold">Nom de l'entreprise</Label>
              <Input
                id="companyName"
                value={config.companyName}
                onChange={(e) => updateConfig({ companyName: e.target.value })}
                placeholder="Ex: TechCorp"
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground focus:shadow-[3px_3px_0px]"
              />
            </div>
          </FieldRow>
          <FieldRow>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Ton de l'assistant</Label>
              <Select value={config.tone} onValueChange={(v) => updateConfig({ tone: v })}>
                <SelectTrigger className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chaleureux">Chaleureux</SelectItem>
                  <SelectItem value="professionnel">Très professionnel</SelectItem>
                  <SelectItem value="premium">Premium / Luxe</SelectItem>
                  <SelectItem value="decontracte">Décontracté</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Téléphonie</Label>
              <Select value={config.telephonyProvider} onValueChange={(v) => updateConfig({ telephonyProvider: v })}>
                <SelectTrigger className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OnOff Business">OnOff Business</SelectItem>
                  <SelectItem value="Webex">Webex</SelectItem>
                  <SelectItem value="SIP/Trunk">SIP / Trunk</SelectItem>
                  <SelectItem value="Autre">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FieldRow>
        </Section>

        {/* Schedule */}
        <Section title="Horaires et langue" icon={Clock}>
          <FieldRow>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Horaires d'ouverture</Label>
              <Input
                value={config.openingHours}
                onChange={(e) => updateConfig({ openingHours: e.target.value })}
                placeholder="Ex: Lun-Ven 9h-18h"
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Fuseau horaire</Label>
              <Select value={config.timezone} onValueChange={(v) => updateConfig({ timezone: v })}>
                <SelectTrigger className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Europe/Paris">Europe/Paris</SelectItem>
                  <SelectItem value="Europe/London">Europe/London</SelectItem>
                  <SelectItem value="America/New_York">America/New_York</SelectItem>
                  <SelectItem value="Asia/Tokyo">Asia/Tokyo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FieldRow>
          <FieldRow>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Langue principale</Label>
              <Input
                value={config.language}
                onChange={(e) => updateConfig({ language: e.target.value })}
                placeholder="Français"
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Autres langues</Label>
              <Input
                value={config.otherLanguages}
                onChange={(e) => updateConfig({ otherLanguages: e.target.value })}
                placeholder="Ex: Anglais, Espagnol"
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground"
              />
            </div>
          </FieldRow>
          <div className="flex items-center gap-3 p-4 bg-secondary/50 border-2 border-foreground">
            <Switch
              checked={config.recordingNotice}
              onCheckedChange={(v) => updateConfig({ recordingNotice: v })}
            />
            <Label className="font-heading font-semibold">
              Annoncer l'enregistrement de l'appel
            </Label>
          </div>
        </Section>

        {/* Services */}
        <Section title="Services et transferts" icon={Headphones}>
          <div className="space-y-4">
            {config.services.map((svc, idx) => (
              <div key={svc.id} className="p-4 bg-secondary/30 border-2 border-foreground">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-heading font-bold text-sm">Service {idx + 1}</span>
                  {config.services.length > 1 && (
                    <button
                      onClick={() => removeService(svc.id)}
                      className="text-accent hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Input
                    value={svc.name}
                    onChange={(e) => updateService(svc.id, { name: e.target.value })}
                    placeholder="Nom du service"
                    className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground text-sm"
                  />
                  <Input
                    value={svc.transferTarget}
                    onChange={(e) => updateService(svc.id, { transferTarget: e.target.value })}
                    placeholder="N° de transfert"
                    className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground text-sm"
                  />
                  <Input
                    value={svc.email}
                    onChange={(e) => updateService(svc.id, { email: e.target.value })}
                    placeholder="Email du service"
                    className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground text-sm"
                  />
                </div>
              </div>
            ))}
            <button
              onClick={addService}
              className="brutal-btn bg-card text-foreground px-4 py-2 text-sm flex items-center gap-2 w-full justify-center"
            >
              <Plus className="w-4 h-4" />
              Ajouter un service
            </button>
          </div>
        </Section>

        {/* Contact */}
        <Section title="Emails et notifications" icon={Mail}>
          <FieldRow>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Email principal (standard)</Label>
              <Input
                value={config.emailMain}
                onChange={(e) => updateConfig({ emailMain: e.target.value })}
                placeholder="contact@entreprise.com"
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">CRM / Ticketing (optionnel)</Label>
              <Select value={config.crmTool || "none"} onValueChange={(v) => updateConfig({ crmTool: v === "none" ? "" : v })}>
                <SelectTrigger className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground">
                  <SelectValue placeholder="Aucun" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  <SelectItem value="HubSpot">HubSpot</SelectItem>
                  <SelectItem value="Notion">Notion</SelectItem>
                  <SelectItem value="Zendesk">Zendesk</SelectItem>
                  <SelectItem value="Salesforce">Salesforce</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FieldRow>
        </Section>

        {/* Calendar */}
        <Section title="Agenda et rendez-vous" icon={Calendar}>
          <FieldRow>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Fournisseur de calendrier</Label>
              <Select value={config.calendarProvider} onValueChange={(v) => updateConfig({ calendarProvider: v })}>
                <SelectTrigger className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Google Calendar">Google Calendar</SelectItem>
                  <SelectItem value="Outlook">Outlook</SelectItem>
                  <SelectItem value="Webex Scheduler">Webex Scheduler</SelectItem>
                  <SelectItem value="Autre">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">ID du calendrier</Label>
              <Input
                value={config.calendarId}
                onChange={(e) => updateConfig({ calendarId: e.target.value })}
                placeholder="Ex: mon-calendrier@gmail.com"
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground"
              />
            </div>
          </FieldRow>
        </Section>

        {/* Custom Greetings */}
        <Section title="Messages personnalisés" icon={Globe} defaultOpen={false}>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Message d'accueil (heures ouvrées)</Label>
              <Textarea
                value={config.customGreeting}
                onChange={(e) => updateConfig({ customGreeting: e.target.value })}
                placeholder={`Bonjour, vous êtes bien chez [COMPANY_NAME], ici [ASSISTANT_NAME]. Je vous écoute — comment puis-je vous aider ?`}
                rows={3}
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Variables disponibles : [COMPANY_NAME], [ASSISTANT_NAME]
              </p>
            </div>
            <div className="space-y-2">
              <Label className="font-heading font-semibold">Message hors horaires</Label>
              <Textarea
                value={config.customClosedGreeting}
                onChange={(e) => updateConfig({ customClosedGreeting: e.target.value })}
                placeholder={`Bonjour, vous êtes chez [COMPANY_NAME]. Nous sommes actuellement fermés. Je peux prendre un message et vous faire rappeler, ou planifier un rendez-vous. Que préférez-vous ?`}
                rows={3}
                className="border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground resize-none"
              />
            </div>
          </div>
        </Section>

        {/* Prompt Preview */}
        <Section title="Aperçu du prompt système" icon={Phone} defaultOpen={false}>
          <div className="p-4 bg-foreground text-background font-mono text-sm leading-relaxed border-2 border-foreground overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
{`Tu es ${config.assistantName || "[ASSISTANT_NAME]"}, l'assistant(e) d'accueil téléphonique de ${config.companyName || "[COMPANY_NAME]"}.
Tu réponds comme une vraie secrétaire : naturel, rapide, professionnel, empathique.
Ton : ${config.tone}
Langue : ${config.language}${config.otherLanguages ? ` + ${config.otherLanguages}` : ""}
Horaires : ${config.openingHours}
Fuseau : ${config.timezone}

Services disponibles :
${config.services.map((s) => `- ${s.name}${s.transferTarget ? ` → ${s.transferTarget}` : ""}${s.email ? ` (${s.email})` : ""}`).join("\n")}

Email standard : ${config.emailMain || "[EMAIL_MAIN]"}
Calendrier : ${config.calendarProvider} (${config.calendarId || "[CALENDAR_ID]"})
${config.crmTool ? `CRM : ${config.crmTool}` : ""}
Téléphonie : ${config.telephonyProvider}
${config.recordingNotice ? "Annonce d'enregistrement : activée" : ""}`}
          </div>
        </Section>
      </div>
    </div>
  );
}
