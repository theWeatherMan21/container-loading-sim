/**
 * 集装箱数据库 & 约束校验引擎
 * 所有尺寸单位为米(m)，重量单位为千克(kg)
 */

const CONTAINER_DB = {
  // ═══ 标准柜 (Standard) ═══
  '20GP': {
    code: '20GP', name: '20尺标准柜', nameCN: '20尺普柜',
    L: 5.900, W: 2.352, H: 2.393,
    doorW: 2.340, doorH: 2.292,
    // 修正(2026-08-06)：ISO 668 规定 20' 最大总重 30480kg，钢质普柜自重 ≥2200kg → payload ≤~28300；
    // 取 28200（参考 Hapag-Lloyd 20GP 28230kg 口径，略保守）
    payload: 28200,
    volume: 33.2,
    type: 'standard',
    allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  },
  '40HQ': {
    code: '40HQ', name: '40尺高柜', nameCN: '40尺高柜',
    L: 12.032, W: 2.352, H: 2.700,
    doorW: 2.340, doorH: 2.597,
    payload: 28650,
    volume: 76.3,
    type: 'standard',
    allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  },
  '40GP': {
    code: '40GP', name: '40尺普柜', nameCN: '40尺普柜',
    L: 12.032, W: 2.352, H: 2.395,
    doorW: 2.340, doorH: 2.292,
    payload: 28800,
    volume: 67.7,
    type: 'standard',
    allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  },
  '45HQ': {
    code: '45HQ', name: '45尺高柜', nameCN: '45尺高柜',
    L: 13.556, W: 2.352, H: 2.700,
    doorW: 2.340, doorH: 2.597,
    payload: 27800,
    volume: 86.0,
    type: 'standard',
    allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  },

  // ═══ 开顶柜 (Open Top) ═══
  '20OT': {
    code: '20OT', name: '20尺开顶柜', nameCN: '20尺开顶',
    L: 5.895, W: 2.350, H: 2.380,
    doorW: 2.338, doorH: Infinity,
    // 修正(2026-08-06)：20' 最大总重 30480kg，开顶柜自重（含可拆顶弓/篷布）> 普柜 → payload ≤~28100
    payload: 28100,
    volume: 32.5,
    type: 'openTop',
    allowOverHeight: true, maxOverHeight: 0.5,
    allowOverWidth: false, allowOverLength: false
  },
  '40OT': {
    code: '40OT', name: '40尺开顶柜', nameCN: '40尺开顶',
    L: 12.029, W: 2.352, H: 2.683,
    doorW: 2.338, doorH: Infinity,
    payload: 28250,
    volume: 74.9,
    type: 'openTop',
    allowOverHeight: true, maxOverHeight: 0.5,
    allowOverWidth: false, allowOverLength: false
  },

  // ═══ 框架柜 (Flat Rack) ═══
  '20FR': {
    code: '20FR', name: '20尺框架柜', nameCN: '20尺框架',
    L: 5.612, W: 2.227, H: 2.219,
    doorW: Infinity, doorH: Infinity,
    // 2026-10-15（爹地拍板）：载重取官方值（Hapag-Lloyd 规格表）——payload 31,260kg。
    // （历史：旧版曾按 20' 常规总重口径保守取 27,500kg，现统一以官方框架柜规格为准。）
    payload: 31260,
    volume: 5.612 * 2.227 * 2.219,
    type: 'flatRack',
    // 2026-10-13 业务口径（爹地）：FR 系列不设尺寸限制，不再有超限预算口径。allowOver* 保留为语义标记。
    allowOverHeight: true,
    allowOverWidth: true,
    allowOverLength: true
  },
  '40FR': {
    code: '40FR', name: '40尺框架柜', nameCN: '40尺框架',
    L: 11.652, W: 2.224, H: 2.248,
    doorW: Infinity, doorH: Infinity,
    // 2026-10-15（爹地拍板）：载重取官方值（Hapag-Lloyd 规格表）——payload 44,050kg。
    // （历史：旧版曾按 45t 总重−自重保守取 39,600kg，现统一以官方框架柜规格为准。）
    payload: 44050,
    volume: 11.652 * 2.224 * 2.248,
    type: 'flatRack',
    // 2026-10-13 业务口径（爹地）：FR 系列不设尺寸限制，不再有超限预算口径。allowOver* 保留为语义标记。
    allowOverHeight: true,
    allowOverWidth: true,
    allowOverLength: true
  }
};

/**
 * 箱型说明（尺寸/载重以 Hapag-Lloyd Container Specification 为准）：
 * - 标准柜 (standard)：20GP/40GP/40HQ/45HQ — 有门约束，不允许超限
 * - 开顶柜 (openTop)：20OT/40OT — 门高=∞（吊装），门宽约束有效，允许超高0.5m（40OT 为 9'6" 高柜规格）
 * - 框架柜 (flatRack)：20FR/40FR — 无门无侧壁；2026-10-13 业务口径（爹地）：**不设尺寸限制**，
 *   货物可装性由物理底线判定（贴角放置地板覆盖率 ≥ 50%；不与已放货物重叠），详见 frFloorFeasible()。
 */

const CONTAINER_LIST = Object.values(CONTAINER_DB);

