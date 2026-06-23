/**
 * 集装箱数据库 & 约束校验引擎
 * 所有尺寸单位为米(m)，重量单位为千克(kg)
 */

const CONTAINER_DB = {
  '20GP': {
    code: '20GP', name: '20尺标准柜', nameCN: '20尺普柜',
    L: 5.898, W: 2.352, H: 2.385,
    doorW: 2.340, doorH: 2.280,
    payload: 28200, // kg (BWS: 28,200 kg)
    volume: 5.898 * 2.352 * 2.385, // m³
    type: 'standard',
    allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  },
  '40HQ': {
    code: '40HQ', name: '40尺高柜', nameCN: '40尺高柜',
    L: 12.032, W: 2.352, H: 2.698,
    doorW: 2.340, doorH: 2.585,
    payload: 28620, // kg (BWS: 28,620 kg)
    volume: 12.032 * 2.352 * 2.698,
    type: 'standard',
    allowOverHeight: false, allowOverWidth: false, allowOverLength: false
  },
  '20OT': {
    code: '20OT', name: '20尺开顶柜', nameCN: '20尺开顶',
    L: 5.898, W: 2.352, H: 2.330,
    doorW: 2.290, // BWS: 2.29m (OT门宽略小于标准柜)
    doorH: Infinity, // 开顶柜吊装，高度不约束门截面，宽度仍需通过箱门
    payload: 28200, // kg (BWS: 28,200 kg)
    volume: 5.898 * 2.352 * 2.330,
    type: 'openTop',
    allowOverHeight: true, maxOverHeight: 0.5,
    allowOverWidth: false, allowOverLength: false
  },
  '40OT': {
    code: '40OT', name: '40尺开顶柜', nameCN: '40尺开顶',
    L: 12.032, W: 2.352, H: 2.330,
    doorW: 2.290, // BWS: 2.29m (OT门宽略小于标准柜)
    doorH: Infinity,
    payload: 26600, // kg (BWS: 26,600 kg)
    volume: 12.032 * 2.352 * 2.330,
    type: 'openTop',
    allowOverHeight: true, maxOverHeight: 0.5,
    allowOverWidth: false, allowOverLength: false
  },
  '20FR': {
    code: '20FR', name: '20尺框架柜', nameCN: '20尺框架',
    L: 5.700, // 内长 5.70m（外长 5.97m），货物实际放置在内长范围内
    W: 2.360, // BWS: 2.36m
    H: 2.240, // BWS: 2.24m
    doorW: Infinity, doorH: Infinity, // 框架柜无门限制（从侧面/顶部吊装）
    payload: 27150, // kg (BWS: 27,150 kg)
    volume: 5.700 * 2.360 * 2.240,
    type: 'flatRack',
    allowOverHeight: true, maxOverHeight: 0.5,
    allowOverWidth: true, maxOverWidth: 0.3,
    allowOverLength: true, maxOverLength: 0.5
  },
  '40FR': {
    code: '40FR', name: '40尺框架柜', nameCN: '40尺框架',
    L: 11.700, // 内长 11.70m（外长 12.06m），货物实际放置在内长范围内
    W: 2.370, // BWS: 2.37m
    H: 2.280, // BWS: 2.28m
    doorW: Infinity, doorH: Infinity,
    payload: 39300, // kg (BWS: 39,300 kg)
    volume: 11.700 * 2.370 * 2.280,
    type: 'flatRack',
    allowOverHeight: true, maxOverHeight: 0.5,
    allowOverWidth: true, maxOverWidth: 0.3,
    allowOverLength: true, maxOverLength: 0.5
  }
};

/**
 * FR 箱型说明：
 * - BWS 数据提供外长和内长：20FR 外长 5.97m / 内长 5.70m，40FR 外长 12.06m / 内长 11.70m
 * - 代码中使用内长作为 L 参数，因为货物实际放置在框架内部
 * - 超长货物可超出内长，但需在 allowOverLength 范围内（0.5m）
 */

const CONTAINER_LIST = Object.values(CONTAINER_DB);

