# Qwen3-TTS Local AI Integration Plan

## Target Result

Integrate Local AI local voice cloning into the OpenBrief Tauri app, focused only on Qwen3-TTS.

The target feature is local speech generation from summaries, transcripts, notes, and chat responses using a user-created cloned voice profile. The app must support macOS Apple Silicon, macOS Intel, Windows, and Linux. Support means the app can install or bundle the right sidecar, expose model status/download/load/generate flows, and fail with clear platform-specific capability messages when acceleration is unavailable.

Do not vendor the local `voicebox/` reference repo into product code. Treat it as the implementation reference for sidecar shape, model registry, model downloading, runtime selection, and inference.

## Scope Decisions

1. Focus on Qwen3-TTS base models only:
   - `qwen-tts-0.6B`
   - `qwen-tts-1.7B`
2. Support Qwen3-TTS voice cloning with reference audio plus reference text.
3. Ship a Voicebox-like Python sidecar managed by Rust/Tauri.
4. Replicate Voicebox's model management behavior:
   - app-owned HuggingFace cache root
   - explicit model status
   - explicit model download
   - progress events
   - load-on-demand inference
   - unload/delete controls
5. Support all desktop release platforms from the start of the design:
   - macOS arm64
   - macOS x86_64
   - Windows x86_64
   - Linux x86_64
   - Linux arm64 where our Tauri release pipeline supports it

## Non-Goals

- Do not add LuxTTS, Kokoro, Chatterbox, TADA, Whisper, MCP, dictation, capture, local LLM refinement, or Voicebox history/story UI in this integration.
- Do not expose arbitrary local HTTP access from the renderer.
- Do not let the renderer pass raw output paths, model-cache paths, or app-data roots.
- Do not auto-download multi-GB models during app install. Download only after explicit user action.
- Do not implement Qwen CustomVoice in the first pass. It is Qwen-branded, but it is preset/instruction TTS rather than arbitrary cloned-voice generation.

## Reference Anchors

Local Voicebox files used as the reference implementation:

- `VOICEBOX_ARCH.md`
- `voicebox/backend/models.py`
- `voicebox/backend/routes/models.py`
- `voicebox/backend/routes/generations.py`
- `voicebox/backend/backends/__init__.py`
- `voicebox/backend/backends/base.py`
- `voicebox/backend/backends/mlx_backend.py`
- `voicebox/backend/backends/pytorch_backend.py`
- `voicebox/backend/utils/chunked_tts.py`
- `voicebox/backend/utils/platform_detect.py`
- `voicebox/backend/config.py`
- `voicebox/backend/server.py`
- `voicebox/backend/build_binary.py`
- `voicebox/scripts/build-server.sh`
- `voicebox/scripts/setup-dev-sidecar.js`
- `voicebox/tauri/src-tauri/tauri.conf.json`
- `voicebox/tauri/src-tauri/src/main.rs`

Relevant OpenBrief anchors:

- Tauri app: `client/apps/tauri`
- Rust helper sidecar: `client/apps/tauri/src-tauri/helper`
- Existing sidecar area: `client/apps/tauri/src-tauri/sidecars`
- Existing build scripts: `client/apps/tauri/scripts`
- Existing STT model management: `client/apps/tauri/src-tauri/src/stt_models.rs`
- Renderer services/settings/features: `client/apps/tauri/src/services`, `client/apps/tauri/src/features`

## Qwen3-TTS Model Registry

Mirror Voicebox's Qwen model ids and backend-aware HF repo selection.

| Model id | Engine | Size | Languages | Apple Silicon MLX repo | PyTorch repo |
| --- | --- | ---: | --- | --- | --- |
| `qwen-tts-0.6B` | `qwen` | ~1.2 GB | `zh,en,ja,ko,de,fr,ru,pt,es,it` | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` | `Qwen/Qwen3-TTS-12Hz-0.6B-Base` |
| `qwen-tts-1.7B` | `qwen` | ~3.5 GB | `zh,en,ja,ko,de,fr,ru,pt,es,it` | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` |

