// src/assist/turns.js
// --- シンプルなターンバイターンβ ---
// ・公式ルート上の角度変化から「左/右/やや左/やや右/UTurn/到着」を抽出
// ・次の曲がりまでの距離を表示（下部HUD）
// ・250m/80m/直前で音声+バイブ案内
// ・ラベル「前→次」の確定時に、区間(prevRec→nextRec)をセットして案内更新

let R = [];        // 公式ルート: [{lat,lng}, ...]
let S = [0];       // 累積距離[m]
let ready = false;

let leg = null;    // 現在の区間 {startIdx,endIdx,mans:[{i,lat,lng,type,angle}], nextIdx, spokenStage}
const STAGES = [250, 80, 25];  // しきい値[m]
const PASS_RADIUS_M = 18;      // 曲がり通過許容[m]
const UI_ID = 'dn-turn-card';

// ===== 公開API =====
export function initTurnEngine(routePoints){
  // ルート正規化
  R = Array.isArray(routePoints) ? routePoints
    .map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  S = [0];
  for (let i=1;i<R.length;i++) S[i] = S[i-1] + hav(R[i-1], R[i]);
  ready = R.length > 2;

  installUI();

  // 他ファイルから呼べるように（ラベル切替で区間確定）
  window.DN_setTurnLeg = setLegByRecords;
}

