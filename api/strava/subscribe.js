// Strava Webhook（Push Subscription）をブラウザだけで管理するための補助エンドポイント。
// 無料枠で使える。アプリは自分だけ＝購読は1つだけ。
//
//   GET /api/strava/subscribe              現在の購読状況を表示
//   GET /api/strava/subscribe?action=create  購読を作成（StravaがwebhookへGET検証を送る）
//   GET /api/strava/subscribe?action=delete&id=123  購読を削除
//
// 環境変数: STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / APP_URL / STRAVA_VERIFY_TOKEN

const BASE = "https://www.strava.com/api/v3/push_subscriptions";

export default async function handler(req, res){
  const client_id = process.env.STRAVA_CLIENT_ID;
  const client_secret = process.env.STRAVA_CLIENT_SECRET;
  const verify_token = process.env.STRAVA_VERIFY_TOKEN || "poppo";
  const callback_url = `${process.env.APP_URL}/api/strava/webhook`;
  const action = req.query.action || "view";

  if(!client_id || !client_secret || !process.env.APP_URL){
    return res.status(500).json({ error: "missing_env", need: ["STRAVA_CLIENT_ID","STRAVA_CLIENT_SECRET","APP_URL"] });
  }

  try {
    if(action === "create"){
      const body = new URLSearchParams({ client_id, client_secret, callback_url, verify_token });
      const r = await fetch(BASE, { method: "POST", body });
      const d = await r.json();
      return res.status(r.status).json({ action: "create", callback_url, result: d });
    }

    if(action === "delete"){
      const id = req.query.id;
      if(!id) return res.status(400).json({ error: "id_required" });
      const url = `${BASE}/${id}?client_id=${client_id}&client_secret=${client_secret}`;
      const r = await fetch(url, { method: "DELETE" });
      return res.status(r.status).json({ action: "delete", id, ok: r.ok });
    }

    // view（既定）
    const url = `${BASE}?client_id=${client_id}&client_secret=${client_secret}`;
    const r = await fetch(url);
    const d = await r.json();
    return res.status(200).json({
      action: "view",
      callback_url,
      subscriptions: d,
      hint: Array.isArray(d) && d.length === 0
        ? "購読がありません。?action=create を開いて作成してください。"
        : "購読済みです。新しいランは自動で取り込まれます。",
    });
  } catch (e) {
    return res.status(502).json({ error: "strava_request_failed", detail: String(e) });
  }
}
