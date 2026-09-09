/* 旧住所に置く「引っ越しました」の案内ページ（tools/build-oldsite-stub.js）の確認
 *
 *   node tests/run-oldsite-stub-test.js
 *
 * なぜ要るか（2026-09-08・配信先の引っ越し）:
 *   旧住所を単に消す（404）と、端末のオフライン係（sw.js）が控えから古いアプリを起動して、
 *   いまのクラウドに書き続ける。案内ページは、開いた時点でその住所のオフライン係を外し、
 *   古い控えを消し、端末に残ったデータを新しい住所へ運ぶ道（持ち出し）を用意していなければならない。
 *   ここでは本物のオフライン係を動かして（Service Worker を許可）、
 *   「古いアプリを控えた端末が、案内ページに置き換わったあとに開き直すとどうなるか」を再現する。
 *
 * 見ているもの:
 *   ① 古いアプリを開いた端末には、オフライン用の控え（dq-*・ienaka-internal-*）ができている
 *   ② 案内ページに差し替えたあとに開くと、案内が出て、オフライン係が全部外れ、控えが消える
 *      （同じ住所（github.io）に同居する別サイトのオフライン係・控えは消さない。新しい住所はページに書かない）
 *   ③ /ienaka/ を開いても古いイエナカが控えから起きず、案内が出る
 *   ④ 端末の保存（localStorage）は消えず、「持ち出す」で新しい住所の「持ち込む」と同じ形式のファイルが出る
 *   ⑤ 「旧データを消す」は二度たずねてから、社内版の鍵だけを消す
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}
const STUB = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-stub-'));
execFileSync(process.execPath, [path.join(ROOT, 'tools/build-oldsite-stub.js'), '--old-path', '/docomo-quote/', STUB], { stdio: 'inherit' });
/* 同じ github.io に同居する「別サイト」のまね（/other/）。案内ページがこれを巻き込まないことを見る */
const OTHER = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-other-'));
fs.writeFileSync(path.join(OTHER, 'index.html'), '<!DOCTYPE html><html><body>other site<script>navigator.serviceWorker.register("sw.js");</script></body></html>');
fs.writeFileSync(path.join(OTHER, 'sw.js'), 'self.addEventListener("install",function(e){e.waitUntil(caches.open("other-site-v1").then(function(c){return c.put("/other/x.txt",new Response("x"));}));self.skipWaiting();});self.addEventListener("activate",function(){self.clients.claim();});');

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown', '.png': 'image/png', '.json': 'application/json' };
/* オフライン係（Service Worker）は https か localhost でしか動かない。ホスト名を偽る方法は CI の Chromium で
 * 効かなかったので、localhost の**別ポート**で「旧住所」と「新住所」を分ける（別ポート＝別のオリジン＝保存も
 * オフライン係も別）。旧住所は本番と同じく /docomo-quote/ の下に置き、/other/ は同居する別サイトのまね。
 * 新しい住所は根っこに社内版（リポジトリの中身）を置く。 */
