const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRuntime(files) {
  const context = { console, window: {} };
  context.window = context;
  vm.createContext(context);
  for (const file of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }
  return context;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runtime = loadRuntime(['container-db.js', 'field-parser.js', 'planner.js', 'packing-engine.js']);
const { ContainerDB: CDB, FieldParser: FP, Planner, PackingEngine: PE } = runtime;

test('test_kitten_planner_respects_available_containers', () => {
  const item = { model: 'Oversize', l: 2.8, w: 1.6, h: 2.4, quantity: 1, weight: 8500, stackable: false, orientationFixed: true };
  const available = [CDB.CONTAINER_DB['20GP']];
  const plan = Planner.planContainerAssignment([item], available);
  assert(plan.assignments.length === 0, `unexpected assignments: ${plan.assignments.map(a => a.containerCode)}`);
  assert(plan.unassigned.length === 1, `expected one unassigned item, got ${plan.unassigned.length}`);
});

test('test_kitten_mixed_result_never_loses_items', () => {
  const item = { model: 'Oversize', l: 2.8, w: 1.6, h: 2.4, quantity: 1, weight: 8500, stackable: false, orientationFixed: true };
  const result = PE.calculate([item], null, { mixedContainers: [CDB.CONTAINER_DB['20GP']], tolerance: 0.01 });
  assert(result.totalItems === 1, `expected totalItems=1, got ${result.totalItems}`);
  assert(result.totalPlaced === 0, `expected totalPlaced=0, got ${result.totalPlaced}`);
  assert(result.unplacedCount === 1, `expected unplacedCount=1, got ${result.unplacedCount}`);
});

test('test_kitten_orientation_survives_next_container', () => {
  const spec = {
    code: 'TEST', nameCN: 'TEST', L: 2, W: 1, H: 1,
    doorW: 2, doorH: 2, payload: 10000, volume: 2,
    type: 'standard', allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  };
  const items = [
    { model: 'Floor', l: 1.99, w: 0.99, h: 0.99, quantity: 1, weight: 1, stackable: false, orientationFixed: true },
    { model: 'Upright', l: 0.8, w: 0.8, h: 1.2, quantity: 1, weight: 1, stackable: true, orientationFixed: true }
  ];
  const result = PE.multiContainerPack(items, spec, { tolerance: 0.001 });
  assert(result.containerCount === 1, `expected only the first non-empty container, got ${result.containerCount}`);
  assert(result.totalPlaced === 1 && result.unplacedCount === 1, `unexpected accounting ${result.totalPlaced}/${result.unplacedCount}`);
  assert(result.totalItems === 2, `expected totalItems=2, got ${result.totalItems}`);
});

test('test_kitten_partial_ems_spaces_are_not_merged', () => {
  const merged = PE._internal.mergeSpaces([
    { x: 0, y: 0, z: 0, L: 1, W: 1, H: 1, blockedAbove: false },
    { x: 1, y: 0.005, z: 0, L: 1, W: 1, H: 1, blockedAbove: false }
  ]);
  assert(merged.length === 2, `expected two spaces, got ${JSON.stringify(merged)}`);
});

test('test_kitten_40hq_cargo_stays_standard', () => {
  const item = { model: 'HQ-only', l: 2.4, w: 1.6, h: 2.4, quantity: 1, weight: 1000, stackable: false, orientationFixed: true };
  assert(CDB.classifyItemByContainerType(item, 0.01) === '40HQ', 'fixture is not classified as 40HQ');
  assert(Planner.classifyItem(item) === 'heavy-nonstack', `unexpected planner class ${Planner.classifyItem(item)}`);
  const plan = Planner.planContainerAssignment([item], [CDB.CONTAINER_DB['40HQ']]);
  assert(plan.assignments.length === 1 && plan.assignments[0].containerCode === '40HQ', `unexpected plan ${JSON.stringify(plan)}`);
});

test('test_kitten_flat_rack_prefers_low_center_of_gravity', () => {
  const item = { model: 'Turbine', l: 2.5, w: 1.5, h: 0.3, quantity: 1, weight: 8000, stackable: true, orientationFixed: false };
  const result = PE.calculate([item], CDB.CONTAINER_DB['40FR'], { tolerance: 0.05, autoRetry: false });
  const placed = result.containers[0].placedItems[0];
  assert(Math.abs(placed.h - 0.3) < 1e-6, `expected flat orientation h=0.3, got ${placed.l}x${placed.w}x${placed.h}`);
});

test('test_kitten_max_payload_matches_used_containers', () => {
  const item = { model: 'Carton', l: 0.5, w: 0.4, h: 0.3, quantity: 10, weight: 10, stackable: true, orientationFixed: false };
  const result = PE.calculate([item], null, {
    mixedContainers: [CDB.CONTAINER_DB['20GP'], CDB.CONTAINER_DB['40HQ']],
    tolerance: 0.01
  });
  const expected = result.containers.reduce((sum, container) => sum + CDB.CONTAINER_DB[container.containerCode].payload, 0);
  assert(result.maxPayload === expected, `expected maxPayload=${expected}, got ${result.maxPayload}`);
});

test('test_kitten_oversize_rejected_from_40hq_with_error', () => {
  const item = { model: 'Oversize-W', l: 3, w: 2.5, h: 1, quantity: 1, weight: 1000, stackable: false, orientationFixed: true };
  const result = PE.calculate([item], CDB.CONTAINER_DB['40HQ'], { tolerance: 0.05, autoRetry: false });
  assert(result.totalPlaced === 0 && result.unplacedCount === 1, 'oversize must not be placed in 40HQ');
  assert(result.hasErrors === true, 'unplaced oversize must surface hasErrors');
});

test('test_kitten_ot_overheight_cargo_still_loads', () => {
  const item = { model: 'Tall-OT', l: 1.2, w: 1, h: 2.6, quantity: 1, weight: 500, stackable: false, orientationFixed: true };
  const result = PE.calculate([item], CDB.CONTAINER_DB['20OT'], { tolerance: 0.05, autoRetry: false });
  assert(result.totalPlaced === 1 && result.unplacedCount === 0, 'OT over-height cargo must load');
});

test('test_kitten_oversize_not_recommended_as_40hq', () => {
  for (const dims of [{ l: 3, w: 2.5, h: 1 }, { l: 12.5, w: 1, h: 1 }]) {
    const item = { model: 'Oversize', ...dims, quantity: 1, weight: 1000, stackable: false, orientationFixed: true };
    const rec = CDB.autoRecommend([item], 0.05);
    const primary = rec && rec.primary && rec.primary.code;
    assert(primary !== '40HQ', 'oversize must not recommend 40HQ');
  }
});

test('test_kitten_invalid_quantity_is_rejected', () => {
  let threw = false;
  try {
    PE.calculate([{ model: 'Bad', l: 1, w: 1, h: 1, quantity: 0, weight: 1 }], '20GP');
  } catch (error) {
    threw = /数量/.test(error.message);
  }
  assert(threw, 'invalid quantity was not rejected');
});

test('test_kitten_layer_pack_rotates_without_threshold_regression', () => {
  const spec = {
    code: 'LAYER', nameCN: 'LAYER', L: 2.15, W: 2.95, H: 1.05,
    doorW: 10, doorH: 10, payload: 100000, volume: 6.66,
    type: 'standard', allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  };
  const item = { model: 'Rect', l: 1.4, w: 1, h: 1, weight: 1, stackable: false, orientationFixed: false, quantity: 1 };
  const pack = quantity => PE.packSingleContainer(
    Array.from({ length: quantity }, () => ({ ...item })),
    spec,
    { tolerance: 0.01, sortStrategy: 'smart' }
  );
  const belowThreshold = pack(9);
  const atThreshold = pack(10);
  assert(atThreshold.placedItems.length >= belowThreshold.placedItems.length,
    `layer threshold regressed from ${belowThreshold.placedItems.length} to ${atThreshold.placedItems.length}`);
  assert(atThreshold.placedItems.length >= 3, `expected rotated layer packing to place at least 3, got ${atThreshold.placedItems.length}`);
});

test('test_kitten_layer_pack_respects_bearing_constraint', () => {
  const spec = {
    code: 'BEARING', nameCN: 'BEARING', L: 2.1, W: 2.1, H: 1.3,
    doorW: 10, doorH: 10, payload: 100000, volume: 5.73,
    type: 'standard', allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  };
  const items = [
    { model: 'Base', l: 2, w: 2, h: 0.2, weight: 1, stackable: true, orientationFixed: true, quantity: 1 },
    { model: 'HeavyCube', l: 0.5, w: 0.5, h: 0.5, weight: 100, stackable: true, orientationFixed: true, quantity: 10 }
  ];
  const result = PE.packSingleContainer(PE.expandItems(items), spec, { tolerance: 0.01, sortStrategy: 'smart' });
  const heavyOnBase = result.placedItems.filter(item => item.model === 'HeavyCube' && item.z > 0.001);
  assert(heavyOnBase.length === 0, `expected bearing check to reject heavy layer, placed ${heavyOnBase.length}`);

  const invalid = {
    ...result,
    isInterim: true,
    placedItems: [
      { model: 'Base', l: 2, w: 2, h: 0.2, x: 0, y: 0, z: 0, weight: 1, stackable: true },
      { model: 'HeavyCube', l: 0.5, w: 0.5, h: 0.5, x: 0, y: 0, z: 0.2, weight: 100, stackable: true }
    ],
    totalWeight: 101,
    utilization: 0.1,
    unplacedItems: []
  };
  const check = PE.selfCheck(invalid, spec, 0.01);
  assert(check.errors.some(error => error.type === 'bearingViolation'), 'selfCheck did not report bearingViolation');
});

test('test_kitten_seeded_multi_start_reaches_four_box_lower_bound', () => {
  const cargo = [
    { model: 'Beam', l: 3.8, w: 0.5, h: 0.45, weight: 3200, quantity: 6, stackable: false },
    { model: 'HVAC', l: 1.85, w: 0.95, h: 2.15, weight: 850, quantity: 4, stackable: false, orientationFixed: true },
    { model: 'Tile', l: 1.2, w: 1, h: 0.95, weight: 720, quantity: 24, stackable: true },
    { model: 'Ingot', l: 1.1, w: 1.1, h: 0.7, weight: 2850, quantity: 10, stackable: true },
    { model: 'Frozen', l: 1.2, w: 0.8, h: 1.2, weight: 550, quantity: 15, stackable: true },
    { model: 'Transformer', l: 2.8, w: 1.6, h: 2.4, weight: 8500, quantity: 2, stackable: false, orientationFixed: true },
    { model: 'Furniture', l: 2.2, w: 0.6, h: 0.15, weight: 85, quantity: 40, stackable: true },
    { model: 'Carton', l: 0.55, w: 0.4, h: 0.35, weight: 15, quantity: 300, stackable: true }
  ];
  const options = { tolerance: 0.05, optimizationSeed: 20260805, randomStarts: 8 };
  const first = PE.multiContainerPack(cargo, CDB.CONTAINER_DB['45HQ'], options);
  const second = PE.multiContainerPack(cargo, CDB.CONTAINER_DB['45HQ'], options);
  assert(first.totalPlaced === 401 && first.unplacedCount === 0, `expected all 401 placed, got ${first.totalPlaced}`);
  assert(first.containerCount === 4, `expected lower bound of 4 boxes, got ${first.containerCount}`);
  assert(first.optimization.lowerBound === 4, `expected lowerBound=4, got ${first.optimization.lowerBound}`);
  // 只断言可复现的核心字段；timeUsedMs 是真实耗时，天然不可重复。
  const stable = ({ strategy, seed, evaluated, lowerBound, randomStarts, timeBudgetMs }) => ({ strategy, seed, evaluated, lowerBound, randomStarts, timeBudgetMs });
  assert(JSON.stringify(stable(first.optimization)) === JSON.stringify(stable(second.optimization)), 'seeded optimization metadata is not repeatable');
  assert(first.containers.map(c => c.placedItems.length).join(',') === second.containers.map(c => c.placedItems.length).join(','),
    'seeded optimization result is not repeatable');
});

test('test_kitten_avg_utilization_is_volume_weighted', () => {
  // 2×20GP(40%) + 1×40HQ(80%)：
  // 算术平均 = 53.3%，容积加权 = (0.4×33.2×2 + 0.8×76.3) / (33.2×2 + 76.3) ≈ 61.4%
  const containers = [
    { placedItems: [{}], totalVolume: 13.28, utilization: 0.4 },
    { placedItems: [{}], totalVolume: 13.28, utilization: 0.4 },
    { placedItems: [{}], totalVolume: 61.04, utilization: 0.8 }
  ];
  const weighted = PE._internal.weightedAvgUtilization(containers);
  assert(Math.abs(weighted - 87.6 / 142.7) < 1e-6, `expected volume-weighted utilization ≈0.614, got ${weighted}`);
  assert(Math.abs(weighted - 0.5333) > 0.05, 'weighted average must differ from arithmetic average for mixed sizes');
  assert(PE._internal.weightedAvgUtilization([]) === 0, 'empty containers should yield 0');
  assert(PE._internal.weightedAvgUtilization([{ placedItems: [], totalVolume: 0, utilization: 0 }]) === 0, 'all-empty containers should yield 0');
});

test('test_kitten_optimizer_time_budget_limits_candidates', () => {
  const cargo = [
    { model: 'Carton', l: 0.5, w: 0.4, h: 0.3, weight: 10, quantity: 300, stackable: true }
  ];
  // 时间预算为 0：只允许评估第一个候选（smart），随后即停止。
  const result = PE.multiContainerPack(cargo, CDB.CONTAINER_DB['20GP'], {
    tolerance: 0.05,
    optimizationTimeMs: 0
  });
  assert(result.totalPlaced === 300 && result.unplacedCount === 0, `time-budget result must remain valid: ${result.totalPlaced}/300`);
  assert(result.optimization.evaluated >= 1, `expected at least the first candidate evaluated, got ${result.optimization.evaluated}`);
  assert(result.optimization.timeUsedMs >= 0, 'timeUsedMs must be non-negative');
});

test('test_kitten_planner_stackable_groups_respect_floor_footprint', () => {
  // 20 种不同型号薄板各 30 件：同型号共享底面积，去重足迹必须不超箱地板。
  const mixed = [];
  for (let m = 0; m < 20; m++) {
    for (let k = 0; k < 30; k++) {
      mixed.push({ model: `Board${m}`, l: 2.0, w: 0.9 + (m % 3) * 0.1, h: 0.05, weight: 20, stackable: true, quantity: 1 });
    }
  }
  const plan = Planner.planContainerAssignment(mixed, Object.values(CDB.CONTAINER_DB));
  assert(plan.unassigned.length === 0, `all stackable boards should be assigned, got ${plan.unassigned.length} unassigned`);
  for (const assignment of plan.assignments) {
    const spec = CDB.CONTAINER_DB[assignment.containerCode];
    const footprint = new Map();
    for (const item of assignment.items) {
      if (!footprint.has(item.model)) footprint.set(item.model, item.l * item.w);
    }
    const totalFootprint = [...footprint.values()].reduce((s, v) => s + v, 0);
    assert(totalFootprint <= spec.L * spec.W + 1e-6,
      `assignment floor footprint ${totalFootprint.toFixed(2)} exceeds ${spec.code} floor ${(spec.L * spec.W).toFixed(2)}`);
  }
  const cartons = Array.from({ length: 100 }, () => ({ model: 'Carton', l: 0.55, w: 0.4, h: 0.35, weight: 15, stackable: true, quantity: 1 }));
  const cartonPlan = Planner.planContainerAssignment(cartons, Object.values(CDB.CONTAINER_DB));
  assert(cartonPlan.assignments.length === 1 && cartonPlan.assignments[0].items.length === 100,
    `100 identical cartons should stay in 1 assignment, got ${cartonPlan.assignments.length}`);
});

test('test_kitten_planner_stackable_groups_respect_height', () => {
  // 高薄板：体积/足迹不超但层高远超箱高 → 必须拆组（默认全部可叠放语义）。
  const boards = [];
  for (let k = 0; k < 200; k++) {
    boards.push({ model: 'Board', l: 2.2, w: 1.0, h: 0.3, weight: 50, stackable: true, quantity: 1 });
  }
  const plan = Planner.planContainerAssignment(boards, Object.values(CDB.CONTAINER_DB));
  assert(plan.unassigned.length === 0, `all boards should be assigned, got ${plan.unassigned.length} unassigned`);
  assert(plan.assignments.length >= 2, `tall boards must split across boxes (height), got ${plan.assignments.length}`);
  for (const assignment of plan.assignments) {
    const spec = CDB.CONTAINER_DB[assignment.containerCode];
    const perModel = new Map();
    for (const item of assignment.items) {
      perModel.set(item.model, (perModel.get(item.model) || 0) + 1);
    }
    let totalHeight = 0;
    for (const [model, count] of perModel) {
      const first = assignment.items.find(i => i.model === model);
      const perLayer = Math.max(1, Math.floor((spec.L * spec.W) / (first.l * first.w)));
      totalHeight += Math.ceil(count / perLayer) * first.h;
    }
    assert(totalHeight <= spec.H + 1e-6, `assignment height ${totalHeight.toFixed(2)} exceeds ${spec.code} height ${spec.H}`);
  }
  // 低薄板 200 件（0.05m 高）：高度不构成约束，应保持 1 箱。
  const thin = [];
  for (let k = 0; k < 200; k++) {
    thin.push({ model: 'Thin', l: 2.2, w: 1.0, h: 0.05, weight: 50, stackable: true, quantity: 1 });
  }
  const thinPlan = Planner.planContainerAssignment(thin, Object.values(CDB.CONTAINER_DB));
  assert(thinPlan.assignments.length === 1 && thinPlan.assignments[0].items.length === 200,
    `thin boards should stay in 1 assignment, got ${thinPlan.assignments.length}`);
});

test('test_kitten_mixed_path_never_loses_partial_unplaced', () => {
  // 构造"Planner 分组乐观 → 组内 3D 装不完 → 部分未装"的场景：
  // 可叠货聚合组（Tile+Carton）体积卡在 0.85 系数边界，3D 实际装不下全部。
  // 修复前：未装件按 model 名去重列表计数，只找回 1 件，其余静默消失 → 账目抛错或丢件。
  const items = [
    { model: 'Beam', l: 3.8, w: 0.5, h: 0.45, weight: 3200, quantity: 6, stackable: false },
    { model: 'Tile', l: 1.2, w: 1.0, h: 0.95, weight: 720, quantity: 24, stackable: true },
    { model: 'Carton', l: 0.55, w: 0.4, h: 0.35, weight: 15, quantity: 300, stackable: true },
    { model: 'Transformer', l: 2.8, w: 1.6, h: 2.4, weight: 8500, quantity: 2, stackable: false, orientationFixed: true }
  ];
  const result = PE.calculate(items, null, {
    tolerance: 0.05,
    mixedContainers: Object.values(CDB.CONTAINER_DB),
    optimizationSeed: 20260805
  });
  const totalInput = items.reduce((s, i) => s + i.quantity, 0);
  assert(result.totalPlaced + result.unplacedCount === totalInput,
    `accounting broken: ${result.totalPlaced} placed + ${result.unplacedCount} unplaced != ${totalInput}`);
  assert(result.hasErrors === false, `unexpected errors: ${JSON.stringify(result.checks?.map(c => c.errors))}`);
});

test('test_kitten_mixed_fallback_reports_unplaced_error', () => {
  // 全部货物超限 → Planner 无分配 → fallback 路径。
  // 修复前：hasErrors=false 且 checks=[]，用户看不到"装不下"提示。
  // 2026-10-13 更新：FR 解除尺寸限制后，单/双维超限货可由 FR 装载（贴端+地板覆盖率≥50% 判据）；
  // 改用「三边均超地板宽两倍」的巨型立方体（任何朝向地板覆盖率都不足 50%）确保真不可装。
  const items = [{ l: 5, w: 5, h: 5, weight: 3000, quantity: 1 }];
  const result = PE.calculate(items, null, { tolerance: 0.05, mixedContainers: Object.values(CDB.CONTAINER_DB) });
  assert(result.unplacedCount === 1, `expected 1 unplaced, got ${result.unplacedCount}`);
  assert(result.hasErrors === true, 'fallback path must surface unplaced as error');
  assert((result.checks || []).some(c => c.errors.some(e => e.type === 'unplaced')), 'checks must contain unplaced error');
});

test('test_kitten_infer_unit_mm_for_industrial_dimensions', () => {
  // 2500X2750X2800 这类工业装箱单尺寸应推断为 mm，而不是 cm。
  // 修复前：混合采样 avg≈1454 < 2000 且 max=3100 < 5000 → 误判 cm（25m 巨物）。
  assert(FP.inferUnit([2500, 2750, 2800]) === 'mm', 'large industrial dims must infer mm');
  assert(FP.inferUnit([2200, 1530, 860]) === 'mm', 'mixed industrial dims must infer mm');
  assert(FP.inferUnit([2350, 430, 2150]) === 'mm', 'industrial dims with min>=100 and max>=1000 must infer mm');
  // 常规 cm 尺寸不应误判为 mm
  assert(FP.inferUnit([80, 60, 50]) === 'cm', 'small cabinet dims should stay cm');
  assert(FP.inferUnit([1.2, 0.8, 0.6]) === 'm', 'meter dims stay m');
  // 900mm 边界：max < 1000 时保持 cm（当前阈值设计），避免误伤
  assert(FP.inferUnit([900, 700, 700]) === 'cm', 'sub-1000 dims stay cm by threshold design');
});

test('test_kitten_simulate_container_options_picks_40fr', () => {
  // AKSU 场景：单件都能进 20FR，但 40FR 实际装箱明显优于 20FR。
  // 预演的核心价值是相对比较（40FR 箱数 ≤ 20FR），而非保证找到 1 箱珍珠解。
  const items = [
    { model: '真空室', l: 2.5, w: 2.75, h: 2.8, weight: 7500, quantity: 1, stackable: false },
    { model: '高阀', l: 2.2, w: 1.53, h: 0.86, weight: 1000, quantity: 1, stackable: false },
    { model: '70泵', l: 0.9, w: 0.7, h: 0.7, weight: 360, quantity: 1, stackable: true },
    { model: '30泵', l: 1.5, w: 0.67, h: 0.7, weight: 450, quantity: 1, stackable: true },
    { model: '真空泵组', l: 3.1, w: 1.03, h: 1.95, weight: 2000, quantity: 1, stackable: false },
    { model: 'KT800', l: 1.8, w: 1.15, h: 1.9, weight: 2000, quantity: 2, stackable: false },
    { model: '控制柜', l: 2.7, w: 0.8, h: 2.2, weight: 1000, quantity: 1, stackable: false },
    { model: '炉体底架', l: 2.35, w: 0.43, h: 2.15, weight: 300, quantity: 1, stackable: false },
    { model: '分子泵', l: 0.56, w: 0.56, h: 0.65, weight: 200, quantity: 2, stackable: true },
    { model: '偏压电源', l: 0.94, w: 0.55, h: 1.0, weight: 80, quantity: 1, stackable: true }
  ];
  const sim = PE.simulateContainerOptions(items, [CDB.CONTAINER_DB['20FR'], CDB.CONTAINER_DB['40FR']], {
    tolerance: 0.05, optimizationSeed: 20260805, optimizationTimeMs: 15000
  });
  const fr40 = sim.find(s => s.code === '40FR');
  const fr20 = sim.find(s => s.code === '20FR');
  assert(fr40 && fr20, 'both 20FR and 40FR must be simulated');
  assert(fr40.totalPlaced === 12 && fr20.totalPlaced === 12, 'both must pack all 12 items');
  assert(fr40.containerCount <= fr20.containerCount,
    `40FR must not need more boxes than 20FR: ${fr40.containerCount} vs ${fr20.containerCount}`);
  assert(sim[0].code === '40FR', `expected 40FR first in sorted results, got ${sim[0].code}`);
});

test('test_kitten_single_box_capacity_finds_40fr_pearl', () => {
  // AKSU 场景：40FR 单箱物理可装 12 件（珍珠解），20FR 装不下。
  // 模拟退火必须稳定识别 40FR 容量，这是"程序能否一箱装下"的保证。
  const items = [
    { model: '真空室', l: 2.5, w: 2.75, h: 2.8, weight: 7500, quantity: 1, stackable: false },
    { model: '高阀', l: 2.2, w: 1.53, h: 0.86, weight: 1000, quantity: 1, stackable: false },
    { model: '70泵', l: 0.9, w: 0.7, h: 0.7, weight: 360, quantity: 1, stackable: true },
    { model: '30泵', l: 1.5, w: 0.67, h: 0.7, weight: 450, quantity: 1, stackable: true },
    { model: '真空泵组', l: 3.1, w: 1.03, h: 1.95, weight: 2000, quantity: 1, stackable: false },
    { model: 'KT800', l: 1.8, w: 1.15, h: 1.9, weight: 2000, quantity: 2, stackable: false },
    { model: '控制柜', l: 2.7, w: 0.8, h: 2.2, weight: 1000, quantity: 1, stackable: false },
    { model: '炉体底架', l: 2.35, w: 0.43, h: 2.15, weight: 300, quantity: 1, stackable: false },
    { model: '分子泵', l: 0.56, w: 0.56, h: 0.65, weight: 200, quantity: 2, stackable: true },
    { model: '偏压电源', l: 0.94, w: 0.55, h: 1.0, weight: 80, quantity: 1, stackable: true }
  ];
  const cap40 = PE.searchSingleBoxCapacity(items, CDB.CONTAINER_DB['40FR'], { tolerance: 0.05, optimizationSeed: 20260805 });
  assert(cap40.maxPlaced === 12, `40FR single box must hold all 12, got ${cap40.maxPlaced}`);
  const cap20 = PE.searchSingleBoxCapacity(items, CDB.CONTAINER_DB['20FR'], { tolerance: 0.05, optimizationSeed: 20260805 });
  assert(cap20.maxPlaced < 12, `20FR must NOT hold all 12 (fits at most ${cap20.maxPlaced})`);
  // 预演结果应包含 singleBoxCapacity 字段
  const sim = PE.simulateContainerOptions(items, [CDB.CONTAINER_DB['40FR']], { tolerance: 0.05, optimizationSeed: 20260805 });
  assert(sim[0].singleBoxCapacity === 12, `simulate must report 40FR singleBoxCapacity=12, got ${sim[0].singleBoxCapacity}`);
});

if (!process.exitCode) console.log(`\n${passed} regression tests passed`);
