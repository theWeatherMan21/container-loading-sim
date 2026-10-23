# 修复计划：集装箱装箱模拟系统辩证性修复

## 1. Summary

基于上一轮审阅，当前系统核心装箱算法已恢复健康（70 件测试无重叠、无超界），但存在一个高影响功能性 bug：`container-db.js` 中 OT 集装箱类型检查使用了错误的字符串 `'opentop'`，而数据库实际值为 `'openTop'`，导致 OT 门约束完全失效、超宽货物无法被推荐到 FR 框架柜。本计划将修复该 bug，并顺带清理已确认的死代码与测试基础设施问题，最后通过辩证性验证确认修复效果。

## 2. Current State Analysis

### 2.1 已验证的健康点
- `packing-engine.js`：EMS + 层铺混合算法在 20A + 50B 标准测试用例下，70 件全部装入 1 个 20GP，自检无错误、无重叠、无超界。
- `field-parser.js`：中文表头识别已覆盖“重量(kg)”、“毛重(kg)”、“可叠放”、“是否可叠放”、“单重”、“单件重量”、“尺寸”等，映射正确。
- `app.js`：上轮报告中的 `_calculating` 未清除、`useMixed` 强制重置问题已修复。

### 2.2 待修复问题
| 优先级 | 文件 | 问题 | 影响 |
|---|---|---|---|
| P0 | `container-db.js` | `checkDoorConstraint` 将 `container.type === 'opentop'` 与数据库 `'openTop'` 比较，永远为 false | OT 门约束失效，超宽货物误分类为 OT，FR 推荐失败 |
| P1 | `container-db.js` | `getOrientations` 第 227 行 `{ l, w, h: h }` 与上一行重复 | 死代码，浪费计算 |
| P1 | `field-parser.js` | `COMBINED_DIM_PATTERN` 常量定义后未使用，实际使用内联正则 | 维护漂移风险 |
| P1 | `dogfood-output/run-core-tests.js` | 未 mock `XLSX` 全局对象，CSV 解析测试抛错 | 测试假阳性，无法建立绿色基线 |
| P2 | `packing-engine.js` | `dblScore` 中 `yScore` 未乘权重系数，Y 方向优先级与 X 接近 | 装箱宽度分布可能不均 |

### 2.3 不在本次计划内
- `layerPack` 全量重建 EMS 的性能优化：属于性能债务，当前正确性已保证，暂不动。
- `app.js` 内联样式重构：属于代码风格债务，不影响功能。
- `autoRetry` 结果比较优化：属于增强，当前重算逻辑已能工作。

## 3. Proposed Changes

### 3.1 修复 OT 类型拼写错误（P0）

**文件：** `container-db.js`  
**位置：** 第 145 行  
**修改内容：**
```javascript
// before
if (container.type === 'opentop') {

// after
if (container.type === 'openTop') {
```
**原因：** 数据库中 `20OT` / `40OT` 的 `type` 字段为 `'openTop'`（驼峰），原代码 `'opentop'` 全小写导致比较永远失败，OT 被当作标准柜处理。由于 `doorH = Infinity`，标准柜分支会错误地让任意货物通过门约束。

### 3.2 增加 OT/FR 门约束与推荐回归测试（P0）

**文件：** `dogfood-output/run-core-tests.js`  
**位置：** 在“集装箱数据库测试”区块中新增测试用例  
**新增内容：**
1. OT 应允许高度超限但宽度合规的货物通过。
2. OT 应拒绝宽度超过门宽的货物。
3. 超宽货物（如 5×3×2 m）应被推荐到 FR 框架柜。

**原因：** 防止未来对 `checkDoorConstraint` 或 `classifyItemByContainerType` 的改动再次破坏 OT/FR 分支。

### 3.3 修复测试脚本的 XLSX mock（P1）

**文件：** `dogfood-output/run-core-tests.js`  
**位置：** 模块加载之前  
**修改内容：** 在 `require` 之前给 `global.XLSX` 一个最小 mock，使 `field-parser.js` 的 CSV 路径能正常执行。

最小 mock 示例：
```javascript
global.XLSX = {
  read: (data, opts) => {
    const text = opts.type === 'string'
      ? data
      : new TextDecoder().decode(new Uint8Array(data));
    const lines = text.split('\n').filter(l => l.trim());
    const rows = lines.map(l => l.split(','));
    return { SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } };
  },
  utils: {
    sheet_to_json: (sheet, opts) => {
      // 根据 sheet 引用返回 rows；实际测试中直接构造即可
    }
  }
};
```

