// docs/audit-2026-10-13/probes/cls-c3-repro.js
// C3 批次（2026-10-15 复审遗留清理）——「修复前/修复后」对照探针
//
// 用法：
//   node docs/audit-2026-10-13/probes/cls-c3-repro.js                 # 跑当前工作树（after）
//   node docs/audit-2026-10-13/probes/cls-c3-repro.js --root <dir>    # 跑指定源码目录（如 HEAD 快照 = before）
//   node docs/audit-2026-10-13/probes/cls-c3-repro.js --json          # 仅 JSON
//
// 四项取证：
//   ① P1-6 空间充足却漏装（60×0.4 小件 + 1.2×1.2×1.0 大件 @20GP）
//   ② P2-① 45HQ 未纳入单件分类（12.5m 货：分类 FR/推 40FR vs 应 45HQ）
//   ③ P2-⑥ 推荐提升文案 "X 优于原推荐 X"（模板逻辑复现）
//   ④ P1-8 超长货分类 vs 引擎装载一致性阶梯
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const args = process.argv.slice(2);
const JSON_ONLY = args.includes('--json');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : path.resolve(__dirname, '../../..');

function loadRuntime(files) {
  const context = { console, window: {}, setTimeout, clearTimeout };
  context.window = context;
  vm.createContext(context);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return context;
}

const ctx = loadRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;
const DB = CDB.CONTAINER_DB;

const mk = (model, l, w, h, weight, qty, extra = {}) =>
  ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });

function fp(placed) {
  const lines = placed
    .map(p => [p.model, p.l, p.w, p.h, p.x, p.y, p.z].map(v => typeof v === 'number' ? v.toFixed(4) : v).join(','))
    .sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

const out = {
  root: ROOT,
  generated_at: new Date().toISOString(),
  p16: {},
  p45hq: {},
  ptext: {},
  p18: {}
};

// ═══ ① P1-6：空间充足却漏装 ═══
{
  const smalls = Array.from({ length: 60 }, () => mk('SMALL', 0.4, 0.4, 0.4, 20, 1));
  const big = mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false });
  const gp20 = DB['20GP'];

  const single = PE.packSingleContainer(smalls.concat([big]), gp20, { tolerance: 0.05, sortStrategy: 'smart' });
  const noRetry = PE.packSingleContainer(smalls.concat([big]), gp20, { tolerance: 0.05, sortStrategy: 'smart', _retryPass: true });
  const e2e = PE.calculate(smalls.concat([big]), '20GP', { tolerance: 0.05 });

  out.p16 = {
    // 「重试 pass 关掉」= 修复前的单遍行为（旧实现只有这一遍）
    singlePass_placed: noRetry.placedItems.length,
    singlePass_bigPlaced: noRetry.placedItems.some(p => p.model === 'BIG'),
    default_placed: single.placedItems.length,
    default_bigPlaced: single.placedItems.some(p => p.model === 'BIG'),
    default_recoveredByRetry: single.recoveredByRetry === true,
    default_unplaced: single.unplacedItems.length,
    e2e_containers: e2e.containerCount,
    e2e_placed: e2e.totalPlaced,
    e2e_unplaced: e2e.unplacedCount
  };
}

// ═══ ② P2-①：45HQ 未纳入单件分类 ═══
{
  const cases = [11.98, 12.5, 13.0, 13.5, 13.6];
  const rows = cases.map(len => {
    const item = { model: `BRIDGE-${len}`, l: len, w: 0.6, h: 0.8, weight: 4800, quantity: 1 };
    const cls = CDB.classifyItemByContainerType({ ...item }, 0.05);
    const rec = CDB.autoRecommend([{ ...item }], 0.05);
    const recCode = rec && rec.primary ? rec.primary.code : `${rec.type}`;
    // 引擎实际能力：45HQ / 40FR 各能否单箱装下
    const in45 = PE.calculate([{ ...item }], '45HQ', { tolerance: 0.05 });
    const in40fr = PE.calculate([{ ...item }], '40FR', { tolerance: 0.05 });
    return {
      len,
      classify: cls,
      recommend: recCode,
      reasoning: rec && rec.reasoning ? rec.reasoning : '',
      engine45HQ_placed: in45.totalPlaced,
      engine40FR_placed: in40fr.totalPlaced
    };
  });
  out.p45hq = { cases: rows };
}

