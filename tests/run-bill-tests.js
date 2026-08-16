/* 請求内訳の読み取り（parseBillText）のテスト
 *
 * 使い方: node tests/run-bill-tests.js
 *
 * 仕組み: keitai-app を ?kqtest=1 付きで Chromium に読み込み、
 * window.__KQ_TEST__.parseBill() に請求内訳の文字起こしを渡して結果を検算する。
 * 期待値はこのファイルに直書き（読み取りの仕様書を兼ねる）。
 * あわせて、読み取った内容（curBill）が同期ペイロードに漏れないことも検査する。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

/* ケース: input は読み取りに渡す文字列、expect は結果の一部一致ではなく完全一致。
 * check(result) を書くと追加の検査もできる。 */
const CASES = [
  {
    name: '紙の請求書（全角・カテゴリ小計と明細の両方・個人情報入り）',
    input: [
      'お客様電話番号等　０９０－０１２３－４５６７',
      '２０２６年　７月ご請求分',
      'ご利用料金の内訳',
      '内訳項目　金額（円）',
      '◇基本使用料（計）　５，０７８',
      'ｅｘｉｍｏ　～１ＧＢ　５，０７８　合算',
      'かけ放題オプション定額料　１，９８０　合算',
      'みんなドコモ割　－１，１００　合算',
      'ドコモ光セット割　－１，１００',
      'ケータイ補償サービス利用料（５００）　５００',
      'ユニバーサルサービス料／基本　２',
      '電話リレーサービス料／基本　１',
      '◇端末等代金分割支払金　２，４５０',
      '端末等代金分割支払金　２，４５０',
      '８回目のご請求です。（全２４回）',
      '◇消費税等相当額（計）　５４８',
      '消費税等相当額（合計）　５４８',
      '◇合計　８，３５９',
      '（お客様番号　０３６４－１２３４－５６７８９）'
    ].join('\n'),
    expect: {
      lines: [
        { n: 'eximo ~1GB', a: 5078 },
        { n: 'かけ放題オプション定額料', a: 1980 },
        { n: 'みんなドコモ割', a: -1100 },
        { n: 'ドコモ光セット割', a: -1100 },
        { n: 'ケータイ補償サービス利用料(500)', a: 500 },
        { n: 'ユニバーサルサービス料/基本', a: 2 },
        { n: '電話リレーサービス料/基本', a: 1 },
        { n: '端末等代金分割支払金', a: 2450 },
        { n: '消費税等相当額(合計)', a: 548 }
      ],
      total: 8359, month: '2026年7月', dropped: 2
    },
    check(r) {
      // 個人情報（電話番号・お客様番号）が結果のどこにも残っていないこと
      const s = JSON.stringify(r);
      for (const leak of ['0123', '4567', '0364', '56789', '090']) {
        if (s.includes(leak)) return `個人情報らしき数字が結果に残っている: ${leak}`;
      }
      return '';
    }
  },
  {
    name: 'My docomo（カテゴリ小計だけを写した場合は小計を使う）',
    input: [
      'ご利用料金の内訳',
      '◇基本使用料等（計）　４，５６５',
      '◇その他ご利用料金等（計）　５０３',
      '◇消費税等相当額（計）　５０６',
      '◇端末等代金分割支払金　２，４５０',
      '合計金額　８，０２４'
    ].join('\n'),
    expect: {
      lines: [
        { n: '基本使用料等', a: 4565 },
        { n: 'その他ご利用料金等', a: 503 },
        { n: '消費税等相当額', a: 506 },
        { n: '端末等代金分割支払金', a: 2450 }
      ],
      total: 8024, month: '', dropped: 0
    }
  },
  {
    name: 'スキャンで金額が次の行に割れた場合（項目名とつなぐ）',
    input: [
      'ｅｘｉｍｏ',
      '５，０７８',
      '',
      '5分通話無料オプション定額料',
      '８８０円'
    ].join('\n'),
    expect: {
      lines: [
        { n: 'eximo', a: 5078 },
        { n: '5分通話無料オプション定額料', a: 880 }
      ],
      total: null, month: '', dropped: 0
    }
  },
  {
    name: '割引のマイナス表記（▲・－・-）',
    input: [
      'ドコモ光セット割　▲１，１００',
      'みんなドコモ割 -1,100',
      'dカードお支払割　－１８７'
    ].join('\n'),
    expect: {
      lines: [
        { n: 'ドコモ光セット割', a: -1100 },
        { n: 'みんなドコモ割', a: -1100 },
        { n: 'dカードお支払割', a: -187 }
      ],
      total: null, month: '', dropped: 0
    }
  },
  {
    name: '合計しか読めなかった場合は合計を1行にする',
    input: 'ご請求金額　９，８７６',
    expect: {
      lines: [{ n: 'ご請求金額', a: 9876 }],
      total: 9876, month: '', dropped: 0
    }
  },
  {
    name: '金額の行が無ければ空（エラーにしない）',
    input: 'ドコモショップで機種変更のご相談\nありがとうございました',
    expect: { lines: [], total: null, month: '', dropped: 0 }
  },
  {
    name: 'スキャンで区切りが「.」「・」に化けた電話番号・長い番号も残さない',
    input: [
      '090.1234.5678',
      '090・1234・5678',
      '1234.5678.9012.3456',
      'eximo　5,078'
    ].join('\n'),
    expect: { lines: [{ n: 'eximo', a: 5078 }], total: null, month: '', dropped: 3 },
    check(r) {
      const s = JSON.stringify(r);
      for (const leak of ['1234', '5678', '9012', '3456', '090']) {
        if (s.includes(leak)) return `番号らしき数字が結果に残っている: ${leak}`;
      }
      return '';
    }
  },
  {
    name: '宛先の住所行（都道府県から始まる行）を残さない',
    input: [
      '大阪府阪南市尾崎町1-2-3',
      '神奈川県横浜市中区4-5-6',
      'eximo　5,078'
    ].join('\n'),
    expect: { lines: [{ n: 'eximo', a: 5078 }], total: null, month: '', dropped: 2 },
    check(r) {
      const s = JSON.stringify(r);
      if (s.includes('阪南') || s.includes('横浜')) return '住所が結果に残っている';
      return '';
    }
  },
  {
    name: '合計行の表記ゆれ（ご請求金額(税込)・ご利用料金合計）も合計として扱う',
    input: 'ご請求金額（税込）　８，０２４',
    expect: { lines: [{ n: 'ご請求金額', a: 8024 }], total: 8024, month: '', dropped: 0 }
  },
  {
    name: '数字で終わる項目名（U15）の末尾を金額と読み違えない',
    input: [
      'ドコモ スマホデビュープラン U15',
      '１，９８０'
    ].join('\n'),
    expect: {
      lines: [{ n: 'ドコモ スマホデビュープラン U15', a: 1980 }],
      total: null, month: '', dropped: 0
    }
  },
  {
    name: 'カメラOCRの読み癖（桁区切りの「,」が「.」になる・区切り後の空白）を直す',
    input: [
      'かけ放題オプション定額料 1.980',
      'みんなドコモ割 -1.100',
      'eximo　5, 078',
      '合計 8,408'
    ].join('\n'),
    expect: {
      lines: [
        { n: 'かけ放題オプション定額料', a: 1980 },
        { n: 'みんなドコモ割', a: -1100 },
        { n: 'eximo', a: 5078 }
      ],
      total: 8408, month: '', dropped: 0
    }
  }
];

