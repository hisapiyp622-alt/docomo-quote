#!/usr/bin/env node
/* 旧・社内版の住所（hisapiyp622-alt.github.io/docomo-quote/）に置く「引っ越しました」の案内ページを作る。
 *
 *   node tools/build-oldsite-stub.js --new-url https://<社内版の新しい住所>/ [出力先]   既定: dist-oldsite/
 *
 * なぜ要るか（2026-09-08・配信先の引っ越し）:
 *   旧住所を単に消す（404）と、端末のオフライン係（sw.js）が「ネットから取れなかったので控えを出す」
 *   と判断し、**古いアプリが控えから起動して、いまのクラウドに書き続ける**。
 *   そこで旧住所の**すべての入口**に、案内ページと「自分を片付ける sw.js」を置く。
 *   入口ごとに sw.js の受け持ち範囲（scope）が別なので、ルートだけでは足りない。
 *
 * ── 各入口に置くもの ──
 *   index.html … 「引っ越しました」の案内。新しい住所へのリンク。
 *                社内版の入口（/・/ienaka/・/ienaka-tokiwahigashi/）には
 *                「この端末のデータを持ち出す」（新しい住所の「持ち込む」で読める同じ形式）と
 *                「文字としてコピー」を置く。開いた時点でこの住所のオフライン係を全部外し、
 *                社内版・製品版の開発コピーの控え（キャッシュ）を消す。端末の保存（localStorage）は消さない。
 *   sw.js      … 入れ替わった瞬間に、自分の受け持ちの控えを消して自分を外す（fetch は素通し）。
 *
 * ── 消す控えの名前 ──
 *   dq-（社内版ケータイ）・kq-（製品版の開発コピー）・ienaka-（イエナカの各版）・dk-（他社比較）だけ。
 *   同じ住所（github.io）には持ち主のほかのサイトも同居しうるので、名前で絞る。 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const NEW_URL = opt("--new-url", "");
const PRODUCT_URL = opt("--product-url", "https://frontalk.curacon.co.jp/");
const rest = args.filter((a, i) => !/^--/.test(a) && !/^--/.test(args[i - 1] || ""));
const OUT = path.resolve(rest[0] || path.join(ROOT, "dist-oldsite"));
if (!/^https:\/\/[^/]+\/?$/.test(NEW_URL)) {
  console.error("使い方: node tools/build-oldsite-stub.js --new-url https://<社内版の新しい住所>/ [出力先]");
  console.error("（新しい住所は https:// で始まり、ホスト名だけ。例: https://example.pages.dev/）");
  process.exit(1);
}
const NEW = NEW_URL.replace(/\/?$/, "/");

/* 入口の一覧。kind: internal=社内版（持ち出しあり）/ product=製品版の開発コピー / demo / retired */
const ENTRIES = [
  { dir: "", kind: "internal", label: "社内版ケータイ見積もり", to: NEW },
  { dir: "ienaka", kind: "internal", label: "社内版イエナカ見積もり（阪南）", to: NEW + "ienaka/" },
  { dir: "ienaka-tokiwahigashi", kind: "internal", label: "社内版イエナカ見積もり（常盤東）", to: NEW + "ienaka-tokiwahigashi/" },
  { dir: "keitai-app", kind: "product", label: "製品版（開発用のコピー）", to: PRODUCT_URL },
  { dir: "ienaka-app", kind: "product", label: "イエナカ単体版（開発用のコピー）", to: PRODUCT_URL },
  { dir: "ienaka-demo", kind: "demo", label: "営業用デモ", to: PRODUCT_URL.replace(/\/?$/, "/") + "demo/" },
  { dir: "ienaka-tiles", kind: "retired", label: "タイル式の試作（終了）", to: NEW },
  { dir: "dakkan-app", kind: "retired", label: "他社比較の試作（終了）", to: NEW }
];
const CACHE_PREFIXES = ["dq-", "kq-", "ienaka-", "dk-"];
const MOVE_PREFIXES = ["dq-", "ienaka-internal-", "ienaka-hannan-"];
const MOVE_SKIP = ["dq-handoff-v1"];

const SW = `/* 旧住所の片付け用（tools/build-oldsite-stub.js が作る）。
 * 入れ替わった瞬間に、この受け持ちの古い控えを消して自分を外す。fetch は素通し。 */
var PREFIXES = ${JSON.stringify(CACHE_PREFIXES)};
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return PREFIXES.some(function (p) { return k.indexOf(p) === 0; });
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.registration.unregister(); })
    .then(function () { return self.clients.matchAll({ type: "window" }); })
    .then(function (cs) { cs.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} }); }));
});
`;

