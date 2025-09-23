import { AssistFlags, setAssistFlag } from './assistFlags.js';
import { voiceEngine } from './voice.js';

export function mountAssistPanel(){
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;right:12px;bottom:12px;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.1) blur(6px);padding:8px 10px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.15);display:flex;gap:10px;align-items:center;font:14px/1.2 system-ui,-apple-system,Segoe UI,Roboto';
  wrap.innerHTML = `
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="dn-voice">音声</label>
    <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="dn-vibe">バイブ</label>
    <select id="dn-lang"><option value="ja-JP">日本語</option><option value="en-US">English</option></select>
    <button id="dn-test" style="padding:4px 8px;border-radius:8px;border:1px solid #ddd;background:#eee">テスト</button>
  `;
  document.body.appendChild(wrap);

  const chkV=document.getElementById('dn-voice'); chkV.checked=AssistFlags.VOICE_ENABLED;
  const chkB=document.getElementById('dn-vibe');  chkB.checked=AssistFlags.VIBE_ENABLED;
  const sel =document.getElementById('dn-lang');  sel.value=AssistFlags.LANG;

  chkV.addEventListener('change', e=> setAssistFlag('voice', e.target.checked?'1':'0'));
  chkB.addEventListener('change', e=> setAssistFlag('vibe',  e.target.checked?'1':'0'));
  sel.addEventListener('change',  e=> setAssistFlag('lang',  e.target.value));

  document.getElementById('dn-test').addEventListener('click', ()=>{
    voiceEngine.initOnceViaUserGesture();
    voiceEngine.speak('テストです。右に曲がります。');
    if ('vibrate' in navigator) navigator.vibrate([150,100,150]);
  });
}
