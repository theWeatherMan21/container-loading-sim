// probe10.js — PDF 报告 HTML 生成（纯函数）+ 载重展示字段核查
const path = require('path');
const fs = require('fs');
const REPO = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const { createRuntime } = require(path.join(REPO, 'scripts/_load-runtime.js'));
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js', 'pdf-exporter.js']);
const CDB = ctx.window.ContainerDB, PE = ctx.window.PackingEngine, PX = ctx.window.PdfExporter;
console.log('PdfExporter 可用:', !!PX, '导出函数:', PX ? Object.keys(PX).join(',') : '-');
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });
const items = [];
for (let i = 0; i < 60; i++) items.push(mk('SM', 0.4, 0.4, 0.4, 20, 1));
items.push(mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false }));
const res = PE.calculate(items, '20GP', { tolerance: 0.05 });
console.log(`结果：箱数=${res.containerCount} 装入=${res.totalPlaced}/${res.totalItems} 未装=${res.unplacedCount} hasWarnings=${res.hasWarnings}`);
const html = PX.renderReportHtml(res, null, {});
console.log(`报告 HTML 长度=${html.length}；页数(.pdf-page)=${(html.match(/class="pdf-page"/g) || []).length}`);
for (const kw of ['载重', '利用率', '总重', '未装', '警告', 'SM', 'BIG']) {
  console.log(`  含「${kw}」: ${html.includes(kw)}`);
}
// 结果对象字段核查（UI/PDF 用到的字段）
const c0 = res.containers[0];
console.log('单箱字段:', JSON.stringify({ containerCode: c0.containerCode, utilization: +c0.utilization.toFixed(4), weightUtil: +c0.weightUtil.toFixed(4), totalWeight: c0.totalWeight, containerVolume: c0.containerVolume, isInterim: c0.isInterim }));
console.log('结果级字段:', Object.keys(res).join(','));
fs.writeFileSync(__dirname + '/probe10.log', `htmlLen=${html.length}\n` + html.slice(0, 1200) + '\n');
