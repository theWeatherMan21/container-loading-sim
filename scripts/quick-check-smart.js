/**
 * 快速验证 smart 策略效果
 */
const { createRuntime } = require('./_load-runtime');
const ctx = createRuntime(['container-db.js', 'field-parser.js', 'packing-engine.js']);

const PE = ctx.window.PackingEngine;
const CDB = ctx.window.ContainerDB;
const pad = (s, n) => String(s).padEnd(n);

const cargo = [
  { model: 'Generator-Set', l: 4.80, w: 1.85, h: 2.05, weight: 6200, quantity: 2, stackable: false, orientationFixed: true, colorIndex: 0 },
  { model: 'HVAC-Unit', l: 1.85, w: 0.95, h: 2.15, weight: 850, quantity: 4, stackable: false, orientationFixed: true, colorIndex: 1 },
  { model: 'Aluminum-Coil', l: 1.45, w: 1.45, h: 0.80, weight: 3200, quantity: 8, stackable: false, orientationFixed: false, colorIndex: 2 },
  { model: 'Steel-Plate-Bundle', l: 2.50, w: 1.20, h: 0.15, weight: 2800, quantity: 12, stackable: true, orientationFixed: false, colorIndex: 3 },
  { model: 'Wooden-Pallet-Tiles', l: 1.20, w: 1.00, h: 0.90, weight: 620, quantity: 36, stackable: true, orientationFixed: false, colorIndex: 4 },
  { model: 'Frozen-Seafood-Pallet', l: 1.20, w: 1.00, h: 1.15, weight: 450, quantity: 20, stackable: true, orientationFixed: false, colorIndex: 5 },
  { model: 'Carton-Consumer-Goods', l: 0.60, w: 0.40, h: 0.35, weight: 12, quantity: 500, stackable: true, orientationFixed: false, colorIndex: 6 },
];

const hq45 = CDB.CONTAINER_DB['45HQ'];

// ── smart 排序验证 ──
console.log('=== smart 排序 (前20件) ===');
const sorted = PE._internal.sortItems(PE.expandItems(cargo).slice(), 'smart');
for (let i = 0; i < Math.min(20, sorted.length); i++) {
  const s = sorted[i];
  const tier = s.stackable === false
    ? (s.weight >= 1000 || Math.max(s.l, s.w, s.h) >= 2 ? 'T1' : 'T3')
    : 'T2';
  console.log(`  ${String(i + 1).padStart(2)}. [${tier}] ${pad(s.model, 24)} ${s.l}x${s.w}x${s.h} ${pad(String(s.weight), 5)}kg`);
}

// ── Box 1: smart ──
console.log('\n=== Box 1: smart ===');
// packSingleContainer 不展开 quantity，必须先展开才能与 4x45HQ 段同口径比较。
const expandedCargo = PE.expandItems(cargo);
const r1 = PE.packSingleContainer(expandedCargo, hq45, { tolerance: 0.05, sortStrategy: 'smart' });
console.log(`已装: ${r1.placedItems.length} 件 | 利用率: ${(r1.utilization * 100).toFixed(1)}% | 重量: ${r1.totalWeight}kg`);
for (let i = 0; i < r1.placedItems.length; i++) {
  const p = r1.placedItems[i];
  console.log(`  ${String(i + 1).padStart(2)}. ${pad(p.model, 24)} @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ${p.l.toFixed(2)}x${p.w.toFixed(2)}x${p.h.toFixed(2)} ${p.weight}kg ${p.stackable ? '可叠' : ''}`);
}

// ── 4x45HQ: smart ──
console.log('\n=== 4x45HQ smart 完整混合装箱 ===');
const m = PE.mixedMultiContainerPack(cargo, [hq45, hq45, hq45, hq45], { tolerance: 0.05, sortStrategy: 'smart' });
console.log(`总箱数: ${m.containerCount} | 已装: ${m.totalPlaced}/${m.totalItems} 件 | 平均利用率: ${(m.avgUtilization * 100).toFixed(1)}%`);
for (let i = 0; i < m.containers.length; i++) {
  const c = m.containers[i];
  const models = {};
  for (const p of c.placedItems) models[p.model] = (models[p.model] || 0) + 1;
  console.log(`  箱${i + 1}: ${c.placedItems.length}件 ${c.totalWeight.toFixed(0)}kg ${(c.utilization * 100).toFixed(1)}%`);
  for (const [model, count] of Object.entries(models)) console.log(`    ${model}: ${count} 件`);
}

// ── 对比旧策略 ──
console.log('\n=== 对比 ===');
const mOld = PE.mixedMultiContainerPack(cargo, [hq45, hq45, hq45, hq45], { tolerance: 0.05, sortStrategy: 'volume-desc' });
console.log(`volume-desc: ${mOld.totalPlaced}/${mOld.totalItems} 件, ${(mOld.avgUtilization * 100).toFixed(1)}%`);
console.log(`smart:       ${m.totalPlaced}/${m.totalItems} 件, ${(m.avgUtilization * 100).toFixed(1)}%`);

const unplaced = m.totalItems - m.totalPlaced;
console.log(`改进: ${unplaced === 0 ? '全部装入!' : '仍有 ' + unplaced + ' 件未装'}`);
