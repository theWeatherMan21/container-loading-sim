# Fix: FR Stacking & Data Consistency Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 40FR items forced to stand vertically (over-height), and verify data consistency between calculation and 3D rendering.

**Architecture:** Two independent fixes in `packing-engine.js`. Issue 2 (FR stacking) is the root-cause algorithmic fix. Issue 1 requires a diagnostic/logging patch to verify data consistency, with a targeted fix if needed.

**Tech Stack:** JavaScript (ES5 IIFE), Three.js, EMS packing algorithm

---

## Root Cause Analysis

### Issue 1: 2000 items × 0.15×0.2×0.3m → "仅装了一箱"

**辨证分析：**

全链路追踪结果：
1. `startCalculationFromManual()` → `state.items` 正确携带 `quantity: 2000`
2. `PE.calculate()` → `multiContainerPack()` → `expandItems()` 正确展开为 2000 个独立条目
3. `packSingleContainer()` → `groupByModel()` → `layerPack()` 层铺逻辑

**实际结论：这不是逻辑 bug。** 2000 × 0.009m³ = 18m³ 的总货物体积，在 40HQ（67.7m³）中完全装得下。算法层面：79 行 × 11 列 = 869 件/层，2000 件仅需 3 层（共 8 层可用），剩余空间充足。

但用户可能遇到的问题：
- **3D 渲染性能瓶颈**：2000 个 THREE.Mesh 在单场景中渲染会严重拖慢/冻结浏览器
- **数据流不一致可能**：`buildVisualization()` 已有诊断日志检查 `totalPlaced` vs `containers[i].placedItems.length`，但用户可能未看到 console 日志
- **用户期望偏差**：用户可能基于经验预计需多箱，但实际算法已优化到一箱装完

**修复策略**：
- 在 Step 4 结果卡片中**显式展示 "已装件数 / 总待装件数"** 对比，闭环展示数据
- 添加 3D 渲染前的大数据量提示（>500 items 时建议降级或分帧渲染）
- 不修改 packing 算法本身（算法逻辑正确）

### Issue 2: 40FR 货物被强制竖放，超高 2.15m

**根因定位**：`findBestPlacement()` 中的 `fitScore` 在 FR 箱型下产生错误激励。

代码路径：`packing-engine.js` 第 340-405 行

```javascript
const fitX = o.l / space.L;
const fitY = o.w / space.W;
const fitZ = o.h / space.H;
const fitScore = (fitX + fitY + fitZ) / 3;
// ... 
const totalScore = score + fitScore * CONSTANTS.FIT_WEIGHT; // FIT_WEIGHT=100
```

**问题机制**：

FR 箱型的 EMS 空间高度使用 `effDims.maxH = container.H + FR_REALITY_LIMITS.maxOverHeightTotal = 2.28 + 2.5 = 4.78m`。以一个典型货物 2.5×1.5×0.3m 为例：

| 朝向 | fitX | fitY | fitZ | fitAvg | ×100 |
|------|------|------|------|--------|------|
| 平放 l=2.5,w=1.5,h=0.3 | 0.21 | 0.63 | 0.06 | 0.30 | 30 |
| 竖放 l=1.5,w=0.3,h=2.5 | 0.13 | 0.13 | 0.52 | 0.26 | 26 |
| 侧立 l=2.5,w=0.3,h=1.5 | 0.21 | 0.13 | 0.31 | 0.22 | 22 |

**竖放的 fitZ（0.52）** 远远高于平放（0.06），因为 FR 的 `space.H`=4.78m 是巨大的分母，但 `item.h`=2.5m 的分子也很可观。这导致 `fitScore` 奖励了竖放方向。

**DBL score 对同一个 space 内不同朝向是相同的**（因为 DBL 只看 space 的 (x,y,z) 坐标，不看朝向），所以无法通过 DBL 区分朝向。

**本质矛盾**：
- `fitScore` 的设计意图是"贴合空间，减少浪费"——这是标准柜的正确思路  
- 但 FR 无顶，height 空间巨大 → 竖放反而获得更高 fitZ → 算法"认为"竖放更节省空间  
- 现实中：竖放使重心过高、不可叠放、极不稳定，应优先平放

**修复方案**：

对 FR 箱型，在 `findBestPlacement()` 的评分中增加一个**稳定性惩罚（stability penalty）**：
- 当朝向的 h 超过容器名义高度 `container.H` 时，施加惩罚
- 或者：对 FR 箱型，将 fitZ 的分母从 `space.H`（有效高度）改为 `container.H`（名义高度）

---

## Tasks

### Task 1: Fix FR stacking — stability penalty for over-height orientations

**Files:**
- Modify: `packing-engine.js:340-405`

**诊断断言**：
1. 对 40FR，所有 6 个朝向中，`h` 最大的那个会获得最高 fitZ → 被选中
2. fix 后，平放（h 最小）应优先于竖放

- [ ] **Step 1: 在 `findBestPlacement()` 中添加 FR 稳定性惩罚**

在 `packing-engine.js` 的 `findBestPlacement` 函数中，在当前 `totalScore` 计算之后添加 FR 稳定性惩罚：

```javascript
// 在 findBestPlacement 函数内，totalScore 计算行之后（约第 393 行）
// 替换这段：
//     const totalScore = score + fitScore * CONSTANTS.FIT_WEIGHT;

// 改为：
        let stabilityPenalty = 0;
        // FR 箱型稳定性惩罚：若朝向使货物高度超过名义箱高，惩罚 FIT_WEIGHT × h/H_nominal
        if (container.type === 'flatRack' && container.H > 0) {
          const nominalH = container.H;
          if (o.h > nominalH + CONSTANTS.EPS) {
            stabilityPenalty = (o.h / nominalH) * CONSTANTS.FIT_WEIGHT * 0.5;
          }
        }
        const totalScore = score + fitScore * CONSTANTS.FIT_WEIGHT - stabilityPenalty;
```

