import { calcXP } from "./training.js";

// ── トレーニング負荷管理（Fitness / Fatigue / Form）──────────────
// 1日の負荷は既存の calcXP（時間・距離・標高・強度・種別を内包）を流用。
// CTL(体力)=42日EMA、ATL(疲労)=7日EMA、TSB(調子=CTL−ATL)。
// ※TrainingPeaks/intervals.icu/Garmin と同じ考え方の簡易版。係数は標準値。

function ymd(d){
  const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0,10);
}
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }

// 日別の負荷（同日複数ログは合算）
export function dailyLoad(logs, maxHR){
  const m = {};
  for(const l of (logs||[])){
    if(!l.date) continue;
    m[l.date] = (m[l.date]||0) + (calcXP(l, maxHR) || 0);
  }
  return m;
}

// 直近 days 日のCTL/ATL/TSB推移
export function loadSeries(logs, maxHR, opts = {}){
  const { days = 42, refDate = new Date() } = opts;
  const loads = dailyLoad(logs, maxHR);
  const dates = Object.keys(loads).sort();
  if(!dates.length) return { series: [], ctl: 0, atl: 0, tsb: 0 };
  // EMAを履歴の先頭から積み上げる（平滑化のため全期間を走査）
  const start = new Date(dates[0]);
  const end = new Date(ymd(refDate));
  const ctlK = 2/(42+1), atlK = 2/(7+1);
  let ctl = 0, atl = 0;
  const series = [];
  for(let d = new Date(start); d <= end; d = addDays(d, 1)){
    const key = ymd(d);
    const load = loads[key] || 0;
    ctl = ctl + (load - ctl)*ctlK;
    atl = atl + (load - atl)*atlK;
    series.push({ date: key, load, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl-atl).toFixed(1) });
  }
  const tail = series.slice(-days);
  const last = series[series.length-1];
  return { series: tail, ctl: last.ctl, atl: last.atl, tsb: last.tsb };
}

// TSB（調子）から状態ラベル
export function formState(tsb){
  if(tsb >= 15) return { label:"回復・キレ重視", tone:"fresh", detail:"疲労が抜けた状態。レースや質の高いポイント練習向き。" };
  if(tsb >= 0)  return { label:"好調レンジ", tone:"good", detail:"バランス良好。通常のトレーニングを継続。" };
  if(tsb >= -15) return { label:"鍛錬中（適正負荷）", tone:"build", detail:"狙い通り負荷が乗っている。睡眠・補給で回復を確保。" };
  return { label:"疲労過多に注意", tone:"warn", detail:"ATLがCTLを大きく上回る。回復走/休養を入れて故障を予防。" };
}

// 急性:慢性 負荷比（ACWR）。0.8〜1.3が適正、1.5+は故障リスク。
export function acwr(logs, maxHR, refDate = new Date()){
  const loads = dailyLoad(logs, maxHR);
  const end = new Date(ymd(refDate));
  const sumRange = (from, to) => {
    let s = 0;
    for(let d = new Date(from); d <= to; d = addDays(d,1)) s += loads[ymd(d)] || 0;
    return s;
  };
  const acute = sumRange(addDays(end, -6), end) / 1;          // 直近7日合計
  const chronic = sumRange(addDays(end, -27), end) / 4;        // 直近28日の週平均
  if(chronic <= 0) return { ratio: 0, acute: Math.round(acute), chronic: 0 };
  return { ratio: +(acute/chronic).toFixed(2), acute: Math.round(acute), chronic: Math.round(chronic) };
}

export function acwrState(ratio){
  if(ratio === 0) return { label:"データ不足", tone:"none" };
  if(ratio > 1.5) return { label:"急増・故障リスク高", tone:"warn" };
  if(ratio >= 0.8 && ratio <= 1.3) return { label:"適正ゾーン", tone:"good" };
  if(ratio < 0.8) return { label:"負荷不足ぎみ", tone:"low" };
  return { label:"やや高め", tone:"build" };
}

// トレーニング単調度（Monotony）と負担（Strain）。Runalyzeの考え方の調整版。
// Monotony = 平均/(標準偏差+平均)。毎日同じ強度ほど高く(→1)、メリハリがあると低い。
export function monotony(logs, maxHR, refDate = new Date()){
  const loads = dailyLoad(logs, maxHR);
  const end = new Date(ymd(refDate));
  const vals = [];
  for(let i = 6; i >= 0; i--) vals.push(loads[ymd(addDays(end, -i))] || 0);
  const mean = vals.reduce((s,v) => s+v, 0) / 7;
  if(mean <= 0) return { monotony: 0, strain: 0, weekLoad: 0 };
  const sd = Math.sqrt(vals.reduce((s,v) => s + (v-mean)**2, 0) / 7);
  const mono = +(mean / (sd + mean)).toFixed(2);
  const weekLoad = vals.reduce((s,v) => s+v, 0);
  return { monotony: mono, strain: Math.round(weekLoad * mono), weekLoad: Math.round(weekLoad) };
}

// 故障予防アラート（ACWR / TSB / 単調度から）。{level, msg} の配列。
export function trainingAlerts(logs, maxHR, refDate = new Date()){
  const out = [];
  const aw = acwr(logs, maxHR, refDate);
  if(aw.ratio > 1.5) out.push({ level: "warn", msg: `急性負荷が高め（ACWR ${aw.ratio}）。回復走/休養日を入れて故障を予防しましょう。` });
  const m = monotony(logs, maxHR, refDate);
  if(m.weekLoad > 0 && m.monotony >= 0.8) out.push({ level: "warn", msg: `トレーニングが単調です（Monotony ${m.monotony}）。強弱のメリハリ（ポイント練習＋回復走）を。` });
  const ls = loadSeries(logs, maxHR, { days: 7, refDate });
  if(ls.tsb <= -15) out.push({ level: "warn", msg: `疲労が溜まっています（TSB ${ls.tsb}）。回復走か休養で抜きましょう。` });
  return out;
}