/**
 * 2026-10-13 业务口径变更（爹地）：**FR 系列不再设置任何尺寸限制**——原“超限预算”
 * （超长 0.5 / 超宽 2.0 / 超高 1.0）整体废除，不再参与任何拦截。
 *
 * FR 货物可装性改由两条物理底线判定（与装载引擎放置路径同口径）：
 *   ① 贴角放置时，货物底面投影与地板的覆盖率 ≥ FR_MIN_FLOOR_RATIO（50%）；
 *   ② 放置后不得与已放货物在空间上重叠（引擎放置路径的碰撞检查）。
 * 判定实现见 frFloorFeasible() / frOrientationFloorRatio()。
 */
const FR_MIN_FLOOR_RATIO = 0.5; // FR 地板最低覆盖率（单一来源；packing-engine 同引此值）

// FR 有效尺寸“包络”哨兵值（纯数值护栏，防 Infinity 参与下游运算产生 NaN/死循环；
// 非业务限制——可装性由上述物理底线判定，此值不对任何现实货物构成约束）。
const FR_FREE_DIM = 1e3;

// FR 长度限定（2026-10-15 爹地口径）：
//   ① 分层：货物最长边 ≤ 20FR 柱间长 → 20FR；超过 → 40FR；
//      超过 40FR 柱间长 + 伸出容限 → 警告「无法装载该货物」；
//   ② 平放：竖立边（朝向的 h）不得超过箱内长——最长边必须水平放置，禁止“竖放塞小箱”。
const FR_OVERHANG_ALLOWANCE_M = 2.0; // 40FR 伸出容限（超出柱间长、允许贴端伸出的部分，单位 m）

/**
 * 获取单件货物对某箱型的有效尺寸上限
 * @param {object} container - 箱型规格
 * @param {number} tolerance - 操作间隙(m)，默认0.05(5cm)
 * @returns {{maxL, maxW, maxH}} 允许的最大尺寸
 */
function getEffectiveMaxDims(container, tolerance = 0.05) {
  const t = tolerance;

  // 2026-10-13 口径：FR 不设尺寸限制——有效尺寸返回放开包络（数值护栏 FR_FREE_DIM，非业务限制）。
  // 可装性由物理底线判定：frFloorFeasible()（分类/推荐层）与引擎放置路径（贴角+地板覆盖率+碰撞检查）。
  if (container.type === 'flatRack') {
    return {
      maxL: FR_FREE_DIM,
      maxW: FR_FREE_DIM,
      maxH: FR_FREE_DIM
    };
  }

  return {
    maxL: container.L - t + (container.allowOverLength ? container.maxOverLength : 0),
    maxW: container.W - t + (container.allowOverWidth ? container.maxOverWidth : 0),
    maxH: container.H - t + (container.allowOverHeight ? container.maxOverHeight : 0)
  };
}

/**
 * FR 朝向级地板覆盖率（贴角放置近似）：
 * 货物以朝向 o 贴箱角放置时，底面投影与 FR 地板的重合比例
 * = min(l, L)/l × min(w, W)/w（与 packing-engine 的 calcFloorOverlapRatio
 * 在贴角场景下的取值一致；阈值同为 FR_MIN_FLOOR_RATIO，单一来源）。
 */
function frOrientationFloorRatio(o, container) {
  const L = container.L, W = container.W;
  if (!(o.l > 0) || !(o.w > 0)) return 0;
  return (Math.min(o.l, L) / o.l) * (Math.min(o.w, W) / o.w);
}

/** FR 装载长度上限（含伸出容限）：20FR = 柱间长；40FR = 柱间长 + FR_OVERHANG_ALLOWANCE_M。 */
function frLengthLimit(container) {
  if (!container || container.type !== 'flatRack') return Infinity;
  return container.L + (container.code === '40FR' ? FR_OVERHANG_ALLOWANCE_M : 0);
}

/** FR 朝向有效性（2026-10-15 口径）：竖立边 ≤ 箱内长（禁竖放）且贴角地板覆盖率 ≥ 阈值。 */
function frOrientationValid(o, container) {
  if (o.h > container.L + 1e-9) return false;
  return frOrientationFloorRatio(o, container) >= FR_MIN_FLOOR_RATIO;
}

/**
 * FR 单件可装性（2026-10-13 口径：不设尺寸限制）：
 * 6 个朝向下存在一角，使贴角放置的地板覆盖率 ≥ FR_MIN_FLOOR_RATIO 即可装。
 * 与装载引擎的一致性：引擎放置路径对 FR 跳过空间盒尺寸检查，以
 * 「贴角 + 实际地板覆盖率 + 碰撞检查」为实际判据；本函数是其单件近似
 * （不考虑与已放货物的互斥，供分类/推荐层做可行性判定）。
 */
function frFloorFeasible(item, container) {
  if (!container || container.type !== 'flatRack') return true;
  const lmax = Math.max(item.l, item.w, item.h);
  if (lmax > frLengthLimit(container) + 1e-9) return false; // 2026-10-15：超装载上限（含伸出容限）
  return getOrientations(item).some(o => frOrientationValid(o, container));
}

/**
 * 检查单件货物在 6 个旋转方向中是否有至少一个能装入给定有效尺寸
 * @param {object} item - {l, w, h}
 * @param {object} eff - {maxL, maxW, maxH}
 * @returns {boolean}
 */
function fitsByRotation(item, eff) {
  return getOrientations(item).some(o =>
    o.l <= eff.maxL && o.w <= eff.maxW && o.h <= eff.maxH
  );
}

