# POPPO TRAINING LOG

利尻53km解析ベースのトレーニング管理RPGアプリ。Strava自動連携 + ダニエルズVDOTによる練習ペース提案。

- フロント: Vite + React + Tailwind（`src/`）
- バックエンド: Vercel サーバーレス関数 + Upstash Redis（`api/`）
- 共有ロジック: `lib/training.js`（XP/レベル/ステータス）, `lib/vdot.js` + `lib/vdotTable.js`（VDOT公式換算表）

## 機能

1. **RPG** — 利尻53km解析に基づくXP/レベル/能力値（有酸素・持久力・スピード持久・閾値・登坂・下り）
2. **Strava自動連携** — Huaweiウォッチ → Huawei Health → Strava → アプリ自動取込（連携時点以降のみ／利尻の二重計上なし）
3. **VDOTペース提案** — ダニエルズ公式換算表（VDOT30〜90）の値をそのまま表示。サブ3必要VDOT=54
4. **記録の編集・削除**（履歴タブ） / **設定画面**（maxHR・VDOT・目標レース・JSONバックアップ）
5. **推移グラフ**（週間距離・累計XP） / **レースカウントダウン＋今週の練習方針**（VDOT差から提案）
6. **ミッション自動判定**（今週のログから達成を自動検出）＋ **カスタムミッション追加** ＋ **補強(ウェイト)メニュー提案**
7. **心拍ゾーン**（maxHR基準のZ1〜Z5）
8. **自動VDOT更新** — 日々の練習タイム・心拍から自分のVDOTを自動推定して更新（`lib/vdot.js`）
9. **コンディション（負荷管理）** — 体力CTL / 疲労ATL / 調子TSB / 負荷バランスACWR（`lib/load.js`）
10. **自己ベスト(PB)＋走力(VDOT)推移**（`lib/vdot.js`） — 距離別ベスト自動抽出と走力の時系列グラフ
11. **練習プラン自動生成**（`lib/plan.js`） — 現VDOT＋レース日＋週回数 から E/M/T/I/R 週次メニューを逆算
12. **故障予防アラート**（`lib/load.js`） — 単調度Monotony・ACWR・TSB から過負荷/単調/疲労を警告
13. **シューズ管理**（`lib/gear.js`） — 記録にシューズを紐付け走行距離を積算・寿命アラート
14. **ヘルスデータ記録**（`lib/health.js`） — 体重・安静時心拍・睡眠・主観疲労(RPE)。安静時心拍上昇で体調アラート

> 派生値（XP・能力値・ミッション達成・VDOT）はすべて `logs`/`missions`/`maxHR` から `recomputeStats`・`evaluateMissions`・`estimateVdotFromLogs` で再計算するため、編集・削除しても整合します。

### 10〜14（GitHubのランニングOSSを参照して追加）
- **自己ベスト/走力推移**（statistics-for-strava / Runalyze 参照） — `personalBests` は各距離帯(5/10/half/full)で最速の実走を抽出。`vdotTrend` は各ランのVDOT推定を時系列化。
- **練習プラン**（RunCulator / Daniels plan 参照） — `weeklyPlan({vdot, raceDate, daysPerWeek})`。レースまでの週数で土台/ビルド/仕上げ/テーパーに周期化。ペースは公式換算表の値。
- **故障予防**（Runalyze 参照） — `monotony`＝平均/(標準偏差+平均)、`trainingAlerts` が ACWR>1.5・Monotony≥0.8・TSB≤−15 を警告。
- **シューズ管理 / ヘルスデータ**（Endurain 参照） — ギアは `gearId` でログに紐付け、`gearMileage`/`gearAlerts` で寿命管理。ヘルスは `health[]` に体重/安静時心拍/睡眠/RPEを記録、`healthAlerts` が安静時心拍の上昇を検知。

### 8. 自動VDOT更新（`lib/vdot.js`）
- 直近90日の練習ログから、ペース×心拍で**自分のVDOTを自動推定**（ペース→走速の酸素コスト、心拍→%VO2max を求めて逆算）。
- **レース**はダニエルズの式（持続時間ベース）を最優先で採用。その他の**連続走**（イージー/ロング/閾値/インターバル）は心拍ベースで推定し、上位推定の加重平均をとる（外れ値1本に振られない）。
- 精度のため除外: 地形（登坂/下り・獲得標高大）、超長時間（180分超のウルトラ）、距離1.5km未満・15分未満・心拍なし。
- **ペース** タブのトグルで自動ON/OFF。レース結果からの手入力で更新すると自動は一旦OFF（再開可）。
- **表示ペースは常に公式換算表の値**（`vdotFromRace` の係数を流用し推定のみに使用。表の値は不変）。

### 9. コンディション / 負荷管理（`lib/load.js`）
- TrainingPeaks / Garmin / intervals.icu と同じ考え方の簡易版。1日の負荷は既存の `calcXP`（時間・距離・標高・強度・種別を内包）を流用。
- **CTL（体力）** = 42日EMA、**ATL（疲労）** = 7日EMA、**TSB（調子）** = CTL−ATL。**ACWR（急性:慢性 負荷比）** で故障リスクの目安も表示。
- ステータスタブに状態ラベル（回復・好調・鍛錬中・疲労過多）と推移グラフを表示。

