// src/assist/turns.js
// ターンバイターンβ + HUD連動（曲率つき矢印＆交差点シルエット）
//
// ・下部カード用の小型Canvas（既存）＋ HUD全画面用Canvas（新規）
// ・角度に応じて L字／ゆるカーブ／Uターンを描画
// ・|角度|>=135° を「T字」に分類して、交差点バー（横棒）を表示
// ・|角度|>=50° を「十字（左/右折）」としてバー表示、<50° はゆるカーブ
// ・HUDは body.hud クラスで自動切替（長押しトグルが既にあればそれと連動）
//
// 公開関数：initTurnEngine(routePoints), onGpsTurnUpdate(pos)
// ラベル切替時は window.DN_setTurnLeg(prevRec, nowRec) を呼んでください（既に組み込み済み）

let R = [];        // 公式ルート: [{lat,lng}, ...]
let S = [0];       // 累積距離[m]
let ready = false;

let leg = null;    // {startIdx,endIdx,mans:[{i,lat,lng,type,angle}], nextIdx, spokenStage}
const STAGES = [250, 80, 25];  // しきい値[m]
const PASS_RADIUS_M = 18;      // 曲がり通過許容[m]
const UI_ID = 'dn-turn-card';
const HUD_ID = 'dn-hud-cv';

export function initTurnEngine(routePoints){
  R = Array.isArray(routePoints) ? routePoints
    .map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  S = [0];
  for (let i=1;i<R.length;i++) S[i] = S[i-1] + hav(R[i-1], R[i]);
  ready = R.length > 2;

  installUI();
  installHUD();

  window.DN_setTurnLeg = setLegByRecords; // ラベル切替側から呼ぶ
}

export function onGpsTurnUpdate(pos){
  if (!ready || !leg) return;
  const lat = pos.lat ?? pos.coords?.latitude;
  const lng = pos.lng ?? pos.coords?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const here = {lat, lng};
  const hi = nearestIdx(here);

  // 直近曲がり通過チェック
  while (leg.nextIdx < leg.mans.length) {
    const m = leg.mans[leg.nextIdx];
    const passedByIndex = (hi >= m.i - 2);
    const passedByDist  = hav(here, {lat:m.lat, lng:m.lng}) <= PASS_RADIUS_M;
    if (passedByIndex || passedByDist) {
      speakNow(m); hapticNow(m);
      leg.nextIdx++;
      leg.spokenStage = -1;
    } else break;
  }

  const next = leg.mans[leg.nextIdx];
  if (next) {
    const distRem = Math.max(0, S[next.i] - S[hi]);
    updateUI(next, distRem);
    maybeSpeak(next, distRem);
  } else {
    updateUIArrive();
  }
}

// ===== 区間セット =====
function setLegByRecords(prevRec, nextRec){
  if (!ready || !nextRec || !Number.isFinite(nextRec.lat) || !Number.isFinite(nextRec.lng)) {
    leg = null; updateUIIdle(); drawHUDIdle(); return;
  }
  let si, ei;
  if (prevRec && Number.isFinite(prevRec.lat) && Number.isFinite(prevRec.lng)){
    si = nearestIdx({lat:prevRec.lat, lng:prevRec.lng});
    ei = nearestIdx({lat:nextRec.lat, lng:nextRec.lng});
  } else {
    ei = nearestIdx({lat:nextRec.lat, lng:nextRec.lng});
    si = Math.max(0, ei - 30);
  }
  if (si > ei) [si, ei] = [ei, si];
  const mans = buildManeuvers(si, ei);
  leg = { startIdx:si, endIdx:ei, mans, nextIdx:0, spokenStage:-1 };
  updateUIFromNext();
}

