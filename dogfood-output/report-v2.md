# Dogfood Report: 智能装箱模拟系统 (v2)

| Field | Value |
|-------|-------|
| **Date** | 2026-06-10 |
| **App** | 智能装箱模拟系统 |
| **Test Mode** | Browser E2E (agent-browser + CDP eval) |
| **URL** | http://localhost:9876/index.html |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 2 |
| Medium | 2 |
| Low | 1 |
| **Total** | **7** |

---

## Issues

### ISSUE-001: EMS 算法产生严重货物重叠 (55+ 处)

| Field | Value |
|-------|-------|
| **Severity** | critical |
| **Category** | functional |
| **URL** | http://localhost:9876/index.html |
| **Repro Video** | N/A (algorithm-level, verified via eval) |

**Description**

20个 A (1.2×0.8×0.6m) + 50个 B (0.4×0.3×0.5m) 装入 20GP，自检发现 **55 处货物重叠**，`selfCheck.pass = false`。EMS 算法中的 `cutSpace` 产生重叠子空间，`mergeSpaces` 无法合并重叠区域，导致后续货物被放置在已被占用的坐标上。autoRetry 重算后重叠依旧存在，无法自动修复。

**Evidence (browser eval)**

```js
PackingEngine.calculate(items, "20GP", {tolerance:0.05, autoRetry:true})
// → checks[0]: { errors: [{ type:"overlap", message:"检测到 55 处货物重叠" }], pass: false }
```

**Root Cause**
`cutSpace()` 在创建"前方空间"时，只取了货物宽度范围（`pl`），同时在右侧又创建了"右侧前方"空间。这两个空间在X和Y方向上都会重叠：
- 前方空间：`{x:space.x, y:fy, L:pl, W:space.y+space.W-fy}` → 包含了右侧空间的区域
- 右侧前方空间：`{x:rx, y:fy, L:space.x+space.L-rx, W:space.y+space.W-fy}` → 与前方空间的X范围重叠

`mergeSpaces()` 只能合并相邻（touching edges）的空间，无法处理重叠区域。

**Repro Steps**

1. 加载页面 → 控制台无错误
2. 通过 eval 调用 `PackingEngine.calculate(...)` 
3. 观察：55 处重叠，pass=false

---

### ISSUE-002: autoRetry 无法修复重叠 → 用户看不到任何货物

| Field | Value |
|-------|-------|
| **Severity** | critical |
| **Category** | functional |
| **URL** | http://localhost:9876/index.html |

**Description**

自检发现重叠后，autoRetry 触发 `recalibrate()` 重算，但重算后的结果依然有相同数量的重叠。这导致自检 fail → 重算 → 仍然 fail 的死循环。用户最终看不到任何有效装箱结果。**在之前的 Node.js 测试中，当 autoRetry 禁用时 0 件货物被放置，说明重算逻辑在某些路径下会清空所有已放置货物。**

**Evidence**

autoRetry=true: placed=70, overlaps=55
autoRetry=false: placed=0, overlaps=0 (all items removed by recalibrate)

---

### ISSUE-003: "重量(kg)" 列被错误映射为 quantity

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **URL** | http://localhost:9876/index.html |

**Description**

CSV 表头 "重量(kg)" 被 FieldParser 映射到 `quantity` 字段（confidence: medium），而非 `weight`。因为关键词匹配中 "量" 命中了数量模式。导致所有货物的 `weight = 0`，装箱时容器载重约束完全失效，超重风险无法检测。

**Evidence**

```js
FieldParser.parseFile(csvData, "test.csv")
// mapping: [{ header:"重量(kg)", field:"quantity", confidence:"medium" }]
// All items: weight = 0
```

实际测试数据中 BOX-C 单重 500kg × 5件 = 2500kg，但 weight 字段全部为 0。

---

### ISSUE-004: "可叠放" 列无法识别 → 不可叠放货物被标记为可叠放

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional |
| **URL** | http://localhost:9876/index.html |

**Description**

CSV 表头 "可叠放"（值：是/否）被映射为 `unknown`（confidence: low），FieldParser 不识别此中文关键词。导致重型设备（BOX-C, 不可叠放）和长管（PIPE-1, 不可叠放）在装箱时全部被当作可叠放处理，算法会将其他货物堆叠在不可叠放货物上方。

