/**
 * 3D 装箱引擎 — EMS + 层铺混合算法
 * 含自检 & 重算机制
 */

const PackingEngine = (() => {
  const CDB = window.ContainerDB;
  const { CONTAINER_DB, getEffectiveMaxDims, checkDoorConstraint, getOrientations, isStackable } = CDB;

  // ═══════════════════════════════════════════
  // 常量定义
  // ═══════════════════════════════════════════

  const CONSTANTS = {
    EPS: 1e-6,              // 几何容差（浮点精度）
    PRUNE_THRESHOLD: 0.01,  // 空间修剪阈值（<1cm视为无效空间）
    MERGE_EPS: 0.001,       // 空间合并容差
    DBL_Z_WEIGHT: 1000,     // DBL评分Z轴权重（最低最优先）
    DBL_X_WEIGHT: 10,       // DBL评分X轴权重（最里最优先）
    DBL_Y_WEIGHT: 10,       // DBL评分Y轴权重（最左最优先）
    FIT_WEIGHT: 100,        // 贴合度评分权重
    LAYER_PACK_THRESHOLD: 10, // 层铺触发阈值（同型号≥10件启用）
    VOLUME_WASTE_FACTOR: 1.3, // 体积浪费估算系数
    MAX_CONTAINERS: 100,    // 多箱分配上限（防无限循环）
    SPATIAL_HASH_THRESHOLD: 200, // 启用空间哈希的货物数量阈值
    SPATIAL_HASH_CELL_SIZE: 2.0  // 空间哈希网格单元大小（米）
  };

  const SUPPORT_MIN_RATIO = 0.70; // 底面最小支撑覆盖率
  const MIN_FR_FLOOR_RATIO = 0.50; // FR 框架柜：z=0 时货物底面投影至少50%与地板重合

  // ═══════════════════════════════════════════
  // EMS 空间数据结构
  // ═══════════════════════════════════════════

  function createSpace(x, y, z, L, W, H, blockedAbove = false) {
    return { x, y, z, L, W, H, blockedAbove };
  }

  /**
   * 切割空间：在 space 中放置了位于 (px,py,pz) 尺寸 (pl,pw,ph) 的货物后
   * 把剩余空间切成最多3个子空间
   */
  function cutSpace(space, px, py, pz, pl, pw, ph) {
    const newSpaces = [];

    // 右方空间 (沿X轴延伸) — 保持完整高度，覆盖空间原始Y范围
    const rx = px + pl;
    if (rx < space.x + space.L) {
      newSpaces.push(createSpace(
        rx, space.y, space.z,
        space.x + space.L - rx, space.W, space.H,
        space.blockedAbove
      ));
    }

    // 前方空间 (沿Y轴延伸) — 限制在货物X宽度范围内
    const fy = py + pw;
    if (fy < space.y + space.W) {
      newSpaces.push(createSpace(
        space.x, fy, space.z,
        pl, space.y + space.W - fy, space.H,
        space.blockedAbove
      ));
      // 货物右侧之外的前方区域（右前方角）
      if (rx < space.x + space.L) {
        newSpaces.push(createSpace(
          rx, fy, space.z,
          space.x + space.L - rx, space.y + space.W - fy, space.H,
          space.blockedAbove
        ));
      }
    }

    // 上方空间 (沿Z轴延伸) — 仅货物正上方
    const tz = pz + ph;
    if (tz < space.z + space.H) {
      if (!space.blockedAbove) {
        newSpaces.push(createSpace(
          space.x, space.y, tz,
          pl, pw, space.z + space.H - tz,
          space.blockedAbove
        ));
      }
    }

    return newSpaces;
  }

  /**
   * 合并相邻的可合并空间（同X或同Y方向上重叠的空间）
   */
  function mergeSpaces(spaces) {
    if (spaces.length <= 1) return spaces;

    const merged = [];
    const used = new Set();

    for (let i = 0; i < spaces.length; i++) {
      if (used.has(i)) continue;
      let current = { ...spaces[i] };
      used.add(i);

      // 尝试与后续空间合并
      for (let j = i + 1; j < spaces.length; j++) {
        if (used.has(j)) continue;
        const other = spaces[j];

        // 同一Z层，同Y范围，X相邻 → 沿X合并
        if (Math.abs(current.z - other.z) < CONSTANTS.MERGE_EPS &&
            Math.abs((current.z + current.H) - (other.z + other.H)) < CONSTANTS.MERGE_EPS &&
            Math.abs(current.y - other.y) < CONSTANTS.MERGE_EPS &&
            Math.abs(current.W - other.W) < CONSTANTS.MERGE_EPS) {

          // 检查X连续性
          if (Math.abs((current.x + current.L) - other.x) < CONSTANTS.MERGE_EPS) {
            current.L += other.L;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j);
            j = i; // 重新扫描
            continue;
          }
          if (Math.abs((other.x + other.L) - current.x) < CONSTANTS.MERGE_EPS) {
            current.x = other.x;
            current.L += other.L;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j);
            j = i;
            continue;
          }
        }

        // 同一Z层，同X范围，Y相邻 → 沿Y合并
        if (Math.abs(current.z - other.z) < CONSTANTS.MERGE_EPS &&
            Math.abs((current.z + current.H) - (other.z + other.H)) < CONSTANTS.MERGE_EPS &&
            Math.abs(current.x - other.x) < CONSTANTS.MERGE_EPS &&
            Math.abs(current.L - other.L) < CONSTANTS.MERGE_EPS) {

          if (Math.abs((current.y + current.W) - other.y) < CONSTANTS.MERGE_EPS) {
            current.W += other.W;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j);
            j = i;
            continue;
          }
          if (Math.abs((other.y + other.W) - current.y) < CONSTANTS.MERGE_EPS) {
            current.y = other.y;
            current.W += other.W;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j);
            j = i;
            continue;
          }
        }
      }

      merged.push(current);
    }

    return merged;
  }

  /**
   * 清理过小的空间（< 1cm 在任意维度）
   */
  function pruneSmallSpaces(spaces) {
    return spaces.filter(s => s.L > CONSTANTS.PRUNE_THRESHOLD && s.W > CONSTANTS.PRUNE_THRESHOLD && s.H > CONSTANTS.PRUNE_THRESHOLD);
  }

  /**
   * 归一化空间：剔除被其他空间完全包含的冗余空间
   * 解决 cutSpace 产生的右前方角空间被右侧空间完全包含的问题
   */
  function normalizeSpaces(spaces) {
    if (spaces.length <= 1) return spaces;
    const result = [];
    for (let i = 0; i < spaces.length; i++) {
      let contained = false;
      for (let j = 0; j < spaces.length; j++) {
        if (i === j) continue;
        const a = spaces[i], b = spaces[j];
        if (a.x >= b.x - CONSTANTS.EPS && a.x + a.L <= b.x + b.L + CONSTANTS.EPS &&
            a.y >= b.y - CONSTANTS.EPS && a.y + a.W <= b.y + b.W + CONSTANTS.EPS &&
            a.z >= b.z - CONSTANTS.EPS && a.z + a.H <= b.z + b.H + CONSTANTS.EPS) {
          // 注意：不传播 blockedAbove，避免包含空间被过度封锁
        // 每个空间的 blockedAbove 应保持独立，由 emsPlace 逐个检查
        contained = true;
          break;
        }
      }
      if (!contained) result.push(spaces[i]);
    }
    return result;
  }

  /**
   * 剔除与已放置货物重叠的 EMS 空间
   * 解决 cutSpace 产生的重叠空间导致的货物碰撞问题
   */
  function purgeOverlapSpaces(spaces, placedItems) {
    return spaces.filter(space => {
      for (const placed of placedItems) {
        const ox = Math.max(space.x, placed.x);
        const oy = Math.max(space.y, placed.y);
        const oz = Math.max(space.z, placed.z);
        const ox2 = Math.min(space.x + space.L, placed.x + placed.l);
        const oy2 = Math.min(space.y + space.W, placed.y + placed.w);
        const oz2 = Math.min(space.z + space.H, placed.z + placed.h);
        // 有正体积重叠 → 剔除
        if (ox < ox2 - CONSTANTS.EPS && oy < oy2 - CONSTANTS.EPS && oz < oz2 - CONSTANTS.EPS) {
          return false;
        }
      }
      return true;
    });
  }

  // ═══════════════════════════════════════════
  // DBL 评分
  // ═══════════════════════════════════════════

  /**
   * Deepest-Bottom-Left 评分
   * 优先选择最靠近里端（深处）、最低、最左的位置
   * z优先级最高（越低越好），y次之，x再次
   */
  function dblScore(spaceX, spaceY, spaceZ, container, effDims) {
    // 归一化到 [0,1]，使用有效尺寸避免 FR 超限空间产生负分
    const maxL = (effDims && effDims.maxL) || container.L;
    const maxW = (effDims && effDims.maxW) || container.W;
    const maxH = (effDims && effDims.maxH) || container.H;
    // xScore: 越靠近 origin（x=0，即车厢里端），分数越高
    const xScore = 1 - (spaceX / maxL);
    // yScore: 越靠近左边（y=0），分数越高
    const yScore = 1 - (spaceY / maxW);
    // zScore: 越靠近底部（z=0），分数越高
    const zScore = 1 - (spaceZ / maxH);

    // DBL 优先：z 最低 > x 最里 > y 最左
    return zScore * CONSTANTS.DBL_Z_WEIGHT + xScore * CONSTANTS.DBL_X_WEIGHT + yScore * CONSTANTS.DBL_Y_WEIGHT;
  }

  // ═══════════════════════════════════════════
  // 单件 EMS 放置
  // ═══════════════════════════════════════════

  /**
   * 计算货物底面在 (x,y,z) 处的支撑覆盖率
   * @returns {number} 0-1
   */
  function calcSupportRatio(x, y, z, l, w, placedItems) {
    if (z <= CONSTANTS.EPS) return 1; // 地板提供完整支撑
    const baseArea = l * w;
    if (baseArea <= CONSTANTS.EPS) return 0;

    let supported = 0;
    for (const p of placedItems) {
      if (Math.abs(p.z + p.h - z) > CONSTANTS.EPS) continue;
      const ox = Math.max(x, p.x);
      const oy = Math.max(y, p.y);
      const ox2 = Math.min(x + l, p.x + p.l);
      const oy2 = Math.min(y + w, p.y + p.w);
      if (ox < ox2 - CONSTANTS.EPS && oy < oy2 - CONSTANTS.EPS) {
        supported += (ox2 - ox) * (oy2 - oy);
      }
    }
    return supported / baseArea;
  }

  /**
   * 检查货物底面投影是否与集装箱地板有交集（用于 40FR/20FR 框架柜）
   *
   * 框架柜无侧壁，允许货物宽度/长度超出地板（在 maxOverWidth / maxOverLength 范围内），
   * 因此只需确保投影与地板存在交集即可，不需完全落入地板内。
   * 超出地板的程度由 getEffectiveMaxDims 的 FR_REALITY_LIMITS 控制。
   *
   * @returns {boolean} 投影与地板有交集则通过
   */
  function baseOverlapsContainerFloor(x, y, l, w, container) {
    const fx = 0, fy = 0;
    const fx2 = container.L, fy2 = container.W;
    const ox = Math.max(x, fx);
    const oy = Math.max(y, fy);
    const ox2 = Math.min(x + l, fx2);
    const oy2 = Math.min(y + w, fy2);
    return ox < ox2 - CONSTANTS.EPS && oy < oy2 - CONSTANTS.EPS;
  }

  /**
   * 计算货物底面投影与 FR 地板的重合比例
   * @returns {number} 0~1，表示底面投影有百分之多少与地板重合
   */
  function calcFloorOverlapRatio(x, y, l, w, container) {
    const fx = 0, fy = 0;
    const fx2 = container.L, fy2 = container.W;
    const ox = Math.max(x, fx);
    const oy = Math.max(y, fy);
    const ox2 = Math.min(x + l, fx2);
    const oy2 = Math.min(y + w, fy2);
    if (ox >= ox2 - CONSTANTS.EPS || oy >= oy2 - CONSTANTS.EPS) return 0;
    const overlapArea = (ox2 - ox) * (oy2 - oy);
    const cargoArea = l * w;
    return cargoArea > CONSTANTS.EPS ? overlapArea / cargoArea : 0;
  }

  /**
   * 检查货物底面四个角是否都有支撑（防止边角悬空）
   * @returns {boolean}
   */
  function hasCornerSupport(x, y, z, l, w, placedItems) {
    if (z <= CONSTANTS.EPS) return true;
    const corners = [
      [x, y],
      [x + l, y],
      [x, y + w],
      [x + l, y + w]
    ];
    for (const [cx, cy] of corners) {
      let supported = false;
      for (const p of placedItems) {
        if (Math.abs(p.z + p.h - z) > CONSTANTS.EPS) continue;
        if (cx + CONSTANTS.EPS >= p.x && cx - CONSTANTS.EPS <= p.x + p.l &&
            cy + CONSTANTS.EPS >= p.y && cy - CONSTANTS.EPS <= p.y + p.w) {
          supported = true;
          break;
        }
      }
      if (!supported) return false;
    }
    return true;
  }

  /**
   * 寻找最佳放置位置（遍历所有EMS空间和方向）
   * @returns {{spaceIndex, orientation, x, y, z}|null}
   */
  function findBestPlacement(item, emsSpaces, container, currentWeight, tolerance, placedItems = []) {
    let best = null;
    let bestScore = -Infinity;
    const orientations = getOrientations(item);
    const minSupport = SUPPORT_MIN_RATIO;

    for (let si = 0; si < emsSpaces.length; si++) {
      const space = emsSpaces[si];

      // blockedAbove: 如果空间被标记为上方封顶，且货物要放在Z>0位置，跳过
      if (space.blockedAbove && space.z > CONSTANTS.EPS) continue;

      for (const o of orientations) {
        // 检查方向是否fit空间
        if (o.l > space.L + CONSTANTS.EPS || o.w > space.W + CONSTANTS.EPS || o.h > space.H + CONSTANTS.EPS) continue;

        // 检查是否超出容器边界（FR 使用含现实超限上限的有效尺寸）
        const effDims = getEffectiveMaxDims(container, tolerance);
        if (o.l > effDims.maxL || o.w > effDims.maxW || o.h > effDims.maxH) continue;

        // 检查门约束（FR 箱型无门约束）
        if (container.type !== 'flatRack') {
          const doorCheck = checkDoorConstraint({ l: o.l, w: o.w, h: o.h }, container, tolerance);
          if (!doorCheck.pass) continue;
        }

        // 重量检查
        if (currentWeight + item.weight > container.payload) continue;

        // 支撑面检查：z>0 时必须满足最低支撑覆盖率，且四角均有支撑
        let support = 1;
        if (space.z > CONSTANTS.EPS) {
          support = calcSupportRatio(space.x, space.y, space.z, o.l, o.w, placedItems);
          const cornersOk = hasCornerSupport(space.x, space.y, space.z, o.l, o.w, placedItems);
          if (support < minSupport || !cornersOk) continue;
        }

        // FR 框架柜：任意层（含 z=0）货物底面必须与地板有交集
        // 因 EMS 空间含超限余量，z=0 时货物也可能被放到地板外，需显式检查
        if (container.type === 'flatRack') {
          const floorRatio = calcFloorOverlapRatio(space.x, space.y, o.l, o.w, container);
          if (floorRatio <= CONSTANTS.EPS) continue; // 无交集，完全在底板外
          // z=0 时：必须至少 MIN_FR_FLOOR_RATIO（50%）的投影落在地板上
          // 防止货物"挂在侧面"
          if (space.z <= CONSTANTS.EPS && floorRatio < MIN_FR_FLOOR_RATIO) continue;
        }

        // 分数
        const score = dblScore(space.x, space.y, space.z, container, effDims);
        // 优先选空间利用率最高的（贴合）
        const fitX = o.l / space.L;
        const fitY = o.w / space.W;
        const fitZ = o.h / space.H;
        const fitScore = (fitX + fitY + fitZ) / 3;

        let totalScore = score + fitScore * CONSTANTS.FIT_WEIGHT;

        // FR/OT 稳定性惩罚：货物高度超过箱体名义高度时惩罚该朝向
        // FR 有效高度含 FR_REALITY_LIMITS，OT 有效高度含 maxOverHeight
        // 两者都会膨胀 space.H 导致 fitZ 错误激励竖放
        const hasInflatedHeight = container.type === 'flatRack' || container.type === 'openTop';
        if (hasInflatedHeight && container.H > 0 && o.h > container.H + CONSTANTS.EPS) {
          const stabilityPenalty = (o.h / container.H) * CONSTANTS.FIT_WEIGHT * 0.5;
          totalScore -= stabilityPenalty;
        }

        if (totalScore > bestScore) {
          bestScore = totalScore;
          best = { spaceIndex: si, orientation: o, x: space.x, y: space.y, z: space.z };
        }
      }
    }

    return best;
  }

  /**
   * 根据最佳位置创建放置记录
   */
  function createPlacedItem(item, best) {
    return {
      model: item.model,
      l: best.orientation.l,
      w: best.orientation.w,
      h: best.orientation.h,
      x: best.x,
      y: best.y,
      z: best.z,
      weight: item.weight,
      stackable: item.stackable !== false,
      colorIndex: item.colorIndex || 0,
      origL: item.l, origW: item.w, origH: item.h
    };
  }

  /**
   * 放置后更新EMS空间：切割、标记blockedAbove、合并、归一化、剔除重叠、修剪
   */
  function updateSpacesAfterPlacement(emsSpaces, best, placed, placedItems) {
    // 切割空间
    const oldSpace = emsSpaces[best.spaceIndex];
    const newSpaces = cutSpace(oldSpace, best.x, best.y, best.z, best.orientation.l, best.orientation.w, best.orientation.h);
    emsSpaces.splice(best.spaceIndex, 1);
    emsSpaces.push(...newSpaces);

    // 如果货物不可叠放，标记上方空间
    if (!placed.stackable) {
      // 标记所有在货物正上方的空间
      for (const s of emsSpaces) {
        if (s.z >= placed.z + placed.h - CONSTANTS.EPS &&
            s.x < placed.x + placed.l && s.x + s.L > placed.x &&
            s.y < placed.y + placed.w && s.y + s.W > placed.y) {
          s.blockedAbove = true;
        }
      }
    }

    // 合并、归一化（剔除被包含的冗余空间）、剔除重叠（含当前放置的货物）、修剪
    const allPlaced = [...placedItems, placed];
    const merged = mergeSpaces(emsSpaces);
    const normalized = normalizeSpaces(merged);
    const cleaned = purgeOverlapSpaces(normalized, allPlaced);
    emsSpaces.splice(0, emsSpaces.length, ...pruneSmallSpaces(cleaned));
  }

  function emsPlace(item, container, emsSpaces, placedItems, currentWeight, tolerance) {
    const best = findBestPlacement(item, emsSpaces, container, currentWeight, tolerance, placedItems);
    if (!best) return null;

    // 后备校验：确保货物满足所有约束（尺寸、门、重量）
    const validation = CDB.validateItem(item, container, currentWeight, tolerance);
    if (!validation.pass) {
      return null; // 校验失败，返回 null 让调用方跳过此货物
    }

    // 放置货物
    const placed = createPlacedItem(item, best);
    updateSpacesAfterPlacement(emsSpaces, best, placed, placedItems);

    return placed;
  }

  // ═══════════════════════════════════════════
  // 层铺批量放置
  // ═══════════════════════════════════════════

  function layerPack(group, container, emsSpaces, placedItems, currentWeight, tolerance) {
    const { l, w, h, quantity } = group;
    const item = group.item;

    let remaining = quantity;
    const placed = [];

    // 门约束检查（只做一次，该组所有货物尺寸相同）
    const doorCheck = checkDoorConstraint({ l, w, h }, container, tolerance);
    if (!doorCheck.pass) return { placed, remaining };

    const canStackMore = item.stackable !== false;

    // 使用 while 循环，每次放置后重新计算最佳空间，确保利用新产生的小空间
    while (remaining > 0) {
      // 重新按面积排序，找最大的可用空间（此时 emsSpaces 已是最新状态）
      const sortedSpaces = emsSpaces
        .map((s, i) => s)
        .filter(s => !s.blockedAbove || s.z < CONSTANTS.EPS)
        .sort((a, b) => (b.L * b.W) - (a.L * a.W));

      let bestSpace = null;
      let bestXCount = 0, bestYCount = 0, bestLayers = 0;

      // 找第一个能放置该货物尺寸的空间
      for (const s of sortedSpaces) {
        const xCount = Math.floor((s.L + CONSTANTS.EPS) / l);
        const yCount = Math.floor((s.W + CONSTANTS.EPS) / w);
        if (xCount === 0 || yCount === 0) continue;

        const layers = Math.floor((s.H + CONSTANTS.EPS) / h);
        if (layers === 0) continue;

        bestSpace = s;
        bestXCount = xCount;
        bestYCount = yCount;
        bestLayers = layers;
        break;
      }

      if (!bestSpace) break; // 没有空间能放下这组货物

      const maxLayers = canStackMore ? bestLayers : 1;
      const perLayer = bestXCount * bestYCount;
      let placedThisRound = 0;

      for (let layer = 0; layer < maxLayers && remaining > 0; layer++) {
        for (let yi = 0; yi < bestYCount && remaining > 0; yi++) {
          for (let xi = 0; xi < bestXCount && remaining > 0; xi++) {
            const px = bestSpace.x + xi * l;
            const py = bestSpace.y + yi * w;
            const pz = bestSpace.z + layer * h;

            // 重量检查
            if (currentWeight + item.weight > container.payload) break;

            // 支撑面检查（层铺时同样不能悬空）
            if (pz > CONSTANTS.EPS) {
              const support = calcSupportRatio(px, py, pz, l, w, placedItems);
              const cornersOk = hasCornerSupport(px, py, pz, l, w, placedItems);
              if (support < SUPPORT_MIN_RATIO || !cornersOk) continue;
            }

            // FR 框架柜：任意层（含 z=0）货物底面必须与地板有交集
            if (container.type === 'flatRack') {
              const floorRatio = calcFloorOverlapRatio(px, py, l, w, container);
              if (floorRatio <= CONSTANTS.EPS) continue; // 无交集
              // z=0 时：至少 50% 投影落在地板上
              if (pz <= CONSTANTS.EPS && floorRatio < MIN_FR_FLOOR_RATIO) continue;
            }

            const entry = {
              model: item.model,
              l, w, h,
              x: px, y: py, z: pz,
              weight: item.weight,
              stackable: item.stackable !== false,
              colorIndex: item.colorIndex || 0,
              origL: item.l, origW: item.w, origH: item.h
            };
            placed.push(entry);
            placedItems.push(entry);
            currentWeight += item.weight;
            placedThisRound++;
            remaining--;
          }
        }
      }

      if (placedThisRound === 0) break; // 该空间虽然 fit 但支撑/重量检查全不通过

      // 不可叠放：放置完一层后标记上方空间封顶
      if (!canStackMore && placedThisRound > 0) {
        for (const s of emsSpaces) {
          if (s.z >= bestSpace.z + h - CONSTANTS.EPS &&
              s.x < bestSpace.x + bestSpace.L && s.x + s.L > bestSpace.x &&
              s.y < bestSpace.y + bestSpace.W && s.y + s.W > bestSpace.y) {
            s.blockedAbove = true;
          }
        }
      }

      // 更新空间：清空并重建，确保下一轮 while 迭代用最新 EMS
      emsSpaces.length = 0;
      buildEMSFromPlaced(placedItems, container, emsSpaces, tolerance);
    }

    return { placed, remaining };
  }

  /**
   * 从已放置货物重建EMS空间列表
   */
  function buildEMSFromPlaced(placedItems, container, emsSpaces, tolerance) {
    // 使用与 packSingleContainer 一致的有效尺寸（FR 含现实超限上限）
    const effDims = getEffectiveMaxDims(container, tolerance);
    emsSpaces.push(createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false));

    for (const item of placedItems) {
      // 找到包含该货物的空间并切割
      for (let i = 0; i < emsSpaces.length; i++) {
        const s = emsSpaces[i];
        if (item.x >= s.x - CONSTANTS.EPS && item.y >= s.y - CONSTANTS.EPS && item.z >= s.z - CONSTANTS.EPS &&
            item.x + item.l <= s.x + s.L + CONSTANTS.EPS &&
            item.y + item.w <= s.y + s.W + CONSTANTS.EPS &&
            item.z + item.h <= s.z + s.H + CONSTANTS.EPS) {
          const newSpaces = cutSpace(s, item.x, item.y, item.z, item.l, item.w, item.h);
          emsSpaces.splice(i, 1);
          emsSpaces.push(...newSpaces);
          break;
        }
      }
    }

    emsSpaces.splice(0, emsSpaces.length, ...pruneSmallSpaces(purgeOverlapSpaces(normalizeSpaces(mergeSpaces(emsSpaces)), placedItems)));

    // 恢复 blockedAbove 标记：遍历已放置的非叠放货物，封住其正上方空间
    for (const item of placedItems) {
      if (item.stackable === false) {
        for (const s of emsSpaces) {
          if (s.z >= item.z + item.h - CONSTANTS.EPS &&
              s.x < item.x + item.l && s.x + s.L > item.x &&
              s.y < item.y + item.w && s.y + s.W > item.y) {
            s.blockedAbove = true;
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════
  // 单箱装箱
  // ═══════════════════════════════════════════

  /**
   * 对单箱执行3D装箱
   * @param {Array} cargoItems - 展开后的货物列表（每件一个条目）
   * @param {object} container - 箱型规格
   * @param {object} options - { tolerance, sortStrategy }
   * @returns {{ placedItems, unplacedItems, utilization, weightUtil, errors, warnings }}
   */
  function packSingleContainer(cargoItems, container, options = {}) {
    const tolerance = options.tolerance || 0.05;
    const sortStrategy = options.sortStrategy || 'volume-desc';

    const effDims = getEffectiveMaxDims(container, tolerance);

    // 排序
    const sorted = sortItems([...cargoItems], sortStrategy);

    // 初始化EMS（FR 使用含现实超限上限的有效尺寸）
    let emsSpaces = [createSpace(0, 0, 0, effDims.maxL, effDims.maxW, effDims.maxH, false)];
    const placedItems = [];
    let currentWeight = 0;
    const unplacedItems = [];

    // 按型号分组
    const groups = groupByModel(sorted);

    for (const g of groups) {
      const item = g.items[0];
      const totalQty = g.items.reduce((s, i) => s + 1, 0);

      // ≥10件同型号用层铺
      if (totalQty >= CONSTANTS.LAYER_PACK_THRESHOLD && g.items.every(i => i.l === item.l && i.w === item.w && i.h === item.h)) {
        const result = layerPack(
          { l: item.l, w: item.w, h: item.h, quantity: totalQty, item },
          container, emsSpaces, placedItems, currentWeight, tolerance
        );
        currentWeight += item.weight * (totalQty - result.remaining);
        // 未铺完的继续用EMS逐件
        for (let r = 0; r < result.remaining; r++) {
          const placed = emsPlace(item, container, emsSpaces, placedItems, currentWeight, tolerance);
          if (placed) {
            placedItems.push(placed);
            currentWeight += item.weight;
          } else {
            unplacedItems.push({ ...item });
          }
        }
      } else {
        // EMS逐件放置
        for (const gi of g.items) {
          const placed = emsPlace(gi, container, emsSpaces, placedItems, currentWeight, tolerance);
          if (placed) {
            placedItems.push(placed);
            currentWeight += gi.weight;
          } else {
            unplacedItems.push({ ...gi });
          }
        }
      }
    }

    // 利用率
    const totalVolume = placedItems.reduce((s, i) => s + i.l * i.w * i.h, 0);
    const containerVol = container.L * container.W * container.H;
    // 标准柜/OT 按标称容积计算利用率；FR 因可超限，标称利用率上限为 100%
    const utilization = containerVol > 0 ? Math.min(1, totalVolume / containerVol) : 0;
    // FR 空间效率：按含现实超限上限的有效包络容积计算
    const effectiveVolume = effDims.maxL * effDims.maxW * effDims.maxH;
    const spaceEfficiency = effectiveVolume > 0 ? totalVolume / effectiveVolume : 0;
    const weightUtil = container.payload > 0 ? currentWeight / container.payload : 0;

    return {
      placedItems,
      unplacedItems,
      utilization,
      spaceEfficiency,
      weightUtil,
      totalWeight: currentWeight,
      totalVolume,
      containerCode: container.code || 'UNKNOWN'
    };
  }

  // ═══════════════════════════════════════════
  // 多箱连续分配
  // ═══════════════════════════════════════════

  function multiContainerPack(allItems, containerSpec, options = {}) {
    const containers = [];
    let remaining = expandItems(allItems);

    while (remaining.length > 0 && containers.length < CONSTANTS.MAX_CONTAINERS) {
      const result = packSingleContainer(remaining, containerSpec, options);
      containers.push(result);

      remaining = result.unplacedItems.map(u => ({
        model: u.model,
        l: u.l || u.origL,
        w: u.w || u.origW,
        h: u.h || u.origH,
        weight: u.weight || 0,
        stackable: u.stackable !== undefined ? u.stackable : true,
        orientationFixed: false,
        colorIndex: u.colorIndex || 0
      }));

      // 安全检查：如果没有任何货物被装入，说明所有剩余货物都不fit
      if (result.placedItems.length === 0) break;
    }

    // 汇总
    const totalPlaced = containers.reduce((s, c) => s + c.placedItems.length, 0);
    const totalVolumePlaced = containers.reduce((s, c) => s + c.totalVolume, 0);
    const avgUtilization = containers.length > 0
      ? containers.reduce((s, c) => s + c.utilization, 0) / containers.length
      : 0;
    const totalWeightLoaded = containers.reduce((s, c) => s + c.totalWeight, 0);

    return {
      containerCode: containerSpec.code,
      containerName: containerSpec.nameCN,
      containers,
      containerCount: containers.length,
      totalPlaced,
      totalItems: totalPlaced + remaining.length,  // 总待装件数
      unplacedCount: remaining.length,
      unplacedItems: remaining.map(i => i.model).filter((v, idx, arr) => arr.indexOf(v) === idx),
      avgUtilization,
      totalVolumePlaced,
      totalWeightLoaded,
      maxPayload: containerSpec.payload * containers.length
    };
  }

  // ═══════════════════════════════════════════
  // 混合箱型多箱分配（按指定顺序装填不同箱型）
  // ═══════════════════════════════════════════

  function mixedMultiContainerPack(allItems, containerSpecs, options = {}) {
    const containers = [];
    const skippedContainers = [];  // 记录被跳过的箱型及原因
    let remaining = expandItems(allItems);
    let totalVolumePlaced = 0;
    let totalWeightLoaded = 0;
    let totalPlaced = 0;

    for (let ci = 0; ci < containerSpecs.length; ci++) {
      const spec = containerSpecs[ci];
      if (remaining.length === 0) {
        // 所有货物已在之前的箱型中装完，后续箱型不再需要
        for (let sj = ci; sj < containerSpecs.length; sj++) {
          skippedContainers.push({
            code: containerSpecs[sj].code,
            nameCN: containerSpecs[sj].nameCN,
            reason: '所有货物已在之前的箱型中装完，此箱无需使用'
          });
        }
        break;
      }

      const result = packSingleContainer(remaining, spec, options);
      containers.push({
        ...result,
        containerCode: spec.code || result.containerCode || 'UNKNOWN',
        containerName: spec.nameCN || spec.name || '未知箱型'
      });

      if (result.placedItems.length === 0) {
        // 当前箱型无法装下任何货物，标记跳过
        skippedContainers.push({
          code: spec.code,
          nameCN: spec.nameCN,
          reason: '剩余货物的尺寸/门约束不符合此箱型，无法装载任何货物'
        });
        // remaining 不变，继续尝试下一个箱型
        continue;
      }

      totalPlaced += result.placedItems.length;
      totalVolumePlaced += result.totalVolume;
      totalWeightLoaded += result.totalWeight;

      remaining = result.unplacedItems.map(u => ({
        model: u.model,
        l: u.l || u.origL,
        w: u.w || u.origW,
        h: u.h || u.origH,
        weight: u.weight || 0,
        stackable: u.stackable !== undefined ? u.stackable : true,
        orientationFixed: false,
        colorIndex: u.colorIndex || 0
      }));
    }

    // 过滤空箱（未装入任何货物的箱型）
    const nonEmptyContainers = containers.filter(c => c.placedItems.length > 0);

    const avgUtilization = nonEmptyContainers.length > 0
      ? nonEmptyContainers.reduce((s, c) => s + c.utilization, 0) / nonEmptyContainers.length
      : 0;

    return {
      containerCode: 'mixed',
      containerName: '混合箱型',
      containers: nonEmptyContainers,
      containerCount: nonEmptyContainers.length,
      totalPlaced,
      totalItems: totalPlaced + remaining.length,
      unplacedCount: remaining.length,
      unplacedItems: remaining.map(i => i.model).filter((v, idx, arr) => arr.indexOf(v) === idx),
      avgUtilization,
      totalVolumePlaced,
      totalWeightLoaded,
      maxPayload: containerSpecs.reduce((s, spec) => s + spec.payload, 0),
      skippedContainers
    };
  }

  // ═══════════════════════════════════════════
  // 自检
  // ═══════════════════════════════════════════

  function selfCheck(result, container, tolerance = 0.05) {
    const errors = [];
    const warnings = [];
    const { placedItems, utilization, totalWeight } = result;

    // 1. 重叠检测 O(n²) AABB
    const overlaps = detectOverlaps(placedItems);
    if (overlaps.length > 0) {
      errors.push({
        type: 'overlap',
        message: `检测到 ${overlaps.length} 处货物重叠`,
        details: overlaps.slice(0, 5).map(o => `${o.a.model} 与 ${o.b.model} 重叠`)
      });
    }

    // 2. 超界检测
    const effDims = getEffectiveMaxDims(container, tolerance);
    const outOfBounds = [];
    for (const item of placedItems) {
      if (item.x + item.l > effDims.maxL + tolerance) outOfBounds.push(`${item.model} X方向超界`);
      if (item.y + item.w > effDims.maxW + tolerance) outOfBounds.push(`${item.model} Y方向超界`);
      if (item.z + item.h > effDims.maxH + tolerance) outOfBounds.push(`${item.model} Z方向超界`);
    }
    if (outOfBounds.length > 0) {
      errors.push({ type: 'outOfBounds', message: '货物超出容器边界', details: outOfBounds.slice(0, 5) });
    }

    // 3. 严重低利用率
    // FR 箱型因可超限，用 spaceEfficiency 评估装载紧凑度更合理
    const isFR = container.type === 'flatRack';
    const efficiency = isFR ? (result.spaceEfficiency || utilization) : utilization;
    if (efficiency < 0.2 && placedItems.length <= 2) {
      warnings.push({
        type: 'lowUtilizationCritical',
        message: `空间利用率仅${(efficiency * 100).toFixed(1)}%，且仅装入${placedItems.length}件货物`,
        suggestRecalc: true
      });
    } else if (efficiency < 0.5) {
      warnings.push({
        type: 'lowUtilization',
        message: `空间利用率${(efficiency * 100).toFixed(1)}%，低于50%`
      });
    }

    // 4. 重量检查
    if (totalWeight > container.payload + 1) {
      errors.push({
        type: 'overweight',
        message: `总重量${totalWeight.toFixed(0)}kg 超出 ${container.code} 最大载重${container.payload}kg`
      });
    }

    // 5. 门约束（逐件检查已放置货物）
    const doorViolations = [];
    for (const item of placedItems) {
      const dc = checkDoorConstraint({ l: item.l, w: item.w, h: item.h }, container, tolerance);
      if (!dc.pass) {
        doorViolations.push(item.model);
      }
    }
    if (doorViolations.length > 0) {
      errors.push({
        type: 'doorViolation',
        message: `${doorViolations.length} 件货物无法通过箱门`,
        details: doorViolations.slice(0, 5)
      });
    }

    // 6. FR 底板投影（仅 flatRack）
    // z=0: 必须至少 50% 投影与地板重合（防止"挂在侧面"）
    // z>0: 至少与地板有交集（由下方货物接力支撑）
    if (isFR) {
      const floorViolations = [];
      const floorWarningItems = [];
      for (const item of placedItems) {
        const ratio = calcFloorOverlapRatio(item.x, item.y, item.l, item.w, container);
        if (ratio <= CONSTANTS.EPS) {
          floorViolations.push(`${item.model} 底面投影未与地板重合 @(${item.x.toFixed(2)},${item.y.toFixed(2)}) z=${item.z.toFixed(2)}`);
        } else if (item.z <= CONSTANTS.EPS && ratio < MIN_FR_FLOOR_RATIO) {
          floorWarningItems.push(`${item.model} 地板覆盖率仅${(ratio*100).toFixed(0)}%（需≥${(MIN_FR_FLOOR_RATIO*100).toFixed(0)}%） @(${item.x.toFixed(2)},${item.y.toFixed(2)})`);
        }
      }
      if (floorViolations.length > 0) {
        errors.push({
          type: 'floorViolation',
          message: `${floorViolations.length} 件货物底面投影未落在地板上`,
          details: floorViolations.slice(0, 5)
        });
      }
      if (floorWarningItems.length > 0) {
        warnings.push({
          type: 'lowFloorCoverage',
          message: `${floorWarningItems.length} 件 z=0 层货物地板覆盖率不足${(MIN_FR_FLOOR_RATIO*100).toFixed(0)}%（可能悬挂于侧面）`,
          details: floorWarningItems.slice(0, 5),
          suggestRecalc: true
        });
      }
    }

    // 7. 叠放支撑率 + 四角支撑复检（仅 z>0 的货物）
    const supportViolations = [];
    const cornerViolations = [];
    for (const item of placedItems) {
      if (item.z <= CONSTANTS.EPS) continue;
      const ratio = calcSupportRatio(item.x, item.y, item.z, item.l, item.w, placedItems);
      if (ratio < SUPPORT_MIN_RATIO) {
        supportViolations.push(`${item.model} 支撑率 ${(ratio * 100).toFixed(1)}% < ${(SUPPORT_MIN_RATIO * 100).toFixed(0)}% @(${item.x.toFixed(2)},${item.y.toFixed(2)},${item.z.toFixed(2)})`);
      }
      if (!hasCornerSupport(item.x, item.y, item.z, item.l, item.w, placedItems)) {
        cornerViolations.push(`${item.model} 四角未完全支撑 @(${item.x.toFixed(2)},${item.y.toFixed(2)},${item.z.toFixed(2)})`);
      }
    }
    if (supportViolations.length > 0) {
      errors.push({
        type: 'supportViolation',
        message: `${supportViolations.length} 处叠放货物支撑率不足`,
        details: supportViolations.slice(0, 5)
      });
    }
    if (cornerViolations.length > 0) {
      errors.push({
        type: 'cornerViolation',
        message: `${cornerViolations.length} 处叠放货物四角悬空`,
        details: cornerViolations.slice(0, 5)
      });
    }

    return { errors, warnings, pass: errors.length === 0 };
  }

  /**
   * 空间哈希网格 — 用于加速大范围AABB重叠检测
   * 仅内部使用，不暴露给外部模块
   */
  class SpatialHashGrid {
    constructor(cellSize) {
      this.cellSize = cellSize;
      this.cells = new Map();
    }

    _key(cx, cy, cz) {
      return `${cx},${cy},${cz}`;
    }

    insert(item) {
      const minX = Math.floor(item.x / this.cellSize);
      const minY = Math.floor(item.y / this.cellSize);
      const minZ = Math.floor(item.z / this.cellSize);
      const maxX = Math.floor((item.x + item.l) / this.cellSize);
      const maxY = Math.floor((item.y + item.w) / this.cellSize);
      const maxZ = Math.floor((item.z + item.h) / this.cellSize);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const k = this._key(x, y, z);
            if (!this.cells.has(k)) this.cells.set(k, []);
            this.cells.get(k).push(item);
          }
        }
      }
    }

    queryNeighbors(item) {
      const minX = Math.floor(item.x / this.cellSize);
      const minY = Math.floor(item.y / this.cellSize);
      const minZ = Math.floor(item.z / this.cellSize);
      const maxX = Math.floor((item.x + item.l) / this.cellSize);
      const maxY = Math.floor((item.y + item.w) / this.cellSize);
      const maxZ = Math.floor((item.z + item.h) / this.cellSize);

      const neighbors = new Set();
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const k = this._key(x, y, z);
            const cell = this.cells.get(k);
            if (cell) {
              for (const other of cell) {
                if (other !== item) neighbors.add(other);
              }
            }
          }
        }
      }
      return Array.from(neighbors);
    }
  }

  /**
   * AABB 重叠检测
   * 小规模（<200）用O(n²)，大规模用SpatialHashGrid加速
   */
  function detectOverlaps(items) {
    const overlaps = [];
    const EPS = CONSTANTS.EPS;

    // 小规模直接O(n²)，避免网格构建开销
    if (items.length < CONSTANTS.SPATIAL_HASH_THRESHOLD) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (a.x + EPS < b.x + b.l && a.x + a.l > b.x + EPS &&
              a.y + EPS < b.y + b.w && a.y + a.w > b.y + EPS &&
              a.z + EPS < b.z + b.h && a.z + a.h > b.z + EPS) {
            overlaps.push({ a: { model: a.model, pos: `${a.x},${a.y},${a.z}` }, b: { model: b.model, pos: `${b.x},${b.y},${b.z}` } });
          }
        }
      }
      return overlaps;
    }

    // 大规模使用空间哈希
    const grid = new SpatialHashGrid(CONSTANTS.SPATIAL_HASH_CELL_SIZE);
    for (const item of items) grid.insert(item);

    const checked = new Set();
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const neighbors = grid.queryNeighbors(a);
      for (const b of neighbors) {
        const j = items.indexOf(b);
        if (j <= i) continue; // 避免重复和自比较
        const pairKey = `${i},${j}`;
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        if (a.x + EPS < b.x + b.l && a.x + a.l > b.x + EPS &&
            a.y + EPS < b.y + b.w && a.y + a.w > b.y + EPS &&
            a.z + EPS < b.z + b.h && a.z + a.h > b.z + EPS) {
          overlaps.push({ a: { model: a.model, pos: `${a.x},${a.y},${a.z}` }, b: { model: b.model, pos: `${b.x},${b.y},${b.z}` } });
        }
      }
    }

    return overlaps;
  }

  // ═══════════════════════════════════════════
  // 重算（一次，换排序策略）
  // ═══════════════════════════════════════════

  function recalibrate(allItems, container, originalResult, options) {
    const newOptions = { ...options, sortStrategy: 'weight-desc' };
    const newResult = multiContainerPack(allItems, container, newOptions);

    // 如果首次结果利用率 > 50% 且没有错误，不重算
    const hasCriticalWarnings = (originalResult.containers || []).some(c => {
      const ch = selfCheck(c, container, options.tolerance);
      return ch.warnings.some(w => w.suggestRecalc);
    });

    if (!hasCriticalWarnings && originalResult.avgUtilization >= 0.5) {
      return { ...originalResult, recalculated: false };
    }

    return { ...newResult, recalculated: true };
  }

  // ═══════════════════════════════════════════
  // 辅助函数
  // ═══════════════════════════════════════════

  function sortItems(items, strategy) {
    return items.sort((a, b) => {
      // 不可叠放优先（放在底层）
      if ((a.stackable === false) !== (b.stackable === false)) {
        return a.stackable === false ? -1 : 1;
      }
      // 按策略
      if (strategy === 'weight-desc') {
        return b.weight - a.weight || (b.l * b.w * b.h) - (a.l * a.w * a.h);
      }
      // 默认：体积降序
      return (b.l * b.w * b.h) - (a.l * a.w * a.h);
    });
  }

  function groupByModel(items) {
    const groups = [];
    const seen = new Map();
    for (const item of items) {
      if (!seen.has(item.model)) {
        seen.set(item.model, []);
      }
      seen.get(item.model).push(item);
    }
    for (const [model, gItems] of seen) {
      groups.push({ model, items: gItems });
    }
    return groups;
  }

  /**
   * 展开货物（按quantity字段复制）
   */
  function expandItems(items) {
    const expanded = [];
    for (const item of items) {
      const qty = item.quantity || 1;
      for (let i = 0; i < qty; i++) {
        expanded.push({
          ...item,
          quantity: 1
        });
      }
    }
    return expanded;
  }

  /**
   * 获取展开后的总数
   */
  function getTotalQuantity(items) {
    return items.reduce((s, i) => s + (i.quantity || 1), 0);
  }

  // ═══════════════════════════════════════════
  // 主入口
  // ═══════════════════════════════════════════

  /**
   * 计算装箱方案
   * @param {Array} items - 货物列表 [{model, l, w, h, quantity, weight, stackable, orientationFixed}]
   * @param {string|object} containerCodeOrSpec - 箱型代码或规格对象
   * @param {object} options - { tolerance: 0.05, autoRetry: true }
   * @returns {{ result, checkResult, recommendation }}
   */
  function calculate(items, containerCodeOrSpec, options = {}) {
    const tolerance = options.tolerance || 0.05;
    const autoRetry = options.autoRetry !== false;
    const mixedContainers = options.mixedContainers;

    // 混合装箱模式：按指定箱型顺序装填
    if (mixedContainers && mixedContainers.length > 0) {
      let result = mixedMultiContainerPack(items, mixedContainers, { tolerance, sortStrategy: 'volume-desc' });

      // 自检所有箱（每个箱用各自的箱型规格，按 code 查找 → index 兜底 → 首个规格兜底）
      let allChecks = result.containers.map((c, idx) => {
        const spec = mixedContainers.find(s => s.code === c.containerCode)
          || mixedContainers[idx]
          || mixedContainers[0];
        return selfCheck(c, spec, tolerance);
      });

      // selfCheck → recalibrate 闭环：若有 suggestRecalc 警告，换排序策略重算
      if (autoRetry) {
        const hasRecalcWarning = allChecks.some(c => c.warnings.some(w => w.suggestRecalc));
        if (hasRecalcWarning) {
          result = mixedMultiContainerPack(items, mixedContainers, { tolerance, sortStrategy: 'weight-desc' });
          allChecks = result.containers.map((c, idx) => {
            const spec = mixedContainers.find(s => s.code === c.containerCode)
              || mixedContainers[idx]
              || mixedContainers[0];
            return selfCheck(c, spec, tolerance);
          });
          result.recalculated = true;
        }
      }

      result.checks = allChecks;
      result.hasErrors = allChecks.some(c => c.errors.length > 0);
      result.hasWarnings = allChecks.some(c => c.warnings.length > 0);
      return result;
    }

    // 获取箱型规格
    let containerSpec;
    if (typeof containerCodeOrSpec === 'string') {
      containerSpec = CONTAINER_DB[containerCodeOrSpec];
      if (!containerSpec) throw new Error(`未知箱型: ${containerCodeOrSpec}`);
    } else if (containerCodeOrSpec && typeof containerCodeOrSpec === 'object') {
      containerSpec = containerCodeOrSpec;
    } else {
      throw new Error('无效的箱型规格：未选择或数据损坏，请返回上一步重新确认');
    }

    // 多箱分配
    let result = multiContainerPack(items, containerSpec, { tolerance, sortStrategy: 'volume-desc' });

    // 自检所有箱
    const allChecks = result.containers.map(c => selfCheck(c, containerSpec, tolerance));
    const hasCriticalWarning = allChecks.some(c => c.warnings.some(w => w.suggestRecalc));

    // 重算（如需要）
    if (autoRetry && hasCriticalWarning) {
      result = recalibrate(items, containerSpec, result, { tolerance });
      // 重新自检
      result.checks = result.containers.map(c => selfCheck(c, containerSpec, tolerance));
    } else {
      result.checks = allChecks;
    }

    result.hasErrors = result.checks.some(c => c.errors.length > 0);
    result.hasWarnings = result.checks.some(c => c.warnings.length > 0);

    return result;
  }

  // 导出
  return {
    calculate,
    packSingleContainer,
    multiContainerPack,
    mixedMultiContainerPack,
    selfCheck,
    recalibrate,
    expandItems,
    getTotalQuantity,
    // 暴露内部函数供测试
    _internal: { createSpace, cutSpace, mergeSpaces, dblScore, emsPlace, layerPack, detectOverlaps, sortItems, groupByModel, calcSupportRatio, hasCornerSupport, baseOverlapsContainerFloor }
  };
})();

window.PackingEngine = PackingEngine;