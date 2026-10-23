// 审阅探针批次4：混合装箱完整链路（模拟 UI 路径）
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;
const DB = CDB.CONTAINER_DB;
const ALL = Object.values(DB);

console.log('========== 4a: 30t 单件 + 全部箱型可选（真实计算路径）==========');
{
  const items = [{ model: 'M30', l: 2, w: 2, h: 2, weight: 30000, quantity: 1 }];
  const r = PE.calculate(items, null, { mixedContainers: ALL, tolerance: 0.05 });
  console.log('  containers:', r.containers.map(c => `${c.containerCode}(${c.placedItems.length}件)`).join(', '));
  console.log('  totalPlaced:', r.totalPlaced, 'unplacedCount:', r.unplacedCount, 'hasErrors:', r.hasErrors);
  console.log('  plannerFallback:', r.plannerFallback);
}

console.log('\n========== 4b: 30t 单件 + 用户照推荐只勾 20GP ==========');
{
  const items = [{ model: 'M30', l: 2, w: 2, h: 2, weight: 30000, quantity: 1 }];
  const r = PE.calculate(items, null, { mixedContainers: [DB['20GP']], tolerance: 0.05 });
  console.log('  containers:', r.containers.map(c => `${c.containerCode}(${c.placedItems.length}件)`).join(', ') || '(空)');
  console.log('  unplacedCount:', r.unplacedCount, 'hasErrors:', r.hasErrors);
  console.log('  errors:', JSON.stringify(r.checks.flatMap(c => c.errors.map(e => e.message))));
}

console.log('\n========== 4c: 真实混合场景（标准货 + 超限货）==========');
{
  const items = [
    { model: 'STD', l: 1, w: 1, h: 1, weight: 100, quantity: 30 },
    { model: 'BIG', l: 3, w: 2.6, h: 2.6, weight: 8000, quantity: 1 },  // 超宽超高 → FR/OT
  ];
  const r = PE.calculate(items, null, { mixedContainers: ALL, tolerance: 0.05 });
  console.log('  containers:', r.containers.map(c => `${c.containerCode}(${c.placedItems.length}件,${(c.utilization * 100).toFixed(0)}%)`).join(', '));
  console.log('  totalPlaced:', r.totalPlaced, '/31 unplaced:', r.unplacedCount);
  console.log('  BIG 落在:', r.containers.filter(c => c.placedItems.some(p => p.model === 'BIG')).map(c => c.containerCode));
}

console.log('\n========== 4d: 单箱型模式 40HQ 装 28.5t 件 ==========');
{
  const items = [{ model: 'M28', l: 2, w: 2, h: 2, weight: 28500, quantity: 1 }];
  const r = PE.calculate(items, '40HQ', { tolerance: 0.05 });
  console.log('  placed:', r.totalPlaced, 'unplaced:', r.unplacedCount, 'hasErrors:', r.hasErrors);
}

console.log('\n========== 4e: 20GP 单箱型模式，28.3t 件（略超 28.2t）==========');
{
  const items = [{ model: 'M283', l: 2, w: 2, h: 2, weight: 28300, quantity: 1 }];
  const r = PE.calculate(items, '20GP', { tolerance: 0.05 });
  console.log('  placed:', r.totalPlaced, 'unplaced:', r.unplacedCount);
  console.log('  unplaced 报错信息:', JSON.stringify(r.checks.flatMap(c => c.errors.map(e => e.message))));
}

console.log('\n========== 4f: 大订单性能（1000 件 1m 立方）==========');
{
  const items = [{ model: 'C', l: 1, w: 1, h: 1, weight: 100, quantity: 1000 }];
  const t0 = Date.now();
  const r = PE.calculate(items, '20GP', { tolerance: 0.05 });
  console.log('  containerCount:', r.containerCount, 'totalPlaced:', r.totalPlaced, '耗时ms:', Date.now() - t0);
  console.log('  优化信息:', JSON.stringify(r.optimization || null));
}