function serve() {
  const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown', '.webmanifest': 'application/manifest+json' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, decodeURIComponent(p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const { chromium } = playwright();
  const srv = await serve();
  const port = srv.address().port;
  const launchOpts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) launchOpts.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('gstatic.com')) return route.abort();
    if (url.endsWith('firebase-config.js')) {
      let js = fs.readFileSync(path.join(ROOT, 'keitai-app/firebase-config.js'), 'utf8');
      js = js.replace(/projectId:\s*"[^"]*"/, 'projectId: ""'); // 端末内モードで起動
      return route.fulfill({ contentType: 'application/javascript', body: js });
    }
    if (/\/keitai-app\/(index\.html)?(\?.*)?$/.test(url)) {
      let html = fs.readFileSync(path.join(ROOT, 'keitai-app/index.html'), 'utf8');
      html = html.replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>/g, '');
      html = html.replace("'serviceWorker' in navigator", "false && 'serviceWorker' in navigator");
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    return route.continue();
  });

  await page.goto(`http://127.0.0.1:${port}/keitai-app/?kqtest=1`);
  await page.waitForTimeout(600);
  page.once('dialog', (d) => d.accept());
  await page.click('#setupSkip').catch(() => {});
  await page.waitForTimeout(600);
  await page.click('#tourSkip').catch(() => {});
  await page.waitForFunction(() => window.__KQ_TEST__, null, { timeout: 5000 });

  let ok = 0; const bad = [];
  for (const c of CASES) {
    const r = await page.evaluate((t) => window.__KQ_TEST__.parseBill(t), c.input);
    const a = JSON.stringify(c.expect);
    const b = JSON.stringify(r);
    let err = a === b ? '' : `\n    期待: ${a}\n    実際: ${b}`;
    if (!err && c.check) {
      const msg = c.check(r);
      if (msg) err = `\n    ${msg}`;
    }
    if (err) bad.push(`✗ ${c.name}${err}`); else ok++;
  }

  // 読み取った内容（curBill）が同期ペイロードに入らないこと
  const leak = await page.evaluate(() => {
    window.__KQ_TEST__.setCurBill({ lines: [{ n: '検査用の請求行', a: 1234 }], total: 1234, month: '2026年7月' });
    const payload = window.__KQ_TEST__.quotePayload();
    window.__KQ_TEST__.setCurBill(null);
    if (!payload) return '同期ペイロードを作れなかった';
    if (payload.indexOf('検査用の請求行') >= 0 || payload.indexOf('curBill') >= 0) {
      return '請求内訳（curBill）が同期ペイロードに含まれている';
    }
    return '';
  });
  if (leak) bad.push(`✗ 同期への漏えい検査: ${leak}`); else ok++;

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log(`請求内訳の読み取りテスト: ${ok}/${CASES.length + 1} OK`);
  if (bad.length) {
    console.error(bad.join('\n'));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
