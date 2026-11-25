// 生成「多件同规格」合成夹具：用于批量/层铺策略的回归场景。
// ⚠️ 数据全部为合成值（爹地 2026-11-25 定：真实业务数据不入库）。
// 需要跑真实单的取证脚本请用本地夹具 ~/.hermes/private/cls-fixtures/，不要往这里塞。
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();

const rows = [
  ['Item', 'Description', 'Net', 'Gross', 'L', 'W', 'H', 'VoL', 'PackageType', 'Remark'],
];

// 储罐 H ×20（小件标准箱，测同规格批量层铺）
for (let i = 0; i < 20; i++) {
  rows.push([8, '储罐 H Storage Tank H', 400, 550, 2100, 800, 800, 1.34, 'U型架 U-Type Frame', 'Sample']);
}
// 传动轴 I ×10
for (let i = 0; i < 10; i++) {
  rows.push([11, '传动轴 I Drive Shaft I', 500, 600, 3000, 1200, 1300, 4.68, 'U型架 U-Type Frame', 'Sample']);
}
// 输送泵 J ×10
for (let i = 0; i < 10; i++) {
  rows.push([12, '输送泵 J Transfer Pump J', 480, 950, 2700, 1400, 1400, 5.29, '铁框架 Iron Frame', 'Sample']);
}
// 缓冲桶 K ×15
for (let i = 0; i < 15; i++) {
  rows.push([13, '缓冲桶 K Buffer Vessel K', 300, 800, 1700, 1600, 1100, 2.99, '铁框架 Iron Frame', 'Sample']);
}
// 钢结构模块 D ×8
for (let i = 0; i < 8; i++) {
  rows.push([4, '钢结构模块 D Steel Module D', 1900, 2200, 3500, 1400, 1800, 8.82, '铁框架 Iron Frame', 'Sample']);
}

const ws = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(wb, ws, 'PackingList');
XLSX.writeFile(wb, 'test-packing-list-bulk.xlsx');
console.log('Created test-packing-list-bulk.xlsx with', rows.length - 1, 'synthetic items');
