import { AssistFlags } from './assistFlags.js';

class VoiceEngine {
  constructor(){ this.ready=false; this.initialized=false; this.voices=[]; this.queue=[]; this.speaking=false; }
  initOnceViaUserGesture(){
    if (this.initialized) return; this.initialized = true;
    try { const u=new SpeechSynthesisUtterance(''); u.lang=AssistFlags.LANG; speechSynthesis.speak(u); } catch {}
    const load=()=>{ this.voices=speechSynthesis.getVoices(); this.ready=true; };
    load(); if ('onvoiceschanged' in speechSynthesis) speechSynthesis.onvoiceschanged=load;
  }
  speak(text){
    if (!AssistFlags.VOICE_ENABLED) return;
    if (!('speechSynthesis' in window)) return;
    if (!this.ready || this.speaking){ this.queue.push(text); return; }
    const u=new SpeechSynthesisUtterance(text);
    u.lang=AssistFlags.LANG; u.rate=AssistFlags.RATE; u.pitch=AssistFlags.PITCH; u.volume=AssistFlags.VOL;
    const jp=this.voices.find(v=>v.lang?.startsWith('ja')); if (jp) u.voice=jp;
    this.speaking=true;
    u.onend=()=>{ this.speaking=false; const n=this.queue.shift(); if (n) this.speak(n); };
    speechSynthesis.speak(u);
  }
}
export const voiceEngine = new VoiceEngine();

export function announce(kind, params={}){
  let t='';
  if (kind==='turn-left') t = params.distanceM ? `この先 ${Math.round(params.distanceM)} メートルで左です。` : '左です。';
  if (kind==='turn-right') t = params.distanceM ? `この先 ${Math.round(params.distanceM)} メートルで右です。` : '右です。';
  if (kind==='arrive') t = params.nextName ? `${params.nextName} に到着しました。` : '目的地に到着しました。';
  if (kind==='off-route') t = '予定ルートから外れています。安全に停車してご確認ください。';
  if (kind==='resume') t = 'ルートへ復帰しました。';
  if (kind==='custom') t = params.nextName ?? '';
  if (t) voiceEngine.speak(t);
}
