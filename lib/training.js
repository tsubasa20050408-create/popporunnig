export const WORKOUTS = {
  recovery:{ label:"ゆるジョグ", typeBonus:1.0, gains:{aerobic:0.8}, tag:"回復" },
  easy:    { label:"イージーラン", typeBonus:1.05, gains:{aerobic:1.0,endurance:0.5}, tag:"基礎" },
  long:    { label:"ロング走", typeBonus:1.2, gains:{endurance:2.0,aerobic:1.0}, tag:"持久" },
  tempo:   { label:"テンポ / 閾値走", typeBonus:1.4, gains:{threshold:2.2,speedEnd:1.0}, tag:"弱点強化" },
  interval:{ label:"インターバル", typeBonus:1.4, gains:{speedEnd:2.2,threshold:0.8}, tag:"スピード" },
  hill:    { label:"ヒル走 / 登坂", typeBonus:1.5, gains:{climb:2.8,aerobic:0.8,endurance:0.5}, tag:"弱点強化" },
  downhill:{ label:"下り走", typeBonus:1.5, gains:{downhill:2.8,speedEnd:0.6}, tag:"弱点強化" },
  race:    { label:"レース", typeBonus:1.6, gains:{endurance:1.5,threshold:0.8,speedEnd:0.6}, tag:"本番" },
  cross:   { label:"筋トレ / クロス", typeBonus:0.8, gains:{climb:0.8,downhill:0.8}, tag:"補強" },
  rest:    { label:"完全休養", typeBonus:0, gains:{}, tag:"休養" },
};
export const SEED_STATS = { aerobic:78, endurance:70, speedEnd:52, threshold:48, climb:35, downhill:33 };
export const SEED_LOGS = [
  { id:1, date:"2026-06-07", type:"race", dist:54.13, dur:333.77, avgHR:150, maxHR:171, gain:428, descent:426, xp:0,
    note:"利尻島一周53km / 5:33:46 / ネガティブスプリット・ラスト4分台" },
];
export const SEED_MISSIONS = [
  { id:"m1", label:"ヒル走 1本（獲得標高100m+）", bonus:150, attr:"climb", inc:4, done:false },
  { id:"m2", label:"閾値走 20分以上", bonus:150, attr:"threshold", inc:4, done:false },
  { id:"m3", label:"下りjog 1本", bonus:120, attr:"downhill", inc:4, done:false },
  { id:"m4", label:"ロング走 90分以上", bonus:120, attr:"endurance", inc:3, done:false },
  { id:"m5", label:"週合計 40km 達成", bonus:100, attr:"aerobic", inc:2, done:false },
];

export function intensityFactor(avgHR, maxHR){
  if(!avgHR||!maxHR) return 1.0;
  const r=avgHR/maxHR;
  if(r<0.7) return 0.9; if(r<0.8) return 1.05; if(r<0.87) return 1.25; if(r<0.92) return 1.5; return 1.8;
}
export function calcXP(log, maxHR){
  const w=WORKOUTS[log.type]; if(!w||w.typeBonus===0) return 0;
  const base=log.dur||0, distB=(log.dist||0)*4, elevB=(log.gain||0)*0.5;
  const f=intensityFactor(log.avgHR, log.maxHR||maxHR);
  return Math.round((base+distB+elevB)*f*w.typeBonus);
}
export function levelFromXP(xp){
  let lvl=1, req=300, cum=0;
  while(xp>=cum+req){ cum+=req; lvl++; req=300+(lvl-1)*180; }
  return { level:lvl, into:xp-cum, req };
}
export function rankTitle(l){
  if(l>=13) return "サブ3ランナー"; if(l>=11) return "サブ3チャレンジャー";
  if(l>=9) return "サブ3.15ランナー"; if(l>=7) return "サブ3.5ランナー";
  if(l>=5) return "サブ4ランナー"; if(l>=3) return "市民ランナー"; return "ランナー見習い";
}
export function applyGains(stats, type, dur){
  const w=WORKOUTS[type]; const durF=Math.min((dur||0)/40, 1.6); const next={...stats};
  Object.entries(w.gains||{}).forEach(([k,g])=>{
    const gain=g*durF; next[k]=Math.min(100, +(next[k]+gain*(1-next[k]/100)).toFixed(1));
  });
  return next;
}
export function fmtPace(dur, dist){
  if(!dur||!dist) return "—"; const p=dur/dist, m=Math.floor(p), s=Math.round((p-m)*60);
  return `${m}'${String(s).padStart(2,"0")}"`;
}
export function initialState(){
  return {
    maxHR: 198, vdot: 50,
    raceName: "北海道マラソン", raceDate: "",
    logs: SEED_LOGS.map(l=>({ ...l, xp: calcXP(l, l.maxHR||198) })),
    stats: { ...SEED_STATS },
    missions: SEED_MISSIONS.map(m=>({ ...m })),
  };
}
export function classify(a, distKm, durMin){
  if(a.type!=="Run" && a.type!=="TrailRun") return "cross";
  if(a.workout_type===1) return "race";
  const gainPerKm=(a.total_elevation_gain||0)/Math.max(distKm,1);
  const pace=durMin/Math.max(distKm,0.1);
  if(gainPerKm>25) return "hill"; if(distKm>=20) return "long";
  if(pace<4.5 && distKm<=12) return "tempo"; if(pace>=6.5) return "recovery"; return "easy";
}
export function stravaToLog(a){
  const dist=+(a.distance/1000).toFixed(2); const dur=+(a.moving_time/60).toFixed(2);
  return {
    id:"st_"+a.id, stravaId:a.id, date:(a.start_date_local||a.start_date||"").slice(0,10),
    type:classify(a, dist, dur), dist, dur,
    avgHR:Math.round(a.average_heartrate||0), maxHR:Math.round(a.max_heartrate||0),
    gain:Math.round(a.total_elevation_gain||0), descent:0, note:(a.name||"Strava")+"（Strava取込）",
  };
}

