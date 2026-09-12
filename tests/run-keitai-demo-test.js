/* 営業用デモ（/keitai-demo/）の確認
 *
 *   node tests/run-keitai-demo-test.js
 *
 * なぜ要るか（2026-09-12）:
 *   デモは大人数の場で配る。製品版と同じ住所に置くため、間違えると
 *   ・デモの入力が製品版の保存（kq-*）を書き換える
 *   ・デモからログイン画面が出て、本番のクラウドへの入口になる
 *   という事故になる。ここでは実際のブラウザで開いて、
 *   ・ログイン無しで見積もりの画面まで入れること
 *   ・保存の接頭辞が kqdemo- で、製品版の kq-* を触らないこと
 *   ・Firebase を読み込まず、Service Worker も登録しないこと
 *   ・デモだと分かる表示が出ること
 *   を確かめる。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'keitai-demo');

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(dir, decodeURIComponent(p.replace(/^\//, '')));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let ng = 0;
const ok = (cond, msg, extra) => { if (!cond) { ng++; console.log('NG  ' + msg + (extra ? '  ' + extra : '')); } else console.log('ok  ' + msg); };

(async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-keitai-demo.js')], { stdio: 'ignore' });

  /* ① 中身の確認（配ってはいけないものが無いか） */
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  ok(html.indexOf('gstatic.com/firebasejs') < 0, 'Firebase を読み込んでいない');
  ok(html.indexOf('firebase-config.js') < 0, 'クラウドの接続先を持っていない');
  ok(html.indexOf("serviceWorker' in navigator") < 0, 'Service Worker を登録しない');
  ok(html.indexOf('window.KEITAI_DEMO = true') >= 0, 'デモの印が立っている');
  ok(html.indexOf('name="robots" content="noindex"') >= 0, '検索よけが入っている');
  ok(html.indexOf('manifest.webmanifest') < 0, 'ホーム画面に入れない（manifest なし）');
  ok(html.indexOf('id="toIenaka"') < 0, 'イエナカ単体版へのリンクが無い');
  ok(!fs.existsSync(path.join(OUT, 'sw.js')) && !fs.existsSync(path.join(OUT, 'firebase-config.js')), '同梱してはいけないファイルが無い');
  const appjs = fs.readFileSync(path.join(OUT, 'app.js'), 'utf8');
  const ver = (appjs.match(/var APP_VERSION = "([^"]+)"/) || [])[1] || '';
  ok(/-demo$/.test(ver), '版に -demo が付いている', ver);

  /* ② 実際のブラウザで開く */
  const { chromium } = playwright();
  const launchOpts = { args: ['--no-sandbox'] };
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  const srv = await serve(OUT);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  const reqs = [];
  page.on('request', (r) => reqs.push(r.url()));

  /* 製品版の保存が同じ住所にある状態を作る（デモがこれを触らないことを見る） */
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('kq-master-v1', JSON.stringify({ 本物: true }));
    localStorage.setItem('kq-config-v1', JSON.stringify({ storeName: '本物の店', staff: [{ id: 's1', name: '本物担当', code: '1234' }] }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const st = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!(e && !e.hidden && e.offsetParent !== null); };
    const keys = Object.keys(localStorage);
    return {
      login: vis('loginBox') || vis('loginForm') || vis('lockBox'),
      setup: vis('setupOverlay'),
      staffGate: vis('staffGate'),
      quote: vis('tab-quote') || !!document.querySelector('#planSel, [id^="plan"]'),
      warn: (document.getElementById('cloudWarn') || {}).textContent || '',
      demoBadge: !!document.querySelector('.demo-badge'),
      store: (document.getElementById('storeNameInput') || {}).value || '',
      keys: keys,
      kqMaster: localStorage.getItem('kq-master-v1'),
      kqConfig: localStorage.getItem('kq-config-v1'),
      title: document.title
    };
  });

  ok(!st.login, 'ログイン画面が出ない');
  ok(!st.setup, '初期設定の画面が出ない');
  ok(st.demoBadge, '「デモ版」の札が出ている');
  ok(/デモ版/.test(st.warn) && /この端末の中だけ/.test(st.warn), 'デモの説明が画面の上に出る', st.warn.slice(0, 40));
  ok(/デモ版/.test(st.title), '題名にデモ版が入っている', st.title);
  ok(st.keys.some((k) => k.indexOf('kqdemo-') === 0), 'デモの保存は kqdemo- で始まる',
    st.keys.filter((k) => k.indexOf('kqdemo') === 0).slice(0, 3).join(' '));
  ok(!st.keys.some((k) => k.indexOf('kq-') === 0 && k.indexOf('kqdemo') !== 0 && k !== 'kq-master-v1' && k !== 'kq-config-v1'),
    'デモが製品版の保存（kq-*）を新しく作らない',
    st.keys.filter((k) => k.indexOf('kq-') === 0 && k.indexOf('kqdemo') !== 0).join(' '));
  ok(st.kqMaster === JSON.stringify({ 本物: true }), '製品版の料金マスタを書き換えない');
  ok(/本物の店/.test(String(st.kqConfig)), '製品版の店舗設定を書き換えない');
  ok(reqs.every((u) => u.indexOf('gstatic.com') < 0 && u.indexOf('googleapis.com') < 0), '外のクラウドへ通信しない',
    reqs.filter((u) => u.indexOf('gstatic') >= 0 || u.indexOf('googleapis') >= 0).join(' '));
  ok(errs.length === 0, 'JS のエラーが出ない', errs.slice(0, 2).join(' | '));

  /* ③ 見積もりが計算できる（デモとして最低限使える） */
  const calc = await page.evaluate(() => {
    const sel = document.querySelector('select[id^="plan"]');
    if (!sel) return { ok: false, why: 'プランの選択欄が見つからない' };
    const opt = Array.from(sel.options).find((o) => o.value && o.value !== '');
    if (!opt) return { ok: false, why: 'プランの選択肢が無い' };
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, plan: opt.text };
  });
  ok(calc.ok, 'プランを選べる', calc.why || calc.plan);
  await page.waitForTimeout(600);
  const total = await page.evaluate(() => (document.body.innerText.match(/[0-9１-９][0-9,，]*\s*円/) || [''])[0]);
  ok(!!total, '金額が画面に出る', total);

  await ctx.close();
  await browser.close();
  srv.close();

  console.log(ng === 0 ? '\n営業用デモ（ケータイ）: 問題なし' : `\n営業用デモ（ケータイ）: NG ${ng}件`);
  process.exit(ng === 0 ? 0 : 1);
})();