## セットアップ

```bash
npm install
```

### 環境変数（Vercel に登録）

`.env.example` を参照。

```
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
APP_URL=https://<your-domain>.vercel.app   # 末尾スラなし
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

### 事前準備（人間が行う）

1. **Strava API アプリ**: https://www.strava.com/settings/api
   - Authorization Callback Domain にデプロイ先ドメイン（ドメインのみ）
   - Client ID / Client Secret を控える
2. **Upstash Redis**: https://upstash.com で作成し REST URL / TOKEN を控える

## ローカル確認

```bash
npm install -g vercel
vercel dev      # フロント + /api/* が動く
```

`npm run dev` は Vite のみ起動します（API は動きません）。API も検証するなら `vercel dev` を使用。

## デプロイ

```bash
vercel --prod
# Settings → Environment Variables に上記5つを登録 → 再度 vercel --prod
```

**重要**: 本番ドメインを `APP_URL` と Strava の Authorization Callback Domain の両方に一致させること（不一致だと OAuth 失敗）。

## 取込方法

Strava API が有料サブスクの裏に入った場合でも使える、**完全無料**の取込経路があります。

### A. ファイル取込（GPX / TCX）— API不要・推奨
1. Strava で対象アクティビティを開く → 「…」→ **「GPXをエクスポート」**
2. アプリの **記録** タブ → **「ファイルを選んで取り込む」** で選択（複数可）
3. 距離・時間・獲得標高・心拍を自動計算し、種別を自動判定して XP・能力値に反映

ブラウザ内で解析（`lib/parseActivity.js`）するためサーバー・API不要。過去のアクティビティもまとめて取り込めます。
Strava の一括ダウンロード（設定 → アカウント → アーカイブをリクエスト）で得た元ファイルも利用できます。

### B. スマホの「共有」から直接取込（PWA Web Share Target）— 半自動・無料
1. アプリをスマホで開き、ブラウザメニューから **「ホーム画面に追加 / アプリをインストール」**（PWA化）
2. Strava や Huawei Health で対象アクティビティを **GPX/TCXで共有**
3. 共有先の一覧に出る **「POPPO TRAINING LOG」** を選ぶ → 自動で取込・XP反映

仕組み: `public/manifest.webmanifest` の `share_target` と `public/sw.js`（Service Worker）が共有ファイルを受け取り、アプリが取込みます。
※ Web Share Target は Chromium系ブラウザ（Android）で動作。iOSは非対応。Huawei端末はブラウザにより可否が異なります（不可なら下のA/手入力を使用）。

### C. 一括ZIP取込 — 手数最小・無料
1. strava.com → 設定 → マイアカウント → **「アカウントの一括エクスポート（アーカイブをリクエスト）」**
2. メールで届くZIPを **そのまま**（解凍せず）アプリの **記録 → 「ファイル / ZIP を選んで取り込む」** で選択
3. ZIP内の `activities/*.gpx`（`.gz`圧縮も可）を自動展開して一括取込・重複自動スキップ

`lib/unzip.js`（ブラウザ標準 `DecompressionStream` 使用・依存ゼロ）でZIP/gzを展開します。
※ ZIP内が `.fit`（FIT形式）の場合は未対応。その活動は除外されます（個別の「GPXをエクスポート」なら必ずGPXで取得可）。

### D. 手入力
**記録** タブのフォームから直接入力。

### C. Strava API 自動連携（要・API利用権限）
API が利用できる場合のみ。OAuth連携 → `/api/strava/sync` で自動取込。Webhookで完全自動化も可（下記）。

---

## Strava Webhook で完全自動化（API利用権限がある場合）

アプリを開いていない時でも、ランが記録された瞬間に自動取込されます（Stravaの無料枠で利用可）。

実装済み:
- `api/strava/webhook.js` — Strava からの通知を受信して同期
- `api/strava/subscribe.js` — 購読をブラウザだけで管理（curl不要）

環境変数に `STRAVA_VERIFY_TOKEN`（任意の文字列、例 `poppo`）を追加して再デプロイ後、ブラウザで開くだけ:

```
購読状況の確認 : https://<your-domain>/api/strava/subscribe
購読の作成     : https://<your-domain>/api/strava/subscribe?action=create
購読の削除     : https://<your-domain>/api/strava/subscribe?action=delete&id=<購読ID>
```

`?action=create` を開いた瞬間に Strava が webhook を検証し、購読が有効になります。
購読は1アプリにつき1つだけ。`{"result":{"id":...}}` が返れば成功です。

開いている間も、アプリを再表示/フォーカスした時に自動同期します。

## 補足

- ロジックの単一ソース: XP/レベル/ステータス = `lib/training.js`、VDOTペース = `lib/vdot.js` + `lib/vdotTable.js`
- VDOTペースは式の近似ではなく公式換算表の値をそのまま表示
- データは Upstash 保管。スマホ・PC どの端末からでも同じ状態で開ける
