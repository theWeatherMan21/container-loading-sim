/**
 * 诊断脚本 #2 — 装箱过程逐件追踪
 */
const { createRuntime } = require('./_load-runtime');
const ctx = createRuntime(['container-db.js', 'field-parser.js', 'packing-engine.js']);

const PE = ctx.window.PackingEngine;
const CDB = ctx.window.ContainerDB;
const pad = (s, n) => String(s).padEnd(n);

const testCargo = [
  { model: 'Generator-Set',       l: 4.80, w: 1.85, h: 2.05, weight: 6200, quantity: 2,  stackable: false, orientationFixed: true,  colorIndex: 0 },
  { model: 'HVAC-Unit',           l: 1.85, w: 0.95, h: 2.15, weight: 850,  quantity: 4,  stackable: false, orientationFixed: true,  colorIndex: 1 },
  { model: 'Aluminum-Coil',       l: 1.45, w: 1.45, h: 0.80, weight: 3200, quantity: 8,  stackable: false, orientationFixed: false, colorIndex: 2 },
  { model: 'Steel-Plate-Bundle',  l: 2.50, w: 1.20, h: 0.15, weight: 2800, quantity: 12, stackable: true,  orientationFixed: false, colorIndex: 3 },
  { model: 'Wooden-Pallet-Tiles', l: 1.20, w: 1.00, h: 0.90, weight: 620,  quantity: 36, stackable: true,  orientationFixed: false, colorIndex: 4 },
  { model: 'Frozen-Seafood-Pallet',l: 1.20,w: 1.00, h: 1.15, weight: 450,  quantity: 20, stackable: true,  orientationFixed: false, colorIndex: 5 },
  { model: 'Carton-Consumer-Goods',l: 0.60,w: 0.40, h: 0.35, weight: 12,   quantity: 500,stackable: true,  orientationFixed: false, colorIndex: 6 },
];

const hq45 = CDB.CONTAINER_DB['45HQ'];

console.log('══════════════════════════════════════════════');
console.log('  诊断 #2: 装箱过程逐件追踪');
console.log('══════════════════════════════════════════════\n');

// ── 排序验证 ──
console.log('── 排序验证 ──\n');
const sortedVol = PE._internal.sortItems(PE.expandItems(testCargo).slice(), 'volume-desc');
console.log('  volume-desc 前12件:');
for (let i = 0; i < Math.min(12, sortedVol.length); i++) {
  const s = sortedVol[i];
  console.log(`    ${String(i+1).padStart(2)}. ${pad(s.model, 24)} ${s.l}×${s.w}×${s.h}  ${pad(String(s.weight), 5)}kg  ${s.stackable ? '可叠' : '不可叠'}`);
}

const sortedWt = PE._internal.sortItems(PE.expandItems(testCargo).slice(), 'weight-desc');
console.log('\n  weight-desc 前12件:');
for (let i = 0; i < Math.min(12, sortedWt.length); i++) {
  const s = sortedWt[i];
  console.log(`    ${String(i+1).padStart(2)}. ${pad(s.model, 24)} ${s.l}×${s.w}×${s.h}  ${pad(String(s.weight), 5)}kg  ${s.stackable ? '可叠' : '不可叠'}`);
}

// ── Box 1: volume-desc ──
console.log('\n──────────────────────────────────────────');
console.log('  Box 1: volume-desc');
console.log('──────────────────────────────────────────\n');

const resultVol = PE.packSingleContainer(testCargo, hq45, { tolerance: 0.05, sortStrategy: 'volume-desc' });
console.log(`  已装: ${resultVol.placedItems.length} 件 | 未装: ${resultVol.unplacedItems.length} 件`);
console.log(`  利用率: ${(resultVol.utilization * 100).toFixed(2)}% | 重量: ${resultVol.totalWeight}kg / ${hq45.payload}kg (${(resultVol.weightUtil * 100).toFixed(2)}%)\n`);

for (let i = 0; i < resultVol.placedItems.length; i++) {
  const p = resultVol.placedItems[i];
  console.log(`    ${String(i+1).padStart(2)}. ${pad(p.model, 24)} @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ${pad(`${p.l.toFixed(2)}×${p.w.toFixed(2)}×${p.h.toFixed(2)}`, 18)} ${pad(String(p.weight)+'kg', 7)} ${p.stackable ? '可叠' : ''}`);
}

const unplacedCounts = {};
for (const u of resultVol.unplacedItems) unplacedCounts[u.model] = (unplacedCounts[u.model] || 0) + 1;
console.log('\n  未装箱:');
for (const [model, count] of Object.entries(unplacedCounts)) console.log(`    ${model}: ${count} 件`);

// ── Box 1: weight-desc ──
console.log('\n──────────────────────────────────────────');
console.log('  Box 1: weight-desc');
console.log('──────────────────────────────────────────\n');

