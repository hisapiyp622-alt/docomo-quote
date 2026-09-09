#!/usr/bin/env node
/* 社内版（阪南・常盤東）の配信用フォルダを作る。
 *
 *   node tools/build-internal-dist.js [出力先]     既定: dist-internal/
 *
 * なぜ要るか（2026-09-08・配信先の引っ越し）:
 *   これまで社内版は「このリポジトリの main を丸ごと GitHub Pages で配る」形だった。
 *   そのため tools/・tests/・設計文書・firestore.rules まで、社内版の住所から誰でも読めた。
 *   引っ越し先（Cloudflare Pages）には、アプリを動かすのに要るファイル**だけ**を置く。
 *
 * ── 方針: 入れるものを一つずつ書く（許可リスト） ──────────
 *   「入れないものを書く」やり方だと、新しく足したファイルが黙って配られる
 *   （出荷用の firestore.rules で一度やった失敗）。ここでは要るファイルを全部列挙し、
 *   出来上がりに一覧に無いファイルが1つでもあれば止める。
 *
 * ── できあがる形 ──────────────────────────────
 *   /                        → 社内版ケータイの入口（build-internal.js の生成物）
 *   /keitai-app/             → 本体（app.js・data.js・style.css・img・説明書）。製品版の入口は入れない
 *   /ienaka/                 → 社内版イエナカ（阪南）の入口
 *   /ienaka-tokiwahigashi/   → 社内版イエナカ（常盤東）の入口
 *   /ienaka-app/             → イエナカ本体（app.js・style.css・icon.svg）
 *   /404.html /_headers /version.json /robots.txt → tools/lib/dist-extras.js
 *
 * ルートの index.html・sw.js は tools/build-internal.js が作った生成物をそのまま使う
 * （このスクリプトは書き換えない）。先に build-internal.js を流しておくこと。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { writeExtras } = require("./lib/dist-extras");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "dist-internal"));

function ocrEnabled() {
  const src = fs.readFileSync(path.join(ROOT, "keitai-app", "app.js"), "utf8");
  const m = src.match(/var\s+OCR_ON\s*=\s*(true|false)\s*;/);
  if (!m) { console.error("keitai-app/app.js に OCR_ON の行が見つかりません。"); process.exit(1); }
  return m[1] === "true";
}

/* 入れるファイル（出力先の相対パス → 原本の相対パス）。これ以外は入れない。 */
const ALLOW = [
  "index.html", "sw.js", "manifest.webmanifest", "icon.svg", "firebase-config.js",
  "keitai-app/app.js", "keitai-app/changelog.js", "keitai-app/data.js", "keitai-app/qr.js", "keitai-app/ienaka.js",
  "keitai-app/style.css",
  "keitai-app/TERMS.md", "keitai-app/LICENSE.md", "keitai-app/PRIVACY.md", "keitai-app/SUPPORT.md", "keitai-app/STATS_GUIDE.md",
  "keitai-app/img/icon-192.png", "keitai-app/img/icon-512.png", "keitai-app/img/icon-maskable-512.png", "keitai-app/img/apple-touch-icon.png",
  "ienaka/index.html", "ienaka/sw.js", "ienaka/manifest.webmanifest",
  "ienaka-tokiwahigashi/index.html", "ienaka-tokiwahigashi/sw.js", "ienaka-tokiwahigashi/manifest.webmanifest",
  "ienaka-app/app.js", "ienaka-app/style.css", "ienaka-app/icon.svg"
];
/* おまけ（dist-extras.js が作る）。許可リストの照合ではこれも「あってよいもの」 */
const EXTRAS = ["404.html", "_headers", "version.json", "robots.txt"];

const OCR = ocrEnabled();
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const rel of ALLOW) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.error(`必要なファイルがありません: ${rel}`); process.exit(1); }
  fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(OUT, rel));
}
/* カメラ読み取り（OCR）が「入」のときだけ、読み取り用ファイル（14MB）を丸ごと入れる */
const allowed = new Set(ALLOW.concat(EXTRAS));
if (OCR) {
  (function copyOcr(src, dst, relBase) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) {
      const s = path.join(src, n), d = path.join(dst, n), rel = relBase + "/" + n;
      if (fs.statSync(s).isDirectory()) copyOcr(s, d, rel);
      else { fs.copyFileSync(s, d); allowed.add(rel); }
    }
  })(path.join(ROOT, "keitai-app", "ocr"), path.join(OUT, "keitai-app", "ocr"), "keitai-app/ocr");
}

// 無い住所のページ・見出し・版の印・検索よけ
writeExtras(OUT, {
  title: "フロントーク（社内版）", homeHref: "/",
  swPaths: ["/sw.js", "/ienaka/sw.js", "/ienaka-tokiwahigashi/sw.js"],
  noindex: true,
  extra: { kind: "internal" }
});

// 点検1 ─ 許可リストに無いファイルが1つでもあれば止める
(function check(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { check(p); continue; }
    const rel = path.relative(OUT, p).split(path.sep).join("/");
    if (!allowed.has(rel)) {
      console.error(`許可リストに無いファイルが配信物にあります: ${rel}`);
      console.error("入れてよいものなら ALLOW に足してください。");
      process.exit(1);
    }
  }
})(OUT);

// 点検2 ─ オフライン用に控える一覧（各 sw.js の ASSETS）が全部そろっているか
for (const sw of ["sw.js", "ienaka/sw.js", "ienaka-tokiwahigashi/sw.js"]) {
  const src = fs.readFileSync(path.join(OUT, sw), "utf8");
  const m = src.match(/var ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) { console.error(`${sw}: ASSETS の一覧が読めません`); process.exit(1); }
  const dir = path.posix.dirname("/" + sw);
  for (const raw of m[1].match(/"[^"]*"/g) || []) {
    const rel = raw.slice(1, -1);
    const abs = path.posix.normalize(path.posix.join(dir, rel === "./" ? "index.html" : rel));
    if (!fs.existsSync(path.join(OUT, abs))) {
      console.error(`${sw}: 控える一覧の ${rel} が配信物にありません（${abs}）。ALLOW に足してください`);
      process.exit(1);
    }
  }
}

// 点検3 ─ 入口の HTML が参照する自分のファイル（script/link/img）が全部あるか
for (const html of ["index.html", "ienaka/index.html", "ienaka-tokiwahigashi/index.html"]) {
  const src = fs.readFileSync(path.join(OUT, html), "utf8");
  const dir = path.posix.dirname("/" + html);
  const refs = [];
  src.replace(/(?:src|href|data-doc)="([^"#?:]+)"/g, (m2, r) => { refs.push(r); return m2; });
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r) || r === "./" || r === "../") continue;
    const abs = path.posix.normalize(path.posix.join(dir, r));
    if (abs.endsWith("/")) continue;
    if (!fs.existsSync(path.join(OUT, abs))) {
      console.error(`${html} が参照する ${r} が配信物にありません（${abs}）。ALLOW に足してください`);
      process.exit(1);
    }
  }
}

let files = 0, bytes = 0;
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);
console.log(`できあがり: ${OUT}`);
console.log(`  ファイル ${files}件 / ${(bytes / 1024 / 1024).toFixed(1)}MB（許可リスト方式）`);
console.log(`  カメラ読み取り: ${OCR ? "入（読み取り用ファイルを同梱）" : "切（読み取り用ファイルは入れない）"}`);
console.log("\n社内版の配信先（Cloudflare Pages）へ、このフォルダの中身をそのまま置きます。");