/**
 * 检查单件货物的尺寸是否超出箱型允许范围
 * @param {object} item - {l, w, h} 单位m
 * @param {object} container - 箱型规格
 * @param {number} tolerance - 操作间隙
 * @returns {{pass: boolean, reasons: string[]}}
 */
function checkSizeConstraints(item, container, tolerance = 0.05) {
  const reasons = [];
  const eff = getEffectiveMaxDims(container, tolerance);

  // C-04 修复(2026-08-06)：与 checkDoorConstraint 的 orientationFixed 分支口径一致 ——
  // orientationFixed=true（禁倒置）时仅检查两个水平旋转朝向 {l,w,h} 与 {w,l,h}，不检查倒置方向；
  // false/未定义时走 getOrientations 全部 6 方向（含去重），保证 validateItem 调用链上尺寸与门约束使用同一朝向集合。
  const orientations = item.orientationFixed
    ? [{ l: item.l, w: item.w, h: item.h }, { l: item.w, w: item.l, h: item.h }]
    : getOrientations(item);

  let anyFit = false;
  for (const o of orientations) {
    if (o.l <= eff.maxL && o.w <= eff.maxW && o.h <= eff.maxH) {
      anyFit = true;
      break;
    }
  }

  if (!anyFit) {
    const dims = `${item.l.toFixed(3)}×${item.w.toFixed(3)}×${item.h.toFixed(3)}m`;
    const orientationDesc = item.orientationFixed ? '2个水平旋转朝向' : '全部朝向';
    reasons.push(
      `货物尺寸 ${dims} 无法在${orientationDesc}中匹配 ${container.code} ` +
      `可用尺寸范围(长≤${eff.maxL.toFixed(3)}m, 宽≤${eff.maxW.toFixed(3)}m, 高≤${eff.maxH.toFixed(3)}m)`
    );
  }

  return { pass: anyFit, reasons };
}

/**
 * 门截面约束校验
 * 检查货物是否存在一个朝向能通过集装箱门（截面 ≤ doorW × doorH）
 * 仅对标准柜和开顶柜生效；开顶柜仅检查宽度约束（高度由吊装解决），框架柜自动通过
 * @param {object} item - {l, w, h}
 * @param {object} container - 箱型规格
 * @param {number} tolerance
 * @returns {{pass: boolean, reasons: string[]}}
 */
function checkDoorConstraint(item, container, tolerance = 0.05) {
  const reasons = [];
  const effDoorW = container.doorW - tolerance;
  const effDoorH = container.doorH - tolerance;

  // 框架柜无门约束（两侧均可进），OT 仅跳过高度约束
  if (container.type === 'flatRack') {
    return { pass: true, reasons };
  }
  if (container.type === 'openTop') {
    // OT 顶部吊装只放宽门高；但实际进入方向仍必须满足门宽，且必须尊重朝向限制。
    const otPass = getOrientations(item).some(o => o.w <= effDoorW + tolerance);
    if (otPass) return { pass: true, reasons };
    return { pass: false, reasons: [`货物任一允许朝向的门宽均超过 OT 门宽 ${effDoorW.toFixed(3)}m`] };
  }

  // 货物通过箱门时，允许绕Z轴水平转向，但不允许倒置；门框截面为货物的宽×高。
  const orientations = item.orientationFixed
    ? [{ l: item.l, w: item.w, h: item.h }, { l: item.w, w: item.l, h: item.h }]
    : getOrientations(item);
  const doorPass = orientations.some(o => o.w <= effDoorW + tolerance && o.h <= effDoorH + tolerance);
  if (doorPass) return { pass: true, reasons };
  reasons.push(`货物任一允许进入截面均无法通过箱门(门宽${effDoorW.toFixed(3)}m×门高${effDoorH.toFixed(3)}m)`);
  return { pass: false, reasons };
}

/**
 * 重量约束校验
 * @param {number} totalWeight - 已装载总重量 kg
 * @param {number} itemWeight - 单件货物重量 kg
 * @param {object} container
 * @returns {{pass: boolean, reasons: string[]}}
 */
function checkWeightConstraint(totalWeight, itemWeight, container) {
  const reasons = [];
  const newTotal = totalWeight + itemWeight;
  if (newTotal > container.payload) {
    reasons.push(
      `累计重量${(newTotal).toFixed(0)}kg 超出 ${container.code} 最大载重${container.payload}kg`
    );
    return { pass: false, reasons };
  }
  return { pass: true, reasons };
}

/**
 * 叠放约束：检查货物是否可以被叠放（顶部放东西）
 * @param {object} item - 含 stackable 字段
 * @returns {boolean} true=可以被叠
 */
function isStackable(item) {
  return item.stackable !== false;
}

/**
 * 获取货物的可选方向列表
 * @param {object} item - {l, w, h, orientationFixed}
 * @returns {Array<{l, w, h}>}
 */
function getOrientations(item) {
  const { l, w, h, orientationFixed } = item;
  if (orientationFixed) {
    // 仅水平旋转（绕Z轴）
    return [
      { l, w, h },
      { l: w, w: l, h }
    ];
  }
  // 全部6种方向
  return [
    { l, w, h },
    { l, w: h, h: w },
    { l: w, w: l, h },
    { l: w, w: h, h: l },
    { l: h, w: l, h: w },
    { l: h, w: w, h: l }
  ].filter((o, i, arr) => {
    // 去重
    return arr.findIndex(x => x.l === o.l && x.w === o.w && x.h === o.h) === i;
  });
}

