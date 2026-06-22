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

// Test with A×20 + various B quantities  
for (let bQty = 1; bQty <= 50; bQty += 5) {
  const testItems = [
    { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 20, weight: 500, stackable: true, orientationFixed: false },
    { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: bQty, weight: 100, stackable: true, orientationFixed: false },
  ];
  
  const result = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: false });
  if (result?.containers?.length) {
    const items = result.containers[0].placedItems;
    const ov = countOverlaps(items);
    const bItems = items.filter(i => i.model === 'B');
    const bFirst = bItems[0];
    const zB = bFirst ? bFirst.z.toFixed(2) : 'N/A';
    const aFirst = items.find(i => i.model === 'A');
    console.log(`A×20 + B×${bQty}: ${items.length} placed, ${ov} overlaps, A=[${aFirst.l}×${aFirst.w}×${aFirst.h}], B_z=${zB}`);
    if (ov > 0) {
      console.log(`  ❌❌❌ OVERLAPS START at B×${bQty}!!!`);
      // Show first few B positions vs A positions
      const aItems = items.filter(i => i.model === 'A');
      const bItems2 = items.filter(i => i.model === 'B');
      console.log(`  First A: (${aItems[0].x.toFixed(2)},${aItems[0].y.toFixed(2)},${aItems[0].z.toFixed(2)})`);
      console.log(`  Last A: (${aItems[aItems.length-1].x.toFixed(2)},${aItems[aItems.length-1].y.toFixed(2)},${aItems[aItems.length-1].z.toFixed(2)})`);
      console.log(`  First B: (${bItems2[0].x.toFixed(2)},${bItems2[0].y.toFixed(2)},${bItems2[0].z.toFixed(2)})`);
      console.log(`  Last B: (${bItems2[bItems2.length-1].x.toFixed(2)},${bItems2[bItems2.length-1].y.toFixed(2)},${bItems2[bItems2.length-1].z.toFixed(2)})`);
      
      // Which A items do B items overlap with?
      let firstOverlapB = null;
      for (const b of bItems2) {
        for (const a of aItems) {
          if (b.x < a.x + a.l && b.x + b.l > a.x && b.y < a.y + a.w && b.y + b.w > a.y && b.z < a.z + a.h && b.z + b.h > a.z) {
            if (!firstOverlapB) {
              firstOverlapB = b;
              console.log(`  B overlap example: B(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}) overlaps A(${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)})`);
            }
          }
        }
      }
      break;
    }
  }
}