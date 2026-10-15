// probe-run.js — 逐条实测引擎不变量
const L = require('./probe-lib.js');
const { ctx, CDB, PE, DB, audit, log } = L;

const mk = (model, l, w, h, weight, qty, extra = {}) => ({ model, l, w, h, weight, quantity: qty, stackable: true, ...extra });

// ═══ S1: 非叠放货 + 可叠小件（blockedAbove 是否守住）═══
log('\n########## S1 非叠放货正上方是否被侵占 ##########');
{
  const items = [ mk('NOSTACK-大件', 1.2, 1.2, 1.0, 500, 1, { stackable: false }) ];
  for (let i = 0; i < 60; i++) items.push(mk('SMALL', 0.4, 0.4, 0.4, 20, 1));
  const items2 = [ mk('NOSTACK-大件', 2.0, 1.0, 1.5, 800, 2, { stackable: false }) ];
  for (let i = 0; i < 80; i++) items2.push(mk('SMALL', 0.5, 0.5, 0.5, 15, 1));
  audit('S1a 20GP 1件不可叠+60件小可叠', items, DB['20GP']);
  audit('S1b 40HQ 2件不可叠+80件小可叠', items2, DB['40HQ']);
  // 层铺路径：同型号 ≥10 件且不可叠
  const s1c = [ mk('NOSTACK-薄板', 2.0, 1.0, 0.2, 300, 12, { stackable: false }) ];
  for (let i = 0; i < 40; i++) s1c.push(mk('SMALL', 0.5, 0.5, 0.5, 15, 1));
  audit('S1c 40HQ 12件不可叠薄板(层铺阈值)+40小可叠', s1c, DB['40HQ']);
}

// ═══ S2: 单件/累计重量边界 ═══
log('\n########## S2 重量边界 ##########');
{
  const gp = DB['20GP'];
  audit(`S2a 单件=payload(${gp.payload}kg) 一件`, [mk('W-EXACT', 1, 1, 1, gp.payload, 1)], gp);
  audit(`S2b 两件各 payload/2 (应恰好装满)`, [mk('W-HALF', 1, 1, 1, gp.payload / 2, 2)], gp);
  audit(`S2c 单件=payload+1kg`, [mk('W-OVER', 1, 1, 1, gp.payload + 1, 1)], gp);
  const hq = DB['40HQ'];
  audit(`S2d 40HQ 单件=payload+1kg`, [mk('W-OVER2', 1, 1, 1, hq.payload + 1, 1)], hq);
}

// ═══ S3: 门约束边界 ═══
log('\n########## S3 门约束边界 ##########');
{
  const hq = DB['40HQ'], ot = DB['40OT'], gp = DB['20GP'];
  const cases = [
    ['S3a 20GP 门宽临界 2.34×2.292×1.0', mk('DOOR-EQ', 1.0, 2.340, 2.292, 200, 1), gp],
    ['S3b 20GP 门高 2.30 (超 2.292)', mk('DOOR-HI', 1.0, 1.0, 2.300, 200, 1), gp],
    ['S3c 40HQ 门高 2.60 (超 2.597)', mk('DOOR-HI40', 1.0, 1.0, 2.600, 200, 1), hq],
    ['S3d 40OT 门宽 2.34 (超 OT 2.338)', mk('OT-W', 1.0, 2.340, 1.0, 200, 1), ot],
    ['S3e 40OT 门宽 2.338 临界', mk('OT-W2', 1.0, 2.338, 1.0, 200, 1), ot],
  ];
  for (const [label, item, spec] of cases) {
    const dc = CDB.checkDoorConstraint(item, spec, 0.05);
    log(`  ${label}: 门约束 pass=${dc.pass}${dc.pass ? '' : ' :: ' + dc.reasons[0]}`);
    log(`     分类=${CDB.classifyItemByContainerType(item, 0.05)}  可装朝向=${CDB.hasValidOrientationForContainer(item, spec, 0.05)}`);
  }
  // tolerance 是否在门约束中真正生效
  for (const t of [0, 0.05, 0.10]) {
    const dc = CDB.checkDoorConstraint(mk('T', 1.0, 2.340, 2.292, 1, 1), gp, t);
    const dc2 = CDB.checkDoorConstraint(mk('T2', 1.0, 2.352, 1.0, 1, 1), gp, t);
    log(`  tolerance=${t}: 2.340宽过门=${dc.pass}  2.352宽(箱内宽)过门=${dc2.pass}`);
  }
}

