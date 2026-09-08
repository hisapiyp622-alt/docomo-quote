/* 端末マスタ（機種の一覧）の取り込みの確認
 *
 * 使い方: node tests/run-device-master-tests.js
 *
 * なぜ要るか（2026-09-08 全体デバッグ 第2波）:
 *   代理店からもらう機種一覧の見出しは「本体価格（10%税込）」「48回払い月額」の
 *   ように数字が入っているのがふつう。それまでの読み方は「1行目に数字があれば
 *   見出しではない」と決めつけていたため、見出しを読み落とし、
 *   店頭頭金・カエドキ23回分の列を黙って捨てていた。
 *   その結果、お客様にお渡しする見積書の「店頭お支払い金額」が0円になり、
 *   分割の月額も頭金のぶんだけ高く出ていた（気づく手がかりが無かった）。
 *
 * 見ているもの（お客様・担当者の目に映るもの）:
 *   ・見出しに数字があっても、頭金・23回分の列を読むこと
 *   ・先頭に空行やタイトル行があっても、見出しを読むこと
 *   ・本体価格の欄が空や「－」の行で、隣の頭金・23回分を値段と取り違えないこと
 *   ・「145,200」と桁区切りのカンマで割れていても、145,200円と読むこと
 *   ・取り込んだあとの案内に、頭金・23回分を読めたかどうかが出ること
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
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.devmaster, null, { timeout: 8000 });

  const parse = (text) => page.evaluate((t) => {
    const r = window.__KQ_TEST__.devmaster.parse(t);
    return { list: r.list, skipped: r.skipped, ambiguous: r.ambiguous,
      note: window.__KQ_TEST__.devmaster.note(r.head) };
  }, text);

  /* ---- ① 数字の無い見出し（これまでも読めていた形） ---- */
  const a = await parse([
    '機種名,本体価格,店頭頭金,カエドキ23回分',
    'iPhone 17 128GB,145200,3300,72600'
  ].join('\n'));
  chk('① 見出しつきの表を、値段・頭金・23回分まで読む',
    a.list.length === 1 && a.list[0].price === 145200
      && a.list[0].atamakin === 3300 && a.list[0].kaedoki23 === 72600,
    JSON.stringify(a.list));

  /* ---- ② 見出しに数字が入っている（代理店のCSVでふつうにある形） ---- */
  const b = await parse([
    '機種名,本体価格（10%税込）,店頭頭金,カエドキ23回分',
    'iPhone 17 128GB,145200,3300,72600'
  ].join('\n'));
  chk('② 見出しが「本体価格（10%税込）」でも、頭金・23回分を読む',
    b.list.length === 1 && b.list[0].price === 145200
      && b.list[0].atamakin === 3300 && b.list[0].kaedoki23 === 72600,
    JSON.stringify(b.list));

  const c = await parse([
    '機種名,本体価格,48回払い月額,店頭頭金,カエドキ23回分',
    'iPhone 17 128GB,145200,3025,3300,72600'
  ].join('\n'));
  chk('② 「48回払い月額」の列があっても、頭金・23回分を読む',
    c.list.length === 1 && c.list[0].price === 145200
      && c.list[0].atamakin === 3300 && c.list[0].kaedoki23 === 72600,
    JSON.stringify(c.list));

  /* ---- ③ 型番・容量が本体価格より左にある表 ---- */
  const d = await parse([
    '機種名,型番,容量,本体価格（10%税込）,在庫',
    'iPhone 17 128GB,MQ6X3J/A,128,145200,5'
  ].join('\n'));
  chk('③ 容量の「128」を値段と取り違えない',
    d.list.length === 1 && d.list[0].price === 145200, JSON.stringify(d.list));

  /* ---- ④ 先頭に空行やタイトル行がある ---- */
  const e = await parse([
    '',
    '2026年9月 価格表',
    '機種名,本体価格,店頭頭金,カエドキ23回分',
    'iPhone 17 128GB,145200,3300,72600'
  ].join('\n'));
  chk('④ 先頭に空行やタイトル行があっても、見出しを読む',
    e.list.length === 1 && e.list[0].atamakin === 3300 && e.list[0].kaedoki23 === 72600,
    JSON.stringify(e.list));

  /* ---- ⑤ 本体価格の欄が空・「－」の行 ---- */
  const f = await parse([
    '機種名,本体価格,店頭頭金,カエドキ23回分',
    'iPhone 17 128GB,,3300,72600',
    'Galaxy S26,－,5500,60000',
    'Xperia 10 VIII,72600,0,36300'
  ].join('\n'));
  const names = f.list.map((x) => x.name + ':' + x.price).join(' / ');
  chk('⑤ 値段が空の行を、頭金の3300円で取り込まない',
    !/iPhone 17 128GB:3300/.test(names) && !/Galaxy S26:5500/.test(names), names);
  chk('⑤ 値段が空の行は飛ばし、ちゃんと入っている行だけ取り込む',
    f.list.length === 1 && f.list[0].name === 'Xperia 10 VIII' && f.list[0].price === 72600
      && f.skipped === 2, names + ' skipped=' + f.skipped);

  /* ---- ⑤-2 本体価格の欄に数字以外が混じっている行 ---- */
  const f2 = await parse([
    '機種名,本体価格,店頭頭金,カエドキ23回分',
    'iPhone 17 128GB,145200(税込),3300,72600',
    'Galaxy S26,お問い合わせ,5500,60000'
  ].join('\n'));
  const n2 = f2.list.map((x) => x.name + ':' + x.price).join(' / ');
  chk('⑤ 値段の欄に「(税込)」などが混じる行を、頭金の金額で取り込まない',
    !/:3300|:5500/.test(n2), n2);

  /* ---- ⑥ 引用符なしの桁区切りカンマ ---- */
  const g = await parse([
    '機種名,本体価格,店頭頭金,カエドキ23回分',
    'iPhone 17 128GB,145,200,3,300,72,600'
  ].join('\n'));
  chk('⑥ 「145,200」と割れていても 145,200円 と読む',
    g.list.length === 1 && g.list[0].price === 145200, JSON.stringify(g.list));

  /* ---- ⑥-2 見出しの無い一覧で、在庫数と金額の頭をつながない ---- */
  const g2 = await parse('iPhone 17 128GB,12,145,200\nGalaxy S26,3,132,000');
  const g2n = g2.list.map((x) => x.name + ':' + x.price).join(' / ');
  chk('⑥ 在庫数と金額の頭をつないだ、実在しない金額を作らない',
    !/12145|3132/.test(g2n), g2n);
  chk('⑥ 決められない行は取り込まず、飛ばしたことを数える',
    g2.list.length === 0 && g2.ambiguous === 2, g2n + ' ambiguous=' + g2.ambiguous);
  const g3 = await parse('iPhone 17 128GB,145200,12\nGalaxy S26,132000,3');
  chk('⑥ 在庫数が金額のうしろにある一覧は、これまでどおり読める',
    g3.list.length === 2 && g3.list[0].price === 145200 && g3.list[1].price === 132000,
    JSON.stringify(g3.list));

  /* ---- ⑦ 取り込んだあとの案内 ---- */
  chk('⑦ 頭金・23回分を読めたことが案内に出る',
    /店頭頭金/.test(b.note) && /カエドキ23回分/.test(b.note), b.note);
  const h = await parse('iPhone 17 128GB,145200\nGalaxy S26,120000');
  chk('⑦ 見出しが無いときは「読めませんでした」と知らせる',
    /読めませんでした/.test(h.note), h.note);
  chk('⑦ 見出しが無い表でも、機種名と値段は読める',
    h.list.length === 2 && h.list[0].price === 145200, JSON.stringify(h.list));

  /* ---- ⑧ 実際に取り込んで、見積書に頭金が出る ---- */
  const sheet = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.devmaster.apply('機種名,本体価格（10%税込）,店頭頭金,カエドキ23回分\niPhone 17 128GB,145200,3300,72600');
    const dev = (T.std.get().devices || []).filter((x) => x.name === 'iPhone 17 128GB')[0];
    return dev || null;
  });
  chk('⑧ 取り込んだ機種に頭金3,300円が入っている',
    sheet && sheet.atamakin === 3300, JSON.stringify(sheet));

  /* ---- ⑨ のりかえ（MNP）で機種を選んでも、頭金の初期値が勝手に入らない
   *      （MNPはSIMのみ・頭金なしのご案内が多いので基本なし・2026-07-30 安藤さん）---- */
  const atama = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const m = T.std.get();
    m.fees.atamakin_default = 11000;
    T.std.set(m);
    // 頭金の登録が無い機種を用意する
    T.devmaster.apply('機種名,本体価格\nテスト端末A,150000');
    const out = {};
    ['mnp', 'kishu', 'shinki'].forEach((proc) => {
      T.lines.clearAll();
      T.lines.pick(0);
      T.lines.fill(0, { procType: proc, payMethod: 'bunkatsu36' });
      T.lines.pick(0);
      const sel = document.getElementById('deviceSelect');
      const opt = Array.prototype.filter.call(sel.options, (o) => /テスト端末A/.test(o.textContent))[0];
      sel.value = opt ? opt.value : '';
      sel.dispatchEvent(new Event('change'));
      out[proc] = { atama: document.getElementById('atamakin').value,
        sheet: T.saved.sheetText() };
    });
    return out;
  });
  chk('⑨ MNPで機種を選んでも、頭金の初期値（11,000円）が入らない',
    !Number(atama.mnp.atama), 'atamakin=' + atama.mnp.atama);
  chk('⑨ MNPの見積書に「店頭お支払い 11,000円」と出ない',
    atama.mnp.sheet.indexOf('11,000') < 0,
    atama.mnp.sheet.split('\n').filter((l) => /11,000/.test(l)).join(' / '));
  chk('⑨ 機種変更ではこれまでどおり頭金の初期値が入る',
    Number(atama.kishu.atama) === 11000, 'atamakin=' + atama.kishu.atama);
  chk('⑨ 新規契約でもこれまでどおり入る',
    Number(atama.shinki.atama) === 11000, 'atamakin=' + atama.shinki.atama);

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('端末マスタの取り込みに問題があります: ' + ok.length + '/' + (ok.length + ng.length)
      + '\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('端末マスタの取り込みのテスト: ' + ok.length + '/' + ok.length + ' OK');
})();
