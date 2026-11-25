use serde::Serialize;
use tauri::command;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use std::sync::mpsc::channel;
use std::io::Write;

#[derive(Serialize)]
struct PickedFile {
    name: String,
    bytes: Vec<u8>,
}

// ── 日志落盘 ─────────────────────────────────────────────────────────
// 读者是维护者（命令行 / 探针），不是界面用户：release 里不出现任何面板或按钮（爹地 11-18 红线）。
// 位置固定 ~/Library/Logs/ContainerLoadingSim/app.log，追加写，超 5MB 滚动为 app.log.1。
// 不写业务内容（品名/单号/文件名一律不落盘），只写计数与结果，避免日志本身成为泄漏源。
fn log_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home)
        .join("Library")
        .join("Logs")
        .join("ContainerLoadingSim")
}

fn log_line(kind: &str, msg: &str) {
    let dir = log_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join("app.log");
    if let Ok(md) = std::fs::metadata(&file) {
        if md.len() > 5 * 1024 * 1024 {
            let _ = std::fs::rename(&file, dir.join("app.log.1"));
        }
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
    {
        let _ = writeln!(f, "[{}] [{}] {}", ts, kind, msg);
    }
}

/// 写一行启动记录。[boot] version=<版本> exe=<二进制路径>
pub fn log_boot() {
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    log_line(
        "boot",
        &format!("version={} exe={}", env!("CARGO_PKG_VERSION"), exe),
    );
}

/// 自检专用：写一条人造错误行。仅当 `CLS_FAULT_INJECT=1` 时由 main 调用。
/// 为什么要有：spec 的 known_errors 必须来自真日志（不许编），而这个 App 的错误场景
/// 目前只有「用户取消对话框」和「写盘失败」，没法随时复现 —— 注入一条并明确标注
/// FAULT_INJECTED，既能验正则又不会冒充真实故障。界面无任何关联控件（爹地 11-18 红线）。
pub fn log_fault_injected(tag: &str) {
    log_line(
        "op",
        &format!("kind=pick ok=0 err=FAULT_INJECTED:{} elapsed=0ms", tag),
    );
}

/// 选择 Excel 文件并立即读取内容（合并 pick + read 为一步）。
/// 安全：不暴露接受任意路径的命令，前端无法通过 IPC 读取任意文件。
#[command]
fn pick_excel_file_read(app: AppHandle) -> Result<Option<PickedFile>, String> {
    let t0 = std::time::Instant::now();
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
    let res = rx.recv().map_err(|e| e.to_string());
    let ms = t0.elapsed().as_millis();
    // 只记字节数，不记文件名（文件名可能带单号/客户名）
    match &res {
        Ok(Some(f)) => log_line(
            "op",
            &format!("kind=pick ok=1 bytes={} elapsed={}ms", f.bytes.len(), ms),
        ),
        Ok(None) => log_line("op", &format!("kind=pick ok=0 err=cancelled elapsed={}ms", ms)),
        Err(e) => log_line("op", &format!("kind=pick ok=0 err={} elapsed={}ms", e, ms)),
    }
    res
}

#[command]
fn save_pdf_file(app: AppHandle, default_name: String, data: Vec<u8>) -> Result<bool, String> {
    let t0 = std::time::Instant::now();
    let nbytes = data.len();
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
    let res = rx.recv().map_err(|e| e.to_string());
    let ms = t0.elapsed().as_millis();
    match &res {
        Ok(true) => log_line(
            "op",
            &format!("kind=export ok=1 bytes={} elapsed={}ms", nbytes, ms),
        ),
        Ok(false) => log_line(
            "op",
            &format!("kind=export ok=0 err=cancelled bytes={} elapsed={}ms", nbytes, ms),
        ),
        Err(e) => log_line("op", &format!("kind=export ok=0 err={} elapsed={}ms", e, ms)),
    }
    res
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 启动即落一行 boot（版本 + 二进制路径），探针据此判「本次启动后的追加」
            log_boot();

            // ★ 2026-11-18：3D 调试日志门控。只有 `CLS_DEBUG=1` 启动才给前端打开开关；
            //   正常启动 `window.__CLS_DEBUG__` 不存在，控制台零 `[3D Diag]`（爹地 11-18 红线）。
            //   延迟 600ms：setup 阶段 WebView 尚未执行前端脚本，立即 eval 会随导航丢失。
            if std::env::var("CLS_DEBUG").map(|v| v == "1").unwrap_or(false) {
                if let Some(w) = tauri::Manager::get_webview_window(app, "main") {
                    let w2 = w.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        let _ = w2.eval("window.__CLS_DEBUG__=true");
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_excel_file_read,
            save_pdf_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
