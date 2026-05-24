import { describe, expect, it } from "vitest";
import {
  defaultTtsSettings,
  loadTtsSettings,
  saveTtsSettings,
} from "@/services/ttsSettingsService";

function createMemoryStorage(initialValue?: string): Storage {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set("openbrief.tts-settings", initialValue);
  }

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("ttsSettingsService", () => {
  it("loads defaults when no settings are saved", () => {
    expect(loadTtsSettings(createMemoryStorage())).toEqual(defaultTtsSettings);
  });

  it("persists the selected Supertonic voice", () => {
    const storage = createMemoryStorage();

    const saved = saveTtsSettings(
      {
        engine: "supertonic",
        modelId: "Supertone/supertonic-3",
        voiceStyleId: "F3",
        languageCode: "ko",
        hasSelectedVoice: true,
      },
      storage,
    );

    expect(loadTtsSettings(storage)).toEqual(saved);
  });

  it("repairs invalid saved values", () => {
    const storage = createMemoryStorage(
      JSON.stringify({
        engine: "missing",
        modelId: "Supertone/supertonic-2",
        voiceStyleId: "X1",
        languageCode: "zh",
        hasSelectedVoice: "yes",
      }),
    );

    expect(loadTtsSettings(storage)).toEqual(defaultTtsSettings);
  });
});
