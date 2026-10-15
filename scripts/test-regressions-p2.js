// scripts/test-regressions-p2.js — P2 轮 10 项修复的回归测试固化
// 覆盖：
//   引擎 packing-engine.js：D-02（recalibrate 新旧对比保留优者）、D-03（FR 利用率不截断 >1、
//       加权平均用 Σ体积/Σ容积）、C-NEW-3（容器规格 NaN/payload NaN → 明确业务错误）
//   应用 app.js（静态契约，理由见 APP 章节注释）：合并单重数量加权平均（100×5kg+200×8kg → 7kg）、
//       映射表含净重/描述、simulateProgress 可取消
//   解析 field-parser.js：F-04（[6.5,2.4,2.6] → m；[200,150,100] → cm + 歧义警告）、
//       F-05（"1.5m×2m×3m" / "1200mm×800mm×600mm" 行内单位换算）、F-06（'长(毫米)' 表头 → mm）
//   数据 container-db.js：C-02（getEffectiveMaxDims(40FR) 单一来源 FR_REALITY_LIMITS）、
//       C-04（checkSizeConstraints orientationFixed 只查水平朝向）
// 用法：node scripts/test-regressions-p2.js（或由 test-all.js 聚合运行）
// 约束：只读源文件（packing-engine/field-parser/container-db/app 一律只读）；
//       app.js 因闭包不导出内部函数且项目记录 JSDOM 在 Node 20+/23 卡死（见 _load-runtime.js 注释），
//       采用"源码契约模式 + 公式独立复算"的静态断言策略，防回归能力等价于行为断言。

const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./_load-runtime');

const ROOT = path.join(__dirname, '..');

const ctx = createRuntime([
  'container-db.js',
  'field-parser.js',
  'packing-engine.js'
]);

const CDB = ctx.window.ContainerDB;
const FP = ctx.window.FieldParser;
const PE = ctx.window.PackingEngine;

// app.js 源码（静态契约断言用，只读）
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

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

// 工具：解析内存表格（表头 + 数据行）→ { items, colTypes, warnings, dimUnit }
function parseRows(header, rows) {
  const colTypes = FP.classifyColumns(header, rows);
  const mapping = colTypes.map((t, i) => ({ field: t.field, confidence: t.confidence }));
  const result = FP.reExtract(rows, header, mapping);
  result.colTypes = colTypes;
  return result;
}

// 工具：断言调用抛错且消息含关键字
// 注意：源文件在 vm 沙箱中运行，其抛出的 Error 属于沙箱 realm，
// 宿主 realm 的 instanceof Error 恒为 false —— 改用 message 字段判定。
function assertThrows(fn, keyword, message) {
  let threw = null;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  assert(threw != null && typeof threw.message === 'string',
    message + `（未抛出异常，返回了 ${threw}）`);
  assert(String(threw.message || '').includes(keyword),
    `${message}（实际错误消息: ${threw.message}）`);
}

// ═══════════════════════════════════════════
// 1) D-02a：shouldAdoptRecalc 纯函数——新旧结果对比保留优者
// ═══════════════════════════════════════════
test('D-02a shouldAdoptRecalc 采纳/保留判定', () => {
  const adopt = PE._internal.shouldAdoptRecalc;
  // 1a. 新结果利用率显著更优（件数变少也采纳）→ true
  assert(adopt({ avgUtilization: 0.4, totalPlaced: 8 }, { avgUtilization: 0.55, totalPlaced: 7 }) === true,
    '利用率 0.4→0.55 显著更优应采纳');
  // 1b. 利用率持平且件数不减 → true
  assert(adopt({ avgUtilization: 0.5, totalPlaced: 10 }, { avgUtilization: 0.5, totalPlaced: 10 }) === true,
    '持平且件数不减应采纳');
  // 1c. 利用率持平但件数减少 → false（不得以等利用率牺牲已装件数）
  assert(adopt({ avgUtilization: 0.5, totalPlaced: 10 }, { avgUtilization: 0.5 + 1e-7, totalPlaced: 9 }) === false,
    '持平但件数减少不应采纳');
  // 1d. 核心：新结果利用率更差 → false（修复前 recalibrate 无条件替换，即此场景被错误采纳）
  assert(adopt({ avgUtilization: 0.6, totalPlaced: 10 }, { avgUtilization: 0.5, totalPlaced: 12 }) === false,
    '利用率 0.6→0.5 更差必须保留原结果');
  // 1e. 非有限值保护：旧利用率 NaN 视为 0，新结果有效 → 采纳
  assert(adopt({ avgUtilization: NaN, totalPlaced: 10 }, { avgUtilization: 0.5, totalPlaced: 10 }) === true,
    '旧值 NaN 应按 0 处理并采纳有效新结果');
});

