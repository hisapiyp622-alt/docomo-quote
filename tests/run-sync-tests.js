/* 端末どうしの同期で、見積もりが消えないかの確認（4-40）
 *
 * 使い方: node tests/run-sync-tests.js
 *
 * なぜ要るか（2026-09-04 阪南で実際に起きたこと）:
 *   iPadで作った見積もりを、あとからPCで開いたら、PCに残っていた
 *   古い見積もりで上書きされた。原因は「開く前の時刻」の控え方。
 *
 *   ① 起動      loadState() が「開く前の時刻」を控える（正しい）
 *   ② 起動の続き recalc() → saveState() が、その時刻を「今」に書き換える
 *   ③ 担当を選ぶ loadState() がもう一度走り、控えが「今」になってしまう ← ここ
 *   ④ 同期開始  「この端末（今）＞ クラウド（数分前）」となり、
 *               何も入力していないのに、この端末の古い内容を送ってしまう
 *
 *   画面を開いただけで「たった今この端末で編集した」ことになるため、
 *   あとから開いたほうが必ず勝つ＝先に作ったほうが必ず消える。
 *
 * 見ているもの:
 *   ① 「開く前の時刻」は、担当ごとにこのページで1回しか控えないこと
 *   ② 画面を描き直しても（＝自動保存が走っても）その控えが動かないこと
 *   ③ 端末の時計のずれ（数分）では、勝ち負けがひっくり返らないこと
 *   ④ どちらを採るときも、消えるほうを「保存」タブの自動控えに残すこと
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
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.sync, null, { timeout: 8000 });

  /* ---- ① いまの端末に「30分前に直した見積もり」があることにする ----
   * 起動のときに控えるものなので、置いてから**開き直す**。 */
  const atKey = await page.evaluate(() => window.__KQ_TEST__.sync.atKey());
  const long = await page.evaluate((k) => {
    const t = Date.now() - 30 * 60 * 1000;
    localStorage.setItem(k, String(t));
    return t;
  }, atKey);

  await page.reload();
  await page.waitForTimeout(700);
  await page.click('#setupSkip').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('#tourSkip').catch(() => {});
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.sync, null, { timeout: 8000 });

  const setup = await page.evaluate(() => {
    const S = window.__KQ_TEST__.sync;
    return { loaded: S.loadedAt(), stored: S.storedAt() };
  });
  chk('① 開いた時点で「開く前の時刻」を控えている',
    Math.abs(setup.loaded - long) < 1000, setup.loaded + ' / ' + long);

  /* ---- ② 画面を描き直す（自動保存が走って、時刻が「今」になる） ---- */
  const afterTouch = await page.evaluate(() => {
    const S = window.__KQ_TEST__.sync;
    S.touch();                       // recalc() → saveState() → markQuoteAt(今)
    return { stored: S.storedAt(), loaded: S.loadedAt() };
  });
  chk('② 自動保存で、保存されている時刻は「今」になる',
    afterTouch.stored > long, String(afterTouch.stored));
  chk('② それでも「開く前の時刻」は動かない',
    Math.abs(afterTouch.loaded - long) < 1000, String(afterTouch.loaded));

  /* ---- ③ 担当を選び直す（loadState がもう一度走る）----
   * ここで控えが「今」になってしまうのが、今回の不具合の正体。 */
  const afterReload = await page.evaluate(() => {
    const S = window.__KQ_TEST__.sync;
    return { loaded: S.reload(), stored: S.storedAt() };
  });
  const drift = afterReload.loaded - long;
  chk('③ 担当を選び直しても「開く前の時刻」は動かない（今回の不具合）',
    Math.abs(drift) < 1000,
    '開く前 ' + long + ' → 控え ' + afterReload.loaded
    + '（' + Math.round(drift / 1000) + '秒ずれた。0であるべき）');

  /* ---- ④ 時計のずれの許容 ---- */
  const skew = await page.evaluate(() => window.__KQ_TEST__.sync.skewMs());
  chk('④ 端末の時計のずれを見込んでいる（3分以上）', skew >= 3 * 60 * 1000,
    Math.round(skew / 60000) + '分');

  /* ---- ⑤ 消えるほうを控えに残す ---- */
  const stash = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.sync;
    // この端末に中身を入れる
    T.std.pick('plan', T.std.get().plans[0].id);
    const before = S.autoNames().length;
    // 「ほかの端末の内容」が届いたことにして、控えを取らせる
    const other = JSON.stringify({
      active: 0, gen: 0,
      patterns: [{ planId: 'max', procType: 'kishu', devicePrice: 99800,
        deviceName: 'よその端末の機種' }, {}, {}]
    });
    S.stashRemote(other);
    return { before: before, names: S.autoNames(), payload: S.payload() };
  });
  chk('⑤ ほかの端末の内容を、消す前に自動控えとして残す',
    stash.names.length > stash.before
    && stash.names.some((n) => /ほかの端末の内容/.test(n)),
    JSON.stringify(stash.names));
  chk('⑤ 控えを取っても、この端末の内容は変わらない',
    !/よその端末の機種/.test(stash.payload), stash.payload.slice(0, 120));

  /* ---- ⑥ 料金表が届いて画面を描き直しても、
   *      「この端末で入力があった」と数えない（4-40 の2つ目の経路）----
   * 選べなくなった段階をアプリが選び直すなど、お店の人が何も触っていないのに
   * 見積もりの中身が変わることがある。これを入力と数えると、この端末が勝ち、
   * ほかの端末で作った見積もりを消してしまう。 */
  const store = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.sync;
    // 段階（データ量）が複数あるプランを選び、2つ目の段階にしておく
    const m0 = T.std.get();
    const plan = m0.plans.filter((p) => p.tiers && p.tiers.length > 1)[0];
    T.std.pick('plan', plan.id);
    const sel = document.getElementById('tierIdx');
    sel.value = '1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    const before = S.payload();
    S.markSig();                       // 同期を見張り始めたときの控え
    const editedAtStart = S.edited();

    // ほかの端末から、その段階が無くなった料金表が届いたことにする
    const m = T.std.get();
    m.plans.filter((p) => p.id === plan.id)[0].tiers = [plan.tiers[0]];
    S.applyStore({ master: JSON.stringify(m) });

    return { editedAtStart: editedAtStart, changed: S.payload() !== before,
      edited: S.edited(), plan: plan.id };
  });
  chk('⑥ 見張り始めた直後は「入力あり」にならない',
    store.editedAtStart === false, String(store.editedAtStart));
  // 中身が実際に変わったことを確かめる（変わらなければテストの意味がない）
  chk('⑥ 料金表が届いて、アプリが見積もりの中身を直している',
    store.changed === true, store.plan);
  chk('⑥ それでも「この端末で入力があった」ことにはならない',
    store.edited === false, 'アプリの都合の変更を入力と数えている');

  /* ---- ⑦ 別端末で次のお客様を始めたら、前のお客様の情報を残さない ----
   * 氏名と請求内訳は同期されないので、同じお客様ならこの端末の内容を保つ。
   * お客様の区切り（gen）が進んだときは、全回線で前のお客様の情報を外す。
   * 内部の判定だけでなく、保存された実データと氏名入力欄の表示を確かめる。 */
  const customers = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.sync;
    const L = T.lines;
    const gen = S.gen();
    const expected = [];
    for (let i = 0; i < L.max(); i++) {
      const personal = {
        custName: '検証のお客様' + (i + 1),
        curBill: { lines: [{ n: '検証用の請求項目' + (i + 1), a: 1000 + i }],
          total: 1000 + i, month: '2026年9月', gen: gen }
      };
      expected.push(personal);
      L.fill(i, Object.assign({ planId: T.std.get().plans[0].id, procType: 'kishu' }, personal));
    }
    L.pick(L.max() - 1);
    function readBack() {
      const saved = JSON.parse(localStorage.getItem(S.quoteKey()));
      const namesShown = [];
      for (let i = 0; i < L.max(); i++) {
        L.pick(i);
        namesShown.push(document.getElementById('custName').value);
      }
      return { gen: saved.gen, namesShown: namesShown, patterns: saved.patterns.map((pt) => ({
        custName: pt.custName, curBill: pt.curBill || null, deviceName: pt.deviceName
      })) };
    }
    const same = JSON.parse(S.payload()); // 実際の送信と同じく、氏名・請求内訳は入れない
    same.patterns.forEach((pt, i) => { pt.deviceName = '同じお客様の機種' + (i + 1); });
    const oldPayload = JSON.stringify(same);
    S.applyRemote(oldPayload, false);
    const sameCustomer = readBack();

    // 古い保存は gen が無い。区切り0の同じお客様として扱い、氏名を消さない。
    const legacy = JSON.parse(oldPayload);
    delete legacy.gen;
    S.applyRemote(JSON.stringify(legacy), false);
    const legacyCustomer = readBack();

    const next = JSON.parse(S.payload());
    next.gen = gen + 1;
    next.patterns.forEach((pt, i) => { pt.deviceName = '次のお客様の機種' + (i + 1); });
    S.applyRemote(JSON.stringify(next), false);
    const nextCustomer = readBack();

    // 次のお客様への切り替え後に、古い内容が遅れて届く場合（初回・継続中の両方）。
    const stale = [true, false].map((first) => {
      S.applyRemote(oldPayload, first);
      return readBack();
    });
    return { gen: gen, expected: expected, same: sameCustomer, legacy: legacyCustomer,
      next: nextCustomer, stale: stale };
  });
  chk('⑦ gen の無い旧形式の確認は、お客様の区切り0で行っている', customers.gen === 0);
  customers.expected.forEach((personal, i) => {
    const line = '回線' + (i + 1);
    [ ['同じお客様の同期', customers.same], ['gen の無い旧形式の同期', customers.legacy] ]
      .forEach(([label, result]) => {
        chk('⑦ ' + label + 'でも' + line + 'の氏名と請求内訳が残る',
          result.patterns[i].custName === personal.custName
          && result.namesShown[i] === personal.custName
          && JSON.stringify(result.patterns[i].curBill) === JSON.stringify(personal.curBill),
          JSON.stringify(result.patterns[i]) + ' / 入力欄: ' + result.namesShown[i]);
      });
    chk('⑦ 別端末で次のお客様を始めると' + line + 'の前の氏名と請求内訳が消える',
      customers.next.gen === customers.gen + 1
      && customers.next.patterns[i].custName === '' && customers.next.namesShown[i] === ''
      && customers.next.patterns[i].curBill === null,
      JSON.stringify(customers.next.patterns[i]) + ' / 入力欄: ' + customers.next.namesShown[i]);
  });
  customers.stale.forEach((result, i) => {
    chk('⑦ 古いお客様の同期が遅れて届いても次のお客様の内容を変えない（'
      + (i === 0 ? '初回' : '継続中') + '）',
    JSON.stringify(result) === JSON.stringify(customers.next), JSON.stringify(result));
  });

  /* ---- ⑨「新しいお客様として始める」のあとに、前の見積もりが戻ってこないか ----
   * 2026-09-06 阪南で発生。新しいお客様として始めると、この端末の見積もりは
   * 空になる。ところがクラウドにはまだ前のお客様の内容が残っているため、
   * 同期の初回でそれを取り込んでしまい、**消したはずの見積もりが戻っていた**。
   * 中身が空になったせいで「この端末を勝ちにする」判定も通らなかった。 */
  const fresh = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.sync;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    T.saved.clear();
    // 前のお客様の見積もりを作る
    L.fill(0, { planId: plan, procType: 'kishu', deviceName: '前のお客様の機種' });
    L.pick(0);
    const before = S.payload();
    const genBefore = S.gen();

    // 「新しいお客様として始める」
    S.newCustomer();
    const genAfter = S.gen();
    const emptied = S.payload().indexOf('前のお客様の機種') < 0;

    // クラウドには、まだ前のお客様の内容が残っている（同期の初回で届く）
    const msg = S.applyRemote(before, true);
    return { genBefore: genBefore, genAfter: genAfter, emptied: emptied, msg: msg,
      back: S.payload().indexOf('前のお客様の機種') >= 0,
      autoNames: S.autoNames() };
  });
  chk('⑨「新しいお客様」でお客様の区切りが1つ進む',
    fresh.genAfter === fresh.genBefore + 1, fresh.genBefore + ' → ' + fresh.genAfter);
  chk('⑨「新しいお客様」で見積もりが空になる', fresh.emptied === true);
  chk('⑨ そのあとクラウドから前の内容が届いても、戻ってこない（今回の不具合）',
    fresh.back === false, fresh.msg);
  chk('⑨ 前のお客様の内容は「保存」タブの自動控えに残っている',
    fresh.autoNames.length > 0, JSON.stringify(fresh.autoNames));

  /* ---- ⑩ 2026-09-08 の全体デバッグ ----
   *   #2  他の端末が「次のお客様」を始めた内容が届いても、この端末が覚えている
   *       「どの保存の続きか」が切れず、前のお客様の保存が中身だけ入れ替わっていた
   *   #29 2台を同時に開いていると、触っていない側に「自動控え」が次々でき、
   *       実績の応対（提案）件数が水増しされていた */
  const cut = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.sync;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    T.saved.clear();
    // お客様Aの見積もりを作って保存（＝この保存の続き、という覚えが付く）
    L.fill(0, { planId: plan, procType: 'kishu', deviceName: 'お客様Aの機種' });
    L.pick(0);
    const a = T.saved.save('お客様A');
    const srcBefore = T.saved.srcId();
    // 他の端末が「次のお客様」を始めた内容（お客様の区切りが1つ進んでいる）
    const other = JSON.parse(S.payload());
    other.gen = (other.gen | 0) + 1;
    other.patterns[0].deviceName = 'お客様Bの機種';
    S.applyRemote(JSON.stringify(other));
    const srcAfter = T.saved.srcId();
    // この状態で保存を押したら、お客様Aの保存が書き替わらず新しい1件になるはず
    const b = T.saved.save('お客様B');
    const aStill = (T.saved.list ? T.saved.list() : []).filter((x) => x.id === a.id)[0] || null;
    return {
      srcBefore: srcBefore, srcAfter: srcAfter,
      newItem: b && b.id !== a.id,
      aKept: !!(aStill && JSON.stringify(aStill.data).indexOf('お客様Aの機種') >= 0),
      count: T.saved.count()
    };
  });
  chk('⑩ 保存した直後は「どの保存の続きか」を覚えている', !!cut.srcBefore, String(cut.srcBefore));
  chk('⑩ 他の端末が次のお客様を始めた内容が届いたら、その覚えを切る',
    cut.srcAfter === null, String(cut.srcAfter));
  chk('⑩ そのあとの保存は新しい1件になる', cut.newItem === true && cut.count === 2,
    '件数=' + cut.count);
  chk('⑩ お客様Aの提案内容が書き替わらずに残っている', cut.aKept === true);

  const noStash = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.sync;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    T.saved.clear();
    // この端末は「見ているだけ」。同期で受け取った内容がそのまま入っている
    L.fill(0, { planId: plan, procType: 'kishu', deviceName: 'もう一方の端末の入力' });
    L.pick(0);
    S.markSig();                       // ここまでが「最後に同期した中身」
    // もう一方の端末が入力を続け、更新が5回届く
    for (let i = 0; i < 5; i++) {
      const o = JSON.parse(S.payload());
      o.patterns[0].deviceName = 'もう一方の端末の入力' + i;
      S.applyRemote(JSON.stringify(o));
      S.markSig();
    }
    return { autos: S.autoNames(), count: T.saved.count() };
  });
  chk('⑩ 触っていない端末に「自動控え」が増えない（実績の応対が水増しされない）',
    noStash.autos.length === 0 && noStash.count === 0,
    '自動控え=' + JSON.stringify(noStash.autos) + ' 保存件数=' + noStash.count);

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('端末どうしの同期に問題があります: ' + ok.length + '/' + (ok.length + ng.length)
      + '\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('端末どうしの同期のテスト: ' + ok.length + '/' + ok.length + ' OK');
})();
