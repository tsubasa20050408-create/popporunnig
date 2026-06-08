import { redis, KEYS } from "../_redis.js";
import { initialState, calcXP, applyGains, stravaToLog } from "../../lib/training.js";

// Phase 2: Strava Webhook で完全自動化
// GET  = 購読検証（hub.challenge をそのまま返す）
// POST = activity create のとき sync 相当を実行

async function getAccessToken(){
  let t = await redis.get(KEYS.token); if(!t) return null;
  if(Math.floor(Date.now()/1000) > t.expires_at - 120){
    const r = await fetch("https://www.strava.com/oauth/token", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ client_id:process.env.STRAVA_CLIENT_ID, client_secret:process.env.STRAVA_CLIENT_SECRET, grant_type:"refresh_token", refresh_token:t.refresh_token }),
    });
    const d = await r.json();
    t = { access_token:d.access_token, refresh_token:d.refresh_token, expires_at:d.expires_at };
    await redis.set(KEYS.token, t);
  }
  return t.access_token;
}

async function syncOne(activityId){
  const token = await getAccessToken(); if(!token) return;
  const r = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, { headers:{ Authorization:`Bearer ${token}` } });
  const a = await r.json(); if(!a || !a.id) return;
  const imported = new Set((await redis.get(KEYS.imported)) || []);
  if(imported.has(a.id)) return;
  let state = (await redis.get(KEYS.state)) || initialState();
  const log = stravaToLog(a); log.xp = calcXP(log, state.maxHR || 198);
  state.logs = [log, ...state.logs];
  state.stats = applyGains(state.stats, log.type, log.dur);
  imported.add(a.id);
  await redis.set(KEYS.state, state);
  await redis.set(KEYS.imported, [...imported]);
}

export default async function handler(req, res){
  if(req.method === "GET"){
    const challenge = req.query["hub.challenge"];
    return res.status(200).json({ "hub.challenge": challenge });
  }
  if(req.method === "POST"){
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if(body && body.object_type === "activity" && body.aspect_type === "create"){
      try { await syncOne(body.object_id); } catch { /* ignore */ }
    }
    return res.status(200).json({ ok:true });
  }
  res.status(405).end();
}
