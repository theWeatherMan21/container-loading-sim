/**
 * 深度调试：打包重叠问题
 */
const fs = require('fs');
const path = require('path');

const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';

global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };

require(path.join(srcDir, 'container-db.js'));
require(path.join(srcDir, 'packing-engine.js'));

const CDB = global.ContainerDB;
const PE = global.PackingEngine;

// Simple items to minimize variables
const testItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 20, weight: 500, stackable: true, orientationFixed: false },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 50, weight: 100, stackable: true, orientationFixed: false },
];

const result = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: true });

if (!result || !result.containers.length) {
  console.log('No result');
  process.exit(1);
}

const container = result.containers[0];
const items = container.placedItems;

console.log(`Container: ${container.containerCode}`);
console.log(`Total items: ${items.length}`);
console.log(`Utilization: ${(container.utilization * 100).toFixed(1)}%`);

// Detailed overlap detection
let overlapCount = 0;
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    const overlapX = a.x < b.x + b.l && a.x + a.l > b.x;
    const overlapY = a.y < b.y + b.w && a.y + a.w > b.y;
    const overlapZ = a.z < b.z + b.h && a.z + a.h > b.z;
    
    if (overlapX && overlapY && overlapZ) {
      overlapCount++;
      console.log(`\nOVERLAP #${overlapCount}:`);
      console.log(`  ${a.model} @ (${a.x.toFixed(3)}, ${a.y.toFixed(3)}, ${a.z.toFixed(3)}) [${a.l.toFixed(3)}×${a.w.toFixed(3)}×${a.h.toFixed(3)}]`);
      console.log(`  ${b.model} @ (${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.z.toFixed(3)}) [${b.l.toFixed(3)}×${b.w.toFixed(3)}×${b.h.toFixed(3)}]`);
      
      // Show overlap region
      const ox = Math.max(0, Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y));
      const oz = Math.max(0, Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z));
      console.log(`  Overlap: ${ox.toFixed(3)} × ${oy.toFixed(3)} × ${oz.toFixed(3)}`);
      
      if (overlapCount >= 10) {
        console.log('\n... (showing first 10 overlaps)');
        break;
      }
    }
    if (overlapCount >= 10) break;
  }
  if (overlapCount >= 10) break;
}

console.log(`\nTotal overlaps: ${overlapCount}`);

// Check layer pattern - are items placed on layers?
console.log('\n=== Z-level distribution ===');
const zLevels = {};
for (const item of items) {
  const zKey = item.z.toFixed(4);
  if (!zLevels[zKey]) zLevels[zKey] = [];
  zLevels[zKey].push(item.model);
}
for (const z of Object.keys(zLevels).sort()) {
  console.log(`  z=${z}: ${zLevels[z].length} items [${zLevels[z].slice(0, 5).join(',')}...]`);
}

// Check XY distribution of layer 0
console.log('\n=== XY of first 5 items at z=0 ===');
const z0Items = items.filter(i => i.z < 0.001);
for (const item of z0Items.slice(0, 10)) {
  console.log(`  ${item.model} @ (${item.x.toFixed(3)}, ${item.y.toFixed(3)}) [${item.l.toFixed(3)}×${item.w.toFixed(3)}]`);
}

// Also check if the DBL fix caused the issue by reverting temporarily
console.log('\n=== Analyzing overlap cause ===');

// Check: do all items at same Z have proper Y boundaries?
const itemYs = z0Items.map(i => ({ model: i.model, yMin: i.y, yMax: i.y + i.w }));
itemYs.sort((a, b) => a.yMin - b.yMin);
console.log('\n  Y ranges at z=0 (sorted by yMin):');
for (const iy of itemYs) {
  console.log(`    ${iy.model}: y=[${iy.yMin.toFixed(3)}, ${iy.yMax.toFixed(3)}]  width=${(iy.yMax-iy.yMin).toFixed(3)}`);
}

// Find all overlapping pairs at z=0
console.log('\n  Overlaps at z=0:');
let z0overlaps = 0;
for (let i = 0; i < z0Items.length; i++) {
  for (let j = i + 1; j < z0Items.length; j++) {
    const a = z0Items[i], b = z0Items[j];
    if (a.x < b.x + b.l && a.x + a.l > b.x && a.y < b.y + b.w && a.y + a.w > b.y) {
      z0overlaps++;
      console.log(`    ${a.model}(${a.x.toFixed(2)},${a.y.toFixed(2)}) × ${b.model}(${b.x.toFixed(2)},${b.y.toFixed(2)})`);
      if (z0overlaps >= 5) break;
    }
  }
  if (z0overlaps >= 5) break;
}

// Check if layerPack is creating overlapping placements at higher Z
const z1Items = items.filter(i => i.z > 0.1 && i.z < 1.0);
console.log(`\n  Items at z=0.6-ish: ${z1Items.length}`);
if (z1Items.length > 0) {
  for (const item of z1Items.slice(0, 10)) {
    console.log(`    ${item.model} @ (${item.x.toFixed(3)}, ${item.y.toFixed(3)}, ${item.z.toFixed(3)}) [${item.l.toFixed(3)}×${item.w.toFixed(3)}×${item.h.toFixed(3)}]`);
  }
  // Check if these overlap with z=0 items
  let z0z1overlaps = 0;
  for (const a of z1Items) {
    for (const b of z0Items) {
      if (a.x < b.x + b.l && a.x + a.l > b.x && a.y < b.y + b.w && a.y + a.w > b.y) {
        z0z1overlaps++;
      }
    }
  }
  console.log(`  XY overlaps between z=0 and z=0.6: ${z0z1overlaps}`);
}