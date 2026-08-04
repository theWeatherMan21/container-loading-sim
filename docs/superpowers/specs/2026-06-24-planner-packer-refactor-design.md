# Planner + Packer 两阶段架构重构设计

**日期**: 2026-06-24  
**状态**: 待审批  
**关联**: P1-P8 根因分析 → 修复方案

---

## 1. 动机

当前 `mixedMultiContainerPack` 将"分配"和"放置"两个职责耦合在一条贪心链中：

```
排序 → EMS逐件放置 → 满箱 → 下一箱
```

根因：重型不可叠货物排在前面 → 被 `blockedAbove` 封锁上方空间 → 可叠轻货永无机会。

多轮补丁（smart排序、自适应切换、承重检查）均为参数级修复，未触及架构层根因。

人类装箱思维是**全局同步**的：先看大件需要什么柜型、小件能否聚合成一箱、所有条件同时成立——没有"先装大件再看小件"的顺序。

本次重构目标：**解耦分配与放置**，让分配层做全局约束分析，放置层仅负责给定一组货物在单箱内的 3D 摆放。

---

## 2. 新架构

```
┌──────────────┐    分组     ┌──────────────┐   逐箱试装   ┌──────────────┐
│  所有货物     │ ────────→ │   Planner     │ ──────────→ │   Packer     │
│  + 可用箱型   │           │  (分配层)     │ ←────────── │  (放置层)    │
└──────────────┘           └──────────────┘   反馈修订    └──────────────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │  装箱方案     │
                          │ [{箱型, 货物}]│
                          └──────────────┘
```

### 2.1 Planner（新模块）

**职责**：将货物清单分组并分配到具体的集装箱。

**输入**：
- 货物列表（含尺寸、重量、可叠性、数量）
- 可用箱型列表
- 用户约束（未来扩展）

**输出**：
- `[{ containerCode, items: [{model, l, w, h, weight, quantity, stackable}] }]`

**核心规则（按优先级）**：

| 优先级 | 规则 | 说明 |
|--------|------|------|
| 1 | 尺寸硬约束 | 货物最长边 > 箱型内容积 → 该货不可入此箱型 |
| 2 | 门约束 | 货物截面 > 门开口 → 不可入 |
| 3 | 载重约束 | 分配后总重 > 箱型载重 → 拆分成多箱 |
| 4 | 超限货物 → 独占 | 超门高/超门宽/超门深 → 该货物必须独占一个 OT/FR |
| 5 | 重型不可叠 → 先保障地板 | weight ≥ 1000kg 或 maxDim ≥ 2.0m 且不可叠 → 优先分配，保证每箱有足够地板面积 |
| 6 | 同类型货聚合 | 同 stackable 属性的可叠货尽量放入同一箱，减少异构 |
| 7 | 体积/重量双约束 | 分配后总体积 < 箱型内容积 × 0.92，总重 < 箱型载重 |

**与 Packer 的交互**：

```
Planner 分配 v1 → Packer 逐箱试装 → 某箱利用率 < 60% 且有未装货
  → Planner 收到反馈："箱2装不下全部纸箱，剩余50件"
  → Planner 修订：增加一箱或合并到邻近组
  → Planner 分配 v2 → Packer 再试
  → 收敛或达到最大迭代次数（3轮）
```

### 2.2 Packer（保留现有 EMS，接口契约化）

**职责**：给定一组货物和一个箱型，输出这些货物的 3D 坐标。

**接口**：
```javascript
packSingleContainer(items, containerSpec, { sortStrategy, tolerance }) → {
  packedItems: [{ model, l, w, h, weight, x, y, z, orientation, stackable }],
  unplacedItems: [{ model, l, w, h, weight, quantity, stackable }],
  utilization: { volume, weight },
  emsSpaces: []
}
```

**保留不变**：
- `packSingleContainer` 的 EMS + DBL 评分 + 层铺混合算法
- `selfCheck` / `recalibrate` 自检闭环
- `sortItems`（smart 策略保留）
- `checkWeightBearing` 承重检查
- `blockedAbove` 逻辑

**不再暴露**：`mixedMultiContainerPack` 保留作为兼容入口，内部委托给 Planner + 循环调用 Packer。

### 2.3 向后兼容

现有 `window.PackingEngine.calculate()` 接口行为不变：
- `options.mixedContainers` 存在时 → 走 Planner + Packer 新路径
- `options.mixedContainers` 不存在时 → 保持原有 `multiContainerPack` 行为
- `recommendMixedContainers`（在 container-db.js）→ 保持不变，仅调用下游变更

---

## 3. 不变的部分

| 模块 | 状态 |
|------|------|
| `container-db.js` | 不变 |
| `field-parser.js` | 不变 |
| `packing-engine.js` 中的 `packSingleContainer` | 内部逻辑不变，接口略作整理 |
| `packing-engine.js` 中的 `selfCheck` / `recalibrate` | 不变 |
| `packing-engine.js` 中的 EMS 工具函数（`cutSpace`, `mergeSpaces`, `dblScore` 等） | 不变 |
| 前端 UI | 不变 |
| 回归测试 `test-all-scenarios.js` | 需保持全部通过 |

---

## 4. 新增模块：`planner.js`

```
/ContainerLoadingSim/planner.js
```

