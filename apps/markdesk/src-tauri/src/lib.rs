//! MarkDesk desktop shell: opens products by starting a `markspec desk
//! --serve` sidecar, and keeps the list of recently opened products.

pub mod assistant_settings;
pub mod assistants;
pub mod handshake;
pub mod recents;
pub mod sidecar;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_store::StoreExt;

use assistant_settings::AssistantSettings;
use assistants::{AssistantId, AssistantStatus, Probe, TestOutcome, TestResult};
use handshake::Handshake;
use recents::Recent;
use sidecar::{OpenError, SidecarSlot};

/// Store file holding the recents list, in the app-data directory.
const RECENTS_STORE: &str = "recents.json";
/// Key of the recents list inside [`RECENTS_STORE`].
const RECENTS_KEY: &str = "recents";
/// Key that receives a recents value that could not be read.
const RECENTS_CORRUPT_KEY: &str = "recents.corrupt";

/// Store file holding the assistant settings, in the app-data directory.
const SETTINGS_STORE: &str = "settings.json";
/// Key of the assistant settings inside [`SETTINGS_STORE`].
const ASSISTANT_KEY: &str = "assistant";
/// Key that receives assistant settings that could not be read.
const ASSISTANT_CORRUPT_KEY: &str = "assistant.corrupt";

/// Test error when `test_assistant` is called while a Test runs.
const TEST_ALREADY_RUNNING: &str = "A Test is already running.";

/// The state shared by the Test commands.
///
/// One Test runs at a time: `running` is set while a Test runs, and every
/// Test shares the one `cancel` flag, which `test_assistant` clears when a
/// Test starts.
#[derive(Default)]
struct AssistantTestState {
    /// Set by `cancel_assistant_test`; the running Test polls it.
    cancel: Arc<AtomicBool>,
    /// Set while a Test runs.
    running: Arc<AtomicBool>,
}

/// Marks a Test as running until it is dropped.
struct TestGuard(Arc<AtomicBool>);

impl TestGuard {
    /// Start a Test: set `running` and clear `cancel`. Returns `None`, and
    /// changes neither flag, when a Test is already running.
    fn start(running: &Arc<AtomicBool>, cancel: &AtomicBool) -> Option<TestGuard> {
        running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()?;
        cancel.store(false, Ordering::SeqCst);
        Some(TestGuard(Arc::clone(running)))
    }
}

impl Drop for TestGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// What `open_product` returns to the web UI: the sidecar handshake.
pub type OpenedProduct = Handshake;

/// A recents entry as shown to the web UI, with `exists` computed when the
/// list is read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProduct {
    /// Absolute product root.
    pub root: String,
    /// Project name, or folder name when the project has none; absent until
    /// the product is opened once.
    pub name: Option<String>,
    /// Whether the root is still a directory on disk.
    pub exists: bool,
}

fn load_recents(app: &AppHandle) -> Result<Vec<Recent>, String> {
    let store = app.store(RECENTS_STORE).map_err(|err| err.to_string())?;
    let parsed = recents::parse_stored(store.get(RECENTS_KEY));
    if let Some(value) = parsed.corrupt {
        // Keep the unreadable value instead of overwriting it with a fresh
        // list. Write errors are ignored: the list still loads as empty.
        eprintln!("markdesk: recents could not be read; kept under {RECENTS_CORRUPT_KEY}");
        if store.get(RECENTS_CORRUPT_KEY).is_none() {
            store.set(RECENTS_CORRUPT_KEY, value);
        }
        store.delete(RECENTS_KEY);
        let _ = store.save();
    }
    Ok(parsed.list)
}

fn save_recents(app: &AppHandle, list: &[Recent]) -> Result<(), String> {
    let store = app.store(RECENTS_STORE).map_err(|err| err.to_string())?;
    let value = serde_json::to_value(list).map_err(|err| err.to_string())?;
    store.set(RECENTS_KEY, value);
    store.save().map_err(|err| err.to_string())
}

fn load_assistant_settings(app: &AppHandle) -> Result<AssistantSettings, String> {
    let store = app.store(SETTINGS_STORE).map_err(|err| err.to_string())?;
    let parsed = assistant_settings::parse_stored(store.get(ASSISTANT_KEY));
    let earlier = store.get(ASSISTANT_CORRUPT_KEY);
    if let Some(plan) = assistant_settings::corrupt_move(parsed.corrupt, earlier.as_ref()) {
        // Keep the unreadable value instead of overwriting it. Write errors
        // are ignored: the settings still load as the defaults.
        eprintln!(
            "markdesk: assistant settings could not be read; kept under {ASSISTANT_CORRUPT_KEY}"
        );
        if let Some(value) = plan.write_corrupt_key {
            store.set(ASSISTANT_CORRUPT_KEY, value);
        }
        store.delete(ASSISTANT_KEY);
        let _ = store.save();
    }
    Ok(parsed.settings)
}

