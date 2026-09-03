/* 料金表の配信と「受付終了」のテスト（製品化レビュー 4-11）
 *
 * 使い方: node tests/run-master-update-tests.js
 *
 * 何を見張っているか:
 *  ・配信（data.js）に retiredFrom を書くと、店舗の料金表に「受付終了」が届くこと
 *    （店舗が金額を変えていても・店舗独自の印を付けていても届く）
 *  ・配信から retiredFrom を消すと、受付再開もちゃんと届くこと
 *  ・店舗が自分で足した商材が、受付終了の巻き添えにならないこと
 *  ・受付終了は「新しく選べない」だけで、すでに選んである見積もりは
 *    見た目も金額も変わらないこと（過去の見積もり・実績を壊さない）
 *  ・店舗の逃げ道（うちはまだ使う）が効くこと
 *  ・店舗が読む文章に、英語のままの項目名が混ざっていないこと
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
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.std, null, { timeout: 8000 });

  const std = (fn, arg) => page.evaluate(([f, a]) => window.__KQ_TEST__.std[f](a), [fn, arg]);

  // 今日を固定する（端末の時計に左右されないように）
  await std('setToday', '2026-10-15');

  /* ---- 下ごしらえ: 店舗の料金表と、配信データを組み立てる ----
   * 店舗側は「金額を自分で変えた」「店舗独自の印を付けた」「自分で足した」を含む。 */
  const setup = await page.evaluate(() => {
    const S = window.__KQ_TEST__.std;
    const m = S.get();
    // 店舗が金額を変えたオプション（配信由来）
    const anshin = m.options.filter((o) => o.id === 'anshin_pack')[0];
    if (anshin) anshin.price = 1500;
    // 店舗独自の印を付けた配信由来のオプション
    const dmag = m.options.filter((o) => o.id === 'dmagazine')[0];
    if (dmag) dmag.own = true;
    // 店舗が自分で足した商材（配信には無い）
    m.options.push({ id: 'shop_own_1', name: 'うちの見守りサービス', price: 500, category: 'その他', own: true });
    S.set(m);
    return {
      hasAnshin: !!anshin, hasDmag: !!dmag,
      campaigns: (S.dist().campaigns || []).map((c) => ({ id: c.id, plans: c.plans || [] })),
      campaignIds: (S.dist().campaigns || []).map((c) => c.id),
      voiceIds: (S.dist().voiceOptions || []).map((v) => v.id),
      planIds: (S.dist().plans || []).map((p) => p.id),
      feeIds: (S.dist().feeItems || []).map((f) => f.id)
    };
  });
  chk('下ごしらえ: 検査に使う項目が料金表にある',
    setup.hasAnshin && setup.hasDmag && setup.campaignIds.length && setup.voiceIds.length,
    JSON.stringify(setup).slice(0, 120));

  const PLAN = setup.planIds[0];
  // ③に必ず出るように、選ぶプランで使えるキャンペーンを選ぶ
  const CAMP = (setup.campaigns.filter((c) => !c.plans.length || c.plans.indexOf(PLAN) >= 0)[0]
    || setup.campaigns[0]).id;
  const VOICE = setup.voiceIds.filter((v) => v !== 'none')[0];

  // 配信データに「受付終了」を書く（版も上げる）
  await page.evaluate(([camp, voice, plan]) => {
    const S = window.__KQ_TEST__.std;
    const d = S.dist();
    d.masterVersion = d.masterVersion + 1;
    d.updated = '2026-10-10';
    const set = (list, id, ymd) => {
      const x = (d[list] || []).filter((y) => y.id === id)[0];
      if (x) x.retiredFrom = ymd;
    };
    set('campaigns', camp, '2026-10-01');       // もう終わっている
    set('voiceOptions', voice, '2026-10-01');
    set('options', 'anshin_pack', '2026-10-01');
    set('options', 'dmagazine', '2026-10-01');  // 店舗独自の印が付いているもの
    set('plans', plan, '2026-12-01');           // これから終わる（予告）
    S.setDist(d);
  }, [CAMP, VOICE, PLAN]);

  chk('① 版が上がると「料金表の更新があります」になる', await std('available'));

  const ended = await std('ended');
  const endedNames = ended.map((e) => e.name).join('｜');
  chk('② 更新の前に「受付が終わるもの」を数えられる（5種すべて）',
    ended.length === 5, ended.length + '件: ' + endedNames);
  chk('② 予告（未来の終了日）も出す',
    ended.filter((e) => e.soon).length === 1, JSON.stringify(ended.filter((e) => e.soon)));

  const changes = await std('changes');
  const lines = (changes && changes.lines) || [];
  chk('③ 「変わる内容」に受付終了の行が日本語で出る',
    lines.some((l) => /受付終了/.test(l)), JSON.stringify(lines).slice(0, 200));
  // 商材の名前（smartあんしんパックなど）に英字が入るのは正しいので、
  // 「日本語にし忘れた項目名」（の◯◯を…／retiredFrom など）だけを弾く
  const rawField = (l) => /retiredFrom|keepAnyway|の[a-zA-Z]+[をがはに]/.test(l);
  chk('③ 店舗が読む行に、日本語にし忘れた項目名が混ざっていない',
    !lines.some(rawField), JSON.stringify(lines.filter(rawField)));

  // 更新を当てる
  await std('apply');
  const after = await std('get');

  const findIn = (list, id) => (after[list] || []).filter((x) => x.id === id)[0];
  chk('④ 店舗が金額を変えていても受付終了は届く',
    !!(findIn('options', 'anshin_pack') || {}).retiredFrom,
    JSON.stringify(findIn('options', 'anshin_pack')).slice(0, 160));
  chk('④ 店舗独自の印を付けていても受付終了は届く',
    !!(findIn('options', 'dmagazine') || {}).retiredFrom);
  chk('④ 通話オプションにも届く（配信の引き継ぎが手書きの場所）',
    !!(findIn('voiceOptions', VOICE) || {}).retiredFrom);
  chk('④ キャンペーンにも届く', !!(findIn('campaigns', CAMP) || {}).retiredFrom);
  chk('④ 店舗が自分で足した商材は、消えも終了もしない',
    !!findIn('options', 'shop_own_1') && !findIn('options', 'shop_own_1').retiredFrom,
    JSON.stringify(findIn('options', 'shop_own_1')));

  // 見積もり画面（キャンペーンはプランを選んでいるときだけ出る）
  await std('pick', 'plan');
  await page.evaluate(([plan]) => window.__KQ_TEST__.std.pick('plan', plan), [PLAN]);
  await std('redraw');
  const view1 = await page.evaluate(([camp, voice]) => {
    const S = window.__KQ_TEST__.std;
    const q = (sel) => document.querySelector(sel);
    const m = S.get();
    const cname = (m.campaigns.filter((c) => c.id === camp)[0] || {}).name || '（無し）';
    const vname = (m.voiceOptions.filter((v) => v.id === voice)[0] || {}).name || '';
    const vtext = q('#voiceTiles') ? q('#voiceTiles').innerText : '';
    return {
      optionList: q('#optionList') ? q('#optionList').innerText : '',
      campaign: q('#campaignList') ? q('#campaignList').innerText : '',
      campName: cname,
      voice: vtext,
      // 新旧をまとめたタイルなので、名前ではなく「受付終了」の印で見る
      voiceHasEnded: /受付終了/.test(vtext),
      planOpts: Array.from(document.querySelectorAll('#planId option')).map((o) => o.textContent)
    };
  }, [CAMP, VOICE]);
  chk('⑤ 受付終了のオプションは一覧に出ない', !/あんしんパック/.test(view1.optionList), view1.optionList.slice(0, 80));
  chk('⑤ 受付終了のキャンペーンは③に出ない', !new RegExp(view1.campName).test(view1.campaign),
    view1.campName + ' / ' + view1.campaign.slice(0, 80));
  chk('⑤ 受付終了の通話オプションは②に出ない',
    !view1.voiceHasEnded, view1.voice.slice(0, 80));
  chk('⑤ 「受付が終わったものも出す」の案内が出る', /受付が終わったものも出す/.test(view1.optionList));

  // 「受付が終わったものも出す」は、実際にボタンを押して確かめる
  await page.click('#optionList [data-ended-toggle]');
  await page.waitForTimeout(200);
  const view2 = await page.evaluate(() => ({
    opt: document.querySelector('#optionList').innerText,
    camp: document.querySelector('#campaignList').innerText
  }));
  chk('⑥ ボタンを押すと受付終了のものも選べる',
    /あんしんパック/.test(view2.opt) && /受付終了/.test(view2.opt), view2.opt.slice(0, 120));
  chk('⑥ 押すと③のキャンペーンにも効く', /受付終了/.test(view2.camp), view2.camp.slice(0, 120));
  await page.click('#optionList [data-ended-toggle]');
  await page.waitForTimeout(200);

  /* ---- すでに選んである見積もりは、見た目も金額も変わらない ---- */
  const keep = await page.evaluate(() => {
    const S = window.__KQ_TEST__.std;
    S.setToday('2026-09-01');               // まだ受付中の日
    S.pick('option', 'anshin_pack', true);
    S.redraw();
    const before = S.totals();
    S.setToday('2026-10-15');               // 受付終了の日をまたぐ
    S.redraw();
    const afterT = S.totals();
    return { before: before, after: afterT, shown: document.querySelector('#optionList').innerText };
  });
  chk('⑦ 受付が終わっても、選んである見積もりの金額は変わらない',
    JSON.stringify(keep.before) === JSON.stringify(keep.after),
    JSON.stringify(keep.before) + ' → ' + JSON.stringify(keep.after));
  chk('⑦ 選んである項目は一覧からも消えない', /あんしんパック/.test(keep.shown), keep.shown.slice(0, 80));

  /* ---- 店舗の逃げ道（うちはまだ使う） ---- */
  const keepAnyway = await page.evaluate(() => {
    const S = window.__KQ_TEST__.std;
    S.pick('option', 'anshin_pack', false);
    const m = S.get();
    const o = m.options.filter((x) => x.id === 'anshin_pack')[0];
    o.keepAnyway = true;
    S.set(m);
    S.redraw();
    return document.querySelector('#optionList').innerText;
  });
  chk('⑧ 「うちはまだ使う」にすると一覧に戻る',
    /あんしんパック/.test(keepAnyway) && !/あんしんパック（受付終了）/.test(keepAnyway),
    keepAnyway.slice(0, 100));

  /* ---- 受付再開が届く ---- */
  const reopen = await page.evaluate(() => {
    const S = window.__KQ_TEST__.std;
    const m = S.get();
    delete m.options.filter((x) => x.id === 'anshin_pack')[0].keepAnyway;
    S.set(m);
    const d = S.dist();
    d.masterVersion = d.masterVersion + 1;
    d.updated = '2026-10-20';
    delete (d.options.filter((o) => o.id === 'anshin_pack')[0] || {}).retiredFrom;
    S.setDist(d);
    S.apply();
    S.redraw();
    return {
      master: S.get().options.filter((o) => o.id === 'anshin_pack')[0],
      shown: document.querySelector('#optionList').innerText
    };
  });
  chk('⑨ 配信から終了日を消すと、受付再開が店舗にも届く',
    !reopen.master.retiredFrom, JSON.stringify(reopen.master).slice(0, 120));
  chk('⑨ 一覧にも戻る', /あんしんパック/.test(reopen.shown));

  /* ---- 通話オプション: 新旧をまとめたタイルを押しても、受付終了のほうが選ばれない ---- */
  const voicePick = await page.evaluate(() => {
    const S = window.__KQ_TEST__.std;
    // 「新」（v5）だけ受付終了にして、タイルを押す
    const m = S.get();
    const nv = m.voiceOptions.filter((v) => v.id === 'v5')[0];
    const ov = m.voiceOptions.filter((v) => v.id === 'v5l')[0];
    if (!nv || !ov) return { skip: true };
    nv.retiredFrom = '2026-10-01';
    delete nv.keepAnyway;
    S.set(m);
    S.pick('voice', 'none');
    S.redraw();
    const tile = document.querySelector('#voiceTiles [data-voice="v5"]');
    if (tile) tile.click();
    return { skip: false, voice: S.get() && window.__KQ_TEST__.std.picked('voice') };
  });
  if (!voicePick.skip) {
    const chosen = await page.evaluate(() => window.__KQ_TEST__.std.picked('voice'));
    chk('⑫ 新旧をまとめたタイルを押しても、受付終了のほうは選ばれない',
      chosen !== 'v5', String(chosen));
  }

  /* ---- テンプレートに入っていた受付終了は外して知らせる ---- */
  const tpl = await page.evaluate(([camp]) => {
    const S = window.__KQ_TEST__.std;
    const T = window.__KQ_TEST__;
    // 受付が終わっている割引（この検査の前半で終了にしたもの）を入れたテンプレを作る
    S.pick('campaign', camp, true);
    T.tplSave(0);
    S.pick('campaign', camp, false);
    T.tplApply(0);
    return {
      picked: !!S.picked('campaign', camp),
      msg: (document.getElementById('tplMsg') || {}).textContent || ''
    };
  }, [CAMP]);
  chk('⑪ テンプレートに入っていた受付終了は外す', !tpl.picked, String(tpl.picked));
  chk('⑪ 外したことを名前つきで知らせる', /受付が終わって/.test(tpl.msg), tpl.msg);

  /* ---- 受付終了のプランを選んである見積もりが、別のプランに化けない ---- */
  const planKeep = await page.evaluate(([plan]) => {
    const S = window.__KQ_TEST__.std;
    S.setToday('2026-12-15');            // プランの終了日（2026-12-01）を過ぎた日
    S.pick('plan', plan);
    S.redraw();
    return { picked: S.get() && document.getElementById('planId').value, want: plan };
  }, [PLAN]);
  chk('⑩ 受付終了のプランを選んである見積もりは、別のプランに変わらない',
    planKeep.picked === planKeep.want, planKeep.picked + ' / ' + planKeep.want);

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('料金表の配信（受付終了）のテスト: ' + ok.length + '/' + (ok.length + ng.length) + '\n  × '
      + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('料金表の配信（受付終了）のテスト: ' + ok.length + '/' + ok.length + ' OK');
})();
