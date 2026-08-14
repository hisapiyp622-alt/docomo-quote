#!/usr/bin/env node
/* ── 社内版（リポジトリ直下）を製品版から生成する ──────────────────
 * 使い方: node tools/build-internal.js
 *
 * 社内版は「製品版と同じ中身・ログインまわりだけ無し」。仕組みは:
 *   ・root/index.html … keitai-app/index.html のパスを書き換えて生成（このスクリプト）
 *   ・root/sw.js      … keitai-app/sw.js から生成（キャッシュ名 dq-*）
 *   ・app.js などの本体 … keitai-app/ のファイルをそのまま読み込む（複製しない）
 *   ・root/firebase-config.js … 社内用（手書き・このスクリプトは触らない）
 *   ・社内版の分岐は keitai-app/app.js の INTERNAL フラグ（window.KEITAI_INTERNAL）
 *
 * 製品版の index.html / sw.js を変えたら、このスクリプトを実行して
 * root を作り直してからコミットする（リリース手順に含める）。 */
"use strict";
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");

function read(p) { return fs.readFileSync(path.join(root, p), "utf8"); }
function write(p, s) { fs.writeFileSync(path.join(root, p), s); console.log("生成: " + p); }

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

// イエナカ単体版へのリンク（root からは1階層下）
html = html.split('href="../ienaka-app/"').join('href="ienaka-app/"');

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

console.log("完了。root は keitai-app と同じ中身（ログイン無し・dq-* キー・settings/docomoQuoteStore 同期）で動きます。");
