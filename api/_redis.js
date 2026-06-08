import { Redis } from "@upstash/redis";
export const redis = Redis.fromEnv();
export const KEYS = {
  state: "ptl:state", token: "ptl:strava:token",
  lastSync: "ptl:strava:lastSync", imported: "ptl:strava:imported",
};
