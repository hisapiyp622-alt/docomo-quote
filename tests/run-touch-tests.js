/* 触って使う機器（iPad・iPhone）でだけ起きることの確認
 *
 * 使い方: node tests/run-touch-tests.js
 *
 * なぜ要るか（2026-09-05 リハーサルで見つけたこと）:
 *   iPhone・iPad の Safari は、**文字が16pxより小さい入力欄を触ると画面を拡大し、
 *   指を離しても元に戻りません**。お客様の前で画面が拡大したままになります。
 *
 *   1.156.0 で対策を入れたつもりでしたが、対策は
 *     @supports (-webkit-touch-callout: none) { input, select, textarea { ... } }
 *   と書かれており、`.field select` や `.tile select` のような
 *   **クラス付きの規則のほうが強い**ため、実際には22か所に当たっていませんでした。
 *   しかも Safari でしか効かない書き方なので、Chromium のテストでは
 *   規則ごと無視され、気づけませんでした。
 *
 * やり方:
 *   Chromium では @supports の条件が偽になるので、**同じ中身の規則を
 *   自分で入れて Safari と同じ状態を作り**、見えている入力欄の文字の
 *   大きさを測ります（!important の付け方まで本物と同じにすること。
 *   ここを強くしてしまうと、負けている欄を見逃します）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

/* 本物（style.css）から対策の中身をそのまま取り出して使う。
 * ここに書き写すと、本物を変えたときにテストだけ古くなるため。 */
function touchRule(file) {
  const css = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = css.match(/@supports\s*\(-webkit-touch-callout:\s*none\)\s*\{([\s\S]*?)\n\}/);
  return m ? m[1] : null;
}

const ok = [];
const ng = [];
function chk(name, cond, extra) {
  if (cond) ok.push(name);
  else ng.push(name + (extra ? '\n      ' + extra : ''));
}

const APPS = [
  { name: 'ケータイ見積もり', url: '/keitai-app/?kqtest=1', css: 'keitai-app/style.css' },
  { name: 'イエナカ単体版', url: '/ienaka-app/', css: 'ienaka-app/style.css' },
  { name: 'イエナカ デモ版', url: '/ienaka-demo/', css: 'ienaka-demo/style.css' }
];

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
  const errors = [];

  for (const app of APPS) {
    const rule = touchRule(app.css);
    chk(app.name + ': 触る機器向けの対策が書いてある', !!rule,
      app.css + ' に @supports (-webkit-touch-callout: none) が無い');
    if (!rule) continue;

    // iPad（縦）の大きさ・指で触る前提で開く
    const ctx = await browser.newContext({
      viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, serviceWorkers: 'block'
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(app.name + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await ctx.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('gstatic.com')) return route.abort();
      if (url.endsWith('firebase-config.js')) {
        return route.fulfill({ contentType: 'application/javascript', body: 'window.KEITAI_FIREBASE={};' });
      }
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}${app.url}`);
    await page.waitForTimeout(900);
    await page.click('#setupSkip').catch(() => {});
    await page.waitForTimeout(250);
    await page.click('#tourSkip').catch(() => {});
    await page.waitForTimeout(250);

    // Safari と同じ状態にする（強さも本物と同じにすること）
    await page.addStyleTag({ content: rule });
    await page.waitForTimeout(300);

    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input, select, textarea').forEach((el) => {
        if (el.offsetParent === null) return;                    // 見えていない欄は除く
        if (el.type === 'radio' || el.type === 'checkbox') return; // 触っても拡大しない
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 16) {
          const box = el.closest('[class]');
          out.push((el.id || el.name || el.tagName)
            + '（' + (box ? box.className.split(' ')[0] : '?') + '）' + px + 'px');
        }
      });
      return out;
    });
    chk(app.name + ': 見えている入力欄の文字がすべて16px以上', small.length === 0,
      small.join('\n      '));

    // 直したことで横にはみ出していないか（iPhone の狭い幅でも見る）
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: document.documentElement.clientWidth
    }));
    chk(app.name + ': iPhone の幅でも横にはみ出さない', over.doc <= over.win + 1,
      over.doc + 'px > ' + over.win + 'px');

    await ctx.close();
  }

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('触って使う機器で困ることがあります: ' + ok.length + '/' + (ok.length + ng.length)
      + '\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('触って使う機器の確認: ' + ok.length + '/' + ok.length + ' OK');
})();
