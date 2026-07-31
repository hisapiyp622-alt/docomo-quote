/* 他社比較（ネット回線）＝ 奪還ツール — ネット優先・失敗時キャッシュ */
var CACHE = "dk-v4";
var ASSETS = ["./", "index.html", "style.css", "data.js", "ienaka.js", "dakkan.js", "app.js", "firebase-config.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      /* 同じサイトに複数のアプリが同居しているため、消すのは自分の接頭辞（dk-v）の
       * 古い版だけ。「自分以外すべて」を消すと、他アプリのオフライン用キャッシュを
       * 巻き添えで消してしまう（このアプリを1回開くだけで、圏外のとき
       * ケータイ見積もりが起動できなくなる）。 */
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("dk-v") === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    // no-cache: ブラウザのHTTPキャッシュを飛ばしてサーバーへ再検証し、常に最新を取得
    fetch(e.request, { cache: "no-cache" })
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
