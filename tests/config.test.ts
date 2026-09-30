import { describe, expect, it } from "vitest";
import {
  activationBlockers,
  exportConfig,
  importConfig,
  migrateLegacyConfig,
  sanitizeConfig,
} from "../core/config";

/** Ce que l'ancien prototype enregistrait dans localStorage. Valeurs factices. */
const legacy = {
  assistantName: "Clara",
  companyName: "Cabinet Exemple",
  customGreeting: "Bienvenue.",
  customSystemPrompt: "Vouvoyer les appelants.",
  companyKnowledge: "Parking derrière le bâtiment.",
  resendApiKey: "re_FAUSSE_CLE_DE_TEST_123456",
  googleCalendarCredentials: '{"private_key":"-----BEGIN FAUX-----"}',
  webhookUrl: "https://hooks.example.test/abc",
  emailFrom: "assistant@example.test",
  calendarId: "agenda-factice@example.test",
  services: [
    {
      id: "1",
      name: "Standard",
      transferTarget: "+33100000000",
      email: "x@example.test",
    },
  ],
};
const SECRETS = [
  "re_FAUSSE",
  "BEGIN FAUX",
  "hooks.example",
  "agenda-factice",
  "+33100000000",
  "assistant@example",
];

describe("configuration et secrets", () => {
  it("la migration garde les réglages publics et élimine les données de connecteur", () => {
    const { config, dropped } = migrateLegacyConfig(legacy);
    expect(config.cabinetName).toBe("Cabinet Exemple");
    expect(config.greeting).toBe("Bienvenue.");
    expect(config.cabinetInstructions).toBe("Vouvoyer les appelants.");
    expect(dropped).toEqual(
      expect.arrayContaining([
        "resendApiKey",
        "googleCalendarCredentials",
        "webhookUrl",
        "services",
      ])
    );
    const serialized = JSON.stringify(config);
    for (const s of SECRETS) expect(serialized).not.toContain(s);
  });

  it("l'export et l'import ne transportent aucun secret", () => {
    const exported = exportConfig(
      sanitizeConfig({ ...legacy, schema: 2, cabinetName: "C" })
    );
    for (const s of SECRETS) expect(exported).not.toContain(s);
    const imported = importConfig(
      JSON.stringify({ ...JSON.parse(exported), resendApiKey: "re_FAUSSE_X" })
    );
    expect(JSON.stringify(imported.config)).not.toContain("re_FAUSSE");
    expect(imported.dropped).toContain("resendApiKey");
  });

  it("l'audio n'est jamais conservé, la simulation n'est jamais active par défaut", () => {
    const c = sanitizeConfig({
      retention: { storeAudio: true, callRecordDays: 30 },
      simulation: "yes",
    });
    expect(c.retention.storeAudio).toBe(false);
    expect(c.simulation).toBe(false);
  });

  it("l'activation finale exige une consigne d'urgence validée et l'absence de simulation", () => {
    expect(
      activationBlockers(sanitizeConfig({ cabinetName: "C", simulation: true }))
    ).toEqual(
      expect.arrayContaining([
        "urgency_notice_not_validated",
        "simulation_enabled",
      ])
    );
    expect(
      activationBlockers(
        sanitizeConfig({
          cabinetName: "C",
          urgency: { validatedByCabinet: true },
          openingHours: [{ weekday: 1, from: "09:00", to: "12:00" }],
        })
      )
    ).toEqual([]);
  });
});
