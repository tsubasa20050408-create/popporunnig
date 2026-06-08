import { redis, KEYS } from "./_redis.js";
import { initialState } from "../lib/training.js";
export default async function handler(req, res){
  if(req.method==="GET"){ const s=await redis.get(KEYS.state); return res.status(200).json(s||initialState()); }
  if(req.method==="POST"){
    const body = typeof req.body==="string" ? JSON.parse(req.body) : req.body;
    await redis.set(KEYS.state, body); return res.status(200).json({ ok:true });
  }
  res.status(405).end();
}
