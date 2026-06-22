/**
 * 核心算法单元测试 — 直接引用源模块，不依赖浏览器 DOM
 */
const fs = require('fs');
const path = require('path');

const srcDir = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const OUT = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/dogfood-output';

// Mock browser globals
global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };
global.XLSX = {
  read: (data, opts) => {
    const text = opts.type === 'string' ? data : new TextDecoder().decode(data);
    const delimiter = text.includes('\t') ? '\t' : ',';
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const rows = lines.map(l => l.split(delimiter).map(c => c.trim()));
    return { SheetNames: ['Sheet1'], Sheets: { Sheet1: rows } };
  },
  utils: {
    sheet_to_json: (sheet) => sheet || []
  }
};

let issues = [];
let issueNum = 0;

function issue(severity, title, detail) {
  issueNum++;
  const iss = { num: issueNum, severity, title, detail };
  issues.push(iss);
  console.log(`  ⚠️  ISSUE-${String(issueNum).padStart(3, '0')} [${severity}] ${title}`);
  if (detail) console.log(`       ${detail}`);
}

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}

// ─── Load modules ───
console.log('\n========== 模块加载 ==========');
try {
  require(path.join(srcDir, 'container-db.js'));
  pass('container-db.js loaded');
} catch(e) { issue('critical', 'container-db fails to load', e.message); }

try {
  require(path.join(srcDir, 'field-parser.js'));
  pass('field-parser.js loaded');
} catch(e) { issue('critical', 'field-parser fails to load', e.message); }

try {
  require(path.join(srcDir, 'packing-engine.js'));
  pass('packing-engine.js loaded');
} catch(e) { issue('critical', 'packing-engine fails to load', e.message); }

const CDB = global.ContainerDB;
const FP = global.FieldParser;
const PE = global.PackingEngine;

// ─── 集装箱数据库测试 ───
console.log('\n========== 集装箱数据库 ==========');

// Test 1: All 6 types exist
const requiredTypes = ['20GP', '40HQ', '20OT', '40OT', '20FR', '40FR'];
for (const code of requiredTypes) {
  if (CDB.CONTAINER_DB[code]) pass(`${code} exists`);
  else issue('critical', `Missing container type: ${code}`, '');
}

// Test 2: OT door constraint (height unconstrained, width still checked)
console.log('\n--- OT Door Constraint ---');
const ot20 = CDB.CONTAINER_DB['20OT'];
if (ot20.doorH === Infinity && Math.abs(ot20.doorW - 2.290) < 0.001) {
  pass('20OT doorH=Infinity, doorW=2.290 — height unconstrained, width still checked (BWS standard)');
} else {
  issue('high', '20OT door constraint wrong', `doorW=${ot20.doorW}, doorH=${ot20.doorH}`);
}

const largeOTItem = { l: 5.0, w: 2.2, h: 3.0 }; // tall cargo, min dim fits door width
const otDoorCheck = CDB.checkDoorConstraint(largeOTItem, ot20, 0.05);
if (otDoorCheck.pass) {
  pass('OT tall cargo (h=3.0m) passes door constraint');
} else {
  issue('high', 'OT door constraint rejected tall cargo', otDoorCheck.reasons.join('; '));
}

const wideOTItem = { l: 2.5, w: 2.5, h: 2.5 }; // no face fits through door
const wideCheck = CDB.checkDoorConstraint(wideOTItem, ot20, 0.05);
if (!wideCheck.pass) {
  pass('OT rejects cargo whose smallest face exceeds door width');
} else {
  issue('high', 'OT should reject cargo that cannot pass door', '2.5m cargo passed OT door check');
}

// Test 3: FR skips door entirely
console.log('\n--- FR Door Constraint ---');
const fr20 = CDB.CONTAINER_DB['20FR'];
if (fr20.doorW === Infinity && fr20.doorH === Infinity) {
  pass('20FR doorW=Infinity, doorH=Infinity — fully unconstrained');
}
const frCheck = CDB.checkDoorConstraint({ l: 10, w: 10, h: 10 }, fr20, 0.05);
if (frCheck.pass) pass('FR passes any door constraint');

