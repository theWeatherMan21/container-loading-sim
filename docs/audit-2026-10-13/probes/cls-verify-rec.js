// 30t 推荐链修复验证
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;

const show = (tag, rec) => console.log(`${tag}: type=${rec.type} primary=${rec.primary ? rec.primary.code : '-'} | ${(rec.reasoning || rec.reason || '').slice(0, 110)}`);

show('30t 单件', CDB.autoRecommend([{ model: 'M', l: 2, w: 2, h: 2, weight: 30000, quantity: 1 }], 0.05));
show('40t 单件', CDB.autoRecommend([{ model: 'M', l: 2, w: 2, h: 2, weight: 40000, quantity: 1 }], 0.05));
show('28.5t 单件', CDB.autoRecommend([{ model: 'M', l: 2, w: 2, h: 2, weight: 28500, quantity: 1 }], 0.05));
show('30t + 10小货', CDB.autoRecommend([
  { model: 'HEAVY', l: 2, w: 2, h: 2, weight: 30000, quantity: 1 },
  { model: 'SMALL', l: 1, w: 1, h: 1, weight: 100, quantity: 10 },
], 0.05));

// 端到端：30t 件按推荐算 40FR
const r = PE.calculate([{ model: 'M', l: 2, w: 2, h: 2, weight: 30000, quantity: 1 }], '40FR');
console.log('30t → 40FR 实算:', { placed: r.totalPlaced, unplaced: r.unplacedCount });
