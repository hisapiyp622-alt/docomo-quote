#!/usr/bin/env node
/* 社内版（阪南・常盤東）の配信用フォルダを作る。
 *
 *   node tools/build-internal-dist.js [出力先]     既定: dist-internal/
 *
 * なぜ要るか（2026-09-08・配信先の引っ越し）:
 *   これまで社内版は「このリポジトリの main を丸ごと GitHub Pages で配る」形だった。
 *   そのため tools/・tests/・設計文書・firebase-config.js まで、社内版の住所から誰でも読めた。
 *   引っ越し先（Cloudflare Pages）には、アプリを動かすのに要るファイルだけを置く。
 *
 * ── できあがる形 ──────────────────────────────
 *   /                        → 社内版ケータイ（ルートの index.html・sw.js・manifest・icon・firebase-config）
 *   /keitai-app/             → 本体（app.js・data.js・style.css・img・説明書 …）。入口（index.html・sw.js）は入れない
 *   /ienaka/                 → 社内版イエナカ（阪南）
 *   /ienaka-tokiwahigashi/   → 社内版イエナカ（常盤東）
 *   /ienaka-app/             → イエナカ本体（app.js・style.css・icon.svg だけ）
 *   /404.html /_headers /version.json → tools/lib/dist-extras.js（製品版と同じ）
 *
 * ── 入れないもの ──────────────────────────────
 *   tools/・tests/・.github/・文書（*.md・CLAUDE.md …）・firebase.json・firestore.rules
 *   製品版の入口（keitai-app/index.html・sw.js・manifest・firebase-config.js）
 *   イエナカ単体版の入口（ienaka-app/index.html・sw.js・manifest・firebase-config.js）
 *   デモ（ienaka-demo）・試作（ienaka-tiles・dakkan-app）・ocr/（OCR_ON が false のとき）
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
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skip && skip.includes(name)) continue;
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}
function copyFiles(srcDir, dstDir, names) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const n of names) {
    const s = path.join(srcDir, n);
    if (!fs.existsSync(s)) { console.error(`必要なファイルがありません: ${path.relative(ROOT, s)}`); process.exit(1); }
    fs.copyFileSync(s, path.join(dstDir, n));
  }
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });
const OCR = ocrEnabled();

// 1) ルート（社内版ケータイの入口。build-internal.js の生成物）
copyFiles(ROOT, OUT, ["index.html", "sw.js", "manifest.webmanifest", "icon.svg", "firebase-config.js"]);

/* 2) ケータイ本体。製品版の入口と、配ってはいけないものは外す。
 *   index.html・sw.js・manifest … 製品版の入口。社内版の住所から製品版を開かせない
 *   firebase-config.js … 製品版のクラウド（keitai-quote）の設定。社内版は使わない
 *   firestore.rules … サーバー側の取り決め（製品版と同じ理由で出さない） */
const SKIP_KEITAI = ["index.html", "sw.js", "manifest.webmanifest", "firebase-config.js",
  "firestore.rules", "README.md", "mitsumorin-hello.png", "mitsumorin-sheet.png"]
  .concat(OCR ? [] : ["ocr"]);
copyDir(path.join(ROOT, "keitai-app"), path.join(OUT, "keitai-app"), SKIP_KEITAI);

// 3) イエナカ本体（社内版の /ienaka/ が読むファイルだけ）
copyFiles(path.join(ROOT, "ienaka-app"), path.join(OUT, "ienaka-app"), ["app.js", "style.css", "icon.svg"]);

// 4) 社内版イエナカの入口（build-internal.js の生成物）
copyDir(path.join(ROOT, "ienaka"), path.join(OUT, "ienaka"));
copyDir(path.join(ROOT, "ienaka-tokiwahigashi"), path.join(OUT, "ienaka-tokiwahigashi"));

// 5) 無い住所のページ・見出し・版の印
writeExtras(OUT, {
  title: "フロントーク（社内版）", homeHref: "/",
  swPaths: ["/sw.js", "/ienaka/sw.js", "/ienaka-tokiwahigashi/sw.js"],
  extra: { kind: "internal" }
});

// 6) 点検 ─ 配ってはいけないファイルが混ざっていないか
const NEVER_SHIP = ["firestore.rules", "firebase.json", ".firebaserc", "firestore.indexes.json",
  "serviceAccountKey.json", "key.json", ".env", "CLAUDE.md", "AGENTS.md", "HANDOVER.md", "HANDOVER-CURACON.md"];
const NEVER_DIRS = ["tools", "tests", ".github", "ienaka-demo", "ienaka-tiles", "dakkan-app", "node_modules", "dist-product"];
(function check(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) {
      if (NEVER_DIRS.includes(n)) { console.error(`配信物に入ってはいけないフォルダがあります: ${path.relative(OUT, p)}`); process.exit(1); }
      check(p); continue;
    }
    if (NEVER_SHIP.includes(n)) { console.error(`配信物に入ってはいけないファイルがあります: ${path.relative(OUT, p)}`); process.exit(1); }
  }
})(OUT);

// 7) 点検 ─ オフライン用に控える一覧（各 sw.js の ASSETS）が全部そろっているか
for (const sw of ["sw.js", "ienaka/sw.js", "ienaka-tokiwahigashi/sw.js"]) {
  const src = fs.readFileSync(path.join(OUT, sw), "utf8");
  const m = src.match(/var ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) { console.error(`${sw}: ASSETS の一覧が読めません`); process.exit(1); }
  const dir = path.posix.dirname("/" + sw);
  for (const raw of m[1].match(/"[^"]*"/g) || []) {
    const rel = raw.slice(1, -1);
    const abs = path.posix.normalize(path.posix.join(dir, rel === "./" ? "index.html" : rel));
    if (!fs.existsSync(path.join(OUT, abs))) {
      console.error(`${sw}: 控える一覧の ${rel} が配信物にありません（${abs}）`);
      process.exit(1);
    }
  }
}

// 8) 中身の確認（数え上げ）
let files = 0, bytes = 0;
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);
console.log(`できあがり: ${OUT}`);
console.log(`  ファイル ${files}件 / ${(bytes / 1024 / 1024).toFixed(1)}MB`);
console.log(`  カメラ読み取り: ${OCR ? "入（読み取り用ファイルを同梱）" : "切（読み取り用ファイルは入れない）"}`);
console.log("\n社内版の配信先（Cloudflare Pages）へ、このフォルダの中身をそのまま置きます。");