/**
 * FR 箱型现实超限上限（经验值）
 * 框架柜虽无顶无侧壁，但超宽/超高/超长仍受道路、船舱、吊具、绑扎限制。
 * 该上限表示：货物在框架柜底板上允许占用的最大包络尺寸。
 */
const FR_REALITY_LIMITS = {
  maxOverLengthTotal: 0.5,   // 前后合计最多超出 0.5m（与 allowOverLength 一致）
  maxOverWidthTotal: 2.0,    // 左右合计最多超出 2m（容纳 4.3m 宽特种货）
  maxOverHeightTotal: 2.5    // 上下合计最多超出 2.5m（容纳 4.36m 高特种货）
};

/**
 * 获取单件货物对某箱型的有效尺寸上限
 * @param {object} container - 箱型规格
 * @param {number} tolerance - 操作间隙(m)，默认0.05(5cm)
 * @returns {{maxL, maxW, maxH}} 允许的最大尺寸
 */
function getEffectiveMaxDims(container, tolerance = 0.05) {
  const t = tolerance;

  // 对FR箱型使用现实超限上限（符合用户指示：默认货物均可运输，但非无限超限）
  if (container.type === 'flatRack') {
    return {
      maxL: container.L + FR_REALITY_LIMITS.maxOverLengthTotal,
      maxW: container.W + FR_REALITY_LIMITS.maxOverWidthTotal,
      maxH: container.H + FR_REALITY_LIMITS.maxOverHeightTotal
    };
  }

  return {
    maxL: container.L - t + (container.allowOverLength ? container.maxOverLength : 0),
    maxW: container.W - t + (container.allowOverWidth ? container.maxOverWidth : 0),
    maxH: container.H - t + (container.allowOverHeight ? container.maxOverHeight : 0)
  };
}

/**
 * 检查单件货物在 6 个旋转方向中是否有至少一个能装入给定有效尺寸
 * @param {object} item - {l, w, h}
 * @param {object} eff - {maxL, maxW, maxH}
 * @returns {boolean}
 */
