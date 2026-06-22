# Debug Session: cargo-stacking-reimport

## 状态
[FIXED_PENDING_VERIFY]

## 问题描述
1. 锥体（Cone）在 3D 视图中未叠放到其他货物上，而是“悬空”摆放，不符合实际装箱逻辑。
2. 出现 6 件货物无法装载的警告。
3. 已导入过一次装箱单后，点击左下角“重新上传”再导入新文件失败。

## 环境
- macOS 桌面端 / 浏览器端
- 数据集：yantai-v2.xlsx（截图中的 14 件烟台箱单）

## 假设与验证
1. **堆叠逻辑假设**： packing-engine 的 `findBestPlacement` 未校验 `z > 0` 时下方是否有实体支撑。
   - **验证**：代码确认 `findBestPlacement` 只检查 EMS 空间尺寸，未检查支撑面。已添加 `calcSupportRatio` 与 `minSupport = 0.7` 校验。
2. **货物分类假设**： 40FR 超长规则未导致截图中大量未装载。
   - **验证**：用 yantai-v2 数据跑当前逻辑，得到 4 箱（3×40HQ + 1×40FR），14 件全部装载，无未装载。截图中的 5 箱/6 未装载应为旧版本 bug。
3. **算法空间利用假设**： 当前算法对 yantai-v2 能完成装载，暂不调整。
4. **重导入状态假设**： “重新上传”按钮只重置了部分 state，且 Tauri 文件读取用了 `new Uint8Array(bytes).buffer`，未做错误处理。
   - **验证**：已添加 try/catch、安全的 ArrayBuffer 转换（`slice().buffer`），并清理 3D 视图、克隆重置 file input。
5. **重量解析假设**： 原代码把“净重”也映射到 `grossWeight`，导致载荷计算用净重而非毛重。
   - **验证**：已把“净重”移回 `netWeight`，并改为优先使用 `grossWeight`。

## 修复内容
- `field-parser.js`：分离 `grossWeight` 与 `netWeight` 关键词，优先使用毛重。
- `packing-engine.js`：在 `findBestPlacement` 中加入底面支撑覆盖率检查（≥70%），禁止悬空放置。
- `app.js`：
  - Tauri 文件选择/读取增加 try/catch 与错误提示；
  - 使用 `Uint8Array.slice().buffer` 安全转换文件内容；
  - “重新上传”时清理 3D 视图、清空结果容器、克隆并重绑 file input。

## 测试结果
- `node dogfood-output/run-core-tests.js`：全部通过。
- `node debug-yantai-v2.js`：14 件全部装载，4 箱，无悬空（支撑覆盖率 100%）。
- 桌面端 `.app` 已重新构建成功。

## 待用户确认
请用新生成的 `.app` 导入 `yantai-v2.xlsx` 验证：
1. 推荐是否为 4 箱（3×40HQ + 1×40FR）。
2. 是否还有“悬空”货物。
3. 点击“重新上传”后能否正常导入另一个文件。