/**
 * 完整的单件约束校验管道
 * 所有校验同时运行，收集全部失败原因
 * @param {object} item - {l, w, h, weight, stackable, orientationFixed, model}
 * @param {object} container
 * @param {number} currentTotalWeight
 * @param {number} tolerance
 * @returns {{pass: boolean, reasons: string[], failures: string[]}}
 */
function validateItem(item, container, currentTotalWeight = 0, tolerance = 0.05) {
  const allReasons = [];
  let pass = true;

  // 1. 尺寸约束
  const sizeResult = checkSizeConstraints(item, container, tolerance);
  if (!sizeResult.pass) { pass = false; allReasons.push(...sizeResult.reasons); }

  // 2. 门约束
  const doorResult = checkDoorConstraint(item, container, tolerance);
  if (!doorResult.pass) { pass = false; allReasons.push(...doorResult.reasons); }

  // 3. 重量约束 (每次放置时动态检查，此处仅检查单件是否超payload)
  if (item.weight > container.payload) {
    pass = false;
    allReasons.push(`${item.model || '货物'} 单件重${item.weight}kg 超过 ${container.code} 最大载重${container.payload}kg`);
  }

  return { pass, reasons: allReasons };
}

/**
 * FR 超长标记（2026-10-13 口径：FR 不设尺寸限制后，本函数不再参与任何拦截，
 * 仅保留“超长货”标记供 3D 标注与提示使用）。
 * @param {object} item - {l, w, h}
 * @returns {{frAllowed: boolean, overLength: boolean, rotated: boolean, reason: string}}
 */
function checkFRLengthRule(item) {
  const fr20 = CONTAINER_DB['20FR'];
  const fr40 = CONTAINER_DB['40FR'];
  const lmax = Math.max(item.l, item.w, item.h);

  if (lmax > frLengthLimit(fr40) + 1e-9) {
    return {
      frAllowed: false, overLength: true, rotated: false, tier: 'none',
      reason: `最长边 ${lmax.toFixed(2)}m 超出框架柜装载上限（40FR 柱间长 ${fr40.L}m + 伸出容限 ${FR_OVERHANG_ALLOWANCE_M}m），无法装载该货物`
    };
  }
  if (lmax > fr20.L + 1e-9) {
    return {
      frAllowed: true, overLength: true, rotated: false, tier: '40FR',
      reason: `最长边 ${lmax.toFixed(2)}m 超出 20FR 柱间长 ${fr20.L}m，需 40FR${lmax > fr40.L + 1e-9 ? '（贴端伸出装载）' : ''}`
    };
  }
  return { frAllowed: true, overLength: false, rotated: false, tier: '20FR', reason: '' };
}

function hasValidOrientationForContainer(item, container, tolerance = 0.05) {
  const eff = getEffectiveMaxDims(container, tolerance);
  const effDoorW = container.doorW - tolerance;
  const effDoorH = container.doorH - tolerance;

  // D-08 修复(2026-08-06)：同一候选朝向必须同时满足「尺寸 fit」与「门可通过」，
  // 不再对内层 checkDoorConstraint 传入展开后朝向导致其重新展开 6 向（两套独立存在性 → 门过不去的货被误判可装）。
  // 门截面直接取该候选朝向自身的 w×h（与 checkDoorConstraint 的容差公式一致：w ≤ doorW−t+t = doorW）。
  return getOrientations(item).some(o => {
    if (container.type === 'flatRack') {
      // 2026-10-15 口径：长度限定（最长边 ≤ 柱间长+伸出容限）+ 平放限定（竖立边 ≤ 箱内长）+ 地板覆盖率。
      const lmax = Math.max(item.l, item.w, item.h);
      if (lmax > frLengthLimit(container) + 1e-9) return false;
      return frOrientationValid(o, container);
    }
    if (o.l > eff.maxL || o.w > eff.maxW || o.h > eff.maxH) return false;
    if (container.type === 'openTop') {
      // 开顶柜仅门宽约束（高度由吊装解决）
      return o.w <= effDoorW + tolerance;
    }
    return o.w <= effDoorW + tolerance && o.h <= effDoorH + tolerance;
  });
}

function getAvailableContainerTypes(item, containers, tolerance = 0.05) {
  return containers.filter(container => hasValidOrientationForContainer(item, container, tolerance));
}

/**
 * 判断单件货物最低要求的箱型类别（按经济优先级）
 * @param {object} item - {l, w, h, weight}
 * @param {number} tolerance
 * @returns {'20GP'|'40HQ'|'OT'|'FR'|'none'} 最低要求箱型类别
 */
