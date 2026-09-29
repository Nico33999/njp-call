import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Les dates sont lues en Europe/Paris par le moteur, quel que soit le fuseau
    // de la machine : les bancs tournent volontairement en UTC pour le prouver.
    env: { TZ: "UTC" },
  },
});
