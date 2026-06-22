const path = require('path');
const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';

global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };

require(path.join(srcDir, 'container-db.js'));
require(path.join(srcDir, 'packing-engine.js'));

const CDB = global.ContainerDB;
const PE = global.PackingEngine;

const testItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 20, weight: 500, stackable: true, orientationFixed: false },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 50, weight: 100, stackable: true, orientationFixed: false },
];

console.log('=== WITH autoRetry=true (default) ===');
const r1 = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: true });
if (r1) {
  const overlaps1 = countOverlaps(r1.containers[0].placedItems);
  console.log(`Overlaps: ${overlaps1}`);
}

console.log('\n=== WITH autoRetry=false ===');
const r2 = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: false });
if (r2) {
  const overlaps2 = countOverlaps(r2.containers[0].placedItems);
  console.log(`Overlaps: ${overlaps2}`);
  if (overlaps2 === 0) {
    console.log('✅ Bug is in autoRetry/recalibrate!');
    console.log(`Utilization: ${(r2.containers[0].utilization*100).toFixed(1)}%`);
    console.log(`Placed: ${r2.containers[0].placedItems.length} items`);
  }
}

function countOverlaps(items) {
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.x < b.x + b.l && a.x + a.l > b.x && a.y < b.y + b.w && a.y + a.w > b.y && a.z < b.z + b.h && a.z + a.h > b.z) {
        n++;
      }
    }
  }
  return n;
}