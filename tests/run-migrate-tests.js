/* 古い形で保存された内容を、いまのアプリが正しく読めるかのテスト（製品化レビュー 4-35）
 *
 * 使い方: node tests/run-migrate-tests.js
 *
 * なぜ要るか:
 *   アプリを直すたびに「古い保存を新しい形に直す」処理を足してきた（20か所以上）。
 *   1か所でも漏れると、**古い見積もりを開いたときだけ**値引きが消える・
 *   オプションが消える、といったことが起きる。実際に起きたことがある。
 *   ふだんの検算（run-calc-tests.js）は新しく作った見積もりしか見ないので、
 *   ここでは「昔の店舗の端末に入っている形」を作って読ませ、結果を見る。
 *
 * 見ているもの:
 *   ① 料金表（マスタ）… 昔の書き方でも、いまの形に直って読めること
 *   ② 見積もり … 昔の書き方でも、選んだ内容と金額がそのまま残ること
 *   ③ 店舗が自分で足した商材・自分で変えた金額が、読み直しで消えないこと
 *
 * 期待値は run-calc-tests.js と同じ考え方で、data.js の金額から手で計算している。
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

/* ---- 昔の形の料金表 ----
 * 2026年前半までの保存に入っていた書き方をまとめたもの。
 * 「いまは無い項目」「いまとは違う名前」「いまは別の場所にあるもの」を含む。 */
const OLD_MASTER = {
  // 版数は無い（あとから足した項目）
  fees: { jimu_shinki: 3300, jimu_mnp: 3300, jimu_kishu: 3300 },
  plans: [
    // tiers も discounts も持っている、いちばん普通の形
    { id: 'max', name: 'ドコモ MAX', tiers: [{ label: '〜1GB', price: 5698 }],
      discounts: { minna3: 1210, set: 1210, dcardGold: 550 } },
    // 昔のプラン（group も poikatsuPt も maxBonus も無い）
    { id: 'poikatsu_max', name: 'ポイ活 MAX', tiers: [{ label: '〜1GB', price: 11748 }], discounts: {} }
  ],
  voiceOptions: [
    { id: 'none', name: 'なし', price: 0 },
    // 昔の長い名前（1.128.0 で短くした）
    { id: 'v5l', name: '5分通話無料オプション（留守電・キャッチホン無料なし）', price: 770 }
  ],
  options: [
    // type:"once" … 昔は「オプション」に一括のものが混ざっていた（いまは初期費用へ移す）
    { id: 'old_once_item', name: '昔の一括商材', price: 3300, type: 'once' },
    // 社内表記の名前（お客様の見積書に出るので直す）
    { id: 'anshin_pack', name: 'あんしんパック', price: 792 },
    { id: 'bk_danime', name: 'dアニメストア（爆アゲ）', price: 660 },
    // NETFLIX 旧3項目（いまは料金選択式の1項目に統合）
    { id: 'op_1784430991714', name: 'NETFLIX 広告つきスタンダード', price: 890 },
    // 1.5.7 で取り下げた買い切りオプション（消えるはず）
    { id: 'op_photocube256', name: 'フォトキューブ256', price: 9800 },
    // 店舗が自分で足した商材（消えても変わってもいけない）
    { id: 'shop_own_x', name: 'うちの端末クリーニング', price: 1100, category: 'その他', own: true }
  ],
  // feeItems / campaigns / accessories / templates が無い（あとから足したもの）
  agencyOptions: [
    // 昔の「代理店独自サービス」（いまはオプションに統合）
    { id: 'agency_1', name: '昔の代理店サービス', price: 550 }
  ]
};

/* ---- 昔の形の見積もり ----
 * 「端末を24回で買って、みんなドコモ割3回線＋光セット割、
 *   5分通話（旧）、smartあんしんパック」を選んだ状態を、昔の書き方で。 */
const OLD_QUOTE = {
  active: 0,
  patterns: [
    {
      procType: 'kishu', planId: 'max', tierIdx: 0,
      minna: '3', dSet: true,
      voice: 'v5l',
      options: { anshin_pack: true, old_once_item: true },
      // 昔は「残価」を入れていた（いまは「23回分の総額」）
      payMethod: 'kaedoki', devicePrice: 129800, zanka: 71800,
      // 昔の「キャンペーン値引き」（いまは手値引きとダイレクト割に分かれた）
      campaignOff: 5500,
      deviceName: 'テスト機'
    },
    {}, {}
  ]
};