Default generation config should match Voicebox:

```json
{
  "engine": "qwen",
  "modelId": "qwen-tts-1.7B",
  "modelSize": "1.7B",
  "language": "en",
  "maxChunkChars": 800,
  "crossfadeMs": 50,
  "normalize": true,
  "personality": false,
  "seed": null,
  "instruct": null
}
```

OpenBrief should show `qwen-tts-0.6B` as the recommended first download on CPU-only machines and `qwen-tts-1.7B` as the quality default where memory and acceleration are available.

## Qwen3-ASR Extension

Qwen3-ASR reuses the same `openbrief-localai` sidecar so the app has one frozen Python runtime for Qwen speech features. Model weights are still downloaded on demand into the app-owned local AI Hugging Face cache.

| Model id | Engine | Languages | Apple Silicon MLX repo | PyTorch repo | Forced aligner |
| --- | --- | --- | --- | --- | --- |
| `qwen3-asr-0.6B` | `qwen3-asr` | 11 timestamp languages: `zh,en,yue,fr,de,it,ja,ko,pt,ru,es` | `mlx-community/Qwen3-ASR-0.6B-8bit` | `Qwen/Qwen3-ASR-0.6B` | `Qwen3-ForcedAligner-0.6B` |
| `qwen3-asr-1.7B` | `qwen3-asr` | 11 timestamp languages: `zh,en,yue,fr,de,it,ja,ko,pt,ru,es` | `mlx-community/Qwen3-ASR-1.7B-8bit` | `Qwen/Qwen3-ASR-1.7B` | `Qwen3-ForcedAligner-0.6B` |

Platform policy:

1. macOS Apple Silicon uses MLX-Audio Qwen3-ASR and MLX-Audio Qwen3-ForcedAligner.
2. macOS Intel, Windows, and Linux use the official `qwen-asr` package and Qwen checkpoints.
3. Word timestamps require the forced aligner. Streaming ASR is out of scope for timestamped transcript generation because upstream Qwen streaming does not use the forced aligner.
4. `qwen3-asr-0.6B` is the default STT recommendation because it is the lower-cost model and still supports forced alignment.

## Platform Matrix

Voicebox selects MLX only on Apple Silicon when `mlx.core` imports successfully; otherwise it uses PyTorch. Replicate that rule, but make capability reporting explicit before generation.

| Platform | Required sidecar variant | Runtime | Default repo family | Acceleration policy |
| --- | --- | --- | --- | --- |
| macOS arm64 | `openbrief-localai-aarch64-apple-darwin` | MLX preferred, PyTorch fallback | MLX repos when MLX is available; PyTorch repos otherwise | MLX/Metal first. If MLX import fails, surface fallback status and use PyTorch CPU only if packaged. |
| macOS x86_64 | `openbrief-localai-x86_64-apple-darwin` | PyTorch | PyTorch repos | CPU first. No MLX. Warn before 1.7B download/generation. |
| Windows x86_64 | `openbrief-localai-x86_64-pc-windows-msvc.exe` | PyTorch | PyTorch repos | CPU sidecar bundled. CUDA sidecar can be optional downloaded backend. DirectML/XPU can be enabled if dependency packaging is stable. |
| Linux x86_64 | `openbrief-localai-x86_64-unknown-linux-gnu` | PyTorch | PyTorch repos | CPU sidecar bundled. CUDA/ROCm/XPU treated as optional later variants unless CI can build and smoke-test them. |
| Linux arm64 | `openbrief-localai-aarch64-unknown-linux-gnu` | PyTorch | PyTorch repos | CPU sidecar if OpenBrief ships Linux arm64. Otherwise report unsupported at build/release level. |

Device selection in PyTorch mode should follow Voicebox's Qwen backend:

1. CUDA if `torch.cuda.is_available()`
2. Intel XPU if `intel_extension_for_pytorch` and `torch.xpu` are available
3. DirectML on Windows if `torch_directml` is available
4. CPU fallback

