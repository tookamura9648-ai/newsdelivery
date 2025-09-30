// 次の目的地ラベル（CSV→表示）＋ドラッグ＆四隅スナップ
// 追加: GPS初回で“現在地より前”を既訪問、手動NEXT、マーカー/HUD連動
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
    name:['name','氏名','お名前','利用者名'],
    address:['address','住所','所在地'],
    note:['note','備考','メモ','時間帯','区分'],
    lat:['lat','latitude','緯度'],
    lng:['lng','long','longitude','経度','経緯度'],
    id:      ['id','番号','no'],
    order:   ['order','順路','順番','配達順','seq','route']
  };
  for (const k in al){
    const hit=headers.findIndex(h=>norm(h)===norm(al[k][0]) || al[k].some(a=>norm(h)===norm(a)));
    if (hit>=0) map[k]=hit;
  }
  return map;
}

/* ===== UI ===== */
function readParam(name){ return new URLSearchParams(location.search).get(name); }

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
async function loadPoints(){
  const res=await fetch('./assets/data/points.csv',{cache:'no-store'});
  if(!res.ok) throw new Error('points.csv not found');
  const rows=parseCSV(await res.text()).filter(r=>r.length && r.some(x=>x!==''));
  if(rows.length<=1) return [];
  const headers=rows[0], m=headerIndexMap(headers);
  const idx=(k,f)=> (m[k]!=null?m[k]:f);
  const out=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i];
    const ordRaw = (m.order!=null ? r[m.order] : (m.id!=null ? r[m.id] : ''));
    const ordNum = Number.parseFloat(String(ordRaw).replace(/[^\d.\-]/g,'')); // 数値だけ抽出
    out.push({
      id: m.id!=null ? r[m.id] : String(i),
      name: r[idx('name',0)]||'',
      address: r[idx('address',1)]||'',
      note: m.note!=null ? r[m.note] : '',
      lat: m.lat!=null ? parseFloat(r[m.lat]) : NaN,
      lng: m.lng!=null ? parseFloat(r[m.lng]) : NaN,
      _seq: Number.isFinite(ordNum) ? ordNum : null,  // ← 追加：並び順の元
      _routeIndex: Infinity,
      _visited: false
    });
  }
  return out;
}

/* ===== メイン ===== */
export async function initDestLabel(routePoints, getClosestIndex){
  if(document.readyState==='loading'){
    await new Promise(res=>document.addEventListener('DOMContentLoaded',res,{once:true}));
  }

  const points = await loadPoints().catch(e=>{ console.warn('[DeliNavi] points.csv load error',e); return []; });
  if(!points.length){ console.warn('[DeliNavi] points.csv empty; dest label disabled'); return; }

  // ルート順
  // 並び順の決定：①order/id → ②ルート近傍 → ③CSVの並び
  const hasExplicitOrder = points.every(p => p._seq != null);
  if (hasExplicitOrder) {
    // ① CSVの order（なければ id 数値）でソート
    points.sort((a,b)=> (a._seq - b._seq));
    points.forEach((p,i)=> p._routeIndex = i);
  } else {
    // ② 位置情報があるならルート沿いの順序で
    const hasGeo = points.some(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (hasGeo){
      for (const p of points){
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)){
          p._routeIndex = getClosestIndex({lat:p.lat, lng:p.lng});
        }
      }
      points.sort((a,b)=> a._routeIndex - b._routeIndex);
    } else {
      // ③ 位置が無ければCSVの行順のまま
      points.forEach((p,i)=> p._routeIndex = i);
    }
  const card = createCard();
  let lastHereIdx=0, cursorIdx=0, firstFixDone=false;

  function showByIndex(i){
    if(i<0) i=0; if(i>=points.length) i=points.length-1;
    cursorIdx=i; updateCard(card, points[cursorIdx]);
    // マーカー/HUD連動
    const p=points[cursorIdx];
    if(Number.isFinite(p.lat)&&Number.isFinite(p.lng)){
      if (typeof window.DN_focusDestByLatLng==='function') window.DN_focusDestByLatLng(p.lat,p.lng);
      else if (typeof window.DN_focusDest==='function') window.DN_focusDest(cursorIdx);
    } else if (typeof window.DN_focusDest==='function') {
      window.DN_focusDest(cursorIdx);
    }
  }
  function findNextIndexFromHere(hereIdx){
    const a=points.findIndex(p=>!p._visited && p._routeIndex>=hereIdx);
    if(a!==-1) return a;
    const b=points.findIndex(p=>!p._visited);
    return b!==-1 ? b : -1;
  }

  // “次へ”ボタン連動
  window.DN_destLabelNext = function(){
    if(!points.length) return null;
    points[cursorIdx]._visited = true;
    let nxt = findNextIndexFromHere(lastHereIdx);
    if(nxt===-1) nxt = findNextIndexFromHere(-1);
    if(nxt!==-1) showByIndex(nxt);
    return points[cursorIdx];
  };

  // 初期表示
  showByIndex(0);

  // GPSチェイン
  const prev = window.__DN_onGpsUpdate;
  window.__DN_onGpsUpdate = function(pos){
    try{
      const hereIdx = getClosestIndex(pos);
      lastHereIdx = hereIdx;

      // 初回：現在地より前を既訪問
      if(!firstFixDone){
        points.forEach(p=>{ if(Number.isFinite(p._routeIndex) && p._routeIndex<hereIdx) p._visited=true; });
        firstFixDone=true;
        const i0=findNextIndexFromHere(hereIdx); if(i0!==-1) showByIndex(i0);
      }

      // 到着で自動進行
      let nextIdx = findNextIndexFromHere(hereIdx);
      if(nextIdx!==-1){
        const next=points[nextIdx];
        const curPos={lat:pos.lat??pos.coords.latitude, lng:pos.lng??pos.coords.longitude};
        if(Number.isFinite(next.lat)&&Number.isFinite(next.lng)){
          const d=haversine(curPos,{lat:next.lat,lng:next.lng});
          if(d<=AssistFlags.ARRIVE_RADIUS_M){
            points[nextIdx]._visited=true;
            const nxt=findNextIndexFromHere(hereIdx);
            if(nxt!==-1) showByIndex(nxt);
          }else{
            showByIndex(nextIdx);
          }
        }else{
          if(hereIdx>=next._routeIndex) points[nextIdx]._visited=true;
          const nxt2=findNextIndexFromHere(hereIdx); if(nxt2!==-1) showByIndex(nxt2);
        }
      }
    }catch(e){ console.warn('[DeliNavi] dest label update error', e); }
    if (typeof prev==='function') prev(pos);
  };

  console.log('[DeliNavi] DestLabel initialized');
}