const state = { dir: ROOT };
function serveFile(base, p, s) {
  const f = path.join(base, decodeURIComponent(p));
  if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); s.end(fs.readFileSync(f));
}
const srvOld = http.createServer((q, s) => {
  let p = q.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html';
  if (p.indexOf('/other/') === 0) return serveFile(OTHER, p.slice('/other'.length), s);
  if (p.indexOf('/docomo-quote/') === 0) return serveFile(state.dir, p.slice('/docomo-quote'.length), s);
  s.writeHead(404); s.end('nf');
});
const srv = http.createServer((q, s) => {
  let p = q.url.split('?')[0]; if (p.endsWith('/')) p += 'index.html';
  serveFile(state.dir, p, s);
});
let okN = 0, ng = 0;
function chk(l, cond, x) { console.log((cond ? 'OK  ' : 'NG  ') + l + (x ? '  ' + x : '')); if (cond) okN++; else ng++; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = {
  'dq-config-v1': JSON.stringify({ storeName: 'ドコモショップ阪南店', staff: [{ id: 's1', name: '佐藤', code: '1111' }], activeStaffId: 's1' }),
  'dq-saved-v1:s1': JSON.stringify([{ id: 'sv1', name: '山田様', custName: '山田 太郎', data: { patterns: [{ custName: '山田 太郎' }] } }]),
  'ienaka-internal-config-v1': JSON.stringify({ storeName: 'ドコモショップ阪南店' }),
  'kq-config-v1': JSON.stringify({ storeName: '製品版の開発コピー' })
};

srv.listen(0, '127.0.0.1', async () => {
  await new Promise((r) => srvOld.listen(0, '127.0.0.1', r));
  const OLD = 'http://localhost:' + srvOld.address().port;   // 旧住所（…/docomo-quote/ の下）
  const NEW = 'http://localhost:' + srv.address().port;      // 新しい住所（根っこ）
  const { chromium } = playwright();
  const lo = { args: ['--no-sandbox', '--no-proxy-server'] };
  if (fs.existsSync('/opt/pw-browsers/chromium')) lo.executablePath = '/opt/pw-browsers/chromium';
  const b = await chromium.launch(lo);
  const c = await b.newContext({ acceptDownloads: true });   // オフライン係（Service Worker）を動かす
  const errs = [];
  const pg = await c.newPage(); pg.setDefaultTimeout(10000);
  pg.on('pageerror', (e) => errs.push(String(e)));
  const dialogs = []; let dismissNext = false;
  pg.on('dialog', (d) => { dialogs.push(d.message()); if (dismissNext) { dismissNext = false; d.dismiss(); } else d.accept(); });
  await pg.addInitScript((s) => { if (!window.__seeded) { window.__seeded = 1; Object.keys(s).forEach((k) => localStorage.setItem(k, s[k])); } }, SEED);
  const cacheNames = () => pg.evaluate(() => caches.keys());
  const regs = () => pg.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.map((x) => x.scope)));
  const ls = () => pg.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });

  /* ---- ① 古いアプリを開いて、控えを作らせる ---- */
  await pg.goto(OLD + '/docomo-quote/?kqtest=1');
  await pg.evaluate(() => navigator.serviceWorker.ready.then(() => null));
  let names = [];
  for (let i = 0; i < 40 && !names.some((n) => /^dq-v/.test(n)); i++) { await wait(300); names = await cacheNames(); }
  chk('① 古い社内版ケータイの控え（dq-v*）ができる', names.some((n) => /^dq-v/.test(n)), names.join(','));
  await pg.goto(OLD + '/docomo-quote/ienaka/');
  await pg.evaluate(() => navigator.serviceWorker.ready.then(() => null));
  for (let i = 0; i < 40 && !names.some((n) => /^ienaka-internal-v/.test(n)); i++) { await wait(300); names = await cacheNames(); }
  chk('① 古い社内版イエナカの控え（ienaka-internal-v*）ができる', names.some((n) => /^ienaka-internal-v/.test(n)), names.join(','));
  // 同居する別サイト（/other/）のオフライン係と控え
  await pg.goto(OLD + '/other/');
  await pg.evaluate(() => navigator.serviceWorker.ready.then(() => null));
  for (let i = 0; i < 40 && !names.includes('other-site-v1'); i++) { await wait(300); names = await cacheNames(); }
  const regsBefore = await regs();
  chk('① オフライン係が3つ（/docomo-quote/・/docomo-quote/ienaka/・別サイト /other/）登録されている', regsBefore.length === 3 && names.includes('other-site-v1'), regsBefore.join(','));

  /* ---- ② 案内ページに差し替えて開き直す ---- */
  state.dir = STUB;
  await pg.goto(OLD + '/docomo-quote/');
  await wait(2500);
  const body = await pg.evaluate(() => document.body.innerText);
  const html = await pg.content();
  chk('② 案内ページが出る（古いアプリではない）', /引っ越しました/.test(body) && !document_has(body), body.slice(0, 80));
  chk('② 新しい住所はページに書かれていない（店内の案内を見てもらう）', !/naibu-test/.test(html) && /店内の案内/.test(body));
  function document_has(t) { return /ご自身の担当者コード|光・5G/.test(t); }
  let regsAfter = await regs();
  for (let i = 0; i < 20 && regsAfter.some((sc) => sc.indexOf('/docomo-quote/') >= 0); i++) { await wait(300); regsAfter = await regs(); }
  chk('② /docomo-quote/ の下のオフライン係がすべて外れる', !regsAfter.some((sc) => sc.indexOf('/docomo-quote/') >= 0), regsAfter.join(','));
  chk('② 同居する別サイト（/other/）のオフライン係は外さない', regsAfter.some((sc) => sc.indexOf('/other/') >= 0), regsAfter.join(','));
  names = await cacheNames();
  chk('② 社内版・開発コピーの控えが消える', !names.some((n) => /^(dq-|kq-|ienaka-|dk-)/.test(n)), names.join(','));
  chk('② 同居する別サイトの控えは消さない', names.includes('other-site-v1'), names.join(','));

  /* ---- ③ /ienaka/ も案内になる ---- */
  await pg.goto(OLD + '/docomo-quote/ienaka/');
  await wait(800);
  const body3 = await pg.evaluate(() => document.body.innerText);
  chk('③ /ienaka/ を開いても古いイエナカが控えから起きず、案内が出る', /引っ越しました/.test(body3) && /イエナカ/.test(body3), body3.slice(0, 80));

  /* ---- ③b /ienaka/ しか開かない端末（ルートを一度も開かない）でも片付く ---- */
  {
    state.dir = ROOT;
    const c3 = await b.newContext();
    const p3 = await c3.newPage(); p3.setDefaultTimeout(10000);
    p3.on('pageerror', (e) => errs.push(String(e)));
    await p3.goto(OLD + '/docomo-quote/ienaka/');
    await p3.evaluate(() => navigator.serviceWorker.ready.then(() => null));
    let n3 = [];
    for (let i = 0; i < 40 && !n3.some((n) => /^ienaka-internal-v/.test(n)); i++) { await wait(300); n3 = await p3.evaluate(() => caches.keys()); }
    chk('③b イエナカだけ使う端末にも控えができる', n3.some((n) => /^ienaka-internal-v/.test(n)), n3.join(','));
    state.dir = STUB;
    await p3.goto(OLD + '/docomo-quote/ienaka/');
    await wait(2500);
    const b3 = await p3.evaluate(() => document.body.innerText);
    let r3 = await p3.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.map((x) => x.scope)));
    for (let i = 0; i < 20 && r3.length; i++) { await wait(300); r3 = await p3.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.map((x) => x.scope))); }
    n3 = await p3.evaluate(() => caches.keys());
    chk('③b ルートを開かなくても /ienaka/ の案内が出て、オフライン係と控えが片付く', /引っ越しました/.test(b3) && r3.length === 0 && !n3.some((n) => /^ienaka-/.test(n)), r3.join(',') + ' / ' + n3.join(','));
    await c3.close();
  }
  /* 全入口に index.html と sw.js の組があること（入口ごとに受け持ち範囲が別なので、1つでも欠けると古いアプリが残る） */
  {
    const missing = ['', 'ienaka', 'ienaka-tokiwahigashi', 'keitai-app', 'ienaka-app', 'ienaka-demo', 'ienaka-tiles', 'dakkan-app']
      .flatMap((d) => ['index.html', 'sw.js'].map((f) => path.posix.join(d, f))).filter((f) => !fs.existsSync(path.join(STUB, f)));
    chk('全入口（8か所）に案内と片付け用 sw.js がある', missing.length === 0, missing.join(','));
  }

  /* ---- ④ 端末の保存は残り、持ち出せる ---- */
  await pg.goto(OLD + '/docomo-quote/');
  await wait(500);
  const l4 = await ls();
  chk('④ 端末の保存（localStorage）は消えていない', l4['dq-saved-v1:s1'] === SEED['dq-saved-v1:s1'] && l4['kq-config-v1'] === SEED['kq-config-v1']);
  const counts = await pg.evaluate(() => document.getElementById('counts').textContent);
  chk('④ 画面にこの端末の件数が出る', /保存した見積もり 1件/.test(counts) && /佐藤/.test(counts), counts);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.evaluate(() => document.getElementById('exportBtn').click())]);
  const file = path.join(STUB, 'export.json');
  await dl.saveAs(file);
  const ex = JSON.parse(fs.readFileSync(file, 'utf8'));
  chk('④ 持ち出しファイルは新しい住所の「持ち込む」と同じ形式', ex.kind === 'frontalk-internal-move' && /共有しない/.test(ex.note || '') && /localhost/.test(ex.from));
  const keys = Object.keys(ex.keys || {});
  chk('④ 社内版の鍵だけが入る', keys.includes('dq-config-v1') && keys.includes('dq-saved-v1:s1') && keys.includes('ienaka-internal-config-v1') && !keys.includes('kq-config-v1'), keys.join(','));
  chk('④ 持ち出しても端末の中身は消えない', (await ls())['dq-saved-v1:s1'] === SEED['dq-saved-v1:s1']);

  /* 新しい住所側で本当に読めるか（アプリの持ち込みに通す） */
  state.dir = ROOT;
  const c2 = await b.newContext({ serviceWorkers: 'block' });
  await c2.route('**/*', (r) => (r.request().url().includes('gstatic.com') ? r.abort() : r.continue()));
  const p2 = await c2.newPage(); p2.on('dialog', (d) => d.accept()); p2.on('pageerror', (e) => errs.push(String(e)));
  await p2.goto(NEW + '/?kqtest=1'); await wait(1000);
  await p2.evaluate((json) => { document.getElementById('movePasteText').value = json; document.getElementById('movePasteBtn').click(); }, fs.readFileSync(file, 'utf8'));
  await wait(800); await p2.waitForLoadState('load'); await wait(1000);
  const l5 = await p2.evaluate(() => ({ s: localStorage.getItem('dq-saved-v1:s1'), k: localStorage.getItem('kq-config-v1'), m: localStorage.getItem('dq-moved-v1') }));
  chk('④ 新しい住所のアプリがそのファイルを持ち込める', l5.s === SEED['dq-saved-v1:s1'] && l5.k === null && /localhost/.test(l5.m || ''), JSON.stringify(l5).slice(0, 120));
  await c2.close();
  state.dir = STUB;

  /* ---- ⑤ 旧データを消す（二度たずねる） ---- */
  dialogs.length = 0; dismissNext = true;
  await pg.evaluate(() => document.getElementById('wipeBtn').click());
  await wait(300);
  chk('⑤ 「消す」は先に件数を見せてたずね、「いいえ」なら消さない', dialogs.length === 1 && /保存した見積もり 1件/.test(dialogs[0]) && (await ls())['dq-saved-v1:s1'] === SEED['dq-saved-v1:s1'], dialogs.join('|').slice(0, 100));
  dialogs.length = 0;
  await pg.evaluate(() => document.getElementById('wipeBtn').click());
  await wait(300);
  const l6 = await ls();
  chk('⑤ 二度「はい」で社内版の鍵だけ消える（開発コピーは残る）', dialogs.length === 2 && !('dq-saved-v1:s1' in l6) && !('dq-config-v1' in l6) && l6['kq-config-v1'] === SEED['kq-config-v1'], Object.keys(l6).join(','));

  await b.close(); srv.close(); srvOld.close();
  fs.rmSync(STUB, { recursive: true, force: true });
  fs.rmSync(OTHER, { recursive: true, force: true });
  const bad = errs.filter((e) => !/テスト用/.test(e));
  if (bad.length) { console.error('JSエラー:\n' + bad.join('\n')); process.exit(1); }
  if (ng) { console.error('旧住所の案内ページのテスト: NG ' + ng + '件'); process.exit(1); }
  console.log('旧住所の案内ページのテスト: ' + okN + '/' + okN + ' OK');
});
