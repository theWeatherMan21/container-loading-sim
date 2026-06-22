global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };
global.XLSX = require('../vendor/xlsx.full.min.js');

require('../container-db.js');
require('../packing-engine.js');

const CDB = global.ContainerDB;
const PE = global.PackingEngine;

// 测试货物：尺寸较大的货物
const testItems = [
  { model: '1', l: 5.7, w: 4.3, h: 4.29, weight: 10000, quantity: 1, stackable: true },
  { model: '3', l: 5.7, w: 4.3, h: 4.36, weight: 22500, quantity: 1, stackable: true },
  { model: '5', l: 8.4, w: 2.71, h: 2.77, weight: 8000, quantity: 1, stackable: true },
];

const fr40 = CDB.CONTAINER_DB['40FR'];
console.log('40FR规格:', JSON.stringify(fr40, null, 2));

console.log('\n=== 测试FR箱型装箱 ===');
console.log('测试货物:', JSON.stringify(testItems, null, 2));

const result = PE.calculate(testItems, fr40, { tolerance: 0.05 });
console.log('\n装箱结果:', JSON.stringify(result, null, 2));