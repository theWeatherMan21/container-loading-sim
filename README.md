<div align="center">

# 智能装箱模拟系统

**Container Loading Simulator**

一个专业级集装箱装载优化系统，支持 **6 种箱型** · **EMS+层铺混合算法** · **3D WebGL 可视化** · **PDF 报告导出**

[![Tauri](https://img.shields.io/badge/Tauri_v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app)
[![Three.js](https://img.shields.io/badge/Three.js-049EF4?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg?style=for-the-badge)](#license)

<br/>

<img src="src-tauri/icons/128x128.png" width="80" alt="App Icon"/>

</div>

---

## 功能亮点

| 能力 | 说明 |
|:---|:---|
| **智能箱型推荐** | 根据货物尺寸/重量/门约束自动推荐最优箱型，支持混合多箱组合 |
| **6 种集装箱** | 20GP · 40HQ · 20OT · 40OT · 20FR · 40FR（含开顶柜/框架柜特殊约束） |
| **EMS+层铺算法** | Empty Maximum Space 空间分割 + 同型号≥10件批量层铺，双策略混合 |
| **3D WebGL 可视化** | Three.js 实时渲染，摄像机预设动画，异常件标签高亮 |
| **自检闭环** | 8 项自动校验（重叠/超界/利用率/重量/门/FR地板/支撑率/四角）→ 自动重算 |
| **智能字段识别** | 三阶段解析：结构探测 → 列语义映射 → 多尺寸消歧，兼容各种装箱单格式 |
| **PDF 报告** | 含 3D 透视截图 + 详细装载清单 + 问题报告 |
| **三主题** | 浅色 / 深色 / 高对比度，莫兰迪配色系统 |

---

## 快速开始

### 方式一：浏览器直接打开

```bash
# 克隆仓库
git clone https://github.com/theWeatherMan21/container-loading-sim.git
cd container-loading-sim

# 启动本地服务器（Three.js ES Module 需要）
python3 -m http.server 8080

# 打开浏览器访问
open http://localhost:8080
```

### 方式二：Tauri 桌面应用

```bash
# 前置：安装 Rust + Node.js 18+
npm install

# 开发模式
npm run dev

# 构建安装包（macOS .dmg / Windows .exe）
npm run build
```

> **macOS 注意**：首次打开 .dmg 可能提示"已损坏"，执行 `xattr -cr /Applications/智能装箱模拟系统.app` 即可。
>
> **Windows 注意**：SmartScreen 可能弹出警告，点击"更多信息" → "仍要运行"。

---

## 使用流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Step 1    │    │   Step 2    │    │   Step 3    │    │   Step 4    │
│             │    │             │    │             │    │             │
│  上传装箱单  │ →  │  确认数据   │ →  │  装箱配置   │ →  │  装箱结果   │
│  或手动录入  │    │  调整映射   │    │  选择箱型   │    │  3D + PDF   │
│             │    │  选择单位   │    │  叠放设置   │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### Step 1 · 上传装箱单

- 支持 `.xlsx` / `.xls` / `.csv`，拖拽或点击上传
- 或手动录入货物（型号、尺寸、数量、重量）
- 自动识别表头行、列语义、尺寸单位

### Step 2 · 确认数据

- 预览解析结果，调整列映射
- 多尺寸同型号自动检测，可选择保留哪些尺寸组
- 支持 mm / cm / m 单位切换

### Step 3 · 装箱配置

- 查看自动推荐箱型（支持混合多箱组合）
- 手动选择或切换箱型
- 设置操作间隙、叠放/翻转约束

### Step 4 · 装箱结果

- 汇总卡片：箱数 · 利用率 · 总重 · 件数
- 3D 交互视图（等距/俯视/正视/侧视预设）
- 异常件高亮（超长/超宽/超高/旋转/禁叠）
- 自检报告（错误/警告/建议）
- 一键导出 PDF

---

## 箱型规格

| 箱型 | 内尺寸 (L×W×H m) | 载重 (kg) | 容积 (m³) | 特殊能力 |
|:---:|:---:|:---:|:---:|:---|
| **20GP** | 5.898 × 2.352 × 2.385 | 28,200 | 33.1 | 标准普柜 |
| **40HQ** | 12.032 × 2.352 × 2.698 | 28,620 | 76.3 | 高柜，门高 2.585m |
| **20OT** | 5.898 × 2.352 × 2.330 | 28,200 | 32.1 | 开顶吊装，可超高 0.5m |
| **40OT** | 12.032 × 2.352 × 2.330 | 26,600 | 65.7 | 开顶吊装，可超高 0.5m |
| **20FR** | 5.700 × 2.360 × 2.240 | 27,150 | 30.0 | 框架柜，可超宽 2.0m / 超长 0.5m |
| **40FR** | 11.700 × 2.370 × 2.280 | 39,300 | 62.5 | 框架柜，可超宽 2.0m / 超高 2.5m / 超长 0.5m |

> 数据来源：BWS (Blue Water Shipping) 标准规格

---

## 算法概述

### EMS + 层铺混合策略

```
                    ┌─────────────────────────────┐
                    │      packSingleContainer     │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  按型号分组 → 同型号 ≥ 10 件？ │
                    └──────┬──────────────┬───────┘
                           │ YES          │ NO
              ┌────────────▼───┐    ┌─────▼──────────┐
              │   layerPack    │    │   emsPlace     │
              │  批量网格铺放   │    │  EMS 空间遍历  │
              │  while 循环刷新 │    │  DBL 评分选优  │
              └────────────────┘    └────────────────┘
                           │                │
                    ┌──────▼────────────────▼───────┐
                    │   buildEMSFromPlaced (空间重建) │
                    └───────────────────────────────┘
```

### 自检机制（8 项）

| # | 检查项 | 触发条件 |
|:---:|:---|:---|
| 1 | 重叠检测 | AABB 3D 碰撞（小规模 O(n²)，大规模空间哈希） |
| 2 | 超界检测 | 货物超出有效容器边界 |
| 3 | 利用率告警 | < 20% 触发重算建议，< 50% 警告 |
| 4 | 重量校验 | 累计重量 ≤ 箱型最大载重 |
| 5 | 门约束检查 | 已放置货物是否能通过箱门截面 |
| 6 | FR 地板投影 | 框架柜货物底面必须与地板有交集 |
| 7 | 支撑率 ≥ 70% | z > 0 的货物底面覆盖支撑面积 |
| 8 | 四角支撑 | z > 0 的货物底面四角必须有支撑 |

---

## 技术架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        index.html (4-step wizard)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ styles.css│  │ app.js   │  │ three-viewer │  │pdf-exporter │  │
│  │ Morandi 3 │  │ 主控制器  │  │ Three.js 3D  │  │ html2canvas │  │
│  │ themes   │  │          │  │ WebGL 引擎   │  │ + jsPDF     │  │
│  └──────────┘  └────┬─────┘  └──────────────┘  └─────────────┘  │
│                     │                                            │
│  ┌──────────────────▼───────────────────────────────────────┐    │
│  │  field-parser.js  →  container-db.js  →  packing-engine  │    │
│  │  智能字段解析         箱型规格/推荐       EMS+层铺算法     │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Tauri Bridge (可选) — Rust 后端 IPC：文件选择/读取/保存   │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 核心依赖

| 用途 | 库 | 版本 |
|:---|:---|:---|
| 3D 渲染 | Three.js + OrbitControls | ES Module |
| Excel 解析 | SheetJS (xlsx) | 0.18.5 |
| PDF 生成 | jsPDF + html2canvas | 1.4.1 |
| 桌面应用 | Tauri | v2 |

---

## 项目结构

```
ContainerLoadingSim/
├── index.html              # 4 步向导 UI
├── styles.css              # 莫兰迪色系设计系统（3 套主题）
├── app.js                  # 主应用控制器
├── field-parser.js         # 智能字段识别引擎
├── container-db.js         # 集装箱数据库 & 约束校验
├── packing-engine.js       # 3D 装箱引擎（EMS + 层铺）
├── three-viewer.js         # Three.js 3D 可视化引擎
├── pdf-exporter.js         # PDF 报告导出
├── tauri-plugin-bridge.js  # Tauri 桌面桥接
├── vendor/                 # 第三方库
│   ├── three.module.js
│   ├── OrbitControls.js
│   ├── xlsx.full.min.js
│   ├── jspdf.umd.min.js
│   └── html2canvas.min.js
├── src-tauri/              # Tauri Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/main.rs
├── scripts/                # 构建脚本
│   └── build-frontend.js
└── docs/                   # 技术文档
    └── container-loading-operation-spec.md
```

---

## 设计系统

采用 **莫兰迪配色**（Morandi Palette），低饱和度灰调，视觉柔和：

| 角色 | 色值 | 用途 |
|:---:|:---:|:---|
| 主背景 | `#F5F0EB` | 页面底色 |
| 卡片背景 | `#FFFFFF` | 内容容器 |
| 主文字 | `#3C3A36` | 标题/正文 |
| 次文字 | `#7A7570` | 说明/备注 |
| 强调色 | `#8FA39B` | 按钮/高亮 |
| 危险色 | `#C97B7B` | 错误/删除 |
| 成功色 | `#7B9A7B` | 完成/通过 |

---

## 桌面应用

基于 [Tauri v2](https://tauri.app) 构建，支持 macOS 和 Windows：

```bash
# macOS 构建
npm run build:mac    # 输出 .dmg 安装包

# Windows 构建（需 Windows 环境或交叉编译）
npm run build:win    # 输出 .exe 安装程序
```

详见 [桌面应用说明](./README-DESKTOP.md)

---

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交变更：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 开启 Pull Request

---

## 许可证

[ISC License](./LICENSE)

---

<div align="center">

**Made by Russo McAllister · MESA Funding LLC**

All Rights Reserved.

</div>
