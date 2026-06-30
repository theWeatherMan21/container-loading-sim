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

console.log(`\nclassifyItem: ${pass}/${pass+fail} passed`);
if (fail > 0) process.exit(1);
