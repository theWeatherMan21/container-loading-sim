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

    // Step 2: 超限货分配 — 每件独占一个适合的最小 FR/OT
    for (const item of oversizeItems) {
      const candidates = filterContainerTypes(item, containerSpecs);

      if (candidates.length === 0) {
        unassigned.push(item);
        continue;
      }

      // 选体积最小的
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
      let placed = false;

      const usableCodes = new Set(filterContainerTypes(item, containerSpecs).map(c => c.code));

      // 尝试加入已有组
      for (const group of heavyAssignmentGroups) {
        if (usableCodes.has(group.container.code) &&
            group.totalWeight + item.weight <= group.container.payload &&
            (group.totalVolume + itemVol) <= group.container.L * group.container.W * group.container.H * 0.8) {
          group.items.push(item);
          group.totalWeight += item.weight;
          group.totalVolume += itemVol;
          placed = true;
          break;
        }
      }

      if (!placed) {
        // 找能装下这件货的最小标准箱型
        let bestContainer = null;
        for (const c of standardContainers) {
          if (usableCodes.has(c.code) && item.weight <= c.payload &&
              itemVol <= c.L * c.W * c.H * 0.8) {
            bestContainer = c;
            break;
          }
        }
        if (bestContainer) {
          heavyAssignmentGroups.push({
            container: bestContainer,
            items: [item],
            totalWeight: item.weight,
            totalVolume: itemVol
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
        assignments.push({
          containerCode: stackableGroup.container.code,
          items: stackableGroup.items,
          reason: `可叠货聚合，${stackableGroup.items.length}件，体积${stackableGroup.totalVolume.toFixed(2)}m³`
        });
        stackableGroup = null;
        i--;
        continue;
      }

      if (!stackableGroup) {
        for (const c of standardContainers) {
          if (usableCodes.has(c.code) && itemVol <= c.L * c.W * c.H * VOLUME_FACTOR) {
            stackableGroup = {
              container: c,
              items: [],
              totalVolume: 0,
              totalWeight: 0
            };
            break;
          }
        }
      }

      if (stackableGroup) {
        const maxVol = stackableGroup.container.L * stackableGroup.container.W * stackableGroup.container.H * VOLUME_FACTOR;
        if (stackableGroup.totalVolume + itemVol > maxVol ||
            stackableGroup.totalWeight + item.weight > stackableGroup.container.payload) {
          assignments.push({
            containerCode: stackableGroup.container.code,
            items: stackableGroup.items,
            reason: `可叠货聚合，${stackableGroup.items.length}件，体积${stackableGroup.totalVolume.toFixed(2)}m³`
          });
          stackableGroup = null;
          i--; // 重试当前 item
          continue;
        }
        stackableGroup.items.push(item);
        stackableGroup.totalVolume += itemVol;
        stackableGroup.totalWeight += item.weight;
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

      const usableCodes = new Set(filterContainerTypes(item, containerSpecs).map(c => c.code));

      if (lightGroup && !usableCodes.has(lightGroup.container.code)) {
        assignments.push({
          containerCode: lightGroup.container.code,
          items: lightGroup.items,
          reason: `轻型不可叠分组，${lightGroup.items.length}件`
        });
        lightGroup = null;
        i--;
        continue;
      }

      if (!lightGroup) {
        for (const c of standardContainers) {
          if (usableCodes.has(c.code) && itemVol <= c.L * c.W * c.H * VOLUME_FACTOR) {
            lightGroup = {
              container: c,
              items: [],
              totalVolume: 0,
              totalWeight: 0
            };
            break;
          }
        }
      }

      if (lightGroup) {
        const maxVol = lightGroup.container.L * lightGroup.container.W * lightGroup.container.H * VOLUME_FACTOR;
        if (lightGroup.totalVolume + itemVol > maxVol ||
            lightGroup.totalWeight + item.weight > lightGroup.container.payload) {
          assignments.push({
            containerCode: lightGroup.container.code,
            items: lightGroup.items,
            reason: `轻型不可叠分组，${lightGroup.items.length}件`
          });
          lightGroup = null;
          i--;
          continue;
        }
        lightGroup.items.push(item);
        lightGroup.totalVolume += itemVol;
        lightGroup.totalWeight += item.weight;
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
