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

const runtime = loadRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const { ContainerDB: CDB, Planner, PackingEngine: PE } = runtime;

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

if (!process.exitCode) console.log(`\n${passed} regression tests passed`);
