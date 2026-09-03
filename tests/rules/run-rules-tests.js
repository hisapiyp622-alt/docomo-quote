/* Firestore ルールのテスト（製品化レビュー 4-25）
 *
 * 目的: ルールを1文字直しただけで全店舗が止まる／逆に他店のデータが見える、
 * という事故を防ぐ。エミュレータ（本物と同じルール実行エンジン）に
 * keitai-app/firestore.rules を読ませて、代表的な操作を試す。
 *
 * 使い方: sh tools/test-rules.sh
 *   （中で firebase emulators:exec が動き、このスクリプトを呼びます）
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('@firebase/rules-unit-testing');

const ROOT = path.resolve(__dirname, '../..');
const RULES = fs.readFileSync(path.join(ROOT, 'keitai-app/firestore.rules'), 'utf8');
const DEV_UID = (RULES.match(/request\.auth\.uid == '([^']+)'/) || [])[1] || 'DEV';

const ok = [];
const ng = [];
async function check(name, fn) {
  try { await fn(); ok.push(name); }
  catch (e) { ng.push(name + '  → ' + String(e.message || e).split('\n')[0]); }
}
const stamp = (o) => Object.assign({ clientId: 'c1', updatedAtMs: Date.now() }, o);

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-frontalk',
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 }
  });
  await env.clearFirestore();

  // --- 下ごしらえ（販売側がコンソールで入れるぶん） ---
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('contracts/storeA').set({ status: 'active', org: 'riwa', area: 'kansai' });
    await db.doc('contracts/storeB').set({ status: 'active', org: 'riwa', area: 'kansai' });
    await db.doc('contracts/storeT').set({ status: 'active', org: 'riwa', area: 'tokai' });
    await db.doc('contracts/storeS').set({ status: 'suspended', org: 'riwa', area: 'kansai' });
    await db.doc('contracts/storeE').set({ status: 'trial', org: 'riwa', area: 'kansai',
      trialEndsAt: new Date(Date.now() - 86400000) });          // お試し切れ
    await db.doc('roles/roleKansai').set({ type: 'area', org: 'riwa', area: 'kansai' });
    await db.doc('roles/roleHq').set({ type: 'agency', org: 'riwa' });
    await db.doc('stores/storeA').set({ storeName: 'A店', clientId: 'seed' });
    await db.doc('stores/storeB').set({ storeName: 'B店', clientId: 'seed' });
    await db.doc('stores/storeS').set({ storeName: 'S店', clientId: 'seed' });
    await db.doc('stores/storeA/quotes/s1').set({ data: '{}', clientId: 'seed' });
  });

  const A = env.authenticatedContext('storeA').firestore();
  const B = env.authenticatedContext('storeB').firestore();
  const S = env.authenticatedContext('storeS').firestore();
  const E = env.authenticatedContext('storeE').firestore();
  const KANSAI = env.authenticatedContext('roleKansai').firestore();
  const HQ = env.authenticatedContext('roleHq').firestore();
  const DEV = env.authenticatedContext(DEV_UID).firestore();
  const ANON = env.unauthenticatedContext().firestore();

  // --- 店舗 ---
  await check('店舗は自分の店舗情報を読める', () => assertSucceeds(A.doc('stores/storeA').get()));
  await check('店舗は自分の店舗情報を書ける', () =>
    assertSucceeds(A.doc('stores/storeA').set(stamp({ storeName: 'A店', master: '{}' }))));
  await check('店舗は他店を読めない', () => assertFails(A.doc('stores/storeB').get()));
  await check('店舗は他店に書けない', () =>
    assertFails(A.doc('stores/storeB').set(stamp({ storeName: '乗っ取り' }))));
  await check('未ログインでは読めない', () => assertFails(ANON.doc('stores/storeA').get()));
  await check('店舗は自分の見積もりを書ける', () =>
    assertSucceeds(A.doc('stores/storeA/quotes/s1').set(stamp({ data: '{}' }))));
  await check('店舗は自分の保存を書ける', () =>
    assertSucceeds(A.doc('stores/storeA/saved/s1').set(stamp({ list: '[]', del: '{}' }))));

  // --- 書き込みの形・大きさ ---
  await check('知らないフィールドは書けない', () =>
    assertFails(A.doc('stores/storeA').set(stamp({ storeName: 'A店', hack: 1 }))));
  await check('clientId の無い見積もりは書けない', () =>
    assertFails(A.doc('stores/storeA/quotes/s1').set({ data: '{}' })));
  await check('900KBを超える書き込みはできない', () =>
    assertFails(A.doc('stores/storeA/saved/s1').set(stamp({ list: 'x'.repeat(950000) }))));
  await check('決められていないサブコレクションには書けない', () =>
    assertFails(A.doc('stores/storeA/etc/x').set(stamp({ a: 1 }))));

  // --- 契約の状態 ---
  await check('停止中の店舗は読めるが書けない', async () => {
    await assertSucceeds(S.doc('stores/storeS').get());
    await assertFails(S.doc('stores/storeS').set(stamp({ storeName: 'S店' })));
  });
  await check('お試し切れの店舗は書けない', () =>
    assertFails(E.doc('stores/storeE').set(stamp({ storeName: 'E店' }))));

  // --- 上位アカウント（代理店・エリア） ---
  await check('エリアは担当エリアの店舗を読める', () => assertSucceeds(KANSAI.doc('stores/storeA').get()));
  await check('エリアは担当エリアの店舗のマスタを直せる', () =>
    assertSucceeds(KANSAI.doc('stores/storeA').set(stamp({ storeName: 'A店', master: '{}' }))));
  await check('エリアは担当外（東海）の店舗を読めない', () => assertFails(KANSAI.doc('stores/storeT').get()));
  await check('エリアは停止中の店舗には書けない', () =>
    assertFails(KANSAI.doc('stores/storeS').set(stamp({ storeName: 'S店' }))));
  await check('代理店は自社の全店舗を読める', async () => {
    await assertSucceeds(HQ.doc('stores/storeA').get());
    await assertSucceeds(HQ.doc('stores/storeT').get());
  });
  await check('上位は店舗の見積もりも読める（閲覧のみはアプリ側で担保）', () =>
    assertSucceeds(KANSAI.doc('stores/storeA/quotes/s1').get()));

  // --- 契約・役割の器そのもの ---
  await check('店舗は自分の契約を読めるが書けない', async () => {
    await assertSucceeds(A.doc('contracts/storeA').get());
    await assertFails(A.doc('contracts/storeA').set({ status: 'active' }));
  });
  await check('店舗は他店の契約を読めない', () => assertFails(A.doc('contracts/storeB').get()));
  await check('役割は本人だけ読める・誰も書けない', async () => {
    await assertSucceeds(KANSAI.doc('roles/roleKansai').get());
    await assertFails(A.doc('roles/roleKansai').get());
    await assertFails(KANSAI.doc('roles/roleKansai').set({ type: 'agency', org: 'riwa' }));
  });

  // --- 保守アカウント ---
  await check('保守アカウントは全店舗を読める', async () => {
    await assertSucceeds(DEV.doc('stores/storeA').get());
    await assertSucceeds(DEV.doc('stores/storeB').get());
  });

  await env.cleanup();
  console.log('ルールのテスト: ' + ok.length + '/' + (ok.length + ng.length) + ' OK');
  ng.forEach((x) => console.error('✗ ' + x));
  if (ng.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