// ═══════════════════════════════════════════
// 2) D-02b：recalibrate 集成——返回结构完整且结果不劣化
// ═══════════════════════════════════════════
test('D-02b recalibrate 集成：保留优者不劣化', () => {
  const items = [
    { model: 'Box', l: 1.0, w: 1.0, h: 1.0, quantity: 3, weight: 300, stackable: true, orientationFixed: false }
  ];
  const original = PE.calculate(items, '20GP', { autoRetry: false, tolerance: 0.05 });
  const result = PE.recalibrate(items, CDB.CONTAINER_DB['20GP'], original, { tolerance: 0.05 });
  // 结果结构完整
  assert(Number.isFinite(result.avgUtilization), `重算结果 avgUtilization 缺失/非有限: ${result.avgUtilization}`);
  assert(Number.isFinite(result.totalPlaced), `重算结果 totalPlaced 缺失/非有限: ${result.totalPlaced}`);
  assert(Array.isArray(result.containers), '重算结果 containers 缺失');
  // 采纳/保留恰居其一（修复前：无条件采纳，无 recalcSkipped 概念）
  assert(result.recalculated === true || result.recalcSkipped === true, 'recalculated/recalcSkipped 必须恰有一个为 true');
  assert(result.recalculated !== result.recalcSkipped, 'recalculated 与 recalcSkipped 互斥');
  // 无论哪个分支，结果都不劣化：保留 → 与原值完全一致；采纳 → 利用率不降且件数不降
  if (result.recalcSkipped) {
    assert(result.avgUtilization === original.avgUtilization, 'recalcSkipped 必须完整保留原结果');
  } else {
    assert(result.totalPlaced >= original.totalPlaced, `采纳结果件数不降: ${result.totalPlaced} < ${original.totalPlaced}`);
    assert(result.avgUtilization + 1e-6 >= original.avgUtilization, '采纳结果利用率不降');
  }
});

// ═══════════════════════════════════════════
// 3) D-03a：FR 超限装载利用率不截断（>1）+ overCapacity 标记
// ═══════════════════════════════════════════
test('D-03a FR 超装 utilization >1 不截断', () => {
  const fr = CDB.CONTAINER_DB['40FR'];
  const items = PE.expandItems([
    { model: 'OversizeMachine', l: 11.0, w: 4.0, h: 2.0, quantity: 1, weight: 15000, stackable: false, orientationFixed: false }
  ]);
  const result = PE.packSingleContainer(items, fr, { tolerance: 0.05 });
  assert(result.placedItems.length === 1, `超宽件应装入 40FR，实际 ${result.placedItems.length} 件`);
  // 40FR 内容积 11.652×2.224×2.248 ≈ 58.255；货物 11.0×4.0×2.0 = 88 → 利用率 ≈ 1.51
  // 修复前 Math.min(1, …) 截断为 1，此断言即失败
  assert(result.utilization > 1.5 && result.utilization < 1.6,
    `utilization 应为 ~1.51（不截断），实际 ${result.utilization}`);
  assert(result.overCapacity === true, `超装应带 overCapacity 标记，实际 ${result.overCapacity}`);
  assert(result.overVolume === true, `超装应带 overVolume 标记，实际 ${result.overVolume}`);
});

