import { useEffect, useMemo, useRef, useState } from "react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Activity, Trophy, Target, Gauge, Flame, Mountain, TrendingDown,
  Heart, RefreshCw, Link2, Plus, RotateCcw, ChevronRight,
  Settings, Trash2, Download, Upload, Calendar, Dumbbell, HeartPulse, Pencil, X,
} from "lucide-react";
import {
  WORKOUTS, SEED_STATS, SEED_LOGS, SEED_MISSIONS,
  calcXP, levelFromXP, rankTitle, applyGains, fmtPace, classify,
  recomputeStats, evaluateMissions, weekRange, hrZones, weeklyFocus, STRENGTH_PLAN,
  initialState,
} from "../lib/training.js";
import { paceSet, vdotFromRace, SUB3_VDOT, VDOT_MIN, VDOT_MAX } from "../lib/vdot.js";
import { parseActivityFile } from "../lib/parseActivity.js";
import { unzip, gunzipText } from "../lib/unzip.js";

// ── UI専用の能力値メタ（ロジックには影響しない）──
const ATTRS = [
  { key: "aerobic",   label: "有酸素",       short: "有酸素", color: "#34d399", Icon: Heart },
  { key: "endurance", label: "持久力",       short: "持久",   color: "#60a5fa", Icon: Activity },
  { key: "speedEnd",  label: "スピード持久", short: "SP持久", color: "#f472b6", Icon: Gauge },
  { key: "threshold", label: "閾値",         short: "閾値",   color: "#fbbf24", Icon: Flame },
  { key: "climb",     label: "登坂力",       short: "登坂",   color: "#fb923c", Icon: Mountain },
  { key: "downhill",  label: "下り",         short: "下り",   color: "#a78bfa", Icon: TrendingDown },
];

const TABS = [
  { id: "status",   label: "ステータス", Icon: Trophy },
  { id: "log",      label: "記録",       Icon: Plus },
  { id: "history",  label: "履歴",       Icon: Activity },
  { id: "missions", label: "ミッション", Icon: Target },
  { id: "pace",     label: "ペース",     Icon: Gauge },
];

const TYPE_KEYS = Object.keys(WORKOUTS);

const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-4";
const btn = "rounded-xl px-3 py-2 text-sm font-medium transition active:scale-[0.98] disabled:opacity-40";

