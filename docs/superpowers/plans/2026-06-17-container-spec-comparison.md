# BWS 集装箱规格与代码数据对比分析

## 概述

本文档对比分析了权威来源（Blue Water Shipping）的集装箱规格数据与代码中的集装箱参数，识别关键差异并评估影响。

---

## BWS 网站数据提取（权威来源）

### 20' Dry Container
- Length: 5.90 m
- Width: 2.35 m
- Height: 2.39 m
- Door width: 2.34 m
- Door height: 2.28 m
- Max payload: 28.20 t (28,200 kg)
- Capacity: 33 cbm

### 40' Dry Container
- Length: 12.03 m
- Width: 2.35 m
- Height: 2.39 m
- Door width: 2.34 m
- Door height: 2.28 m
- Max payload: 28.80 t (28,800 kg)
- Capacity: 67 cbm

### 40' Dry High-Cube Container
- Length: 12.03 m
- Width: 2.35 m
- Height: 2.70 m
- Door width: 2.34 m
- Door height: 2.58 m
- Max payload: 28.62 t (28,620 kg)
- Capacity: 76 cbm

### 20' Open Top Container
- Length: 5.90 m
- Width: 2.34 m
- Height: 2.35 m
- Door width: 2.29 m
- Door height: 2.25 m
- Max payload: 28.20 t (28,200 kg)
- Roof opening: 5.68 x 2.25 m
- Capacity: 32 cbm

### 40' Open Top Container
- Length: 12.03 m
- Width: 2.34 m
- Height: 2.35 m
- Door width: 2.29 m
- Door height: 2.25 m
- Max payload: 26.60 t (26,600 kg)
- Roof opening: 11.81 x 2.22 m
- Capacity: 64 cbm

### 20' Flat Rack Container
- Length: 5.97 m
- Length (inner): 5.70 m
- Width: 2.36 m
- Height: 2.24 m
- Max payload: 27.15 t (27,150 kg)

### 40' Flat Rack Container
- Length: 12.06 m
- Length (inner): 11.66 m
- Width: 2.37 m
- Height: 2.28 m
- Max payload: 39.30 t (39,300 kg)

---

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

---

## 关键差异分析

| 箱型 | 参数 | BWS 数据 | 代码数据 | 差异 | 差异百分比 | 影响等级 |
|---|---|---|---|---|---|---|
| 20GP | Length | 5.90 m | 5.898 m | -0.002 m | -0.03% | 可忽略 |
| 20GP | Width | 2.35 m | 2.352 m | +0.002 m | +0.09% | 可忽略 |
| 20GP | Height | 2.39 m | 2.385 m | -0.005 m | -0.21% | 可忽略 |
| 20GP | Payload | 28,200 kg | 24,000 kg | -4,200 kg | -14.9% | **严重** |
| 40HQ | Payload | 28,620 kg | 26,500 kg | -2,120 kg | -7.4% | **严重** |
| 20OT | Length | 5.90 m | 5.898 m | -0.002 m | -0.03% | 可忽略 |
| 20OT | Width | 2.34 m | 2.352 m | +0.012 m | +0.51% | 可忽略 |
| 20OT | Height | 2.35 m | 2.330 m | -0.020 m | -0.85% | 可忽略 |
| 20OT | Door width | 2.29 m | 2.340 m | +0.050 m | +2.18% | **中等** |
| 20OT | Payload | 28,200 kg | 23,000 kg | -5,200 kg | -18.4% | **严重** |
| 40OT | Payload | 26,600 kg | 26,500 kg | -100 kg | -0.38% | 可忽略 |
| 20FR | Length | 5.97 m | 5.700 m | -0.270 m | -4.52% | **中等** |
| 20FR | Width | 2.36 m | 2.350 m | -0.010 m | -0.42% | 可忽略 |
| 20FR | Height | 2.24 m | 2.350 m | +0.110 m | +4.91% | **中等** |
| 20FR | Payload | 27,150 kg | 28,000 kg | +850 kg | +3.13% | 可忽略 |
| 40FR | Length | 12.06 m | 11.700 m | -0.360 m | -2.98% | **中等** |
| 40FR | Width | 2.37 m | 2.350 m | -0.020 m | -0.84% | 可忽略 |
| 40FR | Height | 2.28 m | 2.350 m | +0.070 m | +3.07% | **中等** |
| 40FR | Payload | 39,300 kg | 40,000 kg | +700 kg | +1.78% | 可忽略 |

---

## 差异影响评估

### 严重差异
1. **20GP/40HQ/20OT 载重偏低**：
   - 20GP: 24,000kg vs 28,200kg (-14.9%)
   - 40HQ: 26,500kg vs 28,620kg (-7.4%)
   - 20OT: 23,000kg vs 28,200kg (-18.4%)
   - **影响**：可能导致实际可装载货物被误判为超重，推荐错误的箱型或混合方案

### 中等差异
1. **20OT 门宽偏大**：2.340m vs 2.290m (+2.2%)
   - **影响**：可能导致实际无法通过门的货物被误判为可通过
2. **FR 箱型尺寸差异**：
   - 20FR 长度：代码使用内长 5.70m，BWS 外长 5.97m
   - 40FR 长度：代码使用内长 11.70m，BWS 外长 12.06m
   - **影响**：长度判断偏差，可能影响超长货物的处理
3. **FR 箱型高度偏大**：
   - 20FR: 2.350m vs 2.24m (+4.9%)
   - 40FR: 2.350m vs 2.28m (+3.1%)
   - **影响**：可能导致实际超高的货物被误判为可装载

### 可忽略差异
- 尺寸差异在 2-5cm 范围内，属于不同制造商的正常公差范围
- 载重差异在 1% 以内，属于正常波动范围

---

## 建议行动

| 优先级 | 行动 | 说明 |
|---|---|---|
| P0 | 更新 20GP/40HQ/20OT 载重 | 修复严重数据错误 |
| P1 | 更新 20OT/40OT 门宽 | 修复门约束判断偏差 |
| P2 | 更新 FR 箱型尺寸 | 统一内外长使用标准 |
| P3 | 更新认知文档 | 反映最新数据来源 |
| P4 | 添加参数验证测试 | 确保数据准确性 |

---

## 数据来源

- Blue Water Shipping Container Specifications: https://www.bws.net/toolbox/container-specifications
- 代码文件: `/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/container-db.js`
- 对比日期: 2026-06-17