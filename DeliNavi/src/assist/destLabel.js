// 次の目的地ラベル（CSV → 画面表示）
// 期待CSV: assets/data/points.csv
// 推奨ヘッダ: id,name,address,note,lat,lng
// 日本語エイリアス対応: 氏名/住所/備考/緯度/経度 など

import { AssistFlags } from './assistFlags.js';
import { haversine } from './geometry.js';

function parseCSV(text){
  const rows=[]; let i=0, cur='', inQ=false, row=[];
  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c==='\"'){ if(text[i+1]==='\"'){cur+='\"'; i++;} else {inQ=false;} }
      else cur+=c;
    }else{
      if(c==='\"'){ inQ=true; }
      else if(c===','){ row.push(cur); cur=''; }
      else if(c==='\n' || c==='\r'){
        if(c==='\r' && text[i+1]==='\n') i++;
        row.push(cur); rows.push(row); row=[]; cur='';
      }else cur+=c;
    }
    i++;
  }
  row.push(cur); rows.push(row);
  // BOM除去
  if (rows[0] && rows[0][0] && rows[0][0].charCodeAt(0)===0xFEFF) {
    rows[0][0] = rows[0][0].slice(1);
  }
  return rows;
}
function headerIndexMap(headers){
  const norm = s=>s.toLowerCase().replace(/\s/g,'');
  const idx={};
  const aliases = {
    name:['name','氏名','お名前','利用者名'],
    address:['address','住所','所在地'],
    note:['note','備考','メモ','時間帯','区分'],
    lat:['lat','latitude','緯度'],
    lng:['lng','long','longitude','経度','経緯度'],
    id:['id','番号','no']
  };
  for(const key of Object.keys(aliases)){
    for(const a of aliases[key]){
      const j = headers.findIndex(h=>norm(h)===norm(a));
      if(j>=0){ idx[key]=j; break; }
    }
  }
  return idx;
}

function createCard(){
  const wrap = document.createElement('div');
  wrap.id='dn-dest-card';
  wrap.style.cssText = `
    position:fixed; left:12px; top:12px; z-index:9999;
    background:#fff; color:#111; border:2px solid #0b2f3a; border-radius:10px;
    padding:10px 14px; min-width:240px; max-width:72vw;
    box-shadow:0 8px 24px rgba(0,0,0,.15); font-family:system-ui,-apple-system,Segoe UI,Roboto;
  `;
  wrap.innerHTML = `
    <div id="dn-dest-address" style="font-size:14px; line-height:1.25; margin-bottom:6px; word-break:break-word;"></div>
    <div id="dn-dest-name" style="font-size:28px; line-height:1.15; letter-spacing:.15em; font-weight:600; margin:2px 0 6px;"></div>
    <div id="dn-dest-note" style="font-size:14px; opacity:.85;"></div>
  `;
  document.body.appendChild(wrap);
  return wrap;
}
function updateCard(card, rec){
  const addr = card.querySelector('#dn-dest-address');
  const name = card.querySelector('#dn-dest-name');
  const note = card.querySelector('#dn-dest-note');
  addr.textContent   = rec.address || '';
  name.textContent   = rec.name || '';
  note.textContent   = rec.note || '';
}

async function loadPoints(){
  const res = await fetch('./assets/data/points.csv', { cache:'no-store' });
  if (!res.ok) throw new Error('points.csv not found');
  const text = await res.text();
  const rows = parseCSV(text).filter(r=>r.length && r.some(x=>x!==''));
  if (rows.length<=1) return [];
  const headers = rows[0];
  const m = headerIndexMap(headers);
  // 残った列は控えめに自動推定（最低でも name/address は拾う）
  const defIdx = (name, fallback) => (m[name] ?? fallback);

  const out=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i];
    const rec = {
      id   : m.id!=null   ? r[m.id]   : String(i),
      name : r[defIdx('name', 0)] ?? '',
      address: r[defIdx('address', 1)] ?? '',
      note : m.note!=null ? r[m.note] : '',
      lat  : m.lat!=null  ? parseFloat(r[m.lat]) : NaN,
      lng  : m.lng!=null  ? parseFloat(r[m.lng]) : NaN,
      _routeIndex: Infinity,
      _visited: false,
    };
    out.push(rec);
  }
  return out;
}

export async function initDestLabel(routePoints, getClosestIndex){
  // DOM 準備後に実行
  if (document.readyState === 'loading'){
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once:true }));
  }

  const points = await loadPoints().catch(e=>{ console.warn('[DeliNavi] points.csv load error', e); return []; });
  if (!points.length){
    console.warn('[DeliNavi] points.csv is empty or missing; dest label disabled');
    return;
  }

  // ルート上の近傍indexを各ポイントに割り当て（lat/lngがあれば）
  const hasGeo = points.some(p=>Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (hasGeo){
    for (const p of points){
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)){
        p._routeIndex = getClosestIndex({lat:p.lat, lng:p.lng});
      }
    }
    points.sort((a,b)=>(a._routeIndex)-(b._routeIndex)); // 進行順に並び替え
  } else {
    // 位置が無い場合はCSVの並び順をそのまま採用
    points.forEach((p,i)=> p._routeIndex = i);
  }

  const card = createCard();
  // 直近候補を先に表示（初回は1件目）
  updateCard(card, points[0]);

  // GPS連携：既存ハンドラに「合流」する（チェイン）
  const prev = window.__DN_onGpsUpdate;
  window.__DN_onGpsUpdate = (pos)=>{
    try {
      const hereIdx = getClosestIndex(pos);
      // まだ訪問していないポイントのうち「現在地以降」にある最初のもの
      let next = points.find(p => !p._visited && p._routeIndex >= hereIdx) || points.find(p=>!p._visited) || points[points.length-1];

      // 到着判定：位置がある行だけ距離で判定（ない行はルートindexで近似）
      if (Number.isFinite(next.lat) && Number.isFinite(next.lng)){
        const d = haversine(pos, {lat:next.lat, lng:next.lng});
        if (d <= AssistFlags.ARRIVE_RADIUS_M){
          next._visited = true;
          // 次の候補に進めてすぐ表示差し替え
          next = points.find(p => !p._visited && p._routeIndex >= hereIdx) || points.find(p=>!p._visited) || next;
        }
      } else {
        // 緯度経度がない場合：現在のルートIndexを超えたら訪問扱い
        if (hereIdx >= next._routeIndex) next._visited = true;
      }

      updateCard(card, next);
    } catch(e){ console.warn('[DeliNavi] dest label update error', e); }

    // 既存へ引き継ぎ
    if (typeof prev === 'function') prev(pos);
  };

  console.log('[DeliNavi] DestLabel initialized');
}
