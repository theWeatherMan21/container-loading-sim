// 复现用户报告的装箱结果：验证 16 箱 / 低利用率的根因
global.window = global; // packing-engine 依赖 window.ContainerDB
require('../container-db.js');
require('../packing-engine.js');
const PE = global.window.PackingEngine;

const items = [
  { model: '1', l: 0.240, w: 0.350, h: 2.300, quantity: 1,   weight: 7000, stackable: true },
  { model: '2', l: 0.500, w: 0.600, h: 0.700, quantity: 700, weight: 600,  stackable: true }
];

function describe(label, result) {
  console.log('=== ' + label + ' ===');
  console.log('containerCount:', result.containerCount);
  console.log('totalPlaced:', result.totalPlaced, '/ unplaced:', result.unplacedCount);
  const specs = {};
  (result.containers || []).forEach((c, i) => {
    specs[c.containerCode] = (specs[c.containerCode] || 0) + 1;
    if (i < 3 || c.placedItems.length <= 2) {
      const models = {};
      c.placedItems.forEach(p => { models[p.model] = (models[p.model] || 0) + 1; });
      console.log(`  箱${i + 1} [${c.containerCode}] 件数=${c.placedItems.length} 体积利用率=${(c.utilization * 100).toFixed(1)}% 载重利用率=${(c.weightUtil * 100).toFixed(1)}% 总重=${c.totalWeight.toFixed(0)}kg SKU=${JSON.stringify(models)}`);
    }
  });
  console.log('箱型分布:', JSON.stringify(specs));
}

// 1) 直接对 40HQ 计算（观察单箱型多箱路径）
const r40hq = PE.calculate(items, { code: '40HQ', nameCN: '40尺高柜', L: 12.032, W: 2.352, H: 2.700, doorW: 2.340, doorH: 2.597, payload: 28650, volume: 76.3, type: 'standard' }, { tolerance: 0.05, autoRetry: true });
describe('单箱型 40HQ', r40hq);

// 2) 直接对 40GP 计算
const r40gp = PE.calculate(items, { code: '40GP', nameCN: '40尺普柜', L: 12.032, W: 2.352, H: 2.395, doorW: 2.340, doorH: 2.292, payload: 28800, volume: 67.7, type: 'standard' }, { tolerance: 0.05, autoRetry: true });
describe('单箱型 40GP', r40gp);

// 3) 推荐预演：看推荐器给哪种箱
if (PE.simulateContainerOptions) {
  const sim = PE.simulateContainerOptions(items, ['20GP', '40GP', '40HQ', '45HQ'], { tolerance: 0.05 });
  console.log('=== 推荐预演 ===');
  console.log(JSON.stringify(sim, null, 1).slice(0, 1200));
}
