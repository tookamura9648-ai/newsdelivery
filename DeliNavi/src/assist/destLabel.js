// 次の目的地ラベル（CSV → 表示）＋ドラッグ移動＆四隅スナップ
// 追加: ①GPS初回Fix時に“現在地より前”を既訪問扱い ②手動「次へ」API(window.DN_destLabelNext)
import { AssistFlags } from './assistFlags.js';
import { haversine } from './geometry.js';
import './focusMarkers.js'; // ← 追加（window.* API を定義）

function parseCSV(text){
  const rows=[]; let i=0, cur='', inQ=false, row=[];
  while(i<text.length){
    const c=text[i];
    if(inQ){ if(c==='\"'){ if(text[i+1]==='\"'){cur+='\"'; i++;} else inQ=false; } else cur+=c; }
    else{ if(c==='\"') inQ=true; else if(c===','){ row.push(cur); cur=''; }
      else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(cur); rows.push(row); row=[]; cur=''; }
      else cur+=c; }
    i++;
  }
  row.push(cur); rows.push(row);
  if (rows[0]?.[0] && rows[0][0].charCodeAt(0)===0xFEFF) rows[0][0]=rows[0][0].slice(1);
  return rows;
}
function headerIndexMap(headers){
  const norm=s=>s.toLowerCase().replace(/\s/g,'');
  const idx={};
  const aliases={
    name:['name','氏名','お名前','利用者名'],
    address:['address','住所','所在地'],
    note:['note','備考','メモ','時間帯','区分'],
    lat:['lat','latitude','緯度'],
    lng:['lng','long','longitude','経度','経緯度'],
    id:['id','番号','no']
  };
  for (const k of Object.keys(aliases)){
    for (const a of aliases[k]){
      const j=headers.findIndex(h=>norm(h)===norm(a));
      if (j>=0){ idx[k]=j; break; }
    }
  }
  return idx;
}
function readParam(name){ return new URLSearchParams(location.search).get(name); }

