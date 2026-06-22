/**
 * 精确定位：只用 2 个 A 和 1 个 B，追踪每个 EMS 空间状态
 * 通过直接读取放置结果来反向分析
 */
const path = require('path');

const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';

global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };

require(path.join(srcDir, 'container-db.js'));

// Monkey-patch packing-engine before loading it
// We'll capture the emsPlace function by wrapping it
const fs = require('fs');
const engineSrc = fs.readFileSync(path.join(srcDir, 'packing-engine.js'), 'utf8');

// Patch: add a debug global to capture placements
const patchedSrc = engineSrc.replace(
  'return placed;\n  }',
  `if (typeof global.__debug === 'function') {
      global.__debug('ems', { model: item.model, l: best.orientation?.l, w: best.orientation?.w, h: best.orientation?.h, x: best.x, y: best.y, z: best.z, spaceIdx: best.spaceIndex, spaceX: oldSpace?.x, spaceY: oldSpace?.y, spaceZ: oldSpace?.z, spaceL: oldSpace?.L, spaceW: oldSpace?.W, spaceH: oldSpace?.H, newSpacesCount: newSpaces?.length });
    }
    return placed;
  }`
);

eval(patchedSrc);

const PE = global.PackingEngine;
const CDB = global.ContainerDB;

// Simple test
const testItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 2, weight: 500, stackable: true, orientationFixed: false },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 1, weight: 100, stackable: true, orientationFixed: false },
];

const debugLog = [];
global.__debug = (type, data) => {
  console.log(`[${type}] ${data.model} → (${data.x},${data.y},${data.z}) [${data.l}×${data.w}×${data.h}] from space #${data.spaceIdx}(${data.spaceX?.toFixed(3)},${data.spaceY?.toFixed(3)},${data.spaceZ?.toFixed(3)})[${data.spaceL?.toFixed(3)}×${data.spaceW?.toFixed(3)}×${data.spaceH?.toFixed(3)}] → ${data.newSpacesCount} new spaces`);
  debugLog.push(data);
};

const result = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: false });

if (result && result.containers.length) {
  const items = result.containers[0].placedItems;
  console.log(`\nPlaced ${items.length} items:`);
  for (const item of items) {
    console.log(`  ${item.model} @ (${item.x.toFixed(3)},${item.y.toFixed(3)},${item.z.toFixed(3)}) [${item.l.toFixed(3)}×${item.w.toFixed(3)}×${item.h.toFixed(3)}]`);
  }
  
  // Check overlaps
  let overlaps = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.x < b.x + b.l && a.x + a.l > b.x && a.y < b.y + b.w && a.y + a.w > b.y && a.z < b.z + b.h && a.z + a.h > b.z) {
        overlaps++;
        console.log(`OVERLAP: ${a.model}@(${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)}) × ${b.model}@(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)})`);
      }
    }
  }
  console.log(`Total overlaps: ${overlaps}`);
  
  if (overlaps === 0) console.log('✅ No overlaps with autoRetry=false');
}