// ===== 曲がり抽出 =====
function buildManeuvers(si, ei){
  const out=[];
  for(let i=Math.max(si+1,1); i<=Math.min(ei-1, R.length-2); i++){
    const a = bearing(smooth(i-1), smooth(i));
    const b = bearing(smooth(i),   smooth(i+1));
    let ang = norm180(b - a); // -180..+180
    const abs = Math.abs(ang);
    if (abs < 25) continue; // 道なり
    let type;
    if (abs > 160) type = 'uturn';
    else if (abs >= 50) type = (ang < 0 ? 'left' : 'right');
    else type = (ang < 0 ? 'slight_left' : 'slight_right');
    out.push({ i, lat:R[i].lat, lng:R[i].lng, type, angle:ang });
  }
  out.push({ i:ei, lat:R[ei].lat, lng:R[ei].lng, type:'arrive', angle:0 });
  return out;

  function smooth(k){
    const i0 = Math.max(0, k-1), i1=k, i2=Math.min(R.length-1, k+1);
    return { lat:(R[i0].lat+R[i1].lat+R[i2].lat)/3, lng:(R[i0].lng+R[i1].lng+R[i2].lng)/3 };
  }
}

// ===== 近傍探索・測地 =====
function nearestIdx(p){ let best=0,bd=Infinity; for(let i=0;i<R.length;i++){const di=hav(p,R[i]); if(di<bd){bd=di;best=i;}} return best; }
function hav(a,b){ const toR=x=>x*Math.PI/180,Rm=6371000; const dφ=toR(b.lat-a.lat), dλ=toR(b.lng-a.lng);
  const s=Math.sin(dφ/2)**2 + Math.cos(toR(a.lat))*Math.cos(toR(b.lat))*Math.sin(dλ/2)**2; return 2*Rm*Math.asin(Math.sqrt(s)); }
function bearing(a,b){ const toR=x=>x*Math.PI/180,toD=r=>r*180/Math.PI; const φ1=toR(a.lat),φ2=toR(b.lat),Δλ=toR(b.lng-a.lng);
  const y=Math.sin(Δλ)*Math.cos(φ2), x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ); return (toD(Math.atan2(y,x))+360)%360; }
function norm180(a){ return ((a+180)%360+360)%360-180; }

// ===== UI（下部カード + HUD） =====
function installUI(){
  if (document.getElementById(UI_ID)) return;
  const el = document.createElement('div');
  el.id = UI_ID;
  el.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9500;padding:10px 14px;border-radius:12px;background:rgba(0,0,0,.85);color:#fff;min-width:240px;box-shadow:0 10px 24px rgba(0,0,0,.35);font:600 16px/1.25 system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans JP",sans-serif;text-align:center;pointer-events:none;display:flex;gap:10px;align-items:center;justify-content:center';
  el.innerHTML =
    '<canvas id="dn-turn-cv" width="164" height="164" style="width:82px;height:82px" aria-hidden="true"></canvas>' +
    '<div style="text-align:left"><div id="dn-turn-line1" style="font-size:18px"></div><div id="dn-turn-line2" style="opacity:.85;font-size:13px;margin-top:3px"></div></div>';
  document.body.appendChild(el);
}
function installHUD(){
  if (document.getElementById(HUD_ID)) return;
  const cv = document.createElement('canvas');
  cv.id = HUD_ID;
  cv.setAttribute('aria-hidden','true');
  Object.assign(cv.style, {
    position:'fixed', inset:'0', zIndex:9000, pointerEvents:'none', display:'none'
  });
  document.body.appendChild(cv);
  const resize = ()=>{ cv.width = window.innerWidth; cv.height = window.innerHeight; };
  resize(); window.addEventListener('resize', resize);
}
function isHud(){ return document.body.classList.contains('hud'); }
function showCard(show){ const el = document.getElementById(UI_ID); if(el) el.style.display = show ? 'flex':'none'; }
function showHUD(show){ const cv = document.getElementById(HUD_ID); if(cv) cv.style.display = show ? 'block':'none'; }

