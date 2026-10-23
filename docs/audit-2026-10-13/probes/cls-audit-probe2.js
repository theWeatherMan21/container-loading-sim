// 审阅探针批次2：推荐链路 + 超限边界
const { createRuntime } = require('/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/scripts/_load-runtime.js');
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;
const DB = CDB.CONTAINER_DB;

console.log('========== 实验7: 重货推荐链路 ==========');
for (const w of [27000, 28500, 30000, 32000, 40000, 41000, 43000]) {
  const item = { model: 'M', l: 2, w: 2, h: 2, weight: w, quantity: 1 };
  let rec;
  try { rec = CDB.autoRecommend([item], 0.05); } catch (e) { rec = { err: e.message }; }
  console.log(`  ${w}kg → type=${rec.type} primary=${rec.primary ? rec.primary.code : '-'} reasoning=${(rec.reasoning || rec.reason || '').slice(0, 90)}`);
}

console.log('\n========== 实验8: 40FT 单件容量上限复核（40FR 39.6t 口径 vs 官方 44.05t）==========');
for (const w of [40000, 42000, 44000]) {
  const item = { model: 'M', l: 3, w: 2, h: 2, weight: w, quantity: 1 };
  let r; try { r = PE.calculate([item], '40FR'); r = { placed: r.totalPlaced, unplaced: r.unplacedCount }; } catch (e) { r = e.message; }
  console.log(`  ${w}kg 3×2×2 → 40FR: ${JSON.stringify(r)}`);
}

console.log('\n========== 实验9: FR 超长/超宽装载 ==========');
// 9a: 13m 长货（超 40FR 内长 11.652，但 ≤ 12.152 超长上限）→ 应贴端装载
{
  const item = { model: 'LONG', l: 13, w: 1, h: 1, weight: 3000, quantity: 1 };
  let cls = CDB.classifyItemByContainerType(item);
  let r; try { r = PE.calculate([item], '40FR'); r = { placed: r.totalPlaced, unplaced: r.unplacedCount, overLen: r.containers[0] && r.containers[0].placedItems.map(p => p.overLength) }; } catch (e) { r = 'ERR:' + e.message; }
  console.log(`  13m 长货: classify=${cls} | 40FR=${JSON.stringify(r)}`);
}
// 9b: 12.2m 长货（超超长上限 12.152）→ 应不可装
{
  const item = { model: 'TOOLONG', l: 12.3, w: 1, h: 1, weight: 3000, quantity: 1 };
  let cls = CDB.classifyItemByContainerType(item);
  let r; try { r = PE.calculate([item], '40FR'); r = { placed: r.totalPlaced, unplaced: r.unplacedCount, errors: r.hasErrors }; } catch (e) { r = 'ERR:' + e.message; }
  console.log(`  12.3m 长货: classify=${cls} | 40FR=${JSON.stringify(r)}`);
}
// 9c: 超宽货 3.5m 宽（40FR 超宽上限 2.224+2.0=4.224）
{
  const item = { model: 'WIDE', l: 3, w: 3.5, h: 2, weight: 5000, quantity: 1 };
  let cls = CDB.classifyItemByContainerType(item);
  let r; try { r = PE.calculate([item], '40FR'); r = { placed: r.totalPlaced, unplaced: r.unplacedCount }; } catch (e) { r = 'ERR:' + e.message; }
  console.log(`  3.5m 宽货: classify=${cls} | 40FR=${JSON.stringify(r)}`);
}
// 9d: 宽 4.5m 货（超 4.224 上限）→ 应不可装
{
  const item = { model: 'TOOWIDE', l: 2, w: 4.5, h: 1, weight: 5000, quantity: 1 };
  let cls = CDB.classifyItemByContainerType(item);
  console.log(`  4.5m 宽货: classify=${cls}`);
}

console.log('\n========== 实验10: 20OT 超高货（门高不受限）==========');
{
  const item = { model: 'TALL', l: 2, w: 2, h: 2.6, weight: 5000, quantity: 1 };
  let cls = CDB.classifyItemByContainerType(item);
  let r; try { r = PE.calculate([item], '20OT'); r = { placed: r.totalPlaced, unplaced: r.unplacedCount }; } catch (e) { r = 'ERR:' + e.message; }
  console.log(`  2.6m 高货: classify=${cls} | 20OT=${JSON.stringify(r)}`);
  // 40HQ 对照（门高 2.597 但内高 2.7 或超高）
  let r2; try { r2 = PE.calculate([item], '40HQ'); r2 = { placed: r2.totalPlaced, unplaced: r2.unplacedCount }; } catch (e) { r2 = 'ERR:' + e.message; }
  console.log(`  40HQ 对照: ${JSON.stringify(r2)}`);
}

console.log('\n========== 实验11: 同货多箱混合推荐（哪些会被推给用户）==========');
{
  const items = [
    { model: 'STD', l: 1, w: 1, h: 1, weight: 100, quantity: 500 },
  ];
  let r; try { r = CDB.autoRecommend(items, 0.05); } catch (e) { r = { err: e.message }; }
  console.log(`  500×1m立方: type=${r.type} primary=${r.primary ? r.primary.code : '-'} reasoning=${(r.reasoning || '').slice(0, 120)}`);
  if (r.type === 'mixed' && r.mixed) console.log('    mixed:', r.mixed.description, '| specs:', r.mixed.specs.map(s => s.code).join(','));
}
