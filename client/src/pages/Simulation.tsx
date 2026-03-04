/*
 * Design: Signal — Néo-Brutaliste Télécom
 * Page de simulation d'appel avec interface chat style téléphone
 * Bordures épaisses, bulles de chat, indicateurs de statut
 */
import { useState, useRef, useEffect } from "react";
import { useSimulation } from "@/contexts/SimulationContext";
import { useConfig } from "@/contexts/ConfigContext";
import { useAssistantAI } from "@/hooks/useAssistantAI";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Phone, PhoneOff, Send, Mic, MicOff, Volume2,
  User, Bot, AlertTriangle, Info
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const PHONE_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663392666558/aVBEyTu9zJPXVXR49mAvhc/phone-simulation-B7t4A35aFRjxeYsmdjYgc2.webp";

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <Bot className="w-4 h-4 text-primary mr-2" />
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 bg-primary rounded-full"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  );
}

export default function Simulation() {
  const { messages, isCallActive, isTyping, addMessage, startCall, endCall, clearMessages } = useSimulation();
  const { config, isConfigured } = useConfig();
  const { processMessage, initCall } = useAssistantAI();
  const [input, setInput] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages, isTyping]);

  const handleStartCall = () => {
    startCall();
    initCall();
  };

  const handleEndCall = () => {
    const lastAssistantMsg = messages.filter((m) => m.role === "assistant").pop();
    endCall({
      intention: "Appel simulé",
      service: "Standard",
      result: "message",
      callerName: "Appelant test",
      callerPhone: "",
      callerEmail: "",
      motif: lastAssistantMsg?.content.slice(0, 50) || "Simulation",
      urgency: "standard",
      nextAction: "Aucune",
    });
    addMessage("system", "Appel terminé.", "FIN");
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !isCallActive || isTyping) return;
    setInput("");
    addMessage("caller", text);
    await processMessage(text);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const callDuration = isCallActive && messages.length > 0
    ? Math.floor((Date.now() - messages[0].timestamp.getTime()) / 1000)
    : 0;
  const minutes = Math.floor(callDuration / 60);
  const seconds = callDuration % 60;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b-[3px] border-foreground bg-secondary/30">
        <div className="container py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl lg:text-4xl font-bold mb-2">Simulation</h1>
              <p className="text-muted-foreground">
                Testez votre assistant en simulant un appel téléphonique.
              </p>
            </div>
            {isCallActive && (
              <div className="badge-online flex items-center gap-2">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                En appel — {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="container py-8">
        <div className="grid lg:grid-cols-[1fr_340px] gap-8">
          {/* Chat Area */}
          <div className="brutal-card flex flex-col" style={{ height: "calc(100vh - 280px)", minHeight: "500px" }}>
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b-2 border-foreground bg-secondary/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary flex items-center justify-center border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground">
                  <Bot className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <div className="font-heading font-bold text-sm">
                    {config.assistantName || "Assistant"} — {config.companyName || "Entreprise"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {isCallActive ? "En ligne" : "Hors ligne"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`w-8 h-8 flex items-center justify-center border-2 border-foreground transition-colors ${
                    isMuted ? "bg-accent text-white" : "bg-card"
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button className="w-8 h-8 flex items-center justify-center border-2 border-foreground bg-card">
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea ref={scrollRef} className="flex-1 p-4">
              {!isCallActive && messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <div className="w-20 h-20 bg-secondary flex items-center justify-center border-2 border-foreground shadow-[4px_4px_0px] shadow-foreground mb-6">
                    <Phone className="w-10 h-10 text-muted-foreground" />
                  </div>
                  <h3 className="font-heading text-xl font-bold mb-2">Prêt à simuler</h3>
                  <p className="text-muted-foreground max-w-sm mb-6">
                    {isConfigured
                      ? "Cliquez sur le bouton ci-dessous pour démarrer un appel simulé."
                      : "Configurez d'abord votre assistant dans l'onglet Configuration."}
                  </p>
                  <button
                    onClick={handleStartCall}
                    className="brutal-btn bg-emerald text-white px-6 py-3 flex items-center gap-2 text-base"
                  >
                    <Phone className="w-5 h-5" />
                    Démarrer l'appel
                  </button>
                </div>
              )}

              <AnimatePresence>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`mb-4 flex ${
                      msg.role === "caller" ? "justify-end" : msg.role === "system" ? "justify-center" : "justify-start"
                    }`}
                  >
                    {msg.role === "system" ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary border-2 border-foreground text-xs font-heading font-semibold">
                        <Info className="w-3 h-3" />
                        {msg.content}
                        {msg.action && (
                          <span className="ml-2 px-1.5 py-0.5 bg-primary text-primary-foreground text-[10px]">
                            {msg.action}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className={`max-w-[80%] ${msg.role === "caller" ? "order-1" : ""}`}>
                        <div className="flex items-end gap-2">
                          {msg.role === "assistant" && (
                            <div className="w-7 h-7 bg-primary flex items-center justify-center border-2 border-foreground shrink-0">
                              <Bot className="w-4 h-4 text-primary-foreground" />
                            </div>
                          )}
                          <div
                            className={`px-4 py-3 border-2 border-foreground text-sm leading-relaxed whitespace-pre-line ${
                              msg.role === "caller"
                                ? "bg-secondary shadow-[3px_3px_0px] shadow-foreground"
                                : "bg-primary/10 shadow-[3px_3px_0px] shadow-primary/30"
                            }`}
                          >
                            {msg.content}
                          </div>
                          {msg.role === "caller" && (
                            <div className="w-7 h-7 bg-accent flex items-center justify-center border-2 border-foreground shrink-0">
                              <User className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </div>
                        {msg.action && (
                          <div className={`mt-1 text-[10px] font-heading font-semibold text-muted-foreground ${msg.role === "caller" ? "text-right" : "text-left ml-9"}`}>
                            Action : {msg.action}
                          </div>
                        )}
                        <div className={`mt-0.5 text-[10px] text-muted-foreground ${msg.role === "caller" ? "text-right" : "text-left ml-9"}`}>
                          {msg.timestamp.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {isTyping && <TypingIndicator />}
            </ScrollArea>

            {/* Input */}
            <div className="p-4 border-t-2 border-foreground bg-secondary/30">
              {isCallActive ? (
                <div className="flex gap-3">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Tapez votre message (vous êtes l'appelant)..."
                    disabled={isTyping}
                    className="flex-1 border-2 border-foreground shadow-[2px_2px_0px] shadow-foreground"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isTyping}
                    className="brutal-btn bg-primary text-primary-foreground px-4 disabled:opacity-50"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleEndCall}
                    className="brutal-btn bg-accent text-accent-foreground px-4"
                  >
                    <PhoneOff className="w-5 h-5" />
                  </button>
                </div>
              ) : messages.length > 0 ? (
                <div className="flex gap-3">
                  <button
                    onClick={handleStartCall}
                    className="brutal-btn bg-emerald text-white px-6 py-2.5 flex items-center gap-2 flex-1 justify-center"
                  >
                    <Phone className="w-5 h-5" />
                    Nouvel appel
                  </button>
                  <button
                    onClick={clearMessages}
                    className="brutal-btn bg-card text-foreground px-4 py-2.5 text-sm"
                  >
                    Effacer
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6 hidden lg:block">
            {/* Assistant Card */}
            <div className="brutal-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-primary flex items-center justify-center border-2 border-foreground shadow-[3px_3px_0px] shadow-foreground">
                  <Bot className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <div className="font-heading font-bold">{config.assistantName || "Assistant"}</div>
                  <div className="text-sm text-muted-foreground">{config.companyName || "Entreprise"}</div>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ton</span>
                  <span className="font-heading font-semibold capitalize">{config.tone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Horaires</span>
                  <span className="font-heading font-semibold">{config.openingHours}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Services</span>
                  <span className="font-heading font-semibold">{config.services.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Téléphonie</span>
                  <span className="font-heading font-semibold text-xs">{config.telephonyProvider}</span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="brutal-card p-5">
              <h3 className="font-heading font-bold text-sm mb-3">Scénarios rapides</h3>
              <div className="space-y-2">
                {[
                  "Je voudrais parler au commercial",
                  "J'ai un problème technique",
                  "Je voudrais prendre un rendez-vous",
                  "Je voudrais laisser un message",
                  "C'est pour une facture",
                ].map((scenario, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (!isCallActive) {
                        handleStartCall();
                        setTimeout(() => {
                          addMessage("caller", scenario);
                          processMessage(scenario);
                        }, 1500);
                      } else {
                        setInput(scenario);
                      }
                    }}
                    className="w-full text-left px-3 py-2 text-sm bg-secondary/50 border-2 border-foreground hover:bg-secondary transition-colors font-heading"
                  >
                    "{scenario}"
                  </button>
                ))}
              </div>
            </div>

            {/* Tips */}
            <div className="brutal-card p-5 bg-primary/5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-accent" />
                <h3 className="font-heading font-bold text-sm">Conseils</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Parlez naturellement, comme au téléphone</li>
                <li>L'assistant détecte automatiquement votre intention</li>
                <li>Répondez par A/B ou 1-5 aux menus proposés</li>
                <li>L'historique est sauvegardé automatiquement</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
