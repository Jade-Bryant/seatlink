import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenario,SCENE_DEFINITIONS,DEMO_SEATS,enterScenarioLibrary,advanceAndRelease,demoBookings} from '../src/scenarios.js';
import {planSeats,planRenewal,bookPlan} from '../src/planner.js';
import {at,dayOf,freeSlots} from '../src/engine.js';
const input={start:'14:00',end:'17:00'};
test('all four demo scenes have distinct, deterministic expected outcomes',()=>{
 assert.equal(SCENE_DEFINITIONS.length,4);
 for(const [name,kind,minutes] of [['stitch','stitched',180],['renewal','partial',60],['gap','stitched',175],['single','single',180]]){
  const s=createScenario(name);const p=planSeats(s,input).plans[0];assert.equal(p.kind,kind,name);assert.equal(p.seatedSeconds/60,minutes,name);assert.deepEqual(s,createScenario(name));
 }
 const g=createScenario('gap');assert.equal(planSeats(g,{...input,maxGapMinutes:0}).plans[0].kind,'partial');
});
test('renewal guide requires booking and entry, then creates only the announced vacancy',()=>{
 const initial=createScenario('renewal');assert.throws(()=>enterScenarioLibrary(initial),/先预约/);assert.throws(()=>advanceAndRelease(initial),/入馆/);
 let s={...bookPlan(initial,planSeats(initial,input).plans[0]),demoStage:'reserved'};
 s=enterScenarioLibrary(s);assert.equal(s.inside,true);assert.equal(s.demoStage,'checked_in');assert.equal(demoBookings(s)[0].status,'checked_in');
 assert.equal(planRenewal(s,{reservationId:demoBookings(s)[0].id,end:'17:00'}).plans.length,0);
 s=advanceAndRelease(s);const date=dayOf(s.now);assert.equal(s.now,at(date,14*3600+50*60));
 assert.deepEqual(freeSlots(s,DEMO_SEATS.B,date),[[at(date,15*3600),at(date,17*3600)]]);
 const p=planRenewal(s,{reservationId:demoBookings(s)[0].id,end:'17:00'}).plans[0];assert.equal(p.seatedSeconds,7200);
 s=bookPlan(s,p);assert.equal(demoBookings(s).length,2);assert.equal(demoBookings(s).reduce((n,r)=>n+r.end-r.start,0),10800);
 assert.equal(demoBookings(initial).length,0);
});
