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

  /* ---- ⑨ 実績のポイント（お店が決める指標・2026-09-07）----
   * ドコモの評価指標のように「新規 × eximo で◯点」と数えたい、という要望。
   * 点数と項目名はアプリに持たず、お店がマスタ設定で入力する。
   * ここでは**数え方**だけを見る（点数は検査用に入れる）。
   *
   * 見ているもの:
   *   ・条件を1つだけ書いた行 … その項目が立った回線の数だけ数える
   *   ・条件を2つ書いた行（組み合わせ）… 両方そろった回線だけ数える
   *   ・光（世帯に1本）… 回線が何本あっても商談に1件
   *   ・成約で外した回線は数えない
   */
  const cx = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const plan = m.plans[0].id;      // ドコモ MAX
    const plan2 = m.plans.filter((p) => p.id !== plan)[0].id;
    // 回線1: 新規 × プランA ／ 回線2: 機種変更 × プランB
    L.fill(0, { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      deviceName: 'A', planChange: true });
    L.fill(1, { planId: plan2, procType: 'kishu', procTodo: { kishu: true },
      deviceName: 'B', planChange: true });
    L.pick(0);
    const cat = L.cxCatalog();
    const has = (k) => !!cat[k];
    L.cxSet([
      { id: 'r1', name: '新規（単独）', pt: 10, keys: ['proc:shinki'] },
      { id: 'r2', name: '機種変更（単独）', pt: 3, keys: ['proc:kishu'] },
      { id: 'r3', name: '新規 × プランA（組み合わせ）', pt: 100, keys: ['proc:shinki', 'plan:' + plan] },
      { id: 'r4', name: '新規 × プランB（そろわない）', pt: 999, keys: ['proc:shinki', 'plan:' + plan2] },
      { id: 'r5', name: '条件なし（数えない）', pt: 500, keys: [] }
    ]);
    const all = L.cxBreak();
    const only1 = L.cxBreak([0]);
    return { cat: { shinki: has('proc:shinki'), planA: has('plan:' + plan) },
      all: all, total: L.cxTotal(), only1: only1, total1: L.cxTotal([0]) };
  });
  function find(list, id) { return (list || []).filter((x) => x.id === id)[0] || null; }
  chk('⑨ 実績の項目キーが取れている', cx.cat.shinki && cx.cat.planA, JSON.stringify(cx.cat));
  chk('⑨ 条件1つの行は、その項目が立った回線ぶん数える',
    !!find(cx.all, 'r1') && find(cx.all, 'r1').n === 1
    && !!find(cx.all, 'r2') && find(cx.all, 'r2').n === 1,
    JSON.stringify(cx.all));
  chk('⑨ 組み合わせは、両方そろった回線だけ数える',
    !!find(cx.all, 'r3') && find(cx.all, 'r3').n === 1 && find(cx.all, 'r3').total === 100,
    JSON.stringify(find(cx.all, 'r3')));
  chk('⑨ そろわない組み合わせは数えない', !find(cx.all, 'r4'), JSON.stringify(find(cx.all, 'r4')));
  chk('⑨ 条件が空の行は数えない', !find(cx.all, 'r5'));
  chk('⑨ 合計は 10＋3＋100 ＝113', cx.total === 113, String(cx.total));
  chk('⑨ 成約で外した回線は数えない（回線1だけなら 10＋100 ＝110）',
    cx.total1 === 110, String(cx.total1) + ' / ' + JSON.stringify(cx.only1));

  /* 光は世帯に1本。回線が2本あっても商談に1件 */
  const cxIe = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    L.cxSet([{ id: 'ie', name: '光 1ギガ', pt: 42, keys: ['ie:1g'] }]);
    const before = L.cxTotal();
    // 光を入れて、申し込みにチェックする
    const ie = document.getElementById('ieEnabled');
    if (ie && !ie.checked) { ie.checked = true; ie.dispatchEvent(new Event('change', { bubbles: true })); }
    const td = document.getElementById('todoHikari');
    if (td && !td.checked) { td.checked = true; td.dispatchEvent(new Event('change', { bubbles: true })); }
    return { before: before, after: L.cxTotal(), rows: L.cxBreak() };
  });
  chk('⑨ 光を入れる前は、光の行は数えない', cxIe.before === 0, String(cxIe.before));
  chk('⑨ 光は回線が2本でも商談に1件（42点）',
    cxIe.after === 42, String(cxIe.after) + ' / ' + JSON.stringify(cxIe.rows));

  /* ---- ⑩ ポイントの読み込み（ファイルから足す）----
   * あとから項目を足せるようにするための入口。
   * ・同じ行は差し替え、無い行は足す（手で足した行は消さない）
   * ・条件に使う項目が「実績で追う項目」で切られていると、いつまでも0件になるので、
   *   読み込んだ行が使う項目は自動で数える側に入れる
   * ・ただしプランだけは別で、実績の表には足さない（配点がプランごとに違うため、
   *   実績に出したくないプランも条件に選べる・2026-09-07） */
  const imp = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    // 既定では実績に出していないプランと、既定では数えていないオプションを選ぶ
    const off = m.plans.filter((p) => !L.statsCatalog()['plan:' + p.id])[0];
    const offOpt = m.options.filter((o) => !L.statsCatalog()['opt:' + o.id])[0];
    L.cxSet([{ id: 'keep', name: '手で足した行', pt: 7, keys: ['proc:shinki'] }]);
    const before = L.statsCatalog()['plan:' + off.id] ? 'ある' : 'ない';
    const optBefore = L.statsCatalog()['opt:' + offOpt.id] ? 'ある' : 'ない';
    const pickable = L.cxCatalog()['plan:' + off.id] || '';
    const res = L.cxImport([
      { id: 'keep', name: '差し替え後', pt: 9, keys: ['proc:shinki'] },
      { id: 'newone', name: '新規 × ' + off.name, pt: 50, keys: ['proc:shinki', 'plan:' + off.id] },
      { id: 'newopt', name: 'オプション', pt: 3, keys: ['opt:' + offOpt.id] }
    ]);
    return { off: off.id, before: before, after: L.statsCatalog()['plan:' + off.id] ? 'ある' : 'ない',
      pickable: pickable, optBefore: optBefore,
      optAfter: L.statsCatalog()['opt:' + offOpt.id] ? 'ある' : 'ない', res: res };
  });
  chk('⑩ 読み込む前は、そのプランは実績の項目に出ていない', imp.before === 'ない', imp.before);
  chk('⑩ 実績に出していないプランでも、ポイントの条件には選べる',
    /実績には出しません/.test(imp.pickable), imp.pickable);
  chk('⑩ 読み込んでも、プランは実績の項目に足さない', imp.after === 'ない', imp.after);
  chk('⑩ プラン以外は、条件に使う項目が自動で数える側に入る',
    imp.optBefore === 'ない' && imp.optAfter === 'ある', imp.optBefore + '→' + imp.optAfter);
  chk('⑩ 同じ行は差し替え、無い行は足す',
    imp.res.added === 2 && imp.res.updated === 1 && imp.res.skipped === 0, JSON.stringify(imp.res));

  /* ---- ⑪ U39（ご利用者が39歳以下）----
   * ドコモの評価指標の「成長領域加算」に当たる。お客様の年齢はアプリでは
   * 分からないので、お店がチェックで入れる（2026-09-07）。
   * 加算は**基本の行とは別の行**として数えられる（基本105点＋加算48点＝153点）。 */
  const u39 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const plan = m.plans[0].id;
    /* 回線1だけ U39、回線2は U39 なし。
     * プランを成約として数えるには「料金プランの変更あり」が要る仕様なので入れる。 */
    L.fill(0, { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true, u39: true });
    L.fill(1, { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true, u39: false });
    L.pick(0);
    L.cxSet([
      { id: 'base', name: '新規 × プランA', pt: 105, keys: ['proc:shinki', 'plan:' + plan] },
      { id: 'add', name: '新規 × プランA × U39', pt: 48, keys: ['proc:shinki', 'plan:' + plan, 'u39'] }
    ]);
    const rows = L.cxBreak();
    const cb = document.getElementById('u39');
    return { inCatalog: !!L.cxCatalog()['u39'], rows: rows, total: L.cxTotal(),
      hasBox: !!cb, boxChecked: cb ? cb.checked : null };
  });
  function pick(list, id) { return (list || []).filter((x) => x.id === id)[0] || null; }
  chk('⑪ 画面に U39 のチェック欄がある', u39.hasBox === true);
  chk('⑪ 実績の項目に U39 が出る', u39.inCatalog === true);
  chk('⑪ 基本の行は2回線とも数える',
    !!pick(u39.rows, 'base') && pick(u39.rows, 'base').n === 2, JSON.stringify(u39.rows));
  chk('⑪ 加算はチェックした回線だけ数える',
    !!pick(u39.rows, 'add') && pick(u39.rows, 'add').n === 1, JSON.stringify(pick(u39.rows, 'add')));
  chk('⑪ 合計は 105×2 ＋ 48 ＝258（基本と加算が足される）',
    u39.total === 258, String(u39.total));

  /* U39 はお客様の紙には出さない（実績のためだけの印） */
  const u39Sheet = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.lines.pick(0);
    return T.std.sheetHtml();
  });
  chk('⑪ お客様の見積書に U39 は出ない', !/U39/.test(u39Sheet), u39Sheet.slice(0, 80));

  /* ---- ⑫ 実績に出さないプランをポイントの条件に使う（2026-09-07）----
   * 評価指標は配点がプランごとに違うので、実績の「項目別」には出したくない
   * プランでも条件に選べる必要がある。
   * ・ポイントは数える
   * ・実績の「項目別」には行を出さない
   * ・実績で追っているプランは、これまでどおり行が出る */
  const offPlan = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const on = m.plans.filter((p) => L.statsCatalog()['plan:' + p.id])[0];   // 実績に出すプラン
    const off = m.plans.filter((p) => !L.statsCatalog()['plan:' + p.id])[0]; // 出さないプラン
    L.fill(0, { planId: off.id, procType: 'shinki', procTodo: { shinki: true }, planChange: true });
    L.fill(1, { planId: on.id, procType: 'shinki', procTodo: { shinki: true }, planChange: true });
    L.pick(0);
    L.cxSet([
      { id: 'offrow', name: '新規 × ' + off.name, pt: 34, keys: ['proc:shinki', 'plan:' + off.id] },
      { id: 'onrow', name: '新規 × ' + on.name, pt: 105, keys: ['proc:shinki', 'plan:' + on.id] }
    ]);
    const items = L.items();
    return { on: on.id, off: off.id, rows: L.cxBreak(), total: L.cxTotal(),
      itemKeys: Object.keys(items),
      inCx: !!L.cxCatalog()['plan:' + off.id],
      inStats: !!L.statsCatalog()['plan:' + off.id] };
  });
  function row12(id) { return (offPlan.rows || []).filter((x) => x.id === id)[0] || null; }
  chk('⑫ 実績に出さないプランも、ポイントの条件の一覧には出る', offPlan.inCx === true);
  chk('⑫ そのプランは実績で追う項目の一覧には出ない', offPlan.inStats === false);
  chk('⑫ そのプランでもポイントは数える',
    !!row12('offrow') && row12('offrow').n === 1, JSON.stringify(offPlan.rows));
  chk('⑫ 実績の「項目別」にはそのプランの行を出さない',
    offPlan.itemKeys.indexOf('plan:' + offPlan.off) < 0, JSON.stringify(offPlan.itemKeys));
  chk('⑫ 実績で追っているプランは、これまでどおり項目に出る',
    offPlan.itemKeys.indexOf('plan:' + offPlan.on) >= 0, JSON.stringify(offPlan.itemKeys));
  chk('⑫ 合計は 34 ＋ 105 ＝139', offPlan.total === 139, String(offPlan.total));

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
