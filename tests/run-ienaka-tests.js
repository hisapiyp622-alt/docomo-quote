/* 光・home 5G（イエナカ）の金額のゴールデンテスト
 *
 * 使い方:
 *   node tests/run-ienaka-tests.js            … tests/golden-ienaka.json と突き合わせて検算
 *   node tests/run-ienaka-tests.js --update   … いまの計算結果で作り直す（意図して金額を変えたとき）
 *
 * 仕組み: ケータイ見積もりの「光・5G」タブ（keitai-app/ienaka.js）と、
 * イエナカ単体版（ienaka-app/app.js）の両方を Chromium で読み込み、
 * window.__IE_TEST__.run() で代表パターンを計算する。
 * ・golden と一致するか（金額が勝手に変わっていないか）
 * ・統合版と単体版で同じ結果になるか（二重実装のズレ検出・製品化レビュー 4-9/4-34）
 * の2つを見る。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'golden-ienaka.json');
const UPDATE = process.argv.indexOf('--update') >= 0;

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

/* 代表パターン（defaultState への差分）。
 * 期待値の根拠は tests/golden-ienaka.json のコミット時に PR で確認する。 */
const CASES = {
  'hikari1g_ht_A_shinki': {},
  'hikari1g_mansion': { housing: 'ms' },
  'hikari1g_typeB': { ptype: 'B' },
  'hikari10g': { product: 'hikari10g' },
  'ahamo1g': { product: 'ahamo1g' },
  'ahamo1g_gold': { product: 'ahamo1g', dcard: 'gold' },          // ahamo光は還元対象外（4-6）
  'hikari1g_gold': { dcard: 'gold' },                              // 既定は充当しない（4-7）
  'hikari1g_gold_apply': { dcard: 'gold', dcardApply: true },      // 充当する場合
  'hikari1g_platinum': { dcard: 'platinum' },
  'home5g': { product: 'home5g' },
  'typec_hikari': { product: 'hikari1g', applyType: 'kirikae' },
  'typec_coax_koji': { product: 'hikari1g', applyType: 'kirikae', typecLine: 'coax', typecKoji: 11000 },
  'hikari1g_denwa': { opts: { denwa: true } },
  'hikari1g_norouter': { routerRental: 'nashi' },
  'hikari1g_tenyo': { applyType: 'tenyo' }
};

async function runOn(page, url, port) {
  await page.goto(`http://127.0.0.1:${port}${url}`);
  await page.waitForTimeout(600);
  page.once('dialog', (d) => d.accept());
  await page.click('#setupSkip').catch(() => {});
  await page.waitForTimeout(400);
  await page.click('#tourSkip').catch(() => {});
  await page.waitForFunction(() => window.__IE_TEST__, null, { timeout: 8000 });
  const out = {};
  for (const [name, patch] of Object.entries(CASES)) {
    out[name] = await page.evaluate((p) => window.__IE_TEST__.run(p), patch);
  }
  return out;
}

(async () => {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, decodeURIComponent(p));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(f);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const { chromium } = playwright();
  const launchOpts = { args: ['--no-sandbox'] };
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('gstatic.com')) return route.abort();
    if (url.endsWith('firebase-config.js')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.KEITAI_FIREBASE={};window.IENAKA_FIREBASE={};' });
    }
    return route.continue();
  });

  const integrated = await runOn(page, '/keitai-app/?kqtest=1', port);
  const standalone = await runOn(page, '/ienaka-app/', port);
  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }

  // 統合版と単体版のズレ（同じ計算のはず）
  const diffs = [];
  for (const name of Object.keys(CASES)) {
    const a = JSON.stringify(integrated[name]);
    const b = JSON.stringify(standalone[name]);
    if (a !== b) diffs.push({ name, a, b });
  }

  if (UPDATE) {
    fs.writeFileSync(GOLDEN, JSON.stringify(integrated, null, 2) + '\n');
    console.log(`golden-ienaka.json を更新しました（${Object.keys(integrated).length}ケース）`);
  }

  if (!fs.existsSync(GOLDEN)) {
    console.error('tests/golden-ienaka.json がありません。--update で作成してください。');
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  let ok = 0; const bad = [];
  for (const name of Object.keys(CASES)) {
    if (JSON.stringify(golden[name]) === JSON.stringify(integrated[name])) ok++;
    else bad.push({ name, want: golden[name], got: integrated[name] });
  }
  console.log(`光・5Gの金額テスト: ${ok}/${Object.keys(CASES).length} OK`
    + `（統合版と単体版の一致: ${Object.keys(CASES).length - diffs.length}/${Object.keys(CASES).length}）`);
  bad.forEach((b) => {
    console.error('✗ ' + b.name + '\n    期待: ' + JSON.stringify(b.want && b.want.segs)
      + '\n    実際: ' + JSON.stringify(b.got && b.got.segs));
  });
  diffs.forEach((d) => {
    console.error('✗ 統合版と単体版で結果が違う: ' + d.name
      + '\n    統合版: ' + d.a.slice(0, 200) + '\n    単体版: ' + d.b.slice(0, 200));
  });
  if (bad.length || diffs.length) {
    if (bad.length) console.error('\n意図した料金変更の場合は node tests/run-ienaka-tests.js --update で golden を更新してください。');
    process.exit(1);
  }
})();
