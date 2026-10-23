# C4 修复报告 — 2026-10-21（45HQ vs 40FR 分档落地）

> **背景**：C3 遗留的复审 P2-①（45HQ 未纳入单件分类）此前因与「13m→40FR」口径冲突被挂起待拍板。
> 爹地 2026-10-21 给出分档结论（12–13m 可 45HQ 优先；13–13.5m 边缘；>13.5m 锁 40FR；40FR 悬挑覆盖 14–16m）。
> 本批按该分档实现并验证。
> **结论**：分档全部落地；回归 **21/21 套件全绿**；E2E 4 场景通过（13m→45HQ、14m→40FR 悬挑、16.5m 拒装、真实单 14/14）。

---

## 一、落地口径（爹地 2026-10-21 分档）

| 最长边 | 推荐 | 判定要点 |
|---|---|---|
| ≤12.0m（40HQ 有效内长 11.982m 内） | 40HQ | 不推 45HQ/FR |
| 12.0–13.0m，单件 ≤20t | **45HQ 优先** | 内长 13.556m，比 40FR 便宜、免 OOG 超限审批 |
| 13.0–13.5m | **45HQ（边缘档）** | 余量 <0.56m：提示核实实际箱号内长/吊点法兰外扩，并给 40FR 备选 |
| 13.5–14.652m | **40FR** | 贴端悬挑，每端 ≤1.5m 属常规超限 |
| 14.652–16m | 40FR（特批档） | 每端悬挑 >1.5m，需船司特批/超限审批 |
| >16m | 无法装载 | 需特种运输 |
| 单件 >20t（任意长度档） | 40FR | 45HQ 船司常限约 26t，规划按 20t 留余量 |

## 二、实现点

- `container-db.js`
  - 新常量（单一来源，全部导出）：`HQ45_MAX_CARGO_LENGTH_M=13.5`、`HQ45_EDGE_MIN_LENGTH_M=13.0`、
    `HQ45_MAX_ITEM_WEIGHT_KG=20000`、`FR_ROUTINE_PER_END_M=1.5`、`FR_TOTAL_LENGTH_CEILING_M=16`。
  - `classifyItemByContainerType`：分类阶梯 `20GP → 40HQ → 45HQ（≤13.5m）→ OT → FR（≤16m）→ none`（45HQ 在 40HQ 之后、OT 之前）。
  - `recommendContainer`：`needs45HQ` 分支——12–13m 走「更经济/免 OOG」文案；13–13.5m 走「余量仅约 X m + 绑扎吃紧 + 40FR 备选」文案；
    超重（>20t）/尺寸不足回退 40FR 并说明原因。FR 分支文案改为按悬挑分档（常规/特批）输出每端悬挑米数。
  - `checkFRLengthRule`：返回 `{tier, requiresApproval}`；>16m → `frAllowed:false` + 明确警告。
  - `frLengthLimit`（40FR）= 16m 硬上限；新增 `frRoutineLengthLimit`（14.652m）供文案/校验复用。
  - 附：合入 worker 提案中的 `buildPromotionReasoning` 纯函数（推荐文案分档生成，原 P2-5 修复的共享实现，备用）。

## 三、验证

- **回归**：`node scripts/test-all.js` → **21/21 全绿**（新增 `test-regressions-c4.js`：5 通过 / 41 断言，含分档矩阵、重量门槛、超宽回退、引擎实装、常量契约）。
- **E2E**（`docs/audit-2026-10-13/probes/cls-e2e-smoke5.py`，截图 A5/D5/E5/F5）：
  - A5 真实单：推荐 45HQ×4（原 40HQ×4+40FR×1），实算 5 箱 / **14/14 全装** / 60.48t；
  - D5 13m：推荐 **45HQ**，文案「可平放装入——较 40FR 更经济，且无需超限（OOG）审批」；
  - E5 14m：推荐 **40FR**，文案「贴端悬挑，每端约 1.17m，属常规超限」；
  - F5 16.5m：**警告无法装载该货物**（40FR 悬挑覆盖至 16m）；
  - console 0 错误、Worker 0 回退。
- 引擎实装：12.5/13.5m → 45HQ 单箱装入；14/15/16m → 40FR 装入且带 `overLength` 标记；16.2m → 0。

## 四、已知边界/风险（用户需知）

1. **45HQ 箱源与目的港拖车**：45 尺柜不是所有航线/港口都有，拖车也可能不收——App 只能提示「确认航线 45HQ 箱源」，实际订舱需人工确认。
2. **13.0–13.5m 绑扎余量**：45HQ 内长 13.556m 是标称值，不同箱厂差几厘米；货端绑扎/楔块需 5–10cm，13.4m 以上余量已很紧——App 已提示核实实际箱号内长。
3. **40FR 装载长度口径**：本系统按柱间长 11.652m 计（悬挑从柱间算起）；行业也有按底板 11.78m 计的说法，差约 13cm。当前取更保守口径，若需按底板计可一行调整。
4. **40FR 悬挑上限 16m**：按「每端 ≤1.5m 常规、再长需船司特批」实现为 14.652m 常规 / 14.652–16m 特批提示 / >16m 拒装；如实际业务上限不同，改 `FR_TOTAL_LENGTH_CEILING_M` 一个常量即可。
5. **40HQ 12.0m 边界**：40HQ 有效内长 11.982m（扣 5cm 操作间隙），12.0m 整的货会落进 45HQ 档；这是操作间隙的必然结果。

## 五、改动文件

- `container-db.js`（分档常量、classify、recommend、checkFRLengthRule、frLengthLimit/frRoutineLengthLimit、导出）
- `scripts/test-regressions-c4.js`（新）、`scripts/test-all.js`（注册）
- `scripts/test-regressions-c1.js` / `c2.js`（旧口径断言更新：13m 改 45HQ、14m 改 40FR 悬挑、警告用例改 16.2m）
- `docs/container-loading-operation-spec.md`（变更 11，变更 5 标注被覆盖）
- 截图：`docs/audit-2026-10-13/cls-e2e-{A5,D5,E5,F5}.png`；探针：`probes/cls-e2e-smoke5.py`

---

*报告人：Hermes（婉宜）· 2026-10-21 · commit 见 git log `feat(C4)`*
