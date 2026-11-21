import {seats} from './seats.js';
import {createState,at,dayOf,OPEN,CLOSE,USER,live,advance,scan} from './engine.js';
export const DEMO_SEATS={A:seats[0].id,B:seats[1].id};
export const SCENE_DEFINITIONS=[
 {id:'stitch',title:'必须换座',description:'A 只能坐到 15:00，B 从 15:00 开始有空。没有一张座位能坐满三小时。',outcome:'把 A、B 两段一起预约，得到 3 小时学习时间。'},
 {id:'renewal',title:'先坐，再续',description:'开始只有 A 的一小时可用。先预约、入馆，再模拟别人释放 B。',outcome:'从已约 1 小时，变成两段共 3 小时。'},
 {id:'gap',title:'有空窗',description:'A 到 15:00，B 从 15:05 才空闲。换座之间确实有 5 分钟没座位。',outcome:'接受 5 分钟可以拼接；改成 0 分钟就无法拼满。'},
 {id:'single',title:'一张就够',description:'A 从 14:00 到 17:00 一直空闲，用作无需换座的对照。',outcome:'优先选一张座位，不为了拼接而让人换座。'},
];
export const SCENARIOS=Object.fromEntries(SCENE_DEFINITIONS.map(s=>[s.id,s.title]));
export function createScenario(name){
 if(name==='demo'||name==='empty')return createState(name==='empty');
 if(!SCENARIOS[name])throw new Error('未知演示场景。');
 const s=createState(true),date=dayOf(s.now),{A,B}=DEMO_SEATS;
 s.now=at(date,13*3600+50*60);s.scenario=name;s.demoSession=true;s.demoStage='initial';
 const free={};
 if(name==='single')free[A]=[[14*3600,17*3600]];
 else free[A]=[[14*3600,15*3600]];
 if(['stitch','gap'].includes(name))free[B]=[[15*3600+(name==='gap'?300:0),17*3600]];
 for(const seat of seats){let cursor=OPEN,n=0;
  const add=(a,b,extra={})=>{if(b>a)s.reservations.push({id:`scenario-${name}-${seat.id}-${n++}`,userId:`sample-${seat.id}-${n}`,seatId:seat.id,date,start:at(date,a),end:at(date,b),status:'checked_in',checkedInAt:Math.min(s.now,at(date,a)),createdAt:s.now,note:'合成场景数据',...extra});};
  if(name==='renewal'&&seat.id===B){add(OPEN,15*3600);add(15*3600,17*3600,{scenarioHold:true});add(17*3600,CLOSE);continue;}
  for(const [a,b] of free[seat.id]||[]){add(cursor,a);cursor=b;}add(cursor,CLOSE);
 }
 s.events=[{id:'init',at:s.now,text:`已进入「${SCENARIOS[name]}」独立演示，学习目标 14:00–17:00。`}];
 return s;
}
export const demoBookings=state=>state.reservations.filter(r=>r.userId===USER&&(live(r)||r.status==='completed')).sort((a,b)=>a.start-b.start);
const log=(state,text)=>({...state,nextEventId:(state.nextEventId||0)+1,events:[{id:`event-${state.nextEventId||0}`,at:state.now,text},...state.events].slice(0,100)});
export function enterScenarioLibrary(state){
 if(state.scenario!=='renewal'||state.demoStage!=='reserved')throw new Error('请先预约 A 的一小时。');
 if(!demoBookings(state).some(r=>r.seatId===DEMO_SEATS.A))throw new Error('没有找到 A 座预约。');
 const started=advance(state,at(dayOf(state.now),14*3600));
 return {...(started.inside?started:scan(started,'in')),demoStage:'checked_in'};
}
// One explicit cancellation event; only the 15:00–17:00 hold is released.
export function releaseScenarioSeat(state){
 if(state.scenario!=='renewal')throw new Error('请先载入续座场景。');
 if(state.scenarioReleased)throw new Error('该示例座位已释放。');
 return log({...state,scenarioReleased:true,demoStage:'released',reservations:state.reservations.map(r=>r.scenarioHold?{...r,status:'cancelled',releasedAt:state.now}:r)},`${DEMO_SEATS.B}：模拟他人取消 15:00–17:00 预约，新增空位现已可查。`);
}
export function advanceAndRelease(state){
 if(state.demoStage!=='checked_in')throw new Error('请先模拟入馆签到，避免原预约超时。');
 return releaseScenarioSeat(advance(state,at(dayOf(state.now),14*3600+50*60)));
}
