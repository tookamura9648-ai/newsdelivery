import { mountAssistPanel } from './assistPanel.js';
import { Announcer } from './announcer.js';
import { initDestLabel } from './destLabel.js';   // ← 追加


let announcer = null;

function getClosestIndexFactory(route){
  return (pos)=>{
    let best=0, bestD=Infinity;
    for (let i=0;i<route.length;i++){
      const d=Math.hypot(route[i].lat-pos.lat, route[i].lng-pos.lng);
      if (d<bestD){ bestD=d; best=i; }
    }
    return best;
  };
}

// official-route.geojson から単純に折れ点列を拾う（MultiLineString/LineString対応）
async function loadRoutePoints(){
  const res = await fetch('./assets/routes/official-route.geojson', { cache:'no-store' });
  const gj = await res.json();
  const pts = [];
  const pushLine = (coords)=> coords.forEach(([lng,lat])=> pts.push({lat, lng}));
  if (gj.type==='FeatureCollection'){
    for (const f of gj.features){
      const g = f.geometry;
      if (!g) continue;
      if (g.type==='LineString') pushLine(g.coordinates);
      if (g.type==='MultiLineString') g.coordinates.forEach(pushLine);
    }
  } else if (gj.type==='LineString') pushLine(gj.coordinates);
  else if (gj.type==='MultiLineString') gj.coordinates.forEach(pushLine);
  return pts;
}

export async function initAssist(){
  mountAssistPanel();

  // iOSの音声解錠：最初のタップ/クリックで解錠
  const unlock = ()=>{ try{ window.voiceEngine?.initOnceViaUserGesture(); }catch{} };
  window.addEventListener('click', unlock, { once:true, capture:true });
  window.addEventListener('touchstart', unlock, { once:true, capture:true });

  // ルート読み込み
  const route = await loadRoutePoints();
  if (!route.length) { console.warn('route empty'); return; }
  announcer = new Announcer(route, getClosestIndexFactory(route));
  await initDestLabel(route, getClosestIndexFactory(route));  // ← 追加


  // 他の場所から呼べるように公開（既存のGPS処理とつなぐ）
  window.__DN_onGpsUpdate = (pos)=> announcer?.onGPS(pos);

  // 既存で watchPosition がない場合の簡易ウォッチ（あるなら不要）
  if (!window.__DN_ALREADY_WATCHING__){
    try{
      navigator.geolocation.watchPosition(p=>{
        const pos={ lat:p.coords.latitude, lng:p.coords.longitude };
        window.__DN_onGpsUpdate && window.__DN_onGpsUpdate(pos);
      }, e=>console.warn('GPS error', e), { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });
      window.__DN_ALREADY_WATCHING__ = true;
    }catch(e){ console.warn(e); }
  }
}

// 自動起動（index.html から <script type="module" src="./assist/initAssist.js"> でもOK）
if (!window.__DN_INIT_CALLED__){
  window.__DN_INIT_CALLED__ = true;
  initAssist();
}