function classifyItemByContainerType(item, tolerance = 0.05) {
  const gp20 = CONTAINER_DB['20GP'];
  const hq40 = CONTAINER_DB['40HQ'];
  const fr40 = CONTAINER_DB['40FR'];

  // 超长优先：任一边超过 40FR 内长，直接按 FR 规则判定（用户要求“仅长超则优先考虑 FR”）
  const hasOverLengthDim = item.l > fr40.L || item.w > fr40.L || item.h > fr40.L;

  if (!hasOverLengthDim) {
    // 1. 检查能否通过20GP门并fit有效尺寸
    const gp20Door = checkDoorConstraint(item, gp20, tolerance);
    if (gp20Door.pass) {
      if (hasValidOrientationForContainer(item, gp20, tolerance)) return '20GP';
    }

    // 2. 检查能否通过40HQ门（标准柜/高柜通用门截面）
    const hq40Door = checkDoorConstraint(item, hq40, tolerance);
    if (hq40Door.pass) {
      if (hasValidOrientationForContainer(item, hq40, tolerance)) return '40HQ';
    }

    // 3. 检查能否通过OT门（仅宽度约束）并fit有效尺寸
    const ot20 = CONTAINER_DB['20OT'];
    const ot40 = CONTAINER_DB['40OT'];
    const ot20Door = checkDoorConstraint(item, ot20, tolerance);
    const ot40Door = checkDoorConstraint(item, ot40, tolerance);
    if (ot20Door.pass || ot40Door.pass) {
      if (hasValidOrientationForContainer(item, ot20, tolerance) ||
          hasValidOrientationForContainer(item, ot40, tolerance)) return 'OT';
    }
  }

  // 4. 检查框架柜（无门约束；2026-10-15 口径：长度限定 + 平放限定 + 地板覆盖率）
  const frRule = checkFRLengthRule(item);

  if (frRule.frAllowed && frFloorFeasible(item, fr40)) {
    item._frOverLength = frRule.overLength;
    item._frRotated = frRule.rotated;
    return 'FR';
  }

  return 'none';
}

// 调试用：打印40FR有效尺寸
// console.log('40FR effective dims:', getEffectiveMaxDims(CONTAINER_DB['40FR'], 0.05));

/**
 * 箱型自动推荐决策树（尺寸优先+分项检测）
 * @param {Array} items - 所有货物
 * @param {number} tolerance
 * @returns {{ primary: object, alternatives: object[], reasoning: string }|null}
 */
