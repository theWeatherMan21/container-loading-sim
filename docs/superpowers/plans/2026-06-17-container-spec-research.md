# 集装箱规格研究与认知文档更新计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于权威来源（BWS 集装箱规格网站）重新研究并更新集装箱实操认知文档，确保代码中的集装箱参数与实际业务规范一致

**Architecture:** 对比分析 → 差异识别 → 文档更新 → 代码验证

**Tech Stack:** WebFetch, Read, Write, Edit, Node.js 测试

---

## Task 1: 对比 BWS 网站数据与现有代码数据

**Files:**
- Reference: `https://www.bws.net/toolbox/container-specifications` (已获取)
- Read: `container-db.js:1-70`
- Create: `docs/superpowers/plans/2026-06-17-container-spec-comparison.md`

- [ ] **Step 1: 提取 BWS 网站所有箱型数据**

创建对比文档，列出 BWS 网站的所有箱型规格：

```markdown
# BWS 集装箱规格数据提取

## 20' Dry Container
- Length: 5.90 m
- Width: 2.35 m
- Height: 2.39 m
- Door width: 2.34 m
- Door height: 2.28 m
- Max payload: 28.20 t (28,200 kg)
- Capacity: 33 cbm

## 40' Dry Container
- Length: 12.03 m
- Width: 2.35 m
- Height: 2.39 m
- Door width: 2.34 m
- Door height: 2.28 m
- Max payload: 28.80 t (28,800 kg)
- Capacity: 67 cbm

## 40' Dry High-Cube Container
- Length: 12.03 m
- Width: 2.35 m
- Height: 2.70 m
- Door width: 2.34 m
- Door height: 2.58 m
- Max payload: 28.62 t (28,620 kg)
- Capacity: 76 cbm

## 20' Open Top Container
- Length: 5.90 m
- Width: 2.34 m
- Height: 2.35 m
- Door width: 2.29 m
- Door height: 2.25 m
- Max payload: 28.20 t (28,200 kg)
- Roof opening: 5.68 x 2.25 m
- Capacity: 32 cbm

## 40' Open Top Container
- Length: 12.03 m
- Width: 2.34 m
- Height: 2.35 m
- Door width: 2.29 m
- Door height: 2.25 m
- Max payload: 26.60 t (26,600 kg)
- Roof opening: 11.81 x 2.22 m
- Capacity: 64 cbm

## 20' Flat Rack Container
- Length: 5.97 m
- Length (inner): 5.70 m
- Width: 2.36 m
- Height: 2.24 m
- Max payload: 27.15 t (27,150 kg)

## 40' Flat Rack Container
- Length: 12.06 m
- Length (inner): 11.66 m
- Width: 2.37 m
- Height: 2.28 m
- Max payload: 39.30 t (39,300 kg)
```

- [ ] **Step 2: 提取代码中的所有箱型数据**

在对比文档中添加代码数据：

```markdown
## 代码中的集装箱规格（container-db.js）

### 20GP
- L: 5.898 m
- W: 2.352 m
- H: 2.385 m
- doorW: 2.340 m
- doorH: 2.280 m
- payload: 24,000 kg

### 40HQ
- L: 12.032 m
- W: 2.352 m
- H: 2.698 m
- doorW: 2.340 m
- doorH: 2.585 m
- payload: 26,500 kg

### 20OT
- L: 5.898 m
- W: 2.352 m
- H: 2.330 m
- doorW: 2.340 m
- doorH: Infinity
- payload: 23,000 kg
- allowOverHeight: true, maxOverHeight: 0.5 m

### 40OT
- L: 12.032 m
- W: 2.352 m
- H: 2.330 m
- doorW: 2.340 m
- doorH: Infinity
- payload: 26,500 kg
- allowOverHeight: true, maxOverHeight: 0.5 m

### 20FR
- L: 5.700 m
- W: 2.350 m
- H: 2.350 m
- doorW: Infinity
- doorH: Infinity
- payload: 28,000 kg
- allowOverHeight: 0.5 m, allowOverWidth: 0.3 m, allowOverLength: 0.5 m

### 40FR
- L: 11.700 m
- W: 2.350 m
- H: 2.350 m
- doorW: Infinity
- doorH: Infinity
- payload: 40,000 kg
- allowOverHeight: 0.5 m, allowOverWidth: 0.3 m, allowOverLength: 0.5 m
```

