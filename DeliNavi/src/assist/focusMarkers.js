// 目的地マーカーの可視制御：'all' | 'next' | 'pair'
// 要望対応：GPSドット矢印は常に表示／現在=半透明／次=赤強調
let _markers = [];
let _map = null;
let _curr = -1;          // 「現在のところ」（直前に表示していた配達先）
let _next = -1;          // 「次のところ」
let _mode = 'pair';      // 既定を pair
const _gpsLayers = [];   // 常時表示するGPS用レイヤ群
const _origIcon = new Map(); // L.Markerの元アイコンを保存（次=赤→戻す用）

function readModeFromURL(){
  const q = new URLSearchParams(location.search);
  if (q.get('showPair') === '1') return 'pair';
  const mm = q.get('markerMode');
  if (mm === 'pair' || mm === 'next' || mm === 'all') return mm;
  const on = q.get('onlyNext');
  if (on === '1') return 'next';
  if (on === '0') return 'all';
  const ls = localStorage.getItem('markerMode');
  if (ls === 'pair' || ls === 'next' || ls === 'all') return ls;
  return 'pair';
}
_mode = readModeFromURL();

function isGpsLayer(m){
  if (!m) return false;
  if (_gpsLayers.includes(m)) return true;
  const cls = m.options?.className || '';
  return /\bdn-gps\b/.test(cls); // className: 'dn-gps' を付けた場合も常時表示
}

function hideLayer(m){
  try {
    if (isGpsLayer(m)) { showLayer(m); return; } // GPSは常に可視
    if (m.setOpacity) m.setOpacity(0);
    if (m.setStyle)   m.setStyle({ opacity:0, fillOpacity:0 });
    m.getElement?.()?.style && (m.getElement().style.pointerEvents = 'none');
    if (_map && m.remove && _map.hasLayer(m) && !m.setOpacity) m.remove(); // 最終手段
  } catch {}
}
function showLayer(m){
  try {
    if (_map && m.addTo && !_map.hasLayer(m)) m.addTo(_map);
    if (m.setOpacity) m.setOpacity(1);
    if (m.setStyle)   m.setStyle({ opacity:1, fillOpacity:0.6 });
    m.getElement?.()?.style && (m.getElement().style.pointerEvents = 'auto');
    if (m.setZIndexOffset) m.setZIndexOffset(1000);
  } catch {}
}

