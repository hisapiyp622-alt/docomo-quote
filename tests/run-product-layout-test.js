/* 出荷用（フロントーク配信リポジトリ）の並びが壊れていないかの確認
 *
 *   node tests/run-product-layout-test.js
 *
 * なぜ要るか: 出荷用は keitai-app をルートへ、デモを /demo/ へ移すので、
 * ファイル同士の参照（相対パス）の深さが変わる。書き換え漏れがあると
 * 本番でだけ 404 になり、店頭で「QRが出ない」といった形で表に出る。
 * ここでは実際に組み立てて、3つの入口をブラウザで開き、
 * 読み込みに失敗したファイルが1つも無いことを確かめる。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist-product');

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
  { name: '製品版ケータイ', url: '/', want: ['/app.js', '/style.css', '/qr.js', '/data.js', '/ienaka.js'] },
  { name: '製品版イエナカ単体', url: '/ienaka-app/', want: ['/ienaka-app/app.js', '/qr.js'] },
  { name: '営業用デモ', url: '/demo/', want: ['/demo/app.js', '/qr.js'] }
];

(async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-product.js')], { stdio: 'inherit' });

  const { chromium } = playwright();
  const srv = await serve();
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  /* Service Worker は切って開く。入れたままだと、先に開いたページの
   * オフライン用の控えが次のページに使われて、確認したい素の状態が見えない。
   * 控えの一覧（sw.js の ASSETS）は下で別に確かめる。 */
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
    await page.waitForTimeout(400);

    for (const [p, st] of got) if (st >= 400) problems.push(`${spec.name}: ${p} が ${st}（見つからない）`);
    for (const w of spec.want) {
      if (!got.some(([p]) => p === w)) problems.push(`${spec.name}: ${w} を読み込んでいない（参照の書き換え漏れの可能性）`);
    }
    await page.close();
  }

  /* 相手側へのリンクが、移した後の階層で正しい先を指しているか */
  const linkChecks = [
    { file: 'index.html', id: 'toIenaka', want: '/ienaka-app/' },
    { file: 'ienaka-app/index.html', id: 'toKeitai', want: '/' }
  ];
  for (const c of linkChecks) {
    const page = await ctx.newPage();
    await page.route('**/*', (route) => (route.request().url().includes('gstatic.com') ? route.abort() : route.continue()));
    await page.goto(base + '/' + c.file.replace(/index\.html$/, ''), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#' + c.id, { timeout: 5000 }).catch(() => {});
    const href = await page.$eval('#' + c.id, (a) => a.href).catch((e) => { problems.push(`${c.file}: #${c.id} を読めません ${e.message}`); return null; });
    if (!href) problems.push(`${c.file}: #${c.id} のリンクが見つかりません`);
    else if (new URL(href).pathname !== c.want) problems.push(`${c.file}: #${c.id} の行き先が ${new URL(href).pathname}（${c.want} のはず）`);
    await page.close();
  }

  /* オフライン用に控えるファイルの一覧（sw.js の ASSETS）が、
   * 移した後の階層でも全部あるか。ここが1つでも欠けると、
   * 初回にオフライン用の保存そのものが失敗し、圏外で起動できなくなる。 */
  function get(u) {
    return new Promise((resolve) => http.get(u, (r) => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0)));
  }
  for (const sw of ['sw.js', 'ienaka-app/sw.js']) {
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

  await browser.close();
  srv.close();

  if (problems.length) {
    console.error('出荷用の並びに問題があります:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`出荷用の並び: 問題なし（${PAGES.length}か所を確認）`);
})();
