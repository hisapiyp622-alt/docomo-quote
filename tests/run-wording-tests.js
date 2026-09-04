/* 画面の案内文が、実在しない場所を指していないかの確認（製品化レビュー 5-4・5-8）
 *
 * 使い方: node tests/run-wording-tests.js
 *
 * なぜ要るか:
 *   チュートリアルやヘルプが「実績タブ」「マスタ設定タブ」と書いていたが、
 *   実際のタブは 見積もり／光・5G／見積書／引き継ぎ／保存 の5つで、
 *   実績は「保存」タブの中、マスタ設定は担当者コードの画面から開く。
 *   案内どおりに探しても見つからないので、導入時とデモで必ずつまずく。
 *
 * やり方:
 *   実際にブラウザで開いて、お店の人が読める文章（チュートリアル・ヘルプ・
 *   画面のヒント）だけを集め、「◯◯タブ」と書いてある◯◯が
 *   本物のタブ名かどうかを見る。コードのコメントは対象にしない。
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
  else ng.push(name + (extra ? '\n      ' + extra : ''));
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
      '.svg': 'image/svg+xml', '.md': 'text/markdown',
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
  await page.waitForTimeout(700);
  await page.click('#setupSkip').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('#tourSkip').catch(() => {});
  await page.waitForFunction(() => window.__KQ_TEST__ && window.__KQ_TEST__.wording, null, { timeout: 8000 });

  const w = await page.evaluate(() => window.__KQ_TEST__.wording());

  chk('① タブの名前を読み取れる', w.tabs.length === 5, JSON.stringify(w.tabs));
  chk('① 読んでもらう文章を集められる', w.texts.length > 20, String(w.texts.length));

  /* 「◯◯タブ」の◯◯が本物のタブ名かどうか。
   * 「見積書タブへ」のように正しく書いてあるものは通す。
   * 「タブ区切り」は文字のタブのことなので、はじめから除く。 */
  function badTabs(t, where) {
    const out = [];
    // 太字などの飾りを外してから見る（**保存**タブ のような書き方があるため）
    const flat = String(t).replace(/[*_`]/g, '');
    let i = -1;
    while ((i = flat.indexOf('タブ', i + 1)) >= 0) {
      if (flat.slice(i, i + 5) === 'タブ区切り') continue;
      // 「見積書」タブ のようにカギかっこで囲む書き方も正しいので、囲みは外して見る
      const before = flat.slice(Math.max(0, i - 12), i).replace(/[」』"']+$/, '');
      // 直前が本物のタブ名で終わっていればよい
      if (w.tabs.some((name) => before.endsWith(name))) continue;
      out.push(`${where}「…${before.slice(-8)}タブ」`
        + `… ${flat.slice(Math.max(0, i - 30), i + 25).replace(/\s+/g, ' ')}`);
    }
    return out;
  }

  const bad = [];
  w.texts.forEach((t) => { badTabs(t, '').forEach((x) => bad.push(x)); });
  chk('② 実在しないタブを案内していない', !bad.length,
    bad.join('\n      ') + '\n      本物のタブ: ' + w.tabs.join('／'));

  // アプリ内から開ける手引き（マークダウン）も同じ目で見る
  const docs = ['STATS_GUIDE.md', 'SUPPORT.md', 'TERMS.md'];
  const docBad = [];
  docs.forEach((d) => {
    const f = path.join(ROOT, 'keitai-app', d);
    if (!fs.existsSync(f)) return;
    badTabs(fs.readFileSync(f, 'utf8'), d + ': ').forEach((x) => docBad.push(x));
  });
  chk('③ アプリ内から開く手引きも、実在しないタブを案内していない',
    !docBad.length, docBad.join('\n      '));

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (ng.length) {
    console.error('案内文に、実在しない場所への案内があります:\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('案内文の確認: ' + ok.length + '/' + ok.length + ' OK'
    + '（タブ: ' + w.tabs.join('／') + '／読んだ文章 ' + w.texts.length + '件）');
})();
