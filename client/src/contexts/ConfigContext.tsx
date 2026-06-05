import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface ServiceConfig {
  id: string;
  name: string;
  transferTarget: string;
  email: string;
}

export interface AssistantConfig {
  assistantName: string;
  companyName: string;
  tone: string;
  language: string;
  otherLanguages: string;
  openingHours: string;
  timezone: string;
  services: ServiceConfig[];
  emailMain: string;
  calendarId: string;
  calendarProvider: string;
  crmTool: string;
  telephonyProvider: string;
  recordingNotice: boolean;
  customGreeting: string;
  customClosedGreeting: string;
  // === NOUVEAU : Configuration IA conversationnelle réelle ===
  customSystemPrompt: string;      // Instructions personnalisées complètes pour l'IA
  companyKnowledge: string;        // Connaissances spécifiques sur l'entreprise / produits / process
}

const defaultServices: ServiceConfig[] = [
  { id: "1", name: "Commercial", transferTarget: "", email: "" },
  { id: "2", name: "Support", transferTarget: "", email: "" },
  { id: "3", name: "Comptabilité", transferTarget: "", email: "" },
  { id: "4", name: "Ressources humaines", transferTarget: "", email: "" },
  { id: "5", name: "Standard", transferTarget: "", email: "" },
];

const defaultConfig: AssistantConfig = {
  assistantName: "Clara",
  companyName: "",
  tone: "chaleureux",
  language: "Français",
  otherLanguages: "",
  openingHours: "Lun-Ven 9h-18h",
  timezone: "Europe/Paris",
  services: defaultServices,
  emailMain: "",
  calendarId: "",
  calendarProvider: "Google Calendar",
  crmTool: "",
  telephonyProvider: "OnOff Business",
  recordingNotice: true,
  customGreeting: "",
  customClosedGreeting: "",
  // IA conversationnelle
  customSystemPrompt: "",
  companyKnowledge: "",
};

interface ConfigContextType {
  config: AssistantConfig;
  updateConfig: (updates: Partial<AssistantConfig>) => void;
  updateService: (id: string, updates: Partial<ServiceConfig>) => void;
  addService: () => void;
  removeService: (id: string) => void;
  resetConfig: () => void;
  isConfigured: boolean;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AssistantConfig>(() => {
    const saved = localStorage.getItem("assistant-config");
    if (saved) {
      try {
        return { ...defaultConfig, ...JSON.parse(saved) };
      } catch {
        return defaultConfig;
      }
    }
    return defaultConfig;
  });

  const updateConfig = useCallback((updates: Partial<AssistantConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      localStorage.setItem("assistant-config", JSON.stringify(next));
      return next;
    });
  }, []);

  const updateService = useCallback((id: string, updates: Partial<ServiceConfig>) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        services: prev.services.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      };
      localStorage.setItem("assistant-config", JSON.stringify(next));
      return next;
    });
  }, []);

  const addService = useCallback(() => {
    setConfig((prev) => {
      const next = {
        ...prev,
        services: [
          ...prev.services,
          {
            id: Date.now().toString(),
            name: "",
            transferTarget: "",
            email: "",
          },
        ],
      };
      localStorage.setItem("assistant-config", JSON.stringify(next));
      return next;
    });
  }, []);

  const removeService = useCallback((id: string) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        services: prev.services.filter((s) => s.id !== id),
      };
      localStorage.setItem("assistant-config", JSON.stringify(next));
      return next;
    });
  }, []);

  const resetConfig = useCallback(() => {
    localStorage.removeItem("assistant-config");
    setConfig(defaultConfig);
  }, []);

  const isConfigured = Boolean(config.companyName && config.assistantName);

  return (
    <ConfigContext.Provider
      value={{ config, updateConfig, updateService, addService, removeService, resetConfig, isConfigured }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
