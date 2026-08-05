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
  'diagnose-ems-fragmentation.js'     // EMS 碎片
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
