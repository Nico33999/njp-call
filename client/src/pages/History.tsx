/*
 * Design: Signal — Néo-Brutaliste Télécom
 * Page d'historique des appels avec tableau et détails
 * Cards avec ombres décalées, badges de statut, timeline
 */
import { useState } from "react";
import { useSimulation, type CallSummary } from "@/contexts/SimulationContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Phone, PhoneForwarded, MessageSquare, Calendar, Clock,
  User, AlertCircle, ChevronRight, Inbox, Bot, Trash2
} from "lucide-react";
import { motion } from "framer-motion";

const DASHBOARD_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663392666558/aVBEyTu9zJPXVXR49mAvhc/dashboard-preview-QjYSuMQULZpKAx9ka9QR8o.webp";

const resultConfig: Record<string, { label: string; icon: React.ElementType; class: string }> = {
  transferred: { label: "Transféré", icon: PhoneForwarded, class: "badge-online" },
  message: { label: "Message", icon: MessageSquare, class: "badge-busy" },
  appointment: { label: "RDV", icon: Calendar, class: "badge-online" },
  pending: { label: "En attente", icon: Clock, class: "badge-offline" },
};

function CallCard({ call, onClick }: { call: CallSummary; onClick: () => void }) {
  const cfg = resultConfig[call.result] || resultConfig.pending;
  const Icon = cfg.icon;

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="w-full text-left brutal-card p-5 flex items-center gap-4 group"
    >
      <div className="w-12 h-12 bg-primary/10 flex items-center justify-center border-2 border-foreground shrink-0">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-heading font-bold text-sm truncate">
            {call.callerName || "Appelant inconnu"}
          </span>
          <span className={cfg.class}>{cfg.label}</span>
          {call.urgency === "urgent" && (
            <span className="badge-offline text-[10px]">Urgent</span>
          )}
        </div>
        <div className="text-sm text-muted-foreground truncate">{call.motif || "Pas de motif"}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {call.timestamp.toLocaleDateString("fr-FR")} à {call.timestamp.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          {" · "}{call.service}
          {" · "}{call.messages.length} messages
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </motion.button>
  );
}

function CallDetail({ call, onClose }: { call: CallSummary; onClose: () => void }) {
  const cfg = resultConfig[call.result] || resultConfig.pending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl border-2 border-foreground shadow-[6px_6px_0px] shadow-foreground bg-card p-0 max-h-[85vh] overflow-hidden">
        <DialogHeader className="p-5 border-b-2 border-foreground bg-secondary/30">
          <DialogTitle className="font-heading text-xl">Détail de l'appel</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-80px)]">
          <div className="p-5 space-y-6">
            {/* Summary */}
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { label: "Appelant", value: call.callerName || "Inconnu", icon: User },
                { label: "Service", value: call.service, icon: Phone },
                { label: "Résultat", value: cfg.label, icon: cfg.icon },
                { label: "Urgence", value: call.urgency === "urgent" ? "Urgent" : "Standard", icon: AlertCircle },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="flex items-center gap-3 p-3 bg-secondary/30 border-2 border-foreground">
                    <Icon className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">{item.label}</div>
                      <div className="font-heading font-semibold text-sm">{item.value}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Info */}
            <div className="space-y-3">
              <div className="p-3 bg-secondary/30 border-2 border-foreground">
                <div className="text-xs text-muted-foreground mb-1">Motif</div>
                <div className="text-sm">{call.motif || "Non spécifié"}</div>
              </div>
              {call.callerPhone && (
                <div className="p-3 bg-secondary/30 border-2 border-foreground">
                  <div className="text-xs text-muted-foreground mb-1">Téléphone</div>
                  <div className="text-sm font-heading">{call.callerPhone}</div>
                </div>
              )}
              {call.callerEmail && (
                <div className="p-3 bg-secondary/30 border-2 border-foreground">
                  <div className="text-xs text-muted-foreground mb-1">Email</div>
                  <div className="text-sm font-heading">{call.callerEmail}</div>
                </div>
              )}
              <div className="p-3 bg-secondary/30 border-2 border-foreground">
                <div className="text-xs text-muted-foreground mb-1">Prochaine action</div>
                <div className="text-sm">{call.nextAction}</div>
              </div>
              <div className="p-3 bg-secondary/30 border-2 border-foreground">
                <div className="text-xs text-muted-foreground mb-1">Horodatage</div>
                <div className="text-sm font-heading">
                  {call.timestamp.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                  {" à "}
                  {call.timestamp.toLocaleTimeString("fr-FR")}
                </div>
              </div>
            </div>

            {/* Conversation */}
            <div>
              <h3 className="font-heading font-bold text-sm mb-3">Conversation ({call.messages.length} messages)</h3>
              <div className="space-y-3 p-4 bg-foreground/5 border-2 border-foreground">
                {call.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${msg.role === "caller" ? "justify-end" : msg.role === "system" ? "justify-center" : "justify-start"}`}
                  >
                    {msg.role === "system" ? (
                      <div className="text-xs text-muted-foreground italic px-2 py-1 bg-secondary border border-foreground/20">
                        {msg.content}
                      </div>
                    ) : (
                      <div className={`max-w-[75%] px-3 py-2 text-sm border-2 border-foreground ${
                        msg.role === "caller" ? "bg-secondary" : "bg-primary/10"
                      }`}>
                        <div className="flex items-center gap-1 mb-1">
                          {msg.role === "assistant" ? (
                            <Bot className="w-3 h-3 text-primary" />
                          ) : (
                            <User className="w-3 h-3 text-accent" />
                          )}
                          <span className="text-[10px] font-heading font-semibold">
                            {msg.role === "assistant" ? "Assistant" : "Appelant"}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {msg.timestamp.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <div className="whitespace-pre-line">{msg.content}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default function History() {
  const { callHistory } = useSimulation();
  const [selectedCall, setSelectedCall] = useState<CallSummary | null>(null);

  const stats = {
    total: callHistory.length,
    transferred: callHistory.filter((c) => c.result === "transferred").length,
    messages: callHistory.filter((c) => c.result === "message").length,
    appointments: callHistory.filter((c) => c.result === "appointment").length,
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b-[3px] border-foreground bg-secondary/30">
        <div className="container py-8">
          <h1 className="text-3xl lg:text-4xl font-bold mb-2">Historique</h1>
          <p className="text-muted-foreground">
            Récapitulatif de tous les appels simulés.
          </p>
        </div>
      </div>

      <div className="container py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total appels", value: stats.total, icon: Phone, color: "bg-primary" },
            { label: "Transférés", value: stats.transferred, icon: PhoneForwarded, color: "bg-emerald" },
            { label: "Messages", value: stats.messages, icon: MessageSquare, color: "bg-accent" },
            { label: "Rendez-vous", value: stats.appointments, icon: Calendar, color: "bg-primary" },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="brutal-card p-4"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 ${stat.color} flex items-center justify-center border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-heading text-2xl font-bold">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Call List */}
        {callHistory.length === 0 ? (
          <div className="brutal-card p-12 text-center">
            <div className="w-20 h-20 bg-secondary flex items-center justify-center border-2 border-foreground shadow-[4px_4px_0px] shadow-foreground mx-auto mb-6">
              <Inbox className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="font-heading text-xl font-bold mb-2">Aucun appel</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Lancez une simulation pour voir apparaître l'historique des appels ici.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {callHistory.map((call) => (
              <CallCard key={call.id} call={call} onClick={() => setSelectedCall(call)} />
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedCall && <CallDetail call={selectedCall} onClose={() => setSelectedCall(null)} />}
    </div>
  );
}
