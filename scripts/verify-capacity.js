/**
 * 完整容量验证：测试 smart 策略需要多少箱才能装完所有 582 件
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

const totalVolume = PE.expandItems(cargo).reduce((s, i) => s + i.l * i.w * i.h, 0);
console.log(`总货物体积: ${totalVolume.toFixed(1)} m³`);
console.log(`总件数: ${PE.getTotalQuantity(cargo)}`);

const hq45 = CDB.CONTAINER_DB['45HQ'];
const hq45Vol = hq45.l * hq45.w * hq45.h;
console.log(`45HQ 体积: ${hq45Vol.toFixed(1)} m³`);
console.log(`理论最少箱数: ${Math.ceil(totalVolume / hq45Vol)}`);

console.log('\n=== 逐级扩容测试 ===');
for (let n = 4; n <= 8; n++) {
  const specs = Array(n).fill(hq45);
  const m = PE.mixedMultiContainerPack(cargo, specs, { tolerance: 0.05, sortStrategy: 'smart' });
  const pct = ((m.totalPlaced / m.totalItems) * 100).toFixed(1);
  const marker = m.totalPlaced === m.totalItems ? ' ✅ 全部装入!' : '';
  console.log(`  ${n}×45HQ: ${m.totalPlaced}/${m.totalItems} 件 (${pct}%) 利用率: ${(m.avgUtilization*100).toFixed(1)}%${marker}`);
  if (m.totalPlaced === m.totalItems) {
    console.log(`\n=== ${n}×45HQ 装箱明细 ===`);
    for (let i = 0; i < m.containers.length; i++) {
      const c = m.containers[i];
      const models = {};
      for (const p of c.placedItems) models[p.model] = (models[p.model] || 0) + 1;
      console.log(`  箱${i+1}: ${c.placedItems.length}件 ${c.totalWeight.toFixed(0)}kg ${(c.utilization*100).toFixed(1)}%`);
      for (const [model, count] of Object.entries(models)) console.log(`    ${model}: ${count} 件`);
    }
    break;
  }
}

// 承重检查验证
console.log('\n=== 承重检查验证 ===');
{
  const items = [
    { model: 'Heavy', l: 1.0, w: 1.0, h: 0.5, weight: 5000, stackable: true, colorIndex: 0 },
    { model: 'Light', l: 0.5, w: 0.5, h: 0.5, weight: 10, stackable: true, colorIndex: 1 },
  ];
  const r = PE.packSingleContainer(items, hq45, { tolerance: 0.05, sortStrategy: 'smart' });
  console.log(`重物(${items[0].weight}kg) + 轻物(${items[1].weight}kg): ${r.placedItems.length} 件`);
  for (const p of r.placedItems) {
    console.log(`  ${p.model} @(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) z=${p.z.toFixed(2)} ${p.weight}kg`);
  }
  // Light on top of Heavy: below=5000kg, above=10kg, 5000 >= 10*0.5 → should PASS
  // Heavy on top of Light: below=10kg, above=5000kg, 10 >= 5000*0.5 → should FAIL
  const hasLightOnHeavy = r.placedItems.some(p => p.model === 'Light' && p.z > 0);
  const hasHeavyOnLight = r.placedItems.some(p => p.model === 'Heavy' && p.z > 0);
  console.log(`  轻物在重物上方: ${hasLightOnHeavy ? '✅ 允许' : '❌ 意外'}`);
  console.log(`  重物在轻物上方: ${hasHeavyOnLight ? '❌ 不应允许!' : '✅ 已阻止'}`);
}
