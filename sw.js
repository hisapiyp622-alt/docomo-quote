/* シンプルなオフラインキャッシュ（ネット優先・失敗時キャッシュ） */
var CACHE = "dq-v56";
var ASSETS = ["./", "index.html", "style.css", "app.js", "data.js", "firebase-config.js", "manifest.webmanifest", "icon.svg",
  "ienaka/", "ienaka/index.html", "ienaka/ienaka.css", "ienaka/ienaka.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    // no-cache: ブラウザのHTTPキャッシュ(最大10分)を飛ばしてサーバーへ再検証し、常に最新を取得
    fetch(e.request, { cache: "no-cache" })
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
