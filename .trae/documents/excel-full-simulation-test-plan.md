# 计划：使用目录下 Excel 文件进行全实操模拟测试

## 1. 摘要

使用项目目录下现有文件 `土耳其货物明细(1).xlsx` 作为输入，端到端跑通 ContainerLoadingSim 的完整流程：

```
上传/解析 Excel → 列映射确认 → 单位确认 → SKU 属性确认 → 箱型推荐 → 3D 装箱计算 → 结果验证与报告
```

目标是：
- 验证字段解析器对真实中文表头的识别准确率
- 验证单位推断、多尺寸消歧、重量/尺寸解析
- 验证箱型推荐与 3D 装箱算法在真实货物数据上的表现
- 输出一份可复现的测试报告

## 2. 当前状态分析

### 2.1 输入文件

- **文件路径**：`/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/土耳其货物明细(1).xlsx`
- **文件类型**：`.xlsx`（Excel 2007+）
- **预期内容**：土耳其货物装箱明细，包含型号、尺寸、数量、重量等字段

### 2.2 系统解析链路

```
Excel 文件
  → FileReader.readAsArrayBuffer()
  → FieldParser.parseFile(data, fileName)
    → XLSX.read(data, { type: 'array', raw: true })
    → XLSX.utils.sheet_to_json(sheet, { header: 1 })
    → detectHeader() 识别表头行
    → classifyColumns() 列语义映射
    → extractItems() 提取货物数据
      → 单位推断 mm/cm/m
      → 组合尺寸解析
      → 多尺寸消歧
    → detectMultiSize() 检测同一型号多组尺寸
  → App.handleFileUpload() 渲染 Step 2
  → App.confirmData() 应用用户映射/单位/多尺寸选择
  → App.renderStep3() 显示 SKU 属性表与箱型推荐
  → App.startCalculation() → PackingEngine.calculate()
  → App.renderStep4() 显示结果摘要、3D 视图、PDF 导出
```

### 2.3 测试策略选择

有两种执行方式：

| 方式 | 说明 | 优点 | 缺点 |
|---|---|---|---|
| A. 浏览器实操 | 启动本地 HTTP 服务器，用浏览器打开 `index.html`，人工/脚本上传 Excel | 最接近真实用户场景 | 依赖浏览器环境，不易自动断言 |
| B. Node 脚本模拟 | 直接调用 `FieldParser.parseFile()` + `ContainerDB.autoRecommend()` + `PackingEngine.calculate()` | 可完全自动化、易断言、可复现 | 跳过 UI 交互层 |

**推荐方式 B 作为主力**，辅以方式 A 做 UI 冒烟。因为用户要求"全实操模拟测试并返回结果"，核心关注数据流转与计算结果，而非 UI 动画。

## 3. 建议的测试步骤

### 阶段一：准备 Node 测试脚本

#### 3.1 创建测试脚本

- **文件**：`dogfood-output/run-excel-simulation.js`
- **内容**：
  1. 使用 `fs.readFileSync()` 读取 `土耳其货物明细(1).xlsx` 为 Buffer。
  2. 由于 `FieldParser.parseFile()` 内部依赖浏览器全局 `XLSX`，需要在 Node 环境中注入 `global.XLSX = require('./vendor/xlsx.full.min.js')`。
  3. 调用 `FieldParser.parseFile(buffer, '土耳其货物明细(1).xlsx')`。
  4. 打印解析结果：工作表数、表头行、列映射、识别出的 SKU、数量、尺寸、重量、单位。
  5. 检查是否有 `result.error` 或 `result.warnings`。

#### 3.2 验证字段映射

- 检查 `result.mapping` 是否正确识别出：
  - 型号 → `model`
  - 长/宽/高 → `length` / `width` / `height`（或组合尺寸 `combinedDimension`）
  - 数量 → `quantity`
  - 毛重/重量 → `grossWeight`
- 对于识别置信度为 `low` 的列，记录并人工判断。

#### 3.3 验证单位推断

