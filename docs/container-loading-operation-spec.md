# 集装箱装箱模拟系统 — 操作规范与代码映射

> 本文档面向业务操作人员与开发者双受众。
> 上层为业务操作规范，下层为代码实现映射，确保装箱逻辑可追溯、可验证。

> **数据来源**：集装箱规格数据基于 Blue Water Shipping (BWS) 权威规格表：https://www.bws.net/toolbox/container-specifications
> 代码中的参数与权威数据的对比分析见 `docs/superpowers/plans/2026-06-17-container-spec-comparison.md`。

---

## 第一部分：通用操作规范

### 1.1 坐标系与方向约定

- 以集装箱内部**后-左-下角**为坐标原点 `(0, 0, 0)`。
- **X 轴**：箱体长度方向，从后向前（`L`）。
- **Y 轴**：箱体宽度方向，从左向右（`W`）。
- **Z 轴**：箱体高度方向，从下向上（`H`）。
- 货物尺寸统一用 **长(l) × 宽(w) × 高(h)** 表示，单位为 **米(m)**；重量单位为 **千克(kg)**。

> 代码映射：`packing-engine.js` 中 `createSpace(x, y, z, L, W, H)` 与放置货物时的 `(x, y, z)` 坐标。

### 1.2 货物旋转规则

- 默认情况下，货物允许 **6 个旋转方向**（立方体所有排列）。
- 若货物标记为 **"仅可水平旋转"**（`orientationFixed = true`），则只允许 **绕 Z 轴水平旋转 2 个方向**：
  - 原方向：`l × w × h`
  - 水平旋转 90°：`w × l × h`
- 该标记用于防止货物倒置或侧翻，但允许在水平面内调整长宽方向。

> 代码映射：`container-db.js` → `getOrientations(item)`；`app.js` Step 3 SKU 表格中表头为"仅可水平旋转"。

### 1.3 门约束通用规则

门约束判断货物能否通过集装箱门框进入箱内。

| 箱型类型 | 规则 | 说明 |
|---|---|---|
| 标准柜（20GP/40GP/40HQ） | 存在某个截面 ≤ 门宽 × 门高 | 货物可旋转，只需一个横截面能通过门 |
| 开顶柜（20OT/40OT） | 货物最小边 ≤ 门宽（2.29m） | 顶部可吊装，高度不受门限制，但宽度仍需通过箱门。注意：OT 门宽（2.29m）略小于标准柜（2.34m） |
| 框架柜（20FR/40FR） | 无门约束 | 货物可从侧面或顶部吊装进入 |

> 代码映射：`container-db.js` → `checkDoorConstraint(item, container, tolerance)`。

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

### 1.5 重量约束

- **单件重量**不得超过所选箱型的 `payload`（最大载重）。
- **累计重量**不得超过所选箱型的 `payload`。
- 当前版本**不检查**重心分布（前后/左右平衡）与单件叉车/吊装能力，后续可按需扩展。

> 代码映射：`container-db.js` → `checkWeightConstraint(totalWeight, itemWeight, container)`；`validateItem()` 中单件重量检查。

### 1.6 堆叠与稳定性

- **可叠放**（`stackable = true`，默认）：其他货物可以放置在该货物上方。
- **不可叠放**（`stackable = false`）：系统会阻止其他货物放置在该货物的正上方（通过 `blockedAbove` 标志）。
- 当前实现仅阻止正上方叠放，不阻止从侧面紧邻放置；若业务要求完全隔离，需额外配置缓冲空间。
- 算法优先采用 **层铺（layer packing）** 策略：同型号货物数量 ≥ 10 件时启用，先铺满一层再向上堆叠，提升稳定性。

> 代码映射：`packing-engine.js` → `placeItem()` 中 `blockedAbove` 处理；`layerPack()` 中 `LAYER_PACK_THRESHOLD = 10`。

---

## 第二部分：箱型速查表（基于 BWS 权威数据）

| 箱型 | 外尺寸 (L×W×H m) | 内尺寸 (L×W×H m) | 门尺寸 (W×H m) | Payload (kg) | 容积 (cbm) | 类型 | 允许超限 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 20GP | 5.90 × 2.35 × 2.39 | 5.898 × 2.352 × 2.385 | 2.34 × 2.28 | 28,200 | 33 | standard | 无 | 标准干货柜 |
| 40GP | 12.03 × 2.35 × 2.39 | 12.032 × 2.352 × 2.385 | 2.34 × 2.28 | 28,800 | 67 | standard | 无 | 40尺标准柜 |
| 40HQ | 12.03 × 2.35 × 2.70 | 12.032 × 2.352 × 2.698 | 2.34 × 2.58 | 28,620 | 76 | standard | 无 | 40尺高柜 |
| 20OT | 5.90 × 2.34 × 2.35 | 5.898 × 2.352 × 2.330 | 2.29 × ∞ | 28,200 | 32 | openTop | 超高 +0.5m | 顶开口 5.68×2.25m |
| 40OT | 12.03 × 2.34 × 2.35 | 12.032 × 2.352 × 2.330 | 2.29 × ∞ | 26,600 | 64 | openTop | 超高 +0.5m | 顶开口 11.81×2.22m |
| 20FR | 5.97 × 2.36 × 2.24 | 5.700 × 2.350 × 2.350 | ∞ × ∞ | 27,150 | - | flatRack | 超高+0.5m, 超宽+0.3m, 超长+0.5m | 无顶无侧壁 |
| 40FR | 12.06 × 2.37 × 2.28 | 11.700 × 2.350 × 2.350 | ∞ × ∞ | 39,300 | - | flatRack | 超高+0.5m, 超宽+0.3m, 超长+0.5m | 无顶无侧壁 |

