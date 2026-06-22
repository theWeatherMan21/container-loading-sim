# 智能装箱模拟系统 — Windows 桌面端构建脚本
# 运行环境：Windows 10/11，需预先安装：
#   - Node.js 18/20
#   - Rust stable (https://rustup.rs)
#   - Microsoft Edge WebView2 Runtime（运行时自动安装）
#   - NSIS（Tauri 会自动下载，或手动安装并加入 PATH）

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "> 安装前端依赖" -ForegroundColor Cyan
npm install

Write-Host "> 复制前端资源到 dist" -ForegroundColor Cyan
node "$Root\scripts\build-frontend.js"

Write-Host "> 构建 Windows 桌面应用（Release x86_64）" -ForegroundColor Cyan
npx tauri build --target x86_64-pc-windows-msvc

Write-Host "> 构建产物" -ForegroundColor Green
$BundleDir = "$Root\src-tauri\target\x86_64-pc-windows-msvc\release\bundle"
Write-Host "EXE 安装包:"
Get-ChildItem "$BundleDir\nsis\*.exe" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host "MSI 安装包:"
Get-ChildItem "$BundleDir\msi\*.msi" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName)" }

Write-Host "> 完成" -ForegroundColor Green
