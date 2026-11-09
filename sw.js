// 離線快取：有網路時用最新版，連不上或太慢時用快取。
const CACHE = "shadowing-v2";
const FILES = ["./", "index.html", "style.css", "data.js", "dictation.js", "app.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
const TIMEOUT_MS = 2500;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // 字典查詢等外部連線不經過快取
  e.respondWith(new Promise(resolve => {
    let finished = false;
    const useCache = () => fromCache(req).then(hit => {
      if (hit && !finished) { finished = true; resolve(hit); return true; }
      return false;
    });
    const timer = setTimeout(useCache, TIMEOUT_MS);
    // 開啟頁面的請求不能另設 cache 選項，否則會直接失敗而一直用舊版
    fetch(req.mode === "navigate" ? req : new Request(req, { cache: "no-cache" })).then(res => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      if (!finished) { finished = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      useCache().then(ok => { if (!ok && !finished) { finished = true; resolve(Response.error()); } });
    });
  }));
});
