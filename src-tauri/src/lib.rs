// Desktop shell for Zen Multiverse.
// Auto-update: on launch we quietly check the update endpoint, download a newer signed build in the
// background, and only then tell the page it is ready. The page shows one calm prompt at a quiet
// moment ("restart now / later"). If she picks later, the update installs when the game is closed.
//
// Save safety: the web save ('garden-save' in localStorage) is mirrored to the app data folder so
// it survives webview cache clears: save.json (latest) + save.bak.json (the previous good one).
// The web side validates the JSON before sending; writes go to a temp file renamed into place.
// On window close the page gets one chance (<= 2.5 s) to flush its save before the app exits.
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_updater::{Update, UpdaterExt};

static CLOSING: AtomicBool = AtomicBool::new(false);

fn save_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn save_write(app: AppHandle, data: String) -> Result<(), String> {
    if !serde_json::from_str::<serde_json::Value>(&data).map(|v| v.is_object()).unwrap_or(false) {
        return Err("refusing to write a save that is not a JSON object".into());
    }
    let dir = save_dir(&app)?;
    let main = dir.join("save.json");
    let bak = dir.join("save.bak.json");
    let tmp = dir.join("save.json.tmp");
    fs::write(&tmp, data.as_bytes()).map_err(|e| e.to_string())?;
    if main.exists() {
        let _ = fs::copy(&main, &bak);
    }
    fs::rename(&tmp, &main).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_read(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = save_dir(&app)?;
    let main = fs::read_to_string(dir.join("save.json")).unwrap_or_default();
    let bak = fs::read_to_string(dir.join("save.bak.json")).unwrap_or_default();
    Ok(vec![main, bak])
}

#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0);
}

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
        .invoke_handler(tauri::generate_handler![zen_update_status, zen_update_install, save_write, save_read, app_quit])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if CLOSING.swap(true, Ordering::SeqCst) {
                    return; // second close: let it go
                }
                api.prevent_close();
                let app = window.app_handle().clone();
                if let Some(w) = app.get_webview_window(window.label()) {
                    let _ = w.eval(
                        "(async()=>{try{if(window.__gardenFlush)await window.__gardenFlush();}catch(e){}window.__TAURI_INTERNALS__.invoke('app_quit');})()",
                    );
                }
                // never hang on close: exit anyway after a moment
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(2500));
                    app.exit(0);
                });
            }
        })
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
