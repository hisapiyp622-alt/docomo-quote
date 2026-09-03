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
 */
const { execSync } = require('child_process');

const BASE = process.argv[2] || 'origin/main';
const FILE = 'keitai-app/data.js';

function readAt(ref) {
  try { return execSync(`git show ${ref}:${FILE}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return null; }
}
function field(src, key) {
  if (!src) return null;
  const m = src.match(new RegExp('"' + key + '"\\s*:\\s*("?[^,\\n}]+)'));
  return m ? m[1].replace(/"/g, '').trim() : null;
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
const bv = Number(field(base, 'masterVersion'));
const hv = Number(field(head, 'masterVersion'));
const bu = field(base, 'updated');
const hu = field(head, 'updated');
const ng = [];
if (!(hv > bv)) ng.push(`masterVersion が上がっていません（${bv} → ${hv}）。+1 してください`);
if (bu === hu) ng.push(`updated（料金データ基準日）が ${hu} のままです。今日の日付に直してください`);
if (ng.length) {
  console.error('料金表を変えたときの決まりに合っていません:\n  - ' + ng.join('\n  - ')
    + '\n\n料金の変更は data.js ＋ masterVersion ＋ updated の3点セットで配ります'
    + '（アプリの中で置き換える一時しのぎは使わない）。');
  process.exit(1);
}
console.log(`料金表の変更を確認しました（masterVersion ${bv} → ${hv} / 基準日 ${bu} → ${hu}）。`);
