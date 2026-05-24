import type { TauriInvoke } from "@/services/tauriHelperClient";
import {
  createTtsPreviewDefaultFileName,
  saveTtsPreviewAudio,
} from "@/services/voiceService";
import { describe, expect, it, vi } from "vitest";

describe("voiceService", () => {
  it("uses the first 20 preview characters for the default WAV filename", () => {
    expect(
      createTtsPreviewDefaultFileName("Generate this simple preview."),
    ).toBe("Generate this simple.wav");
    expect(createTtsPreviewDefaultFileName(" / bad:name? ")).toBe(
      "bad name.wav",
    );
  });

  it("exports preview audio bytes to the selected save path", async () => {
    const invokeMock = vi.fn();
    const invokeCommand: TauriInvoke = async <T>() =>
      ({
        targetPath: "/exports/Preview.wav",
        bytesWritten: 3,
      }) as T;
    const fileDialogService = {
      selectVideoFile: vi.fn(),
      selectImageFile: vi.fn(),
      selectSavePath: vi.fn(async () => "/exports/Preview"),
    };
    const trackedInvokeCommand: TauriInvoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      invokeMock(command, args);
      return invokeCommand<T>(command, args);
    };

    const result = await saveTtsPreviewAudio(
      {
        audioBytes: new Uint8Array([1, 2, 3]),
        defaultFileName: "Generate this simple.wav",
      },
      { invokeCommand: trackedInvokeCommand, fileDialogService },
    );

    expect(fileDialogService.selectSavePath).toHaveBeenCalledWith({
      title: "Export voice preview",
      defaultPath: "Generate this simple.wav",
      filters: [{ name: "Audio", extensions: ["wav"] }],
    });
    expect(invokeMock).toHaveBeenCalledWith("export_tts_preview_audio", {
      audioBytes: [1, 2, 3],
      outputDirectory: "/exports",
      fileName: "Preview.wav",
    });
    expect(result).toEqual({
      targetPath: "/exports/Preview.wav",
      bytesWritten: 3,
    });
  });
});
