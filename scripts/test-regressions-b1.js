// scripts/test-regressions-b1.js — B1 轮回归固化（B 方向·引擎尾部合并 pass + isInterim 语义修正）
//
// 背景（定界存档：装箱逻辑自查 · 尾货未回退更小箱型 · 2026-08-27）：
//   混合路径 mixedMultiContainerPack 的主循环箱(:1517)/动态扩容兜底箱(:1597)曾缺失
//   isInterim 标记、尾合并调用(:1612)未透传 mergedTags，导致这些箱携带的 unplacedItems
//   （本质是「向下一箱的移交记录」）在 PE.calculate 全管线的 selfCheck unplaced 错误块
//   (:1803 if (!result.isInterim && result.unplacedItems…)) 被误报为「未能装入」，且
//   尾货未参与回退合并产生孤儿箱。
//   修复：三处统一补 isInterim 标记 + 尾合并 pass 介入 → 立方500 由孤儿态收敛为 10 箱。
//
// 覆盖（锚点均来自 scripts/probe-direct-call.js 手工实证基线，2026-08-27）：
//   B-TAIL-1 立方500 × smart   直调 → 恰 10 箱，分布 {"40GP":1,"40HQ":1,"45HQ":8}
//   B-TAIL-2 立方500 × stackable-first 直调 → 同上（策略无关性）
//   B-TAIL-3 双策略账目守恒：totalPlaced=500、unplacedCount=0、totalItems=500，
//            且 Σ逐箱 placedItems.length === totalPlaced（自洽校验和）
//   B-TAIL-4 零特种柜：所有返回箱 code ∈ 传入干货柜集合（20GP/40GP/40HQ/45HQ）
//   B-TAIL-5 isInterim 行为锁：双策略所有容器均带 isInterim=true（unplaced 移交记录
//            的消费豁免前提；任一箱缺标即会在 calculate 全管线误报错误）
//   B-TAIL-6 源码契约：引擎三处 isInterim 标记齐备 + selfCheck 豁免 (!result.isInterim)
//            存在 + Planner 尾组合并块（plannerReason:'尾组合并'，结果级自报机制，
//            依设计不含 isInterim）未被污染
//   B-TAIL-7 重货瓶颈保护（0.5m 立方×500kg×300 件，总重 150t 必然重量切分）：
//            多箱拆分、每箱零超载（totalWeight ≤ payload）、账目守恒
//            —— 守护「尾合并不越重量红线」不变量
// 用法：node scripts/test-regressions-b1.js（或由 test-all.js 聚合运行）

const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./_load-runtime');

const ROOT = path.join(__dirname, '..');
const ENG_SRC = fs.readFileSync(path.join(ROOT, 'packing-engine.js'), 'utf8');

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