function updateUIFromNext(){
  if (!leg || !leg.mans.length) { updateUIIdle(); drawHUDIdle(); return; }
  updateUI(leg.mans[0], 0);
}
function updateUI(next, dist){
  const hud = isHud();
  showHUD(hud); showCard(!hud);

  const dir = next.type.includes('left') ? 'left'
            : next.type.includes('right') ? 'right'
            : (next.type==='uturn' ? 'right' : 'right');
  const bend = next.type==='arrive' ? 0 : Math.abs(next.angle||90);

  // === 地図上オーバレイ：近づいたら表示、曲がり終われば消す ===
  updateMapOverlay(dir, bend, next, dist);

  // 小カード側の矢印（HUD時は非表示だが常に描画してOK）
  drawTurnArrow(dir, bend);

  // テキスト（小カード）
  const l1 = document.getElementById('dn-turn-line1');
  const l2 = document.getElementById('dn-turn-line2');
  const text = {left:'左折', right:'右折', slight_left:'やや左', slight_right:'やや右', uturn:'Uターン', arrive:'目的地'}[next.type] || '道なり';
  const dTxt = `${Math.max(0, Math.round(dist))}m 先`;
  if (l1) l1.textContent = (next.type==='arrive') ? '🏁 まもなく目的地です' : `${dTxt}、${text}`;
  if (l2) l2.textContent = hintText(next.type);
}

function updateUIIdle(){ const l1=document.getElementById('dn-turn-line1'); const l2=document.getElementById('dn-turn-line2');
  if (l1) l1.textContent='案内待機中'; if (l2) l2.textContent=''; }
function updateUIArrive(){ const l1=document.getElementById('dn-turn-line1'); const l2=document.getElementById('dn-turn-line2');
  if (l1) l1.textContent='🏁 まもなく目的地です'; if (l2) l2.textContent=''; }

// ===== カード用：曲率つき矢印（小） =====
// ===== カード用：曲率つき矢印（小）＋ 進行方向ヘッド =====
function drawTurnArrow(dir, bendDegRaw){
  const cv = document.getElementById('dn-turn-cv'); if (!cv) return;
  const ctx = cv.getContext('2d'); const W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);

  const bend = Math.max(25, Math.min(180, Math.round(bendDegRaw || 90)));
  const sign = (dir==='left' || dir==='slight_left') ? -1 : +1;

  // 基本寸法
  const body=24, outline=body+6, preLen=30, postLen=34, curveLen=46;
  const x0=32, y0=H-20, P1={x:x0,y:y0-preLen};

  const rad=bend*Math.PI/180, dirX=Math.sin(rad)*sign, dirY=-Math.cos(rad);
  const kLen=curveLen*(90/bend), P2={x:P1.x+dirX*kLen, y:P1.y+dirY*kLen};
  const cGain=0.55*(bend/90), C1={x:P1.x, y:P1.y-cGain*curveLen}, C2={x:P2.x-dirX*cGain*curveLen, y:P2.y-dirY*cGain*curveLen};
  const P3={x:P2.x+dirX*postLen, y:P2.y+dirY*postLen}; // 矢印先端（進行方向）

  // 本体（外縁→本体）
  const headPath=(w)=>{ const nx=-dirY, ny=dirX, tip=P3,
    base={x:P3.x-dirX*(w*1.65), y:P3.y-dirY*(w*1.65)},
    L={x:base.x+nx*w, y:base.y+ny*w}, R={x:base.x-nx*w, y:base.y-ny*w};
    ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath(); };

  const stroke=(w,color)=>{ ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(P1.x,P1.y);
    ctx.bezierCurveTo(C1.x,C1.y,C2.x,C2.y,P2.x,P2.y); ctx.lineTo(P3.x,P3.y);
    ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=color; ctx.lineWidth=w; ctx.stroke();
    ctx.beginPath(); headPath(w*0.62); ctx.fillStyle=color; ctx.fill(); };

  stroke(outline,'#0b3a5a');
  stroke(body,'#12b24a');

  // ★進行方向インジケータ（白の小さな三角ヘッド／縁取りつき）
  const iw = Math.max(6, body*0.50);
  const nx=-dirY, ny=dirX;
  const tip=P3, base={x:P3.x-dirX*(iw*1.25), y:P3.y-dirY*(iw*1.25)},
        L={x:base.x+nx*(iw*0.68), y:base.y+ny*(iw*0.68)},
        R={x:base.x-nx*(iw*0.68), y:base.y-ny*(iw*0.68)};
  // 縁取り
  ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath();
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();
  // 本体
  ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath();
  ctx.fillStyle='#fff'; ctx.fill();
}



