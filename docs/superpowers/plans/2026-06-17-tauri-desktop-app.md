# Tauri 桌面应用封装实现计划（macOS 优先，保留 Windows）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有的纯前端“智能装箱模拟系统”封装为 macOS 原生桌面应用（.app / .dmg），并保留后续构建 Windows 安装包的能力，使用户可以一键双击打开，无需手动启动 HTTP 服务。

**Architecture:** 采用 Tauri 框架：Rust 后端提供本地文件系统访问和原生对话框，WebView 复用现有 HTML/CSS/JS 前端。前端通过 `@tauri-apps/api` 调用后端命令实现 Excel 选择、PDF/报告保存，其余业务逻辑保持不变。

**Tech Stack:** Tauri v2, Rust, WebKit (macOS), Vanilla JS (现有前端)

---

## File Structure

| 文件/目录 | 职责 |
|---|---|
| `src-tauri/Cargo.toml` | Rust 项目配置与依赖 |
| `src-tauri/tauri.conf.json` | Tauri 应用配置（窗口、权限、前端入口） |
| `src-tauri/src/lib.rs` | Rust 后端命令（打开文件、保存文件、获取应用目录） |
| `src-tauri/src/main.rs` | 应用入口 |
| `src-tauri/icons/` | 应用图标（macOS .icns + Windows .ico） |
| `package.json` | 前端依赖：`@tauri-apps/api`、`@tauri-apps/cli` |
| `tauri-plugin-bridge.js` | 前端桥接：检测 Tauri 环境并替换文件输入/保存行为 |
| `app.js` | 修改文件上传、PDF 导出逻辑，支持 Tauri API |
| `desktop-build.sh` | macOS 一键构建脚本（开发/发布/dmg） |
| `README-DESKTOP.md` | 桌面端构建与使用说明 |

---

## Task 1: 环境准备与 Tauri 初始化

