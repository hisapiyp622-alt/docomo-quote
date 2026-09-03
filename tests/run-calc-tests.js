/* 金額計算のゴールデンテスト
 *
 * 使い方:
 *   node tests/run-calc-tests.js            … tests/golden.json と突き合わせて検算
 *   node tests/run-calc-tests.js --update   … いまの計算結果で golden.json を作り直す
 *                                             （料金改定など、意図して金額を変えたとき）
 *
 * 仕組み: keitai-app を ?kqtest=1 付きで Chromium に読み込み、
 * app.js 内の window.__KQ_TEST__.run() で代表パターンの金額を計算して比較する。
 * Firebase(gstatic) はネットワーク遮断し、端末内モードで動かす。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'golden.json');
const UPDATE = process.argv.indexOf('--update') >= 0;

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

/* 代表パターン。フィールドは app.js の defaultState() に対する差分。
 * ケースを足すときはここに追記して --update で golden を作り直す。 */
const CASES = {
  // --- プラン単体 ---
  'max_shinki': { procType: 'shinki', planId: 'max', jimuFee: 4950 },
  'max_kishu': { procType: 'kishu', planId: 'max' },
  'poikatsu_max': { procType: 'shinki', planId: 'poikatsu_max', jimuFee: 4950 },
  'poikatsu20': { planId: 'poikatsu_20' },
  'mini_t0': { planId: 'mini', tierIdx: 0 },
  'mini_t1': { planId: 'mini', tierIdx: 1 },
  'ahamo': { planId: 'ahamo' },
  'u15_t0': { planId: 'u15_debut', tierIdx: 0 },
  'u15_t1': { planId: 'u15_debut', tierIdx: 1 },
  // --- 割引の組み合わせ ---
  'max_minna3_set': { planId: 'max', minna: '3', dSet: true },
  'max_minna2': { planId: 'max', minna: '2' },
  'max_dcard': { planId: 'max', dCard: 'normal' },
  'max_dcard_gold': { planId: 'max', dCard: 'gold' },
  'max_denki': { planId: 'max', dDenki: true },
  'max_choki10': { planId: 'max', choki: 'y10' },
  'max_choki20_full': { planId: 'max', minna: '3', dSet: true, dCard: 'gold', dDenki: true, choki: 'y20' },
  'u15_dcard_gold': { planId: 'u15_debut', tierIdx: 0, dCard: 'gold' },
  /* 2026-09-03 追加（製品化レビュー 4-4・4-5）。手計算の根拠:
   * ・dマガジン 580（コンテンツ使用料）は還元の対象外。月額は 5,148＋580＝5,728 でも
   *   対象額は 5,148 → 4×100pt = 400pt（直す前は 5×100pt = 500pt だった）
   * ・smartあんしん補償 990（付加機能使用料）は対象。5,148＋990＝6,138 → 5×100pt = 500pt
   * ・ハーティ/子育ての通話オプション割引は、旧オプション（2023-06-30 まで）は 770円。
   *   5分（旧）770 → 0円、かけ放題（旧）1,870 → 1,100円 */
  'gold_dmagazine_content': { planId: 'max', dCard: 'gold', options: { dmagazine: true } },
  'gold_hosho_taisho': { planId: 'max', dCard: 'gold', options: { smart_hosho: true } },
  'hearty_v5l': { planId: 'max', hearty: true, voice: 'v5l' },
  'hearty_kakel': { planId: 'max', hearty: true, voice: 'kakel' },
  'kosodate_kakel': { planId: 'max', kosodate: true, voice: 'kakel' },
  // --- キャンペーン ---
  'u15_oyako': { planId: 'u15_debut', tierIdx: 0, campaigns: { oyako_u15: true } },
  'max_oyako_family': { planId: 'max', campaigns: { oyako_family: true } },
  // --- 通話オプション ---
  'max_voice5min': { planId: 'max', voice: 'v5' },
  'max_voice_full': { planId: 'max', voice: 'kake' },
  // --- オプション ---
  'max_hosho990': { planId: 'max', options: { smart_hosho: true }, optionKubun: { smart_hosho: 'new' } },
  'max_hosho330': { planId: 'max', options: { smart_hosho: true }, optionKubun: { smart_hosho: 'new' }, optionPrices: { smart_hosho: 330 } },
  'max_anshin_pack': { planId: 'max', options: { anshin_pack: true }, optionKubun: { anshin_pack: 'new' } },
  // --- 端末購入 ---
  'device_ikkatsu': { planId: 'max', payMethod: 'ikkatsu', devicePrice: 129800, deviceName: 'テスト機', jimuFee: 4950 },
  'device_ikkatsu_coupon': { planId: 'max', payMethod: 'ikkatsu', devicePrice: 129800, couponOff: 22000, deviceName: 'テスト機' },
  'device_b24': { planId: 'max', payMethod: 'b24', devicePrice: 129800, deviceName: 'テスト機' },
  'device_b36_atamakin': { planId: 'max', payMethod: 'b36', devicePrice: 98000, atamakin: 11000, deviceName: 'テスト機' },
  'device_kaedoki': { planId: 'max', payMethod: 'kaedoki', devicePrice: 129800, kaedoki23: 58000, deviceName: 'テスト機' },
  // --- 子育てサポート割引（1.115.0〜） ---
  'kosodate_max': { planId: 'max', kosodate: true },
  'kosodate_max_kake': { planId: 'max', kosodate: true, voice: 'kake' },
  'kosodate_hearty_both': { planId: 'max', kosodate: true, hearty: true },
  // --- その他の枠 ---
  'adhoc_monthly': { planId: 'max', adhocMonthly: [{ name: 'テスト割', amount: -550, months: 12 }] },
  'adhoc_initial': { planId: 'max', adhocInitial: [{ name: 'テスト商材', amount: 3300 }] },
  'accessories': { planId: 'max', accessories: [{ name: 'ケース', price: 4400, pay: 'once' }, { name: 'ガラス', price: 3300, pay: 'b24' }] }
};

