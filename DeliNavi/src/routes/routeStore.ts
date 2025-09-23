// 経路を読み込んで polyline 化している既存処理を流用してください
// 下は例：最終的に {lat,lng,name?}[] が取れればOK
let routePoints: {lat:number; lng:number; name?:string}[] = [];

export function setRoutePoints(pts: {lat:number; lng:number; name?:string}[]) {
  routePoints = pts;
}
export function getRoutePoints() {
  return routePoints;
}