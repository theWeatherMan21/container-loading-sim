// scripts/test-regressions-r4.js — R4 轮 22 项修复的回归测试固化
// 覆盖：F-01/F-02/F-03/D-13/D-16/C-N2/C-N3/C-N1（totalHeight）/payload 物理边界/
//       D-08（门约束同一朝向）/X-01（同型号双尺寸找回守恒）/H1（orientationFixed 不倒置）/
//       C-NEW-1（空间误删 5 件全装）/D-01（承重判据 v2）/P-01（PDF 分页）
// 用法：node scripts/test-regressions-r4.js（或由 test-all.js 聚合运行）
// 约束：只读源文件，数据构造在测试内完成；app.js 的 UI 逻辑不在此覆盖。

const { createRuntime } = require('./_load-runtime');

const ctx = createRuntime([
  'container-db.js',
  'field-parser.js',
  'planner.js',
  'packing-engine.js',
  'pdf-exporter.js'
]);

const CDB = ctx.window.ContainerDB;
const FP = ctx.window.FieldParser;
const Planner = ctx.window.Planner;
const PE = ctx.window.PackingEngine;
const PdfExporter = ctx.window.PdfExporter;

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

// 尺寸签名（与引擎找回逻辑口径一致：优先 origL/origW/origH）
function sizeKey(item) {
  const l = (item.origL != null ? item.origL : item.l).toFixed(3);
  const w = (item.origW != null ? item.origW : item.w).toFixed(3);
  const h = (item.origH != null ? item.origH : item.h).toFixed(3);
  return `${l}x${w}x${h}`;
}

// ═══════════════════════════════════════════
// 1) F-01：表头声明 kg 的轻货（0.5/1.2/2.5）不得 ×1000 当吨
// ═══════════════════════════════════════════
test('F-01 表头 kg 轻货不被吨启发式放大', () => {
  const r = parseRows(
    ['型号', '长', '宽', '高', '数量', '毛重(kg)'],
    [['A1', 1, 1, 1, 10, '0.5'], ['A2', 1, 1, 1, 10, '1.2'], ['A3', 1, 1, 1, 10, '2.5']]
  );
  assert(r.colTypes[5].field === 'grossWeight', `毛重(kg) 列未识别为重量列: ${r.colTypes[5].field}`);
  assert(r.items.length === 3, `应提取 3 件，实际 ${r.items.length}`);
  const weights = r.items.map(i => i.weight);
  assert(weights[0] === 0.5, `第1件 weight=${weights[0]}，期望 0.5（×1000 回归）`);
  assert(weights[1] === 1.2, `第2件 weight=${weights[1]}，期望 1.2（×1000 回归）`);
  assert(weights[2] === 2.5, `第3件 weight=${weights[2]}，期望 2.5（×1000 回归）`);
});

// ═══════════════════════════════════════════
// 2) F-02：行内单位后缀 g/lb/oz 换算为 kg
// ═══════════════════════════════════════════
test('F-02 g/lb/oz 行内单位换算', () => {
  const r = parseRows(
    ['型号', '长', '宽', '高', '数量', '毛重'],
    [['A1', 1, 1, 1, 1, '500g'], ['A2', 1, 1, 1, 1, '5lb'], ['A3', 1, 1, 1, 1, '5oz']]
  );
  assert(r.items.length === 3, `应提取 3 件，实际 ${r.items.length}`);
  const weights = r.items.map(i => i.weight);
  assert(Math.abs(weights[0] - 0.5) < 1e-9, `500g → ${weights[0]}，期望 0.5`);
  assert(Math.abs(weights[1] - 2.268) < 1e-9, `5lb → ${weights[1]}，期望 2.268（5×0.4536）`);
  assert(Math.abs(weights[2] - 0.14175) < 1e-9, `5oz → ${weights[2]}，期望 0.14175（5×0.02835）`);
});

