use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

const RUNNER_SCRIPT: &str = include_str!("../sidecars/supertonic-python/openbrief_supertonic.py");
const SUPERTONIC_PACKAGE: &str = "supertonic>=1.3.1";
const SUPERTONIC_EXTERNAL_BIN_PATH: &str = "openbrief-supertonic";
const MODEL_REPO_ID: &str = "Supertone/supertonic-3";
const DEFAULT_VOICE_STYLE_ID: &str = "M1";
const DEFAULT_LANGUAGE: &str = "en";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupertonicChatTtsRequest {
    asset_library_path: String,
    chat_message_id: String,
    text: String,
    chat_session_id: Option<String>,
    voice_style_id: Option<String>,
    language: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SupertonicChatTtsResult {
    audio_path: String,
    generation_id: String,
    model_id: &'static str,
    voice_style_id: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupertonicChatTtsLookupRequest {
    asset_library_path: String,
    chat_message_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SupertonicChatTtsArtifact {
    audio_path: String,
    generation_id: String,
    size_bytes: u64,
}

#[tauri::command]
pub async fn generate_supertonic_chat_tts(
    app: AppHandle,
    request: SupertonicChatTtsRequest,
) -> Result<SupertonicChatTtsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        generate_supertonic_chat_tts_blocking(app, request)
    })
    .await
    .map_err(|error| format!("supertonic_task_join_failed:{error}"))?
}

#[tauri::command]
pub fn latest_supertonic_chat_tts(
    app: AppHandle,
    request: SupertonicChatTtsLookupRequest,
) -> Result<Option<SupertonicChatTtsArtifact>, String> {
    let library_root = app_library_root(&app)?;
    latest_supertonic_chat_tts_from_root(
        &library_root,
        &request.asset_library_path,
        &request.chat_message_id,
    )
}

fn generate_supertonic_chat_tts_blocking(
    app: AppHandle,
    request: SupertonicChatTtsRequest,
) -> Result<SupertonicChatTtsResult, String> {
    let _chat_session_id = request.chat_session_id.as_deref();
    let text = request.text.trim();
    if text.is_empty() {
        return Err("supertonic_text_empty".to_string());
    }

    let library_root = app_library_root(&app)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app_data_dir_unavailable:{error}"))?;
    let supertonic_root = app_data.join("supertonic");
    let models_root = app_data.join("models").join("supertonic");

    let generation_id = create_generation_id(&request.chat_message_id, text);
    let output_relative_path = chat_tts_audio_relative_path(
        &request.asset_library_path,
        &request.chat_message_id,
        &generation_id,
    )?;
    let output_path = validated_library_output_path(&library_root, &output_relative_path)?;
    let output_parent = output_path
        .parent()
        .ok_or_else(|| "supertonic_output_parent_missing".to_string())?;
    fs::create_dir_all(output_parent)
        .map_err(|error| format!("supertonic_output_dir_create_failed:{error}"))?;

    let voice_style_id = sanitize_voice_style_id(
        request
            .voice_style_id
            .as_deref()
            .unwrap_or(DEFAULT_VOICE_STYLE_ID),
    )?;
    let language = sanitize_language(request.language.as_deref().unwrap_or(DEFAULT_LANGUAGE))?;

    fs::create_dir_all(models_root.join("hf"))
        .map_err(|error| format!("supertonic_model_dir_create_failed:{error}"))?;

    let args = supertonic_read_args(text, &output_path, &voice_style_id, &language, &models_root);
    let output = match run_supertonic_sidecar(&app, args.clone(), &models_root) {
        Ok(output) if output.success => output,
        Ok(output) if cfg!(debug_assertions) && is_dev_placeholder_output(&output) => {
            run_supertonic_python_fallback(&supertonic_root, args, &models_root)?
        }
        Ok(output) => output,
        Err(error) if cfg!(debug_assertions) => {
            log::warn!(
                target: "openbrief::supertonic",
                "Supertonic sidecar unavailable in debug build; falling back to app-data Python venv: {}",
                error,
            );
            run_supertonic_python_fallback(&supertonic_root, args, &models_root)?
        }
        Err(error) => return Err(error),
    };

    if !output.success {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "supertonic_generate_failed:{}",
            stderr.trim().lines().last().unwrap_or("unknown")
        ));
    }

    let metadata =
        fs::metadata(&output_path).map_err(|error| format!("supertonic_output_missing:{error}"))?;
    if !metadata.is_file() {
        return Err("supertonic_output_not_file".to_string());
    }

    Ok(SupertonicChatTtsResult {
        audio_path: output_relative_path,
        generation_id,
        model_id: MODEL_REPO_ID,
        voice_style_id,
        size_bytes: metadata.len(),
    })
}

