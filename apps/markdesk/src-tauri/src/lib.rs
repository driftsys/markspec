//! MarkDesk desktop shell: opens products by starting a `markspec desk
//! --serve` sidecar, and keeps the list of recently opened products.

pub mod handshake;
pub mod recents;
pub mod sidecar;

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_store::StoreExt;

use handshake::Handshake;
use recents::Recent;
use sidecar::{OpenError, Sidecar};

/// Store file holding the recents list, in the app-data directory.
const RECENTS_STORE: &str = "recents.json";
/// Key of the recents list inside [`RECENTS_STORE`].
const RECENTS_KEY: &str = "recents";

/// What `open_product` returns to the web UI: the sidecar handshake.
pub type OpenedProduct = Handshake;

/// A recents entry as shown to the web UI, with `exists` computed when the
/// list is read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProduct {
    /// Absolute product root.
    pub root: String,
    /// Display name chosen by the author, if any.
    pub name: Option<String>,
    /// Whether the root is still a directory on disk.
    pub exists: bool,
}

/// The single live sidecar, if a product is open.
#[derive(Default)]
struct OpenProduct(Mutex<Option<Sidecar>>);

impl OpenProduct {
    /// Kill the live sidecar, if any.
    fn stop(&self) {
        let previous = self.0.lock().map(|mut slot| slot.take()).unwrap_or(None);
        if let Some(sidecar) = previous {
            sidecar.stop();
        }
    }
}

fn load_recents(app: &AppHandle) -> Result<Vec<Recent>, String> {
    let store = app.store(RECENTS_STORE).map_err(|err| err.to_string())?;
    Ok(store
        .get(RECENTS_KEY)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default())
}

fn save_recents(app: &AppHandle, list: &[Recent]) -> Result<(), String> {
    let store = app.store(RECENTS_STORE).map_err(|err| err.to_string())?;
    let value = serde_json::to_value(list).map_err(|err| err.to_string())?;
    store.set(RECENTS_KEY, value);
    store.save().map_err(|err| err.to_string())
}

/// Start a sidecar for the product containing `path`. On success the
/// previous sidecar is stopped and the product root moves to the front of
/// the recents list. On failure the previous sidecar keeps running.
#[tauri::command]
async fn open_product(
    app: AppHandle,
    state: State<'_, OpenProduct>,
    path: String,
) -> Result<OpenedProduct, OpenError> {
    let started = tauri::async_runtime::spawn_blocking(move || {
        let command = sidecar::markspec_command(&path)?;
        sidecar::start(command, sidecar::HANDSHAKE_TIMEOUT)
    })
    .await
    .map_err(|err| OpenError {
        kind: sidecar::OpenErrorKind::SpawnFailed,
        details: err.to_string(),
    })?;
    let (new_sidecar, handshake) = started?;

    let previous = state
        .0
        .lock()
        .map(|mut slot| slot.replace(new_sidecar))
        .unwrap_or(None);
    if let Some(sidecar) = previous {
        sidecar.stop();
    }

    let recorded = load_recents(&app)
        .and_then(|list| save_recents(&app, &recents::touch(list, &handshake.root)));
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

/// Set the display name of a recent product; a blank name clears it.
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

/// Start the MarkDesk application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenProduct::default())
        .invoke_handler(tauri::generate_handler![
            open_product,
            list_recents,
            set_product_name,
            remove_recent
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
            } => app.state::<OpenProduct>().stop(),
            _ => {}
        });
}
