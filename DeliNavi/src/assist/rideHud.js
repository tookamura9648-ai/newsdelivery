// 走行中は“矢印＋距離＋氏名・住所・備考”、停止で地図に戻る HUD
// 追加: 長押しで HUD⇄地図 トグル、色: 背景=黒/文字=白/矢印=緑

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

  const SPEED_ENTER_KMH = read('rideEnter', 8);
  const SPEED_EXIT_KMH  = read('rideExit', 2);
  const EXIT_HOLD_S     = read('rideExitHold', 4);
  const MODE_PARAM      = read('rideMode', 'auto'); // 'auto'|'ride'|'map'

  // 地図要素（隠す対象）— ?mapSel=#map で明示も可
  const MAP_SEL = read('mapSel', null);
  const mapElCandidates = ()=> {
    if (MAP_SEL) return [document.querySelector(String(MAP_SEL))].filter(Boolean);
    return [
      document.getElementById('map'),
      document.querySelector('.leaflet-container'),
    ].filter(Boolean);
  };

  // 方位・距離
  function haversine(a,b){
    const R=6371000, toRad=x=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const s=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(s));
  }
  function bearing(a,b){
    const toRad=x=>x*Math.PI/180, toDeg=r=>r*180/Math.PI;
    const φ1=toRad(a.lat), φ2=toRad(b.lat), Δλ=toRad(b.lng-a.lng);
    const y=Math.sin(Δλ)*Math.cos(φ2);
    const x=Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
    let θ=toDeg(Math.atan2(y,x)); if (θ<0) θ+=360; return θ;
  }
  const angDiff = (a,b)=>{ let d=(a-b+540)%360-180; return d; };

  // ====== HUD DOM ======
  let hud, addrEl, nameEl, noteEl, arrow, distEl, subEl;
  let visible = false;

  function ensureHud(){
    if (hud) return;
    hud = document.createElement('div');
    hud.id = 'dn-ride-hud';
    hud.style.cssText = `
      position:fixed; inset:0; z-index:9800;
      display:none; align-items:center; justify-content:center; flex-direction:column;
      background:#000; color:#fff; font-family:system-ui,-apple-system,Segoe UI,Roboto;
      user-select:none; touch-action:none; text-shadow:0 1px 2px rgba(0,0,0,.6);
    `;

    // 上：住所
    addrEl = document.createElement('div');
    addrEl.style.cssText = 'font-size:16px; opacity:.9; margin-bottom:4px; text-align:center; max-width:90vw;';

    // 中：氏名（大）
    nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:28px; font-weight:700; letter-spacing:.1em; margin-bottom:8px; text-align:center; max-width:90vw;';

    // 矢印（緑）
    arrow = document.createElementNS('http://www.w3.org/2000/svg','svg');
    arrow.setAttribute('width','220'); arrow.setAttribute('height','220'); arrow.setAttribute('viewBox','0 0 100 100');
    arrow.style.cssText = 'margin:8px 0; transform:rotate(0deg); transition:transform .08s linear;';
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('fill', '#00e676'); // 緑
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d','M50 8 L70 48 H58 V92 H42 V48 H30 Z');
    g.appendChild(p); arrow.appendChild(g);

    // 距離
    distEl = document.createElement('div');
    distEl.style.cssText = 'font-size:22px; font-weight:600; margin-top:6px;';

    // 下：備考
    noteEl = document.createElement('div');
    noteEl.style.cssText = 'font-size:16px; opacity:.9; margin-top:8px; text-align:center; max-width:90vw;';

    // ステータス
    subEl = document.createElement('div');
    subEl.style.cssText = 'font-size:13px; opacity:.6; margin-top:6px;';

    hud.append(addrEl, nameEl, arrow, distEl, noteEl, subEl);
    document.body.appendChild(hud);
  }

  function showHud(){
    ensureHud();
    if (visible) return;
    visible = true;
    hud.style.display = 'flex';
    for (const el of mapElCandidates()) { el.style.opacity='0'; el.style.pointerEvents='none'; }
    updateSubText();
  }
  function hideHud(){
    if (!visible) return;
    visible = false;
    hud.style.display = 'none';
    for (const el of mapElCandidates()) { el.style.opacity='1'; el.style.pointerEvents='auto'; }
    updateSubText();
  }

  // ====== 目標＆ラベル同期 ======
  let target = null; // {lat,lng,name,address,note}
  function readLabelDom(){
    return {
      name:    document.getElementById('dn-dest-name')?.textContent || '',
      address: document.getElementById('dn-dest-address')?.textContent || '',
      note:    document.getElementById('dn-dest-note')?.textContent || '',
    };
  }
  function setTarget(lat,lng,overrideName){
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const dom = readLabelDom();
    target = { lat, lng, name: overrideName || dom.name, address: dom.address, note: dom.note };
    if (nameEl)  nameEl.textContent  = target.name || '';
    if (addrEl)  addrEl.textContent  = target.address || '';
    if (noteEl)  noteEl.textContent  = target.note || '';
  }

  // destLabel → HUD 同期（座標経由）
  const prevByLatLng = window.DN_focusDestByLatLng;
  window.DN_focusDestByLatLng = function(lat,lng){
    const nm = document.getElementById('dn-dest-name')?.textContent || '';
    setTarget(lat,lng,nm);
    if (typeof prevByLatLng === 'function') prevByLatLng(lat,lng);
  };
  // indexのみの古い経路でも最低限同期
  const prevByIdx = window.DN_focusDest;
  window.DN_focusDest = function(i){
    try{
      if (window.DN__internalGetMarkers) {
        const m = window.DN__internalGetMarkers()[i];
        const ll = m?.getLatLng?.();
        if (ll) setTarget(ll.lat, ll.lng, document.getElementById('dn-dest-name')?.textContent||'');
      }
    }catch{}
    if (typeof prevByIdx === 'function') prevByIdx(i);
  };

  // ====== 速度・方位 ======
  let lastPos = null, filtHeading = 0, exitHoldStart = 0;
  function updateFromGPS(p){
    const t = Date.now()/1000;
    const pos = { lat:p.coords.latitude, lng:p.coords.longitude, t };
    let vms = (p.coords.speed!=null && !Number.isNaN(p.coords.speed)) ? p.coords.speed : null;
    if (vms==null && lastPos){
      const d = haversine(lastPos, pos); const dt = Math.max(0.5, t - lastPos.t); vms = d/dt;
    }
    const kmh = (vms||0)*3.6;

    let hdg = (p.coords.heading!=null && !Number.isNaN(p.coords.heading)) ? p.coords.heading : null;
    if (hdg==null && lastPos){ if (haversine(lastPos,pos) > 1.5) hdg = bearing(lastPos, pos); }
    if (hdg==null) hdg = filtHeading;
    const alpha = 0.25, dAng = angDiff(hdg, filtHeading); filtHeading = (filtHeading + alpha*dAng + 360) % 360;

    if (target){
      const dist = haversine(pos, target);
      const brgTo = bearing(pos, target);
      const rel = (brgTo - filtHeading + 360) % 360;
      distEl.textContent = dist >= 1000 ? (dist/1000).toFixed(2)+' km' : Math.round(dist)+' m';
      if (nameEl) nameEl.textContent = target.name || '';
      if (addrEl) addrEl.textContent = target.address || '';
      if (noteEl) noteEl.textContent = target.note || '';
      arrow.style.transform = `rotate(${rel}deg)`;
    }

    handleMode(kmh);
    lastPos = pos;
  }

  // ====== モード制御（自動/手動）＆表示テキスト ======
  let override = (MODE_PARAM==='ride'||MODE_PARAM==='map') ? MODE_PARAM : null; // 'ride'|'map'|null
  function updateSubText(){
    if (!subEl) return;
    if (override === 'ride')       subEl.textContent = '手動固定: HUD（長押しで解除）';
    else if (override === 'map')   subEl.textContent = '手動固定: 地図（長押しで解除）';
    else                           subEl.textContent = 'ライドHUD（走行で自動表示 / 停止で地図に戻る）';
  }
  function setOverride(m){
    ensureHud(); override = m; updateSubText();
    if (m==='ride') showHud(); else if (m==='map') hideHud();
  }
  function clearOverride(){ override = null; updateSubText(); }
  function handleMode(kmh){
    if (override){ if (override==='ride') showHud(); else hideHud(); return; }
    if (kmh >= SPEED_ENTER_KMH){ exitHoldStart = 0; showHud(); }
    else if (kmh <= SPEED_EXIT_KMH){
      if (!exitHoldStart) exitHoldStart = Date.now()/1000;
      if (Date.now()/1000 - exitHoldStart >= EXIT_HOLD_S) hideHud();
    }
  }
  window.DN_setRideMode = function(m){ if (m==='auto') clearOverride(); else setOverride(m); };

  // ====== 長押しトグル ======
  const LONG_MS = 650, MOVE_TOL = 10;
  let lpTimer=0, sx=0, sy=0;
  function onDown(ev){ sx=ev.clientX; sy=ev.clientY; clearTimeout(lpTimer); lpTimer=setTimeout(onLong, LONG_MS); }
  function onMove(ev){ if (Math.hypot(ev.clientX-sx, ev.clientY-sy) > MOVE_TOL) clearTimeout(lpTimer); }
  function onUp(){ clearTimeout(lpTimer); }
  function onLong(){
    clearTimeout(lpTimer);
    if (override){ clearOverride(); navigator.vibrate?.([30,70,30]); return; }
    setOverride(visible ? 'map' : 'ride'); navigator.vibrate?.([15,60,120]);
  }
  window.addEventListener('pointerdown', onDown, { passive:true });
  window.addEventListener('pointermove', onMove, { passive:true });
  window.addEventListener('pointerup', onUp, { passive:true });
  window.addEventListener('pointercancel', onUp, { passive:true });

  // ====== GPSチェイン合流 ======
  const prevOnGps = window.__DN_onGpsUpdate;
  window.__DN_onGpsUpdate = (posOrEvent)=>{
    if (posOrEvent && 'coords' in posOrEvent) {
      updateFromGPS(posOrEvent);
    } else if (posOrEvent && typeof posOrEvent.lat==='number') {
      const fake = { coords: { latitude: posOrEvent.lat, longitude: posOrEvent.lng, speed: null, heading: null } };
      updateFromGPS(fake);
    }
    if (typeof prevOnGps==='function') prevOnGps(posOrEvent);
  };

  document.addEventListener('DOMContentLoaded', ()=>{ ensureHud(); updateSubText(); }, { once:true });
})();





