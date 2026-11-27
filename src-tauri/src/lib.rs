// Desktop shell for Zen Multiverse.
// Auto-update: we quietly check the update endpoint 20 s after launch and then every 45 minutes while
// the game runs (a failed check retries after 5 minutes), download a newer signed build in the
// background, and tell the page it is ready. The page saves and installs by itself at a safe moment
// (no Update / Restart click). A failed install leaves the running app alone and retries soon.
// A newer release that comes out while one is already waiting replaces it. Every check writes one line
// to <app log dir>/updater.log, so a stuck updater shows up in the logs. (0.2.11 only checked at
// launch, so a copy left running overnight never heard about 0.2.12-0.2.14.)
// Windows: updater installMode is "quiet" (no installer window) because the NSIS package is
// current-user, so it does not need a UAC prompt. "passive" would show a progress bar; "quiet"
// cannot request elevation, which is fine for a per-user install.
//
// Save safety: the web save ('garden-save' in localStorage) is mirrored to the app data folder so
// it survives webview cache clears: save.json (latest) + save.bak.json (the previous good one).
// The web side validates the JSON before sending; writes go to a temp file renamed into place.
// One-click invites: zenmultiverse://join/CODE links (from play.thinkcore.io/j/CODE) reach the running
// app through the deep-link plugin; a second launch is folded into the first by single-instance. The
// links wait in PendingLinks until the page pulls them (zen_take_links), so a cold start loses none.
//
// On window close the page gets one chance (<= 2.5 s) to flush its save before the app exits.
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

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

// Error tracking: the page's error ring buffer (js/perf/errlog.js) appends one JSON line per new
// error to <app log dir>/zen-errors.log. Capped: the file rolls to zen-errors.1.log at 512 KB.
#[tauri::command]
fn log_append(app: AppHandle, line: String) -> Result<(), String> {
    use std::io::Write;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("zen-errors.log");
    if fs::metadata(&path).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = fs::rename(&path, dir.join("zen-errors.1.log"));
    }
    let mut line: String = line.chars().take(4000).collect();
    line.retain(|c| c != '\n' && c != '\r');
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    writeln!(f, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[derive(Default)]
struct PendingLinks(Mutex<Vec<String>>);

fn push_links(app: &AppHandle, urls: Vec<String>) {
    let urls: Vec<String> = urls.into_iter().filter(|u| u.starts_with("zenmultiverse://") && u.len() < 200).collect();
    if urls.is_empty() {
        return;
    }
    if let Some(p) = app.try_state::<PendingLinks>() {
        let mut v = p.0.lock().unwrap();
        for u in urls {
            if !v.contains(&u) {
                v.push(u);
            }
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = w.eval("window.__zenDeepLink&&window.__zenDeepLink()");
    }
}

#[tauri::command]
fn zen_take_links(pending: State<'_, PendingLinks>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

#[derive(Default)]
struct PendingUpdate(Mutex<Option<(Update, Vec<u8>)>>);

#[derive(Serialize)]
struct UpdateStatus {
    ready: bool,
    version: Option<String>,
    current: String,
    checked: u64, // unix seconds of the last finished check (0 = not yet)
}

static LAST_CHECK: AtomicU64 = AtomicU64::new(0);
static INSTALL_FAIL: AtomicBool = AtomicBool::new(false);
const FIRST_CHECK_S: u64 = 20; // give the garden a moment to load before touching the network
const CHECK_EVERY_S: u64 = 45 * 60;
const RETRY_S: u64 = 5 * 60;
const INSTALL_RETRY_S: u64 = 30;

fn now_s() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// one line per check in <app log dir>/updater.log (rolls to updater.1.log at 64 KB)
fn update_log(app: &AppHandle, msg: &str) {
    use std::io::Write;
    let Ok(dir) = app.path().app_log_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("updater.log");
    if fs::metadata(&path).map(|m| m.len() > 64 * 1024).unwrap_or(false) {
        let _ = fs::rename(&path, dir.join("updater.1.log"));
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} v{} {}", now_s(), app.package_info().version, msg);
    }
}

// Debug builds only: ZEN_UPDATE_URL / ZEN_UPDATE_PUBKEY / ZEN_UPDATE_FIRST_S / ZEN_UPDATE_EVERY_S point a
// dev build at a local feed signed with a throwaway key (tests/updater-e2e.sh). Release builds ignore them.
fn dev_env(_name: &str) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        return std::env::var(_name).ok().filter(|v| !v.is_empty());
    }
    #[allow(unreachable_code)]
    None
}

