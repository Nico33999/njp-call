import { useCallback } from "react";
import { useConfig } from "@/contexts/ConfigContext";
import { useSimulation } from "@/contexts/SimulationContext";

function isWithinHours(hours: string): boolean {
  if (!hours) return true;
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  
  // Simple parsing: "Lun-Ven 9h-18h"
  const dayMap: Record<string, number> = {
    "dim": 0, "lun": 1, "mar": 2, "mer": 3, "jeu": 4, "ven": 5, "sam": 6,
  };
  
  const lower = hours.toLowerCase();
  const dayMatch = lower.match(/(lun|mar|mer|jeu|ven|sam|dim)-(lun|mar|mer|jeu|ven|sam|dim)/);
  const hourMatch = lower.match(/(\d{1,2})h?\s*-\s*(\d{1,2})h?/);
  
  if (dayMatch) {
    const startDay = dayMap[dayMatch[1]] ?? 1;
    const endDay = dayMap[dayMatch[2]] ?? 5;
    if (currentDay < startDay || currentDay > endDay) return false;
  }
  
  if (hourMatch) {
    const startHour = parseInt(hourMatch[1]);
    const endHour = parseInt(hourMatch[2]);
    if (currentHour < startHour || currentHour >= endHour) return false;
  }
  
  return true;
}

type IntentType = "transfer" | "appointment" | "message" | "info" | "emergency" | "unknown";

interface DetectedIntent {
  type: IntentType;
  service?: string;
  confidence: number;
}

function detectIntent(message: string, serviceNames: string[]): DetectedIntent {
  const lower = message.toLowerCase();
  
  // Emergency
  if (/urgence|danger|secours|ambulance|pompier|police|samu|15|18|17/i.test(lower)) {
    return { type: "emergency", confidence: 0.95 };
  }
  
  // Appointment
  if (/rendez-vous|rdv|planifier|réserver|créneau|disponibilit/i.test(lower)) {
    return { type: "appointment", confidence: 0.9 };
  }
  
  // Message
  if (/message|rappel|rappeler|laisser un mot|contacter/i.test(lower)) {
    return { type: "message", confidence: 0.85 };
  }
  
  // Transfer to specific service
  for (const svc of serviceNames) {
    if (lower.includes(svc.toLowerCase())) {
      return { type: "transfer", service: svc, confidence: 0.9 };
    }
  }
  
  // Commercial keywords
  if (/commercial|vente|acheter|prix|devis|offre|tarif|produit/i.test(lower)) {
    return { type: "transfer", service: "Commercial", confidence: 0.8 };
  }
  
  // Support keywords
  if (/support|aide|problème|bug|panne|technique|marche pas|fonctionne/i.test(lower)) {
    return { type: "transfer", service: "Support", confidence: 0.8 };
  }
  
  // Billing keywords
  if (/facture|facturation|paiement|comptabilit|remboursement|avoir/i.test(lower)) {
    return { type: "transfer", service: "Comptabilité", confidence: 0.8 };
  }
  
  // HR keywords
  if (/rh|ressources humaines|recrutement|emploi|candidature|poste/i.test(lower)) {
    return { type: "transfer", service: "Ressources humaines", confidence: 0.8 };
  }
  
  return { type: "unknown", confidence: 0.3 };
}

interface ConversationState {
  phase: "greeting" | "intent" | "collecting_info" | "confirming" | "closing";
  collectedData: {
    name?: string;
    phone?: string;
    email?: string;
    motif?: string;
    urgency?: string;
    availability?: string;
    appointmentSlot?: string;
  };
  intent?: DetectedIntent;
  awaitingField?: string;
}

let conversationState: ConversationState = {
  phase: "greeting",
  collectedData: {},
};