fn save_assistant_settings(app: &AppHandle, settings: &AssistantSettings) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|err| err.to_string())?;
    let value = serde_json::to_value(settings).map_err(|err| err.to_string())?;
    store.set(ASSISTANT_KEY, value);
    store.save().map_err(|err| err.to_string())
}

/// The detection probe for the stored `settings`: a successful Test of
/// Copilot counts as a confirmed sign-in.
fn probe_from_settings(home: &Path, settings: &AssistantSettings) -> Probe {
    Probe::new(home, settings.copilot_confirmed)
}

/// The recents list after `opened` was opened: its root moves to the front.
/// The root is the one the sidecar discovered, which can be an ancestor of
/// the folder the author chose.
pub fn recents_after_open(list: Vec<Recent>, opened: &Handshake) -> Vec<Recent> {
    recents::touch(list, &opened.root)
}

/// Start a sidecar for the product containing `path`. On success the
/// previous sidecar is stopped and the product root moves to the front of
/// the recents list. On failure the previous sidecar keeps running.
#[tauri::command]
async fn open_product(app: AppHandle, path: String) -> Result<OpenedProduct, OpenError> {
    let worker_app = app.clone();
    let handshake = tauri::async_runtime::spawn_blocking(move || {
        let command = sidecar::markspec_command(&path)?;
        worker_app
            .state::<SidecarSlot>()
            .open(command, sidecar::HANDSHAKE_TIMEOUT)
    })
    .await
    .map_err(|err| OpenError {
        kind: sidecar::OpenErrorKind::SpawnFailed,
        details: err.to_string(),
    })??;

    let recorded = load_recents(&app)
        .and_then(|list| save_recents(&app, &recents_after_open(list, &handshake)));
    if let Err(err) = recorded {
        eprintln!("MarkDesk: could not record recent product: {err}");
    }
    Ok(handshake)
}

/// The recents list, most recent first.
#[tauri::command]
fn list_recents(app: AppHandle) -> Result<Vec<RecentProduct>, String> {
    Ok(load_recents(&app)?
        .into_iter()
        .map(|recent| RecentProduct {
            exists: Path::new(&recent.root).is_dir(),
            root: recent.root,
            name: recent.name,
        })
        .collect())
}

/// Store the name of a recent product: the project name, or the folder name
/// when the project has none. The web UI calls it on each open. A blank
/// name clears it.
#[tauri::command]
fn set_product_name(app: AppHandle, root: String, name: String) -> Result<(), String> {
    let list = load_recents(&app)?;
    save_recents(&app, &recents::set_name(list, &root, &name))
}

/// Remove a product from the recents list.
#[tauri::command]
fn remove_recent(app: AppHandle, root: String) -> Result<(), String> {
    let list = load_recents(&app)?;
    save_recents(&app, &recents::remove(list, &root))
}

/// Find each assistant and report its state. Never prompts and never signs in.
#[tauri::command]
async fn detect_assistants(app: AppHandle) -> Result<Vec<AssistantStatus>, String> {
    let settings = load_assistant_settings(&app)?;
    let home = app.path().home_dir().map_err(|err| err.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        assistants::detect_all(&probe_from_settings(&home, &settings))
    })
    .await
    .map_err(|err| err.to_string())
}

/// Run the short Test prompt on one assistant. The web UI passes only the
/// assistant id; the program and the prompt are fixed in the shell. A call
/// made while a Test runs fails at once and changes nothing.
#[tauri::command]
async fn test_assistant(app: AppHandle, id: AssistantId) -> Result<TestResult, String> {
    let state = app.state::<AssistantTestState>();
    let cancel = Arc::clone(&state.cancel);
    let Some(_guard) = TestGuard::start(&state.running, &cancel) else {
        return Ok(TestResult {
            outcome: TestOutcome::Failed,
            reply: None,
            error: Some(TEST_ALREADY_RUNNING.to_string()),
        });
    };
    let settings = load_assistant_settings(&app)?;
    let home = app.path().home_dir().map_err(|err| err.to_string())?;
    let probe = probe_from_settings(&home, &settings);
    let Some(program) =
        assistants::locate(id.binary(), probe.path_env.as_deref(), &probe.extra_dirs)
    else {
        return Ok(TestResult {
            outcome: TestOutcome::Failed,
            reply: None,
            error: Some(format!("{} is not installed", id.binary())),
        });
    };
    let path = probe.child_path();
    let run = tauri::async_runtime::spawn_blocking(move || {
        assistants::run_test(
            id,
            &program,
            path.as_deref(),
            assistants::TEST_TIMEOUT,
            &cancel,
        )
    })
    .await
    .map_err(|err| err.to_string())?;

    if id == AssistantId::Copilot {
        // Read the settings again so a change made while the Test ran is
        // not overwritten.
        let latest = load_assistant_settings(&app)?;
        if let Some(next) = assistant_settings::settings_after_test(&latest, id, &run) {
            save_assistant_settings(&app, &next)?;
        }
    }
    Ok(run.result)
}