// ═══════════════════════════════════════════
// 3) F-03：无单位表头 + 整数尺寸列（1200/800/600）→ 判尺寸列而非 model/quantity
// ═══════════════════════════════════════════
test('F-03 无单位整数列识别为尺寸（mm→m）', () => {
  const r = parseRows(
    ['型号', '长', '宽', '高', '数量', '毛重'],
    [['A1', 1200, 800, 600, 2, 30], ['A2', 1000, 700, 500, 3, 25]]
  );
  const fields = r.colTypes.map(t => t.field);
  assert(fields[1] === 'length' || fields[1] === 'possibleDimension', `列1 应判尺寸，实际 ${fields[1]}`);
  assert(fields[2] === 'width' || fields[2] === 'possibleDimension', `列2 应判尺寸，实际 ${fields[2]}`);
  assert(fields[3] === 'height' || fields[3] === 'possibleDimension', `列3 应判尺寸，实际 ${fields[3]}`);
  assert(fields[0] === 'model', `列0 应是型号列，实际 ${fields[0]}`);
  assert(fields[4] === 'quantity', `列4 应是数量列，实际 ${fields[4]}`);
  assert(r.items.length === 2, `应提取 2 件，实际 ${r.items.length}`);
  assert(r.items[0].model === 'A1', `型号被误判为数字：${r.items[0].model}`);
  assert(Math.abs(r.items[0].l - 1.2) < 1e-9 && Math.abs(r.items[0].w - 0.8) < 1e-9 && Math.abs(r.items[0].h - 0.6) < 1e-9,
    `尺寸应为 1.2×0.8×0.6，实际 ${r.items[0].l}×${r.items[0].w}×${r.items[0].h}`);
  assert(r.items[0].quantity === 2, `数量应为 2，实际 ${r.items[0].quantity}`);
  assert(r.dimUnit === 'mm', `应推断 mm，实际 ${r.dimUnit}`);
});

// ═══════════════════════════════════════════
// 4) D-13：单件毛重(kg) 识别为重量列（长关键词优先，不被"件"抢占）
// ═══════════════════════════════════════════
test('D-13 单件毛重(kg) 识别为重量列', () => {
  // 4a. 纯分类：无尺寸列时列语义必须正确
  const types = FP.classifyColumns(['型号', '单件毛重(kg)', '数量'], [['A1', 5.5, 10]]);
  assert(types[1].field === 'grossWeight', `单件毛重(kg) 被判为 ${types[1].field}，期望 grossWeight`);
  assert(types[2].field === 'quantity', `数量列被判为 ${types[2].field}，期望 quantity`);
  // 4b. 全提取：重量/数量均正确
  const r = parseRows(
    ['型号', '长', '宽', '高', '数量', '单件毛重(kg)'],
    [['A1', 1, 1, 1, 10, 5.5], ['A2', 1, 1, 1, 20, 8]]
  );
  assert(r.colTypes[5].field === 'grossWeight', `带尺寸表头下单件毛重被判为 ${r.colTypes[5].field}`);
  const weights = r.items.map(i => i.weight);
  const qtys = r.items.map(i => i.quantity);
  assert(weights[0] === 5.5 && weights[1] === 8, `单件毛重提取错误: ${weights.join(',')}`);
  assert(qtys[0] === 10 && qtys[1] === 20, `数量列被单件毛重抢占: ${qtys.join(',')}`);
});

