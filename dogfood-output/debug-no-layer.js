const path = require('path');
const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';

global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };

require(path.join(srcDir, 'container-db.js'));

// Patch: disable layerPack by changing threshold to 99999
const fs = require('fs');
let engineSrc = fs.readFileSync(path.join(srcDir, 'packing-engine.js'), 'utf8');
engineSrc = engineSrc.replace('totalQty >= 10', 'totalQty >= 99999');
eval(engineSrc);

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

// Small test first
const smallItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 5, weight: 500, stackable: true, orientationFixed: false },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 10, weight: 100, stackable: true, orientationFixed: false },
];

console.log('=== Small test (5A + 10B, emsPlace only) ===');
const r1 = PE.calculate(smallItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: false });
if (r1?.containers?.length) {
  const ov1 = countOverlaps(r1.containers[0].placedItems);
  console.log(`Placed: ${r1.containers[0].placedItems.length}, Overlaps: ${ov1}`);
  if (ov1 > 0) {
    const items = r1.containers[0].placedItems;
    for (let i = 0; i < items.length && i < 15; i++) {
      console.log(`  ${items[i].model} @ (${items[i].x.toFixed(2)},${items[i].y.toFixed(2)},${items[i].z.toFixed(2)}) [${items[i].l}×${items[i].w}×${items[i].h}]`);
    }
  }
}

// Full test
const fullItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 20, weight: 500, stackable: true, orientationFixed: false },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 50, weight: 100, stackable: true, orientationFixed: false },
];

console.log('\n=== Full test (20A + 50B, emsPlace only) ===');
const r2 = PE.calculate(fullItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: false });
if (r2?.containers?.length) {
  const ov2 = countOverlaps(r2.containers[0].placedItems);
  console.log(`Placed: ${r2.containers[0].placedItems.length}, Overlaps: ${ov2}`);
  if (ov2 > 0) {
    console.log(`❌ Overlaps exist even without layerPack → bug is in emsPlace/cutSpace/mergeSpaces`);
  } else {
    console.log(`✅ No overlaps without layerPack → bug is in layerPack`);
  }
}