// ═══ S4: 超大货物分类 ═══
log('\n########## S4 超出所有箱型时的分类 ##########');
{
  const fr40 = DB['40FR'];
  const eff = CDB.getEffectiveMaxDims(fr40, 0.05);
  log(`  40FR 有效尺寸 maxL=${eff.maxL} maxW=${eff.maxW} maxH=${eff.maxH}`);
  for (const dims of [[13.0, 1, 1], [12.0, 1, 1], [12.10, 1, 1], [12.20, 1, 1], [6.5, 1, 1], [20, 0.5, 0.5], [3, 3, 1]]) {
    const it = mk('X', dims[0], dims[1], dims[2], 100, 1);
    const cls = CDB.classifyItemByContainerType(it, 0.05);
    const rec = CDB.recommendContainer([it], 0.05);
    log(`  尺寸 ${dims.join('×')}m → 分类=${cls}  推荐=${rec ? (rec.primary && rec.primary.code) || rec.reason : 'null'}`);
  }
}

// ═══ S5: FR 超长货 ═══
log('\n########## S5 FR 超长货（40FR） ##########');
{
  const fr = DB['40FR'];
  audit('S5a 40FR 单件 12.10×2.0×1.0（超内长 11.652）', [mk('OVL', 12.10, 2.0, 1.0, 5000, 1)], fr);
  audit('S5b 40FR 单件 11.9×2.0×1.0（内长内）', [mk('INL', 11.9, 2.0, 1.0, 5000, 1)], fr);
  audit('S5c 40FR 单件 3.5×4.0×1.0（超宽）', [mk('OVW', 3.5, 4.0, 1.0, 5000, 1)], fr);
  audit('S5d 20FR 单件 6.0×2.227×2.219', [mk('FR20', 6.0, 2.227, 2.219, 3000, 1)], DB['20FR']);
}

// ═══ S6: 非 FR 越界 / 悬空 / 叠放（多箱管线） ═══
log('\n########## S6 单箱管线（非 FR）不变量 ##########');
{
  const items = [];
  for (let i = 0; i < 120; i++) items.push(mk('C' + (i % 3), 0.6 + 0.1 * (i % 3), 0.5, 0.4, 30, 1));
  items.push(mk('BIG-NOSTACK', 2.4, 1.1, 1.2, 900, 3, { stackable: false }));
  const r = audit('S6a 20GP 123件异构（含3件不可叠）', items, DB['20GP']);
  // 多箱
  const multi = PE.multiContainerPack(items, DB['20GP'], { tolerance: 0.05 });
  let bad = 0, obTotal = 0, owTotal = 0, svTotal = 0;
  for (const c of multi.containers) {
    const sv = L.checkStackViolation(c), ob = L.checkOutOfBounds(c, DB['20GP']), ow = L.checkOverweight(c, DB['20GP']);
    svTotal += sv.length; obTotal += ob.length; owTotal += ow.length;
    if (sv.length + ob.length + ow.length > 0) { bad++; log(`  ✗ 箱#${c.containerCode} 叠放${sv.length} 越界${ob.length} 超重${ow.length}`); }
  }
  log(`  多箱结果：箱数=${multi.containerCount} 装入=${multi.totalPlaced}/${multi.totalItems} 未装=${multi.unplacedCount} 平均利用率=${(multi.avgUtilization * 100).toFixed(1)}%`);
  log(`  跨箱不变量违规：叠放=${svTotal} 越界=${obTotal} 超重=${owTotal}（违规箱数 ${bad}/${multi.containerCount}）`);
}

// ═══ S7: tolerance=0 / 缺省 ═══
log('\n########## S7 tolerance 边界 ##########');
{
  const it = [mk('TOL', 2.35, 1.0, 1.0, 200, 4)];
  for (const t of [0, 0.05, 0.25]) {
    const r = PE.packSingleContainer(it, DB['20GP'], { tolerance: t });
    log(`  tolerance=${t}: 20GP 装入=${r.placedItems.length}/${it.length} 利用率=${(r.utilization * 100).toFixed(1)}%`);
  }
  const exact = [mk('TOL-EXACT', DB['20GP'].L, 1.0, 1.0, 200, 2)];
  const r0 = PE.packSingleContainer(exact, DB['20GP'], { tolerance: 0.05 });
  log(`  件长=箱内长(5.900) tolerance=0.05: 装入=${r0.placedItems.length}/2`);
  const r1 = PE.packSingleContainer(exact, DB['20GP'], { tolerance: 0 });
  log(`  件长=箱内长(5.900) tolerance=0: 装入=${r1.placedItems.length}/2`);
}

log('\n########## 完成 ##########');
require('fs').writeFileSync(__dirname + '/probe-run.log', L.out.join('\n') + '\n');
