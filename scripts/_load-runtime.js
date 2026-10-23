// scripts/_load-runtime.js — 统一 vm 沙箱加载器
// 替代 JSDOM：Node 20+/23 环境下 JSDOM 初始化会卡死，
// 前端模块仅依赖 window 全局，用 vm 沙箱即可完整加载。
// 用法：const { createRuntime } = require('./_load-runtime');
//       const ctx = createRuntime(['container-db.js', 'planner.js', 'packing-engine.js']);
//       const CDB = ctx.window.ContainerDB;
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createRuntime(files) {
  const context = { console, window: {}, setTimeout, clearTimeout };
  context.window = context;
  vm.createContext(context);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context, { filename: f });
  }
  return context;
}

module.exports = { createRuntime };
