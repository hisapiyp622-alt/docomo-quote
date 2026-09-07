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
   * 欄は**のりかえ（MNP）のときだけ**出す（店舗の指定・2026-09-07）。
   * 加算は**基本の行とは別の行**として数えられる（基本105点＋加算48点＝153点）。 */
  const u39 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const plan = m.plans[0].id;
    /* 回線1だけ U39、回線2は U39 なし。
     * プランを成約として数えるには「料金プランの変更あり」が要る仕様なので入れる。 */
    L.fill(0, { planId: plan, procType: 'mnp', procTodo: { mnp: true },
      planChange: true, u39: true });
    L.fill(1, { planId: plan, procType: 'mnp', procTodo: { mnp: true },
      planChange: true, u39: false });
    L.pick(0);
    L.cxSet([
      { id: 'base', name: 'のりかえ × プランA', pt: 105, keys: ['proc:mnp', 'plan:' + plan] },
      { id: 'add', name: 'のりかえ × プランA × U39', pt: 48, keys: ['proc:mnp', 'plan:' + plan, 'u39'] }
    ]);
    const rows = L.cxBreak();
    const f = document.getElementById('u39Field');
    const cb = document.getElementById('u39');
    // 欄が「手続き内容」のカードにあるか（U15 と同じ場所）
    const card = f && f.closest('.card');
    const inProcCard = !!(card && /手続き内容/.test((card.querySelector('h2') || {}).textContent || ''));
    const nextToU15 = !!(card && card.contains(document.getElementById('u15Field')));
    const shownOnMnp = f ? !f.hidden : null;
    // 新規に切り替えても出ること（U15 と同じ条件）
    L.fill(0, { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true, u39: true });
    L.pick(0);
    const shownOnShinki = f ? !f.hidden : null;
    // のりかえに戻してから件数を見る
    L.fill(0, { planId: plan, procType: 'mnp', procTodo: { mnp: true },
      planChange: true, u39: true });
    L.pick(0);
    return { inCatalog: !!L.cxCatalog()['u39'], rows: rows, total: L.cxTotal(),
      hasBox: !!cb, shownOnMnp: shownOnMnp, shownOnShinki: shownOnShinki,
      inProcCard: inProcCard, nextToU15: nextToU15 };
  });
  function pick(list, id) { return (list || []).filter((x) => x.id === id)[0] || null; }
  chk('⑪ 画面に U39 のチェック欄がある', u39.hasBox === true);
  chk('⑪ U39 の欄は「手続き内容」にあり、U15 と同じカードに並ぶ',
    u39.inProcCard === true && u39.nextToU15 === true,
    'カード:' + u39.inProcCard + ' / U15と同じ:' + u39.nextToU15);
  chk('⑪ のりかえのときは U39 の欄が出る', u39.shownOnMnp === true);
  chk('⑪ 新規のときも U39 の欄が出る（U15 と同じ条件）', u39.shownOnShinki === true);
  chk('⑪ 実績の項目に U39 が出る', u39.inCatalog === true);
  chk('⑪ 基本の行は2回線とも数える',
    !!pick(u39.rows, 'base') && pick(u39.rows, 'base').n === 2, JSON.stringify(u39.rows));
  chk('⑪ 加算はチェックした回線だけ数える',
    !!pick(u39.rows, 'add') && pick(u39.rows, 'add').n === 1, JSON.stringify(pick(u39.rows, 'add')));
  chk('⑪ 合計は 105×2 ＋ 48 ＝258（基本と加算が足される）',
    u39.total === 258, String(u39.total));

  /* のりかえ以外では欄を出さない。出していない手続きでチェックが残っていても、
   * 見えないまま実績に入らないこと（画面と数え方で同じものを見る）。 */
  const u39Off = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    const out = {};
    [['kishu', '機種変更'], ['plan', 'プラン変更']].forEach(([k, name]) => {
      L.fill(0, { planId: plan, procType: k, procTodo: { [k]: true },
        planChange: true, u39: true });
      L.fill(1, {});
      L.pick(0);
      const f = document.getElementById('u39Field');
      out[k] = { name: name, shown: f ? !f.hidden : null };
    });
    // 機種変更のままで、U39 の加算だけの行が数えられないこと
    L.cxSet([{ id: 'add', name: 'U39 だけ', pt: 48, keys: ['u39'] }]);
    out.counted = L.cxTotal();
    return out;
  });
  chk('⑪ 機種変更のときは U39 の欄を出さない', u39Off.kishu.shown === false);
  chk('⑪ プラン変更のときも U39 の欄を出さない', u39Off.plan.shown === false);
  chk('⑪ 欄を出していない手続きでは、チェックが残っていても数えない',
    u39Off.counted === 0, String(u39Off.counted));

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

  /* ---- ⑬ 容量ごとに分けるプラン（ドコモ mini の 4GB・10GB・2026-09-07）----
   * ・容量ごとに別の行になる
   * ・容量が入っていない以前の保存は、分けずに1つの行にまとめる
   *   （いちばん小さい容量として数えると、過去の実績が変わってしまうため） */
  const tier = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m0 = T.std.get();
    // 「容量ごとに分ける」が入っているプラン（初期値はドコモ mini）
    const split = (m0.statsCfg || {}).planTier || {};
    const pl = m0.plans.filter((p) => p.tiers && p.tiers.length >= 2 && split[p.id])[0];
    // 実績の表に出す設定にしてから見る（初期値では出していないプランのため）
    m0.statsCfg.plans[pl.id] = true;
    T.std.set(m0);
    // 回線1は小さい容量、回線2は大きい容量
    L.fill(0, { planId: pl.id, tierIdx: 0, procType: 'mnp', procTodo: { mnp: true }, planChange: true });
    L.fill(1, { planId: pl.id, tierIdx: 1, procType: 'mnp', procTodo: { mnp: true }, planChange: true });
    L.pick(0);
    const cat = L.cxCatalog();
    return {
      plan: pl.id, labels: pl.tiers.map((t) => t.label),
      itemKeys: Object.keys(L.items()),
      names: L.items(),
      catT0: cat['plan:' + pl.id + ':t0'] || '',
      catT1: cat['plan:' + pl.id + ':t1'] || '',
      catOld: cat['plan:' + pl.id] || ''
    };
  });
  chk('⑬ 容量ごとに別の行になる（小さい容量）',
    tier.itemKeys.indexOf('plan:' + tier.plan + ':t0') >= 0, JSON.stringify(tier.itemKeys));
  chk('⑬ 容量ごとに別の行になる（大きい容量）',
    tier.itemKeys.indexOf('plan:' + tier.plan + ':t1') >= 0, JSON.stringify(tier.itemKeys));
  chk('⑬ 分ける前の行は出ない',
    tier.itemKeys.indexOf('plan:' + tier.plan) < 0, JSON.stringify(tier.itemKeys));
  chk('⑬ 行の名前に容量が入る',
    tier.catT0.indexOf(tier.labels[0]) >= 0 && tier.catT1.indexOf(tier.labels[1]) >= 0,
    tier.catT0 + ' / ' + tier.catT1);
  chk('⑬ 条件の一覧に、以前の保存ぶんの行もある',
    /容量なし/.test(tier.catOld), tier.catOld);

  /* 容量が入っていない以前の保存は、分けずにまとめる */
  const tierOld = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const split = (m.statsCfg || {}).planTier || {};
    const pl = m.plans.filter((p) => p.tiers && p.tiers.length >= 2 && split[p.id])[0];
    m.statsCfg.plans[pl.id] = true;
    T.std.set(m);
    return { id: pl.id,
      keys: Object.keys(L.itemsRaw([{ planId: pl.id, procType: 'mnp', procTodo: { mnp: true }, planChange: true }])) };
  });
  chk('⑬ 容量が入っていない以前の保存は、容量ごとに分けない',
    tierOld.keys.indexOf('plan:' + tierOld.id) >= 0
    && tierOld.keys.filter((k) => k.indexOf('plan:' + tierOld.id + ':t') === 0).length === 0,
    JSON.stringify(tierOld.keys));

  /* 保存を通しても容量が残ること。保存は中身を削って小さくしているので、
   * 容量を残す指定が抜けると、実際の記録では全部「容量なし」に落ちてしまう。 */
  const tierSaved = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const split = (m.statsCfg || {}).planTier || {};
    const pl = m.plans.filter((p) => p.tiers && p.tiers.length >= 2 && split[p.id])[0];
    m.statsCfg.plans[pl.id] = true;
    T.std.set(m);
    T.saved.clear();
    L.fill(0, { planId: pl.id, tierIdx: 1, procType: 'mnp', procTodo: { mnp: true }, planChange: true });
    L.fill(1, {});
    L.pick(0);
    T.saved.save('容量の検査');
    // 古い保存は中身を削って小さくする。その形でも容量が残ることを見る
    const it = T.saved.slimAll()[0];
    const pat = ((it && it.data && it.data.patterns) || [])[0] || {};
    return { id: pl.id, slim: !!(it && it.slim), tierIdx: pat.tierIdx,
      keys: Object.keys(L.itemsRaw([pat])) };
  });
  chk('⑬ 保存しても容量が残る（保存は中身を削って小さくしているため）',
    tierSaved.tierIdx === 1, '保存された容量: ' + JSON.stringify(tierSaved.tierIdx));
  chk('⑬ 保存した記録から、容量ごとの行が出る',
    tierSaved.keys.indexOf('plan:' + tierSaved.id + ':t1') >= 0, JSON.stringify(tierSaved.keys));

  /* ---- ⑭ 法人プラン（ドコモ Biz・2026-09-07）----
   * ・「プラン世代」で法人プランを選べる（一覧に実在すること）
   * ・実績でも数える（マスタ設定の「実績で追う項目」に初めから入っている）
   * ・ポイントの条件にも選べる */
  const biz = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const ids = ['biz_unlimited', 'biz_kakehodai'];
    const plans = ids.map((id) => m.plans.filter((p) => p.id === id)[0] || null);
    // 「プラン世代」を法人にしたときの一覧（実際に出ている文字で見る）
    const gsel = document.getElementById('planGroup');
    gsel.value = 'biz';
    gsel.dispatchEvent(new Event('change', { bubbles: true }));
    const names = Array.prototype.map.call(
      document.querySelectorAll('#planId option'), (o) => o.textContent.trim());
    // データ無制限を1回線目に入れて、実績とポイントを見る
    L.fill(0, { planGroup: 'biz', planId: 'biz_unlimited', tierIdx: 2, procType: 'shinki',
      procTodo: { shinki: true }, planChange: true });
    L.fill(1, {});
    L.pick(0);
    L.cxSet([{ id: 'bz', name: '新規 × Biz データ無制限', pt: 20,
      keys: ['proc:shinki', 'plan:biz_unlimited'] }]);
    return {
      found: plans.map((p) => !!p),
      groups: plans.map((p) => p && p.group),
      prices: plans.map((p) => p && p.tiers.map((t) => t.price)),
      cfgOn: ids.map((id) => !!((m.statsCfg || {}).plans || {})[id]),
      names: names,
      itemKeys: Object.keys(L.items()),
      inCx: ids.map((id) => !!L.cxCatalog()['plan:' + id]),
      total: L.cxTotal()
    };
  });
  chk('⑭ 法人プランが2つとも料金表にある', biz.found[0] === true && biz.found[1] === true);
  chk('⑭ プラン世代は「法人」', biz.groups[0] === 'biz' && biz.groups[1] === 'biz',
    JSON.stringify(biz.groups));
  chk('⑭ 「プラン世代」を法人にすると、一覧に2つとも出る',
    biz.names.some((n) => /Biz データ無制限/.test(n))
    && biz.names.some((n) => /Biz かけ放題/.test(n)), JSON.stringify(biz.names));
  chk('⑭ データ無制限は3段階（5,313／6,413／8,063円）',
    JSON.stringify(biz.prices[0]) === '[5313,6413,8063]', JSON.stringify(biz.prices[0]));
  chk('⑭ かけ放題は3,553円', JSON.stringify(biz.prices[1]) === '[3553]',
    JSON.stringify(biz.prices[1]));
  chk('⑭ 実績で追う項目に初めから入っている',
    biz.cfgOn[0] === true && biz.cfgOn[1] === true, JSON.stringify(biz.cfgOn));
  chk('⑭ 実績の「項目別」に出る',
    biz.itemKeys.indexOf('plan:biz_unlimited') >= 0, JSON.stringify(biz.itemKeys));
  chk('⑭ ポイントの条件にも選べる',
    biz.inCx[0] === true && biz.inCx[1] === true, JSON.stringify(biz.inCx));
  chk('⑭ ポイントが数えられる（20点）', biz.total === 20, String(biz.total));

  /* ---- ⑮ 実績の項目を増やす（2026-09-07・店舗の指定）----
   * ・機種ハイエンドを Android と iPhone に分ける
   * ・（再掲）iPhone
   * ・タブレット総販（機種の欄のチェック）
   * ・下取り（指定機種／指定外機種）
   * どれも実績だけの印で、お客様の紙には出さない。 */
  const more = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    const base = { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true, payMethod: 'ikkatsu' };
    // 回線1: iPhone のハイエンド＋下取り（指定機種）
    L.fill(0, Object.assign({}, base, { deviceName: 'iPhone 17 Pro', devicePrice: 200000,
      shitadori: 'target' }));
    // 回線2: Android のハイエンド＋タブレット＋下取り（指定外）
    L.fill(1, Object.assign({}, base, { deviceName: 'Pixel 10 Pro', devicePrice: 180000,
      tablet: true, shitadori: 'other' }));
    L.pick(0);
    const keys = Object.keys(L.items());
    const cat = L.cxCatalog();
    return { keys: keys,
      catAndroid: cat['highend:android'] || '', catIphone: cat['highend:iphone'] || '',
      hasTabletBox: !!document.getElementById('tablet'),
      hasShitadoriSel: !!document.getElementById('shitadori'),
      shitadoriOpts: Array.prototype.map.call(
        document.querySelectorAll('#shitadori option'), (o) => o.value) };
  });
  chk('⑮ ハイエンドは iPhone と Android で別の行になる',
    more.keys.indexOf('highend:iphone') >= 0 && more.keys.indexOf('highend:android') >= 0,
    JSON.stringify(more.keys));
  chk('⑮ 分ける前のハイエンドの行は出ない',
    more.keys.indexOf('highend') < 0, JSON.stringify(more.keys));
  chk('⑮ 行の名前に Android／iPhone が入る',
    /Android/.test(more.catAndroid) && /iPhone/.test(more.catIphone),
    more.catAndroid + ' / ' + more.catIphone);
  chk('⑮ （再掲）iPhone が出る', more.keys.indexOf('iphone') >= 0, JSON.stringify(more.keys));
  chk('⑮ 画面にタブレットのチェック欄と下取りの選び欄がある',
    more.hasTabletBox === true && more.hasShitadoriSel === true);
  chk('⑮ 下取りは「なし・指定機種・指定外機種」から選ぶ',
    JSON.stringify(more.shitadoriOpts) === '["","target","other"]',
    JSON.stringify(more.shitadoriOpts));
  chk('⑮ タブレット総販が出る', more.keys.indexOf('tablet') >= 0, JSON.stringify(more.keys));
  chk('⑮ 下取りは指定機種と指定外機種で別の行になる',
    more.keys.indexOf('shitadori:target') >= 0 && more.keys.indexOf('shitadori:other') >= 0,
    JSON.stringify(more.keys));

  /* 端末購入なしのときは、機種の印を数えない（金額にも入っていないため） */
  const moreOff = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    L.fill(0, { planId: plan, procType: 'shinki', procTodo: { shinki: true }, planChange: true,
      deviceName: 'iPhone 17 Pro', devicePrice: 200000, tablet: true, payMethod: 'none' });
    L.fill(1, {});
    L.pick(0);
    return Object.keys(L.items());
  });
  chk('⑮ 端末購入なしのときは iPhone・ハイエンド・タブレットを数えない',
    moreOff.indexOf('iphone') < 0 && moreOff.indexOf('tablet') < 0
    && moreOff.filter((k) => k.indexOf('highend') === 0).length === 0,
    JSON.stringify(moreOff));

  /* お客様の紙には出さない */
  const moreSheet = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.lines.fill(0, { planId: T.std.get().plans[0].id, procType: 'shinki',
      procTodo: { shinki: true }, planChange: true, payMethod: 'ikkatsu',
      deviceName: 'iPhone 17 Pro', devicePrice: 200000, tablet: true, shitadori: 'target' });
    T.lines.pick(0);
    return T.std.sheetHtml() + '\n' + (T.std.staffHtml ? T.std.staffHtml() : '');
  });
  chk('⑮ タブレット・下取りの印はお客様の紙に出ない',
    !/タブレット総販/.test(moreSheet) && !/指定外機種/.test(moreSheet),
    moreSheet.slice(0, 60));

  /* ---- ⑯ ahamo を大盛りとポイ活で分ける（2026-09-07）---- */
  const ah = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const poi = m.plans.filter((p) => p.id === 'ahamo_poikatsu')[0] || null;
    L.fill(0, { planId: 'ahamo', tierIdx: 1, procType: 'mnp', procTodo: { mnp: true } });
    L.fill(1, { planId: 'ahamo_poikatsu', procType: 'mnp', procTodo: { mnp: true } });
    L.pick(0);
    const cat = L.cxCatalog();
    return {
      poiFound: !!poi, poiPrice: poi && poi.tiers[0].price, poiPt: poi && poi.poikatsuPt,
      splitOn: !!((m.statsCfg || {}).planTier || {}).ahamo,
      cfgOn: !!((m.statsCfg || {}).plans || {})['ahamo'],
      cfgPoiOn: !!((m.statsCfg || {}).plans || {})['ahamo_poikatsu'],
      keys: Object.keys(L.items()),
      catT0: cat['plan:ahamo:t0'] || '', catT1: cat['plan:ahamo:t1'] || ''
    };
  });
  chk('⑯ ahamo ポイ活が料金表にある（7,150円・上限4,000pt）',
    ah.poiFound === true && ah.poiPrice === 7150 && ah.poiPt === 4000,
    JSON.stringify([ah.poiFound, ah.poiPrice, ah.poiPt]));
  chk('⑯ ahamo は容量ごとに分ける設定が入っている', ah.splitOn === true);
  chk('⑯ ahamo と ahamo ポイ活を実績で数える',
    ah.cfgOn === true && ah.cfgPoiOn === true, JSON.stringify([ah.cfgOn, ah.cfgPoiOn]));
  chk('⑯ 大盛り（110GB）の行が出る',
    ah.keys.indexOf('plan:ahamo:t1') >= 0, JSON.stringify(ah.keys));
  chk('⑯ ahamo ポイ活は別の行になる',
    ah.keys.indexOf('plan:ahamo_poikatsu') >= 0, JSON.stringify(ah.keys));
  chk('⑯ 行の名前に容量が入る（30GB／110GB）',
    /30GB/.test(ah.catT0) && /110GB/.test(ah.catT1), ah.catT0 + ' / ' + ah.catT1);

  /* ---- ⑰ home 5G を新規と機種変更で分ける（2026-09-07）---- */
  const h5 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const cat = L.cxCatalog();
    // 区分が入っていない以前の保存は、分けずに1つの行にまとめる
    const old = L.itemsRawIe({ enabled: true, product: 'home5g' });
    const nw = L.itemsRawIe({ enabled: true, product: 'home5g', h5Kubun: 'kishu' });
    return {
      hasSel: !!document.getElementById('ieH5Kubun'),
      opts: Array.prototype.map.call(
        document.querySelectorAll('#ieH5Kubun option'), (o) => o.value),
      catShinki: cat['ie:home5g:shinki'] || '', catKishu: cat['ie:home5g:kishu'] || '',
      oldKeys: Object.keys(old), newKeys: Object.keys(nw)
    };
  });
  chk('⑰ home 5G に「区分」の選び欄がある（新規／機種変更）',
    h5.hasSel === true && JSON.stringify(h5.opts) === '["shinki","kishu"]',
    JSON.stringify(h5.opts));
  chk('⑰ 実績の項目が新規と機種変更に分かれる',
    /新規/.test(h5.catShinki) && /機種変更/.test(h5.catKishu),
    h5.catShinki + ' / ' + h5.catKishu);
  chk('⑰ 機種変更を選ぶと、その行で数える',
    h5.newKeys.indexOf('ie:home5g:kishu') >= 0, JSON.stringify(h5.newKeys));
  chk('⑰ 区分が入っていない以前の保存は、分けずにまとめる',
    h5.oldKeys.indexOf('ie:home5g') >= 0
    && h5.oldKeys.filter((k) => k.indexOf('ie:home5g:') === 0).length === 0,
    JSON.stringify(h5.oldKeys));

  /* ---- ⑱ 実績のポイントの並べ替え（▲▼・2026-09-07）---- */
  const ord = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.lines.cxSet([
      { id: 'a', name: 'あ', pt: 1, keys: ['proc:shinki'] },
      { id: 'b', name: 'い', pt: 2, keys: ['proc:mnp'] },
      { id: 'c', name: 'う', pt: 3, keys: ['proc:kishu'] }
    ]);
    const before = T.lines.cxOrder();
    T.lines.cxMove(2, 'up');       // 「う」を上へ
    const afterUp = T.lines.cxOrder();
    T.lines.cxMove(0, 'down');     // 「あ」を下へ
    return { before: before, afterUp: afterUp, afterDown: T.lines.cxOrder() };
  });
  chk('⑱ ▲で1つ上へ動く',
    JSON.stringify(ord.afterUp) === '["a","c","b"]', JSON.stringify(ord.afterUp));
  chk('⑱ ▼で1つ下へ動く',
    JSON.stringify(ord.afterDown) === '["c","a","b"]', JSON.stringify(ord.afterDown));

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
