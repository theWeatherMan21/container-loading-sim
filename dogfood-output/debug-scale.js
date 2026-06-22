const path = require('path');
const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';

global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };

require(path.join(srcDir, 'container-db.js'));
require(path.join(srcDir, 'packing-engine.js'));

const CDB = global.ContainerDB;
const PE = global.PackingEngine;

function countOverlaps(items) {
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.x < b.x + b.l && a.x + a.l > b.x && a.y < b.y + b.w && a.y + a.w > b.y && a.z < b.z + b.h && a.z + a.h > b.z) n++;
    }
  }
  return n;
}

for (let aQty = 2; aQty <= 10; aQty++) {
  const testItems = [
    { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: aQty, weight: 500, stackable: true, orientationFixed: false },
    { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 1, weight: 100, stackable: true, orientationFixed: false },
  ];
  
  const result = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: false });
  if (result?.containers?.length) {
    const items = result.containers[0].placedItems;
    const ov = countOverlaps(items);
    const firstA = items.find(i => i.model === 'A');
    const orient = firstA ? `[${firstA.l}×${firstA.w}×${firstA.h}]` : '?';
    console.log(`A×${aQty} + B×1: ${items.length} placed, ${ov} overlaps, A orient=${orient}`);
    if (ov > 0) {
      console.log(`  ❌ First overlap at A×${aQty}!`);
      // Show B placement
      const bItem = items.find(i => i.model === 'B');
      if (bItem) console.log(`  B @ (${bItem.x.toFixed(2)},${bItem.y.toFixed(2)},${bItem.z.toFixed(2)}) [${bItem.l}×${bItem.w}×${bItem.h}]`);
      break;
    }
  }
}