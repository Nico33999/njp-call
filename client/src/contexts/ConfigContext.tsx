/**
 * Configuration PUBLIQUE du cabinet, dans le configurateur.
 *
 * Aucun secret n'est saisi, stocké, exporté ni envoyé depuis le navigateur :
 * les données de connecteur (téléphonie, messagerie, agenda) vivent côté
 * service, dans un coffre. L'ancienne configuration du prototype
 * (`assistant-config`) est migrée une fois : les réglages publics sont
 * gardés, les secrets sont effacés, et la liste de ce qui a été effacé est
 * affichée au praticien.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { migrateLegacyConfig, sanitizeConfig, type CabinetConfig } from "../../../core/config";

const KEY = "njp-call-config-v2";
const LEGACY_KEY = "assistant-config";

const read = (): { config: CabinetConfig; dropped: string[] } => {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return { config: sanitizeConfig(JSON.parse(current)), dropped: [] };
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateLegacyConfig(JSON.parse(legacy));
      localStorage.setItem(KEY, JSON.stringify(migrated.config));
      localStorage.removeItem(LEGACY_KEY); // les anciens secrets ne restent pas dans le navigateur
      return migrated;
    }
  } catch {
    /* configuration illisible : on repart des valeurs par défaut */
  }
  return { config: sanitizeConfig({}), dropped: [] };
};

interface ConfigContextType {
  config: CabinetConfig;
  /** Propriétés sensibles retirées lors de la migration, à signaler. */
  dropped: string[];
  update: (patch: Partial<CabinetConfig>) => void;
  replace: (next: CabinetConfig) => void;
  reset: () => void;
}

const Ctx = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(read);
  const [config, setConfig] = useState<CabinetConfig>(initial.config);
  const save = (next: CabinetConfig) => {
    const clean = sanitizeConfig(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(clean));
    } catch {
      /* stockage indisponible : la configuration vit le temps de la page */
    }
    return clean;
  };
  const update = useCallback((patch: Partial<CabinetConfig>) => setConfig((prev) => save({ ...prev, ...patch })), []);
  const replace = useCallback((next: CabinetConfig) => setConfig(save(next)), []);
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* rien */
    }
    setConfig(sanitizeConfig({}));
  }, []);
  return <Ctx.Provider value={{ config, dropped: initial.dropped, update, replace, reset }}>{children}</Ctx.Provider>;
}

export function useConfig() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfig doit être utilisé dans ConfigProvider");
  return ctx;
}
