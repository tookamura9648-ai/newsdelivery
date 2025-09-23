export const AssistFlags = {
  VOICE_ENABLED: readBool('voice', true),
  VIBE_ENABLED: readBool('vibe', true),
  LANG: readStr('lang', 'ja-JP'),
  RATE: readNum('rate', 1.0),
  PITCH: readNum('pitch', 1.0),
  VOL: readNum('vol', 1.0),
  ARRIVE_RADIUS_M: readNum('arrive', 25),
  OFF_ROUTE_WARN_M: readNum('offWarn', 40),
  OFF_ROUTE_INTERVAL_S: readNum('offInt', 20),
  NEXT_TURN_LOOKAHEAD_M: readNum('turnAhead', 60),
};
function readStr(k, def){ const q=new URLSearchParams(location.search); return q.get(k) ?? localStorage.getItem(k) ?? def; }
function readBool(k, def){ const q=new URLSearchParams(location.search); const v=q.get(k) ?? localStorage.getItem(k); return v===null?def:(v==='1'||v==='true'); }
function readNum(k, def){ const q=new URLSearchParams(location.search); const v=q.get(k) ?? localStorage.getItem(k); return v?Number(v):def; }
export function setAssistFlag(k, v){ localStorage.setItem(k, v); }
