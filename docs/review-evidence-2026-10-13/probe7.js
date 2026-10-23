// probe7.js — 真实装箱单端到端（解析 mm → 推荐 → 计算 → 不变量校验）
const path = require('path');
const fs = require('fs');
const REPO = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const { createRuntime } = require(path.join(REPO, 'scripts/_load-runtime.js'));
const L = require('./probe-lib.js');

const ctx = createRuntime(['container-db.js', 'field-parser.js', 'planner.js', 'packing-engine.js']);
ctx.XLSX = require(path.join(REPO, 'node_modules/xlsx'));
const FP = ctx.window.FieldParser;
const CDB = ctx.window.ContainerDB;
const PE = ctx.window.PackingEngine;

const out = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); out.push(s); console.log(s); };

const file = process.argv[2] || path.join(REPO, 'test-packing-list.xlsx');
log(`文件：${file}`);
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const parsed = FP.parseFile(ab, path.basename(file));
log(`工作表=${parsed.sheets.length} headerRow=${parsed.headerRow} headerRowIndex=${parsed.headerRowIndex} 数据行=${parsed.totalDataRows}`);
log(`列映射：` + JSON.stringify(parsed.mapping.map(m => `${m.header}→${m.field}(${m.confidence})`)));
if (parsed.warnings && parsed.warnings.length) log(`解析告警：` + JSON.stringify(parsed.warnings));
log('解析出的货物：');
for (const it of parsed.items) {
  log(`  ${it.model} | ${it.l}×${it.w}×${it.h} | qty=${it.quantity} | ${it.weight}kg | stackable=${it.stackable}`);
}
const multi = FP.detectMultiSize(parsed.items);
log(`多尺寸 SKU：${JSON.stringify(Object.keys(multi))}`);

// 单位推断（等价于 app.inferUnitFromMapping 的数值分支）
const dimIdx = parsed.mapping.filter(m => ['length', 'width', 'height', 'possibleDimension', 'combinedDimension'].includes(m.field)).map(m => m.index);
const rows = [];
for (const sh of parsed.sheets) rows.push(...sh.data);
const dataRows = rows.slice(parsed.headerRowIndex + 1);
const vals = [];
for (const r of dataRows) for (const i of dimIdx) { const v = r[i]; if (v != null && v !== '') { const n = FP.normalizeNumber(v); if (!isNaN(n) && n > 0) vals.push(n); } }
log(`尺寸列原始数值样本=${JSON.stringify(vals.slice(0, 8))} → 推断单位=${FP.inferUnit(vals)}`);

// 端到端计算（等价 app.startCalculation 的混合路径）
const items = parsed.items.map(i => ({ ...i, stackable: i.stackable !== false, orientationFixed: i.orientationFixed || false }));
const rec = CDB.autoRecommend(items, 0.05);
log(`自动推荐：type=${rec && rec.type} primary=${rec && rec.primary && rec.primary.code} reasoning=${rec && rec.reasoning}`);
log(`备选：${rec && rec.alternatives ? rec.alternatives.map(a => a.code).join(',') : ''}`);

const t0 = Date.now();
let res;
try {
  res = PE.calculate(items, null, { tolerance: 0.05, mixedContainers: CDB.CONTAINER_LIST });
  log(`\n混合计算：耗时=${Date.now() - t0}ms 箱数=${res.containerCount} 装入=${res.totalPlaced}/${res.totalItems} 未装=${res.unplacedCount} 平均利用率=${(res.avgUtilization * 100).toFixed(1)}% hasErrors=${res.hasErrors} hasWarnings=${res.hasWarnings}`);
  log(`箱型序列：` + res.containers.map(c => `${c.containerCode}(${c.placedItems.length}件,${(c.utilization * 100).toFixed(0)}%,${(c.weightUtil * 100).toFixed(0)}%载)`).join(' | '));
  const totVol = items.reduce((s, i) => s + i.l * i.w * i.h * (i.quantity || 1), 0);
  const totWt = items.reduce((s, i) => s + i.weight * (i.quantity || 1), 0);
  log(`输入体积=${totVol.toFixed(1)}m³ 总重=${totWt.toFixed(0)}kg`);
  // 不变量
  let sv = 0, ob = 0, ow = 0, fl = 0, ov = 0;
  for (const c of res.containers) {
    const spec = CDB.CONTAINER_LIST.find(s => s.code === c.containerCode);
    sv += L.checkStackViolation(c).length;
    ow += L.checkOverweight(c, spec).length;
    fl += L.checkFloating(c).length;
    const eff = CDB.getEffectiveMaxDims(spec, 0.05);
    for (const it of c.placedItems) {
      if (it.x + it.l > eff.maxL + 1e-6 || it.y + it.w > eff.maxW + 1e-6 || it.z + it.h > eff.maxH + 1e-6) ob++;
    }
    // 重叠
    const n = c.placedItems.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = c.placedItems[i], b = c.placedItems[j];
      if (a.x + 1e-6 < b.x + b.l && a.x + a.l > b.x + 1e-6 && a.y + 1e-6 < b.y + b.w && a.y + a.w > b.y + 1e-6 && a.z + 1e-6 < b.z + b.h && a.z + a.h > b.z + 1e-6) ov++;
    }
  }
  log(`不变量：叠放违规=${sv} 越界(含FR超限预算)=${ob} 超重=${ow} 悬空=${fl} 重叠=${ov}`);
  const errs = res.checks.filter(c => c.errors.length);
  log(`selfCheck 报错：${errs.length ? JSON.stringify(errs.map(c => c.errors.map(e => e.type + ':' + e.message))) : '无'}`);
  const warns = res.checks.filter(c => c.warnings.length);
  if (warns.length) log(`selfCheck 告警：${JSON.stringify(warns.map(c => c.warnings.map(w => w.type))) }`);
} catch (e) {
  log(`✗ calculate 抛错：${e.message}`);
}

// 单箱型路径（40HQ）对照
try {
  const r2 = PE.calculate(items, '40HQ', { tolerance: 0.05 });
  log(`\n单箱型 40HQ：箱数=${r2.containerCount} 装入=${r2.totalPlaced}/${r2.totalItems} 未装=${r2.unplacedCount} 平均利用率=${(r2.avgUtilization * 100).toFixed(1)}% hasErrors=${r2.hasErrors}`);
  log(`  各箱：` + r2.containers.map(c => `${c.placedItems.length}件/${(c.utilization * 100).toFixed(0)}%`).join(' | '));
  if (r2.unplacedCount > 0) log(`  未装货物：` + JSON.stringify(r2.unplacedItems));
} catch (e) { log(`✗ 40HQ 抛错：${e.message}`); }

fs.writeFileSync(__dirname + '/probe7.log', out.join('\n') + '\n');
