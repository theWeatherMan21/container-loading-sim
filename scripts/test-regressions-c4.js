// scripts/test-regressions-c4.js — C4 轮（2026-10-21 爹地拍板：45HQ vs 40FR 分档）回归固化
// 口径（爹地原话分档）：
//   ① ≤12.0m（40HQ 装得下）→ 不推 45HQ/FR；
//   ② 12.0–13.0m 且单件 ≤20t → 45HQ 优先（比 40FR 便宜、免 OOG 超限审批）；
//   ③ 13.0–13.5m → 45HQ 边缘方案：余量小/绑扎吃紧，提示核实箱内长 + 备选 40FR；
//   ④ >13.5m / 超宽 / 需悬挑 → 锁 40FR；悬挑覆盖至 16m（每端 ≤1.5m 常规，更长需船司特批）；
//   ⑤ >16m → 无法装载（需特种运输）；单件 >20t 不走 45HQ。
// 用法：node scripts/test-regressions-c4.js（或由 test-all.js 聚合运行）
const { createRuntime } = require('./_load-runtime');

const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;

let passed = 0;
let failed = 0;
let assertCount = 0;

function assert(condition, message) {
  assertCount++;
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function rec(l, w, h, kg) {
  return CDB.autoRecommend([{ model: `T${l}`, l, w, h, weight: kg, quantity: 1 }], 0.05);
}

function codeOf(r) {
  if (!r) return 'null';
  if (r.type === 'single') return r.primary ? r.primary.code : 'no-primary';
  return r.type;
}

// ═══════════════════════════════════════════
// 1) 长度分档矩阵（爹地 2026-10-21 口径）
// ═══════════════════════════════════════════
test('C4-TIER 长度分档：≤12m 40HQ / 12–13m 45HQ / 13–13.5m 45HQ 边缘 / 13.5–16m 40FR / >16m 拒装', () => {
  assert(codeOf(rec(11.5, 1, 1, 3000)) === '40HQ', `11.5m 应 40HQ，实际 ${codeOf(rec(11.5, 1, 1, 3000))}`);

  for (const l of [12.0, 12.5, 13.0]) {
    const r = rec(l, 1, 1, 3000);
    assert(codeOf(r) === '45HQ', `${l}m 应推荐 45HQ，实际 ${codeOf(r)}`);
    assert(/更经济/.test(r.reasoning) && /45HQ/.test(r.reasoning), `${l}m 文案应说明 45HQ 更经济，实际 ${r.reasoning}`);
  }

  for (const l of [13.2, 13.5]) {
    const r = rec(l, 1, 1, 3000);
    assert(codeOf(r) === '45HQ', `${l}m（边缘档）仍应主推 45HQ，实际 ${codeOf(r)}`);
    assert(/余量仅约/.test(r.reasoning) && /绑扎/.test(r.reasoning) && /40FR/.test(r.reasoning),
      `${l}m 应提示余量/绑扎吃紧并给 40FR 备选，实际 ${r.reasoning}`);
  }

  for (const l of [13.6, 14.0, 14.5]) {
    const r = rec(l, 1, 1, 3000);
    assert(codeOf(r) === '40FR', `${l}m 应推荐 40FR，实际 ${codeOf(r)}`);
    assert(/贴端悬挑/.test(r.reasoning) && /常规超限/.test(r.reasoning), `${l}m 应注明贴端悬挑（常规超限），实际 ${r.reasoning}`);
  }

  for (const l of [15.0, 16.0]) {
    const r = rec(l, 1, 1, 3000);
    assert(codeOf(r) === '40FR', `${l}m 应推荐 40FR（特批档），实际 ${codeOf(r)}`);
    assert(/船司特批|超限审批/.test(r.reasoning), `${l}m 应提示需船司特批/超限审批，实际 ${r.reasoning}`);
  }

  const over = rec(16.2, 1, 1, 3000);
  assert(over.type === 'failed' && /无法装载该货物/.test(over.reasoning),
    `16.2m 应 failed 且含「无法装载该货物」，实际 ${over.type}/${over.reasoning}`);
});

// ═══════════════════════════════════════════
// 2) 重量门槛（单件 >20t 不走 45HQ）
// ═══════════════════════════════════════════
test('C4-WEIGHT 重量门槛：单件 ≤20t 才走 45HQ，超了回退 40FR', () => {
  assert(codeOf(rec(12.5, 1, 1, 20000)) === '45HQ', '20.0t 恰在门槛内应 45HQ');

  const heavy = rec(12.5, 1, 1, 20001);
  assert(codeOf(heavy) === '40FR', `20.001t 应回退 40FR，实际 ${codeOf(heavy)}`);
  assert(/45HQ 规划载重/.test(heavy.reasoning), `应说明 45HQ 规划载重限制，实际 ${heavy.reasoning}`);

  assert(codeOf(rec(12.5, 1, 1, 25000)) === '40FR', '25t 应 40FR');
});

// ═══════════════════════════════════════════
// 3) 超宽/门过不去 → 40FR
// ═══════════════════════════════════════════
test('C4-WIDTH 超宽货（12.5×2.5×2.5，45HQ 门/内宽都过不去）→ 40FR', () => {
  const r = rec(12.5, 2.5, 2.5, 5000);
  assert(codeOf(r) === '40FR', `12.5×2.5×2.5 应 40FR，实际 ${codeOf(r)}`);
});

// ═══════════════════════════════════════════
// 4) 引擎实装与分档一致
// ═══════════════════════════════════════════
test('C4-ENGINE 引擎实装：12.5/13.5m 进 45HQ，14/15/16m 进 40FR（带超长标记），16.2m 装不进', () => {
  for (const l of [12.5, 13.5]) {
    const r = PE.calculate([{ model: 'P', l, w: 1, h: 1, weight: 5000, quantity: 1 }], '45HQ', { tolerance: 0.05 });
    assert(r.totalPlaced === 1 && r.containerCount === 1, `${l}m 应单箱装入 45HQ，实际 ${r.totalPlaced}/${r.containerCount}`);
  }
  for (const l of [14.0, 15.0, 16.0]) {
    const r = PE.calculate([{ model: 'P', l, w: 1, h: 1, weight: 5000, quantity: 1 }], '40FR', { tolerance: 0.05 });
    const placed = r.containers[0] && r.containers[0].placedItems[0];
    assert(r.totalPlaced === 1, `${l}m 应装入 40FR，实际 ${r.totalPlaced}`);
    assert(placed && placed.overLength === true, `${l}m 应带超长标记`);
  }
  const over = PE.calculate([{ model: 'P', l: 16.2, w: 1, h: 1, weight: 5000, quantity: 1 }], '40FR', { tolerance: 0.05 });
  assert(over.totalPlaced === 0, `16.2m 不应装入 40FR，实际 ${over.totalPlaced}`);
});

// ═══════════════════════════════════════════
// 5) 常量单一来源
// ═══════════════════════════════════════════
test('C4-CONST 分档常量导出且取值正确（单一来源）', () => {
  assert(CDB.FR_TOTAL_LENGTH_CEILING_M === 16, `40FR 悬挑上限应为 16m，实际 ${CDB.FR_TOTAL_LENGTH_CEILING_M}`);
  assert(CDB.HQ45_MAX_CARGO_LENGTH_M === 13.5, `45HQ 优先区间上限应为 13.5m，实际 ${CDB.HQ45_MAX_CARGO_LENGTH_M}`);
  assert(CDB.HQ45_EDGE_MIN_LENGTH_M === 13.0, `45HQ 边缘档起点应为 13.0m，实际 ${CDB.HQ45_EDGE_MIN_LENGTH_M}`);
  assert(CDB.HQ45_MAX_ITEM_WEIGHT_KG === 20000, `45HQ 单件重量门槛应为 20t，实际 ${CDB.HQ45_MAX_ITEM_WEIGHT_KG}`);
  assert(Math.abs(CDB.frRoutineLengthLimit(CDB.CONTAINER_DB['40FR']) - 14.652) < 1e-9,
    `40FR 常规悬挑上限应为 14.652m，实际 ${CDB.frRoutineLengthLimit(CDB.CONTAINER_DB['40FR'])}`);
});

console.log(`\n═══ test-regressions-c4 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
