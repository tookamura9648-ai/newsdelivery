import { AssistFlags } from './assistFlags.js';
function canVibrate(){ return 'vibrate' in navigator && AssistFlags.VIBE_ENABLED; }
export const Vibe = {
  rightTurn(){ if (!canVibrate()) return; navigator.vibrate([700,250,700]); },             // 右: 長め×2
  leftTurn(){  if (!canVibrate()) return; navigator.vibrate([250,150,250,150,250]); },     // 左: 短め×3
  arrive(){    if (!canVibrate()) return; navigator.vibrate([300,150,900]); },
  offRoute(){  if (!canVibrate()) return; navigator.vibrate([200,120,200,120,600]); },
  resume(){    if (!canVibrate()) return; navigator.vibrate([180,120,180]); },
};
