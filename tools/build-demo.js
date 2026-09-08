#!/usr/bin/env node
/* ── 営業用デモ（/ienaka-demo/）を、イエナカ単体版から生成する ──────────
 * 使い方: node tools/build-demo.js       … 生成する
 *         node tools/build-demo.js --check … ズレていないかだけ見る（CI用）
 *
 * なぜ要るか（2026-09-08 の全体デバッグ）:
 *   デモ版は ienaka-app/ からの「手作業の写し」だった。写し忘れが積み重なり、
 *   ・タイプCでマンションが選べてしまい、月額が 1,320円 安く出る
 *   ・申込区分が「切替」のまま（製品は「転用（タイプC）」）
 *   ・同軸ケーブルからの転用の工事料の欄が無い
 *   ・`<script>` の外に書いたコメントが、画面に文字として出ていた
 *   といった不具合が、営業でお客様にお見せする画面に残っていた。
 *   デモだけの違いは下の RULES に閉じ込め、あとは原本と同じにする。
 *
 * デモだけの違い（ここに全部書く）:
 *   app.js  … 版の名前に -demo を付けるだけ。中身の分岐は
 *             ienaka-app/app.js の DEMO（window.IENAKA_DEMO）で持つ
 *   index.html … 題名・説明・検索よけ・デモの札／ケータイ見積もりへのリンクを外す／
 *             Firebase を読み込まない（クラウド同期を使わない）／
 *             Service Worker を登録しない（オンライン専用）／
 *             manifest を持たない（ホーム画面に入れない）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'ienaka-app');
const OUT = path.join(ROOT, 'ienaka-demo');

function appJs(src) {
  const out = src.replace(/(var APP_VERSION = ")([^"]+)(";)/, '$1$2-demo$3');
  if (out === src) throw new Error('版の名前（APP_VERSION）が見つかりませんでした');
  return out;
}

function indexHtml(src) {
  let h = src;
  const rep = (a, b, why) => {
    if (h.indexOf(a) < 0) throw new Error('見つかりませんでした（' + why + '）: ' + a.slice(0, 60));
    h = h.split(a).join(b);
  };
  rep('<meta name="description" content="ドコモ光・ahamo光・home 5G の店頭見積もりを、工事費・特典・実質価格まで自動計算して1枚に印刷できるアプリ。">',
      '<meta name="description" content="ドコモ光・ahamo光・home 5G の店頭見積もりデモ版。工事費・特典・実質価格まで自動計算します。">\n<meta name="robots" content="noindex">',
      '説明文と検索よけ');
  rep('<title>イエナカ見積もり｜ドコモ光・home 5G</title>',
      '<title>イエナカ見積もり（デモ版）｜ドコモ光・home 5G</title>', '題名');
  rep('<link rel="manifest" href="manifest.webmanifest">\n', '', 'manifest（ホーム画面に入れない）');
  rep('  <h1>イエナカ見積もり', '  <h1>イエナカ見積もり <span class="demo-badge">デモ版</span>', 'デモの札');
  // ケータイ見積もりへのリンクは出さない
  h = h.replace(/^.*id="toKeitai".*\n/m, '');
  // Firebase は読み込まず、デモの印だけを立てる
  const fb = h.match(/<script src="https:\/\/www\.gstatic\.com\/firebasejs[\s\S]*?<script src="firebase-config\.js"><\/script>\n/);
  if (!fb) throw new Error('Firebase の読み込み部分が見つかりませんでした');
  h = h.replace(fb[0], '<!-- デモ版: クラウド同期は使わないため Firebase は読み込まない -->\n<script>window.IENAKA_DEMO = true;</script>\n');
  // Service Worker の登録は外す（オンライン専用）
  const sw = h.match(/<script>\nif \('serviceWorker' in navigator\)[\s\S]*?<\/script>\n/);
  if (!sw) throw new Error('Service Worker の登録部分が見つかりませんでした');
  h = h.replace(sw[0], '<!-- デモ版: オンライン専用のため Service Worker は登録しない（オフラインでは使えません） -->\n');
  return h;
}

const same = (x) => x;   // そのまま写すもの
const files = [
  { name: 'app.js', make: appJs },
  { name: 'index.html', make: indexHtml },
  { name: 'style.css', make: same },
  { name: 'icon.svg', make: same }
];

const check = process.argv.indexOf('--check') >= 0;
let ng = 0;
files.forEach(function (f) {
  const src = fs.readFileSync(path.join(SRC, f.name), 'utf8');
  const want = f.make(src);
  const dst = path.join(OUT, f.name);
  const now = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
  if (check) {
    if (now !== want) {
      console.error('× ienaka-demo/' + f.name + ' が ienaka-app/ とズレています。'
        + '`node tools/build-demo.js` を実行して作り直してください。');
      ng++;
    }
    return;
  }
  fs.writeFileSync(dst, want);
  console.log('生成: ienaka-demo/' + f.name);
});
if (check) {
  if (ng) process.exit(1);
  console.log('営業用デモ（/ienaka-demo/）は、イエナカ単体版と同じ中身です。');
} else {
  console.log('完了。営業用デモは ienaka-app/ から作り直しました。'
    + 'style.css・icon.svg もそろえました。');
}
