// probe2.js — 装载能力基准 + 端到端主流程不变量
const L = require('./probe-lib.js');
const { ctx, CDB, PE, DB, audit, log } = L;
const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });
const expand = (items) => PE.expandItems(items);

// ═══ A: 规则网格容量基准（理论最大件数 vs 引擎实测）═══
log('\n########## A 规则网格容量基准（理论 vs 实测） ##########');
{
  const S = 0.5;
  const cases = [
    ['20GP', DB['20GP']],
    ['40HQ', DB['40HQ']],
    ['45HQ', DB['45HQ']],
  ];
  for (const [code, spec] of cases) {
    const nx = Math.floor(spec.L / S), ny = Math.floor(spec.W / S), nz = Math.floor(spec.H / S);
    const theoretical = nx * ny * nz;
    for (const qty of [theoretical, theoretical * 2]) {
      const items = expand([mk('CUBE', S, S, S, 5, qty)]);
      const r = PE.packSingleContainer(items, spec, { tolerance: 0.05 });
      const cov = r.placedItems.length / Math.min(qty, theoretical);
      log(`  ${code} 0.5m立方 ×${qty}：理论单箱上限=${theoretical} 实测装入=${r.placedItems.length} 单箱达成率=${(cov * 100).toFixed(1)}% 利用率=${(r.utilization * 100).toFixed(1)}% 未装=${r.unplacedItems.length}`);
    }
    // 多箱全装
    const items = expand([mk('CUBE', S, S, S, 5, theoretical * 3)]);
    const m = PE.multiContainerPack(items, spec, { tolerance: 0.05 });
    const lower = Math.ceil(theoretical * 3 / theoretical);
    log(`  ${code} ×${theoretical * 3} 多箱：箱数=${m.containerCount}（理论下界 ${lower}）装入=${m.totalPlaced}/${m.totalItems} 平均利用率=${(m.avgUtilization * 100).toFixed(1)}%`);
  }
}

// ═══ B: 低利用率下漏装定位 ═══
log('\n########## B 低利用率漏装定位 ##########');
{
  const items = [ mk('NOSTACK-大件', 1.2, 1.2, 1.0, 500, 1, { stackable: false }) ];
  for (let i = 0; i < 60; i++) items.push(mk('SMALL', 0.4, 0.4, 0.4, 20, 1));
  const r = PE.packSingleContainer(items, DB['20GP'], { tolerance: 0.05 });
  const vol = r.placedItems.reduce((s, i) => s + i.l * i.w * i.h, 0);
  const inputVol = items.reduce((s, i) => s + i.l * i.w * i.h, 0);
  log(`  20GP：输入体积=${inputVol.toFixed(2)}m³（箱容 33.2）装入=${r.placedItems.length}/${items.length} 已装体积=${vol.toFixed(2)}m³ 利用率=${(r.utilization * 100).toFixed(1)}%`);
  log(`  未装件：` + r.unplacedItems.map(i => `${i.model}(${i.l}×${i.w}×${i.h})`).join(', '));
  // 对照：去掉不可叠大件
  const r2 = PE.packSingleContainer(items.slice(1), DB['20GP'], { tolerance: 0.05 });
  log(`  对照（仅 60 件小件）：装入=${r2.placedItems.length}/60 未装=${r2.unplacedItems.length} 利用率=${(r2.utilization * 100).toFixed(1)}%`);
  // 对照：仅大件
  const r3 = PE.packSingleContainer([items[0]], DB['20GP'], { tolerance: 0.05 });
  log(`  对照（仅 1 件不可叠大件）：装入=${r3.placedItems.length}/1 未装=${r3.unplacedItems.length}`);
}

