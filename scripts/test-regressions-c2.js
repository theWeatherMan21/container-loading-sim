// scripts/test-regressions-c2.js — C2 轮（2026-10-15 爹地拍板）回归固化
// 覆盖：① FR 官方载重（20FR 31,260 / 40FR 44,050）
//       ② FR 长度限定：超 20FR 柱间长 → 40FR；超 40FR 柱间长+伸出容限(2m) → 警告无法装载
//       ③ FR 平放限定：禁竖放（13m 管不得立于 FR），超长贴端伸出（overLength 标记）
//       ④ 6 面翻转：默认允许（可放倒）；逐件「仅可水平旋转」（orientationFixed）仍生效
//       ⑤ 数据界面全局「允许 6 面翻转」勾选接线（静态契约）
//       ⑥ Worker 基建（预演 + 主计算）：self.window 别名 + 三件套 importScripts + calculate 分支（静态）
//       ⑦ 性能优化：层内支撑批量预计算存在且工作（微用例）
// 用法：node scripts/test-regressions-c2.js（或由 test-all.js 聚合运行）
const path = require('path');
const fs = require('fs');
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

// ═══════════════════════════════════════════
// 1) FR 官方载重
// ═══════════════════════════════════════════
test('C2-PAYLOAD FR 载重取官方值（31,260 / 44,050）', () => {
  assert(CDB.CONTAINER_DB['20FR'].payload === 31260, `20FR payload=${CDB.CONTAINER_DB['20FR'].payload}`);
  assert(CDB.CONTAINER_DB['40FR'].payload === 44050, `40FR payload=${CDB.CONTAINER_DB['40FR'].payload}`);
});

// ═══════════════════════════════════════════
// 2) FR 长度限定：分层 + 平放 + 超限警告
// ═══════════════════════════════════════════
test('C2-FR-TIER 超长货分档：12–13.5m 走 45HQ（不竖放塞 20FR），>13.5m 走 40FR 悬挑', () => {
  // 2026-10-21 爹地分档（替代 10-15「13m→40FR」单档口径）
  const rec = CDB.autoRecommend([{ model: 'P13', l: 13, w: 1, h: 1, weight: 3000, quantity: 1 }], 0.05);
  assert(rec.type === 'single' && rec.primary && rec.primary.code === '45HQ',
    `13m（3t）应推荐 45HQ，实际 ${rec.type}/${rec.primary && rec.primary.code}`);
  assert(rec.primary.code !== '20FR', '13m 不应被竖放塞进 20FR');
  assert(/45HQ/.test(rec.reasoning || '') && /平放/.test(rec.reasoning || ''),
    `原因应说明 45HQ 平放装载，实际 ${rec.reasoning}`);

  // 13.6m（超 45HQ 优先上限 13.5m）→ 40FR 贴端悬挑
  const recOver = CDB.autoRecommend([{ model: 'P13.6', l: 13.6, w: 1, h: 1, weight: 3000, quantity: 1 }], 0.05);
  assert(recOver.type === 'single' && recOver.primary && recOver.primary.code === '40FR',
    `13.6m 应推荐 40FR，实际 ${recOver.type}/${recOver.primary && recOver.primary.code}`);
  assert(/贴端悬挑/.test(recOver.reasoning || ''), `13.6m 应注明贴端悬挑，实际 ${recOver.reasoning}`);

  // 15.2m（每端悬挑 1.77m）→ 40FR + 船司特批提示
  const recFar = CDB.autoRecommend([{ model: 'P15.2', l: 15.2, w: 1, h: 1, weight: 3000, quantity: 1 }], 0.05);
  assert(recFar.type === 'single' && recFar.primary && recFar.primary.code === '40FR',
    `15.2m 应推荐 40FR，实际 ${recFar.type}/${recFar.primary && recFar.primary.code}`);
  assert(/船司特批|超限审批/.test(recFar.reasoning || ''), `15.2m 应提示需船司特批，实际 ${recFar.reasoning}`);
});

