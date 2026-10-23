// 审阅探针批次5：列识别深挖（test-packing-list.xlsx）
const fs = require('fs'), vm = require('vm');
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const XLSX = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/node_modules/xlsx');
const ctx = createRuntime([]);
ctx.XLSX = XLSX;
vm.runInContext(fs.readFileSync('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/field-parser.js', 'utf8'), ctx, { filename: 'field-parser.js' });
const FP = ctx.FieldParser;

const buf = fs.readFileSync('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/test-packing-list.xlsx');
const res = FP.parseFile(buf, 'test-packing-list.xlsx');

console.log('=== 列映射（列名 → 识别字段）===');
res.mapping.forEach(m => console.log(`  [${m.index}] "${m.header}" → ${m.field} (${m.confidence})`));

console.log('\n=== 解析出的 items ===');
res.items.forEach(i => console.log(`  ${i.model}: ${i.l}×${i.w}×${i.h}m qty=${i.quantity} wt=${i.weight}kg`));

console.log('\n=== warnings ===');
res.warnings.forEach(w => console.log('  -', w));
