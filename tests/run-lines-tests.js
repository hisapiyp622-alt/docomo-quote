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
    !!find(cx.all, 'r2') && find(cx.all, 'r2').n === 1, JSON.stringify(cx.all));
  chk('⑨ 細かい行に丸ごと含まれる行は、その回線では数えない（グレーで出す）',
    !!find(cx.all, 'r1') && find(cx.all, 'r1').n === 0
    && find(cx.all, 'r1').covered === 1, JSON.stringify(find(cx.all, 'r1')));
  chk('⑨ 組み合わせは、両方そろった回線だけ数える',
    !!find(cx.all, 'r3') && find(cx.all, 'r3').n === 1 && find(cx.all, 'r3').total === 100,
    JSON.stringify(find(cx.all, 'r3')));
  chk('⑨ そろわない組み合わせは数えない', !find(cx.all, 'r4'), JSON.stringify(find(cx.all, 'r4')));
  chk('⑨ 条件が空の行は数えない', !find(cx.all, 'r5'));
  /* 「新規（単独）」は「新規 × プランA」に丸ごと含まれるので、
   * その回線では細かいほうだけ数える（2026-09-07 の指定）。 */
  chk('⑨ 合計は 3＋100 ＝103（新規の単独行は、細かい行で数えた回線では数えない）',
    cx.total === 103, String(cx.total));
  chk('⑨ 成約で外した回線は数えない（回線1だけなら 100）',
    cx.total1 === 100, String(cx.total1) + ' / ' + JSON.stringify(cx.only1));

  /* 光は世帯に1本。回線が2本あっても商談に1件 */
  const cxIe = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    /* 2026-09-07 から、光は申込区分（新規・転用・事業者変更）で分ける。
     * 既定の申込区分は「新規」なので、その行を使う。 */
    L.cxSet([{ id: 'ie', name: '光 1ギガ（新規）', pt: 42, keys: ['ie:1g:shinki'] }]);
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
    // 既定では実績に出していないプランを選ぶ
    const off = m.plans.filter((p) => !L.statsCatalog()['plan:' + p.id])[0];
    /* オプションは 2026-09-07 から全部数えるようにしたので、
     * マスタ設定の画面で1つ外してから試す（実際に押す道を通す）。 */
    /* 一覧の順番に頼らない。ドコモメールは「プランに付いてくるかどうか」の選択で
     * 獲得ではないため実績に数えない（statsSkipOpt）ので、数える対象のものを選ぶ。 */
    const offOpt = m.options.filter((o) => !!L.statsCatalog()['opt:' + o.id])[0];
    L.optSkipUi(offOpt.id, false);
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
   * 条件が重なる行は、細かいほうだけ数える（店舗の指定・2026-09-07）。
   * U39の回線は「のりかえ×プランA×U39」だけ、U39でない回線は
   * 「のりかえ×プランA」だけ。二重には数えない。 */
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
  chk('⑪ 基本の行は、U39でない回線だけ数える（U39の回線は細かい行で数える）',
    !!pick(u39.rows, 'base') && pick(u39.rows, 'base').n === 1
    && pick(u39.rows, 'base').covered === 1, JSON.stringify(u39.rows));
  chk('⑪ 加算はチェックした回線だけ数える',
    !!pick(u39.rows, 'add') && pick(u39.rows, 'add').n === 1, JSON.stringify(pick(u39.rows, 'add')));
  chk('⑪ 合計は 105 ＋ 48 ＝153（二重に数えない）',
    u39.total === 153, String(u39.total));

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
      marks: L.statMarks() };
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
  chk('⑮ 画面にタブレットのチェック欄がある', more.hasTabletBox === true);
  chk('⑮ 実績の印4つが、④オプションの「その他」にタイルで出ている',
    ['dcardFirst', 'dpayFirst', 'shitadoriTarget', 'shitadoriOther']
      .every((id) => more.marks.some((m) => m.id === id && m.inOther)),
    JSON.stringify(more.marks));
  chk('⑮ タイルの文字が読める（下取りの2種類・初回利用の2つ）',
    /下取り/.test((more.marks.filter((m) => m.id === 'shitadoriTarget')[0] || {}).name || '')
    && /指定外/.test((more.marks.filter((m) => m.id === 'shitadoriOther')[0] || {}).name || '')
    && /dカード初回/.test((more.marks.filter((m) => m.id === 'dcardFirst')[0] || {}).name || '')
    && /d払い初回/.test((more.marks.filter((m) => m.id === 'dpayFirst')[0] || {}).name || ''),
    JSON.stringify(more.marks.map((m) => m.name)));
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

  /* ---- ⑲ LIBMO は新規・のりかえのときだけ選べる（2026-09-07）----
   * LIBMO はドコモとは別会社のサービス。店舗の指定で、新規とのりかえで扱う
   * （機種変更・プラン変更では出さない）。
   * ・出さない世代は**一覧そのものから外す**（iPhone・iPad の Safari は
   *   option の hidden を無視するため・2026-09-06 の事故）
   * ・すでに LIBMO を選んでいる見積もりでは、チェックを外しても消さない
   *   （消すとプランが未選択に戻り、保存した見積もりの金額が変わるため） */
  const lib = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const plans = ['libmo_nattoku', 'libmo_gogo'].map(
      (id) => m.plans.filter((p) => p.id === id)[0] || null);
    function groups() {
      return Array.prototype.map.call(
        document.querySelectorAll('#planGroup option'), (o) => o.value);
    }
    // 機種変更のとき
    L.fill(0, { planId: m.plans[0].id, procType: 'kishu', procTodo: { kishu: true } });
    L.fill(1, {});
    L.pick(0);
    const onKishu = groups();
    // のりかえのとき
    L.fill(0, { planId: m.plans[0].id, procType: 'mnp', procTodo: { mnp: true } });
    L.pick(0);
    const onMnp = groups();
    // 新規のとき（2026-09-07 に足した）
    L.fill(0, { planId: m.plans[0].id, procType: 'shinki', procTodo: { shinki: true } });
    L.pick(0);
    const onShinki = groups();
    // LIBMO を選んだあとに機種変更へ変えても、世代が消えないこと
    L.fill(0, { planGroup: 'libmo', planId: 'libmo_gogo', tierIdx: 2,
      procType: 'kishu', procTodo: { kishu: true } });
    L.pick(0);
    const keepGroups = groups();
    const keepPlan = document.getElementById('planId').value;
    // のりかえに戻して一覧の中身を見る
    L.fill(0, { planGroup: 'libmo', planId: 'libmo_nattoku', tierIdx: 1,
      procType: 'mnp', procTodo: { mnp: true } });
    L.pick(0);
    const names = Array.prototype.map.call(
      document.querySelectorAll('#planId option'), (o) => o.textContent.trim());
    return {
      found: plans.map((p) => !!p),
      prices: plans.map((p) => p && p.tiers.map((t) => t.price)),
      groups: plans.map((p) => p && p.group),
      onKishu: onKishu, onMnp: onMnp, onShinki: onShinki,
      keepGroups: keepGroups, keepPlan: keepPlan,
      names: names,
      monthly: T.run({ planGroup: 'libmo', planId: 'libmo_nattoku', tierIdx: 1 }).segs[0].monthly
    };
  });
  chk('⑲ LIBMO のプランが2つとも料金表にある',
    lib.found[0] === true && lib.found[1] === true);
  chk('⑲ なっとくプランは 3GB 980円・8GB 1,518円',
    JSON.stringify(lib.prices[0]) === '[980,1518]', JSON.stringify(lib.prices[0]));
  chk('⑲ ゴーゴープランは 1,100／1,320／1,980円',
    JSON.stringify(lib.prices[1]) === '[1100,1320,1980]', JSON.stringify(lib.prices[1]));
  chk('⑲ 機種変更のときは「プラン世代」に LIBMO を出さない',
    lib.onKishu.indexOf('libmo') < 0, JSON.stringify(lib.onKishu));
  chk('⑲ のりかえのときは「プラン世代」に LIBMO が出る',
    lib.onMnp.indexOf('libmo') >= 0, JSON.stringify(lib.onMnp));
  chk('⑲ 新規のときも「プラン世代」に LIBMO が出る',
    lib.onShinki.indexOf('libmo') >= 0, JSON.stringify(lib.onShinki));
  chk('⑲ LIBMO を選んだあとは、のりかえを外しても消えない',
    lib.keepGroups.indexOf('libmo') >= 0 && lib.keepPlan === 'libmo_gogo',
    JSON.stringify(lib.keepGroups) + ' / ' + lib.keepPlan);
  chk('⑲ 一覧に LIBMO のプランが実際に出ている',
    lib.names.some((n) => /なっとくプラン/.test(n))
    && lib.names.some((n) => /ゴーゴープラン/.test(n)), JSON.stringify(lib.names));
  chk('⑲ なっとくプラン 8GB の月額は 1,518円（ドコモの割引は付かない）',
    lib.monthly === 1518, String(lib.monthly));

  /* ---- ⑳ 法人プランだけの割引（2026-09-07・店舗の指定）----
   * 出典: ドコモの提供条件書
   * ・ビジネスメンバーズ割 ▲275円 … データ無制限・かけ放題の両方
   * ・社員割 ▲275円 … データ無制限のみ（かけ放題の条件書には記載が無い）
   * 対象外のプランで選んでも金額が動かないことまで見る。 */
  const bw = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const m = T.std.get();
    const dis = {};
    ['biz_unlimited', 'biz_kakehodai'].forEach((id) => {
      const p = m.plans.filter((x) => x.id === id)[0];
      dis[id] = p ? p.discounts : null;
    });
    function shown(id) {
      const el = document.getElementById(id);
      return !!el && !el.hidden;
    }
    // データ無制限（〜1GB 5,313円）で2つとも入れる
    const uBase = T.run({ planGroup: 'biz', planId: 'biz_unlimited', tierIdx: 0 });
    const uBoth = T.run({ planGroup: 'biz', planId: 'biz_unlimited', tierIdx: 0,
      bizMembers: true, shain: true });
    // かけ放題（3,553円）… ビジネスメンバーズ割だけ効く
    const kBase = T.run({ planGroup: 'biz', planId: 'biz_kakehodai' });
    const kBoth = T.run({ planGroup: 'biz', planId: 'biz_kakehodai',
      bizMembers: true, shain: true });
    /* 法人プランのときだけ欄を出す。
     * run() は見終わったら状態を戻すので、画面を見るときは fill+pick を使う。 */
    const L = T.lines;
    L.fill(0, { planGroup: 'biz', planId: 'biz_unlimited', tierIdx: 0 });
    L.pick(0);
    const onBizU = [shown('bizMembersWrap'), shown('shainWrap')];
    L.fill(0, { planGroup: 'biz', planId: 'biz_kakehodai' });
    L.pick(0);
    const onBizK = [shown('bizMembersWrap'), shown('shainWrap')];
    L.fill(0, { planGroup: 'current', planId: 'max' });
    L.pick(0);
    const onMax = [shown('bizMembersWrap'), shown('shainWrap')];
    const offTxt = (document.getElementById('discountOff') || {}).textContent || '';
    // 個人のプランで選んでも金額が動かないこと
    const maxBase = T.run({ planGroup: 'current', planId: 'max' });
    const maxBoth = T.run({ planGroup: 'current', planId: 'max',
      bizMembers: true, shain: true });
    // 3GB超〜無制限で全部の割引 → 提供条件書の 4,873円 と合うか
    const allOn = T.run({ planGroup: 'biz', planId: 'biz_unlimited', tierIdx: 2,
      minna: '3', dSet: true, choki: 'y20', bizMembers: true, shain: true });
    // 見積書に名前が出るか
    L.fill(0, { planGroup: 'biz', planId: 'biz_unlimited', tierIdx: 0,
      bizMembers: true, shain: true });
    L.fill(1, {});
    L.pick(0);
    const sheet = T.std.sheetHtml();
    return {
      dis: dis,
      uBase: uBase.segs[0].monthly, uBoth: uBoth.segs[0].monthly,
      kBase: kBase.segs[0].monthly, kBoth: kBoth.segs[0].monthly,
      maxBase: maxBase.segs[0].monthly, maxBoth: maxBoth.segs[0].monthly,
      allOn: allOn.segs[0].monthly,
      onBizU: onBizU, onBizK: onBizK, onMax: onMax, offTxt: offTxt,
      sheetHasBiz: /ビジネスメンバーズ割/.test(sheet),
      sheetHasShain: /社員割/.test(sheet)
    };
  });
  chk('⑳ 料金表に金額が入っている（無制限は2つ・かけ放題はメンバーズ割だけ）',
    bw.dis.biz_unlimited.bizMembers === 275 && bw.dis.biz_unlimited.shain === 275
    && bw.dis.biz_kakehodai.bizMembers === 275 && !bw.dis.biz_kakehodai.shain,
    JSON.stringify(bw.dis));
  chk('⑳ データ無制限は2つで▲550円',
    bw.uBase - bw.uBoth === 550, bw.uBase + ' → ' + bw.uBoth);
  chk('⑳ かけ放題はメンバーズ割の▲275円だけ（社員割は効かない）',
    bw.kBase - bw.kBoth === 275, bw.kBase + ' → ' + bw.kBoth);
  chk('⑳ 個人のプランで選んでも金額が動かない',
    bw.maxBase === bw.maxBoth, bw.maxBase + ' → ' + bw.maxBoth);
  chk('⑳ 法人プランのときだけ欄を出す',
    JSON.stringify(bw.onBizU) === '[true,true]'
    && JSON.stringify(bw.onBizK) === '[true,false]'
    && JSON.stringify(bw.onMax) === '[false,false]',
    JSON.stringify([bw.onBizU, bw.onBizK, bw.onMax]));
  chk('⑳ 個人のプランで「社員割の対象外です」と出さない',
    !/社員割|ビジネスメンバーズ/.test(bw.offTxt), bw.offTxt);
  chk('⑳ 提供条件書の 4,873円（3GB超〜無制限・全部の割引）と合う',
    bw.allOn === 4873, String(bw.allOn));
  chk('⑳ 見積書の内訳に名前が出る',
    bw.sheetHasBiz === true && bw.sheetHasShain === true,
    JSON.stringify([bw.sheetHasBiz, bw.sheetHasShain]));

  /* ---- ㉑ 機種の区分（自動／ハイエンド／スタンダード・2026-09-07）----
   * 金額で自動的に決め、手でも変えられるようにする（店舗の指定）。 */
  const kr = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    const base = { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true, payMethod: 'ikkatsu' };
    function keysFor(patch) {
      L.fill(0, Object.assign({}, base, patch));
      L.fill(1, {});
      L.pick(0);
      return Object.keys(L.items());
    }
    // 自動: 10万円以上 → ハイエンド ／ 10万円未満 → スタンダード
    const autoHigh = keysFor({ deviceName: 'Pixel 10 Pro', devicePrice: 180000 });
    const autoStd = keysFor({ deviceName: 'Galaxy A56', devicePrice: 65000 });
    const autoIpHigh = keysFor({ deviceName: 'iPhone 17 Pro', devicePrice: 200000 });
    // iPhone は機種名で見るので、高くても Pro・Air でなければスタンダード
    const autoIpStd = keysFor({ deviceName: 'iPhone 17', devicePrice: 200000 });
    // 手で選んだら、そちらが勝つ
    const manStd = keysFor({ deviceName: 'Pixel 10 Pro', devicePrice: 180000,
      kishuRank: 'std' });
    const manHigh = keysFor({ deviceName: 'Galaxy A56', devicePrice: 65000,
      kishuRank: 'high' });
    // 端末を買っていないときは、どちらにも数えない
    const noBuy = keysFor({ deviceName: 'Pixel 10 Pro', devicePrice: 180000,
      payMethod: 'none' });
    // 頭金は元値から引く（総額12万・頭金3万 → 元値9万 → スタンダード）
    const atama = keysFor({ deviceName: 'Xperia 10', devicePrice: 120000, atamakin: 30000 });
    // 画面の選び欄
    L.fill(0, Object.assign({}, base, { deviceName: 'Galaxy A56', devicePrice: 65000 }));
    L.pick(0);
    const opts = Array.prototype.map.call(
      document.querySelectorAll('#kishuRank option'), (o) => o.value);
    const hintAuto = (document.getElementById('kishuRankHint') || {}).textContent || '';
    L.fill(0, Object.assign({}, base, { deviceName: 'Galaxy A56', devicePrice: 65000,
      kishuRank: 'high' }));
    L.pick(0);
    const hintMan = (document.getElementById('kishuRankHint') || {}).textContent || '';
    const cat = L.cxCatalog();
    return { autoHigh, autoStd, autoIpHigh, autoIpStd, manStd, manHigh, noBuy, atama,
      opts, hintAuto, hintMan,
      catA: cat['kishustd:android'] || '', catI: cat['kishustd:iphone'] || '' };
  });
  const hasK = (ks, k) => ks.indexOf(k) >= 0;
  chk('㉑ 自動: 10万円以上の Android はハイエンド',
    hasK(kr.autoHigh, 'highend:android') && !hasK(kr.autoHigh, 'kishustd:android'),
    JSON.stringify(kr.autoHigh));
  chk('㉑ 自動: 10万円未満の Android はスタンダード',
    hasK(kr.autoStd, 'kishustd:android') && !hasK(kr.autoStd, 'highend:android'),
    JSON.stringify(kr.autoStd));
  chk('㉑ 自動: iPhone Pro はハイエンド',
    hasK(kr.autoIpHigh, 'highend:iphone'), JSON.stringify(kr.autoIpHigh));
  chk('㉑ 自動: iPhone は Pro・Air でなければ、高くてもスタンダード',
    hasK(kr.autoIpStd, 'kishustd:iphone') && !hasK(kr.autoIpStd, 'highend:iphone'),
    JSON.stringify(kr.autoIpStd));
  chk('㉑ 手で「スタンダード」を選ぶと、金額が高くてもスタンダード',
    hasK(kr.manStd, 'kishustd:android') && !hasK(kr.manStd, 'highend:android'),
    JSON.stringify(kr.manStd));
  chk('㉑ 手で「ハイエンド」を選ぶと、金額が安くてもハイエンド',
    hasK(kr.manHigh, 'highend:android') && !hasK(kr.manHigh, 'kishustd:android'),
    JSON.stringify(kr.manHigh));
  chk('㉑ 端末購入なしのときは、どちらにも数えない',
    !kr.noBuy.some((k) => k.indexOf('highend') === 0 || k.indexOf('kishustd') === 0),
    JSON.stringify(kr.noBuy));
  chk('㉑ 頭金は元値から引く（総額12万・頭金3万 → スタンダード）',
    hasK(kr.atama, 'kishustd:android'), JSON.stringify(kr.atama));
  chk('㉑ 選び欄は「自動・ハイエンド・スタンダード」',
    JSON.stringify(kr.opts) === '["","high","std"]', JSON.stringify(kr.opts));
  chk('㉑ 自動のときは、いまの判定を画面に出す',
    /自動/.test(kr.hintAuto) && /スタンダード/.test(kr.hintAuto), kr.hintAuto);
  chk('㉑ 手で選んだときは、その旨を画面に出す',
    /手で選んで/.test(kr.hintMan), kr.hintMan);
  chk('㉑ 実績の項目に Android と iPhone のスタンダードが並ぶ',
    /Android/.test(kr.catA) && /iPhone/.test(kr.catI), kr.catA + ' / ' + kr.catI);

  /* ---- ㉒ 光を申込区分で分ける（2026-09-07）---- */
  const ha = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const cat = L.cxCatalog();
    const out = {};
    ['shinki', 'tenyo', 'jigyosha', 'kirikae'].forEach((a) => {
      out[a] = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari1g', applyType: a }));
    });
    const old = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari1g' }));
    const ten = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari10g',
      applyType: 'jigyosha' }));
    return { out: out, old: old, ten: ten,
      catS: cat['ie:1g:shinki'] || '', catT: cat['ie:1g:tenyo'] || '',
      catJ: cat['ie:1g:jigyosha'] || '', catK: cat['ie:1g:kirikae'] || '',
      cat10: cat['ie:10g:jigyosha'] || '' };
  });
  chk('㉒ 実績の項目に 新規・転用・事業者変更・転用タイプC が並ぶ',
    /新規/.test(ha.catS) && /転用/.test(ha.catT) && /事業者変更/.test(ha.catJ)
    && /タイプC/.test(ha.catK),
    [ha.catS, ha.catT, ha.catJ, ha.catK].join(' / '));
  chk('㉒ 10ギガも申込区分で分かれる', /10ギガ/.test(ha.cat10) && /事業者変更/.test(ha.cat10),
    ha.cat10);
  chk('㉒ 新規を選ぶと、新規の行で数える',
    ha.out.shinki.indexOf('ie:1g:shinki') >= 0, JSON.stringify(ha.out.shinki));
  chk('㉒ 転用を選ぶと、転用の行で数える',
    ha.out.tenyo.indexOf('ie:1g:tenyo') >= 0, JSON.stringify(ha.out.tenyo));
  chk('㉒ 事業者変更を選ぶと、事業者変更の行で数える',
    ha.out.jigyosha.indexOf('ie:1g:jigyosha') >= 0, JSON.stringify(ha.out.jigyosha));
  chk('㉒ 10ギガの事業者変更も、そのぶんの行で数える',
    ha.ten.indexOf('ie:10g:jigyosha') >= 0, JSON.stringify(ha.ten));
  /* 保存を小さくしたあとも区分が残っているか。
   * ここを見ないと、保存に残す処理を消しても項目のテストだけ通ってしまう。 */
  const slim = await page.evaluate(() => {
    const L = window.__KQ_TEST__.lines;
    return {
      hikari: L.slimIe({ enabled: true, product: 'hikari1g', applyType: 'jigyosha',
        housing: 'ht', jimuFee: 4950 }),
      home5g: L.slimIe({ enabled: true, product: 'home5g', h5Kubun: 'kishu',
        h5DevicePrice: 73260 })
    };
  });
  chk('㉒ 保存を小さくしても、光の申込区分は残る',
    slim.hikari.applyType === 'jigyosha', JSON.stringify(slim.hikari));
  chk('㉒ 保存を小さくしても、home 5G の区分は残る',
    slim.home5g.h5Kubun === 'kishu', JSON.stringify(slim.home5g));
  chk('㉒ 区分が入っていない以前の保存は、分けずにまとめる',
    ha.old.indexOf('ie:1g') >= 0
    && ha.old.filter((k) => k.indexOf('ie:1g:') === 0).length === 0,
    JSON.stringify(ha.old));

  /* ---- ㉓ プロバイダ OCN インターネット（2026-09-07・店舗の指定）----
   * 画面の選択肢と同じ文字で見ているかまで確かめる。
   * ここがズレると、選んでいるのに数えられない。 */
  const ocn = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const opts = Array.prototype.map.call(
      document.querySelectorAll('#ieProvider option'), (o) => o.value);
    const on = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari1g',
      applyType: 'shinki', provider: 'OCN インターネット' }));
    const other = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari1g',
      applyType: 'shinki', provider: '@nifty' }));
    const none = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari1g',
      applyType: 'shinki' }));
    const slim = L.slimIe({ enabled: true, product: 'hikari1g', applyType: 'shinki',
      provider: 'OCN インターネット', jimuFee: 4950 });
    const cat = L.cxCatalog();
    return { opts: opts, on: on, other: other, none: none, slim: slim,
      cat: cat['ie:prov:ocn'] || '' };
  });
  chk('㉓ 画面の選択肢に「OCN インターネット」がある（同じ文字で見ている）',
    ocn.opts.indexOf('OCN インターネット') >= 0, JSON.stringify(ocn.opts));
  chk('㉓ 実績の項目に出る', /OCN インターネット/.test(ocn.cat), ocn.cat);
  chk('㉓ OCN を選ぶと数える',
    ocn.on.indexOf('ie:prov:ocn') >= 0, JSON.stringify(ocn.on));
  chk('㉓ ほかのプロバイダでは数えない',
    ocn.other.indexOf('ie:prov:ocn') < 0, JSON.stringify(ocn.other));
  chk('㉓ プロバイダ未定のときは数えない',
    ocn.none.indexOf('ie:prov:ocn') < 0, JSON.stringify(ocn.none));
  chk('㉓ 保存を小さくしてもプロバイダは残る',
    ocn.slim.provider === 'OCN インターネット', JSON.stringify(ocn.slim));

  /* ---- ㉔ 光のオプション（テレビ・お電話）を数える（2026-09-07）----
   * イエナカの実際のオプション一覧に、同じ id で載っていることまで見る。
   * id がズレると、選んでいるのに数えられない。 */
  const ieo = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const base = { enabled: true, product: 'hikari1g', applyType: 'shinki' };
    const tv = Object.keys(L.itemsRawIe(Object.assign({}, base, { opts: { tv: true } })));
    const dw = Object.keys(L.itemsRawIe(Object.assign({}, base, { opts: { denwa: true } })));
    const bv = Object.keys(L.itemsRawIe(Object.assign({}, base, { opts: { denwaBV: true } })));
    const none = Object.keys(L.itemsRawIe(Object.assign({}, base, { opts: {} })));
    const slim = L.slimIe(Object.assign({}, base, { jimuFee: 4950,
      opts: { tv: true, denwa: true, lanCard: true } }));
    const cat = L.cxCatalog();
    /* 画面のオプション一覧に、同じ id のチェック欄が実際に出ているか */
    const ieEn = document.getElementById('ieEnabled');
    if (ieEn && !ieEn.checked) {
      ieEn.checked = true;
      ieEn.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const ids = Array.prototype.map.call(
      document.querySelectorAll('#ieOptList [data-ietile]'),
      (el) => el.getAttribute('data-ietile'));
    return { tv, dw, bv, none, slim, ids,
      catTv: cat['ie:opt:tv'] || '', catDw: cat['ie:opt:denwa'] || '',
      catBv: cat['ie:opt:denwaBV'] || '' };
  });
  chk('㉔ 実績の項目に テレビオプション・光電話・光電話バリューが並ぶ',
    /テレビオプション/.test(ieo.catTv) && /ドコモ光電話/.test(ieo.catDw)
    && /バリュー/.test(ieo.catBv),
    [ieo.catTv, ieo.catDw, ieo.catBv].join(' / '));
  chk('㉔ テレビオプションを選ぶと数える',
    ieo.tv.indexOf('ie:opt:tv') >= 0, JSON.stringify(ieo.tv));
  chk('㉔ ドコモ光電話を選ぶと数える',
    ieo.dw.indexOf('ie:opt:denwa') >= 0, JSON.stringify(ieo.dw));
  chk('㉔ 光電話バリューを選ぶと数える',
    ieo.bv.indexOf('ie:opt:denwaBV') >= 0, JSON.stringify(ieo.bv));
  chk('㉔ 選んでいないときは数えない',
    !ieo.none.some((k) => k.indexOf('ie:opt:') === 0), JSON.stringify(ieo.none));
  chk('㉔ 保存を小さくしても、数えるオプションの印は残る',
    !!(ieo.slim.opts || {}).tv && !!(ieo.slim.opts || {}).denwa,
    JSON.stringify(ieo.slim.opts));
  chk('㉔ 数えないオプションは保存に残さない（保存を小さくするため）',
    !(ieo.slim.opts || {}).lanCard, JSON.stringify(ieo.slim.opts));
  chk('㉔ 光の画面に、同じ id のチェック欄が実際に出ている',
    ieo.ids.indexOf('tv') >= 0 && ieo.ids.indexOf('denwa') >= 0
    && ieo.ids.indexOf('denwaBV') >= 0, JSON.stringify(ieo.ids));

  /* ---- ㉕ homeでんわ・dカード初回利用・オプションの実績（2026-09-07）---- */
  const more2 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    const plan = m.plans[0].id;
    // homeでんわ（光・home 5G の両方で選べる）
    const hd1 = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari1g',
      applyType: 'shinki', opts: { homeDenwaLight: true } }));
    const hd5 = Object.keys(L.itemsRawIe({ enabled: true, product: 'home5g',
      h5Kubun: 'shinki', opts: { homeDenwaBasic: true } }));
    const hdSlim = L.slimIe({ enabled: true, product: 'home5g', h5Kubun: 'shinki',
      opts: { homeDenwaLight: true }, h5DevicePrice: 73260 });
    // dカード初回利用
    L.fill(0, { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true, dcardFirst: true });
    L.fill(1, {});
    L.pick(0);
    const dcOn = Object.keys(L.items());
    const box = L.statMarks().some((m) => m.id === 'dcardFirst');
    const sheet = T.std.sheetHtml() + '\n'
      + (T.std.staffHtml ? T.std.staffHtml() : '');
    L.fill(0, { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true });
    L.pick(0);
    const dcOff = Object.keys(L.items());
    // 料金表のオプション（名前と金額）
    const byName = {};
    (m.options || []).forEach((o) => { byName[o.name] = o.price; });
    // 実績の項目に、オプションが名前で並んでいるか
    const cat = L.cxCatalog();
    const catNames = Object.keys(cat).map((k) => cat[k]);
    return { hd1, hd5, hdSlim, dcOn, dcOff, box,
      sheetHasDc: /dカード初回利用/.test(sheet),
      byName: byName, catNames: catNames,
      catHd1: cat['ie:opt:homeDenwaLight'] || '',
      catHd2: cat['ie:opt:homeDenwaBasic'] || '',
      catDc: cat['dcardfirst'] || '' };
  });
  chk('㉕ homeでんわ ライトを光で選ぶと数える',
    more2.hd1.indexOf('ie:opt:homeDenwaLight') >= 0, JSON.stringify(more2.hd1));
  chk('㉕ homeでんわ ベーシックを home 5G で選ぶと数える',
    more2.hd5.indexOf('ie:opt:homeDenwaBasic') >= 0, JSON.stringify(more2.hd5));
  chk('㉕ 保存を小さくしても homeでんわ の印は残る',
    !!(more2.hdSlim.opts || {}).homeDenwaLight, JSON.stringify(more2.hdSlim.opts));
  const ieTiles = await page.evaluate(() => {
    const L = window.__KQ_TEST__.lines;
    return {
      hikari: L.ieOptTiles('hikari1g'),
      home5g: L.ieOptTiles('home5g'),
      clicked: (function () {
        L.ieOptTiles('hikari1g');
        const ok = L.ieOptClick('homeでんわ ライト');
        return { ok: ok, after: L.ieOptTiles('hikari1g') };
      })()
    };
  });
  chk('㉕ 光の④オプションに「homeでんわ」のタイルが実際に出ている',
    ieTiles.hikari.some((n) => /homeでんわ ライト/.test(n))
    && ieTiles.hikari.some((n) => /homeでんわ ベーシック/.test(n)),
    JSON.stringify(ieTiles.hikari));
  chk('㉕ home 5G の④オプションにも出ている',
    ieTiles.home5g.some((n) => /homeでんわ ライト/.test(n)),
    JSON.stringify(ieTiles.home5g));
  chk('㉕ homeでんわ を押すまで、セット割のタイルは出ない',
    !ieTiles.hikari.some((n) => /セット割/.test(n)), JSON.stringify(ieTiles.hikari));
  chk('㉕ homeでんわ を押すと、セット割のタイルが出る',
    ieTiles.clicked.ok === true
    && ieTiles.clicked.after.some((n) => /セット割/.test(n)),
    JSON.stringify(ieTiles.clicked));
  chk('㉕ 実績の項目に homeでんわ が2つ並ぶ',
    /ライト/.test(more2.catHd1) && /ベーシック/.test(more2.catHd2),
    more2.catHd1 + ' / ' + more2.catHd2);
  chk('㉕ 「dカード初回利用」のタイルがある', more2.box === true);
  chk('㉕ dカード初回利用にチェックすると数える',
    more2.dcOn.indexOf('dcardfirst') >= 0, JSON.stringify(more2.dcOn));
  chk('㉕ チェックしなければ数えない',
    more2.dcOff.indexOf('dcardfirst') < 0, JSON.stringify(more2.dcOff));
  chk('㉕ 実績の項目に「（再掲）dカード初回利用」が出る',
    /dカード初回利用/.test(more2.catDc), more2.catDc);
  chk('㉕ dカード初回利用はお客様の紙に出ない', more2.sheetHasDc === false);

  /* ---- ㉖ あんしん系のオプション（名前・金額・実績の項目）---- */
  const ANSHIN = [
    ['あんしんセキュリティ スタンダードプラン', 550],
    ['あんしんセキュリティ スタンダードプラン詐欺対策プラス', 999],
    ['あんしんセキュリティ トータルプラン詐欺対策プラス', 1815],
    ['あんしん遠隔サポート', 660],
    ['smartあんしん補償', 990],
    ['smartあんしんパック', 1452]
  ];
  ANSHIN.forEach(function (a) {
    chk('㉖ 料金表に「' + a[0] + '」が ' + a[1] + '円である',
      more2.byName[a[0]] === a[1], String(more2.byName[a[0]]));
    chk('㉖ 実績の項目に「' + a[0] + '」が出る',
      more2.catNames.indexOf('オプション: ' + a[0]) >= 0
      || more2.catNames.some((n) => n.indexOf(a[0]) >= 0),
      JSON.stringify(more2.catNames.filter((n) => /あんしん/.test(n))));
  });

  /* ---- ㉗ 条件が重なる行の二重計上（2026-09-07・店舗の指定）----
   * 「のりかえ×ポイ活MAX×U39」を作ると「のりかえ×ポイ活MAX」にも当たり、
   * 両方で数えられて点が二重になっていた。細かいほうだけ数える。 */
  const dup = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const rows = [
      { id: 'a', name: 'のりかえ × ポイ活MAX', pt: 100,
        keys: ['proc:mnp', 'plan:poikatsu_max'] },
      { id: 'b', name: 'のりかえ × ポイ活MAX × U39', pt: 150,
        keys: ['proc:mnp', 'plan:poikatsu_max', 'u39'] }
    ];
    function run(patch1, patch2) {
      L.cxSet(rows.map((r) => Object.assign({}, r)));
      L.fill(0, Object.assign({ planId: 'poikatsu_max', procType: 'mnp',
        procTodo: { mnp: true }, planChange: true }, patch1 || {}));
      L.fill(1, patch2 ? Object.assign({ planId: 'poikatsu_max', procType: 'mnp',
        procTodo: { mnp: true }, planChange: true }, patch2) : {});
      L.pick(0);
      return { total: L.cxTotal(), rows: L.cxBreak() };
    }
    return {
      u39: run({ u39: true }),                        // U39の回線1本
      plain: run({}),                                 // U39でない回線1本
      both: run({ u39: true }, { u39: false })        // 1本ずつ
    };
  });
  function row(r, id) { return (r.rows || []).filter((x) => x.id === id)[0] || null; }
  chk('㉗ U39の回線は、細かい行の150点だけ（100＋150にしない）',
    dup.u39.total === 150, String(dup.u39.total) + ' / ' + JSON.stringify(dup.u39.rows));
  chk('㉗ 数えなかった行はグレー用の印を付けて残す',
    !!row(dup.u39, 'a') && row(dup.u39, 'a').n === 0
    && row(dup.u39, 'a').covered === 1, JSON.stringify(row(dup.u39, 'a')));
  chk('㉗ U39でない回線は、これまでどおり100点',
    dup.plain.total === 100, String(dup.plain.total));
  chk('㉗ U39でない回線では、細かい行に食われない',
    !!row(dup.plain, 'a') && row(dup.plain, 'a').n === 1
    && row(dup.plain, 'a').covered === 0, JSON.stringify(row(dup.plain, 'a')));
  chk('㉗ 1本ずつのときは 150（U39）＋100（U39でない）＝250',
    dup.both.total === 250, String(dup.both.total) + ' / ' + JSON.stringify(dup.both.rows));

  /* 食べられた回線が2本のときは covered も2。応対ごとに1と数えると、
   * 実績の「〇件は、もっと細かい行で数えました」がずれる。 */
  const dup2 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    L.cxSet([
      { id: 'a', name: 'のりかえ × ポイ活MAX', pt: 100, keys: ['proc:mnp', 'plan:poikatsu_max'] },
      { id: 'b', name: 'のりかえ × ポイ活MAX × U39', pt: 150,
        keys: ['proc:mnp', 'plan:poikatsu_max', 'u39'] }
    ]);
    const base = { planId: 'poikatsu_max', procType: 'mnp', procTodo: { mnp: true },
      planChange: true, u39: true };
    L.fill(0, base);
    L.fill(1, Object.assign({}, base));   // 2本とも U39
    L.pick(0);
    return { rows: L.cxBreak(), total: L.cxTotal() };
  });
  chk('㉗ 食べられた回線が2本なら covered も2',
    (dup2.rows.filter((x) => x.id === 'a')[0] || {}).covered === 2,
    JSON.stringify(dup2.rows));
  chk('㉗ 2本とも細かい行で数える（150×2＝300）',
    dup2.total === 300, String(dup2.total));

  /* ---- ㉘ d払い初回利用・ひかりTV（2026-09-07・店舗の指定）----
   * d払い初回利用は、店頭のお支払い方法の「d払い」とは別の印。
   * 店頭でd払いを選んだだけで「初回」に数えてしまわないことも見る。 */
  const more3 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    const base = { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true };
    function keys(patch) {
      L.fill(0, Object.assign({}, base, patch));
      L.fill(1, {});
      L.pick(0);
      return Object.keys(L.items());
    }
    const on = keys({ dpayFirst: true });
    const off = keys({});
    // 店頭のお支払いで d払い を選んだだけでは数えない
    const storePayOnly = keys({ storePay: { dbarai: true } });
    const box = L.statMarks().some((m) => m.id === 'dpayFirst');
    L.fill(0, Object.assign({}, base, { dpayFirst: true }));
    L.pick(0);
    const sheet = T.std.sheetHtml() + '\n' + (T.std.staffHtml ? T.std.staffHtml() : '');
    // ひかりTV
    const tv = Object.keys(L.itemsRawIe({ enabled: true, product: 'hikari1g',
      applyType: 'shinki', opts: { vsHikariTv: true } }));
    const tvSlim = L.slimIe({ enabled: true, product: 'hikari1g', applyType: 'shinki',
      opts: { vsHikariTv: true } });
    const cat = L.cxCatalog();
    return { on, off, storePayOnly, box,
      sheetHasDpay: /d払い初回/.test(sheet),
      tv, tvSlim: (tvSlim.opts || {}).vsHikariTv === true,
      catDpay: cat['dpayfirst'] || '', catTv: cat['ie:opt:vsHikariTv'] || '' };
  });
  chk('㉘ 「d払い初回利用」のタイルがある', more3.box === true);
  chk('㉘ チェックすると数える',
    more3.on.indexOf('dpayfirst') >= 0, JSON.stringify(more3.on));
  chk('㉘ チェックしなければ数えない',
    more3.off.indexOf('dpayfirst') < 0, JSON.stringify(more3.off));
  chk('㉘ 店頭のお支払いで d払い を選んだだけでは数えない',
    more3.storePayOnly.indexOf('dpayfirst') < 0, JSON.stringify(more3.storePayOnly));
  chk('㉘ 実績の項目に「（再掲）d払い初回利用」が出る',
    /d払い初回利用/.test(more3.catDpay), more3.catDpay);
  chk('㉘ d払い初回利用はお客様の紙に出ない', more3.sheetHasDpay === false);
  chk('㉘ ひかりTV を選ぶと数える',
    more3.tv.indexOf('ie:opt:vsHikariTv') >= 0, JSON.stringify(more3.tv));
  chk('㉘ 保存を小さくしても ひかりTV の印は残る', more3.tvSlim === true);
  chk('㉘ 実績の項目に ひかりTV が出る',
    /ひかりTV/.test(more3.catTv), more3.catTv);

  /* ---- ㉙ 実績の印をタイルで押す（2026-09-07・店舗の指定）----
   * ④オプションの「その他」に移したので、実際に押して切り替わるか見る。
   * 下取りは2種類あるが、同時には立たない。 */
  const mk = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const plan = T.std.get().plans[0].id;
    L.fill(0, { planId: plan, procType: 'shinki', procTodo: { shinki: true },
      planChange: true, payMethod: 'ikkatsu', devicePrice: 50000 });
    L.fill(1, {});
    L.pick(0);
    function state() {
      const m = {};
      L.statMarks().forEach((x) => { m[x.id] = x.on; });
      return m;
    }
    const before = state();
    L.statMarkClick('dcardFirst');
    const afterCard = state();
    const keysCard = Object.keys(L.items());
    L.statMarkClick('shitadoriTarget');
    const afterTarget = state();
    L.statMarkClick('shitadoriOther');       // もう片方を押すと入れ替わる
    const afterOther = state();
    const keysOther = Object.keys(L.items());
    L.statMarkClick('shitadoriOther');       // もう一度押すと消える
    const afterOff = state();
    // お客様の紙に出ないこと
    L.statMarkClick('dpayFirst');
    L.statMarkClick('shitadoriTarget');
    const sheet = T.std.sheetHtml() + '\n' + (T.std.staffHtml ? T.std.staffHtml() : '');
    return { before, afterCard, afterTarget, afterOther, afterOff, keysCard, keysOther,
      sheetClean: !/下取り|初回利用/.test(sheet) };
  });
  chk('㉙ はじめはどれも立っていない',
    Object.keys(mk.before).every((k) => mk.before[k] === false), JSON.stringify(mk.before));
  chk('㉙ タイルを押すと立ち、実績に数える',
    mk.afterCard.dcardFirst === true && mk.keysCard.indexOf('dcardfirst') >= 0,
    JSON.stringify(mk.afterCard) + ' / ' + JSON.stringify(mk.keysCard));
  chk('㉙ 下取りは指定機種を押すと立つ',
    mk.afterTarget.shitadoriTarget === true && mk.afterTarget.shitadoriOther === false,
    JSON.stringify(mk.afterTarget));
  chk('㉙ もう片方を押すと入れ替わる（同時には立たない）',
    mk.afterOther.shitadoriOther === true && mk.afterOther.shitadoriTarget === false
    && mk.keysOther.indexOf('shitadori:other') >= 0
    && mk.keysOther.indexOf('shitadori:target') < 0,
    JSON.stringify(mk.afterOther) + ' / ' + JSON.stringify(mk.keysOther));
  chk('㉙ もう一度押すと消える',
    mk.afterOff.shitadoriOther === false && mk.afterOff.shitadoriTarget === false,
    JSON.stringify(mk.afterOff));
  chk('㉙ 押してもお客様の紙には出ない', mk.sheetClean === true);

  /* あんしん遠隔サポートは「その他」に置く（店舗の指定・2026-09-07）。
   * 「サポート」という中身1つのタブを作ってしまっていたのを直した。 */
  const cats = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const m = T.std.get();
    const byName = {};
    (m.options || []).forEach((o) => { byName[o.name] = o.category || 'その他'; });
    return { enkaku: byName['あんしん遠隔サポート'],
      soloCats: Object.keys(byName).reduce((acc, n) => {
        acc[byName[n]] = (acc[byName[n]] || 0) + 1; return acc;
      }, {}) };
  });
  chk('㉙ あんしん遠隔サポートは「その他」に入っている',
    cats.enkaku === 'その他', String(cats.enkaku));
  /* あんしん遠隔サポートのために「サポート」というタブを作ってしまっていた。
   * 中身1つのタブが増えないよう、そのタブ自体が無いことを見る。
   * （「バックアップ」は以前からある1つだけのタブなので、ここでは触らない） */
  chk('㉙ 「サポート」というタブを作っていない',
    !cats.soloCats['サポート'], JSON.stringify(cats.soloCats));

  /* ---- ㉚ 当日の古い保存の「成約」を押したとき（2026-09-08・店舗からの指摘）----
   * 画面に別のお客様の見積もりが開いたまま、古い保存の「成約」を押すと、
   * 画面のほう（直近に保存したお客様）の内容が成約として記録されていた。 */
  const won = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    const m = T.std.get();
    S.clear();
    // お客様A: ドコモMAX を1本（先に保存する＝当日の古いほう）
    L.fill(0, { planId: 'max', procType: 'mnp', procTodo: { mnp: true }, planChange: true });
    L.fill(1, {});
    L.pick(0);
    const a = S.save('お客様A');
    // お客様B: ポイ活MAX を1本（あとから保存＝直近）
    L.fill(0, { planId: 'poikatsu_max', procType: 'shinki', procTodo: { shinki: true },
      planChange: true });
    L.pick(0);
    const b = S.save('お客様B');
    const srcAfterB = S.srcId();
    // ここで A の「成約」を押す（画面には B が開いたまま）
    const wonA = S.won(a.id, true);      // OK を押した場合
    // B の成約は、画面の続きなので画面の内容でよい
    const wonB = S.won(b.id, true);
    return { aId: a.id, bId: b.id, srcAfterB: srcAfterB,
      wonAItems: Object.keys(wonA.items), wonAUsedCurrent: wonA.usedCurrent,
      wonBItems: Object.keys(wonB.items), wonBUsedCurrent: wonB.usedCurrent };
  });
  chk('㉚ 保存した直後は、画面の見積もりがその保存の続きになっている',
    won.srcAfterB === won.bId, won.srcAfterB + ' / ' + won.bId);
  chk('㉚ 古い保存（お客様A）の成約に、画面のお客様Bの内容が入らない',
    won.wonAItems.indexOf('plan:poikatsu_max') < 0, JSON.stringify(won.wonAItems));
  chk('㉚ 古い保存（お客様A）は、保存したときの内容（ドコモMAX・のりかえ）で数える',
    won.wonAItems.indexOf('plan:max') >= 0 && won.wonAItems.indexOf('proc:mnp') >= 0,
    JSON.stringify(won.wonAItems));
  chk('㉚ 古い保存では、画面の内容を成約内容として持たない',
    won.wonAUsedCurrent === false, String(won.wonAUsedCurrent));
  chk('㉚ 画面の続きである保存（お客様B）は、これまでどおり画面の内容で記録できる',
    won.wonBUsedCurrent === true
    && won.wonBItems.indexOf('plan:poikatsu_max') >= 0, JSON.stringify(won.wonBItems));

  /* ---- ㉛ アプリを開き直しても、成約の紐づけが切れない（2026-09-08）----
   * propSrcId を画面の中だけに持っていたため、iPad がスリープから戻ると
   * 「別の見積もりです」と言われ、店頭で最後に直した内容を残せなかった。 */
  const re = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    S.clear();
    L.fill(0, { planId: 'max', procType: 'mnp', procTodo: { mnp: true }, planChange: true });
    L.fill(1, {});
    L.pick(0);
    const it = S.save('お客様');
    const before = S.srcId();
    // 店頭で最後に1つ直す（保存は押さない）
    L.fill(0, { planId: 'poikatsu_max', procType: 'mnp', procTodo: { mnp: true },
      planChange: true });
    L.pick(0);
    // ここでアプリを開き直す
    const after = S.reopen();
    const w = S.won(it.id, true);      // 画面の内容で記録する（OK）
    return { id: it.id, before, after, usedCurrent: w.usedCurrent,
      items: Object.keys(w.items) };
  });
  chk('㉛ 開き直しても、どの保存の続きかを覚えている',
    re.after === re.id, re.after + ' / ' + re.id);
  chk('㉛ 開き直したあとでも、画面の内容を成約として記録できる',
    re.usedCurrent === true && re.items.indexOf('plan:poikatsu_max') >= 0,
    String(re.usedCurrent) + ' / ' + JSON.stringify(re.items));

  /* ---- ㉜ 記録済みの見積もりを開いて、別のお客様に直したとき（2026-09-08）----
   * 「開く」で読んだ記録済みの保存に、次のお客様の内容を書き込んでしまい、
   * 前のお客様の成約内容がすり替わって、新しいお客様は1件も数えられなかった。 */
  const ov = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    S.clear();
    // お客様A: ドコモMAX・のりかえ → 保存して成約
    L.fill(0, { planId: 'max', procType: 'mnp', procTodo: { mnp: true }, planChange: true });
    L.fill(1, {});
    L.pick(0);
    const a = S.save('お客様A');
    S.won(a.id, false);                    // 保存したときの内容で成約
    // 後日、お客様Aの見積もりを「開く」→ お客様B用に直す
    S.open(a.id);
    L.fill(0, { planId: 'poikatsu_max', procType: 'shinki', procTodo: { shinki: true },
      planChange: true });
    L.pick(0);
    const nAfterOpen = S.count();
    // 見積もり画面の「⋯→成約」を押す
    const nAfterWon = S.recordWon();
    const list = S.list();
    const aItem = list.filter((x) => x.id === a.id)[0] || {};
    const other = list.filter((x) => x.id !== a.id)[0] || null;
    return {
      nAfterOpen, nAfterWon,
      aPlan: ((((aItem.wonData || aItem.data) || {}).patterns || [{}])[0] || {}).planId,
      newMade: !!other,
      newPlan: other ? (((other.wonData || other.data || {}).patterns || [{}])[0] || {}).planId : ''
    };
  });
  chk('㉜ 記録済みを開いて直したときは、新しい1件として増える',
    ov.nAfterWon === ov.nAfterOpen + 1, ov.nAfterOpen + ' → ' + ov.nAfterWon);
  chk('㉜ お客様Aの成約内容が、お客様Bの内容にすり替わらない',
    ov.aPlan === 'max', String(ov.aPlan));
  chk('㉜ お客様Bはお客様Bの内容で数える',
    ov.newMade === true && ov.newPlan === 'poikatsu_max',
    String(ov.newMade) + ' / ' + String(ov.newPlan));

  /* ---- ㉝ 成約を記録したあとに「保存」を押しても、2件に増えない（2026-09-08）---- */
  const dupSave = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    S.clear();
    L.fill(0, { planId: 'max', procType: 'kishu', procTodo: { kishu: true }, planChange: true });
    L.fill(1, {});
    L.pick(0);
    const n0 = S.recordWon();          // 保存せずに「⋯→成約」
    /* そのあと「保存」を押す（名前は変えない＝ふつうの押し方）。
     * 名前を変えて保存したときは、別の1件にするのが元からの動き。 */
    S.save('');
    const n1 = S.count();
    const list = S.list();
    return { n0, n1, result: (list[0] || {}).result, name: (list[0] || {}).name };
  });
  chk('㉝ 成約のあとに保存しても、同じお客様が2件にならない',
    dupSave.n1 === dupSave.n0 && dupSave.n0 === 1,
    dupSave.n0 + ' → ' + dupSave.n1);
  chk('㉝ 保存し直しても、成約の印は消えない',
    dupSave.result === 'won', String(dupSave.result));

  /* ---- ㉞ id の書いていないポイントのファイルを読み込む（2026-09-08）----
   * 以前は id が全部同じになり、2行目以降が1行目の場所に当たって
   * お店が入れた点数の設定が黙って消えていた。 */
  const imp2 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    /* お店に既に行がある状態（「実績の項目から一気に作る」で作った形）。
     * ここへ id の書いていないファイルを読み込むと、全部が「差し替え」になる。
     * 以前は差し替えのあいだ id の番号が増えず、3行とも同じ id になっていた。 */
    L.cxSet([
      { id: 'keep1', name: '手で足した行1', pt: 10, keys: ['proc:shinki'] },
      { id: 'keep2', name: '手で足した行2', pt: 20, keys: ['proc:mnp'] },
      { id: 'old1', name: '前の名前A', pt: 1, keys: ['proc:kishu'] },
      { id: 'old2', name: '前の名前B', pt: 1, keys: ['u39'] },
      { id: 'old3', name: '前の名前C', pt: 1, keys: ['tablet'] }
    ]);
    // id を書いていない3行（本部から配られたファイルを想定）
    const res = L.cxImport([
      { name: '新しい行A', pt: 5, keys: ['proc:kishu'] },
      { name: '新しい行B', pt: 6, keys: ['u39'] },
      { name: '新しい行C', pt: 7, keys: ['tablet'] }
    ]);
    const rows = L.cxRowsNow();
    return { res: res, names: rows.map((r) => r.name), pts: rows.map((r) => r.pt),
      ids: rows.map((r) => r.id), uniq: new Set(rows.map((r) => r.id)).size };
  });
  chk('㉞ 3行とも差し替わる（潰れない）',
    imp2.res.updated === 3 && imp2.res.added === 0, JSON.stringify(imp2.res));
  chk('㉞ 差し替えたあとも行が5つのまま（減らない）',
    imp2.names.length === 5, imp2.names.length + ' / ' + JSON.stringify(imp2.names));
  chk('㉞ 点数も3行ぶんそろう（5・6・7）',
    [5, 6, 7].every((v) => imp2.pts.indexOf(v) >= 0), JSON.stringify(imp2.pts));
  chk('㉞ 手で足した行が消えない',
    imp2.names.indexOf('手で足した行1') >= 0 && imp2.names.indexOf('手で足した行2') >= 0,
    JSON.stringify(imp2.names));
  chk('㉞ 読み込んだ3行が全部そろう',
    ['新しい行A', '新しい行B', '新しい行C'].every((n) => imp2.names.indexOf(n) >= 0),
    JSON.stringify(imp2.names));
  chk('㉞ id が重ならない',
    imp2.uniq === imp2.ids.length, JSON.stringify(imp2.ids));

  /* ---- ㉟ タイプCの光と、商材を変えたときの取りこぼし（2026-09-08）---- */
  const tc = await page.evaluate(() => {
    const L = window.__KQ_TEST__.lines;
    return {
      // タイプC（1ギガ・10ギガ）が、英語の内部名でなく日本語で数えられるか
      c1: L.itemsRawIe({ enabled: true, product: 'hikaric', applyType: 'kirikae' }),
      c10: L.itemsRawIe({ enabled: true, product: 'hikaric10g', applyType: 'kirikae' }),
      // 商材を home 5G に変えたのに、光だけのオプション・プロバイダが残っている場合
      moved: L.itemsRawIe({ enabled: true, product: 'home5g', h5Kubun: 'shinki',
        provider: 'OCN インターネット', opts: { tv: true, denwa: true, homeDenwaLight: true } }),
      // ふつうの光では、これまでどおり数える
      normal: L.itemsRawIe({ enabled: true, product: 'hikari1g', applyType: 'shinki',
        provider: 'OCN インターネット', opts: { tv: true } })
    };
  });
  const k1 = Object.keys(tc.c1), k10 = Object.keys(tc.c10);
  chk('㉟ タイプC（1ギガ）は「光 1ギガ」として数える（英語の内部名にしない）',
    k1.some((k) => k.indexOf('ie:1g') === 0) && !k1.some((k) => /hikaric/.test(k)),
    JSON.stringify(tc.c1));
  chk('㉟ タイプC（10ギガ）は「光 10ギガ」として数える',
    k10.some((k) => k.indexOf('ie:10g') === 0) && !k10.some((k) => /hikaric/.test(k)),
    JSON.stringify(tc.c10));
  const km = Object.keys(tc.moved);
  chk('㉟ home 5G に変えたら、光だけのオプションは数えない',
    km.indexOf('ie:opt:tv') < 0 && km.indexOf('ie:opt:denwa') < 0, JSON.stringify(km));
  chk('㉟ home 5G でも選べる homeでんわ は、これまでどおり数える',
    km.indexOf('ie:opt:homeDenwaLight') >= 0, JSON.stringify(km));
  chk('㉟ home 5G ではプロバイダを数えない（欄が出ない商材のため）',
    km.indexOf('ie:prov:ocn') < 0, JSON.stringify(km));
  const kn = Object.keys(tc.normal);
  chk('㉟ ふつうの光では、テレビもプロバイダもこれまでどおり数える',
    kn.indexOf('ie:opt:tv') >= 0 && kn.indexOf('ie:prov:ocn') >= 0, JSON.stringify(kn));

  /* ---- ㊱ 出さない選択肢は一覧そのものから外す（2026-09-08）----
   * option の hidden は iPhone・iPad の Safari が無視する（2026-09-06 の事故）。
   * 光・5Gの商材・申込区分・住居に、その書き方が残っていた。 */
  const sel = await page.evaluate(() => {
    const L = window.__KQ_TEST__.lines;
    return {
      // タイプCのとき、フレッツ転用・事業者変更は一覧から消える
      applyOnC: L.ieSelectOpts('ieApplyType', 'hikaric'),
      applyOnNormal: L.ieSelectOpts('ieApplyType', 'hikari1g'),
      // タイプC（1ギガ）は戸建てだけ。マンションは一覧から消える
      housingOnC: L.ieSelectOpts('ieHousing', 'hikaric'),
      housingOnNormal: L.ieSelectOpts('ieHousing', 'hikari1g'),
      product: L.ieSelectOpts('ieProduct', 'hikari1g')
    };
  });
  chk('㊱ タイプCでは、転用・事業者変更が一覧から消える',
    sel.applyOnC.values.indexOf('tenyo') < 0 && sel.applyOnC.values.indexOf('jigyosha') < 0,
    JSON.stringify(sel.applyOnC.values));
  chk('㊱ ふつうの光では、転用・事業者変更が出る',
    sel.applyOnNormal.values.indexOf('tenyo') >= 0
    && sel.applyOnNormal.values.indexOf('jigyosha') >= 0,
    JSON.stringify(sel.applyOnNormal.values));
  chk('㊱ タイプC（1ギガ）では、マンションが一覧から消える',
    sel.housingOnC.values.indexOf('ms') < 0, JSON.stringify(sel.housingOnC.values));
  chk('㊱ ふつうの光では、マンションが出る',
    sel.housingOnNormal.values.indexOf('ms') >= 0,
    JSON.stringify(sel.housingOnNormal.values));
  chk('㊱ hidden や disabled で隠している選択肢が残っていない',
    ['applyOnC', 'applyOnNormal', 'housingOnC', 'housingOnNormal', 'product']
      .every((k) => sel[k] && sel[k].hiddenOnes.length === 0),
    JSON.stringify(Object.keys(sel).map((k) => [k, sel[k] && sel[k].hiddenOnes])));

  /* ---- ㊲ 見積もりなしの成約にもポイントが付く（2026-09-08）----
   * 実績の件数には出るのに、ポイントだけ1点も付いていなかった。 */
  const nq = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    S.clear();
    L.cxSet([
      { id: 'k', name: '機種変更', pt: 12, keys: ['proc:kishu'] },
      { id: 'g', name: 'dカード GOLD', pt: 40, keys: ['dcard:gold'] }
    ]);
    // 機種変更 2件・dカード GOLD 1件を「見積もりなしの成約」で記録
    S.addNoQuote({ 'proc:kishu': 2, 'dcard:gold': 1 });
    const r = S.cxTotalSaved();
    return { total: r.total, rows: r.rows };
  });
  chk('㊲ 見積もりなしの成約にもポイントが付く（12×2＋40＝64）',
    nq.total === 64, String(nq.total) + ' / ' + JSON.stringify(nq.rows));
  chk('㊲ 件数も項目ごとに数える（機種変更2件）',
    (nq.rows.k || {}).n === 2, JSON.stringify(nq.rows.k));

  /* ---- ㊳ 残りの見直し3件（2026-09-08）---- */
  const rest = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    // dカード・でんきを「まとめて1行」にしたときの並び
    const one = S.orderOf(['proc:kishu', 'dcard', 'denki', 'gas', 'opt:x', 'acc:y']);
    // 「保存したときの内容のまま成約」でも、数えた回線の案内が出るか
    S.clear();
    L.fill(0, { planId: 'max', procType: 'kishu', procTodo: { kishu: true }, planChange: true });
    L.fill(1, { planId: 'max', procType: 'kishu', procTodo: { kishu: true }, planChange: true });
    L.pick(0);
    const it = S.save('2回線のお客様');
    S.wonLines(it.id, [0]);          // 回線1だけ数える／保存したときの内容のまま
    const txt = S.listText();
    return { one: one, note: /実績に数えた回線/.test(txt), txt: txt.slice(0, 200) };
  });
  chk('㊳ dカード・でんきを「まとめて1行」にしても、表の最後に落ちない',
    rest.one.indexOf('dcard') < rest.one.indexOf('opt:x')
    && rest.one.indexOf('denki') < rest.one.indexOf('opt:x')
    && rest.one.indexOf('dcard') < rest.one.indexOf('acc:y'),
    JSON.stringify(rest.one));
  chk('㊳ 「保存したときの内容のまま成約」でも、数えた回線の案内が出る',
    rest.note === true, rest.txt);

  /* ---- ㊴ 実績の「ご来店目的別」を表にする（2026-09-08・店舗の指定）----
   * 成約・成約率の列はいらない。獲得した項目は文字の羅列ではなく列で出す。 */
  const vp = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    S.clear();
    // 来店目的「端末購入」で、機種変更のお客様を1人（成約まで）
    L.fill(0, { planId: 'max', procType: 'kishu', procTodo: { kishu: true },
      planChange: true, visitPurposes: { buy: true } });
    L.fill(1, {});
    L.pick(0);
    const a = S.save('お客様A');
    S.won(a.id, false);
    return S.visitTable();
  });
  chk('㊴ 見出しが「ご来店目的別」になっている',
    vp.found === true && /ご来店目的別/.test(vp.title), vp.title);
  chk('㊴ 「成約」「成約率」の列を出さない',
    vp.cols.indexOf('成約') < 0 && vp.cols.indexOf('成約率') < 0, JSON.stringify(vp.cols));
  chk('㊴ 「目的」「応対」の列は残す',
    vp.cols[0] === '目的' && vp.cols[1] === '応対', JSON.stringify(vp.cols));
  chk('㊴ 獲得した項目が、それぞれの列になっている',
    vp.cols.length > 2 && vp.cols.some((c) => /機種変更/.test(c)), JSON.stringify(vp.cols));
  chk('㊴ 件数が数字で入っている（文字の羅列ではない）',
    vp.rows.some((r) => r[0] === '端末購入' && r.slice(2).some((c) => c === '1')),
    JSON.stringify(vp.rows));
  chk('㊴ 合計の行が出る', vp.rows.some((r) => r[0] === '合計'), JSON.stringify(vp.rows));

  /* ---- ㊵ クリアを「この回線」と「全回線」に分ける／引き継ぎタブの回線切り替え
   *      （2026-09-08・店舗からの要望）----
   *   ・「入力をクリア」が全回線をまとめて消すものしか無く、
   *     見比べ用に作った1本だけを作り直したいときに、ほかの回線まで消えていた
   *   ・引き継ぎシートは回線ごとの内容なのに、回線の切り替えが
   *     見積もり・見積書のタブにしか無かった
   *   実際に画面のボタンを押して確かめる（内部の関数を直接呼ばない）。 */
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => d.accept());
  const clr = await page.evaluate(() => {
    const L = window.__KQ_TEST__.lines;
    const val = (id) => { const e = document.getElementById(id); return e ? e.value : '(欄なし)'; };
    const out = {};
    out.staffTabs = L.staffTabs();
    // 回線1・回線2に中身を入れて、回線1を開く
    L.fill(0, { planId: 'max', procType: 'kishu', custName: 'あんどう' });
    L.fill(1, { planId: 'mini', procType: 'shinki', custName: 'いとう' });
    L.pick(0);
    L.clearOne(true);                 // 回線のバーの「この回線をクリア」
    out.afterOne1 = val('planId');
    L.pick(1);
    out.afterOne2 = val('planId');
    out.afterOne2Cust = val('custName');
    // 下の並びの「この回線をクリア」でも同じこと（いま開いているのは回線2）
    L.clearOne(false);
    out.afterOneBottom2 = val('planId');
    // 全回線をクリア
    L.fill(0, { planId: 'max', procType: 'kishu' });
    L.fill(1, { planId: 'mini', procType: 'shinki' });
    L.pick(0);
    L.clearAll(false);
    L.pick(1); out.afterAll2 = val('planId');
    L.pick(0); out.afterAll1 = val('planId');
    return out;
  });
  chk('㊵ 引き継ぎタブに回線1〜5の切り替えボタンが出る',
    clr.staffTabs.length === 5 && clr.staffTabs[0] === '回線1' && clr.staffTabs[4] === '回線5',
    JSON.stringify(clr.staffTabs));
  chk('㊵ 「この回線をクリア」で、開いている回線だけが消える',
    clr.afterOne1 === '', '回線1のプラン=' + clr.afterOne1);
  chk('㊵ 「この回線をクリア」で、ほかの回線は残る',
    clr.afterOne2 === 'mini' && clr.afterOne2Cust === 'いとう',
    '回線2のプラン=' + clr.afterOne2 + ' 名前=' + clr.afterOne2Cust);
  chk('㊵ 下の並びの「この回線をクリア」も同じように効く',
    clr.afterOneBottom2 === '', '回線2のプラン=' + clr.afterOneBottom2);
  chk('㊵ 「全回線をクリア」は回線1も回線2も消す',
    clr.afterAll1 === '' && clr.afterAll2 === '',
    '回線1=' + clr.afterAll1 + ' 回線2=' + clr.afterAll2);

  // 引き継ぎタブで回線を切り替えると、シートの中身も切り替わる
  const stf = await page.evaluate(() => {
    const L = window.__KQ_TEST__.lines;
    L.fill(0, { planId: 'max', procType: 'kishu' });
    L.fill(1, { planId: 'mini', procType: 'shinki' });
    L.pick(0);
    document.querySelector('.tab[data-tab="staff"]').click();
    const body = () => (document.getElementById('staffSheetBody').innerText || '');
    const t1 = body(); const a1 = L.activeTabOf('staff');
    const b2 = document.querySelector('#tab-staff .pat[data-pat="1"]');
    if (!b2) { document.querySelector('.tab[data-tab="quote"]').click();
      return { t1: t1, t2: '', a1: a1, a2: '', missing: true }; }
    b2.click();
    const t2 = body(); const a2 = L.activeTabOf('staff');
    document.querySelector('.tab[data-tab="quote"]').click();
    return { t1, t2, a1, a2 };
  });
  chk('㊵ 引き継ぎタブの回線ボタンで、選ばれている回線が変わる',
    stf.a1 === '回線1' && stf.a2 === '回線2', stf.a1 + ' → ' + stf.a2);
  chk('㊵ 引き継ぎシートの中身が、切り替えた回線のものに変わる',
    stf.t1.indexOf('ドコモ MAX') >= 0 && stf.t2.indexOf('ドコモ mini') >= 0
      && stf.t1 !== stf.t2,
    '回線1に「ドコモ MAX」=' + (stf.t1.indexOf('ドコモ MAX') >= 0)
      + ' / 回線2に「ドコモ mini」=' + (stf.t2.indexOf('ドコモ mini') >= 0));

  /* ---- ㊶ 2026-09-08 の全体デバッグで見つかった、実績と保存の重い不具合 ----
   *   #1  開き直すと「どの保存の続きか」が毎回消え、成約で保存が2件に増える
   *   #4  成約の確認画面を出している間に同期が届くと、押した成約が消える
   *   #9  回線2以降でU39・U15の欄が出ないのに、実績では数えていた
   *   #20 4〜5回線だと保存が41〜55件で頭打ちになり、古い見積もりが黙って消える
   *   #21 1回線だけの見積もりで「自動控え」が二重にできる
   * 内部の値ではなく、**本物の再読み込み**と**画面に出ている件数**で見る。 */

  // --- #1 本物の再読み込みを挟む（S.reopen() では enterStaff を通らず素通りする）
  const beforeReload = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.saved.clear();
    T.lines.fill(0, { planId: 'max', procType: 'kishu', devicePrice: 100000 });
    T.lines.pick(0);
    const a = T.saved.save('再読み込みの検査');
    return { id: a.id, srcId: T.saved.srcId(), stored: !!T.saved.propStored(), count: T.saved.count() };
  });
  await page.reload();
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.saved, null, { timeout: 20000 });
  const afterReload = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    return { srcId: T.saved.srcId(), stored: !!T.saved.propStored(), count: T.saved.count() };
  });
  const afterWon = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const n = T.saved.recordWon();
    const list = T.saved.list ? T.saved.list() : null;
    return { count: n, wonCount: (list || []).filter((x) => x.result === 'won').length };
  });
  chk('㊶ 保存した直後は「どの保存の続きか」を覚えている',
    beforeReload.srcId === beforeReload.id && beforeReload.stored,
    'srcId=' + beforeReload.srcId + ' 端末に残った=' + beforeReload.stored);
  chk('㊶ アプリを開き直しても、その覚えが消えない',
    afterReload.srcId === beforeReload.id && afterReload.stored,
    'srcId=' + afterReload.srcId + ' 端末に残った=' + afterReload.stored);
  chk('㊶ 開き直したあと成約を押しても、保存は1件のまま（2件に増えない）',
    afterWon.count === 1, '保存件数=' + afterWon.count);
  chk('㊶ その1件が成約になっている',
    afterWon.wonCount === 1, '成約の件数=' + afterWon.wonCount);

  // --- #21 1回線だけの見積もりで、自動控えが二重にできない
  const stash1 = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.saved.clear();
    T.lines.fill(0, { planId: 'max', procType: 'kishu', devicePrice: 100000 });
    for (let i = 1; i < 5; i++) T.lines.fill(i, {});
    T.lines.pick(0);
    T.saved.save('1回線だけ');
    T.sync.newCustomer();           // 「新しいお客様として始める」と同じ流れ
    return { count: T.saved.count(), autos: T.sync.autoNames() };
  });
  chk('㊶ 1回線だけの見積もりを保存したあと次のお客様に移っても、自動控えが増えない',
    stash1.count === 1 && stash1.autos.length === 0,
    '保存件数=' + stash1.count + ' 自動控え=' + JSON.stringify(stash1.autos));

  // --- #4 確認画面を出している間に同期が届いても、押した成約が消えない
  const wonSync = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.saved.clear();
    T.lines.fill(0, { planId: 'max', procType: 'kishu' });
    T.lines.pick(0);
    const a = T.saved.save('同期が割り込む検査');
    return T.saved.wonWithSync(a.id);
  });
  chk('㊶ 成約の確認中に同期が届いても、押した成約が記録される',
    wonSync.result === 'won', '結果=' + JSON.stringify(wonSync));

  // --- #9 回線2以降でもU39・U15の欄が出る（回線1の手続きを引き継ぐ）
  const u = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.saved.clear();
    T.lines.fill(0, { planId: 'max', procType: 'shinki', procTodo: { shinki: true } });
    T.lines.fill(1, { planId: 'mini' });          // 回線2は手続きを選び直していない
    T.lines.pick(1);
    const line2 = T.saved.u15u39();
    T.lines.fill(0, { planId: 'max', procType: 'kishu', procTodo: { kishu: true } });
    T.lines.pick(1);
    const line2kishu = T.saved.u15u39();
    T.lines.pick(0);
    return { line2, line2kishu };
  });
  chk('㊶ 回線1が新規なら、回線2でもU39・U15の欄が出る',
    u.line2.u39 === true && u.line2.u15 === true, JSON.stringify(u.line2));
  chk('㊶ 回線1が機種変更なら、回線2でも欄は出ない（出し分けを壊していない）',
    u.line2kishu.u39 === false && u.line2kishu.u15 === false, JSON.stringify(u.line2kishu));

  // --- #20 4〜5回線の見積もりをたくさん保存しても、件数が減らない
  const bulk = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.saved.clear();
    /* ご家族4〜5回線＋オプション・アクセサリ・追加項目まで入った、実際にありうる
     * 重さの見積もり。1件あたり約16,000字で、48件ほどで送信の上限(780,000字)に届く。
     * 上限より前に「軽くする（slim）」が働かないと、ここで古いものが消え始める。 */
    const heavy = {
      planId: 'max', procType: 'kishu', devicePrice: 130000,
      deviceName: 'テスト機種ABCDEFG', custName: 'テストのお客様',
      options: { smart_hosho: true, anshin_pack: true, netflix: true },
      optionKubun: { smart_hosho: 'new', anshin_pack: 'new', netflix: 'new' },
      procTodo: { kishu: true }, visitPurposes: { buy: true },
      adhocMonthly: Array.from({ length: 8 }, (_, i) => ({ name: '追加項目のテスト' + i, amount: 1100, months: 12 })),
      adhocInitial: Array.from({ length: 8 }, (_, i) => ({ name: '初期費用のテスト' + i, amount: 3300 })),
      accessories: Array.from({ length: 8 }, (_, i) => ({ name: 'アクセサリのテスト' + i, price: 5500, pay: 'once' })),
      quoteMemo: 'あ'.repeat(200), todoOther: 'い'.repeat(200)
    };
    const n = T.saved.bulk(70, heavy);
    return { count: n, sizes: T.saved.sizes() };
  });
  chk('㊶ 5回線の重い見積もりを70件保存しても、保存が減らない（古いものが黙って消えない）',
    bulk.count === 70, '保存件数=' + bulk.count + '（70件のはず）／' + JSON.stringify(bulk.sizes));
  chk('㊶ そのとき、古いものは「捨てる」のではなく「軽くする」で収めている',
    bulk.sizes.slim > 0 && bulk.sizes.total <= bulk.sizes.limit,
    JSON.stringify(bulk.sizes));

  /* ---- ㊷ お客様に見せる金額に関わる不具合（2026-09-08）----
   *   #23 LIBMO でドコモの通話オプションが「プランに込み 0円」と出て、見積書にも載る
   *   #24 ahamo で「旧」（770円・1,870円）が選べる。ahamo にその金額の通話オプションは無い
   *   #26 「かけ放題オプション(1000) 1,100円」がどのプランでも選べ、ドコモ MAX で 880円 安く出る
   *   #53 料金マスタに「ドコモメール」が無く、ahamo・mini・irumo でメールの欄が出ない
   *   #25 LIBMO なのに「みんなドコモ割（回線数のカウントには含まれます）」と案内される
   * 見るのは内部の設定ではなく、**画面のタイルに出ている文字**。 */
  const money = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.saved;
    function pick(pid) {
      const t = document.getElementById('procType');
      if (t) { t.value = 'mnp'; t.dispatchEvent(new Event('change', { bubbles: true })); }
      const grp = document.getElementById('planGroup');
      const sel = document.getElementById('planId');
      if (!Array.prototype.some.call(sel.options, (o) => o.value === pid) && grp) {
        for (const g of grp.options) {
          grp.value = g.value; grp.dispatchEvent(new Event('change', { bubbles: true }));
          if (Array.prototype.some.call(sel.options, (o) => o.value === pid)) break;
        }
      }
      if (!Array.prototype.some.call(sel.options, (o) => o.value === pid)) return null;
      sel.value = pid; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { tiles: S.voiceTiles(), mail: S.mailField(), off: S.discountOff() };
    }
    const out = {};
    ['max', 'mini', 'ahamo', 'ahamo_poikatsu', 'irumo', 'libmo_gogo', 'libmo_nattoku'].forEach((p) => {
      out[p] = pick(p);
    });
    return out;
  });
  const joined = (p) => (money[p] ? money[p].tiles.join(' ／ ') : '(プランが出ない)');
  chk('㊷「かけ放題オプション(1000)」がどのプランにも出ない（ドコモ MAX で880円安く出ない）',
    ['max', 'mini', 'ahamo', 'irumo'].every((p) => money[p] && !/\(1000\)/.test(joined(p))),
    ['max', 'mini', 'ahamo', 'irumo'].map((p) => p + ': ' + joined(p)).join(' / '));
  chk('㊷ ahamo・ahamo ポイ活で「旧」（770円・1,870円）が出ない',
    ['ahamo', 'ahamo_poikatsu'].every((p) => money[p]
      && !/770円/.test(joined(p)) && !/1,870円/.test(joined(p))),
    ['ahamo', 'ahamo_poikatsu'].map((p) => p + ': ' + joined(p)).join(' / '));
  chk('㊷ ahamo のかけ放題は 1,100円のまま（正しい金額は消していない）',
    money.ahamo && /1,100円/.test(joined('ahamo')), joined('ahamo'));
  chk('㊷ ドコモ MAX のかけ放題は 1,980円のまま',
    money.max && /1,980円/.test(joined('max')), joined('max'));
  chk('㊷ LIBMO では、ドコモの通話オプションを1つも出さない（「プランに込み」と言わない）',
    ['libmo_gogo', 'libmo_nattoku'].every((p) => money[p]
      && money[p].tiles.length === 1 && /通話オプションなし/.test(money[p].tiles[0])),
    ['libmo_gogo', 'libmo_nattoku'].map((p) => p + ': ' + joined(p)).join(' / '));
  chk('㊷ ahamo・ドコモ mini・irumo で、ドコモメールの欄が 330円 で出る',
    ['ahamo', 'ahamo_poikatsu', 'mini', 'irumo'].every((p) => money[p]
      && money[p].mail.shown && /330円/.test(money[p].mail.text)),
    ['ahamo', 'ahamo_poikatsu', 'mini', 'irumo']
      .map((p) => p + ': ' + (money[p] ? JSON.stringify(money[p].mail) : '?')).join(' / '));
  chk('㊷ ドコモ MAX ではメールの欄を出さない（標準で込みのため）',
    money.max && money.max.mail.shown === false, JSON.stringify(money.max && money.max.mail));
  chk('㊷ LIBMO では「みんなドコモ割（回線数のカウントには含まれます）」と言わない',
    ['libmo_gogo', 'libmo_nattoku'].every((p) => money[p]
      && !/回線数のカウントには含まれます/.test(money[p].off)),
    ['libmo_gogo', 'libmo_nattoku'].map((p) => p + ': ' + (money[p] ? money[p].off : '?')).join(' / '));

  /* ---- ㊸ お客様にお渡しする紙まわり（2026-09-08）----
   *   #45 3枚組で印刷すると、3枚目（光の別紙）だけ店舗名・担当者・電話番号が違う
   *   #46 ①〜⑨のカードを並べ替えると、画面のヒントの丸数字が古いまま
   *   #36 成約の確認画面の回線一覧に、内部名「plan_only」がそのまま出る */
  const sign = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.saved;
    T.lines.fill(0, { planId: 'max', procType: 'kishu', devicePrice: 100000,
      shopName: 'テスト店A', staffName: '山田', shopTel: '06-0000-0000' });
    T.lines.pick(0);
    S.ieOn('hikari1g');            // 光を「見積もりに含める」（3枚目が出る条件）
    S.scope('hikari');
    const three = S.signs();
    S.scope('phone');
    const one = S.signs();
    return { three: three, one: one };
  });
  chk('㊸ 見積書の発行元に、⑨で書き換えた店舗名・担当者・電話番号が出る',
    sign.one.length > 0 && /テスト店A/.test(sign.one[0]) && /山田/.test(sign.one[0])
      && /06-0000-0000/.test(sign.one[0]), JSON.stringify(sign.one));
  chk('㊸ 3枚組にしても、どのページも同じ発行元になる',
    sign.three.length > 0 && sign.three.every((t) => /テスト店A/.test(t) && /山田/.test(t)),
    JSON.stringify(sign.three));

  /* 内部の印の数ではなく、**実際に並べ替えて画面の文字が変わるか**で見る。
   * ④オプションを先頭へ動かすと、④は①になる。説明文の中の「④オプション」も
   * 「①オプション」に変わっていなければ、別のカードを指してしまう。 */
  const circ = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.saved;
    const before = S.reorderCards(null);          // 既定の並び
    const after = S.reorderCards(['c4', 'c1', 'c2', 'c3', 'c5', 'c6', 'c7', 'c8', 'c9']);
    const back = S.reorderCards(null);            // 元に戻す
    return { before: before, after: after, back: back };
  });
  const hasMaru4Before = circ.before.filter((t) => /④オプション/.test(t));
  const stillMaru4 = circ.after.filter((t) => /④オプション/.test(t));
  chk('㊸ 既定の並びでは、説明文が「④オプション」を指している',
    hasMaru4Before.length > 0, JSON.stringify(circ.before).slice(0, 200));
  chk('㊸ ④を先頭へ動かすと、説明文の丸数字も「①オプション」に変わる',
    stillMaru4.length === 0 && circ.after.some((t) => /①オプション/.test(t)),
    '残った④=' + JSON.stringify(stillMaru4).slice(0, 300));
  chk('㊸ 並びを戻すと、説明文も元の番号に戻る',
    circ.back.filter((t) => /④オプション/.test(t)).length === hasMaru4Before.length,
    JSON.stringify(circ.back).slice(0, 200));

  /* 成約の確認画面の「どの回線を数えるか」の欄に出る文字。
   * プランを選んでいない（プラン変更だけの）回線では手続き名が出るが、
   * そこに内部の値「plan_only」がそのまま出ていた。 */
  const ls = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    T.saved.clear();
    T.saved.ieOn && T.saved.ieOn(null);
    T.lines.fill(0, { procType: 'plan_only', planChange: true, voice: 'kake' });
    T.lines.fill(1, { planId: 'max', procType: 'kishu', devicePrice: 100000 });
    T.lines.pick(0);
    const a = T.saved.save('回線の名前の検査');
    return T.saved.wonLineText(a.id);
  });
  chk('㊸ 成約の確認画面の回線の欄に、内部名「plan_only」が出ない',
    ls.length > 0 && ls.indexOf('plan_only') < 0, JSON.stringify(ls).slice(0, 250));
  chk('㊸ かわりに「プラン変更」と日本語で出る',
    /プラン変更/.test(ls), JSON.stringify(ls).slice(0, 250));

  /* ---- ㊹ 実績の項目・一覧まわり（2026-09-08）----
   *   #10 「（再掲）機種スタンダード」だけ外すチェックが無い
   *   #12 dカードの種類・でんきのメニュー未選択の行が、項目一覧に無い
   *   #15 ポイントの控えを読み込むと、同じ id の行が2つできる
   *   #17 追っていない項目の目標が、内部の英数字のまま残って消せない
   *   #18 料金表から消えた商材が、実績に内部の英数字で出る
   *   #19 ポイント表の読み込みで、店舗独自サービスなどが数える側に戻らない */
  const catX = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    const c = L.statsCatalog();
    return {
      flags: L.scFlags(),
      hasDcardX: !!c['dcard:x'], hasDenkiX: !!c['denki:x'],
      dcardXName: c['dcard:x'] || '', denkiXName: c['denki:x'] || ''
    };
  });
  chk('㊹ 「（再掲）機種スタンダード」を外すチェックが、設定の画面にある',
    catX.flags.indexOf('kishuStd') >= 0, JSON.stringify(catX.flags));
  chk('㊹ dカード・でんきの「未選択」も項目一覧に出る（目標・配点を設定できる）',
    catX.hasDcardX && catX.hasDenkiX,
    catX.dcardXName + ' / ' + catX.denkiXName);

  /* 前のほうに「条件だけ同じ行」があると、id で探す前にそちらを差し替えてしまい、
   * 同じ id の行が2つ残っていた。そうなると実績のポイント表が
   * 「件数×点数≠小計」になる（同じ行が2回数えられる）。 */
  const impDup = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    L.cxSet([
      { id: 'aaa', name: '前の行（条件が同じ）', pt: 10, keys: ['proc:shinki'] },
      { id: 'bbb', name: 'あとの行', pt: 20, keys: ['proc:kishu'] }
    ]);
    // ファイルの行は id が bbb。条件は前の行（aaa）と同じ
    L.cxImport([{ id: 'bbb', name: '読み込んだ行', pt: 30, keys: ['proc:shinki'] }]);
    const rows = L.cxRowsNow();
    const ids = rows.map((r) => r.id);
    // 実際に成約させて、ポイントの表が「件数×点数＝小計」になっているかも見る
    S.clear();
    L.fill(0, { planId: 'max', procType: 'shinki', procTodo: { shinki: true } });
    L.pick(0);
    const a = S.save('ポイントの検査');
    S.won(a.id, false);
    const cx = S.cxTotalSaved();
    const bad = Object.keys(cx.rows).filter((k) => cx.rows[k].total !== cx.rows[k].pt * cx.rows[k].n);
    return { ids: ids, dup: ids.length !== new Set(ids).size,
      total: cx.total, bad: bad, rows: Object.keys(cx.rows).map((k) => k + ':' + JSON.stringify(cx.rows[k])) };
  });
  chk('㊹ ポイントの控えを読み込んでも、同じ id の行が2つできない',
    impDup.dup === false, JSON.stringify(impDup.ids));
  chk('㊹ ポイントの表が「件数×点数＝小計」になっている',
    impDup.bad.length === 0, JSON.stringify(impDup.rows));

  const ownBack = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const m = T.std.get();
    // 数える側から外してある項目を、ポイントの条件に使って読み込む
    const opt = m.options.filter((o) => !!L.statsCatalog()['opt:' + o.id])[0];
    L.optSkipUi(opt.id, false);
    const before = !!L.statsCatalog()['opt:' + opt.id];
    L.cxImport([{ id: 'z1', name: '検査', pt: 5, keys: ['opt:' + opt.id] }]);
    return { before: before, after: !!L.statsCatalog()['opt:' + opt.id] };
  });
  chk('㊹ ポイントの条件に使った項目は、読み込みで数える側に戻る',
    ownBack.before === false && ownBack.after === true, ownBack.before + ' → ' + ownBack.after);

  const goalOrphan = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    // 一覧に無いキーに目標を入れる（＝「実績で追う項目」から外したあとの状態）
    L.setGoal('opt:kensa_nai_koumoku', 3);
    const labels = L.goalLabels();
    const rows = L.goalRows();
    L.setGoal('opt:kensa_nai_koumoku', 0);
    return { labels: labels.filter((t) => /kensa_nai_koumoku/.test(t)), rows: rows };
  });
  chk('㊹ 追っていない項目の目標にも、マスタ設定に欄が出る（消せる）',
    goalOrphan.labels.length === 1 && /いまは追っていない項目/.test(goalOrphan.labels[0]),
    JSON.stringify(goalOrphan.labels));

  const delName = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    // 料金表に無いオプションを付けた保存を作り、実績に出る名前を見る
    const items = T.lines.itemsRaw([{ options: { op_9999999999999: true },
      optionKubun: { op_9999999999999: 'new' }, planId: 'max', procType: 'kishu' }]);
    return Object.keys(items).map((k) => k + '=' + items[k].name);
  });
  chk('㊹ 料金表から消えた商材でも、実績に内部の英数字を出さない',
    delName.some((t) => /削除された商材/.test(t)) && !delName.some((t) => /=op_9999999999999/.test(t)),
    JSON.stringify(delName));

  /* ---- ㊺ 画面の動き（2026-09-08）----
   *   #33 プラン世代をLIBMOにしたまま手続きを機種変更に変えると、LIBMOが選べたまま
   *   #37 回線を切り替えて戻ると、手で入れた事務手数料0円が4,950円に戻る
   *   #38 ⑥アクセサリのタイルが「並べ替え」で掴めない
   *   #40 選択式オプションの金額欄を選択肢に無い額にすると、表示と計算額が食い違う
   *   #41 「その他」が全部受付終了になると、実績の印のタイルが画面から消える */
  const grp = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.lines;
    const pt = document.getElementById('procType');
    const setProc = (v) => { pt.value = v; pt.dispatchEvent(new Event('change', { bubbles: true })); };
    setProc('mnp');
    const onMnp = S.planGroups();
    // 世代だけ LIBMO にして（プランは選ばない）、手続きを機種変更へ
    const gsel = document.getElementById('planGroup');
    gsel.value = 'libmo'; gsel.dispatchEvent(new Event('change', { bubbles: true }));
    setProc('kishu');
    const afterKishu = S.planGroups();
    // LIBMO のプランを選んである見積もりでは残る
    setProc('mnp');
    gsel.value = 'libmo'; gsel.dispatchEvent(new Event('change', { bubbles: true }));
    const psel = document.getElementById('planId');
    const libmo = Array.prototype.filter.call(psel.options, (o) => /libmo/.test(o.value))[0];
    if (libmo) { psel.value = libmo.value; psel.dispatchEvent(new Event('change', { bubbles: true })); }
    setProc('kishu');
    const withPlan = S.planGroups();
    setProc('kishu');
    return { onMnp, afterKishu, withPlan };
  });
  chk('㊺ のりかえ（MNP）のときは LIBMO が選べる',
    grp.onMnp.indexOf('libmo') >= 0, JSON.stringify(grp.onMnp));
  chk('㊺ プラン未選択のまま機種変更に変えると、LIBMO は一覧から消える',
    grp.afterKishu.indexOf('libmo') < 0, JSON.stringify(grp.afterKishu));
  chk('㊺ LIBMO のプランを選んである見積もりでは、機種変更にしても残る（金額を変えない）',
    grp.withPlan.indexOf('libmo') >= 0, JSON.stringify(grp.withPlan));

  const fee = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.lines;
    const L = T.lines;
    L.fill(0, {}); L.fill(1, {});
    L.pick(0);
    const pt = document.getElementById('procType');
    pt.value = 'shinki'; pt.dispatchEvent(new Event('change', { bubbles: true }));
    const auto = S.fees();
    // 手で 0円 にする（SIMのみで手数料を取らないご案内）
    const j = document.getElementById('jimuFee');
    j.value = '0'; j.dispatchEvent(new Event('input', { bubbles: true }));
    const byHand = S.fees();
    L.pick(1); L.pick(0);          // 回線を切り替えて戻る
    const back = S.fees();
    return { auto, byHand, back };
  });
  chk('㊺ 新規を選ぶと事務手数料が自動で入る（今までどおり）',
    Number(fee.auto.jimu) > 0, JSON.stringify(fee.auto));
  chk('㊺ 回線を切り替えて戻っても、手で入れた0円が戻らない',
    Number(fee.back.jimu) === 0 && fee.back.jimu === fee.byHand.jimu,
    JSON.stringify(fee.byHand) + ' → ' + JSON.stringify(fee.back));

  const tiles = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.lines;
    const m = T.std.get();
    const before = S.otherTiles();
    // 「その他」のオプションを全部 受付終了 にする
    (m.options || []).forEach((o) => {
      if ((o.category || 'その他') === 'その他') o.retiredFrom = '2020-01-01';
    });
    T.std.set(m);
    const after = S.otherTiles();
    (m.options || []).forEach((o) => { delete o.retiredFrom; });
    // 出荷の料金表にはアクセサリが1件も入っていないので、検査用に1つ足す
    m.accessories = (m.accessories || []).concat(
      [{ id: 'acc_kensa', name: '検査用アクセサリ', price: 3300 }]);
    T.std.set(m);
    const drag = S.accDraggable();
    m.accessories = (m.accessories || []).filter((a) => a.id !== 'acc_kensa');
    T.std.set(m);
    return { before, after, drag: drag };
  });
  chk('㊺ 「その他」が全部受付終了でも、実績の印のタイルが残る',
    tiles.after && tiles.after.some((t) => /下取り/.test(t))
      && tiles.after.some((t) => /dカード初回利用/.test(t)),
    JSON.stringify(tiles.after));
  chk('㊺ 実績の印のタイルが二重に出ない',
    tiles.before && tiles.before.filter((t) => /dカード初回利用/.test(t)).length === 1,
    JSON.stringify(tiles.before));
  chk('㊺ ⑥アクセサリのタイルが「並べ替え」で掴める（案内どおり）',
    tiles.drag === true, String(tiles.drag));

  const opx = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const S = T.lines;
    const m = T.std.get();
    const o = (m.options || [])[0];
    o.priceChoices = [550, 1100]; o.price = 550;
    T.std.set(m);
    // 選択肢に無い額を入れて、指を離す
    const r = S.setOptPrice(o.id, 9999);
    return r;
  });
  chk('㊺ 選択式オプションの金額欄に選択肢に無い額を入れたら、一番上の金額に合わせる',
    opx && opx.choices.indexOf(opx.price) >= 0,
    JSON.stringify(opx));

  /* ---- ㊻ 保存領域・店舗の切り替え・「いま送る」（2026-09-08）----
   *   #30 アプリを閉じるときの「いま送る」が、実際には送らず待ち直していた
   *   #60 別の店舗にログインしても「料金表の適用日」が前の店舗のまま残る */
  const flush = await page.evaluate(() => window.__KQ_TEST__.lines.flushNow());
  chk('㊻ 「いま送る」で、待っていたぶんが実際にクラウドへ送られる（待ち直さない）',
    flush.length >= 1, '送信の回数=' + flush.length + ' ' + JSON.stringify(flush).slice(0, 200));

  const wipe = await page.evaluate(() => window.__KQ_TEST__.lines.wipeKeys());
  chk('㊻ 店舗を切り替えると、料金表の適用日と削除の記録も端末から消える',
    wipe && wipe.before[0] && wipe.before[1] && !wipe.after[0] && !wipe.after[1],
    JSON.stringify(wipe));

  /* ---- ㊼ 成約の確認画面の「−・＋」と、見積もりなしの成約のポイント（2026-09-08）----
   *   #13 確認画面で「−」して消した項目が、ポイントにはそのまま残っていた
   *   #14 見積もりなしの成約で、別々の回線の項目が1回線にまとめられ、
   *       組み合わせの行が二重に数えられていた */
  const adjCx = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    S.clear();
    for (let i = 0; i < 5; i++) L.fill(i, {});     // 前の検査の中身を残さない
    L.cxSet([
      { id: 'g1', name: 'dカード GOLD', pt: 40, keys: ['dcard:gold'] },
      { id: 'k1', name: '機種変更', pt: 12, keys: ['proc:kishu'] }
    ]);
    L.fill(0, { planId: 'max', procType: 'kishu', procTodo: { kishu: true, dcard: true },
      todoDcard: true, todoDcardType: 'gold' });
    L.pick(0);
    const a = S.save('補正の検査');
    // 確認画面で dカード GOLD を「−」して 0件にしてから記録する
    const before = S.won(a.id, false);
    const cxBefore = S.cxTotalSaved();
    S.clear();
    for (let i = 0; i < 5; i++) L.fill(i, {});
    L.fill(0, { planId: 'max', procType: 'kishu', procTodo: { kishu: true, dcard: true },
      todoDcard: true, todoDcardType: 'gold' });
    L.pick(0);
    const b = S.save('補正の検査2');
    const after = S.wonMinus(b.id, 'dcard:gold');
    const cxAfter = S.cxTotalSaved();
    return { itemsBefore: Object.keys(before.items || {}), cxBefore: cxBefore.total,
      itemsAfter: Object.keys(after.items || {}), cxAfter: cxAfter.total,
      rows: Object.keys(cxAfter.rows) };
  });
  chk('㊼ そのままなら、項目もポイントも両方入る（52点）',
    adjCx.itemsBefore.indexOf('dcard:gold') >= 0 && adjCx.cxBefore === 52,
    JSON.stringify(adjCx.itemsBefore) + ' 合計=' + adjCx.cxBefore);
  chk('㊼ 確認画面で「−」して消したら、実績の項目から消える',
    adjCx.itemsAfter.indexOf('dcard:gold') < 0, JSON.stringify(adjCx.itemsAfter));
  chk('㊼ 同じように、ポイントからも引かれる（12点になる）',
    adjCx.cxAfter === 12, '合計=' + adjCx.cxAfter + ' 行=' + JSON.stringify(adjCx.rows));

  const nqCx = await page.evaluate(() => {
    const T = window.__KQ_TEST__;
    const L = T.lines;
    const S = T.saved;
    S.clear();
    L.cxSet([
      { id: 'a1', name: '新規 × dカード GOLD', pt: 20, keys: ['proc:shinki', 'dcard:gold'] },
      { id: 'a2', name: '機種変更 × dカード GOLD', pt: 5, keys: ['proc:kishu', 'dcard:gold'] }
    ]);
    // 見積もりなしの成約: 新規1・機種変更1・dカードGOLD1（GOLDは1枚だけ）
    S.addNoQuote({ 'proc:shinki': 1, 'proc:kishu': 1, 'dcard:gold': 1 });
    const one = S.cxTotalSaved();
    S.clear();
    // dカードGOLDを2枚売った日は、両方の行が1件ずつ当たる
    S.addNoQuote({ 'proc:shinki': 1, 'proc:kishu': 1, 'dcard:gold': 2 });
    const two = S.cxTotalSaved();
    return { one: one.total, oneRows: one.rows, two: two.total };
  });
  chk('㊼ 見積もりなしの成約で、dカード1枚を2つの組み合わせ行が取り合わない（20点）',
    nqCx.one === 20, '合計=' + nqCx.one + ' ' + JSON.stringify(nqCx.oneRows));
  chk('㊼ 2枚売った日は、両方の行が1件ずつ当たる（25点）',
    nqCx.two === 25, '合計=' + nqCx.two);

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