// ═══════════════════════════════════════════
// 5) D-16：多单位冲突 / 无单位组合列 → 全维度采样（不只看 lengthCol）
// ═══════════════════════════════════════════
test('D-16 组合列拆分 + 多单位冲突全维度采样', () => {
  // 5a. 无表头单位 + 组合尺寸列：拆分所有维度参与推断 → mm
  const r1 = parseRows(
    ['型号', '尺寸', '数量', '毛重(kg)'],
    [['A1', '1200x800x600', 1, 30]]
  );
  assert(r1.items.length === 1, `组合列应提取 1 件，实际 ${r1.items.length}`);
  assert(r1.dimUnit === 'mm', `组合列应推断 mm，实际 ${r1.dimUnit}`);
  assert(Math.abs(r1.items[0].l - 1.2) < 1e-9 && Math.abs(r1.items[0].w - 0.8) < 1e-9 && Math.abs(r1.items[0].h - 0.6) < 1e-9,
    `组合列拆分尺寸应为 1.2×0.8×0.6，实际 ${r1.items[0].l}×${r1.items[0].w}×${r1.items[0].h}`);
  assert(r1.warnings.some(w => w.includes('组合尺寸')), '缺少组合尺寸拆分警告');

  // 5b. 多单位冲突：L(mm) 但组合列首值 0.8（m 级）→ 全维度采样含 W/H 列 → cm
  //     若实现退化为"只看 lengthCol 首值" → 推断 m → l=0.8，断言失败即捕获回归
  const r2 = parseRows(
    ['型号', 'L(mm)', 'W(cm)', 'H(cm)', '数量', '毛重(kg)'],
    [['A1', '0.8x0.6x0.5', 60, 50, 1, 30]]
  );
  assert(r2.warnings.some(w => w.includes('多个不同的尺寸单位')), '缺少多单位冲突警告');
  assert(r2.items.length === 1, `冲突场景应提取 1 件，实际 ${r2.items.length}`);
  assert(r2.dimUnit === 'cm', `全维度采样应推断 cm，实际 ${r2.dimUnit}（只采样 lengthCol 会误判 m）`);
  assert(Number.isFinite(r2.items[0].l) && Number.isFinite(r2.items[0].w) && Number.isFinite(r2.items[0].h),
    '冲突场景尺寸解析出现 NaN');
});

// ═══════════════════════════════════════════
// 6) C-N2：科学计数法不被字符剥离破坏
// ═══════════════════════════════════════════
test('C-N2 normalizeNumber 科学计数法', () => {
  assert(FP.normalizeNumber('1.5E3') === 1500, `1.5E3 → ${FP.normalizeNumber('1.5E3')}，期望 1500`);
  assert(FP.normalizeNumber('1e3') === 1000, `1e3 → ${FP.normalizeNumber('1e3')}，期望 1000`);
  assert(FP.normalizeNumber('2.5E-1') === 0.25, `2.5E-1 → ${FP.normalizeNumber('2.5E-1')}，期望 0.25`);
});

// ═══════════════════════════════════════════
// 7) C-N3：负重量钳制为 0 且不崩溃
// ═══════════════════════════════════════════
test('C-N3 负重量钳制为 0', () => {
  const r = parseRows(
    ['型号', '长', '宽', '高', '数量', '毛重(kg)'],
    [['A1', 1, 1, 1, 1, '-5']]
  );
  assert(r.items.length === 1, `负重量行不应被丢弃，实际 ${r.items.length}`);
  assert(r.items[0].weight === 0, `负重量应为 0，实际 ${r.items[0].weight}`);
  assert(r.warnings.some(w => w.includes('非正值')), '缺少非正值重量警告');
});

// ═══════════════════════════════════════════
// 8) C-N1：planner 可叠高度预筛（63 件 0.9×0.5×2.0 → 每箱 ≤30 件）
// ═══════════════════════════════════════════
test('C-N1 planner totalHeight 高度约束生效（每箱≤30）', () => {
  const item = { model: 'TallBox', l: 0.9, w: 0.5, h: 2.0, quantity: 63, weight: 500, stackable: true, orientationFixed: false };
  const plan = Planner.planContainerAssignment([item], [CDB.CONTAINER_DB['20GP']]);
  assert(plan.assignments.length >= 3, `63 件 2m 高货应至少分 3 箱，实际 ${plan.assignments.length}`);
  const perBox = plan.assignments.map(a => a.items.length);
  assert(perBox.every(n => n <= 30), `存在单箱超过 30 件（高度预筛失效）: ${perBox.join(',')}`);
  const total = perBox.reduce((s, n) => s + n, 0);
  assert(total === 63, `分配件数应为 63，实际 ${total}`);
  assert(plan.unassigned.length === 0, `不应有未分配件，实际 ${plan.unassigned.length}`);
});

