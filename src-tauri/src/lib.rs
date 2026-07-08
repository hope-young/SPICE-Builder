// SpiceBuilder - Tauri Rust backend
// IPC commands for React frontend ↔ Python FastAPI backend

mod commands;

use commands::python_backend::PythonBackendState;
use tauri::Manager;

#[tauri::command]
fn hello(name: &str) -> String {
    format!("Hello, {}! From Tauri + Rust 🦀", name)
}

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    ).try_init();

    log::info!("SpiceBuilder Tauri backend starting...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PythonBackendState::default())
        .invoke_handler(tauri::generate_handler![
            // 基础
            hello,
            get_version,
            // Python sidecar
            commands::python_backend::start_python_backend,
            commands::python_backend::stop_python_backend,
            commands::python_backend::check_backend,
            // 文件
            commands::filesystem::open_excel_file,
            commands::filesystem::open_spice_model_file,
            commands::filesystem::save_file_dialog,
            commands::filesystem::read_text_file,
            commands::filesystem::open_folder,
            // 代理
            commands::proxy::call_api,
            commands::proxy::api_load_project,
            commands::proxy::api_run_fit,
            commands::proxy::api_export_lib,
        ])
        .setup(|_app| Ok(()))
        .on_window_event(|window, event| {
            // 窗口关闭时杀掉 Python 子进程
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<PythonBackendState>() {
                    if let Some(mut child) = state.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
                        let _ = child.start_kill();
                        log::info!("Python backend killed on window close");
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
