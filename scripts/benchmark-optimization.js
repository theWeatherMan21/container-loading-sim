// scripts/benchmark-optimization.js — 多起点优化 vs 单次基线的可重复基准
//
// 目的：在引入 CP-SAT / 模拟退火等更重的方法之前，固定一份跨订单基准，
// 确保任何优化改动要么提升、要么持平基线（不劣化）。
//
// 口径：
// - 所有场景固定箱型、固定种子、固定时间预算；
// - 基线 = multiContainerPack(optimize:false, sortStrategy:'smart')；
// - 优化 = multiContainerPack(默认优化路径)；
// - 判定：优化结果在 (未装件数, 箱数) 上必须不劣于基线；任一场景劣化 → 退出码 1。
//
// 用法：node scripts/benchmark-optimization.js

const { createRuntime } = require('./_load-runtime');

const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const PE = ctx.window.PackingEngine;
const CDB = ctx.window.ContainerDB;

const SEED = 20260805;
const SCENARIOS = [
  {
    name: 'homogeneous-cartons',
    box: '20GP',
    items: [{ model: 'Carton', l: 0.5, w: 0.4, h: 0.3, weight: 10, quantity: 100, stackable: true }]
  },
  {
    name: 'weight-dominant-mixed',
    box: '45HQ',
    items: [
      { model: 'Dense', l: 1, w: 1, h: 0.5, weight: 5000, quantity: 15, stackable: true },
      { model: 'Fill', l: 0.5, w: 0.4, h: 0.3, weight: 10, quantity: 100, stackable: true }
    ]
  },
  {
    name: 'floor-dominant',
    box: '40HQ',
    items: [
      { model: 'Machine', l: 2.5, w: 1.1, h: 1, weight: 500, quantity: 12, stackable: false },
      { model: 'Fill', l: 0.4, w: 0.3, h: 0.3, weight: 10, quantity: 50, stackable: true }
    ]
  },
  {
    name: 'rotation-sensitive',
    box: '20GP',
    items: [
      { model: 'Rect', l: 1.4, w: 1, h: 1, weight: 100, quantity: 10, stackable: false },
      { model: 'Slim', l: 0.8, w: 0.5, h: 0.5, weight: 20, quantity: 12, stackable: true }
    ]
  },
  {
    name: 'compatibility-limited',
    box: '40FR',
    items: [
      { model: 'Wide', l: 3, w: 2.6, h: 1, weight: 2000, quantity: 3, stackable: false, orientationFixed: true },
      { model: 'Fill', l: 0.5, w: 0.4, h: 0.3, weight: 10, quantity: 20, stackable: true }
    ]
  },
  {
    name: 'representative-401-mixed',
    box: '45HQ',
    items: [
      { model: 'Beam', l: 3.8, w: 0.5, h: 0.45, weight: 3200, quantity: 6, stackable: false },
      { model: 'HVAC', l: 1.85, w: 0.95, h: 2.15, weight: 850, quantity: 4, stackable: false, orientationFixed: true },
      { model: 'Tile', l: 1.2, w: 1, h: 0.95, weight: 720, quantity: 24, stackable: true },
      { model: 'Ingot', l: 1.1, w: 1.1, h: 0.7, weight: 2850, quantity: 10, stackable: true },
      { model: 'Frozen', l: 1.2, w: 0.8, h: 1.2, weight: 550, quantity: 15, stackable: true },
      { model: 'Transformer', l: 2.8, w: 1.6, h: 2.4, weight: 8500, quantity: 2, stackable: false, orientationFixed: true },
      { model: 'Furniture', l: 2.2, w: 0.6, h: 0.15, weight: 85, quantity: 40, stackable: true },
      { model: 'Carton', l: 0.55, w: 0.4, h: 0.35, weight: 15, quantity: 300, stackable: true }
    ]
  }
];

function runScenario(scenario) {
  const spec = CDB.CONTAINER_DB[scenario.box];
  const t0 = process.hrtime.bigint();
  const baseline = PE.multiContainerPack(scenario.items, spec, {
    tolerance: 0.05, sortStrategy: 'smart', optimize: false
  });
  const t1 = process.hrtime.bigint();
  const optimized = PE.multiContainerPack(scenario.items, spec, {
    tolerance: 0.05, optimizationSeed: SEED, randomStarts: 8
  });
  const t2 = process.hrtime.bigint();

  return {
    name: scenario.name,
    box: scenario.box,
    baseline: {
      boxes: baseline.containerCount,
      placed: baseline.totalPlaced,
      unplaced: baseline.unplacedCount,
      ms: Number(Number(t1 - t0) / 1e6).toFixed(1)
    },
    optimized: {
      boxes: optimized.containerCount,
      placed: optimized.totalPlaced,
      unplaced: optimized.unplacedCount,
      ms: Number(Number(t2 - t1) / 1e6).toFixed(1),
      strategy: optimized.optimization.strategy,
      evaluated: optimized.optimization.evaluated,
      lowerBound: optimized.optimization.lowerBound,
      timeUsedMs: optimized.optimization.timeUsedMs
    }
  };
}

function isBetterOrEqual(opt, base) {
  if (opt.unplaced !== base.unplaced) return opt.unplaced < base.unplaced;
  if (opt.boxes !== base.boxes) return opt.boxes <= base.boxes;
  return true;
}

let failed = 0;
console.log('══════════ 多起点优化基准（seed=' + SEED + '）══════════');
for (const scenario of SCENARIOS) {
  const r = runScenario(scenario);
  const better = isBetterOrEqual(r.optimized, r.baseline);
  const delta = r.optimized.boxes < r.baseline.boxes
    ? ` ⬇ 省 ${r.baseline.boxes - r.optimized.boxes} 箱`
    : (r.optimized.unplaced < r.baseline.unplaced ? ` ⬇ 多装 ${r.baseline.unplaced - r.optimized.unplaced} 件` : '');
  console.log(`  ${better ? '✅' : '❌'} ${r.name.padEnd(26)} 基线 ${r.baseline.boxes}箱/${r.baseline.placed}件 ${r.baseline.ms}ms → 优化 ${r.optimized.boxes}箱/${r.optimized.placed}件 ${r.optimized.ms}ms${delta}  [${r.optimized.strategy}, ${r.optimized.evaluated}候选]`);
  if (!better) {
    failed++;
    console.error(`    劣化: ${JSON.stringify(r)}`);
  }
}
console.log(failed === 0 ? '\n✅ 全部场景优化不劣于基线' : `\n❌ ${failed} 个场景劣化`);
process.exit(failed > 0 ? 1 : 0);