### 各箱型适用场景

- **20GP**：普通干货、重货，经济型首选。容积 33 cbm，载重 28.2t。
- **40GP**：40尺标准柜，容积 67 cbm，载重 28.8t。适合中等体积货物。
- **40HQ**：轻泡货、高货，容积比载重更关键。容积 76 cbm，载重 28.62t。
- **20OT/40OT**：单件高度超过标准柜门高（2.28/2.58m），但最小横截面仍能通过箱门；顶部吊装。OT 门宽 2.29m（略小于标准柜 2.34m）。
- **20FR/40FR**：超宽、超长、超重或不规则货物；无顶无侧壁，需额外绑扎加固。FR 使用内长（20FR: 5.70m, 40FR: 11.70m）作为有效装载长度。

> 代码映射：`container-db.js` → `CONTAINER_DB` 常量对象。

---

## 第三部分：选箱推荐逻辑

系统按 **经济优先级** 选择箱型：20GP → 40HQ → OT → FR。

### 3.1 单件最低箱型分类

对每一件货物，`classifyItemByContainerType()` 按以下顺序判断最低需求：

1. **20GP**：能通过 20GP 门且尺寸在 20GP 有效范围内。
2. **40HQ**：能通过 40HQ 门且尺寸在 40HQ 有效范围内（通常用于超长或较高货物）。
3. **OT**：能通过 OT 门（最小边 ≤ 门宽）且尺寸在 20OT/40OT 有效范围内（通常用于超高货物）。
4. **FR**：能在 6 个旋转方向中放入 20FR/40FR 有效尺寸（用于超宽/超长/不规则货物）。
5. **none**：无法装入任何箱型。

### 3.2 整单主箱型推荐

- 若任意一件货物需要 **FR**，则主箱型必须为 FR；优先尝试 20FR，不行再尝试 40FR。
- 否则若任意一件需要 **OT**，则主箱型必须为 OT；优先尝试 20OT，不行再尝试 40OT。
- 否则若任意一件需要 **40HQ**，则主箱型为 40HQ。
- 否则默认推荐 **20GP**；当总重超过 20GP payload 时升级为 40HQ，当预估需要 >2 个 20GP 时把 40HQ 加入备选。

### 3.3 混合装箱

单箱型无法满足时，`recommendMixedContainers()` 尝试组合多种箱型。当前策略：
- 按货物分类拆分：FR 货物、OT 货物、标准货物分别装箱。
- 优先使用能装下该子集的最经济箱型。

> 代码映射：`container-db.js` → `classifyItemByContainerType()`、`recommendContainer()`、`autoRecommend()`、`recommendMixedContainers()`。

---

## 第四部分：代码映射索引

### 4.1 按文件映射

#### `container-db.js`

| 业务规则 | 函数/常量 | 行号范围 |
|---|---|---|
| 箱型基础参数 | `CONTAINER_DB` | 6-67 |
| 有效尺寸计算 | `getEffectiveMaxDims()` | 70-84 |
| 6 方向旋转适配检查 | `fitsByRotation()` | 92-105 |
| 单件尺寸约束 | `checkSizeConstraints()` | 114-145 |
| 门约束校验 | `checkDoorConstraint()` | 157-201 |
| 单件/累计重量约束 | `checkWeightConstraint()` | 213-220 |
| 叠放属性读取 | `isStackable()` | 230 |
| 可选旋转方向 | `getOrientations()` | 239-260 |
| 单件完整校验管道 | `validateItem()` | 271-290 |
| 单件最低箱型分类 | `classifyItemByContainerType()` | 298-363 |
| 整单主箱型推荐 | `recommendContainer()` | 374-515 |
| 自动推荐（含混合） | `autoRecommend()` | 523-557 |
| 多箱混合推荐 | `recommendMixedContainers()` | 565+ |

#### `field-parser.js`