struct SupertonicProcessOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn supertonic_read_args(
    text: &str,
    output_path: &Path,
    voice_style_id: &str,
    language: &str,
    models_root: &Path,
) -> Vec<String> {
    vec![
        "read".to_string(),
        "--model".to_string(),
        MODEL_REPO_ID.to_string(),
        "--text".to_string(),
        text.to_string(),
        "--output".to_string(),
        output_path.to_string_lossy().to_string(),
        "--voice-style".to_string(),
        voice_style_id.to_string(),
        "--language".to_string(),
        language.to_string(),
        "--total-steps".to_string(),
        "8".to_string(),
        "--speed".to_string(),
        "1.05".to_string(),
        "--cache-dir".to_string(),
        models_root.join("cache").to_string_lossy().to_string(),
    ]
}

fn run_supertonic_sidecar(
    app: &AppHandle,
    args: Vec<String>,
    models_root: &Path,
) -> Result<SupertonicProcessOutput, String> {
    tauri::async_runtime::block_on(async {
        let output = app
            .shell()
            .sidecar(SUPERTONIC_EXTERNAL_BIN_PATH)
            .map_err(|error| format!("supertonic_sidecar_unavailable:{error}"))?
            .args(args)
            .env("HF_HOME", models_root.join("hf"))
            .env("HF_HUB_CACHE", models_root.join("hf").join("hub"))
            .env("SUPERTONIC_MODEL_REPO_ID", MODEL_REPO_ID)
            .output()
            .await
            .map_err(|error| format!("supertonic_sidecar_start_failed:{error}"))?;
        Ok(SupertonicProcessOutput {
            success: output.status.success(),
            stdout: output.stdout,
            stderr: output.stderr,
        })
    })
}