// ===== HUD用：全画面矢印＋交差点シルエット＋進行方向ヘッド =====
function drawHUD(dir, bendDegRaw, next, dist){
  const cv = document.getElementById('dn-hud-cv'); if (!cv) return;
  const ctx = cv.getContext('2d'); const W=cv.width,H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='rgba(0,0,0,0.85)'; ctx.fillRect(0,0,W,H);

  const bend = Math.max(25, Math.min(180, Math.round(bendDegRaw || 90)));
  const sign = (dir==='left' || dir==='slight_left') ? -1 : +1;

  const S = Math.min(W,H);
  const body = Math.max(18, Math.round(S*0.06));
  const outline = body + Math.round(body*0.28);
  const preLen = Math.round(S*0.18);
  const postLen= Math.round(S*0.20);
  const curveLen=Math.round(S*0.26);

  const cx = Math.round(W*0.38), cy = Math.round(H*0.72);
  const x0=cx, y0=cy, P1={x:x0,y:y0-preLen};

  const rad=bend*Math.PI/180, dirX=Math.sin(rad)*sign, dirY=-Math.cos(rad);
  const kLen=curveLen*(90/bend), P2={x:P1.x+dirX*kLen, y:P1.y+dirY*kLen};
  const cGain=0.55*(bend/90), C1={x:P1.x, y:P1.y-cGain*curveLen}, C2={x:P2.x-dirX*cGain*curveLen, y:P2.y-dirY*cGain*curveLen};
  const P3={x:P2.x+dirX*postLen, y:P2.y+dirY*postLen};

  // 交差点バー
  const inter = classifyIntersection(next);
  const barW = outline;
  if (inter!=='none'){
    ctx.save(); ctx.translate(P2.x, P2.y); ctx.rotate(Math.atan2(dirY, dirX));
    ctx.fillStyle='rgba(255,255,255,0.18)';
    const len=Math.round(S*0.22);
    ctx.fillRect(-len, -barW/2, len*2, barW); // 横棒
    if (inter==='cross'){ ctx.fillRect(-barW/2, -len, barW, len*2); } // 十字
    ctx.restore();
  }

  // 胴体
  const headPath=(w)=>{ const nx=-dirY, ny=dirX, tip=P3,
    base={x:P3.x-dirX*(w*1.65), y:P3.y-dirY*(w*1.65)},
    L={x:base.x+nx*w, y:base.y+ny*w}, R={x:base.x-nx*w, y:base.y-ny*w};
    ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath(); };
  const stroke=(w,color)=>{ ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(P1.x,P1.y);
    ctx.bezierCurveTo(C1.x,C1.y,C2.x,C2.y,P2.x,P2.y); ctx.lineTo(P3.x,P3.y);
    ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=color; ctx.lineWidth=w; ctx.stroke();
    ctx.beginPath(); headPath(w*0.62); ctx.fillStyle=color; ctx.fill(); };
  stroke(outline,'#0b3a5a'); stroke(body,'#12b24a');

  // ★進行方向インジケータ（白いヘッド・縁取り）
  const iw = Math.max(10, Math.round(body*0.9));
  const nx=-dirY, ny=dirX;
  const tip=P3, base={x:P3.x-dirX*(iw*1.25), y:P3.y-dirY*(iw*1.25)},
        L={x:base.x+nx*(iw*0.70), y:base.y+ny*(iw*0.70)},
        R={x:base.x-nx*(iw*0.70), y:base.y-ny*(iw*0.70)};
  ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath();
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath();
  ctx.fillStyle='#fff'; ctx.fill();

  // 右側の距離・文言
  const text = {left:'左折', right:'右折', slight_left:'やや左', slight_right:'やや右', uturn:'Uターン', arrive:'目的地'}[next.type] || '道なり';
  ctx.fillStyle='#fff';
  ctx.font = `600 ${Math.round(S*0.08)}px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  ctx.fillText(`${Math.max(0,Math.round(dist))}m`, Math.round(W*0.55), Math.round(H*0.54));
  ctx.font = `500 ${Math.round(S*0.06)}px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
  ctx.fillText(text, Math.round(W*0.55), Math.round(H*0.62));

    // === 追加：上に氏名、下に備考と「長押しで解除」 ===
  const rec = (window.DN_destLabelCurrent && window.DN_destLabelCurrent()) || {};
  const name = rec.name || rec.氏名 || rec.お名前 || '';
  const note = rec.note || rec.備考 || '';
  ctx.font = `800 ${Math.round(S*0.07)}px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
  ctx.textAlign='center';
  ctx.fillText(name || '', W/2, Math.round(H*0.13));
  ctx.font = `500 ${Math.round(S*0.045)}px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
  ctx.fillText(note || '手動固定: HUD（長押しで解除）', W/2, Math.round(H*0.92));

}


  
function classifyIntersection(next){
  if (!next || next.type==='arrive') return 'none';
  const abs = Math.abs(next.angle||0);
  if (abs >= 135) return 'T';      // T字寄り
  if (abs >= 50)  return 'cross';  // 十字（標準の左/右折）
  return 'none';                    // ゆるカーブはバー無し
}