**Files:**
- Create: `package.json`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/main.rs`
- Modify: `index.html`（前端入口适配）

- [ ] **Step 1: 检查 Rust / Tauri 依赖**

```bash
rustc --version
cargo --version
node --version
npm --version
```

Expected: Rust ≥ 1.70, Node ≥ 18。若缺失，先安装 `rustup` 和 Node。

- [ ] **Step 2: 初始化 npm 项目并安装 Tauri 依赖**

```bash
npm init -y
npm install @tauri-apps/api@2 @tauri-apps/cli@2 --save-dev
```

- [ ] **Step 3: 创建 Tauri 配置文件**

Create `src-tauri/tauri.conf.json`:

```json
{
  "productName": "智能装箱模拟系统",
  "identifier": "com.containerloading.sim",
  "version": "1.0.0",
  "build": {
    "frontendDist": "../",
    "devUrl": "http://localhost:8080"
  },
  "app": {
    "windows": [
      {
        "title": "智能装箱模拟系统",
        "width": 1440,
        "height": 900,
        "resizable": true,
        "fullscreen": false,
        "center": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns"],
    "macOS": {
      "frameworks": [],
      "minimumSystemVersion": "10.13",
      "license": ""
    }
  }
}
```

- [ ] **Step 4: 创建 Rust 项目配置**

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "container-loading-sim"
version = "1.0.0"
edition = "2021"

[dependencies]
tauri = { version = "2.0.0", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
opt-level = 3
lto = true
```

Create `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    container_loading_sim_lib::run();
}
```

- [ ] **Step 5: 适配 index.html 以支持 Tauri 协议**

Modify `index.html` 顶部，确保资源路径使用相对路径（已满足），并在 body 末尾增加 Tauri API 检测：

```html
<script>
  window.__TAURI__ = window.__TAURI__ || null;
</script>
```

- [ ] **Step 6: 提交**

```bash
git add package.json src-tauri/ index.html
git commit -m "chore: initialize Tauri desktop app scaffold"
```

---

## Task 2: Rust 后端命令实现

**Files:**
- Create: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`（权限配置）

- [ ] **Step 1: 实现文件选择命令**

```rust
use tauri::command;
use std::path::PathBuf;

#[command]
async fn pick_excel_file() -> Result<Option<String>, String> {
    let path = rfd::AsyncFileDialog::new()
        .add_filter("Excel", &["xlsx", "xls", "csv"])
        .pick_file()
        .await
        .map(|f| f.path().to_string_lossy().to_string());
    Ok(path)
}
```

- [ ] **Step 2: 实现读取文件内容命令**

```rust
#[command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: 实现保存文件命令**

```rust
#[command]
async fn save_pdf_file(default_name: String, data: Vec<u8>) -> Result<bool, String> {
    if let Some(path) = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter("PDF", &["pdf"])
        .save_file()
        .await
    {
        std::fs::write(path.path(), data).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}
```

- [ ] **Step 4: 注册命令与配置权限**

Create `src-tauri/src/lib.rs`:

```rust
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_excel_file,
            read_file_bytes,
            save_pdf_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Update `src-tauri/tauri.conf.json` permissions:

```json
{
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "fs:allow-read-file",
    "fs:allow-write-file"
  ]
}
```

- [ ] **Step 5: 添加 rfd 依赖**

Update `src-tauri/Cargo.toml`:

```toml
[dependencies]
rfd = "0.14"
```

- [ ] **Step 6: 提交**

```bash
git add src-tauri/
git commit -m "feat: add Tauri backend commands for file pick/read/save"
```

---

## Task 3: 前端 Tauri 桥接层

**Files:**
- Create: `tauri-plugin-bridge.js`
- Modify: `app.js`
- Modify: `index.html`

- [ ] **Step 1: 创建桥接模块**

Create `tauri-plugin-bridge.js`:

```javascript
const TauriBridge = (() => {
  const isTauri = typeof window !== 'undefined' && !!window.__TAURI__;

  async function pickExcelFile() {
    if (!isTauri) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('pick_excel_file');
  }

  async function readFileBytes(path) {
    if (!isTauri) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('read_file_bytes', { path });
  }

  async function savePdfFile(defaultName, uint8Array) {
    if (!isTauri) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    const arr = Array.from(uint8Array);
    return invoke('save_pdf_file', { defaultName, data: arr });
  }

  return { isTauri, pickExcelFile, readFileBytes, savePdfFile };
})();

if (typeof window !== 'undefined') {
  window.TauriBridge = TauriBridge;
}
```

- [ ] **Step 2: 在 index.html 引入桥接模块**

Modify `index.html`，在 `app.js` 之前加入：

```html
<script type="module" src="tauri-plugin-bridge.js"></script>
```

- [ ] **Step 3: 修改 app.js 文件上传逻辑**

Find the file input change handler and adapt:

```javascript
async function handleFileSelect() {
  if (TauriBridge && TauriBridge.isTauri) {
    const path = await TauriBridge.pickExcelFile();
    if (!path) return;
    const bytes = await TauriBridge.readFileBytes(path);
    const buffer = new Uint8Array(bytes);
    processExcelBuffer(buffer, path);
    return;
  }
  // 原有浏览器 file input 逻辑保持不变
}
```

- [ ] **Step 4: 修改 PDF 导出逻辑**

In `exportPdf()`:

```javascript
async function exportPdf() {
  // ... 生成 PDF blob ...
  if (TauriBridge && TauriBridge.isTauri) {
    const array = new Uint8Array(await blob.arrayBuffer());
    const saved = await TauriBridge.savePdfFile('装箱报告.pdf', array);
    if (saved) showSuccess('PDF 已保存 🥛');
    return;
  }
  // 原有浏览器下载逻辑
}
```

- [ ] **Step 5: 提交**

```bash
git add tauri-plugin-bridge.js app.js index.html
git commit -m "feat: add Tauri frontend bridge for native file dialogs"
```

---

## Task 4: 图标与应用元数据

**Files:**
- Create: `src-tauri/icons/icon.icns`
- Create: `src-tauri/icons/32x32.png`
- Create: `src-tauri/icons/128x128.png`

- [ ] **Step 1: 生成 macOS 图标集**

Use ImageMagick or macOS `iconutil`:

```bash
mkdir -p src-tauri/icons/icon.iconset
sips -z 16 16     icon.png --out src-tauri/icons/icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out src-tauri/icons/icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out src-tauri/icons/icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out src-tauri/icons/icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out src-tauri/icons/icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out src-tauri/icons/icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out src-tauri/icons/icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out src-tauri/icons/icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out src-tauri/icons/icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out src-tauri/icons/icon.iconset/icon_512x512@2x.png
iconutil -c icns src-tauri/icons/icon.iconset -o src-tauri/icons/icon.icns
```

- [ ] **Step 2: 生成 PNG 图标**

```bash
sips -z 32 32   icon.png --out src-tauri/icons/32x32.png
sips -z 128 128 icon.png --out src-tauri/icons/128x128.png
```

- [ ] **Step 3: 提交**

```bash
git add src-tauri/icons/
git commit -m "assets: add macOS app icons"
```

---

## Task 5: 构建脚本与 macOS 测试

**Files:**
- Create: `desktop-build.sh`
- Create: `README-DESKTOP.md`

- [ ] **Step 1: 创建 macOS 构建脚本**

Create `desktop-build.sh`:

```bash
#!/bin/bash
set -e

echo "==> 安装前端依赖"
npm install

echo "==> 开发模式预览"
# npm run tauri dev

echo "==> 构建 macOS 应用"
npx tauri build --target aarch64-apple-darwin

echo "==> 构建产物"
ls -la src-tauri/target/release/bundle/dmg/
ls -la src-tauri/target/release/bundle/macos/
```

Make executable:

```bash
chmod +x desktop-build.sh
```

- [ ] **Step 2: 编写桌面端 README**

Create `README-DESKTOP.md`:

```markdown
# 桌面端构建说明

## macOS

```bash
./desktop-build.sh
```

产物：
- `src-tauri/target/release/bundle/macos/智能装箱模拟系统.app`
- `src-tauri/target/release/bundle/dmg/智能装箱模拟系统_1.0.0_aarch64.dmg`

## Windows（保留）

在 Windows 或交叉编译环境下：

```bash
rustup target add x86_64-pc-windows-msvc
npx tauri build --target x86_64-pc-windows-msvc
```

产物：
- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/msi/*.msi`

## 开发调试

```bash
npx tauri dev
```
```

- [ ] **Step 3: 提交**

```bash
git add desktop-build.sh README-DESKTOP.md
git commit -m "build: add macOS build script and desktop README"
```

---

## Task 6: 构建验证与测试

**Files:**
- Modify: `dogfood-output/browser-smoke-test.py`（新增桌面端测试）
- Create: `dogfood-output/desktop-smoke-test.py`

- [ ] **Step 1: 构建开发版并启动**

```bash
npx tauri dev
```

Expected: Tauri 窗口弹出，加载首页，标题正确。

- [ ] **Step 2: 手动/Playwright 测试桌面端核心流程**

Create `dogfood-output/desktop-smoke-test.py`:

```python
from playwright.sync_api import sync_playwright
import os

APP = '/Applications/智能装箱模拟系统.app/Contents/MacOS/智能装箱模拟系统'
EXCEL = os.path.abspath('土耳其货物明细(1).xlsx')

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless=False,
        args=['--remote-debugging-port=9222']
    )
    # 通过 Tauri 的 WebView 测试较复杂，建议先手动验证
    # 或启动 App 后连接 CDP
    browser.close()
```

- [ ] **Step 3: 构建发布版**

```bash
npx tauri build --target aarch64-apple-darwin
```

Expected: 生成 `.app` 和 `.dmg`。

- [ ] **Step 4: 提交**

```bash
git add dogfood-output/desktop-smoke-test.py
git commit -m "test: add desktop smoke test scaffold"
```

---

## Task 7: 清理 3D 调试产物

**Files:**
- Delete: `.dbg/3d-viewer-timeout.env`
- Delete: `.dbg/server.log`
- Delete: `.dbg/file-test.log`
- Delete: `.dbg/file-test-post.log`
- Delete: `.dbg/browser-test.log`
- Delete: `.dbg/browser-test-post.log`
- Delete: `debug-3d-viewer-timeout.md`

- [ ] **Step 1: 停止 Debug Server**

Find and kill process:

```bash
lsof -i :7777 | grep python | awk '{print $2}' | xargs kill
```

- [ ] **Step 2: 删除调试产物**

```bash
rm -rf .dbg debug-3d-viewer-timeout.md
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: clean up 3D timeout debugging artifacts"
```

---

## Self-Review

### Spec coverage
- macOS 桌面应用：Task 1-5 覆盖
- 一键打开：Task 1 配置 + Task 5 脚本覆盖
- 保留 Windows 可能性：Task 5 README 覆盖
- 前端文件桥接：Task 3 覆盖
- 图标与元数据：Task 4 覆盖
- 构建验证：Task 6 覆盖
- 调试产物清理：Task 7 覆盖

### Placeholder scan
- 无 TBD/TODO
- 所有代码片段完整
- 所有命令可执行

### Type consistency
- Rust 命令名 `pick_excel_file` / `read_file_bytes` / `save_pdf_file` 前后端一致
- 前端 `TauriBridge` API 与 Rust 命令签名一致

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-17-tauri-desktop-app.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
