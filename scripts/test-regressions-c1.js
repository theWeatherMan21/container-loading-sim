// scripts/test-regressions-c1.js — C1 轮（2026-10-13 双轨审阅修复）回归固化
// 覆盖：P0-1 英文标准表头列识别 / P0-3 相邻全等数据行保留 /
//       Planner 无限循环熔断（原 OOM）/ P1-5 tolerance=0 不被改写 /
//       P1-1 重货推荐链（单件超普柜载重 → 40FR）/ FR 解除尺寸限制（2026-10-13 爹地口径）
// 用法：node scripts/test-regressions-c1.js（或由 test-all.js 聚合运行）
const path = require('path');
const { createRuntime } = require('./_load-runtime');
const XLSX = require(path.join(__dirname, '..', 'node_modules', 'xlsx'));

const ctx = createRuntime(['container-db.js', 'field-parser.js', 'planner.js', 'packing-engine.js']);
ctx.XLSX = XLSX;
const CDB = ctx.window.ContainerDB;
const FP = ctx.window.FieldParser;
const Planner = ctx.window.Planner;
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

function xlsxBuf(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// ═══════════════════════════════════════════
// 1) P0-1：英文标准表头（Net/Gross/L/W/H/Remark）
// ═══════════════════════════════════════════
test('C1-HEADER 英文标准表头列识别（Net/Gross/L/W/H）', () => {
  const aoa = [
    ['Item', 'Description', 'Net', 'Gross', 'L(mm)', 'W(mm)', 'H(mm)', 'Remark'],
    [1, 'Widget-A', 100, 120, 1200, 800, 600, 'Final'],
  ];
  const res = FP.parseFile(xlsxBuf(aoa), 't.xlsx');
  assert(res.items.length === 1, `应解析 1 条，实际 ${res.items.length}`);
  const it = res.items[0];
  assert(it.model === 'Widget-A', `型号应为 Description 值，实际 ${it.model}`);
  assert(Math.abs(it.l - 1.2) < 1e-9 && Math.abs(it.w - 0.8) < 1e-9 && Math.abs(it.h - 0.6) < 1e-9,
    `尺寸应为 1.2×0.8×0.6（真实 L/W/H 列），实际 ${it.l}×${it.w}×${it.h}`);
  assert(it.weight === 120, `重量应取 Gross=120，实际 ${it.weight}`);
  const fieldOf = (h) => (res.mapping.find(m => m.header === h) || {}).field;
  assert(fieldOf('Net') === 'netWeight', `Net 应识别为 netWeight，实际 ${fieldOf('Net')}`);
  assert(fieldOf('Gross') === 'grossWeight', `Gross 应识别为 grossWeight，实际 ${fieldOf('Gross')}`);
  assert(fieldOf('Remark') === 'unknown', `Remark 应被忽略（unknown），实际 ${fieldOf('Remark')}`);
});

test('C1-HEADER2 低置信推断列不得抢占明确列（L 列不被 Gross 污染）', () => {
  const aoa = [
    ['Item', 'Description', 'Qty', 'Gross', 'L(mm)', 'W(mm)', 'H(mm)'],
    [1, 'Widget', 5, 100, 1200, 800, 600],
  ];
  const res = FP.parseFile(xlsxBuf(aoa), 't.xlsx');
  const it = res.items[0];
  assert(Math.abs(it.l - 1.2) < 1e-9, `长度应保持 1.2（不被 Gross=100 污染），实际 ${it.l}`);
  assert(it.quantity === 5, `数量应为 5，实际 ${it.quantity}`);
});

// ═══════════════════════════════════════════
// 2) P0-3：相邻全等数据行保留（不静默删件）
// ═══════════════════════════════════════════
test('C1-DEDUP 相邻全等数据行保留（不静默删件）', () => {
  const aoa = [
    ['型号', '长(mm)', '宽(mm)', '高(mm)', '数量'],
    ['BOX-A', 1200, 800, 600, 1],
    ['BOX-A', 1200, 800, 600, 1],
    ['BOX-B', 500, 400, 300, 5],
  ];
  const res = FP.parseFile(xlsxBuf(aoa), 't.xlsx');
  const total = res.items.reduce((s, i) => s + i.quantity, 0);
  assert(res.items.length === 3, `应保留 3 行，实际 ${res.items.length}`);
  assert(total === 7, `总件数应为 7（1+1+5），实际 ${total}`);
});

// ═══════════════════════════════════════════
// 3) Planner 熔断：原 OOM 最小复现（0.5×0.5×2.5）
// ═══════════════════════════════════════════
test('C1-OOM 高件可放倒不再死循环（原 64MB 堆 1 秒 OOM）', () => {
  const t0 = Date.now();
  const plan = Planner.planContainerAssignment(
    [{ model: 'TALL', l: 0.5, w: 0.5, h: 2.5, weight: 10, quantity: 1, stackable: true }],
    CDB.CONTAINER_LIST
  );
  const ms = Date.now() - t0;
  assert(ms < 2000, `应在 2s 内返回，实际 ${ms}ms`);
  assert(plan.assignments.length + plan.unassigned.length >= 1, '应有分配结果');
  const r = PE.calculate([{ model: 'TALL', l: 0.5, w: 0.5, h: 2.5, weight: 10, quantity: 1 }], null, {
    mixedContainers: Object.values(CDB.CONTAINER_DB), tolerance: 0.05
  });
  assert(r.totalPlaced === 1 && r.unplacedCount === 0,
    `应全部装入，实际 placed=${r.totalPlaced} unplaced=${r.unplacedCount}`);
});

// ═══════════════════════════════════════════
// 4) P1-5：tolerance=0 不被静默改写
// ═══════════════════════════════════════════
test('C1-TOL0 tolerance=0（零间隙）不被改写为 0.05', () => {
  const mk = () => ([{ model: 'T', l: 5.88, w: 1, h: 1, weight: 100, quantity: 1 }]);
  const r0 = PE.calculate(mk(), '20GP', { tolerance: 0 });
  const r01 = PE.calculate(mk(), '20GP', { tolerance: 0.01 });
  const r5 = PE.calculate(mk(), '20GP', { tolerance: 0.05 });
  assert(r0.totalPlaced === 1, `tolerance=0 应可装 5.88m 货（5.9-0=5.9），实际 ${r0.totalPlaced}`);
  assert(r01.totalPlaced === 1, `tolerance=0.01 应可装，实际 ${r01.totalPlaced}`);
  assert(r5.totalPlaced === 0, `tolerance=0.05 应不可装（5.9-0.05=5.85 < 5.88），实际 ${r5.totalPlaced}`);
});

// ═══════════════════════════════════════════
// 5) P1-1：重货推荐链（单件超普柜载重 → 40FR）
// ═══════════════════════════════════════════
test('C1-REC 单件超普柜载重 → FR 链（2026-10-15 官方载重口径）', () => {
  // 2026-10-15 更新：FR 载重改官方值（20FR 31,260 / 40FR 44,050）——30t 单件落 20FR、33t 落 40FR
  const rec = CDB.autoRecommend([{ model: 'M', l: 2, w: 2, h: 2, weight: 30000, quantity: 1 }], 0.05);
  assert(rec.type === 'single' && rec.primary && rec.primary.code === '20FR',
    `30t 单件应推荐 20FR，实际 type=${rec.type} primary=${rec.primary && rec.primary.code}`);
  const r = PE.calculate([{ model: 'M', l: 2, w: 2, h: 2, weight: 30000, quantity: 1 }], '20FR');
  assert(r.totalPlaced === 1, '30t → 20FR 实算应装入');
  const rec33 = CDB.autoRecommend([{ model: 'M', l: 2, w: 2, h: 2, weight: 33000, quantity: 1 }], 0.05);
  assert(rec33.type === 'single' && rec33.primary && rec33.primary.code === '40FR',
    `33t 单件应推荐 40FR，实际 type=${rec33.type} primary=${rec33.primary && rec33.primary.code}`);
  const rec2 = CDB.autoRecommend([{ model: 'M', l: 2, w: 2, h: 2, weight: 45000, quantity: 1 }], 0.05);
  assert(rec2.type === 'failed', `45t 单件应为 failed，实际 ${rec2.type}`);
  assert(/无法装入任何单箱/.test(rec2.reasoning || ''), `文案应说明无法装单箱，实际 ${rec2.reasoning}`);
});

// ═══════════════════════════════════════════
// 6) FR 解除尺寸限制（2026-10-13 口径：不设尺寸限制 + 地板覆盖率物理底线）
// ═══════════════════════════════════════════
test('C1-FR1 FR 超长货可装（悬挑装载 + 地板覆盖判据 + 超长标记）', () => {
  // 2026-10-21 爹地分档：13m/3t 走 45HQ（更经济、免 OOG 审批）；FR 取证改用 13.6m（超 45HQ 优先上限 13.5m）
  assert(CDB.classifyItemByContainerType({ l: 13, w: 1, h: 1, weight: 100 }) === '45HQ', '13m 货应分类 45HQ');
  const r = PE.calculate([{ model: 'LONG', l: 13.6, w: 1, h: 1, weight: 3000, quantity: 1 }], '40FR');
  assert(r.totalPlaced === 1, '13.6m 应可装 40FR（贴端悬挑）');
  assert(r.containers[0].placedItems[0].overLength === true, '13.6m 货应带超长标记');
});

test('C1-FR2 FR 超宽货可装（3.5m 宽）', () => {
  const r = PE.calculate([{ model: 'WIDE', l: 3, w: 3.5, h: 2, weight: 5000, quantity: 1 }], '40FR');
  assert(r.totalPlaced === 1, '3.5m 宽货应可装 40FR');
});

test('C1-FR3 物理底线：三边均超地板宽两倍的立方体不可装', () => {
  assert(CDB.classifyItemByContainerType({ l: 5, w: 5, h: 5, weight: 100 }) === 'none', '5×5×5 应不可装');
  const r = PE.calculate([{ model: 'CUBE', l: 5, w: 5, h: 5, weight: 3000, quantity: 1 }], '40FR');
  assert(r.unplacedCount === 1, '5×5×5 实算应未装');
});

test('C1-FR4 多件 FR 混装无重叠（碰撞检查）', () => {
  const r = PE.calculate([
    { model: 'A', l: 13, w: 1, h: 1, weight: 3000, quantity: 1 },
    { model: 'B', l: 3, w: 1, h: 1, weight: 1000, quantity: 3 },
  ], '40FR');
  assert(r.totalPlaced === 4, `13m+3×3m 应全装，实际 ${r.totalPlaced}`);
  const errs = (r.checks || []).flatMap(c => c.errors).filter(e => e.type === 'overlap');
  assert(errs.length === 0, '不应有重叠错误');
});

// ═══════════════════════════════════════════
// 7) 文案：无重量列提示（不再谎称体积估算）
// ═══════════════════════════════════════════
test('C1-MSG 无重量列文案说明载重校验失效', () => {
  const aoa = [['型号', '长(mm)', '宽(mm)', '高(mm)'], ['C1', 1200, 800, 600]];
  const res = FP.parseFile(xlsxBuf(aoa), 't.xlsx');
  assert(res.warnings.some(w => w.includes('载重校验不会生效')),
    `警告应说明载重校验失效，实际 ${JSON.stringify(res.warnings)}`);
});

// ═══════════════════════════════════════════
// 8) LIVE SUMMARY 面板联动（静态契约，2026-10-13 C1.1）
// ═══════════════════════════════════════════
test('C1-CTX LIVE SUMMARY 面板联动（静态契约）', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(/context-utilization/.test(src), '结果摘要应写入 #context-utilization');
  assert(/context-unloaded/.test(src), '结果摘要应写入 #context-unloaded');
  assert(/risk-line__dot--ok/.test(src), '风险线应支持 ok 态');
});

console.log(`\n═══ test-regressions-c1 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
