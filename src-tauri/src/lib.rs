use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
struct OpenResult {
    name: String,
    bytes_base64: String,
}

#[tauri::command]
fn open_design_file() -> Result<Option<OpenResult>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("ARCO project", &["arco", "pfg"])
        .add_filter("Figma file", &["fig"])
        .add_filter("All supported files", &["arco", "pfg", "fig"])
        .pick_file()
    else {
        return Ok(None);
    };

    let bytes = fs::read(&path).map_err(|e| format!("Unable to read file: {e}"))?;
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("design.arco")
        .to_string();

    Ok(Some(OpenResult {
        name,
        bytes_base64: STANDARD.encode(bytes),
    }))
}

#[tauri::command]
fn save_design_file(name: String, bytes_base64: String) -> Result<Option<String>, String> {
    let suggested = if name.trim().is_empty() { "design.arco" } else { &name };
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(suggested)
        .add_filter("ARCO project", &["arco", "pfg"])
        .add_filter("Figma file", &["fig"])
        .save_file()
    else {
        return Ok(None);
    };

    let bytes = STANDARD
        .decode(bytes_base64.as_bytes())
        .map_err(|e| format!("Invalid file payload: {e}"))?;

    let tmp = temporary_path(&path);
    fs::write(&tmp, &bytes).map_err(|e| format!("Unable to write temporary file: {e}"))?;
    fs::rename(&tmp, &path).or_else(|_| {
        fs::copy(&tmp, &path).map(|_| ()).and_then(|_| fs::remove_file(&tmp))
    }).map_err(|e| format!("Unable to commit file: {e}"))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

fn temporary_path(path: &PathBuf) -> PathBuf {
    let mut tmp = path.clone();
    let file = path.file_name().and_then(|v| v.to_str()).unwrap_or("design");
    tmp.set_file_name(format!('.{file}.arco-tmp'));
    tmp
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "desktop": true,
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_design_file, save_design_file, app_info])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ARCO");
}
