// 次の目的地ラベル（CSV → 表示）＋ ドラッグ移動＆四隅スナップ
// 追加機能: GPS初回で“現在地より前”を既訪問扱い、手動NEXT、フォーカス連動
import { AssistFlags } from './assistFlags.js';
import { haversine } from './geometry.js';

/* ---------- CSV 解析 ---------- */
function parseCSV(text){
  const rows=[]; let i=0, cur='', inQ=false, row=[];
  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c==='\"'){ if(text[i+1]==='\"'){cur+='\"'; i++;} else { inQ=false; } }
      else { cur+=c; }
    }else{
      if(c==='\"'){ inQ=true; }
      else if(c===','){ row.push(cur); cur=''; }
      else if(c==='\n' || c==='\r'){
        if(c==='\r' && text[i+1]==='\n') i++;
        row.push(cur); rows.push(row); row=[]; cur='';
      }else{
        cur+=c;
      }
    }
    i++;
  }
  row.push(cur); rows.push(row);
  if (rows[0] && rows[0][0] && rows[0][0].charCodeAt(0)===0xFEFF) rows[0][0]=rows[0][0].slice(1);
  return rows;
}
function headerIndexMap(headers){
  const norm = s => String(s||'').toLowerCase().replace(/\s/g,'');
  const idx = {};
  const aliases = {
    name:    ['name','氏名','お名前','利用者名'],
    address: ['address','住所','所在地'],
    note:    ['note','備考','メモ','時間帯','区分'],
    lat:     ['lat','latitude','緯度'],
    lng:     ['lng','long','longitude','経度','経緯度'],
    id:      ['id','番号','no']
  };
  for (var k in aliases){
    var arr = aliases[k];
    for (var a=0; a<arr.length; a++){
      var j = headers.findIndex(h => norm(h) === norm(arr[a]));
      if (j >= 0){ idx[k] = j; break; }
    }
  }
  return idx;
}
function readParam(name){ return new URLSearchParams(location.search).get(name); }

/* ---------- 位置・レイアウト ---------- */
function applyDock(card, dock){
  card.dataset.dock = dock;
  card.style.left = card.style.right = card.style.top = card.style.bottom = '';
  var pad = 12;
  if (dock==='tl'){ card.style.left = pad+'px';  card.style.top = pad+'px'; }
  if (dock==='tr'){ card.style.right= pad+'px';  card.style.top = pad+'px'; }
  if (dock==='bl'){ card.style.left = pad+'px';  card.style.bottom = pad+'px'; }
  if (dock==='br'){ card.style.right= pad+'px';  card.style.bottom = pad+'px'; }
  if (dock==='free'){
    var x = Number(localStorage.getItem('dnDestX')||'24');
    var y =







