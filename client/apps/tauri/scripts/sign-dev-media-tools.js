import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  adHocSignMacOSBinary,
  executableName,
  mediaToolsDirForTarget,
} from "./prepare-media-assets.js";
import { getHostTriple } from "./setup-dev-sidecars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function signDevMediaTools({
  targetTriple = getHostTriple(),
  resourcesDir = join(__dirname, "..", "src-tauri", "resources", "media-tools"),
  signMacOSBinary = adHocSignMacOSBinary,
} = {}) {
  if (process.platform !== "darwin" || !targetTriple.includes("apple-darwin")) {
    return { skipped: true, reason: "not-macos", signed: [] };
  }

  const ytdlpPath = join(
    mediaToolsDirForTarget({ resourcesDir, targetTriple }),
    executableName("yt-dlp", targetTriple),
  );
  if (!existsSync(ytdlpPath)) {
    return { skipped: true, reason: "yt-dlp-missing", signed: [] };
  }

  signMacOSBinary(ytdlpPath);
  return { skipped: false, signed: [ytdlpPath] };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = signDevMediaTools();
  if (result.skipped) {
    console.log(`Skipped dev media tool signing: ${result.reason}`);
  } else {
    for (const filePath of result.signed) {
      console.log(`Signed dev media tool: ${filePath}`);
    }
  }
}
