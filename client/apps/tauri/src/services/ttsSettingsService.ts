import type { Supertonic3LanguageCode } from "@acme/model-card";
import { isSynthesisLanguageSupportedByModel } from "@acme/model-card";

export type TtsEngine = "supertonic";
export type TtsModelId = "Supertone/supertonic-3";
export type SupertonicVoiceStyleId =
  | "M1"
  | "M2"
  | "M3"
  | "M4"
  | "M5"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5";

export type SupertonicPresetVoiceStyle = {
  id: SupertonicVoiceStyleId;
  label: string;
};

export type TtsSettings = {
  engine: TtsEngine;
  modelId: TtsModelId;
  voiceStyleId: SupertonicVoiceStyleId;
  languageCode: Supertonic3LanguageCode;
  hasSelectedVoice: boolean;
};

export const supertonicPresetVoiceStyles: SupertonicPresetVoiceStyle[] = [
  { id: "M1", label: "M1" },
  { id: "M2", label: "M2" },
  { id: "M3", label: "M3" },
  { id: "M4", label: "M4" },
  { id: "M5", label: "M5" },
  { id: "F1", label: "F1" },
  { id: "F2", label: "F2" },
  { id: "F3", label: "F3" },
  { id: "F4", label: "F4" },
  { id: "F5", label: "F5" },
];

export const defaultTtsSettings: TtsSettings = {
  engine: "supertonic",
  modelId: "Supertone/supertonic-3",
  voiceStyleId: "M1",
  languageCode: "en",
  hasSelectedVoice: false,
};

const storageKey = "openbrief.tts-settings";

export function loadTtsSettings(storage = browserLocalStorage()): TtsSettings {
  if (!storage) return defaultTtsSettings;

  try {
    return normalizeTtsSettings(JSON.parse(storage.getItem(storageKey) ?? "{}"));
  } catch {
    return defaultTtsSettings;
  }
}

export function saveTtsSettings(
  settings: TtsSettings,
  storage = browserLocalStorage(),
): TtsSettings {
  const normalized = normalizeTtsSettings(settings);
  storage?.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

function normalizeTtsSettings(value: unknown): TtsSettings {
  if (!value || typeof value !== "object") return defaultTtsSettings;

  const candidate = value as Partial<Record<keyof TtsSettings, unknown>>;

  return {
    engine: "supertonic",
    modelId: "Supertone/supertonic-3",
    voiceStyleId: isSupertonicVoiceStyleId(candidate.voiceStyleId)
      ? candidate.voiceStyleId
      : defaultTtsSettings.voiceStyleId,
    languageCode: isSupertonicLanguageCode(candidate.languageCode)
      ? candidate.languageCode
      : defaultTtsSettings.languageCode,
    hasSelectedVoice:
      typeof candidate.hasSelectedVoice === "boolean"
        ? candidate.hasSelectedVoice
        : defaultTtsSettings.hasSelectedVoice,
  };
}

function isSupertonicVoiceStyleId(
  value: unknown,
): value is SupertonicVoiceStyleId {
  return supertonicPresetVoiceStyles.some((voice) => voice.id === value);
}

function isSupertonicLanguageCode(
  value: unknown,
): value is Supertonic3LanguageCode {
  return (
    typeof value === "string" &&
    isSynthesisLanguageSupportedByModel("Supertone/supertonic-3", value)
  );
}

function browserLocalStorage() {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