// ═══════════════════════════════════════════
// 9) payload：官方载重值（2026-10-15 爹地拍板：FR 取官方值）
// ═══════════════════════════════════════════
test('payload 20GP/20OT/20FR/40FR 载重口径', () => {
  const expected = { '20GP': 28200, '20OT': 28100, '20FR': 31260, '40FR': 44050 };
  for (const [code, value] of Object.entries(expected)) {
    assert(CDB.CONTAINER_DB[code] && CDB.CONTAINER_DB[code].payload === value,
      `${code}.payload = ${CDB.CONTAINER_DB[code] && CDB.CONTAINER_DB[code].payload}，期望 ${value}`);
  }
  // 普柜物理下限：20' 总重 ≤ 30480 - 自重 → payload 必须 < 30000（20GP/20OT 口径）
  for (const code of ['20GP', '20OT']) {
    assert(CDB.CONTAINER_DB[code].payload < 30000, `${code}.payload ${CDB.CONTAINER_DB[code].payload} 超 20' 物理上限`);
  }
  // FR 重载柜按官方规格（Hapag-Lloyd）取 31,260 / 44,050——不受 20' 普柜 ISO 668 口径约束
  assert(CDB.CONTAINER_DB['40FR'].payload > CDB.CONTAINER_DB['20FR'].payload, '40FR 载重应大于 20FR');
});

// ═══════════════════════════════════════════
// 10) D-08：门约束同一候选朝向（尺寸 fit 与门可通过必须同朝向）
// ═══════════════════════════════════════════
test('D-08 hasValidOrientationForContainer 门/尺寸同朝向', () => {
  const big = { l: 5.84, w: 2.29, h: 2.32, weight: 1000, stackable: false, orientationFixed: false };
  const small = { l: 2.0, w: 1.0, h: 1.0, weight: 500, stackable: false, orientationFixed: false };
  const gp20 = CDB.CONTAINER_DB['20GP'];
  // 5.84×2.29×2.32：水平旋转后 2.32 宽超有效宽（2.352-0.05），2.32 高无法过门（2.292）→ 必须 false
  assert(CDB.hasValidOrientationForContainer(big, gp20, 0.05) === false,
    '5.84×2.29×2.32 不得误判可装入 20GP（门/尺寸同朝向回归）');
  assert(CDB.hasValidOrientationForContainer(small, gp20, 0.05) === true,
    '2.0×1.0×1.0 应可装入 20GP');
  // 固定朝向（仅水平旋转）同样受同一朝向规则约束
  const bigFixed = { ...big, orientationFixed: true };
  assert(CDB.hasValidOrientationForContainer(bigFixed, gp20, 0.05) === false,
    '固定朝向 5.84×2.29×2.32 不得误判可装入 20GP');
});

