//! MarkDesk desktop shell: opens products by starting a `markspec desk
//! --serve` sidecar, and keeps the list of recently opened products.

pub mod handshake;
pub mod recents;
pub mod sidecar;

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_store::StoreExt;

use handshake::Handshake;
use recents::Recent;
use sidecar::{OpenError, SidecarSlot};

/// Store file holding the recents list, in the app-data directory.
const RECENTS_STORE: &str = "recents.json";
/// Key of the recents list inside [`RECENTS_STORE`].
const RECENTS_KEY: &str = "recents";
/// Key that receives a recents value that could not be read.
const RECENTS_CORRUPT_KEY: &str = "recents.corrupt";

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

/// Start the MarkDesk application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarSlot::default())
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
}
