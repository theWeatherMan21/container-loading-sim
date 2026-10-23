// probe5b.js — 空间合并机制 + 容差整列 + 性能计时（分段，避免超时）
const L = require('./probe-lib.js');
const { ctx, CDB, PE, DB, log } = L;
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });
const expand = (items) => PE.expandItems(items);
const I = PE._internal;
const sec = process.argv[2] || 'all';
const t0 = () => Date.now();

if (sec === 'all' || sec === 'A') {
  log('\n########## A mergeSpaces 对齐要求 ##########');
  const strip = (x, y, len) => I.createSpace(x, y, 0.4, len, 0.4, 1.943, false);
  const rows = [strip(0, 0.0, 5.6), strip(0, 0.4, 5.6), strip(0, 0.8, 5.6), strip(0, 1.2, 5.6), strip(0, 1.6, 4.0)];
  const merged = I.mergeSpaces(rows);
  log(`  60/70 格（第5行短）→ 合并块数=${merged.length}`);
  for (const m of merged) log(`    L=${m.L.toFixed(2)} W=${m.W.toFixed(2)} H=${m.H.toFixed(2)} @(${m.x},${m.y},${m.z})`);
  log(`  存在 L≥1.2 且 W≥1.2 的整块：${merged.some(m => m.L >= 1.2 && m.W >= 1.2)}`);
  const full = [0, 0.4, 0.8, 1.2, 1.6].map(y => strip(0, y, 5.6));
  const mf = I.mergeSpaces(full);
  log(`  70/70 格（完整）→ 合并块数=${mf.length}：${mf.map(m => `L=${m.L.toFixed(2)} W=${m.W.toFixed(2)} H=${m.H.toFixed(2)}`).join(' | ')}`);
  log(`  存在 L≥1.2 且 W≥1.2 的整块：${mf.some(m => m.L >= 1.2 && m.W >= 1.2)}`);
}

if (sec === 'all' || sec === 'B') {
  log('\n########## B 容差 × 立方尺寸（40HQ，5cm 默认容差） ##########');
  const spec = DB['40HQ'];
  log(`  内长 ${spec.L} / 内宽 ${spec.W} / 内高 ${spec.H}；扣 5cm → ${(spec.L - 0.05).toFixed(3)}/${(spec.W - 0.05).toFixed(3)}/${(spec.H - 0.05).toFixed(3)}`);
  for (const S of [0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.8]) {
    const theo = Math.floor(spec.L / S) * Math.floor(spec.W / S) * Math.floor(spec.H / S);
    const theo05 = Math.floor((spec.L - 0.05) / S) * Math.floor((spec.W - 0.05) / S) * Math.floor((spec.H - 0.05) / S);
    const t = t0();
    const r = PE.packSingleContainer(expand([mk('C', S, S, S, 5, theo)]), spec, { tolerance: 0.05 });
    log(`  ${S}m：理论格排=${theo} 扣5cm格排=${theo05} 实测=${r.placedItems.length} 达成率=${(r.placedItems.length / theo * 100).toFixed(1)}% 利用率=${(r.utilization * 100).toFixed(1)}% 耗时=${t0() - t}ms`);
  }
}

if (sec === 'all' || sec === 'E') {
  log('\n########## E 大件在小件之后 vs 之前（40HQ） ##########');
  const smalls = Array.from({ length: 60 }, () => mk('SM', 0.4, 0.4, 0.4, 20, 1));
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  for (const strat of ['smart', 'input-order', 'small-first', 'group-total-volume-desc', 'weight-desc']) {
    const r = PE.packSingleContainer(expand([...smalls, big]), DB['40HQ'], { tolerance: 0.05, sortStrategy: strat });
    const pos = r.placedItems.find(p => p.model === 'BIG');
    log(`  40HQ ${strat}: 装入=${r.placedItems.length}/61 大件=${pos ? `placed@z=${pos.z.toFixed(2)}` : '未装'}`);
  }
  for (const strat of ['smart', 'input-order', 'small-first']) {
    const r = PE.packSingleContainer(expand([...smalls, big]), DB['20GP'], { tolerance: 0.05, sortStrategy: strat });
    const pos = r.placedItems.find(p => p.model === 'BIG');
    log(`  20GP ${strat}: 装入=${r.placedItems.length}/61 大件=${pos ? `placed@z=${pos.z.toFixed(2)}` : '未装'}`);
  }
}

if (sec === 'all' || sec === 'C') {
  log('\n########## C 性能计时（单箱打包） ##########');
  const spec = DB['40HQ'];
  for (const n of [480, 1440]) {
    const items = expand([mk('CUBE', 0.5, 0.5, 0.5, 5, n)]);
    const t = t0();
    const r = PE.packSingleContainer(items, spec, { tolerance: 0.05 });
    log(`  ${n} 件 0.5m 立方 单箱打包：装入=${r.placedItems.length} 耗时=${t0() - t}ms`);
  }
  const items = [mk('CUBE', 0.5, 0.5, 0.5, 5, 1440)];
  for (const opt of [{ randomStarts: 0, optimize: false }, { randomStarts: 2 }, { randomStarts: 12 }]) {
    const t = t0();
    const r = PE.multiContainerPack(items, spec, { tolerance: 0.05, ...opt });
    log(`  1440 件 multiContainerPack ${JSON.stringify(opt)}：箱数=${r.containerCount} 装入=${r.totalPlaced} 平均利用率=${(r.avgUtilization * 100).toFixed(1)}% 耗时=${t0() - t}ms`);
  }
}

require('fs').writeFileSync(__dirname + `/probe5b-${sec}.log`, L.out.join('\n') + '\n');