test('C2-FR-TIER2 6m 货（20FR 长度外）→ 40FR', () => {
  const rec = CDB.autoRecommend([{ model: 'W6', l: 6, w: 3, h: 3, weight: 500, quantity: 1 }], 0.05);
  assert(rec.type === 'single' && rec.primary && rec.primary.code === '40FR',
    `6m 应推荐 40FR，实际 ${rec.type}/${rec.primary && rec.primary.code}`);
});

test('C2-FR-TIER3 5.5m 货（20FR 可装）→ 20FR', () => {
  const rec = CDB.autoRecommend([{ model: 'W5', l: 5.5, w: 3.5, h: 3, weight: 800, quantity: 1 }], 0.05);
  assert(rec.type === 'single' && rec.primary && rec.primary.code === '20FR',
    `5.5m 应推荐 20FR，实际 ${rec.type}/${rec.primary && rec.primary.code}`);
});

test('C2-FR-WARN 16.2m 货（超 40FR 悬挑上限 16m）→ 警告无法装载该货物', () => {
  const item = { model: 'P16.2', l: 16.2, w: 1, h: 1, weight: 3000, quantity: 1 };
  assert(CDB.classifyItemByContainerType({ ...item }) === 'none', '16.2m 应分类 none');
  const rec = CDB.autoRecommend([{ ...item }], 0.05);
  assert(rec.type === 'failed', `16.2m 应为 failed，实际 ${rec.type}`);
  assert(/无法装载该货物/.test(rec.reasoning || ''), `文案应含“无法装载该货物”，实际 ${rec.reasoning}`);
  assert(/超出框架柜装载上限/.test(rec.reasoning || ''), `文案应含“超出框架柜装载上限”，实际 ${rec.reasoning}`);

  // 14m 曾经也判超限——2026-10-21 起 40FR 悬挑覆盖 14–16m（每端 ≤1.5m 常规），必须能装
  const p14 = CDB.autoRecommend([{ model: 'P14', l: 14, w: 1, h: 1, weight: 3000, quantity: 1 }], 0.05);
  assert(p14.type === 'single' && p14.primary && p14.primary.code === '40FR',
    `14m 应推荐 40FR（悬挑覆盖 14–16m），实际 ${p14.type}/${p14.primary && p14.primary.code}`);
});

test('C2-FR-STAND 平放限定：13m 手选 20FR 装不了；40FR 平放（h=1）+ 超长标记', () => {
  const item = { model: 'P13', l: 13, w: 1, h: 1, weight: 3000, quantity: 1 };
  const r20 = PE.calculate([{ ...item }], '20FR');
  assert(r20.totalPlaced === 0 && r20.unplacedCount === 1, `13m→20FR 应拒装，实际 placed=${r20.totalPlaced}`);
  const r40 = PE.calculate([{ ...item }], '40FR');
  assert(r40.totalPlaced === 1, '13m→40FR 应装入');
  const placed = r40.containers[0].placedItems[0];
  assert(placed.h <= 1 + 1e-6, `应为平放（朝向 h=1），实际 h=${placed.h}`);
  assert(placed.overLength === true, '13m 超 40FR 柱间长，应带超长标记');
});

test('C2-FR-GATE 20FR 长度门：7m 窄件手选 20FR 拒装（超 20FR 柱间长）', () => {
  const r = PE.calculate([{ model: 'P7', l: 7, w: 1, h: 1, weight: 100, quantity: 1 }], '20FR');
  assert(r.totalPlaced === 0 && r.unplacedCount === 1, `7m→20FR 应拒装，实际 placed=${r.totalPlaced}`);
});

