// 审阅探针批次6：正确解析下的推荐预期（修复演示）
// 从 test-packing-list.xlsx 按"正确列映射"构造 items，跑 autoRecommend
const fs = require('fs');
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const XLSX = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/node_modules/xlsx');
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;

// dump 全部行先看看
const wb = XLSX.readFile('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/test-packing-list.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log('=== 全部 15 行 ===');
rows.forEach((r, i) => console.log(i, JSON.stringify(r).slice(0, 160)));

// 正确映射：col1=名称, col4=L(mm), col5=W, col6=H, col3=Gross(kg)
const items = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length < 7) continue;
  const name = String(r[1] || '').trim();
  const gross = Number(r[3]);
  const L = Number(r[4]), W = Number(r[5]), H = Number(r[6]);
  if (!name || !isFinite(L) || !isFinite(W) || !isFinite(H) || L <= 0) continue;
  items.push({ model: name.slice(0, 24), l: L / 1000, w: W / 1000, h: H / 1000, weight: gross, quantity: 1 });
}
console.log('\n=== 正确解析的 items ===');
items.forEach(i => console.log(`  ${i.model}: ${i.l}×${i.w}×${i.h} @ ${i.weight}kg`));

const rec = CDB.autoRecommend(items, 0.05);
console.log('\n=== autoRecommend（正确解析）===');
console.log('  type:', rec.type);
console.log('  primary:', rec.primary ? rec.primary.code : '-');
console.log('  reasoning:', rec.reasoning);
if (rec.mixed) console.log('  mixed:', rec.mixed.description);
console.log('  总重:', items.reduce((s, i) => s + i.weight, 0), 'kg');

// 混合全箱型可计算性验证
const ALL = Object.values(CDB.CONTAINER_DB);
try {
  const r = PE.calculate(items, null, { mixedContainers: ALL, tolerance: 0.05 });
  console.log('\n=== 混合计算（全箱型可选）===');
  console.log('  containers:', r.containers.map(c => `${c.containerCode}(${c.placedItems.length}件,${(c.utilization * 100).toFixed(0)}%)`).join(', '));
  console.log('  unplaced:', r.unplacedCount, '/', r.totalItems);
} catch (e) {
  console.log('混合计算报错:', e.message);
}
