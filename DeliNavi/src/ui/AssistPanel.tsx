// =============================
// src/ui/AssistPanel.tsx
// =============================
import React, { useEffect, useState } from 'react';
import { AssistFlags, setAssistFlag } from '../config/assistFlags';
import { voiceEngine } from '../assist/voice';


export default function AssistPanel(){
const [voice, setVoice] = useState(AssistFlags.VOICE_ENABLED);
const [vibe, setVibe] = useState(AssistFlags.VIBE_ENABLED);
const [lang, setLang] = useState(AssistFlags.LANG);


useEffect(()=>{
const onTouchInit = () => voiceEngine.initOnceViaUserGesture();
window.addEventListener('click', onTouchInit, { once: true, capture: true });
window.addEventListener('touchstart', onTouchInit, { once: true, capture: true });
return ()=>{
window.removeEventListener('click', onTouchInit, { capture: true } as any);
window.removeEventListener('touchstart', onTouchInit, { capture: true } as any);
};
},[]);


return (
<div className="fixed bottom-3 right-3 bg-white/90 backdrop-blur px-3 py-2 rounded-xl shadow-md flex gap-3 items-center text-sm">
<label className="flex items-center gap-1">
<input type="checkbox" checked={voice} onChange={e=>{
const v = e.target.checked; setVoice(v); setAssistFlag('voice', v?'1':'0');
}}/>
音声
</label>
<label className="flex items-center gap-1">
<input type="checkbox" checked={vibe} onChange={e=>{
const v = e.target.checked; setVibe(v); setAssistFlag('vibe', v?'1':'0');
}}/>
バイブ
</label>
<select value={lang} onChange={e=>{ setLang(e.target.value); setAssistFlag('lang', e.target.value); }}>
<option value="ja-JP">日本語</option>
<option value="en-US">English</option>
</select>
<button className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300" onClick={()=>{
// 試聴
(window as any).voiceEngine?.speak('テストです。右に曲がります。');
if ('vibrate' in navigator) navigator.vibrate([150,100,150]);
}}>テスト</button>
</div>
);
}