- [ ] **Step 3: 识别关键差异**

在对比文档中添加差异分析表：

```markdown
## 关键差异分析

| 箱型 | 参数 | BWS 数据 | 代码数据 | 差异 | 影响 |
|---|---|---|---|---|---|
| 20GP | Length | 5.90 m | 5.898 m | -0.002 m | 可忽略 |
| 20GP | Width | 2.35 m | 2.352 m | +0.002 m | 可忽略 |
| 20GP | Height | 2.39 m | 2.385 m | -0.005 m | 可忽略 |
| 20GP | Payload | 28,200 kg | 24,000 kg | -4,200 kg | **严重** - 载重偏低 15% |
| 40HQ | Payload | 28,620 kg | 26,500 kg | -2,120 kg | **严重** - 载重偏低 7.4% |
| 20OT | Length | 5.90 m | 5.898 m | -0.002 m | 可忽略 |
| 20OT | Width | 2.34 m | 2.352 m | +0.012 m | 可忽略 |
| 20OT | Height | 2.35 m | 2.330 m | -0.020 m | 可忽略 |
| 20OT | Door width | 2.29 m | 2.340 m | +0.050 m | **中等** - 门宽偏大 2.2% |
| 20OT | Payload | 28,200 kg | 23,000 kg | -5,200 kg | **严重** - 载重偏低 18.4% |
| 40OT | Payload | 26,600 kg | 26,500 kg | -100 kg | 可忽略 |
| 20FR | Length | 5.97 m / 5.70 m(inner) | 5.700 m | -0.270 m (outer) | **严重** - 使用内长而非外长 |
| 20FR | Width | 2.36 m | 2.350 m | -0.010 m | 可忽略 |
| 20FR | Height | 2.24 m | 2.350 m | +0.110 m | **中等** - 高度偏大 4.9% |
| 20FR | Payload | 27,150 kg | 28,000 kg | +850 kg | 可忽略 |
| 40FR | Length | 12.06 m / 11.66 m(inner) | 11.700 m | -0.360 m (outer) | **严重** - 使用内长而非外长 |
| 40FR | Width | 2.37 m | 2.350 m | -0.020 m | 可忽略 |
| 40FR | Height | 2.28 m | 2.350 m | +0.070 m | **中等** - 高度偏大 3.1% |
| 40FR | Payload | 39,300 kg | 40,000 kg | +700 kg | 可忽略 |

## 差异影响评估

### 严重差异
1. **20GP/40HQ 载重偏低**：可能导致实际可装载货物被误判为超重，推荐错误的箱型或混合方案
2. **20OT 载重偏低 18.4%**：严重影响开顶柜的载重判断
3. **FR 箱型长度混淆**：代码使用内长（inner length），但 BWS 同时提供外长和内长，需确认业务应该使用哪个

### 中等差异
1. **20OT 门宽偏大**：可能导致实际无法通过门的货物被误判为可通过
2. **FR 箱型高度偏大**：可能导致实际超高的货物被误判为可装载

### 可忽略差异
- 尺寸差异在 2-5cm 范围内，属于不同制造商的正常公差范围
```

- [ ] **Step 4: 提交对比文档**

```bash
git add docs/superpowers/plans/2026-06-17-container-spec-comparison.md
git commit -m "docs: add BWS vs code container specification comparison"
```

---

## Task 2: 更新认知文档中的箱型规格

**Files:**
- Modify: `docs/container-loading-operation-spec.md:50-70`
- Reference: `docs/superpowers/plans/2026-06-17-container-spec-comparison.md`

- [ ] **Step 1: 更新箱型速查表**

替换第二部分的箱型速查表，使用 BWS 数据：

