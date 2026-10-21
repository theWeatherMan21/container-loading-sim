// scripts/test-all.js — 全量测试聚合入口
// 顺序运行全部单元/集成/场景测试，任一失败即退出码 1
// 用法：npm test （内部调用本脚本）
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// 断言类套件：输出保留，失败即整体失败
const assertSuites = [
  'test-calculation-regressions.js',  // 核心回归（vm）
  'test-planner.js',                  // Planner 单元
  'test-planner-integration.js',      // Planner + Packer 集成
  'test-all-scenarios.js',            // 全场景
  'benchmark-optimization.js',        // 多起点优化 vs 基线（跨订单不劣化）
  'quick-check-smart.js',             // smart 策略
  'verify-capacity.js',               // 容量验证
  'diagnose-classification.js',       // 分类诊断
  'diagnose-packing-trace.js',        // 装箱追踪
  'diagnose-ems-fragmentation.js',    // EMS 碎片
  'test-regressions-r4.js',            // R4 轮 22 项修复回归固化（F-01..P-01）
  'test-regressions-p2.js',            // P2 轮 10 项修复回归固化（D-02/D-03/C-NEW-3/F-04/F-05/F-06/C-02/C-04/APP-1..3）
  'test-regressions-v05.js',            // V-05 修复回归固化（3D 多箱切换空白：disposeRenderer 不杀 context + 自愈兜底）
  'test-regressions-a1.js',            // A1 轮回归固化（A 方向单箱型尾货提示层静态契约：A-TAIL-1..5）
  'test-regressions-b1.js',            // B1 轮回归固化（B 方向引擎尾合并 pass 契约 + 直调混合装箱账目：B-TAIL-1..7）
  'test-regressions-c1.js',            // C1 轮回归固化（2026-10-13 双轨审阅修复：表头/去重/熔断/tolerance/重货推荐/FR 解除尺寸限制）
  'test-regressions-c2.js',            // C2 轮回归固化（2026-10-15 爹地拍板：官方载重/FR 长度限定（分层+平放+超限警告）/6 面翻转勾选/Worker/性能）
  'test-regressions-c3.js'             // C3 轮回归固化（2026-10-15 复审遗留：P1-6 漏装重试 pass / P1-8 分类一致性 / P2-5 文案 / P2-4 自检口径）
];

// 报告类套件：输出量大，仅检查退出码
const reportSuites = [
  'test-full-mixed-report.js',
  'test-comprehensive-report.js'
];

let failed = 0;
const run = (file, silent) => {
  const cmd = `node ${path.join(__dirname, file)}`;
  try {
    execSync(cmd, { stdio: silent ? 'pipe' : 'inherit', cwd: root, timeout: 300000 });
    console.log(`✅ ${file}`);
  } catch (e) {
    failed++;
    console.error(`❌ ${file}${silent ? '' : ` (${e.status || '超时/异常'})`}`);
  }
};

console.log('══════════ 全量测试套件 ══════════');
for (const s of assertSuites) run(s, false);
for (const s of reportSuites) run(s, true);

console.log(failed === 0
  ? `\n✅ 全部 ${assertSuites.length + reportSuites.length} 个测试套件通过`
  : `\n❌ ${failed} 个测试套件失败`);
process.exit(failed > 0 ? 1 : 0);
