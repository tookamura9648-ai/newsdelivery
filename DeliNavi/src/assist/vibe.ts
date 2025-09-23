// =============================
// src/assist/vibe.ts
// =============================
import { AssistFlags } from '../config/assistFlags';


function canVibrate() {
return 'vibrate' in navigator && AssistFlags.VIBE_ENABLED;
}


export const Vibe = {
rightTurn() {
// 右: ブーッ ブーッ（長め×2）
if (!canVibrate()) return;
navigator.vibrate([700, 250, 700]);
},
leftTurn() {
// 左: ブッ ブッ ブ（短め×3）
if (!canVibrate()) return;
navigator.vibrate([250, 150, 250, 150, 250]);
},
arrive() {
if (!canVibrate()) return;
navigator.vibrate([300, 150, 900]);
},
offRoute() {
if (!canVibrate()) return;
// 強め警告パターン
navigator.vibrate([200, 120, 200, 120, 600]);
},
resume() {
if (!canVibrate()) return;
navigator.vibrate([180, 120, 180]);
}
};