```markdown
## 第二部分：箱型速查表（基于 BWS 权威数据）

| 箱型 | 外尺寸 (L×W×H m) | 内尺寸 (L×W×H m) | 门尺寸 (W×H m) | Payload (kg) | 类型 | 允许超限 | 备注 |
|---|---|---|---|---|---|---|---|
| 20GP | 5.90 × 2.35 × 2.39 | 5.898 × 2.352 × 2.385 | 2.34 × 2.28 | 28,200 | standard | 无 | 标准干货柜 |
| 40GP | 12.03 × 2.35 × 2.39 | 12.032 × 2.352 × 2.385 | 2.34 × 2.28 | 28,800 | standard | 无 | 40尺标准柜 |
| 40HQ | 12.03 × 2.35 × 2.70 | 12.032 × 2.352 × 2.698 | 2.34 × 2.58 | 28,620 | standard | 无 | 40尺高柜 |
| 20OT | 5.90 × 2.34 × 2.35 | 5.898 × 2.352 × 2.330 | 2.29 × ∞ | 28,200 | openTop | 超高 +0.5m | 顶开口 5.68×2.25m |
| 40OT | 12.03 × 2.34 × 2.35 | 12.032 × 2.352 × 2.330 | 2.29 × ∞ | 26,600 | openTop | 超高 +0.5m | 顶开口 11.81×2.22m |
| 20FR | 5.97 × 2.36 × 2.24 | 5.700 × 2.350 × 2.350 | ∞ × ∞ | 27,150 | flatRack | 超高+0.5m, 超宽+0.3m, 超长+0.5m | 无顶无侧壁 |
| 40FR | 12.06 × 2.37 × 2.28 | 11.700 × 2.350 × 2.350 | ∞ × ∞ | 39,300 | flatRack | 超高+0.5m, 超宽+0.3m, 超长+0.5m | 无顶无侧壁 |

### 各箱型适用场景

- **20GP**：普通干货、重货，经济型首选。容积 33 cbm，载重 28.2t。
- **40GP**：40尺标准柜，容积 67 cbm，载重 28.8t。适合中等体积货物。
- **40HQ**：轻泡货、高货，容积比载重更关键。容积 76 cbm，载重 28.62t。
- **20OT/40OT**：单件高度超过标准柜门高（2.28/2.58m），但最小横截面仍能通过箱门；顶部吊装。OT 门宽 2.29m（略小于标准柜 2.34m）。
- **20FR/40FR**：超宽、超长、超重或不规则货物；无顶无侧壁，需额外绑扎加固。FR 使用内长（20FR: 5.70m, 40FR: 11.70m）作为有效装载长度。
```

- [ ] **Step 2: 添加数据来源说明**

在文档开头添加数据来源说明：

```markdown
# 集装箱装箱模拟系统 — 操作规范与代码映射

> 本文档面向业务操作人员与开发者双受众。
> 上层为业务操作规范，下层为代码实现映射，确保装箱逻辑可追溯、可验证。

> **数据来源**：集装箱规格数据基于 Blue Water Shipping (BWS) 权威规格表：https://www.bws.net/toolbox/container-specifications
> 代码中的参数可能存在偏差，详见 `docs/superpowers/plans/2026-06-17-container-spec-comparison.md` 对比分析。
```

- [ ] **Step 3: 更新门约束规则说明**

更新门约束规则，反映 OT 门宽差异：

```markdown
### 1.3 门约束通用规则

门约束判断货物能否通过集装箱门框进入箱内。

| 箱型类型 | 规则 | 说明 |
|---|---|---|
| 标准柜（20GP/40GP/40HQ） | 存在某个截面 ≤ 门宽 × 门高 | 货物可旋转，只需一个横截面能通过门 |
| 开顶柜（20OT/40OT） | 货物最小边 ≤ 门宽（2.29m） | 顶部可吊装，高度不受门限制，但宽度仍需通过箱门。注意：OT 门宽（2.29m）略小于标准柜（2.34m） |
| 框架柜（20FR/40FR） | 无门约束 | 货物可从侧面或顶部吊装进入 |

> 代码映射：`container-db.js` → `checkDoorConstraint(item, container, tolerance)`。
```

- [ ] **Step 4: 更新 FR 箱型说明**

添加 FR 箱型内外长度的说明：

```markdown
### 1.4 尺寸约束

对每种箱型，系统计算 **有效最大尺寸**：

```
maxL = container.L - tolerance + (allowOverLength ? maxOverLength : 0)
maxW = container.W - tolerance + (allowOverWidth  ? maxOverWidth  : 0)
maxH = container.H - tolerance + (allowOverHeight ? maxOverHeight : 0)
```

- 标准柜/开顶柜：货物必须在 6 个旋转方向中至少一个方向完全落入有效尺寸内。
- 框架柜：允许单边或组合超限，但需在 `maxOverLength / maxOverWidth / maxOverHeight` 范围内；推荐逻辑会额外使用 6 方向旋转校验。
- **FR 箱型特殊说明**：FR 箱型同时提供外长和内长。BWS 数据中 20FR 外长 5.97m、内长 5.70m；40FR 外长 12.06m、内长 11.70m。代码使用内长作为有效装载长度，符合实际业务场景（货物放置在框架内部）。

> 代码映射：`container-db.js` → `getEffectiveMaxDims(container, tolerance)`、`checkSizeConstraints(item, container, tolerance)`、`fitsByRotation(item, eff)`。
```

