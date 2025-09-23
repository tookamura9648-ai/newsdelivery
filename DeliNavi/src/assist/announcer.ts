// =============================
// src/assist/announcer.ts
// =============================
import { AssistFlags } from '../config/assistFlags';
import { announce } from './voice';
import { Vibe } from './vibe';
import { LatLng, haversine, turnDirection } from './geometry';


export type RoutePoint = LatLng & { name?: string };


export class Announcer {
private lastOffRouteAt = 0; // epoch sec
private wasOffRoute = false;
private lastTurnIdx = -1; // 直前に案内したターンの次ポイントindex
private lastArriveIdx = -1;


constructor(
private route: RoutePoint[],
private getClosestIndex: (pos:LatLng)=>number,
){}


onUserGestureInit() {
// 音声を解錠
try { (window as any).voiceEngine?.initOnceViaUserGesture(); } catch {}
}


onGPS(pos: LatLng) {
const idx = this.getClosestIndex(pos);
const nextIdx = Math.min(idx+1, this.route.length-1);
const prevIdx = Math.max(idx-1, 0);
const here = this.route[idx];
const next = this.route[nextIdx];
const prev = this.route[prevIdx];


// 1) 到着判定
const dToNext = haversine(pos, next);
if (dToNext <= AssistFlags.ARRIVE_RADIUS_M && nextIdx !== this.lastArriveIdx) {
announce('arrive', { nextName: next.name });
Vibe.arrive();
this.lastArriveIdx = nextIdx;
this.lastTurnIdx = nextIdx; // 同一点での重複案内を避ける
return;
}


// 2) 曲がり案内
if (dToNext <= AssistFlags.NEXT_TURN_LOOKAHEAD_M && nextIdx !== this.lastTurnIdx) {
const dir = turnDirection(prev, here, next);
if (dir > 0) { // 右
announce('turn-right', { distanceM: dToNext, nextName: next.name });
Vibe.rightTurn();
this.lastTurnIdx = nextIdx;
} else if (dir < 0) {
announce('turn-left', { distanceM: dToNext, nextName: next.name });
Vibe.leftTurn();
this.lastTurnIdx = nextIdx;
}
}


// 3) 逸脱検知（最近傍点距離は外側で計算済みならそれを渡してOK）
const off = dToNext > AssistFlags.OFF_ROUTE_WARN_M; // 単純判定: 次点までの距離で代用
const now = Math.floor(Date.now()/1000);
if (off) {
if (!this.wasOffRoute || now - this.lastOffRouteAt >= AssistFlags.OFF_ROUTE_INTERVAL_S) {
announce('off-route');
Vibe.offRoute();
}