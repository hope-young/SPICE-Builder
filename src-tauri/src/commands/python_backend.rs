// commands/python_backend.rs
// Python FastAPI 后端 sidecar 管理
//
// 策略：使用 system Python（不打包 Python 解释器）
// 启动命令: python -m spicebuilder.api.scripts.run_api
// 默认端口: 8000

use std::process::Stdio;
use std::sync::Mutex;
use tauri::State;
use tokio::process::{Child, Command};
use serde::Serialize;

#[allow(dead_code)]
const PYTHON_HOST: &str = "127.0.0.1";
#[allow(dead_code)]
const PYTHON_PORT: u16 = 8765;
const PYTHON_URL: &str = "http://127.0.0.1:8765";
const PYTHON_API_MODULE: &str = "spicebuilder.api.scripts.run_api";
const STARTUP_TIMEOUT_S: u64 = 15;
const REQUIRED_EXPORT_ENDPOINT: &str = "/api/csv/export_model";

pub struct PythonBackendState {
    pub child: Mutex<Option<Child>>,
    pub running: Mutex<bool>,
    pub pid: Mutex<Option<u32>>,
}

impl Default for PythonBackendState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            running: Mutex::new(false),
            pid: Mutex::new(None),
        }
    }
}

#[derive(Serialize)]
pub struct HealthStatus {
    pub running: bool,
    pub url: String,
    pub pid: Option<u32>,
    pub api_version: Option<String>,
    pub uptime_s: Option<f64>,
    pub error: Option<String>,
}

fn is_windows_app_alias(path: &str) -> bool {
    path.to_ascii_lowercase().contains("\\windowsapps\\python")
}

fn python_can_import_api(path: &str, project_root: &str) -> bool {
    let output = std::process::Command::new(path)
        .arg("-c")
        .arg("import spicebuilder.api.server")
        .current_dir(project_root)
        .env("PYTHONIOENCODING", "utf-8")
        .output();
    match output {
        Ok(out) if out.status.success() => true,
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            log::warn!("Python candidate rejected: {} ({})", path, stderr.trim());
            false
        }
        Err(e) => {
            log::warn!("Python candidate cannot run: {} ({})", path, e);
            false
        }
    }
}

/// 查找能导入当前项目 API 的真实 Python 解释器。
fn find_python(project_root: &str) -> Result<String, String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(path) = std::env::var("SPICEBUILDER_PYTHON") {
        candidates.push(path);
    }

    #[cfg(windows)]
    {
        candidates.push(format!("{}\\.venv\\Scripts\\python.exe", project_root));
        candidates.push(format!("{}\\venv\\Scripts\\python.exe", project_root));
    }
    #[cfg(not(windows))]
    {
        candidates.push(format!("{}/.venv/bin/python", project_root));
        candidates.push(format!("{}/venv/bin/python", project_root));
    }

    for name in &["python", "python3", "py"] {
        if let Ok(path) = which::which(name) {
            candidates.push(path.to_string_lossy().to_string());
        }
    }

    candidates.extend([
        "C:\\Python312\\python.exe".to_string(),
        "C:\\Python311\\python.exe".to_string(),
        "C:\\Python310\\python.exe".to_string(),
        "C:\\Users\\Public\\AppData\\Local\\Programs\\Python\\Python312\\python.exe".to_string(),
        "C:\\Users\\Public\\AppData\\Local\\Programs\\Python\\Python311\\python.exe".to_string(),
    ]);

    for candidate in candidates {
        let path = std::path::Path::new(&candidate);
        if !path.exists() || is_windows_app_alias(&candidate) {
            continue;
        }
        if python_can_import_api(&candidate, project_root) {
            return Ok(candidate);
        }
    }

    Err(format!(
        "No Python environment can import spicebuilder.api.server. Install dependencies in the project env, e.g. .venv\\Scripts\\python.exe -m pip install -e . -r requirements-api.txt, or set SPICEBUILDER_PYTHON to a valid python.exe. Skipped WindowsApps python aliases."
    ))
}

async fn endpoint_is_registered(client: &reqwest::Client) -> Result<bool, String> {
    let openapi_url = format!("{}/openapi.json", PYTHON_URL);
    let resp = client
        .get(&openapi_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Ok(false);
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body
        .get("paths")
        .and_then(|paths| paths.get(REQUIRED_EXPORT_ENDPOINT))
        .is_some())
}

