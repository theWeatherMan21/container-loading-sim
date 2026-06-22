const path = require('path');
const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';

global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };

require(path.join(srcDir, 'container-db.js'));

// Load and patch packing-engine
const fs = require('fs');
let engineSrc = fs.readFileSync(path.join(srcDir, 'packing-engine.js'), 'utf8');

// Patch: use effDims in buildEMSFromPlaced
const original = 'function buildEMSFromPlaced(placedItems, container, emsSpaces, tolerance) {\n    emsSpaces.push(createSpace(0, 0, 0, container.L, container.W, container.H, false));';
const patched = 'function buildEMSFromPlaced(placedItems, container, emsSpaces, tolerance) {\n    const effDims = getEffectiveMaxDims(container, tolerance);\n    emsSpaces.push(createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false));';

engineSrc = engineSrc.replace(original, patched);

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

// Test full case
const testItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 20, weight: 500, stackable: true, orientationFixed: false },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 50, weight: 100, stackable: true, orientationFixed: false },
];

const result = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: false });

if (result?.containers?.length) {
  const items = result.containers[0].placedItems;
  const ov = countOverlaps(items);
  console.log(`Placed: ${items.length}, Overlaps: ${ov}`);
  
  if (ov > 0) {
    console.log('❌ Still has overlaps — buildEMSFromPlaced dimension fix alone is not enough');
  } else {
    console.log('✅ FIXED! buildEMSFromPlaced should use effective dimensions (with tolerance)');
  }
}