fn run_supertonic_python_fallback(
    supertonic_root: &Path,
    args: Vec<String>,
    models_root: &Path,
) -> Result<SupertonicProcessOutput, String> {
    let runtime = ensure_python_runtime(supertonic_root)?;
    let runner_script = write_runner_script(supertonic_root)?;
    ensure_supertonic_package(&runtime)?;

    let mut command = Command::new(&runtime.python);
    command
        .arg(&runner_script)
        .args(args)
        .env("HF_HOME", models_root.join("hf"))
        .env("HF_HUB_CACHE", models_root.join("hf").join("hub"))
        .env("SUPERTONIC_MODEL_REPO_ID", MODEL_REPO_ID);

    let output = command
        .output()
        .map_err(|error| format!("supertonic_generate_start_failed:{error}"))?;
    Ok(SupertonicProcessOutput {
        success: output.status.success(),
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

fn is_dev_placeholder_output(output: &SupertonicProcessOutput) -> bool {
    String::from_utf8_lossy(&output.stdout).contains("OpenBrief dev")
        || String::from_utf8_lossy(&output.stderr).contains("OpenBrief dev")
}

struct PythonRuntime {
    python: PathBuf,
}

struct PythonBootstrap {
    program: &'static str,
    args: &'static [&'static str],
}

fn ensure_python_runtime(supertonic_root: &Path) -> Result<PythonRuntime, String> {
    let venv_dir = supertonic_root.join("python");
    let python = venv_python(&venv_dir);
    if python.is_file() {
        return Ok(PythonRuntime { python });
    }

    fs::create_dir_all(supertonic_root)
        .map_err(|error| format!("supertonic_runtime_dir_create_failed:{error}"))?;
    let bootstrap = find_system_python()?;
    let output = Command::new(bootstrap.program)
        .args(bootstrap.args)
        .arg("-m")
        .arg("venv")
        .arg(&venv_dir)
        .output()
        .map_err(|error| format!("supertonic_venv_create_start_failed:{error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "supertonic_venv_create_failed:{}",
            stderr.trim().lines().last().unwrap_or("unknown")
        ));
    }

    Ok(PythonRuntime { python })
}

fn ensure_supertonic_package(runtime: &PythonRuntime) -> Result<(), String> {
    if Command::new(&runtime.python)
        .arg("-c")
        .arg("import supertonic")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
    {
        return Ok(());
    }

    let pip_install = Command::new(&runtime.python)
        .arg("-m")
        .arg("pip")
        .arg("install")
        .arg("--upgrade")
        .arg("pip")
        .arg(SUPERTONIC_PACKAGE)
        .output()
        .map_err(|error| format!("supertonic_pip_install_start_failed:{error}"))?;

    if !pip_install.status.success() {
        let stderr = String::from_utf8_lossy(&pip_install.stderr);
        return Err(format!(
            "supertonic_pip_install_failed:{}",
            stderr.trim().lines().last().unwrap_or("unknown")
        ));
    }

    if !Command::new(&runtime.python)
        .arg("-c")
        .arg("import supertonic")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
    {
        return Err("supertonic_import_failed_after_install".to_string());
    }

    Ok(())
}

fn write_runner_script(supertonic_root: &Path) -> Result<PathBuf, String> {
    let runner_dir = supertonic_root.join("runner");
    fs::create_dir_all(&runner_dir)
        .map_err(|error| format!("supertonic_runner_dir_create_failed:{error}"))?;
    let runner_script = runner_dir.join("openbrief_supertonic.py");
    fs::write(&runner_script, RUNNER_SCRIPT)
        .map_err(|error| format!("supertonic_runner_write_failed:{error}"))?;
    Ok(runner_script)
}

fn find_system_python() -> Result<PythonBootstrap, String> {
    let candidates: &[PythonBootstrap] = if cfg!(windows) {
        &[
            PythonBootstrap {
                program: "py",
                args: &["-3"],
            },
            PythonBootstrap {
                program: "python",
                args: &[],
            },
            PythonBootstrap {
                program: "python3",
                args: &[],
            },
        ]
    } else {
        &[
            PythonBootstrap {
                program: "python3",
                args: &[],
            },
            PythonBootstrap {
                program: "python",
                args: &[],
            },
        ]
    };

    for candidate in candidates {
        if Command::new(candidate.program)
            .args(candidate.args)
            .arg("--version")
            .status()
            .is_ok_and(|status| status.success())
        {
            return Ok(PythonBootstrap {
                program: candidate.program,
                args: candidate.args,
            });
        }
    }

    Err("supertonic_python_unavailable".to_string())
}

fn venv_python(venv_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

fn app_library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app_data_dir_unavailable:{error}"))?
        .join("library");
    fs::create_dir_all(&root).map_err(|error| format!("library_root_create_failed:{error}"))?;
    root.canonicalize()
        .map_err(|error| format!("library_root_invalid:{error}"))
}

fn chat_tts_audio_relative_path(
    asset_library_path: &str,
    chat_message_id: &str,
    generation_id: &str,
) -> Result<String, String> {
    let asset_dir = asset_directory_from_library_path(asset_library_path)?;
    Ok(format!(
        "{asset_dir}/chat/tts/{}/{generation_id}/audio.wav",
        sanitize_path_segment(chat_message_id)
    ))
}

fn chat_tts_message_relative_path(
    asset_library_path: &str,
    chat_message_id: &str,
) -> Result<String, String> {
    let asset_dir = asset_directory_from_library_path(asset_library_path)?;
    Ok(format!(
        "{asset_dir}/chat/tts/{}",
        sanitize_path_segment(chat_message_id)
    ))
}

fn latest_supertonic_chat_tts_from_root(
    library_root: &Path,
    asset_library_path: &str,
    chat_message_id: &str,
) -> Result<Option<SupertonicChatTtsArtifact>, String> {
    let message_relative_path =
        chat_tts_message_relative_path(asset_library_path, chat_message_id)?;
    let message_dir = validated_library_output_path(library_root, &message_relative_path)?;
    reject_existing_relative_symlinks(library_root, Path::new(&message_relative_path))?;

    if !message_dir.exists() {
        return Ok(None);
    }
    if path_is_symlink(&message_dir)? {
        return Err("supertonic_chat_tts_dir_must_not_be_symlink".to_string());
    }

    let metadata = fs::metadata(&message_dir)
        .map_err(|error| format!("supertonic_chat_tts_dir_metadata_failed:{error}"))?;
    if !metadata.is_dir() {
        return Err("supertonic_chat_tts_dir_must_be_directory".to_string());
    }

    let mut latest: Option<(SystemTime, SupertonicChatTtsArtifact)> = None;
    for entry in fs::read_dir(&message_dir)
        .map_err(|error| format!("supertonic_chat_tts_dir_read_failed:{error}"))?
    {
        let entry =
            entry.map_err(|error| format!("supertonic_chat_tts_entry_read_failed:{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("supertonic_chat_tts_entry_type_failed:{error}"))?;
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }

        let generation_id = entry.file_name().to_string_lossy().to_string();
        let audio_path = entry.path().join("audio.wav");
        if path_is_symlink(&audio_path)? {
            continue;
        }
        let Ok(audio_metadata) = fs::metadata(&audio_path) else {
            continue;
        };
        if !audio_metadata.is_file() {
            continue;
        }

        let modified = audio_metadata.modified().unwrap_or(UNIX_EPOCH);
        let artifact = SupertonicChatTtsArtifact {
            audio_path: chat_tts_audio_relative_path(
                asset_library_path,
                chat_message_id,
                &generation_id,
            )?,
            generation_id,
            size_bytes: audio_metadata.len(),
        };

        match &latest {
            Some((latest_modified, _)) if modified <= *latest_modified => {}
            _ => latest = Some((modified, artifact)),
        }
    }

    Ok(latest.map(|(_, artifact)| artifact))
}

fn asset_directory_from_library_path(relative_path: &str) -> Result<String, String> {
    let path = PathBuf::from(relative_path);
    if path.is_absolute() || has_parent_dir_or_absolute_component(&path) {
        return Err("supertonic_asset_path_must_be_library_relative".to_string());
    }

    let mut components = path.components();
    let directory = normal_component(&mut components)
        .ok_or_else(|| "supertonic_asset_path_missing_directory".to_string())?;
    let asset_id = normal_component(&mut components)
        .ok_or_else(|| "supertonic_asset_path_missing_asset_id".to_string())?;

    match directory.as_str() {
        "videos" | "audios" | "pdfs" => Ok(format!("{directory}/{asset_id}")),
        _ => Err("supertonic_asset_path_unsupported_directory".to_string()),
    }
}

fn normal_component(components: &mut std::path::Components<'_>) -> Option<String> {
    match components.next()? {
        Component::Normal(value) => value.to_str().map(ToString::to_string),
        _ => None,
    }
}

fn validated_library_output_path(
    library_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative = PathBuf::from(relative_path);
    if relative.is_absolute() || has_parent_dir_or_absolute_component(&relative) {
        return Err("supertonic_output_path_must_be_library_relative".to_string());
    }
    let parent_relative = relative
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new(""));
    reject_existing_relative_symlinks(library_root, parent_relative)?;
    Ok(library_root.join(relative))
}

fn reject_existing_relative_symlinks(root: &Path, relative: &Path) -> Result<(), String> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => {
                current.push(segment);
                if path_is_symlink(&current)? {
                    return Err("supertonic_output_path_must_not_contain_symlink".to_string());
                }
            }
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err("supertonic_output_path_must_be_library_relative".to_string());
            }
        }
    }
    Ok(())
}

