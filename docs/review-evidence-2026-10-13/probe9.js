// probe9.js — Planner 无限循环最小复现
// 用法：node --max-old-space-size=64 probe9.js <case>
const path = require('path');
const REPO = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const { createRuntime } = require(path.join(REPO, 'scripts/_load-runtime.js'));
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const P = ctx.window.Planner;
const log = (...a) => console.log(...a);

const mk = (model, l, w, h, weight, qty, stackable = true) => ({ model, l, w, h, weight, quantity: qty, stackable, orientationFixed: false });
const caseName = process.argv[2] || 'repro';

if (caseName === 'repro') {
  log('最小复现：单件 0.5×0.5×2.5（20GP 内高 2.393，可旋转装入 → 分类 20GP）');
  const items = [mk('TALL', 0.5, 0.5, 2.5, 10, 1)];
  log(`  分类=${CDB.classifyItemByContainerType(items[0], 0.01)}（Planner 用 0.01 容差）`);
  log('  调用 planner.planContainerAssignment …');
  const plan = P.planContainerAssignment(items, CDB.CONTAINER_LIST);
  log(`  assignments=${plan.assignments.length} unassigned=${plan.unassigned.length}`);
}

if (caseName === 'control') {
  log('对照：单件 0.5×0.5×2.3（h < 20GP 内高 2.393）');
  const items = [mk('SHORT', 0.5, 0.5, 2.3, 10, 1)];
  log(`  分类=${CDB.classifyItemByContainerType(items[0], 0.01)}`);
  const plan = P.planContainerAssignment(items, CDB.CONTAINER_LIST);
  log(`  assignments=${plan.assignments.length} unassigned=${plan.unassigned.length}`);
  log(`  分配详情=${JSON.stringify(plan.assignments.map(a => ({ c: a.containerCode, n: a.items.length, reason: a.reason })))}`);
}

if (caseName === 'control2') {
  log('对照：单件 3.0×2.0×1.0（常规尺寸）');
  const items = [mk('NORMAL', 3.0, 2.0, 1.0, 500, 1)];
  log(`  分类=${CDB.classifyItemByContainerType(items[0], 0.01)}`);
  const plan = P.planContainerAssignment(items, CDB.CONTAINER_LIST);
  log(`  assignments=${plan.assignments.length} unassigned=${plan.unassigned.length}`);
}

if (caseName === 'floor') {
  log('变体：单件 6.0×5.0×1.0（底面积 30m² > 40GP 地板 28.3m²，体积 30m³ ≤ 0.85×40GP）');
  const items = [mk('FLAT', 6.0, 5.0, 1.0, 500, 1)];
  log(`  分类=${CDB.classifyItemByContainerType(items[0], 0.01)}`);
  const plan = P.planContainerAssignment(items, CDB.CONTAINER_LIST);
  log(`  assignments=${plan.assignments.length} unassigned=${plan.unassigned.length}`);
}

if (caseName === 'parsed') {
  // probe7 解析出的真实条目（尺寸混拼结果）——逐条判定是否会进入 Step4 且 h 超箱高
  const parsed = [
    ['Final', 8.774, 10.8, 2.12], ['Final', 5.7, 6.54, 2.2], ['Final', 3.22, 3.59, 2.15],
    ['Final', 3.96, 4.27, 1.95], ['Final', 4.815, 5.275, 1.0], ['Final', 6.968, 7.394, 1.13],
    ['Final', 1.38, 2.02, 2.5], ['Estimated', 0.45, 0.61, 0.82], ['Estimated', 2.066, 2.306, 1.54],
    ['Estimated', 5.852, 6.212, 1.54], ['Estimated', 0.55, 0.65, 1.36], ['Estimated', 0.55, 1.1, 1.41],
    ['Estimated', 0.35, 0.945, 1.11], ['Estimated', 6.884, 8.764, 2.2],
  ];
  for (const [m, l, w, h] of parsed) {
    const it = mk(m, l, w, h, 0, 1);
    const cls = CDB.classifyItemByContainerType(it, 0.01);
    const vol = (l * w * h).toFixed(1);
    const usable = CDB.CONTAINER_LIST.filter(c => CDB.hasValidOrientationForContainer(it, c, 0.01)).map(c => c.code).join('/');
    let flag = '';
    if (cls === '20GP' || cls === '40HQ') {
      const stds = CDB.CONTAINER_LIST.filter(c => c.type !== 'flatRack' && c.type !== 'openTop')
        .sort((a, b) => (a.L * a.W * a.H) - (b.L * b.W * b.H));
      const pick = stds.find(c => usable.split('/').includes(c.code) && l * w * h <= c.L * c.W * c.H * 0.85);
      if (pick && (h > pick.H || l * w > pick.L * pick.W)) flag = ` ← 触发无限循环条件（建组箱=${pick.code} 内高${pick.H} 地板${(pick.L * pick.W).toFixed(1)}）`;
    }
    log(`  ${l}×${w}×${h} (${vol}m³) 分类=${cls} 可用=${usable || '无'}${flag}`);
  }
}
