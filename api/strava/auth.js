export default function handler(req, res){
  const redirect = encodeURIComponent(`${process.env.APP_URL}/api/strava/callback`);
  const url = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}`
    + `&response_type=code&redirect_uri=${redirect}&approval_prompt=auto&scope=read,activity:read_all`;
  res.writeHead(302, { Location: url }); res.end();
}
