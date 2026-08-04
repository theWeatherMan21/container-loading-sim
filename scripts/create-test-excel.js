const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
const data = [
  ['Item', 'Description', 'Net', 'Gross', 'L', 'W', 'H', 'VoL', 'PackageType', 'Remark'],
  [1, '小件PC箱 Small parts box', 8774, 10800, 6030, 2210, 2120, 28.25, '铁箱 Iron Box', 'Final'],
  [2, '池体板框架 Cell Plate Frame', 5700, 6540, 5400, 2050, 2200, 24.35, '铁框架 Iron Frame', 'Final'],
  [3, '池体板框架 Cell Plate Frame', 3220, 3590, 4700, 1300, 2150, 13.14, '铁框架 Iron Frame', 'Final'],
  [4, '池体板框架 Cell Plate Frame', 3960, 4270, 3600, 1400, 1950, 9.83, '铁框架 Iron Frame', 'Final'],
  [5, '池底板托盘 Cell Base Plate Tray', 4815, 5275, 5500, 1750, 1000, 9.63, '铁托盘 Iron Tray', 'Final'],
  [6, '放射梁 Radial Beam', 6968, 7394, 6830, 2100, 1130, 16.21, 'U型架 U-Type Frame', 'Final'],
  [7, '锥体 Cone', 1380, 2020, 2500, 2200, 2500, 13.75, '铁框架 Iron Frame', 'Final'],
  [8, '进料罐 Feed Tank', 450, 610, 2200, 820, 820, 1.48, 'U型架 U-Type Frame', 'Estimated'],
  [9, '桥架1 Bridge 1', 2066, 2306, 4500, 2200, 1540, 15.25, '裸装 Bulk', 'Estimated'],
  [10, '桥架2 Bridge 2', 5852, 6212, 11980, 2200, 1540, 40.59, '裸装 Bulk', 'Estimated'],
  [11, '中心轴 Torque Tube', 550, 650, 3100, 1240, 1360, 5.23, 'U型架 U-Type Frame', 'Estimated'],
  [12, '强制稀释 Dilution Pump', 550, 1100, 2800, 1400, 1410, 5.53, '铁框架 Iron Frame', 'Estimated'],
  [13, '稳流桶 Feedwell', 350, 945, 1800, 1650, 1110, 3.30, '铁框架 Iron Frame', 'Estimated'],
  [14, '小件箱2 Small parts box 2', 6884, 8764, 6000, 2200, 2200, 29.04, '铁箱 Iron Box', 'Estimated']
];
const ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, 'PackingList');
XLSX.writeFile(wb, 'test-packing-list.xlsx');
console.log('Created test-packing-list.xlsx');
