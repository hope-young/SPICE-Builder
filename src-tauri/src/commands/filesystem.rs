// commands/filesystem.rs
// 文件对话框（选择 .xlsx、保存 .lib）

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// 打开文件对话框，选择 .xlsx / .csv / .txt 数据文件
#[tauri::command]
pub async fn open_excel_file(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Data files", &["xlsx", "csv", "tsv", "txt"])
        .add_filter("Excel", &["xlsx"])
        .add_filter("CSV", &["csv", "tsv"])
        .add_filter("Text", &["txt"])
        .set_title("Select SPICE data file")
        .pick_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(path) => {
            // FilePath -> String
            let path_str = path.to_string();
            Ok(path_str)
        }
        None => Err("No file selected".to_string()),
    }
}

/// 打开文件对话框，选择 SPICE model/library 文件
#[tauri::command]
pub async fn open_spice_model_file(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("SPICE model files", &["lib", "cir", "spice", "mod", "mdl"])
        .add_filter("SPICE library", &["lib"])
        .add_filter("All files", &["*"])
        .set_title("Select SPICE model file")
        .pick_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(path) => Ok(path.to_string()),
        None => Err("No file selected".to_string()),
    }
}

/// 保存文件对话框（导出 .lib）
#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    default_name: String,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("SPICE Library", &["lib"])
        .add_filter("All files", &["*"])
        .set_title("Save SPICE model file")
        .set_file_name(&default_name)
        .save_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(path) => Ok(path.to_string()),
        None => Err("No path selected".to_string()),
    }
}

/// 读取文本文件（用于小文件预览）
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// 在系统文件浏览器中打开文件夹
#[tauri::command]
pub async fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let folder = std::path::PathBuf::from(&path);
    if !folder.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    let _ = app; // unused
    Ok(())
}