// ── 派生計算ヘルパー（編集・削除・自動判定を正しく扱うため、ステータスはログから再計算する）──
// シードログ(数値id)はSEED_STATSに織込み済みのため除外し、ユーザー/取込ログ(文字列id)のみ適用。
export function recomputeStats(logs, missions){
  let stats = { ...SEED_STATS };
  const ordered = [...(logs||[])]
    .filter(l => typeof l.id === "string")
    .sort((a,b) => (a.date||"").localeCompare(b.date||""));
  for(const l of ordered) stats = applyGains(stats, l.type, l.dur);
  for(const m of (missions||[])){
    if(m.done && m.attr){
      const cur = stats[m.attr] ?? 0;
      stats = { ...stats, [m.attr]: Math.max(0, Math.min(100, +(cur + (m.inc||0)).toFixed(1))) };
    }
  }
  return stats;
}

function ymd(d){
  const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0,10);
}
// 月曜始まりの週範囲（YYYY-MM-DD）
export function weekRange(refDate = new Date()){
  const d = new Date(refDate); const day = (d.getDay()+6)%7; // Mon=0
  const mon = new Date(d); mon.setHours(0,0,0,0); mon.setDate(d.getDate()-day);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  return { start: ymd(mon), end: ymd(sun) };
}
// 既定5ミッションを今週のログから自動判定（カスタムミッションは手動のまま維持）
export function evaluateMissions(missions, logs, refDate = new Date()){
  const { start, end } = weekRange(refDate);
  const wk = (logs||[]).filter(l => l.date >= start && l.date <= end);
  const some = (fn) => wk.some(fn);
  const weekKm = wk.reduce((s,l) => s + (l.dist||0), 0);
  const auto = {
    m1: some(l => l.type==="hill"),
    m2: some(l => (l.type==="tempo"||l.type==="interval") && (l.dur||0)>=20),
    m3: some(l => l.type==="downhill"),
    m4: some(l => l.type==="long" && (l.dur||0)>=90),
    m5: weekKm >= 40,
  };
  return (missions||[]).map(m => (m.id in auto ? { ...m, done: auto[m.id] } : m));
}

// maxHR基準の心拍ゾーン
export function hrZones(maxHR){
  const z = [
    { z:"Z1", name:"回復", lo:0.50, hi:0.60 },
    { z:"Z2", name:"有酸素 (E)", lo:0.60, hi:0.70 },
    { z:"Z3", name:"マラソン (M)", lo:0.70, hi:0.80 },
    { z:"Z4", name:"閾値 (T)", lo:0.80, hi:0.90 },
    { z:"Z5", name:"VO2max (I)", lo:0.90, hi:1.00 },
  ];
  return z.map(x => ({ z:x.z, name:x.name, loB: Math.round(maxHR*x.lo), hiB: Math.round(maxHR*x.hi) }));
}

// VDOT差から今週の練習方針を提案
export function weeklyFocus(gap){
  if(gap <= 0) return { focus:"維持＋本番調整", detail:"サブ3ラインに到達。Tペース維持とMペース走でレースシミュレーションをしつつテーパリングへ。" };
  if(gap >= 6) return { focus:"土台づくり（E/ロング中心）", detail:"まず週間距離と有酸素土台を厚く。週1で短めの閾値走を足す。" };
  if(gap >= 3) return { focus:"閾値(T)強化", detail:"テンポ走20分 or 8分×3（つなぎjog）を週1〜2。ロング走で持久を確保。" };
  return { focus:"VO2max(I)＋仕上げ", detail:"インターバル1000m×5（間400mjog）を週1。Mペース走でレース慣れ。あと少し。" };
}

// ランナー向け補強（ウェイト/クロス）メニュー提案
export const STRENGTH_PLAN = [
  { group:"登坂力 (climb)", items:["ブルガリアンスクワット 8回×3","カーフレイズ 15回×3","ステップアップ 10回×3"] },
  { group:"下り耐性 (downhill)", items:["エキセントリック・スクワット（下ろし4秒）10回×3","フロント/バックランジ 各10回×3","片脚デッドリフト 8回×3"] },
  { group:"体幹・ランエコノミー", items:["プランク 60秒×3","サイドプランク 40秒×左右","デッドバグ 10回×3"] },
  { group:"ばね・接地", items:["縄跳び 2分×3","ボックスジャンプ 6回×3","片脚ホップ 10回×左右"] },
];
