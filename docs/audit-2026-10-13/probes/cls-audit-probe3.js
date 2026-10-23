// 审阅探针批次3：解析层
// 3a. cleanMergedRows 相邻全等行去重是否误删真实数据行
// 3b. 无重量列时的实际行为（weight=0?）
const fs = require('fs'), vm = require('vm');
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const XLSX = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/node_modules/xlsx');

const ctx = createRuntime([]);
ctx.XLSX = XLSX;
vm.runInContext(fs.readFileSync('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/field-parser.js', 'utf8'), ctx, { filename: 'field-parser.js' });
const FP = ctx.FieldParser;

function makeXlsx(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

console.log('========== 3a: 相邻相同数据行 ==========');
{
  const aoa = [
    ['型号', '长(mm)', '宽(mm)', '高(mm)', '数量', '重量(kg)'],
    ['BOX-A', 1200, 800, 600, 10, 250],
    ['BOX-A', 1200, 800, 600, 10, 250],   // 与上一行完全相同的真实数据行
    ['BOX-B', 500, 400, 300, 5, 20],
  ];
  const res = FP.parseFile(makeXlsx(aoa), 'test.xlsx');
  console.log('  输入 3 行数据（其中两行相同）→');
  console.log('  items:', JSON.stringify(res.items.map(i => ({ model: i.model, qty: i.quantity }))));
  console.log('  总件数:', res.items.reduce((s, i) => s + i.quantity, 0), '（期望 25 = 10+10+5）');
  console.log('  totalDataRows:', res.totalDataRows, '（期望 3）');
}

console.log('\n========== 3a2: 带序号列的相同行（对照组）==========');
{
  const aoa = [
    ['序号', '型号', '长(mm)', '宽(mm)', '高(mm)', '数量', '重量(kg)'],
    [1, 'BOX-A', 1200, 800, 600, 10, 250],
    [2, 'BOX-A', 1200, 800, 600, 10, 250],
    [3, 'BOX-B', 500, 400, 300, 5, 20],
  ];
  const res = FP.parseFile(makeXlsx(aoa), 'test.xlsx');
  console.log('  items:', JSON.stringify(res.items.map(i => ({ model: i.model, qty: i.quantity }))));
  console.log('  总件数:', res.items.reduce((s, i) => s + i.quantity, 0), '（期望 25）');
}

console.log('\n========== 3b: 无重量列 ==========');
{
  const aoa = [
    ['型号', '长(mm)', '宽(mm)', '高(mm)', '数量'],
    ['C1', 1200, 800, 600, 10],
    ['C2', 2000, 1000, 1000, 3],
  ];
  const res = FP.parseFile(makeXlsx(aoa), 'test.xlsx');
  console.log('  items:', JSON.stringify(res.items.map(i => ({ model: i.model, weight: i.weight }))));
  console.log('  warnings:', JSON.stringify(res.warnings));
}

console.log('\n========== 3c: 多 Sheet 合并 ==========');
{
  const ws1 = XLSX.utils.aoa_to_sheet([['型号', '长(mm)', '宽(mm)', '高(mm)', '数量', '重量(kg)'], ['A', 1000, 500, 500, 2, 10]]);
  const ws2 = XLSX.utils.aoa_to_sheet([['型号', '长(mm)', '宽(mm)', '高(mm)', '数量', '重量(kg)'], ['B', 900, 500, 500, 3, 12]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'S1');
  XLSX.utils.book_append_sheet(wb, ws2, 'S2');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const res = FP.parseFile(buf, 'test.xlsx');
  console.log('  items:', JSON.stringify(res.items.map(i => ({ model: i.model, qty: i.quantity }))));
  console.log('  （期望 A×2 + B×3）');
}
