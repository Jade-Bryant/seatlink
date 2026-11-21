import React from 'react';
import {tables} from './seats.js';
import {seatStatus} from './engine.js';
const labels={free:'全程可坐',partial:'部分可坐',busy:'不可约'};
export default function SeatMap({seats,selected,date,state,query,onPick,highlights=null,statuses=null,visibleIds=null}){
 return <svg className="seat-map" viewBox="0 0 950 535" aria-label="C200 中区可交互座位图">
 <defs><pattern id="wood" width="30" height="18" patternUnits="userSpaceOnUse"><rect width="30" height="18" fill="#cfa87e"/><path d="M29 0V18" stroke="#efd6b5" strokeWidth="2"/></pattern><linearGradient id="half"><stop offset="50%" stopColor="#68a83e"/><stop offset="50%" stopColor="#fac849"/></linearGradient></defs>
 <rect width="950" height="535" fill="#f3f3f3"/><path d="M92 0V145H10V278H141V535M92 0V535M944 535V300H950" fill="none" stroke="#aaa" strokeWidth="6"/>
 <path d="M12 280H142V420H12M142 280V535" fill="none" stroke="#aaa" strokeWidth="3"/><text x="54" y="357" fontSize="14">C215</text><text x="54" y="492" fontSize="14">C216</text>
 <text x="477" y="48" fontSize="29" fontWeight="600">C200中区（M）</text><text x="911" y="173" fontSize="24">大</text><text x="911" y="203" fontSize="24">门</text>
 {tables.map(([x,y,w,h,r],i)=><rect key={i} x={x} y={y} width={w} height={h} fill="url(#wood)" transform={`rotate(${r} ${x} ${y})`}/>)}
 {[{x:300,y:36,h:148},{x:300,y:260,h:136},{x:650,y:110,h:383},{x:772,y:276,h:139}].map((b,i)=><g key={i}><rect x={b.x} y={b.y} width="10" height={b.h} fill="#ddd" stroke="#303030" strokeWidth="2"/>{Array.from({length:Math.floor(b.h/24)},(_,j)=><path key={j} d={`M${b.x} ${b.y+j*24}h10`} stroke="#555"/>)}</g>)}
 <path d="M310 280L414 128M352 455L550 181" stroke="#999" strokeWidth="8"/><path d="M310 280L414 128M352 455L550 181" stroke="#eee" strokeWidth="4"/>
 <g transform="translate(224 473)"><circle r="38" fill="#fff" stroke="#555" strokeWidth="2"/>{Array.from({length:14},(_,i)=><path key={i} d="M0 0L36 0" stroke="#666" transform={`rotate(${i*25.7})`}/>)}<circle r="10" fill="#eee" stroke="#555"/></g>
 <path d="M778 179a27 27 0 1 1 31 7v-17a13 13 0 1 0-16-4" fill="#fafafa" stroke="#999" strokeWidth="2"/>
 {seats.map(s=>{const status=statuses?.[s.id]?.status||seatStatus(state,s.id,date),label=statuses?.[s.id]?.label||labels[status],match=query&&s.id.toLowerCase().includes(query.toLowerCase()),alias=highlights&&Object.entries(highlights).find(([,id])=>id===s.id)?.[0];return <g role="button" tabIndex="0" aria-label={`${s.id} ${label}`} key={s.id} data-seat={s.id} onClick={()=>onPick(s)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(s);}}} className={`seat-point ${match?'matched':''}`} opacity={visibleIds&&!visibleIds.has(s.id)?0.38:highlights&&!alias?0.25:query&&!match?0.25:1}><title>{s.id} · {label}{!s.verified?' · 模拟编号':''}</title><circle cx={s.x} cy={s.y} r="14" fill="transparent"/><circle cx={s.x} cy={s.y} r={alias?12:match?10:8} fill={selected?.id===s.id?'#ca3228':status==='free'?'#68a83e':status==='partial'?'url(#half)':'#fac849'} stroke={alias?'#075cd4':match?'#075cd4':'#fff'} strokeWidth={alias?3:match?3:1}/>{alias&&<text x={s.x+(alias==='A'?-23:19)} y={s.y+(alias==='A'?22:-18)} fontSize="22" fontWeight="700" fill="#075cd4" stroke="white" strokeWidth="4" paintOrder="stroke">{alias}</text>}</g>})}
 </svg>;
}