/// Stop the running Test, if any.
#[tauri::command]
fn cancel_assistant_test(app: AppHandle) {
    app.state::<AssistantTestState>()
        .cancel
        .store(true, Ordering::SeqCst);
}

/// The stored assistant settings.
#[tauri::command]
fn get_assistant_settings(app: AppHandle) -> Result<AssistantSettings, String> {
    load_assistant_settings(&app)
}

/// Replace the stored assistant settings, except `copilot_confirmed`, which
/// only a Test changes.
#[tauri::command]
fn set_assistant_settings(app: AppHandle, settings: AssistantSettings) -> Result<(), String> {
    let stored = load_assistant_settings(&app)?;
    save_assistant_settings(&app, &assistant_settings::merge_from_ui(&stored, settings))
}

/// Start the MarkDesk application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarSlot::default())
        .manage(AssistantTestState::default())
        .invoke_handler(tauri::generate_handler![
            open_product,
            list_recents,
            set_product_name,
            remove_recent,
            detect_assistants,
            test_assistant,
            cancel_assistant_test,
            get_assistant_settings,
            set_assistant_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while building MarkDesk")
        .run(|app, event| match event {
            // Kill the sidecar explicitly; the closed stdin pipe is only the
            // fallback for when the shell dies without running this.
            RunEvent::Exit
            | RunEvent::WindowEvent {
                event: WindowEvent::Destroyed,
                ..
            } => app.state::<SidecarSlot>().stop(),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recents_after_open_records_the_discovered_root_not_the_chosen_folder() {
        // The author chose /p/brakes/docs; the sidecar discovered /p/brakes.
        let opened = Handshake {
            url: "http://127.0.0.1:1".into(),
            token: "t".into(),
            api_version: 3,
            root: "/p/brakes".into(),
        };
        let list = recents_after_open(
            vec![Recent {
                root: "/p/other".into(),
                name: None,
            }],
            &opened,
        );
        let roots: Vec<&str> = list.iter().map(|r| r.root.as_str()).collect();
        assert_eq!(roots, ["/p/brakes", "/p/other"]);
    }

    #[test]
    fn test_guard_start_clears_a_previous_cancel() {
        let running = Arc::new(AtomicBool::new(false));
        let cancel = AtomicBool::new(true);
        let guard = TestGuard::start(&running, &cancel);
        assert!(guard.is_some());
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(running.load(Ordering::SeqCst));
    }

    #[test]
    fn test_guard_refuses_a_second_test_without_touching_cancel() {
        let running = Arc::new(AtomicBool::new(false));
        let cancel = AtomicBool::new(false);
        let first = TestGuard::start(&running, &cancel).unwrap();
        // The author cancels the first Test; a second call must not clear it.
        cancel.store(true, Ordering::SeqCst);
        assert!(TestGuard::start(&running, &cancel).is_none());
        assert!(cancel.load(Ordering::SeqCst));
        drop(first);
        assert!(!running.load(Ordering::SeqCst));
        assert!(TestGuard::start(&running, &cancel).is_some());
    }

    #[cfg(unix)]
    #[test]
    fn probe_from_settings_detects_confirmed_copilot_as_ready() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "markdesk-lib-probe-{}-{}",
            std::process::id(),
            line!()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("copilot");
        std::fs::write(&bin, "#!/bin/sh\necho copilot 1.0\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let settings = AssistantSettings {
            copilot_confirmed: true,
            ..AssistantSettings::default()
        };
        let mut probe = probe_from_settings(Path::new("/nonexistent-home"), &settings);
        // Find only the fake, and ignore a token set in the environment.
        probe.path_env = None;
        probe.extra_dirs = vec![dir];
        probe.copilot_token = false;
        let status = assistants::detect(AssistantId::Copilot, &probe);
        assert_eq!(status.state, assistants::AssistantState::Ready);
    }
}
