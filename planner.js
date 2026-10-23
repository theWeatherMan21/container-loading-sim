// planner.js — 全局分配层
// 依赖：window.ContainerDB (CDB)
// 职责：将货物清单按约束分组分配到具体的集装箱

const Planner = (() => {
  const CDB = window.ContainerDB;
  const { CONTAINER_DB } = CDB;

  const HEAVY_WEIGHT = 1000;    // kg，重量≥此值视为重型
  const HEAVY_MIN_DIM = 2.0;     // 米，最长边≥此值视为大件
  const VOLUME_FACTOR = 0.85;    // 分配体积上限系数（留缝隙）

  /**
   * 货物分类（结合 container-db 综合门约束 + 业务规则）
   *
   * 规则：
   * 1. 需要 FR/OT 或无法装载 → 'oversize'
   * 2. 可进入标准柜（20GP/40HQ）→ 按重量/叠放细分
   *
   * @param {object} item - {model, l, w, h, weight, stackable, quantity}
   * @returns {'oversize'|'heavy-nonstack'|'stackable'|'light-nonstack'}
   */
  function classifyItem(item) {
    // 使用 container-db 的综合门约束+尺寸检查判定所需箱型等级
    const requiredType = CDB.classifyItemByContainerType(item, 0.01);

    // 无法装载、需要 FR、需要 OT → 明确超限
    if (requiredType === 'none' || requiredType === 'FR' || requiredType === 'OT') {
      return 'oversize';
    }

    // 可进入标准柜 → 按重量和尺寸细分
    const maxDim = Math.max(item.l, item.w, item.h);
    const isHeavy = item.weight >= HEAVY_WEIGHT || maxDim >= HEAVY_MIN_DIM;
    if (item.stackable === false && isHeavy) return 'heavy-nonstack';
    if (item.stackable !== false) return 'stackable';
    return 'light-nonstack';
  }

  /**
   * 为一件货物筛选所有能装下它的箱型
   * @param {object} item
   * @returns {Array} 可用箱型规格列表
   */
  function filterContainerTypes(item, containerSpecs = Object.values(CONTAINER_DB)) {
    const allTypes = Array.isArray(containerSpecs) ? containerSpecs.filter(Boolean) : [];

    return allTypes.filter(container => {
      if (!CDB.hasValidOrientationForContainer(item, container, 0.01)) return false;
      const weightCheck = CDB.checkWeightConstraint(0, item.weight, container);
      return weightCheck.pass;
    });
  }

  /**
   * 全局分配货物到集装箱
   * @param {Array} allItems - [{model,l,w,h,weight,quantity,stackable}]
   * @param {Array} containerSpecs - 可用箱型规格
   * @returns {{ assignments: [{containerCode,items:[],reason}], unassigned:[] }}
   */
  function planContainerAssignment(allItems, containerSpecs) {
    // Step 1: 货物分类（展开 quantity）
    const oversizeItems = [];
    const heavyNonStack = [];
    const stackableItems = [];
    const lightNonStack = [];

    for (const item of allItems) {
      const qty = item.quantity || 1;
      for (let i = 0; i < qty; i++) {
        const single = { ...item, quantity: 1 };
        const cls = classifyItem(single);
        if (cls === 'oversize') oversizeItems.push(single);
        else if (cls === 'heavy-nonstack') heavyNonStack.push(single);
        else if (cls === 'stackable') stackableItems.push(single);
        else lightNonStack.push(single);
      }
    }

    const assignments = [];
    const unassigned = [];

    // ═══ 熔断账本（2026-10-13 修复 P0-1：Planner 无限循环 → OOM）═══
    // 「结算当前组 → i-- 重试当前货物」模式在“建组条件过、加入条件拒”时
    // 会以完全相同的输入反复重建同一个组（每轮泄漏一个空组，直至内存耗尽）。
    // 修复：① 建组/加入条件同口径（新建组必能接纳首件，见下方各循环）；
    //      ② 本账本兜底——同一件货物最多回退重试 RETRY_LIMIT 次，
    //         超过即转入 unassigned（诚实的未分配 > 死循环）。
    const retryCounts = new Map();
    const bumpRetry = (it) => {
      const n = (retryCounts.get(it) || 0) + 1;
      retryCounts.set(it, n);
      return n;
    };
    const RETRY_LIMIT = 2;

    // Step 2: 超限货分配 — 每件独占一个适合的最小 FR/OT
    for (const item of oversizeItems) {
      const candidates = filterContainerTypes(item, containerSpecs);

      if (candidates.length === 0) {
        unassigned.push(item);
        continue;
      }

      // 选体积最小的（P-04 业务权衡：按体积升序选最小箱，未区分 FR/OT 成本——
      // FR 运费通常高于 OT，体积优先换取更少箱数/更少空间浪费；若需成本优先，
      // 可改为 20OT→40OT→20FR→40FR 优先序，但需回归验证既有测试断言。）
      candidates.sort((a, b) => (a.L * a.W * a.H) - (b.L * b.W * b.H));
      const chosen = candidates[0];

      assignments.push({
        containerCode: chosen.code,
        items: [item],
        reason: `超限货独占 ${chosen.code}`
      });
    }

    // Step 3: 重型不可叠分配
    heavyNonStack.sort((a, b) => b.weight - a.weight);

    // 标准箱型（非 FR/OT），按体积升序
    const standardContainers = containerSpecs
      .filter(s => s.type !== 'flatRack' && s.type !== 'openTop')
      .sort((a, b) => (a.L * a.W * a.H) - (b.L * b.W * b.H));

    let heavyAssignmentGroups = [];

    for (const item of heavyNonStack) {
      const itemVol = item.l * item.w * item.h;
      const itemFloor = item.l * item.w;
      let placed = false;

      const usableCodes = new Set(filterContainerTypes(item, containerSpecs).map(c => c.code));

      // 尝试加入已有组
      // 不可叠货物受地板面积硬约束（不能叠放），除体积/重量外必须检查 Σ(l×w) ≤ 箱地板
      for (const group of heavyAssignmentGroups) {
        if (usableCodes.has(group.container.code) &&
            group.totalWeight + item.weight <= group.container.payload &&
            (group.totalVolume + itemVol) <= group.container.L * group.container.W * group.container.H * 0.8 &&
            (group.totalFloor + itemFloor) <= group.container.L * group.container.W) {
          group.items.push(item);
          group.totalWeight += item.weight;
          group.totalVolume += itemVol;
          group.totalFloor += itemFloor;
          placed = true;
          break;
        }
      }

      if (!placed) {
        // 找能装下这件货的最小标准箱型
        let bestContainer = null;
        for (const c of standardContainers) {
          if (usableCodes.has(c.code) && item.weight <= c.payload &&
              itemVol <= c.L * c.W * c.H * 0.8 &&
              itemFloor <= c.L * c.W) {
            bestContainer = c;
            break;
          }
        }
        if (bestContainer) {
          heavyAssignmentGroups.push({
            container: bestContainer,
            items: [item],
            totalWeight: item.weight,
            totalVolume: itemVol,
            totalFloor: itemFloor
          });
        } else {
          unassigned.push(item);
        }
      }
    }

    for (const group of heavyAssignmentGroups) {
      assignments.push({
        containerCode: group.container.code,
        items: group.items,
        reason: `重型不可叠分组，${group.items.length}件，总重${group.totalWeight.toFixed(0)}kg`
      });
    }

    // Step 4: 可叠货聚合（单箱尽量满再开下一箱）
    let stackableGroup = null;
    for (let i = 0; i < stackableItems.length; i++) {
      const item = stackableItems[i];
      const itemVol = item.l * item.w * item.h;

      const usableCodes = new Set(filterContainerTypes(item, containerSpecs).map(c => c.code));

      if (stackableGroup && !usableCodes.has(stackableGroup.container.code)) {
        if (stackableGroup.items.length > 0) {
          assignments.push({
            containerCode: stackableGroup.container.code,
            items: stackableGroup.items,
            reason: `可叠货聚合，${stackableGroup.items.length}件，体积${stackableGroup.totalVolume.toFixed(2)}m³`
          });
        }
        stackableGroup = null;
        if (bumpRetry(item) <= RETRY_LIMIT) { i--; } else { unassigned.push(item); }
        continue;
      }

      if (!stackableGroup) {
        for (const c of standardContainers) {
          // 2026-10-13 修复（P0-1）：建组门槛与下方“加入检查”同口径——新建组必能接纳首件。
          // （原实现仅查体积：体积合格但高度/底面积被加入检查拒绝的货物会触发死循环。）
          const firstFloor = item.l * item.w;
          const firstH = item.h; // 与下方加入检查的层高口径一致（首件层高 = item.h）
          if (usableCodes.has(c.code) &&
              itemVol <= c.L * c.W * c.H * VOLUME_FACTOR &&
              item.weight <= c.payload &&
              firstFloor <= c.L * c.W &&
              firstH <= c.H &&
              CDB.hasValidOrientationForContainer(item, c, 0.01)) {
            stackableGroup = {
              container: c,
              items: [],
              totalVolume: 0,
              totalWeight: 0,
              // 同型号可叠货共享同一底面积，足迹按"型号去重"计一次，
              // 避免大量薄板件把地板面积低估，从而避免 Planner 分组 → 扩容兜底的连锁。
              totalFloor: 0,
              floorModels: new Set(),
              // 高度预筛：每型号按"同型号独占一层"估算层高（保守），
              // 防止大量薄板件在体积/足迹内但高度超箱的情况。
              modelCounts: new Map(),
              // 修复(2026-08-06)：totalHeight 必须初始化，否则首次
              // nextHeight = undefined + n = NaN，NaN > H 恒 false，可叠高度预筛完全失效。
              totalHeight: 0
            };
            break;
          }
        }
      }

      if (stackableGroup) {
        const maxVol = stackableGroup.container.L * stackableGroup.container.W * stackableGroup.container.H * VOLUME_FACTOR;
        const itemFloor = item.l * item.w;
        const isNewFloorModel = !stackableGroup.floorModels.has(item.model);
        const nextFloor = stackableGroup.totalFloor + (isNewFloorModel ? itemFloor : 0);

        // 高度估算：本型号加入后的层数 = ceil(总件数 / 每层可放件数)（保守按单层满铺），
        // 总高 = 各型号层高之和，不允许超过箱高（高度由 0.85 体积系数之外的另一维约束）。
        // 2026-10-13（P0-1）：层高保持未旋转 item.h（保守预筛，维护 C-N1 防线）——
        // 可放倒的高件不在此放行，由熔断护栏转入 unassigned，走 calculate 的扩容兜底（结果正确）。
        const modelCount = (stackableGroup.modelCounts.get(item.model) || 0) + 1;
        const perLayer = Math.max(1, Math.floor((stackableGroup.container.L * stackableGroup.container.W) / itemFloor));
        const thisModelLayers = Math.ceil(modelCount / perLayer);
        const prevModelLayers = Math.ceil((modelCount - 1) / perLayer);
        const nextHeight = stackableGroup.totalHeight + (thisModelLayers - prevModelLayers) * item.h;

        if (stackableGroup.totalVolume + itemVol > maxVol ||
            stackableGroup.totalWeight + item.weight > stackableGroup.container.payload ||
            nextFloor > stackableGroup.container.L * stackableGroup.container.W ||
            nextHeight > stackableGroup.container.H) {
          if (stackableGroup.items.length > 0) {
            assignments.push({
              containerCode: stackableGroup.container.code,
              items: stackableGroup.items,
              reason: `可叠货聚合，${stackableGroup.items.length}件，体积${stackableGroup.totalVolume.toFixed(2)}m³`
            });
          }
          stackableGroup = null;
          // 熔断护栏：同一件货物过多回退重试 → 转 unassigned（防死循环）
          if (bumpRetry(item) <= RETRY_LIMIT) { i--; } else { unassigned.push(item); }
          continue;
        }
        stackableGroup.items.push(item);
        stackableGroup.totalVolume += itemVol;
        stackableGroup.totalWeight += item.weight;
        stackableGroup.totalFloor = nextFloor;
        // 修复(2026-08-06)：防御非有限高度值（历史 NaN 污染），退化按单层高度计
        stackableGroup.totalHeight = Number.isFinite(nextHeight) ? nextHeight : item.h;
        stackableGroup.modelCounts.set(item.model, modelCount);
        if (isNewFloorModel) stackableGroup.floorModels.add(item.model);
      } else {
        unassigned.push(item);
      }
    }

    if (stackableGroup && stackableGroup.items.length > 0) {
      assignments.push({
        containerCode: stackableGroup.container.code,
        items: stackableGroup.items,
        reason: `可叠货聚合，${stackableGroup.items.length}件`
      });
    }

    // Step 5: 轻型不可叠 — 独立开箱（不与其他重型货混装，避免 blockedAbove 碎片化）
    let lightGroup = null;
    for (let i = 0; i < lightNonStack.length; i++) {
      const item = lightNonStack[i];
      const itemVol = item.l * item.w * item.h;
      const itemFloor = item.l * item.w;

      const usableCodes = new Set(filterContainerTypes(item, containerSpecs).map(c => c.code));

      if (lightGroup && !usableCodes.has(lightGroup.container.code)) {
        assignments.push({
          containerCode: lightGroup.container.code,
          items: lightGroup.items,
          reason: `轻型不可叠分组，${lightGroup.items.length}件`
        });
        lightGroup = null;
        if (bumpRetry(item) <= RETRY_LIMIT) { i--; } else { unassigned.push(item); }
        continue;
      }

      if (!lightGroup) {
        for (const c of standardContainers) {
          if (usableCodes.has(c.code) && itemVol <= c.L * c.W * c.H * VOLUME_FACTOR &&
              itemFloor <= c.L * c.W) {
            lightGroup = {
              container: c,
              items: [],
              totalVolume: 0,
              totalWeight: 0,
              totalFloor: 0
            };
            break;
          }
        }
      }

      if (lightGroup) {
        const maxVol = lightGroup.container.L * lightGroup.container.W * lightGroup.container.H * VOLUME_FACTOR;
        // 不可叠货物受地板面积硬约束（不能叠放）：Σ(l×w) ≤ 箱地板面积
        if (lightGroup.totalVolume + itemVol > maxVol ||
            lightGroup.totalWeight + item.weight > lightGroup.container.payload ||
            lightGroup.totalFloor + itemFloor > lightGroup.container.L * lightGroup.container.W) {
          assignments.push({
            containerCode: lightGroup.container.code,
            items: lightGroup.items,
            reason: `轻型不可叠分组，${lightGroup.items.length}件`
          });
          lightGroup = null;
          if (bumpRetry(item) <= RETRY_LIMIT) { i--; } else { unassigned.push(item); }
          continue;
        }
        lightGroup.items.push(item);
        lightGroup.totalVolume += itemVol;
        lightGroup.totalWeight += item.weight;
        lightGroup.totalFloor += itemFloor;
      } else {
        unassigned.push(item);
      }
    }

    if (lightGroup && lightGroup.items.length > 0) {
      assignments.push({
        containerCode: lightGroup.container.code,
        items: lightGroup.items,
        reason: `轻型不可叠分组，${lightGroup.items.length}件`
      });
    }

    return { assignments, unassigned };
  }

  return { classifyItem, filterContainerTypes, planContainerAssignment };
})();

window.Planner = Planner;
