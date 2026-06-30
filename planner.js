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

  return { classifyItem, filterContainerTypes };
})();

window.Planner = Planner;