// ═══════════════════════════════════════════
// 4) D-03b：加权平均利用率 = Σ已装体积 / Σ箱容（非算术平均）
// ═══════════════════════════════════════════
test('D-03b weightedAvgUtilization 按箱容加权', () => {
  const wAvg = PE._internal.weightedAvgUtilization;
  // 箱A：60/120（util=0.5）；箱B：120/100（util=1.2，FR 超装）
  // 加权 = (60+120)/(120+100) = 180/220 ≈ 0.81818；算术平均 = (0.5+1.2)/2 = 0.85
  const boxes = [
    { placedItems: [{}], totalVolume: 60, containerVolume: 120, utilization: 0.5 },
    { placedItems: [{}], totalVolume: 120, containerVolume: 100, utilization: 1.2 }
  ];
  const w = wAvg(boxes);
  assert(Math.abs(w - 180 / 220) < 1e-9, `加权平均应为 180/220≈0.81818，实际 ${w}`);
  assert(Math.abs(w - 0.85) > 0.03, `不得退化为算术平均 0.85，实际 ${w}`);
  // 空容器不参与（防止尾箱拖尾）
  const withEmpty = wAvg([...boxes, { placedItems: [], totalVolume: 0, containerVolume: 200, utilization: 0 }]);
  assert(Math.abs(withEmpty - 180 / 220) < 1e-9, `空容器不应参与加权，实际 ${withEmpty}`);
  // 回退分支：无 containerVolume 时用 totalVolume/utilization 反推箱容
  const fallback = wAvg([{ placedItems: [{}], totalVolume: 50, utilization: 0.25 }]);
  assert(Math.abs(fallback - 0.25) < 1e-9, `无 containerVolume 回退反推应为 0.25，实际 ${fallback}`);
});

// ═══════════════════════════════════════════
// 5) C-NEW-3：容器规格 NaN/非正 → 明确业务错误（不静默）
// ═══════════════════════════════════════════
test('C-NEW-3 容器规格 NaN/payload NaN 抛业务错误', () => {
  const items = [{ model: 'A', l: 1, w: 1, h: 1, quantity: 1, weight: 100 }];
  const good = { code: 'TEST', L: 5.9, W: 2.35, H: 2.39, payload: 28000, type: 'standard', doorW: 2.34, doorH: 2.29 };
  // 5a. L=NaN
  assertThrows(() => PE.calculate(items, { ...good, L: NaN }), '箱型规格无效',
    'L=NaN 必须抛明确业务错误');
  // 5b. payload=NaN（修复前 payload:NaN 使重量比较恒 false，超重货全装且 hasErrors=false）
  assertThrows(() => PE.calculate(items, { ...good, payload: NaN }), '箱型规格无效',
    'payload=NaN 必须抛明确业务错误');
  // 5c. L=0 / 负值
  assertThrows(() => PE.calculate(items, { ...good, L: 0 }), '箱型规格无效', 'L=0 必须抛业务错误');
  assertThrows(() => PE.calculate(items, { ...good, payload: -100 }), '箱型规格无效', 'payload 负数必须抛业务错误');
  // 5d. 合法规格对象与字符串 code 不受影响
  let ok = null;
  try { ok = PE.calculate(items, good, { autoRetry: false }); } catch (e) { ok = e; }
  assert(ok == null || typeof ok.message !== 'string', `合法规格不应抛错: ${ok && ok.message}`);
  assert(ok && Array.isArray(ok.containers), '合法规格应正常返回结果');
  let okStr = null;
  try { okStr = PE.calculate(items, '20GP', { autoRetry: false }); } catch (e) { okStr = e; }
  assert(okStr == null || typeof okStr.message !== 'string', `字符串 code 不应抛错: ${okStr && okStr.message}`);
  assert(okStr && Array.isArray(okStr.containers), '字符串 code 路径不受影响');
});

// ═══════════════════════════════════════════
// 6) APP-1（静态契约）：同型号多尺寸合并单重 = 数量加权平均
//    app.js 闭包不导出该逻辑；JSDOM 在 Node 20+/23 卡死（项目 _load-runtime.js 注释记录）。
//    策略：① 独立复算业务公式（100×5kg+200×8kg → 7kg）② 断言源码实现模式与反模式。
//    若未来把加权平均改回算术平均或去掉 1000 舍入，②即失败，等价捕获回归。
// ═══════════════════════════════════════════
test('APP-1 合并单重数量加权平均（静态契约）', () => {
  // 1. 业务公式独立复算：100 件×5kg + 200 件×8kg → (100×5 + 200×8) / (100+200) = 2100/300 = 7.000kg
  const groups = [{ qty: 100, weight: 5 }, { qty: 200, weight: 8 }];
  const weightedQty = groups.reduce((s, g) => s + g.qty, 0);
  const merged = Math.round(groups.reduce((s, g) => s + g.qty * g.weight, 0) / weightedQty * 1000) / 1000;
  assert(merged === 7, `公式复算应为 7kg，实际 ${merged}`);
  // 2. 源码必须按数量加权（qty×weight 累加、除以加权数量）
  assert(APP_SRC.includes('s + g.qty * g.weight'), '源码缺失 qty×weight 加权累加模式');
  assert(APP_SRC.includes('/ weightedTotalQty'), '源码缺失除以加权数量模式');
  // 3. 舍入到 3 位小数（与 UI 展示口径一致）
  assert(APP_SRC.includes('Math.round(mergedWeight * 1000) / 1000'), '源码缺失 3 位小数舍入');
  // 4. 反模式：不得退化为算术平均（Σweight/组数）
  assert(!APP_SRC.includes('s + g.weight, 0) / weightGroups.length'), '源码出现算术平均反模式');
});

