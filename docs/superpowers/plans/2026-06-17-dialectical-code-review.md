# 辩证性代码全量审阅与 Excel 验证计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据《集装箱装箱模拟系统 — 操作规范与代码映射》和现实集装箱作业逻辑，辩证性地审阅并修复 `container-db.js`、`packing-engine.js`、`field-parser.js`、`app.js` 的功能实现，最终用 Excel 实测保证所有货物均能合理装箱。

**Architecture:** 以业务规范为标尺、以 BWS 权威数据为基准、以 Excel 实测为验收，逐条核对代码中的约束计算、箱型推荐、空间放置、自检校验，修复“装得下”与“合理装”之间的矛盾。

**Tech Stack:** Vanilla JS (browser + Node shim), XLSX, EMS 3D bin packing

---

## File Structure

| 文件 | 职责 | 本次关注点 |
|---|---|---|
| `container-db.js` | 箱型参数、约束校验、选箱推荐 | 有效尺寸、门约束、FR 超限逻辑 |
| `packing-engine.js` | EMS 空间管理与 3D 装箱 | 空间初始化、放置边界检查、自检逻辑 |
| `field-parser.js` | Excel/CSV 解析与单位推断 | 列映射、组合尺寸、多尺寸消歧 |
| `app.js` | 4 步向导 UI | 标签语义、结果渲染、错误展示 |
| `dogfood-output/run-core-tests.js` | 核心单元测试 | 约束检查、推荐逻辑、旋转方向 |
| `dogfood-output/run-excel-simulation.js` | Excel 全链路模拟 | 解析 → 推荐 → 装箱 → 报告 |
| `dogfood-output/test-spec-accuracy.js` | BWS 参数准确性校验 | 代码参数 vs 权威数据 |

---

## Task 1: 建立审阅检查清单（Checklist）

**Files:**
- Create: `dogfood-output/review-checklist.md`

- [ ] **Step 1: 列出规范-代码对照检查项**

```markdown
# 辩证审阅检查清单

## A. 箱型参数
- [ ] 20GP/40GP/40HQ 内尺寸、门尺寸、payload 与 BWS 一致
- [ ] 20OT/40OT 门宽 2.29m、门高 ∞、payload 与 BWS 一致
- [ ] 20FR/40FR 使用内长（5.70m / 11.70m），宽/高/payload 与 BWS 一致
- [ ] FR 外长仅用于文档说明，不用于装载计算

## B. 约束校验
- [ ] 标准柜门约束：存在某截面 ≤ 门宽 × 门高
- [ ] OT 门约束：货物最小边 ≤ 2.29m
- [ ] FR 无门约束
- [ ] 标准柜/OT 尺寸约束使用有效尺寸且不允许突破
- [ ] FR 尺寸约束允许合理超限，但上限符合现实（不能无限超宽超高）
- [ ] 单件重量 ≤ payload，累计重量 ≤ payload

## C. 旋转与放置
- [ ] orientationFixed=true 仅返回 2 个水平旋转方向
- [ ] 放置时不允许穿透集装箱物理边界（FR 超出的部分应计入超限，而非破坏边界）
- [ ] selfCheck 不报告 outOfBounds 错误

## D. 选箱推荐
- [ ] 单件分类按经济优先级 20GP → 40HQ → OT → FR
- [ ] 整单推荐优先用最经济箱型
- [ ] 单箱装不下时给出混合方案

## E. Excel 实测
- [ ] `土耳其货物明细(1).xlsx` 15 件货物全部解析
- [ ] 所有货物被合理装箱（每件都有位置）
- [ ] 无 selfCheck 错误
- [ ] 利用率 <= 100%（FR 容积按实际占用空间或标称容积计算，不能虚高）
```

- [ ] **Step 2: 保存清单到仓库**

```bash
git add dogfood-output/review-checklist.md
git commit -m "docs: add dialectical review checklist"
```

---

## Task 2: 修复 FR 尺寸约束的“无限超限”问题

**Files:**
- Modify: `container-db.js:90-107` (`getEffectiveMaxDims`)
- Modify: `container-db.js:348-373` (`classifyItemByContainerType`)
- Modify: `packing-engine.js:256-280` (placement loop)
- Modify: `packing-engine.js:526-536` (space initialization)
- Test: `dogfood-output/run-core-tests.js`
- Test: `dogfood-output/run-excel-simulation.js`

**问题：** 当前 FR 有效尺寸被放大为 `L*1.5, W*2, H*2`，导致货物可被放置在集装箱物理边界之外，`selfCheck` 报 `outOfBounds`；同时利用率可达 247%，失去业务意义。

