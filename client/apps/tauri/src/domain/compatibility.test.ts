import {
  createPlatformCompatibilityReport,
  getSttModelCompatibility,
  normalizeArchitecture,
  normalizeDesktopPlatform,
} from "@/domain/compatibility";
import { describe, expect, it } from "vitest";

describe("platform compatibility", () => {
  it("normalizes Tauri OS and architecture names", () => {
    expect(normalizeDesktopPlatform("darwin")).toBe("macos");
    expect(normalizeDesktopPlatform("win32")).toBe("windows");
    expect(normalizeArchitecture("arm64")).toBe("aarch64");
    expect(normalizeArchitecture("amd64")).toBe("x86_64");
  });

  it("supports macOS Apple Silicon without warnings when tools are available", () => {
    const report = createPlatformCompatibilityReport({
      platform: "macos",
      architecture: "aarch64",
      downloaderStatus: "available",
      ytdlpIsStale: false,
      mediaTools: configuredMediaTools,
      sttModels: [{ id: "whisper-small", name: "Whisper Small", sizeMb: 466 }],
    });

    expect(report.targetTriple).toBe("aarch64-apple-darwin");
    expect(report.summarySeverity).toBe("supported");
    expect(getSttModelCompatibility(report, "whisper-small")?.severity).toBe(
      "supported",
    );
  });

  it("warns on supported-but-not-smoked Windows and stale yt-dlp", () => {
    const report = createPlatformCompatibilityReport({
      platform: "windows",
      architecture: "x86_64",
      downloaderStatus: "available",
      ytdlpIsStale: true,
      mediaTools: configuredMediaTools,
      sttModels: [{ id: "whisper-small", name: "Whisper Small", sizeMb: 466 }],
    });

    expect(report.targetTriple).toBe("x86_64-pc-windows-msvc");
    expect(report.summarySeverity).toBe("warning");
    expect(
      report.features.find((feature) => feature.id === "video-download")
        ?.message,
    ).toMatch(/stale/i);
  });

  it("blocks unknown or unsupported targets", () => {
    const report = createPlatformCompatibilityReport({
      platform: "windows",
      architecture: "arm64",
      downloaderStatus: "available",
      ytdlpIsStale: false,
      mediaTools: configuredMediaTools,
    });

    expect(report.targetSupported).toBe(false);
    expect(report.summarySeverity).toBe("blocked");
    expect(
      report.features.find((feature) => feature.id === "target")?.severity,
    ).toBe("blocked");
  });

  it("blocks large STT models on Linux ARM64 until runtime smoke exists", () => {
    const report = createPlatformCompatibilityReport({
      platform: "linux",
      architecture: "aarch64",
      downloaderStatus: "available",
      ytdlpIsStale: false,
      mediaTools: configuredMediaTools,
      sttModels: [
        { id: "whisper-small", name: "Whisper Small", sizeMb: 466 },
        { id: "whisper-medium", name: "Whisper Medium", sizeMb: 1536 },
      ],
    });

    expect(getSttModelCompatibility(report, "whisper-small")?.severity).toBe(
      "warning",
    );
    expect(getSttModelCompatibility(report, "whisper-medium")?.severity).toBe(
      "blocked",
    );
  });

  it("blocks non-Whisper STT models on Linux packages", () => {
    const report = createPlatformCompatibilityReport({
      platform: "linux",
      architecture: "x86_64",
      downloaderStatus: "available",
      ytdlpIsStale: false,
      mediaTools: configuredMediaTools,
      sttModels: [
        { id: "qwen3-asr-0.6B", name: "Qwen3-ASR 0.6B", sizeMb: 2400 },
        { id: "parakeet-tdt-0.6b-v3", name: "Parakeet v3", sizeMb: 1200 },
        { id: "whisper-small", name: "Whisper Small", sizeMb: 466 },
      ],
    });

    expect(getSttModelCompatibility(report, "qwen3-asr-0.6B")?.severity).toBe(
      "blocked",
    );
    expect(
      getSttModelCompatibility(report, "parakeet-tdt-0.6b-v3")?.severity,
    ).toBe("blocked");
    expect(getSttModelCompatibility(report, "whisper-small")?.severity).toBe(
      "warning",
    );
  });
});

const configuredMediaTools = [
  { tool: "yt-dlp", status: "configured" as const },
  { tool: "ffmpeg", status: "configured" as const },
  { tool: "ffprobe", status: "configured" as const },
];
