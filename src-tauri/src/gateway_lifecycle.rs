use serde::Serialize;
use serde_json::Value;
use std::env;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub ok: bool,
    pub action: Option<String>,
    pub url: String,
    pub port_open: Option<bool>,
    pub owned_by_shell: bool,
    pub degraded: bool,
    pub health: Option<Value>,
    pub state: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug)]
pub struct LifecycleError {
    message: String,
}

impl LifecycleError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for LifecycleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for LifecycleError {}

pub fn start_gateway() -> Result<RuntimeSnapshot, LifecycleError> {
    run_lifecycle("start")
}

pub fn status_gateway() -> Result<RuntimeSnapshot, LifecycleError> {
    run_lifecycle("status")
}

pub fn stop_gateway() -> Result<RuntimeSnapshot, LifecycleError> {
    run_lifecycle("stop")
}

pub fn start_browser() -> Result<RuntimeSnapshot, LifecycleError> {
    run_browser_lifecycle("start")
}

pub fn status_browser() -> Result<RuntimeSnapshot, LifecycleError> {
    run_browser_lifecycle("status")
}

pub fn stop_browser_if_owned() -> Result<RuntimeSnapshot, LifecycleError> {
    // For simplicity, always allow stop for browser in early impl (refine with owner later)
    run_browser_lifecycle("stop")
}

fn run_browser_lifecycle(action: &str) -> Result<RuntimeSnapshot, LifecycleError> {
    let root = project_root()?;
    let script = root.join("scripts").join("browser-lifecycle.mjs");
    let node = env::var("VOICEFACTORY_NODE").unwrap_or_else(|_| "node".to_string());

    let output = Command::new(node)
        .arg(script)
        .arg(action)
        .current_dir(root)
        .output()
        .map_err(|error| LifecycleError::new(format!("failed to run Browser lifecycle: {error}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(LifecycleError::new(format!(
            "Browser lifecycle {action} failed: {detail}"
        )));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| LifecycleError::new(format!("invalid browser lifecycle output: {error}")))?;
    snapshot_from_json(&stdout)
}

fn run_lifecycle(action: &str) -> Result<RuntimeSnapshot, LifecycleError> {
    let root = project_root()?;
    let script = root.join("scripts").join("gateway-lifecycle.mjs");
    let node = env::var("VOICEFACTORY_NODE").unwrap_or_else(|_| "node".to_string());

    let output = Command::new(node)
        .arg(script)
        .arg(action)
        .current_dir(root)
        .output()
        .map_err(|error| LifecycleError::new(format!("failed to run Gateway lifecycle: {error}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(LifecycleError::new(format!(
            "Gateway lifecycle {action} failed: {detail}"
        )));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| LifecycleError::new(format!("invalid lifecycle output: {error}")))?;
    snapshot_from_json(&stdout)
}

fn project_root() -> Result<PathBuf, LifecycleError> {
    if let Ok(root) = env::var("VOICEFACTORY_PROJECT_ROOT") {
        return Ok(PathBuf::from(root));
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| LifecycleError::new("cannot resolve VoiceFactory project root"))
}

fn snapshot_from_json(output: &str) -> Result<RuntimeSnapshot, LifecycleError> {
    let value: Value = serde_json::from_str(output)
        .map_err(|error| LifecycleError::new(format!("invalid lifecycle JSON: {error}")))?;

    let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let action = value
        .get("action")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let url = value
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or("http://127.0.0.1:3000")
        .to_string();
    let port_open = value.get("portOpen").and_then(Value::as_bool);
    let health = value.get("health").cloned();
    let state = value.get("state").cloned();
    let error = value
        .get("error")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let health_degraded = health
        .as_ref()
        .and_then(|health| health.get("degraded"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Ok(RuntimeSnapshot {
        ok,
        action: action.clone(),
        url,
        port_open,
        owned_by_shell: action.as_deref() == Some("started"),
        degraded: !ok || health_degraded,
        health,
        state,
        error,
    })
}

#[cfg(test)]
mod tests {
    use super::snapshot_from_json;

    #[test]
    fn marks_started_gateway_as_owned_by_shell() {
        let snapshot = snapshot_from_json(
            r#"{"ok":true,"action":"started","url":"http://127.0.0.1:3000","health":{"degraded":false}}"#,
        )
        .expect("snapshot");

        assert!(snapshot.owned_by_shell);
        assert!(!snapshot.degraded);
    }

    #[test]
    fn marks_external_gateway_as_not_owned() {
        let snapshot = snapshot_from_json(
            r#"{"ok":true,"action":"already_running","url":"http://127.0.0.1:3000","health":{"degraded":false}}"#,
        )
        .expect("snapshot");

        assert!(!snapshot.owned_by_shell);
    }

    #[test]
    fn carries_degraded_health_to_desktop_state() {
        let snapshot = snapshot_from_json(
            r#"{"ok":true,"url":"http://127.0.0.1:3000","health":{"degraded":true}}"#,
        )
        .expect("snapshot");

        assert!(snapshot.degraded);
    }
}
