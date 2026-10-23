/* Engine worker — 推荐预演（simulate）+ 主装箱计算（calculate）。
 * 引擎脚本以 window.* 挂载全局；Worker 中先把 self 别名为 window，再按 CDB → Planner → Engine
 * 顺序 importScripts（历史缺陷修复：此前仅 importScripts('packing-engine.js')，在 Worker 中因
 * window 未定义直接抛错 → 预演功能从未生效、静默回退基础推荐）。
 * 2026-10-15（性能 P1-7）：装箱主计算也移入 Worker，避免大订单冻结 UI 主线程。 */
self.window = self;
importScripts('container-db.js', 'planner.js', 'packing-engine.js');

self.addEventListener('message', (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'simulate') {
      const simulation = self.PackingEngine.simulateContainerOptions(
        message.items || [],
        message.candidates || [],
        message.options || {}
      );
      self.postMessage({ type: 'result', requestId: message.requestId, simulation });
      return;
    }
    if (message.type === 'calculate') {
      const result = self.PackingEngine.calculate(
        message.items || [],
        message.containerSpec || null,
        message.options || {}
      );
      self.postMessage({ type: 'calculate-result', requestId: message.requestId, result });
      return;
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: error && error.message ? error.message : String(error)
    });
  }
});
