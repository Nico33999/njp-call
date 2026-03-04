import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type MessageRole = "assistant" | "caller" | "system";
export type CallResult = "transferred" | "message" | "appointment" | "pending";
export type Urgency = "urgent" | "standard";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  action?: string;
}

export interface CallSummary {
  id: string;
  timestamp: Date;
  intention: string;
  service: string;
  result: CallResult;
  callerName: string;
  callerPhone: string;
  callerEmail: string;
  motif: string;
  urgency: Urgency;
  nextAction: string;
  messages: ChatMessage[];
}

interface SimulationContextType {
  messages: ChatMessage[];
  callHistory: CallSummary[];
  isCallActive: boolean;
  isTyping: boolean;
  addMessage: (role: MessageRole, content: string, action?: string) => void;
  startCall: () => void;
  endCall: (summary: Omit<CallSummary, "id" | "timestamp" | "messages">) => void;
  clearMessages: () => void;
  setIsTyping: (v: boolean) => void;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [callHistory, setCallHistory] = useState<CallSummary[]>(() => {
    const saved = localStorage.getItem("call-history");
    if (saved) {
      try {
        return JSON.parse(saved).map((c: CallSummary) => ({
          ...c,
          timestamp: new Date(c.timestamp),
          messages: c.messages.map((m: ChatMessage) => ({ ...m, timestamp: new Date(m.timestamp) })),
        }));
      } catch {
        return [];
      }
    }
    return [];
  });
  const [isCallActive, setIsCallActive] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const addMessage = useCallback((role: MessageRole, content: string, action?: string) => {
    const msg: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      role,
      content,
      timestamp: new Date(),
      action,
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const startCall = useCallback(() => {
    setMessages([]);
    setIsCallActive(true);
  }, []);

  const endCall = useCallback(
    (summary: Omit<CallSummary, "id" | "timestamp" | "messages">) => {
      const call: CallSummary = {
        ...summary,
        id: Date.now().toString(),
        timestamp: new Date(),
        messages,
      };
      setCallHistory((prev) => {
        const next = [call, ...prev];
        localStorage.setItem("call-history", JSON.stringify(next));
        return next;
      });
      setIsCallActive(false);
    },
    [messages]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <SimulationContext.Provider
      value={{ messages, callHistory, isCallActive, isTyping, addMessage, startCall, endCall, clearMessages, setIsTyping }}
    >
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within SimulationProvider");
  return ctx;
}