const resultWt = PE.packSingleContainer(testCargo, hq45, { tolerance: 0.05, sortStrategy: 'weight-desc' });
console.log(`  已装: ${resultWt.placedItems.length} 件 | 未装: ${resultWt.unplacedItems.length} 件`);
console.log(`  利用率: ${(resultWt.utilization * 100).toFixed(2)}% | 重量: ${resultWt.totalWeight}kg / ${hq45.payload}kg (${(resultWt.weightUtil * 100).toFixed(2)}%)\n`);

for (let i = 0; i < resultWt.placedItems.length; i++) {
  const p = resultWt.placedItems[i];
  console.log(`    ${String(i+1).padStart(2)}. ${pad(p.model, 24)} @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ${pad(`${p.l.toFixed(2)}×${p.w.toFixed(2)}×${p.h.toFixed(2)}`, 18)} ${pad(String(p.weight)+'kg', 7)} ${p.stackable ? '可叠' : ''}`);
}

const unplacedCountsWt = {};
for (const u of resultWt.unplacedItems) unplacedCountsWt[u.model] = (unplacedCountsWt[u.model] || 0) + 1;
console.log('\n  未装箱:');
for (const [model, count] of Object.entries(unplacedCountsWt)) console.log(`    ${model}: ${count} 件`);

// ── 4×45HQ 完整混合 ──
console.log('\n──────────────────────────────────────────');
console.log('  完整混合装箱: 4×45HQ (volume-desc)');
console.log('──────────────────────────────────────────\n');

const mixedVol = PE.mixedMultiContainerPack(testCargo, [hq45, hq45, hq45, hq45], { tolerance: 0.05, sortStrategy: 'volume-desc' });
console.log(`  总箱数: ${mixedVol.containerCount} | 已装: ${mixedVol.totalPlaced}/${mixedVol.totalItems} 件 | 平均利用率: ${(mixedVol.avgUtilization*100).toFixed(2)}%\n`);
for (let i = 0; i < mixedVol.containers.length; i++) {
  const c = mixedVol.containers[i];
  console.log(`  ── 箱${i+1}: ${c.placedItems.length}件 ${c.totalWeight.toFixed(0)}kg ${(c.utilization*100).toFixed(2)}% ──`);
  for (const p of c.placedItems) console.log(`    ${pad(p.model, 24)} @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ${p.l.toFixed(2)}×${p.w.toFixed(2)}×${p.h.toFixed(2)}`);
}

console.log('\n──────────────────────────────────────────');
console.log('  完整混合装箱: 4×45HQ (weight-desc)');
console.log('──────────────────────────────────────────\n');

const mixedWt = PE.mixedMultiContainerPack(testCargo, [hq45, hq45, hq45, hq45], { tolerance: 0.05, sortStrategy: 'weight-desc' });
console.log(`  总箱数: ${mixedWt.containerCount} | 已装: ${mixedWt.totalPlaced}/${mixedWt.totalItems} 件 | 平均利用率: ${(mixedWt.avgUtilization*100).toFixed(2)}%\n`);
for (let i = 0; i < mixedWt.containers.length; i++) {
  const c = mixedWt.containers[i];
  console.log(`  ── 箱${i+1}: ${c.placedItems.length}件 ${c.totalWeight.toFixed(0)}kg ${(c.utilization*100).toFixed(2)}% ──`);
  for (const p of c.placedItems) console.log(`    ${pad(p.model, 24)} @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ${p.l.toFixed(2)}×${p.w.toFixed(2)}×${p.h.toFixed(2)}`);
}

// ── 对照: 20GP ──
console.log('\n──────────────────────────────────────────');
console.log('  对照: 单箱型 20GP');
console.log('──────────────────────────────────────────\n');
const gp20 = CDB.CONTAINER_DB['20GP'];
const result20GP = PE.packSingleContainer(testCargo, gp20, { tolerance: 0.05, sortStrategy: 'volume-desc' });
console.log(`  已装: ${result20GP.placedItems.length} 件 | 利用率: ${(result20GP.utilization*100).toFixed(2)}% | 重量: ${result20GP.totalWeight}kg/${gp20.payload}kg`);
for (const p of result20GP.placedItems) {
  console.log(`    ${pad(p.model, 24)} @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ${p.l.toFixed(2)}×${p.w.toFixed(2)}×${p.h.toFixed(2)}`);
}

// ── 汇总 ──
console.log('\n══════════════════════════════════════════════');
console.log('  对比汇总');
console.log('══════════════════════════════════════════════\n');
console.log(`  策略          Box1装入  Box1未装  利用率      装入物品`);
console.log(`  volume-desc   ${String(resultVol.placedItems.length).padEnd(9)} ${String(resultVol.unplacedItems.length).padEnd(9)} ${(resultVol.utilization*100).toFixed(1).padEnd(9)}%  ${resultVol.placedItems.map(p=>p.model).join(', ')}`);
console.log(`  weight-desc   ${String(resultWt.placedItems.length).padEnd(9)} ${String(resultWt.unplacedItems.length).padEnd(9)} ${(resultWt.utilization*100).toFixed(1).padEnd(9)}%  ${resultWt.placedItems.map(p=>p.model).join(', ')}`);
console.log('\n  诊断 #2 完成');
