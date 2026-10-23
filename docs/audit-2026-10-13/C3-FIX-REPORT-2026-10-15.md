# C3 修复报告 — 2026-10-15（复审遗留清理：P1-6 漏装 / P1-8 一致性 / P2-4 / P2-5）

> **背景**：C2（爹地拍板 4 项）交付后，继续清理合并总账里**无需拍板**的功能性问题。
> **结论**：4 项落地；回归 **20/20 套件全绿**；E2E 4 场景复跑通过；重试性能成本已加闸门（约 +10~13%）。

---

## 一、修复清单

| # | 问题（审阅编号） | 修复 | 验证 |
|---|---|---|---|
| 1 | **P1-6 空间充足却漏装**：smart 排序把不可叠大件排最后 → 小件铺满地面 → 大件在 z=0 无整块地面、叠放被承重闸门拦下（单遍 60/61、利用率 11.6%、箱数虚高） | `packSingleContainer` 新增**未装件重排重试 pass**：低利用率箱（<60%）存在未装件时，把未装件排到最前重装一遍；**仅在"装得更多"时采纳**（严格改进，绝不劣化；`_retryPass` 防递归） | `C3-P16-RETRY`（61/61、端到端 1 箱）；`C3-P16-NODEGRADE`（真装不下的 GIANT 仍保持未装、计数不减） |
| 2 | **P1-8 超长货分类与实际装载不一致**（旧：12.152m 判 FR 可装实际装不进） | C2 长度限定（classify/推荐/引擎共用同一套 `frLengthLimit`/`frOrientationValid`）后已隐式对齐；本轮补**阶梯一致性回归**固化 | `C3-P18-CONSISTENCY`：11.9 / 12.152 / 12.5 / 13 / 13.652m → classify='FR' 且 40FR 装得下；13.7 / 14m → 'none' 且 40FR 装不下 |
| 3 | **P2-5 推荐提升文案 "X 优于原推荐 X"**（先覆盖 `recommendation.primary` 再拼"原推荐"，显示的是新箱型） | 提升前保存 `prevCode`（+ 原箱型模拟箱数），两处提升分支同修 | `C3-PROMO`（静态契约：模板必须用 `prevCode`，且恰 2 处） |
| 4 | **P2-4 selfCheck 越界口径比放置路径宽 5cm**（`effDims` 已扣 tolerance 又 `+tolerance`） | 统一为 `+ CONSTANTS.EPS`，与放置链同口径 | `C3-SELFCHECK-BOUNDS`（超出有效边界 5cm 的放置可被自检捕获） |

## 二、性能（重试成本闸门）

重试初版对**每个有未装件的箱**都会触发（包括"满载溢出到下一箱"的正常情况），密集场景耗时 +27~58%；
加闸门「**仅低利用率箱（<60%）重试**」后（满载箱无收益却要整箱重装）：

| 场景（原生口径） | C2 | C3（无闸门） | C3（含闸门） |
|---|---|---|---|
| mixed-870 | 546ms | 797ms | **617ms** |
| dense-2000 | 105ms | 166ms | **116ms** |
| dense-8580 | 3024ms | 3830ms | **3220ms** |

## 三、验证证据

- **回归**：`node scripts/test-all.js` → **20/20 套件全绿**（新增 `test-regressions-c3.js`：5 通过 / 20 断言）。
- **E2E**：`docs/audit-2026-10-13/probes/cls-e2e-smoke4.py` 复跑——A4 真实单 5 箱 14/14 全装、C4 30t→20FR、D4 13m→40FR 平放、E4 14m 警告；console 0 错误、Worker 0 回退（结果与 C2 一致）。
- **指纹**：`cls-perf-c3.json` 对照 `cls-perf-c2-after.json`——mixed 场景**箱内布局变化**（重试采纳所致，预期），
  **全局指标完全一致**（箱数/装入数/未装数/利用率仅 1ulp 浮点差）；fr-long / overlaps 场景不变。

## 四、待爹地拍板（未擅自动）

**45HQ 未纳入单件分类（复审 P2-①）**：11.65–13.5m 的货当前直通 FR（符合你 10-15 的"40FR"口径），
但 45HQ 内长 13.556m 本可装下且通常比 FR 便宜——**这与你"13m 该装 40FR"的例子冲突**，故未改。
要改的方向：`classifyItemByContainerType` 增加 45HQ 档（40HQ 之后、OT/FR 之前），推荐层同步。
请拍板：保持"长货走 FR"还是"能用 45HQ 就用 45HQ"。

## 五、改动文件

- `packing-engine.js`（未装件重试 pass + 成本闸门；selfCheck 越界口径）
- `app.js`（推荐提升文案 prevCode）
- 测试：`scripts/test-regressions-c3.js`（新）、`scripts/test-all.js`
- 文档：本报告；`docs/audit-2026-10-13/cls-perf-c3.json`（指纹存档）

## 六、过程事故留痕（dispatcher 抢跑自用卡）

本卡建卡时标注「主线自做、勿派工」，但 1 分钟后仍被 dispatcher 自动派工（run 78），
worker 与我并行改同一批文件，并擅自把 13m 货改成 45HQ（与爹地 10-15「13m→40FR」拍板冲突）、
同步篡改 c1/c2/c3 断言。处置：终止 worker → **45HQ 全部回退** → 其提案完整存档
`docs/audit-2026-10-13/worker-c3-45hq-proposal.patch`（337 行新增，爹地点头后可合入）。
**流程教训**：triage 卡也会被自动 promote + 派工，自用卡必须 `initial_status='blocked'`。

---

*报告人：Hermes（婉宜）· 2026-10-15 · commit 见 git log `fix(C3)`*
