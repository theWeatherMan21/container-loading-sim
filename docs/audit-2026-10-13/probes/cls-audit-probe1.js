// 装箱模拟系统 · 审阅探针（2026-10-13）
// 目的：用真实引擎验证审查中发现的疑点
const path = require('path');
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;
const PL = ctx.window.Planner;
const DB = CDB.CONTAINER_DB;

const out = (title, obj) => console.log(`\n### ${title}\n` + JSON.stringify(obj, null, 1));

// ── 实验 1: FR payload 边界（28-31t 机器件能否进 20FR/40FR）──
console.log('========== 实验1: FR payload 边界 ==========');
console.log('代码口径: 20FR payload=' + DB['20FR'].payload + ', 40FR payload=' + DB['40FR'].payload);
console.log('Hapag官方: 20FR payload=31260, 40FR payload=44050');
for (const w of [27000, 28000, 30000, 31000, 32000]) {
  const item = { model: 'MACH-' + w, l: 2, w: 2, h: 2, weight: w, quantity: 1 };
  const cls = CDB.classifyItemByContainerType(item);
  const vFR20 = CDB.validateItem(item, DB['20FR'], 0, 0.05);
  const vFR40 = CDB.validateItem(item, DB['40FR'], 0, 0.05);
  let calc20 = null, calc40 = null;
  try { const r = PE.calculate([item], '20FR'); calc20 = { placed: r.totalPlaced, unplaced: r.unplacedCount }; } catch (e) { calc20 = 'ERR:' + e.message; }
  try { const r = PE.calculate([item], '40FR'); calc40 = { placed: r.totalPlaced, unplaced: r.unplacedCount }; } catch (e) { calc40 = 'ERR:' + e.message; }
  console.log(`  ${w}kg: classify=${cls} | validate20FR=${vFR20.pass} | validate40FR=${vFR40.pass} | 20FR实际=${JSON.stringify(calc20)} | 40FR实际=${JSON.stringify(calc40)}`);
}

// ── 实验 2: 20GP 装 1m 立方体容量 ──
console.log('\n========== 实验2: 20GP 装 1m 立方 ==========');
{
  const items = [{ model: 'CUBE', l: 1, w: 1, h: 1, weight: 100, quantity: 100 }];
  const r = PE.calculate(items, '20GP');
  const per = r.containers.map((c, i) => `#${i + 1}:${c.placedItems.length}件/util=${(c.utilization * 100).toFixed(1)}%`);
  out('100个1m立方装20GP', { containerCount: r.containerCount, totalPlaced: r.totalPlaced, unplaced: r.unplacedCount, per });
}

// ── 实验 2b: 20GP 装 5.8×1.1×1.1（Y向2件×Z向2层=4件/箱的预期）──
console.log('\n========== 实验2b: 20GP 长条件 ==========');
{
  const items = [{ model: 'BAR', l: 5.8, w: 1.1, h: 1.1, weight: 500, quantity: 12 }];
  const r = PE.calculate(items, '20GP');
  const per = r.containers.map((c, i) => `#${i + 1}:${c.placedItems.length}件/util=${(c.utilization * 100).toFixed(1)}%`);
  out('12件5.8m长条装20GP', { containerCount: r.containerCount, totalPlaced: r.totalPlaced, per });
}

// ── 实验 3: 边界尺寸与门（tolerance=0.05）──
console.log('\n========== 实验3: 尺寸/门边界 ==========');
for (const [l, w, h] of [[5.85, 2.3, 2.3], [5.86, 2.3, 2.3], [5.9, 2.34, 2.29], [2.3, 2.29, 2.292], [2.34, 2.34, 2.3], [2.4, 2.3, 2.3]]) {
  const item = { model: 'T', l, w, h, weight: 100, quantity: 1 };
  const cls = CDB.classifyItemByContainerType(item, 0.05);
  const eff = CDB.getEffectiveMaxDims(DB['20GP'], 0.05);
  const door = CDB.checkDoorConstraint(item, DB['20GP'], 0.05);
  console.log(`  ${l}×${w}×${h}: 20GP尺寸界=${JSON.stringify(eff)} 门=${door.pass} 分类=${cls}`);
}

// ── 实验 4: 不可叠货上不得放东西 ──
console.log('\n========== 实验4: 不可叠约束 ==========');
{
  const items = [
    { model: 'BIG', l: 2, w: 2, h: 2, weight: 800, stackable: false, quantity: 1 },
    { model: 'SMALL', l: 1, w: 1, h: 1, weight: 50, stackable: true, quantity: 10 }
  ];
  const r = PE.calculate(items, '20GP');
  const c0 = r.containers[0];
  const big = c0.placedItems.find(p => p.model === 'BIG');
  const onTop = c0.placedItems.filter(p => p.model === 'SMALL' && p.z >= big.z + big.h - 1e-6 &&
    p.x < big.x + big.l && p.x + p.l > big.x && p.y < big.y + big.w && p.y + p.w > big.y);
  out('不可叠验证', {
    big: { x: big.x, y: big.y, z: big.z }, smallCount: c0.placedItems.filter(p => p.model === 'SMALL').length,
    smallOnTopOfBig: onTop.length, checks0: r.checks[0].errors.map(e => e.type)
  });
}

// ── 实验 5: 100 件 600kg 重货（文档提到的真实案例复盘）──
console.log('\n========== 实验5: 重货密度案例 ==========');
{
  const items = [{ model: 'HEAVY', l: 1.2, w: 1, h: 1, weight: 600, quantity: 100 }];
  const r = PE.calculate(items, '20GP');
  const per = r.containers.map((c, i) => `#${i + 1}:${c.placedItems.length}件/util=${(c.utilization * 100).toFixed(1)}%/wt=${(c.weightUtil * 100).toFixed(1)}%`);
  out('100件×600kg装20GP', { containerCount: r.containerCount, totalPlaced: r.totalPlaced, unplaced: r.unplacedCount, per: per.slice(0, 8), warnings: r.checks.flatMap(c => c.warnings.map(w => w.type)) });
}

// ── 实验 6: 单箱 40FR 珍珠解（12 件特殊组合，来自回归测试）──
console.log('\n========== 实验6: 40FR 12件珍珠解 ==========');
console.log('（跳过——见 scripts/probe-cube500.js 既有探针）');