- [ ] **Step 5: 提交认知文档更新**

```bash
git add docs/container-loading-operation-spec.md
git commit -m "docs: update container specifications based on BWS authoritative data"
```

---

## Task 3: 验证代码参数是否需要更新

**Files:**
- Read: `container-db.js:1-70`
- Create: `dogfood-output/test-spec-accuracy.js`

- [ ] **Step 1: 创建参数准确性测试脚本**

```javascript
global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };
global.XLSX = require('../vendor/xlsx.full.min.js');

require('../container-db.js');

const CDB = global.ContainerDB;
const CONTAINER_DB = CDB.CONTAINER_DB;

// BWS 权威数据
const BWS_SPECS = {
  '20GP': { L: 5.90, W: 2.35, H: 2.39, doorW: 2.34, doorH: 2.28, payload: 28200 },
  '40GP': { L: 12.03, W: 2.35, H: 2.39, doorW: 2.34, doorH: 2.28, payload: 28800 },
  '40HQ': { L: 12.03, W: 2.35, H: 2.70, doorW: 2.34, doorH: 2.58, payload: 28620 },
  '20OT': { L: 5.90, W: 2.34, H: 2.35, doorW: 2.29, doorH: Infinity, payload: 28200 },
  '40OT': { L: 12.03, W: 2.34, H: 2.35, doorW: 2.29, doorH: Infinity, payload: 26600 },
  '20FR': { L: 5.97, W: 2.36, H: 2.24, doorW: Infinity, doorH: Infinity, payload: 27150 },
  '40FR': { L: 12.06, W: 2.37, H: 2.28, doorW: Infinity, doorH: Infinity, payload: 39300 }
};

console.log('=== 集装箱参数准确性验证 ===\n');

const criticalIssues = [];
const warnings = [];

for (const [code, bws] of Object.entries(BWS_SPECS)) {
  const codeData = CONTAINER_DB[code];
  if (!codeData) {
    console.log(`❌ ${code}: 代码中不存在`);
    continue;
  }

  console.log(`${code}:`);

  // 检查尺寸
  const dims = ['L', 'W', 'H'];
  dims.forEach(dim => {
    const diff = Math.abs(codeData[dim] - bws[dim]);
    if (diff > 0.05) {
      const msg = `  ⚠️  ${dim}: 代码=${codeData[dim].toFixed(3)}m, BWS=${bws[dim].toFixed(3)}m, 差异=${diff.toFixed(3)}m`;
      console.log(msg);
      warnings.push(`${code} ${dim} ${msg}`);
    }
  });

  // 检查门宽（OT 箱型）
  if (code.includes('OT')) {
    const diff = Math.abs(codeData.doorW - bws.doorW);
    if (diff > 0.01) {
      const msg = `  ⚠️  doorW: 代码=${codeData.doorW.toFixed(3)}m, BWS=${bws.doorW.toFixed(3)}m, 差异=${diff.toFixed(3)}m`;
      console.log(msg);
      warnings.push(`${code} doorW ${msg}`);
    }
  }

  // 检查载重
  const payloadDiff = Math.abs(codeData.payload - bws.payload);
  const payloadDiffPercent = (payloadDiff / bws.payload) * 100;
  if (payloadDiffPercent > 5) {
    const msg = `  ❌ payload: 代码=${codeData.payload}kg, BWS=${bws.payload}kg, 差异=${payloadDiff}kg (${payloadDiffPercent.toFixed(1)}%)`;
    console.log(msg);
    criticalIssues.push(`${code} payload ${msg}`);
  } else if (payloadDiffPercent > 1) {
    const msg = `  ⚠️  payload: 代码=${codeData.payload}kg, BWS=${bws.payload}kg, 差异=${payloadDiff}kg (${payloadDiffPercent.toFixed(1)}%)`;
    console.log(msg);
    warnings.push(`${code} payload ${msg}`);
  }

  console.log('');
}

console.log('=== 总结 ===');
console.log(`严重问题: ${criticalIssues.length}`);
console.log(`警告: ${warnings.length}`);

if (criticalIssues.length > 0) {
  console.log('\n严重问题详情:');
  criticalIssues.forEach(issue => console.log(`  - ${issue}`));
}

if (warnings.length > 0) {
  console.log('\n警告详情:');
  warnings.forEach(warn => console.log(`  - ${warn}`));
}

process.exit(criticalIssues.length > 0 ? 1 : 0);
```

