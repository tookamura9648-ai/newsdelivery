// 走行中は“矢印＋距離＋氏名”だけ、停止中は地図に戻すHUD
// 連携：destLabel.jsが発火する DN_focusDestByLatLng(lat,lng) をフックして目標更新
//       focusMarkers.js の有無に関わらず動作（lat/lngで追従）
// 使い方：initAssist.js から import するだけ（下記参照）

(function(){
  // ====== 小ユーティリティ ======
  const q = new URLSearchParams(location.search);
  const read = (k, d) => {
    const v = q.get(k) ?? localStorage.getItem(k);
    if (v == null) return d;
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
    const n = Number(v); return Number.isNaN(n) ? v : n;
  };
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

  // しきい値（好みでURLから上書き可）
  const SPEED_ENTER_KMH = read('rideEnter', 8);  // これ以上でHUDに切替
  const SPEED_EXIT_KMH  = read('rideExit', 2);   // これ未満が続けば地図へ戻す
  const EXIT_HOLD_S     = read('rideExitHold', 4); // 停止継続秒で戻す
  const MODE_PARAM      = read('rideMode', 'auto'); // 'auto' | 'ride' | 'map'

  // 地図要素（見つかったものを隠す）— 必要なら ?mapSel=#map で指定
  const MAP_SEL = read('mapSel', null);
  const mapElCandidates = ()=> {
    if (MAP_SEL) return [document.querySelector(String(MAP_SEL))].filter(Boolean);
    return [
      document.getElementById('map'),
      document.querySelector('.leaflet-container'),
    ].filter(Boolean);
  };

  // 方位・距離計算
  function haversine(a,b){
    const R=6371000, toRad=x=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const s=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(s));
  }
  function bearing(a,b){ // [deg 0-360)
    const toRad=x=>x*Math.PI/180, toDeg=r=>r*180/Math.PI;
    const φ1=toRad(a.lat), φ2=toRad(b.lat), Δλ=toRad(b.lng-a.lng);
    const y=Math.sin(Δλ)*Math.cos(φ2);
    const x=Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
    let θ=toDeg(Math.atan2(y,x)); if (θ<0) θ+=360; return θ;
  }
  const angDiff = (a,b)=>{ // 最小差
    let d = (a-b+540)%360 - 180; return d;
  };

  // ====== HUD DOM ======
  let hud, arrow, nameEl, distEl, subEl;
  let visible = false;
  function ensureHud(){
    if (hud) return;
    hud = document.createElement('div');
    hud.id = 'dn-ride-hud';
    hud.style.cssText = `
      position:fixed; inset:0; z-index:9800;
      display:none; align-items:center; justify-content:center; flex-direction:column;
      background:#fafafa; color:#0b2f3a; font-family:system-ui,-apple-system,Segoe UI,Roboto;
      user-select:none; touch-action:none;
    `;
    // 氏名
    nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:28px; font-weight:700; letter-spacing:.1em; margin-bottom:8px; text-align:center; max-width:90vw;';
    // 矢印（SVG）
    arrow = document.createElementNS('http://www.w3.org/2000/svg','svg');
    arrow.setAttribute('width','220'); arrow.setAttribute('height','220'); arrow.setAttribute('viewBox','0 0 100 100');
    arrow.style.cssText = 'margin:8px 0; transform:rotate(0deg); transition:transform .08s linear;';
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('fill','#0b2f3a');
    // 三角＋軸
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d','M50 8 L70 48 H58 V92 H42 V48 H30 Z'); // ↑矢印
    g.appendChild(p); arrow.appendChild(g);
    // 距離
    distEl = document.createElement('div');
    distEl.style.cssText = 'font-size:22px; font-weight:600; margin-top:6px;';
    // サブ行（簡易状態表示）
    subEl = document.createElement('div');
    subEl.style.cssText = 'font-size:13px; opacity:.7; margin-top:6px;';
    subEl.textContent = 'ライドHUD（走行で自動表示 / 停止で地図に戻る）';
    hud.append(nameEl, arrow, distEl, subEl);
    document.body.appendChild(hud);
  }
  function showHud(){
    ensureHud();
    if (visible) return;
    visible = true;
    hud.style.display = 'flex';
    // 地図など重いUIは隠す
    for (const el of mapElCandidates()) { el.style.opacity='0'; el.style.pointerEvents='none'; }
  }
  function hideHud(){
    if (!visible) return;
    visible = false;
    hud.style.display = 'none';
    for (const el of mapElCandidates()) { el.style.opacity='1'; el.style.pointerEvents='auto'; }
  }

  // ====== ターゲット（次の目的地）と現在値 ======
  let target = null; // {lat,lng,name}
  let lastPos = null; // {lat,lng,t}
  let filtHeading = 0; // [deg]
  let exitHoldStart = 0;

  function setTarget(lat,lng,name){
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    target = {lat, lng, name: name || ''};
    if (nameEl) nameEl.textContent = target.name || '';
  }

  // destLabel からの“次の目的地変更”を横取りして同期（推奨パス）
  const prevByLatLng = window.DN_focusDestByLatLng;
  window.DN_focusDestByLatLng = function(lat,lng){
    // 可能なら名前も拾う（destLabelのDOMを参照）
    const nm = document.getElementById('dn-dest-name')?.textContent || '';
    setTarget(lat,lng,nm);
    if (typeof prevByLatLng === 'function') prevByLatLng(lat,lng);
  };
  // index指定しか来ない古い経路でも最低限の同期（マーカーAPIが登録済みなら推定）
  const prevByIdx = window.DN_focusDest;
  window.DN_focusDest = function(i){
    try{
      if (window.DN__internalGetMarkers) { // （任意）フォーカス管理側が提供していれば利用
        const m = window.DN__internalGetMarkers()[i];
        const ll = m?.getLatLng?.(); if (ll) setTarget(ll.lat, ll.lng, document.getElementById('dn-dest-name')?.textContent||'');
      }
    }catch{}
    if (typeof prevByIdx === 'function') prevByIdx(i);
  };

  // ====== 速度・方位の算出 ======
  function updateFromGPS(p){
    const t = Date.now()/1000;
    const pos = { lat:p.coords.latitude, lng:p.coords.longitude, t };

    // スピード（GPSが出せないときは距離/時間で）
    let vms = (p.coords.speed!=null && !Number.isNaN(p.coords.speed)) ? p.coords.speed : null;
    if (vms==null && lastPos){
      const d = haversine(lastPos, pos); // m
      const dt = Math.max(0.5, t - lastPos.t); // s
      vms = d/dt;
    }
    const kmh = (vms||0)*3.6;

    // 方位（GPS heading or 移動ベクトル）
    let hdg = (p.coords.heading!=null && !Number.isNaN(p.coords.heading)) ? p.coords.heading : null;
    if (hdg==null && lastPos){
      const brg = bearing(lastPos, pos);
      // 微小移動なら方位は据え置き
      if (haversine(lastPos,pos) > 1.5) hdg = brg;
    }
    if (hdg==null) hdg = filtHeading; // 直前値

    // 簡易スムージング
    const alpha = 0.25;
    const dAng = angDiff(hdg, filtHeading);
    filtHeading = (filtHeading + alpha*dAng + 360) % 360;

    // HUD更新
    if (target){
      const dist = haversine(pos, target); // m
      const brgTo = bearing(pos, target); // deg
      const rel = (brgTo - filtHeading + 360) % 360; // 端末の向きから見た“どちらか”
      if (!distEl) ensureHud();
      if (distEl) distEl.textContent = dist >= 1000 ? (dist/1000).toFixed(2)+' km' : Math.round(dist)+' m';
      if (nameEl && target.name) nameEl.textContent = target.name;
      if (arrow) arrow.style.transform = `rotate(${rel}deg)`;
    }

    // モード遷移
    handleMode(kmh);

    lastPos = pos;
  }

  // ====== モード制御 ======
  // mode: 'auto' | 'ride' | 'map'
  let mode = (MODE_PARAM==='ride'||MODE_PARAM==='map') ? MODE_PARAM : 'auto';
  function handleMode(kmh){
    if (mode==='ride'){ showHud(); return; }
    if (mode==='map'){ hideHud(); return; }

    // auto：ヒステリシスで切替
    if (kmh >= SPEED_ENTER_KMH){
      exitHoldStart = 0;
      showHud();
    } else if (kmh <= SPEED_EXIT_KMH){
      if (!exitHoldStart) exitHoldStart = Date.now()/1000;
      if (Date.now()/1000 - exitHoldStart >= EXIT_HOLD_S) hideHud();
    }
  }

  // 手動切替API（必要なら）
  window.DN_setRideMode = function(m){ mode = m; if (m==='ride') showHud(); else if (m==='map') hideHud(); };

  // ====== GPSチェインに合流 ======
  const prevOnGps = window.__DN_onGpsUpdate;
  window.__DN_onGpsUpdate = (posOrEvent)=>{
    // posOrEvent は GeolocationPosition か {lat,lng}
    if (posOrEvent && 'coords' in posOrEvent) {
      updateFromGPS(posOrEvent);
    } else if (posOrEvent && typeof posOrEvent.lat==='number') {
      // {lat,lng}のみの場合は最低限の更新
      const fake = { coords: { latitude: posOrEvent.lat, longitude: posOrEvent.lng, speed: null, heading: null } };
      updateFromGPS(fake);
    }
    if (typeof prevOnGps==='function') prevOnGps(posOrEvent);
  };

  // 起動時：HUDだけ準備（ターゲットはdestLabelが呼ぶと入る）
  document.addEventListener('DOMContentLoaded', ensureHud, { once:true });
})();
