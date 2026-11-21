import {seats} from './seats.js';
import {OPEN,at,dayOf,secOf,bookingDays,freeSlots,reservationError,reserve} from './engine.js';
import {parseTime,validateRange,analyzeAvailability} from './availability.js';
import {SEAT_PREFERENCES,evaluateSeatProfile,rankSeats} from './recommendations.js';
import {demoSeatProfiles} from './seat-profiles.demo.js';

export const DEMO_PROFILES=demoSeatProfiles(seats);
export function assess(profile,state,date,start,end){
 return evaluateSeatProfile(profile,{now:state.now,date,start,end,startAt:at(date,start)});
}
export function findRecommendations(state,request,profiles=DEMO_PROFILES){
 const {date,preferences=[],required=false,allowPartial=false}=request;
 const start=parseTime(request.start),end=parseTime(request.end);
 const earliest=date===dayOf(state.now)?Math.max(OPEN,secOf(state.now)):OPEN;
 const error=!bookingDays(state.now).includes(date)?'该日期尚未开放':validateRange(start,end,earliest);
 const rows=seats.map(seat=>{
  const windows=freeSlots(state,seat.id,date,earliest).map(([a,b])=>[secOf(a),secOf(b)]);
  const available=analyzeAvailability(windows,start,end,!error);
  const profile=profiles[seat.id]||{};
  const assessment=assess(profile,state,date,start,end);
  const eligibilityError=available.preferred?reservationError(state,{seatId:seat.id,date,start:at(date,available.preferred[0]),end:at(date,available.preferred[1])}):'';
  return {...seat,...available,profile,assessment,eligibilityError,...(eligibilityError?{status:'busy',label:'预约重叠'}:{})};
 });
 return {rows,error,start,end,ranking:rankSeats(rows,preferences,{required,allowPartial})};
}
export function selectionError(state,input,preferences=[],required=false,profiles=DEMO_PROFILES){
 const error=reservationError(state,input);
 if(error)return error;
 if(required){
  const values=assess(profiles[input.seatId]||{},state,input.date,secOf(input.start),secOf(input.end)).values;
  const missing=SEAT_PREFERENCES.filter(p=>preferences.includes(p.id)&&values[p.id]!==true);
  if(missing.length)return `不满足必须条件：${missing.map(p=>p.label).join('、')}`;
 }
 return '';
}
export function reserveRecommended(state,input,preferences=[],required=false,profiles=DEMO_PROFILES){
 const error=selectionError(state,input,preferences,required,profiles);
 if(error)throw new Error(error);
 return reserve(state,input);
}
