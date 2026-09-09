/* 社内版の配信用フォルダ（tools/build-internal-dist.js の出力）の確認
 *
 *   node tests/run-internal-layout-test.js
 *
 * なぜ要るか（2026-09-08・配信先の引っ越し）:
 *   社内版はこれまでリポジトリの中身を丸ごと配っていたので「入れ忘れ」は起きなかった。
 *   要るファイルだけを配る形に変えると、入れ忘れは本番でだけ 404 になり、
 *   店頭で「開かない」「QRが出ない」「圏外で起動しない」という形で表に出る。
 *   逆に「入れすぎ」（tools/・tests/・設計文書）は、非公開にした意味を無くす。
 *   ここでは実際に組み立てて、3つの入口をブラウザで開き、
 *   ・読み込みに失敗したファイルが1つも無いこと
 *   ・社内版として動いていること（KEITAI_INTERNAL・引っ越しの欄が出る）
 *   ・オフライン用に控える一覧（sw.js の ASSETS）が全部あること
 *   ・配ってはいけない住所が 404 になること
 *   を確かめる。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-internal');

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

function serve() {
  const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown', '.webmanifest': 'application/manifest+json' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(OUT, decodeURIComponent(p));
      if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* 開く場所と、そこで必ず読み込まれていてほしいファイル */
const PAGES = [
  { name: '社内版ケータイ', url: '/', want: ['/keitai-app/app.js', '/keitai-app/style.css', '/keitai-app/qr.js', '/keitai-app/data.js', '/keitai-app/ienaka.js', '/keitai-app/changelog.js', '/firebase-config.js'] },
  { name: '社内版イエナカ（阪南）', url: '/ienaka/', want: ['/ienaka-app/app.js', '/ienaka-app/style.css', '/keitai-app/qr.js', '/firebase-config.js'] },
  { name: '社内版イエナカ（常盤東）', url: '/ienaka-tokiwahigashi/', want: ['/ienaka-app/app.js', '/ienaka-app/style.css', '/keitai-app/qr.js', '/firebase-config.js'] }
];

/* 配信物に無いはずの住所。1つでも 200 なら「入れすぎ」 */
const MUST_404 = [
  '/tools/build-internal.js', '/tests/run-calc-tests.js', '/CLAUDE.md', '/AGENTS.md', '/HANDOVER.md',
  '/HANDOVER-CURACON.md', '/README.md', '/firebase.json', '/.github/workflows/ci.yml',
  '/keitai-app/index.html', '/keitai-app/sw.js', '/keitai-app/firebase-config.js', '/keitai-app/firestore.rules',
  '/keitai-app/README.md', '/ienaka-app/index.html', '/ienaka-app/sw.js', '/ienaka-app/firebase-config.js',
  '/ienaka-app/firestore.rules', '/ienaka-app/SETUP.md', '/ienaka-demo/index.html', '/ienaka-tiles/index.html',
  '/dakkan-app/index.html', '/dist-product/index.html', '/keitai-app/ocr/', '/keitai-app/icon.svg', '/keitai-app/img/README.md',
  '/tests/rules/run-rules-tests.js', '/tools/release.sh', '/.git/HEAD', '/tools/provision-store.js'
];

