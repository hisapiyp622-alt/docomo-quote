/* 配信先（Cloudflare Pages）の住所の書き換えに耐えるかの確認
 *
 *   node tests/run-pretty-url-test.js
 *
 * なぜ要るか（2026-09-09・段階3の初回配信で判明）:
 *   Cloudflare Pages は「きれいな住所」を作るため、`/○○.html` を `/○○` へ
 *   308 で転送する（`/index.html` → `/`、`/404.html` → `/404`）。
 *   GitHub Pages にはこの転送が無いので、手元のテストでは一度も起きなかった。
 *   オフライン用の控え（sw.js の ASSETS）には "index.html" が入っているため、
 *   転送のせいで控えの作成に失敗すると、**圏外で起動できないアプリが本番にだけ出る**。
 *   ここでは Cloudflare と同じ転送をする仮のサーバーを立てて、
 *   ・控えが全部作られること
 *   ・通信を切っても開けること
 *   を、実際のブラウザ（Service Worker あり）で確かめる。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

/* Cloudflare Pages と同じふるまいをする仮のサーバー */
function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const send = (code, file, headers) => {
        res.writeHead(code, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }, headers || {}));
        res.end(fs.readFileSync(file));
      };
      /* ① /○○.html は /○○ へ 308（index.html はフォルダ自身へ） */
      if (url.endsWith('.html')) {
        const to = url.endsWith('/index.html') ? url.slice(0, -'index.html'.length) : url.slice(0, -'.html'.length);
        res.writeHead(308, { Location: to });
        res.end();
        return;
      }
      const rel = decodeURIComponent(url.replace(/^\//, ''));
      const asDir = path.join(dir, rel, 'index.html');
      const asFile = path.join(dir, rel);
      const asHtml = path.join(dir, rel + '.html');
      /* ② フォルダは index.html、拡張子なしは ○○.html */
      let file = null;
      if (url.endsWith('/') && fs.existsSync(asDir)) file = asDir;
      else if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) file = asFile;
      else if (fs.existsSync(asHtml)) file = asHtml;
      if (file && file.startsWith(dir)) { send(200, file); return; }
      /* ③ 見つからない住所は 404.html を 404 で返す */
      const p404 = path.join(dir, '404.html');
      if (fs.existsSync(p404)) { send(404, p404); return; }
      res.writeHead(404); res.end('not found');
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function assetsOf(dir, swRel) {
  const src = fs.readFileSync(path.join(dir, swRel), 'utf8');
  const m = src.match(/var ASSETS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const base = path.posix.dirname('/' + swRel.replace(/\\/g, '/'));
  return (m[1].match(/"[^"]*"/g) || []).map((raw) => {
    const rel = raw.slice(1, -1);
    return path.posix.normalize(path.posix.join(base, rel === './' ? '' : rel)) + (rel === './' && base !== '/' ? '/' : '');
  });
}

const TARGETS = [
  { name: '製品版', build: 'tools/build-product.js', out: 'dist-product', pages: [{ url: '/', sw: 'sw.js' }] },
  { name: '社内版', build: 'tools/build-internal-dist.js', out: 'dist-internal', pages: [
    { url: '/', sw: 'sw.js' },
    { url: '/ienaka/', sw: 'ienaka/sw.js' },
    { url: '/ienaka-tokiwahigashi/', sw: 'ienaka-tokiwahigashi/sw.js' }
  ] }
];

(async () => {
  const problems = [];
  const { chromium } = playwright();
  const launchOpts = { args: ['--no-sandbox'] };
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);

  for (const t of TARGETS) {
    execFileSync(process.execPath, [path.join(ROOT, t.build)], { stdio: 'ignore' });
    const dir = path.join(ROOT, t.out);
    const srv = await serve(dir);
    const base = `http://127.0.0.1:${srv.address().port}`;

    /* 転送そのものの確認（Cloudflare と同じ形になっているか） */
    const head = (u) => new Promise((resolve) => http.get(u, (r) => { r.resume(); resolve({ code: r.statusCode, loc: r.headers.location }); }).on('error', () => resolve({ code: 0 })));
    const idx = await head(base + '/index.html');
    if (idx.code !== 308 || idx.loc !== '/') problems.push(`${t.name}: 仮サーバーの /index.html の転送がおかしい（${idx.code} ${idx.loc}）`);

    for (const spec of t.pages) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route('**/*', (route) => (route.request().url().includes('gstatic.com') ? route.abort() : route.continue()));
      await page.goto(base + spec.url, { waitUntil: 'domcontentloaded' }).catch((e) => problems.push(`${t.name} ${spec.url}: 開けません ${e.message}`));
      /* 開いた直後はアプリ側の移動が続くことがある。落ち着くまで待つ */
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(1000);

      /* Service Worker が入り、控えが全部そろうまで待つ */
      const want = assetsOf(dir, spec.sw);
      if (!want) { problems.push(`${t.name} ${spec.sw}: 控え一覧が読めません`); await ctx.close(); continue; }
      /* 「Execution context was destroyed」＝評価の最中に画面が移動した、というだけ。
       * 中身の問題ではないので、少し待って数回やり直す（CI での気まぐれな赤を防ぐ） */
      const evalRetry = async (fn) => {
        let last = null;
        for (let i = 0; i < 3; i++) {
          try { return await page.evaluate(fn); } catch (e) {
            last = e;
            if (!/Execution context was destroyed|Target closed|navigation/i.test(String(e.message || e))) break;
            await page.waitForTimeout(1500);
          }
        }
        return { sw: false, urls: [], err: String((last && last.message) || last) };
      };
      const got = await evalRetry(async () => {
        /* 控えの作成に失敗すると ready は永久に返らない。待つのは20秒までにして、
         * 「入らなかった」として報告する（CI が止まらないように） */
        const limit = (pr, ms) => Promise.race([pr, new Promise((r) => setTimeout(() => r('timeout'), ms))]);
        const reg = await limit(navigator.serviceWorker.getRegistration(), 10000);
        if (!reg || reg === 'timeout') return { sw: false, urls: [] };
        const ready = await limit(navigator.serviceWorker.ready, 20000);
        if (ready === 'timeout') return { sw: true, name: null, urls: [], slow: true };
        for (let i = 0; i < 40; i++) {
          const keys = await caches.keys();
          if (keys.length) {
            const c = await caches.open(keys[0]);
            const reqs = await c.keys();
            if (reqs.length) return { sw: true, name: keys[0], urls: reqs.map((r) => new URL(r.url).pathname) };
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        return { sw: true, name: null, urls: [] };
      });

      if (!got.sw) problems.push(`${t.name} ${spec.url}: Service Worker が入りません（${got.err || ''}）`);
      else {
        const missing = want.filter((w) => !got.urls.includes(w));
        if (got.slow) problems.push(`${t.name} ${spec.url}: 控えの作成が終わりません（控え一覧に無いファイルが混ざっていると起きます）`);
        else if (missing.length) problems.push(`${t.name} ${spec.url}: 控えに入らなかった ${missing.join(' ')}（転送のせいで圏外で起動できません）`);
      }

      /* 通信を切って開き直せるか（店頭の圏外そのもの） */
      await ctx.setOffline(true);
      const off = await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).then(() => page.evaluate(() => !!document.querySelector('body') && document.body.innerText.length > 0)).catch((e) => 'NG:' + e.message);
      if (off !== true) problems.push(`${t.name} ${spec.url}: 通信を切ると開けません（${off}）`);
      await ctx.close();
    }
    srv.close();
  }
  await browser.close();

  if (problems.length) { console.log(problems.map((p) => 'NG  ' + p).join('\n')); console.log(`\n住所の書き換えへの耐性: NG ${problems.length}件`); process.exit(1); }
  console.log('住所の書き換えへの耐性: 問題なし（きれいな住所への転送があっても、控えが作られ、圏外で開ける）');
})();