function page(e) {
  const internal = e.kind === "internal";
  const lead = {
    internal: `<p>社内版は<b>新しい住所</b>に引っ越しました。ホーム画面のアイコンを新しい住所で作り直してお使いください。</p>`,
    product: `<p>ここは開発用のコピーでした。製品版は次の住所からお使いください。</p>`,
    demo: `<p>営業用デモは次の住所に移りました。</p>`,
    retired: `<p>この試作は終了しました。社内版は次の住所です。</p>`
  }[e.kind];
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>引っ越しました｜${e.label}</title>
<style>
body{margin:0;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#F4F4F5;color:#222}
main{max-width:560px;margin:6vh auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{font-size:19px;color:#CC0033;margin:0 0 12px}
h2{font-size:15px;margin:22px 0 8px;color:#CC0033}
p{line-height:1.75;margin:0 0 12px}
.url{font-size:17px;word-break:break-all;background:#fff4f6;border:1px solid #f3c7d1;padding:12px;border-radius:8px}
a.btn,button{display:inline-block;padding:11px 18px;border-radius:8px;border:0;background:#CC0033;color:#fff;text-decoration:none;font-weight:600;font-size:15px;cursor:pointer;margin:4px 6px 4px 0}
button.sub{background:#fff;color:#CC0033;border:1px solid #CC0033}
.hint{font-size:13px;color:#666}
.msg{font-size:14px;padding:10px;border-radius:8px;background:#eef8ee;margin-top:10px}
.msg.warn{background:#fff3e0}
textarea{width:100%;box-sizing:border-box;font-size:12px}
</style>
</head>
<body>
<main>
<h1>引っ越しました（${e.label}）</h1>
${lead}
<p class="url"><a href="${e.to}">${e.to}</a></p>
<p><a class="btn" href="${e.to}">新しい住所を開く</a></p>
${internal ? `
<h2>この端末に残っているデータを運ぶ</h2>
<p class="hint">この住所で使っていた端末の中身（保存した見積もり・お客様名・作りかけ・担当者・料金表・イエナカ）を、
新しい住所へ運ぶためのファイルを作ります。<b>持ち出しても、この端末の中身は消えません。</b>
新しい住所で「マスタ設定 → 引っ越し → 持ち込む」からこのファイルを選んでください。
ファイルにはお客様名が入ります。持ち込みの確認が済んだら削除してください。</p>
<p id="counts" class="hint"></p>
<p><button type="button" id="exportBtn">この端末のデータを持ち出す</button>
<button type="button" class="sub" id="copyBtn">文字としてコピー</button></p>
<p id="msg" class="msg" hidden></p>
<details><summary class="hint">全端末の持ち込みと照合が終わったあと（1か月後を目安）</summary>
<p class="hint">この端末に残っている社内版の旧データを消します。<b>新しい住所で件数を確かめてから</b>押してください。</p>
<p><button type="button" class="sub" id="wipeBtn">この端末の旧データを消す</button></p>
</details>` : ""}
<p class="hint">この住所のオフライン用の控え（キャッシュ）は、このページを開いた時点で片付けています。</p>
</main>
<script>
(function () {
  var CACHE_PREFIXES = ${JSON.stringify(CACHE_PREFIXES)};
  var MOVE_PREFIXES = ${JSON.stringify(MOVE_PREFIXES)};
  var MOVE_SKIP = ${JSON.stringify(MOVE_SKIP)};
  /* この住所のオフライン係をすべて外し、社内版・開発コピーの控えを消す（端末の保存は消さない） */
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
    }
    if (window.caches) {
      caches.keys().then(function (keys) {
        keys.forEach(function (k) { if (CACHE_PREFIXES.some(function (p) { return k.indexOf(p) === 0; })) caches.delete(k); });
      });
    }
  } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  if (!$("exportBtn")) return;
  function keyOk(k) { return MOVE_SKIP.indexOf(k) < 0 && MOVE_PREFIXES.some(function (p) { return k.indexOf(p) === 0; }); }
  function collect() {
    var keys = {}, n = 0;
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && keyOk(k)) { keys[k] = localStorage.getItem(k); n++; } }
    var d = new Date(); function z(x) { return ("0" + x).slice(-2); }
    return { kind: "frontalk-internal-move", version: 1,
      note: "店舗の実データ（お客様名を含む）。共有しない・持ち込みの確認が済んだら削除する",
      from: location.host + location.pathname, at: d.getFullYear() + "/" + z(d.getMonth() + 1) + "/" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes()),
      appVersion: "oldsite-stub", count: n, keys: keys };
  }
  function summary(keys) {
    var saved = 0, quotes = 0, ienaka = 0, staff = [];
    Object.keys(keys).forEach(function (k) {
      var v = keys[k];
      if (k.indexOf("dq-saved-v1:") === 0) { try { saved += (JSON.parse(v) || []).length; } catch (e) {} }
      else if (k.indexOf("dq-state-v1:") === 0) quotes++;
      else if (k.indexOf("ienaka-") === 0) ienaka++;
      else if (k === "dq-config-v1") { try { staff = (JSON.parse(v).staff || []).map(function (s) { return s.name || s.id; }); } catch (e) {} }
    });
    return "保存した見積もり " + saved + "件・作りかけ " + quotes + "人分・担当者 " + (staff.length ? staff.join("、") : "（なし）") + "・イエナカ " + ienaka + "件（全 " + Object.keys(keys).length + "件）";
  }
  function msg(t, warn) { var e = $("msg"); e.textContent = t; e.hidden = !t; e.className = "msg" + (warn ? " warn" : ""); }
  function fileName() { var d = new Date(); function z(x) { return ("0" + x).slice(-2); }
    return "frontalk-naibu-move_" + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes()) + ".json"; }
  var last = "";
  $("counts").textContent = "この端末の中身: " + summary(collect().keys);
  $("exportBtn").addEventListener("click", function () {
    var d = collect(); var json = JSON.stringify(d); last = json; var name = fileName();
    var done = function (how) { msg("持ち出しました（" + summary(d.keys) + "）。" + how + " この端末の中身は消えていません。"); };
    var download = function () {
      var blob = new Blob([json], { type: "application/json" }); var u = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
    };
    var file = null; try { file = new File([json], name, { type: "application/json" }); } catch (e) {}
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).then(function () { done("共有先（「ファイルに保存」など）に保存してください。"); },
        function (err) { if (err && err.name === "AbortError") { msg("持ち出しを取り消しました。", true); return; }
          try { download(); done("ファイル（" + name + "）を保存しました。"); } catch (e2) { msg("持ち出せませんでした。「文字としてコピー」をお使いください。", true); } });
      return;
    }
    try { download(); done("ファイル（" + name + "）を保存しました。"); } catch (e) { msg("持ち出せませんでした。「文字としてコピー」をお使いください。", true); }
  });
  $("copyBtn").addEventListener("click", function () {
    var json = last || JSON.stringify(collect());
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function () { msg("コピーしました。新しい住所の「貼り付けて持ち込む」に貼り付けてください。"); }, function () { msg("コピーできませんでした。", true); });
    else msg("コピーできませんでした。", true);
  });
  $("wipeBtn").addEventListener("click", function () {
    var d = collect();
    if (!d.count) { msg("この端末に社内版の旧データはありません。"); return; }
    if (!confirm("この端末に残っている社内版の旧データ（" + summary(d.keys) + "）を消します。\\n新しい住所で件数を確かめましたか？\\n\\n消すと戻せません。よろしいですか？")) return;
    if (!confirm("本当に消しますか？（もう一度確認）")) return;
    Object.keys(d.keys).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    $("counts").textContent = "この端末の中身: " + summary(collect().keys);
    msg("旧データを消しました。");
  });
})();
</script>
</body>
</html>
`;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const e of ENTRIES) {
  const d = path.join(OUT, e.dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "index.html"), page(e));
  fs.writeFileSync(path.join(d, "sw.js"), SW);
}
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
fs.writeFileSync(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");
fs.writeFileSync(path.join(OUT, "404.html"), page({ dir: "", kind: "retired", label: "ページが見つかりません", to: NEW }));
console.log(`できあがり: ${OUT}（入口 ${ENTRIES.length}か所・新しい住所 ${NEW}）`);
console.log("旧住所（GitHub Pages）の配信元をこの中身に差し替えます。手順は非公開リポジトリの migration/RUNBOOK.md。");
