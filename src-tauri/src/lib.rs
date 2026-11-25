// Desktop shell for Zen Multiverse.
// Auto-update: on launch we quietly check the update endpoint, download a newer signed build in the
// background, and only then tell the page it is ready. The page shows one calm prompt at a quiet
// moment ("restart now / later"). If she picks later, the update installs when the game is closed.
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
struct PendingUpdate(Mutex<Option<(Update, Vec<u8>)>>);

#[derive(Serialize)]
struct UpdateStatus {
    ready: bool,
    version: Option<String>,
    current: String,
}

#[tauri::command]
fn zen_update_status(app: AppHandle, pending: State<'_, PendingUpdate>) -> UpdateStatus {
    let guard = pending.0.lock().unwrap();
    UpdateStatus {
        ready: guard.is_some(),
        version: guard.as_ref().map(|(u, _)| u.version.clone()),
        current: app.package_info().version.to_string(),
    }
}

#[tauri::command]
fn zen_update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let taken = pending.0.lock().unwrap().take();
    let Some((update, bytes)) = taken else {
        return Err("no update ready".into());
    };
    // On Windows this hands off to the installer and exits; on macOS it swaps the app bundle.
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

async fn check_and_download(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let bytes = update.download(|_, _| {}, || {}).await?;
    if let Some(pending) = app.try_state::<PendingUpdate>() {
        *pending.0.lock().unwrap() = Some((update, bytes));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![zen_update_status, zen_update_install])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Give the garden a moment to load before touching the network.
                tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                if let Err(e) = check_and_download(handle).await {
                    eprintln!("update check skipped: {e}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        // "Later": apply a downloaded update quietly once the game is closed.
        if let RunEvent::Exit = event {
            if let Some(pending) = handle.try_state::<PendingUpdate>() {
                if let Some((update, bytes)) = pending.0.lock().unwrap().take() {
                    let _ = update.install(bytes);
                }
            }
        }
    });
}
