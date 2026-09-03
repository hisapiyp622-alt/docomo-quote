#!/usr/bin/env node
/* 料金表（keitai-app/data.js）を変えた PR で、
 * masterVersion を上げ忘れていないかを見る（製品化レビュー 4-10）。
 *
 * 使い方: node tools/check-master-version.js <比較元のコミット>
 *   例）node tools/check-master-version.js origin/main
 *
 * masterVersion は「店舗のアプリに料金改定を配る」ための番号。
 * これを上げないと、店舗のマスタに新しい金額が届かず、
 * 見積書の「料金データ基準日」も古いままになる（実際に8月に起きた）。
 *
 * 見るのは「料金の中身」だけ。説明のコメントだけを直したときは、
 * 版を上げなくてよい（上げると全店舗に中身のない更新が届いてしまうため）。
 */
const { execSync } = require('child_process');

const BASE = process.argv[2] || 'origin/main';
const FILE = 'keitai-app/data.js';

function readAt(ref) {
  try { return execSync(`git show ${ref}:${FILE}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
}
// data.js を読み込んで中身（オブジェクト）を取り出す。読めなければ null
function dataOf(src) {
  if (!src) return null;
  try {
    return new Function(src + '; return DEFAULT_DATA;')();
  } catch (e) { return null; }
}
// 版と基準日を抜いた「料金の中身」
function bodyOf(d) {
  if (!d) return null;
  const c = JSON.parse(JSON.stringify(d));
  delete c.masterVersion;
  delete c.updated;
  return JSON.stringify(c);
}

const base = readAt(BASE);
if (base === null) {
  console.log('比較元（' + BASE + '）の料金表を読めなかったので、確認を飛ばします。');
  process.exit(0);
}
const head = require('fs').readFileSync(FILE, 'utf8');
if (base === head) {
  console.log('料金表に変更はありません。');
  process.exit(0);
}
const bd = dataOf(base), hd = dataOf(head);
if (!bd || !hd) {
  console.error('料金表を読み込めませんでした（書き方が壊れている可能性があります）。');
  process.exit(1);
}
if (bodyOf(bd) === bodyOf(hd) && bd.masterVersion === hd.masterVersion) {
  console.log(bd.updated === hd.updated
    ? '料金の中身は変わっていません（コメントなどの変更のみ）。版はそのままで大丈夫です。'
    : `料金の中身は変わらず、基準日だけを直しています（${bd.updated} → ${hd.updated}）。版はそのままで大丈夫です。`);
  process.exit(0);
}
/* 項目を消していないかを見る（製品化レビュー 4-11）。
 * data.js から項目を消しても、店舗の料金表には残り続け、消したことは伝わらない。
 * 受付が終わったものは、消すのではなく retiredFrom（終了日）で伝える。 */
const LISTS = ['plans', 'voiceOptions', 'options', 'feeItems', 'campaigns', 'accessories'];
const gone = [];
LISTS.forEach((k) => {
  const before = (bd[k] || []).map((x) => x.id);
  const after = new Set((hd[k] || []).map((x) => x.id));
  before.forEach((id) => { if (!after.has(id)) gone.push(k + ' の ' + id); });
});
if (gone.length) {
  console.error('料金表から項目を消しています:\n  - ' + gone.join('\n  - ')
    + '\n\n消しても店舗の料金表には残り続け、「終わったこと」は伝わりません。'
    + '\n受付が終わったものは、消さずに終了日を書いてください:'
    + '\n  "retiredFrom": "2026-12-01"   … その日から新しくは選べなくなります');
  process.exit(1);
}
/* 終了日の書き方を確かめる（製品化レビュー 4-11）。
 * 書き間違えると、受付終了が来ない／違う日から来る。画面には何も出ないので、ここで止める。 */
const badDate = [];
LISTS.forEach((k) => {
  (hd[k] || []).forEach((x) => {
    if (!('retiredFrom' in x)) return;
    const v = x.retiredFrom;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) {
      badDate.push(k + ' の ' + x.id + ': ' + JSON.stringify(v));
    }
  });
});
if (badDate.length) {
  console.error('受付終了の日付（retiredFrom）の書き方が違います:\n  - ' + badDate.join('\n  - ')
    + '\n\n"2026-12-01" の形（4桁の年-2桁の月-2桁の日）で書いてください。');
  process.exit(1);
}
const bv = Number(bd.masterVersion), hv = Number(hd.masterVersion);
const bu = String(bd.updated), hu = String(hd.updated);
const ng = [];
if (!(hv > bv)) ng.push(`masterVersion が上がっていません（${bv} → ${hv}）。+1 してください`);
if (bu === hu) ng.push(`updated（料金データ基準日）が ${hu} のままです。今日の日付に直してください`);
if (ng.length) {
  console.error('料金表を変えたときの決まりに合っていません:\n  - ' + ng.join('\n  - ')
    + '\n\n料金の変更は data.js ＋ masterVersion ＋ updated の3点セットで配ります'
    + '（アプリの中で置き換える一時しのぎは使わない）。'
    + '\n受付終了を伝えるときも同じです（項目を消すのではなく retiredFrom を書く）。');
  process.exit(1);
}
console.log(`料金表の変更を確認しました（masterVersion ${bv} → ${hv} / 基準日 ${bu} → ${hu}）。`);
