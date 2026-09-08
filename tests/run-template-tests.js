/* テンプレート（よく出すご提案のひな型）の確認
 *
 * 使い方: node tests/run-template-tests.js
 *
 * なぜ要るか（2026-09-08 全体デバッグ 第2波）:
 *   ① テンプレートに前のお客様の数字・文字（現在の分割支払金・メモ・特記事項）が
 *      焼き付いていて、次のお客様の見積書に出てしまっていた。
 *      店舗共通のテンプレートは店内で共有されるので、混ざると困る。
 *   ② テンプレートを当てると、回線1の「ご来店の目的」が保存した当時のものに
 *      置き換わり、実績の数まで変わっていた。
 *   ③ 保存した当時の金額（機種代金・事務手数料・頭金）が復活し、
 *      いまの料金表と違う金額がお客様の見積書に出ていた。
 *      保存した見積もりは当時の金額のままでよいが、テンプレートは
 *      これから作る見積もりのひな型なので、古い金額を出してはいけない。
 *
 * 見ているもの（お客様・担当者の目に映るもの）:
 *   ・テンプレートの中身に、そのお客様だけの数字・文字が入っていないこと
 *   ・当てはめても、いま応対中のお客様の内容が消えないこと
 *   ・当てはめたら、いまの料金表・端末マスタの金額になること
 *   ・金額を直したときは、その旨が画面の知らせに出ること
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

const ok = [];
const ng = [];
function chk(name, cond, extra) {
  if (cond) ok.push(name);
  else ng.push(name + (extra ? '  → ' + extra : ''));
}

(async () => {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, decodeURIComponent(p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); res.end('nf'); return;
    }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml', '.png': 'image/png',
      '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream';
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
  page.on('dialog', (d) => d.accept());
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('gstatic.com')) return route.abort();
    if (url.endsWith('firebase-config.js')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.KEITAI_FIREBASE={};' });
    }
    return route.continue();
  });

  await page.goto(`http://127.0.0.1:${port}/keitai-app/?kqtest=1`);
  await page.waitForTimeout(800);
  await page.click('#setupSkip').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('#tourSkip').catch(() => {});
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.tplStored, null, { timeout: 8000 });

  /* ---- ① テンプレートに、そのお客様だけの数字・文字が入らない ---- */
  const stored = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    L.pick(0);
    L.fill(0, {
      procType: 'kishu', deviceName: 'テスト端末', devicePrice: 150000, payMethod: 'bunkatsu36',
      currentInst: 3300, currentInstMonths: 12,
      quoteMemo: 'A様 ご家族3回線目としてのご提案',
      todoOther: 'A様 SIM再発行あり・データ移行は翌日',
      visitPurposes: { device: true }, custName: 'あんどう'
    });
    L.pick(0);
    T.tplSave(0);
    return T.tplStored(0);
  });
  const leak = ['custName', 'currentInst', 'currentInstMonths', 'quoteMemo', 'todoOther',
    'visitPurposes', 'kaimashi', 'shitadori', 'usePointAmount', 'mnpBenefitAmt', 'curBill']
    .filter((k) => stored && stored[k] !== undefined);
  chk('① テンプレートに、そのお客様だけの数字・文字が入らない',
    leak.length === 0, '入っていたもの: ' + leak.join('・'));
  chk('① 提案の中身（機種・支払い方法）はちゃんと入っている',
    stored && stored.deviceName === 'テスト端末' && stored.payMethod === 'bunkatsu36',
    JSON.stringify(stored && { d: stored.deviceName, p: stored.payMethod }));

  /* ---- ② 当てはめても、いま応対中のお客様の内容が消えない ---- */
  const after = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    L.clearAll();
    L.pick(0);
    L.fill(0, {
      custName: 'たなか', visitPurposes: { plan: true },
      quoteMemo: 'B様 メモ', todoOther: 'B様 特記', currentInst: 0, currentInstMonths: 0
    });
    L.pick(0);
    T.tplApply(0);
    const st = L.state(0);
    return {
      cust: st.custName, purposes: Object.keys(st.visitPurposes || {}).filter((k) => st.visitPurposes[k]),
      memo: st.quoteMemo, other: st.todoOther,
      inst: st.currentInst, instM: st.currentInstMonths,
      device: st.deviceName, pay: st.payMethod
    };
  });
  chk('② ご来店の目的が、テンプレートの内容に置き換わらない',
    JSON.stringify(after.purposes) === '["plan"]', JSON.stringify(after.purposes));
  chk('② 前のお客様の「現在の分割支払金」が入ってこない',
    after.inst === 0 && after.instM === 0, after.inst + '円 / 残り' + after.instM + '回');
  chk('② 前のお客様のメモ・特記事項が入ってこない',
    after.memo === 'B様 メモ' && after.other === 'B様 特記',
    JSON.stringify([after.memo, after.other]));
  chk('② お客様名も消えない', after.cust === 'たなか', after.cust);
  chk('② テンプレートの提案の中身はちゃんと入る',
    after.device === 'テスト端末' && after.pay === 'bunkatsu36',
    JSON.stringify([after.device, after.pay]));

  /* ---- ③ 当てはめたら、いまの料金表・端末マスタの金額になる ---- */
  const price = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    // 端末マスタに 150,000円 で登録して、その機種でテンプレートを保存する
    T.devmaster.apply('機種名,本体価格,店頭頭金,カエドキ23回分\nテスト端末 256GB,150000,3300,75000');
    L.clearAll();
    L.pick(0);
    L.fill(0, { procType: 'mnp', deviceName: 'テスト端末 256GB', devicePrice: 150000,
      atamakin: 3300, kaedoki23: 75000, payMethod: 'bunkatsu36', jimuFee: 4950 });
    L.pick(0);
    T.tplSave(1);
    // 値下げ（価格改定）と、事務手数料の改定
    T.devmaster.apply('機種名,本体価格,店頭頭金,カエドキ23回分\nテスト端末 256GB,120000,0,60000');
    const m = T.std.get();
    m.fees.jimu_mnp = 2200;
    T.std.set(m);
    L.clearAll();
    L.pick(0);
    T.tplApply(1);
    const st = L.state(0);
    return { price: st.devicePrice, atama: st.atamakin, k23: st.kaedoki23,
      jimu: st.jimuFee, note: T.tplNote(), sheet: T.saved.sheetText() };
  });
  chk('③ 機種代金が、いまの端末マスタの金額になる',
    price.price === 120000, String(price.price));
  chk('③ 店頭頭金・カエドキ23回分も、いまの金額になる',
    price.atama === 0 && price.k23 === 60000, price.atama + ' / ' + price.k23);
  chk('③ 契約事務手数料も、いまの料金表の金額になる',
    price.jimu === 2200, String(price.jimu));
  chk('③ 金額を直したことが、画面の知らせに出る',
    /いまの金額に直しました/.test(price.note) && /機種代金/.test(price.note), price.note);
  chk('③ お客様の見積書に、古い150,000円が出ない',
    price.sheet.indexOf('150,000') < 0, price.sheet.split('\n').filter((l) => /150,000/.test(l)).join(' / '));

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('テンプレートに問題があります: ' + ok.length + '/' + (ok.length + ng.length)
      + '\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('テンプレートのテスト: ' + ok.length + '/' + ok.length + ' OK');
})();
