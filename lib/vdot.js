import { VDOT_TABLE } from "./vdotTable.js";

export const VDOT_MIN = 30, VDOT_MAX = 90;
export const SUB3_VDOT = 54; // 表: VDOT54 = フル2:58'40"（サブ3達成ライン）

// レース結果 → VDOT（ダニエルズの式。算出のみ式、表示は表参照）
export function vdotFromRace(distM, timeMin){
  if(!distM || !timeMin) return 0;
  const v = distM / timeMin;
  const vo2 = -4.60 + 0.182258*v + 0.000104*v*v;
  const pct = 0.8 + 0.1894393*Math.exp(-0.012778*timeMin) + 0.2989558*Math.exp(-0.1932605*timeMin);
  return vo2 / pct;
}
// VDOT(整数丸め・クランプ) → 表の行
export function vdotRow(vdot){
  const v = Math.max(VDOT_MIN, Math.min(VDOT_MAX, Math.round(vdot)));
  return VDOT_TABLE[v];
}
// 表示用ペースセット（すべて公式表の値）
export function paceSet(vdot){
  const r = vdotRow(vdot);
  return {
    E: `${r.eFast}〜${r.eSlow}`, // 速い〜遅い
    M: r.M, T: r.T, I: r.I, R: r.R,
    race: { marathon:r.marathon, half:r.half, tenK:r.tenK, fiveK:r.fiveK },
  };
}
