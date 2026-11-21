import {seats,tables} from '../src/seats.js';
import {at,freeSlots,secOf,clock} from '../src/engine.js';
import {planSeats} from '../src/planner.js';

// These synthetic windows are deliberately varied for UI comparison. No storage,
// booking APIs, network calls, or live school records are used by this experiment.
const DATE='2026-11-20', OPEN=480, CLOSE=1350;
const $=id=>document.getElementById(id);
const fmt=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const minutes=value=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
const ui={start:840,end:1020,dataset:'fragmented',released:false,view:'timeline',filter:'available',sort:'id',allDay:false,maxGap:5,maxSwitches:1,selected:seats[0].id,routeIds:[]};
let model, rows, currentPlans=[];

function syntheticWindows(i){
 const morning=i%3===0?[[540,660]]:i%3===1?[[630,750]]:[];
 const evening=i%4===0?[[1080,1230]]:i%4===1?[[1200,1350]]:[];
 let afternoon=[];
 if(ui.dataset==='renewal'){
  if(i===0)afternoon=[[840,900]];
  if(i===1&&ui.released)afternoon=[[900,1020]];
 }else if(ui.dataset==='gap'){
  if(i%10===0)afternoon=[[840,900]];
  if(i%10===1)afternoon=[[905,1020]];
 }else{
  afternoon=[[[840,900]],[[900,1020]],[[840,930]],[[930,1020]],[[840,960]],[[960,1020]],[[870,945]],[],[],[[990,1050]]][i%10];
  if(ui.dataset==='full'&&i%17===0)afternoon=[[810,1050]];
 }
 return [...morning,...afternoon,...evening];
}
function buildModel(){
 const state={version:2,now:at(DATE,8*3600),inside:false,reservations:[],events:[]};
 seats.forEach((s,i)=>{
  let cursor=OPEN,n=0;
  const busy=(a,b)=>{if(b>a)state.reservations.push({id:`ui-${i}-${n++}`,seatId:s.id,userId:`sample-${i}`,date:DATE,start:at(DATE,a*60),end:at(DATE,b*60),status:'reserved'});};
  for(const [a,b] of syntheticWindows(i)){busy(cursor,a);cursor=b;}
  busy(cursor,CLOSE);
 });
 return state;
}
function getRows(){return seats.map(s=>{
 const windows=freeSlots(model,s.id,DATE).map(([a,b])=>[secOf(a)/60,secOf(b)/60]);
 const slots=windows.map(([a,b])=>[Math.max(a,ui.start),Math.min(b,ui.end)]).filter(([a,b])=>b>a);
 const total=slots.reduce((n,[a,b])=>n+b-a,0);
 const full=slots.some(([a,b])=>a<=ui.start&&b>=ui.end);
 return {...s,windows,slots,total,status:full?'full':total?'partial':'busy'};
});}
function filteredRows(){return rows.filter(s=>ui.filter==='all'||(ui.filter==='full'?s.status==='full':s.total>0)).sort((a,b)=>ui.sort==='longest'?b.total-a.total||a.id.localeCompare(b.id):a.id.localeCompare(b.id));}
function name(s){return `<span class="seat-name">${s.id}<span class="seat-meta">${s.verified?'位置与编号已核对':'临时编号'}</span></span>`;}
function slotText(s){return s.slots.length?s.slots.map(([a,b])=>`${fmt(a)}–${fmt(b)}<br><span class="dim">${b-a} 分钟${b-a<60?' · 不足最短 60 分钟':''}</span>`).join('<br>'):'目标时段内无空闲';}
function statusTag(s){return `<span class="tag ${s.status==='full'?'':'partial'}">${s.status==='full'?'全程可坐':'部分有空'}</span>`;}
function selectors(){return `<div class="toolbar"><label><span class="sr-only">显示范围</span><select id="filter"><option value="available">只看有空闲</option><option value="full">只看全程可坐</option><option value="all">显示全部 83 个</option></select></label><label><span class="sr-only">排序方式</span><select id="sort"><option value="id">按座位编号</option><option value="longest">空闲总时长优先</option></select></label></div>`;}
function legend(map=false){return `<div class="legend"><span><i class="swatch free"></i>${map?'全程可坐':'空闲'}</span>${map?'<span><i class="swatch partial"></i>部分有空</span>':''}<span><i class="swatch busy"></i>${map?'此时段无空闲':'已有预约'}</span>${map?'':'<span><i class="swatch target"></i>你想学习的时间</span>'}<span class="timeline-caption">${fmt(ui.start)}–${fmt(ui.end)} · ${ui.end-ui.start} 分钟</span></div>`;}
function displayRange(){return ui.allDay?[OPEN,CLOSE]:[Math.max(OPEN,Math.floor((ui.start-60)/60)*60),Math.min(CLOSE,Math.ceil((ui.end+60)/60)*60)];}
function ticks(a,b){const out=[a];const step=b-a>480?180:b-a>240?60:30;for(let x=Math.ceil((a+1)/step)*step;x<b;x+=step)if(x-a>=30&&b-x>=30)out.push(x);out.push(b);return out;}
function axis(a,b,mini=false){return `<div class="axis ${mini?'mini-axis':''}">${ticks(a,b).map(t=>`<span class="tick" style="left:${(t-a)/(b-a)*100}%">${fmt(t)}</span>`).join('')}</div>`;}
function track(s,a,b){const pct=x=>(x-a)/(b-a)*100;return `<div class="track" role="img" aria-label="${s.id}，目标时段内${s.slots.length?'可坐 '+s.slots.map(([x,y])=>fmt(x)+' 至 '+fmt(y)).join('，'):'无空闲'}">${ticks(a,b).map(t=>`<span class="tick-line" style="left:${pct(t)}%"></span>`).join('')}${s.windows.map(([x,y])=>[Math.max(x,a),Math.min(y,b)]).filter(([x,y])=>y>x).map(([x,y])=>`<span class="free-block" style="left:${pct(x)}%;width:${(y-x)/(b-a)*100}%">${(y-x)/(b-a)>.24?`${fmt(x)}–${fmt(y)}`:''}</span>`).join('')}<span class="target-band" style="left:${pct(ui.start)}%;width:${(ui.end-ui.start)/(b-a)*100}%"></span></div>`;}
function renderTimeline(){
 const list=filteredRows(),[a,b]=displayRange();
 return `<div class="panel"><div class="view-heading"><div><h2>一行一个座位，哪里有空直接看</h2><p>蓝色边线框住你的学习时间；右侧直接列出其中可坐的时段。</p></div>${selectors()}</div><div class="toolbar" style="margin-bottom:14px"><label class="check-control"><input type="checkbox" id="all-day" ${ui.allDay?'checked':''}>展开全天 08:00–22:30</label><span class="timeline-caption">显示 ${list.length} / 83 个座位</span></div>${legend()}<div class="timeline-table"><div class="table-head"><span>座位</span>${axis(a,b)}<span>目标时间内可以坐</span></div><div class="table-body">${list.length?list.map(s=>`<article class="time-row">${name(s)}<div class="track-cell">${axis(a,b,true)}${track(s,a,b)}</div><div class="slot-text ${s.total?'':'none'}">${slotText(s)}</div></article>`).join(''):'<p class="empty-list">这个筛选下没有座位，试试“只看有空闲”或调整学习时间。</p>'}</div></div><p class="view-footnote">适合快速比较很多座位。绿色片段不足 60 分钟时会标明，不能直接作为单段预约。</p></div>`;
}
function svgMap(){return `<svg class="seat-svg" viewBox="0 0 960 560" role="img" aria-label="C200 中区座位位置图，颜色按目标时段计算；下方或右侧列表可读取各座位时间并定位"><rect x="12" y="14" width="936" height="532" rx="10" fill="#fff" stroke="#d7e0e7"/><path d="M22 36H930M22 38H930" stroke="#cedae5" stroke-width="3"/><text x="48" y="28" fill="#627785" font-size="13">窗侧</text>${tables.map(([x,y,w,h,r])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#e7ecf0" stroke="#d3dde5" transform="rotate(${r} ${x+w/2} ${y+h/2})"/>`).join('')}${rows.map(s=>{const selected=ui.selected===s.id,route=ui.routeIds.includes(s.id),color=s.status==='full'?'#12684c':s.status==='partial'?'#82520c':'#627281',bg=s.status==='full'?'#dbf1e6':s.status==='partial'?'#ffedc0':'#f0f3f5';return `<g><rect x="${s.x-13}" y="${s.y-12}" width="26" height="24" rx="4" fill="${bg}" stroke="${selected||route?'#194db4':color}" stroke-width="${selected||route?3:1}" ${s.status==='busy'&&!selected&&!route?'stroke-dasharray="2 2"':''}/><text x="${s.x}" y="${s.y+4}" text-anchor="middle" fill="${color}" font-size="11" font-weight="600">${s.verified?'L'+Number(s.id.slice(-3)):s.id.slice(-3)}</text>${selected?`<circle cx="${s.x}" cy="${s.y-20}" r="4" fill="#194db4"/>`:''}</g>`;}).join('')}<text x="70" y="522" fill="#627785" font-size="14">C200 中区 · 位置示意</text></svg>`;}
function renderMap(){const list=filteredRows(),selected=rows.find(s=>s.id===ui.selected);return `<div class="panel"><div class="view-heading"><div><h2>先定时间，再看哪个位置合适</h2><p>颜色随你的学习时段变化。所有可坐时间都在列表里，不用逐个打开。</p></div>${selectors()}</div>${legend(true)}${ui.routeIds.length?`<p class="route-location-note">已标出路线涉及的座位：${ui.routeIds.join('、')}。列表中点“定位”可逐段查看。</p>`:''}<div class="map-layout"><div class="map-card"><div class="map-top"><b>${fmt(ui.start)}–${fmt(ui.end)}</b><span>手机可横向滑动地图</span></div><div class="map-scroll">${svgMap()}</div><div class="map-selection" aria-live="polite"><strong>已定位 · ${selected.id}</strong><p>${selected.slots.length?'可坐 '+selected.slots.map(([a,b])=>`${fmt(a)}–${fmt(b)}`).join('、'):'目标时段内无空闲'}${selected.slots.some(([a,b])=>b-a<60)?'；其中不足 60 分钟的片段不可单独预约':''}</p></div></div><div class="map-list"><p class="map-list-header">${list.length} 个结果 · 时段全部展开</p>${list.map(s=>`<article class="map-item ${s.id===ui.selected?'selected':''}" data-seat="${s.id}"><div>${name(s)}<div class="slot-text">${slotText(s)}</div></div><div>${s.total?statusTag(s):''}<br><button data-locate="${s.id}" aria-label="定位 ${s.id}" aria-pressed="${s.id===ui.selected}" style="margin-top:8px">定位</button></div></article>`).join('')||'<p class="empty-list">当前筛选没有匹配座位。</p>'}</div></div><p class="view-footnote">地图保留全部座位，筛选只作用于旁边的结果列表。L25 / L51 为已核对真实编号，其余标注为 SIM 编号末三位，尚待核对。</p></div>`;}
function renderRoutes(){
 currentPlans=planSeats(model,{date:DATE,start:fmt(ui.start),end:fmt(ui.end),minSegmentMinutes:60,maxSwitches:ui.maxSwitches,maxGapMinutes:ui.maxGap,allowPartial:true,limit:3}).plans;
 const first=currentPlans[0],full=first?.reachesEnd;
 const intro=!first?'从所选开始时间，找不到符合“每段至少 60 分钟”的方案。可调整时间或换座条件。':full?first.kind==='single'?'已有一个座位可以坐满，不需要换座。':`可通过换座接到 ${fmt(ui.end)}。${first.gapSeconds?'注意：空窗期间没有座位，不计入学习时长。':'下面每一段都已是这批数据中的可用时间。'}`:`目前只能先坐到 ${clock(secOf(first.coveredUntil))}；后面是否有空位不确定，不保证能续上。`;
 return `<div class="panel"><div class="view-heading"><div><h2>不必自己心算，直接看怎么接</h2><p>每段至少 60 分钟。这里仅比较路线，不创建预约或推送。</p></div><div class="route-settings"><label>最多换座<select id="switches"><option value="0">不换座</option><option value="1">1 次</option><option value="2">2 次</option></select></label><label>每次可接受空窗<select id="gap"><option value="0">不接受空窗</option><option value="5">5 分钟</option><option value="15">15 分钟</option></select></label></div></div><p class="route-intro" role="status">${intro}</p><div class="route-grid">${currentPlans.map((p,i)=>`<article class="route-card ${i===0?'recommended':''}" data-plan="${i}"><div class="route-top"><h3>${p.kind==='single'?'一张就够':p.kind==='partial'?'先坐这一段':'换座接着学'}</h3><span class="tag ${p.gapSeconds||!p.reachesEnd?'partial':''}">${p.reachesEnd?p.gapSeconds?'有空窗':'完整覆盖':'待续座'}</span></div><div class="route-summary"><b>${p.seatedSeconds/60}</b> 分钟有座<span>换 ${p.switches} 次${p.gapSeconds?` · 空窗 ${p.gapSeconds/60} 分钟`:''}</span></div><ol class="route-steps">${p.segments.map((s,j)=>`<li class="route-step"><time>${clock(secOf(s.start))}–${clock(secOf(s.end))}</time><strong>${s.seatId}</strong><small>可坐 ${(s.end-s.start)/60} 分钟</small>${p.gaps.find(g=>g.start===s.end)?`<p class="gap-note">${clock(secOf(p.gaps.find(g=>g.start===s.end).start))}–${clock(secOf(p.gaps.find(g=>g.start===s.end).end))} 暂无座位 · 空窗 ${p.gaps.find(g=>g.start===s.end).seconds/60} 分钟</p>`:''}</li>`).join('')}${!p.reachesEnd?`<li class="route-step"><time>${clock(secOf(p.coveredUntil))}–${fmt(ui.end)}</time><small>尚无可接续座位，不保证续上</small></li>`:''}</ol><div class="route-bottom">${p.gapSeconds?'空窗时段已明确列出；实际预约前需要用户接受。':p.reachesEnd?'相邻时段首尾相接，换座不额外扣 5 分钟。':'若出现新空位，再更新接续机会。'}<button data-route="${i}">在地图上看位置</button></div></article>`).join('')}</div>${!currentPlans.length?'<p class="route-empty">可以切换为“空闲时段零散”，恢复 14:00–17:00，查看换座路线。</p>':''}<p class="view-footnote">适合直接选择一段学习安排。路线根据当前合成空闲时段计算，不预测未来释放。</p></div>`;
}
function renderView(){
 $('view').innerHTML=ui.view==='timeline'?renderTimeline():ui.view==='map'?renderMap():renderRoutes();
 $('view').setAttribute('aria-labelledby',`tab-${ui.view}`);
 document.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.view===ui.view));b.tabIndex=b.dataset.view===ui.view?0:-1;});
 for(const [id,value] of [['filter',ui.filter],['sort',ui.sort],['switches',ui.maxSwitches],['gap',ui.maxGap]])if($(id))$(id).value=String(value);
}
function refresh(){
 model=buildModel();rows=getRows();
 $('stats').innerHTML=[['full','全程可坐','不用换座'],['partial','部分有空','可比较或拼接'],['busy','此时段无空闲','目标时段内']].map(([key,title,sub])=>`<div class="stat ${key}"><div class="number" data-count="${key}">${rows.filter(s=>s.status===key).length}</div><div><b>${title}</b><small>${sub}</small></div></div>`).join('');
 const descriptions={fragmented:'这批数据没有一张座位能坐满 14:00–17:00，可以比较错开的空闲片段。',gap:'14:00–15:00 与 15:05–17:00 之间有空窗；在“换座路线”调整可接受空窗比较结果。',full:'这批数据加入了连续三小时的空位，看看哪种视图最容易找到它。',renewal:ui.released?'模拟释放后：002 新增 15:00–17:00 空位，三个视图同时更新。':'模拟释放前：14:00–17:00 内只有 001 的 14:00–15:00 可坐，后续尚不确定。'};
 $('data-event').innerHTML=`<span>${descriptions[ui.dataset]}</span>${ui.dataset==='renewal'?`<button id="release" type="button">${ui.released?'还原释放前':'查看 002 释放后的变化'}</button>`:''}`;
 renderView();
}
function changeView(view){ui.view=['timeline','map','routes'].includes(view)?view:'timeline';history.replaceState(null,'',`#${ui.view}`);renderView();}
$('controls').addEventListener('submit',e=>{
 e.preventDefault();const start=minutes($('start').value),end=minutes($('end').value);
 const error=!Number.isFinite(start)||!Number.isFinite(end)||end<=start?'结束时间需要晚于开始时间。':start<OPEN||end>CLOSE?'查看时间须在 08:00–22:30 内。':'';
 $('form-error').hidden=!error;$('form-error').textContent=error;if(error)return;
 ui.start=start;ui.end=end;ui.routeIds=[];refresh();
});
$('dataset').addEventListener('change',e=>{ui.dataset=e.target.value;ui.released=false;ui.selected=seats[0].id;ui.routeIds=[];refresh();});
$('reset').addEventListener('click',()=>{ui.start=840;ui.end=1020;$('start').value='14:00';$('end').value='17:00';$('form-error').hidden=true;ui.routeIds=[];refresh();});
$('data-event').addEventListener('click',e=>{if(e.target.closest('#release')){ui.released=!ui.released;ui.routeIds=[];refresh();$('release').focus();}});
document.querySelector('.tabs').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)changeView(b.dataset.view);});
document.querySelector('.tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const list=['timeline','map','routes'],index=list.indexOf(ui.view),next=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;changeView(list[next]);$(`tab-${list[next]}`).focus();});
$('view').addEventListener('change',e=>{
 const id=e.target.id;
 if(id==='filter')ui.filter=e.target.value;if(id==='sort')ui.sort=e.target.value;if(id==='all-day')ui.allDay=e.target.checked;
 if(id==='switches')ui.maxSwitches=Number(e.target.value);if(id==='gap')ui.maxGap=Number(e.target.value);
 renderView();$(id)?.focus();
});
$('view').addEventListener('click',e=>{
 const locate=e.target.closest('[data-locate]');
 if(locate){const listScroll=document.querySelector('.map-list')?.scrollTop||0;ui.selected=locate.dataset.locate;renderView();document.querySelector('.map-list').scrollTop=listScroll;document.querySelector(`[data-locate="${ui.selected}"]`)?.focus({preventScroll:true});const s=seats.find(s=>s.id===ui.selected),scroller=document.querySelector('.map-scroll'),svg=document.querySelector('.seat-svg');scroller.scrollLeft=s.x/960*svg.clientWidth-scroller.clientWidth/2;}
 const route=e.target.closest('[data-route]');
 if(route){ui.routeIds=currentPlans[Number(route.dataset.route)].segments.map(s=>s.seatId);ui.selected=ui.routeIds[0];ui.filter='available';changeView('map');$('view').focus();}
});
window.addEventListener('hashchange',()=>changeView(location.hash.slice(1)));
if(['timeline','map','routes'].includes(location.hash.slice(1)))ui.view=location.hash.slice(1);
refresh();
