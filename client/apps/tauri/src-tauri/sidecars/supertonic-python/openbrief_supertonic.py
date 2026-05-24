import argparse
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path
from typing import Any


MODEL_ALIASES = {
    "supertonic": "supertonic",
    "supertonic-2": "supertonic-2",
    "supertonic-3": "supertonic-3",
    "supertone/supertonic": "supertonic",
    "supertone/supertonic-2": "supertonic-2",
    "supertone/supertonic-3": "supertonic-3",
}

MODEL_REPOS = {
    "supertonic": "Supertone/supertonic",
    "supertonic-2": "Supertone/supertonic-2",
    "supertonic-3": "Supertone/supertonic-3",
}

WHISPER_MODELS = {
    "whisper-tiny": {
        "fileName": "ggml-tiny.bin",
        "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        "sha1": "bd577a113a864445d4c299885e0cb97d4ba92b5f",
    },
    "whisper-base": {
        "fileName": "ggml-base.bin",
        "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        "sha1": "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
    },
    "whisper-small": {
        "fileName": "ggml-small.bin",
        "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "sha1": "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
    },
    "whisper-medium": {
        "fileName": "ggml-medium.bin",
        "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
        "sha1": "fd9727b6e1217c2f614f9b698455c4ffd82463b4",
    },
    "whisper-large-v3-turbo-q5": {
        "fileName": "ggml-large-v3-turbo-q5_0.bin",
        "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        "sha1": "e050f7970618a659205450ad97eb95a18d69c9ee",
    },
    "whisper-large-v3-turbo": {
        "fileName": "ggml-large-v3-turbo.bin",
        "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        "sha1": "4af2b29d7ec73d781377bfd1758ca957a807e941",
    },
}


def normalize_model(model: str | None) -> str:
    candidate = model or os.environ.get("SUPERTONIC_MODEL_REPO_ID") or "supertonic-3"
    normalized = MODEL_ALIASES.get(candidate.strip().lower())
    if normalized is None:
        supported = ", ".join(sorted(MODEL_REPOS.values()))
        raise ValueError(f"Unsupported Supertonic model '{candidate}'. Supported: {supported}")
    return normalized


def duration_seconds(duration: Any) -> float:
    if hasattr(duration, "__len__"):
        return float(duration[0])
    return float(duration)


def synthesize(args: argparse.Namespace) -> dict[str, Any]:
    if args.cache_dir:
        os.environ["SUPERTONIC_CACHE_DIR"] = str(Path(args.cache_dir).expanduser())

    model_name = normalize_model(args.model)
    text = args.text.strip()
    if not text:
        raise ValueError("Text cannot be empty")

    from supertonic import TTS

    output_path = Path(args.output).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    tts = TTS(model=model_name, auto_download=True)
    voice_style = tts.get_voice_style(voice_name=args.voice_style)
    wav, duration = tts.synthesize(
        text=text,
        lang=args.language,
        voice_style=voice_style,
        total_steps=args.total_steps,
        speed=args.speed,
        silence_duration=args.silence_duration,
    )
    tts.save_audio(wav, str(output_path))

    return {
        "outputPath": str(output_path),
        "durationSeconds": duration_seconds(duration),
        "sampleRate": int(tts.sample_rate),
        "model": model_name,
        "modelRepo": MODEL_REPOS[model_name],
        "voiceStyleId": args.voice_style,
        "language": args.language,
        "sizeBytes": output_path.stat().st_size,
    }