(async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-internal-dist.js')], { stdio: 'inherit' });

  const { chromium } = playwright();
  const srv = await serve();
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = { args: ['--no-sandbox'] };
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ serviceWorkers: 'block' });

  const problems = [];
  for (const spec of PAGES) {
    const page = await ctx.newPage();
    const got = [];
    page.on('response', (r) => { if (r.url().startsWith(base)) got.push([new URL(r.url()).pathname, r.status()]); });
    page.on('pageerror', (e) => problems.push(`${spec.name}: JSエラー ${e.message}`));
    // Firebase(gstatic)は外に出さない。端末内モードで開く
    await page.route('**/*', (route) => (route.request().url().includes('gstatic.com') ? route.abort() : route.continue()));
    await page.goto(base + spec.url, { waitUntil: 'networkidle' }).catch((e) => problems.push(`${spec.name}: 開けません ${e.message}`));
    await page.waitForTimeout(500);

    for (const [p, st] of got) if (st >= 400) problems.push(`${spec.name}: ${p} が ${st}（見つからない）`);
    for (const w of spec.want) {
      if (!got.some(([p]) => p === w)) problems.push(`${spec.name}: ${w} を読み込んでいない（入れ忘れ・参照の書き換え漏れの可能性）`);
    }
    if (spec.url === '/') {
      const st = await page.evaluate(() => ({
        internal: window.KEITAI_INTERNAL === true,
        moveCard: (() => { const e = document.getElementById('moveCard'); return e ? !e.hidden : null; })(),
        toIenaka: (() => { const a = document.getElementById('toIenaka'); return a ? (!a.hidden && a.getAttribute('href')) : null; })()
      }));
      if (!st.internal) problems.push('社内版ケータイ: window.KEITAI_INTERNAL が立っていない（製品版として動いてしまう）');
      if (st.moveCard !== true) problems.push('社内版ケータイ: 「引っ越し（住所の変更）」の欄が出ていない（' + st.moveCard + '）');
      if (st.toIenaka !== 'ienaka/') problems.push('社内版ケータイ: 「イエナカ単体版 →」が /ienaka/ を指していない（' + st.toIenaka + '）');
    } else {
      const ok = await page.evaluate(() => window.IENAKA_INTERNAL === true);
      if (!ok) problems.push(`${spec.name}: window.IENAKA_INTERNAL が立っていない`);
    }
    await page.close();
  }

  function get(u) {
    return new Promise((resolve) => http.get(u, (r) => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0)));
  }
  /* オフライン用に控える一覧が全部あるか（1つ欠けると圏外で起動できない） */
  for (const sw of ['sw.js', 'ienaka/sw.js', 'ienaka-tokiwahigashi/sw.js']) {
    const src = fs.readFileSync(path.join(OUT, sw), 'utf8');
    const m = src.match(/var ASSETS\s*=\s*\[([\s\S]*?)\]/);
    if (!m) { problems.push(`${sw}: ASSETS の一覧が読めません`); continue; }
    const dir = path.posix.dirname('/' + sw);
    for (const raw of m[1].match(/"[^"]*"/g) || []) {
      const rel = raw.slice(1, -1);
      const abs = path.posix.normalize(path.posix.join(dir, rel));
      const st = await get(base + abs);
      if (st !== 200) problems.push(`${sw}: 控える一覧の ${rel} が ${st || '接続できない'}（${abs}）`);
    }
  }
  /* 入れすぎ（配ってはいけない住所が読める） */
  for (const p of MUST_404) {
    const st = await get(base + p);
    if (st === 200) problems.push(`${p} が読めます（配信物に入れてはいけません）`);
  }
  /* おまけのファイル */
  for (const p of ['/404.html', '/_headers', '/version.json']) {
    const st = await get(base + p);
    if (st !== 200) problems.push(`${p} がありません（${st}）`);
  }
  try {
    const v = JSON.parse(fs.readFileSync(path.join(OUT, 'version.json'), 'utf8'));
    const appVer = (fs.readFileSync(path.join(OUT, 'keitai-app/app.js'), 'utf8').match(/var APP_VERSION = "([^"]+)"/) || [])[1];
    if (v.kind !== 'internal') problems.push(`version.json の kind が internal でない（${v.kind}）`);
    if (v.app !== appVer) problems.push(`version.json の版（${v.app}）と app.js（${appVer}）が違う`);
  } catch (e) { problems.push('version.json を読めません: ' + e.message); }
  /* 見出し: 種類の推測をさせない・検索に載せない。Cache-Control は書かない（既定の「毎回確かめる」を使う） */
  const h = fs.readFileSync(path.join(OUT, '_headers'), 'utf8');
  if (!/X-Content-Type-Options: nosniff/.test(h)) problems.push('_headers に X-Content-Type-Options が無い');
  if (!/X-Robots-Tag: noindex/.test(h)) problems.push('_headers に X-Robots-Tag: noindex が無い（社内版は検索に載せない）');
  if (h.split('\n').some((l) => !l.trim().startsWith('#') && /Cache-Control/i.test(l))) problems.push('_headers に Cache-Control がある（既定を上書きすると新しい版が届くのが遅れる）');
  if ((await get(base + '/robots.txt')) !== 200) problems.push('/robots.txt が無い（社内版は検索に載せない）');
  const rb = fs.readFileSync(path.join(OUT, 'robots.txt'), 'utf8');
  if (!/Disallow: \/\s*$/m.test(rb)) problems.push('robots.txt が Disallow: / になっていない');

  await browser.close();
  srv.close();

  if (problems.length) {
    console.error('社内版の配信物に問題があります:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`社内版の配信物: 問題なし（${PAGES.length}か所・${MUST_404.length}件の「入れすぎ」確認）`);
})();
