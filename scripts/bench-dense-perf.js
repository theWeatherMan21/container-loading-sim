// scripts/bench-dense-perf.js — 密集件性能基准（2026-10-15 C2 批次 · P1-7）
// 用途：性能优化前后 A/B 计时 + 账目守恒校验。
// 口径说明：使用「原生直载」（window=global，无 vm 沙箱）——与浏览器/Worker 真实环境一致；
// vm 沙箱会把重对象运算放大约 10~30 倍，bench 数字请以本脚本为准。
// 运行：node scripts/bench-dense-perf.js [1|2|3]
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'container-db.js'));
require(path.join(__dirname, '..', 'planner.js'));
require(path.join(__dirname, '..', 'packing-engine.js'));
const CDB = window.ContainerDB;
const PE = window.PackingEngine;

function makeItems(modelCount, perModel, seed = 42) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const items = [];
  for (let m = 0; m < modelCount; m++) {
    const l = 0.3 + Math.round(rnd() * 7) / 10;
    const w = 0.25 + Math.round(rnd() * 5) / 10;
    const h = 0.2 + Math.round(rnd() * 5) / 10;
    items.push({
      model: `M${String(m).padStart(3, '0')}`,
      l: Number(l.toFixed(2)), w: Number(w.toFixed(2)), h: Number(h.toFixed(2)),
      weight: 5 + Math.round(rnd() * 45),
      quantity: perModel, stackable: true
    });
  }
  return items;
}

function run(name, items, spec, options) {
  const total = items.reduce((s, i) => s + i.quantity, 0);
  const t0 = Date.now();
  const r = PE.calculate(items, spec, options);
  const ms = Date.now() - t0;
  const conserved = r.totalPlaced + r.unplacedCount === total;
  console.log(
    `${name}: ${total} 件 → ${r.containerCount} 箱 / 装 ${r.totalPlaced} / 余 ${r.unplacedCount} / ${ms}ms / 账目${conserved ? '守恒✓' : '!!!不守恒!!!'} / 平均利用率 ${(r.avgUtilization * 100).toFixed(1)}%`
  );
  return { ms, result: r };
}

const which = process.argv[2];
const t = Date.now();

// 场景 1：870 件 · 58 型号 × 15 · 混合双箱型（20GP+40HQ）
if (!which || which === '1') {
  run('场景1 mixed-870', makeItems(58, 15), null, {
    mixedContainers: [CDB.CONTAINER_DB['20GP'], CDB.CONTAINER_DB['40HQ']],
    tolerance: 0.05
  });
}

// 场景 2：2000 件 · 同型号密集小件 · 单箱型 45HQ（纯层铺压力）
if (!which || which === '2') {
  run('场景2 dense-2000', [{ model: 'DENSE', l: 0.5, w: 0.4, h: 0.3, weight: 8, quantity: 2000, stackable: true }], '45HQ', { tolerance: 0.05 });
}

// 场景 3：8580 件 · 同型号密集小件 · 单箱型 45HQ（原复核口径「>400s 未完成」）
if (!which || which === '3') {
  run('场景3 dense-8580', [{ model: 'DENSE', l: 0.5, w: 0.4, h: 0.3, weight: 8, quantity: 8580, stackable: true }], '45HQ', { tolerance: 0.05 });
}

console.log(`总耗时 ${Date.now() - t}ms`);