const ctx = createRuntime(['container-db.js', 'field-parser.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;

const specs = ['20GP', '40GP', '40HQ', '45HQ'].map(c => CDB.CONTAINER_DB[c]);
const ALLOWED_CODES = new Set(specs.map(s => s.code));
const cube500 = () => [{ model: 'CUBE', l: 1, w: 1, h: 1, quantity: 500, weight: 300, stackable: true }];

// 通用账目校验和：Σ逐箱 placed 必须等于 totalPlaced，且 totalPlaced+unplacedCount=totalItems
function assertAccounting(r, totalExpected) {
  const placedSum = r.containers.reduce((sum, c) => sum + c.placedItems.length, 0);
  assert(placedSum === r.totalPlaced,
    `账目自洽破坏：Σ逐箱placed=${placedSum} !== totalPlaced=${r.totalPlaced}`);
  assert(r.totalPlaced + r.unplacedCount === r.totalItems,
    `账目守恒破坏：${r.totalPlaced}+${r.unplacedCount} !== ${r.totalItems}`);
  if (totalExpected !== undefined) {
    assert(r.totalItems === totalExpected, `totalItems=${r.totalItems}，期望 ${totalExpected}`);
    assert(r.totalPlaced === totalExpected, `totalPlaced=${r.totalPlaced}，期望 ${totalExpected}`);
    assert(r.unplacedCount === 0, `unplacedCount=${r.unplacedCount}，期望 0`);
  }
}

function runMixed(items, options) {
  return PE.mixedMultiContainerPack(items, specs, { tolerance: 0.05, ...options });
}

test('B-TAIL-1 立方500×smart 直调恰10箱且分布 {40GP:1,40HQ:1,45HQ:8}', () => {
  const r = runMixed(cube500(), { sortStrategy: 'smart' });
  assert(r.containerCount === 10, `containerCount=${r.containerCount}，权威锚点为 10`);
  const dist = {};
  r.containers.forEach(c => { dist[c.containerCode] = (dist[c.containerCode] || 0) + 1; });
  const expected = { '40GP': 1, '40HQ': 1, '45HQ': 8 };
  assert(JSON.stringify(dist) === JSON.stringify(expected),
    `分布 ${JSON.stringify(dist)}，权威锚点为 ${JSON.stringify(expected)}`);
});

test('B-TAIL-2 立方500×stackable-first 直调同为10箱同分布（策略无关）', () => {
  const r = runMixed(cube500(), { sortStrategy: 'stackable-first' });
  assert(r.containerCount === 10, `containerCount=${r.containerCount}，权威锚点为 10`);
  const dist = {};
  r.containers.forEach(c => { dist[c.containerCode] = (dist[c.containerCode] || 0) + 1; });
  const expected = { '40GP': 1, '40HQ': 1, '45HQ': 8 };
  assert(JSON.stringify(dist) === JSON.stringify(expected),
    `分布 ${JSON.stringify(dist)}，权威锚点为 ${JSON.stringify(expected)}`);
});

test('B-TAIL-3 双策略账目守恒：500 全装入 + Σ逐箱placed 校验和自洽', () => {
  for (const strategy of ['smart', 'stackable-first']) {
    const r = runMixed(cube500(), { sortStrategy: strategy });
    assertAccounting(r, 500);
    // maxPayload 若由直调填充，必须等于实际使用箱型的 payload 之和（对齐样板 kitten 锁法）
    if (r.maxPayload !== undefined) {
      const expectedPayload = r.containers.reduce(
        (sum, c) => sum + CDB.CONTAINER_DB[c.containerCode].payload, 0);
      assert(r.maxPayload === expectedPayload,
        `maxPayload=${r.maxPayload}，应为使用箱型 payload 之和 ${expectedPayload}`);
    }
  }
});

test('B-TAIL-4 零特种柜：双策略所有返回箱均为传入干货柜类型', () => {
  for (const strategy of ['smart', 'stackable-first']) {
    const r = runMixed(cube500(), { sortStrategy: strategy });
    for (const c of r.containers) {
      assert(ALLOWED_CODES.has(c.containerCode),
        `${strategy} 出现集合外箱型 ${c.containerCode}（特种柜泄漏）`);
    }
  }
});

test('B-TAIL-5 isInterim 行为锁：双策略 10/10 逐箱均带 isInterim=true', () => {
  for (const strategy of ['smart', 'stackable-first']) {
    const r = runMixed(cube500(), { sortStrategy: strategy });
    const missing = r.containers.filter(c => c.isInterim !== true);
    assert(missing.length === 0,
      `${strategy} 有 ${missing.length} 箱缺 isInterim 标记`
      + `（[=${missing.map(c => c.containerCode).join(',')}]）`
      + '——缺标箱若携带 unplacedItems 将在全管线被误报「未能装入」');
    // 交接链一致性：任一带 unplacedItems>0 的箱（除末箱外）都必须豁免于错误块
    const unplacedWithFlag = r.containers.filter(
      c => (c.unplacedItems || []).length > 0 && c.isInterim === true);
    assert(unplacedWithFlag.length > 0 || r.unplacedCount === 0,
      'unplaced 移交记录与 isInterim 豁免机制脱钩');
  }
});

test('B-TAIL-6 源码契约：三处 isInterim 落点齐备 + 豁免点在位 + Planner 尾合并块未污染', () => {
  const flagCount = (ENG_SRC.match(/isInterim:\s*true/g) || []).length;
  assert(flagCount >= 3,
    `packing-engine.js 中 'isInterim: true' 仅 ${flagCount} 处（主循环/扩容兜底/尾合并透传 共需 ≥3）`);
  assert(/!\s*result\.isInterim/.test(ENG_SRC),
    'selfCheck unplaced 错误块的 !result.isInterim 豁免开关丢失');
  assert(/mergedTags:?\s*\{[^}]*isInterim/.test(ENG_SRC.replace(/\n/g, ' ')),
    '尾合并调用缺少 mergedTags.isInterim 透传');
  // Planner 尾组合并为结果级自报机制（plannerReason:'尾组合并'），依设计不含 isInterim，勿动勿染
  const i = ENG_SRC.indexOf('尾组合并');
  assert(i !== -1, "未找到 Planner 尾合并 plannerReason:'尾组合并' 锚点");
  const win = ENG_SRC.slice(Math.max(0, i - 200), i + 200);
  assert(!win.includes('isInterim'),
    'Planner 尾合并块出现 isInterim——结果级自报机制被污染（其 unplaced 语义不同，禁止混标）');
});

test('B-TAIL-7 重货瓶颈保护：150t 钢锭多箱切分且每箱零超载', () => {
  const heavy = [{ model: 'STEEL', l: 0.5, w: 0.5, h: 0.5, quantity: 300, weight: 500, stackable: true }];
  const r = runMixed(heavy);
  assert(r.containers.length >= 2,
    `仅 ${r.containers.length} 箱——总重 150t 物理上不可能单柜承载，重量切分失效`);
  let worstOver = 0;
  for (const c of r.containers) {
    const payload = CDB.CONTAINER_DB[c.containerCode].payload;
    if (c.totalWeight > payload) {
      worstOver = Math.max(worstOver, c.totalWeight - payload);
    }
    assert(ALLOWED_CODES.has(c.containerCode), `重量切分出现集合外箱型 ${c.containerCode}`);
  }
  assert(worstOver === 0,
    `存在超载箱（最大超出 ${Math.round(worstOver)}kg）——尾合并越过重量红线`);
  assertAccounting(r, 300);
  console.log(`     （重货切分实测 ${r.containers.length} 箱，分布 ${JSON.stringify(
    r.containers.reduce((d, c) => ({ ...d, [c.containerCode]: (d[c.containerCode] || 0) + 1 }), {})
  )}）`);
});

console.log(`\n═══ test-regressions-b1 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
