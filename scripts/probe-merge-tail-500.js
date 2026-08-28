// 探针：观察 mergeTailContainers 重写后的 500 件尾货行为（非入册脚本）
global.window = global;
require('../container-db.js');
require('../field-parser.js');
require('../planner.js');
require('../packing-engine.js');
const PE = global.window.PackingEngine;
const CDB = global.window.ContainerDB;

// 500 件典型混合货：主货标准件 + 尾部长尾碎片制造者
const items = [
  { model: 'PROD-A', l: 1.10, w: 0.90, h: 0.80, quantity: 120, weight: 380, stackable: true },
  { model: 'PROD-B', l: 0.80, w: 0.70, h: 0.60, quantity: 260, weight: 150, stackable: true },
  { model: 'TOOL-C', l: 1.50, w: 1.20, h: 1.00, quantity: 40, weight: 520, stackable: true },
  { model: 'FRAME-D', l: 2.20, w: 1.10, h: 0.95, quantity: 30, weight: 640, stackable: false },
  { model: 'CASE-E', l: 0.60, w: 0.55, h: 0.50, quantity: 60, weight: 90, stackable: true }
];
const totalQty = items.reduce((s, i) => s + i.quantity, 0);
console.log('输入总件数:', totalQty);

const mixedCodes = ['20GP', '40GP', '40HQ', '45HQ'];
const result = PE.calculate(items, null, {
  mixedContainers: mixedCodes.map(c => CDB.CONTAINER_DB[c]),
  tolerance: 0.05,
  autoRetry: true
});

console.log('containerCount:', result.containerCount);
console.log('totalPlaced:', result.totalPlaced, '/ unplaced:', result.unplacedCount, '/ total:', result.totalItems);

const specs = {};
let minUtil = Infinity;
(result.containers || []).forEach((c) => {
  specs[c.containerCode] = (specs[c.containerCode] || 0) + 1;
  const util = Math.max(c.utilization ?? 0, c.weightUtil ?? 0);
  if (util < minUtil) minUtil = util;
});
console.log('箱型分布:', JSON.stringify(specs));
console.log('最低双维利用箱:', (minUtil * 100).toFixed(1) + '%');
result.containers.forEach((c, i) => {
  console.log(`  箱${String(i + 1).padStart(2)} [${c.containerCode}] 件=${c.placedItems.length} 容积=${((c.utilization ?? 0) * 100).toFixed(1)}% 载重=${((c.weightUtil ?? 0) * 100).toFixed(1)}%`);
});

// 特种柜出现即 fail（Q2 语义：这批全是普通货）
const special = Object.keys(specs).filter(k => /OT|FR|TK/.test(k));
if (special.length > 0) { console.error('❌ 特种柜渗入:', special); process.exitCode = 1; }
else console.log('✅ 零特种柜');

if (result.totalPlaced + result.unplacedCount !== totalQty) {
  console.error(`❌ 账目不平: ${result.totalPlaced}+${result.unplacedCount}≠${totalQty}`); process.exitCode = 1;
}
