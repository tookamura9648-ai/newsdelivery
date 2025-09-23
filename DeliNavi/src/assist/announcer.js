import { AssistFlags } from './assistFlags.js';
import { announce } from './voice.js';
import { voiceEngine } from './voice.js'; // ← 追加
import { Vibe } from './vibe.js';
import { haversine, turnDirection } from './geometry.js';

export class Announcer {
  constructor(route, getClosestIndex){
    this.route=route; this.getIdx=getClosestIndex;
    this.lastOffRouteAt=0; this.wasOffRoute=false; this.lastTurnIdx=-1; this.lastArriveIdx=-1;
  }
  onUserGestureInit(){
    try { voiceEngine.initOnceViaUserGesture(); } catch{}
  }
  onGPS(pos){
    if (!this.route?.length) return;
    const idx=this.getIdx(pos); const nextIdx=Math.min(idx+1, this.route.length-1); const prevIdx=Math.max(idx-1,0);
    const here=this.route[idx], next=this.route[nextIdx], prev=this.route[prevIdx];
    const dToNext=haversine(pos, next);

    // 到着
    if (dToNext<=AssistFlags.ARRIVE_RADIUS_M && nextIdx!==this.lastArriveIdx){
      announce('arrive', { nextName: next.name }); Vibe.arrive();
      this.lastArriveIdx=nextIdx; this.lastTurnIdx=nextIdx; return;
    }
    // 曲がり手前
    if (dToNext<=AssistFlags.NEXT_TURN_LOOKAHEAD_M && nextIdx!==this.lastTurnIdx){
      const dir=turnDirection(prev, here, next);
      if (dir>0){ announce('turn-right', { distanceM: dToNext, nextName: next.name }); Vibe.rightTurn(); this.lastTurnIdx=nextIdx; }
      else if (dir<0){ announce('turn-left',  { distanceM: dToNext, nextName: next.name }); Vibe.leftTurn();  this.lastTurnIdx=nextIdx; }
    }
    // 逸脱（簡易）
    const off = dToNext > AssistFlags.OFF_ROUTE_WARN_M;
    const now = Math.floor(Date.now()/1000);
    if (off){
      if (!this.wasOffRoute || now-this.lastOffRouteAt>=AssistFlags.OFF_ROUTE_INTERVAL_S){
        announce('off-route'); Vibe.offRoute(); this.lastOffRouteAt=now; this.wasOffRoute=true;
      }
    } else {
      if (this.wasOffRoute){ announce('resume'); Vibe.resume(); }
      this.wasOffRoute=false;
    }
  }
}


