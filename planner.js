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
   * 货物分类
   * @param {object} item - {model, l, w, h, weight, stackable, quantity}
   * @returns {'oversize'|'heavy-nonstack'|'stackable'|'light-nonstack'}
   */
  function classifyItem(item) {
    const isOversize = checkIsOversizeForAnyContainer(item);
    if (isOversize) return 'oversize';

    const maxDim = Math.max(item.l, item.w, item.h);
    const isHeavy = item.weight >= HEAVY_WEIGHT || maxDim >= HEAVY_MIN_DIM;

    if (item.stackable === false && isHeavy) return 'heavy-nonstack';
    if (item.stackable !== false) return 'stackable';
    return 'light-nonstack';
  }

  /**
   * 检查货物是否超限（对任何标准箱型）
   * 超门高：h > 箱门高度 (20GP=2.28m)
   * 超门宽：min(l,w) > 箱门宽度 (20GP=2.342m)
   */
  function checkIsOversizeForAnyContainer(item) {
    const gp20 = CONTAINER_DB['20GP'];
    if (!gp20) return false;

    // 高度超过门高 → 超限
    if (item.h > gp20.doorH + 0.01) return true;
    // 宽度（较小截面）超过门宽 → 超限
    if (Math.min(item.l, item.w) > gp20.doorW + 0.01) return true;

    return false;
  }

  /**
   * 为一件货物筛选所有能装下它的箱型
   * @param {object} item
   * @returns {Array} 可用箱型规格列表
   */
  function filterContainerTypes(item) {
    const allTypes = Object.values(CONTAINER_DB);

    return allTypes.filter(container => {
      // 尺寸硬约束
      const sizeCheck = CDB.checkSizeConstraints(item, container, 0.01);
      if (!sizeCheck.pass) return false;

      // 门约束
      const doorCheck = CDB.checkDoorConstraint(item, container, 0.01);
      if (!doorCheck.pass) return false;

      // 载重约束（单件不能超过箱型载重）
      const weightCheck = CDB.checkWeightConstraint(0, item.weight, container);
      if (!weightCheck.pass) return false;

      return true;
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
      const usableTypes = filterContainerTypes(item);
      const frTypes = usableTypes.filter(t => t.type === 'flatRack');
      const otTypes = usableTypes.filter(t => t.type === 'openTop');
      const candidates = [...frTypes, ...otTypes];

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

    // Step 3-6 待实现...
    return { assignments, unassigned };
  }

  return { classifyItem, filterContainerTypes, planContainerAssignment };
})();

window.Planner = Planner;
