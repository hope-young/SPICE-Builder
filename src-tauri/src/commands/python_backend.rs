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

/// 查找系统 Python 解释器
fn find_python() -> Result<String, String> {
    // Windows 上常见的 Python 命令
    for name in &["python", "python3", "py"] {
        if let Ok(path) = which::which(name) {
            return Ok(path.to_string_lossy().to_string());
        }
    }
    // Windows 常见安装位置
    let candidates = [
        "C:\\Python311\\python.exe",
        "C:\\Python310\\python.exe",
        "C:\\Python312\\python.exe",
        "C:\\Users\\Public\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Ok(c.to_string());
        }
    }
    Err("Python not found. Please install Python 3.10+ and ensure 'python' is in PATH.".to_string())
}

/// 启动 Python 后端 sidecar
#[tauri::command]
pub async fn start_python_backend(
    _app: tauri::AppHandle,
    state: State<'_, PythonBackendState>,
) -> Result<String, String> {
    // 已经在跑？
    {
        let running = state.running.lock().unwrap_or_else(|e| e.into_inner());
        if *running {
            return Ok(format!("already running at {}", PYTHON_URL));
        }
    }

    let python = find_python()?;
    log::info!("Using Python: {}", python);

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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let start = std::time::Instant::now();
    let health_url = format!("{}/api/health", PYTHON_URL);
    while start.elapsed().as_secs() < STARTUP_TIMEOUT_S {
        match client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                log::info!("Python backend healthy: {}", health_url);
                return Ok(format!("running at {}", PYTHON_URL));
            }
            _ => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }

    // 超时但可能仍在启动
    log::warn!("Python backend started but health check timed out ({}s)", STARTUP_TIMEOUT_S);
    Ok(format!(
        "started but health check timeout (URL: {})",
        PYTHON_URL
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