## Product Rules

1. Voice cloning is opt-in and consent-gated.
2. Reference samples must be user-selected or user-recorded intentionally.
3. Each Qwen voice sample must store both audio and `referenceText`.
4. Model downloads are explicit, cancellable, and progress-visible.
5. Generated audio and profiles live under app-owned storage.
6. Generated artifacts store provenance:
   - engine
   - model id
   - backend type
   - HF repo id
   - voice profile id
   - reference sample ids
   - language
   - seed
   - source text hash
   - created time
7. Renderer receives ids, labels, status, and playback/export commands only. Rust owns raw paths.

## Storage Layout

Use OpenBrief-owned data roots. The sidecar should not write to Voicebox's default `data/` folder.

```text
app-data/
  models/
    localai/
      hf/
        models--Qwen--Qwen3-TTS-12Hz-1.7B-Base/
        models--Qwen--Qwen3-TTS-12Hz-0.6B-Base/
        models--mlx-community--Qwen3-TTS-12Hz-1.7B-Base-bf16/
        models--mlx-community--Qwen3-TTS-12Hz-0.6B-Base-bf16/
  localai/
    profiles/
      <profile-id>/
        profile.json
        samples/
          <sample-id>.wav
        prompts/
          qwen-<model-id>-<sample-hash>.json
    generations/
      <generation-id>/
        audio.wav
        metadata.json
    logs/
      sidecar.log
```

Rust responsibilities:

- Create and canonicalize roots.
- Pass roots to the sidecar through argv/env.
- Set `OPENBRIEF_LOCALAI_MODELS_DIR` to `app-data/models/localai/hf`.
- Optionally set `HF_HUB_CACHE` directly as a belt-and-suspenders fallback.
- Refuse renderer-supplied absolute output/model paths.

Sidecar responsibilities:

- Read `OPENBRIEF_LOCALAI_MODELS_DIR` at startup and route HuggingFace downloads there.
- Store voice prompts/cache only below the configured data directory.
- Return storage-relative paths to Rust, not arbitrary absolute paths to the renderer.

## Sidecar Shape

Create a reduced Python sidecar named `openbrief-localai`.

The sidecar should be a minimal FastAPI server with the same major lifecycle as Voicebox:

```text
GET  /health
GET  /runtime
GET  /models/status
POST /models/download
POST /models/download/cancel
POST /models/load
POST /models/unload
DELETE /models/{modelId}
POST /profiles
GET  /profiles
POST /profiles/{profileId}/samples
DELETE /profiles/{profileId}
POST /generate
GET  /generate/{generationId}/status
POST /generate/{generationId}/cancel
```

Startup arguments should mirror Voicebox:

```text
openbrief-localai \
  --host 127.0.0.1 \
  --port <ephemeral-or-reserved-port> \
  --data-dir <app-data/localai> \
  --parent-pid <tauri-pid>
```

Environment:

```text
OPENBRIEF_LOCALAI_MODELS_DIR=<app-data/models/localai/hf>
HF_HUB_CACHE=<app-data/models/localai/hf>
OPENBRIEF_LOCALAI_TOKEN=<random-per-launch-token>
```

Prefer a random loopback port plus token. Keep stdio JSON-RPC as a fallback if local HTTP is considered too wide an attack surface.

## Installation And Packaging

Replicate Voicebox's sidecar installation model, adapted for OpenBrief.

### Build Artifacts

Add platform-specific sidecar binaries under Tauri `externalBin` naming:

```text
client/apps/tauri/src-tauri/binaries/openbrief-localai-<target-triple>
client/apps/tauri/src-tauri/binaries/openbrief-localai-<target-triple>.exe
```

Tauri config should register only the sidecar basename:

```json
{
  "bundle": {
    "externalBin": ["binaries/openbrief-localai"]
  }
}
```

Build scripts:

- `client/apps/tauri/scripts/setup-dev-localai-sidecar.js`
  - creates placeholder binaries for local dev, like Voicebox's `setup-dev-sidecar.js`
  - does not hide missing real binaries in release builds
