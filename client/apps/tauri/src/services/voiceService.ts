import type { TauriInvoke } from "@/services/tauriHelperClient";
import type {
  QwenPresetVoiceId,
  SupertonicVoiceStyleId,
  TtsLanguageCode,
  TtsModelId,
} from "@/services/ttsSettingsService";
import { canUseTauriRuntime } from "@/services/tauriHelperClient";
import { invoke } from "@tauri-apps/api/core";

export type TtsVoiceCatalogModel = {
  id: TtsModelId;
  name: string;
  engine: "supertonic" | "qwen";
  downloaded: boolean;
  voices: TtsVoiceCatalogVoice[];
};

export type TtsVoiceCatalogVoice = {
  id: SupertonicVoiceStyleId | QwenPresetVoiceId;
  label: string;
  downloaded: boolean;
};

export type GenerateTtsPreviewRequest = {
  text: string;
  modelId: TtsModelId;
  language: TtsLanguageCode;
  voiceStyleId?: SupertonicVoiceStyleId;
  qwenPresetVoiceId?: QwenPresetVoiceId;
};

export type TtsPreviewResult = {
  modelId: TtsModelId;
  voiceId: string;
  language: TtsLanguageCode;
  sizeBytes: number;
  audioUrl: string;
};

type RawTtsPreviewResult = {
  modelId: TtsModelId;
  voiceId: string;
  language: TtsLanguageCode;
  sizeBytes: number;
  audioBytes: number[];
};

export async function listTtsVoices(invokeCommand: TauriInvoke = invoke) {
  if (!canUseTauriRuntime()) {
    return [] satisfies TtsVoiceCatalogModel[];
  }

  return await invokeCommand<TtsVoiceCatalogModel[]>("tts_voice_catalog");
}

export async function generateTtsPreview(
  request: GenerateTtsPreviewRequest,
  invokeCommand: TauriInvoke = invoke,
): Promise<TtsPreviewResult> {
  if (!canUseTauriRuntime()) {
    throw new Error("tts_preview_requires_tauri_runtime");
  }

  const result = await invokeCommand<RawTtsPreviewResult>(
    "generate_tts_preview",
    {
      request: {
        text: request.text,
        modelId: request.modelId,
        language: request.language,
        voiceStyleId: request.voiceStyleId,
        qwenPresetVoiceId: request.qwenPresetVoiceId,
      },
    },
  );
  const audioBlob = new Blob([new Uint8Array(result.audioBytes)], {
    type: "audio/wav",
  });

  return {
    modelId: result.modelId,
    voiceId: result.voiceId,
    language: result.language,
    sizeBytes: result.sizeBytes,
    audioUrl: URL.createObjectURL(audioBlob),
  };
}