// ═══════════════════════════════════════════
// 7) APP-2（静态契约）：列映射表含净重/描述
// ═══════════════════════════════════════════
test('APP-2 映射表含净重/描述（静态契约）', () => {
  // 正向映射（字段→中文标签）
  assert(APP_SRC.includes("netWeight: '净重'"), 'FIELD_TO_LABEL 缺失 netWeight 映射');
  assert(APP_SRC.includes("description: '描述'"), 'FIELD_TO_LABEL 缺失 description 映射');
  // 反向映射（中文标签→字段）
  assert(APP_SRC.includes("'净重': 'netWeight'"), 'LABEL_TO_FIELD 缺失 净重 映射');
  assert(APP_SRC.includes("'描述': 'description'"), 'LABEL_TO_FIELD 缺失 描述 映射');
  // 下拉选项必须可选（映射表含但下拉不可选 = 功能断裂）
  const dropdownLine = (APP_SRC.match(/DROPDOWN_OPTIONS = \[[^\]]*\]/) || [''])[0];
  assert(dropdownLine.includes('净重') && dropdownLine.includes('描述'),
    `DROPDOWN_OPTIONS 缺失 净重/描述: ${dropdownLine.slice(0, 80)}`);
});

// ═══════════════════════════════════════════
// 8) APP-3（静态契约）：计算进度可取消 + 作废链路闭环（2026-10-15 Worker 化后更新）
// ═══════════════════════════════════════════
test('APP-3 计算进度句柄可取消 + 作废链路闭环（静态契约）', () => {
  // 进度动画句柄必须真实清除 setInterval（phaseTimer），取消后不再轮播文案
  assert(APP_SRC.includes('function showCalcProgress()'), '缺失 showCalcProgress 进度动画');
  assert(APP_SRC.includes('cancel() {'), 'showCalcProgress 缺失 cancel() 句柄');
  assert(APP_SRC.includes('clearInterval(phaseTimer)'), 'cancel 必须 clearInterval(phaseTimer)');
  // 在途句柄须被全局持有，供 showStep/resetState 作废（app#6 竞态防护闭环）
  assert(APP_SRC.includes('activeCalcHandle'), '缺失 activeCalcHandle 在途句柄');
  // 2026-10-15：主计算迁入 Worker 后，作废链路 = generation token + calcWorker.terminate()
  assert(APP_SRC.includes('cancelCalcWorker()'), '缺失 cancelCalcWorker 作废入口');
  assert(APP_SRC.includes('gen !== calcGeneration'), 'Worker 回调必须校验 generation token');
});

