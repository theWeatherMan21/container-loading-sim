// probe8.js — OOM 阶段定位 + 0 重量影响
const path = require('path');
const REPO = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const { createRuntime } = require(path.join(REPO, 'scripts/_load-runtime.js'));
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;
const P = ctx.window.Planner;
const DB = CDB.CONTAINER_DB;
const log = (...a) => console.log(`[${Date.now() % 100000}]`, ...a);

// 复刻 probe7 解析出的（错误）货物：尺寸混拼 + 0 重量
const parsedItems = [
  ['Final', 8.774, 10.8, 2.12], ['Final', 5.7, 6.54, 2.2], ['Final', 3.22, 3.59, 2.15],
  ['Final', 3.96, 4.27, 1.95], ['Final', 4.815, 5.275, 1.0], ['Final', 6.968, 7.394, 1.13],
  ['Final', 1.38, 2.02, 2.5], ['Estimated', 0.45, 0.61, 0.82], ['Estimated', 2.066, 2.306, 1.54],
  ['Estimated', 5.852, 6.212, 1.54], ['Estimated', 0.55, 0.65, 1.36], ['Estimated', 0.55, 1.1, 1.41],
  ['Estimated', 0.35, 0.945, 1.11], ['Estimated', 6.884, 8.764, 2.2],
].map(([model, l, w, h]) => ({ model, l, w, h, weight: 0, quantity: 1, stackable: true, orientationFixed: false }));

log('阶段1：Planner.planContainerAssignment');
const plan = P.planContainerAssignment(parsedItems, CDB.CONTAINER_LIST);
log(`  assignments=${plan.assignments.length} unassigned=${plan.unassigned.length}`);

log('阶段2：逐个箱型 packSingleContainer');
for (const spec of CDB.CONTAINER_LIST) {
  const r = PE.packSingleContainer(parsedItems, spec, { tolerance: 0.05 });
  log(`  ${spec.code}: 装入=${r.placedItems.length} 未装=${r.unplacedItems.length} 利用率=${(r.utilization * 100).toFixed(1)}%`);
}

log('阶段3：packSingleContainer 仅第 1 件（8.774×10.8×2.12）逐箱型');
const one = [parsedItems[0]];
for (const spec of CDB.CONTAINER_LIST) {
  const r = PE.packSingleContainer(one, spec, { tolerance: 0.05 });
  log(`  ${spec.code}: 装入=${r.placedItems.length}`);
}

log('阶段4：多箱 multiContainerPack（混合箱型列表）');
const m = PE.multiContainerPack(parsedItems, DB['40FR'], { tolerance: 0.05, randomStarts: 0, optimize: false });
log(`  40FR: 箱数=${m.containerCount} 装入=${m.totalPlaced}/${m.totalItems}`);

log('阶段5：calculate 混合路径（可能 OOM，最后执行）');
try {
  const res = PE.calculate(parsedItems, null, { tolerance: 0.05, mixedContainers: CDB.CONTAINER_LIST });
  log(`  OK 箱数=${res.containerCount} 装入=${res.totalPlaced} 未装=${res.unplacedCount}`);
} catch (e) { log(`  抛错：${e.message}`); }
log('完成');
