/**
 * 3D 装箱引擎 — EMS + 层铺混合算法
 * 含自检 & 重算机制
 */

const PackingEngine = (() => {
  // D-18 防护：ContainerDB 为核心依赖，未加载时给出明确错误而非裸 TypeError
  // （与 calculate() 内 window.Planner 的检查风格一致）
  const CDB = window.ContainerDB;
  if (!CDB || typeof CDB.getEffectiveMaxDims !== 'function') {
    throw new Error('ContainerDB 未加载：请确认 container-db.js 已先于 packing-engine.js 加载');
  }
  const { CONTAINER_DB, getEffectiveMaxDims, checkDoorConstraint, getOrientations, hasValidOrientationForContainer, TIER } = CDB;

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
    MAX_CONTAINERS: 100,    // 多箱分配上限（防无限循环）
    SPATIAL_HASH_THRESHOLD: 200, // 启用空间哈希的货物数量阈值
    SPATIAL_HASH_CELL_SIZE: 2.0, // 空间哈希网格单元大小（米）
    // 智能排序：重型不可叠阈值（需要独占地板空间）
    HEAVY_NONSTACKABLE_WEIGHT: 1000,  // 重量≥此值视为重型
    HEAVY_NONSTACKABLE_MIN_DIM: 2.0,  // 最长边≥此值视为大件
    // 承重检查：下方物品总重量必须 ≥ 上方物品重量 × 此系数
    SUPPORT_WEIGHT_RATIO: 0.5,
    // 尾组合并统一准入池阈值（Q3）：双维利用（容积/载重）任一低于此值视为碎片箱可参与合并。
    // 也是「孤儿箱」修复语义的关键：扩容兜底 max-placed 策略可能在段中间造出低利用零散箱，
    // 纯 run 段尾判定会漏掉它们，该门控负责捕获。
    TAIL_MAX_UTIL: 0.35
  };

  const SUPPORT_MIN_RATIO = 0.70; // 底面最小支撑覆盖率
  // FR 地板最低覆盖率：单一来源 = ContainerDB.FR_MIN_FLOOR_RATIO（2026-10-13 口径变更）
  const MIN_FR_FLOOR_RATIO = (typeof CDB.FR_MIN_FLOOR_RATIO === 'number') ? CDB.FR_MIN_FLOOR_RATIO : 0.50;

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

    // 截断占位尺寸到空间边界：
    // FR 超长货（l > 排布长度 L）贴端放置时，货物伸出箱体之外的部分
    // 不得参与子空间计算，否则会产生越界空间导致后续货物排布超界。
    const effPl = Math.min(pl, space.x + space.L - px);
    const effPw = Math.min(pw, space.y + space.W - py);

    // 右方空间 (沿X轴延伸) — 保持完整高度，覆盖空间原始Y范围
    const rx = px + effPl;
    if (rx < space.x + space.L) {
      newSpaces.push(createSpace(
        rx, space.y, space.z,
        space.x + space.L - rx, space.W, space.H,
        space.blockedAbove
      ));
    }

    // 前方空间 (沿Y轴延伸) — 限制在货物X宽度范围内
    const fy = py + effPw;
    if (fy < space.y + space.W) {
      newSpaces.push(createSpace(
        space.x, fy, space.z,
        effPl, space.y + space.W - fy, space.H,
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
          effPl, effPw, space.z + space.H - tz,
          space.blockedAbove
        ));
      }
    }

    return newSpaces;
  }

  /**
   * 合并相邻且精确对齐的空间。
   *
   * 合并规则：
   * 1. 同Z、同H、同Y、同W、X相邻 → 沿X扩展
   * 2. 同Z、同H、同X、同L、Y相邻 → 沿Y扩展
   *
   * 非精确对齐空间不能用包围盒合并，否则会制造原本不存在的可用区域。
   */
  function mergeSpaces(spaces) {
    if (spaces.length <= 1) return spaces;

    const EPS = CONSTANTS.MERGE_EPS;

    // ── 第一轮：精确对齐合并 ──
    let merged = [];
    const used = new Set();

    for (let i = 0; i < spaces.length; i++) {
      if (used.has(i)) continue;
      let current = { ...spaces[i] };
      used.add(i);

      for (let j = i + 1; j < spaces.length; j++) {
        if (used.has(j)) continue;
        const other = spaces[j];

        // 同Z同H同Y同W，X相邻
        if (Math.abs(current.z - other.z) < EPS &&
            Math.abs((current.z + current.H) - (other.z + other.H)) < EPS &&
            Math.abs(current.y - other.y) < EPS &&
            Math.abs(current.W - other.W) < EPS) {

          if (Math.abs((current.x + current.L) - other.x) < EPS) {
            current.L += other.L;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j); j = i; continue;
          }
          if (Math.abs((other.x + other.L) - current.x) < EPS) {
            current.x = other.x; current.L += other.L;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j); j = i; continue;
          }
        }

        // 同Z同H同X同L，Y相邻
        if (Math.abs(current.z - other.z) < EPS &&
            Math.abs((current.z + current.H) - (other.z + other.H)) < EPS &&
            Math.abs(current.x - other.x) < EPS &&
            Math.abs(current.L - other.L) < EPS) {

          if (Math.abs((current.y + current.W) - other.y) < EPS) {
            current.W += other.W;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j); j = i; continue;
          }
          if (Math.abs((other.y + other.W) - current.y) < EPS) {
            current.y = other.y; current.W += other.W;
            if (other.blockedAbove) current.blockedAbove = true;
            used.add(j); j = i; continue;
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
   *
   * 修复 C-NEW-1：不再"整块删除"重叠空间，而是按货物 AABB 对被重叠空间做
   * 六面切割，保留不与任何货物重叠的有效部分。原实现整删会导致
   * "merge 后部分重叠的兄弟空间"中不与货物重叠的大片有效区域永久丢失
   * （实测 15.8 m³），把本可装下的货物推成未装。
   */
  function purgeOverlapSpaces(spaces, placedItems) {
    const result = [];
    for (const space of spaces) {
      let current = [space];
      for (const placed of placedItems) {
        const next = [];
        for (const s of current) {
          // 计算 s 与 placed 的 AABB 重叠范围
          const ox = Math.max(s.x, placed.x);
          const oy = Math.max(s.y, placed.y);
          const oz = Math.max(s.z, placed.z);
          const ox2 = Math.min(s.x + s.L, placed.x + placed.l);
          const oy2 = Math.min(s.y + s.W, placed.y + placed.w);
          const oz2 = Math.min(s.z + s.H, placed.z + placed.h);

          // 无正体积重叠 → 原样保留
          if (ox >= ox2 - CONSTANTS.EPS || oy >= oy2 - CONSTANTS.EPS || oz >= oz2 - CONSTANTS.EPS) {
            next.push(s);
            continue;
          }

          // 六面切割：围绕重叠盒子 (ox,oy,oz)-(ox2,oy2,oz2) 保留非重叠部分
          // 左片：x∈[s.x, ox]
          if (ox - s.x > CONSTANTS.PRUNE_THRESHOLD) {
            next.push({ ...s, L: ox - s.x });
          }
          // 右片：x∈[ox2, s.x+s.L]
          if (s.x + s.L - ox2 > CONSTANTS.PRUNE_THRESHOLD) {
            next.push({ ...s, x: ox2, L: s.x + s.L - ox2 });
          }
          // 前片：y∈[s.y, oy]，x 限制在重叠范围 [ox, ox2]
          if (oy - s.y > CONSTANTS.PRUNE_THRESHOLD && ox2 - ox > CONSTANTS.PRUNE_THRESHOLD) {
            next.push({ ...s, x: ox, L: ox2 - ox, W: oy - s.y });
          }
          // 后片：y∈[oy2, s.y+s.W]
          if (s.y + s.W - oy2 > CONSTANTS.PRUNE_THRESHOLD && ox2 - ox > CONSTANTS.PRUNE_THRESHOLD) {
            next.push({ ...s, x: ox, L: ox2 - ox, y: oy2, W: s.y + s.W - oy2 });
          }
          // 下片：z∈[s.z, oz]
          if (oz - s.z > CONSTANTS.PRUNE_THRESHOLD && ox2 - ox > CONSTANTS.PRUNE_THRESHOLD && oy2 - oy > CONSTANTS.PRUNE_THRESHOLD) {
            next.push({ ...s, x: ox, L: ox2 - ox, y: oy, W: oy2 - oy, H: oz - s.z });
          }
          // 上片：z∈[oz2, s.z+s.H]
          if (s.z + s.H - oz2 > CONSTANTS.PRUNE_THRESHOLD && ox2 - ox > CONSTANTS.PRUNE_THRESHOLD && oy2 - oy > CONSTANTS.PRUNE_THRESHOLD) {
            next.push({ ...s, x: ox, L: ox2 - ox, y: oy, W: oy2 - oy, z: oz2, H: s.z + s.H - oz2 });
          }
        }
        current = next;
        if (current.length === 0) break; // 空间被完全覆盖，无剩余部分
      }
      result.push(...current);
    }
    return result;
  }

  // ═══════════════════════════════════════════
  // DBL 评分
  // ═══════════════════════════════════════════

  /**
   * Deepest-Bottom-Left 评分
   * 优先选择最靠近里端（深处）、最低、最左的位置
   * z 优先级最高（越低越好）；x/y 同权重（各 DBL_X_WEIGHT=DBL_Y_WEIGHT=10），
   * 由归一化数值自然排序（x 越靠里端、y 越靠左，归一化分越高）
   */
  function dblScore(spaceX, spaceY, spaceZ, container, effDims) {
    // 归一化到 [0,1]。2026-10-13：基准改用箱体真实内尺寸——FR 解除尺寸限制后
    // 有效尺寸为放开包络（FR_FREE_DIM），继续用它归一化会使 x/y/z 分数全部退化（≈1），DBL 排序失效。
    const maxL = container.L || 1;
    const maxW = container.W || 1;
    const maxH = container.H || 1;
    // xScore: 越靠近 origin（x=0，即车厢里端），分数越高
    const xScore = 1 - (spaceX / maxL);
    // yScore: 越靠近左边（y=0），分数越高
    const yScore = 1 - (spaceY / maxW);
    // zScore: 越靠近底部（z=0），分数越高
    const zScore = 1 - (spaceZ / maxH);

    // DBL 优先：z 最低 > x/y 同级（DBL_X_WEIGHT === DBL_Y_WEIGHT，由归一化数值自然排序）
    return zScore * CONSTANTS.DBL_Z_WEIGHT + xScore * CONSTANTS.DBL_X_WEIGHT + yScore * CONSTANTS.DBL_Y_WEIGHT;
  }

  // ═══════════════════════════════════════════
  // 单件 EMS 放置
  // ═══════════════════════════════════════════

  /**
   * 检查某已放置物品自身是否有支撑（z=0 视为地板支撑；否则其正下方须存在
   * 顶面高度匹配且投影相交的物品）。用于支撑传递性验证：自身悬空的物品
   * 不得作为上层货物的有效支撑物。
   */
  function hasUnderlyingSupport(p, placedItems) {
    if (p.z <= CONSTANTS.EPS) return true;
    for (const q of placedItems) {
      if (q === p) continue;
      if (Math.abs(q.z + q.h - p.z) > CONSTANTS.EPS) continue;
      const ox = Math.max(p.x, q.x);
      const oy = Math.max(p.y, q.y);
      const ox2 = Math.min(p.x + p.l, q.x + q.l);
      const oy2 = Math.min(p.y + p.w, q.y + q.w);
      if (ox < ox2 - CONSTANTS.EPS && oy < oy2 - CONSTANTS.EPS) return true;
    }
    return false;
  }

  /**
   * 计算货物底面在 (x,y,z) 处的支撑覆盖率
   * @returns {number} 0-1
   */
  function calcSupportRatio(x, y, z, l, w, placedItems, unsupportedSet = null) {
    if (z <= CONSTANTS.EPS) return 1; // 地板提供完整支撑
    const baseArea = l * w;
    if (baseArea <= CONSTANTS.EPS) return 0;

    let supported = 0;
    for (const p of placedItems) {
      if (Math.abs(p.z + p.h - z) > CONSTANTS.EPS) continue;
      // 支撑传递性：支撑物自身必须被支撑（悬空物品不计入支撑面积）。
      // unsupportedSet（可选）：复查期预计算的“悬空集合”，O(1) 跳过（2026-10-15 性能 P1-7）。
      if (unsupportedSet ? unsupportedSet.has(p) : !hasUnderlyingSupport(p, placedItems)) continue;
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
  /**
   * 检查货物底面投影是否与集装箱地板存在交集（FR 框架柜专用判据）。
   * 注意：该函数仅通过 _internal 导出供测试引用，主流程未直接调用——
   * 实际装箱路径使用 getEffectiveMaxDims 的有效尺寸 + checkDoorConstraint 完成同语义约束。
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
   * 碰撞检查：候选货物的 AABB 是否与任一已放货物相交（口径与 detectOverlaps 一致）。
   *
   * 2026-10-13：FR 跳过空间盒尺寸检查后，货物可从空间角向 +x/+y/+z 悬出放置——
   * 悬出部分可能进入相邻空间、与其中的已放货物实际相交，EMS 空间不变式在此
   * 路径上不再充分，必须在放置时显式排除。
   * @returns {boolean} true = 存在实际重叠（不可放）
   */
  function collidesWithPlaced(x, y, z, l, w, h, placedItems) {
    const EPS = CONSTANTS.EPS;
    for (const p of placedItems) {
      if (x + EPS < p.x + p.l && x + l > p.x + EPS &&
          y + EPS < p.y + p.w && y + w > p.y + EPS &&
          z + EPS < p.z + p.h && z + h > p.z + EPS) {
        return true;
      }
    }
    return false;
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
   * 承重感知支撑检查：z>0 时，校验下方物品是否能承受上方货物的重量。
   *
   * 判据（v2，修复 D-01）：
   * 1. 若下方存在声明了 maxStackWeight（单件可承受的堆叠重量 kg）的物品，
   *    以真实承重判据判定：Σ(maxStackWeight × 接触面积占比) ≥ 上方总重；
   * 2. 否则保留 SUPPORT_WEIGHT_RATIO（0.5）保守兜底（原判据）：
   *    Σ(下方自重 × 接触面积占比) ≥ 上方总重 × 0.5；
   * 3. 支撑面积下限：总接触面积必须 ≥ 上方底面积 × SUPPORT_MIN_RATIO，
   *    否则直接判失败——杜绝"200kg 泡沫承 300kg"这类支撑面积不足的荒谬组合；
   * 4. 支撑传递性：自身悬空（无底层支撑）的物品不参与承重（hasUnderlyingSupport）。
   *
   * 允许场景：600kg 钢箱（maxStackWeight=10000）→ 1500kg 设备
   * 拒绝场景：600kg 钢箱（无字段）→ 1500kg（600 < 1500×0.5）
   *           200kg 泡沫仅覆盖 50% 底面 → 任意上方货物
   *
   * @param {number} x, y, z - 候选位置（z = 下方物品顶面高度）
   * @param {number} l, w - 候选货物的朝向尺寸
   * @param {number} aboveWeight - 上方货物重量(kg)
   * @param {Array} placedItems - 已放置货物列表
   * @returns {boolean}
   */
  function checkWeightBearing(x, y, z, l, w, aboveWeight, placedItems, unsupportedSet = null) {
    if (z <= CONSTANTS.EPS) return true; // 地板支撑，通过

    const aboveArea = l * w;
    if (aboveArea <= CONSTANTS.EPS) return false;

    let realCapacity = 0;  // 声明 maxStackWeight 物品的承重能力（面积折算）
    let belowWeight = 0;   // 未声明物品的自重（面积折算）
    let supportedArea = 0; // 与上方底面的总接触面积
    let hasRealCapacity = false;

    for (const p of placedItems) {
      if (Math.abs(p.z + p.h - z) > CONSTANTS.EPS) continue;
      // 支撑传递性：自身悬空的物品不得作为承重支撑（unsupportedSet 为预计算快路径）
      if (unsupportedSet ? unsupportedSet.has(p) : !hasUnderlyingSupport(p, placedItems)) continue;
      const ox = Math.max(x, p.x);
      const oy = Math.max(y, p.y);
      const ox2 = Math.min(x + l, p.x + p.l);
      const oy2 = Math.min(y + w, p.y + p.w);
      if (ox < ox2 - CONSTANTS.EPS && oy < oy2 - CONSTANTS.EPS) {
        const contactArea = (ox2 - ox) * (oy2 - oy);
        const ratio = contactArea / aboveArea;
        supportedArea += contactArea;
        if (p.maxStackWeight != null && p.maxStackWeight >= 0) {
          realCapacity += p.maxStackWeight * ratio;
          hasRealCapacity = true;
        } else {
          belowWeight += p.weight * ratio;
        }
      }
    }

    // 支撑面积下限：总接触面积必须达到上方底面积的 SUPPORT_MIN_RATIO
    if (supportedArea < aboveArea * SUPPORT_MIN_RATIO) return false;

    // 真实承重判据优先：一旦下方有声明 maxStackWeight 的物品，以真实能力为准
    if (hasRealCapacity) return realCapacity >= aboveWeight;
    // 保守兜底（原判据）：下方总重 ≥ 上方总重 × 0.5
    return belowWeight >= aboveWeight * CONSTANTS.SUPPORT_WEIGHT_RATIO;
  }

  /**
   * 寻找最佳放置位置（遍历所有EMS空间和方向）
   * @returns {{spaceIndex, orientation, x, y, z}|null}
   */
  function findBestPlacement(item, emsSpaces, container, currentWeight, tolerance, placedItems = []) {
    let best = null;
    let bestScore = -Infinity;
    // 入口一次性检查：hasValidOrientationForContainer 为纯函数，item/container/tolerance
    // 在本函数内不变，循环内无需重复检查（原循环内同条件检查为死代码，已删除）。
    if (container && !hasValidOrientationForContainer(item, container, tolerance)) {
      return null;
    }

    const orientations = getOrientations(item);
    const minSupport = SUPPORT_MIN_RATIO;

    for (let si = 0; si < emsSpaces.length; si++) {
      const space = emsSpaces[si];

      // blockedAbove: 如果空间被标记为上方封顶，且货物要放在Z>0位置，跳过
      if (space.blockedAbove && space.z > CONSTANTS.EPS) continue;

      for (const o of orientations) {
        const isFR = container.type === 'flatRack';
        const effDims = getEffectiveMaxDims(container, tolerance);

        if (!isFR) {
          // 检查方向是否fit空间
          if (o.l > space.L + CONSTANTS.EPS || o.w > space.W + CONSTANTS.EPS || o.h > space.H + CONSTANTS.EPS) continue;

          // 检查是否超出容器边界
          if (o.l > effDims.maxL || o.w > effDims.maxW || o.h > effDims.maxH) continue;
        }
        // 2026-10-13（爹地口径）：FR 不设尺寸限制——跳过空间盒/有效尺寸的 fit 检查，
        // 改由下方「贴角放置 + 地板覆盖率 + 已放货物碰撞检查」判定可放性。

        // 检查门约束（FR 箱型无门约束）
        // 注意：传入 orientationFixed，保证固定朝向货物只用其两个水平朝向过门检查，
        // 与 CDB.checkDoorConstraint 内部口径一致（否则朝向对象缺字段会退化为 6 方向
        // 检查，含倒置朝向，可能放行物理上无法进门的水平朝向）。
        if (!isFR) {
          const doorCheck = checkDoorConstraint({ l: o.l, w: o.w, h: o.h, orientationFixed: item.orientationFixed === true }, container, tolerance);
          if (!doorCheck.pass) continue;
        }

        // 计算失败必须保留未装货物，调用方据此决定换箱/重算。

        // 重量检查
        if (currentWeight + item.weight > container.payload) continue;

        // 支撑面检查：z>0 时必须满足最低支撑覆盖率，且四角均有支撑
        let support = 1;
        if (space.z > CONSTANTS.EPS) {
          support = calcSupportRatio(space.x, space.y, space.z, o.l, o.w, placedItems);
          const cornersOk = hasCornerSupport(space.x, space.y, space.z, o.l, o.w, placedItems);
          if (support < minSupport || !cornersOk) continue;

          // 承重检查：下方物品必须能支撑上方重量
          // 防止6200kg发电机压在12kg纸箱上这类物理荒谬场景
          if (!checkWeightBearing(space.x, space.y, space.z, o.l, o.w, item.weight, placedItems)) {
            continue;
          }
        }

        // FR 框架柜专项（2026-10-13 改造：尺寸限制解除后，以物理底线为唯一判据）：
        //   ① 贴角放置的地板覆盖率——z=0 层需 ≥ FR_MIN_FLOOR_RATIO（防悬空摆放）；上层至少与地板有交集；
        //   ② 碰撞检查——跳过空间盒检查后货物可从空间角向 +x/+y/+z 悬出，
        //      悬出部分可能进入相邻空间已放货物的区域，必须显式排除实际重叠。
        if (isFR) {
          // 2026-10-15 口径（爹地）：平放限定——竖立边不得超过箱内长（禁“竖放塞小箱”，如 13m 管立于 FR）。
          if (o.h > container.L + CONSTANTS.EPS) continue;
          const floorRatio = calcFloorOverlapRatio(space.x, space.y, o.l, o.w, container);
          if (floorRatio <= CONSTANTS.EPS) continue; // 无交集，完全在底板外
          if (space.z <= CONSTANTS.EPS && floorRatio < MIN_FR_FLOOR_RATIO) continue;
          if (collidesWithPlaced(space.x, space.y, space.z, o.l, o.w, o.h, placedItems)) continue;
        }

        // 分数
        const score = dblScore(space.x, space.y, space.z, container, effDims);
        // 优先选空间利用率最高的（贴合）
        const fitX = o.l / space.L;
        const fitY = o.w / space.W;
        const fitZ = o.h / space.H;
        const fitScore = (fitX + fitY + fitZ) / 3;

        let totalScore = score + fitScore * CONSTANTS.FIT_WEIGHT;

        // FR/OT 允许超高，但运输稳定性要求优先选择低重心朝向。
        // 只惩罚超过名义箱高仍不足以阻止合法但明显不稳定的侧立/竖放。
        const hasInflatedHeight = container.type === 'flatRack' || container.type === 'openTop';
        if (hasInflatedHeight && container.H > 0) {
          const minimumHeight = Math.min(item.l, item.w, item.h);
          const avoidableHeight = Math.max(0, o.h - minimumHeight);
          const stabilityPenalty = (avoidableHeight / container.H) * CONSTANTS.FIT_WEIGHT;
          totalScore -= stabilityPenalty;

          if (o.h > container.H + CONSTANTS.EPS) {
            totalScore -= (o.h / container.H) * CONSTANTS.FIT_WEIGHT * 0.5;
          }
        }

        if (totalScore > bestScore) {
          bestScore = totalScore;
          best = {
            spaceIndex: si,
            orientation: o,
            x: space.x, y: space.y, z: space.z,
            // FR 超尺寸标记（3D 标注）：解除尺寸限制后以实际尺寸对比产生
            overLength: isFR && (o.l > container.L + CONSTANTS.EPS || o.w > container.W + CONSTANTS.EPS || o.h > container.H + CONSTANTS.EPS)
          };
        }
      }
    }

    // ═══ FR 超长货特殊分支 ═══
    // 常规空间无法容纳（货物某方向 l > 排布长度 L），但货物本身在有效尺寸上限内
    // （l ≤ L + 超长余量）：允许贴端（x=0）放置，货物伸出箱体端壁之外的部分
    // 由 3D 标记"超长"提示（对应 FR 端壁折叠装载场景）。
    if (!best && container.type === 'flatRack') {
      const effDims = getEffectiveMaxDims(container, tolerance);
      for (const o of orientations) {
        // 2026-10-15：平放限定同样约束超长贴端分支（竖立边 ≤ 箱内长）
        if (o.h > container.L + CONSTANTS.EPS) continue;
        if (o.l <= effDims.maxL + CONSTANTS.EPS &&
            o.w <= effDims.maxW + CONSTANTS.EPS &&
            o.h <= effDims.maxH + CONSTANTS.EPS) {

          for (let si = 0; si < emsSpaces.length; si++) {
            const space = emsSpaces[si];
            // 必须贴端（x≈0）且贴地（z≈0）：超长货只能从箱内起点伸出
            if (space.x > CONSTANTS.EPS) continue;
            if (space.z > CONSTANTS.EPS) continue;
            if (space.blockedAbove && space.z > CONSTANTS.EPS) continue;
            if (o.w > space.W + CONSTANTS.EPS || o.h > space.H + CONSTANTS.EPS) continue;

            // 重量检查
            if (currentWeight + item.weight > container.payload) continue;

            // FR 底板投影检查（超长部分悬出端壁外，但箱内部分必须与地板充分重合）
            const floorRatio = calcFloorOverlapRatio(space.x, space.y, o.l, o.w, container);
            if (floorRatio <= CONSTANTS.EPS) continue; // 无交集
            if (floorRatio < MIN_FR_FLOOR_RATIO) continue; // 箱内投影不足 50%（悬出过多）
            // 碰撞检查（与常规分支同口径，2026-10-13）
            if (collidesWithPlaced(space.x, space.y, space.z, o.l, o.w, o.h, placedItems)) continue;

            // 评分：贴端贴地贴左最优
            const score = dblScore(space.x, space.y, space.z, container, effDims);
            if (score > bestScore) {
              bestScore = score;
              best = { spaceIndex: si, orientation: o, x: space.x, y: space.y, z: space.z, overLength: o.l > container.L + CONSTANTS.EPS };
            }
          }
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
      origL: item.l, origW: item.w, origH: item.h,
      // 约束透传：供 selfCheck 以与放置路径一致的口径复查
      orientationFixed: item.orientationFixed === true,
      maxStackWeight: item.maxStackWeight,
      overLength: best.overLength || false   // FR 超长货（伸出端壁，需标记）
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

/**
 * 层内支撑/承重/四角支撑批量预计算（2026-10-15 性能 P1-7 优化）。
 *
 * 与逐格调用 calcSupportRatio / hasCornerSupport / checkWeightBearing 的结果一致：
 * - 支撑/承重只统计「顶面高度 == 本层 pz」且自身有底层支撑（hasUnderlyingSupport）的支撑物；
 * - 四角覆盖不区分支撑物自身是否悬空（与 hasCornerSupport 口径一致）；
 * - 累加顺序与逐格版本一致（按 placedItems 顺序），浮点求和结果相同；
 * - 同层新放置货物顶面 = pz+h ≠ pz，不会影响本层其它格子的判定。
 *
 * @returns {Uint8Array} 长度 xCount*yCount，1 = 该格子三项检查全过
 */
  function precomputeLayerSupportChecks(space, l, w, pz, xCount, yCount, itemWeight, placedItems) {
    const n = xCount * yCount;
    const ok = new Uint8Array(n);
    const aboveArea = l * w;
    if (aboveArea <= CONSTANTS.EPS) return ok;
    const supported = new Float64Array(n);   // Σ 接触面积（calcSupportRatio 分子）
    const contactSum = new Float64Array(n);  // Σ 接触面积（checkWeightBearing supportedArea）
    const belowWeight = new Float64Array(n);
    const realCapacity = new Float64Array(n);
    const hasReal = new Uint8Array(n);
    const cornerBits = new Uint8Array(n);    // bit0..3：四角被支撑物覆盖

    const gx0 = space.x, gy0 = space.y;
    const gx1 = space.x + xCount * l, gy1 = space.y + yCount * w;
    const EPS = CONSTANTS.EPS;

    for (const p of placedItems) {
      if (Math.abs(p.z + p.h - pz) > EPS) continue;
      const ix0 = Math.max(p.x, gx0), iy0 = Math.max(p.y, gy0);
      const ix1 = Math.min(p.x + p.l, gx1), iy1 = Math.min(p.y + p.w, gy1);
      if (ix0 >= ix1 - EPS || iy0 >= iy1 - EPS) continue;

      // 候选网格中与 p 可能相交的格范围（放宽一格，格内再做精确相交判定）
      const xi0 = Math.max(0, Math.floor((ix0 - gx0) / l));
      const xi1 = Math.min(xCount - 1, Math.ceil((ix1 - gx0) / l));
      const yi0 = Math.max(0, Math.floor((iy0 - gy0) / w));
      const yi1 = Math.min(yCount - 1, Math.ceil((iy1 - gy0) / w));
      // 支撑传递性（计算一次，避免逐格重复）：悬空物品不计入支撑/承重（四角除外，见上）
      const supportedOk = hasUnderlyingSupport(p, placedItems);
      const isReal = supportedOk && p.maxStackWeight != null && p.maxStackWeight >= 0;

      for (let yi = yi0; yi <= yi1; yi++) {
        for (let xi = xi0; xi <= xi1; xi++) {
          const cx = gx0 + xi * l, cy = gy0 + yi * w;
          const ox = Math.max(cx, p.x), oy = Math.max(cy, p.y);
          const ox2 = Math.min(cx + l, p.x + p.l), oy2 = Math.min(cy + w, p.y + p.w);
          if (!(ox < ox2 - EPS && oy < oy2 - EPS)) continue;
          const idx = yi * xCount + xi;
          // 四角覆盖（与 hasCornerSupport 的角点判定逐字一致；不受支撑传递性过滤）
          if (cx + EPS >= p.x && cx - EPS <= p.x + p.l && cy + EPS >= p.y && cy - EPS <= p.y + p.w) cornerBits[idx] |= 1;
          if (cx + l + EPS >= p.x && cx + l - EPS <= p.x + p.l && cy + EPS >= p.y && cy - EPS <= p.y + p.w) cornerBits[idx] |= 2;
          if (cx + EPS >= p.x && cx - EPS <= p.x + p.l && cy + w + EPS >= p.y && cy + w - EPS <= p.y + p.w) cornerBits[idx] |= 4;
          if (cx + l + EPS >= p.x && cx + l - EPS <= p.x + p.l && cy + w + EPS >= p.y && cy + w - EPS <= p.y + p.w) cornerBits[idx] |= 8;
          if (!supportedOk) continue;
          const contact = (ox2 - ox) * (oy2 - oy);
          supported[idx] += contact;
          contactSum[idx] += contact;
          const ratio = contact / aboveArea;
          if (isReal) { realCapacity[idx] += p.maxStackWeight * ratio; hasReal[idx] = 1; }
          else { belowWeight[idx] += p.weight * ratio; }
        }
      }
    }

    for (let idx = 0; idx < n; idx++) {
      // calcSupportRatio：supportRatio ≥ SUPPORT_MIN_RATIO（同除法与比较）
      if (supported[idx] / aboveArea < SUPPORT_MIN_RATIO) continue;
      // hasCornerSupport：四角均有支撑
      if ((cornerBits[idx] & 15) !== 15) continue;
      // checkWeightBearing：先支撑面积下限，再按声明承重/保守兜底判定
      if (contactSum[idx] < aboveArea * SUPPORT_MIN_RATIO) continue;
      ok[idx] = hasReal[idx]
        ? (realCapacity[idx] >= itemWeight ? 1 : 0)
        : (belowWeight[idx] >= itemWeight * CONSTANTS.SUPPORT_WEIGHT_RATIO ? 1 : 0);
    }
    return ok;
  }

  // ═══════════════════════════════════════════
  // 层铺批量放置
  // ═══════════════════════════════════════════

  function layerPack(group, container, emsSpaces, placedItems, currentWeight, tolerance) {
    const { quantity } = group;
    const item = group.item;

    let remaining = quantity;
    const placed = [];
    // 层铺门过滤必须与逐件 EMS 路径（findBestPlacement）口径一致：
    // 朝向对象显式携带 orientationFixed，避免 checkDoorConstraint 内部退化为
    // 6 方向检查（含倒置），导致固定朝向货以物理无法进门的水平朝向被放行。
    const orientations = getOrientations(item).filter(o => {
      const effDims = getEffectiveMaxDims(container, tolerance);
      if (o.l > effDims.maxL + CONSTANTS.EPS ||
          o.w > effDims.maxW + CONSTANTS.EPS ||
          o.h > effDims.maxH + CONSTANTS.EPS) return false;
      // 2026-10-15 口径：FR 平放限定（竖立边 ≤ 箱内长；禁“竖放塞小箱”）
      if (container.type === 'flatRack' && o.h > container.L + CONSTANTS.EPS) return false;
      return container.type === 'flatRack' ||
        checkDoorConstraint({ l: o.l, w: o.w, h: o.h, orientationFixed: item.orientationFixed === true }, container, tolerance).pass;
    });

    // 2026-10-15（爹地口径）：FR 长度限定——最长边超出装箱上限（柱间长+伸出容限）→ 该箱不可用
    if (container.type === 'flatRack' && typeof CDB.frLengthLimit === 'function' &&
        Math.max(item.l, item.w, item.h) > CDB.frLengthLimit(container) + CONSTANTS.EPS) {
      return { placed, remaining };
    }

    if (orientations.length === 0) return { placed, remaining };

    const canStackMore = item.stackable !== false;

    // 使用 while 循环，每次放置后重新计算最佳空间，确保利用新产生的小空间
    while (remaining > 0) {
      let bestLayout = null;

      // 同时比较空间与合法朝向，避免批量层铺因固定原始方向产生装载量断崖。
      for (const s of emsSpaces) {
        if (s.blockedAbove && s.z > CONSTANTS.EPS) continue;

        for (const orientation of orientations) {
          const xCount = Math.floor((s.L + CONSTANTS.EPS) / orientation.l);
          const yCount = Math.floor((s.W + CONSTANTS.EPS) / orientation.w);
          if (xCount === 0 || yCount === 0) continue;

          const layers = Math.floor((s.H + CONSTANTS.EPS) / orientation.h);
          if (layers === 0) continue;

          const maxLayers = canStackMore ? layers : 1;
          const capacity = Math.min(remaining, xCount * yCount * maxLayers);
          const occupiedVolume = capacity * orientation.l * orientation.w * orientation.h;
          const spaceVolume = s.L * s.W * s.H;
          const fit = spaceVolume > CONSTANTS.EPS ? occupiedVolume / spaceVolume : 0;

          if (!bestLayout || capacity > bestLayout.capacity ||
              (capacity === bestLayout.capacity && fit > bestLayout.fit)) {
            bestLayout = { space: s, orientation, xCount, yCount, maxLayers, capacity, fit };
          }
        }
      }

      if (!bestLayout) break;

      const { space: bestSpace, orientation, xCount, yCount, maxLayers } = bestLayout;
      const { l, w, h } = orientation;
      let placedThisRound = 0;

      for (let layer = 0; layer < maxLayers && remaining > 0; layer++) {
        const pzLayer = bestSpace.z + layer * h;
        // 2026-10-15（性能 P1-7 优化）：本层支撑/承重/四角支撑一次性批量预计算（与逐格调用逐位一致，
        // 见 precomputeLayerSupportChecks 注释）。原实现逐格调用 calcSupportRatio/checkWeightBearing，
        // 其内层对每个支撑物再算 hasUnderlyingSupport（O(已放件)），叠加成 O(格数×P²)≈O(P³) 的密集件
        // 爆炸（2000 件 ≈ 45s 的主因）；批量化后同一层只扫一遍已放件。
        const cellOk = pzLayer > CONSTANTS.EPS
          ? precomputeLayerSupportChecks(bestSpace, l, w, pzLayer, xCount, yCount, item.weight, placedItems)
          : null;

        for (let yi = 0; yi < yCount && remaining > 0; yi++) {
          for (let xi = 0; xi < xCount && remaining > 0; xi++) {
            const px = bestSpace.x + xi * l;
            const py = bestSpace.y + yi * w;
            const pz = pzLayer;

            // 重量检查
            if (currentWeight + item.weight > container.payload) break;

            // 支撑与承重检查（使用批量预计算结论；口径与逐格函数一致）
            if (cellOk && !cellOk[yi * xCount + xi]) continue;

            // FR 框架柜：任意层（含 z=0）货物底面必须与地板有交集
            if (container.type === 'flatRack') {
              const floorRatio = calcFloorOverlapRatio(px, py, l, w, container);
              if (floorRatio <= CONSTANTS.EPS) continue;
              if (pz <= CONSTANTS.EPS && floorRatio < MIN_FR_FLOOR_RATIO) continue;
            }

            const entry = {
              model: item.model,
              l, w, h,
              x: px, y: py, z: pz,
              weight: item.weight,
              stackable: item.stackable !== false,
              colorIndex: item.colorIndex || 0,
              origL: item.l, origW: item.w, origH: item.h,
              // 约束透传：供 selfCheck 以与放置路径一致的口径复查
              orientationFixed: item.orientationFixed === true,
              maxStackWeight: item.maxStackWeight
            };
            placed.push(entry);
            placedItems.push(entry);
            currentWeight += item.weight;
            placedThisRound++;
            remaining--;
          }
        }
      }

      if (placedThisRound === 0) break;

      if (!canStackMore) {
        for (const s of emsSpaces) {
          if (s.z >= bestSpace.z + h - CONSTANTS.EPS &&
              s.x < bestSpace.x + bestSpace.L && s.x + s.L > bestSpace.x &&
              s.y < bestSpace.y + bestSpace.W && s.y + s.W > bestSpace.y) {
            s.blockedAbove = true;
          }
        }
      }

      emsSpaces.length = 0;
      buildEMSFromPlaced(placedItems, container, emsSpaces, tolerance);
    }

    return { placed, remaining };
  }

  /**
   * 从已放置货物重建EMS空间列表
   */
  function buildEMSFromPlaced(placedItems, container, emsSpaces, tolerance) {
    // 排布范围与 packSingleContainer 一致（FR 排布长度 = 真实内长）
    const packDims = getPackSpaceDims(container, tolerance);
    emsSpaces.push(createSpace(0, 0, 0, packDims.maxL, packDims.maxW, packDims.maxH, false));

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
   * 获取排布空间的有效尺寸（EMS 初始空间范围）
   *
   * 与 getEffectiveMaxDims 的区别：
   * - 货物尺寸上限（maxL）允许 FR 超长货（L + 超长余量）通过尺寸校验；
   * - 但排布空间（packL）严格限制为真实内长 L —— 普通货物不允许排布超界，
   *   只有货物本身尺寸超长（l > L）时由 findBestPlacement 的超长分支贴端放置。
   */
  function getPackSpaceDims(container, tolerance) {
    const effDims = getEffectiveMaxDims(container, tolerance);
    if (container.type === 'flatRack') {
      // 2026-10-13：FR 解除尺寸限制后，排布空间退回箱体真实内尺寸作为几何基底；
      // 货物超出部分由「贴角放置 + 地板覆盖率 + 碰撞检查」在放置时判定（不再受空间盒限制）。
      return { maxL: container.L, maxW: container.W, maxH: container.H };
    }
    return effDims;
  }

  /**
   * 对单箱执行3D装箱
   * @param {Array} cargoItems - 展开后的货物列表（每件一个条目）
   * @param {object} container - 箱型规格
   * @param {object} options - { tolerance, sortStrategy }
   * @returns {{ placedItems, unplacedItems, utilization, weightUtil, errors, warnings }}
   */
  function packSingleContainer(cargoItems, container, options = {}) {
    // 2026-10-13 修复（审阅 P1-5）：数值参数判空统一用 == null —— 原 `options.tolerance || 0.05`
    // 会把合法的 0（零间隙）静默改写为 0.05。
    const tolerance = options.tolerance == null ? 0.05 : Number(options.tolerance);
    const sortStrategy = options.sortStrategy || 'smart';

    const effDims = getEffectiveMaxDims(container, tolerance);

    // 排序
    const sorted = sortItems([...cargoItems], sortStrategy);

    // 初始化EMS（排布范围：标准柜=有效尺寸，FR=真实内长，超长货由超长分支贴端处理）
    const packDims = getPackSpaceDims(container, tolerance);
    let emsSpaces = [createSpace(0, 0, 0, packDims.maxL, packDims.maxW, packDims.maxH, false)];
    const placedItems = [];
    let currentWeight = 0;
    const unplacedItems = [];

    // 按型号分组；部分候选策略在组级别排序，避免 quantity 大的型号被单件评分低估。
    const groups = orderGroups(groupByModel(sorted), sortStrategy);

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

    const packed = [];
    const oversized = [];
    for (const item of placedItems) {
      const bounds = getEffectiveMaxDims(container, tolerance);
      if (container.type !== 'flatRack' && (item.l > bounds.maxL + CONSTANTS.EPS || item.w > bounds.maxW + CONSTANTS.EPS || item.h > bounds.maxH + CONSTANTS.EPS)) {
        oversized.push(item);
      } else {
        packed.push(item);
      }
    }

    const packedVolume = packed.reduce((s, i) => s + i.l * i.w * i.h, 0);
    const packedWeight = packed.reduce((s, i) => s + i.weight, 0);
    const containerVol = container.L * container.W * container.H;
    // 修复 D-03：utilization 不再用 Math.min(1, …) 截断。
    // FR 超限装载（packedVolume > containerVol）保留真实比值（>1），
    // 并附加 overCapacity 标记供 UI 警示（任务卡字段名；overVolume 为兼容保留）；
    // weightedAvgUtilization 直接使用真实箱容 containerVolume，
    // 避免截断值反推容量导致跨箱平均失真。
    const rawUtil = containerVol > 0 ? packedVolume / containerVol : 0;
    const utilization = rawUtil;
    const overCapacity = packedVolume > containerVol;
    const overVolume = rawUtil > 1 + CONSTANTS.EPS;
    // 2026-10-13：FR 解除尺寸限制后不再有“有效排布空间”概念——FR 的紧凑度基准退回真实箱容
    // （普通箱维持原口径：相对扣减容差后的有效尺寸）。
    const effectiveVolume = container.type === 'flatRack'
      ? containerVol
      : effDims.maxL * effDims.maxW * effDims.maxH;
    const spaceEfficiency = effectiveVolume > 0 ? packedVolume / effectiveVolume : 0;
    const weightUtil = container.payload > 0 ? packedWeight / container.payload : 0;

    return {
      placedItems: packed,
      unplacedItems: [...unplacedItems, ...oversized],
      utilization,
      spaceEfficiency,
      weightUtil,
      totalWeight: packedWeight,
      totalVolume: packedVolume,
      containerVolume: containerVol,
      overVolume,
      overCapacity,
      containerCode: container.code || 'UNKNOWN'
    };
  }

  // ═══════════════════════════════════════════
  // 多箱连续分配
  // ═══════════════════════════════════════════

  /**
   * 按实际箱容加权的平均利用率。
   *
   * 算术平均会等权对待 20GP 与 45HQ，并让尾箱（通常利用率低）系统性拉低指标；
   * 加权口径 = Σ(已装体积) / Σ(箱容)，跨箱型可比，也避免尾箱拖尾。
   * 修复 D-03：容量累加优先使用每箱携带的真实箱容 containerVolume
   * （FR 超限装载时 utilization > 1，用 totalVolume/utilization 反推仍等于
   * 真实箱容，但显式字段更可靠）；兼容无该字段的旧对象/mock。
   */
  function weightedAvgUtilization(containers) {
    const nonEmpty = containers.filter(c => c.placedItems.length > 0);
    if (nonEmpty.length === 0) return 0;
    let packed = 0;
    let capacity = 0;
    for (const c of nonEmpty) {
      packed += c.totalVolume;
      if (c.containerVolume != null && Number.isFinite(c.containerVolume) && c.containerVolume > 0) {
        capacity += c.containerVolume;
      } else if (c.utilization > CONSTANTS.EPS) {
        capacity += c.totalVolume / c.utilization;
      }
    }
    return capacity > CONSTANTS.EPS ? packed / capacity : 0;
  }

  /**
   * 尾组级联合并（装箱后处理 pass）：
   * 将装箱序列中「跨箱型分段」末端的碎片尾箱两两重装合一。典型场景：
   * [..., 20GP 满×N][..., 20GP 尾6件][45HQ, 45HQ][20GP 尾10件] 中，
   * 两个被大块装载隔断的低利用率尾箱（6件+10件）本可并成一箱。
   *
   * 候选判定采用结构化 run 扫描：把 containers 按「连续同 containerCode」切段，
   * 每段末箱即为候选（正是被整段同型装载隔断的碎片位置）；
   * 配对失败则原样返回，天然无害。
   *
   * 正确性三支柱：
   * 1. 账目不变性 —— 只有当重装结果「全量装净」（placed 数等于输入数且 unplaced 为空）
   *    才接受合并；已装件数/体积/重量在搬运中严格守恒，调用方既有账目 throw 不受影响；
   * 2. 规格回填 —— 合并箱写回 spec 的 containerCode/name 与真实 containerVolume，
   *    保证 selfCheck 按 containerCode 匹配规格、weightedAvgUtilization 容量加权正确；
   * 3. 旋转还原 —— 重装前用 origL/origW/origH 还原原始尺寸（X-01 同款模式），
   *    规避旋转后就地改写的 l/w/h 干扰装载器排序与层铺判断。
   *
   * @param {Array} containers - 待处理的集装箱对象数组（原地修改）
   * @param {Array} specs - 可用白名单箱型规格（合并目标仅限其中）
   * @param {object} options - { tolerance, sortStrategy, mergedTags }
   *   mergedTags 会原样展开到新造的合并箱上（由调用方传入路径语义标记）
   * @returns {{ changed: boolean }} 是否发生过合并
   */
  function mergeTailContainers(containers, specs, options = {}) {
    if (!Array.isArray(containers) || containers.length < 2) return { changed: false };
    if (!Array.isArray(specs)) return { changed: false };

    // 白名单箱型去重 + tier 分级 → 容积升序：优先用最小容积箱装净，避免浪费大箱；
    // Q2 分级门控——普通干货箱（standard）永远先于特种箱（openTop→flatRack）作为合并目标，
    // 特种柜只收编普通货碎片，绝不让普通货合并进特种箱（运费成本倒挂）。
    const uniqueSpecs = [];
    const seenCodes = new Set();
    for (const spec of specs) {
      if (spec && spec.code && !seenCodes.has(spec.code)) {
        seenCodes.add(spec.code);
        uniqueSpecs.push(spec);
      }
    }
    uniqueSpecs.sort((a, b) =>
      ((TIER[a.type] ?? 99) - (TIER[b.type] ?? 99)) ||
      ((a.L * a.W * a.H) - (b.L * b.W * b.H))
    );
    if (uniqueSpecs.length === 0) return { changed: false };

    const MAX_MERGE_ROUNDS = 10; // 链式重试上限；每次成功合并净减一箱，必然早于上限终止
    const packOptions = {
      tolerance: typeof options.tolerance === 'number' ? options.tolerance : 0.05,
      sortStrategy: options.sortStrategy
    };

    // 还原原始规格快照（placedItems 的 l/w/h 是旋转后就地改写值）
    const restoreItem = (it) => ({
      ...it,
      l: it.origL != null ? it.origL : it.l,
      w: it.origW != null ? it.origW : it.w,
      h: it.origH != null ? it.origH : it.h
    });

    // Q4 两级 O(1) 预筛：试排前快拒，避免对明显装不下的组合做全量三维排布。
    // 只做总量级检查（体积×1.05 宽限 + 毛重），不做单件 fit 预检。
    const precheckFeasible = (combined, spec) => {
      let totalVolume = 0;
      let totalWeight = 0;
      for (const it of combined) {
        totalVolume += it.l * it.w * it.h;
        totalWeight += (it.weight || 0) * (it.quantity || 1);
      }
      return totalVolume <= spec.L * spec.W * spec.H * 1.05 &&
             totalWeight <= (spec.payload || Infinity);
    };

    let changed = false;
    for (let round = 0; round < MAX_MERGE_ROUNDS; round++) {
      // run 切段：收集每段末箱的下标
      const tails = [];
      let i = 0;
      while (i < containers.length) {
        let j = i;
        while (j + 1 < containers.length && containers[j + 1].containerCode === containers[i].containerCode) j++;
        tails.push(j);
        i = j + 1;
      }

      // ═══ Q3 统一准入池（孤儿箱修复核心）═══
      // 纯「段尾」判定漏掉动态扩容在段中间造出的低利用零散箱（max-placed 兜底产物），
      // 故准入条件放宽为二选一：
      //   a) 是所在 run 段末箱 —— 常规尾组碎片；
      //   b) 双维利用（容积/载重最大值）低于 TAIL_MAX_UTIL —— 孤儿箱。
      // 「全量装净」铁律不变：接受前两源箱货量守恒搬运，不改变已装总数。
      const pool = [];
      for (let idx = 0; idx < containers.length; idx++) {
        const c = containers[idx];
        if (!(c && Array.isArray(c.placedItems) && c.placedItems.length > 0)) continue;
        const isRunTail = tails.includes(idx);
        const volUtil = c.utilization ?? 0;
        const wtUtil = c.weightUtil ?? 0;
        const isFragment = Math.max(volUtil, wtUtil) < CONSTANTS.TAIL_MAX_UTIL;
        if (isRunTail || isFragment) pool.push(idx);
      }
      if (pool.length < 2) break; // 可参与合并的箱子不足两个

      // ═══ Q5-B 全对扫描择优 ═══
      // 枚举准入池内全部有序配对 × 白名单箱型，打分后取最优者执行一枚；
      // score 越小越好：tier 主导（普通箱永远赢特种箱），同 tier 内合并后利用率越高越好。
      // 扫描全程不写回 containers——只有找到可行方案才落一次 splice，杜绝脏状态。
      let bestPlan = null;
      for (let a = 0; a < pool.length; a++) {
        for (let b = a + 1; b < pool.length; b++) {
          const cA = containers[pool[a]];
          const cB = containers[pool[b]];
          const combined = [
            ...cA.placedItems.map(restoreItem),
            ...cB.placedItems.map(restoreItem)
          ];
          for (const spec of uniqueSpecs) {
            if (!precheckFeasible(combined, spec)) continue;
            const repack = packSingleContainer(combined, spec, packOptions);
            // 接受条件：全量装净 —— 绝不制造新的未装件
            if (repack.placedItems.length === combined.length &&
                Array.isArray(repack.unplacedItems) && repack.unplacedItems.length === 0) {
              const mergedUtil = Math.max(repack.utilization ?? 0, repack.weightUtil ?? 0);
              const score = (TIER[spec.type] ?? 99) * 100 - Math.round(mergedUtil * 100) / 100;
              if (!bestPlan || score < bestPlan.score) {
                bestPlan = { score, drop: [pool[a], pool[b]], repack, spec };
              }
            }
          }
        }
      }
      if (!bestPlan) break; // 本轮无可行配对，链式收敛结束

      // 落地唯一最优合并：剔除两源箱，合并箱 append 至末尾
      const dropIdx = new Set(bestPlan.drop);
      const survivors = containers.filter((_, idx) => !dropIdx.has(idx));
      survivors.push({
        ...bestPlan.repack,
        containerCode: bestPlan.spec.code,
        containerName: bestPlan.spec.nameCN || bestPlan.spec.name || '未知箱型',
        ...(options.mergedTags || {})
      });
      containers.splice(0, containers.length, ...survivors);
      changed = true;
    }
    return { changed };
  }

  function multiContainerPackOnce(allItems, containerSpec, options = {}) {
    const containers = [];
    const totalInputItems = getTotalQuantity(allItems);
    const maxContainers = options.maxContainers || CONSTANTS.MAX_CONTAINERS;
    let remaining = expandItems(allItems);

    while (remaining.length > 0 && containers.length < maxContainers) {
      const result = packSingleContainer(remaining, containerSpec, options);
      result.isInterim = true; // 未装件会在下一箱继续尝试，不视为本箱错误
      containers.push(result);

      remaining = result.unplacedItems.map(u => ({ ...u, quantity: 1 }));

      // 安全检查：如果没有任何货物被装入，说明所有剩余货物都不fit
      if (result.placedItems.length === 0) break;
    }

    const nonEmptyContainers = containers.filter(c => c.placedItems.length > 0);
    const emptyCount = containers.length - nonEmptyContainers.length;
    if (emptyCount > 0) containers.splice(0, containers.length, ...nonEmptyContainers);

    // 尾组级联合并 pass（B 方向 · 装载后处理统一接入点）。
    // 同箱型路径下所有箱共享同一 containerCode，run 切段恒为单段、候选数 < 2，
    // 合并天然不触发（防御性空转）；保留接入点保证三条装载管线的
    // 后处理语义一致。合并在汇总 reduce 与账目校验之前执行，
    // 且「全量装净」约束保证已装数不变，此处账目无需回填。
    mergeTailContainers(containers, [containerSpec], {
      tolerance: options.tolerance,
      sortStrategy: options.sortStrategy,
      mergedTags: { isInterim: true }
    });

    // 汇总
    const totalPlaced = containers.reduce((s, c) => s + c.placedItems.length, 0);
    const totalVolumePlaced = containers.reduce((s, c) => s + c.totalVolume, 0);
    const avgUtilization = weightedAvgUtilization(containers);
    const totalWeightLoaded = containers.reduce((s, c) => s + c.totalWeight, 0);

    if (totalPlaced + remaining.length !== totalInputItems) {
      throw new Error(`多箱装箱账目不一致：输入${totalInputItems}件，已装${totalPlaced}件，未装${remaining.length}件`);
    }

    return {
      containerCode: containerSpec.code,
      containerName: containerSpec.nameCN,
      containers,
      containerCount: containers.length,
      totalPlaced,
      totalItems: totalInputItems,
      unplacedCount: remaining.length,
      unplacedItems: remaining.map(i => i.model).filter((v, idx, arr) => arr.indexOf(v) === idx),
      avgUtilization,
      totalVolumePlaced,
      totalWeightLoaded,
      maxPayload: containerSpec.payload * containers.length
    };
  }

  function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleGroups(items, random) {
    const groups = groupByModel(items).map(group => ({ ...group, items: [...group.items] }));
    for (let i = groups.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [groups[i], groups[j]] = [groups[j], groups[i]];
    }
    return groups.flatMap(group => group.items);
  }

  /**
   * 逐件洗牌（非组级）：大件混装场景（如 FR 超宽超高件）需要把关键大件
   * 插在特定位置才能找到紧凑排布。组级洗牌只改变组间顺序，无法覆盖这类解。
   */
  function shuffleItems(items, random) {
    const result = items.map(i => ({ ...i }));
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function calculateContainerLowerBound(allItems, containerSpec) {
    const expanded = expandItems(allItems);
    const totalWeight = expanded.reduce((sum, item) => sum + item.weight, 0);
    const totalVolume = expanded.reduce((sum, item) => sum + item.l * item.w * item.h, 0);
    const containerVolume = containerSpec.L * containerSpec.W * containerSpec.H;
    // 只使用不会高估最优箱数的必要条件。地板面积在当前模型中不是可靠下界：
    // 轻型不可叠货允许位于上层，FR 还允许合规悬出。
    return Math.max(
      1,
      Math.ceil(totalWeight / containerSpec.payload),
      Math.ceil(totalVolume / containerVolume)
    );
  }

  function isBetterMultiContainerResult(candidate, incumbent) {
    if (!incumbent) return true;
    if (candidate.unplacedCount !== incumbent.unplacedCount) {
      return candidate.unplacedCount < incumbent.unplacedCount;
    }
    if (candidate.containerCount !== incumbent.containerCount) {
      return candidate.containerCount < incumbent.containerCount;
    }
    const candidateLast = candidate.containers.length > 0
      ? candidate.containers[candidate.containers.length - 1].utilization
      : 0;
    const incumbentLast = incumbent.containers.length > 0
      ? incumbent.containers[incumbent.containers.length - 1].utilization
      : 0;
    if (Math.abs(candidateLast - incumbentLast) > CONSTANTS.EPS) return candidateLast > incumbentLast;
    return candidate.avgUtilization > incumbent.avgUtilization + CONSTANTS.EPS;
  }

  function multiContainerPack(allItems, containerSpec, options = {}) {
    // maxContainers 不再禁用优化：Planner 混合路径以 maxContainers=1 保留"每组一箱"语义，
    // 但组内装载顺序仍应多起点择优（减少未装件 → 减少扩容兜底）。
    const shouldOptimize = options.optimize !== false &&
      options.sortStrategy == null;
    if (!shouldOptimize) return multiContainerPackOnce(allItems, containerSpec, options);

    const lowerBound = calculateContainerLowerBound(allItems, containerSpec);
    const seed = Number.isInteger(options.optimizationSeed) ? options.optimizationSeed : 20260805;
    // 扰动预算按展开件数自适应：小订单 2 次即够，大订单最多 12 次；
    // 显式传入 randomStarts 时以调用方为准（上限 20）。
    const expandedCount = getTotalQuantity(allItems);
    const defaultRandomStarts = expandedCount < 50 ? 2 : (expandedCount < 200 ? 4 : (expandedCount < 1000 ? 8 : 12));
    const randomStarts = Number.isInteger(options.randomStarts)
      ? Math.max(0, Math.min(20, options.randomStarts))
      : defaultRandomStarts;
    // 时间预算：默认 2.5s。大批量订单全跑候选可能耗时 ×10，用预算保护交互延迟。
    const maxTimeMs = Number.isFinite(options.optimizationTimeMs) && options.optimizationTimeMs >= 0
      ? options.optimizationTimeMs
      : 2500;
    const startedAt = Date.now();
    const random = createSeededRandom(seed);
    const expanded = expandItems(allItems);
    const candidates = [
      { name: 'smart', items: allItems, options: { ...options, sortStrategy: 'smart', optimize: false } },
      { name: 'group-total-volume-desc', items: allItems, options: { ...options, sortStrategy: 'group-total-volume-desc', optimize: false } },
      { name: 'small-first', items: allItems, options: { ...options, sortStrategy: 'small-first', optimize: false } },
      { name: 'big-middle', items: allItems, options: { ...options, sortStrategy: 'big-middle', optimize: false } },
      { name: 'structured-fr', items: allItems, options: { ...options, sortStrategy: 'structured-fr', optimize: false } }
    ];

    for (let i = 0; i < randomStarts; i++) {
      // 交替使用组级洗牌与逐件洗牌：组级保留同型号连续性，逐件覆盖大件插位场景。
      if (i % 2 === 0) {
        candidates.push({
          name: `seeded-group-shuffle-${i + 1}`,
          items: shuffleGroups(expanded, random),
          options: { ...options, sortStrategy: 'input-order', optimize: false }
        });
      } else {
        candidates.push({
          name: `seeded-item-shuffle-${i + 1}`,
          items: shuffleItems(expanded, random),
          options: { ...options, sortStrategy: 'input-order', optimize: false }
        });
      }
    }

    let best = null;
    let evaluated = 0;
    for (const candidate of candidates) {
      // 时间预算为软限制：检查仅在候选之间进行，当前候选一旦开始会完整跑完；
      // evaluated > 0 保证至少评估一个候选；预算耗尽后停止后续候选。
      if (evaluated > 0 && Date.now() - startedAt >= maxTimeMs) break;
      const result = multiContainerPackOnce(candidate.items, containerSpec, candidate.options);
      evaluated++;
      if (isBetterMultiContainerResult(result, best)) {
        best = result;
        best.optimization = { strategy: candidate.name, seed, evaluated, lowerBound };
      }
      if (best.unplacedCount === 0 && best.containerCount <= lowerBound) break;
    }

    best.optimization.evaluated = evaluated;
    best.optimization.randomStarts = randomStarts;
    best.optimization.timeBudgetMs = maxTimeMs;
    best.optimization.timeUsedMs = Date.now() - startedAt;
    return best;
  }

  /**
   * 邻域搜索精化：对候选解做"相邻交换"局部改进。
   *
   * 注意：对单箱"珍珠解"（如 40FR 一箱 12 件）收益有限——局部交换易陷入
   * 局部最优（实测 2000 次交换仍 11/12），广域随机重启更有效。
   * 本函数保留用于多箱场景的轻量改进，不作为单箱容量保证。
   *
   * @param {Array} allItems - 货物列表
   * @param {object} containerSpec - 箱型
   * @param {object} options - 含 sortStrategy（生成初始顺序）
   * @param {number} passes - 交换轮数
   * @returns 精化后的结果
   */
  function refineBySwap(allItems, containerSpec, options = {}, passes = 30) {
    const expanded = expandItems(allItems);
    let order = sortItems([...expanded], options.sortStrategy || 'smart');
    let bestResult = multiContainerPackOnce(order, containerSpec, { ...options, sortStrategy: 'input-order' });
    let bestPlaced = bestResult.totalPlaced || 0;
    let bestOrder = order.slice();

    const rng = createSeededRandom(Number.isInteger(options.optimizationSeed) ? options.optimizationSeed : 20260805);
    for (let pass = 0; pass < passes; pass++) {
      // 随机选两个位置交换（相邻更可能改善碎片化，但全范围更通用）
      const a = Math.floor(rng() * order.length);
      const b = Math.floor(rng() * order.length);
      if (a === b) continue;
      const trial = order.slice();
      [trial[a], trial[b]] = [trial[b], trial[a]];
      const result = multiContainerPackOnce(trial, containerSpec, { ...options, sortStrategy: 'input-order' });
      if ((result.totalPlaced || 0) > bestPlaced ||
          ((result.totalPlaced || 0) === bestPlaced && result.totalVolume > bestResult.totalVolume)) {
        bestPlaced = result.totalPlaced || 0;
        bestResult = result;
        bestOrder = trial.slice();
        order = trial.slice();
      }
      if (bestPlaced === expanded.length) break; // 全部装入即停
    }

    if (bestPlaced > 0) {
      bestResult = multiContainerPackOnce(bestOrder, containerSpec, { ...options, sortStrategy: 'input-order' });
    }
    bestResult.refined = { passes: passes, finalPlaced: bestPlaced, total: expanded.length };
    return bestResult;
  }

  /**
   * 单箱容量搜索（模拟退火）：找到"单箱最多能装几件"的近似上界。
   *
   * 背景：EMS 贪心对"大件 + FR 悬出"场景存在珍珠解（如 40FR 一箱 12 件），
   * 随机洗牌命中率约 1/5146，贪心交换卡在局部最优（11/12）。
   * 模拟退火（交换 + 移动操作 + 温度递减 + 温度重置）实测 10/10 次找到最优，
   * 平均约 0.7s——是预演"该箱型单箱实际容量"的可靠手段。
   *
   * @param {Array} allItems - 货物列表（含 quantity）
   * @param {object} containerSpec - 箱型
   * @param {object} options - { tolerance, optimizationSeed, iterations }
   * @returns {{maxPlaced: number, total: number, order: Array|null, iterations: number, ms: number}}
   */
  function searchSingleBoxCapacity(allItems, containerSpec, options = {}) {
    const tolerance = options.tolerance == null ? 0.05 : options.tolerance;
    const iterations = Number.isInteger(options.iterations) ? options.iterations : 5000;
    const expanded = expandItems(allItems);
    const total = expanded.length;
    const startedAt = Date.now();

    const evaluate = (order) => packSingleContainer(order, containerSpec, { tolerance, sortStrategy: 'input-order' }).placedItems.length;

    let seed = Number.isInteger(options.optimizationSeed) ? options.optimizationSeed : 20260805;
    let bestOrder = null;
    let bestN = 0;

    // 多起点：从几个确定性排序开始退火，提高覆盖；默认 4 起点，调用方可缩减
    const startOrders = ['smart', 'small-first', 'big-middle', 'group-total-volume-desc']
      .map(s => { try { return sortItems([...expanded], s); } catch (e) { return [...expanded]; } })
      .slice(0, Number.isInteger(options.maxStarts) ? Math.max(1, options.maxStarts) : 4);

    for (const start of startOrders) {
      const rng = createSeededRandom(seed++);
      let current = start.slice();
      let currentN = evaluate(current);
      if (currentN > bestN) { bestN = currentN; bestOrder = current.slice(); }
      if (bestN === total) break;

      let T = 5.0;
      let stagnantResets = 0;   // 温度重置后无改进的轮数
      let lastResetBest = bestN;
      for (let i = 0; i < iterations; i++) {
        // 操作：60% 交换，40% 移动（取出插入随机位）——移动是跳出局部最优的关键
        const trial = current.slice();
        if (rng() < 0.6) {
          const a = Math.floor(rng() * trial.length), b = Math.floor(rng() * trial.length);
          [trial[a], trial[b]] = [trial[b], trial[a]];
        } else {
          const a = Math.floor(rng() * trial.length);
          const [item] = trial.splice(a, 1);
          trial.splice(Math.floor(rng() * trial.length), 0, item);
        }
        const n = evaluate(trial);
        const delta = n - currentN;
        if (delta >= 0 || rng() < Math.exp(delta / T)) {
          current = trial; currentN = n;
          if (n > bestN) { bestN = n; bestOrder = trial.slice(); }
        }
        T *= 0.9995;
        if (T < 0.1) {
          T = 5.0; current = start.slice(); currentN = evaluate(current);
          if (bestN === lastResetBest) {
            stagnantResets++;
            if (stagnantResets >= 2) break; // 连续 2 轮重置无改进，该起点已收敛
          } else {
            stagnantResets = 0;
            lastResetBest = bestN;
          }
        }
        if (bestN === total) break;
      }
      if (bestN === total) break;
    }

    return {
      maxPlaced: bestN,
      total,
      order: bestOrder,
      iterations,
      ms: Date.now() - startedAt
    };
  }

  // ═══════════════════════════════════════════
  // 混合箱型多箱分配（按指定顺序装填不同箱型）
  // ═══════════════════════════════════════════

  function mixedMultiContainerPack(allItems, containerSpecs, options = {}) {
    const containers = [];
    const totalInputItems = getTotalQuantity(allItems);
    const skippedContainers = [];  // 记录被跳过的箱型及原因
    let remaining = expandItems(allItems);
    let totalVolumePlaced = 0;
    let totalWeightLoaded = 0;
    let totalPlaced = 0;
    // 自适应策略：连续多箱被不可叠碎片化时自动切换排序
    let useStackableFirst = false;

    for (let ci = 0; ci < containerSpecs.length; ci++) {
      const spec = containerSpecs[ci];
      if (remaining.length === 0) {
        for (let sj = ci; sj < containerSpecs.length; sj++) {
          skippedContainers.push({
            code: containerSpecs[sj].code,
            nameCN: containerSpecs[sj].nameCN,
            reason: '所有货物已在之前的箱型中装完，此箱无需使用'
          });
        }
        break;
      }

      // 自适应策略选择
      const boxOptions = { ...options };
      if (useStackableFirst) boxOptions.sortStrategy = 'stackable-first';

      const result = packSingleContainer(remaining, spec, boxOptions);
      containers.push({
        ...result,
        containerCode: spec.code || result.containerCode || 'UNKNOWN',
        containerName: spec.nameCN || spec.name || '未知箱型',
        isInterim: true // 本箱 unplacedItems 是移交记录（后续箱/扩容兜底继续装载），非终态错误；selfCheck 据此跳过逐箱上报，终态由 calculate() 结果级统一判定
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

      // 先计算新 remaining，再用旧 remaining 做自适应判断
      const newRemaining = result.unplacedItems.map(u => ({ ...u, quantity: 1 }));

      // 自适应检测：当前箱利用率 < 20% 且全是不可叠货 → 下一箱切换 stackable-first
      const hadStackableBefore = remaining.some(i => i.stackable !== false);
      const hasStackableAfter = newRemaining.some(i => i.stackable !== false);
      const allPlacedAreNonStackable = result.placedItems.length > 0 &&
        result.placedItems.every(p => p.stackable === false);

      if (result.utilization < 0.2 && allPlacedAreNonStackable && hadStackableBefore) {
        useStackableFirst = true;
      } else if (useStackableFirst && !hasStackableAfter) {
        // 仅当剩余货物中不再有可叠货时才退出 stackable-first 模式
        useStackableFirst = false;
      }

      remaining = newRemaining;
    }

    // ═══ 动态扩容兜底：保证"能装必装" ═══
    // 核心原则：未装只允许发生在"单件尺寸/约束超出所有箱型"时。
    // 若剩余货物仍能装入某个可用箱型，则追加该箱型继续装载，
    // 直到全部装完，或剩余货物确实无法装入任何箱型。
    // 箱型选择策略：容积升序 + 全装优先（优先选能一次装完的最小箱，避免浪费大箱）。
    if (remaining.length > 0) {
      const MAX_EXPAND_ROUNDS = 30; // 扩容轮次上限（防异常死循环）
      const expandOptions = { ...options };
      if (useStackableFirst) expandOptions.sortStrategy = 'stackable-first';
      // 去重并按 tier 分级 → 容积升序排列（普通干货箱优先，特种箱按开顶→框架兜底）
      const uniqueSpecs = [];
      const seenCodes = new Set();
      for (const spec of containerSpecs) {
        if (!seenCodes.has(spec.code)) { seenCodes.add(spec.code); uniqueSpecs.push(spec); }
      }
      uniqueSpecs.sort((a, b) =>
        ((TIER[a.type] ?? 99) - (TIER[b.type] ?? 99)) ||
        ((a.L * a.W * a.H) - (b.L * b.W * b.H))
      );

      let expanded = true;
      for (let round = 0; round < MAX_EXPAND_ROUNDS && remaining.length > 0 && expanded; round++) {
        expanded = false;
        // 1) 全装优先：找能一次装下全部剩余的最小容积箱型
        let best = null;
        for (const spec of uniqueSpecs) {
          const r = packSingleContainer(remaining, spec, expandOptions);
          if (r.placedItems.length === 0) continue;
          if (r.placedItems.length === remaining.length) {
            best = { spec, r };
            break; // 全装即最优（最小容积优先）
          }
          // 2) 次优：记录装下最多件的箱型
          if (!best || r.placedItems.length > best.r.placedItems.length) {
            best = { spec, r };
          }
        }
        if (best) {
          containers.push({
            ...best.r,
            containerCode: best.spec.code || best.r.containerCode || 'UNKNOWN',
            containerName: best.spec.nameCN || best.spec.name || '未知箱型',
            isExpand: true, // 扩容箱标记
            isInterim: true // 同主循环：若本轮仍有剩余件则属移交记录；末轮扩容箱的真未装由 calculate() 结果级统一上报
          });
          totalPlaced += best.r.placedItems.length;
          totalVolumePlaced += best.r.totalVolume;
          totalWeightLoaded += best.r.totalWeight;
          remaining = best.r.unplacedItems.map(u => ({ ...u, quantity: 1 }));
          expanded = true;
        }
      }
    }

    // 尾组级联合并 pass（B 方向 · 混合路径接入点）：
    // 主循环 + 动态扩容兜底完成后，将「连续同箱型段」末端的碎片尾箱两两合一。
    // 「全量装净」约束保证已装件数/体积/重量在搬运中严格守恒，
    // 上方增量累计器（totalPlaced 等）无需回填；排序策略与扩容兜底保持一致。
    // 合并产物同样打 isInterim：unplacedItems 属中间态记录，终态由结果级统一判定（对齐 :1187 单箱型路径样例）。
    mergeTailContainers(containers, containerSpecs, {
      tolerance: options.tolerance,
      sortStrategy: useStackableFirst ? 'stackable-first' : options.sortStrategy,
      mergedTags: { isInterim: true }
    });

    // 过滤空箱（未装入任何货物的箱型）
    const nonEmptyContainers = containers.filter(c => c.placedItems.length > 0);

    const avgUtilization = weightedAvgUtilization(nonEmptyContainers);

    if (totalPlaced + remaining.length !== totalInputItems) {
      throw new Error(`混合装箱账目不一致：输入${totalInputItems}件，已装${totalPlaced}件，未装${remaining.length}件`);
    }

    return {
      containerCode: 'mixed',
      containerName: '混合箱型',
      containers: nonEmptyContainers,
      containerCount: nonEmptyContainers.length,
      totalPlaced,
      totalItems: totalInputItems,
      unplacedCount: remaining.length,
      unplacedItems: remaining.map(i => i.model).filter((v, idx, arr) => arr.indexOf(v) === idx),
      avgUtilization,
      totalVolumePlaced,
      totalWeightLoaded,
      maxPayload: nonEmptyContainers.reduce((s, c) => {
        const spec = containerSpecs.find(candidate => candidate.code === c.containerCode);
        return s + (spec ? spec.payload : 0);
      }, 0),
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
    const weightUtil = container.payload > 0 ? totalWeight / container.payload : 0;

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

    // 3. 低利用率
    // FR 箱型因可超限，用 spaceEfficiency 评估装载紧凑度更合理。
    // 修复（用户案例：700件×600kg 重货，载重打满后体积利用率仅12.9%）：
    // 载重利用率接近上限时，体积低是物理必然（重货密度 > 箱容密度），
    // 不应再报"空间利用率低"警告——改为提示载重已饱和、瓶颈在重量。
    const isFR = container.type === 'flatRack';
    const efficiency = isFR ? (result.spaceEfficiency || utilization) : utilization;
    const weightSaturated = weightUtil >= 0.9; // 载重≥90% 视为重量瓶颈
    if (weightSaturated && efficiency < 0.5) {
      warnings.push({
        type: 'weightBottleneck',
        message: `载重已达上限（${(weightUtil * 100).toFixed(1)}%），体积利用率${(efficiency * 100).toFixed(1)}%属重货正常水平——箱数受重量限制而非容积`
      });
    } else if (efficiency < 0.2 && placedItems.length <= 2) {
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
    // 放置记录已透传 orientationFixed，复查口径与放置路径一致（修复 H1）：
    // 固定朝向货只用两个水平朝向过门检查，不因"倒置可过门"而放行。
    const doorViolations = [];
    for (const item of placedItems) {
      const dc = checkDoorConstraint({ l: item.l, w: item.w, h: item.h, orientationFixed: item.orientationFixed === true }, container, tolerance);
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

    // 7. 叠放支撑率 + 四角支撑 + 承重复检（仅 z>0 的货物）
    // 2026-10-15（性能 P1-7 优化）：复查期 placedItems 冻结 → 预计算“悬空集合”一次，
    // 供 calcSupportRatio/checkWeightBearing O(1) 跳过；原实现逐件复查嵌套 hasUnderlyingSupport
    // 形成 O(P³) 级开销（2000 件密集件复查 ≈ 20s 的主因）。
    const unsupportedSet = new Set();
    for (const p of placedItems) {
      if (p.z > CONSTANTS.EPS && !hasUnderlyingSupport(p, placedItems)) unsupportedSet.add(p);
    }
    const supportViolations = [];
    const cornerViolations = [];
    const bearingViolations = [];
    for (const item of placedItems) {
      if (item.z <= CONSTANTS.EPS) continue;
      const ratio = calcSupportRatio(item.x, item.y, item.z, item.l, item.w, placedItems, unsupportedSet);
      if (ratio < SUPPORT_MIN_RATIO) {
        supportViolations.push(`${item.model} 支撑率 ${(ratio * 100).toFixed(1)}% < ${(SUPPORT_MIN_RATIO * 100).toFixed(0)}% @(${item.x.toFixed(2)},${item.y.toFixed(2)},${item.z.toFixed(2)})`);
      }
      if (!hasCornerSupport(item.x, item.y, item.z, item.l, item.w, placedItems)) {
        cornerViolations.push(`${item.model} 四角未完全支撑 @(${item.x.toFixed(2)},${item.y.toFixed(2)},${item.z.toFixed(2)})`);
      }
      if (!checkWeightBearing(item.x, item.y, item.z, item.l, item.w, item.weight, placedItems, unsupportedSet)) {
        bearingViolations.push(`${item.model} 下方货物承重不足 @(${item.x.toFixed(2)},${item.y.toFixed(2)},${item.z.toFixed(2)})`);
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
    if (bearingViolations.length > 0) {
      errors.push({
        type: 'bearingViolation',
        message: `${bearingViolations.length} 处叠放货物承重不足`,
        details: bearingViolations.slice(0, 5)
      });
    }

    // 8. 货物未装入：这是计算错误/约束失败，不是普通提示。
    // 中间箱（isInterim）的未装件会移交后续箱继续尝试，不在此处报错，
    // 最终剩余未装由 calculate() 在结果级统一上报。
    if (!result.isInterim && result.unplacedItems && result.unplacedItems.length > 0) {
      errors.push({
        type: 'unplaced',
        message: `${result.unplacedItems.length} 件货物未能装入 ${container.code}`,
        details: result.unplacedItems.slice(0, 10).map(item => item.model || '未知货物')
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

  /**
   * D-02 重算采纳判定纯函数。
   * 对比新旧结果的总装载件数 + 空间利用率：
   * 新结果利用率显著更优 → 采纳；利用率持平且已装件数不减少 → 采纳；
   * 其余情况（新结果不优于旧结果）→ 保留原结果。
   * 独立成纯函数，便于单测直接构造新旧结果断言采纳/保留方向。
   * @param {object} originalResult - 首次结果（含 avgUtilization / totalPlaced）
   * @param {object} newResult - 换排序策略后的重算结果
   * @param {number} [eps] - 利用率比较容差，默认 CONSTANTS.EPS
   * @returns {boolean} true=采纳新结果，false=保留原结果
   */
  function shouldAdoptRecalc(originalResult, newResult, eps) {
    const EPS = eps == null ? CONSTANTS.EPS : eps;
    const newUtil = Number.isFinite(newResult.avgUtilization) ? newResult.avgUtilization : 0;
    const oldUtil = Number.isFinite(originalResult.avgUtilization) ? originalResult.avgUtilization : 0;
    const newPlaced = Number.isFinite(newResult.totalPlaced) ? newResult.totalPlaced : 0;
    const oldPlaced = Number.isFinite(originalResult.totalPlaced) ? originalResult.totalPlaced : 0;
    const utilBetter = newUtil > oldUtil + EPS;
    const utilTie = Math.abs(newUtil - oldUtil) <= EPS;
    return utilBetter || (utilTie && newPlaced >= oldPlaced);
  }

  function recalibrate(allItems, container, originalResult, options) {
    const newOptions = { ...options, sortStrategy: 'weight-desc', optimize: false };
    const newResult = multiContainerPack(allItems, container, newOptions);

    // 如果首次结果利用率 > 50% 且没有错误，不重算
    const hasCriticalWarnings = (originalResult.containers || []).some(c => {
      const ch = selfCheck(c, container, options.tolerance);
      return ch.warnings.some(w => w.suggestRecalc);
    });

    if (!hasCriticalWarnings && originalResult.avgUtilization >= 0.5) {
      return { ...originalResult, recalculated: false, recalcSkipped: false };
    }

    // 修复 D-02：重算结果不再无条件替换。
    // 判定逻辑收敛到纯函数 shouldAdoptRecalc（对比总装载件数 + 空间利用率），
    // 仅当新结果不差于旧结果时才替换；更差时保留原结果并标注 recalcSkipped。
    if (shouldAdoptRecalc(originalResult, newResult, CONSTANTS.EPS)) {
      return { ...newResult, recalculated: true, recalcSkipped: false };
    }
    return { ...originalResult, recalculated: false, recalcSkipped: true };
  }

  // ═══════════════════════════════════════════
  // 辅助函数
  // ═══════════════════════════════════════════

  function sortItems(items, strategy) {
    if (strategy === 'input-order' || strategy === 'group-total-volume-desc') {
      return items;
    }

    // structured-fr：FR 悬出场景的显式结构化顺序（直接返回排序结果，不走 comparator）。
    // 经验证可装 40FR 一箱 12 件的排列：前段窄矮件（宽≤1.6 且 高≤2.0，铺满 y 悬出区）
    // → 两个最大不可叠件（体积降序，占中段）→ 剩余件（宽度降序收尾）。
    // 这是对"大件 + 超宽悬出"场景的定向启发，无法被通用排序规则复现。
    if (strategy === 'structured-fr') {
      const maxDim = (item) => Math.max(item.l, item.w, item.h);
      const volume = (item) => item.l * item.w * item.h;
      const list = [...items];
      list.sort((a, b) => volume(b) - volume(a));
      const middle = list.filter(it => it.stackable === false && maxDim(it) > 2.5).slice(0, 2);
      // front：可叠小件（≤1.2）+ 不可叠窄矮件（宽≤1.6 且 高≤2.0，如 KT-800）——先铺前段
      const front = list.filter(it =>
        (it.stackable !== false && maxDim(it) <= 1.2) ||
        (it.stackable === false && it.w <= 1.6 && it.h <= 2.0 && !middle.includes(it))
      );
      const back = list.filter(it => !middle.includes(it) && !front.includes(it));
      front.sort((a, b) => b.w - a.w);
      middle.sort((a, b) => volume(b) - volume(a));
      back.sort((a, b) => b.w - a.w);
      return [...front, ...middle, ...back];
    }

    return items.sort((a, b) => {
      // ── smart 策略：三级分组，解决异构混装碎片化问题 ──
      // 层1: 重型不可叠（需独占连续地板空间）→ 最先装
      // 层2: 可叠货物（填隙、叠高）→ 第二梯队
      // 层3: 轻型不可叠（可放在可叠货物上方）→ 最后装
      if (strategy === 'smart') {
        const tier = (item) => {
          if (item.stackable === false) {
            const maxDim = Math.max(item.l, item.w, item.h);
            if (item.weight >= CONSTANTS.HEAVY_NONSTACKABLE_WEIGHT ||
                maxDim >= CONSTANTS.HEAVY_NONSTACKABLE_MIN_DIM) {
              return 1; // 重型不可叠，需地板
            }
            return 3; // 轻型不可叠，可放顶层
          }
          return 2; // 可叠
        };
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;
        // 同层内体积降序
        return (b.l * b.w * b.h) - (a.l * a.w * a.h);
      }

      // ── stackable-first 策略：可叠优先（低利用率箱的兜底策略）──
      // 当上一箱空间被不可叠货物碎片化后，下一箱优先堆叠可叠货
      if (strategy === 'stackable-first') {
        const tier = (item) => {
          if (item.stackable !== false) return 1; // 可叠优先
          const maxDim = Math.max(item.l, item.w, item.h);
          if (item.weight >= CONSTANTS.HEAVY_NONSTACKABLE_WEIGHT ||
              maxDim >= CONSTANTS.HEAVY_NONSTACKABLE_MIN_DIM) {
            return 2; // 重型不可叠第二
          }
          return 3; // 轻型不可叠最后
        };
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;
        return (b.l * b.w * b.h) - (a.l * a.w * a.h);
      }

      // ── small-first 策略：小件/可叠件优先填充前段，大件靠后 ──
      // 针对 FR 超宽悬出场景：大件（如 2.5×2.75×2.8 真空室）先放会占满
      // 前段并割裂空间，导致小件无法进入其身后。先铺矮件/可叠件可让
      // 大件落在中段，小件收尾——这是 40FR 一箱 12 件解的结构。
      if (strategy === 'small-first') {
        const maxDim = (item) => Math.max(item.l, item.w, item.h);
        const tier = (item) => {
          if (item.stackable !== false) return 1; // 可叠小件最先（能叠高，填充灵活）
          const d = maxDim(item);
          if (d <= 1.6) return 2;   // 小不可叠次之
          if (d <= 2.5) return 3;   // 中不可叠
          return 4;                 // 大不可叠最后
        };
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;
        // 同级：体积升序（小件先）
        return (a.l * a.w * a.h) - (b.l * b.w * b.h);
      }

      // ── big-middle 策略：小件先铺前段 → 两个最大件 → 中件 → 窄件 → 小件收尾 ──
      // 已验证：该顺序对"大件+FR 悬出"场景能稳定装下（40FR 一箱 12 件）。
      // 与 small-first 的差异：大不可叠件（真空泵组/真空室）放在"小不可叠"之后
      // 而非最后——前段由 KT-800 等中件铺满后，最大件落在中段悬出区。
      if (strategy === 'big-middle') {
        const maxDim = (item) => Math.max(item.l, item.w, item.h);
        const tier = (item) => {
          const d = maxDim(item);
          if (item.stackable !== false) return d <= 1.2 ? 1 : 5; // 可叠小件最前，可叠大件最后
          if (d <= 1.6) return 2;    // 小不可叠（70泵/分子泵）
          if (d <= 2.5) return 4;    // 中不可叠（高阀/炉体底架）
          return 3;                  // 大不可叠（真空泵组/真空室/控制柜）——中段！
        };
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;
        // 同级：体积升序（小件先）
        return (a.l * a.w * a.h) - (b.l * b.w * b.h);
      }

      // ── 原有策略：不可叠优先 → 体积/重量降序 ──
      if ((a.stackable === false) !== (b.stackable === false)) {
        return a.stackable === false ? -1 : 1;
      }
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

  function orderGroups(groups, strategy) {
    if (strategy !== 'group-total-volume-desc') return groups;
    return [...groups].sort((a, b) => {
      const totalVolume = group => group.items.reduce((sum, item) => sum + item.l * item.w * item.h, 0);
      return totalVolume(b) - totalVolume(a);
    });
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
    return items.reduce((s, i) => {
      const qty = Number(i.quantity == null ? 1 : i.quantity);
      return s + (Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0);
    }, 0);
  }

  function validateCalculationInput(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('货物列表为空');
    }
    for (const item of items) {
      const dims = [item.l, item.w, item.h, item.weight].map(Number);
      if (dims.some(v => !Number.isFinite(v)) || dims[0] <= 0 || dims[1] <= 0 || dims[2] <= 0 || dims[3] < 0) {
        throw new Error(`${item.model || '未知货物'} 的尺寸或重量无效`);
      }
      const qty = Number(item.quantity == null ? 1 : item.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error(`${item.model || '未知货物'} 的数量必须为正整数`);
      }
      // X-02 防护：超大数量会撑爆展开件数（内存/耗时失控），超过单订单上限直接报错
      if (qty > 1000000) {
        throw new Error(`${item.model || '未知货物'} 的数量超过单订单上限（1000000）`);
      }
    }
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
    validateCalculationInput(items);
    const tolerance = options.tolerance == null ? 0.05 : Number(options.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new Error('操作间隙必须为非负数');
    }
    const autoRetry = options.autoRetry !== false;
    const mixedContainers = options.mixedContainers;

    // 混合装箱模式：使用 Planner 分配层进行全局分组分配
    if (mixedContainers && mixedContainers.length > 0) {
      const planner = window.Planner;
      if (!planner || typeof planner.planContainerAssignment !== 'function') {
        throw new Error('Planner 未加载，无法执行混合装箱');
      }
      const plan = planner.planContainerAssignment(items, mixedContainers);

      // 如果 Planner 没有产生任何分配，回退到原始贪心法
      if (plan.assignments.length === 0) {
        let result = mixedMultiContainerPack(items, mixedContainers, { tolerance, sortStrategy: 'smart' });
        let allChecks = result.containers.map((c, idx) => {
          const spec = mixedContainers.find(s => s.code === c.containerCode) || mixedContainers[idx] || mixedContainers[0];
          return selfCheck(c, spec, tolerance);
        });
        result.checks = allChecks;
        // fallback 分支同样需要上报未装错误：所有货物都无法分配时（如超限超所有箱型），
        // 主混合路径的 unplaced 上报在此不生效，缺失会表现为 hasErrors=false 且无任何提示。
        if (result.unplacedCount > 0) {
          result.checks.push({
            errors: [{ type: 'unplaced', message: `${result.unplacedCount} 件货物未能装入任何可用箱型` }],
            warnings: []
          });
        }
        result.hasErrors = result.checks.some(c => c.errors.length > 0);
        result.hasWarnings = allChecks.some(c => c.warnings.length > 0);
        result.plannerFallback = true;
        return result;
      }

      // 逐组调用 Packer 试装；每组对应一个候选箱，不能产出比用户选择更多的箱子。
      // 某组一箱装不下时，剩余件留在未装列表，由最终结果级统一上报。
      const containers = [];
      let allUnplaced = [...plan.unassigned];
      const availableByCode = new Map(mixedContainers.map(spec => [spec.code, spec]));

      for (const assignment of plan.assignments) {
        const spec = availableByCode.get(assignment.containerCode);
        if (!spec) {
          allUnplaced.push(...assignment.items);
          continue;
        }

        const assignmentResult = multiContainerPack(assignment.items, spec, {
          tolerance,
          maxContainers: 1,
          optimizationSeed: options.optimizationSeed
        });

        for (const packedContainer of assignmentResult.containers) {
          if (packedContainer.placedItems.length === 0) continue;
          containers.push({
            ...packedContainer,
            containerCode: spec.code,
            containerName: spec.nameCN || spec.name || '未知箱型',
            plannerReason: assignment.reason
          });
        }

        if (assignmentResult.unplacedCount > 0) {
          // 按"输入件数 - 已装件数"差量找回未装件。
          // 不能用 unplacedItems（model 名去重列表）计数——它会丢失数量，
          // 例如 300 件 Carton 装 280 件时只剩 ['Carton']，导致 19 件静默消失。
          // 修复 X-01：计数键为 (model + 尺寸签名)，同型号多尺寸时找回规格
          // 与实际未装件一致，杜绝"已装大件混入找回清单"的幽灵件。
          const sizeKeyOf = (it) => {
            const l = (it.origL != null ? it.origL : it.l).toFixed(4);
            const w = (it.origW != null ? it.origW : it.w).toFixed(4);
            const h = (it.origH != null ? it.origH : it.h).toFixed(4);
            return `${l}x${w}x${h}`;
          };
          const itemKeyOf = (it) => `${it.model}|${sizeKeyOf(it)}`;
          const placedByKey = new Map();
          for (const packed of assignmentResult.containers) {
            for (const item of packed.placedItems) {
              const key = itemKeyOf(item);
              placedByKey.set(key, (placedByKey.get(key) || 0) + 1);
            }
          }
          const missingByKey = new Map();
          for (const item of assignment.items) {
            const key = itemKeyOf(item);
            missingByKey.set(key, (missingByKey.get(key) || 0) + 1);
          }
          for (const [key, count] of missingByKey) {
            missingByKey.set(key, count - (placedByKey.get(key) || 0));
          }
          for (const item of assignment.items) {
            const key = itemKeyOf(item);
            const missing = missingByKey.get(key) || 0;
            if (missing > 0) {
              allUnplaced.push(item);
              missingByKey.set(key, missing - 1);
            }
          }
        }
      }

      // ═══ 动态扩容兜底：保证"能装必装" ═══
      // Planner 分组可能低估箱数（如不可叠货物受地板面积约束），
      // 组分配后若仍有剩余货物能装入某个可用箱型，追加该箱型补装，
      // 直到全部装完或剩余货物确实无法装入任何箱型。
      // 箱型选择策略：容积升序 + 全装优先（避免浪费大箱，如 40GP 能装完就不必用 45HQ）。
      if (allUnplaced.length > 0) {
        const MAX_EXPAND_ROUNDS = 30;
        // 去重并按 tier 分级 → 容积升序排列（普通干货箱优先，特种箱按开顶→框架兜底）
        const uniqueSpecs = [];
        const seenCodes = new Set();
        for (const spec of mixedContainers) {
          if (!seenCodes.has(spec.code)) { seenCodes.add(spec.code); uniqueSpecs.push(spec); }
        }
        uniqueSpecs.sort((a, b) =>
          ((TIER[a.type] ?? 99) - (TIER[b.type] ?? 99)) ||
          ((a.L * a.W * a.H) - (b.L * b.W * b.H))
        );

        let expanded = true;
        for (let round = 0; round < MAX_EXPAND_ROUNDS && allUnplaced.length > 0 && expanded; round++) {
          expanded = false;
          let best = null;
          for (const spec of uniqueSpecs) {
            // 用 packSingleContainer（返回对象型 unplacedItems）；
            // multiContainerPack 的 unplacedItems 是 model 字符串数组，无法继续装载
            const r = packSingleContainer(allUnplaced, spec, { tolerance, sortStrategy: 'smart' });
            if (r.placedItems.length === 0) continue;
            if (r.placedItems.length === allUnplaced.length) {
              best = { spec, r };
              break; // 全装即最优（最小容积优先）
            }
            if (!best || r.placedItems.length > best.r.placedItems.length) {
              best = { spec, r };
            }
          }
          if (best) {
            containers.push({
              ...best.r,
              containerCode: best.spec.code,
              containerName: best.spec.nameCN || best.spec.name || '未知箱型',
              plannerReason: '扩容补装'
            });
            allUnplaced = best.r.unplacedItems.map(u => ({ ...u, quantity: 1 }));
            expanded = true;
          }
        }
      }

      // 尾组级联合并 pass（B 方向 · Planner 分支接入点）：
      // 分组装载 + 扩容兜底完成后，对「连续同箱型段」末端的碎片尾箱做两两合一。
      // 「全量装净」约束保证已装件数守恒，allUnplaced 与 accountedUnplaced 的
      // 差值校验（及后续 throw）不受影响；合并箱回填 spec 编码/名称，
      // availableByCode 反查 maxPayload 与 selfCheck 匹配均保持正确。
      mergeTailContainers(containers, mixedContainers, {
        tolerance,
        sortStrategy: 'smart',
        mergedTags: { plannerReason: '尾组合并' }
      });

      const totalPlaced = containers.reduce((s, c) => s + c.placedItems.length, 0);
      const inputTotal = getTotalQuantity(items);
      const accountedUnplaced = Math.max(0, inputTotal - totalPlaced);
      if (allUnplaced.length !== accountedUnplaced) {
        throw new Error(`装箱结果账目不一致：输入${inputTotal}件，已装${totalPlaced}件，未装记录${allUnplaced.length}件`);
      }

      let result = {
        containerCode: 'mixed',
        containerName: '混合箱型（Planner分配）',
        containers,
        containerCount: containers.length,
        totalPlaced,
        totalItems: inputTotal,
        unplacedCount: allUnplaced.length,
        unplacedItems: allUnplaced.map(i => i.model || i.name || '未知').filter((v, idx, arr) => arr.indexOf(v) === idx),
        avgUtilization: weightedAvgUtilization(containers),
        totalVolumePlaced: containers.reduce((s, c) => s + (c.totalVolume || 0), 0),
        totalWeightLoaded: containers.reduce((s, c) => s + (c.totalWeight || 0), 0),
        maxPayload: containers.reduce((s, c) => {
          const spec = availableByCode.get(c.containerCode);
          return s + (spec ? spec.payload : 0);
        }, 0)
      };

      // 自检所有箱
      let allChecks = result.containers.map(c => {
        const spec = mixedContainers.find(s => s.code === c.containerCode);
        return selfCheck(c, spec, tolerance);
      });

      // Planner 路径不自动回退贪心法 — Planner 分配是有意为之的
      result.checks = allChecks;
      if (result.unplacedCount > 0) {
        result.checks.push({
          errors: [{ type: 'unplaced', message: `${result.unplacedCount} 件货物未能装入任何可用箱型` }],
          warnings: []
        });
      }
      result.hasErrors = result.checks.some(c => c.errors.length > 0);
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
      // 修复 C-NEW-3：容器规格对象入口校验。
      // L/W/H/payload 任一为 NaN/≤0/非有限数时，重量/体积约束会静默失效
      // （如 payload:NaN 使重量比较恒为 false，超重货全装且 hasErrors=false）。
      // 校验失败一律抛明确业务错误（与 validateCalculationInput 风格一致），
      // 不做静默回退——用户传入的非法规格必须显式暴露。字符串 code 路径不受影响。
      const specChecks = [
        { field: 'L', value: Number(containerSpec.L) },
        { field: 'W', value: Number(containerSpec.W) },
        { field: 'H', value: Number(containerSpec.H) },
        { field: 'payload', value: Number(containerSpec.payload) }
      ];
      const invalidFields = specChecks.filter(s => !Number.isFinite(s.value) || s.value <= 0);
      if (invalidFields.length > 0) {
        throw new Error(`箱型规格无效：${invalidFields.map(s => `${s.field}=${containerSpec[s.field]}`).join(', ')} 必须为正数`);
      }
    } else {
      throw new Error('无效的箱型规格：未选择或数据损坏，请返回上一步重新确认');
    }

    // 多箱分配
    let result = multiContainerPack(items, containerSpec, {
      tolerance,
      optimizationSeed: options.optimizationSeed,
      randomStarts: options.randomStarts,
      optimize: options.optimize
    });

    // 自检所有箱；未装货物本身即计算失败（约束不满足），需在结果级显式报错，
    // 否则全被拒绝时 containers 为空，hasErrors 会漏报。
    const allChecks = result.containers.map(c => selfCheck(c, containerSpec, tolerance));
    if (result.unplacedCount > 0) {
      allChecks.push({
        errors: [{ type: 'unplaced', message: `${result.unplacedCount} 件货物未能装入 ${containerSpec.code}` }],
        warnings: []
      });
    }
    const hasCriticalWarning = allChecks.some(c => c.warnings.some(w => w.suggestRecalc));

    // 重算（如需要）
    if (autoRetry && hasCriticalWarning) {
      result = recalibrate(items, containerSpec, result, { tolerance });
      // 重新自检
      result.checks = result.containers.map(c => selfCheck(c, containerSpec, tolerance));
      if (result.unplacedCount > 0) {
        result.checks.push({
          errors: [{ type: 'unplaced', message: `${result.unplacedCount} 件货物未能装入 ${containerSpec.code}` }],
          warnings: []
        });
      }
    } else {
      result.checks = allChecks;
    }

    result.hasErrors = result.checks.some(c => c.errors.length > 0);
    result.hasWarnings = result.checks.some(c => c.warnings.length > 0);

    return result;
  }

  /**
   * 箱型实际装箱预演：对每个候选箱型跑多起点装箱，比较真实所需箱数。
   *
   * 推荐层（autoRecommend）只检查"单件尺寸适配 + 总重"，不验证实际排布能力，
   * 会出现"单件都能进 20FR，但实际要 3 箱，而 40FR 只需 1 箱"的误导。
   * 本函数用优化器对每个候选箱型做真实装箱，返回按箱数/未装件数排序的对比，
   * 供 UI 在推荐时择优。
   *
   * @param {Array} items - 货物列表（含 quantity）
   * @param {Array} containerSpecs - 候选箱型规格列表
   * @param {object} options - { tolerance, optimizationSeed, randomStarts, optimizationTimeMs }
   * @returns {Array<{code, nameCN, containerCount, totalPlaced, unplacedCount, avgUtilization, feasible}>}
   */
  function simulateContainerOptions(items, containerSpecs, options = {}) {
    const results = [];
    const expandedTotal = (list) => list.reduce((s, i) => s + (i.quantity || 1), 0);
    // 预演需要比默认更强的搜索：单件适配不代表实际能装下，
    // 大件 + FR 悬出场景需要较多逐件洗牌才能找到紧凑排布（如 40FR 一箱 12 件）。
    const simRandomStarts = Number.isInteger(options.randomStarts) ? options.randomStarts : 60;
    const simTimeMs = Number.isFinite(options.optimizationTimeMs) ? options.optimizationTimeMs : 8000;
    for (const spec of containerSpecs) {
      if (!spec) continue;
      try {
        const result = multiContainerPack(items, spec, {
          tolerance: options.tolerance == null ? 0.05 : options.tolerance,
          optimizationSeed: options.optimizationSeed,
          randomStarts: simRandomStarts,
          optimizationTimeMs: simTimeMs
        });
        // 单箱容量搜索：多箱结果可能因贪心顺序低估箱型能力（如 40FR 实际可 1 箱装 12 件，
        // 但多起点只找到 2 箱）。用模拟退火找"单箱最多装几件"，识别珍珠解。
        let singleBox = null;
        try {
          const cap = searchSingleBoxCapacity(items, spec, {
            tolerance: options.tolerance == null ? 0.05 : options.tolerance,
            optimizationSeed: options.optimizationSeed,
            maxStarts: 2   // 预演只判断"能否单箱装完"，2 起点足够且省时
          });
          singleBox = { maxPlaced: cap.maxPlaced, total: cap.total };
        } catch (capErr) {
          // 容量搜索失败不影响主结果
        }
        results.push({
          code: spec.code,
          nameCN: spec.nameCN || spec.name || spec.code,
          containerCount: result.containerCount,
          totalPlaced: result.totalPlaced,
          unplacedCount: result.unplacedCount,
          avgUtilization: result.avgUtilization,
          feasible: result.unplacedCount === 0,
          singleBoxCapacity: singleBox ? singleBox.maxPlaced : null,
          totalItems: singleBox ? singleBox.total : expandedTotal(items)
        });
      } catch (err) {
        results.push({
          code: spec.code,
          nameCN: spec.nameCN || spec.name || spec.code,
          containerCount: Infinity,
          totalPlaced: 0,
          unplacedCount: Infinity,
          avgUtilization: 0,
          feasible: false,
          error: err.message
        });
      }
    }
    // 排序：未装件数 → 箱数 → 利用率
    results.sort((a, b) => {
      if (a.unplacedCount !== b.unplacedCount) return a.unplacedCount - b.unplacedCount;
      if (a.containerCount !== b.containerCount) return a.containerCount - b.containerCount;
      return b.avgUtilization - a.avgUtilization;
    });
    return results;
  }

  // 导出
  return {
    calculate,
    packSingleContainer,
    multiContainerPack,
    mixedMultiContainerPack,
    simulateContainerOptions,
    refineBySwap,
    searchSingleBoxCapacity,
    selfCheck,
    recalibrate,
    expandItems,
    getTotalQuantity,
    // 暴露内部函数供测试
    _internal: { createSpace, cutSpace, mergeSpaces, dblScore, emsPlace, layerPack, precomputeLayerSupportChecks, detectOverlaps, sortItems, groupByModel, orderGroups, calcSupportRatio, hasCornerSupport, baseOverlapsContainerFloor, checkWeightBearing, weightedAvgUtilization, shouldAdoptRecalc }
  };
})();

  const packingEngineGlobal = typeof window !== 'undefined' ? window : self;
  packingEngineGlobal.PackingEngine = PackingEngine;