fn path_is_symlink(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_symlink()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("supertonic_path_metadata_failed:{error}")),
    }
}

fn has_parent_dir_or_absolute_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::ParentDir | Component::Prefix(_) | Component::RootDir => true,
        Component::CurDir | Component::Normal(_) => false,
    })
}

fn sanitize_path_segment(value: &str) -> String {
    let mut sanitized = String::new();
    let mut last_was_dash = false;
    for character in value.chars() {
        let next = if character.is_ascii_alphanumeric() {
            character.to_ascii_lowercase()
        } else {
            '-'
        };
        if next == '-' {
            if !last_was_dash && !sanitized.is_empty() {
                sanitized.push(next);
            }
            last_was_dash = true;
        } else {
            sanitized.push(next);
            last_was_dash = false;
        }
    }
    let sanitized = sanitized.trim_matches('-');
    if sanitized.is_empty() {
        "item".to_string()
    } else {
        sanitized.chars().take(96).collect()
    }
}

fn sanitize_voice_style_id(value: &str) -> Result<String, String> {
    let sanitized = sanitize_path_segment(value).to_ascii_uppercase();
    match sanitized.as_str() {
        "M1" | "M2" | "M3" | "M4" | "M5" | "F1" | "F2" | "F3" | "F4" | "F5" => Ok(sanitized),
        _ => Err("supertonic_voice_style_unsupported".to_string()),
    }
}

