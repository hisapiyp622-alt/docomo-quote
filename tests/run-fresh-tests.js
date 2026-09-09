/* 「はじめて開いた空の端末」が本番のクラウドを白紙にしないことの確認（2026-09-08）
 *
 *   node tests/run-fresh-tests.js
 *
 * なぜ要るか（配信先の引っ越しの反証で見つかった穴）:
 *   社内版の住所が変わると、全端末が「はじめて開く空の端末」になる。空の端末を圏外で開くと、
 *   クラウドの部品は「端末内の控え（fromCache）」から「何も無い」というお知らせを出す。
 *   ・イエナカ単体はこれを「クラウドが空」と受け取り、白紙の見積もりを quotes/shared へ送っていた
 *     → 通信が戻った瞬間に、阪南・常盤東の全端末の作りかけが白紙になる
 *   ・ケータイ社内版は初期設定の画面が出て、店名や担当者を入れると 1人だけの担当者一覧を送っていた
 *     → 店内の全端末の担当者一覧が置き換わる
 *   ここでは「にせクラウド」（tests/lib/fake-firestore.js）を差し込んで、
 *   クラウドへ飛ぶ書き込み（set）を数える。本物のクラウドにはつながない。
 *
 * 見ているもの（お客様・店舗の目に映るもの）:
 *   ① 空の端末を圏外で開いても、クラウドへの書き込みが 0 件
 *   ② ケータイ社内版は「はじめて開く端末です」の画面で待ち、初期設定の画面は出ない
 *   ③ 通信が戻って本物が届いたら自動で中へ入り、担当者一覧はクラウドのもの（1人だけの内容を送っていない）
 *   ④ 端末に保存があった端末（いつもの iPad が圏外なだけ）は、これまでどおり送れる
 *   ⑤ 通信できていて本当にクラウドが空なら、これまでどおり初期値を送る（初めて使う店舗）
 *   ⑥ クラウドに「閉じた旧住所（movedFrom）」があり、この住所がそれなら、同期を止めて案内を出す
 *   ⑧ 「旧アドレスを閉じる」は3つの書類すべてに movedFrom を書き、「印を消す」で空に戻る。旧住所からは押せない
 *   ⑨ 持ち込んだ直後の最初の同期で、クラウドの新しい作りかけを消さず、ケータイ側のお客様名は端末のものが残る
 *   イ③ イエナカ単体には氏名欄がなく、以前の版の氏名も保存・同期しない
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const fake = require('./lib/fake-firestore');

const ROOT = path.resolve(__dirname, '..');
function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown', '.png': 'image/png' };
const srv = http.createServer((q, s) => {
  let p = q.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, decodeURIComponent(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
});
let okN = 0, ng = 0;
function chk(l, cond, x) { console.log((cond ? 'OK  ' : 'NG  ') + l + (x ? '  ' + x : '')); if (cond) okN++; else ng++; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const { chromium } = playwright();
  const lo = { args: ['--no-sandbox', '--host-resolver-rules=MAP * 127.0.0.1:' + port] };
  if (fs.existsSync('/opt/pw-browsers/chromium')) lo.executablePath = '/opt/pw-browsers/chromium';
  const b = await chromium.launch(lo);
  const errs = [];

  /* 端末を1台開く。opts: { host, url, offline, docs, seed(localStorage に入れておくもの) } */
  async function open(o) {
    const c = await b.newContext({ serviceWorkers: 'block' });
    await c.route('**/*', (r) => (r.request().url().includes('gstatic.com') ? r.abort() : r.continue()));
    const pg = await c.newPage(); pg.setDefaultTimeout(8000);
    pg.on('pageerror', (e) => errs.push(o.url + ': ' + String(e)));
    pg.on('dialog', (d) => d.accept());
    await pg.addInitScript(fake({ offline: o.offline, docs: o.docs || {}, delay: o.delay || {} }));
    if (o.seed) await pg.addInitScript((seed) => { if (!window.__seeded) { window.__seeded = 1; Object.keys(seed).forEach((k) => localStorage.setItem(k, seed[k])); } }, o.seed);
    await pg.goto('http://' + (o.host || 'naibu.example') + o.url);
    await wait(1200);
    return { pg, c };
  }
  const sets = (pg) => pg.evaluate(() => window.__FAKE.sets.map((s) => ({ path: s.path, data: s.data })));
  const vis = (pg, id) => pg.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; }, id);

  const STORE = 'settings/docomoQuoteStore';
  const cloudStore = { storeName: 'テスト店', storeTel: '', staff: [{ id: 's1', name: '佐藤', code: '1111' }, { id: 's2', name: '鈴木', code: '2222' }],
    activeStaffId: 's1', adminLock: null, updatedAtMs: Date.now() - 600000, clientId: 'other-device' };

  /* ---- ケータイ社内版（/） ---- */
  // ① 空の端末を圏外で開く
  let d = await open({ url: '/?kqtest=1', offline: true });
  chk('① 空の端末を圏外で開いても、クラウドへの書き込みが無い', (await sets(d.pg)).length === 0, JSON.stringify(await sets(d.pg)).slice(0, 200));
  chk('② 「はじめて開く端末です」の画面で待つ', await vis(d.pg, 'freshOverlay'));
  chk('② 初期設定の画面は出ない', !(await vis(d.pg, 'setupOverlay')));
  chk('② 担当者コードの画面もまだ出ない', !(await vis(d.pg, 'staffOverlay')));
  // 通信が戻って本物が届く
  await d.pg.evaluate(([p, doc]) => window.__FAKE.deliver(p, doc), [STORE, cloudStore]);
  await wait(800);
  chk('③ 本物が届いたら自動で中へ入る（門が閉じる）', !(await vis(d.pg, 'freshOverlay')));
  chk('③ 担当者コードの画面が出る（クラウドの担当者2人）', await vis(d.pg, 'staffOverlay'));
  const cfg = await d.pg.evaluate(() => JSON.parse(localStorage.getItem('dq-config-v1') || 'null'));
  chk('③ 端末の担当者一覧はクラウドのもの', !!cfg && cfg.staff && cfg.staff.length === 2 && cfg.staff[0].name === '佐藤', JSON.stringify(cfg && cfg.staff));
  const s1 = await sets(d.pg);
  chk('③ 1人だけの担当者一覧（初期値）を送っていない', !s1.some((x) => x.path === STORE && x.data && x.data.staff && x.data.staff.length === 1), JSON.stringify(s1).slice(0, 200));
  await d.c.close();

  // ⑤ 通信できていて、クラウドが本当に空（初めて使う店舗）→ これまでどおり初期値を送る
  d = await open({ url: '/?kqtest=1', offline: false });
  chk('⑤ 通信できていてクラウドが空なら、門は出ない（初めて使う店舗）', !(await vis(d.pg, 'freshOverlay')));
  await d.c.close();

  // ④ 端末に保存がある端末（いつもの iPad）が圏外 → 門は出ない
  d = await open({ url: '/?kqtest=1', offline: true, seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  chk('④ 保存のある端末が圏外でも、門は出ない（これまでどおり）', !(await vis(d.pg, 'freshOverlay')) && (await vis(d.pg, 'staffOverlay')));
  await d.c.close();

  // ⑥ 引っ越し済みの合図（movedFrom がこの住所）
  d = await open({ url: '/?kqtest=1', offline: false, host: 'old.example',
    docs: { [STORE]: Object.assign({}, cloudStore, { movedFrom: 'old.example', movedAt: '2026/09/10 10:00' }) },
    seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  const band = await d.pg.evaluate(() => { const e = document.getElementById('cloudWarn'); return e && !e.hidden ? e.textContent : ''; });
  chk('⑥ 旧住所で開くと「引っ越しました」の案内が出る（新しい住所は載せない）', /引っ越しました/.test(band) && !/new\.example/.test(band), band.slice(0, 80));
  const st = await d.pg.evaluate(() => document.getElementById('syncStatus').textContent);
  chk('⑥ 同期の表示が「引っ越し済み」', /引っ越し済み/.test(st), st);
  // 旧住所で入力しても送らない
  await d.pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await wait(500);
  await d.pg.evaluate(() => { const e = document.getElementById('custName'); e.value = '旧端末のお客様'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(2500);
  const s6 = await sets(d.pg);
  chk('⑥ 旧住所からは何も送らない', s6.length === 0, JSON.stringify(s6).slice(0, 200));
  await d.c.close();
  // 担当が1人でコード無し（担当者コードの画面を通らず、開いた瞬間に中へ入る店舗）の旧端末が、
  // 圏外で作りかけを直していた → 旧住所で開いたとき、合図より先に作りかけを送らない。
  // 本物のクラウドは配達の順番が決まっていないので、店舗の書類のお知らせを 2 秒遅らせて「見積もりの送信が先に走る」形にする
  d = await open({ url: '/?kqtest=1', offline: false, host: 'old.example', delay: { [STORE]: 2000 },
    docs: { [STORE]: { storeName: 'テスト店', storeTel: '', staff: [{ id: 's1', name: '担当1', code: '' }], activeStaffId: 's1', adminLock: null, movedFrom: 'old.example', updatedAtMs: Date.now() - 600000, clientId: 'other-device' } },
    seed: { 'dq-config-v1': JSON.stringify({ storeName: 'テスト店', staff: [{ id: 's1', name: '担当1', code: '' }], activeStaffId: 's1' }),
      'dq-state-v1:s1': JSON.stringify({ active: 0, gen: 1, patterns: [{ custName: '圏外で直した' }] }), 'dq-quote-at:s1': String(Date.now()) } });
  await wait(2500);
  const s7 = await sets(d.pg);
  chk('⑥ 担当者コードの画面を通らない店舗でも、合図が先に効いて何も送らない', s7.length === 0 && (await vis(d.pg, 'cloudWarn')), JSON.stringify(s7).slice(0, 160));
  await d.c.close();
  // 圏外で開いた旧端末（控えに合図なし）で担当者を選ぶ → 担当者一覧の送信が予約されるが、
  // 本物を受け取るまで送らない。通信が戻って合図（movedFrom）が届いたら、予約していたぶんも送らない
  d = await open({ url: '/?kqtest=1', offline: true, host: 'old.example',
    docs: { [STORE]: Object.assign({}, cloudStore) },   // 控えには合図なし（引っ越し前に取った控え）
    seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  await d.pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await wait(1500);
  chk('⑦ 圏外の旧端末で担当者を選んでも、本物を受け取るまで担当者一覧を送らない', (await sets(d.pg)).length === 0, JSON.stringify(await sets(d.pg)).slice(0, 160));
  await d.pg.evaluate(([p, doc]) => window.__FAKE.deliver(p, doc), [STORE, Object.assign({}, cloudStore, { movedFrom: 'old.example' })]);
  await wait(1500);
  chk('⑦ 通信が戻って合図が届いたら、予約していた担当者一覧も送らない', (await sets(d.pg)).length === 0, JSON.stringify(await sets(d.pg)).slice(0, 160));
  await d.c.close();
  // 同じ状況で合図が無ければ、圏外のあいだに直した担当者一覧はこれまでどおり送られる（保留の解放）
  d = await open({ url: '/?kqtest=1', offline: true, host: 'naibu.example',
    docs: { [STORE]: Object.assign({}, cloudStore) },
    seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  await d.pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await wait(800);
  await d.pg.evaluate(([p, doc]) => window.__FAKE.deliver(p, doc), [STORE, Object.assign({}, cloudStore)]);
  await wait(1500);
  chk('⑦ 合図が無ければ、圏外のあいだの担当者の変更はこれまでどおり送られる', (await sets(d.pg)).some((x) => x.path === STORE && x.data && x.data.staff), JSON.stringify(await sets(d.pg)).slice(0, 160));
  await d.c.close();
  // 新しい住所（movedFrom に無い）では止まらない
  d = await open({ url: '/?kqtest=1', offline: false, host: 'new.example',
    docs: { [STORE]: Object.assign({}, cloudStore, { movedFrom: 'old.example' }) }, seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  chk('⑥ 新しい住所では止まらない', !(await d.pg.evaluate(() => { const e = document.getElementById('cloudWarn'); return e && !e.hidden; })));
  chk('⑥ クラウドの書類に新しい住所を書いていない（合図は「閉じた旧住所」だけ）', !(await d.pg.evaluate(() => JSON.stringify(window.__FAKE.docs))).includes('new.example'));
  await d.c.close();

  /* ---- ⑧ 旧アドレスを閉じる／印を消す ---- */
  const IE_STORE = 'settings/ienakaInternalStore', TK_STORE = 'settings/ienakaStore_tokiwahigashi';
  const three = { [STORE]: Object.assign({}, cloudStore), [IE_STORE]: { storeName: 'テスト店' }, [TK_STORE]: { storeName: '常盤東' } };
  d = await open({ url: '/?kqtest=1', offline: false, host: 'new.example', docs: JSON.parse(JSON.stringify(three)), seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  await d.pg.addInitScript(() => { window.KEITAI_OLD_HOSTS = ['old.example']; });
  await d.pg.reload(); await wait(1200);
  await d.pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await wait(500);
  await d.pg.evaluate(() => document.getElementById('moveCloseBtn').click()); await wait(800);
  let docsNow = await d.pg.evaluate(() => window.__FAKE.docs);
  chk('⑧ 「旧アドレスを閉じる」で3つの書類すべてに閉じた旧住所が書かれる', [STORE, IE_STORE, TK_STORE].every((p) => docsNow[p] && docsNow[p].movedFrom === 'old.example'), JSON.stringify([STORE, IE_STORE, TK_STORE].map((p) => docsNow[p] && docsNow[p].movedFrom)));
  chk('⑧ 新しい住所はクラウドに書かれない', !JSON.stringify(docsNow).includes('new.example'));
  chk('⑧ 画面に知らせが出る', /知らせました/.test(await d.pg.evaluate(() => document.getElementById('moveMsg').textContent)));
  await d.pg.evaluate(() => document.getElementById('moveReopenBtn').click()); await wait(800);
  docsNow = await d.pg.evaluate(() => window.__FAKE.docs);
  chk('⑧ 「印を消す」で3つとも空に戻る', [STORE, IE_STORE, TK_STORE].every((p) => docsNow[p] && docsNow[p].movedFrom === ''), JSON.stringify([STORE, IE_STORE, TK_STORE].map((p) => docsNow[p] && docsNow[p].movedFrom)));
  await d.c.close();
  // 旧住所からは押せない
  d = await open({ url: '/?kqtest=1', offline: false, host: 'old.example', docs: JSON.parse(JSON.stringify(three)), seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  await d.pg.addInitScript(() => { window.KEITAI_OLD_HOSTS = ['old.example']; });
  await d.pg.reload(); await wait(1200);
  await d.pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await wait(500);
  await d.pg.evaluate(() => document.getElementById('moveCloseBtn').click()); await wait(800);
  const m8 = await d.pg.evaluate(() => document.getElementById('moveMsg').textContent);
  chk('⑧ 旧住所からは押せず、合図を書かない', /旧アドレス/.test(m8) && /行えません/.test(m8) && !(await sets(d.pg)).some((x) => x.data && 'movedFrom' in x.data), m8.slice(0, 60));
  await d.c.close();

  /* ---- ⑨ 持ち込んだ直後の最初の同期（旧端末の時刻を持ったまま新住所で開く） ---- */
  {
    const oldAt = Date.now() - 3600000;   // 旧端末は1時間前に開いた・送った
    /* 旧端末の作りかけは、アプリ自身に作らせて本物の形にする（手で書いた最小の形だと、開いたときの
     * 整えなおしで「この端末で入力があった」と見なされ、試したい筋道と別のものになる） */
    const oldCfg = Object.assign({}, cloudStore, { staff: [{ id: 's1', name: '佐藤', code: '1111' }] });
    const mk = await open({ url: '/?kqtest=1', offline: true, host: 'maker.example', seed: { 'dq-config-v1': JSON.stringify(oldCfg) } });
    await mk.pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await wait(500);
    await mk.pg.evaluate(() => { window.__KQ_TEST__.saved.pickPlan('current', 'max'); const e = document.getElementById('custName'); e.value = '持ち込んだお客様'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(1200);
    const oldState = await mk.pg.evaluate(() => localStorage.getItem('dq-state-v1:s1'));
    await mk.c.close();
    const newState = JSON.parse(oldState); newState.patterns[0].planId = 'mini'; newState.patterns[0].custName = '';
    const cloudQuote = { data: JSON.stringify(newState), updatedAtMs: Date.now() - 60000, clientId: 'other-device' };
    // 持ち込んだ直後の端末の中身（旧端末の作りかけ・お客様名・開いた時刻・店舗の書類を送った時刻）。旧端末の担当者一覧は古い（1人）
    const seeded = { 'dq-config-v1': JSON.stringify(oldCfg), 'dq-state-v1:s1': oldState,
      'dq-quote-at:s1': String(oldAt), 'dq-store-at': String(oldAt) };
    d = await open({ url: '/?kqtest=1', offline: false, host: 'new.example', seed: seeded,
      docs: { [STORE]: Object.assign({}, cloudStore, { updatedAtMs: Date.now() - 120000 }), [STORE + '/quotes/s1']: cloudQuote } });
    await d.pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await wait(500);
    // 作りかけがある端末は「続きから開く？」とたずねられる（持ち込んだ端末はこうなる）→ 続きから開く
    await d.pg.evaluate(() => { const b = document.getElementById('resumeDlgCont'); if (b && !document.getElementById('resumeDlg').hidden) b.click(); });
    await wait(2500);
    const st9 = await d.pg.evaluate(() => ({ cust: document.getElementById('custName').value, plan: window.__KQ_TEST__.sync.planId(), staff: (JSON.parse(localStorage.getItem('dq-config-v1') || '{}').staff || []).length,
      autos: window.__KQ_TEST__.sync.autoNames() }));
    chk('⑨ クラウドの方が新しい作りかけはクラウドを採り、お客様名は端末のものが残る', st9.plan === 'mini' && st9.cust === '持ち込んだお客様', JSON.stringify(st9));
    chk('⑨ 担当者一覧はクラウドの新しいもの（旧端末の古い一覧で置き換えない）', st9.staff === 2 && !(await sets(d.pg)).some((x) => x.path === STORE && x.data && x.data.staff && x.data.staff.length === 1), JSON.stringify(st9));
    await d.c.close();
  }

  /* ---- イエナカ単体 社内版（/ienaka/） ---- */
  const IE = 'settings/ienakaInternalStore';
  // ⑤ 通信できていてクラウドが本当に空 → 初期値を送る（これまでどおり）。その中身を後の③で「他端末の本物」として使う
  d = await open({ url: '/ienaka/', offline: false });
  const first = (await sets(d.pg)).filter((x) => x.path === IE + '/quotes/shared')[0];
  chk('イ⑤ 通信できていてクラウドが空なら初期値を送る（初めて使う店舗）', !!first);
  await d.c.close();
  const remoteQuote = (() => { const q = JSON.parse(first.data.data); q.staffName = '田中'; q.custName = '以前の版の名前'; return q; })();

  // ① 空の端末を圏外で開く → 送らない。入力しても送らない
  d = await open({ url: '/ienaka/', offline: true });
  chk('イ① 空の端末を圏外で開いても、クラウドへの書き込みが無い', (await sets(d.pg)).length === 0, JSON.stringify(await sets(d.pg)).slice(0, 200));
  await d.pg.evaluate(() => { const e = document.getElementById('quoteMemo'); e.value = '空の端末で入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(1500);
  chk('イ① 空の端末で入力しても、本物を受け取るまで送らない', (await sets(d.pg)).length === 0, JSON.stringify(await sets(d.pg)).slice(0, 200));
  const ist = await d.pg.evaluate(() => (document.getElementById('cloudStatus') || document.querySelector('.sync-status, #syncStatus, .cloud-status') || { textContent: '' }).textContent);
  chk('イ① 「オフライン」の表示', /オフライン/.test(ist), ist);
  // 通信が戻り、本物（他端末の作りかけ）が届く → 取り込む。以後の入力は送れる
  await d.pg.evaluate(([p, doc]) => window.__FAKE.deliver(p, doc), [IE + '/quotes/shared',
    { data: JSON.stringify(remoteQuote), clientId: 'other-device', updatedAtMs: Date.now() }]);
  await wait(800);
  const staffName = await d.pg.evaluate(() => document.getElementById('staffName').value);
  chk('イ③ 本物が届いたら取り込む（他端末の担当者名が入る）', staffName === '田中', staffName);
  chk('イ③ お客様名の入力欄は無い', !(await d.pg.$('#custName')));
  await d.pg.evaluate(() => { const e = document.getElementById('quoteMemo'); e.value = '本物のあとで入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(1500);
  chk('イ③ 本物を受け取ったあとは、これまでどおり送れる', (await sets(d.pg)).some((x) => x.path === IE + '/quotes/shared'));
  const sentQuote = (await sets(d.pg)).filter((x) => x.path === IE + '/quotes/shared').slice(-1)[0];
  const sentData = sentQuote && sentQuote.data && sentQuote.data.data ? JSON.parse(sentQuote.data.data) : null;
  chk('イ③ 以前の版のお客様名を保存・同期しない', !!sentData && !Object.prototype.hasOwnProperty.call(sentData, 'custName'), JSON.stringify(sentData).slice(0, 200));
  await d.c.close();

  // ② 空の端末を圏外のまま**開き直して**入力しても送らない（1回目の起動で自動保存された空の見積もりを「保存あり」と見ない）
  {
    const c2 = await b.newContext({ serviceWorkers: 'block' });
    await c2.route('**/*', (r) => (r.request().url().includes('gstatic.com') ? r.abort() : r.continue()));
    const p2 = await c2.newPage(); p2.on('dialog', (dd) => dd.accept()); p2.on('pageerror', (e) => errs.push('/ienaka/ 2回目: ' + String(e)));
    await p2.addInitScript(fake({ offline: true }));
    await p2.goto('http://naibu.example/ienaka/'); await wait(1000);
    await p2.goto('http://naibu.example/ienaka/'); await wait(1000);   // 圏外のまま開き直す
    await p2.evaluate(() => { const e = document.getElementById('quoteMemo'); e.value = '2回目に入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(1500);
    const s2 = await p2.evaluate(() => window.__FAKE.sets.map((s) => s.path));
    chk('イ② 空の端末を圏外のまま開き直して入力しても送らない', s2.length === 0, s2.join(','));
    await c2.close();
  }
  // ④ 一度でも本物を受け取った端末（いつもの iPad）が圏外 → 入力は送れる（これまでどおり。通信が戻ったときに届く）
  d = await open({ url: '/ienaka/', offline: true, seed: { 'ienaka-internal-config-v1': JSON.stringify({ storeName: 'テスト店', staff: [] }), 'ienaka-internal-seen-cloud-v1': '1' } });
  await d.pg.evaluate(() => { const e = document.getElementById('quoteMemo'); e.value = 'いつもの端末で入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(1500);
  chk('イ④ 一度本物を受け取った端末は圏外でも送れる（これまでどおり）', (await sets(d.pg)).some((x) => x.path === IE + '/quotes/shared'));
  await d.c.close();
  // ④' 通信できる場所で一度開いた端末には印が残り、次に圏外で開いても送れる
  d = await open({ url: '/ienaka/', offline: false, docs: { [IE + '/quotes/shared']: { data: JSON.stringify(remoteQuote), clientId: 'other-device', updatedAtMs: Date.now() } } });
  const mark = await d.pg.evaluate(() => localStorage.getItem('ienaka-internal-seen-cloud-v1'));
  chk("イ④' 本物を受け取ると端末に印が残る（持ち出し・持ち込みで新端末にも運ばれる）", mark === '1', String(mark));
  await d.c.close();

  // ⑥ 引っ越し済みの合図
  d = await open({ url: '/ienaka/', offline: false, host: 'old.example',
    docs: { [IE]: { storeName: 'テスト店', movedFrom: 'old.example', clientId: 'other-device' } },
    seed: { 'ienaka-internal-config-v1': JSON.stringify({ storeName: 'テスト店', staff: [] }) } });
  const iband = await d.pg.evaluate(() => { const e = document.getElementById('movedWarn'); return e && !e.hidden ? e.textContent : ''; });
  chk('イ⑥ 旧住所で開くと「引っ越しました」の案内が出る（新しい住所は載せない）', /引っ越しました/.test(iband) && !/new\.example/.test(iband), iband.slice(0, 80));
  await d.pg.evaluate(() => { const e = document.getElementById('quoteMemo'); e.value = '旧端末で入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(1500);
  chk('イ⑥ 旧住所からは何も送らない', !(await sets(d.pg)).some((x) => x.path.indexOf('quotes/shared') >= 0), JSON.stringify(await sets(d.pg)).slice(0, 200));
  await d.c.close();

  await b.close(); srv.close();
  const bad = errs.filter((e) => !/テスト用/.test(e));
  if (bad.length) { console.error('JSエラー:\n' + bad.join('\n')); process.exit(1); }
  if (ng) { console.error('空の端末のテスト: NG ' + ng + '件'); process.exit(1); }
  console.log('空の端末・引っ越し済みの合図のテスト: ' + okN + '/' + okN + ' OK');
});
