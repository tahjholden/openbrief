import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  executableName,
  mediaToolsDirForTarget,
} from "./prepare-media-assets.js";
import { signDevMediaTools } from "./sign-dev-media-tools.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "openbrief-dev-media-tools-"));
}

describe("dev media tool signing", () => {
  it("signs an existing macOS yt-dlp resource without downloading tools", () => {
    const resourcesDir = tempDir();
    const targetTriple = "aarch64-apple-darwin";
    const targetDir = mediaToolsDirForTarget({ resourcesDir, targetTriple });
    mkdirSync(targetDir, { recursive: true });
    const ytdlpPath = join(targetDir, executableName("yt-dlp", targetTriple));
    writeFileSync(ytdlpPath, "yt-dlp");
    const signed: string[] = [];

    const result = signDevMediaTools({
      resourcesDir,
      targetTriple,
      signMacOSBinary: (filePath) => signed.push(filePath),
    });

    if (process.platform === "darwin") {
      expect(result).toEqual({ skipped: false, signed: [ytdlpPath] });
      expect(signed).toEqual([ytdlpPath]);
    } else {
      expect(result).toEqual({
        skipped: true,
        reason: "not-macos",
        signed: [],
      });
      expect(signed).toEqual([]);
    }
  });

  it("does not require media tools to exist for dev startup", () => {
    const result = signDevMediaTools({
      resourcesDir: tempDir(),
      targetTriple: "aarch64-apple-darwin",
      signMacOSBinary: () => {
        throw new Error("should not sign missing tool");
      },
    });

    const expectedReason =
      process.platform === "darwin" ? "yt-dlp-missing" : "not-macos";
    expect(result).toEqual({
      skipped: true,
      reason: expectedReason,
      signed: [],
    });
  });
});