// ═══════════════════════════════════════════
// 3) 6 面翻转：默认允许 + 逐件“仅可水平旋转”仍生效（引擎级）
// ═══════════════════════════════════════════
test('C2-ROT-ENGINE 默认可放倒（2.6m 高货横放装入 20GP）；orientationFixed 时拒装', () => {
  const free = { model: 'T26', l: 1, w: 1, h: 2.6, weight: 100, quantity: 1 };
  const rFree = PE.calculate([{ ...free }], '20GP');
  assert(rFree.totalPlaced === 1, `默认 6 面翻转应可放倒装入，实际 ${rFree.totalPlaced}`);
  const rFixed = PE.calculate([{ ...free, orientationFixed: true }], '20GP');
  assert(rFixed.totalPlaced === 0 && rFixed.unplacedCount === 1, `固定朝向应拒装，实际 ${rFixed.totalPlaced}`);
});

// ═══════════════════════════════════════════
// 4) UI / Worker 接线（静态契约）
// ═══════════════════════════════════════════
test('C2-ROT-UI 数据界面「允许 6 面翻转」勾选接线（静态契约）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(/allow-6way-checkbox/.test(html), 'index.html 应含 #allow-6way-checkbox');
  assert(/state\.allow6Way/.test(appSrc), 'app.js 应读写 state.allow6Way');
  assert(/allow-6way-checkbox/.test(appSrc), 'app.js 应绑定 #allow-6way-checkbox');
  assert(/!allow6Way/.test(appSrc), 'app.js 应把全局勾选叠加到 orientationFixed');
});

test('C2-WORKER Worker 基建（预演+计算）静态契约', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'recommendation-worker.js'), 'utf8');
  assert(/self\.window = self/.test(src), 'Worker 应先设置 self.window 别名');
  assert(/importScripts\('container-db\.js', 'planner\.js', 'packing-engine\.js'\)/.test(src),
    'Worker 应按 CDB→Planner→Engine 顺序 importScripts');
  assert(/'calculate'/.test(src) && /calculate-result/.test(src), 'Worker 应支持 calculate 消息');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(/getCalcWorker/.test(appSrc) && /type: 'calculate'/.test(appSrc), 'app.js 应将主计算派发到 Worker');
  assert(/runSyncCalculation/.test(appSrc), 'app.js 应保留主线程回退路径');
});

// ═══════════════════════════════════════════
// 5) 性能优化：层内支撑批量预计算（微用例）
// ═══════════════════════════════════════════
test('C2-PERF-BATCH 层内支撑批量预计算（存在 + 基本正确）', () => {
  const { precomputeLayerSupportChecks, createSpace } = PE._internal;
  assert(typeof precomputeLayerSupportChecks === 'function', 'precomputeLayerSupportChecks 应已导出');
  const space = createSpace(0, 0, 0, 5.9, 2.35, 2.4);
  const placed = [{ x: 0, y: 0, z: 0, l: 0.5, w: 0.5, h: 0.5, weight: 10, stackable: true }];
  const ok = precomputeLayerSupportChecks(space, 0.5, 0.5, 0.5, 11, 4, 10, placed);
  assert(ok.length === 44, `结果长度应为 44，实际 ${ok.length}`);
  assert(ok[0] === 1, '正下方格子应通过（100% 支撑 + 四角 + 承重）');
  assert(ok[1] === 0, '无支撑格子应不通过');
  // 支撑传递性：悬空支撑物不计入（下方件自身无支撑时应失败）
  const placed2 = [
    { x: 0, y: 0, z: 0.5, l: 0.5, w: 0.5, h: 0.5, weight: 10, stackable: true }, // 悬空件（下方无顶面对齐物）
    { x: 0, y: 0, z: 0, l: 0.2, w: 0.2, h: 0.2, weight: 5, stackable: true }      // 只顶到 0.2，撑不住 0.5 件
  ];
  const ok2 = precomputeLayerSupportChecks(space, 0.5, 0.5, 1.0, 11, 4, 10, placed2);
  assert(ok2[0] === 0, '悬空件不得作为支撑（传递性口径保持）');
});

console.log(`\n═══ test-regressions-c2 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
