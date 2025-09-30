// 目的地マーカーの可視制御：'all' | 'next' | 'pair' に対応
// pair = 「現在のところ」と「次のところ」だけ表示
let _markers = [];
let _map = null;
let _curr = -1; // 現在のところ（直前に表示していた配達先）
let _next = -1; // 次のところ（今向かう配達先）
let _mode = 'pair'; // 既定を pair に

function readModeFromURL(){
  const q = new URLSearchParams(location.search);
  // 互換: ?onlyNext=1/0   / 新: ?markerMode=pair|next|all / 簡易: ?showPair=1
  if (q.get('showPair') === '1') return 'pair';
  const mm = q.get('markerMode');
  if (mm === 'pair' || mm === 'next' || mm === 'all') return mm;
  const on = q.get('onlyNext');
  if (on === '1') return 'next';
  if (on === '0') return 'all';
  // ローカル保存があれば使う
  const ls = localStorage.getItem('markerMode');
  if (ls === 'pair' || ls === 'next' || ls === 'all') return ls;
  return 'pair';
}
_mode = readModeFromURL();

function hideLayer(m){
  try {
    if (m.setOpacity) m.setOpacity(0);
    if (m.setStyle)  m.setStyle({ opacity:0, fillOpacity:0 });
    m.getElement?.()?.style && (m.getElement().style.pointerEvents = 'none');
    if (_map && m.remove && _map.hasLayer(m) && !m.setOpacity) m.remove(); // 最終手段
  } catch {}
}
function showLayer(m){
  try {
    if (_map && m.addTo && !_map.hasLayer(m)) m.addTo(_map);
    if (m.setOpacity) m.setOpacity(1);
    if (m.setStyle)  m.setStyle({ opacity:1, fillOpacity:0.6 });
    m.getElement?.()?.style && (m.getElement().style.pointerEvents = 'auto');
    if (m.setZIndexOffset) m.setZIndexOffset(1000);
  } catch {}
}
function applyVisibility(){
  if (!_markers.length){ return; }
  if (_mode === 'all'){ _markers.forEach(showLayer); return; }

  _markers.forEach((m, i)=>{
    const vis = (_mode === 'next')
      ? (i === _next)
      : /* pair */ (i === _next || i === _curr);
    vis ? showLayer(m) : hideLayer(m);
  });
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
window.DN_focusDest = function(i){ // “次のところ”インデックスで指定
  if (typeof i === 'number') _next = i;
  applyVisibility();
};
window.DN_focusDestByLatLng = function(lat, lng){ // 座標で“次”を指定
  const i = nearestIndex(lat, lng);
  if (i >= 0) _next = i;
  applyVisibility();
};

// ★ 追加：現在＋次をペアで指定
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

// モード切替（任意で使えます）
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



