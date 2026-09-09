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
 *   ⑥ クラウドに「引っ越し済み（movedTo）」があり、この住所がそれと違うなら、同期を止めて案内を出す
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
    await pg.addInitScript(fake({ offline: o.offline, docs: o.docs || {} }));
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

  // ⑥ 引っ越し済みの合図（movedTo が別の住所）
  d = await open({ url: '/?kqtest=1', offline: false, host: 'old.example',
    docs: { [STORE]: Object.assign({}, cloudStore, { movedTo: 'https://new.example', movedAt: '2026/09/10 10:00' }) },
    seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  const band = await d.pg.evaluate(() => { const e = document.getElementById('cloudWarn'); return e && !e.hidden ? e.textContent : ''; });
  chk('⑥ 旧住所で開くと「引っ越しました」の案内が出る', /引っ越し/.test(band) && /new\.example/.test(band), band.slice(0, 80));
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
  // 新しい住所（movedTo と同じ）では止まらない
  d = await open({ url: '/?kqtest=1', offline: false, host: 'new.example',
    docs: { [STORE]: Object.assign({}, cloudStore, { movedTo: 'https://new.example' }) }, seed: { 'dq-config-v1': JSON.stringify(cloudStore) } });
  chk('⑥ 新しい住所では止まらない', !(await d.pg.evaluate(() => { const e = document.getElementById('cloudWarn'); return e && !e.hidden; })));
  await d.c.close();

  /* ---- イエナカ単体 社内版（/ienaka/） ---- */
  const IE = 'settings/ienakaInternalStore';
  // ⑤ 通信できていてクラウドが本当に空 → 初期値を送る（これまでどおり）。その中身を後の③で「他端末の本物」として使う
  d = await open({ url: '/ienaka/', offline: false });
  const first = (await sets(d.pg)).filter((x) => x.path === IE + '/quotes/shared')[0];
  chk('イ⑤ 通信できていてクラウドが空なら初期値を送る（初めて使う店舗）', !!first);
  await d.c.close();
  const remoteQuote = (() => { const q = JSON.parse(first.data.data); q.staffName = '田中'; q.custName = ''; return q; })();

  // ① 空の端末を圏外で開く → 送らない。入力しても送らない
  d = await open({ url: '/ienaka/', offline: true });
  chk('イ① 空の端末を圏外で開いても、クラウドへの書き込みが無い', (await sets(d.pg)).length === 0, JSON.stringify(await sets(d.pg)).slice(0, 200));
  await d.pg.evaluate(() => { const e = document.getElementById('custName'); e.value = '空の端末で入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
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
  await d.pg.evaluate(() => { const e = document.getElementById('custName'); e.value = '本物のあとで入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(1500);
  chk('イ③ 本物を受け取ったあとは、これまでどおり送れる', (await sets(d.pg)).some((x) => x.path === IE + '/quotes/shared'));
  await d.c.close();

  // ④ 端末に保存がある端末が圏外 → 入力は送れる（これまでどおり。通信が戻ったときに届く）
  d = await open({ url: '/ienaka/', offline: true, seed: { 'ienaka-internal-config-v1': JSON.stringify({ storeName: 'テスト店', staff: [] }) } });
  await d.pg.evaluate(() => { const e = document.getElementById('custName'); e.value = 'いつもの端末で入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(1500);
  chk('イ④ 保存のある端末は圏外でも送れる（これまでどおり）', (await sets(d.pg)).some((x) => x.path === IE + '/quotes/shared'));
  await d.c.close();

  // ⑥ 引っ越し済みの合図
  d = await open({ url: '/ienaka/', offline: false, host: 'old.example',
    docs: { [IE]: { storeName: 'テスト店', movedTo: 'https://new.example', clientId: 'other-device' } },
    seed: { 'ienaka-internal-config-v1': JSON.stringify({ storeName: 'テスト店', staff: [] }) } });
  const iband = await d.pg.evaluate(() => { const e = document.getElementById('movedWarn'); return e && !e.hidden ? e.textContent : ''; });
  chk('イ⑥ 旧住所で開くと「引っ越しました」の案内が出る', /引っ越し/.test(iband) && /new\.example/.test(iband), iband.slice(0, 80));
  await d.pg.evaluate(() => { const e = document.getElementById('custName'); e.value = '旧端末で入力'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(1500);
  chk('イ⑥ 旧住所からは何も送らない', !(await sets(d.pg)).some((x) => x.path.indexOf('quotes/shared') >= 0), JSON.stringify(await sets(d.pg)).slice(0, 200));
  await d.c.close();

  await b.close(); srv.close();
  const bad = errs.filter((e) => !/テスト用/.test(e));
  if (bad.length) { console.error('JSエラー:\n' + bad.join('\n')); process.exit(1); }
  if (ng) { console.error('空の端末のテスト: NG ' + ng + '件'); process.exit(1); }
  console.log('空の端末・引っ越し済みの合図のテスト: ' + okN + '/' + okN + ' OK');
});
