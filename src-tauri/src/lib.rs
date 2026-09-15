mod gateway_lifecycle;

use gateway_lifecycle::RuntimeSnapshot;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_LOCAL_URL: &str = "http://127.0.0.1:3000";

#[derive(Default)]
struct RuntimeOwner {
    started_by_shell: AtomicBool,
    last_start_error: Mutex<Option<String>>,
    remote_url: Mutex<Option<String>>,
}

impl RuntimeOwner {
    fn observe_start(&self, snapshot: &RuntimeSnapshot) {
        self.started_by_shell
            .store(snapshot.owned_by_shell, Ordering::SeqCst);
        self.record_start_error(None);
    }

    fn record_start_error(&self, error: Option<String>) {
        if let Ok(mut slot) = self.last_start_error.lock() {
            *slot = error;
        }
    }

    fn last_start_error(&self) -> Option<String> {
        self.last_start_error
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
    }

    fn set_remote(&self, url: String) {
        if let Ok(mut slot) = self.remote_url.lock() {
            *slot = Some(url);
        }
    }

    // Some(url) => this shell is pointed at a backend on another machine
    // (docs/design/08 Phase D.4): no local gateway/browser process exists to
    // manage, so every runtime command below short-circuits to a remote
    // health check instead of touching gateway_lifecycle's local-process path.
    fn remote_url(&self) -> Option<String> {
        self.remote_url.lock().ok().and_then(|slot| slot.clone())
    }
}

impl Drop for RuntimeOwner {
    fn drop(&mut self) {
        if self.started_by_shell.load(Ordering::SeqCst) {
            let _ = gateway_lifecycle::stop_gateway();
        }
    }
}

#[tauri::command]
fn gateway_runtime_status(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    if let Some(url) = owner.remote_url() {
        return Ok(gateway_lifecycle::status_remote(&url));
    }
    let mut snapshot = gateway_lifecycle::status_gateway().map_err(|error| error.to_string())?;
    if snapshot.error.is_none() {
        snapshot.error = owner.last_start_error();
    }
    Ok(snapshot)
}

#[tauri::command]
fn gateway_runtime_start(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    if let Some(url) = owner.remote_url() {
        // Nothing local to start - the backend runs on another machine.
        return Ok(gateway_lifecycle::status_remote(&url));
    }
    let snapshot = gateway_lifecycle::start_gateway().map_err(|error| error.to_string())?;
    owner.observe_start(&snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn gateway_runtime_stop_if_owned(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    if let Some(url) = owner.remote_url() {
        return Ok(gateway_lifecycle::status_remote(&url));
    }
    if !owner.started_by_shell.load(Ordering::SeqCst) {
        return gateway_lifecycle::status_gateway().map_err(|error| error.to_string());
    }

    let snapshot = gateway_lifecycle::stop_gateway().map_err(|error| error.to_string())?;
    owner.started_by_shell.store(false, Ordering::SeqCst);
    Ok(snapshot)
}

#[tauri::command]
fn browser_runtime_status(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    if let Some(url) = owner.remote_url() {
        return Ok(gateway_lifecycle::status_remote(&url));
    }
    gateway_lifecycle::status_browser().map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_runtime_start(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    if let Some(url) = owner.remote_url() {
        return Ok(gateway_lifecycle::status_remote(&url));
    }
    gateway_lifecycle::start_browser().map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_runtime_stop_if_owned(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    if let Some(url) = owner.remote_url() {
        return Ok(gateway_lifecycle::status_remote(&url));
    }
    // Early impl: allow stop; refine ownership later like gateway
    gateway_lifecycle::stop_browser_if_owned().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeOwner::default())
        .setup(|app| {
            // VOICEFACTORY_REMOTE_GATEWAY_URL set => this shell is the UI half of a
            // 2-machine split (docs/design/08 Phase D.4): point the window at that
            // backend instead of auto-starting a local gateway/browser that would
            // otherwise sit next to the real one, doing nothing useful.
            let remote_url = std::env::var("VOICEFACTORY_REMOTE_GATEWAY_URL")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());

            // Local mode: start the Gateway (and wait for it to become healthy - this
            // call blocks, per gateway_lifecycle's own startup-timeout polling) BEFORE
            // the window exists at all. The window used to be created first, which
            // meant it always tried to load a Gateway that could not possibly be up
            // yet - a real, live-confirmed race (docs/design/10, M2_016/M2_017): every
            // cold start briefly showed the webview's native "connection refused" page
            // even on a fully successful run, since nothing ever reloaded it once the
            // Gateway did come up. Remote mode is unaffected - there is nothing local
            // to wait for, and this shell can't fix a remote backend's own readiness.
            let owner = app.state::<RuntimeOwner>();
            let target_url = if let Some(url) = remote_url {
                owner.set_remote(url.clone());
                url
            } else {
                match gateway_lifecycle::start_gateway() {
                    Ok(snapshot) => owner.observe_start(&snapshot),
                    Err(error) => owner.record_start_error(Some(error.to_string())),
                }
                // Parallel browser launch for easier Brave test (per plan in M2_004/M2_005)
                // Does not block if fails (degraded in gateway health)
                let _ = gateway_lifecycle::start_browser();
                DEFAULT_LOCAL_URL.to_string()
            };

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(target_url.parse()?))
                .title("VoiceFactory")
                .inner_size(1180.0, 780.0)
                .min_inner_size(960.0, 640.0)
                .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            gateway_runtime_status,
            gateway_runtime_start,
            gateway_runtime_stop_if_owned,
            browser_runtime_status,
            browser_runtime_start,
            browser_runtime_stop_if_owned
        ])
        .run(tauri::generate_context!())
        .expect("error while running VoiceFactory desktop shell");
}