function applyDock(card, dock){
  card.dataset.dock = dock;
  card.style.left = card.style.right = card.style.top = card.style.bottom = '';
  const pad = 12;
  if (dock==='tl'){ card.style.left = pad+'px';  card.style.top = pad+'px'; }
  if (dock==='tr'){ card.style.right= pad+'px';  card.style.top = pad+'px'; }
  if (dock==='bl'){ card.style.left = pad+'px';  card.style.bottom = pad+'px'; }
  if (dock==='br'){ card.style.right= pad+'px';  card.style.bottom = pad+'px'; }
  if (dock==='free'){
    const x = Number(localStorage.getItem('dnDestX')||'24');
    const y = Number(localStorage.getItem('dnDestY')||'24');
    card.style.left = Math.max(0, x)+'px';
    card.style.top  = Math.max(0, y)+'px';
  }
  localStorage.setItem('dnDestDock', dock);
}
function createCard(){
  const wrap = document.createElement('div');
  wrap.id='dn-dest-card';
  wrap.style.cssText = `
    position:fixed; z-index:9500; background:#fff; color:#111;
    border:2px solid #0b2f3a; border-radius:10px;
    padding:10px 14px; min-width:240px; max-width:72vw;
    box-shadow:0 8px 24px rgba(0,0,0,.15);
    font-family:system-ui,-apple-system,Segoe UI,Roboto;
  `;
  wrap.innerHTML = `
    <div id="dn-dest-grip" style="position:absolute; right:6px; top:6px; width:22px; height:22px;
      border-radius:6px; background:#eef2f4; display:flex; align-items:center; justify-content:center;
      font-size:13px; cursor:move; user-select:none; touch-action:none; line-height:1">↕</div>
    <button id="dn-dest-snap" title="位置を角にスナップ" style="position:absolute; right:34px; top:6px; width:22px; height:22px;
      border-radius:6px; border:1px solid #cfd8dc; background:#f7fbfd; cursor:pointer">◧</button>
    <div id="dn-dest-address" style="font-size:14px; line-height:1.25; margin-bottom:6px; word-break:break-word;"></div>
    <div id="dn-dest-name" style="font-size:28px; line-height:1.15; letter-spacing:.15em; font-weight:600; margin:2px 0 6px;"></div>
    <div id="dn-dest-note" style="font-size:14px; opacity:.85;"></div>
  `;
  document.body.appendChild(wrap);

  const initDock = readParam('destPos') || localStorage.getItem('dnDestDock') || 'tr';
  applyDock(wrap, initDock);

  // ドラッグ
  const grip = wrap.querySelector('#dn-dest-grip');
  grip.addEventListener('pointerdown', (ev)=>{
    ev.preventDefault(); grip.setPointerCapture(ev.pointerId);
    const rect = wrap.getBoundingClientRect();
    const startX = ev.clientX, startY = ev.clientY;
    const offX = startX - rect.left, offY = startY - rect.top;
    applyDock(wrap, 'free');
    const onMove = (e)=>{
      const x = Math.min(innerWidth - rect.width, Math.max(0, e.clientX - offX));
      const y = Math.min(innerHeight - rect.height, Math.max(0, e.clientY - offY));
      wrap.style.left = x+'px'; wrap.style.top = y+'px';
      localStorage.setItem('dnDestX', String(x));
      localStorage.setItem('dnDestY', String(y));
    };
    const onUp = ()=>{ grip.releasePointerCapture(ev.pointerId); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // 四隅スナップ
  const order = ['tl','tr','br','bl'];
  wrap.querySelector('#dn-dest-snap').addEventListener('click', ()=>{
    const cur = wrap.dataset.dock || 'tr';
    const i = order.indexOf(cur); const next = order[(i+1)%order.length];
    applyDock(wrap, next);
  });

  return wrap;
}
function updateCard(card, rec){
  card.querySelector('#dn-dest-address').textContent = rec.address || '';
  card.querySelector('#dn-dest-name').textContent    = rec.name || '';
  card.querySelector('#dn-dest-note').textContent    = rec.note || '';
}

async function loadPoints(){
  const res = await fetch('./assets/data/points.csv', { cache:'no-store' });
  if (!res.ok) throw new Error('points.csv not found');
  const text = await res.text();
  const rows = parseCSV(text).filter(r=>r.length && r.some(x=>x!==''));
  if (rows.length<=1) return [];
  const headers = rows[0], m = headerIndexMap(headers);
  const defIdx=(k,f)=> (m[k] ?? f);
  const out=[];
  for (let i=1;i<rows.length;i++){
    const r=rows[i];
    out.push({
      id   : m.id!=null   ? r[m.id]   : String(i),
      name : r[defIdx('name', 0)] ?? '',
      address: r[defIdx('address', 1)] ?? '',
      note : m.note!=null ? r[m.note] : '',
      lat  : m.lat!=null  ? parseFloat(r[m.lat]) : NaN,
      lng  : m.lng!=null  ? parseFloat(r[m.lng]) : NaN,
      _routeIndex: Infinity, _visited:false,
    });
  }
  return out;
}

export async function initDestLabel(routePoints, getClosestIndex){
  if (document.readyState==='loading'){
    await new Promise(r=>document.addEventListener('DOMContentLoaded', r, { once:true }));
  }
  const points = await loadPoints().catch(e=>{ console.warn('[DeliNavi] points.csv load error', e); return []; });
  if (!points.length){ console.warn('[DeliNavi] points.csv empty; dest label disabled'); return; }

  // ルート順割当
  const hasGeo = points.some(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
  if (hasGeo){
    for (const p of points){
      if (Number.isFinite(p.lat)&&Number.isFinite(p.lng)){
        p._routeIndex = getClosestIndex({lat:p.lat, lng:p.lng});
      }
    }
    points.sort((a,b)=>a._routeIndex-b._routeIndex);
  } else {
    points.forEach((p,i)=> p._routeIndex=i);
  }

  const card = createCard();
  let lastHereIdx = 0;
  let cursorIdx = 0; // 直近に表示した points の index

  const pickNext = (hereIdx)=>{
    // まだ訪問していない中で hereIdx 以降の最初 → 無ければ最初の未訪問 → 最後
    return points.findIndex(p=>!p._visited && p._routeIndex>=hereIdx)
        ?? points.findIndex(p=>!p._visited);
  };
  const showByIndex = (i)=>{
  if (i<0) i = points.length-1;
  if (i>=points.length) i = points.length-1;
  cursorIdx = i;
  updateCard(card, points[cursorIdx]);

- window.DN_focusDest && window.DN_focusDest(cursorIdx);
+ const p = points[cursorIdx];
+ if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
+   window.DN_focusDestByLatLng
+     ? window.DN_focusDestByLatLng(p.lat, p.lng)   // 近いマーカーを自動特定
+     : (window.DN_focusDest && window.DN_focusDest(cursorIdx));
+ }
};


  // ★“次へ” API（既存の次へボタンから呼んでください）
  window.DN_destLabelNext = function(){
    // 現在表示中を訪問済みにして、次候補を表示
    points[cursorIdx]._visited = true;
    const nxt = points.findIndex(p=>!p._visited && p._routeIndex>=lastHereIdx);
    const fallback = points.findIndex(p=>!p._visited);
    showByIndex(nxt>=0 ? nxt : (fallback>=0 ? fallback : points.length-1));
  };

  // 前回版の変数名と同じ作用域に置くこと（cursorIdx, points, showByIndex を利用）
window.DN_destLabelPrev = function(){
  // 1つ前を表示（既訪問フラグは戻さず表示だけ）
  const i = Math.max(0, cursorIdx - 1);
  showByIndex(i);
};

  // 初期表示
  showByIndex(0);

  // GPSチェイン
  const prev = window.__DN_onGpsUpdate;
  let firstFixDone = false;
  window.__DN_onGpsUpdate = (pos)=>{
    try{
      const hereIdx = getClosestIndex(pos);
      lastHereIdx = hereIdx;

      // ★GPS初回Fix：現在地より前のポイントは既訪問にしてスキップ
      if (!firstFixDone){
        for (const p of points){
          if (Number.isFinite(p._routeIndex) && p._routeIndex < hereIdx) p._visited = true;
        }
        firstFixDone = true;
        const i0 = pickNext(hereIdx);
        if (i0 !== -1) showByIndex(i0);
      }

      // 到着判定で自動進行
      let nextIdx = points.findIndex(p=>!p._visited && p._routeIndex>=hereIdx);
      if (nextIdx === -1) nextIdx = points.findIndex(p=>!p._visited);
      if (nextIdx !== -1){
        const next = points[nextIdx];
        if (Number.isFinite(next.lat)&&Number.isFinite(next.lng)){
          const d = haversine(pos, {lat:next.lat, lng:next.lng});
          if (d<=AssistFlags.ARRIVE_RADIUS_M){
            points[nextIdx]._visited = true;
            // 次の候補を即表示
            let nxt = points.findIndex(p=>!p._visited && p._routeIndex>=hereIdx);
            if (nxt === -1) nxt = points.findIndex(p=>!p._visited);
            if (nxt !== -1) showByIndex(nxt);
          } else {
            // まだ到着していないなら現在の next を表示
            showByIndex(nextIdx);
          }
        } else {
          // 緯度経度なし：インデックスで前進
          if (hereIdx >= next._routeIndex){ points[nextIdx]._visited = true; }
          let nxt = points.findIndex(p=>!p._visited && p._routeIndex>=hereIdx);
          if (nxt === -1) nxt = points.findIndex(p=>!p._visited);
          if (nxt !== -1) showByIndex(nxt);
        }
      }
    }catch(e){ console.warn('[DeliNavi] dest label update error', e); }

    if (typeof prev==='function') prev(pos);
  };

  console.log('[DeliNavi] DestLabel initialized (drag/snap + GPS初期スキップ + 手動NEXT)');
}