// ═══ ③ P2-⑥：推荐提升文案 ═══
{
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  // 旧病灶标记：模板里直接引用 recommendation.primary.code（此时 primary 已被覆盖成新箱型）
  const oldPattern = /优于原推荐 \$\{recommendation\.primary\.code\}/.test(appSrc);
  const prevCodeSaved = /const prevCode = recommendation\.primary\.code/.test(appSrc);
  // 逻辑复现：旧实现先覆盖 primary 再拼文案 → 前后同名
  const oldLogicText = (() => {
    const recommendation = { primary: { code: '40FR' } };
    recommendation.primary = { code: '45HQ' };           // 旧实现：先提升
    return `优于原推荐 ${recommendation.primary.code}`;    // 再拼文案 → 新箱型自己
  })();
  out.ptext = {
    source_has_old_pattern: oldPattern,
    source_saves_prevCode: prevCodeSaved,
    old_logic_rendered_example: oldLogicText
  };
}

// ═══ ④ P1-8：分类 vs 引擎一致性阶梯 ═══
{
  const ladder = [11.5, 11.98, 12.152, 12.5, 13.0, 13.5, 13.556, 13.652, 13.7, 14.0];
  out.p18.rows = ladder.map(len => {
    const item = { model: `L${len}`, l: len, w: 1, h: 1, weight: 1000, quantity: 1 };
    const cls = CDB.classifyItemByContainerType({ ...item }, 0.05);
    const code = { '20GP': '20GP', '40HQ': '40HQ', '45HQ': '45HQ', 'OT': '20OT', 'FR': '40FR' }[cls];
    const placed = code ? PE.calculate([{ ...item }], code, { tolerance: 0.05 }).totalPlaced : 0;
    return { len, classify: cls, engineBox: code || '-', enginePlaced: placed, consistent: cls === 'none' ? placed === 0 : placed === 1 };
  });
  out.p18.allConsistent = out.p18.rows.every(r => r.consistent);
}

if (JSON_ONLY) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const P = (s) => console.log(s);
  P(`═══ C3 复现探针 · root=${ROOT} ═══`);
  P('\n① P1-6 空间充足却漏装（60×0.4 小件 + 1.2×1.2×1.0 大件 @20GP）');
  P(`   单遍（修复前行为）: 装入 ${out.p16.singlePass_placed}/61，大件装入=${out.p16.singlePass_bigPlaced}`);
  P(`   当前实现          : 装入 ${out.p16.default_placed}/61，大件装入=${out.p16.default_bigPlaced}，重试采纳=${out.p16.default_recoveredByRetry}，未装=${out.p16.default_unplaced}`);
  P(`   端到端 calculate  : ${out.p16.e2e_containers} 箱，装入 ${out.p16.e2e_placed}，未装 ${out.p16.e2e_unplaced}`);

  P('\n② P2-① 45HQ 未纳入单件分类');
  for (const r of out.p45hq.cases) {
    P(`   ${String(r.len).padEnd(6)}m  classify=${r.classify.padEnd(5)} 推荐=${r.recommend.padEnd(5)} | 45HQ 实装=${r.engine45HQ_placed}  40FR 实装=${r.engine40FR_placed}`);
  }

  P('\n③ P2-⑥ 推荐提升文案');
  P(`   源码仍用旧模板（primary.code）= ${out.ptext.source_has_old_pattern}；已保存 prevCode = ${out.ptext.source_saves_prevCode}`);
  P(`   旧逻辑渲染示例：${out.ptext.old_logic_rendered_example}`);

  P('\n④ P1-8 分类 vs 引擎一致性阶梯');
  for (const r of out.p18.rows) {
    P(`   ${String(r.len).padEnd(6)}m classify=${r.classify.padEnd(5)} -> ${r.engineBox.padEnd(5)} 实装=${r.enginePlaced} ${r.consistent ? 'OK' : '✗ 不一致'}`);
  }
  P(`   全阶梯一致：${out.p18.allConsistent}`);
  P('\n--- JSON ---');
  P(JSON.stringify(out, null, 2));
}
