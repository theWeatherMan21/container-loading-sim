// 覆盖：
//   应用 app.js「A 方向 · 单箱型尾货推荐提示层」回归固化（静态契约，理由见尾注）：
//     A-TAIL-1 尾货低利用率阈值为百分数口径（TAIL_LOW_UTIL_THRESHOLD_PCT=35 与 lastUtilPct
//              同单位；全文件无旧名 TAIL_LOW_UTIL_THRESHOLD 残留、块内无 0~1 小数比较）
//     A-TAIL-2 isSingleBoxPath 判据逐字契约（!useMixed + 有 containerSpec + 无 containerSpecs，
//              其中 !containerSpecs 为设计意图：仅手动单箱型路径触发）
//     A-TAIL-3 双触发分支结构完整（unplacedCount>0 分支 / tailLowUtil else-if 分支，
//              且 tailLowUtil 带 ≥2 箱与空值双保护）
//     A-TAIL-4 两分支均渲染引导按钮（result-summary__switch → App.goToStep(3)，恰各一次）
//     A-TAIL-5 样式契约存在（--action 注记条 + switch 按钮三态 hover/focus-visible/active）
// 用法：node scripts/test-regressions-a1.js（或由 test-all.js 聚合运行）
// 约束：纯只读断言（无需引擎 runtime）；app.js 因闭包不导出内部函数且项目记录 JSDOM 在
//       Node 20+/23 卡死（见 _load-runtime.js / test-regressions-p2.js 头注释），
//       采用"源码契约模式"静态断言策略，防回归能力等价于行为断言。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

let passed = 0;
let failed = 0;
let assertCount = 0;

function assert(condition, message) {
  assertCount++;
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

// 工具：提取 app.js 中 A 方向提示层代码块（自区块注释起，至 renderContainerTabs 定义止）
function getTailHintBlock() {
  const s = APP_SRC.indexOf('// A 方向（单箱型尾货建议）');
  assert(s !== -1, '未找到 A 方向区块起始注释');
  const e = APP_SRC.indexOf('function renderContainerTabs', s);
  assert(e !== -1, '未找到 A 方向区块结束锚点 renderContainerTabs');
  return APP_SRC.slice(s, e);
}

test('A-TAIL-1 尾货阈值为百分数口径（_PCT=35 与 lastUtilPct 同单位，无旧名残留）', () => {
  assert(APP_SRC.includes('const TAIL_LOW_UTIL_THRESHOLD_PCT = 35;'),
    '缺少百分数口径常量 TAIL_LOW_UTIL_THRESHOLD_PCT = 35');
  assert(APP_SRC.includes('百分数口径'),
    '常量处缺少「百分数口径」口径说明注释（防后人误读回 0~1 口径）');
  assert(!/TAIL_LOW_UTIL_THRESHOLD(?!_PCT)/.test(APP_SRC),
    '存在旧名 TAIL_LOW_UTIL_THRESHOLD 残留（未加 _PCT 后缀）——浏览器端 ReferenceError 隐患');
  const block = getTailHintBlock();
  assert(block.includes('lastUtilPct < TAIL_LOW_UTIL_THRESHOLD_PCT'),
    '比较行未使用百分数常量（口径不一致或已被改动）');
  assert(!/\b0\.35\b/.test(block),
    'A 方向块内出现 0.35 小数比较——疑似回退 0~1 口径');
  assert(block.includes('Math.round(lastC.utilization * 100)'),
    '末箱利用率未按百分数换算（*100 取整）');
});

test('A-TAIL-2 判据仅手动单箱型路径触发（三条件逐字契约）', () => {
  const expected = '!state.useMixed && !!state.containerSpec && !state.containerSpecs';
  assert(APP_SRC.includes(expected),
    `isSingleBoxPath 判据缺失或被改动，须逐字包含: ${expected}`);
  assert(APP_SRC.includes('if (isSingleBoxPath)'),
    '缺少 isSingleBoxPath 主分支包裹');
});

test('A-TAIL-3 双触发分支结构完整（unplacedCount 分支 / tailLowUtil else-if 分支）', () => {
  const block = getTailHintBlock();
  assert(block.includes('containers.length >= 2'),
    'tailLowUtil 缺少 ≥2 箱前置条件');
  assert(block.includes('lastUtilPct !== null'),
    'tailLowUtil 缺少末箱利用率空值保护');
  assert(block.includes('if ((result.unplacedCount || 0) > 0)'),
    '缺少「有件未装入」触发分支');
  assert(block.includes('} else if (tailLowUtil) {'),
    '缺少 tailLowUtil else-if 分支');
});

test('A-TAIL-4 两分支均渲染引导按钮（switch → App.goToStep(3)，恰各一次）', () => {
  const btn = 'class="result-summary__switch" onclick="App.goToStep(3)"';
  const occurrences = APP_SRC.split(btn).length - 1;
  assert(occurrences === 2,
    `引导按钮应恰好出现 2 次（unplaced/tailLowUtil 分支各一），实际 ${occurrences}`);
  const block = getTailHintBlock();
  const notes = (block.match(/result-summary__note--action/g) || []).length;
  assert(notes >= 2,
    `两分支应各自渲染 --action 注记条，实际 ${notes} 次`);
});

test('A-TAIL-5 样式契约存在（注记条 + switch 按钮三态）', () => {
  assert(CSS_SRC.includes('.result-summary__note--action'),
    'styles.css 缺少 .result-summary__note--action 选择器');
  const i = CSS_SRC.indexOf('.result-summary__switch');
  assert(i !== -1, 'styles.css 缺少 .result-summary__switch 选择器');
  const win = CSS_SRC.slice(i, i + 500);
  assert(win.includes(':hover') && win.includes(':focus-visible') && win.includes(':active'),
    '.result-summary__switch 缺少 hover/focus-visible/active 三态样式');
});

console.log(`\n═══ test-regressions-a1 完成：${passed} 通过 / ${failed} 失败（共 ${assertCount} 条断言）═══`);
