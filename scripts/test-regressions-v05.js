// scripts/test-regressions-v05.js — V-05 系列修复回归测试固化（3D 多箱切换空白）
//
// 背景：用户实测「3D 视图多箱来回切换时显示空白，只剩淡蓝色背景」。
// 根因：showContainer 单活模式下 disposeRenderer 对旧 canvas 执行 forceContextLoss()，
//       canvas 元素保留在 DOM；切回时懒创建在同一 canvas 上 new WebGLRenderer，
//       按 W3C 规范被强制丢失的 context 永久 lost，Three.js 构造函数抛
//       「Cannot read properties of null (reading 'precision')」→ 渲染初始化中断 → 空白。
//
// V-05   （第一轮）：disposeRenderer/disposeTempRenderer 移除强杀；showContainer 加 isContextLost 兜底
// V-05-R2（全量审阅后第二轮，对抗性审查发现的结构死角）：
//    A1  >16 箱时浏览器驱逐最老 context → 懒创建构造抛错穿透 showContainer（无 try/catch），
//        if(renderer) 门卫使自愈不可达 → 懒创建包 try/catch + needsHeal 统一路由
//    A2  截图临时渲染器在正式 canvas 上新建 context（未激活箱 N 个 = N 个新 context 且永久驻留）
//        → 改为共享单例离屏渲染器 ensureShotRenderer/disposeShotRenderer
//    B1  自愈换 canvas 后 mousemove/mouseleave 未重绑 → hover tooltip 永久失效 → 自愈时重绑 + 刷新 canvasEls
//    E1  过期 JSDoc（createTempRenderer 描述与实现矛盾）→ 函数整体删除
// 用法：node scripts/test-regressions-v05.js（或由 test-all.js 聚合运行）
// 约束：three-viewer.js 为 ES module（依赖 three import），Node 下不可直接加载，
//       沿用项目「源码契约模式」（同 test-regressions-p2.js 的 APP 章节）。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TV_SRC = fs.readFileSync(path.join(ROOT, 'three-viewer.js'), 'utf8');

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
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
}

// 剥离行注释与块注释后再做调用级检查（避免说明性注释中的方法名字样误报）
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function extractFn(name) {
  const m = TV_SRC.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  return m ? m[0] : null;
}

// ═══ V-05-R2-1: disposeRenderer 不杀 context ═══
test('V-05-R2-1 disposeRenderer 仅 dispose 不 forceContextLoss', () => {
  const body = stripComments(extractFn('disposeRenderer') || '');
  assert(body.length > 0, 'disposeRenderer 函数存在');
  assert(!/\.forceContextLoss\s*\(/.test(body),
    'disposeRenderer 内不得调用 forceContextLoss()——常驻 canvas 的 context 被强杀后切回必空白');
  assert(body.includes('renderer.dispose()'), 'disposeRenderer 必须执行 renderer.dispose() 释放 GPU 资源');
});

// ═══ V-05-R2-2: 临时渲染器体系已删除，改为共享离屏单例 ═══
test('V-05-R2-2 截图统一走共享离屏渲染器（ensureShotRenderer）', () => {
  assert(!TV_SRC.includes('function createTempRenderer'),
    'createTempRenderer 必须删除——它在正式 canvas 上新建 context 是泄漏源');
  assert(!TV_SRC.includes('function disposeTempRenderer'),
    'disposeTempRenderer 必须随 createTempRenderer 一并删除');
  assert(TV_SRC.includes('function ensureShotRenderer'), '必须存在共享截图渲染器 ensureShotRenderer');
  const mk = extractFn('ensureShotRenderer') || '';
  assert(mk.includes("document.createElement('canvas')"),
    '截图渲染器必须跑在游离 canvas 上（不挂 DOM、不占用正式箱型画布）');
  // captureScreenshot / captureScreenshotFixed 都不得再从 renderers map 取正式 renderer 来截图
  for (const fn of ['captureScreenshot', 'captureScreenshotFixed']) {
    const src = stripComments(extractFn(fn) || '');
    assert(src.includes('ensureShotRenderer'), `${fn} 必须使用 ensureShotRenderer`);
    assert(!/\bnew THREE\.WebGLRenderer\b/.test(src), `${fn} 内不得直接 new WebGLRenderer`);
  }
});

// ═══ V-05-R2-3: 懒创建异常保护 + 统一自愈路由（堵 >16 箱驱逐死角）═══
test('V-05-R2-3 showContainer 懒创建有异常保护且自愈覆盖构造失败路径', () => {
  const body = stripComments(extractFn('showContainer') || '');
  assert(body.length > 0, 'showContainer 函数存在');
  assert(body.includes('try') && body.includes('setupCameraRenderer'),
    '懒创建的 setupCameraRenderer 必须包在 try/catch 里（context 驱逐时构造会抛错穿透）');
  assert(/needsHeal\s*=\s*!renderer\s*\|\|/.test(body),
    '自愈判定必须是「!renderer || isContextLost()」——构造失败（renderer 为空）也要进入自愈路由');
  assert(body.includes('isContextLost'), '自愈判定需探测 gl.isContextLost()');
});

// ═══ V-05-R2-4: 自愈换 canvas 后重绑事件 + 刷新 canvasEls ═══
test('V-05-R2-4 自愈路径重绑悬停监听并同步 canvasEls 引用', () => {
  const body = stripComments(extractFn('showContainer') || '');
  assert(/addEventListener\('mousemove'/.test(body),
    '换新 canvas 后必须重绑 mousemove 监听（cloneNode 不复制事件，否则该箱 tooltip 永久失效）');
  assert(body.includes('mouseleave'), 'mouseleave 也必须重绑');
  assert(body.includes('canvasEls'), 'canvasEls 数组中的旧 canvas 引用必须刷新');
});

// ═══ V-05-R2-5: disposeAll 终局语义完整 ═══
test('V-05-R2-5 disposeAll 保留强杀且接管截图渲染器清理', () => {
  const raw = extractFn('disposeAll') || '';
  assert(raw.length > 0, 'disposeAll 函数存在');
  assert(raw.includes('forceContextLoss'),
    'disposeAll 是终局销毁（canvas 随 innerHTML 废弃），必须保留 forceContextLoss 防 context 泄漏');
  assert(raw.includes('disposeShotRenderer'), 'disposeAll 必须释放共享离屏截图渲染器（防重建循环泄漏）');
});

console.log(`\n=== test-regressions-v05: ${passed} passed, ${failed} failed (${assertCount} assertions) ===`);
process.exit(failed > 0 ? 1 : 0);
