#!/usr/bin/env node
/* ── 社内版（当方の店舗用）を製品版から生成する ────────────────────
 * 使い方: node tools/build-internal.js
 *
 * 社内版は「製品版と同じ中身・ログインまわりだけ無し」。2つ作る:
 *   ケータイ見積もり（/）
 *     ・index.html … keitai-app/index.html のパスを書き換えて生成
 *     ・sw.js      … keitai-app/sw.js から生成（キャッシュ名 dq-*）
 *     ・本体       … keitai-app/ のファイルをそのまま読み込む（複製しない）
 *     ・firebase-config.js … 社内用（手書き・このスクリプトは触らない）
 *     ・分岐は keitai-app/app.js の INTERNAL（window.KEITAI_INTERNAL）
 *   イエナカ見積もり 単体（/ienaka/）
 *     ・index.html・sw.js・manifest.webmanifest を ienaka-app/ から生成
 *     ・本体は ienaka-app/ のファイルを読み込む。ログインは外し、同期は残す
 *       （ルートの firebase-config.js を共用・settings/ienakaInternalStore）
 *     ・分岐は ienaka-app/app.js の INTERNAL（window.IENAKA_INTERNAL）
 *     ・保存領域は ienaka-internal-*（製品版 ienaka-app-*・デモ版 ienaka-demo-* と混ざらない）
 *
 * 製品版の index.html / sw.js を変えたら、このスクリプトを実行して
 * 生成物を作り直してからコミットする（リリース手順に含める）。 */
"use strict";
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");

function read(p) { return fs.readFileSync(path.join(root, p), "utf8"); }
function write(p, s) {
  var full = path.join(root, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, s);
  console.log("生成: " + p);
}

/* ---------- index.html ---------- */
var html = read("keitai-app/index.html");

// 社内版の印（firebase-config より先に定義されている必要がある）
var cfgTag = '<script src="firebase-config.js"></script>';
if (html.indexOf(cfgTag) < 0) throw new Error("firebase-config.js の script タグが見つかりません");
html = html.replace(cfgTag, '<script>window.KEITAI_INTERNAL = true;</script>\n' + cfgTag);

// 本体ファイルは keitai-app/ のものを読み込む（firebase-config だけ root の社内用を使う）
["changelog.js", "data.js", "qr.js", "ienaka.js", "app.js"].forEach(function (f) {
  var tag = '<script src="' + f + '"></script>';
  if (html.indexOf(tag) < 0) throw new Error(f + " の script タグが見つかりません");
  html = html.replace(tag, '<script src="keitai-app/' + f + '"></script>');
});
html = html.replace('href="style.css"', 'href="keitai-app/style.css"');

// 画像・説明書も keitai-app/ のものを使う
html = html.split('src="img/').join('src="keitai-app/img/');
html = html.split('href="img/').join('href="keitai-app/img/');
html = html.split('data-doc="').join('data-doc="keitai-app/');

// イエナカ単体版へのリンクは、社内版どうしでつながるように /ienaka/ へ
html = html.split('href="../ienaka-app/"').join('href="ienaka/"');

// ブラウザのタブで見分けられるように
html = html.replace(/<title>([^<]*)<\/title>/, "<title>$1（社内版）</title>");

html = "<!-- このファイルは tools/build-internal.js が keitai-app/index.html から生成します。直接編集しないでください。 -->\n" + html;
write("index.html", html);

/* ---------- sw.js ---------- */
var sw = read("keitai-app/sw.js");
var m = sw.match(/var CACHE = "kq-(v\d+)";/);
if (!m) throw new Error("keitai-app/sw.js の CACHE 名が読めません");
sw = sw.replace(m[0], 'var CACHE = "dq-' + m[1] + '";');

