// FR 放开改造 · 冒烟验证
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;

// 1. 13m 超长货（旧口径装不了）→ 现在应可装 40FR
let item = { model: 'LONG13', l: 13, w: 1, h: 1, weight: 3000, quantity: 1 };
console.log('classify 13m:', CDB.classifyItemByContainerType(item));
let r = PE.calculate([item], '40FR');
console.log('13m → 40FR:', { placed: r.totalPlaced, unplaced: r.unplacedCount });
if (r.containers[0]) console.log('  placed:', r.containers[0].placedItems.map(p => `${p.model}@(${p.x},${p.y},${p.z}) ${p.l}×${p.w}×${p.h} over=${p.overLength}`));

// 2. 30m 巨长货 → 应 none（地板覆盖率<50% 物理底线）
item = { model: 'LONG30', l: 30, w: 1, h: 1, weight: 3000, quantity: 1 };
console.log('\nclassify 30m:', CDB.classifyItemByContainerType(item));

// 3. 3.5m 超宽货 → 40FR 可装
item = { model: 'WIDE35', l: 3, w: 3.5, h: 2, weight: 5000, quantity: 1 };
console.log('\nclassify 3.5m wide:', CDB.classifyItemByContainerType(item));
r = PE.calculate([item], '40FR');
console.log('3.5m wide → 40FR:', { placed: r.totalPlaced, unplaced: r.unplacedCount });

// 4. 5.5m 超宽（覆盖 44%）→ none
item = { model: 'WIDE55', l: 2, w: 5.5, h: 1, weight: 3000, quantity: 1 };
console.log('\nclassify 5.5m wide:', CDB.classifyItemByContainerType(item));

// 5. 回归：100 个 1m 立方 → 20GP
r = PE.calculate([{ model: 'C', l: 1, w: 1, h: 1, weight: 100, quantity: 100 }], '20GP');
console.log('\n回归 100×1m cube → 20GP:', { boxes: r.containerCount, placed: r.totalPlaced, per: r.containers.map(c => c.placedItems.length) });

// 6. 多件 FR 无重叠（13m 长货 + 3×3m 货）—— 碰撞检查验证
const items = [
  { model: 'A', l: 13, w: 1, h: 1, weight: 3000, quantity: 1 },
  { model: 'B', l: 3, w: 1, h: 1, weight: 1000, quantity: 3 },
];
r = PE.calculate(items, '40FR');
console.log('\n13m + 3×3m → 40FR:', { placed: r.totalPlaced, unplaced: r.unplacedCount });
const c0 = r.containers[0];
if (c0) {
  console.log('  placed:', c0.placedItems.map(p => `${p.model}@(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) ${p.l}×${p.w}×${p.h}`));
  const errs = r.checks.flatMap(ch => ch.errors);
  console.log('  errors:', errs.length === 0 ? '(无)' : JSON.stringify(errs.map(e => e.type)));
}

// 7. 20FR vs 40FR 区分：13m 货 → 20FR 不可行（地板覆盖 43%）
console.log('\n13m 货对 20FR frFloorFeasible:', CDB.frFloorFeasible({ l: 13, w: 1, h: 1 }, CDB.CONTAINER_DB['20FR']));
console.log('13m 货对 40FR frFloorFeasible:', CDB.frFloorFeasible({ l: 13, w: 1, h: 1 }, CDB.CONTAINER_DB['40FR']));
