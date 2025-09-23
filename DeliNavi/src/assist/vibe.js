import { AssistFlags } from './assistFlags.js';

let unlocked = false;                    // ← 追加：ユーザー操作後に true
export function unlockVibe(){ unlocked = true; }  // ← 追加：解錠関数

function canVibrate(){
  return unlocked && 'vibrate' in navigator && AssistFlags.VIBE_ENABLED;
}

export const Vibe = {
  rightTurn(){ if (!canVibrate()) return; navigator.vibrate([700,250,700]); },
  leftTurn(){  if (!canVibrate()) return; navigator.vibrate([250,150,250,150,250]); },
  arrive(){    if (!canVibrate()) return; navigator.vibrate([300,150,900]); },
  offRoute(){  if (!canVibrate()) return; navigator.vibrate([200,120,200,120,600]); },
  resume(){    if (!canVibrate()) return; navigator.vibrate([180,120,180]); },
};