- `client/apps/tauri/scripts/build-localai-sidecar.sh`
  - builds current host target
  - copies `dist/openbrief-localai` to the Tauri `binaries/` target-triple name
- CI release jobs
  - build macOS arm64 on macOS arm64
  - build macOS x86_64 on macOS x86_64 or cross-compatible builder if proven
  - build Windows x86_64 on Windows
  - build Linux x86_64 on Linux
  - optionally build Linux arm64 when OpenBrief releases that target

### Python Freezing

Use PyInstaller initially because Voicebox already proves this path. Keep the frozen sidecar smaller than Voicebox by including only Qwen dependencies.

Required hidden/import collection areas:

- `fastapi`
- `uvicorn`
- `huggingface_hub`
- `transformers`
- `safetensors`
- `tokenizers`
- `soundfile`
- `numpy`
- `torch` for PyTorch builds
- `qwen_tts` and all source files it inspects at runtime
- `mlx_audio` and `mlx` for macOS arm64 MLX builds

Do not include Voicebox dependencies for Chatterbox, TADA, LuxTTS, Kokoro, Whisper, MCP, SQLAlchemy history, captures, or local LLM refinement.

### Runtime Variants

Start with one bundled CPU/MLX-capable sidecar per release target:

- macOS arm64: MLX-enabled sidecar. Include PyTorch fallback only if bundle size and import conflicts are acceptable.
- macOS x86_64: PyTorch CPU sidecar.
- Windows x86_64: PyTorch CPU sidecar.
- Linux x86_64: PyTorch CPU sidecar.

Optional later variants:

- Windows CUDA `onedir` backend, downloaded after install like Voicebox's CUDA backend.
- Linux CUDA/ROCm sidecar variants if release size and dependency compatibility are acceptable.
- Intel XPU or DirectML variants if frozen-binary smoke tests prove reliable.

### App Installation Behavior

App install includes the sidecar binary, not Qwen model weights.

First app launch:

1. Rust checks sidecar binary presence.
2. Rust starts sidecar with app-owned data/model dirs.
3. Rust calls `/health` and `/runtime`.
4. Renderer shows Qwen model availability from Rust commands.
5. No model is downloaded until the user chooses a Qwen model and confirms size/runtime cost.

## Model Downloading

Mirror Voicebox's download strategy:

1. The model registry maps `modelId` to the backend-specific HF repo id.
2. `/models/status` scans `HF_HUB_CACHE` for repo cache folders and weight files.
3. `/models/download` starts a background task that calls the same load path used by inference.
4. HuggingFace progress is captured by patching or wrapping tqdm/progress callbacks.
5. Progress is exposed to Rust through SSE or a polling endpoint.
6. `.incomplete` blobs mean the model is not downloaded.
7. `/models/download/cancel` clears active task/progress state.
8. `/models/{modelId}` unloads then deletes the HF cache folder for the repo.

Model status shape:

```json
{
  "modelId": "qwen-tts-1.7B",
  "displayName": "Qwen3-TTS 1.7B",
  "engine": "qwen",
  "backend": "mlx",
  "hfRepoId": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
  "downloaded": false,
  "downloading": false,
  "loaded": false,
  "sizeMb": 3500,
  "languages": ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]
}
```

Rust should normalize progress events before sending them to the renderer:

```json
{
  "kind": "localai:model-download-progress",
  "modelId": "qwen-tts-1.7B",
  "currentBytes": 1048576,
  "totalBytes": 3500000000,
  "filename": "model-00001-of-00002.safetensors",
  "status": "downloading"
}
```

## Inference Flow

Qwen inference should follow Voicebox's sequence.

1. Resolve model id and backend.
2. Load model on demand:
   - MLX: `mlx_audio.tts.load(<mlx repo id>)`
   - PyTorch: `Qwen3TTSModel.from_pretrained(<repo id>, cache_dir=HF_HUB_CACHE, ...)`