// ASSETS: index.html・firebase-config.js・manifest・icon は root、その他は keitai-app/ 配下
var am = sw.match(/var ASSETS = \[[\s\S]*?\];/);
if (!am) throw new Error("keitai-app/sw.js の ASSETS が読めません");
var items = (am[0].match(/"[^"]+"/g) || []).map(function (q) { return q.slice(1, -1); });
var ROOT_OWN = { "./": 1, "index.html": 1, "firebase-config.js": 1, "manifest.webmanifest": 1, "icon.svg": 1 };
var mapped = items.map(function (a) { return ROOT_OWN[a] ? a : "keitai-app/" + a; });
sw = sw.replace(am[0], "var ASSETS = [" + mapped.map(function (a) { return '"' + a + '"'; }).join(", ") + "];");

// 古い版の掃除も自分の接頭辞（dq-）だけを対象にする（kq- は製品版のキャッシュ）
if (sw.indexOf('indexOf("kq-")') < 0) throw new Error("sw.js のキャッシュ掃除の接頭辞が見つかりません");
sw = sw.split('indexOf("kq-")').join('indexOf("dq-")');
sw = "/* このファイルは tools/build-internal.js が keitai-app/sw.js から生成します。直接編集しないでください。 */\n" + sw;
write("sw.js", sw);

/* ---------- 社内版のイエナカ単体（店舗ごとにURLを分けて生成） ----------
 * tag が空 = 阪南（従来の /ienaka/。保存名・同期先も従来のまま）。
 * tag あり = その店舗専用のURL。保存領域は ienaka-internal-<tag>-*、
 * 同期先は recipe-box の settings/ienakaStore_<tag> に分かれる。
 * ★ 店舗を増やしたら、recipe-box の Firestore ルールに
 *   settings/ienakaStore_<tag> の許可も足すこと（SYNC_DIFF.md 参照）。 */
function buildIenaka(dir, tag, label) {
  var ih = read("ienaka-app/index.html");

  // 社内版の印（app.js より先に読ませる）
  var appTag = '<script src="app.js"></script>';
  if (ih.indexOf(appTag) < 0) throw new Error("ienaka-app/index.html の app.js タグが見つかりません");
  var ieBoot;
  if (!tag) {
    /* 阪南: 社内版の印と、以前の保存名（ienaka-hannan-*）からの引っ越し。
     * 引っ越しは阪南だけの事情なので、他店舗・製品版・デモ版には入れない。 */
    ieBoot = '<script>window.IENAKA_INTERNAL = true;\n'
      + '/* 以前の保存名からの引っ越し（一度だけ・古い側は残す） */\n'
      + '(function(){try{var o=[],i,k;for(i=0;i<localStorage.length;i++){k=localStorage.key(i);'
      + 'if(k&&k.indexOf("ienaka-hannan-")===0)o.push(k);}'
      + 'o.forEach(function(x){var n="ienaka-internal-"+x.slice(14);'
      + 'if(!localStorage.getItem(n))localStorage.setItem(n,localStorage.getItem(x));});}catch(e){}})();'
      + '</script>';
  } else {
    // 店舗の札。app.js がこれを見て保存領域と同期先を店舗ごとに分ける
    ieBoot = '<script>window.IENAKA_INTERNAL = true; window.IENAKA_STORE = "' + tag + '";</script>';
  }
  ih = ih.replace(appTag, ieBoot + '\n<script src="../ienaka-app/app.js"></script>');

  /* 端末間同期は社内版でも使う（ログインは無し）。Firebase の設定は
   * ルートの firebase-config.js（社内用・recipe-box プロジェクト）を共用する。
   * ログイン用の SDK（auth）は社内版では使わないので読み込まない。 */
  var authTag = '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>\n';
  if (ih.indexOf(authTag) < 0) throw new Error("ienaka-app/index.html の firebase-auth タグが見つかりません");
  ih = ih.replace(authTag, "");
  var ieCfgTag = '<script src="firebase-config.js"></script>';
  if (ih.indexOf(ieCfgTag) < 0) throw new Error("ienaka-app/index.html の firebase-config.js タグが見つかりません");
  ih = ih.replace(ieCfgTag, '<script src="../firebase-config.js"></script>');

  // 本体は ienaka-app/ のものを読む（../keitai-app/qr.js は同じ階層なのでそのまま）
  ih = ih.replace('href="style.css"', 'href="../ienaka-app/style.css"');
  ih = ih.split('href="icon.svg"').join('href="../ienaka-app/icon.svg"');

  // 「← ケータイ見積もり」は社内版のケータイ（ルート）へ戻す（リンク自体は常に非表示）
  ih = ih.replace('href="../keitai-app/"', 'href="../"');

  ih = ih.replace(/<title>([^<]*)<\/title>/, "<title>$1（" + label + "）</title>");
  ih = "<!-- このファイルは tools/build-internal.js が ienaka-app/index.html から生成します。直接編集しないでください。 -->\n" + ih;
  write(dir + "/index.html", ih);

  /* キャッシュ名は店舗ごとに分ける（同じサイトに同居しているため、
   * 同じ名前だと別店舗の古い版を消してしまう） */
  var cachePrefix = tag ? "ienaka-internal-" + tag + "-" : "ienaka-internal-";
  var isw = read("ienaka-app/sw.js");
  var im = isw.match(/var CACHE = "ienaka-(v\d+)";/);
  if (!im) throw new Error("ienaka-app/sw.js の CACHE 名が読めません");
  isw = isw.replace(im[0], 'var CACHE = "' + cachePrefix + im[1] + '";');
  var iam = isw.match(/var ASSETS = \[[\s\S]*?\];/);
  if (!iam) throw new Error("ienaka-app/sw.js の ASSETS が読めません");
  var iItems = (iam[0].match(/"[^"]+"/g) || []).map(function (q) { return q.slice(1, -1); });
  var IE_ROOT_OWN = { "./": 1, "index.html": 1, "manifest.webmanifest": 1 };
  var iMapped = iItems
    .map(function (a) {
      if (a === "firebase-config.js") return "../firebase-config.js";   // 同期の設定はルートと共用
      if (IE_ROOT_OWN[a]) return a;
      if (a.indexOf("../") === 0) return a;                        // ../keitai-app/qr.js はそのまま
      return "../ienaka-app/" + a;
    });
  isw = isw.replace(iam[0], "var ASSETS = [" + iMapped.map(function (a) { return '"' + a + '"'; }).join(", ") + "];");
  /* 掃除するのは自分の接頭辞だけ（製品版の ienaka-v* や別店舗のものを巻き添えにしない）。
   * 阪南は以前の名前（ienaka-hannan-v*）の残りもここで片付ける。 */
  if (isw.indexOf('indexOf("ienaka-v")') < 0) throw new Error("ienaka-app/sw.js のキャッシュ掃除の接頭辞が見つかりません");
  isw = isw.split('k.indexOf("ienaka-v") === 0')
    .join(tag
      ? 'k.indexOf("' + cachePrefix + 'v") === 0'
      : '(k.indexOf("ienaka-internal-v") === 0 || k.indexOf("ienaka-hannan-v") === 0)');
  isw = "/* このファイルは tools/build-internal.js が ienaka-app/sw.js から生成します。直接編集しないでください。 */\n" + isw;
  write(dir + "/sw.js", isw);

  // ホーム画面に置いたときの設定（アイコンは ienaka-app のものを使う）
  var man = JSON.parse(read("ienaka-app/manifest.webmanifest"));
  man.name = man.name + "（" + label + "）";
  man.scope = "./";
  man.icons = man.icons.map(function (ic) {
    return { src: "../ienaka-app/" + ic.src, sizes: ic.sizes, type: ic.type, purpose: ic.purpose };
  });
  write(dir + "/manifest.webmanifest",
    "// このファイルは tools/build-internal.js が生成します。直接編集しないでください。\n".replace(/^\/\/.*\n/, "")
    + JSON.stringify(man, null, 2) + "\n");
}

buildIenaka("ienaka", "", "社内版");                              // 阪南（従来のURL・保存領域）
buildIenaka("ienaka-tokiwahigashi", "tokiwahigashi", "常盤東店"); // 常盤東（専用URL）

console.log("完了。/ と /ienaka/（阪南）・/ienaka-tokiwahigashi/（常盤東）は"
  + "製品版と同じ中身（ログイン無し・保存領域だけ別）で動きます。");