async fn backend_root_is_spicebuilder(client: &reqwest::Client) -> bool {
    let root_url = format!("{}/", PYTHON_URL);
    match client.get(&root_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let body: serde_json::Value = resp
                .json()
                .await
                .unwrap_or_else(|_| serde_json::json!({}));
            body.get("name")
                .and_then(|v| v.as_str())
                .map(|name| name.contains("SpiceBuilder"))
                .unwrap_or(false)
        }
        _ => false,
    }
}

#[cfg(windows)]
fn kill_port_listeners(port: u16) -> Result<Vec<u32>, String> {
    let output = std::process::Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .map_err(|e| format!("failed to run netstat: {}", e))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{}", port);
    let current_pid = std::process::id();
    let mut pids: Vec<u32> = Vec::new();

    for line in text.lines() {
        let line_upper = line.to_ascii_uppercase();
        if !line_upper.contains("LISTENING") || !line.contains(&needle) {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        let Some(pid_text) = parts.last() else {
            continue;
        };
        let Ok(pid) = pid_text.parse::<u32>() else {
            continue;
        };
        if pid != current_pid && !pids.contains(&pid) {
            pids.push(pid);
        }
    }

    for pid in &pids {
        let status = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .status()
            .map_err(|e| format!("failed to run taskkill for pid {}: {}", pid, e))?;
        if !status.success() {
            log::warn!("taskkill returned non-zero status for pid {}", pid);
        } else {
            log::warn!("Killed stale Python backend listener on port {} pid={}", port, pid);
        }
    }

    Ok(pids)
}

#[cfg(not(windows))]
fn kill_port_listeners(_port: u16) -> Result<Vec<u32>, String> {
    Ok(Vec::new())
}

async fn release_stale_backend_if_needed(client: &reqwest::Client) -> Result<(), String> {
    match endpoint_is_registered(client).await {
        Ok(true) => return Ok(()),
        Ok(false) => {}
        Err(_) => return Ok(()),
    }

    if !backend_root_is_spicebuilder(client).await {
        return Ok(());
    }

    log::warn!(
        "Port {} is held by a stale SpiceBuilder backend without {}; releasing it",
        PYTHON_PORT,
        REQUIRED_EXPORT_ENDPOINT
    );
    let killed = kill_port_listeners(PYTHON_PORT)?;
    if killed.is_empty() {
        log::warn!("No LISTENING process found for stale backend port {}", PYTHON_PORT);
    }
    std::thread::sleep(std::time::Duration::from_millis(800));
    Ok(())
}

/// 启动 Python 后端 sidecar
#[tauri::command]
pub async fn start_python_backend(
    _app: tauri::AppHandle,
    state: State<'_, PythonBackendState>,
) -> Result<String, String> {
    // 已经在跑？
    let already_running = {
        *state.running.lock().unwrap_or_else(|e| e.into_inner())
    };
    if already_running {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .map_err(|e| e.to_string())?;
        if endpoint_is_registered(&client).await.unwrap_or(false) {
            return Ok(format!("already running at {}", PYTHON_URL));
        }
        release_stale_backend_if_needed(&client).await?;
        return Err(format!(
            "Python backend was stale and has been released. Start the backend again."
        ));
    }

    // 构造 PATH：spicebuilder 项目根（让 Python 找到 spicebuilder 包）
    // 通常 spicebuilder 在 Tauri 项目的父目录
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Cannot get exe path: {}", e))?
        .parent()
        .ok_or("Cannot get exe parent")?
        .to_path_buf();

    // 找 spicebuilder 根目录（含 pyproject.toml 的目录）
    let mut project_root = exe_dir.clone();
    for _ in 0..5 {
        if project_root.join("pyproject.toml").exists()
            || project_root.join("spicebuilder").join("__init__.py").exists()
        {
            break;
        }
        if !project_root.pop() {
            break;
        }
    }
    let project_root = project_root
        .to_str()
        .ok_or("Invalid project root path")?
        .to_string();

    log::info!("Project root: {}", project_root);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    if endpoint_is_registered(&client).await.unwrap_or(false) {
        log::info!("Reusing existing Python backend at {}", PYTHON_URL);
        *state.running.lock().unwrap_or_else(|e| e.into_inner()) = true;
        *state.pid.lock().unwrap_or_else(|e| e.into_inner()) = None;
        return Ok(format!("running at {}", PYTHON_URL));
    }
    release_stale_backend_if_needed(&client).await?;

    let python = find_python(&project_root)?;
    log::info!("Using Python: {}", python);

    // 启动 Python
    let mut cmd = Command::new(&python);
    cmd.arg("-m")
        .arg(PYTHON_API_MODULE)
        .current_dir(&project_root)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Windows: 隐藏 console 窗口
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = CREATE_NO_WINDOW; // suppress when target is non-windows
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        // 预留占位以便未来 Linux/macOS 调优
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Python: {}", e))?;

    let pid = child.id();
    log::info!("Python backend started, pid={:?}", pid);

    // 存状态
    {
        let mut child_lock = state.child.lock().unwrap_or_else(|e| e.into_inner());
        *child_lock = Some(child);
        let mut running = state.running.lock().unwrap_or_else(|e| e.into_inner());
        *running = true;
        let mut pid_lock = state.pid.lock().unwrap_or_else(|e| e.into_inner());
        *pid_lock = pid;
    }

    // 轮询 /api/health 等启动
    let start = std::time::Instant::now();
    let health_url = format!("{}/api/health", PYTHON_URL);
    while start.elapsed().as_secs() < STARTUP_TIMEOUT_S {
        match client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match endpoint_is_registered(&client).await {
                    Ok(true) => {
                        log::info!("Python backend healthy: {} and {} registered", health_url, REQUIRED_EXPORT_ENDPOINT);
                        return Ok(format!("running at {}", PYTHON_URL));
                    }
                    Ok(false) => {
                        log::warn!(
                            "Python backend health responded, but {} is not registered yet",
                            REQUIRED_EXPORT_ENDPOINT
                        );
                    }
                    Err(e) => {
                        log::warn!("Failed to verify backend routes: {}", e);
                    }
                }
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }

    // 超时但可能仍在启动
    log::warn!(
        "Python backend started but route verification timed out ({}s)",
        STARTUP_TIMEOUT_S
    );
    let child_opt = {
        let mut child_lock = state.child.lock().unwrap_or_else(|e| e.into_inner());
        child_lock.take()
    };
    if let Some(mut child) = child_opt {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), child.wait()).await;
    }
    *state.running.lock().unwrap_or_else(|e| e.into_inner()) = false;
    *state.pid.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Err(format!(
        "Python backend did not expose {} within {}s. Port 8765 may be held by an old backend, or the Python environment may be missing dependencies.",
        REQUIRED_EXPORT_ENDPOINT,
        STARTUP_TIMEOUT_S
    ))
}

