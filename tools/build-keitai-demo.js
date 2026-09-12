#!/usr/bin/env node
/* ── 営業用デモ（/keitai-demo/）を、製品版のケータイ見積もりから生成する ──────
 * 使い方: node tools/build-keitai-demo.js         … 生成する
 *         node tools/build-keitai-demo.js --check … ズレていないかだけ見る（CI用）
 *
 * なぜ要るか（2026-09-12）:
 *   店長会議など大人数の場で、製品版は店舗IDとパスワードが要るため、その場で
 *   参加者に触ってもらえない。イエナカには以前からデモ版があるが、ケータイには無かった。
 *   「その場で自分の端末で触れる」ほうが、画面共有より伝わる。
 *
 * デモだけの違い（ここに全部書く）:
 *   app.js     … 版の名前に -demo を付けるだけ。中身の分岐は
 *                 keitai-app/app.js の DEMO（window.KEITAI_DEMO）で持つ
 *                 （保存の接頭辞 kqdemo・初期設定を出さない・デモの帯・配信元の警告を出さない）
 *   index.html … 題名・検索よけ・デモの札／Firebase を読み込まない（ログインもクラウドも無し）／
 *                 Service Worker を登録しない（オンライン専用）／manifest とアイコンを持たない
 *                 （ホーム画面に入れない）／イエナカ単体版へのリンクを外す
 *   そのほか   … style.css・data.js・changelog.js・qr.js・ienaka.js・icon.svg は原本の写し
 *
 * 安全のための決まり:
 *   ・保存の接頭辞が製品版（kq-）と別（kqdemo-）。同じ住所に置いても混ざらない
 *   ・Firebase を読み込まないので、本番のクラウドにはつながらない（ログイン画面も出ない）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'keitai-app');
const OUT = path.join(ROOT, 'keitai-demo');

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
  rep('<title>フロントーク｜料金見積もりシミュレーション</title>',
      '<title>フロントーク（デモ版）｜料金見積もりシミュレーション</title>\n<meta name="robots" content="noindex">',
      '題名と検索よけ');
  rep('<link rel="manifest" href="manifest.webmanifest">\n', '', 'manifest（ホーム画面に入れない）');
  rep('<link rel="icon" type="image/png" sizes="192x192" href="img/icon-192.png">\n', '', 'アイコン（画像は同梱しない）');
  rep('<link rel="apple-touch-icon" href="img/apple-touch-icon.png">\n', '', 'アイコン（画像は同梱しない）');
  rep('  <h1>フロントーク', '  <h1>フロントーク <span class="demo-badge">デモ版</span>', 'デモの札');
  // イエナカ単体版へのリンクは出さない（デモには同梱しない）
  const before = h;
  h = h.replace(/^.*id="toIenaka".*\n/m, '');
  if (h === before) throw new Error('イエナカ単体版へのリンクが見つかりませんでした');
  // Firebase は読み込まず、デモの印だけを立てる（ログイン無し・クラウド無し）
  const fb = h.match(/<script src="https:\/\/www\.gstatic\.com\/firebasejs[\s\S]*?<script src="firebase-config\.js"><\/script>\n/);
  if (!fb) throw new Error('Firebase の読み込み部分が見つかりませんでした');
  h = h.replace(fb[0], '<!-- デモ版: ログインもクラウド同期も使わないため Firebase は読み込まない -->\n<script>window.KEITAI_DEMO = true;</script>\n');
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
  { name: 'data.js', make: same },
  { name: 'changelog.js', make: same },
  { name: 'qr.js', make: same },
  { name: 'ienaka.js', make: same },
  { name: 'icon.svg', make: same }
];

const check = process.argv.indexOf('--check') >= 0;
if (!check && !fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
let ng = 0;
files.forEach(function (f) {
  const src = fs.readFileSync(path.join(SRC, f.name), 'utf8');
  const want = f.make(src);
  const dst = path.join(OUT, f.name);
  const now = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
  if (check) {
    if (now !== want) {
      console.error('× keitai-demo/' + f.name + ' が keitai-app/ とズレています。'
        + '`node tools/build-keitai-demo.js` を実行して作り直してください。');
      ng++;
    }
    return;
  }
  fs.writeFileSync(dst, want);
  console.log('生成: keitai-demo/' + f.name);
});
/* 入れてはいけないものが残っていないか（写し間違い・手で置いたファイル） */
const MUST_NOT = ['manifest.webmanifest', 'sw.js', 'firebase-config.js', 'firestore.rules', 'img'];
const leaks = MUST_NOT.filter((n) => fs.existsSync(path.join(OUT, n)));
if (leaks.length) {
  console.error('× keitai-demo/ に入れてはいけないものがあります: ' + leaks.join(' ')
    + '（デモはログイン無し・オンライン専用。これらは消してください）');
  ng++;
}
if (check) {
  if (ng) process.exit(1);
  console.log('営業用デモ（/keitai-demo/）は、製品版と同じ中身です。');
} else {
  if (ng) process.exit(1);
  console.log('完了。営業用デモ（/keitai-demo/）を keitai-app/ から作り直しました。');
}
