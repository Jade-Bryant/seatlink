import React from 'react';
import Icon from './Icons.jsx';
import {seats} from './seats.js';
import {seatStatus,bookingDays,dayOf,secOf,clock} from './engine.js';

export function SchoolHome({state,onSeats,onPlanner}){
 const date=bookingDays(state.now)[0];
 const available=seats.filter(s=>seatStatus(state,s.id,date)!=='busy').length;
 return <section className="school-home">
  <div className="banner"><svg viewBox="157 248 629 302" role="img" aria-label="上海交通大学图书馆"><image href={`${import.meta.env.BASE_URL}home-reference.png`} width="942" height="2048"/></svg><div><Icon name="book" size={17}/>图书馆座位预约</div></div>
  <div className="school-services"><button onClick={onSeats}><span><Icon name="seat" size={28}/></span>座位</button><button onClick={onPlanner}><span><Icon name="route" size={28}/></span>智能找座</button></div>
  <h2 className="section-title">座位</h2>
  <div className="locations"><div className="location-title"><Icon name="down" size={19}/>闵行-主馆（Main Lib）</div><div className="floor-title"><Icon name="down" size={18}/>主馆二楼</div>
   <div className="area-grid">{['B200-东区（E）','B200-中区（M）','B200-西区（W）','C200-东区（E）','C200-中区（M）','C200-西区（W）'].map(name=>{const active=name==='C200-中区（M）';return <button key={name} disabled={!active} onClick={onSeats} className={active?'available-area':''}>{name}<small>{active?`${available} / ${seats.length}`:'—'}</small></button>;})}</div>
  </div>
 </section>;
}
export function SchoolProfile({state,onControls,onScenes,onData}){
 return <section className="school-profile"><div className="school-reader"><span className="reader-icon"><Icon name="user" size={35}/></span><div><strong>演示读者</strong><span>{state.inside?'已入馆':'未入馆'}</span></div></div>
  <div className="school-profile-time"><Icon name="clock" size={18}/>{dayOf(state.now)} · {clock(secOf(state.now))}</div>
  {[[onControls,'settings','模拟控制'],[onScenes,'play','场景演示'],[onData,'info','模拟数据']].map(([action,icon,label])=><button className="school-profile-row" key={label} onClick={action}><Icon name={icon}/><span>{label}</span><Icon name="next" size={18}/></button>)}
 </section>;
}
