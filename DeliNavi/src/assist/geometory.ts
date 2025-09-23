// =============================
// src/assist/geometry.ts
// =============================
export type LatLng = {lat:number, lng:number};


export function haversine(a:LatLng, b:LatLng) {
const R = 6371000;
const toRad = (x:number)=>x*Math.PI/180;
const dLat = toRad(b.lat-a.lat);
const dLng = toRad(b.lng-a.lng);
const s1 = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
return 2*R*Math.asin(Math.sqrt(s1));
}


export function bearing(a:LatLng, b:LatLng) {
// 戻り値はラジアン [0, 2π)
const toRad = (x:number)=>x*Math.PI/180; const toDeg=(r:number)=>r*180/Math.PI;
const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng-a.lng);
const y = Math.sin(Δλ) * Math.cos(φ2);
const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
let θ = Math.atan2(y, x);
if (θ < 0) θ += 2*Math.PI;
return θ; // radians
}


export function turnDirection(prev:LatLng, here:LatLng, next:LatLng) {
// prev→here と here→next の角度差から右左を判定（右=+1, 左=-1, 直進=0）
const b1 = bearing(prev, here);
const b2 = bearing(here, next);
let d = b2 - b1;
while (d > Math.PI) d -= 2*Math.PI;
while (d < -Math.PI) d += 2*Math.PI;
const deg = Math.abs(d)*180/Math.PI;
if (deg < 20) return 0; // 直進
return d > 0 ? +1 : -1; // 右: +1 / 左: -1
}