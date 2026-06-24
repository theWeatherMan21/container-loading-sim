/**
 * 全场景装箱测试脚本
 * 用法: node scripts/test-all-scenarios.js
 * 依赖: 需在项目根目录执行，前端 JS 使用 window 全局对象
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// 创建 DOM 环境
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  runScripts: 'dangerously'
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// 按顺序加载脚本
const scripts = [
  'container-db.js',
  'field-parser.js',
  'packing-engine.js'
];

for (const script of scripts) {
  const code = fs.readFileSync(path.join(__dirname, '..', script), 'utf-8');
  const el = dom.window.document.createElement('script');
  el.textContent = code;
  dom.window.document.body.appendChild(el);
}

const CDB = dom.window.ContainerDB;
const PE = dom.window.PackingEngine;

// ═══════════════════════════════════════════
// 测试场景
// ═══════════════════════════════════════════

const scenarios = [
  {
    name: '场景1: 2000×小型货 20kg/件（历史bug回归）',
    items: [{ model: 'SmallBox', l: 0.15, w: 0.2, h: 0.3, quantity: 2000, weight: 20, stackable: true, orientationFixed: false }],
    autoRecommend: true,
    expect: {
      minBoxes: 2,
      maxBoxes: 3,
      suggestion: '20GP or 40GP by weight (40T / 21.8T ≈ 2 boxes)'
    }
  },
  {
    name: '场景2: 500×小型货 15kg/件（单箱够）',
    items: [{ model: 'TinyBox', l: 0.4, w: 0.3, h: 0.2, quantity: 500, weight: 15, stackable: true, orientationFixed: false }],
    autoRecommend: true,
    expect: {
      minBoxes: 1,
      maxBoxes: 1,
      suggestion: '20GP single box (7500kg < 21770kg)'
    }
  },
  {
    name: '场景3: 1×大型设备 2500×1500×300mm 8T（FR单件—不应竖放）',
    items: [{ model: 'Turbine', l: 2.5, w: 1.5, h: 0.3, quantity: 1, weight: 8000, stackable: true, orientationFixed: false }],
    autoRecommend: true,
    expect: {
      containerType: 'flatRack',
      checkOrientation: 'h should ≈ 0.3 (flat, not stood up)'
    }
  },
  {
    name: '场景4: 2×超大不可叠 3×2.4×2.2m 3T/件',
    items: [{ model: 'MachineBase', l: 3, w: 2.4, h: 2.2, quantity: 2, weight: 3000, stackable: false, orientationFixed: false }],
    autoRecommend: true,
    expect: {
      containerType: 'flatRack',
      minBoxes: 1,
      suggestion: '40FR (fits within 12.08×2.438 with overhang)'
    }
  },
  {
    name: '场景5: 100×温度货 0.5×0.4×0.3m 100kg/件',
    items: [{ model: 'ColdPack', l: 0.5, w: 0.4, h: 0.3, quantity: 100, weight: 100, stackable: true, orientationFixed: false }],
    autoRecommend: true,
    expect: {
      suggestion: 'reefer may be recommended (10000kg total)'
    }
  },
  {
    name: '场景6: 150×大宗中型货 1.5×1×0.5m 200kg/件',
    items: [{ model: 'PalletBox', l: 1.5, w: 1.0, h: 0.5, quantity: 150, weight: 200, stackable: true, orientationFixed: false }],
    autoRecommend: true,
    expect: {
      minBoxes: 2,
      maxBoxes: 3,
      suggestion: '40HQ by weight (30000kg / 26510kg ≈ 2 boxes)'
    }
  }
];

// ═══════════════════════════════════════════
// 执行测试
// ═══════════════════════════════════════════

let passed = 0;
let failed = 0;

function logHeader(msg) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${msg}`);
  console.log(`${'═'.repeat(60)}`);
}

function logSub(msg) {
  console.log(`  ── ${msg}`);
}

function logOk(msg) {
  console.log(`  ✅ ${msg}`);
  passed++;
}

function logFail(msg) {
  console.log(`  ❌ ${msg}`);
  failed++;
}

function logWarn(msg) {
  console.log(`  ⚠️  ${msg}`);
}

function logInfo(msg) {
  console.log(`     ${msg}`);
}

for (const scenario of scenarios) {
  logHeader(scenario.name);
  
  // 1. 自动推荐
  const rec = CDB.autoRecommend(scenario.items, 0.05);
  if (rec && rec.type !== 'failed') {
    logOk(`推荐成功: type=${rec.type}`);
    logInfo(`理由: ${rec.reasoning || 'N/A'}`);
    
    if (rec.type === 'single' && rec.primary) {
      logInfo(`单箱: ${rec.primary.code} (${rec.primary.nameCN}) payload=${rec.primary.payload}kg`);
    } else if (rec.type === 'mixed' && rec.mixed) {
      logInfo(`混合: ${rec.mixed.description}`);
      logInfo(`箱型: ${rec.mixed.specs.map(s => s.code).join(', ')}`);
    }
  } else {
    logFail(`推荐失败`);
  }

  // 2. 执行装箱
  let containerSpecOrNull = null;
  let calcOptions = { tolerance: 0.05, autoRetry: true };

  if (scenario.autoRecommend && rec) {
    if (rec.type === 'single' && rec.primary) {
      containerSpecOrNull = rec.primary;
    } else if (rec.type === 'mixed' && rec.mixed && rec.mixed.specs.length > 0) {
      calcOptions.mixedContainers = rec.mixed.specs;
    } else {
      // 手动选第一个
      const firstCode = Object.keys(CDB.CONTAINER_DB)[0];
      containerSpecOrNull = CDB.CONTAINER_DB[firstCode];
      logWarn(`推荐失败，手动使用: ${firstCode}`);
    }
  }

  try {
    const result = PE.calculate(scenario.items, containerSpecOrNull, calcOptions);
    logOk(`计算完成: ${result.containerCount} 箱, ${result.totalPlaced} 件已装`);
    
    if (result.totalItems) {
      logInfo(`闭环: ${result.totalPlaced} / ${result.totalItems} 件`);
    }
    if (result.unplacedCount > 0) {
      logWarn(`未装: ${result.unplacedCount} 件`);
      logInfo(`未装型号: ${(result.unplacedItems || []).join(', ') || 'N/A'}`);
    }

    // 验证
    if (scenario.expect) {
      if (scenario.expect.minBoxes && result.containerCount < scenario.expect.minBoxes) {
        logFail(`箱数不足: 实际=${result.containerCount}, 期望≥${scenario.expect.minBoxes}`);
      } else if (scenario.expect.maxBoxes && result.containerCount > scenario.expect.maxBoxes) {
        logFail(`箱数过多: 实际=${result.containerCount}, 期望≤${scenario.expect.maxBoxes}`);
      } else if (scenario.expect.minBoxes || scenario.expect.maxBoxes) {
        logOk(`箱数正确: ${result.containerCount}`);
      }

      // 场景3: 检查朝向（FR 不应竖放）
      if (scenario.expect.checkOrientation) {
        const firstContainer = result.containers && result.containers[0];
        if (firstContainer && firstContainer.placedItems && firstContainer.placedItems.length > 0) {
          const item = firstContainer.placedItems[0];
          logInfo(`放置方向: l=${item.l.toFixed(3)}, w=${item.w.toFixed(3)}, h=${item.h.toFixed(3)}`);
          if (scenario.expect.checkOrientation.includes('flat')) {
            if (item.h <= 0.5) {
              logOk(`货物平放 (h=${item.h.toFixed(3)})`);
            } else {
              logFail(`货物竖放 (h=${item.h.toFixed(3)}), 应平放`);
            }
          }
        }
      }

      // 场景3: 检查使用 FR 类型
      if (scenario.expect.containerType) {
        const firstCode = result.containers && result.containers[0] && result.containers[0].containerCode;
        if (firstCode) {
          const spec = CDB.CONTAINER_DB[firstCode];
          if (spec && spec.type === scenario.expect.containerType) {
            logOk(`箱型类型正确: ${spec.type} (${firstCode})`);
          } else {
            logWarn(`箱型类型: ${spec ? spec.type : 'unknown'} (${firstCode}), 期望 ${scenario.expect.containerType}`);
          }
        }
      }
    }

    // 3. 利用率
    logInfo(`平均利用率: ${(result.avgUtilization * 100).toFixed(1)}%`);
    logInfo(`总重: ${(result.totalWeightLoaded / 1000).toFixed(2)}T`);

  } catch (err) {
    logFail(`计算异常: ${err.message}`);
  }
}

// ═══════════════════════════════════════════
// 数据库验证
// ═══════════════════════════════════════════

logHeader('数据库完整性验证');

const expectedContainers = [
  '20GP', '40GP', '40HQ', '45HQ',
  '20RF', '40RF', '40HRF',
  '20FR', '40FR',
  '20PF', '40PF'
];

for (const code of expectedContainers) {
  const spec = CDB.CONTAINER_DB[code];
  if (spec) {
    logOk(`${code} (${spec.nameCN}): ${spec.L}×${spec.W}×${spec.H}m, ${spec.payload}kg, door:${spec.doorW}×${spec.doorH}`);
  } else {
    logFail(`${code}: 不存在`);
  }
}

// 检查是否有多余箱型（旧的 OT 等不应该存在）
const allCodes = Object.keys(CDB.CONTAINER_DB);
const unexpectedCodes = allCodes.filter(c => !expectedContainers.includes(c));
if (unexpectedCodes.length > 0) {
  logFail(`多余箱型: ${unexpectedCodes.join(', ')}`);
} else {
  logOk('箱型数量正确 (11种)');
}

// FR 验证
const fr40 = CDB.CONTAINER_DB['40FR'];
const frEff = CDB.getEffectiveMaxDims(fr40, 0.05);
logInfo(`40FR 有效尺寸: maxH=${frEff.maxH.toFixed(3)}m (内高${fr40.H}+1.0m超限)`);
if (Math.abs(frEff.maxH - (fr40.H + 1.0)) < 0.01) {
  logOk('FR 超高限制 = 1.0m ✓');
} else {
  logFail(`FR 超高限制: 期望 ${fr40.H + 1.0}, 实际 ${frEff.maxH.toFixed(3)}`);
}

// ═══════════════════════════════════════════
logHeader('总结');
console.log(`  ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
