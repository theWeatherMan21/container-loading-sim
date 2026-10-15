// 独立验证：tolerance=0 是否被静默改写为 0.05
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const PE = ctx.window.PackingEngine;

// 5.88m 长货：tolerance=0 时应可装 20GP（5.9-0=5.9 ≥ 5.88）；tolerance=0.05 时不可（5.9-0.05=5.85 < 5.88）
const mk = () => ([{ model: 'T', l: 5.88, w: 1, h: 1, weight: 100, quantity: 1 }]);

for (const tol of [0, 0.001, 0.01, 0.05]) {
  const r = PE.calculate(mk(), '20GP', { tolerance: tol });
  console.log(`tolerance=${tol}: placed=${r.totalPlaced} unplaced=${r.unplacedCount}`);
}
console.log('\n预期：tolerance=0 与 0.001/0.01 都应 placed=1（5.9-0.01=5.89 ≥ 5.88）；若 tolerance=0 结果为 0 则 0 被改写。');

// 直接测 packSingleContainer 层
const spec = ctx.window.ContainerDB.CONTAINER_DB['20GP'];
const r0 = PE.packSingleContainer(mk(), spec, { tolerance: 0 });
const r5 = PE.packSingleContainer(mk(), spec, { tolerance: 0.05 });
console.log(`\npackSingleContainer 直调: tol=0 → placed=${r0.placedItems.length}; tol=0.05 → placed=${r5.placedItems.length}`);
