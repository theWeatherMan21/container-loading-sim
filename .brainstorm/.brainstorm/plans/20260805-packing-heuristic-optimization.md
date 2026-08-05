# 装箱启发式优化设计

## 目标

在不引入外部求解器的前提下，提高现有 EMS 多箱装载质量，并消除层铺路径与逐件 EMS 路径之间的约束差异。

## 已验证问题

- 同型号数量达到 10 件后切换到层铺，但层铺只使用输入方向，存在 9 件装入 3 件、10 件反而只装入 2 件的非单调结果。
- 层铺检查支撑覆盖率和四角支撑，但未检查承重；可将 10 件 100kg 货物放到 1kg 底货上。
- 代表性 401 件订单使用当前 smart 顺序需要 5 个 45HQ；型号总体积降序或有限型号组扰动可在 4 箱内完成，达到载重理论下界。

## 方案（已实施）

1. 层铺每轮枚举货物合法朝向，以本轮可放数量为第一评分，贴合度为第二评分。
2. 层铺高层放置调用与 EMS 相同的承重检查（checkWeightBearing）。
3. selfCheck 增加承重复检（bearingViolation），避免错误布局绕过生成阶段后仍显示通过。
4. 将原多箱执行体保留为 multiContainerPackOnce 核心函数，外层 multiContainerPack 生成有限候选：smart、型号总体积降序（group-total-volume-desc）、固定种子型号组扰动。
5. 候选按未装数量、实际箱数、尾箱利用率、平均利用率的字典序选择；达到重量/体积下界且全部装入时提前停止。
6. 优化器支持 optimizationSeed / randomStarts(≤20) / optimizationTimeMs(默认2500ms) / optimize=false；显式指定 sortStrategy、maxContainers=1 或 optimize=false 时保留单次执行语义。
7. avgUtilization 三处汇总改为容积加权（weightedAvgUtilization），跨箱型可比、尾箱不拖尾。
8. Planner 可叠货聚合增加按型号去重的足迹预筛，避免"分组低估 → 扩容兜底"连锁。
9. 报告脚本容量分析改为同时校验 containerCount === n，消除动态扩容对"n×箱全部装入"结论的污染。
10. quick-check-smart / diagnose-packing-trace 单箱对比补齐 expandItems，与混合段同口径。
11. UI 摘要与箱详情透传 isExpand/plannerReason 标记；叠放约束错误提供业务可读文案。

## 测试（已实施）

- 层铺阈值单调性回归（9件装3、10件≥3）。
- 层铺承重拒绝与 selfCheck 复检（bearingViolation）。
- 401 件代表订单 4 箱下界 + 固定种子可重复。
- 容积加权利用率断言（2×20GP+1×40HQ ≈61.4%）。
- 优化器时间预算（0ms 只评估首个候选且结果有效）。
- Planner 可叠货分组足迹不超箱地板性质测试。
- 全量现有测试与格式检查。

## 已知限制与后续（未实施，需先定义字段语义）

### 承重链：0.5 代理只比较单层下方件
量化复现：10 层 100kg 竖列，最底层承担上方累计 900kg，每层判定均通过（下方单件 100 ≥ 100×0.5）。
根因：checkWeightBearing 只收集顶面恰好在候选 z 的直接下层（L362），不沿支撑链累计载荷；SUPPORT_WEIGHT_RATIO=0.5 是重量代理，与货物实际承压能力无关。
正确修复前置：定义货物字段 `maxTopLoadKg`（单件可承受上方累计载荷）与/或 `maxStackLayers`（最大叠放层数），放置时校验"该柱上方累计 ≤ 下方支撑件 maxTopLoadKg 之和"。
**在字段语义确定前不做代理补丁**：100kg 钢箱与 100kg 纸箱承压能力天差地别，任何"下方累计总重"代理都会误拒合法装载或仍漏报。

### 下界：只含重量/体积，不含地板/FR 悬出
calculateContainerLowerBound 当前只有重量+体积两项（地板项因可上层/FR 可悬出会高估而被移除）。代价是下界变松，早停触发更晚；optimization.lowerBound 只能作为必要条件，不能作为"已达最优"证据展示给用户。

### Planner 可叠货聚合无叠层高度检查
足迹预筛已按型号去重，但"每型号可叠几层"仍依赖 maxStackLayers 字段；无字段时高度约束由 0.85 体积系数近似，极端薄板件仍可能触发扩容兜底。

### 优化器无按规模自适应
randomStarts 固定（默认 8）+ 时间预算兜底（2500ms）。大批量订单最坏仍可能跑满预算；后续可按展开件数/型号数动态缩放 randomStarts。