function recommendContainer(items, tolerance = 0.05) {
  if (!items || items.length === 0) return null;

  const totalWeight = items.reduce((sum, i) => sum + i.weight * (i.quantity || 1), 0);
  const totalVolume = items.reduce((s, i) => s + i.l * i.w * i.h * (i.quantity || 1), 0);

  // 检查单件超重
  const maxItemWeight = Math.max(...items.map(i => i.weight));
  const maxPayload = Math.max(...CONTAINER_LIST.map(c => c.payload));
  if (maxItemWeight > maxPayload) {
    return { needsMixed: true, reason: '单件重量超出所有箱型载重上限，无法装入任何单箱——需拆件或特种运输' };
  }

  // 逐件分类
  const classifications = items.map(item => classifyItemByContainerType(item, tolerance));

  // 无法装载的货物：2026-10-15 口径——给出明确警告原因（超长上限/地板支撑不足），不静默
  const noneIdx = classifications.findIndex(c => c === 'none');
  if (noneIdx >= 0) {
    const noneItem = items[noneIdx];
    const frRule = checkFRLengthRule(noneItem);
    const lmax = Math.max(noneItem.l, noneItem.w, noneItem.h);
    const reason = !frRule.frAllowed
      ? `⚠️ 无法装载该货物：「${noneItem.model || '货物'}」${frRule.reason}`
      : `⚠️ 无法装载该货物：「${noneItem.model || '货物'}」最长边 ${lmax.toFixed(2)}m，尺寸超出可用箱型或框架柜地板支撑不足`;
    return { needsMixed: true, reason };
  }

  const gp20 = CONTAINER_DB['20GP'];
  const hq40 = CONTAINER_DB['40HQ'];
  const hq45 = CONTAINER_DB['45HQ'];
  const ot20 = CONTAINER_DB['20OT'];
  const ot40 = CONTAINER_DB['40OT'];

  // 汇总最低要求箱型
  // 2026-10-13（审阅 P1-1）：单件重量超过全部普柜载重的货同样需要框架柜
  // （尺寸标准但重量上不去普柜，如 30t 机械件 → 40FR），杜绝“20GP×N”类不可行方案。
  const standardMaxPayload = Math.max(gp20.payload, hq40.payload, hq45.payload);
  const singleTooHeavyForStandard = items.some(i => i.weight > standardMaxPayload);
  const needsFR = classifications.some(c => c === 'FR') || singleTooHeavyForStandard;
  const needsOT = classifications.some(c => c === 'OT');
  const needs40HQ = classifications.some(c => c === '40HQ');
  const reasoning = [];

  let primary = null;
  let alternatives = [];

  if (needsFR) {
    // 必须用框架柜（2026-10-15 长度限定口径：超 20FR 柱间长 → 40FR；超 40FR 上限 → 警告）
    const fr20 = CONTAINER_DB['20FR'];
    const fr40 = CONTAINER_DB['40FR'];

    const allFit20FR = items.every(item => hasValidOrientationForContainer(item, fr20, tolerance));
    const weightFit20FR = totalWeight <= fr20.payload;

    if (allFit20FR && weightFit20FR) {
      primary = fr20;
      alternatives = [fr40];
      reasoning.push('货物尺寸/单件重量需要框架柜，20FR可装载');
    } else {
      const allFit40FR = items.every(item => hasValidOrientationForContainer(item, fr40, tolerance));
      const weightFit40FR = totalWeight <= fr40.payload;
      if (allFit40FR && weightFit40FR) {
        primary = fr40;
        alternatives = [fr20];
        const lmax = Math.max(...items.map(i => Math.max(i.l, i.w, i.h)));
        if (lmax > fr20.L + 1e-9) {
          reasoning.push(`货物最长边 ${lmax.toFixed(2)}m 超出 20FR 柱间长 ${fr20.L}m，推荐 40FR${lmax > fr40.L + 1e-9 ? '（贴端伸出装载）' : ''}`);
        } else if (items.some(i => i.weight > fr20.payload)) {
          reasoning.push(`单件重量超出 20FR 载重（${fr20.payload}kg），推荐 40FR`);
        } else {
          reasoning.push('货物尺寸/单件重量需要框架柜，40FR可装载');
        }
      } else {
        const lmax = Math.max(...items.map(i => Math.max(i.l, i.w, i.h)));
        if (lmax > frLengthLimit(fr40) + 1e-9) {
          return { needsMixed: true, reason: `⚠️ 无法装载该货物：最长边 ${lmax.toFixed(2)}m 超出框架柜装载上限（40FR 柱间长 ${fr40.L}m + 伸出容限 ${FR_OVERHANG_ALLOWANCE_M}m）` };
        }
        return { needsMixed: true, reason: '单箱框架柜无法装载所有货物，需多箱装载' };
      }
    }
  } else if (needsOT) {
    // 必须用开顶柜
    const ot20Eff = getEffectiveMaxDims(ot20, tolerance);
    const ot40Eff = getEffectiveMaxDims(ot40, tolerance);

    const allFit20OT = items.every(item => hasValidOrientationForContainer(item, ot20, tolerance));
    const weightFit20OT = totalWeight <= ot20.payload;

    if (allFit20OT && weightFit20OT) {
      primary = ot20;
      alternatives = [ot40];
      reasoning.push('货物高度超限需吊装，20OT开顶柜可装载');
    } else {
      const allFit40OT = items.every(item => hasValidOrientationForContainer(item, ot40, tolerance));
      const weightFit40OT = totalWeight <= ot40.payload;
      if (allFit40OT && weightFit40OT) {
        primary = ot40;
        alternatives = [ot20];
        reasoning.push('货物高度/重量超限，40OT开顶柜可装载');
      } else {
        return { needsMixed: true, reason: '单箱开顶柜无法装载所有货物，需多箱装载' };
      }
    }
  } else if (needs40HQ) {
    // 需要40HQ或更大（超出20GP范围但可通过标准门）
    const hq40Eff = getEffectiveMaxDims(hq40, tolerance);
    const allFit40HQ = items.every(item => hasValidOrientationForContainer(item, hq40, tolerance));
    const weightFit40HQ = totalWeight <= hq40.payload;

    if (allFit40HQ && weightFit40HQ) {
      primary = hq40;
      alternatives = [hq45];
      reasoning.push('货物尺寸超出20GP范围，40HQ可装载');
    } else {
      const allFit45HQ = items.every(item => hasValidOrientationForContainer(item, hq45, tolerance));
      const weightFit45HQ = totalWeight <= hq45.payload;
      if (allFit45HQ && weightFit45HQ) {
        primary = hq45;
        alternatives = [hq40];
        reasoning.push('货物尺寸/重量超出40HQ范围，推荐45HQ');
      } else {
        return { needsMixed: true, reason: '货物尺寸无法装入40HQ或45HQ，需改用开顶柜/框架柜或多箱装载' };
      }
    }
  } else {
    // 所有货物都能在20GP范围内
    primary = gp20;
    reasoning.push('货物尺寸在20GP范围内');

    // 估算所需箱数：体积×1.3余量 与 载重 双因子取大
    const estGp20Count = Math.max(
      Math.ceil(totalVolume / gp20.volume * 1.3),
      Math.ceil(totalWeight / gp20.payload)
    );

    if (estGp20Count > 2) {
      alternatives.push(hq40);
      reasoning.push(`预估需${estGp20Count}个20GP，建议对比40HQ`);
    }

    // 20GP 需多箱（≥3）且 40HQ 可显著减少箱数时，直接升级主推
    // （避免"单箱重量过载就推小箱"而忽略体积需要多箱的现实成本）
    if (estGp20Count >= 3) {
      const estHQ40 = Math.max(
        Math.ceil(totalVolume / hq40.volume * 1.3),
        Math.ceil(totalWeight / hq40.payload)
      );
      if (estHQ40 < estGp20Count) {
        primary = hq40;
        alternatives = [gp20, hq45];
        reasoning.push(`体积/重量需${estGp20Count}个20GP，改用40HQ仅需${estHQ40}箱，推荐40HQ`);
      }
    }

    // 检查总重量是否超过20GP载重
    if (totalWeight > gp20.payload) {
      if (totalWeight <= hq40.payload) {
        primary = hq40;
        alternatives = [hq45, gp20];
        reasoning.push(`总重${totalWeight.toFixed(0)}kg超出20GP载重${gp20.payload}kg，推荐40HQ`);
      } else if (totalWeight <= hq45.payload) {
        primary = hq45;
        alternatives = [hq40, gp20];
        reasoning.push(`总重${totalWeight.toFixed(0)}kg超出多数箱型载重，推荐45HQ`);
      } else {
        return { needsMixed: true, reason: `总重${totalWeight.toFixed(0)}kg超出单箱载重，需多箱装载` };
      }
    }
  }

  return {
    primary,
    alternatives,
    reasoning: reasoning.join('；')
  };
}

