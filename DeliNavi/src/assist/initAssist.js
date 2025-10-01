// --- GPSドット＋矢印（常時表示）を自動セットアップ ---
(function(){
  function withMap(cb){
    if (window.__DN_map) return cb(window.__DN_map);
    const t = setInterval(()=>{ if (window.__DN_map){ clearInterval(t); cb(window.__DN_map); } }, 200);
  }

  withMap(map=>{
    // ドット
    const gpsDot = L.circleMarker([0,0], {
      radius: 6, color:'#00bcd4', fillColor:'#00bcd4', fillOpacity:0.9,
      className:'dn-gps'
    }).addTo(map);

    // 簡易矢印（三角）
    const gpsHeading = L.polygon([[0,0],[0,0],[0,0]], {
      color:'#00bcd4', weight:0, fillOpacity:0.18, className:'dn-gps'
    }).addTo(map);

    // 常時表示に登録（focusMarkers.js が面倒見ます）
    window.DN_registerGpsLayer && window.DN_registerGpsLayer(gpsDot);
    window.DN_registerGpsLayer && window.DN_registerGpsLayer(gpsHeading);

    // 位置更新に相乗り
    const __prev = window.__DN_onGpsUpdate;
    window.__DN_onGpsUpdate = pos=>{
      const lat = pos.lat ?? pos.coords?.latitude;
      const lng = pos.lng ?? pos.coords?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        gpsDot.setLatLng([lat,lng]);

        // 方位が取れたら小さな矢印を向ける
        const hdg = (pos.coords && typeof pos.coords.heading === 'number') ? pos.coords.heading : null;
        if (hdg != null) {
          const ahead = destPoint(lat,lng, hdg,   20);
          const left  = destPoint(lat,lng, hdg-25,12);
          const right = destPoint(lat,lng, hdg+25,12);
          gpsHeading.setLatLngs([[left.lat,left.lng],[ahead.lat,ahead.lng],[right.lat,right.lng]]);
        } else {
          gpsHeading.setLatLngs([[lat,lng],[lat,lng],[lat,lng]]);
        }
      }
      if (typeof __prev === 'function') __prev(pos);
    };

    // ヘルパー：現在地から距離(m)・方位(deg)の点
    function destPoint(lat,lng,bearingDeg,distM){
      const R=6371000, toRad=x=>x*Math.PI/180, toDeg=r=>r*180/Math.PI;
      const br=toRad(bearingDeg), lat1=toRad(lat), lng1=toRad(lng), d=distM/R;
      const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
      const lng2=lng1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
      return {lat:toDeg(lat2), lng:toDeg(lng2)};
    }
  });
})();












