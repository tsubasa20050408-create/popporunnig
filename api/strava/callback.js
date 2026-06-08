import { redis, KEYS } from "../_redis.js";
export default async function handler(req, res){
  const code = req.query.code;
  if(!code){ res.writeHead(302,{Location:`${process.env.APP_URL}/?strava=error`}); return res.end(); }
  const r = await fetch("https://www.strava.com/oauth/token", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ client_id:process.env.STRAVA_CLIENT_ID, client_secret:process.env.STRAVA_CLIENT_SECRET, code, grant_type:"authorization_code" }),
  });
  const d = await r.json();
  await redis.set(KEYS.token, { access_token:d.access_token, refresh_token:d.refresh_token, expires_at:d.expires_at });
  await redis.set(KEYS.lastSync, Math.floor(Date.now()/1000)); // 連携時点以降のみ取込（利尻の二重計上防止）
  res.writeHead(302, { Location:`${process.env.APP_URL}/?strava=connected` }); res.end();
}
