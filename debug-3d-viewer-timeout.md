# Debug: 3D 模块加载超时

**Session ID:** 3d-viewer-timeout  
**Status:** [OPEN]  
**Symptom:** Step 4 3D 视图区域显示“3D 模块加载超时，请刷新页面重试”，同时右侧出现箱 3/箱 4 低利用率警告。  
**Environment:** macOS, 本地 file:// 打开 index.html, Chrome/Safari  

## Hypotheses

1. **H1 — ES module 加载失败：** `three-viewer.js` 或 `three.module.js` / `OrbitControls.js` 未能成功加载，导致 `window.ThreeViewer` 不存在。
2. **H2 — Module 执行报错：** Three.js 模块或 three-viewer.js 执行时抛出异常，导致 `window.ThreeViewer` 赋值未完成。
3. **H3 — 加载超时阈值过短：** 用户本地磁盘/网络慢，10 秒（20×500ms）不足以加载 Three.js 大文件。
4. **H4 — file:// 协议限制：** ES module + import map 在 file:// 协议下被浏览器安全策略拦截。
5. **H5 — 3D 容器尺寸/渲染异常：** ThreeViewer 实际已加载但 buildVisualization 内部抛错，被外层 catch 吞掉后仍显示超时（但截图显示“超时”而非 catch 错误文案，可能性低）。

## Evidence

| 协议 | ThreeViewer 加载 | 3D 渲染 | 结论 |
|---|---|---|---|
| `http://localhost:8080` | ✅ 约 500ms 内成功 | ✅ 正常 | H1/H2/H3 不成立 |
| `file:///...index.html` | ❌ 25 次轮询始终为 `false` | ❌ 显示“加载中/超时” | H4 成立 |

关键日志：
- `instrumentation-boot` 记录到两种协议 `http:` 与 `file:`。
- `http:` 下 `threeviewer-poll` 第 1 次即 `hasThreeViewer: true`。
- `file:` 下全部 25 次 `hasThreeViewer: false`，且无 `window-error` / `unhandledrejection` 事件——说明 ES module 被浏览器安全策略静默拦截，未执行到 `window.ThreeViewer = {...}`。

## Root Cause

`three-viewer.js` 以 `<script type="module">` 加载，并依赖 `importmap` 解析 `three` 与 `three/addons/OrbitControls.js`。Chrome/Safari 在 `file://` 协议下对 ES Module 施加 CORS/同源限制，导致模块无法执行，因此 `window.ThreeViewer` 永远不会被赋值，最终触发“3D 模块加载超时”。

## Fix Applied

1. `app.js` 的 `renderThreeViewer` 超时分支现在调用 `render2DFallback()`。
2. `render2DFallback()`：
   - 检测 `location.protocol === 'file:'`，显示明确提示和 `python3 -m http.server 8080` 命令。
   - 为每个集装箱渲染 2D 装载俯视图（按比例展示货物位置、型号、利用率）。
3. 保留现有 ES module 3D 能力；HTTP 环境下仍自动使用 Three.js 3D 视图。

## Verification

| 场景 | 修复前 | 修复后 |
|---|---|---|
| `http://localhost:8080` | 3D 正常渲染 | 3D 正常渲染 ✅ |
| `file:///...index.html` | 3D 模块加载超时 | 显示 2D 装载示意图 + HTTP 提示 ✅ |

Playwright 端到端验证：
- `browser-smoke-test.py`（HTTP）：15/15 装箱，0 错误 ✅
- `browser-file-test.py`（file://）：15/15 装箱，0 错误，2D 降级视图正常 ✅

## Status

- [ ] 等待用户确认
- [ ] 清理调试产物（Debug Server、日志、`.dbg`）
