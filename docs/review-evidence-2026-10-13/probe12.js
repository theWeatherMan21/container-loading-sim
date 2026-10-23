// probe12.js — 交叉验证平行审阅(AUDIT-2026-10-13)的两条关键结论
const path = require('path');
const fs = require('fs');
const REPO = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const { createRuntime } = require(path.join(REPO, 'scripts/_load-runtime.js'));
const XLSX = require(path.join(REPO, 'node_modules/xlsx'));
const ctx = createRuntime(['container-db.js', 'field-parser.js', 'planner.js', 'packing-engine.js']);
ctx.XLSX = XLSX;
const FP = ctx.window.FieldParser, CDB = ctx.window.ContainerDB, PE = ctx.window.PackingEngine;
const log = (...a) => console.log(...a);

// ── A. 平行审阅 P0-2：相邻完全相同的数据行被静默删除 ──
log('══ A. 重复行是否被删除（构造 25 行含重复行的 xlsx） ══');
const header = ['Item', 'Description', 'Qty', 'Gross', 'L(mm)', 'W(mm)', 'H(mm)'];
const rows = [header];
for (let i = 1; i <= 25; i++) rows.push([i, 'Widget', 1, 100, 1200, 800, 600]);
// 前 10 行与第 1 行完全相同（同型号同尺寸同数量）→ 若去重按整行 JSON 比对，会丢
for (let i = 0; i < 10; i++) rows.push([1, 'Widget', 1, 100, 1200, 800, 600]);
const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'PL');
const tmp = path.join(__dirname, 'dup-rows.xlsx');
XLSX.writeFile(wb, tmp);
const buf = fs.readFileSync(tmp);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const parsed = FP.parseFile(ab, 'dup-rows.xlsx');
log(`FieldParser 解析：数据行=${parsed.totalDataRows} 条目数=${parsed.items.length} 总件数=${parsed.items.reduce((s, i) => s + (i.quantity || 1), 0)}`);
log(`  条目尺寸=${JSON.stringify(parsed.items.map(i => `${i.l}×${i.w}×${i.h}×${i.quantity}`))}`);
log(`  列映射=${JSON.stringify(parsed.mapping.map(m => `${m.header}→${m.field}`))}`);

// 复刻 app.js:617-623 的去重逻辑
const allRows = [];
for (const sh of parsed.sheets) allRows.push(...sh.data);
const cleaned = allRows.length > 0 ? [allRows[0]] : [];
for (let i = 1; i < allRows.length; i++) {
  if (JSON.stringify(cleaned[cleaned.length - 1]) !== JSON.stringify(allRows[i])) cleaned.push(allRows[i]);
}
log(`  原始行=${allRows.length} → app.js 去重后=${cleaned.length}（差 ${allRows.length - cleaned.length} 行）`);
log(`  （app.js 随后 state.dataRows = cleaned.slice(headerRowIndex+1)，即送 reExtract 的行数=${cleaned.slice(parsed.headerRowIndex + 1).length}）`);

// ── B. 平行审阅 P1-3：30t 单件被推荐 20GP×2 ──
log('\n══ B. 单件 30t 的推荐结论 ══');
const heavy = [{ model: 'STEEL-30T', l: 3.0, w: 2.0, h: 1.5, weight: 30000, quantity: 1, stackable: false, orientationFixed: false }];
const rec = CDB.recommendContainer(heavy, 0.05);
log(`  recommendContainer → ${rec ? (rec.primary ? 'primary=' + rec.primary.code : 'needsMixed: ' + rec.reason) + ' | ' + rec.reasoning : 'null'}`);
const auto = CDB.autoRecommend(heavy, 0.05);
log(`  autoRecommend → type=${auto.type} primary=${auto.primary && auto.primary.code} reasoning=${auto.reasoning}`);
const mix = CDB.recommendMixedContainers(heavy, 0.05);
log(`  recommendMixedContainers → ${mix ? mix.description : 'null'}`);
for (const code of ['20GP', '40HQ']) {
  const r = PE.calculate(heavy, code, { tolerance: 0.05 });
  log(`  calculate(${code}) → 装入=${r.totalPlaced}/${r.totalItems} 未装=${r.unplacedCount} hasErrors=${r.hasErrors} 错误=${JSON.stringify((r.checks || []).flatMap(c => c.errors.map(e => e.type)))}`);
}
