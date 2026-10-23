// 探针 v2：定界存档原始口径 —— 1×1×1m/300kg 正立方 × 500 件
global.window = global;
require('../container-db.js');
require('../field-parser.js');
require('../planner.js');
require('../packing-engine.js');
const PE = global.window.PackingEngine;
const CDB = global.window.ContainerDB;

const items = [{ model: 'CUBE', l: 1, w: 1, h: 1, quantity: 500, weight: 300, stackable: true }];
const mixedCodes = ['20GP', '40GP', '40HQ', '45HQ'];

for (const label of ['默认排序', 'stackable-first']) {
  const result = PE.calculate(items, null, {
    mixedContainers: mixedCodes.map(c => CDB.CONTAINER_DB[c]),
    tolerance: 0.05,
    autoRetry: true,
    ...(label === 'stackable-first' ? { sortStrategy: 'stackable-first' } : {})
  });
  const specs = {};
  (result.containers || []).forEach(c => { specs[c.containerCode] = (specs[c.containerCode] || 0) + 1; });
  console.log(`=== ${label} ===`);
  console.log('箱数:', result.containerCount, '| placed:', result.totalPlaced, '| unplaced:', result.unplacedCount);
  console.log('箱型分布:', JSON.stringify(specs));
  result.containers.forEach((c, i) => {
    console.log(`  箱${String(i + 1).padStart(2)} [${c.containerCode}] 件=${c.placedItems.length} 容积=${((c.utilization ?? 0) * 100).toFixed(1)}%`);
  });
}
