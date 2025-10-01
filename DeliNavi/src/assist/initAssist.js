// DeliNavi Assist 初期化エントリ
// - ルート(GeoJSON)読込 → 共有
// - 目的地ラベル起動（destLabel）
// - HUD/マーカー制御の読み込み
// - GPS監視 → __DN_onGpsUpdate に配送
// - 追加: GPSドット＋矢印（常時表示）オプション実装

import './focusMarkers.js';
import './rideHud.js';
import './assistPanel.js'; // パネルを使っている場合。未使用なら消してOK
import { initDestLabel } from './destLabel.js';

// ===== ユーティリティ =====
const qs = new URLSearchParams(location.search);
const readBool = (k, def=false) => {
  const v = qs.get(k);
  if (v == null) return def;
  return v === '1' || v === 'true' || v === 'on';
};

// ===== ルート読込 (official-route.geojson) =====
async function loadRoutePoints() {
  const res = await fetch('./assets/routes/official-route.geojson', { cache: 'no-store' });
  if (!res.ok) throw new Error('official-route.geojson not found');
  const gj = await res.json();

  // GeoJSON -> {lat,lng}[] にフラット化
  const coords = [];
  const pushCoords = (arr) => {
    for (const c of arr) {
      if (Array.isArray(c[0])) pushCoords(c);
      else coords.push({ lat: c[1], lng: c[0] }); // [lng,lat]
    }
  };
  if (gj.type === 'FeatureCollection') {
    for (const f of gj.features) {
      const g = f.geometry || {};
      if (g.type === 'LineString') pushCoords(g.coordinates);
      else if (g.type === 'MultiLineString') pushCoords(g.coordinates);
    }
  } else if (gj.type === 'Feature') {
    const g = gj.geometry || {};
    if (g.type === 'LineString') pushCoords(g.coordinates);
    else if (g.type === 'MultiLineString') pushCoords(g.coordinates);
  } else if (gj.type === 'LineString' || gj.type === 'MultiLineString') {
    pushCoords(gj.coordinates);
  }

  if (!coords.length) throw new Error('route coordinates empty');
  return coords;
}

