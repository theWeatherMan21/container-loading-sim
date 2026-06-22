/**
 * 深度调试：所有 space 和 placement 的详细追踪
 */
const path = require('path');

const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';

global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };

require(path.join(srcDir, 'container-db.js'));
require(path.join(srcDir, 'packing-engine.js'));

const CDB = global.ContainerDB;
const PE = global.PackingEngine;

const testItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 5, weight: 500, stackable: true, orientationFixed: false },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 5, weight: 100, stackable: true, orientationFixed: false },
];

const result = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: true });

if (!result || !result.containers.length) {
  console.log('No result');
  process.exit(1);
}

const container = result.containers[0];
const items = container.placedItems;

// Show all placements
console.log('=== All Placements ===');
for (const item of items) {
  console.log(`${item.model} @ (${item.x.toFixed(3)}, ${item.y.toFixed(3)}, ${item.z.toFixed(3)}) [${item.l.toFixed(3)}×${item.w.toFixed(3)}×${item.h.toFixed(3)}]`);
}

// Check for identical positions
console.log('\n=== Position Uniqueness Check ===');
const posKeys = {};
for (const item of items) {
  const key = `${item.model}_${item.x.toFixed(3)}_${item.y.toFixed(3)}_${item.z.toFixed(3)}`;
  if (posKeys[key]) {
    console.log(`DUPLICATE: ${key}`);
  }
  posKeys[key] = true;
}
console.log(`Unique positions: ${Object.keys(posKeys).length} / ${items.length}`);

// Overlap detection - grouped by model
console.log('\n=== B items overlapping A items ===');
const aItems = items.filter(i => i.model === 'A');
const bItems = items.filter(i => i.model === 'B');
for (const b of bItems) {
  for (const a of aItems) {
    if (b.x < a.x + a.l && b.x + b.l > a.x &&
        b.y < a.y + a.w && b.y + b.w > a.y &&
        b.z < a.z + a.h && b.z + b.h > a.z) {
      console.log(`B(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}) overlaps A(${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)})`);
    }
  }
}

// NOW: trace through emsPlace manually for each B item
console.log('\n=== Replicating placement logic ===');
// Rebuild the EMS state by placing A items manually
const containerSpec = CDB.CONTAINER_DB['20GP'];
const tolerance = 0.05;
const { L, W, H } = containerSpec;

let emsSpaces = [PE.createSpace(0, 0, 0, L, W, H)];
const placedItems = [];
let cw = 0;

// Emulate A items being placed (they're all stackable=true so should be straightforward)
for (const item of aItems) {
  const orientations = CDB.getOrientations(item);
  let best = null, bestScore = -Infinity;
  
  for (let si = 0; si < emsSpaces.length; si++) {
    const space = emsSpaces[si];
    if (space.blockedAbove && space.z > 0.001) continue;
    
    for (const o of orientations) {
      if (o.l > space.L + 0.001 || o.w > space.W + 0.001 || o.h > space.H + 0.001) continue;
      
      const effDims = CDB.getEffectiveMaxDims(containerSpec, tolerance);
      if (o.l > effDims.maxL || o.w > effDims.maxW || o.h > effDims.maxH) continue;
      
      const score = PE.dblScore(space.x, space.y, space.z, containerSpec);
      const fitScore = (o.l/space.L + o.w/space.W + o.h/space.H) / 3;
      const totalScore = score + fitScore * 100;
      
      if (totalScore > bestScore) {
        bestScore = totalScore;
        best = { spaceIndex: si, orientation: o, x: space.x, y: space.y, z: space.z };
      }
    }
  }
  
  if (!best) break;
  
  placedItems.push({
    model: item.model, l: best.orientation.l, w: best.orientation.w, h: best.orientation.h,
    x: best.x, y: best.y, z: best.z, weight: item.weight, stackable: true
  });
  
  const oldSpace = emsSpaces[best.spaceIndex];
  const newSpaces = PE.cutSpace(oldSpace, best.x, best.y, best.z, best.orientation.l, best.orientation.w, best.orientation.h);
  emsSpaces.splice(best.spaceIndex, 1);
  emsSpaces.push(...newSpaces);
  emsSpaces.splice(0, emsSpaces.length, ...PE.pruneSmallSpaces(PE.mergeSpaces(emsSpaces)));
}