fn sanitize_language(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    if value == "na" || (value.len() == 2 && value.chars().all(|c| c.is_ascii_lowercase())) {
        Ok(value)
    } else {
        Err("supertonic_language_unsupported".to_string())
    }
}

fn create_generation_id(chat_message_id: &str, text: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let mut hasher = Sha1::new();
    hasher.update(chat_message_id.as_bytes());
    hasher.update(text.as_bytes());
    hasher.update(nanos.to_string().as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("tts-{nanos}-{}", &digest[..12])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_chat_tts_path_inside_source_asset_directory() {
        let path = chat_tts_audio_relative_path(
            "audios/audio-1/source.mp3",
            "chat-audio-1-assistant-2026-05-23T00:00:00.000Z",
            "tts-123",
        )
        .unwrap();

        assert_eq!(
            path,
            "audios/audio-1/chat/tts/chat-audio-1-assistant-2026-05-23t00-00-00-000z/tts-123/audio.wav"
        );
    }

    #[test]
    fn builds_sidecar_read_args_with_model_cache_dir() {
        let args = supertonic_read_args(
            "Welcome to OpenBrief",
            Path::new("/tmp/openbrief/audio.wav"),
            "M1",
            "en",
            Path::new("/tmp/openbrief/models/supertonic"),
        );

        assert_eq!(args[0], "read");
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--model" && pair[1] == MODEL_REPO_ID));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--text" && pair[1] == "Welcome to OpenBrief"));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--cache-dir"
                && pair[1] == "/tmp/openbrief/models/supertonic/cache"));
    }

    #[test]
    fn finds_latest_chat_tts_audio_inside_message_directory() {
        let library_root = std::env::temp_dir().join(format!(
            "openbrief-supertonic-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let first_audio = library_root.join("videos/video-1/chat/tts/chat-1/tts-1/audio.wav");
        let second_audio = library_root.join("videos/video-1/chat/tts/chat-1/tts-2/audio.wav");
        fs::create_dir_all(first_audio.parent().unwrap()).unwrap();
        fs::write(&first_audio, b"first").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        fs::create_dir_all(second_audio.parent().unwrap()).unwrap();
        fs::write(&second_audio, b"second").unwrap();

        let artifact = latest_supertonic_chat_tts_from_root(
            &library_root,
            "videos/video-1/source.mp4",
            "chat-1",
        )
        .unwrap()
        .unwrap();

        assert_eq!(
            artifact.audio_path,
            "videos/video-1/chat/tts/chat-1/tts-2/audio.wav"
        );
        assert_eq!(artifact.generation_id, "tts-2");
        assert_eq!(artifact.size_bytes, 6);

        fs::remove_dir_all(library_root).unwrap();
    }

    #[test]
    fn rejects_non_asset_library_directories() {
        assert_eq!(
            asset_directory_from_library_path("summaries/video-1.md").unwrap_err(),
            "supertonic_asset_path_unsupported_directory"
        );
    }

    #[test]
    fn rejects_traversal_asset_paths() {
        assert_eq!(
            asset_directory_from_library_path("../videos/video-1/source.mp4").unwrap_err(),
            "supertonic_asset_path_must_be_library_relative"
        );
    }
}
