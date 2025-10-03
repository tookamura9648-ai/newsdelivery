// 次の目的地ラベル（CSV→表示）＋ドラッグ移動＆四隅スナップ
// 機能: ①順序は order/id 優先 ②GPS初回で現在地より前を既訪問 ③“次へ”で手動前進
//       ④到着で自動前進 ⑤focusMarkers / rideHud と連動
import { AssistFlags } from './assistFlags.js';
import { haversine } from './geometry.js';

/* ===== CSV ===== */
function parseCSV(text){
  const rows=[]; let i=0, cell='', row=[], q=false;
  while(i<text.length){
    const c=text[i++];
    if(q){
      if(c==='\"'){ if(text[i]==='\"'){ cell+='\"'; i++; } else { q=false; } }
      else cell+=c;
    }else{
      if(c==='\"') q=true;
      else if(c===','){ row.push(cell); cell=''; }
      else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i]==='\n') i++; row.push(cell); rows.push(row); row=[]; cell=''; }
      else cell+=c;
    }
  }
  row.push(cell); rows.push(row);
  if (rows[0]?.[0]?.charCodeAt(0)===0xFEFF) rows[0][0]=rows[0][0].slice(1);
  return rows;
}
function headerIndexMap(headers){
  const norm=s=>String(s||'').toLowerCase().replace(/\s/g,'');
  const map={}, al={
    order  : ['order','順路','順番','配達順','seq','route'],
    name   : ['name','氏名','お名前','利用者名'],
    address: ['address','住所','所在地'],
    note   : ['note','備考','メモ','時間帯','区分'],
    lat    : ['lat','latitude','緯度'],
    lng    : ['lng','long','longitude','経度','経緯度'],
    id     : ['id','番号','no'],    
  };
  for (const k in al){
    const hit = headers.findIndex(h => al[k].some(a => norm(h)===norm(a)));
    if (hit>=0) map[k]=hit;
  }
  return map;
}
// DMS(度分秒)でも10進に直す（普段はGoogleマップの10進をそのままでOK）
function parseCoord(val, kind/*'lat'|'lng'*/){
  if (val == null) return NaN;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s); // 既に10進
  const m = s.match(/([NSEW])?\s*([0-9]{1,3})[^0-9]*([0-9]{1,2})?[^0-9]*([0-9]{1,2}(?:\.\d+)?)?\s*([NSEW])?/i);
  if (!m) return NaN;
  const hemi=(m[1]||m[5]||'').toUpperCase();
  const deg=Number(m[2]||0), min=Number(m[3]||0), sec=Number(m[4]||0);
  if (kind==='lat' && deg>90) return NaN;
  if (kind==='lng' && deg>180) return NaN;
  const sign = (hemi==='S'||hemi==='W') ? -1 : 1;
  return sign*(deg + min/60 + sec/3600);
}

/* ===== UI ===== */
function readParam(name){ return new URLSearchParams(location.search).get(name); }

function readBoolParam(name, def){
  const v = readParam(name);
  if (v == null) return def;
  return v === '1' || v === 'true' || v === 'on';
}

function applyDock(card, dock){
  card.dataset.dock = dock;
  card.style.left = card.style.right = card.style.top = card.style.bottom = '';
  const pad = 12;
  if (dock==='tl'){ card.style.left=pad+'px';  card.style.top=pad+'px'; }
  if (dock==='tr'){ card.style.right=pad+'px'; card.style.top=pad+'px'; }
  if (dock==='bl'){ card.style.left=pad+'px';  card.style.bottom=pad+'px'; }
  if (dock==='br'){ card.style.right=pad+'px'; card.style.bottom=pad+'px'; }
  if (dock==='free'){
    const x=Number(localStorage.getItem('dnDestX')||'24');
    const y=Number(localStorage.getItem('dnDestY')||'24');
    card.style.left=Math.max(0,x)+'px'; card.style.top=Math.max(0,y)+'px';
  }
  localStorage.setItem('dnDestDock', dock);
}
function createCard(){
  const wrap=document.createElement('div');
  wrap.id='dn-dest-card';
  wrap.style.cssText='position:fixed;z-index:9500;background:#fff;color:#111;border:2px solid #0b2f3a;border-radius:10px;padding:10px 14px;min-width:240px;max-width:72vw;box-shadow:0 8px 24px rgba(0,0,0,.15);font-family:system-ui,-apple-system,Segoe UI,Roboto;';
  wrap.innerHTML=`
    <div id="dn-dest-grip" style="position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:6px;background:#eef2f4;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:move;user-select:none;touch-action:none;line-height:1">↕</div>
    <button id="dn-dest-snap" title="位置を角にスナップ" style="position:absolute;right:34px;top:6px;width:22px;height:22px;border-radius:6px;border:1px solid #cfd8dc;background:#f7fbfd;cursor:pointer">◧</button>
    <div id="dn-dest-address" style="font-size:14px;line-height:1.25;margin-bottom:6px;word-break:break-word;"></div>
    <div id="dn-dest-name" style="font-size:28px;line-height:1.15;letter-spacing:.15em;font-weight:600;margin:2px 0 6px;"></div>
    <div id="dn-dest-note" style="font-size:14px;opacity:.85;"></div>`;
  document.body.appendChild(wrap);

  const initDock=readParam('destPos')||localStorage.getItem('dnDestDock')||'tr';
  applyDock(wrap,initDock);

  // drag
  const grip=wrap.querySelector('#dn-dest-grip');
  grip.addEventListener('pointerdown',ev=>{
    ev.preventDefault(); grip.setPointerCapture(ev.pointerId);
    const rect=wrap.getBoundingClientRect(); const offX=ev.clientX-rect.left, offY=ev.clientY-rect.top;
    applyDock(wrap,'free');
    const onMove=e=>{
      const x=Math.min(innerWidth-rect.width,Math.max(0,e.clientX-offX));
      const y=Math.min(innerHeight-rect.height,Math.max(0,e.clientY-offY));
      wrap.style.left=x+'px'; wrap.style.top=y+'px';
      localStorage.setItem('dnDestX',String(x)); localStorage.setItem('dnDestY',String(y));
    };
    const onUp=()=>{ try{grip.releasePointerCapture(ev.pointerId);}catch{} window.removeEventListener('pointermove',onMove); window.removeEventListener('pointerup',onUp); };
    window.addEventListener('pointermove',onMove); window.addEventListener('pointerup',onUp);
  });
  // snap
  const order=['tl','tr','br','bl'];
  wrap.querySelector('#dn-dest-snap').addEventListener('click',()=>{
    const cur=wrap.dataset.dock||'tr'; const i=order.indexOf(cur); applyDock(wrap, order[(i+1)%order.length]);
  });

  return wrap;
}
function updateCard(card, rec){
  card.querySelector('#dn-dest-address').textContent = rec.address || '';
  card.querySelector('#dn-dest-name').textContent    = rec.name || '';
  card.querySelector('#dn-dest-note').textContent    = rec.note || '';
}

