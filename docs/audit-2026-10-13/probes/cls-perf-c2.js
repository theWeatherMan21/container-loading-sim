// docs/audit-2026-10-13/probes/cls-perf-c2.js
// C2 批次 §4「性能优化」的确定性基准探针（优化前后必须字节级等价）
//
// 用法：
//   node docs/audit-2026-10-13/probes/cls-perf-c2.js            # 人类可读 + JSON
//   node docs/audit-2026-10-13/probes/cls-perf-c2.js --json     # 仅 JSON（存档用）
//   node docs/audit-2026-10-13/probes/cls-perf-c2.js --profile  # 额外输出热点自计时
//
// 口径：
// - 全部场景固定种子（LCG），无随机、无时间预算（不依赖机器负载的优化时限）；
// - 每个场景跑 3 轮，取中位数毫秒；结果指纹 = 装载明细的 sha256（排序后规范化文本）；
// - 优化前后指纹必须完全一致（字节级等价），耗时下降才算有效优化。
'use strict';
const crypto = require('crypto');
const { createRuntime } = require('../../../scripts/_load-runtime');

const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const PE = ctx.window.PackingEngine;
const CDB = ctx.window.ContainerDB;

const JSON_ONLY = process.argv.includes('--json');
const WITH_PROFILE = process.argv.includes('--profile');

// ── 确定性随机 ──
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildMixedItems(seed, unitCount) {
  const rnd = lcg(seed);
  const items = [];
  let left = unitCount;
  let idx = 0;
  while (left > 0) {
    idx += 1;
    const qty = Math.min(left, 8 + Math.floor(rnd() * 42));
    const l = 0.30 + Math.round(rnd() * 200) / 100;   // 0.30 – 2.30 m
    const w = 0.25 + Math.round(rnd() * 100) / 100;   // 0.25 – 1.25 m
    const h = 0.20 + Math.round(rnd() * 90) / 100;    // 0.20 – 1.10 m
    items.push({
      model: `M${idx}`,
      l, w, h,
      weight: 20 + Math.round(rnd() * 480),
      quantity: qty,
      stackable: rnd() > 0.15,
      orientationFixed: rnd() < 0.1
    });
    left -= qty;
  }
  return items;
}

function buildFRItems() {
  return [
    { model: 'FR-Long', l: 5.4, w: 2.0, h: 1.2, weight: 12000, quantity: 3, stackable: false },
    { model: 'FR-Wide', l: 3.0, w: 2.6, h: 1.0, weight: 2000, quantity: 4, stackable: false },
    { model: 'FR-Fill', l: 0.8, w: 0.6, h: 0.5, weight: 40, quantity: 40, stackable: true }
  ];
}

// ── 结果指纹（规范化，排序无关噪声剔除）──
function fingerprint(result) {
  const lines = [];
  const containers = (result.containers || []).slice().sort((a, b) =>
    String(a.containerCode || '').localeCompare(String(b.containerCode || '')) ||
    (a.placedItems || []).length - (b.placedItems || []).length
  );
  containers.forEach((c, ci) => {
    lines.push(`C${ci}|${c.containerCode || ''}|${(c.placedItems || []).length}`);
    (c.placedItems || [])
      .slice()
      .sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.z - b.z) || String(a.model).localeCompare(String(b.model)))
      .forEach(p => {
        lines.push([
          p.model,
          Number(p.l).toFixed(4), Number(p.w).toFixed(4), Number(p.h).toFixed(4),
          Number(p.x).toFixed(4), Number(p.y).toFixed(4), Number(p.z).toFixed(4),
          Number(p.weight || 0).toFixed(2)
        ].join(','));
      });
  });
  lines.push(`TOTAL|${result.totalPlaced}|${result.unplacedCount}|${(result.containers || []).length}`);
  lines.push(`UTIL|${Number(result.avgUtilization || 0).toFixed(6)}`);
  const text = lines.join('\n');
  return { hash: crypto.createHash('sha256').update(text).digest('hex'), lines: lines.length };
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function runScenario(name, fn, rounds = 3) {
  const times = [];
  let last = null;
  for (let i = 0; i < rounds; i++) {
    const t0 = process.hrtime.bigint();
    last = fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    times.push(ms);
  }
  const fp = last && last.__fp ? last.__fp : fingerprint(last);
  const summary = last && last.__summary ? last.__summary : {
    containers: (last.containers || []).length,
    totalPlaced: last.totalPlaced,
    unplacedCount: last.unplacedCount,
    avgUtilization: Number(last.avgUtilization || 0)
  };
  return { name, ms_all: times.map(t => Number(t.toFixed(1))), ms_median: Number(median(times).toFixed(1)), fingerprint: fp.hash, fingerprint_lines: fp.lines, summary };
}