3. Create or load cached voice prompt from profile samples:
   - MLX stores prompt as `ref_audio` plus `ref_text`
   - PyTorch calls `create_voice_clone_prompt(ref_audio, ref_text, x_vector_only_mode=False)`
4. Split long text into natural chunks with default `maxChunkChars=800`.
5. Generate each chunk:
   - MLX calls model `generate(text, ref_audio=..., ref_text=..., lang_code=...)` when supported
   - PyTorch calls `generate_voice_clone(text=..., voice_clone_prompt=..., language=..., instruct=...)`
6. Concatenate chunks with `crossfadeMs=50`.
7. Normalize audio when requested.
8. Save WAV under `app-data/localai/generations/<generation-id>/audio.wav`.
9. Persist metadata and return a generation id to the renderer.

Request shape:

```json
{
  "profileId": "voice-profile-id",
  "text": "Text to speak",
  "language": "en",
  "modelId": "qwen-tts-1.7B",
  "seed": 1234,
  "maxChunkChars": 800,
  "crossfadeMs": 50,
  "normalize": true,
  "source": {
    "kind": "summary",
    "artifactId": "..."
  }
}
```

Response shape:

```json
{
  "generationId": "...",
  "status": "queued",
  "modelId": "qwen-tts-1.7B",
  "backend": "mlx",
  "language": "en"
}
```

Completed generation shape:

```json
{
  "generationId": "...",
  "status": "completed",
  "audioId": "...",
  "durationSeconds": 12.34,
  "modelId": "qwen-tts-1.7B",
  "backend": "mlx",
  "language": "en",
  "seed": 1234
}
```

## Rust Boundary

Add a Rust module, likely `client/apps/tauri/src-tauri/src/localai.rs`.

Commands:

```text
localai_runtime_status
list_localai_models
download_localai_model
cancel_localai_model_download
load_localai_model
unload_localai_model
delete_localai_model
create_voice_profile
list_voice_profiles
add_voice_profile_sample
delete_voice_profile
generate_voice_audio
localai_generation_status
cancel_voice_generation
play_voice_generation
export_voice_generation
```

Rust owns:

- sidecar launch and shutdown
- app-data/model-dir creation
- random sidecar token
- loopback URL
- all raw filesystem paths
- profile sample import/copy
- output playback/export/reveal
- event translation from sidecar progress to renderer events

Renderer owns:

- settings/setup UI
- consent UI
- model picker
- voice profile UX
- generation queue UX
- playback/export controls through Rust commands

## UI And Product Flow

Minimum user flow:

1. User opens Settings or Voice Narration.
2. App shows Qwen3-TTS runtime status for the current platform.
3. User chooses `qwen-tts-0.6B` or `qwen-tts-1.7B`.
4. App shows model size and downloads only after confirmation.
5. User creates a voice profile.
6. User imports or records a short voice sample and provides reference text.
7. User generates narration from a selected source.
8. App shows queue/progress and then playback/export.

Recommended model copy:

- `qwen-tts-0.6B`: faster, smaller, better for CPU-only machines.
- `qwen-tts-1.7B`: higher quality, larger, better with MLX/CUDA-class acceleration.

## Implementation Phases

### Phase 1: Capability Contract

Files:

- `client/apps/tauri/src/domain`
- `client/apps/tauri/src/services`
- `client/apps/tauri/src/features/settings`
- `client/apps/tauri/src/i18n/locales/en_us.ts`

Steps:

1. Add domain types for Qwen-only model, runtime, profile, sample, generation, and progress.
2. Add i18n strings for consent, Qwen model sizes, platform status, and generation states.
3. Add a settings panel that renders mocked runtime/model status.
4. Add renderer service methods that call Rust commands, not sidecar URLs.

Acceptance criteria:

- UI can render Qwen runtime/model states for every platform.
- Consent copy is visible before sample import/recording.
- No local HTTP URL leaks into renderer state.

### Phase 2: Rust Sidecar Manager

Files:

