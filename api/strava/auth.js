export default function handler(req, res){
  const clientId = process.env.STRAVA_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  // 環境変数が未設定なら、壊れたStravaへ飛ばさず原因を表示する
  const missing = [];
  if(!clientId) missing.push("STRAVA_CLIENT_ID");
  if(!appUrl) missing.push("APP_URL");
  if(missing.length){
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(500).end(JSON.stringify({
      error: "missing_env",
      missing,
      hint: "VercelのSettings→Environment Variablesに上記をProductionで登録し、再デプロイしてください。値の前後の引用符・空白は不可。",
    }, null, 2));
  }

  const redirect = encodeURIComponent(`${appUrl}/api/strava/callback`);
  const url = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(clientId.trim())}`
    + `&response_type=code&redirect_uri=${redirect}&approval_prompt=auto&scope=read,activity:read_all`;
  res.writeHead(302, { Location: url }); res.end();
}
