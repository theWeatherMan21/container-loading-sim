global.window = global;
global.document = { createElement: () => ({ innerHTML: '' }) };
global.XLSX = require('../vendor/xlsx.full.min.js');

require('../container-db.js');
require('../field-parser.js');
require('../packing-engine.js');

const CDB = global.ContainerDB;
const FP = global.FieldParser;

const fs = require('fs');
const filePath = '土耳其货物明细(1).xlsx';
const buffer = fs.readFileSync(filePath);

const parseResult = FP.parseFile(buffer, filePath);
console.log('parseResult keys:', Object.keys(parseResult));
console.log('parseResult:', JSON.stringify(parseResult, null, 2).slice(0, 500));
const items = parseResult.items;

console.log('Items:', items ? items.length : 'undefined');
console.log('Unit:', parseResult.dimUnit);

const rec = CDB.autoRecommend(items, 0.05);
console.log('\nRecommendation:', JSON.stringify({
  type: rec.type,
  primary: rec.primary ? rec.primary.code : null,
  mixedCount: rec.mixed ? rec.mixed.specs.length : 0,
  reasoning: rec.reasoning,
  description: rec.mixed ? rec.mixed.description : null
}, null, 2));

// Classify each item
items.forEach(item => {
  const cls = CDB.classifyItemByContainerType(item, 0.05);
  console.log(`Item ${item.model}: ${cls} (${item.l}×${item.w}×${item.h}, ${item.weight}kg)`);
});