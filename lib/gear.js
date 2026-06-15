// ── ギア（シューズ）走行距離・寿命管理 ──────────────
// gear: [{ id, name, initialKm, retireKm }]、各logの gearId で紐付け。
const DEFAULT_RETIRE = 600; // 一般的なロードシューズ寿命の目安(km)

export function gearMileage(gear, logs){
  const sums = {};
  for(const l of (logs || [])){
    if(l.gearId) sums[l.gearId] = (sums[l.gearId] || 0) + (l.dist || 0);
  }
  return (gear || []).map(g => {
    const km = +(((g.initialKm || 0) + (sums[g.id] || 0))).toFixed(1);
    const retireKm = g.retireKm || DEFAULT_RETIRE;
    const pct = Math.min(100, Math.round((km / retireKm) * 100));
    return { ...g, retireKm, km, pct, over: km >= retireKm, warn: km >= retireKm * 0.85 };
  });
}

// 寿命に近い/超えたシューズのアラート
export function gearAlerts(gear, logs){
  return gearMileage(gear, logs)
    .filter(g => g.warn)
    .map(g => ({
      level: g.over ? "warn" : "info",
      msg: g.over
        ? `「${g.name}」が寿命(${g.retireKm}km)を超えました（${g.km}km）。買い替え検討を。`
        : `「${g.name}」が寿命の${g.pct}%（${g.km}/${g.retireKm}km）。そろそろ買い替え準備を。`,
    }));
}
