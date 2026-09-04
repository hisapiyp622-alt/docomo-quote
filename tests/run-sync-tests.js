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
