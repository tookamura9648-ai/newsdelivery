import { mountAssistPanel } from './assistPanel.js';
import { Announcer } from './announcer.js';
import { voiceEngine } from './voice.js'; // ← 追加（グローバル経由に頼らない）
import { unlockVibe } from './vibe.js';     // ← 追加

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

// official-route.geojson から折れ点を抽出（LineString / MultiLineString対応）
async function loadRoutePoints(){
  const res = await fetch('./assets/routes/official-route.geojson', { cache:'no-store' });
  const gj = await res.json();
  const pts = [];
  const pushLine = (coords)=> coords.forEach(([lng,lat])=> pts.push({lat, lng}));
  if (gj.type==='FeatureCollection'){
    for (const f of gj.features){
      const g = f.geometry; if (!g) continue;
      if (g.type==='LineString') pushLine(g.coordinates);
      if (g.type==='MultiLineString') g.coordinates.forEach(pushLine);
    }
  } else if (gj.type==='LineString') pushLine(gj.coordinates);
  else if (gj.type==='MultiLineString') gj.coordinates.forEach(pushLine);
  return pts;
}

export async function initAssist(){
  // DOM 準備後…
  if (document.readyState === 'loading'){
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once:true }));
  }

  mountAssistPanel();

  // ★最初のタップ/クリックで「音声＋バイブ」を解錠
  const unlock = () => { try { voiceEngine.initOnceViaUserGesture(); } catch{}; unlockVibe(); };
  window.addEventListener('click', unlock, { once:true, capture:true });
  window.addEventListener('touchstart', unlock, { once:true, capture:true });

  // ルート読み込み
  const route = await loadRoutePoints();
  if (!route.length) { console.warn('[DeliNavi] route empty'); return; }

  announcer = new Announcer(route, getClosestIndexFactory(route));

  // 既存GPSからも呼べるように公開
  window.__DN_onGpsUpdate = (pos)=> announcer?.onGPS(pos);

  // もし既存の watchPosition がない場合だけ簡易ウォッチ
  if (!window.__DN_ALREADY_WATCHING__){
    try{
      navigator.geolocation.watchPosition(p=>{
        const pos={ lat:p.coords.latitude, lng:p.coords.longitude };
        window.__DN_onGpsUpdate?.(pos);
      }, e=>console.warn('GPS error', e), { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });
      window.__DN_ALREADY_WATCHING__ = true;
    }catch(e){ console.warn(e); }
  }

  console.log('[DeliNavi] Assist initialized');
}

// 自動起動（DOM後に動くよう await 済）
if (!window.__DN_INIT_CALLED__){
  window.__DN_INIT_CALLED__ = true;
  initAssist().catch(err => console.error('[DeliNavi] initAssist error', err));
}