**导出函数**：

### 4.1 `planContainerAssignment(allItems, availableContainerTypes)`

```javascript
/**
 * 全局分配货物到集装箱
 * @param {Array} allItems - 展开后的货物清单
 * @param {Array} containerSpecs - 可用箱型 [{code, maxDims, maxWeight, ...}]
 * @returns {{ assignments: [{containerCode, items:[], reason}], unassigned:[] }}
 */
function planContainerAssignment(allItems, containerSpecs) { ... }
```

**内部逻辑步骤**：

```
Step 1: 货物分类
  - 超限货（超门高/超门宽/超门深）→ oversizeItems[]
  - 重型不可叠（weight≥1000 或 maxDim≥2.0 且 stackable===false）→ heavyNonStack[]
  - 可叠货 → stackableItems[]
  - 轻型不可叠 → lightNonStack[]

Step 2: 超限货分配
  - 每件超限货 → 独立分配适合的 OT/FR 箱
  - 选择规则：优先最小能装下的箱型

Step 3: 重型不可叠分配  
  - 按体积和载重打包进 20GP/40HQ
  - 每箱总重 ≤ 载重，总体积 ≤ 内容积 × 0.8（留缝隙）
  - 排序：重量降序（重的先装，确保地板优先）

Step 4: 可叠货聚合
  - 按模型/尺寸相似度聚类
  - 每箱体积 ≤ 内容积 × 0.85
  - 优先用小箱（20GP）装大体积货，大箱（45HQ）装轻泡货

Step 5: 轻型不可叠（次要优先）
  - 尝试放在重型不可叠箱子的上层（通过 Packer 试装验证）
  - 无法放置的 → 独立开箱

Step 6: 试装反馈
  - 逐箱调用 packSingleContainer
  - 利用率 < 60% 且有剩余未装货 → 回退 Step 3/4 修订
```

### 4.2 辅助函数

```javascript
function classifyItem(item) → 'oversize' | 'heavy-nonstack' | 'stackable' | 'light-nonstack'
function filterContainerTypes(item, containerSpecs) → 该货物可用的箱型列表
function estimateVolume(items) → number  (l×w×h×qty 累加)
```

---

## 5. `packing-engine.js` 修改点

| 位置 | 修改 | 理由 |
|------|------|------|
| `calculate()` | 当 `mixedContainers` 存在时，调用 `planContainerAssignment` 替代直接调用 `mixedMultiContainerPack` | 入口点切换 |
| `mixedMultiContainerPack()` | 保留作为兼容层，内部委托给 Planner | 向后兼容 |
| 新增导入 | `const planner = window.Planner` | 模块引用 |

**不修改的部分**：`packSingleContainer`、`selfCheck`、`recalibrate`、所有 EMS 工具函数。

---

## 6. 测试策略

### 6.1 现有测试保持通过

- `scripts/test-all-scenarios.js`：32 个断言，运行前确认全部通过
- `scripts/test-comprehensive-report.js`：先跑一遍作为 baseline

### 6.2 新测试

| 测试文件 | 覆盖内容 |
|----------|----------|
| `scripts/test-planner.js` | `classifyItem`、`planContainerAssignment` 各种场景 |
| `scripts/test-planner-unit.js` | 超限分配正确性、重型不可叠地板面积检查、可叠聚合不超体积上限 |
| `scripts/test-planner-feedback.js` | 试装反馈修订：利用率低时触发修订，修订后利用率提升 |

### 6.3 场景验证

**场景A**：582件混合货（原始 bug 案例）→ 预期 4×45HQ 装箱率 ≥ 70%  
**场景B**：8种401件（综合报告测试）→ 预期全部装入，箱数 ≤ 4  
**场景C**：变压器独占 FR → 正确分配 1×40FR  
**场景D**：纯可叠轻货 300 箱 → 全部装入，无空洞箱

---

## 7. 不做的事

- **不改 EMS 底层**：`cutSpace`、`mergeSpaces`、`blockedAbove` 逻辑保持不变。这些是 P6-P8 的范围，属于后续专项优化。
- **不添加 UI 约束项**：货号级别的 `allowedContainerTypes`/`exclusiveContainer` 等字段属于方案 C 的 UI 部分，本次不做。
- **不引入遗传算法/模拟退火**：Planner 使用确定性规则，不引入随机优化——保证结果可复现、可解释。
- **不修改 `recommendMixedContainers`**：该函数在 container-db.js 中，行为保持不变。

---

## 8. 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| Planner 规则太多，有些规则相互矛盾 | 中 | 规则按优先级排序，高优先生效，低优不覆盖高优结果 |
| 试装反馈循环不收敛（来回修订） | 低 | 限制最大 3 轮，超时后接受当前最优解 |
| Planner 新代码引入 bug，回归测试失败 | 中 | 每步 commit，小步验证，保持旧路径作为 fallback |
| 某些边缘场景 Planner 无法处理，掉回贪心法 | 低 | `mixedMultiContainerPack` 保留作为兜底 |

---

## 9. Spec 自审

- [x] 无 TBD/TODO 占位符
- [x] 架构描述与文件修改点一致
- [x] 测试策略覆盖单元、集成、场景三层
- [x] 不做的范围明确，避免 scope creep
- [x] 向后兼容路径清晰
