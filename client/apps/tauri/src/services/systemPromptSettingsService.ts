import { DEFAULT_CHAT_SYSTEM_PROMPT } from "@/domain/chat";
import { DEFAULT_QUIZ_SYSTEM_PROMPT } from "@/domain/quiz";
import { YOUTUBE_BLOG_SUMMARY_SYSTEM_PROMPT } from "@/domain/summary";
import {
  DEFAULT_TRANSCRIPT_REVIEW_SYSTEM_PROMPT,
  DEFAULT_TRANSCRIPT_TRANSLATION_SYSTEM_PROMPT,
} from "@/domain/transcript-actions";
import {
  getWorkspaceStorageItem,
  removeWorkspaceStorageItem,
  setWorkspaceStorageItem,
} from "@/services/workspaceStorage";

export type SystemPromptSettings = {
  videoSummary: string;
  chat: string;
  quiz: string;
  transcriptReview: string;
  transcriptTranslation: string;
};

export const defaultSystemPromptSettings: SystemPromptSettings = {
  videoSummary: YOUTUBE_BLOG_SUMMARY_SYSTEM_PROMPT,
  chat: DEFAULT_CHAT_SYSTEM_PROMPT,
  quiz: DEFAULT_QUIZ_SYSTEM_PROMPT,
  transcriptReview: DEFAULT_TRANSCRIPT_REVIEW_SYSTEM_PROMPT,
  transcriptTranslation: DEFAULT_TRANSCRIPT_TRANSLATION_SYSTEM_PROMPT,
};

const storageKey = "openbrief.system-prompts";

export function loadSystemPromptSettings(
  storage: Storage | undefined = browserStorage(),
): SystemPromptSettings {
  if (!storage) return defaultSystemPromptSettings;

  try {
    return normalizeSystemPromptSettings(
      JSON.parse(getWorkspaceStorageItem(storageKey, storage) ?? "{}"),
    );
  } catch {
    return defaultSystemPromptSettings;
  }
}

export function saveSystemPromptSettings(
  settings: SystemPromptSettings,
  storage: Storage | undefined = browserStorage(),
): SystemPromptSettings {
  const normalized = normalizeSystemPromptSettings(settings);
  setWorkspaceStorageItem(storageKey, JSON.stringify(normalized), storage);
  return normalized;
}

export function resetSystemPromptSettings(
  storage: Storage | undefined = browserStorage(),
): SystemPromptSettings {
  removeWorkspaceStorageItem(storageKey, storage);
  return defaultSystemPromptSettings;
}

function normalizeSystemPromptSettings(value: unknown): SystemPromptSettings {
  if (!value || typeof value !== "object") {
    return defaultSystemPromptSettings;
  }

  const candidate = value as Partial<
    Record<keyof SystemPromptSettings, unknown>
  >;

  return {
    videoSummary:
      typeof candidate.videoSummary === "string" &&
      candidate.videoSummary.trim()
        ? candidate.videoSummary
        : defaultSystemPromptSettings.videoSummary,
    chat:
      typeof candidate.chat === "string" && candidate.chat.trim()
        ? candidate.chat
        : defaultSystemPromptSettings.chat,
    quiz:
      typeof candidate.quiz === "string" && candidate.quiz.trim()
        ? candidate.quiz
        : defaultSystemPromptSettings.quiz,
    transcriptReview:
      typeof candidate.transcriptReview === "string" &&
      candidate.transcriptReview.trim()
        ? candidate.transcriptReview
        : defaultSystemPromptSettings.transcriptReview,
    transcriptTranslation:
      typeof candidate.transcriptTranslation === "string" &&
      candidate.transcriptTranslation.trim()
        ? candidate.transcriptTranslation
        : defaultSystemPromptSettings.transcriptTranslation,
  };
}

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