function fitsByRotation(item, eff) {
  const dims = [item.l, item.w, item.h];
  const orientations = [
    [dims[0], dims[1], dims[2]],
    [dims[0], dims[2], dims[1]],
    [dims[1], dims[0], dims[2]],
    [dims[1], dims[2], dims[0]],
    [dims[2], dims[0], dims[1]],
    [dims[2], dims[1], dims[0]]
  ];
  return orientations.some(o =>
    o[0] <= eff.maxL && o[1] <= eff.maxW && o[2] <= eff.maxH
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

  // 检查：是否存在至少一个方向能使货物放进箱子
  // 对于3D装箱，需要在所有6个方向中至少一个满足
  const orientations = [
    { l: item.l, w: item.w, h: item.h },
    { l: item.l, w: item.h, h: item.w },
    { l: item.w, w: item.l, h: item.h },
    { l: item.w, w: item.h, h: item.l },
    { l: item.h, w: item.l, h: item.w },
    { l: item.h, w: item.w, h: item.l }
  ];

  let anyFit = false;
  for (const o of orientations) {
    if (o.l <= eff.maxL && o.w <= eff.maxW && o.h <= eff.maxH) {
      anyFit = true;
      break;
    }
  }

  if (!anyFit) {
    const dims = `${item.l.toFixed(3)}×${item.w.toFixed(3)}×${item.h.toFixed(3)}m`;
    reasons.push(
      `货物尺寸 ${dims} 无法在6个方向中具备匹配 ${container.code} ` +
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

  // 框架柜无门约束（两侧均可进），OT 仅跳过高度约束（M2：显式检查类型）
  if (container.type === 'flatRack') {
    return { pass: true, reasons };
  }
  if (container.type === 'openTop') {
    // OT 仅需要宽度通过门，高度不受限
    const minDim = Math.min(item.l, item.w, item.h);
    if (minDim <= effDoorW) {
      return { pass: true, reasons };
    }
    return { pass: false, reasons };
  }

  // 检查是否存在一个截面 ≤ 门宽×门高
  // 货物可以旋转通过门，只需要截面fit
  const crossSections = [
    { a: item.l, b: item.w },
    { a: item.l, b: item.h },
    { a: item.w, b: item.h }
  ];

  let anyPass = false;
  const doorMin = Math.min(effDoorW, effDoorH);
  const doorMax = Math.max(effDoorW, effDoorH);
  for (const cs of crossSections) {
    const minDim = Math.min(cs.a, cs.b);
    const maxDim = Math.max(cs.a, cs.b);
    // 货物截面两个边分别不超过门截面的短边和长边即可通过
    if (minDim <= doorMin && maxDim <= doorMax) {
      anyPass = true;
      break;
    }
  }

  if (!anyPass) {
    reasons.push(
      `货物无截面能通过箱门(门宽${effDoorW.toFixed(3)}m×门高${effDoorH.toFixed(3)}m)，` +
      `建议使用开顶柜吊装`
    );
  }

  return { pass: anyPass, reasons };
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
 * 40FR 超长规则：
 * - 内长 11.70m 为基准；
 * - 若长宽高有 2 项及以上超过 11.70m，明确无法装载；
 * - 若仅 1 项超过 11.70m，允许作为 FR 超长货装载（需 3D 标出）。
 * @param {object} item - {l, w, h}
 * @returns {{frAllowed: boolean, overLength: boolean, rotated: boolean, reason: string}}
 */
function checkFRLengthRule(item) {
  const frL = CONTAINER_DB['40FR'].L;
  const dims = [item.l, item.w, item.h];
  const overCount = dims.filter(d => d > frL).length;

  if (overCount >= 2) {
    return { frAllowed: false, overLength: false, rotated: false, reason: `长宽高中有 ${overCount} 项超过 40FR 内长 ${frL}m，无法装载` };
  }

  if (overCount === 1) {
    // 仅一项超过 11.70m：只能是长度方向超长，标记为 FR 超长货
    return { frAllowed: true, overLength: true, rotated: false, reason: `长度 ${Math.max(...dims).toFixed(2)}m 超过 40FR 内长 ${frL}m，作为超长货装载` };
  }

  return { frAllowed: true, overLength: false, rotated: false, reason: '' };
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
    // 1. 检查能否通过20GP门并fit有效尺寸（尝试6个旋转方向）
    const gp20Door = checkDoorConstraint(item, gp20, tolerance);
    if (gp20Door.pass) {
      if (fitsByRotation(item, getEffectiveMaxDims(gp20, tolerance))) return '20GP';
    }

    // 2. 检查能否通过40HQ门
    const hq40Door = checkDoorConstraint(item, hq40, tolerance);
    if (hq40Door.pass) {
      if (fitsByRotation(item, getEffectiveMaxDims(hq40, tolerance))) return '40HQ';
    }

    // 3. 检查能否通过OT门（仅宽度约束）并fit有效尺寸
    const ot20 = CONTAINER_DB['20OT'];
    const ot40 = CONTAINER_DB['40OT'];
    const ot20Door = checkDoorConstraint(item, ot20, tolerance);
    const ot40Door = checkDoorConstraint(item, ot40, tolerance);
    if (ot20Door.pass || ot40Door.pass) {
      if (fitsByRotation(item, getEffectiveMaxDims(ot20, tolerance)) ||
          fitsByRotation(item, getEffectiveMaxDims(ot40, tolerance))) return 'OT';
    }
  }

  // 4. 检查框架柜（无门约束，允许合理超限）
  const frRule = checkFRLengthRule(item);

  if (!frRule.frAllowed) {
    // 明确无法装载：两项及以上超过 40FR 内长
    return 'none';
  }

  const fr40Eff = getEffectiveMaxDims(fr40, tolerance);
  const [maxDim, midDim, minDim] = [item.l, item.w, item.h].sort((a, b) => b - a);
  const fitFR40 = maxDim <= fr40Eff.maxL && midDim <= fr40Eff.maxW && minDim <= fr40Eff.maxH;

  if (fitFR40) {
    item._frOverLength = frRule.overLength;
    item._frRotated = frRule.rotated;
    return 'FR';
  }

  if (frRule.overLength) {
    item._frOverLength = true;
    item._frRotated = false;
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
    return { needsMixed: true, reason: '单件超重，需多箱装载' };
  }

  // 逐件分类
  const classifications = items.map(item => classifyItemByContainerType(item, tolerance));

  // 检查是否有无法装载的货物
  if (classifications.some(c => c === 'none')) {
    return null;
  }

  // 汇总最低要求箱型
  const needsFR = classifications.some(c => c === 'FR');
  const needsOT = classifications.some(c => c === 'OT');
  const needs40HQ = classifications.some(c => c === '40HQ');

  const gp20 = CONTAINER_DB['20GP'];
  const hq40 = CONTAINER_DB['40HQ'];
  const reasoning = [];

  // 根据最低要求选择主箱型
  let primary = null;
  let alternatives = [];

  if (needsFR) {
    // 必须用框架柜
    const fr20 = CONTAINER_DB['20FR'];
    const fr40 = CONTAINER_DB['40FR'];
    const fr20Eff = getEffectiveMaxDims(fr20, tolerance);
    const fr40Eff = getEffectiveMaxDims(fr40, tolerance);

    // 检查所有货物是否都能装入20FR（考虑6个旋转方向）
    const allFit20FR = items.every(item => fitsByRotation(item, fr20Eff));
    // 检查总重量
    const weightFit20FR = totalWeight <= fr20.payload;

    if (allFit20FR && weightFit20FR) {
      primary = fr20;
      alternatives = [fr40];
      reasoning.push('货物尺寸需要框架柜，20FR可装载');
    } else {
      // 检查40FR（考虑6个旋转方向）
      const allFit40FR = items.every(item => fitsByRotation(item, fr40Eff));
      const weightFit40FR = totalWeight <= fr40.payload;
      if (allFit40FR && weightFit40FR) {
        primary = fr40;
        alternatives = [fr20];
        reasoning.push('货物尺寸需要框架柜，40FR可装载');
      } else {
        // 单箱FR也无法装载，需要多箱
        return { needsMixed: true, reason: '单箱框架柜无法装载所有货物，需多箱装载' };
      }
    }
  } else if (needsOT) {
    // 必须用开顶柜
    const ot20 = CONTAINER_DB['20OT'];
    const ot40 = CONTAINER_DB['40OT'];
    const ot20Eff = getEffectiveMaxDims(ot20, tolerance);
    const ot40Eff = getEffectiveMaxDims(ot40, tolerance);

    // 优先尝试20OT（更经济），使用6方向旋转检查
    const allFit20OT = items.every(item => fitsByRotation(item, ot20Eff));
    const weightFit20OT = totalWeight <= ot20.payload;

    if (allFit20OT && weightFit20OT) {
      primary = ot20;
      alternatives = [ot40];
      reasoning.push('货物高度超限，20OT开顶柜可装载');
    } else {
      const allFit40OT = items.every(item => fitsByRotation(item, ot40Eff));
      const weightFit40OT = totalWeight <= ot40.payload;
      if (allFit40OT && weightFit40OT) {
        primary = ot40;
        alternatives = [ot20];
        reasoning.push('货物高度超限，40OT开顶柜可装载');
      } else {
        return { needsMixed: true, reason: '单箱开顶柜无法装载所有货物，需多箱装载' };
      }
    }
  } else if (needs40HQ) {
    // 需要40HQ（长度或高度超20GP，但能通过40HQ门）
    const hq40Eff = getEffectiveMaxDims(hq40, tolerance);
    const allFit40HQ = items.every(item => fitsByRotation(item, hq40Eff));
    const weightFit40HQ = totalWeight <= hq40.payload;

    if (allFit40HQ && weightFit40HQ) {
      primary = hq40;
      alternatives = [gp20];
      reasoning.push('货物尺寸超出20GP范围，40HQ可装载');
    } else {
      return { needsMixed: true, reason: '单箱40HQ无法装载所有货物，需多箱装载' };
    }
  } else {
    // 所有货物都能在20GP范围内
    primary = gp20;
    reasoning.push('货物尺寸在20GP范围内');

    // 估算所需箱数
    const estGp20Count = Math.ceil(totalVolume / gp20.volume * 1.3);

    // 如果预估需要>2个20GP，推荐40HQ作为备选
    if (estGp20Count > 2) {
      alternatives.push(hq40);
      reasoning.push(`预估需${estGp20Count}个20GP，建议对比40HQ`);
    }

    // 检查总重量是否超过20GP载重
    if (totalWeight > gp20.payload) {
      // 20GP载重不够，看40HQ
      if (totalWeight <= hq40.payload) {
        primary = hq40;
        alternatives = [gp20];
        reasoning.push(`总重${totalWeight.toFixed(0)}kg超出20GP载重${gp20.payload}kg，推荐40HQ`);
      } else {
        // 需要多箱
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
  // 计算总货物量
  const totalVolume = items.reduce((s, i) => s + i.l * i.w * i.h * (i.quantity || 1), 0);
  const totalWeight = items.reduce((s, i) => s + i.weight * (i.quantity || 1), 0);
  const maxItemWeight = Math.max(...items.map(i => i.weight));

  // 检查单件超重
  const maxPayload = Math.max(...CONTAINER_LIST.map(c => c.payload));
  if (maxItemWeight > maxPayload) return null;

  // 逐件分类，按门约束可行性分组
  const groupStandard = []; // 可通过标准柜门的货物
  const groupOT = [];       // 只能通过OT门的货物
  const groupFR = [];       // 只能通过FR门的货物
  const noneItems = [];     // 明确无法装载的货物

  for (const item of items) {
    const cls = classifyItemByContainerType(item, tolerance);
    if (cls === '20GP' || cls === '40HQ') {
      groupStandard.push(item);
    } else if (cls === 'OT') {
      groupOT.push(item);
    } else if (cls === 'FR') {
      groupFR.push(item);
    } else if (cls === 'none') {
      noneItems.push(item);
    }
  }

  // 辅助函数：计算某组货物所需箱数
  function calcUnitsForGroup(groupItems, spec) {
    if (!groupItems || groupItems.length === 0) return 0;
    const vol = groupItems.reduce((s, i) => s + i.l * i.w * i.h * (i.quantity || 1), 0);
    const wt = groupItems.reduce((s, i) => s + i.weight * (i.quantity || 1), 0);
    const estByVol = Math.ceil(vol / spec.volume * 1.3);
    const estByWt = Math.ceil(wt / spec.payload);
    return Math.max(1, estByVol, estByWt);
  }

  // 辅助函数：选择最经济的单箱型
  // allowedTypes: 允许使用的箱型类型列表，如 ['standard','openTop','flatRack']
  function pickBestSingleSpec(groupItems, allowedTypes = null) {
    if (!groupItems || groupItems.length === 0) return null;
    const candidates = [];

    const allow = (type) => !allowedTypes || allowedTypes.includes(type);

    if (allow('standard')) {
      // 尝试20GP（6方向旋转检查）
      const gp20 = CONTAINER_DB['20GP'];
      const gp20Eff = getEffectiveMaxDims(gp20, tolerance);
      if (groupItems.every(item => fitsByRotation(item, gp20Eff))) {
        candidates.push({ spec: gp20, units: calcUnitsForGroup(groupItems, gp20) });
      }

      // 尝试40HQ
      const hq40 = CONTAINER_DB['40HQ'];
      const hq40Eff = getEffectiveMaxDims(hq40, tolerance);
      if (groupItems.every(item => fitsByRotation(item, hq40Eff))) {
        candidates.push({ spec: hq40, units: calcUnitsForGroup(groupItems, hq40) });
      }
    }

    if (allow('openTop')) {
      // 尝试20OT（6方向旋转检查）
      const ot20 = CONTAINER_DB['20OT'];
      const ot20Eff = getEffectiveMaxDims(ot20, tolerance);
      if (groupItems.every(item => fitsByRotation(item, ot20Eff))) {
        candidates.push({ spec: ot20, units: calcUnitsForGroup(groupItems, ot20) });
      }

      // 尝试40OT
      const ot40 = CONTAINER_DB['40OT'];
      const ot40Eff = getEffectiveMaxDims(ot40, tolerance);
      if (groupItems.every(item => fitsByRotation(item, ot40Eff))) {
        candidates.push({ spec: ot40, units: calcUnitsForGroup(groupItems, ot40) });
      }
    }

    if (allow('flatRack')) {
      // 尝试20FR（6方向旋转检查，含超限余量）
      const fr20 = CONTAINER_DB['20FR'];
      const fr20Eff = getEffectiveMaxDims(fr20, tolerance);
      if (groupItems.every(item => fitsByRotation(item, fr20Eff))) {
        candidates.push({ spec: fr20, units: calcUnitsForGroup(groupItems, fr20) });
      }

      // 尝试40FR
      const fr40 = CONTAINER_DB['40FR'];
      const fr40Eff = getEffectiveMaxDims(fr40, tolerance);
      if (groupItems.every(item => fitsByRotation(item, fr40Eff))) {
        candidates.push({ spec: fr40, units: calcUnitsForGroup(groupItems, fr40) });
      }
    }

    if (candidates.length === 0) return null;

    // 选择箱数最少的方案（如果相同，按经济优先级排序）
    candidates.sort((a, b) => {
      if (a.units !== b.units) return a.units - b.units;
      const priority = { '20GP': 1, '40HQ': 2, '20OT': 3, '40OT': 4, '20FR': 5, '40FR': 6 };
      return (priority[a.spec.code] || 99) - (priority[b.spec.code] || 99);
    });

    return candidates[0];
  }

  // 构建混合方案
  const comboSpecs = [];
  const parts = [];

  // 1. 处理标准货组：只能用标准柜（20GP/40HQ），不能用 FR/OT
  if (groupStandard.length > 0) {
    const best = pickBestSingleSpec(groupStandard, ['standard']);
    if (!best) return null; // 标准货无法装载
    for (let i = 0; i < best.units; i++) comboSpecs.push(best.spec);
    parts.push(`${best.spec.nameCN}×${best.units}`);
  }

  // 2. 处理OT货组：只能用开顶柜
  if (groupOT.length > 0) {
    const best = pickBestSingleSpec(groupOT, ['openTop']);
    if (!best) return null;
    for (let i = 0; i < best.units; i++) comboSpecs.push(best.spec);
    parts.push(`${best.spec.nameCN}×${best.units}`);
  }

  // 3. 处理FR货组：必须使用框架柜
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
    reasoning: `总货物 ${totalVolume.toFixed(1)}m³ / ${totalWeight.toFixed(0)}kg，推荐 ${comboSpecs.length} 箱混合方案（按货物类型分组装载）`
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
      const maxFailL = Math.max(...failingItems.map(i => i.l));
      const maxFailW = Math.max(...failingItems.map(i => i.w));
      const maxFailH = Math.max(...failingItems.map(i => i.h));
      reasons.push(
        `${spec.nameCN}: 货物尺寸 ${maxFailL.toFixed(2)}×${maxFailW.toFixed(2)}×${maxFailH.toFixed(2)}m ` +
        `超过门约束 ${spec.doorW.toFixed(2)}×${spec.doorH === Infinity ? '∞' : spec.doorH.toFixed(2)}m`
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

// 导出为全局
window.ContainerDB = {
  CONTAINER_DB,
  CONTAINER_LIST,
  getEffectiveMaxDims,
  checkSizeConstraints,
  checkDoorConstraint,
  checkWeightConstraint,
  isStackable,
  getOrientations,
  validateItem,
  classifyItemByContainerType,
  recommendContainer,
  recommendMixedContainers,
  analyzeRecommendationFailure,
  autoRecommend
};