**Evidence**

```js
// mapping: [{ header:"可叠放", field:"unknown", confidence:"low" }]
// PIPE-1: stackable = true (应该是 false)
// BOX-C: stackable = true (应该是 false)
```

---

### ISSUE-005: OT 门约束中宽度检查被 Infinity 绕过

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | functional |
| **URL** | http://localhost:9876/index.html |

**Description**

OT 集装箱 `doorH = Infinity` 但 `doorW = 2.34`。在 `checkDoorConstraint` 中：

```js
minDim <= Math.min(effDoorW, effDoorH) && maxDim <= Math.max(effDoorW, effDoorH)
```

`Math.max(effDoorW, effDoorH)` = `Math.max(2.29, Infinity)` = `Infinity`，导致任何货物的 `maxDim` 都能通过（因为 `any_number <= Infinity` 永远为 true）。虽然 `minDim <= 2.29` 仍然有效，但当货物的短边 ≤ 门宽时就能通过——这包括了少量合理但危险的边缘情况：货物 2.29 × 100（极长），短边 2.29 ≤ 2.29 通过。

**Fix:** OT 门约束应分开检查宽高：对 OT，只检查 `min(l,w) <= effDoorW`。

---

### ISSUE-006: FieldParser 不识别常见的 "重量(kg)" / "可叠放" 等中文表头

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | functional |

**Description**

`field-parser.js` 的关键词匹配表缺少对中国物流行业常用表头的覆盖：
- "重量(kg)" → 应映射到 weight
- "可叠放" → 应映射到 stackable  
- "是否可叠放" → 同上
- "单重" / "单件重量" → 同上

用户上传装箱单后，需要在 Step 2 手动修正列映射。但默认映射错误会导致新手用户直接点"确认数据"，使用错误的 weight 和 stackable 值进行装箱。

---

### ISSUE-007: `JSON.stringify` 序列化 Infinity 为 null 导致调试困难

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | ux |
| **URL** | http://localhost:9876/index.html |

**Description**

`container-db.js` 使用 `Infinity` 表示 FR 柜无门约束、OT 柜无高度约束。但 `JSON.stringify(Infinity)` 返回 `"null"`，导致：
- API 返回的 JSON 中 doorH 显示为 null
- 调试/日志中难以区分 "null = 无限" 和 "null = 未定义"
- 如果有后端 API 传输，反序列化后 null != Infinity

---

## Additional Observations (非 bug，建议改进)

### A. agent-browser 与文件上传交互问题
- `agent-browser upload` 将文件写入 `<input type="file">` 但不触发 `change` 事件，需要手动 `dispatchEvent`
- `handleFileUpload` 函数签名接受 File 对象而非 Event 对象，通过 eval 调用时需要注意

### B. 页面首检
- 页面加载正常，无 JS 错误
- 控制台只有 `📦 Container Loading Simulator — ready ✨`
- 所有全局模块正确加载：XLSX, ContainerDB, FieldParser, PackingEngine, PdfExporter, App, ThreeViewer

### C. 容器推荐工作正常
- `ContainerDB.recommendContainer` 正确返回 primary + alternatives
- 20GP 正确推荐为大部分货物的首选

### D. 层铺逻辑改进确认
- 非叠放货物 `maxLayers` 正确限制为 1
- `blockedAbove` 标志在 EMS 重建后正确恢复

---

## Priority Fix Order

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 1 | ISSUE-001: EMS 重叠 | High | 核心算法无意义 |
| 2 | ISSUE-003: 重量列映射 | Low | 载重约束失效 |
| 3 | ISSUE-004: 可叠放列映射 | Low | 叠放约束失效 |
| 4 | ISSUE-005: OT 门约束绕过 | Medium | 边界场景错误 |
| 5 | ISSUE-002: autoRetry 死循环 | Medium | 依赖 #1 修复 |
| 6 | ISSUE-006: 关键词表扩展 | Low | 用户体验 |
| 7 | ISSUE-007: Infinity 序列化 | Low | 调试体验 |