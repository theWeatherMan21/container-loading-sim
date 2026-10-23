// probe3.js — 漏装/短装根因定位
const L = require('./probe-lib.js');
const { ctx, CDB, PE, DB, log } = L;
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });
const expand = (items) => PE.expandItems(items);

log('\n########## A 大件被小件"挤掉"的临界点（20GP） ##########');
{
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  for (const k of [0, 1, 2, 5, 10, 20, 40, 60]) {
    const smalls = [];
    for (let i = 0; i < k; i++) smalls.push(mk('SMALL', 0.4, 0.4, 0.4, 20, 1));
    for (const order of ['big-last', 'big-first']) {
      const items = order === 'big-first' ? [big, ...smalls] : [...smalls, big];
      const r = PE.packSingleContainer(expand(items), DB['20GP'], { tolerance: 0.05 });
      const bigOk = r.placedItems.some(p => p.model === 'BIG');
      const unplaced = r.unplacedItems.map(i => i.model);
      log(`  k=${k} ${order}: 装入=${r.placedItems.length}/${items.length} 大件装入=${bigOk} 利用率=${(r.utilization * 100).toFixed(1)}% 未装=${unplaced.join(',') || '无'}`);
    }
  }
}

log('\n########## B 同一场景换 40HQ / 换容差 ##########');
{
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  const smalls = [];
  for (let i = 0; i < 60; i++) smalls.push(mk('SMALL', 0.4, 0.4, 0.4, 20, 1));
  for (const code of ['20GP', '40HQ', '45HQ']) {
    for (const t of [0.05, 0]) {
      const r = PE.packSingleContainer(expand([...smalls, big]), DB[code], { tolerance: t });
      log(`  ${code} tolerance=${t}: 装入=${r.placedItems.length}/61 大件=${r.placedItems.some(p => p.model === 'BIG')}`);
    }
  }
}

log('\n########## C 40HQ 0.5m 立方：容差对格排的影响 ##########');
{
  const S = 0.5, spec = DB['40HQ'];
  const nx = Math.floor(spec.L / S), ny = Math.floor(spec.W / S), nz = Math.floor(spec.H / S);
  log(`  理论：${nx}×${ny}×${nz} = ${nx * ny * nz} 件（需长 ${(nx * S).toFixed(3)}m ≤ 内长 ${spec.L}）`);
  for (const t of [0.05, 0.02, 0.01, 0]) {
    const r = PE.packSingleContainer(expand([mk('CUBE', S, S, S, 5, nx * ny * nz)]), spec, { tolerance: t });
    log(`  tolerance=${t}: 单箱装入=${r.placedItems.length} 利用率=${(r.utilization * 100).toFixed(1)}% 未装=${r.unplacedItems.length}`);
  }
  for (const t of [0.05, 0]) {
    const m = PE.calculate(expand([mk('CUBE', S, S, S, 5, nx * ny * nz * 3)]), '40HQ', { tolerance: t });
    log(`  tolerance=${t}: 1440 件 端到端箱数=${m.containerCount} 平均利用率=${(m.avgUtilization * 100).toFixed(1)}%`);
  }
  // 0.4m 立方对照（不落在容差边界）
  const S2 = 0.4;
  const n2 = Math.floor(spec.L / S2) * Math.floor(spec.W / S2) * Math.floor(spec.H / S2);
  const r2 = PE.packSingleContainer(expand([mk('CUBE4', S2, S2, S2, 5, n2)]), spec, { tolerance: 0.05 });
  log(`  对照 0.4m 立方 理论 ${n2} 件：实测=${r2.placedItems.length} 利用率=${(r2.utilization * 100).toFixed(1)}%`);
}

log('\n########## D 123 件异构：单箱为什么只装 73 件 ##########');
{
  const items = [];
  for (let i = 0; i < 120; i++) items.push(mk('C' + (i % 3), 0.6 + 0.1 * (i % 3), 0.5, 0.4, 30, 1));
  items.push(mk('BIG', 2.4, 1.1, 1.2, 900, 3, { stackable: false }));
  const ex = expand(items);
  for (const strat of ['smart', 'small-first', 'big-middle', 'group-total-volume-desc', 'input-order']) {
    const r = PE.packSingleContainer(ex, DB['20GP'], { tolerance: 0.05, sortStrategy: strat });
    log(`  ${strat}: 单箱装入=${r.placedItems.length}/${ex.length} 利用率=${(r.utilization * 100).toFixed(1)}% 未装=${r.unplacedItems.length}`);
  }
  // 只放同型号小件，看单箱能不能装满（无大件干扰）
  for (const q of [40, 100, 200]) {
    const r = PE.packSingleContainer(expand([mk('C0', 0.6, 0.5, 0.4, 30, q)]), DB['20GP'], { tolerance: 0.05 });
    log(`  单型号 0.6×0.5×0.4 ×${q}: 装入=${r.placedItems.length} 利用率=${(r.utilization * 100).toFixed(1)}%`);
  }
  for (const q of [100, 300]) {
    const r = PE.packSingleContainer(expand([mk('C0', 1.2, 0.8, 0.6, 30, q)]), DB['40HQ'], { tolerance: 0.05 });
    log(`  单型号 1.2×0.8×0.6 ×${q} @40HQ: 装入=${r.placedItems.length} 利用率=${(r.utilization * 100).toFixed(1)}%`);
  }
}

log('\n########## E selfCheck 是否报错（漏装场景） ##########');
{
  const items = [];
  for (let i = 0; i < 120; i++) items.push(mk('C' + (i % 3), 0.6 + 0.1 * (i % 3), 0.5, 0.4, 30, 1));
  const ex = expand(items);
  const r = PE.packSingleContainer(ex, DB['20GP'], { tolerance: 0.05 });
  const ch = PE.selfCheck({ ...r, isInterim: false }, DB['20GP'], 0.05);
  log(`  单箱 120 件：装入=${r.placedItems.length} selfCheck.pass=${ch.pass} errors=${JSON.stringify(ch.errors.map(e => e.type))} warnings=${JSON.stringify(ch.warnings.map(w => w.type))}`);
  const ch2 = PE.selfCheck({ ...r, isInterim: true }, DB['20GP'], 0.05);
  log(`  同结果但 isInterim=true：pass=${ch2.pass} errors=${JSON.stringify(ch2.errors.map(e => e.type))}`);
}

log('\n########## 完成 ##########');
require('fs').writeFileSync(__dirname + '/probe3.log', L.out.join('\n') + '\n');