def sha1_file(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    with urllib.request.urlopen(url) as response, partial.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    partial.replace(destination)


def ensure_whisper_model(model_id: str, models_dir: Path) -> Path:
    model = WHISPER_MODELS.get(model_id)
    if model is None:
        supported = ", ".join(sorted(WHISPER_MODELS))
        raise ValueError(f"Unsupported transcription model '{model_id}'. Supported: {supported}")

    model_path = models_dir / model["fileName"]
    if not model_path.is_file():
        download_file(model["url"], model_path)

    actual_sha1 = sha1_file(model_path)
    if actual_sha1 != model["sha1"]:
        raise ValueError(
            f"Checksum mismatch for {model_id}: expected {model['sha1']}, got {actual_sha1}"
        )
    return model_path


def create_smoke_wav(path: Path, duration_seconds: float = 1.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sample_rate = 16_000
    frame_count = int(sample_rate * duration_seconds)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        for index in range(frame_count):
            value = int(0.12 * 32767 * math.sin(2 * math.pi * 440 * index / sample_rate))
            wav.writeframesraw(struct.pack("<h", value))


def helper_executable_name() -> str:
    return "openbrief-helper.exe" if os.name == "nt" else "openbrief-helper"


def resolve_helper_path(value: str | None) -> Path:
    if value:
        return Path(value).expanduser()

    module_dir = Path(__file__).resolve().parent
    candidates = [
        module_dir / helper_executable_name(),
        module_dir / "bin" / helper_executable_name(),
        Path(sys.executable).resolve().parent / helper_executable_name(),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate

    found = shutil.which(helper_executable_name()) or shutil.which("openbrief-helper")
    if found:
        return Path(found)

    raise ValueError(
        "openbrief-helper not found next to openbrief CLI, in its bin directory, or on PATH"
    )


def parse_helper_events(stdout: str) -> list[dict[str, Any]]:
    events = []
    for line in stdout.splitlines():
        line = line.strip()
        if line:
            events.append(json.loads(line))
    return events


def transcribe(args: argparse.Namespace) -> dict[str, Any]:
    helper = resolve_helper_path(args.helper)
    if not helper.is_file():
        raise ValueError(f"openbrief-helper not found at {helper}")

    output_path = Path(args.output).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    audio_path = Path(args.audio).expanduser() if args.audio else output_path.parent / "stt-smoke.wav"
    if args.audio is None:
        create_smoke_wav(audio_path)
    elif not audio_path.is_file():
        raise ValueError(f"Audio file not found at {audio_path}")

    models_dir = Path(args.models_dir).expanduser()
    model_path = ensure_whisper_model(args.model, models_dir)

    request = {
        "protocolVersion": 1,
        "jobId": f"stt-smoke-{args.model}",
        "command": "transcribe_audio",
        "audioPath": str(audio_path),
        "modelPath": str(model_path),
        "outputPath": str(output_path),
    }
    if args.language:
        request["language"] = args.language

    completed = subprocess.run(
        [str(helper), "--json", json.dumps(request)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    events = parse_helper_events(completed.stdout)
    if completed.returncode != 0:
        raise RuntimeError(
            json.dumps(
                {
                    "helperStatus": completed.returncode,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                }
            )
        )

    completion = next(
        (event for event in reversed(events) if event.get("event") == "job_completed"),
        None,
    )
    if completion is None:
        raise RuntimeError(f"openbrief-helper did not emit job_completed: {completed.stdout}")
    if not output_path.is_file():
        raise RuntimeError(f"Transcript output missing at {output_path}")

    return {
        "command": "transcribe",
        "model": args.model,
        "modelPath": str(model_path),
        "modelSha1": sha1_file(model_path),
        "audioPath": str(audio_path),
        "outputPath": str(output_path),
        "transcriptBytes": output_path.stat().st_size,
        "helperEventCount": len(events),
        "result": completion.get("result"),
    }


def add_generation_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("text", nargs="?", help="Text to synthesize")
    parser.add_argument("--text", dest="text_option", help=argparse.SUPPRESS)
    parser.add_argument("--output", default="openbrief-supertonic.wav")
    parser.add_argument("--model")
    parser.add_argument("--cache-dir")
    parser.add_argument("--voice-style", "--voice", default="M1")
    parser.add_argument("--language", "--lang", default="en")
    parser.add_argument("--total-steps", "--steps", type=int, default=8)
    parser.add_argument("--speed", type=float, default=1.05)
    parser.add_argument("--silence-duration", type=float, default=0.3)


def add_transcribe_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("audio", nargs="?", help="16 kHz mono WAV input. Omit for smoke audio.")
    parser.add_argument("--model", default="whisper-tiny", choices=sorted(WHISPER_MODELS))
    parser.add_argument("--helper", help="Override the embedded openbrief-helper path")
    parser.add_argument("--models-dir", default="openbrief-stt-models")
    parser.add_argument("--output", default="openbrief-transcript.json")
    parser.add_argument("--language", "--lang")


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="openbrief")
    subparsers = parser.add_subparsers(dest="command")
    read_parser = subparsers.add_parser("read", help="Generate speech from text")
    add_generation_args(read_parser)
    transcribe_parser = subparsers.add_parser("transcribe", help="Transcribe audio with OpenBrief STT")
    add_transcribe_args(transcribe_parser)
    return parser


def create_legacy_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    add_generation_args(parser)
    return parser


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    argv = argv or []
    if argv[:1] in (["read"], ["transcribe"]):
        args = create_parser().parse_args(argv)
    else:
        args = create_legacy_parser().parse_args(argv)
        args.command = "read"

    if args.command == "transcribe":
        return args

    if args.text is None:
        args.text = args.text_option
    if args.text is None:
        raise SystemExit("openbrief read requires text")
    return args


def main(argv: list[str] | None = None) -> None:
    import sys

    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = transcribe(args) if args.command == "transcribe" else synthesize(args)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
