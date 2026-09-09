/* 引っ越し（住所の変更）の「持ち出し → 持ち込み」の確認（2026-09-08）
 *
 *   node tests/run-move-tests.js
 *
 * なぜ要るか:
 *   社内版の配信先が変わると（github.io → 新しい住所）、端末の中の保存は住所ごとに別なので、
 *   新しい住所では空から始まる。クラウドに無いもの（お客様名・請求内訳の読み取り・作りかけの細部）は
 *   端末から運ぶしかない。運び方を間違えると、お客様名が消える／製品版の開発コピーの内容が
 *   混ざる／途中で失敗して半端な状態が残る。
 *
 * 見ているもの（お客様・店舗の目に映るもの）:
 *   ① 旧住所の「持ち出す」で出るファイルに、社内版の鍵（dq-*・ienaka-internal-*・ienaka-hannan-*）だけが入り、
 *      製品版の開発コピー（kq-*）・デモ・一時的な引き渡しは入らない
 *   ② 新しい住所の最初の画面（初期設定）から持ち込めて、開き直したあと、お客様名・作りかけ・保存・
 *      イエナカの中身が旧住所と同じになる。「情報」に持ち込みの記録が出る
 *   ③ バックアップのファイル・対象外の鍵が混ざったファイルは拒否し、端末の中身を変えない
 *   ④ 新しい住所ですでに入力していた端末には、上書きする前にもう一度たずねる
 *   ⑤ 「貼り付けて持ち込む」でも同じ結果になる
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

const SEED = {
  'dq-config-v1': JSON.stringify({ storeName: 'ドコモショップ阪南店', storeTel: '', staff: [{ id: 's1', name: '佐藤', code: '1111' }], activeStaffId: 's1' }),
  'dq-saved-v1:s1': JSON.stringify([{ id: 'sv1', name: '山田様 9/1', custName: '山田 太郎', at: '2026/09/01 10:00', upAt: 1756700000000,
    data: { active: 0, patterns: [{ custName: '山田 太郎', planId: '' }] } }]),
  'dq-state-v1:s1': JSON.stringify({ active: 0, gen: 3, patterns: [{ custName: '作りかけ 鈴木' }] }),
  'dq-quote-at:s1': '1756800000000',
  'ienaka-internal-v1': JSON.stringify({ custName: 'イエナカのお客様', staffName: '佐藤' }),
  'ienaka-internal-config-v1': JSON.stringify({ storeName: 'ドコモショップ阪南店' }),
  'ienaka-hannan-config-v1': JSON.stringify({ storeName: '旧名の保存' }),
  'kq-config-v1': JSON.stringify({ storeName: '製品版の開発コピー' }),
  'ienaka-demo-config-v1': JSON.stringify({ storeName: 'デモ' }),
  'dq-handoff-v1': JSON.stringify({ from: 'ienaka', at: Date.now() })
};

srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  const { chromium } = playwright();
  const lo = { args: ['--no-sandbox', '--host-resolver-rules=MAP * 127.0.0.1:' + port] };
  if (fs.existsSync('/opt/pw-browsers/chromium')) lo.executablePath = '/opt/pw-browsers/chromium';
  const b = await chromium.launch(lo);
  const errs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-move-'));

  async function open(host, seed) {
    const c = await b.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    await c.route('**/*', (r) => (r.request().url().includes('gstatic.com') ? r.abort() : r.continue()));
    const pg = await c.newPage(); pg.setDefaultTimeout(8000);
    pg.on('pageerror', (e) => errs.push(host + ': ' + String(e)));
    pg.dialogs = []; pg.dismissIf = null;
    pg.on('dialog', (d) => { pg.dialogs.push(d.message()); if (pg.dismissIf && pg.dismissIf.test(d.message())) d.dismiss(); else d.accept(); });
    if (seed) await pg.addInitScript((s) => { if (!window.__seeded) { window.__seeded = 1; Object.keys(s).forEach((k) => localStorage.setItem(k, s[k])); } }, seed);
    await pg.goto('http://' + host + '/?kqtest=1');
    await wait(1000);
    return { pg, c };
  }
  const vis = (pg, id) => pg.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; }, id);
  const ls = (pg) => pg.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  const enterCode = async (pg) => { await pg.evaluate(() => { document.getElementById('staffCode').value = '1111'; document.getElementById('staffForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await wait(500); };
  const msg = (pg) => pg.evaluate(() => { const e = document.getElementById('moveMsg'); return e && !e.hidden ? e.textContent : ''; });

  /* ---- ① 旧住所で持ち出す ---- */
  let d = await open('old.example', SEED);
  chk('旧住所: 担当者コードの画面が出る', await vis(d.pg, 'staffOverlay'));
  await enterCode(d.pg);
  chk('旧住所: 「引っ越し」の欄が出ている（社内版）', await vis(d.pg, 'moveCard') || await d.pg.evaluate(() => !document.getElementById('moveCard').hidden));
  const [dl] = await Promise.all([
    d.pg.waitForEvent('download'),
    d.pg.evaluate(() => document.getElementById('moveExportBtn').click())
  ]);
  const file = path.join(tmp, 'export.json');
  await dl.saveAs(file);
  const ex = JSON.parse(fs.readFileSync(file, 'utf8'));
  chk('① 持ち出しファイルに目印がある', ex.kind === 'frontalk-internal-move' && /old\.example/.test(ex.from) && /共有しない/.test(ex.note || ''), ex.kind + ' ' + ex.from);
  const keys = Object.keys(ex.keys || {});
  chk('① 社内版の鍵が入っている', ['dq-config-v1', 'dq-saved-v1:s1', 'dq-state-v1:s1', 'dq-quote-at:s1', 'ienaka-internal-v1', 'ienaka-internal-config-v1', 'ienaka-hannan-config-v1'].every((k) => keys.includes(k)), keys.join(','));
  chk('① 製品版の開発コピー・デモ・一時的な引き渡しは入らない', !keys.some((k) => /^(kq-|ienaka-demo-)/.test(k) || k === 'dq-handoff-v1'), keys.filter((k) => /^(kq-|ienaka-demo-)/.test(k) || k === 'dq-handoff-v1').join(','));
  chk('① ファイル名が分かりやすい', /^frontalk-naibu-move_\d{8}-\d{4}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const m1 = await msg(d.pg);
  chk('① 画面に持ち出した内容（保存 1件・担当者）が出る', /持ち出しました/.test(m1) && /保存した見積もり 1件/.test(m1) && /佐藤/.test(m1), m1.slice(0, 120));
  chk('① 持ち出しても旧住所の中身は消えない', (await ls(d.pg))['dq-saved-v1:s1'] === ex.keys['dq-saved-v1:s1']);
  await d.c.close();

  /* ---- ② 新しい住所の最初の画面から持ち込む ---- */
  d = await open('new.example', null);
  chk('新住所: はじめは初期設定の画面（端末内モード）', await vis(d.pg, 'setupOverlay'));
  chk('新住所: 初期設定の画面に「旧アドレスから持ち込む」がある', await vis(d.pg, 'setupMoveWrap'));
  await d.pg.setInputFiles('#moveImportFile', file);
  await wait(800);
  chk('② 取り込む前に内容をたずねる', d.pg.dialogs.some((t) => /old\.example/.test(t) && /保存した見積もり 1件/.test(t) && /クラウドには書きません/.test(t)), d.pg.dialogs.join(' | ').slice(0, 160));
  chk('② 開いただけの新端末には「すでに保存や作りかけがあります」の念押しは出ない', !d.pg.dialogs.some((t) => /すでに保存や作りかけ/.test(t)), d.pg.dialogs.join(' | ').slice(0, 160));
  chk('② 「持ち込みました」と知らせて開き直す', d.pg.dialogs.some((t) => /持ち込みました/.test(t)));
  await d.pg.waitForLoadState('load'); await wait(1200);
  const after = await ls(d.pg);
  /* 開き直すと、アプリ自身が「記録（dq-log-v1）」と「開いた時刻（dq-quote-at:*）」を書き換える。それ以外は同じであること */
  const same = (k) => /^dq-log-v1$|^dq-quote-at:/.test(k) || after[k] === ex.keys[k];
  chk('② 持ち出した鍵がすべて同じ中身で入っている', keys.every(same) && ('dq-quote-at:s1' in after), keys.filter((k) => !same(k)).join(','));
  chk('② 対象外の鍵は新住所に無い', !('kq-config-v1' in after) && !('ienaka-demo-config-v1' in after) && !('dq-handoff-v1' in after));
  chk('② 持ち込みの記録が残る', /old\.example/.test(after['dq-moved-v1'] || ''), after['dq-moved-v1']);
  chk('② 開き直すと担当者コードの画面（旧住所の担当者）', await vis(d.pg, 'staffOverlay') && !(await vis(d.pg, 'setupOverlay')));
  await enterCode(d.pg);
  const cust = await d.pg.evaluate(() => document.getElementById('custName').value);
  chk('② 作りかけのお客様名が残っている', cust === '作りかけ 鈴木', cust);
  const savedText = await d.pg.evaluate(() => window.__KQ_TEST__.saved.listText());
  const savedRaw = after['dq-saved-v1:s1'] || '';
  chk('② 保存した見積もりにお客様名が残っている', /山田 太郎/.test(savedRaw) && /1件/.test(savedText), savedText.slice(0, 80));
  await d.pg.evaluate(() => document.getElementById('aboutBtn').click()); await wait(300);
  await d.pg.evaluate(() => document.getElementById('aboutDiagBtn').click()); await wait(300);
  const diag = await d.pg.evaluate(() => document.getElementById('aboutDiagText').textContent);
  chk('② 「情報」に持ち込みの記録が出る', /引っ越し: .*old\.example/.test(diag), (diag.match(/引っ越し:[^\n]*/) || [''])[0]);
  await d.pg.evaluate(() => document.getElementById('aboutClose').click());

  /* ---- ③ 拒否するファイル ---- */
  const snap = await ls(d.pg);
  const bk = path.join(tmp, 'backup.json');
  fs.writeFileSync(bk, JSON.stringify({ kind: 'keitai-quote-backup', version: 1, master: {}, config: {} }));
  d.pg.dialogs = [];
  await d.pg.setInputFiles('#moveImportFile', bk); await wait(500);
  chk('③ バックアップのファイルは断る', /バックアップ/.test(await msg(d.pg)) && !d.pg.dialogs.length, await msg(d.pg));
  const mixed = path.join(tmp, 'mixed.json');
  fs.writeFileSync(mixed, JSON.stringify(Object.assign({}, ex, { keys: Object.assign({}, ex.keys, { 'kq-config-v1': '{}' }) })));
  await d.pg.setInputFiles('#moveImportFile', mixed); await wait(500);
  chk('③ 対象外の鍵が混ざったファイルは断る', /対象外/.test(await msg(d.pg)) && !d.pg.dialogs.length, await msg(d.pg));
  const snap2 = await ls(d.pg);
  chk('③ 断ったときは端末の中身を変えない', JSON.stringify(snap) === JSON.stringify(snap2));

  /* ---- ④ 新しい住所ですでに保存がある端末（使い始めた端末） ---- */
  await d.pg.evaluate(() => localStorage.setItem('dq-saved-v1:s1', JSON.stringify([{ id: 'n1', name: '新住所で保存', custName: '新住所のお客様', data: { patterns: [{}] } }, { id: 'n2', name: '2件目', data: { patterns: [{}] } }])));
  d.pg.dialogs = []; d.pg.dismissIf = /すでに保存や作りかけがあります/;
  await d.pg.setInputFiles('#moveImportFile', file); await wait(800);
  chk('④ 使い始めた端末には、この端末の件数（保存 2件）を見せて念を押す', d.pg.dialogs.some((t) => /すでに保存や作りかけがあります/.test(t) && /いまこの端末: 保存した見積もり 2件/.test(t)), d.pg.dialogs.join(' | ').slice(0, 200));
  chk('④ 「いいえ」なら何も変えない', !d.pg.dialogs.some((t) => /持ち込みました/.test(t)) && /新住所のお客様/.test((await ls(d.pg))['dq-saved-v1:s1'] || ''));
  await d.c.close();

  /* ---- ⑤ 貼り付けて持ち込む ---- */
  d = await open('paste.example', null);
  await d.pg.evaluate((json) => { document.getElementById('movePasteText').value = json; document.getElementById('movePasteBtn').click(); }, fs.readFileSync(file, 'utf8'));
  await wait(800);
  await d.pg.waitForLoadState('load'); await wait(1200);
  const after5 = await ls(d.pg);
  chk('⑤ 貼り付けでも同じ中身が入る', keys.every((k) => /^dq-log-v1$|^dq-quote-at:/.test(k) || after5[k] === ex.keys[k]) && !('kq-config-v1' in after5), keys.filter((k) => after5[k] !== ex.keys[k]).join(','));
  await d.c.close();

  await b.close(); srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const bad = errs.filter((e) => !/テスト用/.test(e));
  if (bad.length) { console.error('JSエラー:\n' + bad.join('\n')); process.exit(1); }
  if (ng) { console.error('引っ越し（持ち出し・持ち込み）のテスト: NG ' + ng + '件'); process.exit(1); }
  console.log('引っ越し（持ち出し・持ち込み）のテスト: ' + okN + '/' + okN + ' OK');
});
