// 探针 v3：直调 mixedMultiContainerPack（绕过 Planner 分组）对照
global.window = global;
require('../container-db.js');
require('../field-parser.js');
require('../planner.js');
require('../packing-engine.js');
const PE = global.window.PackingEngine;
const CDB = global.window.ContainerDB;

const mixedCodes = ['20GP', '40GP', '40HQ', '45HQ'];
const specs = mixedCodes.map(c => CDB.CONTAINER_DB[c]);

// 场景A：定界存档口径 —— 正立方×500
let items = [{ model: 'CUBE', l: 1, w: 1, h: 1, quantity: 500, weight: 300, stackable: true }];
for (const strategy of ['smart', 'stackable-first']) {
  const r = PE.mixedMultiContainerPack(items, specs, { tolerance: 0.05, sortStrategy: strategy });
  const list = Array.isArray(r.containers) ? r.containers : [];
  const dist = {};
  let boxCount = 0;
  list.forEach(c => { dist[c.containerCode] = (dist[c.containerCode] || 0) + 1; boxCount++; });
  console.log(`[立方500·直调·${strategy}] 箱数=${boxCount}`, JSON.stringify(dist));
  list.forEach((c, i) => {
    console.log(`  箱${String(i + 1).padStart(2)} [${c.containerCode}] 件=${c.placedItems.length} 容积=${((c.utilization ?? 0) * 100).toFixed(1)}%`);
  });
}

// 场景B：混合货 510 直调对照
items = [
  { model: 'PROD-A', l: 1.10, w: 0.90, h: 0.80, quantity: 120, weight: 380, stackable: true },
  { model: 'PROD-B', l: 0.80, w: 0.70, h: 0.60, quantity: 260, weight: 150, stackable: true },
  { model: 'TOOL-C', l: 1.50, w: 1.20, h: 1.00, quantity: 40, weight: 520, stackable: true },
  { model: 'FRAME-D', l: 2.20, w: 1.10, h: 0.95, quantity: 30, weight: 640, stackable: false },
  { model: 'CASE-E', l: 0.60, w: 0.55, h: 0.50, quantity: 60, weight: 90, stackable: true }
];
{
  const r = PE.mixedMultiContainerPack(items, specs, { tolerance: 0.05 });
  const list = Array.isArray(r.containers) ? r.containers : [];
  let boxCount = 0;
  const dist = {};
  list.forEach(c => { dist[c.containerCode] = (dist[c.containerCode] || 0) + 1; boxCount++; });
  console.log(`[混货510·直调] 总箱数=${boxCount}`, JSON.stringify(dist));
}
