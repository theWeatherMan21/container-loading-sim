/**
 * 诊断脚本 #1 — 货物分类 + 推荐链路分析
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

// 手动注入脚本
for (const script of ['container-db.js', 'field-parser.js', 'packing-engine.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', script), 'utf-8');
  const el = dom.window.document.createElement('script');
  el.textContent = code;
  dom.window.document.body.appendChild(el);
}

const CDB = dom.window.ContainerDB;

function main() {
  const testCargo = [
    { model: 'Generator-Set',       l: 4.80, w: 1.85, h: 2.05, weight: 6200, stackable: false, orientationFixed: true,  quantity: 2 },
    { model: 'HVAC-Unit',           l: 1.85, w: 0.95, h: 2.15, weight: 850,  stackable: false, orientationFixed: true,  quantity: 4 },
    { model: 'Aluminum-Coil',       l: 1.45, w: 1.45, h: 0.80, weight: 3200, stackable: false, orientationFixed: false, quantity: 8 },
    { model: 'Steel-Plate-Bundle',  l: 2.50, w: 1.20, h: 0.15, weight: 2800, stackable: true,  orientationFixed: false, quantity: 12 },
    { model: 'Wooden-Pallet-Tiles', l: 1.20, w: 1.00, h: 0.90, weight: 620,  stackable: true,  orientationFixed: false, quantity: 36 },
    { model: 'Frozen-Seafood-Pallet',l: 1.20,w: 1.00, h: 1.15, weight: 450,  stackable: true,  orientationFixed: false, quantity: 20 },
    { model: 'Carton-Consumer-Goods',l: 0.60,w: 0.40, h: 0.35, weight: 12,   stackable: true,  orientationFixed: false, quantity: 500 },
  ];

  const pad = (s, n) => String(s).padEnd(n);

  console.log('══════════════════════════════════════════════');
  console.log('  诊断 #1: 货物分类 + 推荐链路');
  console.log('══════════════════════════════════════════════\n');

  // ── 1. 逐一分类 ──
  console.log('── 1. classifyItemByContainerType 结果 ──\n');
  for (const item of testCargo) {
    const cls = CDB.classifyItemByContainerType(item, 0.05);
    const vol = (item.l * item.w * item.h).toFixed(2);
    console.log(`  ${pad(item.model, 24)} ${pad(cls, 6)} | ${pad(vol, 8)}m³ | ${pad(String(item.weight), 5)}kg | ${item.stackable ? '可叠' : '不可叠'} | ${item.orientationFixed ? '锁朝向' : '自由转'}`);
  }

  // ── 2. fitsByRotation 矩阵 ──
  console.log('\n── 2. 每种货物 vs 每种箱型的 fitsByRotation ──\n');
  const containerTypes = ['20GP', '40GP', '40HQ', '45HQ', '20OT', '40OT', '20RF', '40RF', '40HRF', '20FR', '40FR', '20PF', '40PF'];

  let header = pad('  货物', 26);
  for (const ct of containerTypes) header += pad(ct, 7);
  console.log(header);

  for (const item of testCargo) {
    let row = pad(`  ${item.model}`, 26);
    for (const ct of containerTypes) {
      const spec = CDB.CONTAINER_DB[ct];
      if (!spec) { row += pad('N/A', 7); continue; }
      const eff = CDB.getEffectiveMaxDims(spec, 0.05);
      const fits = CDB.fitsByRotation(item, eff);
      row += pad(fits ? '✓' : '✗', 7);
    }
    console.log(row);
  }

  // ── 3. 推荐引擎 ──
  console.log('\n── 3. autoRecommend ──\n');
  const rec = CDB.autoRecommend(testCargo, 0.05);
  console.log('  primary:', rec?.primary?.code, rec?.primary?.reason);
  console.log('  needsMixed:', rec?.primary?.needsMixed);

  console.log('\n── 4. recommendMixedContainers ──\n');
  const mixed = CDB.recommendMixedContainers(testCargo, 0.05);
  console.log('  specs:', mixed?.specs?.map(s => s.code));
  console.log('  description:', mixed?.description);
  console.log('  reasoning:', mixed?.reasoning);

  if (mixed?.specs) {
    console.log('\n  各箱型有效尺寸 (tolerance=5cm):');
    const seen = new Set();
    for (const spec of mixed.specs) {
      if (seen.has(spec.code)) continue;
      seen.add(spec.code);
      const eff = CDB.getEffectiveMaxDims(spec, 0.05);
      console.log(`    ${spec.code}: L≤${eff.maxL.toFixed(3)}m W≤${eff.maxW.toFixed(3)}m H≤${eff.maxH.toFixed(3)}m payload=${spec.payload}kg`);
    }
  }

  // ── 5. 门约束 ──
  console.log('\n── 5. 门约束 (非FR箱型) ──\n');
  for (const item of testCargo) {
    const fails = [];
    for (const ct of containerTypes) {
      const spec = CDB.CONTAINER_DB[ct];
      if (!spec || spec.type === 'flatRack') continue;
      if (!CDB.checkDoorConstraint(item, spec, 0.05).pass) fails.push(ct);
    }
    console.log(`  ${pad(item.model, 24)} ${fails.length === 0 ? '✓ 全部通过' : '⚠ 失败: ' + fails.join(', ')}`);
  }

  // ── 6. 理论装载能力 ──
  console.log('\n── 6. 理论单箱装载能力 (45HQ) ──\n');
  const hq45 = CDB.CONTAINER_DB['45HQ'];
  const hq45Eff = CDB.getEffectiveMaxDims(hq45, 0.05);
  console.log(`  有效尺寸: L=${hq45Eff.maxL.toFixed(2)}m W=${hq45Eff.maxW.toFixed(2)}m H=${hq45Eff.maxH.toFixed(2)}m 载重=${hq45.payload}kg\n`);

  for (const item of testCargo) {
    let maxCount = 0;
    let bestInfo = '';
    const orients = item.orientationFixed
      ? [[item.l, item.w, item.h], [item.w, item.l, item.h]]
      : [[item.l,item.w,item.h],[item.l,item.h,item.w],[item.w,item.l,item.h],[item.w,item.h,item.l],[item.h,item.l,item.w],[item.h,item.w,item.l]];

    for (const [ol, ow, oh] of orients) {
      if (ol > hq45Eff.maxL || ow > hq45Eff.maxW || oh > hq45Eff.maxH) continue;
      const nx = Math.floor(hq45Eff.maxL / ol);
      const ny = Math.floor(hq45Eff.maxW / ow);
      const nz = item.stackable ? Math.floor(hq45Eff.maxH / oh) : 1;
      const n = nx * ny * nz;
      const maxWt = Math.floor(hq45.payload / item.weight);
      const feasible = Math.min(n, maxWt);
      if (feasible > maxCount) {
        maxCount = feasible;
        bestInfo = `${ol.toFixed(2)}×${ow.toFixed(2)}×${oh.toFixed(2)} (${nx}×${ny}×${nz})`;
      }
    }
    console.log(`  ${pad(item.model, 24)} ${String(maxCount).padStart(4)} 件  | ${bestInfo} | ${(item.l*item.w*item.h).toFixed(2)}m³/件`);
  }

  // ── 7. 推荐引擎对比 ──
  console.log('\n── 7. 不同箱型的单箱型推荐对比 ──\n');
  for (const ct of ['20GP', '40GP', '40HQ', '45HQ']) {
    const spec = CDB.CONTAINER_DB[ct];
    const vol = spec.volume;
    const payload = spec.payload;
    const totalVol = testCargo.reduce((s, i) => s + i.l * i.w * i.h * i.quantity, 0);
    const totalWt = testCargo.reduce((s, i) => s + i.weight * i.quantity, 0);
    const estVol = Math.ceil(totalVol / vol * 1.3);
    const estWt = Math.ceil(totalWt / payload);
    const est = Math.max(1, estVol, estWt);
    console.log(`  ${ct}: ${est} 箱 (vol: ${estVol}, wt: ${estWt}) | ${vol.toFixed(1)}m³ ${payload}kg`);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('  诊断 #1 完成');
  console.log('══════════════════════════════════════════════');
}

try { main(); } catch(e) { console.error(e); process.exit(1); }