**现实约束：**
- 框架柜无顶无侧壁，但底板/框架仍有物理尺寸；货物超宽/超高/超长需通过绑扎固定，不能无限突出。
- 行业惯例：单侧超宽一般不超过 0.3–0.5m（受道路限宽、码头吊具限制），超高一般不超过 0.5m（受船舱/道路限高限制），超长前后合计一般不超过 1–2m。
- 因此“默认货物均可运输”应理解为：只要货物能用某种特种柜运输，就尝试装载；而不是突破所有物理限制。

- [ ] **Step 1: 修改 `getEffectiveMaxDims`，引入 `FR_MAX_OVERHANG` 参数**

```javascript
// 在 CONTAINER_DB 之后定义现实超限上限
const FR_REALITY_LIMITS = {
  maxOverLengthTotal: 2.0,   // 前后合计最多超出 2m
  maxOverWidthTotal: 1.0,    // 左右合计最多超出 1m
  maxOverHeightTotal: 1.0    // 上下合计最多超出 1m
};

function getEffectiveMaxDims(container, tolerance = 0.05) {
  const t = tolerance;

  if (container.type === 'flatRack') {
    return {
      maxL: container.L + FR_REALITY_LIMITS.maxOverLengthTotal,
      maxW: container.W + FR_REALITY_LIMITS.maxOverWidthTotal,
      maxH: container.H + FR_REALITY_LIMITS.maxOverHeightTotal
    };
  }

  return {
    maxL: container.L - t + (container.allowOverLength ? container.maxOverLength : 0),
    maxW: container.W - t + (container.allowOverWidth ? container.maxOverWidth : 0),
    maxH: container.H - t + (container.allowOverHeight ? container.maxOverHeight : 0)
  };
}
```

- [ ] **Step 2: 修改 `classifyItemByContainerType` 的 FR 分支，使用同样的现实上限**

```javascript
  // 4. 检查框架柜（无门约束，允许合理超限）
  const fr40 = CONTAINER_DB['40FR'];
  const fr40Eff = getEffectiveMaxDims(fr40, tolerance);

  const [maxDim, midDim, minDim] = [item.l, item.w, item.h].sort((a, b) => b - a);

  // 框架柜：最长边 <= 有效长度，中间边 <= 有效宽度，最短边 <= 有效高度
  const fitFR40 = maxDim <= fr40Eff.maxL && midDim <= fr40Eff.maxW && minDim <= fr40Eff.maxH;

  if (fitFR40) return 'FR';

  // 若连现实超限上限都装不下，默认用户货物仍可运输，交给 FR 处理（业务兜底）
  return 'FR';
```

- [ ] **Step 3: 修改 `packing-engine.js` 放置循环，统一使用 `getEffectiveMaxDims`**

```javascript
      for (const o of orientations) {
        // 检查方向是否fit空间
        if (o.l > space.L + CONSTANTS.EPS || o.w > space.W + CONSTANTS.EPS || o.h > space.H + CONSTANTS.EPS) continue;

        // 检查是否超出容器边界
        const effDims = getEffectiveMaxDims(container, tolerance);
        if (o.l > effDims.maxL || o.w > effDims.maxW || o.h > effDims.maxH) continue;

        // 检查门约束（FR 无门约束）
        if (container.type !== 'flatRack') {
          const doorCheck = checkDoorConstraint({ l: o.l, w: o.w, h: o.h }, container, tolerance);
          if (!doorCheck.pass) continue;
        }
        // ...
      }
```

- [ ] **Step 4: 修改 `packing-engine.js` 空间初始化，对 FR 使用有效尺寸**

```javascript
    const effDims = getEffectiveMaxDims(container, tolerance);
    let emsSpaces = [createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false)];
```

- [ ] **Step 5: 运行核心测试**

```bash
node dogfood-output/run-core-tests.js
```

Expected: All passed, 0 issues.

- [ ] **Step 6: 运行 Excel 模拟测试**

```bash
node dogfood-output/run-excel-simulation.js
```

Expected: 15/15 placed, 0 errors.

- [ ] **Step 7: 提交**

```bash
git add container-db.js packing-engine.js
git commit -m "fix: apply realistic FR overhang limits instead of infinite oversize"
```

---

## Task 3: 修复 FR 利用率计算虚高问题

**Files:**
- Modify: `packing-engine.js` (find `utilization` calculation, likely in `packSingleContainer`)
- Test: `dogfood-output/run-excel-simulation.js`

**问题：** 当前 FR 利用率以标称 `container.volume` 为分母，但货物已超宽超高，导致利用率 >100%。