function serve() {
  const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown', '.webmanifest': 'application/manifest+json' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, decodeURIComponent(p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const { chromium } = playwright();
  const srv = await serve();
  const port = srv.address().port;
  const launchOpts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('gstatic.com')) return route.abort();
    if (url.endsWith('firebase-config.js')) {
      let js = fs.readFileSync(path.join(ROOT, 'keitai-app/firebase-config.js'), 'utf8');
      js = js.replace(/projectId:\s*"[^"]*"/, 'projectId: ""'); // 端末内モードで起動
      return route.fulfill({ contentType: 'application/javascript', body: js });
    }
    if (/\/keitai-app\/(index\.html)?(\?.*)?$/.test(url)) {
      let html = fs.readFileSync(path.join(ROOT, 'keitai-app/index.html'), 'utf8');
      html = html.replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>/g, '');
      html = html.replace("'serviceWorker' in navigator", "false && 'serviceWorker' in navigator");
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    return route.continue();
  });

  await page.goto(`http://127.0.0.1:${port}/keitai-app/?kqtest=1`);
  await page.waitForTimeout(600);
  page.once('dialog', (d) => d.accept());
  await page.click('#setupSkip').catch(() => {});
  await page.waitForTimeout(600);
  await page.click('#tourSkip').catch(() => {});
  await page.waitForFunction(() => window.__KQ_TEST__, null, { timeout: 5000 });

  const results = {};
  for (const [name, patch] of Object.entries(CASES)) {
    results[name] = await page.evaluate((p) => window.__KQ_TEST__.run(p), patch);
  }
  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }

  if (UPDATE) {
    fs.writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`golden.json を更新しました（${Object.keys(results).length}ケース）`);
    return;
  }

  if (!fs.existsSync(GOLDEN)) {
    console.error('tests/golden.json がありません。node tests/run-calc-tests.js --update で作成してください。');
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  let ok = 0; const bad = [];
  for (const name of Object.keys(CASES)) {
    const a = JSON.stringify(golden[name]);
    const b = JSON.stringify(results[name]);
    if (a === b) { ok++; continue; }
    bad.push(`✗ ${name}\n    期待: ${a}\n    実際: ${b}`);
  }
  for (const name of Object.keys(golden)) {
    if (!(name in CASES)) bad.push(`✗ ${name}: golden にあるがケース定義に無い`);
  }
  console.log(`金額計算テスト: ${ok}/${Object.keys(CASES).length} OK`);
  if (bad.length) {
    console.error(bad.join('\n'));
    console.error('\n意図した料金変更の場合は node tests/run-calc-tests.js --update で golden を更新してください。');
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
