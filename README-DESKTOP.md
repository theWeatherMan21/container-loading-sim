# 智能装箱模拟系统 - 桌面端构建说明

## 技术方案

采用 [Tauri v2](https://tauri.app/) 封装现有前端：
- 前端：复用现有 HTML/CSS/JS（Three.js 3D、装箱算法等）
- 后端：Rust 提供原生文件对话框与文件读写
- 产物：macOS `.app` / `.dmg`，后续可扩展 Windows `.exe` / `.msi`

## 环境要求

- macOS 10.13+
- Node.js ≥ 18
- Rust（通过 rustup 安装）

## 安装依赖

```bash
npm install
```

## 开发调试

```bash
. "$HOME/.cargo/env"
npx tauri dev
```

## macOS 一键构建

```bash
./desktop-build.sh
```

构建完成后产物位于：

- App：`src-tauri/target/release/bundle/macos/智能装箱模拟系统.app`
- DMG：`src-tauri/target/release/bundle/dmg/智能装箱模拟系统_1.0.0_aarch64.dmg`

## 安装后打不开？

### macOS 提示「App is damaged and can't be opened」

这是因为应用尚未经过 Apple 公证，macOS Gatekeeper 拦截了从网上下载的未签名应用。**应用本身没有损坏**，按以下步骤即可运行：

1. 把 `/Applications/智能装箱模拟系统.app` 拖到废纸篓。
2. 重新从 `.dmg` 把应用拖进 `/Applications`。
3. 打开 Terminal，执行：
   ```bash
   xattr -cr /Applications/智能装箱模拟系统.app
   ```
4. 正常双击打开应用。

如需完全避免此提示，需要 Apple Developer Program 账号对应用进行签名和公证。

### Windows 提示「Windows 已保护你的电脑」/ Microsoft Defender SmartScreen

这是因为安装包未购买代码签名证书。点击提示上的「更多信息」→「仍要运行」即可继续安装使用。

如需完全避免此提示，需要购买 Windows 代码签名证书。

## Windows x86_64 版本（推荐）

当前开发机是 macOS ARM，不能在本机直接产出可运行的 Windows `.exe`：Tauri 的 Windows MSVC 链接器和 WebView2 打包环境需要 Windows runner。项目已提供 GitHub Actions 工作流，可在 Windows CI 上稳定构建 x86_64 安装包。

### 构建方式

1. 将当前代码提交并推送到 GitHub。
2. 打开仓库的 **Actions → Build Windows x86 Installer**。
3. 点击 **Run workflow**。
4. 构建完成后，从 workflow 的 **Artifacts** 下载 `windows-x86_64-installer`。
5. 其中 `nsis/*.exe` 是推荐的安装包；`msi/*.msi` 是企业部署格式。

也可以推送版本标签触发构建并自动附加到 GitHub Release：

```bash
git tag v1.1.1
git push origin v1.1.1
```

对应工作流文件：`.github/workflows/windows-x86.yml`。

### 本地 Windows 构建命令

在 Windows x86_64 或 x64 机器上执行：

```powershell
npm ci
rustup target add x86_64-pc-windows-msvc
npx tauri build --target x86_64-pc-windows-msvc
```

产物位于：

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi`

> 这里的“x86版本”按 Windows 常见命名约定解释为 `x86_64`（64位 Intel/AMD）。如果你实际需要 32位 Windows，则目标应改为 `i686-pc-windows-msvc`，但 Tauri 2/WebView2 生态和依赖兼容性会明显更差，需要单独验证。

## 文件结构

```
src-tauri/
  Cargo.toml          # Rust 依赖
  tauri.conf.json     # 应用配置
  capabilities/       # 权限声明
  src/
    lib.rs            # 后端命令
    main.rs           # 入口
  icons/              # 应用图标
app.js                # 前端：文件上传/PDF 导出桥接
tauri-plugin-bridge.js # Tauri 环境检测与 API 桥接
```