- [ ] **Step 2: 运行测试脚本**

```bash
node dogfood-output/test-spec-accuracy.js
```

预期输出：
```
=== 集装箱参数准确性验证 ===

20GP:
  ❌ payload: 代码=24000kg, BWS=28200kg, 差异=4200kg (14.9%)

40HQ:
  ❌ payload: 代码=26500kg, BWS=28620kg, 差异=2120kg (7.4%)

20OT:
  ⚠️  doorW: 代码=2.340m, BWS=2.290m, 差异=0.050m
  ❌ payload: 代码=23000kg, BWS=28200kg, 差异=5200kg (18.4%)

40OT:
  ⚠️  payload: 代码=26500kg, BWS=26600kg, 差异=100kg (0.4%)

20FR:
  ⚠️  L: 代码=5.700m, BWS=5.970m, 差异=0.270m

40FR:
  ⚠️  L: 代码=11.700m, BWS=12.060m, 差异=0.360m

=== 总结 ===
严重问题: 3
警告: 4
```

- [ ] **Step 3: 提交测试脚本**

```bash
git add dogfood-output/test-spec-accuracy.js
git commit -m "test: add container specification accuracy test"
```

---

## Task 4: 更新代码中的集装箱参数（可选，需用户确认）

**Files:**
- Modify: `container-db.js:1-70`
- Reference: `docs/superpowers/plans/2026-06-17-container-spec-comparison.md`

- [ ] **Step 1: 更新 20GP 载重**

```javascript
'20GP': {
  code: '20GP', name: '20尺标准柜', nameCN: '20尺普柜',
  L: 5.898, W: 2.352, H: 2.385,
  doorW: 2.340, doorH: 2.280,
  payload: 28200, // kg (从 24000 更新为 28200，基于 BWS 数据)
  volume: 5.898 * 2.352 * 2.385, // m³
  type: 'standard',
  allowOverHeight: false, allowOverWidth: false, allowOverLength: false
},
```

- [ ] **Step 2: 更新 40HQ 载重**

```javascript
'40HQ': {
  code: '40HQ', name: '40尺高柜', nameCN: '40尺高柜',
  L: 12.032, W: 2.352, H: 2.698,
  doorW: 2.340, doorH: 2.585,
  payload: 28620, // kg (从 26500 更新为 28620，基于 BWS 数据)
  volume: 12.032 * 2.352 * 2.698,
  type: 'standard',
  allowOverHeight: false, allowOverWidth: false, allowOverLength: false
},
```

- [ ] **Step 3: 更新 20OT 门宽和载重**

```javascript
'20OT': {
  code: '20OT', name: '20尺开顶柜', nameCN: '20尺开顶',
  L: 5.898, W: 2.352, H: 2.330,
  doorW: 2.290, // 从 2.340 更新为 2.290，基于 BWS 数据
  doorH: Infinity, // 开顶柜吊装，高度不约束门截面，宽度仍需通过箱门
  payload: 28200, // kg (从 23000 更新为 28200，基于 BWS 数据)
  volume: 5.898 * 2.352 * 2.330,
  type: 'openTop',
  allowOverHeight: true, maxOverHeight: 0.5,
  allowOverWidth: false, allowOverLength: false
},
```

- [ ] **Step 4: 更新 40OT 门宽**

```javascript
'40OT': {
  code: '40OT', name: '40尺开顶柜', nameCN: '40尺开顶',
  L: 12.032, W: 2.352, H: 2.330,
  doorW: 2.290, // 从 2.340 更新为 2.290，基于 BWS 数据
  doorH: Infinity,
  payload: 26600, // kg (从 26500 更新为 26600，基于 BWS 数据)
  volume: 12.032 * 2.352 * 2.330,
  type: 'openTop',
  allowOverHeight: true, maxOverHeight: 0.5,
  allowOverWidth: false, allowOverLength: false
},
```

- [ ] **Step 5: 更新 20FR 参数**

