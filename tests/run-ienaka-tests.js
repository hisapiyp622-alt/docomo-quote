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
/* --update は既定で「差分を見せるだけ」。書き換えるには --yes も付ける。
 * ケータイ側（run-calc-tests.js）は 4-36 でそうしたのに、こちらは
 * --update だけでアプリの出力をそのまま正解に焼き直せてしまい、
 * 金額が狂っても気づけない状態だった（2026-09-08）。 */
const UPDATE = process.argv.indexOf('--update') >= 0;
const YES = process.argv.indexOf('--yes') >= 0;

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

/* 代表パターン（defaultState への差分）。
 * 期待値の根拠は tests/golden-ienaka.json のコミット時に PR で確認する。 */
const CASES = {
  'hikari1g_ht_A_shinki': {},
  'hikari1g_mansion': { housing: 'ms' },
  /* マンション（100M）。料金表は 戸建（ht）と マンション（ms）しか持っていないので、
   * ms100 は ms として引く。この読み替えが無いと、料金表に無い鍵を引いて
   * 画面が固まり、金額が戸建のまま直らなかった（2026-09-08）。 */
  'hikari1g_ms100': { housing: 'ms100' },
  'hikari10g_ms100': { product: 'hikari10g', housing: 'ms100' },
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
  /* ドコモ光 10ギガ タイプC（2026-09-06 追加）。
   * 出典: https://www.docomo.ne.jp/internet/hikari/charge/10g_type_c/
   * 月額 6,380円（2年定期契約・税込）で**戸建・マンション同額**。
   * 1ギガ タイプCと違い、マンションでも戸建に寄せない（同額なので寄せる意味がない）。 */
  'typec10g_kodate': { product: 'hikaric10g', housing: 'ht', applyType: 'shinki', onecoin: false },
  'typec10g_mansion': { product: 'hikaric10g', housing: 'ms', applyType: 'shinki', onecoin: false },
  // ベイコム（1ギガではマンション対象外の会社）でも、10ギガは同額のまま
  'typec10g_baycom_mansion': { product: 'hikaric10g', applyType: 'kirikae',
    housing: 'ms', curLine: 'baycom', onecoin: false },
  // ワンコイン（6か月500円）の対象
  'typec10g_onecoin': { product: 'hikaric10g', housing: 'ht', applyType: 'shinki', onecoin: true },
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
  /* 営業用デモ（/ienaka-demo/）も同じ計算になることを見る（2026-09-08）。
   * デモは tools/build-demo.js が単体版から作るが、生成物が古いまま
   * コミットされることがあるので、実際に動かして金額で確かめる。
   * 2026-09-08 まで、デモだけタイプC×マンションが 4,400円（正しくは 5,720円）と
   * 出ていたのに、テストはデモ版を1度も開いていなかった。 */
  const demo = await runOn(page, '/ienaka-demo/', port);

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
    /* 初期値は、そのときの上限（2026年12月の改定で 20% → 12%）。
     * 上限そのものの確認は、下の「2026年12月の改定」でまとめて見る。 */
    const mx = String(await page.evaluate(() => window.__IE_TEST__.platMax()));
    if (await page.inputValue(rateId) !== mx) {
      uiBad.push('還元率の初期値が上限（' + mx + '）になっていません');
    }
    // 率を下げると、還元ポイントも下がる
    const pt = () => page.$eval('#dcardHint', (e) => (e.textContent.match(/→ (\d+)pt/) || [])[1]);
    const atMax = await pt();
    await page.fill(rateId, '10'); await page.dispatchEvent(rateId, 'input'); await page.waitForTimeout(300);
    const at10 = await pt();
    if (!(Number(at10) > 0 && Number(at10) * Number(mx) === Number(atMax) * 10)) {
      uiBad.push(`率を ${mx}%→10% にしても、ポイントが率どおりに減りません（${atMax}pt → ${at10}pt）`);
    }
    // 範囲の外を入れたら上限に直る
    await page.fill(rateId, '99'); await page.dispatchEvent(rateId, 'change'); await page.waitForTimeout(300);
    if (await page.inputValue(rateId) !== mx) uiBad.push('範囲の外の値が上限に直りません');
    await page.selectOption(sel, 'none'); await page.waitForTimeout(200);
  }
  await rateCheck('#dcard', '#platRate', '#platRateHint');

  /* 2026年12月の改定（製品化レビュー 4-17）。
   * ドコモ光への dカード PLATINUM の還元が、最大20% → 最大12% に変わる。
   *   出典: https://www.docomo.ne.jp/info/notice/page/260901_00.html
   * ※ケータイの進呈率（10/15/20%）は変わらない。変わるのはドコモ光のほう。
   *
   * ★ **2026-09-06 の店舗判断で「いま即座に切り替え」** ている。
   *   11月ご利用分まではお客様が実際に受け取るポイントのほうが多くなるので、
   *   見積書が「多めに見せる」side には倒れないため。
   *   そのため、きょうの日付を11月にしても12月にしても **同じ 12% になるのが正しい**。 */
  const revBad = [];
  {
    const setDay = (d) => page.evaluate((x) => window.__IE_TEST__.setToday(x), d);
    const maxOf = () => page.evaluate(() => window.__IE_TEST__.platMax());
    const rateOf = () => page.evaluate(() => window.__IE_TEST__.platRate());

    for (const day of ['2026-11-30', '2026-12-01', '']) {
      await setDay(day);
      const mx = await maxOf();
      if (mx !== 12) revBad.push('上限が 12% になりません（日付 ' + (day || 'きょう') + ' で ' + mx + '）');
    }

    /* 20% のまま保存してあった見積もりを開いたときは、12% に落ちること
     * （公式の率より高いポイントを、お客様にお見せしないため） */
    await page.evaluate(() => { window.__IE_TEST__.run({ dcard: 'platinum', dcardPlatRate: 20 }); });
    if (await rateOf() !== 12) revBad.push('20%のまま保存した見積もりが 12% に落ちません');

    // 画面の入力欄・案内文・選択肢の文字も 12% になること
    await page.selectOption('#dcard', 'platinum'); await page.waitForTimeout(300);
    const mx2 = await page.getAttribute('#platRate', 'max');
    if (String(mx2) !== '12') revBad.push('入力欄の上限が 12 になりません（いま ' + mx2 + '）');
    if (await page.inputValue('#platRate') !== '12') {
      revBad.push('還元率の初期値が 12 になりません（いま ' + await page.inputValue('#platRate') + '）');
    }
    const hint = await page.textContent('#platRateHint');
    if (!/最大12%/.test(hint || '')) revBad.push('案内文に「最大12%」が出ません');
    if (!/11月のご利用分まで|11月ご利用分まで/.test(hint || '')) {
      revBad.push('案内文に「11月ご利用分までは最大20%」の断りが出ません');
    }
    const optTxt = await page.textContent('#dcardPlatOpt');
    if (!/12%/.test(optTxt || '')) revBad.push('選択肢の文字が 12% になりません（いま ' + optTxt + '）');

    /* お客様の見積書に入る一文（改定の断り）。12月になるまでは出す。 */
    await setDay('2026-11-30');
    await page.selectOption('#dcard', 'gold'); await page.waitForTimeout(150);
    await page.selectOption('#dcard', 'platinum'); await page.waitForTimeout(300);
    const notes = await page.evaluate(() => window.__IE_TEST__.reviseNotices
      ? window.__IE_TEST__.reviseNotices() : []);
    if (!notes.length || !/多くたまります/.test(notes.join(''))) {
      revBad.push('見積書に入る断りが「実際にはこれより多くたまります」になっていません: ' + JSON.stringify(notes));
    }
    await setDay('');
    await page.selectOption('#dcard', 'none'); await page.waitForTimeout(200);
  }

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

    /* ★ 一覧の「数」も見る（2026-09-06 の不具合）。
     * 出さないはずのケーブルテレビ会社が、実機（iPad の Safari）では
     * ぜんぶ出て 122件になっていた。原因は option の hidden で隠していたこと。
     * Safari はそれを無視する。**一覧そのものから外さないと隠れない。**
     * 数を見ておけば、同じことが起きたとき必ず落ちる。 */
    const all = await p3.evaluate(() => window.__IE_TEST__.hintFor({}));
    if (all.optionCount > 20) {
      optBad.push('選択肢が多すぎます（' + all.optionCount + '件）。'
        + '出さないはずの回線が一覧に残っています: '
        + all.optionNames.slice(0, 8).join('・') + ' …');
    }
    // ケーブルテレビ会社は、設定していない店舗では1社も出さない
    const catvOut = all.optionNames.filter((n) => /タイプC対象外|ケーブル|CATV/.test(n));
    if (catvOut.length) {
      optBad.push('ケーブルテレビ会社が既定で出ています: ' + catvOut.slice(0, 5).join('・'));
    }
    await p3.close();
  }
  if (optBad.length) {
    console.error('既定で出さない回線の設定に問題があります:\n  ✗ ' + optBad.join('\n  ✗ '));
    process.exit(1);
  }
  console.log('既定で出さない回線（auひかり・楽天ひかり）: 問題なし');

  /* ---- 引き継いだ担当者名が、同期の初回受信で前の担当者名に戻らないか
   *      （2026-09-08。お客様にお渡しする紙に違う担当者名が出ていた）---- */
  await page.goto(`http://127.0.0.1:${port}/ienaka-app/`);
  await page.waitForFunction(() => window.__IE_TEST__ && window.__IE_TEST__.handoffThenSync,
    null, { timeout: 20000 });
  const ho = await page.evaluate(() => window.__IE_TEST__.handoffThenSync('安藤', '山田'));
  if (ho.first !== '安藤') {
    console.error('✗ 引き継いだ担当者名が、同期の初回受信で戻ってしまいます: '
      + JSON.stringify(ho));
    process.exitCode = 1;
  } else if (ho.second !== '山田') {
    console.error('✗ 2回目以降も担当者名が同期されません（守りすぎです）: ' + JSON.stringify(ho));
    process.exitCode = 1;
  } else {
    console.log('引き継いだ担当者名: 問題なし（初回は守り、2回目からは同期する）');
  }

  /* ---- 商材を ahamo光／タイプC に変えたあと、前の商材で選んだプロバイダの
   *      ご案内が『開通までの流れ』に残っていないか（2026-09-08）---- */
  const flow = await page.evaluate(() => {
    const T = window.__IE_TEST__;
    const base = { enabled: true, applyType: 'shinki', provider: '@nifty', visitSupport: true };
    return {
      nifty: T.flowText(Object.assign({}, base, { product: 'hikari1g' })),
      ahamo: T.flowText(Object.assign({}, base, { product: 'ahamo1g' })),
      typec: T.flowText(Object.assign({}, base, { product: 'hikaric' })),
      home5g: T.flowText(Object.assign({}, base, { product: 'home5g' }))
    };
  });
  const flowBad = [];
  if (!/訪問設定サポート/.test(flow.nifty) || !/訪問サポートの日程/.test(flow.nifty)) {
    flowBad.push('ドコモ光1ギガ＋@nifty のときに訪問設定サポートの案内が出ていません');
  }
  ['ahamo', 'typec', 'home5g'].forEach((k) => {
    if (/@nifty/.test(flow[k])) {
      flowBad.push(k + ' に @nifty の案内が残っています: '
        + (flow[k].split('\n').filter((l) => /@nifty/.test(l))[0] || ''));
    }
  });
  if (flowBad.length) {
    console.error('開通までの流れに、前の商材のご案内が残っています:\n  ✗ ' + flowBad.join('\n  ✗ '));
    process.exitCode = 1;
  } else {
    console.log('商材を切り替えたときの開通までの流れ: 問題なし');
  }

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
  const demoDiffs = [];
  for (const name of Object.keys(CASES)) {
    if (INTEGRATED_ONLY.indexOf(name) >= 0) continue;
    const a = stable(integrated[name]);
    const b = stable(standalone[name]);
    if (a !== b) diffs.push({ name, a, b });
    const c = stable(demo[name]);
    if (b !== c) demoDiffs.push({ name, a: b, b: c });
  }

  if (UPDATE && !YES) {
    const before = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
    const changed = Object.keys(integrated).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(integrated[k]));
    console.log(changed.length
      ? '正解と違うのは ' + changed.length + '件です:\n  ・' + changed.join('\n  ・')
      : '正解との違いはありません。');
    console.log('\n中身を確かめて、意図した料金変更であれば --yes を付けて実行してください:');
    console.log('  node tests/run-ienaka-tests.js --update --yes');
    process.exit(changed.length ? 1 : 0);
  }
  if (UPDATE && YES) {
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
  if (revBad.length) {
    console.error('2026年12月の改定（ドコモ光の還元率）に問題があります:\n  ✗ ' + revBad.join('\n  ✗ '));
    process.exit(1);
  }
  console.log('2026年12月の改定（ドコモ光 最大12%）: 問題なし');
  const shared = Object.keys(CASES).length - INTEGRATED_ONLY.length;
  console.log(`光・5Gの金額テスト: ${ok}/${Object.keys(CASES).length} OK`
    + `（統合版と単体版の一致: ${shared - diffs.length}/${shared}`
    + ` ／ 単体版と営業用デモの一致: ${shared - demoDiffs.length}/${shared}）`);
  bad.forEach((b) => {
    console.error('✗ ' + b.name + '\n    期待: ' + JSON.stringify(b.want && b.want.segs)
      + '\n    実際: ' + JSON.stringify(b.got && b.got.segs));
  });
  diffs.forEach((d) => {
    console.error('✗ 統合版と単体版で結果が違う: ' + d.name
      + '\n    統合版: ' + d.a.slice(0, 200) + '\n    単体版: ' + d.b.slice(0, 200));
  });
  demoDiffs.forEach((d) => {
    console.error('✗ 単体版と営業用デモで結果が違う: ' + d.name
      + '\n    単体版: ' + d.a.slice(0, 200) + '\n    デモ版: ' + d.b.slice(0, 200)
      + '\n    → node tools/build-demo.js でデモを作り直してください');
  });
  if (bad.length || diffs.length || demoDiffs.length) {
    if (bad.length) console.error('\n意図した料金変更の場合は node tests/run-ienaka-tests.js --update で golden を更新してください。');
    process.exit(1);
  }
})();