console.log(`\nAfter placing ${aItems.length} A items:`);
console.log(`EMS spaces: ${emsSpaces.length}`);
for (const s of emsSpaces) {
  console.log(`  Space (${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) [${s.L.toFixed(2)}×${s.W.toFixed(2)}×${s.H.toFixed(2)}] blockedAbove=${s.blockedAbove||false}`);
}

// Check if any space overlaps with placed items
console.log('\n=== Space vs Item Overlap Check ===');
let spaceItemOverlaps = 0;
for (const s of emsSpaces) {
  for (const p of placedItems) {
    // Check overlap in XY (same Z level)
    if (Math.abs(s.z - p.z) < 0.001 &&
        s.x < p.x + p.l && s.x + s.L > p.x &&
        s.y < p.y + p.w && s.y + s.W > p.y) {
      spaceItemOverlaps++;
      console.log(`SPACE-ITEM OVERLAP: Space(${s.x.toFixed(2)},${s.y.toFixed(2)})[${s.L.toFixed(2)}×${s.W.toFixed(2)}] contains item ${p.model}(${p.x.toFixed(2)},${p.y.toFixed(2)})[${p.l.toFixed(2)}×${p.w.toFixed(2)}]`);
    }
  }
}
console.log(`Space-item XY overlaps at same Z: ${spaceItemOverlaps}`);

// Now try to place B item
console.log('\n=== B item placement attempt ===');
const bItem = { l: 0.5, w: 0.4, h: 0.3, weight: 100, stackable: true, orientationFixed: false, model: 'B' };
const bOrientations = CDB.getOrientations(bItem);

let bBest = null, bBestScore = -Infinity;
for (let si = 0; si < emsSpaces.length; si++) {
  const space = emsSpaces[si];
  if (space.blockedAbove && space.z > 0.001) continue;
  
  for (const o of bOrientations) {
    if (o.l > space.L + 0.001 || o.w > space.W + 0.001 || o.h > space.H + 0.001) continue;
    
    const effDims = CDB.getEffectiveMaxDims(containerSpec, tolerance);
    if (o.l > effDims.maxL || o.w > effDims.maxW || o.h > effDims.maxH) continue;
    
    const score = PE.dblScore(space.x, space.y, space.z, containerSpec);
    const fitScore = (o.l/space.L + o.w/space.W + o.h/space.H) / 3;
    const totalScore = score + fitScore * 100;
    
    if (totalScore > bBestScore) {
      bBestScore = totalScore;
      bBest = { spaceIndex: si, orientation: o, spaceX: space.x, spaceY: space.y, spaceZ: space.z, score, fitScore };
    }
  }
}

if (bBest) {
  console.log(`B would place at (${bBest.spaceX.toFixed(3)}, ${bBest.spaceY.toFixed(3)}, ${bBest.spaceZ.toFixed(3)}) space=${bBest.spaceIndex}`);
  console.log(`  Score: dbl=${bBest.score.toFixed(2)}, fit=${bBest.fitScore.toFixed(2)}, total=${bBestScore.toFixed(2)}`);
  
  // Check overlap with placed A items
  for (const a of placedItems) {
    if (a.model !== 'A') continue;
    if (bBest.spaceX < a.x + a.l && bBest.spaceX + bBest.orientation.l > a.x &&
        bBest.spaceY < a.y + a.w && bBest.spaceY + bBest.orientation.w > a.y &&
        bBest.spaceZ < a.z + a.h && bBest.spaceZ + bBest.orientation.h > a.z) {
      console.log(`  ❌ B would overlap with A @ (${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)})`);
    }
  }
} else {
  console.log('  B could NOT find a space!');
}