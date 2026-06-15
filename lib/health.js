// ── ヘルスデータ（体重・安静時心拍・睡眠・主観疲労RPE）──────────
// health: [{ id, date, weight, rhr, sleep, rpe, note }]

function sortByDate(health){
  return [...(health || [])].filter(h => h.date).sort((a,b) => a.date.localeCompare(b.date));
}

export function latestHealth(health){
  const s = sortByDate(health);
  return s.length ? s[s.length - 1] : null;
}

// 安静時心拍のベースライン（直近windowDays・最新日を除く平均）
export function rhrBaseline(health, refDate = new Date(), windowDays = 30){
  const cutoff = new Date(refDate); cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffYmd = cutoff.toISOString().slice(0,10);
  const s = sortByDate(health).filter(h => h.rhr > 0 && h.date >= cutoffYmd);
  if(s.length < 2) return null;
  const past = s.slice(0, -1); // 最新は除いてベースライン化
  if(!past.length) return null;
  return Math.round(past.reduce((a,h) => a + h.rhr, 0) / past.length);
}

// 体調アラート（安静時心拍がベースより高い＝疲労/体調不良のサイン）
export function healthAlerts(health, refDate = new Date()){
  const out = [];
  const latest = latestHealth(health);
  const base = rhrBaseline(health, refDate);
  if(latest && latest.rhr > 0 && base && latest.rhr >= base + 7){
    out.push({ level: "warn", msg: `安静時心拍が平常(${base})より高め(${latest.rhr})。疲労・体調不良のサイン。無理せず回復を優先。` });
  }
  if(latest && latest.rpe >= 8){
    out.push({ level: "info", msg: `直近の主観疲労(RPE ${latest.rpe})が高め。睡眠・補給で回復を確保しましょう。` });
  }
  return out;
}

// 体重・安静時心拍の推移（グラフ用）
export function healthTrend(health, days = 60){
  return sortByDate(health).slice(-days).map(h => ({
    date: h.date, label: h.date.slice(5),
    weight: h.weight || null, rhr: h.rhr || null,
  }));
}
