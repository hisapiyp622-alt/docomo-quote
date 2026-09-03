/* 店舗の開通スクリプトのテスト（製品化レビュー 4-24）
 *
 * 使い方: sh tools/test-provision.sh
 *   （中で Firebase エミュレータ（Authentication＋Firestore）を立ち上げて、
 *     tools/provision-store.js を本番と同じ手順で流します。本番には何も起きません）
 *
 * 見ているもの:
 *  ・下見（--run なし）では何も作らないこと
 *  ・CSV から複数店舗を一度に作れること（アカウント・契約の器・店舗の入れ物）
 *  ・お試し期限が timestamp 型で、日本時間の 23:59:59 に入ること
 *  ・所属の札（org / area）と店舗名が contracts に入ること
 *  ・すでにある店舗を上書きしないこと（--force のときだけ上書き）
 *  ・店舗IDの書き間違いを止めること
 *  ・--check が、型違い・アカウント無しなどの取りこぼしを見つけること
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const ok = [];
const ng = [];
function chk(name, cond, extra) {
  if (cond) ok.push(name);
  else ng.push(name + (extra ? '  → ' + extra : ''));
}

function run(args, expectFail) {
  try {
    return execFileSync('node', [path.join(ROOT, 'tools/provision-store.js')].concat(args),
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (expectFail) return String(e.stdout || '') + String(e.stderr || '');
    throw new Error('失敗しました: ' + String(e.stderr || e.message).slice(0, 300));
  }
}

(async () => {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-frontalk' });
  const db = getFirestore();
  const auth = getAuth();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  const csv = path.join(dir, 'stores.csv');
  fs.writeFileSync(csv, [
    '店舗ID,店舗名,org,area,お試し日数',
    'riwa-umeda01,ドコモショップ梅田店,riwa,kansai,7',
    'riwa-nagoya01,ドコモショップ名古屋店,riwa,tokai,14'
  ].join('\n') + '\n');

  // ---- ① 下見では何も作らない ----
  const dry = run(['--file', csv]);
  chk('① 下見では「作ります」とだけ出る', /アカウントを作ります/.test(dry), dry.split('\n').slice(0, 3).join(' / '));
  let users = await auth.listUsers(10);
  chk('① 下見のあと、アカウントは1件もできていない', users.users.length === 0, String(users.users.length));

  // ---- ② 実行 ----
  const out = run(['--file', csv, '--run']);
  chk('② 2店舗ぶんの受け渡し表が出る',
    /riwa-umeda01,/.test(out) && /riwa-nagoya01,/.test(out), out.split('=====')[1] || '');
  users = await auth.listUsers(10);
  chk('② アカウントが2つできる', users.users.length === 2, String(users.users.length));
  const byEmail = {};
  users.users.forEach((u) => { byEmail[u.email] = u; });
  const u1 = byEmail['riwa-umeda01@keitai-quote.example'];
  chk('② メールは <店舗ID>@keitai-quote.example', !!u1, Object.keys(byEmail).join(','));

  const c1 = (await db.collection('contracts').doc(u1.uid).get()).data();
  chk('③ 契約の器に status / 店舗名 / 店舗ID が入る',
    c1.status === 'trial' && c1.storeName === 'ドコモショップ梅田店' && c1.storeId === 'riwa-umeda01',
    JSON.stringify(c1));
  chk('③ 所属の札（org / area）が入る', c1.org === 'riwa' && c1.area === 'kansai');
  chk('④ お試し期限が timestamp 型', !!(c1.trialEndsAt && typeof c1.trialEndsAt.toDate === 'function'),
    typeof c1.trialEndsAt);
  const end = c1.trialEndsAt.toDate();
  const jst = new Date(end.getTime() + 9 * 3600 * 1000);
  chk('④ 期限は日本時間の 23:59:59',
    jst.getUTCHours() === 23 && jst.getUTCMinutes() === 59, jst.toISOString());
  const days = Math.round((end - new Date()) / 86400000);
  chk('④ お試し日数がCSVのとおり（7日）', days >= 6 && days <= 8, String(days) + '日後');

  const s1 = (await db.collection('stores').doc(u1.uid).get()).data();
  chk('⑤ 店舗の入れ物に店舗名が先に入る', s1.storeName === 'ドコモショップ梅田店', JSON.stringify(s1));

  // 名古屋は14日
  const u2 = byEmail['riwa-nagoya01@keitai-quote.example'];
  const c2 = (await db.collection('contracts').doc(u2.uid).get()).data();
  const days2 = Math.round((c2.trialEndsAt.toDate() - new Date()) / 86400000);
  chk('④ 店舗ごとに日数を変えられる（14日）', days2 >= 13 && days2 <= 15, String(days2) + '日後');
  chk('③ エリアの札も店舗ごと（tokai）', c2.area === 'tokai', c2.area);

  // ---- ⑥ もう一度流しても壊さない ----
  await db.collection('contracts').doc(u1.uid).set({ status: 'active' }, { merge: true });
  run(['--file', csv, '--run']);
  const c1b = (await db.collection('contracts').doc(u1.uid).get()).data();
  chk('⑥ すでにある契約の器を勝手に書き戻さない', c1b.status === 'active', c1b.status);
  const users2 = await auth.listUsers(10);
  chk('⑥ アカウントも増えない', users2.users.length === 2, String(users2.users.length));

  // ---- ⑦ --force なら上書きする ----
  run(['--file', csv, '--run', '--force']);
  const c1c = (await db.collection('contracts').doc(u1.uid).get()).data();
  chk('⑦ --force ならお試しに戻せる', c1c.status === 'trial', c1c.status);

  // ---- ⑧ 書き間違いを止める ----
  const bad = path.join(dir, 'bad.csv');
  fs.writeFileSync(bad, '店舗ID,店舗名\nRIWA_Umeda,梅田\n');
  const badOut = run(['--file', bad, '--run'], true);
  chk('⑧ 店舗IDの書き間違いを止める', /半角の小文字/.test(badOut), badOut.trim().split('\n').pop());
  const noHead = path.join(dir, 'nohead.csv');
  fs.writeFileSync(noHead, 'id2,name2\nx,y\n');
  const noHeadOut = run(['--file', noHead, '--run'], true);
  chk('⑧ 見出しが違うCSVを止める', /店舗ID/.test(noHeadOut), noHeadOut.trim().split('\n').pop());

  // ---- ⑨ --check が取りこぼしを見つける ----
  await db.collection('contracts').doc('UID_MANUAL_MISTAKE').set({
    status: 'trial', trialEndsAt: '2026-12-31', storeId: 'tegaki01', storeName: '手貼りの店'
  });
  const check = run(['--check']);
  chk('⑨ 期限の型違いを見つける', /timestamp 型ではありません/.test(check), check.slice(-300));
  chk('⑨ アカウントの無いUIDを見つける', /ログインアカウントがありません/.test(check));
  chk('⑨ 正常な店舗も一覧に出る', /riwa-umeda01/.test(check) && /riwa-nagoya01/.test(check));

  if (ng.length) {
    console.error('店舗の開通スクリプトのテスト: ' + ok.length + '/' + (ok.length + ng.length)
      + '\n  × ' + ng.join('\n  × '));
    process.exit(1);
  }
  console.log('店舗の開通スクリプトのテスト: ' + ok.length + '/' + ok.length + ' OK');
})().catch((e) => {
  console.error('テストが失敗しました: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
