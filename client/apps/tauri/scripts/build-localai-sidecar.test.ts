import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocalAiSidecar,
  buildProfileFromArgs,
  copyBuiltLocalAiSidecar,
  extrasForBuildProfile,
  pyinstallerCollectArgs,
  pyinstallerOutputPath,
  releaseModeFromArgs,
  targetTripleFromArgs,
  torchInstallArgsForTarget,
  venvPythonPath,
} from "./build-localai-sidecar.js";

describe("Local AI sidecar build script", () => {
  it("defaults to release builds for packaging", () => {
    expect(releaseModeFromArgs([])).toBe(true);
  });

  it("supports debug placeholder builds for development", () => {
    expect(releaseModeFromArgs(["--debug"])).toBe(false);
  });

  it("parses explicit target arguments", () => {
    expect(targetTripleFromArgs(["--target", "x86_64-pc-windows-msvc"])).toBe(
      "x86_64-pc-windows-msvc",
    );
    expect(() => targetTripleFromArgs(["--target"])).toThrow(/requires/);
  });

  it("parses explicit build profiles", () => {
    expect(buildProfileFromArgs(["--profile", "tts"])).toBe("tts");
    expect(buildProfileFromArgs(["--profile", "asr"])).toBe("asr");
    expect(buildProfileFromArgs(["--profile", "smoke"])).toBe("smoke");
    expect(() => buildProfileFromArgs(["--profile"])).toThrow(/requires/);
    expect(() => buildProfileFromArgs(["--profile", "all"])).toThrow(/Unsupported/);
  });

  it("keeps Qwen TTS and ASR dependency profiles separate", () => {
    expect(
      extrasForBuildProfile({
        profile: "tts",
        targetTriple: "x86_64-unknown-linux-gnu",
      }),
    ).toEqual(["qwen-tts"]);
    expect(
      extrasForBuildProfile({
        profile: "asr",
        targetTriple: "x86_64-unknown-linux-gnu",
      }),
    ).toEqual(["qwen-asr"]);
  });

  it("adds MLX dependencies only for native Apple Silicon model profiles", () => {
    expect(
      extrasForBuildProfile({
        profile: "tts",
        targetTriple: "aarch64-apple-darwin",
      }),
    ).toEqual(["qwen-tts", "torch", "mlx"]);
    expect(
      extrasForBuildProfile({
        profile: "smoke",
        targetTriple: "aarch64-apple-darwin",
      }),
    ).toEqual([]);
  });

  it("pins CPU-only Torch wheels for Linux and Windows release sidecars", () => {
    expect(torchInstallArgsForTarget("x86_64-unknown-linux-gnu")).toEqual([
      "-m",
      "pip",
      "install",
      "torch>=2.4",
      "--index-url",
      "https://download.pytorch.org/whl/cpu",
    ]);
    expect(torchInstallArgsForTarget("x86_64-pc-windows-msvc")).toEqual([
      "-m",
      "pip",
      "install",
      "torch>=2.4",
      "--index-url",
      "https://download.pytorch.org/whl/cpu",
    ]);
    expect(torchInstallArgsForTarget("aarch64-apple-darwin")).toBeNull();
  });

  it("collects only installed model modules for PyInstaller", () => {
    const ttsArgs = pyinstallerCollectArgs({
      profile: "tts",
      targetTriple: "x86_64-unknown-linux-gnu",
    });
    const asrArgs = pyinstallerCollectArgs({
      profile: "asr",
      targetTriple: "x86_64-unknown-linux-gnu",
    });

    expect(ttsArgs).toContain("qwen_tts");
    expect(ttsArgs).not.toContain("qwen_asr");
    expect(asrArgs).toContain("qwen_asr");
    expect(asrArgs).not.toContain("qwen_tts");
    expect(
      pyinstallerCollectArgs({
        profile: "smoke",
        targetTriple: "x86_64-unknown-linux-gnu",
      }),
    ).toEqual([]);
  });

  it("uses platform-specific venv Python paths", () => {
    expect(venvPythonPath("/tmp/venv", "x86_64-unknown-linux-gnu")).toBe(
      "/tmp/venv/bin/python",
    );
    expect(venvPythonPath("C:\\tmp\\venv", "x86_64-pc-windows-msvc")).toMatch(
      /Scripts[/\\]python\.exe$/,
    );
  });

  it("uses the PyInstaller onefile output name for the target", () => {
    expect(
      pyinstallerOutputPath({
        distDir: "/tmp/dist",
        targetTriple: "x86_64-pc-windows-msvc",
      }),
    ).toMatch(/openbrief-localai\.exe$/);
  });

  it("copies built sidecars to the Tauri target-triple name", () => {
    const root = mkdtempSync(join(tmpdir(), "openbrief-localai-copy-"));
    const sourcePath = join(root, "openbrief-localai");
    const binariesDir = join(root, "binaries");
    writeFileSync(sourcePath, "#!/bin/sh\n");

    const result = copyBuiltLocalAiSidecar({
      sourcePath,
      binariesDir,
      targetTriple: "aarch64-apple-darwin",
    });

    expect(result.destinationName).toBe("openbrief-localai-aarch64-apple-darwin");
    expect(existsSync(result.destinationPath)).toBe(true);
  });

  it("creates a placeholder and skips PyInstaller in debug mode", () => {
    const root = mkdtempSync(join(tmpdir(), "openbrief-localai-build-"));
    const result = buildLocalAiSidecar({
      root,
      binariesDir: join(root, "binaries"),
      targetTriple: "x86_64-unknown-linux-gnu",
      release: false,
      execFile: () => {
        throw new Error("debug build should not invoke Python");
      },
    });

    expect(result.skipped).toBe(true);
    expect(
      existsSync(join(root, "binaries", "openbrief-localai-x86_64-unknown-linux-gnu")),
    ).toBe(true);
  });

  it("installs CPU Torch before Qwen extras on Linux release builds", () => {
    const root = mkdtempSync(join(tmpdir(), "openbrief-localai-release-"));
    const sourceDir = join(root, "source");
    const commands: string[][] = [];
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "openbrief_localai.py"), "print('localai')\n");

    const result = buildLocalAiSidecar({
      root,
      sourceDir,
      binariesDir: join(root, "binaries"),
      targetTriple: "x86_64-unknown-linux-gnu",
      hostTriple: "x86_64-unknown-linux-gnu",
      release: true,
      execFile: (_command, args) => {
        commands.push(args.map(String));
        if (args.includes("PyInstaller")) {
          const distDir = join(root, "dist", "x86_64-unknown-linux-gnu");
          mkdirSync(distDir, { recursive: true });
          writeFileSync(join(distDir, "openbrief-localai"), "#!/bin/sh\n");
        }
      },
    });

    const torchInstallIndex = commands.findIndex((args) =>
      args.includes("https://download.pytorch.org/whl/cpu"),
    );
    const qwenInstallIndex = commands.findIndex((args) =>
      args.some((arg) => arg.endsWith("[qwen-tts]")),
    );

    expect(result.skipped).toBe(false);
    expect(torchInstallIndex).toBeGreaterThan(-1);
    expect(qwenInstallIndex).toBeGreaterThan(torchInstallIndex);
  });

  it("rejects cross-target PyInstaller release builds", () => {
    const root = mkdtempSync(join(tmpdir(), "openbrief-localai-cross-"));

    expect(() =>
      buildLocalAiSidecar({
        root,
        binariesDir: join(root, "binaries"),
        targetTriple: "x86_64-pc-windows-msvc",
        hostTriple: "aarch64-apple-darwin",
        release: true,
        execFile: () => {
          throw new Error("release guard should run before Python");
        },
      }),
    ).toThrow(/cannot cross-compile/);
  });
});
