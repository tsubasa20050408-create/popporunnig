import { redis, KEYS } from "../_redis.js";
import { initialState, calcXP, applyGains, stravaToLog } from "../../lib/training.js";

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

export default async function handler(req, res){
  const token = await getAccessToken();
  if(!token) return res.status(401).json({ error:"not_connected" });
  const last = (await redis.get(KEYS.lastSync)) || 0;
  const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${last}&per_page=50`, { headers:{ Authorization:`Bearer ${token}` } });
  const acts = await r.json();
  if(!Array.isArray(acts)) return res.status(502).json({ error:"strava_fetch_failed", detail:acts });

  const imported = new Set((await redis.get(KEYS.imported)) || []);
  let state = (await redis.get(KEYS.state)) || initialState();
  let added = 0, maxEpoch = last;
  acts.sort((a,b)=> new Date(a.start_date)-new Date(b.start_date));
  for(const a of acts){
    const ep = Math.floor(new Date(a.start_date).getTime()/1000);
    if(ep > maxEpoch) maxEpoch = ep;
    if(imported.has(a.id)) continue;
    const log = stravaToLog(a); log.xp = calcXP(log, state.maxHR || 198);
    state.logs = [log, ...state.logs];
    state.stats = applyGains(state.stats, log.type, log.dur);
    imported.add(a.id); added++;
  }
  await redis.set(KEYS.state, state);
  await redis.set(KEYS.imported, [...imported]);
  await redis.set(KEYS.lastSync, maxEpoch);
  res.status(200).json({ added, state });
}
