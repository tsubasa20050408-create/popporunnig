# POPPO TRAINING LOG

利尻53km解析ベースのトレーニング管理RPGアプリ。Strava自動連携 + ダニエルズVDOTによる練習ペース提案。

- フロント: Vite + React + Tailwind（`src/`）
- バックエンド: Vercel サーバーレス関数 + Upstash Redis（`api/`）
- 共有ロジック: `lib/training.js`（XP/レベル/ステータス）, `lib/vdot.js` + `lib/vdotTable.js`（VDOT公式換算表）

## 機能

1. **RPG** — 利尻53km解析に基づくXP/レベル/能力値（有酸素・持久力・スピード持久・閾値・登坂・下り）
2. **Strava自動連携** — Huaweiウォッチ → Huawei Health → Strava → アプリ自動取込（連携時点以降のみ／利尻の二重計上なし）
3. **VDOTペース提案** — ダニエルズ公式換算表（VDOT30〜90）の値をそのまま表示。サブ3必要VDOT=54

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
