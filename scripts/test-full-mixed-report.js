/**
 * 全箱型混合装箱综合验证测试
 * 生成完整的测试报告
 * 用法: node scripts/test-full-mixed-report.js
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// vm 沙箱加载（替代 JSDOM，兼容 Node 20+ / 23）
const context = { console, window: {}, setTimeout, clearTimeout };
context.window = context;
vm.createContext(context);

for (const script of ['container-db.js', 'field-parser.js', 'packing-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', script), 'utf8'), context, { filename: script });
}

const CDB = context.window.ContainerDB;
const PE = context.window.PackingEngine;

// ═══════════════════════════════════════════
// 测试数据集：7 种不同特征货物
// ═══════════════════════════════════════════

const TEST_CARGO = [
  {
    model: 'Steel-Plate-Bundle',
    nameCN: '钢板捆包',
    l: 2.50, w: 1.20, h: 0.15,
    quantity: 12, weight: 2800,
    stackable: true, orientationFixed: false,
    category: '金属材料', notes: '重型扁平件，可叠放，需均匀铺底'
  },
  {
    model: 'HVAC-Unit',
    nameCN: '空调外机',
    l: 1.85, w: 0.95, h: 2.15,
    quantity: 4, weight: 850,
    stackable: false, orientationFixed: true,
    category: '机电设备', notes: '不可倒置（orientationFixed），不可叠放，高度超出20GP门'
  },
  {
    model: 'Wooden-Pallet-Tiles',
    nameCN: '木托盘瓷砖',
    l: 1.20, w: 1.00, h: 0.90,
    quantity: 36, weight: 620,
    stackable: true, orientationFixed: false,
    category: '建材', notes: '标准托盘货，重且可叠放2层'
  },
  {
    model: 'Aluminum-Coil',
    nameCN: '铝卷',
    l: 1.45, w: 1.45, h: 0.80,
    quantity: 8, weight: 3200,
    stackable: false, orientationFixed: false,
    category: '金属材料', notes: '卧式放置圆柱体，不可叠放，单件重量大'
  },
  {
    model: 'Frozen-Seafood-Pallet',
    nameCN: '冷冻海鲜托盘',
    l: 1.20, w: 1.00, h: 1.15,
    quantity: 20, weight: 450,
    stackable: true, orientationFixed: false,
    category: '冷冻食品', notes: '需冷冻柜运输，温度敏感'
  },
  {
    model: 'Generator-Set',
    nameCN: '发电机组',
    l: 4.80, w: 1.85, h: 2.05,
    quantity: 2, weight: 6200,
    stackable: false, orientationFixed: true,
    category: '重型机械', notes: '超长超宽，需框架柜/平板柜运输'
  },
  {
    model: 'Carton-Consumer-Goods',
    nameCN: '纸箱日用品',
    l: 0.60, w: 0.40, h: 0.35,
    quantity: 500, weight: 12,
    stackable: true, orientationFixed: false,
    category: '日用品', notes: '轻泡货，量大但体积密度低'
  }
];

// ═══════════════════════════════════════════
// 输出报告
// ═══════════════════════════════════════════

function pad(s, n) { return (s || '').toString().padEnd(n); }
function rpad(s, n) { return (s || '').toString().padStart(n); }
function f2(n) { return Number(n).toFixed(2); }
function f0(n) { return Number(n).toFixed(0); }

const report = [];
const L = '\n';

function section(title) { report.push(`${L}${'═'.repeat(78)}`); report.push(`  ${title}`); report.push(`${'═'.repeat(78)}`); }
function sub(title) { report.push(`${L}  ${title}`); }
function line(s) { report.push(`    ${s}`); }

// Header
report.push(`${'═'.repeat(78)}`);
report.push(`  智能装箱模拟系统 — 全箱型混合装箱综合验证报告`);
report.push(`  生成时间: ${new Date().toLocaleString('zh-CN')}`);
report.push(`  测试方法: Node.js + JSDOM 自动化测试`);
report.push(`${'═'.repeat(78)}`);

// ═══ Section 1: Test Data ═══
section('一、测试货物数据');
sub('货物清单：');
line(`┌─$ {'─'.repeat(14)}┬─$ {'─'.repeat(8)}┬─$ {'─'.repeat(22)}┬─$ {'─'.repeat(6)}┬─$ {'─'.repeat(8)}┬─$ {'─'.repeat(6)}┬─$ {'─'.repeat(10)}┐`);
line(`│ ${pad('型号', 14)}│ ${pad('尺寸(m)', 8)}│ ${pad('单重(kg)', 22)}│ ${pad('数量', 6)}│ ${pad('总体积', 8)}│ ${pad('不可叠', 6)}│ ${pad('类别', 10)}│`);
line(`├─$ {'─'.repeat(14)}┼─$ {'─'.repeat(8)}┼─$ {'─'.repeat(22)}┼─$ {'─'.repeat(6)}┼─$ {'─'.repeat(8)}┼─$ {'─'.repeat(6)}┼─$ {'─'.repeat(10)}┤`);

let totalVol = 0, totalWt = 0, totalQty = 0;
for (const c of TEST_CARGO) {
  const dims = `${f2(c.l)}×${f2(c.w)}×${f2(c.h)}`;
  const vol = c.l * c.w * c.h * c.quantity;
  const wt = c.weight * c.quantity;
  totalVol += vol; totalWt += wt; totalQty += c.quantity;
  const model = c.model.length > 14 ? c.model.substring(0, 13) + '…' : c.model;
  line(`│ ${pad(model, 14)}│ ${pad(dims, 8)}│ ${pad(rpad(f0(c.weight), 10) + ' × ' + pad(c.quantity.toString(), 6), 22)}│ ${pad(c.quantity.toString(), 6)}│ ${pad(f2(vol) + ' m³', 8)}│ ${pad(c.stackable ? '可' : '不可', 6)}│ ${pad(c.category, 10)}│`);
}
line(`├─$ {'─'.repeat(14)}┴─$ {'─'.repeat(8)}┴─$ {'─'.repeat(22)}┴─$ {'─'.repeat(6)}┴─$ {'─'.repeat(8)}┴─$ {'─'.repeat(6)}┴─$ {'─'.repeat(10)}┤`);
line(`│ 合计: ${pad(totalQty + ' 件', 14)}│          │ ${pad(rpad(f0(totalWt), 10) + ' kg', 22)}│          │ ${pad(f2(totalVol) + ' m³', 8)}│          │            │`);
line(`└─$ {'─'.repeat(14)}┴─$ {'─'.repeat(8)}┴─$ {'─'.repeat(22)}┴─$ {'─'.repeat(6)}┴─$ {'─'.repeat(8)}┴─$ {'─'.repeat(6)}┴─$ {'─'.repeat(10)}┘`);

// ═══ Section 2: Container Specifications ═══
section('二、可用集装箱规格');
const allTypes = ['20GP','40HQ','45HQ','20OT','40OT','20FR','40FR'];
line(`┌─$ {'─'.repeat(6)}┬─$ {'─'.repeat(12)}┬─$ {'─'.repeat(20)}┬─$ {'─'.repeat(10)}┬─$ {'─'.repeat(12)}┬─$ {'─'.repeat(10)}┐`);
line(`│ ${pad('代码', 6)}│ ${pad('名称', 12)}│ ${pad('内尺寸(m)', 20)}│ ${pad('门(m)', 10)}│ ${pad('载重(kg)', 12)}│ ${pad('类型', 10)}│`);
line(`├─$ {'─'.repeat(6)}┼─$ {'─'.repeat(12)}┼─$ {'─'.repeat(20)}┼─$ {'─'.repeat(10)}┼─$ {'─'.repeat(12)}┼─$ {'─'.repeat(10)}┤`);
for (const code of allTypes) {
  const s = CDB.CONTAINER_DB[code];
  const dims = `${f2(s.L)}×${f2(s.W)}×${f2(s.H)}`;
  const door = `${f2(s.doorW)}×${s.doorH === Infinity ? '∞' : f2(s.doorH)}`;
  line(`│ ${pad(code, 6)}│ ${pad(s.nameCN, 12)}│ ${pad(dims, 20)}│ ${pad(door, 10)}│ ${pad(f0(s.payload), 12)}│ ${pad(s.type, 10)}│`);
}
line(`└─$ {'─'.repeat(6)}┴─$ {'─'.repeat(12)}┴─$ {'─'.repeat(20)}┴─$ {'─'.repeat(10)}┴─$ {'─'.repeat(12)}┴─$ {'─'.repeat(10)}┘`);

// ═══ Section 3: Auto-Recommendation ═══
section('三、自动箱型推荐');
const rec = CDB.autoRecommend(TEST_CARGO, 0.05);

if (rec && rec.type === 'single' && rec.primary) {
  line(`推荐类型: 单箱型`);
  line(`主推: ${rec.primary.code} ${rec.primary.nameCN} (${rec.primary.L}×${rec.primary.W}×${rec.primary.H}m, ${rec.primary.payload}kg)`);
  line(`理由: ${rec.reasoning}`);
  if (rec.alternatives && rec.alternatives.length > 0) {
    line(`备选: ${rec.alternatives.map(a => a.code + ' ' + a.nameCN).join(', ')}`);
  }
} else if (rec && rec.type === 'mixed' && rec.mixed) {
  line(`推荐类型: 混合装箱`);
  line(`方案: ${rec.mixed.description}`);
  line(`箱型序列: ${rec.mixed.specs.map(s => s.code).join(' → ')}`);
  line(`理由: ${rec.reasoning}`);
} else {
  line(`⚠️ 自动推荐失败: ${rec ? rec.reasoning : '未知原因'}`);
}

// Also check mixed recommendation
const mixedRec = CDB.recommendMixedContainers(TEST_CARGO, 0.05);
if (mixedRec) {
  line(``);
  line(`混合装箱备选方案: ${mixedRec.description}`);
  line(`箱数: ${mixedRec.specs.length}箱`);
  line(`箱型排列: ${mixedRec.specs.map(s => s.code).join(' → ')}`);
}

// ═══ Section 4: Per-Container Type Tests ═══
section('四、逐箱型装载测试');

const containerTests = [
  { code: '20GP', label: '20GP 标准柜' },
  { code: '40HQ', label: '40HQ 高柜' },
  { code: '45HQ', label: '45HQ 超高柜' },
];

for (const ct of containerTests) {
  const spec = CDB.CONTAINER_DB[ct.code];
  sub(`${ct.label} (${ct.code}) 装载测试`);
  try {
    const result = PE.calculate(TEST_CARGO, spec, { tolerance: 0.05, autoRetry: true });
    line(`箱数: ${result.containerCount}  已装: ${result.totalPlaced}/${result.totalPlaced + result.unplacedCount} 件  利用率: ${f2(result.avgUtilization * 100)}%  总重: ${f2(result.totalWeightLoaded)}kg / ${f0(spec.payload * result.containerCount)}kg (${f2((result.totalWeightLoaded / (spec.payload * result.containerCount) * 100))}%)`);
    if (result.unplacedCount > 0) {
      line(`未装: ${result.unplacedCount} 件 (${(result.unplacedItems || []).join(', ')})`);
    }
    // Check for selfCheck results
    if (result.checks) {
      const errors = result.checks.reduce((s, c) => s + c.errors.length, 0);
      const warnings = result.checks.reduce((s, c) => s + c.warnings.length, 0);
      if (errors + warnings > 0) {
        line(`自检: ${errors} 错误, ${warnings} 警告`);
      }
    }
  } catch (e) {
    line(`❌ 计算失败: ${e.message}`);
  }
}

// ═══ Section 5: Full Mixed Loading ═══
section('五、混合箱型完整装载方案');

let testSpecs;
let result;

if (rec && rec.type === 'mixed' && rec.mixed && rec.mixed.specs.length > 0) {
  testSpecs = rec.mixed.specs;
} else if (mixedRec && mixedRec.specs.length > 0) {
  testSpecs = mixedRec.specs;
} else {
  testSpecs = [CDB.CONTAINER_DB['40HQ']];
  sub('警告: 自动推荐失败，手动使用 40HQ');
}

try {
  result = PE.calculate(TEST_CARGO, null, {
    tolerance: 0.05,
    autoRetry: true,
    mixedContainers: testSpecs
  });

  sub('装载结果摘要：');
  line(`总箱数: ${result.containerCount}`);
  line(`已装件数: ${result.totalPlaced} / ${result.totalPlaced + result.unplacedCount}`);
  line(`总装载重量: ${f2(result.totalWeightLoaded)} kg`);
  line(`总装载体积: ${f2(result.totalVolumePlaced)} m³`);
  line(`平均空间利用率: ${f2(result.avgUtilization * 100)}%`);

  if (result.unplacedCount > 0) {
    line(`未装载: ${result.unplacedCount} 件`);
    line(`未装型号: ${(result.unplacedItems || []).join(', ')}`);
  }

  // Per-container detail
  sub('各箱装载明细：');
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    const spec = CDB.CONTAINER_DB[c.containerCode] || { L: 12, W: 2.4, H: 2.6, payload: 28000 };
    const isFR = spec.type === 'flatRack';
    const effMetric = isFR && c.spaceEfficiency != null
      ? `空间效率: ${f2(c.spaceEfficiency * 100)}%`
      : `利用率: ${f2(c.utilization * 100)}%`;

    // Count items by model
    const modelCounts = {};
    for (const item of c.placedItems) {
      modelCounts[item.model] = (modelCounts[item.model] || 0) + 1;
    }

    line(``);
    line(`  ┌─ 箱 ${ci + 1}: ${c.containerCode} (${spec.nameCN}) ─────────────────────`);
    line(`  │ 货物件数: ${c.placedItems.length} 件`);
    line(`  │ 装载重量: ${f2(c.totalWeight)} kg / ${f0(spec.payload)} kg (${f2(c.weightUtil * 100)}%)`);
    line(`  │ ${effMetric}`);
    line(`  │`);

    // Show model breakdown
    const modelEntries = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]);
    for (const [model, cnt] of modelEntries) {
      const cargoDef = TEST_CARGO.find(tc => tc.model === model);
      const dimStr = cargoDef ? `${f2(cargoDef.l)}×${f2(cargoDef.w)}×${f2(cargoDef.h)}m` : '';
      line(`  │   ${pad(model, 22)} ${pad(cnt.toString(), 5)}件  ${dimStr}  ${pad(rpad(f0(cnt * (cargoDef ? cargoDef.weight : 0)), 6), 8)}kg`);
    }
    line(`  └─$ {'─'.repeat(50)}`);

    // Check selfCheck
    if (result.checks && result.checks[ci]) {
      const chk = result.checks[ci];
      if (chk.errors.length > 0) {
        line(`    ❌ 自检错误:`);
        chk.errors.forEach(e => line(`       · ${e.message || e}`));
      }
      if (chk.warnings.length > 0) {
        line(`    ⚠️ 自检警告:`);
        chk.warnings.forEach(w => line(`       · ${w.message || w}`));
      }
    }
  }

  // Skipped containers
  if (result.skippedContainers && result.skippedContainers.length > 0) {
    sub('跳过的箱型：');
    result.skippedContainers.forEach(s => line(`  - ${s.code} (${s.nameCN}): ${s.reason}`));
  }

  // Recalculated flag
  if (result.recalculated) {
    line(``);
    line(`🔄 已触发自动重算 (sortStrategy: weight-desc)`);
  }

} catch (e) {
  line(`❌ 混合装载计算失败: ${e.message}`);
}

// ═══ Section 6: Stability & Compliance ═══
section('六、稳定性与合规性分析');

if (result) {
  sub('中心质量分布：');
  let totalMomentX = 0, totalMomentY = 0, totalMomentZ = 0, totalMass = 0;
  for (const c of result.containers) {
    const spec = CDB.CONTAINER_DB[c.containerCode] || { L: 12, W: 2.4 };
    for (const item of c.placedItems) {
      const cx = item.x + item.l / 2;
      const cy = item.y + item.w / 2;
      const cz = item.z + item.h / 2;
      const mass = item.weight || 0;
      totalMomentX += cx * mass;
      totalMomentY += cy * mass;
      totalMomentZ += cz * mass;
      totalMass += mass;
    }
  }
  const cgX = totalMass > 0 ? totalMomentX / totalMass : 0;
  const cgY = totalMass > 0 ? totalMomentY / totalMass : 0;
  const cgZ = totalMass > 0 ? totalMomentZ / totalMass : 0;
  line(`全局重心: X=${f2(cgX)}m, Y=${f2(cgY)}m, Z=${f2(cgZ)}m`);
  line(`总质量: ${f2(totalMass)} kg`);

  sub('叠放稳定性检查：');
  let unstackableCount = 0;
  let totalLayers = 0;
  for (const c of result.containers) {
    for (const item of c.placedItems) {
      if (item.stackable === false) unstackableCount++;
      totalLayers = Math.max(totalLayers, (item.z + item.h) > 0.5 ? 2 : 1);
    }
  }
  line(`不可叠放件数: ${unstackableCount}`);
  line(`最大堆叠层: Z+height = ${f2(totalLayers)}m (理论)`);

  sub('合规性评估：');
  const checks = result.checks || [];
  let totalErrors = 0, totalWarnings = 0;
  for (const chk of checks) {
    totalErrors += chk.errors.length;
    totalWarnings += chk.warnings.length;
  }
  if (totalErrors === 0 && totalWarnings === 0) {
    line(`✅ 所有装箱通过自检，无错误无警告`);
  } else {
    line(`${totalErrors > 0 ? '❌' : '⚠️'} 自检结果: ${totalErrors} 错误, ${totalWarnings} 警告`);
  }

  // Weight compliance
  sub('载重合规性：');
  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    const spec = CDB.CONTAINER_DB[c.containerCode] || { payload: 28000 };
    const ratio = (c.totalWeight / spec.payload * 100);
    const status = ratio > 100 ? '❌ 超载' : ratio > 90 ? '⚠️ 接近上限' : '✅ 合规';
    line(`箱${ci + 1} ${c.containerCode}: ${f2(c.totalWeight)} / ${f0(spec.payload)} kg (${f2(ratio)}%) ${status}`);
  }

} else {
  line(`无法进行稳定性分析（无计算结果）`);
}

// ═══ Section 7: Multi-scenario stress test ═══
section('七、边界条件压力测试');

const edgeCases = [
  {
    name: '全部可叠放标准货',
    items: [{ model: 'A', l: 0.5, w: 0.4, h: 0.3, quantity: 100, weight: 50, stackable: true, orientationFixed: false }],
    check: (r) => r.unplacedCount === 0
  },
  {
    name: '全部不可叠放（每件独占一层）',
    items: [{ model: 'B', l: 0.5, w: 0.4, h: 0.3, quantity: 20, weight: 50, stackable: false, orientationFixed: false }],
    check: (r) => r.containerCount <= 1 || r.unplacedCount === 0
  },
  {
    name: '极端重量（超载测试）',
    items: [{ model: 'C', l: 0.5, w: 0.4, h: 0.3, quantity: 500, weight: 500, stackable: true, orientationFixed: false }],
    check: (r) => r.containerCount >= 2  // 250T，任何单箱都装不下
  },
  {
    name: '超大尺寸单件（FR 边界）',
    items: [{ model: 'D', l: 12.5, w: 4.3, h: 2.5, quantity: 1, weight: 5000, stackable: false, orientationFixed: true }],
    check: (r) => r.containerCount >= 1 || r.unplacedCount > 0  // 可能超 FR 极限
  },
  {
    name: '不可倒置（orientationFixed）',
    items: [{ model: 'E', l: 1.5, w: 0.8, h: 2.2, quantity: 3, weight: 200, stackable: false, orientationFixed: true }],
    check: (r) => true  // 仅验证不崩溃
  }
];

for (const ec of edgeCases) {
  sub(`${ec.name}`);
  try {
    const rec2 = CDB.autoRecommend(ec.items, 0.05);
    let ecResult;
    if (rec2 && rec2.type === 'single' && rec2.primary) {
      ecResult = PE.calculate(ec.items, rec2.primary, { tolerance: 0.05, autoRetry: true });
    } else if (rec2 && rec2.type === 'mixed' && rec2.mixed) {
      ecResult = PE.calculate(ec.items, null, { tolerance: 0.05, autoRetry: true, mixedContainers: rec2.mixed.specs });
    } else {
      line(`  推荐失败, 原因: ${rec2 ? rec2.reasoning : 'N/A'}`);
      continue;
    }
    const ok = ec.check(ecResult);
    line(`  ${ok ? '✅' : '⚠️'} ${ecResult.containerCount}箱 ${ecResult.totalPlaced}件已装 ${ecResult.unplacedCount}件未装`);
    if (!ok) line(`  期望验证未通过`);
  } catch (e) {
    line(`  ❌ 异常: ${e.message}`);
  }
}

// ═══ Section 8: Identified Issues & Recommendations ═══
section('八、发现的问题与优化建议');

const issues = [];

// Collect issues from the main test
if (result) {
  if (result.unplacedCount > 0) {
    issues.push({
      severity: 'HIGH',
      title: `${result.unplacedCount} 件货物未能装载`,
      detail: `未装载型号: ${(result.unplacedItems || []).join(', ')}。建议: 增加箱型或检查货物尺寸是否超过所有可用箱型的有效范围。`,
      recommendation: '考虑使用更大的箱型（如45HQ），或拆分为更多小箱。'
    });
  }

  for (let ci = 0; ci < result.containers.length; ci++) {
    const c = result.containers[ci];
    const spec = CDB.CONTAINER_DB[c.containerCode] || { payload: 28000, L: 12, W: 2.4 };
    const wtRatio = c.totalWeight / spec.payload;
    if (wtRatio > 0.95) {
      issues.push({
        severity: 'MEDIUM',
        title: `箱${ci + 1} (${c.containerCode}) 载重利用率 ${f2(wtRatio * 100)}% 接近上限`,
        detail: `实际装载 ${f2(c.totalWeight)}kg，额定 ${f0(spec.payload)}kg。`,
        recommendation: '增加一箱分摊重量，或使用载重更高的替代箱型。'
      });
    }
    if (c.utilization < 0.3) {
      issues.push({
        severity: 'LOW',
        title: `箱${ci + 1} (${c.containerCode}) 体积利用率仅 ${f2(c.utilization * 100)}%`,
        detail: `空间利用率偏低，可能存在优化空间。`,
        recommendation: '考虑改用更小的箱型节省成本，或与其它货物拼箱。'
      });
    }
  }

  if (result.checks) {
    for (let ci = 0; ci < result.checks.length; ci++) {
      const chk = result.checks[ci];
      for (const e of chk.errors) {
        issues.push({
          severity: 'CRITICAL',
          title: `箱${ci + 1} 自检错误: ${e.message || e}`,
          detail: JSON.stringify(e.details || {}).substring(0, 200),
          recommendation: '需人工审查装箱方案，可能需要调整货物分组或箱型选择。'
        });
      }
      for (const w of chk.warnings) {
        issues.push({
          severity: 'MEDIUM',
          title: `箱${ci + 1} 自检警告: ${w.message || w}`,
          detail: '',
          recommendation: '建议复核，确认在实际操作中可接受。'
        });
      }
    }
  }
}

if (issues.length === 0) {
  issues.push({
    severity: 'INFO',
    title: '未发现显著问题',
    detail: '所有货物成功装载，自检通过，空间利用率和载重利用率均在合理范围内。',
    recommendation: '当前方案可直接执行。'
  });
}

const sevIcon = { 'CRITICAL': '🔴', 'HIGH': '🟠', 'MEDIUM': '🟡', 'LOW': '🔵', 'INFO': '🟢' };
for (let i = 0; i < issues.length; i++) {
  const iss = issues[i];
  line(`${i + 1}. ${sevIcon[iss.severity] || '⚪'} [${iss.severity}] ${iss.title}`);
  if (iss.detail) line(`   ${iss.detail}`);
  line(`   建议: ${iss.recommendation}`);
}

// ═══ Footer ═══
report.push(`${L}${'═'.repeat(78)}`);
report.push(`  报告结束`);
report.push(`  测试工具: scripts/test-full-mixed-report.js + PackingEngine v1.1`);
report.push(`${'═'.repeat(78)}${L}`);

// Output
const output = report.join('\n');
console.log(output);

// Save to file
const reportPath = path.join(__dirname, '..', 'test-reports', 'full-mixed-report-' + new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19) + '.txt');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, output);
console.log(`\n报告已保存至: ${reportPath}`);