| 业务规则 | 函数/常量 | 说明 |
|---|---|---|
| 列语义关键词 | `FIELD_KEYWORDS` | 表头模糊匹配字典 |
| 组合尺寸解析 | `COMBINED_DIM_PATTERN` | 解析 "L×W×H" 格式 |
| 单位推断 | `UNIT_INFERENCE`、`inferUnit()` | 根据数值范围推断 mm/cm/m |
| 表头单位检测 | `detectUnitFromHeader()` | 从表头文字识别单位 |
| 文件解析入口 | `parseFile()` | Excel/CSV → structured data |
| 重新提取数据 | `reExtract()` | 按用户调整后的列映射重新解析 |
| 多尺寸消歧 | `detectMultiSize()` | 同一型号出现多组尺寸时提示 |

#### `packing-engine.js`

| 业务规则 | 函数/常量 | 说明 |
|---|---|---|
| 算法常量 | `CONSTANTS` | EPS、DBL 评分权重、层铺阈值等 |
| EMS 空间 | `createSpace()`、`cutSpace()` | 剩余空间表示与切割 |
| 空间修剪/合并 | `pruneSpaces()`、`mergeSpaces()` | 去除无效空间、合并相邻空间 |
| 从已放货物重建 EMS | `buildEMSFromPlaced()` | 层铺后重建可用空间 |
| 空间评分 | `scoreSpaceDBL()` | Depth-Bottom-Left 启发式评分 |
| 货物放置 | `placeItem()` | 尝试把货物放入某个空间 |
| 层铺算法 | `layerPack()` | 同型号 ≥10 件时启用 |
| 单箱计算 | `packContainer()` | 对单一集装箱执行装箱 |
| 主入口 | `calculate()` | 单箱/多箱/混合箱调度 |
| 自检 | `selfCheck()`、`detectOverlaps()` | 重叠与超界检测 |
| 重算机制 | `autoRetry` / `recalibrate()` | 失败时切换排序策略 |

#### `app.js`

| 业务规则 | 函数 | 说明 |
|---|---|---|
| 步骤流转 | `showStep()`、`updateStepIndicators()` | 4 步向导 |
| 文件上传 | `handleFileUpload()` | Step 1 文件读取与解析 |
| 单位推断 | `inferUnitFromMapping()` | 结合表头与数值推断单位 |
| 数据确认 | `confirmData()` | Step 2 → Step 3，处理列映射与多尺寸选择 |
| SKU 属性表 | `renderSkuTable()` | 可叠放、仅可水平旋转 |
| 箱型推荐渲染 | `renderContainerRecommendation()` | 显示推荐主箱型与备选 |
| 开始计算 | `startCalculation()` | Step 3 → Step 4 |
| 结果展示 | `renderStep4()` | 摘要、箱标签、告警、3D、PDF |

### 4.2 规范条目 → 代码关键字速查

| 规范关键词 | 搜索关键词 |
|---|---|
| 门约束 | `checkDoorConstraint` |
| 尺寸约束 | `checkSizeConstraints` / `getEffectiveMaxDims` |
| 重量约束 | `checkWeightConstraint` / `payload` |
| 旋转方向 | `getOrientations` / `orientationFixed` |
| 叠放 | `stackable` / `blockedAbove` / `isStackable` |
| 箱型推荐 | `recommendContainer` / `autoRecommend` |
| 层铺 | `layerPack` / `LAYER_PACK_THRESHOLD` |
| EMS | `createSpace` / `cutSpace` / `buildEMSFromPlaced` |

---

## 第五部分：常见异常与处理

| 异常场景 | 业务含义 | 代码表现 | 建议处理 |
|---|---|---|---|
| 门约束失败 | 货物无法通过箱门 | `checkDoorConstraint` 返回 `pass: false` | 改用开顶柜/框架柜；或拆分货物 |
| 尺寸约束失败 | 货物任何旋转方向都放不进箱内 | `checkSizeConstraints` 返回 `pass: false` | 改用更大箱型或框架柜 |
| 单件超重 | 单件 > payload | `validateItem` 失败 | 拆分货物或使用特种箱 |
| 累计超重 | 总重 > payload | `checkWeightConstraint` 失败 | 分箱或换大载重箱型 |
| 非叠放被叠放 | 算法在不可叠放货物上放置了其他货物 | `selfCheck` 报错 | 检查 `blockedAbove` 是否正确传播 |
| 利用率过低 | 大量空间浪费 | `avgUtilization` 很低 | 尝试调整 tolerance 或启用 autoRetry |
| 无推荐箱型 | 所有单件分类为 `none` | `recommendContainer` 返回 `null` | 检查货物尺寸/重量是否异常 |
| 多尺寸歧义 | 同一型号出现多组尺寸 | `detectMultiSize` 触发 | 在 Step 2 选择正确尺寸组 |

---

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
6. **FR 内外长**：FR 箱型代码使用内长，实际装载应考虑内长限制（20FR: 5.70m, 40FR: 11.70m）。
7. **OT 门宽**：OT 箱型门宽（2.29m）略小于标准柜（2.34m），需特别注意超宽货物。
