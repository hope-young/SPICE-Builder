// commands/proxy.rs
// HTTP 代理 - 让前端通过 Tauri 调用 Python API
// （不直接暴露 Python 端口，前端不用处理 CORS）

use serde::Serialize;
use serde_json::Value;

const PYTHON_BASE_URL: &str = "http://127.0.0.1:8765";

#[derive(Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub ok: bool,
    pub body: Value,
    pub error: Option<String>,
}

/// 通用 HTTP 代理 - 前端调用此 command 而非直连 Python
#[tauri::command]
pub async fn call_api(
    method: String,
    endpoint: String,
    body: Option<String>,
) -> Result<ApiResponse, String> {
    // debug: log body 长度 + 前 200 字符
    if let Some(b) = body.as_ref() {
        log::info!("[call_api] method={} endpoint={} body_len={} body_preview={}", method, endpoint, b.len(), &b.chars().take(200).collect::<String>());
    } else {
        log::info!("[call_api] method={} endpoint={} (no body)", method, endpoint);
    }
    let url = format!("{}{}", PYTHON_BASE_URL, endpoint);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))  // 拟合可能耗时
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    if let Some(b) = body {
        // 尝试 JSON 解析；如果不是 JSON 就当 raw text
        if let Ok(json) = serde_json::from_str::<Value>(&b) {
            req = req.json(&json);
        } else {
            req = req.body(b);
        }
    }

    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            let body: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
            Ok(ApiResponse {
                status,
                ok: status < 400,
                body,
                error: None,
            })
        }
        Err(e) => Ok(ApiResponse {
            status: 0,
            ok: false,
            body: Value::Null,
            error: Some(e.to_string()),
        }),
    }
}

/// 加载项目（专用 command，包装 POST /api/projects/load）
#[tauri::command]
pub async fn api_load_project(excel_path: String) -> Result<ApiResponse, String> {
    let body = serde_json::json!({ "excel_path": excel_path });
    call_api("POST".to_string(), "/api/projects/load".to_string(),
              Some(body.to_string())).await
}

/// 跑拟合（专用 command，包装 POST /api/fit/run）
#[tauri::command]
pub async fn api_run_fit(project_id: String) -> Result<ApiResponse, String> {
    let body = serde_json::json!({ "project_id": project_id });
    call_api("POST".to_string(), "/api/fit/run".to_string(),
              Some(body.to_string())).await
}

/// 导出 .lib（专用 command，包装 POST /api/export/lib）
#[tauri::command]
pub async fn api_export_lib(
    project_id: String,
    output_path: String,
    format: String,
) -> Result<ApiResponse, String> {
    let body = serde_json::json!({
        "project_id": project_id,
        "output_path": output_path,
        "format": format,
    });
    call_api("POST".to_string(), "/api/export/lib".to_string(),
              Some(body.to_string())).await
}