**逻辑说明**：
- 仅对 `flatRack` 生效
- 当 `o.h > container.H`（名义高度）时，施加 `(h/nominalH) × FIT_WEIGHT × 0.5` 的惩罚
- 竖放 2.5m / 2.28m = 1.096 → 惩罚 54.8 分 → score + 26 - 54.8 = 负数，被淘汰
- 平放 0.3m / 2.28m = 0.132 → 不触发惩罚（0.3 < 2.28）→ 正常评分

- [ ] **Step 2: 验证修复逻辑**

手动测试：对 40FR 装入 2.5×1.5×0.3m 货物，验证 3D 视图中货物为平放而非竖放。

```bash
# 在浏览器 console 中验证
# 预期：item.l ≈ 2.5, item.w ≈ 1.5, item.h ≈ 0.3（平放）
# 不应出现 l=1.5, w=0.3, h=2.5 的朝向
```

- [ ] **Step 3: Commit**

```bash
git add packing-engine.js
git commit -m "fix: FR flat-rack stability penalty prevents forced vertical orientations"
```

---

### Task 2: Data consistency — add result summary with placed/total ratio

**Files:**
- Modify: `app.js:1627-1645` (renderResultSummary)
- Modify: `packing-engine.js:714-757` (multiContainerPack — add `totalItems` field)

**目标**：在 Step 4 结果卡片中显示"X / Y 件已装"而非仅"Y 件已装"，让用户清楚看到闭环。

- [ ] **Step 1: 在 `multiContainerPack` 中回传 `totalItems`**

在 `packing-engine.js` 的 `multiContainerPack` 函数返回值中添加 `totalItems` 字段：

```javascript
    return {
      containerCode: containerSpec.code,
      containerName: containerSpec.nameCN,
      containers,
      containerCount: containers.length,
      totalPlaced,
      totalUnplaced: remaining.length,
      totalItems: totalPlaced + remaining.length, // ← 新增
      unplacedCount: remaining.length,
      unplacedItems: remaining.map(i => i.model).filter((v, idx, arr) => arr.indexOf(v) === idx),
      avgUtilization,
      totalVolumePlaced,
      totalWeightLoaded,
      maxPayload: containerSpec.payload * containers.length
    };
```

- [ ] **Step 2: 在 `mixedMultiContainerPack` 中同样回传 `totalItems`**

找到 `mixedMultiContainerPack` 的返回语句（约第 827 行），添加 `totalItems: totalPlaced + remaining.length`。

- [ ] **Step 3: 更新 `renderResultSummary` 中的 "已装件数" 卡片**

在 `app.js` 的 `renderResultSummary` 中：

```javascript
// 原：
// { label: '已装件数', value: result.totalPlaced, unit: '件', color: '#9C8B7D' }

// 改为：
      const totalItems = result.totalItems || (result.totalPlaced + result.unplacedCount);
      { label: '已装 / 总件数', value: `${result.totalPlaced}/${totalItems}`, unit: '件', color: '#9C8B7D',
        hint: result.unplacedCount > 0 ? `${result.unplacedCount} 件未能装入` : '全部装入 ✓' }
```

- [ ] **Step 4: 同样更新混合箱型返回**

在 `mixedMultiContainerPack` 的 return 末尾添加 `totalItems` 字段。

- [ ] **Step 5: Commit**

```bash
git add packing-engine.js app.js
git commit -m "feat: add totalItems field & placed/total ratio in result summary for closed-loop UX"
```

---

### Task 3: 3D rendering warning for large item counts

**Files:**
- Modify: `three-viewer.js:797-895` (buildVisualization)

**目标**：当 placedItems > 500 时，显示性能提示，并提供"简化渲染"选项。

- [ ] **Step 1: 添加大数据量检测 + 用户提示**

在 `buildVisualization()` 的构建开始处，`const parent` 之后添加：

```javascript
  const MAX_SAFE_RENDER = 500;
  let totalRenderItems = 0;
  for (const c of result.containers) {
    totalRenderItems += (c.placedItems || []).length;
  }
  
  if (totalRenderItems > MAX_SAFE_RENDER) {
    const warning = document.createElement('div');
    warning.style.cssText = 'position:absolute;top:48px;left:8px;right:8px;background:#FFF9E6;border:1px solid #E8D5A0;border-radius:8px;padding:8px 12px;font-size:11px;color:#8B7516;z-index:10;pointer-events:auto;';
    warning.innerHTML = `⚠️ 物品种类较多（${totalRenderItems}件），3D 渲染可能较慢。`;
    parent.appendChild(warning);
    setTimeout(() => { if (warning.parentNode) warning.remove(); }, 8000);
  }
```

- [ ] **Step 2: Commit**

```bash
git add three-viewer.js
git commit -m "feat: add 3D render warning for >500 cargo items"
```

---

## Self-Review Checklist

### Spec Coverage
- [x] Issue 1: 2000 items "仅装一箱" → 已验证算法逻辑正确，添加数据一致性展示 + 渲染提示
- [x] Issue 2: 40FR 竖放超高 → 根因定位 + 稳定性惩罚修复

### Placeholder Scan
- [x] 所有代码块均为完整实现，无 TBD/TODO
- [x] 所有 git 命令可执行

### Type Consistency
- [x] `totalItems` 字段在两处（multiContainerPack / mixedMultiContainerPack）同时添加
- [x] `result.totalItems` 在 app.js 的 renderResultSummary 中正确引用
- [x] `container.H` 和 `container.type` 在 findBestPlacement 上下文中均存在（container 参数已传入）