/* ---- 手計算の期待値 ----
 * 月々のもの:
 *   ドコモ MAX 〜1GB 5,698 −みんな3 1,210 −光セット 1,210 ＝3,278
 *   ＋5分通話無料（旧）770 ＋smartあんしんパック 1,452 ＝5,500
 *   （smartあんしんパックは、昔の 792 円が読み直しで 1,452 円に上がる）
 * 端末（いつでもカエドキ）:
 *   昔の「残価 71,800」は「23回分の総額 129,800 −71,800 ＝58,000」に読み替わる。
 *   昔の「キャンペーン値引き 5,500」はダイレクト割として引き継がれるので
 *   58,000 −5,500 ＝52,500 を23回 → 52,500 ÷23 ＝2,282.6 → 毎月 2,282 円
 *   （端数 52,500 −2,282×23 ＝14 円は初回だけ）
 * 1〜23か月目 5,500 ＋2,282 ＝7,782 円／24か月目から 5,500 円 */
const WANT = {
  seg1: 7782,
  seg2: 5500,
  optTotal: 1452,     // 「昔の一括商材」は初期費用へ移るので、月額のオプションには入らない
  voicePrice: 770
};

(async () => {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, decodeURIComponent(p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); res.end('nf'); return;
    }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(f)]
      || 'application/octet-stream';
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
  await page.waitForTimeout(700);
  await page.click('#setupSkip').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('#tourSkip').catch(() => {});
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.migrate, null, { timeout: 8000 });

  // ---- ① 古い形の料金表を読ませる ----
  const m = await page.evaluate((raw) => window.__KQ_TEST__.migrate.loadMaster(raw),
    JSON.stringify(OLD_MASTER));
  const opt = (id) => (m.options || []).filter((o) => o.id === id)[0];
  const fee = (id) => (m.feeItems || []).filter((f) => f.id === id)[0];

  chk('① 昔の一括商材（type:"once"）が初期費用へ移る',
    !opt('old_once_item') && !!fee('old_once_item'), JSON.stringify(fee('old_once_item')));
  chk('① 昔の「代理店独自サービス」がオプションへ入る',
    !!opt('agency_1') && !m.agencyOptions, JSON.stringify(opt('agency_1')));
  chk('① 社内表記の名前が、お客様に出せる名前へ直る',
    (opt('anshin_pack') || {}).name === 'smartあんしんパック'
    && (opt('bk_danime') || {}).name === 'dアニメストア',
    [(opt('anshin_pack') || {}).name, (opt('bk_danime') || {}).name].join(' / '));
  chk('① smartあんしんパックの初期値が 792 → 1,452 円になる',
    (opt('anshin_pack') || {}).price === 1452, String((opt('anshin_pack') || {}).price));
  chk('① NETFLIX の旧3項目が消え、料金選択式の1項目になる',
    !opt('op_1784430991714') && !!opt('netflix') && !!(opt('netflix') || {}).priceChoices,
    JSON.stringify(opt('netflix')));
  chk('① 取り下げた買い切りオプションが消える', !opt('op_photocube256'));
  chk('① 通話オプションの長い名前が短くなる',
    ((m.voiceOptions || []).filter((v) => v.id === 'v5l')[0] || {}).name === '5分通話無料オプション（旧）',
    JSON.stringify((m.voiceOptions || []).filter((v) => v.id === 'v5l')[0]));

  // 後から足した入れ物が埋まる
  /* アクセサリは店舗の商材なので、配信の初期値は空。入れ物だけできていればよい */
  chk('① 後から足した入れ物（初期費用・キャンペーン・アクセサリ）が埋まる',
    (m.feeItems || []).length > 1 && (m.campaigns || []).length > 0
    && Array.isArray(m.accessories),
    [(m.feeItems || []).length, (m.campaigns || []).length,
     JSON.stringify(m.accessories)].join(' / '));
  chk('① テンプレートの入れ物が3つできる',
    Array.isArray(m.templates) && m.templates.length === 3, JSON.stringify(m.templates));
  chk('① 料金表の版数が入る（次の改定から知らせる）',
    typeof m.masterVersion === 'number' && m.masterVersion > 0, String(m.masterVersion));

  // プランの性質が補完される
  const plan = (id) => (m.plans || []).filter((p) => p.id === id)[0];
  chk('① プランの区分（表示グループ）が入る',
    (plan('max') || {}).group === 'current', JSON.stringify((plan('max') || {}).group));
  chk('① ポイ活のポイント数が補われる',
    (plan('poikatsu_max') || {}).poikatsuPt === 5000, String((plan('poikatsu_max') || {}).poikatsuPt));
  chk('① 爆アゲの区分・dカード還元の対象が補われる',
    (plan('max') || {}).bakuageTier === 'max' && (opt('bk_danime') || {}).bakuage === 10,
    [(plan('max') || {}).bakuageTier, (opt('bk_danime') || {}).bakuage].join(' / '));
  chk('① 新しく増えたプランが追記される',
    (m.plans || []).length > 2, String((m.plans || []).length));

  // ---- ③ 店舗のものが壊れない ----
  chk('③ 店舗が自分で足した商材が残る（名前・金額・独自の印そのまま）',
    !!opt('shop_own_x') && opt('shop_own_x').price === 1100 && opt('shop_own_x').own === true,
    JSON.stringify(opt('shop_own_x')));
  chk('③ 店舗が変えた事務手数料が残る（配信の値で上書きしない）',
    m.fees.jimu_mnp === 3300, String(m.fees.jimu_mnp));

  // ---- ② 古い形の見積もりを読ませる ----
  const q = await page.evaluate((raw) => window.__KQ_TEST__.migrate.loadQuote(raw),
    JSON.stringify(OLD_QUOTE));
  const st = q.state, c = q.calc;

  chk('② 選んだプラン・割引がそのまま残る',
    st.planId === 'max' && st.minna === '3' && st.dSet === true,
    JSON.stringify({ planId: st.planId, minna: st.minna, dSet: st.dSet }));
  chk('② 選んだ通話オプションが残る', st.voice === 'v5l', st.voice);
  chk('② 選んだオプションが残る', st.options.anshin_pack === true, JSON.stringify(st.options));
  chk('② 昔の「残価」が「23回分の総額」に読み替わる',
    st.kaedoki23 === 58000 && typeof st.zanka === 'undefined',
    JSON.stringify({ kaedoki23: st.kaedoki23, zanka: st.zanka }));
  chk('② 昔の「キャンペーン値引き」がダイレクト割に引き継がれる',
    st.directOff === 5500 && typeof st.campaignOff === 'undefined',
    JSON.stringify({ directOff: st.directOff, campaignOff: st.campaignOff }));
  chk('② 手続きの種類が「やること」に引き継がれる',
    !!(st.procTodo && st.procTodo.kishu), JSON.stringify(st.procTodo));

  // 金額（手計算）
  const seg1 = (c.segs[0] || {}).monthly;
  const seg2 = (c.segs[1] || {}).monthly;
  chk('② 月額が手計算と合う（1〜23か月目 ' + WANT.seg1 + '円）',
    seg1 === WANT.seg1, String(seg1) + '円 / segs=' + JSON.stringify(c.segs));
  chk('② 端末を払い終えたあとも手計算と合う（' + WANT.seg2 + '円）',
    seg2 === WANT.seg2, String(seg2) + '円');
  chk('② オプションの合計が手計算と合う（' + WANT.optTotal + '円）',
    c.optTotal === WANT.optTotal, String(c.optTotal));
  chk('② 通話オプションが手計算と合う（' + WANT.voicePrice + '円）',
    c.voicePrice === WANT.voicePrice, String(c.voicePrice));

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('古い保存データの読み直しに問題があります: ' + ok.length + '/' + (ok.length + ng.length)
      + '\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('古い保存データの読み直しのテスト: ' + ok.length + '/' + ok.length + ' OK');
})();