export default function TrainingApp() {
  const [state, setState] = useState(null); // {maxHR, vdot, logs, stats, missions}
  const [tab, setTab] = useState("status");
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [pendingShare, setPendingShare] = useState(null);

  // ── 起動：サーバーstate読込 + Strava自動同期 ──
  useEffect(() => {
    (async () => {
      try {
        const s = await fetch("/api/state").then((r) => r.json());
        setState(s && s.logs ? s : initialState());
      } catch {
        setState(initialState()); // API未到達でもシードで開けるように
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get("strava") === "connected") {
        setBanner({ kind: "ok", text: "Stravaと連携しました。アクティビティを同期します…" });
        window.history.replaceState({}, "", window.location.pathname);
      } else if (params.get("strava") === "error") {
        setBanner({ kind: "err", text: "Strava連携に失敗しました。もう一度お試しください。" });
        window.history.replaceState({}, "", window.location.pathname);
      }
      autoSync();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── スマホ共有メニューから来たファイルを Cache から取り出す（PWA Web Share Target）──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share-target") == null) return;
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      try {
        if (!("caches" in window)) return;
        const cache = await caches.open("shared-files");
        const idx = await cache.match("/shared-index");
        const keys = idx ? await idx.json() : [];
        const items = [];
        for (const k of keys) {
          const r = await cache.match(k);
          if (r) {
            items.push({ name: r.headers.get("X-Filename") || "shared.gpx", text: await r.text() });
            await cache.delete(k);
          }
        }
        await cache.delete("/shared-index");
        if (items.length) setPendingShare(items);
      } catch {
        /* 共有取込失敗時は無視 */
      }
    })();
  }, []);

  // state読込後に共有ファイルを取込
  useEffect(() => {
    if (state && pendingShare && pendingShare.length) {
      const { added, skipped } = importItems(pendingShare);
      setBanner({
        kind: added ? "ok" : "err",
        text: added
          ? `共有から${added}件を取り込みました${skipped ? `（${skipped}件はスキップ）` : ""}。`
          : "共有ファイルを取り込めませんでした（重複/解析失敗）。",
      });
      setPendingShare(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pendingShare]);

  // ── 再表示/フォーカス時にも自動同期（開きっぱなしでも最新に。Webサーバーは無料のまま）──
  const autoSyncRef = useRef(() => {});
  useEffect(() => {
    let last = Date.now();
    const maybeSync = () => {
      // 連打/頻繁な発火を防ぐため60秒以上空いたときだけ
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 60000) return;
      last = Date.now();
      autoSyncRef.current();
    };
    document.addEventListener("visibilitychange", maybeSync);
    window.addEventListener("focus", maybeSync);
    return () => {
      document.removeEventListener("visibilitychange", maybeSync);
      window.removeEventListener("focus", maybeSync);
    };
  }, []);

  async function saveState(next) {
    setState(next);
    try {
      await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      /* オフライン時もUIは更新済み */
    }
  }

  async function autoSync() {
    setSyncing(true);
    try {
      const r = await fetch("/api/strava/sync", { method: "POST" });
      if (r.ok) {
        const { added, state: server } = await r.json();
        if (server) setState(server);
        if (added > 0) setBanner({ kind: "ok", text: `${added}件の新しいアクティビティを取り込みました。` });
      }
    } catch {
      /* 未連携などは無視 */
    } finally {
      setSyncing(false);
    }
  }
  autoSyncRef.current = autoSync;

  // ── 集計（XP/レベル）──
  const totals = useMemo(() => {
    if (!state) return null;
    const logXP = (state.logs || []).reduce((s, l) => s + (l.xp || 0), 0);
    const missionXP = (state.missions || []).filter((m) => m.done).reduce((s, m) => s + (m.bonus || 0), 0);
    const totalXP = logXP + missionXP;
    const lv = levelFromXP(totalXP);
    return { totalXP, logXP, missionXP, ...lv };
  }, [state]);

  if (!state || !totals) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white/70">
        <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> 読み込み中…
      </div>
    );
  }

  // ── 全mutationの中心：logs/missions/maxHR から xp・stats・ミッション自動判定を再計算 ──
  function withRecalc(base) {
    const logs = (base.logs || []).map((l) => ({ ...l, xp: calcXP(l, base.maxHR || 198) }));
    const missions = evaluateMissions(base.missions || [], logs);
    const stats = recomputeStats(logs, missions);
    return { ...base, logs, missions, stats };
  }
  function commit(base) {
    saveState(withRecalc(base));
  }

  // ── アクション ──
  function addLog(form) {
    const log = {
      id: "u_" + Date.now(),
      date: form.date,
      type: form.type,
      dist: +form.dist || 0,
      dur: +form.dur || 0,
      avgHR: +form.avgHR || 0,
      maxHR: +form.maxHR || 0,
      gain: +form.gain || 0,
      descent: 0,
      note: form.note || "",
    };
    commit({ ...state, logs: [log, ...state.logs] });
    setTab("status");
  }

  // ── GPX/TCX/ZIP/gz ファイル取込（Strava API不要・完全無料）──
  // ZIP(=Strava一括エクスポート)やgzは展開し、中のGPX/TCXをまとめて取り込む。
  async function importFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const items = [];
    let fitCount = 0;
    const pushIfActivity = (name, text) => {
      const n = name.toLowerCase();
      if (n.endsWith(".gpx") || n.endsWith(".tcx")) items.push({ name, text });
    };
    for (const f of files) {
      const lower = f.name.toLowerCase();
      try {
        if (lower.endsWith(".zip")) {
          const entries = await unzip(await f.arrayBuffer());
          for (const e of entries) {
            const en = e.name.toLowerCase();
            if (en.endsWith(".fit") || en.endsWith(".fit.gz")) { fitCount++; continue; }
            if (en.endsWith(".gz")) {
              const text = await gunzipText(e.bytes);
              pushIfActivity(e.name.replace(/\.gz$/i, ""), text);
            } else {
              pushIfActivity(e.name, new TextDecoder().decode(e.bytes));
            }
          }
        } else if (lower.endsWith(".gz")) {
          const base = f.name.replace(/\.gz$/i, "");
          if (base.toLowerCase().endsWith(".fit")) { fitCount++; continue; }
          pushIfActivity(base, await gunzipText(new Uint8Array(await f.arrayBuffer())));
        } else if (lower.endsWith(".fit")) {
          fitCount++;
        } else {
          pushIfActivity(f.name, await f.text());
        }
      } catch {
        /* 壊れたファイルはスキップ */
      }
    }
    const { added, skipped } = importItems(items);
    setBanner({
      kind: added ? "ok" : "err",
      text: added
        ? `${added}件を取り込みました${skipped ? `（${skipped}件はスキップ）` : ""}。${fitCount ? ` FIT形式${fitCount}件は未対応のため除外。` : ""}`
        : fitCount
          ? `FIT形式が${fitCount}件ありました（現在未対応）。Stravaの「GPXをエクスポート」で取得したGPX、または一括ZIP内のGPX/TCXを使ってください。`
          : "取り込めるアクティビティがありませんでした（重複/解析失敗）。",
    });
  }

  // items: [{ name, text }] — ファイル選択・スマホ共有・ZIP展開の共通取込。{added, skipped} を返す
  function importItems(parsed) {
    const logs = [...state.logs];
    let added = 0, skipped = 0;
    for (const item of parsed) {
      if (!item) continue;
      let act = null;
      try { act = parseActivityFile(item.name, item.text); } catch { act = null; }
      if (!act || !act.dist || !act.dur) { skipped++; continue; }
      // 重複ガード：同じ日付かつ距離がほぼ同じなら取り込まない
      if (logs.some((l) => l.date === act.date && Math.abs((l.dist || 0) - act.dist) < 0.05)) {
        skipped++; continue;
      }
      const type = classify({ type: "Run", workout_type: 0, total_elevation_gain: act.gain }, act.dist, act.dur);
      logs.unshift({
        id: "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        date: act.date, type, dist: act.dist, dur: act.dur,
        avgHR: act.avgHR, maxHR: act.maxHR, gain: act.gain, descent: 0,
        note: (act.name || item.name) + "（ファイル取込）",
      });
      added++;
    }
    if (added) { commit({ ...state, logs }); setTab("status"); }
    return { added, skipped };
  }

  function changeLogType(id, type) {
    commit({ ...state, logs: state.logs.map((l) => (l.id === id ? { ...l, type } : l)) });
  }

  function editLog(id, patch) {
    commit({
      ...state,
      logs: state.logs.map((l) =>
        l.id === id
          ? { ...l, ...patch, dist: +patch.dist || 0, dur: +patch.dur || 0, gain: +patch.gain || 0, avgHR: +patch.avgHR || 0, maxHR: +patch.maxHR || 0 }
          : l
      ),
    });
  }

  function deleteLog(id) {
    if (!window.confirm("この記録を削除しますか？")) return;
    commit({ ...state, logs: state.logs.filter((l) => l.id !== id) });
  }

  // カスタムミッションのみ手動トグル（既定m1〜m5はログから自動判定）
  function toggleMission(id) {
    commit({ ...state, missions: state.missions.map((m) => (m.id === id ? { ...m, done: !m.done } : m)) });
  }

  function reEvaluate() {
    commit({ ...state }); // withRecalc が evaluateMissions を実行
  }

  function addMission(m) {
    const mission = {
      id: "c_" + Date.now(),
      label: m.label || "カスタムミッション",
      attr: m.attr || "aerobic",
      inc: +m.inc || 2,
      bonus: +m.bonus || 100,
      done: false,
      custom: true,
    };
    commit({ ...state, missions: [...state.missions, mission] });
  }

  function removeMission(id) {
    commit({ ...state, missions: state.missions.filter((m) => m.id !== id) });
  }

  function updateSettings(patch) {
    const next = { ...state, ...patch };
    if (patch.maxHR != null) next.maxHR = Math.max(120, Math.min(230, +patch.maxHR || 198));
    if (patch.vdot != null) next.vdot = Math.max(VDOT_MIN, Math.min(VDOT_MAX, Math.round(+patch.vdot)));
    commit(next); // maxHR変更時はxp・statsも再計算される
  }

  function updateVdot(v) {
    saveState({ ...state, vdot: Math.max(VDOT_MIN, Math.min(VDOT_MAX, Math.round(v)) ) });
  }

  function resetAll() {
    if (!window.confirm("すべてのデータを初期状態（利尻シード・VDOT50）に戻します。よろしいですか？")) return;
    saveState({
      maxHR: 198,
      vdot: 50,
      raceName: "北海道マラソン", raceDate: "",
      logs: SEED_LOGS.map((l) => ({ ...l, xp: calcXP(l, l.maxHR || 198) })),
      stats: { ...SEED_STATS },
      missions: SEED_MISSIONS.map((m) => ({ ...m })),
    });
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `poppo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.logs)) throw new Error("invalid");
      commit({ maxHR: 198, vdot: 50, raceName: "北海道マラソン", raceDate: "", missions: [], ...data });
      setBanner({ kind: "ok", text: "バックアップを復元しました。" });
    } catch {
      setBanner({ kind: "err", text: "バックアップの読み込みに失敗しました（JSON形式を確認）。" });
    }
  }

  return (
    <div className="min-h-screen text-white" style={{ background: "#0a0e15" }}>
      <div className="mx-auto max-w-md px-4 pb-28 pt-5">
        {/* ヘッダー */}
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight">POPPO TRAINING LOG</h1>
            <p className="text-xs text-white/50">{rankTitle(totals.level)} ・ サブ3への道</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={autoSync}
              disabled={syncing}
              className={`${btn} border border-white/10 bg-white/5 flex items-center gap-1`}
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "同期中" : "同期"}
            </button>
            <button
              onClick={() => setTab(tab === "settings" ? "status" : "settings")}
              className={`${btn} border border-white/10 ${tab === "settings" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5"}`}
              aria-label="設定"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {banner && (
          <div
            className={`mb-4 rounded-xl px-3 py-2 text-sm ${
              banner.kind === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
            }`}
          >
            {banner.text}
          </div>
        )}

        {tab === "status" && <StatusTab state={state} totals={totals} />}
        {tab === "log" && <LogTab onAdd={addLog} onImport={importFiles} />}
        {tab === "history" && (
          <HistoryTab state={state} onChangeType={changeLogType} onEdit={editLog} onDelete={deleteLog} />
        )}
        {tab === "missions" && (
          <MissionsTab
            state={state}
            onToggle={toggleMission}
            onReEvaluate={reEvaluate}
            onAddMission={addMission}
            onRemoveMission={removeMission}
          />
        )}
        {tab === "pace" && <PaceTab state={state} onUpdateVdot={updateVdot} />}
        {tab === "settings" && (
          <SettingsTab state={state} onUpdate={updateSettings} onExport={exportBackup} onImport={importBackup} onResetAll={resetAll} />
        )}
      </div>

      {/* 下部ナビ */}
      <nav className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0a0e15]/95 backdrop-blur">
        <div className="mx-auto flex max-w-md">
          {TABS.map((t) => {
            const Active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] ${
                  Active ? "text-emerald-400" : "text-white/45"
                }`}
              >
                <t.Icon className="h-5 w-5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// 日付文字列(YYYY-MM-DD)の週始まり(月曜)を返す
function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

// ── ステータス（RPG）──
function StatusTab({ state, totals }) {
  const radarData = ATTRS.map((a) => ({ attr: a.short, value: state.stats[a.key] ?? 0 }));
  const pct = Math.min(100, Math.round((totals.into / totals.req) * 100));
  const connected = (state.logs || []).some((l) => String(l.id).startsWith("st_"));

  // レースまでの日数
  const daysToRace = useMemo(() => {
    if (!state.raceDate) return null;
    const ms = new Date(state.raceDate + "T00:00:00") - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
    return Math.round(ms / 86400000);
  }, [state.raceDate]);

  // 週間距離（直近10週）と 週間XP
  const trend = useMemo(() => {
    const byWeek = {};
    for (const l of state.logs || []) {
      if (!l.date) continue;
      const wk = mondayOf(l.date);
      if (!byWeek[wk]) byWeek[wk] = { week: wk, km: 0, xp: 0 };
      byWeek[wk].km += l.dist || 0;
      byWeek[wk].xp += l.xp || 0;
    }
    const weeks = Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week));
    const last = weeks.slice(-10).map((w) => ({ ...w, km: +w.km.toFixed(1), label: w.week.slice(5) }));
    let cum = 0;
    const cumXP = weeks.map((w) => { cum += w.xp; return { label: w.week.slice(5), xp: cum }; }).slice(-12);
    return { weekly: last, cumXP, thisWeekKm: (byWeek[mondayOf(new Date().toISOString().slice(0, 10))]?.km || 0) };
  }, [state.logs]);

  return (
    <div className="space-y-4">
      {/* レベルカード */}
      <div className={card}>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-white/50">レベル</p>
            <p className="text-4xl font-black leading-none">{totals.level}</p>
            <p className="mt-1 text-sm text-emerald-400">{rankTitle(totals.level)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/50">累計XP</p>
            <p className="text-2xl font-bold">{totals.totalXP.toLocaleString()}</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-white/50">
            <span>次のレベルまで</span>
            <span>{totals.into} / {totals.req}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* レースカウントダウン */}
      {state.raceDate && (
        <div className={`${card} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-cyan-400" />
            <div>
              <p className="text-sm font-medium">{state.raceName || "目標レース"}</p>
              <p className="text-[11px] text-white/50">{state.raceDate}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black leading-none text-cyan-400">
              {daysToRace >= 0 ? daysToRace : "—"}
            </p>
            <p className="text-[11px] text-white/50">{daysToRace >= 0 ? "日前" : "終了"}</p>
          </div>
        </div>
      )}

      {/* Strava連携 */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-orange-400" />
            <span className="text-sm font-medium">Strava連携</span>
          </div>
          <span className={`text-xs ${connected ? "text-emerald-400" : "text-white/40"}`}>
            {connected ? "取込実績あり" : "未連携"}
          </span>
        </div>
        <button
          onClick={() => { window.location.href = "/api/strava/auth"; }}
          className={`${btn} mt-3 w-full bg-orange-500/90 text-white hover:bg-orange-500`}
        >
          Stravaと連携する
        </button>
        <p className="mt-2 text-[11px] text-white/40">
          連携後はウォッチのランが起動時・「同期」で自動取込されます（連携時点以降のみ／利尻の二重計上なし）。
        </p>
      </div>

      {/* 能力値レーダー */}
      <div className={card}>
        <p className="mb-2 text-sm font-medium">能力値</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="rgba(255,255,255,0.12)" />
              <PolarAngleAxis dataKey="attr" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="value" stroke="#34d399" fill="#34d399" fillOpacity={0.35} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {ATTRS.map((a) => (
            <div key={a.key} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-white/70">
                <a.Icon className="h-3.5 w-3.5" style={{ color: a.color }} />
                {a.label}
              </span>
              <span className="text-sm font-bold tabular-nums" style={{ color: a.color }}>
                {(state.stats[a.key] ?? 0).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 推移グラフ */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">週間距離</p>
          <p className="text-[11px] text-white/50">今週 {trend.thisWeekKm.toFixed(1)}km</p>
        </div>
        <div className="mt-2 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend.weekly} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#11161f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#fff" }} cursor={{ fill: "rgba(255,255,255,0.05)" }}
                formatter={(v) => [`${v}km`, "距離"]}
              />
              <Bar dataKey="km" fill="#34d399" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-3 mb-1 text-sm font-medium">累計XP推移</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend.cumXP} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#11161f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#fff" }} formatter={(v) => [v.toLocaleString(), "累計XP"]}
              />
              <Line type="monotone" dataKey="xp" stroke="#22d3ee" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── 記録 ──
function LogTab({ onAdd, onImport }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    date: today, type: "easy", dist: "", dur: "", avgHR: "", maxHR: "", gain: "", note: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/60";

  const previewXP = useMemo(() => {
    if (WORKOUTS[form.type]?.typeBonus === 0) return 0;
    return calcXP(
      { type: form.type, dist: +form.dist || 0, dur: +form.dur || 0, gain: +form.gain || 0, avgHR: +form.avgHR || 0, maxHR: +form.maxHR || 0 },
      198
    );
  }, [form]);

  return (
    <div className="space-y-4">
      {/* ファイル取込（Strava API不要・無料）*/}
      <div className={card}>
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-orange-400" />
          <p className="text-sm font-medium">ファイルから取込（GPX / TCX / ZIP）</p>
        </div>
        <p className="mt-1 text-[11px] text-white/40">
          GPX/TCX単体でも、Stravaの<b>一括エクスポートZIPを丸ごと</b>選んでもOK。中身を自動展開して距離・時間・標高・心拍を計算しXPに反映します。重複は自動スキップ・複数選択可。
        </p>
        <label className={`${btn} mt-3 block w-full cursor-pointer bg-orange-500/90 text-center text-white hover:bg-orange-500`}>
          ファイル / ZIP を選んで取り込む
          <input
            type="file"
            accept=".gpx,.tcx,.zip,.gz,application/gpx+xml,application/xml,text/xml,application/zip,application/gzip"
            multiple
            className="hidden"
            onChange={(e) => { onImport(e.target.files); e.target.value = ""; }}
          />
        </label>
      </div>

      <div className={card}>
        <p className="mb-3 text-sm font-medium">手入力で記録</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-white/50">種別</label>
            <select className={input} value={form.type} onChange={set("type")}>
              {TYPE_KEYS.map((k) => (
                <option key={k} value={k}>{WORKOUTS[k].label}（{WORKOUTS[k].tag}）</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="日付"><input type="date" className={input} value={form.date} onChange={set("date")} /></Field>
            <Field label="距離 (km)"><input type="number" inputMode="decimal" className={input} value={form.dist} onChange={set("dist")} placeholder="10" /></Field>
            <Field label="時間 (分)"><input type="number" inputMode="decimal" className={input} value={form.dur} onChange={set("dur")} placeholder="50" /></Field>
            <Field label="獲得標高 (m)"><input type="number" inputMode="numeric" className={input} value={form.gain} onChange={set("gain")} placeholder="0" /></Field>
            <Field label="平均HR"><input type="number" inputMode="numeric" className={input} value={form.avgHR} onChange={set("avgHR")} placeholder="150" /></Field>
            <Field label="最大HR"><input type="number" inputMode="numeric" className={input} value={form.maxHR} onChange={set("maxHR")} placeholder="175" /></Field>
          </div>
          <Field label="メモ"><input className={input} value={form.note} onChange={set("note")} placeholder="今日の感触など" /></Field>

          <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2 text-sm">
            <span className="text-white/60">獲得予定XP</span>
            <span className="font-bold text-emerald-400">+{previewXP}</span>
          </div>

          <button onClick={() => onAdd(form)} className={`${btn} w-full bg-emerald-500 text-black hover:bg-emerald-400`}>
            記録する
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-white/50">{label}</label>
      {children}
    </div>
  );
}

// ── 履歴（種別修正・編集・削除）──
function HistoryTab({ state, onChangeType, onEdit, onDelete }) {
  const logs = state.logs || [];
  const [editId, setEditId] = useState(null);
  return (
    <div className="space-y-3">
      {logs.length === 0 && <div className={`${card} text-center text-sm text-white/50`}>記録がありません</div>}
      {logs.map((l) =>
        editId === l.id ? (
          <LogEditor
            key={l.id}
            log={l}
            onCancel={() => setEditId(null)}
            onSave={(patch) => { onEdit(l.id, patch); setEditId(null); }}
          />
        ) : (
          <div key={l.id} className={card}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span>{l.date}</span>
                  {String(l.id).startsWith("st_") && <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-orange-300">Strava</span>}
                  {String(l.id).startsWith("f_") && <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-cyan-300">ファイル</span>}
                </div>
                <p className="mt-0.5 truncate text-sm font-medium">{l.note || WORKOUTS[l.type]?.label}</p>
              </div>
              <span className="shrink-0 text-sm font-bold text-emerald-400">+{l.xp || 0}XP</span>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px] text-white/60">
              <Cell k="距離" v={l.dist ? `${l.dist}km` : "—"} />
              <Cell k="時間" v={l.dur ? `${Math.round(l.dur)}分` : "—"} />
              <Cell k="ペース" v={fmtPace(l.dur, l.dist)} />
              <Cell k="標高" v={l.gain ? `${l.gain}m` : "—"} />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <select
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-emerald-400/60"
                value={l.type}
                onChange={(e) => onChangeType(l.id, e.target.value)}
              >
                {TYPE_KEYS.map((k) => (
                  <option key={k} value={k}>{WORKOUTS[k].label}</option>
                ))}
              </select>
              <button onClick={() => setEditId(l.id)} className={`${btn} border border-white/10 bg-white/5 px-2.5 py-1.5`} aria-label="編集">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onDelete(l.id)} className={`${btn} border border-rose-500/30 text-rose-300 px-2.5 py-1.5`} aria-label="削除">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function LogEditor({ log, onSave, onCancel }) {
  const [f, setF] = useState({
    date: log.date || "", dist: log.dist ?? "", dur: log.dur ?? "",
    gain: log.gain ?? "", avgHR: log.avgHR ?? "", maxHR: log.maxHR ?? "", note: log.note || "",
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/60";
  return (
    <div className={`${card} border-emerald-400/30`}>
      <p className="mb-2 text-sm font-medium">記録を編集</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="日付"><input type="date" className={input} value={f.date} onChange={set("date")} /></Field>
        <Field label="距離 (km)"><input type="number" inputMode="decimal" className={input} value={f.dist} onChange={set("dist")} /></Field>
        <Field label="時間 (分)"><input type="number" inputMode="decimal" className={input} value={f.dur} onChange={set("dur")} /></Field>
        <Field label="獲得標高 (m)"><input type="number" inputMode="numeric" className={input} value={f.gain} onChange={set("gain")} /></Field>
        <Field label="平均HR"><input type="number" inputMode="numeric" className={input} value={f.avgHR} onChange={set("avgHR")} /></Field>
        <Field label="最大HR"><input type="number" inputMode="numeric" className={input} value={f.maxHR} onChange={set("maxHR")} /></Field>
      </div>
      <Field label="メモ"><input className={input} value={f.note} onChange={set("note")} /></Field>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onSave(f)} className={`${btn} flex-1 bg-emerald-500 text-black hover:bg-emerald-400`}>保存</button>
        <button onClick={onCancel} className={`${btn} border border-white/10 bg-white/5`}>キャンセル</button>
      </div>
    </div>
  );
}

function Cell({ k, v }) {
  return (
    <div className="rounded-lg bg-white/[0.03] py-1.5">
      <div className="text-[10px] text-white/40">{k}</div>
      <div className="font-medium text-white/80">{v}</div>
    </div>
  );
}

// ── ミッション（既定は今週のログから自動判定 / カスタムは手動）──
function MissionsTab({ state, onToggle, onReEvaluate, onAddMission, onRemoveMission }) {
  const missions = state.missions || [];
  const presets = missions.filter((m) => !m.custom);
  const customs = missions.filter((m) => m.custom);
  const doneCount = missions.filter((m) => m.done).length;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", attr: "aerobic", inc: 2, bonus: 100 });
  const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/60";

  const Row = ({ m, auto }) => {
    const a = ATTRS.find((x) => x.key === m.attr);
    return (
      <div className={`${card} flex w-full items-center justify-between ${m.done ? "border-emerald-400/40 bg-emerald-500/[0.07]" : ""}`}>
        <button
          onClick={() => !auto && onToggle(m.id)}
          disabled={auto}
          className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${m.done ? "border-emerald-400 bg-emerald-400 text-black" : "border-white/20"}`}>
            {m.done && "✓"}
          </span>
          <div>
            <p className={`text-sm ${m.done ? "text-white/60 line-through" : ""}`}>{m.label}</p>
            <p className="text-[11px]" style={{ color: a?.color }}>
              {a?.label} +{m.inc} ・ ボーナス +{m.bonus}XP{auto ? " ・ 自動判定" : ""}
            </p>
          </div>
        </button>
        {m.custom && (
          <button onClick={() => onRemoveMission(m.id)} className="ml-2 text-rose-300/70 hover:text-rose-300" aria-label="削除">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className={`${card} flex items-center justify-between`}>
        <div>
          <p className="text-sm font-medium">今週のミッション</p>
          <p className="text-xs text-white/50">{doneCount} / {missions.length} 達成</p>
        </div>
        <button onClick={onReEvaluate} className={`${btn} border border-white/10 bg-white/5 flex items-center gap-1`}>
          <RotateCcw className="h-3.5 w-3.5" /> 再判定
        </button>
      </div>

      <p className="px-1 text-[11px] text-white/40">既定ミッションは今週のログから自動で達成判定されます。</p>
      {presets.map((m) => <Row key={m.id} m={m} auto />)}

      {customs.length > 0 && <p className="px-1 pt-1 text-[11px] text-white/40">カスタムミッション（タップで達成切替）</p>}
      {customs.map((m) => <Row key={m.id} m={m} auto={false} />)}

      {/* カスタムミッション追加 */}
      {adding ? (
        <div className={`${card} space-y-3`}>
          <Field label="内容"><input className={input} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="例: ウィンドスプリント 6本" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-white/50">能力</label>
              <select className={input} value={form.attr} onChange={(e) => setForm((f) => ({ ...f, attr: e.target.value }))}>
                {ATTRS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
            <Field label="能力+"><input type="number" className={input} value={form.inc} onChange={(e) => setForm((f) => ({ ...f, inc: e.target.value }))} /></Field>
            <Field label="XP"><input type="number" className={input} value={form.bonus} onChange={(e) => setForm((f) => ({ ...f, bonus: e.target.value }))} /></Field>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { if (form.label.trim()) { onAddMission(form); setForm({ label: "", attr: "aerobic", inc: 2, bonus: 100 }); setAdding(false); } }}
              className={`${btn} flex-1 bg-emerald-500 text-black hover:bg-emerald-400`}
            >追加</button>
            <button onClick={() => setAdding(false)} className={`${btn} border border-white/10 bg-white/5`}>やめる</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={`${btn} w-full border border-white/10 bg-white/5 flex items-center justify-center gap-1`}>
          <Plus className="h-4 w-4" /> ミッションを追加
        </button>
      )}

      {/* 補強メニュー提案 */}
      <div className={card}>
        <div className="mb-2 flex items-center gap-2">
          <Dumbbell className="h-4 w-4 text-amber-400" />
          <p className="text-sm font-medium">補強メニュー提案（ウェイト/クロス）</p>
        </div>
        <p className="mb-2 text-[11px] text-white/40">弱点（登坂/下り）と故障予防に。記録は種別「筋トレ / クロス」で残すとXPになります。</p>
        <div className="space-y-2">
          {STRENGTH_PLAN.map((g) => (
            <div key={g.group} className="rounded-xl bg-white/[0.03] px-3 py-2">
              <p className="text-xs font-medium text-amber-300">{g.group}</p>
              <ul className="mt-1 space-y-0.5">
                {g.items.map((it) => <li key={it} className="text-[11px] text-white/70">・{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ペース（VDOT・公式換算表）──
function PaceTab({ state, onUpdateVdot }) {
  const P = paceSet(state.vdot);
  const gap = SUB3_VDOT - state.vdot;

  const RACES = [
    { key: "5000", label: "5km", m: 5000 },
    { key: "10000", label: "10km", m: 10000 },
    { key: "half", label: "ハーフ", m: 21097.5 },
    { key: "full", label: "フル", m: 42195 },
  ];
  const [race, setRace] = useState({ dist: "5000", h: "", m: "", s: "" });
  const setR = (k) => (e) => setRace((r) => ({ ...r, [k]: e.target.value }));

  const calcVdot = useMemo(() => {
    const distM = RACES.find((r) => r.key === race.dist)?.m || 0;
    const totalMin = (+race.h || 0) * 60 + (+race.m || 0) + (+race.s || 0) / 60;
    if (!distM || !totalMin) return 0;
    return Math.round(vdotFromRace(distM, totalMin));
  }, [race]);

  const rows = [
    { z: "E", k: "ゆるジョグ/イージー/ロング", pace: P.E, hint: "会話できる強度。土台づくり" },
    { z: "M", k: "マラソンペース（道マラ本番）", pace: P.M, hint: "12〜16km 連続走で慣らす" },
    { z: "T", k: "テンポ/閾値走（弱点強化）", pace: P.T, hint: "20分連続 or 8分×3（つなぎjog）" },
    { z: "I", k: "インターバル（弱点強化）", pace: P.I, hint: "1000m×5（間400mjog）" },
    { z: "R", k: "レペティション/流し", pace: P.R, hint: "200m×8（しっかり休む）" },
  ];

  const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/60";

  return (
    <div className="space-y-4">
      {/* 現状サマリ */}
      <div className={card}>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-white/50">現在のVDOT</p>
            <p className="text-4xl font-black leading-none">{state.vdot}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/50">サブ3に必要</p>
            <p className="text-2xl font-bold text-emerald-400">{SUB3_VDOT}</p>
            <p className="text-[11px] text-white/50">{gap > 0 ? `あと ${gap.toFixed(0)}` : "到達！"}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px]">
          <RaceCell k="フル" v={P.race.marathon} />
          <RaceCell k="ハーフ" v={P.race.half} />
          <RaceCell k="10km" v={P.race.tenK} />
          <RaceCell k="5km" v={P.race.fiveK} />
        </div>
        <p className="mt-2 text-[10px] text-white/40">現VDOTでのレース予想タイム（公式換算表より）</p>
      </div>

      {/* 今週の練習方針（VDOT差から） */}
      {(() => {
        const plan = weeklyFocus(gap);
        let days = null;
        if (state.raceDate) {
          const ms = new Date(state.raceDate + "T00:00:00") - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
          days = Math.round(ms / 86400000);
        }
        return (
          <div className={card}>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-400" />
              <p className="text-sm font-medium">今週の練習方針</p>
            </div>
            {days != null && days >= 0 && (
              <p className="mt-1 text-[11px] text-cyan-300">{state.raceName || "目標レース"}まで あと{days}日</p>
            )}
            <p className="mt-2 text-sm font-bold text-emerald-300">{plan.focus}</p>
            <p className="mt-1 text-[11px] text-white/60">{plan.detail}</p>
            <p className="mt-2 text-[10px] text-white/40">
              {gap > 0 ? `サブ3まで VDOT あと${gap.toFixed(0)}` : "サブ3ライン到達。仕上げフェーズ。"}
            </p>
          </div>
        );
      })()}

      {/* 練習ペース表 */}
      <div className={card}>
        <p className="mb-2 text-sm font-medium">練習ペース（/km）</p>
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.z} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-sm font-black text-emerald-400">
                {r.z}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-white/80">{r.k}</p>
                <p className="text-[10px] text-white/40">{r.hint}</p>
              </div>
              <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{r.pace}</span>
            </div>
          ))}
        </div>
      </div>

      {/* レース入力でVDOT更新 */}
      <div className={card}>
        <p className="mb-2 text-sm font-medium">レース結果からVDOTを更新</p>
        <div className="grid grid-cols-4 gap-2">
          <div className="col-span-1">
            <label className="mb-1 block text-[11px] text-white/50">距離</label>
            <select className={input} value={race.dist} onChange={setR("dist")}>
              {RACES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <Field label="時"><input type="number" inputMode="numeric" className={input} value={race.h} onChange={setR("h")} placeholder="0" /></Field>
          <Field label="分"><input type="number" inputMode="numeric" className={input} value={race.m} onChange={setR("m")} placeholder="19" /></Field>
          <Field label="秒"><input type="number" inputMode="numeric" className={input} value={race.s} onChange={setR("s")} placeholder="56" /></Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-white/60">算出VDOT <b className="text-white">{calcVdot || "—"}</b></span>
          <button
            onClick={() => calcVdot && onUpdateVdot(calcVdot)}
            disabled={!calcVdot}
            className={`${btn} bg-emerald-500 text-black hover:bg-emerald-400`}
          >
            このVDOTで更新
          </button>
        </div>
        <p className="mt-2 text-[10px] text-white/40">
          ※ 利尻53km等のウルトラは超低強度でVDOT算出に不向きです。直近の5km〜ハーフ、またはTT（タイムトライアル）で更新してください。デフォルトはVDOT50。
        </p>
      </div>

      {/* 心拍ゾーン */}
      <div className={card}>
        <div className="mb-2 flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-rose-400" />
          <p className="text-sm font-medium">心拍ゾーン（最大HR {state.maxHR} 基準）</p>
        </div>
        <div className="space-y-1.5">
          {hrZones(state.maxHR || 198).map((z) => (
            <div key={z.z} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
              <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-xs font-black text-rose-300">
                {z.z}
              </span>
              <span className="flex-1 text-xs text-white/80">{z.name}</span>
              <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{z.loB}–{z.hiB}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-white/40">最大HRは設定（右上⚙）で変更できます。Eペース=Z2、Mペース=Z3、Tペース=Z4が目安。</p>
      </div>
    </div>
  );
}

function RaceCell({ k, v }) {
  return (
    <div className="rounded-lg bg-white/[0.03] py-1.5">
      <div className="text-[10px] text-white/40">{k}</div>
      <div className="font-mono font-bold tabular-nums text-white/90">{v}</div>
    </div>
  );
}

// ── 設定 ──
function SettingsTab({ state, onUpdate, onExport, onImport, onResetAll }) {
  const [f, setF] = useState({
    maxHR: state.maxHR ?? 198,
    vdot: state.vdot ?? 50,
    raceName: state.raceName ?? "",
    raceDate: state.raceDate ?? "",
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-emerald-400/60";

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="mb-3 text-sm font-medium">基本設定</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="最大心拍 (maxHR)"><input type="number" inputMode="numeric" className={input} value={f.maxHR} onChange={set("maxHR")} /></Field>
          <Field label="VDOT"><input type="number" inputMode="numeric" className={input} value={f.vdot} onChange={set("vdot")} /></Field>
          <Field label="目標レース名"><input className={input} value={f.raceName} onChange={set("raceName")} placeholder="北海道マラソン" /></Field>
          <Field label="レース日"><input type="date" className={input} value={f.raceDate} onChange={set("raceDate")} /></Field>
        </div>
        <button
          onClick={() => onUpdate({ maxHR: f.maxHR, vdot: f.vdot, raceName: f.raceName, raceDate: f.raceDate })}
          className={`${btn} mt-3 w-full bg-emerald-500 text-black hover:bg-emerald-400`}
        >
          設定を保存
        </button>
        <p className="mt-2 text-[10px] text-white/40">最大心拍を変えると全記録のXP・能力値が再計算されます。</p>
      </div>

      <div className={card}>
        <p className="mb-1 text-sm font-medium">バックアップ</p>
        <p className="mb-3 text-[11px] text-white/40">データはUpstashに保存されますが、JSONで手元にも保存できます（保険・端末移行用）。</p>
        <div className="flex gap-2">
          <button onClick={onExport} className={`${btn} flex-1 border border-white/10 bg-white/5 flex items-center justify-center gap-1`}>
            <Download className="h-4 w-4" /> 書き出し
          </button>
          <label className={`${btn} flex-1 cursor-pointer border border-white/10 bg-white/5 flex items-center justify-center gap-1`}>
            <Upload className="h-4 w-4" /> 復元
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { if (e.target.files[0]) onImport(e.target.files[0]); e.target.value = ""; }}
            />
          </label>
        </div>
      </div>

      <div className={card}>
        <p className="mb-3 text-sm font-medium text-rose-300">危険な操作</p>
        <button onClick={onResetAll} className={`${btn} w-full border border-rose-500/30 text-rose-300 hover:bg-rose-500/10`}>
          すべてのデータを初期化
        </button>
      </div>
    </div>
  );
}
