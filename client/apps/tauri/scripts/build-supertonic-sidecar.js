import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createDevSidecarPlaceholder,
  getHostTriple,
  sidecarFileName,
} from "./setup-dev-sidecars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectDir = join(__dirname, "..");
const rustCrateDir = join(projectDir, "src-tauri");
const sidecarSourceDir = join(rustCrateDir, "sidecars", "supertonic-python");
const buildRoot = join(rustCrateDir, "target", "supertonic-sidecar");

export function releaseModeFromArgs(args) {
  if (args.includes("--debug")) return false;
  if (args.includes("--release")) return true;
  return true;
}

export function targetTripleFromArgs(args) {
  const targetFlagIndex = args.indexOf("--target");
  if (targetFlagIndex >= 0) {
    const targetTriple = args[targetFlagIndex + 1];
    if (!targetTriple) {
      throw new Error("--target requires a target triple");
    }
    return targetTriple;
  }

  return getHostTriple();
}

export function pythonExecutableForPlatform(platform = process.platform) {
  return platform === "win32" ? "python" : "python3";
}

export function venvPythonPath(venvDir, targetTriple) {
  return targetTriple.includes("windows")
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");
}

export function pyinstallerOutputPath({ distDir, targetTriple }) {
  const executable = targetTriple.includes("windows")
    ? "openbrief-supertonic.exe"
    : "openbrief-supertonic";
  return join(distDir, executable);
}

export function copyBuiltSupertonicSidecar({
  targetTriple = getHostTriple(),
  sourcePath,
  binariesDir = join(rustCrateDir, "binaries"),
} = {}) {
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error(`Built Supertonic sidecar not found: ${sourcePath}`);
  }

  mkdirSync(binariesDir, { recursive: true });
  const destinationName = sidecarFileName("openbrief-supertonic", targetTriple);
  const destinationPath = join(binariesDir, destinationName);
  copyFileSync(sourcePath, destinationPath);

  if (!destinationName.endsWith(".exe")) {
    chmodSync(destinationPath, 0o755);
  }

  return {
    sourcePath,
    destinationName,
    destinationPath,
    size: statSync(destinationPath).size,
  };
}

export function buildSupertonicSidecar({
  execFile = execFileSync,
  targetTriple = getHostTriple(),
  hostTriple = getHostTriple(),
  release = true,
  binariesDir = join(rustCrateDir, "binaries"),
  sourceDir = sidecarSourceDir,
  root = buildRoot,
  platform = process.platform,
} = {}) {
  if (release && targetTriple !== hostTriple) {
    throw new Error(
      `PyInstaller cannot cross-compile Supertonic sidecars; build ${targetTriple} on its matching host instead of ${hostTriple}`,
    );
  }

  createDevSidecarPlaceholder({
    binariesDir,
    baseName: "openbrief-supertonic",
    targetTriple,
    message:
      "OpenBrief dev Supertonic sidecar placeholder. Build the PyInstaller sidecar before packaging.",
  });

  if (!release) {
    return {
      skipped: true,
      reason: "debug builds use the dev placeholder and Rust venv fallback",
      targetTriple,
    };
  }

  const venvDir = join(root, "venv", targetTriple);
  const distDir = join(root, "dist", targetTriple);
  const workDir = join(root, "work", targetTriple);
  const specDir = join(root, "spec", targetTriple);
  const bootstrapPython = pythonExecutableForPlatform(platform);
  const python = venvPythonPath(venvDir, targetTriple);

  if (!existsSync(python)) {
    execFile(bootstrapPython, ["-m", "venv", venvDir], { stdio: "inherit" });
  }

  execFile(python, ["-m", "pip", "install", "--upgrade", "pip"], {
    stdio: "inherit",
  });
  execFile(python, ["-m", "pip", "install", "pyinstaller"], {
    stdio: "inherit",
  });
  execFile(python, ["-m", "pip", "install", `${sourceDir}[read]`], {
    stdio: "inherit",
  });

  mkdirSync(distDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  mkdirSync(specDir, { recursive: true });

  execFile(
    python,
    [
      "-m",
      "PyInstaller",
      "--clean",
      "--onefile",
      "--name",
      "openbrief-supertonic",
      "--distpath",
      distDir,
      "--workpath",
      workDir,
      "--specpath",
      specDir,
      "--collect-all",
      "supertonic",
      "--collect-all",
      "onnxruntime",
      "--collect-all",
      "soundfile",
      join(sourceDir, "openbrief_supertonic.py"),
    ],
    {
      cwd: sourceDir,
      stdio: "inherit",
    },
  );

  return {
    skipped: false,
    ...copyBuiltSupertonicSidecar({
      binariesDir,
      targetTriple,
      sourcePath: pyinstallerOutputPath({ distDir, targetTriple }),
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const result = buildSupertonicSidecar({
    targetTriple: targetTripleFromArgs(args),
    release: releaseModeFromArgs(args),
  });

  if (result.skipped) {
    console.log(`Skipped Supertonic sidecar: ${result.reason}`);
  } else {
    console.log(`Copied Supertonic sidecar: ${result.destinationName} (${result.size} bytes)`);
  }
}