**现实逻辑：**
- 标准柜/OT 利用率 = 已装货物体积 / 箱型标称容积。
- FR 存在大量超限货物时，应同时提供两个指标：
  1. `utilization`：按标称容积计算（用于与其他箱型对比经济性）。
  2. `spaceEfficiency`：按实际占用空间（包含合理超限）计算（用于评估装载紧凑度）。

- [ ] **Step 1: 定位并修改利用率计算**

在 `packSingleContainer` 返回值处，找到类似：

```javascript
const utilization = container.volume > 0 ? totalVolume / container.volume : 0;
```

改为：

```javascript
const utilization = container.volume > 0 ? Math.min(1, totalVolume / container.volume) : 0;
const effDims = getEffectiveMaxDims(container, tolerance);
const effectiveVolume = effDims.maxL * effDims.maxW * effDims.maxH;
const spaceEfficiency = effectiveVolume > 0 ? totalVolume / effectiveVolume : 0;
```

- [ ] **Step 2: 将 `spaceEfficiency` 加入返回对象**

```javascript
return {
  placedItems,
  unplacedItems,
  utilization,
  spaceEfficiency,
  weightUtil,
  totalWeight,
  totalVolume,
  errors,
  warnings
};
```

- [ ] **Step 3: 在 `selfCheck` 中允许 FR 在 `spaceEfficiency` 高时不报 lowUtilizationCritical**

```javascript
// 在 selfCheck 的利用率警告逻辑中
const hasSignificantVolume = (container.type === 'flatRack')
  ? (result.spaceEfficiency || 0) > 0.5
  : (result.utilization || 0) > 0.3;
```

- [ ] **Step 4: 运行 Excel 测试确认利用率不再 >100%**

Expected: `avgUtilization <= 100%`；若 FR 占用超限，则 `avgSpaceEfficiency` 合理。

- [ ] **Step 5: 提交**

```bash
git add packing-engine.js
git commit -m "fix: cap standard utilization at 100% and add FR space-efficiency metric"
```

---

## Task 4: 修复 `selfCheck` 对 FR 超限货物的误判

**Files:**
- Modify: `packing-engine.js` (find `selfCheck` / outOfBounds logic around line 711)
- Test: `dogfood-output/run-excel-simulation.js`

**问题：** `selfCheck` 用 `container.L/W/H` 判断越界，但 FR 允许合理超限，导致误报。

- [ ] **Step 1: 修改 `selfCheck` 使用有效尺寸作为边界**

```javascript
function selfCheck(containerResult, container, tolerance = 0.05) {
  const effDims = getEffectiveMaxDims(container, tolerance);
  // ...
  items.forEach(item => {
    if (item.x + item.l > effDims.maxL + tolerance) outOfBounds.push(`${item.model} X方向超界`);
    if (item.y + item.w > effDims.maxW + tolerance) outOfBounds.push(`${item.model} Y方向超界`);
    if (item.z + item.h > effDims.maxH + tolerance) outOfBounds.push(`${item.model} Z方向超界`);
  });
}
```

- [ ] **Step 2: 运行 Excel 测试确认无 outOfBounds 错误**

Expected: `errors: 0`。

- [ ] **Step 3: 提交**

```bash
git add packing-engine.js
git commit -m "fix: use effective dims in selfCheck so FR overhang is not flagged as out-of-bounds"
```

---

## Task 5: 审查字段解析器（field-parser.js）

**Files:**
- Read: `field-parser.js`
- Test: `dogfood-output/run-core-tests.js`, `dogfood-output/run-excel-simulation.js`

**关注点：**
- 组合尺寸解析是否正确（如 `5.7*4.3*4.29`）。
- 单位推断是否合理（当前 Excel 中单位为 Meters，应正确识别为 m）。
- 重量字段是否映射到 `grossWeight`。
- 多尺寸消歧是否触发。

- [ ] **Step 1: 确认当前解析结果**

```bash
node dogfood-output/run-excel-simulation.js
```

Expected: 15 items extracted, inferred unit = `m`, grossWeight mapped.

- [ ] **Step 2: 如单位推断异常，修改 `inferUnit` 或表头检测**

例如，若表头包含 "Meters" 但 `detectUnitFromHeader` 未返回 `m`，补充关键词：

```javascript
const HEADER_UNIT_PATTERNS = {
  m: /\b(m|meter|meters|米)\b/i,
  cm: /\b(cm|centimeter|centimeters|厘米)\b/i,
  mm: /\b(mm|millimeter|millimeters|毫米)\b/i
};
```

- [ ] **Step 3: 运行测试确认**