// ----- スタイル適用（現在＝半透明／次＝赤） -----
function makeRedDivIcon(){
  // シンプルな赤丸ピン（DivIcon）。標準アイコンを使っている場合の色替え用。
  return L.divIcon({
    className: 'dn-next-red',
    html: '<div style="width:18px;height:18px;border-radius:50%;background:#e53935;border:2px solid white;box-shadow:0 0 0 2px rgba(0,0,0,.25)"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}
const _redIcon = (typeof L !== 'undefined' && L.divIcon) ? makeRedDivIcon() : null;

function clearStyle(m){
  try{
    if (isGpsLayer(m)) return; // 触らない
    // 透明度等を通常へ
    if (m.setOpacity) m.setOpacity(1);
    if (m.setStyle)   m.setStyle({ opacity:1, fillOpacity:0.6, color: undefined, fillColor: undefined, weight: 2 });
    // アイコンを戻す
    if (_origIcon.has(m) && m.setIcon){
      m.setIcon(_origIcon.get(m));
      _origIcon.delete(m);
    }
  }catch{}
}
function styleAsCurrent(m){
  try{
    if (isGpsLayer(m)) return;
    if (m.setOpacity) m.setOpacity(0.4);
    if (m.setStyle)   m.setStyle({ opacity:0.4, fillOpacity:0.2, color:'#888', weight:1 });
    if (m.setZIndexOffset) m.setZIndexOffset(900);
  }catch{}
}
function styleAsNext(m){
  try{
    if (isGpsLayer(m)) return;
    if (m.setStyle){ // circleMarker/geojson系
      m.setStyle({ opacity:1, fillOpacity:0.9, color:'#d32f2f', fillColor:'#ff5252', weight:3 });
    } else if (m.setIcon && _redIcon){ // 通常のL.Marker
      if (!_origIcon.has(m)) _origIcon.set(m, m.options.icon || null);
      m.setIcon(_redIcon);
    }
    if (m.setOpacity) m.setOpacity(1);
    if (m.setZIndexOffset) m.setZIndexOffset(1200);
  }catch{}
}

function restyleAll(){
  // クリア/強調 は「見せるピン」にだけ適用（隠すピンには触らない）
  for (let i=0;i<_markers.length;i++){
    if (isVisibleIndex(i)) clearStyle(_markers[i]);
  }
  if (_curr>=0 && isVisibleIndex(_curr) && _markers[_curr]) styleAsCurrent(_markers[_curr]);
  if (_next>=0 && isVisibleIndex(_next) && _markers[_next]) styleAsNext(_markers[_next]);
}

function isVisibleIndex(i){
  if (_mode === 'all') return true;
  if (_mode === 'next') return i === _next;
  // pair
  return i === _curr || i === _next;
}

function applyVisibility(){
  if (!_markers.length){ return; }
  // 表示・非表示
  if (_mode === 'all'){
    _markers.forEach(showLayer);
  } else {
    _markers.forEach((m, i)=>{
      const vis = (_mode === 'next') ? (i === _next) : (i === _next || i === _curr);
      vis ? showLayer(m) : hideLayer(m);
    });
  }
  // GPSは常に見せる
  _gpsLayers.forEach(showLayer);
  // スタイル
  restyleAll();
}

function nearestIndex(lat, lng){
  let best=-1, bestD=Infinity;
  for (let i=0;i<_markers.length;i++){
    const ll=_markers[i]?.getLatLng?.(); if(!ll) continue;
    const dx=ll.lat-lat, dy=ll.lng-lng; const d=dx*dx+dy*dy;
    if (d < bestD){ bestD=d; best=i; }
  }
  return best;
}

// === 公開API（window.*） ===
window.DN_registerDestinationMarkers = function(markersArray, map){
  _markers = (markersArray||[]).filter(Boolean);
  _map = map || _map;
  applyVisibility();
};

// 「次」を指定（インデックス）
window.DN_focusDest = function(i){
  if (typeof i === 'number') _next = i;
  applyVisibility();
};
// 「次」を指定（座標）
window.DN_focusDestByLatLng = function(lat, lng){
  const i = nearestIndex(lat, lng);
  if (i >= 0) _next = i;
  applyVisibility();
};

// ★「現在＋次」をまとめて指定（おすすめ）
window.DN_focusPair = function(currIdx, nextIdx){
  if (typeof currIdx === 'number') _curr = currIdx;
  if (typeof nextIdx === 'number') _next = nextIdx;
  applyVisibility();
};
window.DN_focusPairByLatLng = function(clat, clng, nlat, nlng){
  const ci = nearestIndex(clat, clng);
  const ni = nearestIndex(nlat, nlng);
  if (ci >= 0) _curr = ci;
  if (ni >= 0) _next = ni;
  applyVisibility();
};

// GPSレイヤ（常時表示）を登録
// 例：DN_registerGpsLayer(headingMarker) あるいは DN_registerGpsLayer(layerGroup)
window.DN_registerGpsLayer = function(layer){
  if (layer && !_gpsLayers.includes(layer)) _gpsLayers.push(layer);
  applyVisibility();
};

// モード切替（必要に応じて）
window.DN_setMarkerMode = function(mode /* 'pair'|'next'|'all' */){
  if (mode==='pair' || mode==='next' || mode==='all'){
    _mode = mode;
    localStorage.setItem('markerMode', mode);
    applyVisibility();
  }
};
// 互換エイリアス
window.DN_showAllDests = function(){ window.DN_setMarkerMode('all'); };
window.DN_hideOthers  = function(){ window.DN_setMarkerMode('next'); };






