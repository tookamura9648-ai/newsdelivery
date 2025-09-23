export function haversine(a,b){
  const R=6371000, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const s1=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s1));
}
function bearing(a,b){
  const toRad=x=>x*Math.PI/180; let φ1=toRad(a.lat), φ2=toRad(b.lat), Δλ=toRad(b.lng-a.lng);
  const y=Math.sin(Δλ)*Math.cos(φ2); const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  let θ=Math.atan2(y,x); if (θ<0) θ+=2*Math.PI; return θ;
}
export function turnDirection(prev, here, next){
  const b1=bearing(prev,here), b2=bearing(here,next);
  let d=b2-b1; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
  const deg=Math.abs(d)*180/Math.PI; if (deg<20) return 0; return d>0?+1:-1; // 右:+1 左:-1
}
