#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 无窗自检模式：只写一行 [boot] 日志就退出，不创建任何窗口。
    // 用途：让探针 / 验收在静默红线（不得让窗口出现在屏幕上）下也能拿到真实启动证据。
    // 正常启动走 run()，其 setup 里同样会写这条日志。
    if std::env::var("CLS_BOOT_LOG_ONLY")
        .map(|v| v == "1")
        .unwrap_or(false)
    {
        container_loading_sim::log_boot();
        // 同一次无窗运行里，按需再落一条注入错误行（供 selfcheck 的 known_errors 验正则）
        if let Ok(tag) = std::env::var("CLS_FAULT_INJECT") {
            if !tag.is_empty() && tag != "0" {
                container_loading_sim::log_fault_injected(&tag);
            }
        }
        std::process::exit(0);
    }
    container_loading_sim::run();
}