// Test 4: Standard door constraint still works
console.log('\n--- Standard Door Constraint ---');
const gp20 = CDB.CONTAINER_DB['20GP'];
const normalItem = { l: 2.0, w: 1.5, h: 2.0 };
const stdCheck = CDB.checkDoorConstraint(normalItem, gp20, 0.05);
if (stdCheck.pass) pass('20GP normal cargo passes door');
else issue('high', '20GP should pass normal cargo', stdCheck.reasons.join('; '));

const tooWide = { l: 3.0, w: 3.0, h: 2.0 };
const wideStdCheck = CDB.checkDoorConstraint(tooWide, gp20, 0.05);
if (!wideStdCheck.pass) pass('20GP rejects cargo too wide for door (3x3m)');
else issue('high', '20GP should reject 3x3m cargo', '');

// Test 5: getOrientations
console.log('\n--- Orientations ---');
const orientations = CDB.getOrientations({ l: 100, w: 80, h: 60 });
if (orientations.length <= 6) pass(`getOrientations returns ${orientations.length} orientations (≤6)`);
else issue('medium', 'Too many orientations', `Expected ≤6, got ${orientations.length}`);

// Check no duplicates
const uniqueSet = new Set(orientations.map(o => `${o.l},${o.w},${o.h}`));
if (uniqueSet.size === orientations.length) pass('No duplicate orientations');
else issue('low', 'Duplicate orientations found', '');

const fixedOrientations = CDB.getOrientations({ l: 100, w: 80, h: 60, orientationFixed: true });
if (fixedOrientations.length === 2) pass('orientationFixed=true returns 2 orientations (Z-axis rotation only)');
else issue('high', 'Fixed orientations wrong count', `Expected 2, got ${fixedOrientations.length}`);

// Test 6: Container recommendation
console.log('\n--- Container Recommendation ---');
const normalItems = [
  { model: 'A', l: 1.0, w: 0.8, h: 0.6, quantity: 10, weight: 500, stackable: true },
  { model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 20, weight: 100, stackable: true }
];
const rec = CDB.recommendContainer(normalItems, 0.05);
if (rec && rec.primary) {
  pass(`Normal items recommend: ${rec.primary.code} (${rec.reasoning})`);
} else {
  issue('high', 'Container recommendation failed for normal items', '');
}

// Over-width items should recommend FR (5x2.5x2 fits 20FR but not GP/OT)
const wideItems = [
  { model: 'WIDE', l: 5.0, w: 2.5, h: 2.0, quantity: 1, weight: 5000, stackable: true }
];
const wideRec = CDB.recommendContainer(wideItems, 0.05);
if (wideRec?.primary?.type === 'flatRack') {
  pass(`Over-width items recommend FR: ${wideRec.primary.code}`);
} else {
  issue('high', 'Over-width items should recommend FR', `Got: ${wideRec?.primary?.code || 'null'}`);
}

// ─── 字段解析测试 ───
console.log('\n========== 字段解析器 ==========');

// Test CSV parsing
const csvContent = `货号,长(cm),宽(cm),高(cm),数量,毛重(kg)
NIG-25-2630-124-01,120,80,60,100,1500
NIG-25-2630-124-02,90,70,50,150,1200
NIG-25-2630-124-03,200,100,80,50,2500`;

try {
  const csvBuffer = Buffer.from(csvContent);
  const result = FP.parseFile(csvBuffer.buffer, 'test.csv');
  if (result && !result.error) {
    pass(`CSV parsed: ${result.sheets.length} sheet(s), ${result.totalDataRows} data rows`);
    if (result.items && result.items.length > 0) {
      pass(`${result.items.length} items extracted`);
      if (result.items.length >= 3) pass('All 3 items extracted from CSV');
      else issue('medium', 'Wrong item count from CSV', `Expected 3, got ${result.items.length}`);
    }
  } else {
    issue('high', 'CSV parsing failed', result?.error || 'Unknown error');
  }
} catch(e) {
  issue('high', 'CSV parsing threw error', e.message);
}

