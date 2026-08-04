/**
 * 诊断脚本 #3 — EMS 空间碎片化可视化分析
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost', runScripts: 'dangerously'
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

for (const script of ['container-db.js', 'field-parser.js', 'packing-engine.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', script), 'utf-8');
  const el = dom.window.document.createElement('script');
  el.textContent = code;
  dom.window.document.body.appendChild(el);
}

const _internal = dom.window.PackingEngine._internal;
const CDB = dom.window.ContainerDB;

function main() {
  const hq45 = CDB.CONTAINER_DB['45HQ'];
  const effDims = CDB.getEffectiveMaxDims(hq45, 0.05);
  const pad = (s, n) => String(s).padEnd(n);

  console.log('══════════════════════════════════════════════');
  console.log('  诊断 #3: EMS 空间碎片化可视化分析');
  console.log('══════════════════════════════════════════════\n');
  console.log(`  45HQ 有效尺寸: L=${effDims.maxL.toFixed(3)}m W=${effDims.maxW.toFixed(3)}m H=${effDims.maxH.toFixed(3)}m`);
  console.log(`  45HQ 标称: L=${hq45.L}m W=${hq45.W}m H=${hq45.H}m payload=${hq45.payload}kg`);

  function printSpaces(spaces, label) {
    const totalVol = spaces.reduce((s, sp) => s + sp.L * sp.W * sp.H, 0);
    const maxVol = Math.max(...spaces.map(sp => sp.L * sp.W * sp.H), 0);
    const containerVol = effDims.maxL * effDims.maxW * effDims.maxH;
    console.log(`\n  ${label}: ${spaces.length}个空间, 总体积 ${totalVol.toFixed(2)}m³ (容器${(totalVol/containerVol*100).toFixed(1)}%), 最大 ${maxVol.toFixed(2)}m³`);
    const sorted = [...spaces].sort((a, b) => (b.L * b.W * b.H) - (a.L * a.W * a.H));
    for (let i = 0; i < Math.min(8, sorted.length); i++) {
      const s = sorted[i];
      const vol = s.L * s.W * s.H;
      console.log(`    [${i}] @(${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) ${pad(`${s.L.toFixed(3)}×${s.W.toFixed(3)}×${s.H.toFixed(3)}`, 24)} = ${vol.toFixed(3)}m³${s.blockedAbove ? ' BLOCKED' : ''}`);
    }
  }

  function checkCanFit(spaces, itemName, l, w, h) {
    console.log(`\n  ── ${itemName} (${l}×${w}×${h}) 可放入? ──`);
    let found = false;
    for (let si = 0; si < spaces.length; si++) {
      const s = spaces[si];
      const orients = [[l,w,h],[l,h,w],[w,l,h],[w,h,l],[h,l,w],[h,w,l]];
      for (const [ol, ow, oh] of orients) {
        if (ol <= s.L + 0.005 && ow <= s.W + 0.005 && oh <= s.H + 0.005) {
          if (!(s.blockedAbove && s.z > 0.005)) {
            found = true;
            console.log(`    Space[${si}] @(${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) ${pad(`${s.L.toFixed(2)}×${s.W.toFixed(2)}×${s.H.toFixed(2)}`, 20)} ← (${ol.toFixed(2)}×${ow.toFixed(2)}×${oh.toFixed(2)})`);
          }
        }
      }
    }
    if (!found) console.log('    ⚠ 无可用空间!');
  }

  // ═══ 场景1: 放置 2 台 Generator ═══
  console.log('\n\n══════════════════════════════════════════════');
  console.log('  场景1: 放置 2 台 Generator-Set (4.80×1.85×2.05, 不可叠, 锁朝向)');
  console.log('══════════════════════════════════════════════');

  let emsSpaces = [_internal.createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false)];
  let placedItems = [];
  let currentWeight = 0;

  printSpaces(emsSpaces, '初始');

  const genItems = [
    { model: 'Generator-A', l: 4.80, w: 1.85, h: 2.05, weight: 6200, stackable: false, orientationFixed: true },
    { model: 'Generator-B', l: 4.80, w: 1.85, h: 2.05, weight: 6200, stackable: false, orientationFixed: true },
  ];

  for (const item of genItems) {
    console.log(`\n  >>> 放置 ${item.model} (当前重 ${currentWeight}kg/${hq45.payload}kg)...`);
    const placed = _internal.emsPlace(item, hq45, emsSpaces, placedItems, currentWeight, 0.05);
    if (placed) {
      placedItems.push(placed);
      currentWeight += item.weight;
      console.log(`  ✓ @(${placed.x.toFixed(2)},${placed.y.toFixed(2)},${placed.z.toFixed(2)}) 朝向 ${placed.l.toFixed(2)}×${placed.w.toFixed(2)}×${placed.h.toFixed(2)}`);
      printSpaces(emsSpaces, '放置后');
    } else {
      console.log(`  ✗ 无法放置!`);
    }
  }

  checkCanFit(emsSpaces, 'Generator-C', 4.80, 1.85, 2.05);
  checkCanFit(emsSpaces, 'Aluminum-Coil', 1.45, 1.45, 0.80);
  checkCanFit(emsSpaces, 'HVAC-Unit', 1.85, 0.95, 2.15);
  checkCanFit(emsSpaces, 'Steel-Plate', 2.50, 1.20, 0.15);
  checkCanFit(emsSpaces, 'Wooden-Pallet', 1.20, 1.00, 0.90);
  checkCanFit(emsSpaces, 'Frozen-Seafood', 1.20, 1.00, 1.15);
  checkCanFit(emsSpaces, 'Carton', 0.60, 0.40, 0.35);

  // ═══ 场景2: 继续放入 Aluminum-Coil ═══
  console.log('\n\n══════════════════════════════════════════════');
  console.log('  场景2: 在 2 台 Generator 后放入 Aluminum-Coil');
  console.log('══════════════════════════════════════════════');

  const alItems = Array.from({ length: 8 }, (_, i) => ({
    model: `Al-${i+1}`, l: 1.45, w: 1.45, h: 0.80,
    weight: 3200, stackable: false, orientationFixed: false
  }));

  let alPlaced = 0;
  for (const item of alItems) {
    const placed = _internal.emsPlace(item, hq45, emsSpaces, placedItems, currentWeight, 0.05);
    if (placed) { placedItems.push(placed); currentWeight += item.weight; alPlaced++; }
    else break;
  }
  console.log(`\n  放入 ${alPlaced} 个 Aluminum-Coil，总重 ${currentWeight}kg`);
  printSpaces(emsSpaces, `${alPlaced}个 Al-Coil 后`);

  if (alPlaced > 0) {
    checkCanFit(emsSpaces, '更多 Al-Coil', 1.45, 1.45, 0.80);
    checkCanFit(emsSpaces, 'HVAC', 1.85, 0.95, 2.15);
    checkCanFit(emsSpaces, 'Carton', 0.60, 0.40, 0.35);
  }

  // ═══ 场景3: 纯铝卷 (无 Generator) ═══
  console.log('\n\n══════════════════════════════════════════════');
  console.log('  场景3 (对照): 纯 Aluminum-Coil，不装 Generator');
  console.log('══════════════════════════════════════════════');

  emsSpaces = [_internal.createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false)];
  placedItems = []; currentWeight = 0;

  let alPlaced2 = 0;
  for (const item of Array.from({length: 8}, (_,i)=>({
    model:`Al-${i+1}`, l:1.45,w:1.45,h:0.80,weight:3200,stackable:false,orientationFixed:false
  }))) {
    const placed = _internal.emsPlace(item, hq45, emsSpaces, placedItems, currentWeight, 0.05);
    if (placed) { placedItems.push(placed); currentWeight += item.weight; alPlaced2++; }
  }
  console.log(`  纯铝卷: 放入 ${alPlaced2}/8 个`);
  printSpaces(emsSpaces, `纯铝卷 ${alPlaced2}个`);

  if (alPlaced2 < 8) checkCanFit(emsSpaces, '剩余 Al-Coil', 1.45, 1.45, 0.80);

  // ═══ 场景4: 空间损失计算 ═══
  console.log('\n\n══════════════════════════════════════════════');
  console.log('  场景4: Generator 占位后的空间损失计算');
  console.log('══════════════════════════════════════════════');

  emsSpaces = [_internal.createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false)];
  placedItems = [];

  const gen1 = { model: 'Gen', l: 4.80, w: 1.85, h: 2.05, weight: 6200, stackable: false, orientationFixed: true };
  _internal.emsPlace(gen1, hq45, emsSpaces, placedItems, 0, 0.05);

  printSpaces(emsSpaces, '1个 Generator 后');

  const totalVol = emsSpaces.reduce((s, sp) => s + sp.L * sp.W * sp.H, 0);
  const containerVol = effDims.maxL * effDims.maxW * effDims.maxH;
  const genVol = 4.80 * 1.85 * 2.05;
  console.log(`\n  容器总体积: ${containerVol.toFixed(2)}m³`);
  console.log(`  Generator 体积: ${genVol.toFixed(2)}m³`);
  console.log(`  剩余 EMS 总积: ${totalVol.toFixed(2)}m³`);
  console.log(`  碎化损失体积: ${(containerVol - totalVol - genVol).toFixed(2)}m³ (${((containerVol-totalVol-genVol)/containerVol*100).toFixed(1)}%)`);

  // Carton 可用空间统计
  let cartonVol = 0;
  for (const s of emsSpaces) {
    if (s.L >= 0.60 && s.W >= 0.40 && s.H >= 0.35 && (!s.blockedAbove || s.z < 0.005)) {
      cartonVol += s.L * s.W * s.H;
    }
  }
  console.log(`  Carton (0.60×0.40×0.35) 可用体积: ${cartonVol.toFixed(2)}m³`);

  // ═══ 场景5: blockedAbove 影响 ═══
  console.log('\n\n══════════════════════════════════════════════');
  console.log('  场景5: blockedAbove 影响分析');
  console.log('══════════════════════════════════════════════');

  emsSpaces = [_internal.createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false)];
  placedItems = [];

  const unstackable = { model: 'Unstackable', l: 2.00, w: 1.50, h: 1.00, weight: 500, stackable: false, orientationFixed: false };
  _internal.emsPlace(unstackable, hq45, emsSpaces, placedItems, 0, 0.05);

  printSpaces(emsSpaces, '不可叠 2.0×1.5×1.0');

  let blockedCount = 0, nonBlockedCount = 0, blockedVol = 0, nonBlockedVol = 0;
  for (const s of emsSpaces) {
    if (s.blockedAbove) { blockedCount++; blockedVol += s.L*s.W*s.H; }
    else { nonBlockedCount++; nonBlockedVol += s.L*s.W*s.H; }
  }
  console.log(`\n  blockedAbove 空间: ${blockedCount}个, ${blockedVol.toFixed(2)}m³`);
  console.log(`  可用空间: ${nonBlockedCount}个, ${nonBlockedVol.toFixed(2)}m³`);
  console.log('  Z分布:');
  for (const s of emsSpaces) {
    console.log(`    z∈[${s.z.toFixed(2)},${(s.z+s.H).toFixed(2)}] ${s.blockedAbove ? 'BLOCKED' : 'free'}`);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  诊断 #3 完成');
  console.log('══════════════════════════════════════════════');
}

main();
