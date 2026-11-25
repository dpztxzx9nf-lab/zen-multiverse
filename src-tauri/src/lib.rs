// Zen Multiverse desktop/mobile shell.
// The web save ('garden-save' in localStorage) is mirrored to the app data folder so it survives
// webview cache clears: save.json (latest) + save.bak.json (the previous good one). The web side
// validates the JSON before sending it; writes go to a temp file and are renamed into place.
// On window close the web side gets one chance to flush its save before the app exits.
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, WindowEvent};

static CLOSING: AtomicBool = AtomicBool::new(false);

fn save_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn save_write(app: AppHandle, data: String) -> Result<(), String> {
    if data.len() < 2 || !data.trim_start().starts_with('{') {
        return Err("refusing to write an empty or non-object save".into());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_write, save_read, app_quit])
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