// ═══════════════════════════════════════════
// 11) X-01：同型号双尺寸找回守恒（无幽灵大件）
// ═══════════════════════════════════════════
test('X-01 同型号双尺寸找回守恒（无幽灵大件）', () => {
  const BIG = '4.000x2.300x1.800';
  const items = [
    { model: 'X', l: 4.0, w: 2.3, h: 1.8, quantity: 3, weight: 3000, stackable: true, orientationFixed: true },
    { model: 'X', l: 1.0, w: 1.0, h: 1.0, quantity: 150, weight: 100, stackable: true, orientationFixed: false }
  ];
  const result = PE.calculate(items, null, {
    mixedContainers: [CDB.CONTAINER_DB['20GP'], CDB.CONTAINER_DB['40HQ'], CDB.CONTAINER_DB['40FR']],
    tolerance: 0.05
  });
  const bigPlaced = result.containers.reduce((s, c) => s + c.placedItems.filter(it => sizeKey(it) === BIG).length, 0);
  const bigUnplaced = (result.unplacedItems || []).filter(it => sizeKey(it) === BIG).length;
  assert(result.totalPlaced === 153, `应全装 153 件，实际 ${result.totalPlaced}`);
  assert(result.hasErrors === false, `不应有错误，实际 hasErrors=${result.hasErrors}`);
  // 守恒：找回清单中 4.0×2.3×1.8 的数量必须等于"输入 3 - 已装"，不得混入幽灵大件
  assert(bigPlaced + bigUnplaced === 3, `大件守恒被破坏：placed=${bigPlaced} unplaced=${bigUnplaced}（幽灵件回归）`);
  assert(bigPlaced === 3 && bigUnplaced === 0, `大件应 3/3 全装（找回清单混入大件？placed=${bigPlaced} unplaced=${bigUnplaced}）`);
  // 未装清单（如有）不得出现 4.0×2.3×1.8 之外的其他规格大件
  for (const it of result.unplacedItems || []) {
    assert(sizeKey(it) === '1.000x1.000x1.000', `未装清单出现异常规格: ${sizeKey(it)}`);
  }
});

// ═══════════════════════════════════════════
// 12) H1：orientationFixed 无倒置装载 + selfCheck 无 doorViolation
// ═══════════════════════════════════════════
test('H1 orientationFixed 不倒置 + 门约束自检', () => {
  const items = Array.from({ length: 10 }, () => ({
    model: 'FixedCrate', l: 3.0, w: 2.5, h: 1.8, weight: 2000, stackable: true, orientationFixed: true
  }));
  const fr = CDB.CONTAINER_DB['40FR'];
  const result = PE.packSingleContainer(items, fr, { tolerance: 0.05 });
  assert(result.placedItems.length >= 1, `40FR 应至少装入 1 件，实际 ${result.placedItems.length}`);
  const inverted = result.placedItems.filter(it => it.h !== 1.8);
  assert(inverted.length === 0, `发现倒置装载 ${inverted.length} 件（h=${inverted.map(i => i.h).join(',')}）`);
  const check = PE.selfCheck(result, fr, 0.05);
  assert(!check.errors.some(e => e.type === 'doorViolation'), 'selfCheck 上报 doorViolation');
  assert(!check.errors.some(e => e.type === 'overlap'), 'selfCheck 上报 overlap');
  assert(!check.errors.some(e => e.type === 'outOfBounds'), 'selfCheck 上报 outOfBounds');
});

// ═══════════════════════════════════════════
// 13) C-NEW-1：几何场景 5 件全装（空间误删回归）
// ═══════════════════════════════════════════
test('C-NEW-1 merge/purge 空间修复：5 件全装', () => {
  const items = PE.expandItems([
    { model: 'SteelBox', l: 1.5, w: 1.5, h: 0.8, quantity: 3, weight: 600, stackable: false, orientationFixed: true },
    { model: 'Device', l: 1.2, w: 0.852, h: 0.8, quantity: 2, weight: 400, stackable: false, orientationFixed: true }
  ]);
  const result = PE.packSingleContainer(items, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, sortStrategy: 'smart' });
  assert(result.placedItems.length === 5, `应 5 件全装，实际 ${result.placedItems.length}（空间误删回归：5→2）`);
  const models = result.placedItems.map(it => it.model).sort();
  assert(models.join(',') === 'Device,Device,SteelBox,SteelBox,SteelBox',
    `装载清单异常: ${models.join(',')}`);
  const check = PE.selfCheck(result, CDB.CONTAINER_DB['20GP'], 0.05);
  assert(!check.errors.some(e => e.type === 'overlap'), '5 件全装场景出现重叠');
  assert(!check.errors.some(e => e.type === 'outOfBounds'), '5 件全装场景出现超界');
});

