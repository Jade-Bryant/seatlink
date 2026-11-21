import React from 'react';
import {DEMO_SEATS,SCENE_DEFINITIONS,demoBookings} from './scenarios.js';
import {freeSlots,dayOf,clock,secOf} from './engine.js';
const fmt=t=>clock(secOf(t));
export function DemoSelector({active,onSelect}){
 return <div className="demo-selector"><div className="demo-selector-heading"><strong>选一个场景，直接看结果</strong><span>独立模拟数据</span></div><div className="demo-options" role="group" aria-label="演示场景">{SCENE_DEFINITIONS.map(s=><button key={s.id} aria-pressed={active===s.id} onClick={()=>onSelect(s.id)}>{s.title}</button>)}</div></div>;
}
export function DemoStory({state,maxGap,onSetGap,onEnter,onRelease,onFind,onShowReservations,renderMap}){
 const scene=SCENE_DEFINITIONS.find(s=>s.id===state.scenario),stage=state.demoStage;
 if(!scene)return null;
 const mine=demoBookings(state),hours=mine.reduce((n,r)=>n+r.end-r.start,0)/3600;
 const minutes=Math.round(hours*60),remaining=Math.max(0,180-minutes);
 const renewal=state.scenario==='renewal';
 return <section className="demo-story">
 <h2>{scene.title}</h2><p>{scene.description}</p><div className="demo-target"><strong>想学习 14:00–17:00</strong><span>最多换 1 次 · 每段至少 60 分钟</span></div>
 <div className="demo-seat-windows">{Object.entries(DEMO_SEATS).map(([alias,id])=><div key={id}><span className={`demo-seat-badge seat-${alias.toLowerCase()}`}>{alias}</span><div><strong>{alias} 座 · {id}</strong><span>{mine.some(r=>r.seatId===id)?`已为你预约 ${mine.filter(r=>r.seatId===id).map(r=>`${fmt(r.start)}–${fmt(r.end)}`).join('、')}`:freeSlots(state,id,dayOf(state.now),14*3600,17*3600).map(([a,b])=>`${fmt(a)}–${fmt(b)}`).join('、')||'目标时段内没有空闲'}</span></div></div>)}</div>
 <p className="demo-expectation">这次看点：{scene.outcome}</p>
 {state.scenario==='gap'&&<div className="demo-gap-options"><span>每次可接受空窗</span><button aria-pressed={Number(maxGap)===5} onClick={()=>onSetGap(5)}>接受 5 分钟</button><button aria-pressed={Number(maxGap)===0} onClick={()=>onSetGap(0)}>不接受空窗（0 分钟）</button></div>}
 {renewal&&<>
 <ol className="demo-steps">{['先约一小时','模拟入馆','14:50 释放 B','确认续座'].map((label,i)=>{const stages={initial:0,reserved:1,checked_in:2,released:3,complete:4};return <li key={label} className={i<(stages[stage]||0)?'done':i===(stages[stage]||0)?'current':''}><span>{i+1}</span>{label}</li>;})}</ol>
 <div className="demo-progress" data-testid="demo-progress"><strong>已预约 {minutes} 分钟</strong><span>{remaining?`距离三小时目标还缺 ${remaining} 分钟`:'三小时已全部预约，共两段'}</span></div>
 {stage==='initial'&&<p className="demo-next">先确认下方的一小时预约，再看后续空位如何出现。</p>}
 {stage==='reserved'&&<button className="primary" onClick={onEnter}>模拟入馆签到</button>}
 {stage==='checked_in'&&<button className="primary" onClick={onRelease}>推进到 14:50，模拟 B 释放</button>}
 {stage==='released'&&<div role="status" className="demo-discovery"><strong>新发现：B 座 15:00–17:00 可预约</strong><p>已按最新空位查找续座。下面的两小时还未预约，确认后才会加入我的预约。</p><button onClick={onFind}>重新查询续座机会</button></div>}
 </>}
 {mine.length>0&&(!renewal||stage==='complete')&&<div className="demo-booked" role="status"><strong>{renewal?'续座完成':'预约成功'} · 共 {mine.length} 段，{minutes} 分钟</strong><ul>{mine.map(r=><li key={r.id}>{Object.entries(DEMO_SEATS).find(([,id])=>id===r.seatId)?.[0]} 座 · {r.seatId} · {fmt(r.start)}–{fmt(r.end)}</li>)}</ul><button onClick={onShowReservations}>查看这次演示的预约</button></div>}
 <details className="demo-map"><summary>在座位图上定位 A、B</summary>{renderMap?.()}</details>
 </section>;
}