// Test unit inference
console.log('\n--- Unit Inference ---');
const mmValues = [12000, 8000, 6000];
const inferredMM = FP.inferUnit(mmValues);
if (inferredMM === 'mm') pass(`Values [12000,8000,6000] → mm (correct)`);
else issue('high', 'Unit inference wrong for mm', `Expected mm, got ${inferredMM}`);

const cmValues = [120, 80, 60];
const inferredCM = FP.inferUnit(cmValues);
if (inferredCM === 'cm') pass(`Values [120,80,60] → cm (correct)`);
else issue('high', 'Unit inference wrong for cm', `Expected cm, got ${inferredCM}`);

const mValues = [1.2, 0.8, 0.6];
const inferredM = FP.inferUnit(mValues);
if (inferredM === 'm') pass(`Values [1.2,0.8,0.6] → m (correct)`);
else issue('high', 'Unit inference wrong for m', `Expected m, got ${inferredM}`);

// Edge case: 20×30×40 cm (should NOT be inferred as meters!)
const smallCmValues = [20, 30, 40];
const inferredSmallCm = FP.inferUnit(smallCmValues);
if (inferredSmallCm === 'cm') pass(`Values [20,30,40] → cm (correctly NOT mistaken as meters)`);
else issue('medium', 'Unit inference misclassifies small cm as meters', `Expected cm, got ${inferredSmallCm}`);

// ─── 打包算法测试 ───
console.log('\n========== 打包引擎 ==========');

// Test basic packing with standard container
const testItems = [
  { model: 'BOX-A', l: 1.0, w: 0.8, h: 0.6, quantity: 20, weight: 500, stackable: true, orientationFixed: false },
  { model: 'BOX-B', l: 0.5, w: 0.4, h: 0.3, quantity: 50, weight: 100, stackable: true, orientationFixed: false },
];

const result = PE.calculate(testItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: true });
if (result) {
  pass(`Packing result: ${result.containerCount} container(s), ${result.totalPlaced} items placed`);
  pass(`Average utilization: ${(result.avgUtilization * 100).toFixed(1)}%`);
  
  if (result.containerCount > 0) pass('At least 1 container used');
  if (result.totalPlaced === 70) pass('All 70 items placed');
  else issue('medium', 'Not all items placed', `Expected 70, placed ${result.totalPlaced}`);
  
  // Self-check
  if (result.checks) {
    const hasErrors = result.checks.some(c => c.errors.length > 0);
    if (!hasErrors) pass('Self-check passed — no errors');
    else {
      const errs = result.checks.flatMap(c => c.errors).map(e => e.message);
      issue('medium', 'Self-check found errors', errs.join('; '));
    }
  }
  
  // Verify no overlaps
  for (let ci = 0; ci < result.containers.length; ci++) {
    const items = result.containers[ci].placedItems;
    let overlaps = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.x < b.x + b.l && a.x + a.l > b.x &&
            a.y < b.y + b.w && a.y + a.w > b.y &&
            a.z < b.z + b.h && a.z + a.h > b.z) {
          overlaps++;
        }
      }
    }
    if (overlaps === 0) pass(`Container ${ci+1}: No overlaps in ${items.length} items`);
    else issue('critical', `Container ${ci+1} has ${overlaps} overlapping items!`, '');
  }
  
  // Verify all items within container bounds
  const spec = CDB.CONTAINER_DB['20GP'];
  for (let ci = 0; ci < result.containers.length; ci++) {
    const items = result.containers[ci].placedItems;
    let outOfBounds = items.filter(i => 
      i.x < -0.01 || i.y < -0.01 || i.z < -0.01 ||
      i.x + i.l > spec.L + 0.01 || i.y + i.w > spec.W + 0.01 || i.z + i.h > spec.H + 0.01
    );
    if (outOfBounds.length === 0) pass(`Container ${ci+1}: All items within bounds`);
    else issue('critical', `Container ${ci+1}: ${outOfBounds.length} items out of bounds`, '');
  }
} else {
  issue('critical', 'Packing engine returned null/undefined', '');
}

