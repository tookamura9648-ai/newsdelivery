import { mountAssistPanel } from './assistPanel.js';
import { Announcer } from './announcer.js';
import { initDestLabel } from './destLabel.js';   // ← 追加
import './rideHud.js';   // ← ライドHUDを有効化


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

  // ★追加（HUDがルートを参照できるように共有）
  window.__DN_route = route;
  window.__DN_getClosestIndex = getClosestIndexFactory(route);

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

// --- GPSドット＋矢印（常時表示）を自動セットアップ ---
(function(){
  function withMap(cb){
    if (window.__DN_map) return cb(window.__DN_map);
    const t = setInterval(()=>{ if (window.__DN_map){ clearInterval(t); cb(window.__DN_map); } }, 200);
  }
  withMap(map=>{
    // ドット
    const gpsDot = L.circleMarker([0,0], {
      radius: 6, color:'#00bcd4', fillColor:'#00bcd4', fillOpacity:0.9,
      className:'dn-gps'  // ← focusMarkers が「常時表示」扱いにします
    }).addTo(map);

    // 簡易矢印（三角）
    const gpsHeading = L.polygon([[0,0],[0,0],[0,0]], {
      color:'#00bcd4', weight:0, fillOpacity:0.18, className:'dn-gps'
    }).addTo(map);

    // 常時表示に登録（focusMarkers.js に追加したAPI）
    window.DN_registerGpsLayer && window.DN_registerGpsLayer(gpsDot);
    window.DN_registerGpsLayer && window.DN_registerGpsLayer(gpsHeading);

    // 位置更新に追従（既存のGPSチェインに合流）
    const __prev = window.__DN_onGpsUpdate;
    window.__DN_onGpsUpdate = pos=>{
      const lat = pos.lat ?? pos.coords?.latitude;
      const lng = pos.lng ?? pos.coords?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        gpsDot.setLatLng([lat,lng]);
        const hdg = (pos.coords && typeof pos.coords.heading === 'number') ? pos.coords.heading : null;
        if (hdg != null) {
          const ahead = destPoint(lat,lng, hdg,   20);
          const left  = destPoint(lat,lng, hdg-25,12);
          const right = destPoint(lat,lng, hdg+25,12);
          gpsHeading.setLatLngs([[left.lat,left.lng],[ahead.lat,ahead.lng],[right.lat,right.lng]]);
        } else {
          gpsHeading.setLatLngs([[lat,lng],[lat,lng],[lat,lng]]);
        }
      }
      if (typeof __prev === 'function') __prev(pos);
    };

    function destPoint(lat,lng,bearingDeg,distM){
      const R=6371000, toRad=x=>x*Math.PI/180, toDeg=r=>r*180/Math.PI;
      const br=toRad(bearingDeg), lat1=toRad(lat), lng1=toRad(lng), d=distM/R;
      const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
      const lng2=lng1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
      return {lat:toDeg(lat2), lng:toDeg(lng2)};
    }

    // --- GPSデバッグピル（?gpsdebug=1 のときだけ表示） ---
(function(){
  const on = new URLSearchParams(location.search).get('gpsdebug') === '1';
  if (!on) return;

  const pill = document.createElement('div');
  pill.style.cssText = 'position:fixed;left:10px;top:10px;z-index:9999;padding:6px 10px;border-radius:999px;color:#fff;font:12px/1.2 system-ui;box-shadow:0 4px 12px rgba(0,0,0,.25);background:#444';
  pill.textContent = 'GPS …';
  document.body.appendChild(pill);

  let last = 0;
  function paint() {
    const age = last ? (Date.now()-last)/1000 : Infinity;
    pill.textContent = last ? `GPS OK · ${age.toFixed(1)}s` : 'GPS待機…';
    pill.style.background = (age===Infinity||age>10) ? '#d32f2f' : (age>4 ? '#f9a825' : '#2e7d32');
    requestAnimationFrame(paint);
  }
  paint();

  // 位置更新に相乗り
  const prev = window.__DN_onGpsUpdate;
  window.__DN_onGpsUpdate = (pos)=>{
    last = Date.now();
    if (typeof prev === 'function') prev(pos);
  };

  // 地図クリックで擬似位置（デスクトップ検証用）
  const map = window.__DN_map;
  if (map && map.on) {
    pill.title = 'gpsdebug: 地図クリックで現在地を擬似更新';
    map.on('click', e=>{
      const {lat,lng} = e.latlng;
      window.__DN_onGpsUpdate && window.__DN_onGpsUpdate({lat,lng,coords:{latitude:lat,longitude:lng}});
    });
  }
})();










