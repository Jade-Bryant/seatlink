import test from 'node:test';
import assert from 'node:assert/strict';
import {seats} from '../src/seats.js';
import {createState,at,reserve} from '../src/engine.js';
import {findRecommendations,selectionError,reserveRecommended,DEMO_PROFILES} from '../src/recommendation-service.js';
import {inspectNearby,evaluateSeatProfile,buildTimelineSeats} from '../src/recommendations.js';
const date='2026-11-19',start=14*3600,end=17*3600;
const request={date,start:'14:00',end:'17:00',preferences:['display']};
const input=(id,a=start,b=end)=>({seatId:id,date,start:at(date,a),end:at(date,b)});
const profiles=Object.fromEntries(seats.map(s=>[s.id,{display:false}]));
const ids=seats.slice(0,4).map(s=>s.id);
profiles[ids[0]]={display:null};profiles[ids[1]]={display:true};profiles[ids[2]]={display:true};

test('full seats precede partials; preferences rank within each availability class',()=>{
 const state=createState(true);
 state.reservations.push({...input(ids[1],15*3600,end),userId:'other',status:'checked_in'});
 const {ranking}=findRecommendations(state,{...request,allowPartial:true},profiles);
 assert.equal(ranking.results[0].id,ids[2]);
 assert.equal(ranking.results.at(-1).id,ids[1]);
 assert.equal(ranking.results.at(-1).status,'partial');
 assert.ok(!findRecommendations(state,request,profiles).ranking.results.some(s=>s.id===ids[1]));
});
test('required excludes unknown and false attributes, without silently relaxing',()=>{
 const {ranking}=findRecommendations(createState(true),{...request,required:true},profiles);
 assert.deepEqual(ranking.results.map(s=>s.id),[ids[1],ids[2]]);
 assert.equal(ranking.excludedCount,81);
});
test('list and map share ranked IDs; show all never promotes excluded seats',()=>{
 const data=findRecommendations(createState(true),{...request,required:true},profiles);
 const only=buildTimelineSeats(data.rows,data.ranking);
 const all=buildTimelineSeats(data.rows,data.ranking,{includeAll:true});
 assert.deepEqual(all.filter(s=>s.isRecommended).map(s=>s.id),only.map(s=>s.id));
 assert.equal(all.length,83);assert.ok(all.slice(2).every(s=>s.recommendationRank===null));
});
test('unknown or missing environment cannot bypass required preference on manual submission',()=>{
 const state=createState(true),before=structuredClone(state);
 for(const id of [ids[0],ids[3]])assert.throws(()=>reserveRecommended(state,input(id),['display'],true,profiles),/必须条件/);
 assert.deepEqual(state,before);
 assert.equal(reserveRecommended(state,input(ids[1]),['display'],true,profiles).reservations.length,1);
 assert.doesNotThrow(()=>reserveRecommended(state,input(ids[0]),['display'],false,profiles));
});
test('sunlight is checked against actual chosen slot and exact reference date',()=>{
 const p={[ids[0]]:{directSunWindows:[[14*3600,15*3600]],sunReferenceDate:date,daylight:true}};
 const state=createState(true);
 assert.match(selectionError(state,input(ids[0]),['shade'],true,p),/避开直晒/);
 assert.equal(selectionError(state,input(ids[0],15*3600,17*3600),['shade'],true,p),'');
 const context={date:'2026-11-20',start,end,now:state.now,startAt:at(date,start)};
 const assessment=evaluateSeatProfile(p[ids[0]],context);
 assert.equal(assessment.values.shade,null);assert.equal(assessment.values.daylight,true);
});
test('nearby counts become unknown for future, stale, incomplete, wrong-date and invalid snapshots',()=>{
 const now=at(date,12*3600+43*60);
 const snapshot={date,observedAt:now-180,total:6,occupied:1,unknown:0};
 const context={date,now,startAt:now+600};
 assert.equal(inspectNearby(snapshot,context).known,true);
 for(const [s,c] of [[snapshot,{...context,startAt:now+901}],[snapshot,{...context,startAt:now-1}],
 [{...snapshot,observedAt:now-601},context],[{...snapshot,unknown:1},context],
 [{...snapshot,date:'2026-11-20'},context],[{...snapshot,occupied:7},context],[{...snapshot,observedAt:now+1},context]]){
  assert.equal(inspectNearby(s,c).known,false);
 }
});
test('default future request cannot imply nearby emptiness; required sparse returns no result',()=>{
 const state=createState(true),result=findRecommendations(state,{...request,preferences:['sparse'],required:true});
 assert.equal(result.ranking.results.length,0);
 assert.ok(result.rows.every(s=>s.assessment.values.sparse===null));
});
test('existing personal bookings and newly introduced seat conflicts are rechecked',()=>{
 let state=createState(true);
 assert.equal(findRecommendations(state,request).ranking.results.length,83);
 state=reserve(state,input(ids[0]));
 assert.equal(findRecommendations(state,request).ranking.results.length,0);
 assert.throws(()=>reserveRecommended(state,input(ids[1])),/重叠/);
 const other=createState(true);other.reservations.push({...input(ids[1]),status:'checked_in',userId:'other'});
 assert.throws(()=>reserveRecommended(other,input(ids[1])),/冲突/);
});
test('recommendation query is deterministic and never mutates booking state',()=>{
 const state=createState(),before=structuredClone(state),profilesBefore=structuredClone(DEMO_PROFILES);
 const first=findRecommendations(state,request);
 assert.deepEqual(findRecommendations(state,request),first);
 assert.deepEqual(state,before);assert.deepEqual(DEMO_PROFILES,profilesBefore);
 for(const s of first.ranking.results)assert.equal(selectionError(state,input(s.id,...s.preferred)), '');
});
test('invalid and unopened requests produce no recommendations',()=>{
 for(const change of [{date:'2026-11-22'},{start:'08:00'},{start:'17:00'},{end:'23:00'},{end:'14:30'},{start:''}]){
  const data=findRecommendations(createState(true),{...request,...change});
  assert.ok(data.error);assert.equal(data.ranking.results.length,0);
 }
});
