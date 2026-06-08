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

## Phase 2（任意）: Strava Webhook で完全自動化

`api/strava/webhook.js` を実装済み。購読作成（1回）:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
  -F callback_url=$APP_URL/api/strava/webhook -F verify_token=任意文字列
```

## 補足

- ロジックの単一ソース: XP/レベル/ステータス = `lib/training.js`、VDOTペース = `lib/vdot.js` + `lib/vdotTable.js`
- VDOTペースは式の近似ではなく公式換算表の値をそのまま表示
- データは Upstash 保管。スマホ・PC どの端末からでも同じ状態で開ける
