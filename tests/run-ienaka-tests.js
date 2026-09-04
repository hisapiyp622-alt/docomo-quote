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
  /* PLATINUM の還元率（5-1）。初年度は20%、2年目以降は前年のご利用額で10〜20%。
   * 率を下げたぶん、還元ポイントもきちんと下がることを見る。
   * 光1ギガ（戸建・A）の対象月額から 1,100円ごとに 率×10pt */
  'hikari1g_platinum_12': { dcard: 'platinum', dcardPlatRate: 12 },
  'hikari1g_platinum_10_apply': { dcard: 'platinum', dcardPlatRate: 10, dcardApply: true },
  'home5g': { product: 'home5g' },
  'typec_hikari': { product: 'hikari1g', applyType: 'kirikae' },
  /* タイプCでマンションが使えるかは、ケーブルテレビ会社ごとに違う（2026-09-04）。
   * 関西で使えるのは KCN・KCN京都・テレビ岸和田 の3社だけ。
   * ・KCN でマンション … マンションの金額 4,400円が出る
   * ・ベイコムでマンション … 戸建てへ寄せて 5,720円になる（間違って安く出さない） */
  'typec_kcn_mansion': { product: 'hikaric', applyType: 'kirikae',
    housing: 'ms', curLine: 'kcn' },
  'typec_baycom_mansion': { product: 'hikaric', applyType: 'kirikae',
    housing: 'ms', curLine: 'baycom' },
  'typec_kcn_kodate': { product: 'hikaric', applyType: 'kirikae',
    housing: 'ht', curLine: 'kcn' },
  /* タイプC転用のとき、ケーブルテレビ会社に残るお支払いを内訳で出せる（2026-09-04）。
   * ドコモの月額には足さず、別枠で出す。
   * ・内訳あり … テレビ3,465 ＋電話1,639 ＋基本料396 −割引2,838 ＝2,662円
   * ・内訳なし … 今までどおり「残る月額」の1行（2,200円） */
  'typec_keep_breakdown': { product: 'hikaric', applyType: 'kirikae',
    typecKeepTv: 3465, typecKeepPhone: 1639, typecKeepOther: 396, typecKeepOff: 2838 },
  'typec_keep_lump': { product: 'hikaric', applyType: 'kirikae', typecKeepAmt: 2200 },
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

  /* PLATINUM の還元率の欄が、画面でもきちんと出入りするか（製品化レビュー 5-1）。
   * 計算だけ直っていても、欄が出なければお店からは率を変えられない。
   * ここは単体版の画面で見る（この時点で /ienaka-app/ を開いている）。 */
  const uiBad = [];
  async function shown(id) {
    return page.$eval(id, (e) => !e.hidden && getComputedStyle(e).display !== 'none').catch(() => null);
  }
  async function rateCheck(sel, rateId, hintId) {
    await page.selectOption(sel, 'none'); await page.waitForTimeout(200);
    if (await shown(rateId + 'Field') !== false) uiBad.push('dカードなしのとき、還元率の欄が出ています');
    await page.selectOption(sel, 'gold'); await page.waitForTimeout(200);
    if (await shown(rateId + 'Field') !== false) uiBad.push('GOLD のとき、還元率の欄が出ています');
    await page.selectOption(sel, 'platinum'); await page.waitForTimeout(200);
    if (await shown(rateId + 'Field') !== true) uiBad.push('PLATINUM を選んでも還元率の欄が出ません');
    if (await shown(hintId) !== true) uiBad.push('PLATINUM を選んでも還元率の説明が出ません');
    if (await page.inputValue(rateId) !== '20') uiBad.push('還元率の初期値が 20 ではありません');
    // 率を下げると、還元ポイントも下がる
    const pt = () => page.$eval('#dcardHint', (e) => (e.textContent.match(/→ (\d+)pt/) || [])[1]);
    const at20 = await pt();
    await page.fill(rateId, '10'); await page.dispatchEvent(rateId, 'input'); await page.waitForTimeout(300);
    const at10 = await pt();
    if (!(Number(at10) > 0 && Number(at10) * 2 === Number(at20))) {
      uiBad.push(`率を 20%→10% にしてもポイントが半分になりません（${at20}pt → ${at10}pt）`);
    }
    // 10〜20 の外を入れたら 20 に直る
    await page.fill(rateId, '99'); await page.dispatchEvent(rateId, 'change'); await page.waitForTimeout(300);
    if (await page.inputValue(rateId) !== '20') uiBad.push('10〜20 の外の値が直りません');
    await page.selectOption(sel, 'none'); await page.waitForTimeout(200);
  }
  await rateCheck('#dcard', '#platRate', '#platRateHint');

  /* タイプCがマンションで使えない会社を選んだとき、画面で止まるか（2026-09-04）。
   * 金額が戸建てに寄るだけだと、お店は気づかずに申し込んでしまう。
   * ここは統合版（ケータイの光・5Gタブ）にしかない機能なので、そちらで見る。 */
  const msBad = [];
  {
    const p2 = await ctx.newPage();
    await runOn(p2, '/keitai-app/?kqtest=1', port);
    const pick = (patch) => p2.evaluate((x) => window.__IE_TEST__.hintFor(x), patch);
    const baycomMs = await pick({ product: 'hikaric', applyType: 'kirikae',
      housing: 'ms', curLine: 'baycom' });
    if (!/戸建てのみ/.test(baycomMs.text)) {
      msBad.push('ベイコム×マンションで「戸建てのみ」の注意が出ない: ' + baycomMs.text.slice(0, 120));
    }
    if (!/新規/.test(baycomMs.text)) {
      msBad.push('「新規になる」の案内が出ない: ' + baycomMs.text.slice(0, 120));
    }
    const kcnMs = await pick({ product: 'hikaric', applyType: 'kirikae',
      housing: 'ms', curLine: 'kcn' });
    if (/戸建てのみ/.test(kcnMs.text)) {
      msBad.push('KCN×マンションで、出てはいけない注意が出ている: ' + kcnMs.text.slice(0, 120));
    }
    const baycomHt = await pick({ product: 'hikaric', applyType: 'kirikae',
      housing: 'ht', curLine: 'baycom' });
    if (/戸建てのみ/.test(baycomHt.text)) {
      msBad.push('ベイコム×戸建てで、出てはいけない注意が出ている: ' + baycomHt.text.slice(0, 120));
    }
    await p2.close();
  }

  /* 既定では出さない回線（2026-09-04 店舗の指定）。
   * auひかり・楽天ひかりは、ふだんのご来店ではほとんど出てこないので選択肢から外す。
   * 扱う店舗だけ、契約の器の features（curLinesShow）で出す。
   * すでに選んである見積もりでは、設定に関係なく残ること（記録が黙って消えない）。 */
  const optBad = [];
  {
    const p3 = await ctx.newPage();
    await runOn(p3, '/keitai-app/?kqtest=1', port);
    const now = (await p3.evaluate(() => window.__IE_TEST__.hintFor({}))).options;
    ['auhikari', 'rakuten'].forEach((id) => {
      if (now[id]) optBad.push(`${id} が既定で選択肢に出ています`);
    });
    // ふだん使う回線は今までどおり出ていること
    ['jcom', 'eo', 'sbhikari', 'flets', 'none'].forEach((id) => {
      if (!now[id]) optBad.push(`${id} が選択肢から消えています（出したままにするもの）`);
    });
    // すでに選んである見積もりでは残る
    const picked = (await p3.evaluate(
      () => window.__IE_TEST__.hintFor({ curLine: 'auhikari' }))).options.auhikari;
    if (!picked) optBad.push('auひかりを選んである見積もりで、選択肢から消えてしまいます');
    await p3.close();
  }
  if (optBad.length) {
    console.error('既定で出さない回線の設定に問題があります:\n  ✗ ' + optBad.join('\n  ✗ '));
    process.exit(1);
  }
  console.log('既定で出さない回線（auひかり・楽天ひかり）: 問題なし');

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }

  /* 統合版と単体版のズレ（同じ計算のはず）。
   * ただし「現在のご利用回線」のケーブルテレビ会社の一覧は、ケータイ見積もりの
   * 光・5Gタブ（統合版）にしかない機能なので、それを使うケースは比べない。
   * 単体版は出荷していない（阪南の社内版の生成元として残しているだけ）。 */
  const INTEGRATED_ONLY = ['typec_kcn_mansion', 'typec_baycom_mansion', 'typec_kcn_kodate'];
  /* 比べるのは中身だけ。項目を書いた順が違うだけで落ちないように、名前順にそろえる。 */
  const stable = (v) => JSON.stringify(v, (k, val) =>
    (val && typeof val === 'object' && !Array.isArray(val))
      ? Object.keys(val).sort().reduce((o, k2) => { o[k2] = val[k2]; return o; }, {})
      : val);
  const diffs = [];
  for (const name of Object.keys(CASES)) {
    if (INTEGRATED_ONLY.indexOf(name) >= 0) continue;
    const a = stable(integrated[name]);
    const b = stable(standalone[name]);
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

  if (msBad.length) {
    console.error('タイプCのマンション可否の案内に問題があります:\n  ✗ ' + msBad.join('\n  ✗ '));
    process.exit(1);
  }
  console.log('タイプCのマンション可否の案内: 問題なし');
  if (uiBad.length) {
    console.error('PLATINUM の還元率の欄に問題があります:\n  ✗ ' + uiBad.join('\n  ✗ '));
    process.exit(1);
  }
  console.log('PLATINUM の還元率の欄: 問題なし');
  console.log(`光・5Gの金額テスト: ${ok}/${Object.keys(CASES).length} OK`
    + `（統合版と単体版の一致: ${Object.keys(CASES).length - INTEGRATED_ONLY.length - diffs.length}`
    + `/${Object.keys(CASES).length - INTEGRATED_ONLY.length}）`);
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
