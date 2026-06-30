// scripts/test-planner.js — Planner 单元测试
// 测试 classifyItem / filterContainerTypes / planContainerAssignment

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  runScripts: 'dangerously'
});
global.window = dom.window;

// 注入 container-db（Planner 依赖 CDB 的约束函数）
const cdbCode = fs.readFileSync(path.join(__dirname, '..', 'container-db.js'), 'utf-8');
const cdbEl = dom.window.document.createElement('script');
cdbEl.textContent = cdbCode;
dom.window.document.body.appendChild(cdbEl);

// 注入 planner
const plannerCode = fs.readFileSync(path.join(__dirname, '..', 'planner.js'), 'utf-8');
const plannerEl = dom.window.document.createElement('script');
plannerEl.textContent = plannerCode;
dom.window.document.body.appendChild(plannerEl);

const { classifyItem } = dom.window.Planner;
const CDB = dom.window.ContainerDB;

let pass = 0, fail = 0;
const assert = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } };

// ── Test 1-6: classifyItem ──

// Test 1: 超限货 — 变压器 2.80×1.60×2.40 超40HQ门高(2.34m)
const transformer = { model: 'Transformer', l: 2.80, w: 1.60, h: 2.40, weight: 8500, stackable: false, quantity: 1 };
assert(classifyItem(transformer) === 'oversize', 'Transformer should be oversize: height 2.40 > door height');

// Test 2: 重型不可叠 — 铝锭 1.10×1.10×0.70, 2850kg, 不可叠
const aluIngot = { model: 'Alu-Ingot', l: 1.10, w: 1.10, h: 0.70, weight: 2850, stackable: false, quantity: 1 };
assert(classifyItem(aluIngot) === 'heavy-nonstack', 'Alu-Ingot should be heavy-nonstack: weight 2850 >= 1000');

// Test 3: 重型可叠 — 瓷砖 1.20×1.00×0.95, 720kg, 可叠 → 不是重型不可叠
const tile = { model: 'Tile', l: 1.20, w: 1.00, h: 0.95, weight: 720, stackable: true, quantity: 1 };
assert(classifyItem(tile) === 'stackable', 'Tile should be stackable: weight 720 < 1000 and stackable=true');

// Test 4: 轻型不可叠 — 小电机 0.80×0.60×0.50, 300kg, 不可叠
const smallMotor = { model: 'Small-Motor', l: 0.80, w: 0.60, h: 0.50, weight: 300, stackable: false, quantity: 1 };
assert(classifyItem(smallMotor) === 'light-nonstack', 'Small-Motor should be light-nonstack: weight 300 < 1000, maxDim 0.80 < 2.0');

// Test 5: 纸箱 — 绝对可叠
const carton = { model: 'Carton', l: 0.55, w: 0.40, h: 0.35, weight: 15, stackable: true, quantity: 1 };
assert(classifyItem(carton) === 'stackable', 'Carton should be stackable');

// Test 6: 长件重型不可叠 — 钢构梁 3.80×0.50×0.45, 3200kg
const steelBeam = { model: 'Steel-Beam', l: 3.80, w: 0.50, h: 0.45, weight: 3200, stackable: false, quantity: 1 };
assert(classifyItem(steelBeam) === 'heavy-nonstack', 'Steel-Beam should be heavy-nonstack: maxDim 3.80 >= 2.0');

console.log(`  classifyItem: ${pass}/${pass+fail} passed`);

// ── Test 7-10: filterContainerTypes ──

const { filterContainerTypes } = dom.window.Planner;

// Test 7: 纸箱 — 所有标准箱型都可用
const cartonTypes = filterContainerTypes(carton);
assert(cartonTypes.length >= 6, 'Carton: should have at least 6 usable container types');
assert(cartonTypes.some(t => t.code === '20GP'), 'Carton: 20GP should be available');
assert(cartonTypes.some(t => t.code === '40HQ'), 'Carton: 40HQ should be available');

// Test 8: 变压器 2.80×1.60×2.40 — FR 可用, 20GP 小门应被排除
const transTypes = filterContainerTypes(transformer);
assert(transTypes.length > 0, 'Transformer: should have at least 1 usable type');
assert(transTypes.some(t => t.type === 'flatRack'), 'Transformer: FR should be available');
// 20GP 门高仅 2.28m，2.40m 高的变压器无法通过
assert(!transTypes.some(t => t.code === '20GP'),
  'Transformer(2.40m tall) should NOT fit through 20GP door(2.28m)');

// Test 9: 钢构梁 3.80m — 检查门约束
const beamTypes = filterContainerTypes(steelBeam);
assert(beamTypes.some(t => t.code === '40HQ'),
  'Steel-Beam(3.80m) should fit 40HQ through door (cross-section 0.50×0.45)');

// Test 10: 铝锭 1.10×1.10×0.70, 2850kg — 载重约束
const aluTypes = filterContainerTypes(aluIngot);
assert(aluTypes.some(t => t.code === '20GP'), 'Alu-Ingot: 20GP should be available for single item');

console.log(`  filterContainerTypes: ${pass}/${pass+fail} total passed`);

// ── Test 11: planContainerAssignment — 超限货独占 FR ──

const { planContainerAssignment } = dom.window.Planner;

const transItem = { model: 'Transformer', l: 2.80, w: 1.60, h: 2.40, weight: 8500, stackable: false, quantity: 2 };
const result1 = planContainerAssignment([transItem], Object.values(CDB.CONTAINER_DB));
assert(result1.assignments.length === 2,
  `Transformer(qty=2): should get 2 containers, got ${result1.assignments.length}`);
assert(result1.assignments.every(a => a.containerCode === '20FR'),
  `Transformer(2.80×1.60): should use 20FR (smallest usable flatRack), got ${result1.assignments.map(a => a.containerCode)}`);
assert(result1.unassigned.length === 0, 'Transformer: no unassigned items');

console.log(`  planContainerAssignment (oversize): ${pass}/${pass+fail} total passed`);
if (fail > 0) process.exit(1);
