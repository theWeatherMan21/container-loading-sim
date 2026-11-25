// 生成「混合规格」合成夹具：覆盖 40HQ / 45HQ / 40FR / 超长拒装 的分档边界。
// ⚠️ 数据全部为合成值（爹地 2026-11-25 定：真实业务数据不入库）。
// 需要跑真实单的取证脚本请用本地夹具 ~/.hermes/private/cls-fixtures/，不要往这里塞。
const XLSX = require('xlsx');
const wb = XLSX.utils.book_new();
const data = [
  ['Item', 'Description', 'Net', 'Gross', 'L', 'W', 'H', 'VoL', 'PackageType', 'Remark'],
  [1, '测试箱 A Test Crate A', 3200, 3800, 4000, 2200, 2100, 18.48, '铁箱 Iron Box', 'Sample'],
  [2, '钢结构模块 B Steel Module B', 2800, 3300, 5000, 2000, 2000, 20.00, '铁框架 Iron Frame', 'Sample'],
  [3, '钢结构模块 C Steel Module C', 1500, 1800, 4200, 1500, 1900, 11.97, '铁框架 Iron Frame', 'Sample'],
  [4, '钢结构模块 D Steel Module D', 1900, 2200, 3500, 1400, 1800, 8.82, '铁框架 Iron Frame', 'Sample'],
  [5, '钢制托盘 E Steel Tray E', 2400, 2700, 5200, 1700, 1000, 8.84, '铁托盘 Iron Tray', 'Sample'],
  [6, '支撑梁 F Support Beam F', 3500, 3800, 6800, 2100, 1100, 15.71, 'U型架 U-Type Frame', 'Sample'],
  [7, '锥形件 G Cone Unit G', 900, 1300, 2400, 2100, 2400, 12.10, '铁框架 Iron Frame', 'Sample'],
  [8, '储罐 H Storage Tank H', 400, 550, 2100, 800, 800, 1.34, 'U型架 U-Type Frame', 'Sample'],
  [9, '桥架 1 Cable Rack 1', 1200, 1400, 4400, 2100, 1500, 13.86, '裸装 Bulk', 'Sample'],
  [10, '桥架 2 Cable Rack 2', 4800, 5200, 11900, 2100, 1500, 37.49, '裸装 Bulk', 'Sample'],
  [11, '传动轴 I Drive Shaft I', 500, 600, 3000, 1200, 1300, 4.68, 'U型架 U-Type Frame', 'Sample'],
  [12, '输送泵 J Transfer Pump J', 480, 950, 2700, 1400, 1400, 5.29, '铁框架 Iron Frame', 'Sample'],
  [13, '缓冲桶 K Buffer Vessel K', 300, 800, 1700, 1600, 1100, 2.99, '铁框架 Iron Frame', 'Sample'],
  [14, '测试箱 L Test Crate L', 3600, 4600, 5900, 2200, 2100, 27.26, '铁箱 Iron Box', 'Sample']
];
const ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, 'PackingList');
XLSX.writeFile(wb, 'test-packing-list.xlsx');
console.log('Created test-packing-list.xlsx with', data.length - 1, 'synthetic items');
