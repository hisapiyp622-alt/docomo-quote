#!/usr/bin/env node
/* リリースの決まりを守れているかを見る（製品化レビュー 4-33）
 *
 * 使い方: node tools/release-check.js
 *
 * 見るのは4つ:
 *  1. keitai-app/app.js の APP_VERSION と changelog.js の先頭の版が合っているか
 *  2. keitai-app/sw.js の CACHE（kq-vNNN）が、前のコミットより増えているか
 *     （上げ忘れると、店舗の端末に新しいアプリが届かない）
 *  3. changelog.js の先頭の日付が、未来になっていないか
 *  4. node tools/build-internal.js を流し直しても差分が出ないか
 *     （＝ルート・/ienaka/ の生成物が最新のまま。作り直し忘れの検出）
 *
 * どれも「配ったのに届かない」「社内版だけ古い」を防ぐためのもの。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'origin/main';
const ng = [];
const ok = [];

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function readAt(ref, p) {
  try { return execSync(`git show ${ref}:${p}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
}

// 1. APP_VERSION と changelog の先頭
const app = read('keitai-app/app.js');
const chg = read('keitai-app/changelog.js');
const appVer = (app.match(/var APP_VERSION = "([^"]+)"/) || [])[1];
const chgVer = (chg.match(/v:\s*"([^"]+)"/) || [])[1];
const chgDay = (chg.match(/d:\s*"([^"]+)"/) || [])[1];
if (!appVer) ng.push('keitai-app/app.js の APP_VERSION を読めませんでした');
else if (appVer !== chgVer) {
  ng.push(`APP_VERSION（${appVer}）と更新履歴の先頭（${chgVer}）が違います。`
    + 'changelog.js に今回の版の行を足してください');
} else ok.push(`版の一致: ${appVer}`);

// 3. 更新履歴の日付が未来でないか
/* 更新履歴の日付は「日本の日付」で書く。CI の機械は世界標準時で動いていて
 * 日本より9時間遅れているため、そのまま比べると朝のリリースが止まる。 */
if (chgDay) {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const ymd = jst.getUTCFullYear() + '-'
    + String(jst.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(jst.getUTCDate()).padStart(2, '0');
  if (chgDay > ymd) ng.push(`更新履歴の先頭の日付（${chgDay}）が未来です（日本時間の今日は ${ymd}）`);
  else ok.push(`更新履歴の日付: ${chgDay}`);
}

// 2. sw.js の CACHE
const sw = read('keitai-app/sw.js');
const cacheNow = (sw.match(/var CACHE = "kq-v(\d+)"/) || [])[1];
const swBase = readAt(BASE, 'keitai-app/sw.js');
const appBase = swBase === null ? null : readAt(BASE, 'keitai-app/app.js');
if (appBase !== null) {
  const baseVer = (appBase.match(/var APP_VERSION = "([^"]+)"/) || [])[1];
  const cacheBase = (swBase.match(/var CACHE = "kq-v(\d+)"/) || [])[1];
  if (baseVer !== appVer) {
    // 版を上げたときは、キャッシュ名も必ず上げる
    if (!(Number(cacheNow) > Number(cacheBase))) {
      ng.push(`APP_VERSION を ${baseVer} → ${appVer} に上げていますが、`
        + `keitai-app/sw.js の CACHE が kq-v${cacheBase} のままです。+1 してください`
        + '（上げないと、店舗の端末に新しいアプリが届きません）');
    } else ok.push(`キャッシュ名: kq-v${cacheBase} → kq-v${cacheNow}`);
  } else if (cacheNow !== cacheBase) {
    ok.push(`キャッシュ名だけ変更: kq-v${cacheBase} → kq-v${cacheNow}`);
  } else {
    ok.push('版の変更はありません');
  }
} else {
  ok.push('比較元を読めなかったので、キャッシュ名の確認は飛ばしました');
}

// 4. 生成物（ルート・/ienaka/）が最新か
/* 「build-internal を流し直しても、生成物の中身が変わらない」ことで確かめる。
 * git の差分で見ると、まだコミットしていない自分の変更まで拾ってしまうため、
 * 実行の前後でファイルの中身を比べる。 */
const GEN = ['index.html', 'sw.js', 'manifest.webmanifest',
  'ienaka/index.html', 'ienaka/sw.js', 'ienaka/manifest.webmanifest',
  'ienaka-tokiwahigashi/index.html', 'ienaka-tokiwahigashi/sw.js',
  'ienaka-tokiwahigashi/manifest.webmanifest'];
function snapshot() {
  const m = {};
  GEN.forEach((f) => {
    const p2 = path.join(ROOT, f);
    m[f] = fs.existsSync(p2) ? fs.readFileSync(p2, 'utf8') : null;
  });
  return m;
}
try {
  const before = snapshot();
  execSync('node tools/build-internal.js', { cwd: ROOT, stdio: 'ignore' });
  const after = snapshot();
  const stale = GEN.filter((f) => before[f] !== after[f]);
  if (stale.length) {
    ng.push('生成物が古いままです（node tools/build-internal.js を実行してコミットしてください）:\n    '
      + stale.join('\n    '));
  } else ok.push('生成物（ルート・/ienaka/）は最新です');
} catch (e) {
  ng.push('tools/build-internal.js の実行に失敗しました: ' + String(e.message || e).split('\n')[0]);
}

if (ok.length) console.log('確認: ' + ok.join(' / '));
if (ng.length) {
  console.error('リリースの決まりに合っていません:\n  - ' + ng.join('\n  - ')
    + '\n\n手順は CLAUDE.md の「リリース手順」にあります。');
  process.exit(1);
}
console.log('リリースの決まりは守られています。');