/**
 * 自动推荐入口（单箱失败时自动尝试混合方案）
 * @param {Array} items - 所有货物
 * @param {number} tolerance
 * @returns {{ type: 'single'|'mixed'|'failed', primary: object|null, mixed: object|null, alternatives: object[], reasoning: string }}
 */
function autoRecommend(items, tolerance = 0.05) {
  // 先尝试单箱推荐
  const singleRec = recommendContainer(items, tolerance);

  if (singleRec && singleRec.primary) {
    return {
      type: 'single',
      primary: singleRec.primary,
      mixed: null,
      alternatives: singleRec.alternatives || [],
      reasoning: singleRec.reasoning
    };
  }

  // 单箱失败（可能是 needsMixed 或其他原因），尝试混合方案
  const mixedRec = recommendMixedContainers(items, tolerance);
  if (mixedRec) {
    const reason = (singleRec && singleRec.reason) ? `${singleRec.reason}，已自动推荐混合方案` : '单箱型无法满足需求，已自动推荐混合方案';
    return {
      type: 'mixed',
      primary: null,
      mixed: mixedRec,
      alternatives: [],
      reasoning: `${reason}：${mixedRec.description}`
    };
  }

  // 全部失败
  return {
    type: 'failed',
    primary: null,
    mixed: null,
    alternatives: [],
    reasoning: (singleRec && singleRec.reason) ? singleRec.reason : '无合适箱型'
  };
}

/**
 * 推荐多箱混合组合（不同箱型组合）
 * @param {Array} items - 所有货物
 * @param {number} tolerance
 * @returns {{ specs: Array, description: string, reasoning: string }|null}
 */
function recommendMixedContainers(items, tolerance = 0.05) {
  const totalVolume = items.reduce((s, i) => s + i.l * i.w * i.h * (i.quantity || 1), 0);
  const totalWeight = items.reduce((s, i) => s + i.weight * (i.quantity || 1), 0);
  const maxItemWeight = Math.max(...items.map(i => i.weight));

  const maxPayload = Math.max(...CONTAINER_LIST.map(c => c.payload));
  if (maxItemWeight > maxPayload) return null;

  // 逐件分类
  const groupStandard = []; // 可通过标准柜门（含冷冻柜门）的货物
  const groupOT = [];       // 只能通过OT门的货物
  const groupFR = [];       // 只能通过框架柜/平板柜的货物
  const noneItems = [];     // 明确无法装载的货物

  // 2026-10-13（审阅 P1-1）：单件重量超过普柜能力（尺寸标准但太重）的货并入 FR 组——
  // 只能依靠框架柜的重载能力装载（如 30t 普通尺寸机械件 → 40FR）。
  const standardMaxPayload = Math.max(
    CONTAINER_DB['20GP'].payload, CONTAINER_DB['40HQ'].payload, CONTAINER_DB['45HQ'].payload
  );
  for (const item of items) {
    const cls = classifyItemByContainerType(item, tolerance);
    if ((cls === '20GP' || cls === '40HQ') && item.weight > standardMaxPayload) {
      groupFR.push(item);
    } else if (cls === '20GP' || cls === '40HQ') {
      groupStandard.push(item);
    } else if (cls === 'OT') {
      groupOT.push(item);
    } else if (cls === 'FR') {
      groupFR.push(item);
    } else if (cls === 'none') {
      noneItems.push(item);
    }
  }

  function calcUnitsForGroup(groupItems, spec) {
    if (!groupItems || groupItems.length === 0) return 0;
    const vol = groupItems.reduce((s, i) => s + i.l * i.w * i.h * (i.quantity || 1), 0);
    const wt = groupItems.reduce((s, i) => s + i.weight * (i.quantity || 1), 0);
    const estByVol = Math.ceil(vol / spec.volume * 1.3);
    const estByWt = Math.ceil(wt / spec.payload);
    return Math.max(1, estByVol, estByWt);
  }

  function pickBestSingleSpec(groupItems, allowedTypes = null) {
    if (!groupItems || groupItems.length === 0) return null;
    const candidates = [];

    const allow = (type) => !allowedTypes || allowedTypes.includes(type);

    if (allow('standard')) {
      // 按尺寸从小到大、载重从低到高依次尝试所有标准柜/冷冻柜
      const standardTypes = ['20GP', '40HQ', '45HQ'];
      for (const code of standardTypes) {
        const spec = CONTAINER_DB[code];
        if (!spec) continue;
        const eff = getEffectiveMaxDims(spec, tolerance);
        if (groupItems.every(item => item.weight <= spec.payload && hasValidOrientationForContainer(item, spec, tolerance))) {
          candidates.push({ spec, units: calcUnitsForGroup(groupItems, spec) });
        }
      }
    }

    if (allow('openTop')) {
      const otTypes = ['20OT', '40OT'];
      for (const code of otTypes) {
        const spec = CONTAINER_DB[code];
        if (!spec) continue;
        const eff = getEffectiveMaxDims(spec, tolerance);
        if (groupItems.every(item => item.weight <= spec.payload && hasValidOrientationForContainer(item, spec, tolerance))) {
          candidates.push({ spec, units: calcUnitsForGroup(groupItems, spec) });
        }
      }
    }

    if (allow('flatRack')) {
      const frTypes = ['20FR', '40FR'];
      for (const code of frTypes) {
        const spec = CONTAINER_DB[code];
        if (!spec) continue;
        const eff = getEffectiveMaxDims(spec, tolerance);
        if (groupItems.every(item => item.weight <= spec.payload && hasValidOrientationForContainer(item, spec, tolerance))) {
          candidates.push({ spec, units: calcUnitsForGroup(groupItems, spec) });
        }
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (a.units !== b.units) return a.units - b.units;
      // 经济优先级：小箱优先，开顶柜次之，框架柜最后
      const priority = {
        '20GP': 1, '40HQ': 2, '45HQ': 3,
        '20OT': 4, '40OT': 5,
        '20FR': 6, '40FR': 7
      };
      return (priority[a.spec.code] || 99) - (priority[b.spec.code] || 99);
    });

    return candidates[0];
  }

  // 构建混合方案
  const comboSpecs = [];
  const parts = [];

  if (groupStandard.length > 0) {
    const best = pickBestSingleSpec(groupStandard, ['standard']);
    if (!best) return null;
    for (let i = 0; i < best.units; i++) comboSpecs.push(best.spec);
    parts.push(`${best.spec.nameCN}×${best.units}`);
  }

  if (groupOT.length > 0) {
    const best = pickBestSingleSpec(groupOT, ['openTop']);
    if (!best) return null;
    for (let i = 0; i < best.units; i++) comboSpecs.push(best.spec);
    parts.push(`${best.spec.nameCN}×${best.units}`);
  }

  if (groupFR.length > 0) {
    const best = pickBestSingleSpec(groupFR, ['flatRack']);
    if (!best) return null;
    for (let i = 0; i < best.units; i++) comboSpecs.push(best.spec);
    parts.push(`${best.spec.nameCN}×${best.units}`);
  }

  if (comboSpecs.length === 0) return null;

  let description = parts.join(' + ');
  if (noneItems.length > 0) {
    description += (description ? '；' : '') + `以下 ${noneItems.length} 件无法装载：${noneItems.map(i => i.model || i.id).join(', ')}`;
  }

  return {
    specs: comboSpecs,
    noneItems,
    description,
    reasoning: `总货物 ${totalVolume.toFixed(1)}m³ / ${totalWeight.toFixed(0)}kg，推荐 ${comboSpecs.length} 箱混合方案`
  };
}

