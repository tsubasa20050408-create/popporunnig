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
