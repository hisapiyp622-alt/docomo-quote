/* AGENTS.md を CLAUDE.md から作る
 *
 * 使い方:
 *   node tools/build-agents.js          … AGENTS.md を作り直す
 *   node tools/build-agents.js --check  … ズレていないかを見るだけ（CI用）
 *
 * なぜ要るか（2026-09-06 の方針）:
 *   このアプリは、クロコ（Claude Code）でもコーデックス（Codex）でも
 *   作業できるようにしてある。片方が止まっても、修正依頼を受けられるようにするため。
 *   ところが**自動で読むファイルの名前が違う**:
 *     クロコ      → CLAUDE.md
 *     コーデックス → AGENTS.md
 *   2つに同じことを手で書くと必ずズレるので、CLAUDE.md を原本にして
 *   AGENTS.md はここで作る。ズレは CI と release-check.js が見張る。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'CLAUDE.md');
const OUT = path.join(ROOT, 'AGENTS.md');
const CHECK = process.argv.indexOf('--check') >= 0;

const HEAD = [
  '<!-- このファイルは tools/build-agents.js が CLAUDE.md から生成します。直接編集しないでください。',
  '     作業ルールを変えるときは CLAUDE.md を直し、node tools/build-agents.js を実行してください。 -->',
  '',
  '> **このファイルは `CLAUDE.md` と同じ中身です。**',
  '> 名前が2つあるのは、AIアシスタントによって自動で読むファイルが違うためです',
  '> （Claude Code は `CLAUDE.md`、Codex は `AGENTS.md`）。',
  '> どちらで作業しても、同じルール・同じ手順・同じテストで進めてください。',
  ''
].join('\n');

if (!fs.existsSync(SRC)) {
  console.error('CLAUDE.md がありません。');
  process.exit(1);
}
const src = fs.readFileSync(SRC, 'utf8');
if (!src.trim()) {
  console.error('CLAUDE.md が空です（過去に空にしてしまった事故があります）。');
  process.exit(1);
}
const want = HEAD + '\n' + src;

if (CHECK) {
  const got = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (got === want) {
    console.log('AGENTS.md は CLAUDE.md と同じ中身です。');
    process.exit(0);
  }
  console.error('AGENTS.md が CLAUDE.md とズレています。'
    + '\n作業ルールは CLAUDE.md が原本です。次を実行して作り直してください:'
    + '\n  node tools/build-agents.js');
  process.exit(1);
}
fs.writeFileSync(OUT, want);
console.log('AGENTS.md を CLAUDE.md から作りました（' + want.split('\n').length + '行）。');