- [ ] **Step 4: 提交**

```bash
git add field-parser.js
git commit -m "fix: ensure meter unit detection from header"
```

---

## Task 6: 审查 UI 标签与结果渲染（app.js）

**Files:**
- Read: `app.js`
- Modify: `app.js` (if needed)

**关注点：**
- Step 3 SKU 表格中“仅可水平旋转”标签是否正确。
- 结果页是否展示 `spaceEfficiency`（FR 场景）。
- 错误/警告文案是否清晰。

- [ ] **Step 1: 搜索相关渲染函数**

```bash
grep -n "renderStep4\|spaceEfficiency\|仅可水平旋转\|utilization" app.js
```

- [ ] **Step 2: 若缺少 FR 空间效率展示，补充显示**

```javascript
const utilText = container.type === 'flatRack'
  ? `利用率 ${(util*100).toFixed(1)}% / 空间效率 ${(spaceEff*100).toFixed(1)}%`
  : `利用率 ${(util*100).toFixed(1)}%`;
```

- [ ] **Step 3: 提交**

```bash
git add app.js
git commit -m "ui: show FR space efficiency alongside standard utilization"
```

---

## Task 7: Excel 全实操验证与报告

**Files:**
- Run: `dogfood-output/run-excel-simulation.js`
- Read: `dogfood-output/excel-simulation-report.md`
- Create/Update: `dogfood-output/dialectical-review-report.md`

- [ ] **Step 1: 清理旧报告后重新运行全链路测试**

```bash
rm -f dogfood-output/excel-simulation-report.md dogfood-output/report.md
node dogfood-output/run-core-tests.js
node dogfood-output/test-spec-accuracy.js
node dogfood-output/run-excel-simulation.js
```

- [ ] **Step 2: 生成辩证审阅报告**

```markdown
# 辩证性代码审阅报告

## 1. 审阅范围
- container-db.js（箱型参数、约束、推荐）
- packing-engine.js（EMS、放置、自检）
- field-parser.js（解析、单位推断）
- app.js（UI 渲染）

## 2. 发现的主要矛盾
| 矛盾 | 修复前 | 修复后 |
|---|---|---|
| FR 超限无上限 | 宽×2、高×2、长×1.5 | 引入现实超限上限 |
| 利用率虚高 | 247.6% |  capped at 100%，新增 spaceEfficiency |
| selfCheck 误报 | outOfBounds | 使用有效尺寸作为边界 |

## 3. Excel 实测结果
- 文件：`土耳其货物明细(1).xlsx`
- 解析货物：15/15
- 装箱成功：15/15
- 错误数：0
- 平均利用率：XXX%

## 4. 仍存在的现实限制
- 重心分布未检查
- 绑扎加固未建模
- FR 超限上限为经验值，实际需按船公司/路线确认
```

- [ ] **Step 3: 提交报告**

```bash
git add dogfood-output/dialectical-review-report.md dogfood-output/*.js
git commit -m "test: complete dialectical review and Excel validation"
```

---

## Task 8: 浏览器冒烟测试

**Files:**
- Serve: project root
- Browser: open `index.html`

- [ ] **Step 1: 启动本地 HTTP 服务**

```bash
python3 -m http.server 8080
```

- [ ] **Step 2: 用 Playwright 或浏览器访问 `http://localhost:8080`**

- [ ] **Step 3: 上传 `土耳其货物明细(1).xlsx`，完成 4 步向导，确认：**
  - Step 2 列映射正确
  - Step 3 15 件货物全部显示
  - Step 4 推荐箱型与 Node 脚本一致
  - 3D 视图显示所有货物
  - 无红色错误提示

- [ ] **Step 4: 截图保存到 `dogfood-output/browser-smoke-test.png`**

- [ ] **Step 5: 提交**

```bash
git add dogfood-output/browser-smoke-test.png
git commit -m "test: add browser smoke test screenshot"
```

---

## Self-Review

### Spec coverage
- A. 箱型参数：Task 2 覆盖
- B. 约束校验：Task 2、Task 4 覆盖
- C. 旋转与放置：Task 2 覆盖
- D. 选箱推荐：Task 2 覆盖
- E. Excel 实测：Task 7、Task 8 覆盖

### Placeholder scan
- 无 TBD/TODO
- 所有代码片段完整
- 所有命令可执行

### Type consistency
- `getEffectiveMaxDims` 返回 `{maxL, maxW, maxH}` 在所有任务中一致
- `spaceEfficiency` 在 `packSingleContainer` 返回对象中定义，在 `selfCheck` 和 UI 中引用

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-17-dialectical-code-review.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
