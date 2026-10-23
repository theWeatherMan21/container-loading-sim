#!/bin/bash
set -e

# 智能装箱模拟系统 - macOS 桌面端构建脚本
# 产物：.app 与 .dmg

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> 安装前端依赖"
npm install

echo "==> 复制前端资源到 dist"
node scripts/build-frontend.js

echo "==> 构建 macOS 桌面应用（Release）"
. "$HOME/.cargo/env"
npx tauri build --target aarch64-apple-darwin

echo "==> 构建产物"
BUNDLE_DIR="src-tauri/target/aarch64-apple-darwin/release/bundle"
echo "App: ${BUNDLE_DIR}/macos/"
ls -la "${BUNDLE_DIR}/macos/"
echo "DMG: ${BUNDLE_DIR}/dmg/"
ls -la "${BUNDLE_DIR}/dmg/" 2>/dev/null || echo "（未生成 DMG，请在 tauri.conf.json 中将 dmg 加入 targets）"

echo "==> 完成"
