import { useCallback } from "react";
import { useConfig } from "@/contexts/ConfigContext";
import { useSimulation } from "@/contexts/SimulationContext";

function detectIntentFallback(message: string, serviceNames: string[]) {
  const lower = message.toLowerCase();
  if (/urgence|danger|secours|ambulance|pompier|police|samu|15|18|17/i.test(lower)) return { type: "emergency" };
  if (/rendez-vous|rdv|planifier|réserver/i.test(lower)) return { type: "appointment" };
  if (/message|rappel|laisser un mot/i.test(lower)) return { type: "message" };
  for (const svc of serviceNames) {
    if (lower.includes(svc.toLowerCase())) return { type: "transfer", service: svc };
  }
  if (/commercial|vente|prix/i.test(lower)) return { type: "transfer", service: "Commercial" };
  if (/support|problème|technique/i.test(lower)) return { type: "transfer", service: "Support" };
  return { type: "unknown" };
}

export function useAssistantAI() {
  const { config } = useConfig();
  const { addMessage, setIsTyping } = useSimulation();

  const executeAction = useCallback(async (action: string, details?: any) => {
    try {
      const res = await fetch("/api/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, config, details }),
      });
      const result = await res.json();
      if (result.success) {
        addMessage("system", result.message || "Action exécutée", action);
      } else {
        addMessage("system", result.message || "Échec de l'action", action);
      }
    } catch {
      addMessage("system", "Action simulée (connecteur non configuré)", action);
    }
  }, [config, addMessage]);

  const processMessage = useCallback(
    async (userMessage: string) => {
      setIsTyping(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "caller", content: userMessage }],
            config,
          }),
        });

        if (!response.ok) throw new Error("AI failed");
        const aiResult = await response.json();

        if (aiResult.error) throw new Error(aiResult.error);

        const { response: aiResponse, action } = aiResult;
        setIsTyping(false);

        if (aiResponse) {
          addMessage("assistant", aiResponse, action);
        }

        if (action) {
          await executeAction(action);
        }
      } catch (error) {
        // Fallback local
        await new Promise(r => setTimeout(r, 600));
        const serviceNames = config.services?.map((s: any) => s.name) || [];
        const intent = detectIntentFallback(userMessage, serviceNames);

        let fallbackResponse = "";
        let fallbackAction = "";

        if (intent.type === "emergency") {
          fallbackResponse = "Je comprends que c'est urgent. Appelez le 15 (SAMU), 18 (pompiers) ou 17 (police).";
          fallbackAction = "ALERTE URGENCE";
        } else if (intent.type === "transfer" && intent.service) {
          fallbackResponse = `Très bien, je vous transfère au service ${intent.service}.`;
          fallbackAction = `transfer_call("${intent.service}")`;
        } else if (intent.type === "appointment") {
          fallbackResponse = "D'accord, je m'en occupe. Quel est votre nom ?";
        } else if (intent.type === "message") {
          fallbackResponse = "Très bien, je prends votre message. Quel est votre nom ?";
        } else {
          fallbackResponse = "Je peux vous aider pour commercial, support, rendez-vous ou message. Que souhaitez-vous ?";
        }

        setIsTyping(false);
        addMessage("assistant", fallbackResponse, fallbackAction);
        if (fallbackAction) await executeAction(fallbackAction);
      }
    },
    [config, addMessage, setIsTyping, executeAction]
  );

  const initCall = useCallback(() => {
    const greeting = config.customGreeting || 
      `Bonjour, vous êtes bien chez ${config.companyName || "notre entreprise"}, ici ${config.assistantName || "l'assistant"}. Je vous écoute.`;

    if (config.recordingNotice) {
      addMessage("system", "Cet appel peut être enregistré.", "NOTICE");
    }
    setTimeout(() => addMessage("assistant", greeting), 400);
  }, [config, addMessage]);

  return { processMessage, initCall };
}