/**
 * 分析箱型推荐失败的原因
 * @param {Array} items - 所有货物
 * @param {number} tolerance
 * @returns {Array<string>} 失败原因列表
 */
function analyzeRecommendationFailure(items, tolerance = 0.05) {
  const reasons = [];
  const totalWeight = items.reduce((s, i) => s + i.weight * (i.quantity || 1), 0);

  // 检查每种箱型的门约束
  for (const spec of CONTAINER_LIST) {
    const failingItems = items.filter(item => !checkDoorConstraint(item, spec, tolerance).pass);
    if (failingItems.length > 0) {
      // C-07 修复：原实现分别取各维最大值拼出"假尺寸"（可能对应不同货物，诊断失真）。
      // 改为取失败件中最大单件（按最长边降序）的真实三维，保证信息对应实际货物。
      const worst = [...failingItems].sort((a, b) =>
        Math.max(b.l, b.w, b.h) - Math.max(a.l, a.w, a.h)
      )[0];
      reasons.push(
        `${spec.nameCN}: 货物 "${worst.model || '未知'}" 尺寸 ${worst.l.toFixed(2)}×${worst.w.toFixed(2)}×${worst.h.toFixed(2)}m ` +
        `（共 ${failingItems.length} 件不满足）超过门约束 ` +
        `${spec.doorW.toFixed(2)}×${spec.doorH === Infinity ? '∞' : spec.doorH.toFixed(2)}m`
      );
    }
  }

  // 检查总重量
  const maxPayload = Math.max(...CONTAINER_LIST.map(s => s.payload));
  if (totalWeight > maxPayload) {
    reasons.push(`总重量 ${totalWeight.toFixed(0)}kg 超过单箱最大载重 ${maxPayload}kg`);
  }

  return reasons;
}

// 箱型分级映射（尾组合并 Q2 分级门控 · 单一来源）：
// 数值越小越优先作为合并目标——普通干货箱在最前，特种箱按开顶→框架顺序兜底。
// 键值与 CONTAINER_DB 中 type 字段严格对齐（'standard'|'openTop'|'flatRack'）。
const TIER = { standard: 0, openTop: 1, flatRack: 2 };

// 导出为全局
window.ContainerDB = {
  CONTAINER_DB,
  CONTAINER_LIST,
  TIER,
  getEffectiveMaxDims,
  frFloorFeasible,
  frLengthLimit,
  frOrientationValid,
  FR_MIN_FLOOR_RATIO,
  FR_OVERHANG_ALLOWANCE_M,
  checkSizeConstraints,
  checkDoorConstraint,
  checkWeightConstraint,
  isStackable,
  getOrientations,
  fitsByRotation,
  hasValidOrientationForContainer,
  getAvailableContainerTypes,
  validateItem,
  classifyItemByContainerType,
  recommendContainer,
  recommendMixedContainers,
  analyzeRecommendationFailure,
  autoRecommend
};