// ═══ C: 端到端 单箱型 PE.calculate ═══
log('\n########## C 端到端 单箱型 calculate（真实入口） ##########');
{
  const items = [];
  for (let i = 0; i < 120; i++) items.push(mk('C' + (i % 3), 0.6 + 0.1 * (i % 3), 0.5, 0.4, 30, 1));
  items.push(mk('BIG-NOSTACK', 2.4, 1.1, 1.2, 900, 3, { stackable: false }));
  const lowerVol = items.reduce((s, i) => s + i.l * i.w * i.h, 0) / (DB['20GP'].L * DB['20GP'].W * DB['20GP'].H);
  const lowerWt = items.reduce((s, i) => s + i.weight, 0) / DB['20GP'].payload;
  let res;
  try {
    res = PE.calculate(items, '20GP', { tolerance: 0.05, autoRetry: true });
    log(`  箱数=${res.containerCount} 装入=${res.totalPlaced}/${res.totalItems} 未装=${res.unplacedCount} 平均利用率=${(res.avgUtilization * 100).toFixed(1)}%`);
    log(`  理论下界：体积 ${lowerVol.toFixed(2)} 箱 / 载重 ${lowerWt.toFixed(2)} 箱`);
    log(`  hasErrors=${res.hasErrors} hasWarnings=${res.hasWarnings}`);
    for (const [i, ch] of res.checks.entries()) {
      if (ch.errors.length) log(`    箱#${i} errors: ` + JSON.stringify(ch.errors.map(e => e.type + ':' + e.message)));
      if (ch.warnings.length) log(`    箱#${i} warnings: ` + JSON.stringify(ch.warnings.map(w => w.type + ':' + w.message)));
    }
    let sv = 0, ob = 0, ow = 0, fl = 0;
    for (const c of res.containers) {
      sv += L.checkStackViolation(c).length; ob += L.checkOutOfBounds(c, DB['20GP']).length;
      ow += L.checkOverweight(c, DB['20GP']).length; fl += L.checkFloating(c).length;
    }
    log(`  不变量：叠放违规=${sv} 越界=${ob} 超重=${ow} 悬空=${fl}`);
  } catch (e) { log('  ✗ 抛错: ' + e.message); }
}

// ═══ D: 端到端 混合箱型（Planner）calculate ═══
log('\n########## D 端到端 混合箱型 calculate（Planner 路径） ##########');
{
  const specs = CDB.CONTAINER_LIST;
  const items = [
    mk('S1', 0.6, 0.5, 0.4, 30, 200),
    mk('S2', 1.2, 0.8, 0.6, 80, 60),
    mk('S3', 2.0, 1.2, 1.5, 400, 8, { stackable: false }),
    mk('S4', 3.0, 2.0, 1.0, 1200, 4),
  ];
  const totVol = items.reduce((s, i) => s + i.l * i.w * i.h * i.quantity, 0);
  const totWt = items.reduce((s, i) => s + i.weight * i.quantity, 0);
  log(`  输入：体积=${totVol.toFixed(1)}m³ 总重=${totWt.toFixed(0)}kg 件数=${items.reduce((s, i) => s + i.quantity, 0)}`);
  try {
    const res = PE.calculate(items, null, { tolerance: 0.05, mixedContainers: specs });
    log(`  箱数=${res.containerCount} 装入=${res.totalPlaced}/${res.totalItems} 未装=${res.unplacedCount} 平均利用率=${(res.avgUtilization * 100).toFixed(1)}% hasErrors=${res.hasErrors}`);
    log(`  箱型序列：` + res.containers.map(c => c.containerCode).join(', '));
    let sv = 0, ob = 0, ow = 0, fl = 0;
    for (const c of res.containers) {
      const spec = specs.find(s => s.code === c.containerCode);
      sv += L.checkStackViolation(c).length; ow += L.checkOverweight(c, spec).length; fl += L.checkFloating(c).length;
      if (spec.type !== 'flatRack') ob += L.checkOutOfBounds(c, spec).length;
      else {
        // FR：只查有效尺寸（含超限预算）
        const eff = CDB.getEffectiveMaxDims(spec, 0.05);
        for (const it of c.placedItems) {
          if (it.x + it.l > eff.maxL + 1e-6 || it.y + it.w > eff.maxW + 1e-6 || it.z + it.h > eff.maxH + 1e-6) ob++;
        }
      }
    }
    log(`  不变量：叠放违规=${sv} 越界=${ob} 超重=${ow} 悬空=${fl}`);
    log(`  体积下界=${(totVol / DB['40HQ'].volume).toFixed(2)}个40HQ当量；载重下界=${(totWt / DB['40GP'].payload).toFixed(2)}`);
    const errs = res.checks.filter(c => c.errors.length > 0).map(c => c.errors.map(e => e.type + ':' + e.message));
    if (errs.length) log('  错误：' + JSON.stringify(errs));
  } catch (e) { log('  ✗ 抛错: ' + e.message); }
}

// ═══ E: quantity 语义（packSingleContainer 直调）═══
log('\n########## E packSingleContainer 的 quantity 语义 ##########');
{
  const r = PE.packSingleContainer([mk('Q', 0.5, 0.5, 0.5, 10, 10)], DB['20GP'], { tolerance: 0.05 });
  log(`  quantity=10 单条记录直调 packSingleContainer：装入=${r.placedItems.length}（期望 10 若自动展开）`);
  const r2 = PE.multiContainerPack([mk('Q', 0.5, 0.5, 0.5, 10, 10)], DB['20GP'], { tolerance: 0.05 });
  log(`  quantity=10 经 multiContainerPack：装入=${r2.totalPlaced}/${r2.totalItems}`);
}

log('\n########## 完成 ##########');
require('fs').writeFileSync(__dirname + '/probe2.log', L.out.join('\n') + '\n');
