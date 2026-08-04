const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();

// 非超限批量测试：选取中小件货物并增加数量
const rows = [
  ['Item', 'Description', 'Net', 'Gross', 'L', 'W', 'H', 'VoL', 'PackageType', 'Remark'],
];

// 进料罐 ×20
for (let i = 0; i < 20; i++) {
  rows.push([8, '进料罐 Feed Tank', 450, 610, 2200, 820, 820, 1.48, 'U型架 U-Type Frame', 'Estimated']);
}
// 中心轴 ×10
for (let i = 0; i < 10; i++) {
  rows.push([11, '中心轴 Torque Tube', 550, 650, 3100, 1240, 1360, 5.23, 'U型架 U-Type Frame', 'Estimated']);
}
// 强制稀释 ×10
for (let i = 0; i < 10; i++) {
  rows.push([12, '强制稀释 Dilution Pump', 550, 1100, 2800, 1400, 1410, 5.53, '铁框架 Iron Frame', 'Estimated']);
}
// 稳流桶 ×15
for (let i = 0; i < 15; i++) {
  rows.push([13, '稳流桶 Feedwell', 350, 945, 1800, 1650, 1110, 3.30, '铁框架 Iron Frame', 'Estimated']);
}
// 池体板框架 ×8
for (let i = 0; i < 8; i++) {
  rows.push([4, '池体板框架 Cell Plate Frame', 3960, 4270, 3600, 1400, 1950, 9.83, '铁框架 Iron Frame', 'Final']);
}

const ws = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(wb, ws, 'PackingList');
XLSX.writeFile(wb, 'test-packing-list-bulk.xlsx');
console.log('Created test-packing-list-bulk.xlsx with', rows.length - 1, 'items');