export function onGpsTurnUpdate(pos){
  if (!ready || !leg) return;
  const lat = pos.lat ?? pos.coords?.latitude;
  const lng = pos.lng ?? pos.coords?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const here = {lat, lng};
  const hi = nearestIdx(here);

  // 直近の曲がりを通過していたら次へ
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

// ===== 区間セット（prevRec, nextRec を渡す） =====
function setLegByRecords(prevRec, nextRec){
  if (!ready || !nextRec || !Number.isFinite(nextRec.lat) || !Number.isFinite(nextRec.lng)) {
    leg = null; updateUIIdle(); return;
  }
  let si, ei;
  if (prevRec && Number.isFinite(prevRec.lat) && Number.isFinite(prevRec.lng)){
    si = nearestIdx({lat:prevRec.lat, lng:prevRec.lng});
    ei = nearestIdx({lat:nextRec.lat, lng:nextRec.lng});
  } else {
    // 最初の1件だけ、手前30点ぶんを区間に含めて案内開始
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
  // 角度の安定化（3点平均ベクトル）
  for(let i=Math.max(si+1,1); i<=Math.min(ei-1, R.length-2); i++){
    const a = bearing(smooth(i-1), smooth(i));
    const b = bearing(smooth(i),   smooth(i+1));
    let ang = norm180(b - a); // -180..+180
    const abs = Math.abs(ang);
    if (abs < 25) continue; // 小さい変化は「道なり」で無視
    let type;
    if (abs > 160) type = 'uturn';
    else if (abs >= 50) type = (ang < 0 ? 'left' : 'right');
    else type = (ang < 0 ? 'slight_left' : 'slight_right');
    out.push({ i, lat:R[i].lat, lng:R[i].lng, type, angle:ang });
  }
  // 到着を末尾に追加
  out.push({ i:ei, lat:R[ei].lat, lng:R[ei].lng, type:'arrive', angle:0 });
  return out;

  function smooth(k){
    const i0 = Math.max(0, k-1), i1=k, i2=Math.min(R.length-1, k+1);
    return {
      lat:(R[i0].lat+R[i1].lat+R[i2].lat)/3,
      lng:(R[i0].lng+R[i1].lng+R[i2].lng)/3
    };
  }
}

// ===== 近傍探索・測地ヘルパ =====
function nearestIdx(p){
  let best=0, bd=Infinity;
  for(let i=0;i<R.length;i++){
    const di = hav(p, R[i]);
    if (di < bd){ bd=di; best=i; }
  }
  return best;
}
function hav(a,b){ // Haversine 距離[m]
  const toR=x=>x*Math.PI/180, Rm=6371000;
  const dφ=toR(b.lat-a.lat), dλ=toR(b.lng-a.lng);
  const s=Math.sin(dφ/2)**2 + Math.cos(toR(a.lat))*Math.cos(toR(b.lat))*Math.sin(dλ/2)**2;
  return 2*Rm*Math.asin(Math.sqrt(s));
}
function bearing(a,b){ // 0..360
  const toR=x=>x*Math.PI/180, toD=r=>r*180/Math.PI;
  const φ1=toR(a.lat), φ2=toR(b.lat), Δλ=toR(b.lng-a.lng);
  const y=Math.sin(Δλ)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (toD(Math.atan2(y,x))+360)%360;
}
function norm180(a){ return ((a+180)%360+360)%360-180; }

// ===== UI（下部HUD + 曲率付き矢印Canvas） =====
function installUI(){
  if (document.getElementById(UI_ID)) return;
  const el = document.createElement('div');
  el.id = UI_ID;
  el.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9500;padding:10px 14px;border-radius:12px;background:rgba(0,0,0,.85);color:#fff;min-width:240px;box-shadow:0 10px 24px rgba(0,0,0,.35);font:600 16px/1.25 system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans JP",sans-serif;text-align:center;pointer-events:none;display:flex;gap:10px;align-items:center;justify-content:center';
  el.innerHTML =
    '<canvas id="dn-turn-cv" width="164" height="164" style="width:82px;height:82px"></canvas>' +
    '<div style="text-align:left"><div id="dn-turn-line1" style="font-size:18px"></div><div id="dn-turn-line2" style="opacity:.85;font-size:13px;margin-top:3px"></div></div>';
  document.body.appendChild(el);
}
function updateUIFromNext(){
  if (!leg || !leg.mans.length) { updateUIIdle(); return; }
  updateUI(leg.mans[0], 0);
}
function updateUI(next, dist){
  // 方向+曲率をCanvasへ
  const dir = next.type.includes('left') ? 'left'
            : next.type.includes('right') ? 'right'
            : (next.type==='uturn' ? 'right' : 'right'); // Uターンは右基準で大カーブ
  const bend = next.type==='arrive' ? 0 : Math.abs(next.angle||90);
  drawTurnArrow(dir, bend);

  const l1 = document.getElementById('dn-turn-line1');
  const l2 = document.getElementById('dn-turn-line2');
  const text = {
    left:'左折', right:'右折', slight_left:'やや左', slight_right:'やや右',
    uturn:'Uターン', arrive:'目的地'
  }[next.type] || '道なり';
  const dTxt = `${Math.max(0, Math.round(dist))}m 先`;
  l1.textContent = (next.type==='arrive') ? '🏁 まもなく目的地です' : `${dTxt}、${text}`;
  l2.textContent = hintText(next.type);
}
function updateUIIdle(){
  const l1 = document.getElementById('dn-turn-line1');
  const l2 = document.getElementById('dn-turn-line2');
  if (l1) l1.textContent = '案内待機中';
  if (l2) l2.textContent = '';
}
function updateUIArrive(){
  const l1 = document.getElementById('dn-turn-line1');
  const l2 = document.getElementById('dn-turn-line2');
  if (l1) l1.textContent = '🏁 まもなく目的地です';
  if (l2) l2.textContent = '';
}
function hintText(type){
  if (type==='arrive') return '安全に停車して配達を完了してください';
  if (type==='uturn')  return '安全を確認し、可能なら転回';
  return '周囲と歩行者にご注意ください';
}

// ===== 曲率付きターン矢印(Canvas) =====
function drawTurnArrow(dir/*'left'|'right'|'uturn'|'slight_left'|'slight_right'*/, bendDegRaw){
  const cv = document.getElementById('dn-turn-cv');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0,0,W,H);

  const bend = Math.max(25, Math.min(180, Math.round(bendDegRaw || 90)));
  const sign = (dir==='left' || dir==='slight_left') ? -1 : +1;

  // 基本寸法
  const body = 24;
  const outline = body + 6;
  const preLen = 30;
  const postLen = 34;
  const curveLen = 46;

  // Y上向きを基準に右へ曲がる（左は左右反転）
  const x0 = 32, y0 = H-20;
  const P1 = {x:x0, y:y0-preLen};

  const rad = bend * Math.PI/180;
  const dirX =  Math.sin(rad) * sign;
  const dirY = -Math.cos(rad);

  const kLen = curveLen * (90/bend);
  const P2 = {x:P1.x + dirX*kLen, y:P1.y + dirY*kLen};

  const cGain = 0.55 * (bend/90);
  const C1 = {x:P1.x, y:P1.y - cGain*curveLen};
  const C2 = {x:P2.x - dirX*cGain*curveLen, y:P2.y - dirY*cGain*curveLen};

  const P3 = {x:P2.x + dirX*postLen, y:P2.y + dirY*postLen};

  const head = (ctx, w)=>{
    const nx = -dirY, ny = dirX;
    const tip = P3;
    const base = {x:P3.x - dirX*(w*1.6), y:P3.y - dirY*(w*1.6)};
    const L = {x:base.x + nx*w, y:base.y + ny*w};
    const R = {x:base.x - nx*w, y:base.y - ny*w};
    ctx.moveTo(tip.x, tip.y); ctx.lineTo(L.x, L.y); ctx.lineTo(R.x, R.y); ctx.closePath();
  };

  const strokePath = (w, color)=>{
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(P1.x, P1.y);
    ctx.bezierCurveTo(C1.x, C1.y, C2.x, C2.y, P2.x, P2.y);
    ctx.lineTo(P3.x, P3.y);
    ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.stroke();
    ctx.beginPath(); head(ctx, w*0.55);
    ctx.fillStyle = color; ctx.fill();
  };

  strokePath(outline, '#0b3a5a');  // 濃紺の縁
  strokePath(body,    '#12b24a');  // 緑の本体
}

// ===== 音声・バイブ =====
function maybeSpeak(next, dist){
  const stage = (dist > STAGES[0]) ? 0
              : (dist > STAGES[1]) ? 1
              : (dist > STAGES[2]) ? 2 : 3; // 3=直前
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
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP'; u.rate = 1; u.pitch = 1; u.volume = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch{}
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

// ===== グローバルフォールバック（念のため） =====
window.DN_initTurnEngine = initTurnEngine;
window.DN_onGpsTurnUpdate = onGpsTurnUpdate;
