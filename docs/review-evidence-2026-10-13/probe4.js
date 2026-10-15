// probe4.js — 根因定位：承重启发式 / EMS 丢空间 / tolerance 假值
const L = require('./probe-lib.js');
const { ctx, CDB, PE, DB, log } = L;
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });
const expand = (items) => PE.expandItems(items);
const run = (items, spec, tol) => PE.packSingleContainer(expand(items), spec, { tolerance: tol });

log('\n########## A 承重启发式假设：小件自重是否卡住大件 ##########');
{
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  const mkSmalls = (n, wgt, s) => Array.from({ length: n }, (_, i) => mk('SM' + s, s, s, s, wgt, 1));
  const cases = [
    ['60×0.4 小件 20kg', mkSmalls(60, 20, 0.4), big],
    ['60×0.4 小件 200kg（下方总重足够）', mkSmalls(60, 200, 0.4), big],
    ['60×0.2 细网格 20kg（地面留大片空）', mkSmalls(60, 20, 0.2), big],
    ['60×0.4 小件 20kg + 大件 0.8×0.8×0.5（更小）', mkSmalls(60, 20, 0.4), mk('BIG2', 0.8, 0.8, 0.5, 500, 1, { stackable: false })],
    ['60×0.4 小件 20kg + 大件 1.2³ 但声明 maxStackWeight', mkSmalls(60, 20, 0.4), { ...big, maxStackWeight: 100 }],
  ];
  for (const [label, smalls, bigItem] of cases) {
    const r = run([...smalls, bigItem], DB['20GP'], 0.05);
    const bigOk = r.placedItems.some(p => p.model.startsWith('BIG'));
    const bigPos = r.placedItems.filter(p => p.model.startsWith('BIG')).map(p => `(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`).join(' ');
    log(`  ${label}: 装入=${r.placedItems.length}/${smalls.length + 1} 大件装入=${bigOk} ${bigPos} 利用率=${(r.utilization * 100).toFixed(1)}%`);
  }
}

log('\n########## B tolerance 假值（0 → 0.05） ##########');
{
  const S = 0.5, spec = DB['40HQ'];
  const n = 480;
  for (const t of [undefined, 0, 0.001, 0.01, 0.03, 0.04, 0.05]) {
    const r = t === undefined
      ? PE.packSingleContainer(expand([mk('CUBE', S, S, S, 5, n)]), spec, {})
      : run([mk('CUBE', S, S, S, 5, n)], spec, t);
    log(`  tolerance=${t === undefined ? '(未传)' : t}: 装入=${r.placedItems.length}/${n}`);
  }
  // 经真实入口 calculate
  for (const t of [0, 0.01]) {
    const r = PE.calculate([mk('CUBE', S, S, S, 5, n)], '40HQ', { tolerance: t });
    log(`  calculate(tolerance=${t}): 箱数=${r.containerCount} 装入=${r.totalPlaced}/${r.totalItems} 未装=${r.unplacedCount}`);
  }
  // calculate 传 0 时 packSingleContainer 收到的是 0 还是 0.05？（用 0.5m 立方边界反推）
  const r0 = PE.calculate([mk('CUBE', S, S, S, 5, 481)], '40HQ', { tolerance: 0 });
  log(`  calculate(tolerance=0) 481件: 箱数=${r0.containerCount}（若 0 生效应为 2 箱且第二箱 1 件；若被改成 0.05 则第一箱 460, 第二箱 21）`);
  for (const c of r0.containers) log(`     箱 ${c.containerCode}: 装入=${c.placedItems.length}`);
}

log('\n########## C 60 件 0.4 小件在 20GP 的实际占用（EMS 状态推断） ##########');
{
  const smalls = Array.from({ length: 60 }, () => mk('SM', 0.4, 0.4, 0.4, 20, 1));
  const r = run(smalls, DB['20GP'], 0.05);
  const z = {}; let maxX = 0, maxY = 0, maxZ = 0;
  for (const p of r.placedItems) {
    z[p.z.toFixed(2)] = (z[p.z.toFixed(2)] || 0) + 1;
    maxX = Math.max(maxX, p.x + p.l); maxY = Math.max(maxY, p.y + p.w); maxZ = Math.max(maxZ, p.z + p.h);
  }
  log(`  60 件装载分布(按z)：${JSON.stringify(z)}  占用范围 x≤${maxX.toFixed(2)} y≤${maxY.toFixed(2)} z≤${maxZ.toFixed(2)}`);
  log(`  箱内：L=${DB['20GP'].L} W=${DB['20GP'].W} H=${DB['20GP'].H}`);
  // 同一批 + 1 件 1.2×1.2×1.0 但可叠（stackable=true）
  const r2 = run([...smalls, mk('BIGSTACK', 1.2, 1.2, 1.0, 500, 1)], DB['20GP'], 0.05);
  log(`  加 1 件 1.2×1.2×1.0 可叠(stackable=true)：装入=${r2.placedItems.length}/61`);
  // 加 1 件 1.2×1.2×0.5 不可叠
  const r3 = run([...smalls, mk('BIGLOW', 1.2, 1.2, 0.5, 500, 1, { stackable: false })], DB['20GP'], 0.05);
  log(`  加 1 件 1.2×1.2×0.5 不可叠：装入=${r3.placedItems.length}/61`);
  // 加 1 件 0.8×0.8×0.8 不可叠
  const r4 = run([...smalls, mk('BIG08', 0.8, 0.8, 0.8, 500, 1, { stackable: false })], DB['20GP'], 0.05);
  log(`  加 1 件 0.8×0.8×0.8 不可叠：装入=${r4.placedItems.length}/61`);
  // 55 件小件 + 大件
  const r5 = run([...smalls.slice(0, 55), mk('BIG55', 1.2, 1.2, 1.0, 500, 1, { stackable: false })], DB['20GP'], 0.05);
  log(`  55 件小件 + 1.2×1.2×1.0 不可叠：装入=${r5.placedItems.length}/56 大件=${r5.placedItems.some(p => p.model === 'BIG55')}`);
}

log('\n########## 完成 ##########');
require('fs').writeFileSync(__dirname + '/probe4.log', L.out.join('\n') + '\n');