// ═══════════════════════════════════════════
// 9) APP-4（静态契约）：推荐刷新入口统一作废排队预演
//    app.js 闭包不导出 refreshContainerRecommendation；用源码结构断言覆盖事件循环竞态契约。
//    token 必须在 DOM 存在性短路之后、try 之前统一递增，预演回调只能复用该 token。
// ═══════════════════════════════════════════
test('APP-4 推荐刷新统一失效旧预演（静态契约）', () => {
  const refreshStart = APP_SRC.indexOf('function refreshContainerRecommendation()');
  const refreshEnd = APP_SRC.indexOf('\n  }', refreshStart);
  assert(refreshStart >= 0 && refreshEnd > refreshStart, 'refreshContainerRecommendation 函数边界缺失');
  const refreshFn = APP_SRC.slice(refreshStart, refreshEnd);
  const tokenPos = refreshFn.indexOf('const refreshToken = ++recSimToken;');
  const guardPos = refreshFn.indexOf('if (!recEl || !altEl) return;');
  const tryPos = refreshFn.indexOf('try {');
  assert(tokenPos > guardPos && tokenPos < tryPos,
    '推荐刷新必须在 DOM 短路后、业务计算前统一递增 recSimToken');
  assert(refreshFn.includes('cancelRecommendationWorker();'),
    '新刷新必须终止旧 Worker，不能只忽略旧结果');
  assert(refreshFn.includes('const simToken = refreshToken;'),
    '预演回调必须复用刷新入口 token');
  assert(!refreshFn.includes('const simToken = ++recSimToken;'),
    '预演分支不得再次独立生成 token，避免刷新失效语义分裂');
  assert(refreshFn.includes("const worker = getRecommendationWorker();"),
    '预演必须通过 Worker 工厂获取独立 Worker');
  assert(APP_SRC.includes("new Worker('recommendation-worker.js')"),
    'Worker 工厂必须创建 recommendation-worker.js');
  assert(refreshFn.includes('worker.postMessage({'),
    '预演参数必须发送给 Worker');

  const workerMessageGuard = 'if (message.requestId !== requestId || simToken !== recSimToken) return;';
  assert(refreshFn.includes(workerMessageGuard),
    'Worker 返回结果必须同时校验 requestId 与 recSimToken');
  assert(APP_SRC.includes('function cancelRecommendationWorker()') && APP_SRC.includes('recommendationWorker.terminate();'),
    '旧 Worker 必须通过 cancelRecommendationWorker() 的 terminate() 终止');
  const workerPathStart = refreshFn.indexOf('if (worker) {');
  const workerPathEnd = refreshFn.indexOf('} else {', workerPathStart);
  assert(workerPathStart >= 0 && workerPathEnd > workerPathStart, 'Worker 预演分支边界缺失');
  const workerPath = refreshFn.slice(workerPathStart, workerPathEnd);
  assert(!workerPath.includes('PE.simulateContainerOptions('),
    'Worker 主路径不得在 UI 主线程调用 simulateContainerOptions');
});

test('APP-5 推荐 Worker 协议返回可关联结果（静态契约）', () => {
  const workerSrc = fs.readFileSync(path.join(ROOT, 'recommendation-worker.js'), 'utf8');
  assert(workerSrc.includes("importScripts('packing-engine.js')"), 'Worker 必须加载装箱引擎');
  assert(workerSrc.includes('self.PackingEngine.simulateContainerOptions'), 'Worker 必须执行真实箱型预演');
  assert(workerSrc.includes('requestId: message.requestId'), 'Worker 结果必须携带 requestId');
  assert(workerSrc.includes("type: 'error'"), 'Worker 必须回传可见错误结果');
});

// ═══════════════════════════════════════════
// 10) F-04a：[6.5,2.4,2.6] 米级大件推断为 m
//    原缺陷：旧规则 avg<3 && max<10 漏判（avg=3.83 被误判 cm → 尺寸放大 100 倍）
// ═══════════════════════════════════════════
test('F-04a [6.5,2.4,2.6] 推断为 m', () => {
  assert(FP.inferUnit([6.5, 2.4, 2.6]) === 'm', `inferUnit([6.5,2.4,2.6]) 应为 m，实际 ${FP.inferUnit([6.5, 2.4, 2.6])}`);
  const r = parseRows(
    ['型号', '长', '宽', '高', '数量', '毛重(kg)'],
    [['A1', 6.5, 2.4, 2.6, 1, 500]]
  );
  assert(r.dimUnit === 'm', `全流程 dimUnit 应为 m，实际 ${r.dimUnit}`);
  assert(Math.abs(r.items[0].l - 6.5) < 1e-9 && Math.abs(r.items[0].w - 2.4) < 1e-9 && Math.abs(r.items[0].h - 2.6) < 1e-9,
    `尺寸应为 6.5×2.4×2.6，实际 ${r.items[0].l}×${r.items[0].w}×${r.items[0].h}`);
});

// ═══════════════════════════════════════════
// 10) F-04b：[200,150,100] 推断为 cm + 歧义警告
// ═══════════════════════════════════════════
test('F-04b [200,150,100] cm + 歧义警告', () => {
  assert(FP.inferUnit([200, 150, 100]) === 'cm', `inferUnit([200,150,100]) 应为 cm，实际 ${FP.inferUnit([200, 150, 100])}`);
  const r = parseRows(
    ['型号', '长', '宽', '高', '数量', '毛重(kg)'],
    [['A1', 200, 150, 100, 1, 30]]
  );
  assert(r.dimUnit === 'cm', `全流程 dimUnit 应为 cm，实际 ${r.dimUnit}`);
  assert(r.items[0].l === 2 && r.items[0].w === 1.5 && r.items[0].h === 1,
    `cm 换算应为 2×1.5×1，实际 ${r.items[0].l}×${r.items[0].w}×${r.items[0].h}`);
  assert(r.warnings.some(w => w.includes('尺寸单位存疑')), '缺失疑似毫米/厘米歧义警告');
});

