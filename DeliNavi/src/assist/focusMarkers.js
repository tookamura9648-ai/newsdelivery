// 目的地マーカーの可視制御（Leaflet想定）
let _markers = [];
let _map = null;
let _curr = -1;

function readOnlyNext() {
  const q = new URLSearchParams(location.search);
  const v = q.get('onlyNext') ?? localStorage.getItem('onlyNext');
  return v === null ? true : (v === '1' || v === 'true'); // 既定=ON
}

function hideLayer(m){
  try {
    if (m.setOpacity) m.setOpacity(0);
    if (m.setStyle)  m.setStyle({ opacity:0, fillOpacity:0 });
    m.getElement?.()?.style && (m.getElement().style.pointerEvents = 'none');
    if (_map && _map.hasLayer(m) && !m.setOpacity && m.remove) m.remove(); // 最終手段
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
function applyFocus(i){
  _curr = i;
  if (!_markers.length) return;
  if (!readOnlyNext()) { _markers.forEach(showLayer); return; }
  _markers.forEach((m,idx)=> idx===i ? showLayer(m) : hideLayer(m));
}

// === 公開API（window.*） ===
window.DN_registerDestinationMarkers = function(markersArray, map){
  _markers = (markersArray || []).filter(Boolean);
  _map = map || _map;
  if (readOnlyNext()) applyFocus(_curr >= 0 ? _curr : 0);
};
window.DN_focusDest = function(i){ applyFocus(i); };
window.DN_showAllDests = function(){ localStorage.setItem('onlyNext','0'); _markers.forEach(showLayer); };
window.DN_hideOthers  = function(){ localStorage.setItem('onlyNext','1'); if (_curr>=0) applyFocus(_curr); };
