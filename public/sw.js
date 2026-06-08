// Service Worker — PWA Web Share Target 受信用。
// スマホの「共有」で送られたGPX/TCXファイルをCacheに保存し、
// アプリ本体（/?share-target=1）へリダイレクトして取り込ませる。

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(handleShare(event.request));
  }
  // それ以外はSWは介入しない（通常どおりネットワーク）
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("file").filter((f) => f && typeof f.text === "function");
    const cache = await caches.open("shared-files");
    const keys = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = `/shared/${Date.now()}-${i}`;
      await cache.put(
        key,
        new Response(f, { headers: { "X-Filename": f.name || `shared-${i}.gpx` } })
      );
      keys.push(key);
    }
    await cache.put("/shared-index", new Response(JSON.stringify(keys)));
  } catch (e) {
    // 失敗してもアプリは開く
  }
  return Response.redirect("/?share-target=1", 303);
}
