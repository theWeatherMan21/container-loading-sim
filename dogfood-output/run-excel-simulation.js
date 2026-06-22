/**
 * Excel 全实操模拟测试
 * 使用目录下 土耳其货物明细(1).xlsx 作为输入
 * 跑通 FieldParser → ContainerDB → PackingEngine 全链路
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..');
const outDir = path.resolve(__dirname);
const excelFile = path.join(srcDir, '土耳其货物明细(1).xlsx');
const reportFile = path.join(outDir, 'excel-simulation-report.md');

// ─── Mock browser globals ───
global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };
global.XLSX = require(path.join(srcDir, 'vendor/xlsx.full.min.js'));

// ─── Load modules ───
require(path.join(srcDir, 'container-db.js'));
require(path.join(srcDir, 'field-parser.js'));
require(path.join(srcDir, 'packing-engine.js'));

const CDB = global.ContainerDB;
const FP = global.FieldParser;
const PE = global.PackingEngine;

function pad(n) { return String(n).padStart(2, '0'); }
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDim(v) { return v.toFixed(3); }
function fmtWeight(v) { return v.toFixed(2); }

// ─── Parse Excel ───
console.log('Reading Excel:', excelFile);
const buffer = fs.readFileSync(excelFile);
console.log('File size:', (buffer.length / 1024).toFixed(1), 'KB');

let parseResult;
let parseError = null;
try {
  parseResult = FP.parseFile(buffer, '土耳其货物明细(1).xlsx');
} catch (e) {
  parseError = e;
}

if (parseError) {
  const report = `# Excel 模拟测试报告\n\n**测试时间：** ${nowStr()}\n\n**输入文件：** 土耳其货物明细(1).xlsx\n\n**状态：** ❌ 解析失败\n\n**错误：**\n\n\`\`\`\n${parseError.stack || parseError.message}\n\`\`\`\n`;
  fs.writeFileSync(reportFile, report);
  console.error('Parse failed:', parseError.message);
  process.exit(1);
}

if (parseResult.error) {
  const report = `# Excel 模拟测试报告\n\n**测试时间：** ${nowStr()}\n\n**输入文件：** 土耳其货物明细(1).xlsx\n\n**状态：** ❌ 解析返回错误\n\n**错误：** ${parseResult.error}\n`;
  fs.writeFileSync(reportFile, report);
  console.error('Parse returned error:', parseResult.error);
  process.exit(1);
}

// ─── Inspect parsed data ───
const items = parseResult.items || [];
const mapping = parseResult.mapping || [];
const warnings = parseResult.warnings || [];
const sheets = parseResult.sheets || [];

console.log('\nParsed summary:');
console.log('  Sheets:', sheets.length);
console.log('  Total data rows:', parseResult.totalDataRows);
console.log('  Items extracted:', items.length);
console.log('  Warnings:', warnings.length);

// ─── Unit inference (mirror app.js logic: header first, then numeric) ───
const dimIndices = mapping
  .filter(m => m.field === 'length' || m.field === 'width' || m.field === 'height' || m.field === 'combinedDimension')
  .map(m => m.index);

let inferredUnit = 'cm';
if (dimIndices.length > 0) {
  // 1. 优先从表头文字中检测单位
  const headerUnits = new Set();
  for (const idx of dimIndices) {
    const m = mapping.find(m => m.index === idx);
    const header = m ? (m.header || '') : '';
    const unit = FP.detectUnitFromHeader ? FP.detectUnitFromHeader(header) : null;
    if (unit) headerUnits.add(unit);
  }

  if (headerUnits.size === 1) {
    inferredUnit = [...headerUnits][0];
  } else {
    // 2. 数值推断
    const dimValues = [];
    for (const sheet of sheets) {
      const dataRows = sheet.data.slice(parseResult.headerRowIndex + 1);
      for (const row of dataRows) {
        for (const idx of dimIndices) {
          const v = row[idx];
          if (v != null && v !== '') {
            const n = FP.normalizeNumber ? FP.normalizeNumber(v) : parseFloat(v);
            if (!isNaN(n) && n > 0) dimValues.push(n);
          }
        }
      }
    }
    if (dimValues.length > 0) {
      inferredUnit = FP.inferUnit(dimValues);
    }
  }
}
console.log('  Inferred dimension unit:', inferredUnit);

// ─── Multi-size detection ───
const multiSize = FP.detectMultiSize(items);
const multiSizeModels = Object.keys(multiSize);
console.log('  Multi-size models:', multiSizeModels.length);

// ─── Container recommendation ───
let recResult = null;
let recError = null;
try {
  recResult = CDB.autoRecommend(items, 0.05);
} catch (e) {
  recError = e;
}

console.log('\nRecommendation:');
if (recError) {
  console.log('  Error:', recError.message);
} else if (!recResult || recResult.type === 'failed') {
  console.log('  Type: failed');
  console.log('  Reasoning:', recResult && recResult.reasoning ? recResult.reasoning : 'No result');
} else {
  console.log('  Type:', recResult.type);
  console.log('  Primary:', recResult.primary ? recResult.primary.code : 'N/A');
  console.log('  Reasoning:', recResult.reasoning);
}

// ─── Packing calculation ───
let packingResult = null;
let packingError = null;
if (recResult && (recResult.primary || recResult.mixed)) {
  const calcOptions = { tolerance: 0.05, autoRetry: true };
  let containerSpecOrNull = null;
  if (recResult.type === 'mixed' && recResult.mixed && recResult.mixed.specs) {
    calcOptions.mixedContainers = recResult.mixed.specs;
  } else if (recResult.primary) {
    containerSpecOrNull = recResult.primary;
  }
  try {
    packingResult = PE.calculate(items, containerSpecOrNull, calcOptions);
  } catch (e) {
    packingError = e;
  }
}

console.log('\nPacking result:');
if (packingError) {
  console.log('  Error:', packingError.message);
} else if (packingResult) {
  console.log('  Containers:', packingResult.containerCount);
  console.log('  Avg utilization:', ((packingResult.avgUtilization || 0) * 100).toFixed(1) + '%');
  console.log('  Total placed:', packingResult.totalPlaced, '/', items.reduce((s, i) => s + (i.quantity || 1), 0));
  console.log('  Errors:', (packingResult.errors || []).length);
}

// ─── Build report ───
let report = `# Excel 模拟测试报告\n\n`;
report += `**测试时间：** ${nowStr()}\n\n`;
report += `**输入文件：** 土耳其货物明细(1).xlsx\n\n`;
report += `**文件大小：** ${(buffer.length / 1024).toFixed(1)} KB\n\n`;
report += `**状态：** ✅ 解析成功\n\n`;

report += `## 1. 解析结果摘要\n\n`;
report += `- 工作表数：${sheets.length}\n`;
report += `- 表头行索引：${parseResult.headerRowIndex}\n`;
report += `- 数据总行数：${parseResult.totalDataRows}\n`;
report += `- 提取货物 SKU 数：${items.length}\n`;
report += `- 单位推断结果：**${inferredUnit}**\n`;
report += `- 多尺寸歧义 SKU 数：${multiSizeModels.length}${multiSizeModels.length > 0 ? '（' + multiSizeModels.join(', ') + '）' : ''}\n`;
report += `- 解析警告数：${warnings.length}\n`;
if (warnings.length > 0) {
  report += `  - ${warnings.join('\n  - ')}\n`;
}
report += `\n`;

report += `## 2. 列映射详情\n\n`;
report += `| 列序号 | 表头名称 | 映射字段 | 置信度 | 样本值 |\n`;
report += `| --- | --- | --- | --- | --- |\n`;
for (const m of mapping) {
  const sample = m.sample ? String(m.sample).replace(/\|/g, '\\|').substring(0, 40) : '—';
  report += `| ${m.index + 1} | ${m.header || '—'} | ${m.field || 'unknown'} | ${m.confidence || 'low'} | ${sample} |\n`;
}
report += `\n`;

report += `## 3. 提取货物明细\n\n`;
report += `| 序号 | 型号 | 长(m) | 宽(m) | 高(m) | 数量 | 单重(kg) | 可叠放 | 仅可水平旋转 |\n`;
report += `| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
items.forEach((item, idx) => {
  report += `| ${idx + 1} | ${item.model || '—'} | ${fmtDim(item.l)} | ${fmtDim(item.w)} | ${fmtDim(item.h)} | ${item.quantity || 1} | ${fmtWeight(item.weight || 0)} | ${item.stackable !== false ? '是' : '否'} | ${item.orientationFixed ? '是' : '否'} |\n`;
});
report += `\n`;

report += `## 4. 箱型推荐结果\n\n`;
if (recError) {
  report += `**状态：** ❌ 推荐失败\n\n**错误：**\n\n\`\`\`\n${recError.stack || recError.message}\n\`\`\`\n\n`;
} else if (!recResult || recResult.type === 'failed') {
  report += `**状态：** ❌ 无合适箱型\n\n`;
  report += `**原因：** ${recResult && recResult.reasoning ? recResult.reasoning : '推荐返回为空'}\n\n`;
} else {
  report += `**推荐类型：** ${recResult.type === 'single' ? '单箱型' : '混合箱型'}\n\n`;
  report += `**主箱型：** ${recResult.primary ? recResult.primary.code + '（' + recResult.primary.nameCN + '）' : 'N/A'}\n\n`;
  if (recResult.alternatives && recResult.alternatives.length > 0) {
    report += `**备选箱型：** ${recResult.alternatives.map(c => c.code).join(', ')}\n\n`;
  }
  if (recResult.mixed && recResult.mixed.description) {
    report += `**混合方案：** ${recResult.mixed.description}\n\n`;
  }
  report += `**推荐理由：** ${recResult.reasoning}\n\n`;
}

report += `## 5. 3D 装箱计算结果\n\n`;
if (packingError) {
  report += `**状态：** ❌ 计算失败\n\n**错误：**\n\n\`\`\`\n${packingError.stack || packingError.message}\n\`\`\`\n\n`;
} else if (packingResult) {
  report += `**状态：** ✅ 计算完成\n\n`;
  report += `| 指标 | 数值 |\n`;
  report += `| --- | --- |\n`;
  report += `| 使用箱数 | ${packingResult.containerCount} |\n`;
  report += `| 平均利用率 | ${((packingResult.avgUtilization || 0) * 100).toFixed(1)}% |\n`;
  report += `| 已装件数 | ${packingResult.totalPlaced} / ${items.reduce((s, i) => s + (i.quantity || 1), 0)} |\n`;
  report += `| 总装载重量 | ${(packingResult.totalWeightLoaded / 1000).toFixed(2)} 吨 |\n`;
  report += `| 错误数 | ${(packingResult.errors || []).length} |\n`;
  report += `| 警告数 | ${(packingResult.warnings || []).length} |\n`;
  report += `\n`;

  if ((packingResult.errors || []).length > 0) {
    report += `### 错误详情\n\n`;
    for (const err of packingResult.errors) {
      report += `- ❌ ${err}\n`;
    }
    report += `\n`;
  }
  if ((packingResult.warnings || []).length > 0) {
    report += `### 警告详情\n\n`;
    for (const w of packingResult.warnings) {
      report += `- ⚠️ ${w}\n`;
    }
    report += `\n`;
  }

  report += `### 分箱详情\n\n`;
  report += `| 箱号 | 箱型 | 利用率 | 装载件数 | 装载重量(kg) |\n`;
  report += `| --- | --- | --- | --- | --- |\n`;
  if (packingResult.containers) {
    packingResult.containers.forEach((c, idx) => {
      report += `| ${idx + 1} | ${c.containerCode || '—'} | ${((c.utilization || 0) * 100).toFixed(1)}% | ${c.placedItems ? c.placedItems.length : 0} | ${(c.totalWeight || 0).toFixed(0)} |\n`;
    });
  }
  report += `\n`;

  if (packingResult.unplacedCount > 0) {
    report += `### 未放置货物\n\n`;
    report += `**未放置件数：** ${packingResult.unplacedCount}\n\n`;
    if (packingResult.unplacedItems && packingResult.unplacedItems.length > 0) {
      report += `**未放置型号：** ${[...new Set(packingResult.unplacedItems)].join(', ')}\n\n`;
    }
    report += `\n`;
  }
} else {
  report += `**状态：** ⏭️ 未执行（推荐失败或无可用箱型）\n\n`;
}

report += `## 6. 发现与建议\n\n`;
const findings = [];
if (warnings.length > 0) findings.push('解析阶段存在警告，建议检查列映射。');
if (multiSizeModels.length > 0) findings.push('存在同一型号多组尺寸，实际使用时需在 Step 2 选择正确尺寸。');
if (recResult && recResult.type === 'failed') findings.push('系统无法为当前货物推荐可用箱型，请检查尺寸/重量是否异常。');
if (packingResult && (packingResult.errors || []).length > 0) findings.push('装箱计算存在错误，需排查重叠/超界/超重问题。');
if (packingResult && packingResult.totalPlaced < items.reduce((s, i) => s + (i.quantity || 1), 0)) findings.push('部分货物未能放置，可能需要更多集装箱或调整货物参数。');
if (findings.length === 0) findings.push('全流程无异常，可直接用于业务参考。');
report += findings.map(f => `- ${f}`).join('\n') + '\n\n';

report += `---\n\n*本报告由 dogfood-output/run-excel-simulation.js 自动生成。*\n`;

fs.writeFileSync(reportFile, report);
console.log('\nReport written to:', reportFile);
