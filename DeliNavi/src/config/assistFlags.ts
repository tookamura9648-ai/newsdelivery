// =============================
// src/config/assistFlags.ts
// =============================
export const AssistFlags = {
VOICE_ENABLED: readBool('voice', true),
VIBE_ENABLED: readBool('vibe', true),
LANG: readStr('lang', 'ja-JP'),
RATE: readNum('rate', 1.0),
PITCH: readNum('pitch', 1.0),
VOL: readNum('vol', 1.0),
ARRIVE_RADIUS_M: readNum('arrive', 25), // 到着判定半径
OFF_ROUTE_WARN_M: readNum('offWarn', 40),
OFF_ROUTE_INTERVAL_S: readNum('offInt', 20), // 何秒おきに警告を再アナウンスするか
NEXT_TURN_LOOKAHEAD_M: readNum('turnAhead', 60), // 何m手前で曲がり案内するか
};


function readStr(k: string, def: string) {
const q = new URLSearchParams(location.search);
return q.get(k) ?? localStorage.getItem(k) ?? def;
}
function readBool(k: string, def: boolean) {
const q = new URLSearchParams(location.search);
const v = q.get(k) ?? localStorage.getItem(k);
return v === null ? def : v === '1' || v === 'true';
}
function readNum(k: string, def: number) {
const q = new URLSearchParams(location.search);
const v = q.get(k) ?? localStorage.getItem(k);
return v ? Number(v) : def;
}
export function setAssistFlag(k: string, v: string) {
localStorage.setItem(k, v);
}