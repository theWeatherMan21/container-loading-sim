// probe10b.js — PDF 报告 HTML 生成（DOM 桩）
const path = require('path');
const fs = require('fs');
const REPO = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const { createRuntime } = require(path.join(REPO, 'scripts/_load-runtime.js'));
const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js', 'pdf-exporter.js']);

const fakeEl = {
  style: {}, classList: { add() {}, remove() {} }, innerHTML: '',
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}
};
ctx.document = { getElementById: () => fakeEl, createElement: () => ({ style: {}, appendChild() {}, classList: { add() {}, remove() {} } }) };
ctx.window.document = ctx.document;

const CDB = ctx.window.ContainerDB, PE = ctx.window.PackingEngine, PX = ctx.window.PdfExporter;
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });

const items = [];
for (let i = 0; i < 60; i++) items.push(mk('SM', 0.4, 0.4, 0.4, 20, 1));
items.push(mk('BIG', 1.2, 1.2, 1.0, 500, 1, { stackable: false }));
const res = PE.calculate(items, '20GP', { tolerance: 0.05 });
console.log(`结果：箱数=${res.containerCount} 装入=${res.totalPlaced}/${res.totalItems} 未装=${res.unplacedCount} hasWarnings=${res.hasWarnings}`);
const el = PX.renderReportHtml(res, null, {});
const html = el.innerHTML || '';
console.log(`报告 HTML 长度=${html.length}；.pdf-page 页数=${(html.match(/pdf-page/g) || []).length}`);
for (const kw of ['载重', '利用率', '总重', '未装', '警告', 'SM', 'BIG', '装箱']) console.log(`  含「${kw}」: ${html.includes(kw)}`);
fs.writeFileSync(__dirname + '/probe10b.html', html);
console.log('HTML 已存 probe10b.html（前 600 字）:');
console.log(html.replace(/\s+/g, ' ').slice(0, 600));