fn updater_for(app: &AppHandle) -> Result<Updater, String> {
    let mut b = app.updater_builder();
    if let Some(u) = dev_env("ZEN_UPDATE_URL") {
        let url: tauri::Url = u.parse().map_err(|e| format!("bad ZEN_UPDATE_URL: {e}"))?;
        b = b.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    if let Some(k) = dev_env("ZEN_UPDATE_PUBKEY") {
        b = b.pubkey(k);
    }
    b.build().map_err(|e| e.to_string())
}

#[tauri::command]
fn zen_update_status(app: AppHandle, pending: State<'_, PendingUpdate>) -> UpdateStatus {
    let guard = pending.0.lock().unwrap();
    UpdateStatus {
        ready: guard.is_some(),
        version: guard.as_ref().map(|(u, _)| u.version.clone()),
        current: app.package_info().version.to_string(),
        checked: LAST_CHECK.load(Ordering::Relaxed),
    }
}

#[tauri::command]
fn zen_update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let taken = pending.0.lock().unwrap().take();
    let Some((update, bytes)) = taken else {
        return Err("no update ready".into());
    };
    // On Windows this hands off to the installer and exits; on macOS it swaps the app bundle.
    // Quiet NSIS (/S /R) relaunches the app; a failed install must not take down the running copy.
    if let Err(e) = update.install(bytes) {
        let msg = e.to_string();
        update_log(&app, &format!("install failed: {msg}"));
        INSTALL_FAIL.store(true, Ordering::Relaxed);
        return Err(msg);
    }
    app.restart();
}

#[tauri::command]
async fn zen_update_check(app: AppHandle) -> Result<String, String> {
    let msg = check_once(&app).await?;
    update_log(&app, &msg);
    LAST_CHECK.store(now_s(), Ordering::Relaxed);
    Ok(msg)
}

// One check: Ok(what happened) or Err(why it failed). Network calls are time-boxed so a hung request
// can never stall the schedule.
async fn check_once(app: &AppHandle) -> Result<String, String> {
    let updater = updater_for(app)?;
    let found = tokio::time::timeout(Duration::from_secs(90), updater.check())
        .await
        .map_err(|_| "check timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let Some(update) = found else {
        return Ok("up to date".into());
    };
    let version = update.version.clone();
    if let Some(pending) = app.try_state::<PendingUpdate>() {
        if pending.0.lock().unwrap().as_ref().map(|(u, _)| u.version == version).unwrap_or(false) {
            return Ok(format!("{version} already downloaded, waiting"));
        }
    }
    let bytes = tokio::time::timeout(Duration::from_secs(45 * 60), update.download(|_, _| {}, || {}))
        .await
        .map_err(|_| format!("download of {version} timed out"))?
        .map_err(|e| format!("download of {version} failed: {e}"))?;
    if let Some(pending) = app.try_state::<PendingUpdate>() {
        // a newer release replaces one that was already waiting
        *pending.0.lock().unwrap() = Some((update, bytes));
    }
    Ok(format!("{version} downloaded, ready"))
}

// Launch check, then every CHECK_EVERY_S while running. Wall-clock based (checked once a minute), so a
// laptop that slept through the due time checks soon after it wakes.
async fn update_loop(app: AppHandle) {
    let first = dev_env("ZEN_UPDATE_FIRST_S").and_then(|v| v.parse().ok()).unwrap_or(FIRST_CHECK_S);
    let every = dev_env("ZEN_UPDATE_EVERY_S").and_then(|v| v.parse().ok()).unwrap_or(CHECK_EVERY_S).max(1);
    let tick = Duration::from_secs(every.min(60));
    tokio::time::sleep(Duration::from_secs(first)).await;
    loop {
        let wait = match check_once(&app).await {
            Ok(msg) => {
                update_log(&app, &msg);
                if INSTALL_FAIL.swap(false, Ordering::Relaxed) { INSTALL_RETRY_S } else { every }
            }
            Err(e) => {
                update_log(&app, &format!("check failed: {e}"));
                if INSTALL_FAIL.swap(false, Ordering::Relaxed) { INSTALL_RETRY_S } else { every.min(RETRY_S) }
            }
        };
        LAST_CHECK.store(now_s(), Ordering::Relaxed);
        // (bounded too, so a clock set backwards can't push the next check out by more than 2x)
        let due = now_s() + wait;
        let mut ticks = 2 * wait / tick.as_secs().max(1) + 1;
        while now_s() < due && ticks > 0 {
            tokio::time::sleep(tick).await;
            ticks -= 1;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // must be the first plugin: a second launch (an invite link clicked while playing) is handed here
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));
    let app = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .manage(PendingLinks::default())
        .invoke_handler(tauri::generate_handler![zen_update_status, zen_update_install, zen_update_check, save_write, save_read, app_quit, log_append, zen_take_links])
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
            // invite links: the one that launched the app, then any opened while it runs
            #[cfg(any(windows, target_os = "linux"))]
            let _ = app.deep_link().register_all();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                push_links(app.handle(), urls.iter().map(|u| u.to_string()).collect());
            }
            let links = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                push_links(&links, event.urls().iter().map(|u| u.to_string()).collect());
            });
            tauri::async_runtime::spawn(update_loop(app.handle().clone()));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        // If a downloaded update is still waiting when the game is closed, install it then.
        if let RunEvent::Exit = event {
            if let Some(pending) = handle.try_state::<PendingUpdate>() {
                if let Some((update, bytes)) = pending.0.lock().unwrap().take() {
                    let _ = update.install(bytes);
                }
            }
        }
    });
}
