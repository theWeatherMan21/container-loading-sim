// probe11.js — 1440 件 0.5m 立方：容差对端到端箱数的影响
const path=require('path');
const REPO='/Users/russospencer/Documents/trae_projects/ContainerLoadingSim';
const {createRuntime}=require(path.join(REPO,'scripts/_load-runtime.js'));
const ctx=createRuntime(['container-db.js','planner.js','packing-engine.js']);
const PE=ctx.window.PackingEngine;
const items=[{model:'CUBE',l:0.5,w:0.5,h:0.5,weight:5,quantity:1440,stackable:true}];
for(const t of [0.05,0.04,0.03,0.01]){
  const t0=Date.now();
  const r=PE.calculate(items,'40HQ',{tolerance:t,randomStarts:0,optimize:false});
  console.log(`tolerance=${t}: 箱数=${r.containerCount} 每箱=${r.containers.map(c=>c.placedItems.length).join('+')} 平均利用率=${(r.avgUtilization*100).toFixed(1)}% 耗时=${Date.now()-t0}ms`);
}
