// scripts/test-regressions-c3.js — C3 轮（2026-10-15 复审遗留清理）回归固化
// 覆盖：① P1-6 空间充足却漏装 → 未装件重排重试 pass（严格改进、绝不劣化）
//       ② P1-8 超长货分类与引擎装载一致性回归（C2 已隐式修复，此处固化防回退）
//       ③ P2-5 推荐提升文案 "X 优于原推荐 X" bug（静态契约）
//       ④ P2-4 selfCheck 越界口径与放置路径统一（±5cm 宽口径修正）
// 注意：45HQ 纳入单件分类（复审 P2-①）属于**待爹地拍板项**（与"13m→40FR"口径冲突，未获批），
//       本文件按已批准的「长货走 FR」口径断言；拍板后可用
//       docs/audit-2026-10-13/worker-c3-45hq-proposal.patch 合入并同步更新相关断言。
// 用法：node scripts/test-regressions-c3.js（或由 test-all.js 聚合运行）
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
// 1) P1-6：未装件重排重试 pass（空间充足却漏装）
// ═══════════════════════════════════════════
test('C3-P16-RETRY 小件铺满地面后大件不再漏装（重试 pass 严格改进）', () => {
  const gp20 = CDB.CONTAINER_DB['20GP'];
  const small = Array.from({ length: 60 }, () => ({
    model: 'SMALL', l: 0.4, w: 0.4, h: 0.4, weight: 20, stackable: true, quantity: 1
  }));
  const big = [{ model: 'BIG', l: 1.2, w: 1.2, h: 1.0, weight: 500, stackable: false, quantity: 1 }];
  const items = [...small, ...big];

  // 单遍（_retryPass 关掉重试）= 修复前行为：历史 60/61，大件漏装
  const singlePass = PE.packSingleContainer(items, gp20, { tolerance: 0.05, sortStrategy: 'smart', _retryPass: true });
  assert(singlePass.placedItems.length === 60, `单遍应复现 60/61 漏装，实际 ${singlePass.placedItems.length}`);
  assert(!singlePass.placedItems.some(p => p.model === 'BIG'), '单遍应漏掉大件（复现前提）');

  // 默认（带重试 pass）→ 61/61
  const r = PE.packSingleContainer(items, gp20, { tolerance: 0.05, sortStrategy: 'smart' });
  assert(r.placedItems.length === 61, `重试后应装入 61/61，实际 ${r.placedItems.length}`);
  assert(r.unplacedItems.length === 0, `重试后不应有未装件，实际 ${r.unplacedItems.length}`);
  assert(r.recoveredByRetry === true, '应从重试 pass 采纳结果（recoveredByRetry 标记）');

  // 端到端单箱
  const e2e = PE.calculate(items, '20GP', { tolerance: 0.05 });
  assert(e2e.totalPlaced === 61 && e2e.unplacedCount === 0, `端到端应全装，实际 ${e2e.totalPlaced}/${e2e.unplacedCount}`);
  assert(e2e.containerCount === 1, `应 1 箱，实际 ${e2e.containerCount}`);
});

test('C3-P16-NODEGRADE 重试不劣化：真装不下的货仍保持未装且计数不减少', () => {
  const gp20 = CDB.CONTAINER_DB['20GP'];
  const small = Array.from({ length: 60 }, () => ({
    model: 'SMALL', l: 0.4, w: 0.4, h: 0.4, weight: 20, stackable: true, quantity: 1
  }));
  const big = { model: 'BIG', l: 1.2, w: 1.2, h: 1.0, weight: 500, stackable: false, quantity: 1 };
  const giant = { model: 'GIANT', l: 3.0, w: 3.0, h: 3.0, weight: 2000, stackable: false, quantity: 1 }; // 20GP 物理放不下
  const r = PE.packSingleContainer([...small, big, giant], gp20, { tolerance: 0.05, sortStrategy: 'smart' });
  assert(r.placedItems.length === 61, `应装入 61 件（60 小 + 1 大），实际 ${r.placedItems.length}`);
  assert(r.unplacedItems.length === 1 && r.unplacedItems[0].model === 'GIANT',
    `仅 GIANT 应保持未装，实际 ${JSON.stringify(r.unplacedItems.map(u => u.model))}`);
});

// ═══════════════════════════════════════════
// 2) P2-5：推荐提升文案 bug（静态契约）
// ═══════════════════════════════════════════
test('C3-PROMO 推荐提升文案不再出现"X 优于原推荐 X"（静态契约）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert(!/优于原推荐 \$\{recommendation\.primary\.code\}/.test(src),
    '文案模板不应直接读 recommendation.primary.code（覆盖后=新箱型）');
  assert(/const prevCode = recommendation\.primary\.code/.test(src),
    '提升前必须先保存原推荐码 prevCode');
  const prevUsages = (src.match(/优于原推荐 \$\{prevCode\}/g) || []).length;
  assert(prevUsages === 2, `两处提升分支都应使用 prevCode，实际 ${prevUsages} 处`);
});

// ═══════════════════════════════════════════
// 3) P1-8：分类 vs 引擎一致性（C2 已隐式修复 → 固化防回退）
// ═══════════════════════════════════════════
test('C3-P18-CONSISTENCY 分类结论与对应箱型的实际装载能力完全对齐（超长阶梯）', () => {
  const boxOf = { '20GP': '20GP', '40HQ': '40HQ', '45HQ': '45HQ', 'OT': '20OT', 'FR': '40FR' };
  const ladder = [5.5, 11.5, 11.98, 12.152, 12.5, 13.0, 13.5, 13.556, 13.652, 13.7, 14.0];
  for (const len of ladder) {
    const item = { model: `L${len}`, l: len, w: 1, h: 1, weight: 1000, quantity: 1 };
    const cls = CDB.classifyItemByContainerType({ ...item });
    if (cls === 'none') {
      const fr = PE.calculate([{ ...item }], '40FR', { tolerance: 0.05 });
      assert(fr.totalPlaced === 0, `${len}m 分类 none 却被 40FR 装入（classify/引擎不一致）`);
      continue;
    }
    assert(Object.prototype.hasOwnProperty.call(boxOf, cls), `${len}m 分类值异常：${cls}`);
    // 分类给出的箱型必须真能装（分类只承诺"最低箱型类别可装单件"）
    const r = PE.calculate([{ ...item }], boxOf[cls], { tolerance: 0.05 });
    assert(r.totalPlaced === 1, `${len}m 分类 ${cls} 但引擎装不进 ${boxOf[cls]}（classify/引擎不一致）`);
  }
});

// ═══════════════════════════════════════════
// 4) P2-4：selfCheck 越界口径（与放置路径统一）
// ═══════════════════════════════════════════
test('C3-SELFCHECK-BOUNDS 超出有效边界的货物必须被自检捕获（±5cm 宽口径修正）', () => {
  const spec = CDB.CONTAINER_DB['20GP'];
  const eff = CDB.getEffectiveMaxDims(spec, 0.05);
  const fakeResult = {
    placedItems: [{
      model: 'X', x: eff.maxL - 0.5, y: 0, z: 0,
      l: 0.55, w: 0.5, h: 0.5, weight: 10,
      stackable: true, orientationFixed: false
    }],
    utilization: 0,
    totalWeight: 10
  };
  const ch = PE.selfCheck(fakeResult, spec, 0.05);
  assert(ch.errors.some(e => e.type === 'outOfBounds'),
    'X 向超出有效边界 5cm 的货物应被自检标记 outOfBounds');
});

console.log(`\n═══ test-regressions-c3 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
