global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };
global.XLSX = require('../vendor/xlsx.full.min.js');

require('../container-db.js');
require('../field-parser.js');

const CDB = global.ContainerDB;
const FP = global.FieldParser;

const fs = require('fs');
const buffer = fs.readFileSync('土耳其货物明细(1).xlsx');
const result = FP.parseFile(buffer, '土耳其货物明细(1).xlsx');
const items = result.items;

console.log('货物明细（尺寸单位：m）：');
items.forEach((item, idx) => {
  console.log(`${idx + 1}. ${item.model || '无型号'}: ${item.l.toFixed(3)} × ${item.w.toFixed(3)} × ${item.h.toFixed(3)} m, ${item.weight}kg × ${item.quantity || 1}`);
});

console.log('\n40FR 有效尺寸：');
const fr40 = CDB.CONTAINER_DB['40FR'];
const eff = CDB.getEffectiveMaxDims(fr40, 0.05);
console.log(`maxL: ${eff.maxL.toFixed(3)}m, maxW: ${eff.maxW.toFixed(3)}m, maxH: ${eff.maxH.toFixed(3)}m`);

console.log('\n货物分类结果：');
items.forEach((item, idx) => {
  const cls = CDB.classifyItemByContainerType(item, 0.05);
  console.log(`${idx + 1}. ${item.model}: ${cls}`);
});

console.log('\n单件最大重量:', Math.max(...items.map(i => i.weight)), 'kg');
console.log('40FR payload:', CDB.CONTAINER_DB['40FR'].payload, 'kg');

console.log('\n各分组货物：');
console.log('标准柜组:', items.filter(i => ['20GP', '40HQ'].includes(CDB.classifyItemByContainerType(i, 0.05))).length, '件');
console.log('OT组:', items.filter(i => CDB.classifyItemByContainerType(i, 0.05) === 'OT').length, '件');
console.log('FR组:', items.filter(i => CDB.classifyItemByContainerType(i, 0.05) === 'FR').length, '件');

console.log('\n混合推荐尝试：');
const mixed = CDB.recommendMixedContainers(items, 0.05);
console.log('推荐结果:', mixed ? JSON.stringify(mixed, null, 2) : 'null');

console.log('\n检查FR组单独推荐：');
const frItems = items.filter(i => CDB.classifyItemByContainerType(i, 0.05) === 'FR');
console.log('FR组货物：');
frItems.forEach(item => {
  const maxDim = Math.max(item.l, item.w, item.h);
  const minDim = Math.min(item.l, item.w, item.h);
  console.log(`${item.model}: max=${maxDim.toFixed(3)}, min=${minDim.toFixed(3)}`);
});

const fr40Spec = CDB.CONTAINER_DB['40FR'];
const fr40Eff = CDB.getEffectiveMaxDims(fr40Spec, 0.05);
console.log(`40FR: maxL=${fr40Eff.maxL.toFixed(3)}, maxW=${fr40Eff.maxW.toFixed(3)}`);
