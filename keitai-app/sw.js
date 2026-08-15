/* シンプルなオフラインキャッシュ（ネット優先・失敗時キャッシュ） */
var CACHE = "kq-v207";
var ASSETS = ["./", "index.html", "style.css", "app.js", "changelog.js",
  "data.js", "qr.js", "ienaka.js", "firebase-config.js",
  "manifest.webmanifest", "icon.svg",
  "img/mitsumorin-hello.png", "img/mitsumorin-sheet.png",
  "img/icon-192.png", "img/icon-512.png", "img/icon-maskable-512.png", "img/apple-touch-icon.png",
  "TERMS.md", "LICENSE.md", "PRIVACY.md", "SUPPORT.md", "STATS_GUIDE.md"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      /* 同じサイトに複数のアプリが同居しているため、消すのは自分の接頭辞（kq-）の
       * 古い版だけ。以前は「自分以外すべて」を消していて、他アプリのオフライン用
       * キャッシュを巻き添えで消していた（別アプリを1回開くだけで、圏外のとき
       * こちらが起動できなくなる）。 */
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("kq-") === 0 && k !== CACHE;
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
        /* 正常な応答だけを控える。
         * 店頭Wi-Fiの認証（キャプティブポータル）が返すHTMLや、サーバーの
         * エラー応答を app.js 等として保存すると、次のオフライン時に壊れた
         * アプリが配信され、サイトデータの削除まで復旧できなくなる。
         * ・自サイトのファイル: 200系で、かつ他のサイトへ転送されていないもの
         * ・他サイト（Firebase SDK等）: 200系または opaque（中身を確認できない
         *   no-cors応答。従来どおり控えて、オフライン起動の望みを残す） */
        var sameOrigin = e.request.url.indexOf(self.location.origin) === 0;
        var cacheable = res && (sameOrigin
          ? (res.ok && res.url.indexOf(self.location.origin) === 0)
          : (res.ok || res.type === "opaque"));
        if (!cacheable) {
          return caches.match(e.request).then(function (c) { return c || res; });
        }
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