**原因：** 当前脚本直接报错“XLSX is not defined”，导致 CSV 解析测试无法真实反映 `field-parser.js` 状态。

### 3.4 清理 getOrientations 死代码（P1）

**文件：** `container-db.js`  
**位置：** 第 225–233 行  
**修改内容：** 删除重复方向 `{ l, w, h: h }` 及其注释。

**原因：** 该方向与 `{ l, w, h }` 完全相同，靠 filter 去重不是必要成本。

### 3.5 统一组合尺寸正则（P1）

**文件：** `field-parser.js`  
**位置：** 第 29 行常量、第 531 行内联正则  
**修改内容：** 将第 531 行内联正则替换为 `COMBINED_DIM_PATTERN` 的使用，必要时给 `COMBINED_DIM_PATTERN` 添加捕获组版本，或保留内联但删除未使用的常量。

**决策：** 优先选择“使用常量”，即把 `COMBINED_DIM_PATTERN` 改为带捕获组的版本：
```javascript
const COMBINED_DIM_PATTERN = /^([\d]+(?:\.[\d]+)?)\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)$/;
```
然后在第 531 行使用 `cleaned.match(COMBINED_DIM_PATTERN)`。

**原因：** 消除常量与实现不一致，降低未来维护成本。

### 3.6 修复 dblScore Y 方向权重（P2）

**文件：** `packing-engine.js`  
**位置：** 第 20 行常量、第 234 行  
**修改内容：**
```javascript
// before
DBL_Y_WEIGHT: 1,
return zScore * CONSTANTS.DBL_Z_WEIGHT + xScore * CONSTANTS.DBL_X_WEIGHT + yScore * CONSTANTS.DBL_Y_WEIGHT;

// after
DBL_Y_WEIGHT: 10,
return zScore * CONSTANTS.DBL_Z_WEIGHT + xScore * CONSTANTS.DBL_X_WEIGHT + yScore * CONSTANTS.DBL_Y_WEIGHT;
```

**原因：** 原代码中 `yScore` 范围 [0,1] 与 `xScore * 10` 范围 [0,10] 同级，无法体现 DBL“z > x > y”的优先级。乘以 10 后 y 方向优先级低于 x，但仍有区分。

## 4. Assumptions & Decisions

1. **不改数据库 type 字段：** 现有数据库使用驼峰 `openTop`、`flatRack` 是既定约定，修复检查字符串比改数据库更保守、风险更低。
2. **不改 `flatrack` 检查：** 第 142 行 `container.type === 'flatrack'` 同样存在大小写不一致风险，但数据库中 FR 的 `type` 是 `'flatRack'`，该检查实际也失效，只是 FR 分支后续走标准柜逻辑时因 `doorW/H = Infinity` 自然通过。本次一并检查并修复为 `'flatRack'`。
3. **测试脚本继续用 Node.js：** 暂时不引入 Jest/Mocha，仅修复现有脚本的 mock 与用例，保持改动最小。
4. **不优化层铺性能：** 全量重建 EMS 是当前正确性保障，本次不动。

## 5. Verification Steps

1. **单元测试脚本全绿：**
   ```bash
   cd /Users/russospencer/Documents/trae_projects/ContainerLoadingSim
   node dogfood-output/run-core-tests.js
   ```
   预期：0 critical / 0 high issue，所有既有测试通过，新增 OT/FR 测试通过。

2. **OT 门约束辩证验证：**
   ```javascript
   CDB.checkDoorConstraint({l:5.0,w:2.3,h:3.0}, CDB.CONTAINER_DB['20OT'], 0.05) // pass: true
   CDB.checkDoorConstraint({l:1.0,w:2.5,h:2.0}, CDB.CONTAINER_DB['20OT'], 0.05) // pass: false
   ```

3. **FR 推荐辩证验证：**
   ```javascript
   CDB.recommendContainer([{model:'WIDE', l:5.0, w:3.0, h:2.0, quantity:1, weight:5000}])
   // primary.type === 'flatRack'
   ```

4. **核心装箱算法回归：**
   运行 `debug-overlap.js` 或 `run-core-tests.js` 中的装箱测试，确认：
   - 70 件全部放置
   - 0 重叠
   - 0 超界
   - 不可叠放货物上方无其他货物

5. **字段解析回归：**
   运行 `field-check.js`，确认：
   - “重量(kg)” → grossWeight
   - “可叠放” → stackable
   - 组合尺寸拆分仍然工作

6. **浏览器端端到端（可选，有时间则做）：**
   启动本地服务器，用 `e2e_test.py` 跑一遍完整流程，确认 Step 1 → Step 4 无 JS 错误、3D 视图正常、PDF 导出正常。
