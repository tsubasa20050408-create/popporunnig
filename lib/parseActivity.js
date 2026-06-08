// GPX / TCX ファイルをブラウザ内で解析してアクティビティ情報を取り出す。
// Strava APIを使わない完全無料の取込経路。サーバー不要（DOMParserはブラウザ標準）。
//
// 返り値: { date, dist(km), dur(min), gain(m), avgHR, maxHR, name } または null

function haversine(la1, lo1, la2, lo2){
  const R = 6371000, toR = Math.PI / 180;
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR;
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function summarize(times, dist, gain, hrs, name){
  if(!times.length) return null;
  times.sort((a, b) => a - b);
  const durMin = (times[times.length - 1] - times[0]) / 60000;
  const avgHR = hrs.length ? Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length) : 0;
  const maxHR = hrs.length ? Math.max(...hrs) : 0;
  return {
    date: new Date(times[0]).toISOString().slice(0, 10),
    dist: +(dist / 1000).toFixed(2),
    dur: +durMin.toFixed(2),
    gain: Math.round(gain),
    avgHR, maxHR,
    name: name || "",
  };
}

function localHR(pt){
  // 名前空間付き(gpxtpx:hr / ns3:hr 等)に対応するため localName で探す
  for(const el of pt.getElementsByTagName("*")){
    if(el.localName === "hr" || el.localName === "HeartRateBpm" || el.localName === "Value"){
      const v = +el.textContent;
      if(v) return v;
    }
  }
  return null;
}

export function parseGpx(text){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const pts = [...doc.getElementsByTagName("trkpt")];
  if(!pts.length) return null;
  const nameEl = doc.getElementsByTagName("name")[0];
  let dist = 0, gain = 0, prevLat = null, prevLon = null, prevEle = null;
  const times = [], hrs = [];
  for(const pt of pts){
    const lat = +pt.getAttribute("lat"), lon = +pt.getAttribute("lon");
    const eleEl = pt.getElementsByTagName("ele")[0];
    const ele = eleEl ? +eleEl.textContent : null;
    const timeEl = pt.getElementsByTagName("time")[0];
    if(timeEl){ const t = new Date(timeEl.textContent); if(!isNaN(t)) times.push(t); }
    const hr = localHR(pt); if(hr) hrs.push(hr);
    if(prevLat != null && !isNaN(lat) && !isNaN(lon)) dist += haversine(prevLat, prevLon, lat, lon);
    if(prevEle != null && ele != null && ele > prevEle) gain += ele - prevEle;
    if(!isNaN(lat)) prevLat = lat;
    if(!isNaN(lon)) prevLon = lon;
    if(ele != null) prevEle = ele;
  }
  return summarize(times, dist, gain, hrs, nameEl ? nameEl.textContent : "");
}

export function parseTcx(text){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const pts = [...doc.getElementsByTagName("Trackpoint")];
  if(!pts.length) return null;
  let firstDist = null, lastDist = null, gain = 0, prevEle = null;
  const times = [], hrs = [];
  for(const pt of pts){
    const timeEl = pt.getElementsByTagName("Time")[0];
    if(timeEl){ const t = new Date(timeEl.textContent); if(!isNaN(t)) times.push(t); }
    const dEl = pt.getElementsByTagName("DistanceMeters")[0];
    if(dEl){ const d = +dEl.textContent; if(firstDist == null) firstDist = d; lastDist = d; }
    const aEl = pt.getElementsByTagName("AltitudeMeters")[0];
    const ele = aEl ? +aEl.textContent : null;
    if(prevEle != null && ele != null && ele > prevEle) gain += ele - prevEle;
    if(ele != null) prevEle = ele;
    const hr = localHR(pt); if(hr) hrs.push(hr);
  }
  const dist = (lastDist != null && firstDist != null) ? lastDist - firstDist : 0;
  return summarize(times, dist, gain, hrs, "");
}

export function parseActivityFile(name, text){
  if(text.includes("<TrainingCenterDatabase")) return parseTcx(text);
  if(text.includes("<gpx")) return parseGpx(text);
  // 拡張子フォールバック
  if(name.toLowerCase().endsWith(".tcx")) return parseTcx(text);
  return parseGpx(text);
}
