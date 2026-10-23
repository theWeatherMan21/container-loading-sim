// probe6.js — 排序兜底缺失 + 容差整列 + 性能标度（分段）
const L = require('./probe-lib.js');
const { ctx, CDB, PE, DB, log } = L;
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });
const expand = (items) => PE.expandItems(items);
const sec = process.argv[2] || 'A';
const t0 = () => Date.now();

if (sec === 'A') {
  log('\n########## A 大件排最后的代价：input-order 把大件放首位 ##########');
  const smalls = Array.from({ length: 60 }, () => mk('SM', 0.4, 0.4, 0.4, 20, 1));
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  const variants = [
    ['big 在首位 + input-order', expand([big, ...smalls]), 'input-order'],
    ['big 在末位 + input-order', expand([...smalls, big]), 'input-order'],
    ['big 在首位 + smart', expand([big, ...smalls]), 'smart'],
    ['big 在末位 + smart（默认）', expand([...smalls, big]), 'smart'],
    ['big 在首位 + weight-desc', expand([big, ...smalls]), 'weight-desc'],
  ];
  for (const [label, items, strat] of variants) {
    const r = PE.packSingleContainer(items, DB['20GP'], { tolerance: 0.05, sortStrategy: strat });
    const pos = r.placedItems.find(p => p.model === 'BIG');
    log(`  ${label}: 装入=${r.placedItems.length}/61 利用率=${(r.utilization * 100).toFixed(1)}% 大件=${pos ? `z=${pos.z.toFixed(2)}` : '未装'}`);
  }
  // 端到端（默认路径）箱数
  const r1 = PE.calculate([...smalls, big], '20GP', { tolerance: 0.05 });
  log(`  默认端到端 calculate：箱数=${r1.containerCount} 平均利用率=${(r1.avgUtilization * 100).toFixed(1)}% 各箱=${r1.containers.map(c => `${c.containerCode}:${c.placedItems.length}件/${(c.utilization * 100).toFixed(1)}%`).join(' | ')}`);
}

if (sec === 'B') {
  log('\n########## B 容差 × 立方尺寸（40HQ，取整倍尺寸） ##########');
  const spec = DB['40HQ'];
  for (const S of [0.4, 0.5, 0.6, 0.75, 0.8]) {
    const theo = Math.floor(spec.L / S) * Math.floor(spec.W / S) * Math.floor(spec.H / S);
    const theo05 = Math.floor((spec.L - 0.05) / S) * Math.floor((spec.W - 0.05) / S) * Math.floor((spec.H - 0.05) / S);
    const t = t0();
    const r = PE.packSingleContainer(expand([mk('C', S, S, S, 5, theo)]), spec, { tolerance: 0.05 });
    log(`  ${S}m：理论格排=${theo} 扣5cm格排=${theo05} 实测=${r.placedItems.length} 达成率=${(r.placedItems.length / theo * 100).toFixed(1)}% 利用率=${(r.utilization * 100).toFixed(1)}% 耗时=${t0() - t}ms`);
  }
}

if (sec === 'C') {
  log('\n########## C 性能标度：单箱打包耗时 vs 件数 ##########');
  const spec = DB['40HQ'];
  for (const n of [100, 300, 500, 800, 1000]) {
    const items = expand([mk('CUBE', 0.5, 0.5, 0.5, 5, n)]);
    const t = t0();
    const r = PE.packSingleContainer(items, spec, { tolerance: 0.05 });
    log(`  ${n} 件：装入=${r.placedItems.length} 耗时=${t0() - t}ms`);
  }
  for (const n of [1440]) {
    for (const opt of [{ optimize: false }, { randomStarts: 2 }]) {
      const t = t0();
      const r = PE.multiContainerPack([mk('CUBE', 0.5, 0.5, 0.5, 5, n)], spec, { tolerance: 0.05, ...opt });
      log(`  ${n} 件 multiContainerPack ${JSON.stringify(opt)}：箱数=${r.containerCount} 平均利用率=${(r.avgUtilization * 100).toFixed(1)}% 耗时=${t0() - t}ms`);
    }
  }
}

require('fs').writeFileSync(__dirname + `/probe6-${sec}.log`, L.out.join('\n') + '\n');