/* ===== データ読込 ===== */
/* ---------- データ読込 ---------- */
async function loadPoints(){
  const res = await fetch('./assets/data/points.csv', { cache:'no-store' });
  if (!res.ok) throw new Error('points.csv not found');

  const text = await res.text();
  const rows = parseCSV(text).filter(r=>r.length && r.some(x=>x!==''));
  if (rows.length<=1) return [];

  const headers = rows[0];
  const m = headerIndexMap(headers); // ← 既定の自動マッピング（住所/氏名/備考 など）

  // === ここで URL パラメータで列割当を上書きできます ===
  // 例: ?labelAddr=所在地&labelName=宛名&labelNote=時間帯
  (function overrideByParam(){
    const params = new URLSearchParams(location.search);
    const norm = s => String(s||'').toLowerCase().replace(/\s/g,'');
    const find = name => headers.findIndex(h => norm(h) === norm(name));
    const a = params.get('labelAddr');
    const n = params.get('labelName');
    const t = params.get('labelNote');
    if (a && find(a) >= 0) m.address = find(a);
    if (n && find(n) >= 0) m.name    = find(n);
    if (t && find(t) >= 0) m.note    = find(t);
  })();

  const idx=(k,f)=> (m[k] != null ? m[k] : f);

  const out=[];
  for (let i=1;i<rows.length;i++){
    const r=rows[i];
    const ordRaw = (m.order!=null ? r[m.order] : (m.id!=null ? r[m.id] : ''));
    const ordNum = Number.parseFloat(String(ordRaw).replace(/[^\d.\-]/g,''));
    out.push({
      id   : (m.id!=null ? r[m.id] : String(i)),
      name : r[idx('name', 0)] || '',
      address: r[idx('address', 1)] || '',
      note : (m.note!=null ? r[m.note] : ''),
      // parseCoord を入れていない場合でも安全にフォールバック
      lat  : (m.lat!=null ? (typeof parseCoord==='function' ? parseCoord(r[m.lat],'lat') : parseFloat(r[m.lat])) : NaN),
      lng  : (m.lng!=null ? (typeof parseCoord==='function' ? parseCoord(r[m.lng],'lng') : parseFloat(r[m.lng])) : NaN),
      _seq : Number.isFinite(ordNum) ? ordNum : null,
      _routeIndex: Infinity, _visited:false,
    });
  }
  return out;
}


