import { paceSet } from "./vdot.js";

// ── ダニエルズ式 週次トレーニングプラン自動生成 ──────────────
// 現VDOT・レースまでの週数・週あたり練習回数 から、E/M/T/I/R の週メニューを生成。
// ペースはすべて公式換算表の値（paceSet）。係数の変更はしない。

const DOW = ["月", "火", "水", "木", "金", "土", "日"];

// フェーズ（レースまでの週数で周期化）
export function phaseOf(weeksToRace){
  if(weeksToRace == null) return { key: "base", label: "土台づくり期" };
  if(weeksToRace <= 2) return { key: "taper", label: "テーパー（調整）期" };
  if(weeksToRace <= 6) return { key: "peak", label: "仕上げ期" };
  if(weeksToRace <= 12) return { key: "build", label: "ビルドアップ期" };
  return { key: "base", label: "土台づくり期" };
}

// フェーズごとの「質の高い練習」プール（曜日に割り当てる）
function qualityPool(phase, P){
  switch(phase){
    case "taper":
      return [
        { type: "tempo", label: "テンポ走（短め）", pace: P.T, detail: "T 10分。刺激を入れつつ疲労は残さない" },
        { type: "interval", label: "流し中心", pace: P.R, detail: "R 200m×4。キレ維持・量は最小" },
      ];
    case "peak":
      return [
        { type: "interval", label: "インターバル", pace: P.I, detail: "I 1000m×5（間400mjog）" },
        { type: "tempo", label: "マラソンペース走", pace: P.M, detail: "M 10〜14km 連続。レース感覚を作る" },
      ];
    case "build":
      return [
        { type: "tempo", label: "閾値走（テンポ）", pace: P.T, detail: "T 20分連続 or 8分×3（つなぎjog）" },
        { type: "interval", label: "インターバル", pace: P.I, detail: "I 1000m×5（間400mjog）" },
      ];
    default: // base
      return [
        { type: "tempo", label: "閾値走（短め）", pace: P.T, detail: "T 8分×2〜3（つなぎjog）" },
      ];
  }
}

// 週メニュー生成。daysPerWeek=3〜7。月曜始まり。
export function weeklyPlan({ vdot, raceDate, daysPerWeek = 4, refDate = new Date() }){
  const P = paceSet(vdot);
  let weeksToRace = null;
  if(raceDate){
    const ms = new Date(raceDate + "T00:00:00") - new Date(new Date(refDate).toISOString().slice(0,10) + "T00:00:00");
    weeksToRace = Math.max(0, Math.ceil(ms / (7 * 86400000)));
  }
  const phase = phaseOf(weeksToRace);
  const runDays = Math.max(3, Math.min(7, daysPerWeek));

  // テンプレ枠：[長] ロング, [質] ポイント, [E] イージー, [休] 休養
  // 走る曜日の優先順（火/木に質、日にロング、間にE、残りを休養）
  const slots = Array(7).fill("rest");
  const longIdx = 6;                 // 日曜＝ロング
  slots[longIdx] = "long";
  // 質練習の曜日：base/taperは火のみ、build/peakは火・木
  const qualityIdx = (phase.key === "build" || phase.key === "peak") ? [1, 3] : [1];
  const quality = qualityPool(phase, P);
  let qUsed = 0;
  for(const qi of qualityIdx){
    if(runDays - 1 - qUsed <= 0) break; // ロングぶんを確保
    slots[qi] = "quality";
    qUsed++;
  }
  // 残りの走枠をイージーで埋める（月→金→…の順）
  const fillOrder = [0, 4, 2, 5, 3, 1];
  let placed = 1 + qUsed; // long + quality
  for(const i of fillOrder){
    if(placed >= runDays) break;
    if(slots[i] === "rest"){ slots[i] = "easy"; placed++; }
  }

  // ロングの距離目安（フェーズで調整）
  const longDetail = phase.key === "taper" ? "E 60〜80分（量を落とす）"
    : phase.key === "peak" ? "E〜M 90〜100分（後半M少々）"
    : "E 90〜120分（会話ペース）";

  const days = slots.map((s, i) => {
    if(s === "rest") return { dow: DOW[i], type: "rest", label: "休養 or 補強", pace: "—", detail: "完全休養 or 体幹/ウェイト" };
    if(s === "long") return { dow: DOW[i], type: "long", label: "ロング走", pace: P.E, detail: longDetail };
    if(s === "easy") return { dow: DOW[i], type: "easy", label: "イージーラン", pace: P.E, detail: "E 40〜60分。土台＋回復" };
    // 質練習：その日より前にある質枠の数で、プールから順に割り当て
    const q = quality[slots.slice(0, i).filter(x => x === "quality").length % quality.length];
    return { dow: DOW[i], type: q.type, label: q.label, pace: q.pace, detail: q.detail };
  });

  return { phase, weeksToRace, runDays, days };
}