// 最近傍インデックス（単純最近点）ファクトリ
function getClosestIndexFactory(route) {
  return function getClosestIndex(pos) {
    const lat = pos.lat ?? pos.coords?.latitude;
    const lng = pos.lng ?? pos.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < route.length; i++) {
      const dx = route[i].lat - lat;
      const dy = route[i].lng - lng;
      const d = dx*dx + dy*dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
}

// ===== GPS 監視の中継ハブ =====
// 他モジュールがこの関数を“ラップ”して連結する（チェイン）
if (typeof window.__DN_onGpsUpdate !== 'function') {
  window.__DN_onGpsUpdate = function(){};
}

// ===== メイン初期化 =====
(async function main(){
  try {
    // 1) ルート読込
    const route = await loadRoutePoints();
    const getClosestIndex = getClosestIndexFactory(route);

    // 共有（HUD/turn案内・他モジュール用）
    window.__DN_route = route;
    window.__DN_getClosestIndex = getClosestIndex;

    // 2) 目的地ラベルを起動
    await initDestLabel(route, getClosestIndex);

    // 3) GPS監視（成功/失敗を __DN_onGpsUpdate に渡す）
    startGeolocation();

    // 4) オプション: GPSドット＋簡易矢印（常時表示）
    setupGpsDotAndArrow();

    // 5) オプション: GPSデバッグピル（?gpsdebug=1）
    if (readBool('gpsdebug', false)) setupGpsDebugPill();

    console.log('[DeliNavi] initAssist ready');
  } catch (e) {
    console.error('[DeliNavi] initAssist failed:', e);
  }
})();

// ===== Geolocation =====
function startGeolocation(){
  if (!('geolocation' in navigator)) {
    console.warn('Geolocation API not available');
    return;
  }
  const opt = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
  navigator.geolocation.watchPosition(
    pos => { try { window.__DN_onGpsUpdate && window.__DN_onGpsUpdate(pos); } catch(e) {} },
    err => {
      console.warn('GPS error', err);
      // クリック疑似（?gpsclick=1 の時だけ有効）
      if (readBool('gpsclick', false)) enableClickSimWhenGpsError();
    },
    opt
  );
}

// ===== GPSエラー時のクリック疑似（任意） =====
function enableClickSimWhenGpsError(){
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#183;color:#fff;padding:8px 12px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.25);font:14px/1.3 system-ui;';
  banner.innerHTML = '位置情報が使えません。<b>地図をクリック</b>で現在地をシミュレートします。';
  document.body.appendChild(banner);

  const attach = () => {
    const map = window.__DN_map;
    if (!map || !map.on) return setTimeout(attach, 300);
    map.on('click', e => {
      const lat = e.latlng.lat, lng = e.latlng.lng;
      window.__DN_onGpsUpdate && window.__DN_onGpsUpdate({ lat, lng, coords:{ latitude:lat, longitude:lng, speed:null, heading:null } });
    });
  };
  attach();
}

// ===== GPSドット＋矢印（常時表示） =====
function setupGpsDotAndArrow(){
  // 地図作成側で window.__DN_map = map; を1行入れておくこと
  const withMap = (cb)=>{
    if (window.__DN_map) return cb(window.__DN_map);
    const t = setInterval(()=>{ if (window.__DN_map){ clearInterval(t); cb(window.__DN_map); } }, 200);
  };
  withMap(map=>{
    // 既に作られていたら何もしない（重複生成を避ける）
    if (window.__DN__gpsDot || window.__DN__gpsArrow) return;

    const gpsDot = L.circleMarker([0,0], {
      radius: 6, color:'#00bcd4', fillColor:'#00bcd4', fillOpacity:0.9,
      className:'dn-gps'
    }).addTo(map);
    const gpsHeading = L.polygon([[0,0],[0,0],[0,0]], {
      color:'#00bcd4', weight:0, fillOpacity:0.18, className:'dn-gps'
    }).addTo(map);

    window.__DN__gpsDot = gpsDot;
    window.__DN__gpsArrow = gpsHeading;

    // 常時表示に登録（focusMarkers.js が非表示対象から除外）
    window.DN_registerGpsLayer && window.DN_registerGpsLayer(gpsDot);
    window.DN_registerGpsLayer && window.DN_registerGpsLayer(gpsHeading);

    const prev = window.__DN_onGpsUpdate;
    window.__DN_onGpsUpdate = (pos)=>{
      try{
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
      }catch(e){}
      if (typeof prev === 'function') prev(pos);
    };
  });

  // 小ヘルパー：現在地から距離(m)/方位(deg)の点
  function destPoint(lat,lng,bearingDeg,distM){
    const R=6371000, toRad=x=>x*Math.PI/180, toDeg=r=>r*180/Math.PI;
    const br=toRad(bearingDeg), lat1=toRad(lat), lng1=toRad(lng), d=distM/R;
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
    const lng2=lng1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
    return {lat:toDeg(lat2), lng:toDeg(lng2)};
  }
}

// ===== GPSデバッグピル（?gpsdebug=1） =====
function setupGpsDebugPill(){
  const pill = document.createElement('div');
  pill.style.cssText = 'position:fixed;left:10px;top:10px;z-index:9999;padding:6px 10px;border-radius:999px;color:#fff;font:12px/1.2 system-ui;box-shadow:0 4px 12px rgba(0,0,0,.25);background:#444';
  pill.textContent = 'GPS…';
  document.body.appendChild(pill);

  let last = 0;
  function paint(){
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

  // 地図クリックで疑似更新（デスクトップ検証用）
  const attach = ()=>{
    const map = window.__DN_map;
    if (!map || !map.on) return setTimeout(attach, 300);
    map.on('click', e=>{
      const {lat,lng} = e.latlng;
      window.__DN_onGpsUpdate && window.__DN_onGpsUpdate({lat,lng,coords:{latitude:lat,longitude:lng}});
    });
  };
  attach();
}