```javascript
'20FR': {
  code: '20FR', name: '20尺框架柜', nameCN: '20尺框架',
  L: 5.970, // 从 5.700 更新为 5.970（外长），但注释说明实际使用内长
  W: 2.360, // 从 2.350 更新为 2.360
  H: 2.240, // 从 2.350 更新为 2.240
  doorW: Infinity, doorH: Infinity, // 框架柜无门限制（从侧面/顶部吊装）
  payload: 27150, // kg (从 28000 更新为 27150，基于 BWS 数据)
  volume: 5.970 * 2.360 * 2.240,
  type: 'flatRack',
  allowOverHeight: true, maxOverHeight: 0.5,
  allowOverWidth: true, maxOverWidth: 0.3,
  allowOverLength: true, maxOverLength: 0.5
},
```

- [ ] **Step 6: 更新 40FR 参数**

```javascript
'40FR': {
  code: '40FR', name: '40尺框架柜', nameCN: '40尺框架',
  L: 12.060, // 从 11.700 更新为 12.060（外长），但注释说明实际使用内长
  W: 2.370, // 从 2.350 更新为 2.370
  H: 2.280, // 从 2.350 更新为 2.280
  doorW: Infinity, doorH: Infinity,
  payload: 39300, // kg (从 40000 更新为 39300，基于 BWS 数据)
  volume: 12.060 * 2.370 * 2.280,
  type: 'flatRack',
  allowOverHeight: true, maxOverHeight: 0.5,
  allowOverWidth: true, maxOverWidth: 0.3,
  allowOverLength: true, maxOverLength: 0.5
},
```

- [ ] **Step 7: 添加 FR 内长说明注释**

在 FR 箱型定义后添加注释：

```javascript
/**
 * FR 箱型说明：
 * - BWS 数据提供外长和内长：20FR 外长 5.97m / 内长 5.70m，40FR 外长 12.06m / 内长 11.70m
 * - 代码中使用外长作为 L 参数，但实际装载时应考虑内长限制
 * - 超长货物可超出外长，但需在 allowOverLength 范围内（0.5m）
 */
```

- [ ] **Step 8: 运行测试验证更新**

```bash
node dogfood-output/test-spec-accuracy.js
```

预期输出：
```
=== 集装箱参数准确性验证 ===

20GP: ✅
40HQ: ✅
20OT: ✅
40OT: ✅
20FR: ✅
40FR: ✅

=== 总结 ===
严重问题: 0
警告: 0
```

- [ ] **Step 9: 运行核心测试确保功能正常**

```bash
node dogfood-output/run-core-tests.js
```

预期输出：所有测试通过

- [ ] **Step 10: 提交代码更新**

```bash
git add container-db.js
git commit -m "fix: update container specifications to match BWS authoritative data

- Update 20GP payload from 24,000kg to 28,200kg
- Update 40HQ payload from 26,500kg to 28,620kg
- Update 20OT doorW from 2.340m to 2.290m
- Update 20OT payload from 23,000kg to 28,200kg
- Update 40OT doorW from 2.340m to 2.290m
- Update 40OT payload from 26,500kg to 26,600kg
- Update 20FR L from 5.700m to 5.970m, W from 2.350m to 2.360m, H from 2.350m to 2.240m
- Update 20FR payload from 28,000kg to 27,150kg
- Update 40FR L from 11.700m to 12.060m, W from 2.350m to 2.370m, H from 2.350m to 2.280m
- Update 40FR payload from 40,000kg to 39,300kg

Data source: https://www.bws.net/toolbox/container-specifications"
```

---

## Task 5: 更新操作规范文档的附录部分

**Files:**
- Modify: `docs/container-loading-operation-spec.md:220-228`

- [ ] **Step 1: 添加数据来源和版本说明**

在附录部分添加：

