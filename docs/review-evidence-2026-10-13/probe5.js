// probe5.js — 空间合并机制 + 容差对整列的影响 + 端到端箱数
const L = require('./probe-lib.js');
const { ctx, CDB, PE, DB, log } = L;
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });
const expand = (items) => PE.expandItems(items);
const I = PE._internal;

log('\n########## A mergeSpaces 对齐要求（部分网格上方空间为何无法成块） ##########');
{
  // 模拟：60 件 0.4 小件铺成 14×5 网格中的 60 格 → 顶部空间逐行合并成条
  const strip = (x, y, len) => I.createSpace(x, y, 0.4, len, 0.4, 1.943, false);
  const rows = [
    strip(0, 0.0, 5.6),   // 14 格满
    strip(0, 0.4, 5.6),
    strip(0, 0.8, 5.6),
    strip(0, 1.2, 5.6),
    strip(0, 1.6, 4.0),   // 第 5 行只铺了 10 格
  ];
  const merged = I.mergeSpaces(rows);
  log(`  输入 5 条顶部条带（第5行短 1.6m）→ 合并结果 ${merged.length} 块：`);
  for (const m of merged) log(`    (x=${m.x}, y=${m.y}, z=${m.z}) L=${m.L.toFixed(2)} W=${m.W.toFixed(2)} H=${m.H.toFixed(2)}`);
  log(`  是否存在 L≥1.2 且 W≥1.2 的整块空间：${merged.some(m => m.L >= 1.2 && m.W >= 1.2)}`);
  // 完整网格（5 行同长）对照
  const full = [0, 0.4, 0.8, 1.2, 1.6].map(y => strip(0, y, 5.6));
  const mergedFull = I.mergeSpaces(full);
  log(`  对照：5 行等长（完整网格）→ 合并结果 ${mergedFull.length} 块：` +
    mergedFull.map(m => `L=${m.L.toFixed(2)} W=${m.W.toFixed(2)} H=${m.H.toFixed(2)}`).join(' | '));
  log(`  对照中是否存在 L≥1.2 且 W≥1.2 的整块空间：${mergedFull.some(m => m.L >= 1.2 && m.W >= 1.2)}`);
}

log('\n########## B 容差 × 立方尺寸：整列丢失率（40HQ） ##########');
{
  const spec = DB['40HQ'];
  log(`  箱内长 L=${spec.L}（默认容差 5cm → 有效长 ${(spec.L - 0.05).toFixed(3)}m）`);
  for (const S of [0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.8]) {
    const theo = Math.floor(spec.L / S) * Math.floor(spec.W / S) * Math.floor(spec.H / S);
    const theo05 = Math.floor((spec.L - 0.05) / S) * Math.floor((spec.W - 0.05) / S) * Math.floor((spec.H - 0.05) / S);
    const r = PE.packSingleContainer(expand([mk('C', S, S, S, 5, theo)]), spec, { tolerance: 0.05 });
    log(`  ${S}m 立方：理论格排=${theo} 扣5cm后格排=${theo05} 实测装入=${r.placedItems.length} 达成率=${(r.placedItems.length / theo * 100).toFixed(1)}% 利用率=${(r.utilization * 100).toFixed(1)}%`);
  }
}

log('\n########## C 端到端箱数：容差 5cm vs 1cm（1440 件 0.5m 立方 40HQ） ##########');
{
  const items = [mk('CUBE', 0.5, 0.5, 0.5, 5, 1440)];
  for (const t of [0.05, 0.03, 0.01]) {
    const r = PE.calculate(items, '40HQ', { tolerance: t });
    log(`  tolerance=${t}: 箱数=${r.containerCount} 装入=${r.totalPlaced}/${r.totalItems} 平均利用率=${(r.avgUtilization * 100).toFixed(1)}% 每箱装入=${r.containers.map(c => c.placedItems.length).join('+')}`);
  }
}

log('\n########## D 端到端：60 小件 + 1 大不可叠（20GP） ##########');
{
  const smalls = Array.from({ length: 60 }, () => mk('SM', 0.4, 0.4, 0.4, 20, 1));
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  const items = [...smalls, big];
  const r = PE.calculate(items, '20GP', { tolerance: 0.05 });
  log(`  箱数=${r.containerCount} 装入=${r.totalPlaced}/${r.totalItems} 未装=${r.unplacedCount} 平均利用率=${(r.avgUtilization * 100).toFixed(1)}%`);
  r.containers.forEach((c, i) => log(`    箱#${i}: 装入=${c.placedItems.length} 利用率=${(c.utilization * 100).toFixed(1)}% 载重=${(c.weightUtil * 100).toFixed(1)}%`));
  // 单次装箱（无多起点优化） vs 多起点
  const single = PE.multiContainerPackOnce ? null : null;
  for (const strat of ['smart', 'small-first', 'input-order', 'big-middle']) {
    const one = PE.packSingleContainer(expand(items), DB['20GP'], { tolerance: 0.05, sortStrategy: strat });
    log(`  单箱（策略 ${strat}）：装入=${one.placedItems.length}/61 利用率=${(one.utilization * 100).toFixed(1)}%`);
  }
  const multi = PE.multiContainerPack(items, DB['20GP'], { tolerance: 0.05 });
  log(`  多起点优化后：箱数=${multi.containerCount} 装入=${multi.totalPlaced}/${multi.totalItems} 平均利用率=${(multi.avgUtilization * 100).toFixed(1)}% 策略=${JSON.stringify(multi.optimization)}`);
}

log('\n########## E 大件在小件之后 vs 之前（排序影响，40HQ） ##########');
{
  const smalls = Array.from({ length: 60 }, () => mk('SM', 0.4, 0.4, 0.4, 20, 1));
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  for (const strat of ['smart', 'input-order', 'small-first', 'group-total-volume-desc', 'weight-desc']) {
    const r = PE.packSingleContainer(expand([...smalls, big]), DB['40HQ'], { tolerance: 0.05, sortStrategy: strat });
    const pos = r.placedItems.find(p => p.model === 'BIG');
    log(`  40HQ ${strat}: 装入=${r.placedItems.length}/61 大件=${pos ? `placed@z=${pos.z.toFixed(2)}` : '未装'}`);
  }
}

log('\n########## 完成 ##########');
require('fs').writeFileSync(__dirname + '/probe5.log', L.out.join('\n') + '\n');
