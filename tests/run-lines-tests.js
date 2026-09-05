/* 回線（見積もりの本数）と、成約のときに数える回線の確認
 *
 * 使い方: node tests/run-lines-tests.js
 *
 * なぜ要るか（2026-09-05 店舗からの要望）:
 *   ① 1商談で扱える回線が3本では足りない（→5本に増やした）
 *   ② 見比べていただくために作った回線があると、成約ボタンを押す前に
 *      その見積もりを消さないと、実績に二重に数えられてしまう。
 *      成約のときに「どの回線を数えるか」を選べるようにした。
 *
 * 見ているもの:
 *   ・回線が5本あり、画面のボタンも5つ出ること
 *   ・古い保存（3本ぶん）を開いても壊れないこと
 *   ・中身のある回線が2本以上のときだけ、成約の確認画面に選択欄が出ること
 *   ・チェックを外した回線が実績に数えられないこと
 *   ・外した回線の見積もり自体は消えないこと
 *   ・全部数えるとき（これまでと同じ）は、記録に余計なものを残さないこと
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
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.lines, null, { timeout: 8000 });

  /* ---- ① 5本ある ---- */
  const basic = await page.evaluate(() => {
    const L = window.__KQ_TEST__.lines;
    return { max: L.max(), count: L.count(), tabs: L.tabs() };
  });
  chk('① 回線を5本もっている', basic.max === 5 && basic.count === 5,
    'max=' + basic.max + ' count=' + basic.count);
  chk('① 画面のボタンも5つ出ている',
    basic.tabs.length === 5 && basic.tabs[4] === '回線5', JSON.stringify(basic.tabs));

  /* ---- ② 古い保存（3本ぶん）を開いても壊れない ---- */
  const old = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const plan = T.std.get().plans[0].id;
    // 3本ぶんしか入っていない、昔の形の保存を置く
    const data = { active: 1, gen: 0, patterns: [
      { planId: plan, procType: 'kishu' }, { planId: plan, procType: 'shinki' }, {}
    ] };
    localStorage.setItem(T.sync.quoteKey(), JSON.stringify(data));
    T.sync.reload();
    const L = T.lines;
    return { count: L.count(), used: L.used() };
  });
  chk('② 3本ぶんの古い保存を開いても、5本の形になる', old.count === 5, String(old.count));
  chk('② 中身のある回線だけを数える（回線1・2）',
    JSON.stringify(old.used) === '[0,1]', JSON.stringify(old.used));

  /* ---- ③ 成約の確認画面に、回線の選択欄が出る ---- */
  const dlg = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    L.fill(0, { planId: plan, procType: 'kishu', deviceName: 'iPhone 17' });
    L.fill(1, { planId: plan, procType: 'kishu', deviceName: '比較用の案' });
    L.pick(0);
    const r = L.askOpen();
    L.askCancel();
    return r;
  });
  chk('③ 中身のある回線が2本あるとき、選択欄が出る', dlg.shown === true);
  chk('③ 中身のある回線が並び、はじめは全部にチェックが入っている',
    dlg.labels.length === 2 && JSON.stringify(dlg.checked) === '[0,1]',
    JSON.stringify(dlg.labels) + ' / ' + JSON.stringify(dlg.checked));
  chk('③ どの回線か分かるよう、機種名が添えてある',
    dlg.labels.some((t) => /比較用の案/.test(t)), JSON.stringify(dlg.labels));

  /* ---- ④ 1本しか使っていないときは出さない（これまでの画面のまま） ---- */
  const one = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    L.fill(1, {});                      // 回線2を空に戻す
    L.pick(0);
    const r = L.askOpen();
    L.askCancel();
    return r;
  });
  chk('④ 使っている回線が1本のときは、選択欄を出さない', one.shown === false);

  /* ---- ⑤ チェックを外した回線は実績に数えない ---- */
  const counted = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    L.fill(0, { planId: plan, procType: 'kishu', deviceName: 'iPhone 17' });
    L.fill(1, { planId: plan, procType: 'shinki', deviceName: '比較用の案' });
    L.pick(0);
    return {
      both: L.items(),                 // 選ばない＝これまでどおり全部
      onlyFirst: L.items([0]),
      onlySecond: L.items([1])
    };
  });
  function keys(o) { return Object.keys(o).sort().join(','); }
  chk('⑤ 選ばなければ、これまでどおり両方を数える',
    Object.keys(counted.both).length >= 2, keys(counted.both));
  chk('⑤ 回線1だけを選ぶと、機種変更だけになる',
    /kishu/.test(keys(counted.onlyFirst)) && !/shinki/.test(keys(counted.onlyFirst)),
    keys(counted.onlyFirst));
  chk('⑤ 回線2だけを選ぶと、新規だけになる',
    /shinki/.test(keys(counted.onlySecond)) && !/kishu/.test(keys(counted.onlySecond)),
    keys(counted.onlySecond));

  /* ---- ⑥ 実際に成約を記録する ---- */
  const rec = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    T.saved.clear();
    L.won();                            // 本物の「成約」と同じ流れ
    L.askUncheck(1);                   // 比較用の回線を外す
    const shown = L.askItems();
    L.askOk();
    const list = T.saved.list();
    return { shown: shown, item: list[0] || null, count: L.count(),
      line2: (T.sync.payload().indexOf('比較用の案') >= 0) };
  });
  chk('⑥ 外したとたん、確認画面の項目からも消える',
    !/新規/.test(rec.shown), rec.shown.replace(/\s+/g, ' ').slice(0, 120));
  chk('⑥ 成約として記録され、数えた回線が残る',
    !!rec.item && rec.item.result === 'won'
    && JSON.stringify(rec.item.wonLines) === '[0]',
    JSON.stringify(rec.item && rec.item.wonLines));
  chk('⑥ 外した回線の見積もりは消えない', rec.line2 === true);
  chk('⑥ 回線は5本のまま', rec.count === 5, String(rec.count));

  /* ---- ⑦ 全部数えるときは、余計なものを記録しない（古い記録と同じ扱い） ---- */
  const all = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    T.saved.clear();
    L.won();
    L.askOk();                          // 何も外さずに記録
    const list = T.saved.list();
    return { item: list[0] || null };
  });
  chk('⑦ 全部の回線を数えるときは、記録に何も足さない',
    !!all.item && all.item.result === 'won' && !all.item.wonLines,
    JSON.stringify(all.item && all.item.wonLines));

  /* ---- ⑧ 使っていない回線は保存に残さない（保存の大きさ対策）----
   * 回線を5本に増やすと、使っていない回線ぶんが保存1件ごとに増える。
   * 保存は担当ごとに1つの塊としてクラウドへ送っており、上限を超えると
   * 古い保存から押し出されてしまうため、後ろの空きは落とす。
   * 落としても、開くときに空の回線として作り直されるので中身は変わらない。 */
  const pack = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    T.saved.clear();
    // 回線1・2だけ使い、3〜5は空のまま保存する
    L.fill(0, { planId: plan, procType: 'kishu', deviceName: 'iPhone 17' });
    L.fill(1, { planId: plan, procType: 'shinki', deviceName: 'Galaxy S26' });
    L.fill(2, {}); L.fill(3, {}); L.fill(4, {});
    L.pick(0);
    const it = T.saved.save('容量の確認');
    const savedPats = (it.data.patterns || []).length;
    const bytes = JSON.stringify(it).length;
    // 開き直したときに元どおりになるか
    T.saved.load(it.id);
    return { savedPats: savedPats, bytes: bytes, count: L.count(),
      used: L.used(), name1: T.lines.items([0]) && true,
      dev1: (T.sync.payload().indexOf('iPhone 17') >= 0),
      dev2: (T.sync.payload().indexOf('Galaxy S26') >= 0) };
  });
  chk('⑧ 使っていない後ろの回線は、保存に残さない',
    pack.savedPats === 2, '保存に入った回線の数: ' + pack.savedPats);
  chk('⑧ 開き直すと回線は5本に戻る', pack.count === 5, String(pack.count));
  chk('⑧ 開き直しても中身は変わらない',
    pack.dev1 && pack.dev2 && JSON.stringify(pack.used) === '[0,1]',
    JSON.stringify(pack.used));

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('回線まわりに問題があります: ' + ok.length + '/' + (ok.length + ng.length)
      + '\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('回線と成約の数え方のテスト: ' + ok.length + '/' + ok.length + ' OK');
})();
