// scripts/test-diag-gate.js — 3D 调试日志门控不变量（2026-11-18 爹地红线）
//
// 契约：
//   1) three-viewer.js 里所有 `[3D Diag]` / `[3D Dig]` 日志必须走 dlog/dwarn/derr，
//      不得出现裸 console.*（release 正常启动控制台零调试输出）。
//   2) diagOn() 默认关：无 window.__CLS_DEBUG__、无 ?diag=1 时返回 false。
//   3) 只有 CLS_DEBUG=1 注入（Rust setup 写 window.__CLS_DEBUG__=true）或 ?diag=1 时才为 true。
//
// 失败即退出码 1。纯静态 + 纯函数求值，不启动浏览器、不开窗口。
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'three-viewer.js');
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

let gated = 0;
const naked = [];
lines.forEach((ln, i) => {
  if (!/\[3D Dia?g/.test(ln)) return;          // 历史拼写混用：`[3D Diag]` 与 `[3D Dig]`
  const t = ln.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;  // 注释里提到该前缀不算日志
  if (/\b(dlog|dwarn|derr)\(/.test(ln)) gated++;
  else naked.push(i + 1);
});

let failed = 0;
if (naked.length) {
  console.error(`FAIL 裸 console 调试日志（行 ${naked.join(', ')}）—— 必须走 dlog/dwarn/derr`);
  failed++;
}
if (gated < 15) {
  console.error(`FAIL 门控日志条数异常：${gated}（预期 ≥15，日志被误删或漏门控）`);
  failed++;
}

const m = src.match(/function diagOn\(\) \{[\s\S]*?\n\}/);
if (!m) {
  console.error('FAIL 找不到 diagOn() 定义');
  process.exit(1);
}
const fn = new Function('window', 'location', `${m[0]}\nreturn diagOn();`);
// 注：m[0] 来自本仓库 three-viewer.js 的静态源码，不是外部输入；此处在沙箱化求值一个纯判定函数。
const cases = [
  ['默认（无注入、无参数）', {}, { search: '' }, false],
  ['CLS_DEBUG=1（Rust 注入）', { __CLS_DEBUG__: true }, { search: '' }, true],
  ['浏览器 ?diag=1', {}, { search: '?diag=1' }, true],
];
for (const [name, win, loc, want] of cases) {
  let got;
  try { got = fn(win, loc); } catch (e) { got = `throw:${e.message}`; }
  if (got !== want) {
    console.error(`FAIL diagOn ${name}: 期望 ${want}，实得 ${got}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n❌ 3D Diag 门控不变量 ${failed} 项失败`);
  process.exit(1);
}
console.log(`PASS 3D Diag 门控：${gated} 条日志全部门控 · 默认关 · CLS_DEBUG 注入开 · ?diag=1 开`);
