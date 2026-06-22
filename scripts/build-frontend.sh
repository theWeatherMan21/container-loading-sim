#!/bin/bash
set -e

# 将前端静态资源复制到 dist 目录，供 Tauri 打包

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
DIST="$ROOT/dist"

mkdir -p "$DIST"
rm -rf "$DIST"/*

# 复制根目录前端文件
cp "$ROOT/index.html" "$DIST/"
cp "$ROOT/styles.css" "$DIST/"
cp "$ROOT/app.js" "$DIST/"
cp "$ROOT/field-parser.js" "$DIST/"
cp "$ROOT/container-db.js" "$DIST/"
cp "$ROOT/packing-engine.js" "$DIST/"
cp "$ROOT/three-viewer.js" "$DIST/"
cp "$ROOT/pdf-exporter.js" "$DIST/"
cp "$ROOT/tauri-plugin-bridge.js" "$DIST/"

# 复制子目录
if [ -d "$ROOT/vendor" ]; then
  cp -R "$ROOT/vendor" "$DIST/"
fi

echo "Frontend copied to $DIST"
