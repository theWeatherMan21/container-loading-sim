use tauri::command;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use std::sync::mpsc::channel;

#[command]
fn pick_excel_file(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = channel();
    app.dialog()
        .file()
        .add_filter("Excel", &["xlsx", "xls", "csv"])
        .pick_file(move |path| {
            tx.send(path.map(|p| p.to_string())).ok();
        });
    rx.recv().map_err(|e| e.to_string())
}

#[command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
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
            pick_excel_file,
            read_file_bytes,
            save_pdf_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
