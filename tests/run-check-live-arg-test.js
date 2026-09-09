/* 配信先の確認の道具に渡す「住所」の受け取り方のテスト
 *
 *   node tests/run-check-live-arg-test.js
 *
 * なぜ要るか（2026-09-09・段階3）:
 *   GitHub の秘密に社内版の住所を貼るとき、日本語入力のままだと
 *   全角の英字（ｈｔｔｐｓ）や全角のコロン・空白・改行が混ざる。
 *   以前はそのまま curl に渡っていたため、通信がすべて拒まれ
 *   「NG 17件」という原因の分からない赤になった（本当は住所の文字の問題）。
 *   ここでは通信をせず、住所の受け取り方だけを見る。
 */
const { execFileSync } = require('child_process');
const path = require('path');

const TOOL = path.resolve(__dirname, '..', 'tools', 'check-live.js');
function run(arg, extra) {
  const args = [TOOL].concat(arg === null ? [] : [arg], ['--check-url'], extra || []);
  try { return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

let ng = 0;
const ok = (cond, msg, extra) => { if (!cond) { ng++; console.log('NG  ' + msg + (extra ? '  ' + extra : '')); } else console.log('ok  ' + msg); };

/* ① 日本語入力のまま打った住所を直せる */
const zen = run('　ｈｔｔｐｓ：／／example.pages.dev/ ');
ok(zen.code === 0 && /https:\/\/example\.pages\.dev\s*$/.test(zen.out.trim()), '全角・空白・末尾の / を取り除く', zen.out.trim());
ok(/全角/.test(zen.out), '何が混ざっていたかを知らせる');

/* ② https:// の書き忘れは補う */
const noScheme = run('example.pages.dev');
ok(noScheme.code === 0 && /https:\/\/example\.pages\.dev/.test(noScheme.out), 'https:// の書き忘れを補う', noScheme.out.trim());

/* ③ 直せない形は、通信する前に止まる */
for (const bad of ['https:/example', 'https://', 'ttps://example.pages.dev']) {
  const r = run(bad);
  ok(r.code === 2, `直せない住所（${bad}）は通信する前に止まる`, 'code=' + r.code);
}

/* ④ 社内版のときは、悪い住所でも中身を書き出さない（記録に残さない） */
const hidden = run('https:/naibu-no-namae', ['--internal']);
ok(hidden.code === 2 && hidden.out.indexOf('naibu-no-namae') === -1, '社内版の住所は記録に出さない', hidden.out.replace(/\n/g, ' ').slice(0, 60));

/* ⑤ 引用符つきで貼っても通る */
const quoted = run('"https://example.pages.dev"');
ok(quoted.code === 0 && /https:\/\/example\.pages\.dev/.test(quoted.out), '引用符ごと貼っても通る', quoted.out.trim());

console.log(ng === 0 ? '\n住所の受け取り方: 問題なし' : `\n住所の受け取り方: NG ${ng}件`);
process.exit(ng === 0 ? 0 : 1);
