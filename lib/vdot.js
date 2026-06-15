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

// ── 日々の練習からVDOTを自動推定 ───────────────────────────────
// %HRmax → %VO2max（HRと酸素摂取率の一般的な線形近似 / Swain et al.）。
// ※利尻53km解析の係数とは独立した「推定用」係数。表示ペースは常に公式表の値のまま。
export function pctVO2FromHR(avgHR, maxHR){
  if(!avgHR || !maxHR) return 0;
  const hr = Math.max(0.5, Math.min(1.0, avgHR/maxHR));
  const pct = (hr - 0.37) / 0.64;
  return Math.max(0.45, Math.min(1.0, pct));
}
// 連続走1本からVDOT推定（ペース＝酸素コスト ÷ HRから求めた%VO2max）。
// 酸素コスト式の係数は vdotFromRace と同一（ダニエルズ）。
export function vdotFromEffort(distKm, durMin, avgHR, maxHR){
  if(!distKm || !durMin || !avgHR || !maxHR) return 0;
  const v = (distKm*1000) / durMin;              // m/min
  const vo2 = -4.60 + 0.182258*v + 0.000104*v*v; // 走速の酸素コスト
  const pct = pctVO2FromHR(avgHR, maxHR);
  if(pct <= 0) return 0;
  return vo2 / pct;
}
// 1本のログからVDOT推定値と信頼重みを返す（推定に使えない場合は null）。
// 地形（登坂/下り・獲得標高大）・超長時間（>180分）はペースが信頼できないため除外。
export function logVdot(l, maxHR){
  if(!l || !l.date) return null;
  const dist = l.dist||0, dur = l.dur||0;
  const aHR = l.avgHR||0, mHR = l.maxHR||maxHR||0;
  const gainPerKm = (l.gain||0) / Math.max(dist, 0.1);
  if(dur > 180 || dist < 1.5 || gainPerKm > 20) return null;
  let est = 0, weight = 0;
  if(l.type === "race" && dur >= 4){
    est = vdotFromRace(dist*1000, dur); weight = 3;            // レース＝最も信頼
  } else if(["tempo","interval","long","easy"].includes(l.type) && dur >= 15 && aHR && mHR){
    est = vdotFromEffort(dist, dur, aHR, mHR);
    weight = l.type === "interval" ? 0.5 : (l.type === "easy" ? 0.7 : 1);
  }
  if(est < VDOT_MIN || est > VDOT_MAX) return null;
  return { date: l.date, vdot: est, weight };
}
// 直近の練習ログ群から自動VDOTを推定。上位推定の加重平均（外れ値1本に振られない）。
export function estimateVdotFromLogs(logs, maxHR, opts = {}){
  const { windowDays = 90, refDate = new Date() } = opts;
  const cutoff = new Date(refDate); cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffYmd = cutoff.toISOString().slice(0,10);
  const ests = [];
  for(const l of (logs||[])){
    if(l.date < cutoffYmd) continue;
    const r = logVdot(l, maxHR);
    if(r) ests.push(r);
  }
  if(!ests.length) return null;
  ests.sort((a,b) => b.vdot - a.vdot);
  const top = ests.slice(0, Math.max(1, Math.ceil(ests.length * 0.4)));
  const wsum = top.reduce((s,e) => s + e.weight, 0) || 1;
  const v = top.reduce((s,e) => s + e.vdot*e.weight, 0) / wsum;
  return { vdot: Math.round(v), samples: ests.length, used: top.length };
}
// VDOT（走力）の時系列推移。日別に最良推定をとる。
export function vdotTrend(logs, maxHR){
  const byDate = {};
  for(const l of (logs||[])){
    const r = logVdot(l, maxHR);
    if(!r) continue;
    if(!byDate[r.date] || r.vdot > byDate[r.date]) byDate[r.date] = Math.round(r.vdot);
  }
  return Object.entries(byDate).map(([date, vdot]) => ({ date, vdot }))
    .sort((a,b) => a.date.localeCompare(b.date));
}
// 距離別の自己ベスト（その距離帯で最速の実走）。全活動の合計距離/時間ベース。
const PB_DISTS = [
  { key:"5k",   label:"5km",   lo:4.6,  hi:6 },
  { key:"10k",  label:"10km",  lo:9,    hi:11.5 },
  { key:"half", label:"ハーフ", lo:19,   hi:23 },
  { key:"full", label:"フル",   lo:40,   hi:44 },
];
export function personalBests(logs){
  return PB_DISTS.map(b => {
    const cands = (logs||[]).filter(l => (l.dist||0) >= b.lo && (l.dist||0) <= b.hi && (l.dur||0) > 0);
    if(!cands.length) return { ...b, best: null };
    const best = cands.reduce((a,c) => (c.dur/c.dist) < (a.dur/a.dist) ? c : a);
    return { ...b, best: { date: best.date, dist: best.dist, dur: best.dur, pace: best.dur/best.dist } };
  });
}