// ═══════════════════════════════════════════
// 14) D-01：承重判据 v2（maxStackWeight 真实承重 + 支撑面积下限）
// ═══════════════════════════════════════════
test('D-01 承重判据 v2', () => {
  const bearing = PE._internal.checkWeightBearing;
  // 14a. 200kg 泡沫仅覆盖上方底面 50% → 拒绝（支撑面积 < 70%）
  const foamHalf = { x: 0, y: 0, z: 0, l: 2.0, w: 2.0, h: 0.5, weight: 200 };
  assert(bearing(0, 0, 0.5, 2.0, 4.0, 300, [foamHalf]) === false,
    '50% 覆盖泡沫不应承 300kg（支撑面积下限回归）');
  // 14b. 泡沫声明 maxStackWeight=0 → 真实承重判据拒绝
  const foamDecl = { ...foamHalf, maxStackWeight: 0 };
  assert(bearing(0, 0, 0.5, 2.0, 2.0, 300, [foamDecl]) === false,
    'maxStackWeight=0 泡沫不应承 300kg');
  // 14c. 100kg 纸箱叠 100kg 纸箱（全接触、无声明）→ 保守兜底放行
  const cartonA = { x: 0, y: 0, z: 0, l: 1.0, w: 1.0, h: 0.5, weight: 100 };
  assert(bearing(0, 0, 0.5, 1.0, 1.0, 100, [cartonA]) === true,
    '100kg 纸箱叠 100kg 应放行');
  // 14d. 600kg 钢箱声明 maxStackWeight=10000 → 承 1500kg 设备（修复前被误拒的合法组合）
  const steelBox = { x: 0, y: 0, z: 0, l: 1.5, w: 2.3, h: 0.8, weight: 600, maxStackWeight: 10000 };
  assert(bearing(0, 0, 0.8, 1.5, 1.5, 1500, [steelBox]) === true,
    'maxStackWeight=10000 钢箱应承 1500kg');
  // 14e. 无声明 600kg 钢箱承 1500kg → 保守兜底仍拒绝（600 < 750）
  const steelPlain = { x: 0, y: 0, z: 0, l: 1.5, w: 2.3, h: 0.8, weight: 600 };
  assert(bearing(0, 0, 0.8, 1.5, 1.5, 1500, [steelPlain]) === false,
    '无声明 600kg 钢箱承 1500kg 应被保守兜底拒绝');
});

// ═══════════════════════════════════════════
// 15) P-01：PDF 明细分页（300 件 → ≥7 页，每页 ≤45 行）
// ═══════════════════════════════════════════
test('P-01 PDF buildDetailPages 分页', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ model: `Item${i}`, l: 1, w: 1, h: 1 }));
  const pages = PdfExporter.buildDetailPages(rows);
  assert(pages.length === Math.ceil(300 / 45), `300 件应分 ${Math.ceil(300 / 45)} 页，实际 ${pages.length}`);
  assert(pages.length >= 7, `页数应 ≥7，实际 ${pages.length}`);
  assert(pages.every(p => p.rows.length <= 45), `存在单页超过 45 行`);
  assert(pages.reduce((s, p) => s + p.rows.length, 0) === 300, '分页总行数应为 300');
  assert(pages.every(p => p.pageCount === pages.length), 'pageCount 不一致');
  assert(pages[1].startIndex === 45, `第 2 页 startIndex 应为 45，实际 ${pages[1].startIndex}`);
  // 小单（≤60 行）保持单页，避免小单回归
  const small = PdfExporter.buildDetailPages(rows.slice(0, 60));
  assert(small.length === 1, '60 行应保持单页');
  const medium = PdfExporter.buildDetailPages(rows.slice(0, 61));
  assert(medium.length === 2, '61 行应拆 2 页');
});

// ═══════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════
console.log(`\n═══ test-regressions-r4 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
if (failed > 0) process.exitCode = 1;
