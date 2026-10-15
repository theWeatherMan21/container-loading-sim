# C1 修复报告 — 2026-10-13（双轨审阅后第一批修复 + FR 口径变更）

> **范围**：合并总账 `docs/REVIEW-MERGED-2026-10-13.md` 中第一批无争议项 + 爹地拍板的 FR 口径变更。
> **结论**：全量回归 **18/18 套件通过（EXIT=0）**；E2E 3 场景复验通过；证据脚本可原样重跑。

---

## 一、FR 业务口径变更（爹地拍板）

> 原话：「FR系列的集装箱，不要再设置尺寸限制，默认都可以装就行了」

**新口径：FR 系列（20FR/40FR）不再设置任何尺寸限制，任何尺寸的货物默认视为可装。**

落地实现：
- **废除** `FR_REALITY_LIMITS`（原超长 +0.5m / 超宽 +2.0m / 超高 +1.0m 预算）。
- **物理底线**（两条，缺一不可）：
  1. 贴角放置地板覆盖率 ≥ 50%（`FR_MIN_FLOOR_RATIO`；`frOrientationFloorRatio` / `frFloorFeasible`，6 朝向取最优）；
  2. 不与已放货物重叠（`collidesWithPlaced` AABB 检查，EPS 口径）。
- 超长货贴端装载、可伸出端壁（`overLength` 标记，3D 可视区分）。
- 数值护栏 `FR_FREE_DIM = 1000`（防 Infinity/NaN 传播，非业务限制）。
- 30m 级超限（任何朝向覆盖率 < 50%）仍正确拒绝。

**边界现象（爹地知情用）**：细长货（如 13m 管束）在**自由旋转**下会被"竖放"装进更小的 FR（20FR，伸出+竖立）；
如需强制平放装 40FR，货物配置勾选「**仅可水平旋转**」即可——已实测：13m 货 fixed-horizontal → 推荐 40FR、实算平放装成（overLength=true）。

## 二、修复清单（第一批）

| # | 问题（审阅编号） | 修复点 | 验证 |
|---|---|---|---|
| 1 | P0-1 英文标准表头（Net/Gross/L/W/H）列识别错乱，假尺寸、重量全 0 | `field-parser.js`：表头词典（Gross/Net 等）+ IGNORE_HEADERS + 两阶段列分配（明确匹配优先于推测匹配） | C1-HEADER / C1-HEADER2；E2E A3 真实单 60476kg 正确解析 |
| 2 | P0-2 Planner 无限循环 OOM（"名义高>箱高、可放倒"货，1 秒耗尽 64MB） | `planner.js`：建组条件与加入检查同口径 + 熔断 `RETRY_LIMIT=2`（超限转 unassigned，诚实上报>死循环）；层高保持保守 `item.h`（维护 C-N1 防线） | C1-OOM；原复现脚本 `probe9.js repro` 不再崩 |
| 3 | P0-3 相邻全等数据行被静默删除（25→15 件） | `field-parser.js` + `app.js`（两处）：去重语义改为"仅删重复**表头**行"，逐字相同数据行必须保留 | C1-DEDUP（1+1+5 全保留） |
| 4 | P0-4 `tolerance=0` 被 falsy 默认吞成 0.05 | `packing-engine.js`：`options.tolerance == null ? 0.05 : Number(...)` | C1-TOL0（0/0.01/0.05 三档对照）；`cls-verify-tol0.js` |
| 5 | P1-1 30t 单件推荐"20GP×2"（物理不可行） | `container-db.js`：单件超普柜载重 → 走 40FR 推荐链；混推组同步（超重货并入 FR 组）；文案更新 | C1-REC；E2E C3（推荐 40FR → 实算 1 箱装入） |
| 6 | UI 死锁：混合勾选被重置 / 按钮 disabled / 失败无去处 | `app.js`：`ensureCalculateButton` 三处补齐 + 混合面板就地显示 | E2E A3（勾选保持 useMixed=true、按钮可用、5 箱全装） |
| 7 | 文案：无重量列谎称"体积估算" | 改为「所有货物按 0kg 处理，**载重校验不会生效**」 | C1-MSG |

**未动（第二批待爹地拍板）**：FR payload 口径（27.5t/39.6t vs 官方 31.26t/44.05t）、6 向翻转默认（2.6m 高货横放）、皮重+VGM 输出、性能拐点（万件级）。

## 三、验证证据

### 回归（全量）
```
node scripts/test-all.js  →  ✅ 全部 18 个测试套件通过（EXIT=0）
```
- 新增 `scripts/test-regressions-c1.js`：**11 通过 / 0 失败**（30 条断言），固化本轮全部修复。
- 更新 3 处锁旧口径断言：`test-regressions-p2.js`（C-02 FR 口径）、`test-all-scenarios.js`（FR 超高）、`test-calculation-regressions.js`（fallback 用"三边均超地板宽两倍"立方体确保真不可装）。

### E2E（headless · 脚本 `docs/audit-2026-10-13/probes/cls-e2e-smoke3.py`）
| 场景 | 修复前 | 修复后 |
|---|---|---|
| A3 真实测试单（14 件） | 假尺寸、0kg、UI 死锁 | 自动推荐 40HQ×4+40FR×1 → **5 箱 14/14 全装、60.48t、无异常** |
| C3 30t 重货 | 推荐 20GP×2 → 算 0 箱 | 推荐 40FR → **1 箱装入** |
| D3 13m 超长货 | 分类 FR 但装不了 | **全链路装成**（1 箱） |

截图：`docs/audit-2026-10-13/cls-e2e-A3-fixed.png` / `cls-e2e-C3-fixed.png` / `cls-e2e-D3-fixed.png`（已归档同目录）。

### 可重跑命令
```bash
# 回归
node scripts/test-all.js
# E2E（需先起 http server）
python3 -m http.server 8377 --bind 127.0.0.1 &
python3 docs/audit-2026-10-13/probes/cls-e2e-smoke3.py
# 引擎级
node docs/audit-2026-10-13/probes/cls-fr-smoke.js
node docs/audit-2026-10-13/probes/cls-verify-rec.js
```

### 改动文件清单
- 源码：`container-db.js`、`packing-engine.js`、`planner.js`、`field-parser.js`、`app.js`
- 测试：`scripts/test-regressions-c1.js`（新增）、`scripts/test-all.js`、`scripts/test-all-scenarios.js`、`scripts/test-calculation-regressions.js`、`scripts/test-regressions-p2.js`
- 文档：`docs/container-loading-operation-spec.md`（FR 口径 + 变更记录）

---

*报告人：Hermes（婉宜）· 2026-10-13 · 对应 commit：见 git log `fix(C1)`*