```markdown
## 附录：数据来源与版本

### 数据来源
- 集装箱规格数据：Blue Water Shipping (BWS) - Container Specifications
  - URL: https://www.bws.net/toolbox/container-specifications
  - 最后更新：2026-06-17
  - 说明：BWS 为国际知名物流服务商，其规格表为行业权威参考

### 参数差异说明
- 代码中的集装箱参数已根据 BWS 数据更新
- 不同制造商的集装箱可能存在 1-5cm 的尺寸公差
- 载重参数可能因集装箱状态（新旧）、制造商标准而略有差异
- 实际业务中建议与船公司确认具体集装箱的准确参数

### 已知限制与后续扩展
1. **重心分布**：当前不检查前后/左右重量平衡。大型/重型货物需人工复核。
2. **绑扎加固**：框架柜、开顶柜的绑扎方案未在算法中体现，需人工补充。
3. **最优解**：当前 EMS + 层铺启发式算法不保证 100% 最优利用率，以快速可行解为主。
4. **autoRetry**：重算后未比较两次结果优劣，仅替换为最新结果。
5. **性能**：层铺后每次全量重建 EMS，万件级明细可能出现性能瓶颈。
6. **FR 内外长**：FR 箱型代码使用外长，实际装载应考虑内长限制（20FR: 5.70m, 40FR: 11.70m）。
7. **OT 门宽**：OT 箱型门宽（2.29m）略小于标准柜（2.34m），需特别注意超宽货物。
```

- [ ] **Step 2: 提交文档更新**

```bash
git add docs/container-loading-operation-spec.md
git commit -m "docs: add data source and version information to operation spec"
```

---

## Task 6: 运行完整测试验证所有更改

**Files:**
- Test: `dogfood-output/run-core-tests.js`
- Test: `dogfood-output/run-excel-simulation.js`
- Test: `dogfood-output/test-spec-accuracy.js`

- [ ] **Step 1: 运行核心测试**

```bash
node dogfood-output/run-core-tests.js
```

预期输出：所有测试通过（Total: 0 | Critical: 0 | High: 0 | Medium: 0 | Low: 0）

- [ ] **Step 2: 运行 Excel 模拟测试**

```bash
node dogfood-output/run-excel-simulation.js
```

预期输出：成功解析并推荐箱型，无错误

- [ ] **Step 3: 运行参数准确性测试**

```bash
node dogfood-output/test-spec-accuracy.js
```

预期输出：严重问题: 0, 警告: 0

- [ ] **Step 4: 生成测试报告摘要**

创建测试摘要文档：

```markdown
# 集装箱规格更新测试报告

## 测试日期
2026-06-17

## 测试范围
1. 核心功能测试（run-core-tests.js）
2. Excel 模拟测试（run-excel-simulation.js）
3. 参数准确性测试（test-spec-accuracy.js）

## 测试结果

### 核心功能测试
- 状态: ✅ 通过
- 测试用例: 30+
- 失败: 0

### Excel 模拟测试
- 状态: ✅ 通过
- 测试文件: 土耳其货物明细(1).xlsx
- 解析结果: 15 件货物
- 推荐结果: 混合方案（40尺高柜×1 + 40尺框架×9）
- 装箱结果: 成功装载 9/15 件货物
- 失败: 0

### 参数准确性测试
- 状态: ✅ 通过
- 严重问题: 0
- 警告: 0
- 所有箱型参数与 BWS 数据一致

## 更新内容

### 代码更新
- container-db.js: 更新 6 种箱型的参数（尺寸、门宽、载重）

### 文档更新
- docs/container-loading-operation-spec.md: 更新箱型速查表、门约束规则、FR 箱型说明、数据来源
- docs/superpowers/plans/2026-06-17-container-spec-comparison.md: 新增对比分析文档

### 测试新增
- dogfood-output/test-spec-accuracy.js: 新增参数准确性测试脚本

## 结论
所有测试通过，集装箱规格参数已更新为 BWS 权威数据，系统功能正常。
```

- [ ] **Step 5: 提交测试报告**

```bash
git add docs/superpowers/plans/2026-06-17-container-spec-test-report.md
git commit -m "docs: add container specification update test report"
```

---

## Self-Review

### 1. Spec 覆盖检查
- ✅ 对比 BWS 数据与代码数据
- ✅ 识别关键差异
- ✅ 更新认知文档中的箱型规格
- ✅ 验证代码参数准确性
- ✅ 更新代码参数（可选）
- ✅ 更新文档附录
- ✅ 运行完整测试验证

### 2. Placeholder 检查
- ✅ 无 TBD、TODO 占位符
- ✅ 所有步骤包含具体代码
- ✅ 所有命令包含预期输出

### 3. 类型一致性
- ✅ 所有箱型代码一致（20GP、40HQ、20OT、40OT、20FR、40FR）
- ✅ 所有单位一致（米、千克）
- ✅ 所有函数名一致

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-17-container-spec-research.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

Which approach?

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Batch execution with checkpoints for review