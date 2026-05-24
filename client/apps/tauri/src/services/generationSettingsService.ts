import {
  defaultGenerationParamsByOperation,
  type GenerationParams,
  type ProviderOperation,
} from "@/domain/provider";

export type GenerationSettings = Record<
  ProviderOperation,
  Required<GenerationParams>
>;

export const defaultGenerationSettings: GenerationSettings = {
  ...defaultGenerationParamsByOperation,
};

const storageKey = "openbrief.generation-settings";

export function loadGenerationSettings(
  storage: Storage | undefined = browserStorage(),
): GenerationSettings {
  if (!storage) return defaultGenerationSettings;

  try {
    return normalizeGenerationSettings(JSON.parse(storage.getItem(storageKey) ?? "{}"));
  } catch {
    return defaultGenerationSettings;
  }
}

export function saveGenerationSettings(
  settings: Partial<Record<ProviderOperation, GenerationParams>>,
  storage: Storage | undefined = browserStorage(),
): GenerationSettings {
  const normalized = normalizeGenerationSettings(settings);
  storage?.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

export function resetGenerationSettings(
  storage: Storage | undefined = browserStorage(),
): GenerationSettings {
  storage?.removeItem(storageKey);
  return defaultGenerationSettings;
}

function normalizeGenerationSettings(value: unknown): GenerationSettings {
  if (!value || typeof value !== "object") {
    return defaultGenerationSettings;
  }

  const candidate = value as Partial<Record<ProviderOperation, unknown>>;

  return {
    summary: normalizeGenerationParams(candidate.summary, "summary"),
    chat: normalizeGenerationParams(candidate.chat, "chat"),
    podcast_script: normalizeGenerationParams(
      candidate.podcast_script,
      "podcast_script",
    ),
    transcript_review: normalizeGenerationParams(
      candidate.transcript_review,
      "transcript_review",
    ),
    transcript_translate: normalizeGenerationParams(
      candidate.transcript_translate,
      "transcript_translate",
    ),
  };
}

function normalizeGenerationParams(
  value: unknown,
  operation: ProviderOperation,
): Required<GenerationParams> {
  const fallback = defaultGenerationSettings[operation];

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<Record<keyof GenerationParams, unknown>>;

  return {
    temperature: numberInRange(candidate.temperature, 0, 2) ?? fallback.temperature,
    topP: numberInRange(candidate.topP, 0, 1) ?? fallback.topP,
    maxTokens: integerInRange(candidate.maxTokens, 1, 128000) ?? fallback.maxTokens,
  };
}

function numberInRange(value: unknown, min: number, max: number) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

function integerInRange(value: unknown, min: number, max: number) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
