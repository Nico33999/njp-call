import { createContext, useContext, type ReactNode } from "react";
import { useConfig } from "./ConfigContext";
import { useRecette } from "../hooks/useRecette";

type Recette = ReturnType<typeof useRecette>;
const Ctx = createContext<Recette | undefined>(undefined);

/** Le banc de recette, partagé entre la simulation et les comptes rendus (en mémoire seulement). */
export function RecetteProvider({ children }: { children: ReactNode }) {
  const { config } = useConfig();
  const recette = useRecette(config);
  return <Ctx.Provider value={recette}>{children}</Ctx.Provider>;
}

export function useRecetteContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRecetteContext doit être utilisé dans RecetteProvider");
  return ctx;
}
