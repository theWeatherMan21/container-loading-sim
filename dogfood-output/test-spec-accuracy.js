global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };
global.XLSX = require('../vendor/xlsx.full.min.js');

require('../container-db.js');

const CDB = global.ContainerDB;
const CONTAINER_DB = CDB.CONTAINER_DB;

// BWS 权威数据（外长）
const BWS_SPECS = {
  '20GP': { L: 5.90, W: 2.35, H: 2.39, doorW: 2.34, doorH: 2.28, payload: 28200 },
  '40GP': { L: 12.03, W: 2.35, H: 2.39, doorW: 2.34, doorH: 2.28, payload: 28800 },
  '40HQ': { L: 12.03, W: 2.35, H: 2.70, doorW: 2.34, doorH: 2.58, payload: 28620 },
  '20OT': { L: 5.90, W: 2.34, H: 2.35, doorW: 2.29, doorH: Infinity, payload: 28200 },
  '40OT': { L: 12.03, W: 2.34, H: 2.35, doorW: 2.29, doorH: Infinity, payload: 26600 },
  '20FR': { L: 5.97, W: 2.36, H: 2.24, doorW: Infinity, doorH: Infinity, payload: 27150, innerL: 5.70 },
  '40FR': { L: 12.06, W: 2.37, H: 2.28, doorW: Infinity, doorH: Infinity, payload: 39300, innerL: 11.70 }
};

// FR箱型代码使用内长，需要特殊处理
const FR_CODES = ['20FR', '40FR'];

console.log('=== 集装箱参数准确性验证 ===\n');

const criticalIssues = [];
const warnings = [];

for (const [code, bws] of Object.entries(BWS_SPECS)) {
  const codeData = CONTAINER_DB[code];
  if (!codeData) {
    console.log(`❌ ${code}: 代码中不存在`);
    continue;
  }

  console.log(`${code}:`);

  // 检查尺寸
  const dims = ['L', 'W', 'H'];
  dims.forEach(dim => {
    let bwsValue = bws[dim];
    // FR箱型代码使用内长，对比时使用内长
    if (dim === 'L' && FR_CODES.includes(code) && bws.innerL !== undefined) {
      bwsValue = bws.innerL;
    }
    const diff = Math.abs(codeData[dim] - bwsValue);
    if (diff > 0.05) {
      const expectedLabel = (dim === 'L' && FR_CODES.includes(code)) ? 'BWS内长' : 'BWS';
      const msg = `  ⚠️  ${dim}: 代码=${codeData[dim].toFixed(3)}m, ${expectedLabel}=${bwsValue.toFixed(3)}m, 差异=${diff.toFixed(3)}m`;
      console.log(msg);
      warnings.push(`${code} ${dim} ${msg}`);
    }
  });

  // 检查门宽（非无穷大）
  if (bws.doorW !== Infinity && codeData.doorW !== Infinity) {
    const diff = Math.abs(codeData.doorW - bws.doorW);
    if (diff > 0.01) {
      const msg = `  ⚠️  doorW: 代码=${codeData.doorW.toFixed(3)}m, BWS=${bws.doorW.toFixed(3)}m, 差异=${diff.toFixed(3)}m`;
      console.log(msg);
      warnings.push(`${code} doorW ${msg}`);
    }
  }

  // 检查载重
  const payloadDiff = Math.abs(codeData.payload - bws.payload);
  const payloadDiffPercent = (payloadDiff / bws.payload) * 100;
  if (payloadDiffPercent > 5) {
    const msg = `  ❌ payload: 代码=${codeData.payload}kg, BWS=${bws.payload}kg, 差异=${payloadDiff}kg (${payloadDiffPercent.toFixed(1)}%)`;
    console.log(msg);
    criticalIssues.push(`${code} payload ${msg}`);
  } else if (payloadDiffPercent > 1) {
    const msg = `  ⚠️  payload: 代码=${codeData.payload}kg, BWS=${bws.payload}kg, 差异=${payloadDiff}kg (${payloadDiffPercent.toFixed(1)}%)`;
    console.log(msg);
    warnings.push(`${code} payload ${msg}`);
  }

  console.log('');
}

console.log('=== 总结 ===');
console.log(`严重问题: ${criticalIssues.length}`);
console.log(`警告: ${warnings.length}`);

if (criticalIssues.length > 0) {
  console.log('\n严重问题详情:');
  criticalIssues.forEach(issue => console.log(`  - ${issue}`));
}

if (warnings.length > 0) {
  console.log('\n警告详情:');
  warnings.forEach(warn => console.log(`  - ${warn}`));
}

process.exit(criticalIssues.length > 0 ? 1 : 0);