/// 停止 Python 后端
#[tauri::command]
pub async fn stop_python_backend(
    state: State<'_, PythonBackendState>,
) -> Result<(), String> {
    // Take child out of the lock BEFORE any await to avoid Send issue
    let child_opt = {
        let mut child_lock = state.child.lock().unwrap_or_else(|e| e.into_inner());
        child_lock.take()
    };

    if let Some(mut child) = child_opt {
        child
            .start_kill()
            .map_err(|e| format!("Failed to kill process: {}", e))?;
        // Reap the child — no lock held across this await
        match tokio::time::timeout(
            std::time::Duration::from_secs(5),
            child.wait(),
        ).await {
            Ok(_) => log::info!("Python backend killed and reaped"),
            Err(_) => log::warn!("Python backend kill timed out during wait"),
        }
    }
    *state.running.lock().unwrap_or_else(|e| e.into_inner()) = false;
    *state.pid.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// 检查 Python 后端健康状态
#[tauri::command]
pub async fn check_backend(
    state: State<'_, PythonBackendState>,
) -> Result<HealthStatus, String> {
    let running = *state.running.lock().unwrap_or_else(|e| e.into_inner());
    let pid = *state.pid.lock().unwrap_or_else(|e| e.into_inner());
    let health_url = format!("{}/api/health", PYTHON_URL);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(&health_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let body: serde_json::Value = resp
                .json()
                .await
                .unwrap_or_else(|_| serde_json::json!({}));
            Ok(HealthStatus {
                running,
                url: PYTHON_URL.to_string(),
                pid,
                api_version: body.get("version").and_then(|v| v.as_str()).map(String::from),
                uptime_s: body.get("uptime_s").and_then(|v| v.as_f64()),
                error: None,
            })
        }
        Ok(resp) => Ok(HealthStatus {
            running,
            url: PYTHON_URL.to_string(),
            pid,
            api_version: None,
            uptime_s: None,
            error: Some(format!("HTTP {}", resp.status())),
        }),
        Err(e) => Ok(HealthStatus {
            running,
            url: PYTHON_URL.to_string(),
            pid,
            api_version: None,
            uptime_s: None,
            error: Some(e.to_string()),
        }),
    }
}
