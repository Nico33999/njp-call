import { useCallback } from "react";
import { useConfig } from "@/contexts/ConfigContext";
import { useSimulation } from "@/contexts/SimulationContext";

// Fallback local intent detection (used if AI proxy fails)
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

  const processMessage = useCallback(
    async (userMessage: string) => {
      setIsTyping(true);

      try {
        // Call our real AI proxy (Groq via Vercel Function)
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "caller", content: userMessage }],
            config: {
              assistantName: config.assistantName,
              companyName: config.companyName,
              tone: config.tone,
              services: config.services,
              openingHours: config.openingHours,
            },
          }),
        });

        if (!response.ok) throw new Error("AI proxy failed");

        const aiResult = await response.json();

        if (aiResult.error) {
          throw new Error(aiResult.error);
        }

        const { response: aiResponse, action, nextPhase } = aiResult;

        setIsTyping(false);

        if (aiResponse) {
          addMessage("assistant", aiResponse, action);
        }

        // Handle specific actions locally for nice UI feedback
        if (action?.includes("transfer_call")) {
          setTimeout(() => {
            addMessage("system", `Transfert simulé vers le service.`, "TRANSFERT OK");
          }, 1200);
        }
        if (action?.includes("calendar_create_event")) {
          addMessage("system", "Rendez-vous enregistré dans le calendrier (simulation).", "RDV CONFIRMÉ");
        }
        if (action?.includes("send_email")) {
          addMessage("system", "Message transmis par email (simulation).", "EMAIL ENVOYÉ");
        }

      } catch (error) {
        console.warn("Real AI failed, using fallback local logic:", error);

        // === FALLBACK: Original rule-based logic (kept as safety net) ===
        await new Promise((r) => setTimeout(r, 600));
        const serviceNames = config.services?.map((s: any) => s.name) || [];
        const intent = detectIntentFallback(userMessage, serviceNames);

        let fallbackResponse = "";
        let fallbackAction: string | undefined;

        if (intent.type === "emergency") {
          fallbackResponse = "Je comprends que c'est urgent. Pour une urgence médicale, appelez le 15 (SAMU). Pour les pompiers, le 18. Pour la police, le 17.";
          fallbackAction = "ALERTE URGENCE";
        } else if (intent.type === "transfer" && intent.service) {
          fallbackResponse = `Très bien, je vous transfère au service ${intent.service}.`;
          fallbackAction = `transfer_call("${intent.service}")`;
        } else if (intent.type === "appointment") {
          fallbackResponse = "D'accord, je m'en occupe. Pour planifier un rendez-vous, quel est votre nom ?";
        } else if (intent.type === "message") {
          fallbackResponse = "Très bien, je prends votre message. Quel est votre nom ?";
        } else {
          fallbackResponse = `Je peux vous aider pour : commercial, support, rendez-vous, ou laisser un message. Que souhaitez-vous ?`;
        }

        setIsTyping(false);
        addMessage("assistant", fallbackResponse, fallbackAction);
      }
    },
    [config, addMessage, setIsTyping]
  );

  const initCall = useCallback(() => {
    const greeting =
      config.customGreeting ||
      `Bonjour, vous êtes bien chez ${config.companyName || "notre entreprise"}, ici ${config.assistantName || "l'assistant"}. Je vous écoute — comment puis-je vous aider ?`;

    if (config.recordingNotice) {
      addMessage("system", "Cet appel peut être enregistré à des fins de qualité.", "NOTICE");
    }

    setTimeout(() => {
      addMessage("assistant", greeting);
    }, 400);
  }, [config, addMessage]);

  return { processMessage, initCall };
}
