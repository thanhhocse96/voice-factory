mod gateway_lifecycle;

use gateway_lifecycle::RuntimeSnapshot;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
struct RuntimeOwner {
    started_by_shell: AtomicBool,
    last_start_error: Mutex<Option<String>>,
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
    let mut snapshot = gateway_lifecycle::status_gateway().map_err(|error| error.to_string())?;
    if snapshot.error.is_none() {
        snapshot.error = owner.last_start_error();
    }
    Ok(snapshot)
}

#[tauri::command]
fn gateway_runtime_start(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    let snapshot = gateway_lifecycle::start_gateway().map_err(|error| error.to_string())?;
    owner.observe_start(&snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn gateway_runtime_stop_if_owned(owner: State<'_, RuntimeOwner>) -> Result<RuntimeSnapshot, String> {
    if !owner.started_by_shell.load(Ordering::SeqCst) {
        return gateway_lifecycle::status_gateway().map_err(|error| error.to_string());
    }

    let snapshot = gateway_lifecycle::stop_gateway().map_err(|error| error.to_string())?;
    owner.started_by_shell.store(false, Ordering::SeqCst);
    Ok(snapshot)
}

#[tauri::command]
fn browser_runtime_status() -> Result<RuntimeSnapshot, String> {
    gateway_lifecycle::status_browser().map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_runtime_start() -> Result<RuntimeSnapshot, String> {
    gateway_lifecycle::start_browser().map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_runtime_stop_if_owned() -> Result<RuntimeSnapshot, String> {
    // Early impl: allow stop; refine ownership later like gateway
    gateway_lifecycle::stop_browser_if_owned().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeOwner::default())
        .setup(|app| {
            let owner = app.state::<RuntimeOwner>();
            match gateway_lifecycle::start_gateway() {
                Ok(snapshot) => owner.observe_start(&snapshot),
                Err(error) => owner.record_start_error(Some(error.to_string())),
            }
            // Parallel browser launch for easier Brave test (per plan in M2_004/M2_005)
            // Does not block if fails (degraded in gateway health)
            let _ = gateway_lifecycle::start_browser();
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
