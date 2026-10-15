// probe-invariants.js — 独立对抗性探针（评审用）
// 目标：在真实执行的引擎上验证「约束是否被违反」，逐条打印实测证据。
// 用法：node probe-invariants.js
const path = require('path');
const REPO = process.env.REPO || '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const { createRuntime } = require(path.join(REPO, 'scripts/_load-runtime.js'));

const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;
const DB = CDB.CONTAINER_DB;

const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); console.log(s); };
const H = (t) => log('\n══════ ' + t + ' ══════');

function overlaps(a, b) {
  const EPS = 1e-6;
  return a.x + EPS < b.x + b.l && a.x + a.l > b.x + EPS &&
         a.y + EPS < b.y + b.w && a.y + a.w > b.y + EPS &&
         a.z + EPS < b.z + b.h && a.z + a.h > b.z + EPS;
}

// ── P1: 非叠放货物正上方是否被放了东西 ──
function checkStackViolation(res) {
  const items = res.placedItems || [];
  const bad = [];
  for (const base of items) {
    if (base.stackable !== false) continue;
    for (const other of items) {
      if (other === base) continue;
      if (other.z < base.z + base.h - 1e-6) continue;           // 不在其上方
      const ox = Math.max(base.x, other.x), oy = Math.max(base.y, other.y);
      const ox2 = Math.min(base.x + base.l, other.x + other.l), oy2 = Math.min(base.y + base.w, other.y + other.w);
      if (ox < ox2 - 1e-6 && oy < oy2 - 1e-6) bad.push({ base: base.model, above: other.model, baseTop: base.z + base.h, aboveZ: other.z });
    }
  }
  return bad;
}

// ── P2: 非 FR 箱型是否越界 ──
function checkOutOfBounds(res, spec) {
  const bad = [];
  for (const it of (res.placedItems || [])) {
    if (it.x + it.l > spec.L + 1e-6) bad.push(`${it.model} X越界 x+l=${(it.x + it.l).toFixed(3)} > L=${spec.L}`);
    if (it.y + it.w > spec.W + 1e-6) bad.push(`${it.model} Y越界 y+w=${(it.y + it.w).toFixed(3)} > W=${spec.W}`);
    if (it.z + it.h > spec.H + 1e-6) bad.push(`${it.model} Z越界 z+h=${(it.z + it.h).toFixed(3)} > H=${spec.H}`);
  }
  return bad;
}

// ── P3: 是否超重 ──
function checkOverweight(res, spec) {
  const w = (res.placedItems || []).reduce((s, i) => s + i.weight, 0);
  return w > spec.payload + 1e-6 ? [`超重 ${w} > payload ${spec.payload}`] : [];
}

// ── P4: 悬空（z>0 但下方无支撑）──
function checkFloating(res) {
  const bad = [];
  for (const it of (res.placedItems || [])) {
    if (it.z <= 1e-6) continue;
    let supported = false;
    for (const p of res.placedItems) {
      if (p === it) continue;
      if (Math.abs(p.z + p.h - it.z) > 1e-6) continue;
      const ox = Math.max(it.x, p.x), oy = Math.max(it.y, p.y);
      const ox2 = Math.min(it.x + it.l, p.x + p.l), oy2 = Math.min(it.y + it.w, p.y + p.w);
      if (ox < ox2 - 1e-6 && oy < oy2 - 1e-6) { supported = true; break; }
    }
    if (!supported) bad.push(`${it.model} 悬空 @(${it.x.toFixed(2)},${it.y.toFixed(2)},${it.z.toFixed(2)})`);
  }
  return bad;
}

function audit(label, items, spec, options) {
  const res = PE.packSingleContainer(items, spec, options || {});
  const sv = checkStackViolation(res);
  const ob = checkOutOfBounds(res, spec);
  const ow = checkOverweight(res, spec);
  const fl = checkFloating(res);
  log(`\n[${label}] 箱型=${spec.code} 装入=${res.placedItems.length}/${items.length} 未装=${res.unplacedItems.length} 利用率=${(res.utilization * 100).toFixed(1)}% 载重=${(res.weightUtil * 100).toFixed(1)}%`);
  log(`  叠放违规=${sv.length} 越界=${ob.length} 超重=${ow.length} 悬空=${fl.length}`);
  if (sv.length) log('  ✗ 叠放样例: ' + sv.slice(0, 3).map(s => `${s.above} 在 ${s.base} 上方(顶${s.baseTop} vs z${s.aboveZ})`).join(' | '));
  if (ob.length) log('  ✗ 越界样例: ' + ob.slice(0, 3).join(' | '));
  if (ow.length) log('  ✗ 超重: ' + ow.join(' | '));
  if (fl.length) log('  ✗ 悬空样例: ' + fl.slice(0, 3).join(' | '));
  return { res, sv, ob, ow, fl };
}

module.exports = { ctx, CDB, PE, DB, audit, log, out, checkStackViolation, checkOutOfBounds, checkOverweight, checkFloating };
