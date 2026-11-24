import { seats } from './seats.js';
export const OPEN = 8 * 3600;
export const CLOSE = 22 * 3600 + 1800;
// Experimental booking policy approved for the stitching prototype.
export const RULES = { minDuration:3600, maxDuration:57600, grace:1800, singleOutstanding:false };
export const USER = 'demo-reader';
export const INITIAL = Date.parse('2026-11-19T12:43:00+08:00') / 1000;
export const dayOf = t => new Date((t+8*3600)*1000).toISOString().slice(0,10);
export const secOf = t => ((t+8*3600)%86400+86400)%86400;
export const at = (date, seconds=0) => Date.parse(`${date}T00:00:00+08:00`)/1000+seconds;
export const nextDay = date => dayOf(at(date)+86400);
export function clock(seconds, withSeconds=false) {
 const v = Math.max(0, Math.floor(seconds));
 return `${String(Math.floor(v/3600)).padStart(2,'0')}:${String(Math.floor(v/60)%60).padStart(2,'0')}${withSeconds?`:${String(v%60).padStart(2,'0')}`:''}`;
}
export const timeValue = value => {const p=value.split(':').map(Number);return p.length>=2&&p.every(Number.isFinite)?p[0]*3600+p[1]*60+(p[2]||0):NaN;};
export const live = r => r.status==='reserved'||r.status==='checked_in';
export const overlap = (a,b,c,d) => a<d&&c<b;
export const bookingDays = now => secOf(now)>=CLOSE ? [nextDay(dayOf(now))] : [dayOf(now)];
export const bookingDatesFor = state => state.replayDate ? [state.replayDate] : bookingDays(state.now);
export const seatsFor = state => state.seats ?? seats;
export const readerFor = state => state.userId ?? USER;
export const minBookingMinutes = state => state.minReservationMinutes ?? RULES.minDuration/60;
export const effectiveEnd = r => Math.max(r.start, Math.min(r.end,r.releasedAt??r.end));
export function intervals(state,seatId,date) {
 return state.reservations.filter(r=>r.seatId===seatId&&r.date===date&&effectiveEnd(r)>r.start)
 .map(r=>[r.start,effectiveEnd(r)]).sort((a,b)=>a[0]-b[0]);
}
export function freeSlots(state,seatId,date,from=OPEN,to=CLOSE) {
 let cursor=at(date,from);const end=at(date,to), out=[];
 for (const [a,b] of intervals(state,seatId,date)) {if(b<=cursor)continue;if(a>=end)break;if(a>cursor)out.push([cursor,Math.min(a,end)]);cursor=Math.max(cursor,b);}
 if(cursor<end)out.push([cursor,end]);return out;
}
export function seatStatus(state,seatId,date) {
 const slots=freeSlots(state,seatId,date); const free=slots.reduce((n,[a,b])=>n+b-a,0);
 return free===CLOSE-OPEN?'free':free===0?'busy':'partial';
}
const addLog=(state,text,when=state.now)=>({...state,nextEventId:(state.nextEventId||0)+1,events:[{id:`event-${state.nextEventId||0}`,at:when,text},...state.events].slice(0,100)});
export function advance(state,target) {
 if(!Number.isFinite(target)||target<state.now)throw new Error('模拟时间只能向前推进；如需重新演示，请重置。');
 let result={...state,now:target,reservations:state.reservations.map(r=>({...r}))};
 for (const r of result.reservations) {
  if(!live(r))continue;
  // Seed visitors have explicit simulated arrival events, not a timeout exemption.
  if(r.autoArriveAt!=null&&r.autoArriveAt<=target&&r.autoArriveAt<r.start+RULES.grace){r.checkedInAt=r.autoArriveAt;r.status='checked_in';}
  if(r.checkedInAt==null&&target>=r.start+RULES.grace){r.status='expired';r.releasedAt=r.start+RULES.grace;result=addLog(result,`${r.seatId}：预约开始 30 分钟未签到，自动释放。`,r.releasedAt);}
  else if(target>=r.end){r.status='completed';r.releasedAt=r.end;result=addLog(result,`${r.seatId}：${r.userId===readerFor(state)?'你的':'其他读者的'}预约时段结束。`,r.end);}
 }
 if(state.inside&&state.now<at(dayOf(state.now),CLOSE)&&target>=at(dayOf(state.now),CLOSE)){result.inside=false;result=addLog(result,'闭馆：模拟馆内状态已重置。',at(dayOf(state.now),CLOSE));}
 result.events.sort((a,b)=>b.at-a.at);
 return result;
}
export function reservationError(state,input) {
 const {seatId,date,start,end}=input;
 if(!seatsFor(state).some(s=>s.id===seatId))return '请选择有效座位。';
 if(!bookingDatesFor(state).includes(date))return '该日期尚未开放预约：每天 22:30 开放次日预约。';
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return '结束时间必须晚于开始时间。';
 if(start<at(date,OPEN)||end>at(date,CLOSE)||dayOf(start)!==date)return '预约须在当日 08:00 至 22:30 之间。';
 if(start<state.now)return '不能预约已经过去的时段，请调整开始时间。';
 const minimum=minBookingMinutes(state);
 if(end-start<minimum*60||end-start>RULES.maxDuration)return `每次预约时长须为 ${minimum}–960 分钟，并在闭馆前结束。`;
 if(state.reservations.some(r=>r.userId===readerFor(state)&&live(r)&&overlap(start,end,r.start,r.end)))return '该时段与你已有的预约重叠；可以同时保留多条预约，但时间不能重叠。';
 if(intervals(state,seatId,date).some(([a,b])=>overlap(start,end,a,b)))return '该时段与已有预约冲突，请选择完整的空闲时段。';
 return '';
}
export function reserve(state,input) {
 const error=reservationError(state,input);if(error)throw new Error(error);
 const checked=state.inside&&dayOf(state.now)===input.date;
 const r={...input,id:`mine-${state.now}-${state.reservations.length}`,userId:readerFor(state),status:checked?'checked_in':'reserved',checkedInAt:checked?state.now:null,createdAt:state.now,releasedAt:null};
 return addLog({...state,reservations:[...state.reservations,r]},`${r.seatId}：预约成功，${clock(secOf(r.start))} 至 ${clock(secOf(r.end))}。`);
}
// Validate against a private staged state. The caller receives a new state only
// if ALL segments succeed; a stale conflict never leaves a partial reservation.
export function reserveBatch(state,segments,{planId,renewal=false}={}) {
 if(!Array.isArray(segments)||!segments.length)throw new Error('预约方案不能为空。');
 const ordered=segments.map(s=>({...s})).sort((a,b)=>a.start-b.start);
 if(new Set(ordered.map(s=>s.date)).size!==1)throw new Error('一套方案必须在同一天内。');
 if(minBookingMinutes(state)<RULES.minDuration/60&&ordered.slice(renewal?0:1).some(s=>s.end-s.start<RULES.minDuration)){
  throw new Error('后续预约段至少 60 分钟。');
 }
 const id=planId||`plan-${state.now}-${state.reservations.length}`;
 let staged=state;
 for(const segment of ordered)staged=reserve(staged,{...segment,planId:id});
 return addLog(staged,`整套方案预约成功：${ordered.length} 段，所有时段已确认。`);
}
export function cancel(state,id) {
 const r=state.reservations.find(r=>r.id===id&&r.userId===readerFor(state)&&live(r));if(!r)throw new Error('该预约已结束，无法取消。');
 return addLog({...state,reservations:state.reservations.map(x=>x.id===id?{...x,status:'cancelled',releasedAt:state.now}:x)},`${r.seatId}：已取消，剩余时段即时释放。`);
}
export function scan(state,direction) {
 if(direction==='in') {
  if(state.inside)throw new Error('当前已在馆内。');
  if(secOf(state.now)<OPEN||secOf(state.now)>=CLOSE)throw new Error('当前为闭馆时间，无法模拟入馆。');
  return addLog({...state,inside:true,reservations:state.reservations.map(r=>r.userId===readerFor(state)&&live(r)&&r.date===dayOf(state.now)?{...r,status:'checked_in',checkedInAt:state.now}:r)},'入馆扫码成功；当日有效预约已签到。');
 }
 if(!state.inside)throw new Error('当前不在馆内。');
 return addLog({...state,inside:false,reservations:state.reservations.map(r=>r.userId===readerFor(state)&&live(r)&&r.date===dayOf(state.now)?{...r,status:'signed_out',releasedAt:state.now}:r)},'离馆扫码成功；当日有效预约已签退，剩余时段即时释放。');
}
export function createState(empty=false) {
 let state={version:2,now:INITIAL,inside:false,reservations:[],events:[],nextEventId:0};
 if(!empty) for(const date of [dayOf(INITIAL),nextDay(dayOf(INITIAL))]) seats.forEach((s,i)=>{
  const blocks=s.id==='LC2-M-025'?[[14,17],[18,22.5]]:s.id==='LC2-M-051'?[[8,22.5]]:i%5===0?[]:i%5===1?[[8,22.5]]:i%5===2?[[8,13],[16,20]]:i%5===3?[[14,17],[18.5,22.5]]:[[8,10],[15,19]];
  blocks.forEach(([a,b],j)=>state.reservations.push({id:`seed-${date}-${i}-${j}`,userId:`sample-${date}-${i}-${j}`,seatId:s.id,date,start:at(date,a*3600),end:at(date,b*3600),createdAt:at(date)-5400,status:'reserved',checkedInAt:null,autoArriveAt:at(date,a*3600),releasedAt:null,note:'合成演示数据'}));
 });
 state=advance(state,state.now);state.events=[{id:'init',at:state.now,text:empty?'已载入全空场景。':'已载入演示预约。非真实历史记录。'}];return state;
}