/* ===== メイン ===== */
export async function initDestLabel(routePoints, getClosestIndex){
  if(document.readyState==='loading'){
    await new Promise(res=>document.addEventListener('DOMContentLoaded',res,{once:true}));
  }
　const AUTO_ADVANCE = readBoolParam('autoAdvance', false); // ★テスト中はOFF（?autoAdvance=1で再有効化）
  const points = await loadPoints().catch(e=>{ console.warn('[DeliNavi] points.csv load error',e); return []; });
  if(!points.length){ console.warn('[DeliNavi] points.csv empty; dest label disabled'); return; }
  
  // 並び順は「CSVの行順」だけに固定（単純化）
  points.forEach((p,i)=> p._routeIndex = i);

  const card = createCard();
  let lastHereIdx=0, cursorIdx=0;

  function showByIndex(i){
  if (i < 0) i = 0;
  if (i >= points.length) i = points.length - 1;

  const prevIdx = (typeof cursorIdx === 'number') ? cursorIdx : -1; // 現在のところ（直前表示）
  cursorIdx = i;                                                    // 次のところ（新表示）

  // ラベル表示を更新
  updateCard(card, points[cursorIdx]);

  // === マーカー表示（現在＋次）＆ HUD 連動 ===
  const pCurr = (prevIdx >= 0) ? points[prevIdx] : null;
  const pNext = points[cursorIdx];

  // 1) マーカー：pair 指定できるならそれを優先
  if (pCurr && Number.isFinite(pCurr.lat) && Number.isFinite(pCurr.lng)
      && Number.isFinite(pNext.lat) && Number.isFinite(pNext.lng)
      && typeof window.DN_focusPairByLatLng === 'function'){
    window.DN_focusPairByLatLng(pCurr.lat, pCurr.lng, pNext.lat, pNext.lng);
  } else if (typeof window.DN_focusPair === 'function' && prevIdx >= 0){
    window.DN_focusPair(prevIdx, cursorIdx);
  } else if (Number.isFinite(pNext.lat) && Number.isFinite(pNext.lng)
             && typeof window.DN_focusDestByLatLng === 'function'){
    // フォールバック：次だけ
    window.DN_focusDestByLatLng(pNext.lat, pNext.lng);
  } else if (typeof window.DN_focusDest === 'function'){
    window.DN_focusDest(cursorIdx);
  }

  // 2) HUD は従来通り“次の目的地”に合わせる
  if (Number.isFinite(pNext.lat) && Number.isFinite(pNext.lng)
      && typeof window.DN_focusDestByLatLng === 'function'){
    window.DN_focusDestByLatLng(pNext.lat, pNext.lng);
  }
}

  function findNextIndexFromHere(){
   // 現在表示している行（cursorIdx）より後で、未訪問の最初を返す
   for (let i = cursorIdx + 1; i < points.length; i++){
     if (!points[i]._visited) return i;
   }
   // 見つからない場合は先頭からも探す
   for (let i = 0; i < points.length; i++){
     if (!points[i]._visited) return i;
   }
   return -1;
 }

  // “次へ”ボタン用
  window.DN_destLabelNext = function(){
    if(!points.length) return null;
    points[cursorIdx]._visited = true;
    let nxt = findNextIndexFromHere();
    if(nxt!==-1) showByIndex(nxt);
    return points[cursorIdx];
  };

  // 初期表示
  showByIndex(0);

  // GPSチェイン
  const prev = window.__DN_onGpsUpdate;
  let firstFixDone = false;

  window.__DN_onGpsUpdate = function(pos){
    try{
      // CSV順モードでは、GPSでラベルを切り替えない（順番は手動のみ）
     const CSV_MODE = true; // ← “常にCSV順” にするフラグ（パラメータ化不要なら true 固定でOK）
     if (CSV_MODE) {
       // 何もしない（HUDや他機能へのGPS連携は下の prev(pos) に任せる）
       if (typeof prev === 'function') prev(pos);
       return;
     }
      const hereIdx = getClosestIndex(pos);
      lastHereIdx = hereIdx;

      // 初回: 現在地より前を既訪問
      if(!firstFixDone){
        points.forEach(p=>{ if(Number.isFinite(p._routeIndex) && p._routeIndex<hereIdx) p._visited=true; });
        firstFixDone=true;
        const i0=findNextIndexFromHere(hereIdx); if(i0!==-1) showByIndex(i0);
      }

      // 到着で自動前進
      let nextIdx = findNextIndexFromHere(hereIdx);
      if(nextIdx!==-1){
        const next=points[nextIdx];
        const curPos={lat:pos.lat??pos.coords?.latitude, lng:pos.lng??pos.coords?.longitude};
        if(Number.isFinite(next.lat)&&Number.isFinite(next.lng)){
          const d=haversine(curPos,{lat:next.lat,lng:next.lng});
          if (d <= AssistFlags.ARRIVE_RADIUS_M){
   if (AUTO_ADVANCE){
     points[nextIdx]._visited = true;
     const nxt = findNextIndexFromHere(hereIdx);
     if (nxt !== -1) showByIndex(nxt);
   } else {
     // 到着しても自動では進めず、表示だけ維持（手動「次へ」で進める）
     showByIndex(nextIdx);
   }
 } else {
   showByIndex(nextIdx);
 }
        }else{          
          if (AUTO_ADVANCE && hereIdx >= next._routeIndex){ points[nextIdx]._visited = true; }
          const nxt2=findNextIndexFromHere(hereIdx); if(nxt2!==-1) showByIndex(nxt2);
        }
      }
    }catch(e){ console.warn('[DeliNavi] dest label update error', e); }
    if (typeof prev==='function') prev(pos);
  };

  console.log('[DeliNavi] DestLabel initialized');
}


  






















