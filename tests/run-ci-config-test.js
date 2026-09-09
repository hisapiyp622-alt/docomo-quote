/* 配信ジョブ（.github/workflows/ci.yml の deploy）の決まりの確認
 *
 *   node tests/run-ci-config-test.js
 *
 * なぜ要るか（2026-09-09・段階3の初回配信が失敗した）:
 *   テストは26項目すべて緑なのに、配信の一歩手前で
 *   「Wrangler requires at least Node.js v22.0.0. You are using v20.20.2」で止まった。
 *   配信の道具（wrangler）が要求する Node の版と、CI が用意する Node の版が
 *   合っているかは、どのテストも見ていなかった。ここで機械的に見る。
 *
 *   もう1つ、社内版のプロジェクト名は「住所を知られないこと」が唯一の守りなので、
 *   記録に平文で残る Variables（vars.）から読んではいけない。secrets. だけ。
 */
const fs = require('fs');
const path = require('path');

const CI = path.resolve(__dirname, '..', '.github', 'workflows', 'ci.yml');
const src = fs.readFileSync(CI, 'utf8');

/* wrangler の主要な版 → 必要な Node の主要な版 */
const NEEDS_NODE = { 3: 16, 4: 22 };

let ng = 0;
const ok = (cond, msg) => { if (!cond) { ng++; console.log('NG  ' + msg); } else { console.log('ok  ' + msg); } };

/* deploy ジョブだけを切り出す（先頭の2字下げが目印） */
const i = src.indexOf('\n  deploy:');
ok(i > 0, 'ci.yml に deploy ジョブがある');
const deploy = i > 0 ? src.slice(i) : '';

/* ① 配信ジョブの Node の版が、使う wrangler の要求を満たしている */
const wran = deploy.match(/wrangler@(\d+)\.\d+\.\d+/);
ok(!!wran, '配信ジョブが wrangler の版を固定している');
if (wran) {
  const major = Number(wran[1]);
  const need = NEEDS_NODE[major];
  ok(need !== undefined, `wrangler@${major} の要求する Node の版を把握している`);
  const nodes = [...deploy.matchAll(/node-version:\s*'?"?(\d+)/g)].map((m) => Number(m[1]));
  ok(nodes.length > 0, '配信ジョブが Node の版を指定している');
  for (const n of nodes) {
    ok(need === undefined || n >= need,
      `配信ジョブの Node ${n} が wrangler@${major} の要求（${need} 以上）を満たす`);
  }
}

/* ② 社内版のプロジェクト名と住所は secrets からだけ読む（Variables は記録に平文で残る） */
for (const key of ['CF_PAGES_PROJECT_INTERNAL', 'CHECK_LIVE_INTERNAL_URL']) {
  ok(!new RegExp('vars\\.' + key).test(src), `${key} を vars.（記録に残る）から読んでいない`);
  ok(new RegExp('secrets\\.' + key).test(src), `${key} を secrets. から読んでいる`);
}

/* ③ 配信は main のときだけ */
ok(/github\.ref == 'refs\/heads\/main'/.test(deploy), '配信は main のときだけ');

console.log(ng === 0 ? '\n配信ジョブの決まり: 問題なし' : `\n配信ジョブの決まり: NG ${ng}件`);
process.exit(ng === 0 ? 0 : 1);