- `client/apps/tauri/src-tauri/src/lib.rs`
- new `client/apps/tauri/src-tauri/src/localai.rs`
- `client/apps/tauri/src-tauri/tauri.conf.json`
- sidecar build/setup scripts

Steps:

1. Register `openbrief-localai` as a Tauri external binary.
2. Add dev placeholder generation for current target triple.
3. Implement launch with `--data-dir`, `--port`, `--parent-pid`.
4. Set `OPENBRIEF_LOCALAI_MODELS_DIR` and sidecar token.
5. Add `/health` and `/runtime` probing.
6. Add Rust command wrappers for model status/download/cancel.

Acceptance criteria:

- Sidecar starts on the local development platform.
- Rust can report runtime status without renderer path exposure.
- Missing sidecar produces a display-safe setup error.

### Phase 3: Minimal Qwen Sidecar

Files:

- new `client/apps/tauri/src-tauri/sidecars/localai-python`
- sidecar `pyproject.toml` / `requirements*.txt`
- sidecar FastAPI app and Qwen backend modules

Steps:

1. Port the minimum Voicebox backend pieces:
   - config/data dir
   - platform detection
   - Qwen model registry
   - HF cache/progress utilities
   - MLX Qwen backend
   - PyTorch Qwen backend
   - chunked generation
   - profile sample/prompt handling
2. Exclude non-Qwen code.
3. Implement `/health`, `/runtime`, `/models/status`, `/models/download`, `/models/download/cancel`.
4. Implement `/profiles` and `/generate`.

Acceptance criteria:

- `/models/status` returns exactly Qwen 0.6B and 1.7B for the active backend.
- Download progress is visible and cancellable.
- One short WAV can be generated from a test profile on the development platform.

### Phase 4: All-Platform Packaging

Steps:

1. Build and smoke-test macOS arm64 sidecar.
2. Build and smoke-test macOS x86_64 sidecar.
3. Build and smoke-test Windows x86_64 sidecar.
4. Build and smoke-test Linux x86_64 sidecar.
5. Add Linux arm64 only if OpenBrief's release pipeline ships that target.
6. Add release checks that fail when a target lacks its matching sidecar binary.

Smoke test per target:

```text
openbrief-localai --version
openbrief-localai --data-dir <tmp> --port <tmp-port> --parent-pid <pid>
GET /health
GET /runtime
GET /models/status
```

Full generation smoke should run where CI hardware can support it. At minimum, run full generation on macOS arm64 and one PyTorch CPU target.

Acceptance criteria:

- Release artifacts include the correct sidecar for every supported target.
- App install never includes model weights.
- App launch can report Qwen capability on every supported target.

### Phase 5: App Workflow

Steps:

1. Wire model status/download UI to Rust.
2. Add voice profile create/list/delete.
3. Add sample import first; add in-app recording after import is stable.
4. Add generation from summaries/transcript selections/chat responses.
5. Add playback/export/reveal through Rust commands.
6. Persist generation metadata.

Acceptance criteria:

- User can download a Qwen model, create a profile, add a sample, and generate audio.
- Generated audio survives app restart.
- Failed generations preserve actionable errors without leaking absolute paths.

### Phase 6: Optional Acceleration Variants

Steps:

1. Add optional Windows CUDA backend only after CPU sidecar is stable.
2. Use Voicebox's onedir downloaded-backend pattern:
   - server core archive
   - CUDA libs archive
   - checksum verification
   - extracted under `app-data/localai/backends/cuda`
   - version check before use
3. Evaluate Linux CUDA/ROCm variants separately.
4. Add runtime diagnostics for unsupported GPU/PyTorch architecture combinations.

Acceptance criteria:

- CPU path remains the fallback on every platform.
- Optional GPU backend can be installed, verified, selected, and reverted.
- Broken or stale GPU backend never prevents CPU generation.

## Security And Abuse Controls