function drawHUDIdle(){
  const cv = document.getElementById(HUD_ID); if (!cv) return;
  const ctx = cv.getContext('2d'); const W=cv.width,H=cv.height;
  ctx.clearRect(0,0,W,H);
  if (!isHud()) return;
  ctx.fillStyle='rgba(0,0,0,0.85)'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#fff';
  ctx.font = `600 ${Math.round(Math.min(W,H)*0.08)}px system-ui, -apple-system, "Noto Sans JP", sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('案内待機中', W/2, H*0.55);
}

function hintText(type){
  if (type==='arrive') return '安全に停車して配達を完了してください';
  if (type==='uturn')  return '安全を確認し、可能なら転回';
  return '周囲と歩行者にご注意ください';
}

// ===== 音声・バイブ =====
function maybeSpeak(next, dist){
  const stage = (dist > STAGES[0]) ? 0 : (dist > STAGES[1]) ? 1 : (dist > STAGES[2]) ? 2 : 3;
  if (stage !== leg.spokenStage){
    leg.spokenStage = stage;
    const text = ttsText(next.type, dist);
    speak(text);
    if (stage >= 2) hapticPre(next);
  }
}
function ttsText(type, dist){
  const d = Math.max(0, Math.round(dist));
  const base = (d>0) ? `${d}メートル先、` : '';
  switch(type){
    case 'left': return base + '左折です';
    case 'right': return base + '右折です';
    case 'slight_left': return base + 'やや左です';
    case 'slight_right': return base + 'やや右です';
    case 'uturn': return base + 'Uターンです';
    case 'arrive': return 'まもなく目的地です';
    default: return base + '道なりです';
  }
}
function speak(text){
  try{ const u=new SpeechSynthesisUtterance(text); u.lang='ja-JP'; u.rate=1; u.pitch=1; u.volume=1;
    speechSynthesis.cancel(); speechSynthesis.speak(u); }catch{}
}
function hapticPre(next){
  if (!navigator.vibrate) return;
  if (next.type==='left' || next.type==='slight_left') navigator.vibrate([200,90,200,90,200]);
  else if (next.type==='right' || next.type==='slight_right') navigator.vibrate([400,120,400]);
}
function hapticNow(next){
  if (!navigator.vibrate) return;
  if (next.type==='left' || next.type==='slight_left') navigator.vibrate([240,80,240,80,240]);
  else if (next.type==='right' || next.type==='slight_right') navigator.vibrate([500,120,500]);
  else if (next.type==='uturn') navigator.vibrate([250,80,250,80,500]);
}

// ===== グローバルフォールバック =====
window.DN_initTurnEngine = initTurnEngine;
window.DN_onGpsTurnUpdate = onGpsTurnUpdate;

// ===== 地図上の大矢印オーバレイ =====
function updateMapOverlay(dir, bend, next, dist){
  const host = document.getElementById('turnOverlay');
  const cv   = document.getElementById('turnOverlayCv');
  if (!host || !cv) return;

  // 表示条件：案内対象＆距離がしきい値未満
  const SHOW_TH = 80; // m（好みで調整）
  const show = (next && next.type!=='arrive' && dist <= SHOW_TH);
  host.classList.toggle('show', show);
  if (!show) { const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); return; }

  const ctx = cv.getContext('2d');
  const W=cv.width, H=cv.height; ctx.clearRect(0,0,W,H);

  // 背景は透過のまま。矢印だけ描画（HUDと同じ色味）
  const bendDeg = Math.max(25, Math.min(180, Math.round(bend || 90)));
  const sign = (dir==='left' || dir==='slight_left') ? -1 : +1;

  // 画面中央に大きめ
  const S = Math.min(W,H);
  const body = Math.round(S*0.12), outline = Math.round(S*0.12*1.28);
  const preLen = Math.round(S*0.20), postLen = Math.round(S*0.22), curveLen = Math.round(S*0.30);
  const x0 = W*0.32, y0 = H*0.78;
  const P1 = {x:x0, y:y0-preLen};

  const rad = bendDeg*Math.PI/180, dirX=Math.sin(rad)*sign, dirY=-Math.cos(rad);
  const kLen = curveLen*(90/bendDeg);
  const P2={x:P1.x+dirX*kLen, y:P1.y+dirY*kLen};
  const cGain=0.55*(bendDeg/90), C1={x:P1.x, y:P1.y-cGain*curveLen}, C2={x:P2.x-dirX*cGain*curveLen, y:P2.y-dirY*cGain*curveLen};
  const P3={x:P2.x+dirX*postLen, y:P2.y+dirY*postLen};

  const head=(w)=>{ const nx=-dirY, ny=dirX, tip=P3, base={x:P3.x-dirX*(w*1.65), y:P3.y-dirY*(w*1.65)},
    L={x:base.x+nx*w, y:base.y+ny*w}, R={x:base.x-nx*w, y:base.y-ny*w};
    ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath(); };
  const stroke=(w,color)=>{ ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(P1.x,P1.y);
    ctx.bezierCurveTo(C1.x,C1.y,C2.x,C2.y,P2.x,P2.y); ctx.lineTo(P3.x,P3.y);
    ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=color; ctx.lineWidth=w; ctx.stroke();
    ctx.beginPath(); head(w*0.62); ctx.fillStyle=color; ctx.fill(); };

  stroke(outline,'#0b3a5a'); stroke(body,'#12b24a');

  // 進行方向ヘッド（白）
  const iw = Math.max(14, Math.round(body*0.85));
  const nx=-dirY, ny=dirX;
  const tip=P3, base={x:P3.x-dirX*(iw*1.25), y:P3.y-dirY*(iw*1.25)},
        L={x:base.x+nx*(iw*0.70), y:base.y+ny*(iw*0.70)},
        R={x:base.x-nx*(iw*0.70), y:base.y-ny*(iw*0.70)};
  ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath();
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill(); // 縁取り
  ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.closePath();
  ctx.fillStyle='#fff'; ctx.fill();
}