export function useAssistantAI() {
  const { config } = useConfig();
  const { addMessage, setIsTyping } = useSimulation();

  const generateGreeting = useCallback(() => {
    const withinHours = isWithinHours(config.openingHours);
    
    if (config.customGreeting && withinHours) {
      return config.customGreeting
        .replace(/\[COMPANY_NAME\]/g, config.companyName || "notre entreprise")
        .replace(/\[ASSISTANT_NAME\]/g, config.assistantName || "l'assistant");
    }
    
    if (config.customClosedGreeting && !withinHours) {
      return config.customClosedGreeting
        .replace(/\[COMPANY_NAME\]/g, config.companyName || "notre entreprise")
        .replace(/\[ASSISTANT_NAME\]/g, config.assistantName || "l'assistant");
    }
    
    if (withinHours) {
      return `Bonjour, vous êtes bien chez ${config.companyName || "notre entreprise"}, ici ${config.assistantName || "l'assistant"}. Je vous écoute — comment puis-je vous aider ?`;
    }
    
    return `Bonjour, vous êtes chez ${config.companyName || "notre entreprise"}. Nous sommes actuellement fermés. Je peux prendre un message et vous faire rappeler, ou planifier un rendez-vous. Que préférez-vous ?`;
  }, [config]);

  const processMessage = useCallback(
    async (userMessage: string) => {
      setIsTyping(true);
      
      // Simulate thinking delay
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
      
      const serviceNames = config.services.map((s) => s.name);
      let response = "";
      let action: string | undefined;

      // Handle based on conversation phase
      switch (conversationState.phase) {
        case "greeting":
        case "intent": {
          const intent = detectIntent(userMessage, serviceNames);
          conversationState.intent = intent;

          if (intent.type === "emergency") {
            response = "Je comprends que c'est urgent. Pour une urgence médicale, appelez le 15 (SAMU). Pour les pompiers, le 18. Pour la police, le 17. Souhaitez-vous que je vous mette en relation avec un de nos services en parallèle ?";
            action = "ALERTE URGENCE";
            conversationState.phase = "intent";
          } else if (intent.type === "transfer" && intent.service) {
            response = `Très bien, je vous transfère au service ${intent.service}.`;
            action = `transfer_call("${intent.service}")`;
            
            // Simulate transfer attempt
            await new Promise((r) => setTimeout(r, 1500));
            
            // 50% chance of success for simulation
            if (Math.random() > 0.5) {
              addMessage("system", `Transfert vers ${intent.service} réussi.`, "TRANSFERT OK");
              response += "\n\nLe transfert est en cours. Bonne journée !";
              conversationState.phase = "closing";
            } else {
              response = `Je n'arrive pas à joindre le service ${intent.service} tout de suite. Je peux :\nA) Prendre vos coordonnées pour un rappel\nB) Vous proposer un rendez-vous\n\nVous préférez quoi ?`;
              action = "TRANSFERT ÉCHOUÉ";
              conversationState.phase = "intent";
              conversationState.intent = { ...intent, type: "unknown" };
            }
          } else if (intent.type === "appointment") {
            response = "D'accord, je m'en occupe. Pour planifier un rendez-vous, j'ai besoin de quelques informations. Quel est votre nom, s'il vous plaît ?";
            conversationState.phase = "collecting_info";
            conversationState.awaitingField = "name";
          } else if (intent.type === "message") {
            response = "Très bien, je prends votre message. Quel est votre nom, s'il vous plaît ?";
            conversationState.phase = "collecting_info";
            conversationState.awaitingField = "name";
          } else if (/^[ab1-5]$/i.test(userMessage.trim())) {
            const choice = userMessage.trim().toLowerCase();
            if (choice === "a" || choice === "1") {
              response = "D'accord, je prends vos coordonnées pour un rappel. Quel est votre nom ?";
              conversationState.intent = { type: "message", confidence: 1 };
              conversationState.phase = "collecting_info";
              conversationState.awaitingField = "name";
            } else if (choice === "b" || choice === "4") {
              response = "Parfait, planifions un rendez-vous. Quel est votre nom ?";
              conversationState.intent = { type: "appointment", confidence: 1 };
              conversationState.phase = "collecting_info";
              conversationState.awaitingField = "name";
            } else if (choice === "2") {
              response = "Je vous transfère au support technique.";
              action = 'transfer_call("Support")';
              conversationState.phase = "closing";
            } else if (choice === "3") {
              response = "Je vous transfère à la comptabilité.";
              action = 'transfer_call("Comptabilité")';
              conversationState.phase = "closing";
            } else if (choice === "5") {
              response = "Très bien, je prends votre message. Quel est votre nom ?";
              conversationState.intent = { type: "message", confidence: 1 };
              conversationState.phase = "collecting_info";
              conversationState.awaitingField = "name";
            }
          } else {
            response = `Je vois. Je peux vous aider pour :\n1. Parler au commercial\n2. Joindre le support\n3. Facturation\n4. Prendre un rendez-vous\n5. Laisser un message\n\nQu'est-ce qui vous convient ?`;
            conversationState.phase = "intent";
          }
          break;
        }

        case "collecting_info": {
          const field = conversationState.awaitingField;
          
          if (field === "name") {
            conversationState.collectedData.name = userMessage;
            response = "Merci. Sur quel numéro on vous rappelle ?";
            conversationState.awaitingField = "phone";
          } else if (field === "phone") {
            conversationState.collectedData.phone = userMessage;
            if (conversationState.intent?.type === "appointment") {
              response = "Et votre email pour la confirmation ?";
              conversationState.awaitingField = "email";
            } else {
              response = "Quel est le sujet en une phrase ?";
              conversationState.awaitingField = "motif";
            }
          } else if (field === "email") {
            conversationState.collectedData.email = userMessage;
            response = "Quel est le motif du rendez-vous ?";
            conversationState.awaitingField = "motif";
          } else if (field === "motif") {
            conversationState.collectedData.motif = userMessage;
            if (conversationState.intent?.type === "appointment") {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              const slot1 = `${tomorrow.toLocaleDateString("fr-FR")} à 10h00`;
              const slot2 = `${tomorrow.toLocaleDateString("fr-FR")} à 14h30`;
              response = `J'ai deux créneaux disponibles :\nA) ${slot1}\nB) ${slot2}\n\nLequel vous arrange ?`;
              conversationState.awaitingField = "appointmentSlot";
            } else {
              response = "C'est urgent (aujourd'hui) ou plutôt standard ?";
              conversationState.awaitingField = "urgency";
            }
          } else if (field === "urgency") {
            conversationState.collectedData.urgency = /urgent|aujourd/i.test(userMessage) ? "urgent" : "standard";
            response = "Quand êtes-vous joignable : matin, après-midi, ou ce soir ?";
            conversationState.awaitingField = "availability";
          } else if (field === "availability") {
            conversationState.collectedData.availability = userMessage;
            conversationState.phase = "confirming";
            
            const d = conversationState.collectedData;
            const serviceName = conversationState.intent?.service || "Standard";
            response = `Parfait, je récapitule :\n• Nom : ${d.name}\n• Téléphone : ${d.phone}\n• Motif : ${d.motif}\n• Urgence : ${d.urgency || "standard"}\n• Disponibilité : ${d.availability}\n\nJe transmets au service ${serviceName}. C'est bien ça ?`;
          } else if (field === "appointmentSlot") {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            let slot: string;
            if (/a|1|10h|matin/i.test(userMessage)) {
              slot = `${tomorrow.toLocaleDateString("fr-FR")} à 10h00`;
            } else {
              slot = `${tomorrow.toLocaleDateString("fr-FR")} à 14h30`;
            }
            conversationState.collectedData.appointmentSlot = slot;
            conversationState.phase = "confirming";
            
            const d = conversationState.collectedData;
            response = `Parfait, c'est confirmé pour le ${slot}.\n\n• Nom : ${d.name}\n• Téléphone : ${d.phone}\n• Email : ${d.email || "non fourni"}\n• Motif : ${d.motif}\n\nVous recevrez une confirmation. Puis-je faire autre chose ?`;
            action = `calendar_create_event("${config.calendarId || "default"}", "${config.companyName} – ${d.motif}", "${slot}")`;
          }
          break;
        }

        case "confirming": {
          if (/oui|ok|c'est bon|exact|parfait|correct/i.test(userMessage)) {
            const d = conversationState.collectedData;
            const serviceName = conversationState.intent?.service || "Standard";
            const serviceEmail = config.services.find((s) => s.name === serviceName)?.email || config.emailMain || "standard@entreprise.com";
            
            if (conversationState.intent?.type === "message") {
              action = `send_email("${serviceEmail}", "${config.companyName} – Demande de rappel – ${serviceName} – ${d.name} – ${d.urgency || "standard"}")`;
              response = "C'est noté et transmis. On vous rappellera dans les meilleurs délais. Puis-je faire autre chose ?";
            } else {
              response = "Parfait, tout est en ordre. Puis-je faire autre chose ?";
            }
            conversationState.phase = "closing";
          } else if (/non|pas correct|erreur|modifier/i.test(userMessage)) {
            response = "D'accord, qu'est-ce que je dois corriger ?";
            conversationState.phase = "collecting_info";
            conversationState.awaitingField = "name";
          } else {
            response = "Excusez-moi, je confirme les informations. C'est correct ?";
          }
          break;
        }

        case "closing": {
          if (/non|rien|c'est tout|au revoir|merci|bonne/i.test(userMessage)) {
            response = `Merci pour votre appel. Bonne journée ! Au revoir.`;
            action = "FIN D'APPEL";
          } else {
            // New request
            conversationState.phase = "intent";
            conversationState.collectedData = {};
            conversationState.awaitingField = undefined;
            const intent = detectIntent(userMessage, serviceNames);
            conversationState.intent = intent;
            
            if (intent.type === "unknown") {
              response = "Bien sûr. De quoi avez-vous besoin ?";
            } else {
              // Re-process
              setIsTyping(false);
              return processMessage(userMessage);
            }
          }
          break;
        }
      }

      setIsTyping(false);
      if (response) {
        addMessage("assistant", response, action);
      }
    },
    [config, addMessage, setIsTyping]
  );

  const initCall = useCallback(() => {
    conversationState = { phase: "greeting", collectedData: {} };
    const greeting = generateGreeting();
    
    if (config.recordingNotice) {
      addMessage("system", "Cet appel peut être enregistré à des fins de qualité.", "NOTICE");
    }
    
    setTimeout(() => {
      addMessage("assistant", greeting);
      conversationState.phase = "intent";
    }, 500);
  }, [generateGreeting, addMessage, config.recordingNotice]);

  return { processMessage, initCall, generateGreeting };
}