// ═══════════════════════════════════════════
// 11) F-05a：组合尺寸行内 m 后缀 "1.5m×2m×3m" → 1.5/2/3 米
// ═══════════════════════════════════════════
test('F-05a 组合尺寸 "1.5m×2m×3m" 按后缀换算', () => {
  const r = parseRows(
    ['型号', '尺寸', '数量', '毛重(kg)'],
    [['A1', '1.5m×2m×3m', 1, 100]]
  );
  assert(r.items.length === 1, `应提取 1 件，实际 ${r.items.length}`);
  assert(Math.abs(r.items[0].l - 1.5) < 1e-9, `l 应为 1.5，实际 ${r.items[0].l}`);
  assert(Math.abs(r.items[0].w - 2) < 1e-9, `w 应为 2，实际 ${r.items[0].w}`);
  assert(Math.abs(r.items[0].h - 3) < 1e-9, `h 应为 3，实际 ${r.items[0].h}`);
  assert(r.warnings.some(w => w.includes('组合尺寸')), '缺失组合尺寸拆分警告');
});

// ═══════════════════════════════════════════
// 12) F-05b：组合尺寸行内 mm 后缀 "1200mm×800mm×600mm" → 1.2/0.8/0.6 米
// ═══════════════════════════════════════════
test('F-05b 组合尺寸 "1200mm×800mm×600mm" 按后缀换算', () => {
  const r = parseRows(
    ['型号', '尺寸', '数量', '毛重(kg)'],
    [['A1', '1200mm×800mm×600mm', 1, 100]]
  );
  assert(r.items.length === 1, `应提取 1 件，实际 ${r.items.length}`);
  assert(Math.abs(r.items[0].l - 1.2) < 1e-9, `l 应为 1.2，实际 ${r.items[0].l}`);
  assert(Math.abs(r.items[0].w - 0.8) < 1e-9, `w 应为 0.8，实际 ${r.items[0].w}`);
  assert(Math.abs(r.items[0].h - 0.6) < 1e-9, `h 应为 0.6，实际 ${r.items[0].h}`);
  assert(r.warnings.some(w => w.includes('组合尺寸')), '缺失组合尺寸拆分警告');
});

// ═══════════════════════════════════════════
// 13) F-06：'长(毫米)' 表头单位检测（含全角括号归一化）
//    原缺陷：'长（毫米）' 全角括号不命中 → 单位丢失 → 数值推断可能错档
// ═══════════════════════════════════════════
test('F-06 长(毫米) 表头 → mm（含全角括号）', () => {
  assert(FP.detectUnitFromHeader('长(毫米)') === 'mm', `长(毫米) 应检测为 mm，实际 ${FP.detectUnitFromHeader('长(毫米)')}`);
  assert(FP.detectUnitFromHeader('长（毫米）') === 'mm', `全角括号 长（毫米） 应归一化后检测为 mm，实际 ${FP.detectUnitFromHeader('长（毫米）')}`);
  assert(FP.detectUnitFromHeader('长(mm)') === 'mm', `长(mm) 应检测为 mm，实际 ${FP.detectUnitFromHeader('长(mm)')}`);
  assert(FP.detectUnitFromHeader('长(cm)') === 'cm', `长(cm) 应检测为 cm，实际 ${FP.detectUnitFromHeader('长(cm)')}`);
  // 全流程：表头 mm + 数值 1200/800/600 → 尺寸换算为 1.2/0.8/0.6 m
  const r = parseRows(
    ['型号', '长(毫米)', '宽(毫米)', '高(毫米)', '数量', '毛重(kg)'],
    [['A1', 1200, 800, 600, 1, 30]]
  );
  assert(r.dimUnit === 'mm', `全流程 dimUnit 应为 mm，实际 ${r.dimUnit}`);
  assert(Math.abs(r.items[0].l - 1.2) < 1e-9 && Math.abs(r.items[0].w - 0.8) < 1e-9 && Math.abs(r.items[0].h - 0.6) < 1e-9,
    `尺寸应为 1.2×0.8×0.6，实际 ${r.items[0].l}×${r.items[0].w}×${r.items[0].h}`);
});