// ── 场景 A/B：整单计算（覆盖 findBestPlacement 热路径）──
function scenarioCalculate(name, items, containerCode) {
  const spec = CDB.CONTAINER_DB[containerCode];
  return () => PE.calculate(items.map(i => ({ ...i })), spec, { tolerance: 0.05, autoRetry: true });
}

// ── 场景 C：detectOverlaps 大规模分支（space hash + 索引查询）──
function scenarioOverlaps(count) {
  const rnd = lcg(4242);
  const placed = [];
  for (let i = 0; i < count; i++) {
    placed.push({
      model: `P${i % 50}`,
      x: rnd() * 12, y: rnd() * 2.2, z: rnd() * 2.6,
      l: 0.4, w: 0.4, h: 0.4
    });
  }
  return () => {
    const overlaps = PE._internal.detectOverlaps(placed);
    return {
      __fp: { hash: crypto.createHash('sha256').update(JSON.stringify(overlaps.map(o => `${o.a.model}@${o.a.pos}|${o.b.model}@${o.b.pos}`))).digest('hex'), lines: overlaps.length },
      __summary: { overlaps: overlaps.length }
    };
  };
}

const report = {
  node: process.version,
  generated_at: new Date().toISOString(),
  scenarios: []
};

report.scenarios.push(runScenario('mixed-400×40HQ', scenarioCalculate('mixed-400', buildMixedItems(20261015, 400), '40HQ')));
report.scenarios.push(runScenario('mixed-800×40HQ', scenarioCalculate('mixed-800', buildMixedItems(20261015, 800), '40HQ'), 3));
report.scenarios.push(runScenario('fr-long×40FR', scenarioCalculate('fr-long', buildFRItems(), '40FR')));
report.scenarios.push(runScenario('overlaps-6000', scenarioOverlaps(6000), 3));

if (WITH_PROFILE) {
  // 粗粒度自计时：单场景内各阶段（展开/单箱装箱）——仅辅助定位，不参与等价判定
  const t = [];
  const items = buildMixedItems(20261015, 800).map(i => ({ ...i }));
  let t0 = process.hrtime.bigint();
  const expanded = PE.expandItems(items);
  t.push({ step: 'expandItems', ms: Number(process.hrtime.bigint() - t0) / 1e6, count: expanded.length });
  t0 = process.hrtime.bigint();
  PE.multiContainerPack(items, CDB.CONTAINER_DB['40HQ'], { tolerance: 0.05 });
  t.push({ step: 'multiContainerPack', ms: Number(process.hrtime.bigint() - t0) / 1e6 });
  report.profile_steps = t.map(x => ({ ...x, ms: Number(x.ms.toFixed(1)) }));
}

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('═══ C2 性能基准（确定性，3 轮取中位数）═══');
  for (const s of report.scenarios) {
    console.log(`${s.name.padEnd(18)} median ${String(s.ms_median).padStart(8)} ms   runs=${JSON.stringify(s.ms_all)}`);
    console.log(`  fingerprint=${s.fingerprint}  lines=${s.fingerprint_lines}  summary=${JSON.stringify(s.summary)}`);
  }
  if (report.profile_steps) console.log('  profile:', JSON.stringify(report.profile_steps));
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(report, null, 2));
}
