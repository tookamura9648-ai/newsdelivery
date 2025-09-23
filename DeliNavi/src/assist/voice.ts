// =============================
// 音声リストロード
const loadVoices = () => {
this.voices = speechSynthesis.getVoices();
this.ready = true;
};
loadVoices();
if ('onvoiceschanged' in speechSynthesis)
speechSynthesis.onvoiceschanged = loadVoices;
}


speak(text: string) {
if (!AssistFlags.VOICE_ENABLED) return;
if (!('speechSynthesis' in window)) return;
if (!this.ready) {
// キューして、後で再生
this.queue.push(text);
return;
}
if (this.speaking) {
this.queue.push(text);
return;
}
const u = new SpeechSynthesisUtterance(text);
u.lang = AssistFlags.LANG;
u.rate = AssistFlags.RATE;
u.pitch = AssistFlags.PITCH;
u.volume = AssistFlags.VOL;
// 日本語向けの声を優先
const jp = this.voices.find(v => v.lang?.startsWith('ja'));
if (jp) u.voice = jp;


this.speaking = true;
u.onend = () => {
this.speaking = false;
const next = this.queue.shift();
if (next) this.speak(next);
};
speechSynthesis.speak(u);
}
}


export const voiceEngine = new VoiceEngine();


export function announce(kind: VoiceKind, params?: {distanceM?: number; nextName?: string;}) {
let text = '';
switch (kind) {
case 'turn-left':
text = params?.distanceM ? `この先 ${Math.round(params.distanceM)} メートルで左です。` : '左です。';
break;
case 'turn-right':
text = params?.distanceM ? `この先 ${Math.round(params.distanceM)} メートルで右です。` : '右です。';
break;
case 'arrive':
text = params?.nextName ? `${params.nextName} に到着しました。` : '目的地に到着しました。';
break;
case 'off-route':
text = `予定ルートから外れています。安全に停車してご確認ください。`;
break;
case 'resume':
text = 'ルートへ復帰しました。';
break;
case 'custom':
text = params?.nextName ?? '';
break;
}
if (text) voiceEngine.speak(text);
}