- Consent gate before cloned profile creation.
- Local-only inference by default.
- No remote model APIs in this feature.
- Token-protect sidecar requests.
- Bind to loopback only.
- Restrict CORS/origin to Tauri webview origins if using HTTP.
- Redact raw paths from sidecar errors.
- Keep voice samples private unless the user exports them.
- Add provenance metadata to generated WAV sidecar JSON.
- Provide delete controls for profiles, samples, generations, and downloaded models.

## Test Plan

Frontend:

- Domain tests for Qwen model/runtime/profile/generation types.
- Settings/setup tests for platform availability copy.
- Consent tests for profile/sample creation.
- Generation service tests for success, cancellation, and error mapping.

Rust:

- Platform capability tests for macOS arm64, macOS x86_64, Windows, Linux.
- Path canonicalization tests for profile samples and generation outputs.
- Sidecar launch argument/env tests.
- Event-shape tests for model and generation progress.

Sidecar:

- Unit tests for backend-aware Qwen model registry.
- Unit tests for language compatibility.
- Unit tests for HF cache status detection, including `.incomplete` blobs.
- Mocked HuggingFace progress tests.
- Chunk splitting/crossfade tests.
- Prompt creation tests with temporary sample files.

Packaging:

- Per-target `--version` smoke.
- Per-target `/health`, `/runtime`, `/models/status` smoke.
- Release check that expected target-triple sidecar exists.
- macOS arm64 generation smoke with `qwen-tts-0.6B`.
- One PyTorch CPU generation smoke with `qwen-tts-0.6B` where CI time permits.

Manual:

- macOS Apple Silicon MLX download/generate.
- macOS Intel or PyTorch fallback download/status.
- Windows CPU download/status, generation if hardware permits.
- Linux CPU download/status, generation if hardware permits.
- Cancel model download.
- Delete model and verify status resets.
- App restart preserves profiles and generated audio.

## Risks

| Risk | Mitigation |
| --- | --- |
| Qwen models are large | Do not bundle weights. Make downloads explicit. Recommend 0.6B on CPU-only machines. |
| Python sidecar increases release size | Port only Qwen paths; exclude Voicebox's other engines and app features. |
| MLX and PyTorch dependencies conflict in one macOS arm64 binary | Prefer MLX-only arm64 first, add PyTorch fallback only after frozen-binary smoke tests. |
| Windows/Linux GPU packaging is fragile | Ship CPU baseline first; add optional GPU backends using downloaded sidecar variants. |
| HuggingFace partial downloads produce false-ready state | Treat `.incomplete` blobs as not downloaded and require actual weight files. |
| Renderer gains filesystem authority | Keep paths Rust-owned and expose only ids/labels. |
| Voice cloning has privacy/legal risk | Consent gate, private app storage, delete/export controls, provenance metadata. |
| Local HTTP sidecar expands attack surface | Loopback only, random token, origin restriction, or stdio fallback. |

## Open Questions

1. Should OpenBrief ship Linux arm64 binaries today, or only document Linux arm64 as source-build until release infrastructure exists?
2. Should macOS arm64 sidecar include PyTorch fallback, or should MLX failure make Qwen unavailable on that target?
3. Should Windows DirectML be included in the base sidecar, or treated as an optional variant like CUDA?
4. Should generation be allowed to trigger model download after confirmation, or should download be a separate setup-only action?
5. What is the maximum acceptable sidecar size per platform?

## Recommended Next Step

Build a Qwen-only sidecar spike before product UI:

1. Create `client/apps/tauri/src-tauri/sidecars/localai-python`.
2. Port only:
   - Qwen model registry
   - platform detection
   - HF cache/status/download progress
   - MLX Qwen backend
   - PyTorch Qwen backend
   - chunked generation
3. Add Rust `localai_runtime_status` and `list_localai_models`.
4. Register a dev placeholder sidecar and start a manually run Python server in development.
5. Prove one local generation with `qwen-tts-0.6B` from an app-owned profile sample.

Stop condition for the spike: OpenBrief can start the Qwen sidecar, report active backend/model status, download or detect `qwen-tts-0.6B`, generate an app-owned WAV from a cloned profile, and return only app-safe ids/labels to the renderer.