- 调用 `FieldParser.inferUnit()` 对尺寸列数值进行推断。
- 检查推断结果是否符合实际（mm/cm/m）。
- 如推断错误，在报告中标注，并说明需要用户在 Step 2 手动修正。

### 阶段二：模拟完整计算流程

#### 3.4 构建 items

- 使用 `parseFile` 返回的 `result.items`。
- 对每个 item 打印：
  - model
  - l, w, h（米）
  - quantity
  - weight
  - stackable
  - orientationFixed

#### 3.5 箱型推荐

- 调用 `ContainerDB.autoRecommend(items, tolerance=0.05)`。
- 记录推荐结果：
  - `type`: 'single' / 'mixed' / 'failed'
  - `primary`: 主箱型
  - `alternatives`: 备选箱型
  - `reasoning`: 推荐理由

#### 3.6 3D 装箱计算

- 调用 `PackingEngine.calculate(items, primaryContainer, { tolerance: 0.05, autoRetry: true })`。
- 如果推荐为 mixed，调用 `PackingEngine.calculate(items, null, { mixedContainers: specs, tolerance: 0.05 })`。
- 记录结果：
  - 所需箱数
  - 平均利用率
  - 已装件数 / 总件数
  - 总重量
  - warnings / errors

#### 3.7 自检

- 调用 `PackingEngine.selfCheck(result)` 或检查 `result.errors`。
- 确认无重叠、无超界。

### 阶段三：浏览器端冒烟（可选但建议）

#### 3.8 启动本地服务器

```bash
python3 -m http.server 8000
```

#### 3.9 打开浏览器并上传 Excel

- 访问 `http://localhost:8000/index.html`
- 上传 `土耳其货物明细(1).xlsx`
- 检查是否能正常进入 Step 2、Step 3、Step 4
- 截图保存到 `dogfood-output/screenshots/`

### 阶段四：生成测试报告

#### 3.10 输出报告

- **文件**：`dogfood-output/excel-simulation-report.md`
- **内容**：
  - 测试文件信息
  - 解析结果摘要
  - 列映射详情
  - 单位推断结果
  - 箱型推荐结果
  - 装箱计算结果
  - 自检结果
  - 发现的问题与建议
  - 截图（如有浏览器测试）

## 4. 假设与决策

1. **XLSX 库在 Node 可用**：`vendor/xlsx.full.min.js` 是 UMD 格式，应可在 Node 中 `require`。若不可行，则改用 npm 安装 `xlsx` 或调整加载方式。
2. **直接调用内部 API 可接受**：为了自动化测试，跳过 UI 层直接调用 `FieldParser` / `ContainerDB` / `PackingEngine` 的全局方法。
3. **不做列映射人工修正**：测试中不模拟用户在 Step 2 调整列映射的行为；若自动映射错误，作为问题记录。
4. **不修改生产代码**：本次为测试任务，仅新增测试脚本和报告，不修改 `app.js` / `field-parser.js` / `packing-engine.js` / `container-db.js`。

## 5. 验证步骤

1. 运行 `node dogfood-output/run-excel-simulation.js`，确认无崩溃、无未捕获异常。
2. 检查解析出的货物数据是否符合 Excel 内容（型号、数量、尺寸、重量）。
3. 检查 `autoRecommend` 返回的主箱型是否合理。
4. 检查 `PackingEngine.calculate` 的结果：
   - `containerCount > 0`
   - `totalPlaced == totalItems`（或记录未放置原因）
   - `result.errors` 为空数组
5. 若执行浏览器测试，确认能完成 4 步流程并生成 3D 视图。
6. 检查生成的报告文件 `dogfood-output/excel-simulation-report.md` 内容完整。

## 6. 交付物

| 文件 | 说明 |
|---|---|
| `dogfood-output/run-excel-simulation.js` | 自动化测试脚本 |
| `dogfood-output/excel-simulation-report.md` | 测试报告 |
| `dogfood-output/screenshots/excel-step*.png` | 浏览器测试截图（如执行） |
