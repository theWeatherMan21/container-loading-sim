use serde::Serialize;
use tauri::command;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use std::sync::mpsc::channel;

#[derive(Serialize)]
struct PickedFile {
    name: String,
    bytes: Vec<u8>,
}

/// 选择 Excel 文件并立即读取内容（合并 pick + read 为一步）。
/// 安全：不暴露接受任意路径的命令，前端无法通过 IPC 读取任意文件。
#[command]
fn pick_excel_file_read(app: AppHandle) -> Result<Option<PickedFile>, String> {
    let (tx, rx) = channel();
    app.dialog()
        .file()
        .add_filter("Excel", &["xlsx", "xls", "csv"])
        .pick_file(move |path| {
            let picked = path.map(|p| {
                let pb = p.into_path().unwrap_or_default();
                let name = pb
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let bytes = std::fs::read(&pb).unwrap_or_default();
                PickedFile { name, bytes }
            });
            tx.send(picked).ok();
        });
    rx.recv().map_err(|e| e.to_string())
}

#[command]
fn save_pdf_file(app: AppHandle, default_name: String, data: Vec<u8>) -> Result<bool, String> {
    let (tx, rx) = channel();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("PDF", &["pdf"])
        .save_file(move |path| {
            let saved = path.map(|p| p.to_string()).and_then(|p| {
                std::fs::write(&p, data.clone()).ok().map(|_| true)
            }).unwrap_or(false);
            tx.send(saved).ok();
        });
    rx.recv().map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            pick_excel_file_read,
            save_pdf_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