// Test non-stackable items
console.log('\n--- Non-stackable Packing ---');
const nonStackItems = [
  { model: 'HEAVY', l: 2.0, w: 1.5, h: 1.8, quantity: 3, weight: 5000, stackable: false, orientationFixed: false },
  { model: 'LIGHT', l: 0.5, w: 0.4, h: 0.3, quantity: 10, weight: 50, stackable: true, orientationFixed: false },
];
const nsResult = PE.calculate(nonStackItems, CDB.CONTAINER_DB['20GP'], { tolerance: 0.05, autoRetry: true });
if (nsResult) {
  // Check that LIGHT items are NOT placed on top of HEAVY items
  for (const container of nsResult.containers) {
    const nonStackables = container.placedItems.filter(i => !i.stackable);
    const stackables = container.placedItems.filter(i => i.stackable);
    let stackedViolation = false;
    for (const heavy of nonStackables) {
      for (const light of stackables) {
        if (light.z >= heavy.z + heavy.h - 0.01 &&
            light.x < heavy.x + heavy.l && light.x + light.l > heavy.x &&
            light.y < heavy.y + heavy.w && light.y + light.w > heavy.y) {
          stackedViolation = true;
          console.log(`  VIOLATION: ${light.model} placed above non-stackable ${heavy.model}`);
        }
      }
    }
    if (!stackedViolation) pass('Non-stackable items respected — nothing placed on top');
    else issue('critical', 'Non-stackable constraint violated — items placed on top of non-stackable!', '');
  }
}

// ─── SUMMARY ───
console.log('\n\n========================================');
console.log('          DOGFOOD REPORT SUMMARY          ');
console.log('========================================');
const crits = issues.filter(i => i.severity === 'critical').length;
const highs = issues.filter(i => i.severity === 'high').length;
const meds = issues.filter(i => i.severity === 'medium').length;
const lows = issues.filter(i => i.severity === 'low').length;

console.log(`Total: ${issues.length} | Critical: ${crits} | High: ${highs} | Medium: ${meds} | Low: ${lows}`);

if (issues.length === 0) {
  console.log('\n✨ All tests passed! Zero issues found.');
} else {
  console.log('\nIssue details:');
  for (const iss of issues) {
    console.log(`  ISSUE-${String(iss.num).padStart(3, '0')} [${iss.severity.toUpperCase()}] ${iss.title}`);
  }
}

// Write report
const report = `# Dogfood Report: 智能装箱模拟系统

| Field | Value |
|-------|-------|
| **Date** | ${new Date().toISOString().slice(0, 10)} |
| **App** | 智能装箱模拟系统 |
| **Test Mode** | Core Algorithm Tests (Node.js) |

## Summary

| Severity | Count |
|----------|-------|
| Critical | ${crits} |
| High | ${highs} |
| Medium | ${meds} |
| Low | ${lows} |
| **Total** | **${issues.length}** |

## Issues

${issues.map(i => `### ISSUE-${String(i.num).padStart(3, '0')}: ${i.title}

| Field | Value |
|-------|-------|
| **Severity** | ${i.severity} |
| **Category** | functional |

**Description**

${i.detail || i.title}
`).join('\n---\n')}

## Test Log

Full test execution log available in console output above.
`;

fs.writeFileSync(path.join(OUT, 'report.md'), report);
console.log('\nReport written to dogfood-output/report.md');