// ═══════════════════════════════════════════
// 14) C-02：getEffectiveMaxDims(40FR) 单一来源 FR_REALITY_LIMITS
//    原缺陷：箱型声明字段与 FR_REALITY_LIMITS 双口径并存，改任一处不生效
// ═══════════════════════════════════════════
test('C-02 getEffectiveMaxDims(40FR) 口径（2026-10-13 更新：FR 不设尺寸限制）', () => {
  const fr = CDB.CONTAINER_DB['40FR'];
  const eff = CDB.getEffectiveMaxDims(fr, 0.05);
  // 2026-10-13 业务口径（爹地）：FR 系列不设尺寸限制——有效尺寸返回放开包络
  // （数值护栏 FR_FREE_DIM=1000，非业务限制；可装性由 frFloorFeasible 地板覆盖率判据承担）。
  assert(eff.maxL >= 100 && eff.maxW >= 100 && eff.maxH >= 100,
    `FR 有效尺寸应为放开包络，实际 ${eff.maxL}/${eff.maxW}/${eff.maxH}`);
  const eff2 = CDB.getEffectiveMaxDims(fr, 0.2);
  assert(eff2.maxL === eff.maxL && eff2.maxW === eff.maxW && eff2.maxH === eff.maxH,
    'FR 放开包络不受 tolerance 影响');
  // 单件可装性走地板覆盖率判据（frFloorFeasible）：贴角近似
  assert(CDB.frFloorFeasible({ l: 13, w: 1, h: 1 }, fr), '13m 长货在 40FR 上应可装（贴端，地板覆盖 89%）');
  assert(!CDB.frFloorFeasible({ l: 5, w: 5, h: 5 }, fr), '三边均超地板宽两倍的立方体应不可装（覆盖率 <50%）');
  // 非 FR 箱不受影响（标准柜仍按 L - tolerance）
  const gp20 = CDB.CONTAINER_DB['20GP'];
  const effGP = CDB.getEffectiveMaxDims(gp20, 0.05);
  assert(Math.abs(effGP.maxL - (gp20.L - 0.05)) < 1e-9, `20GP maxL 应为 ${gp20.L - 0.05}，实际 ${effGP.maxL}`);
});

// ═══════════════════════════════════════════
// 15) C-04：checkSizeConstraints orientationFixed 只查水平朝向
//    原缺陷：orientationFixed 也走 6 方向 → 靠倒置才能装的件被误判可装
// ═══════════════════════════════════════════
test('C-04 checkSizeConstraints orientationFixed 水平朝向', () => {
  const gp20 = CDB.CONTAINER_DB['20GP'];
  const eff = CDB.getEffectiveMaxDims(gp20, 0.05);
  // 高 = maxH + 0.3：水平朝向必超高；倒置（l/h 互换）可装入（maxL 远大于 maxH）
  const tall = { l: 1.0, w: 1.0, h: eff.maxH + 0.3, orientationFixed: false };
  const fixed = { ...tall, orientationFixed: true };
  // 15a. 自由旋转（6 方向）→ 倒置可行 → pass
  const free = CDB.checkSizeConstraints(tall, gp20, 0.05);
  assert(free.pass === true, `自由旋转应可装入（倒置方向可行），实际 pass=${free.pass}`);
  // 15b. 固定朝向 → 只查两个水平朝向 → 必须拒绝（修复前误判 pass）
  const ck = CDB.checkSizeConstraints(fixed, gp20, 0.05);
  assert(ck.pass === false, `orientationFixed 只查水平朝向，超高件必须拒绝，实际 pass=${ck.pass}`);
  // 15c. 拒绝原因须明确"仅 2 个水平旋转朝向"
  assert(ck.reasons.some(r => r.includes('2个水平旋转朝向')), `拒绝原因应注明仅查水平朝向: ${ck.reasons.join('|')}`);
  // 15d. 正常件固定朝向不受误杀
  const normal = { l: 1.0, w: 1.0, h: 1.0, orientationFixed: true };
  const ckN = CDB.checkSizeConstraints(normal, gp20, 0.05);
  assert(ckN.pass === true, `正常小件固定朝向应放行，实际 pass=${ckN.pass}`);
});

// ═══════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════
console.log(`\n═══ test-regressions-p2 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
if (failed > 0) process.exitCode = 1;
