#!/usr/bin/env node
/* 店舗の開通をまとめて行う（製品化レビュー 4-24）
 *
 * これまでは Firebase のコンソールで、店舗ごとに6工程・UIDの手貼りでした。
 * 13店舗の同時お試しでは、貼り間違い・期限の型違いに気づけません。
 * このスクリプトは、店舗の一覧から
 *   ・ログイン用アカウント（Authentication）
 *   ・契約の器（contracts/{UID}）… お試し期限・所属の札・店舗名
 *   ・店舗の入れ物（stores/{UID}）… 店舗名
 * を一度に作り、店舗へ渡す「ID とパスワードの一覧」を出します。
 *
 * ── 使い方 ─────────────────────────────────────────────
 *   1. 下ごしらえ（初回だけ）
 *        npm install firebase-admin
 *        Firebase コンソール → プロジェクトの設定 → サービスアカウント
 *        →「新しい秘密鍵の生成」で鍵ファイル（.json）を落とす
 *        ※ この鍵はパスワードと同じです。リポジトリに入れないでください
 *
 *   2. 店舗の一覧を作る（CSV・1行1店舗。1行目は見出し）
 *        店舗ID,店舗名,org,area,お試し日数
 *        riwa-umeda01,ドコモショップ梅田店,riwa,kansai,7
 *        riwa-nagoya01,ドコモショップ名古屋店,riwa,tokai,7
 *
 *   3. 下見（何をするか表示するだけ。何も作りません）
 *        node tools/provision-store.js --key ./key.json --file stores.csv
 *
 *   4. 実行
 *        node tools/provision-store.js --key ./key.json --file stores.csv --run
 *
 *   5. 確認（すでに作った店舗の状態を見る。作りません）
 *        node tools/provision-store.js --key ./key.json --check
 *
 * 1店舗だけのときは CSV なしでも書けます:
 *   node tools/provision-store.js --key ./key.json \
 *     --id riwa-umeda01 --name "ドコモショップ梅田店" --org riwa --area kansai --trial 7 --run
 *
 * 本契約から始めるときは --trial のかわりに --active を付けます。
 * ─────────────────────────────────────────────────────
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 引数 ---------- */
function args() {
  const a = process.argv.slice(2);
  const o = { run: false, check: false, force: false, trial: 7, active: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--run') o.run = true;
    else if (k === '--check') o.check = true;
    else if (k === '--force') o.force = true;
    else if (k === '--active') o.active = true;
    else if (k === '--key') o.key = a[++i];
    else if (k === '--file') o.file = a[++i];
    else if (k === '--id') o.id = a[++i];
    else if (k === '--name') o.name = a[++i];
    else if (k === '--org') o.org = a[++i];
    else if (k === '--area') o.area = a[++i];
    else if (k === '--tel') o.tel = a[++i];
    else if (k === '--trial') o.trial = Number(a[++i]);
    else if (k === '--pass') o.pass = a[++i];
    else if (k === '--out') o.out = a[++i];
    else if (k === '-h' || k === '--help') o.help = true;
    else { console.error('知らない指定です: ' + k); process.exit(1); }
  }
  return o;
}

function die(msg) { console.error('\n' + msg + '\n'); process.exit(1); }

/* ---------- ログインに使うメールの @ 以降（アプリの設定と必ず揃える） ---------- */
function storeDomain() {
  const src = fs.readFileSync(path.join(ROOT, 'keitai-app/firebase-config.js'), 'utf8');
  const m = src.match(/KEITAI_STORE_DOMAIN\s*=\s*"([^"]+)"/);
  if (!m) die('keitai-app/firebase-config.js から KEITAI_STORE_DOMAIN を読めませんでした。');
  return m[1];
}

/* ---------- 店舗へ渡すパスワード ----------
 * 読み間違えやすい文字（0 O o 1 l I）は使わない。口頭でも伝えられる形にする。 */
function makePass(len) {
  const A = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  const b = crypto.randomBytes(len * 2);
  for (let i = 0; out.length < len; i++) out += A[b[i] % A.length];
  return out;
}

/* ---------- お試しの終了日時（日本時間の 23:59:59） ---------- */
function trialEnd(days) {
  const now = new Date();
  // 日本時間での「今日」を出してから日数を足す
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth(), d = jst.getUTCDate();
  // その日の 23:59:59（日本時間）＝ UTC では 14:59:59
  return new Date(Date.UTC(y, m, d + Number(days), 14, 59, 59));
}
function ymdJst(dt) {
  const jst = new Date(dt.getTime() + 9 * 3600 * 1000);
  const z = (n) => String(n).padStart(2, '0');
  return jst.getUTCFullYear() + '/' + z(jst.getUTCMonth() + 1) + '/' + z(jst.getUTCDate());
}

/* ---------- CSV ---------- */
function readCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = txt.split(/\r?\n/).filter((l) => l.trim());
  if (!rows.length) die('店舗の一覧が空です: ' + file);
  const head = rows[0].split(',').map((c) => c.trim());
  const idx = (names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const iId = idx(['店舗ID', 'id', 'storeId']);
  const iName = idx(['店舗名', 'name', 'storeName']);
  const iOrg = idx(['org', '代理店']);
  const iArea = idx(['area', 'エリア']);
  const iTrial = idx(['お試し日数', 'trial', 'trialDays']);
  if (iId < 0 || iName < 0) {
    die('1行目の見出しに「店舗ID」と「店舗名」が必要です。\n'
      + '  例) 店舗ID,店舗名,org,area,お試し日数');
  }
  return rows.slice(1).map((line, n) => {
    const c = line.split(',').map((x) => x.trim());
    const row = {
      id: c[iId], name: c[iName],
      org: iOrg >= 0 ? c[iOrg] : '',
      area: iArea >= 0 ? c[iArea] : '',
      trial: iTrial >= 0 && c[iTrial] !== '' ? Number(c[iTrial]) : null,
      line: n + 2
    };
    if (!row.id) die((n + 2) + '行目: 店舗IDが空です');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(row.id)) {
      die((n + 2) + '行目: 店舗ID「' + row.id + '」は半角の小文字・数字・ハイフンだけにしてください');
    }
    if (!row.name) die((n + 2) + '行目: 店舗名が空です');
    return row;
  });
}

/* ---------- 本体 ---------- */
(async () => {
  const o = args();
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); return; }

  let App, Auth, Store;
  try {
    App = require('firebase-admin/app');
    Auth = require('firebase-admin/auth');
    Store = require('firebase-admin/firestore');
  } catch (e) {
    die('firebase-admin が入っていません。先にこれを実行してください:\n  npm install firebase-admin');
  }
  /* 練習用（エミュレータ）。本番の鍵を使わずに、同じ手順をひととおり試せる。
   * tests/run-provision-tests.js がこの道を通る。 */
  const emu = !!(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
  if (emu) {
    console.log('※ 練習用のエミュレータにつないでいます（本番には何も起きません）');
    App.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-frontalk' });
  } else {
    if (!o.key && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      die('鍵ファイルの場所を指定してください:\n'
        + '  node tools/provision-store.js --key ./key.json ...\n\n'
        + '鍵は Firebase コンソール → プロジェクトの設定 → サービスアカウント\n'
        + '→「新しい秘密鍵の生成」で作れます（リポジトリに入れないでください）。');
    }
    const cred = o.key ? App.cert(require(path.resolve(o.key))) : App.applicationDefault();
    App.initializeApp({ credential: cred });
  }
  const auth = Auth.getAuth();
  const db = Store.getFirestore();
  const DOMAIN = storeDomain();

  /* ===== 確認だけ（--check） ===== */
  if (o.check) {
    const snap = await db.collection('contracts').get();
    if (snap.empty) { console.log('契約の器（contracts）はまだ空です。'); return; }
    const rows = [];
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const warn = [];
      let email = '';
      try { email = (await auth.getUser(doc.id)).email || ''; }
      catch (e) { warn.push('このUIDのログインアカウントがありません'); }
      if (!['trial', 'active', 'suspended'].includes(d.status)) warn.push('status が変です: ' + d.status);
      if (d.status === 'trial') {
        if (!d.trialEndsAt) warn.push('trialEndsAt がありません');
        else if (typeof d.trialEndsAt.toDate !== 'function') warn.push('trialEndsAt が timestamp 型ではありません');
        else if (d.trialEndsAt.toDate() < new Date()) warn.push('お試し期限が切れています（' + ymdJst(d.trialEndsAt.toDate()) + '）');
      }
      const st = await db.collection('stores').doc(doc.id).get();
      if (!st.exists) warn.push('stores がまだありません（店舗が一度もログインしていない可能性）');
      rows.push({
        uid: doc.id,
        id: d.storeId || (email ? email.split('@')[0] : '（不明）'),
        name: d.storeName || (st.exists ? (st.data().storeName || '') : ''),
        status: d.status || '（無し）',
        until: d.status === 'trial' && d.trialEndsAt && d.trialEndsAt.toDate ? ymdJst(d.trialEndsAt.toDate()) : '',
        org: d.org || '', area: d.area || '',
        ver: st.exists ? (st.data().appVersion || '') : '',
        warn: warn
      });
    }
    rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    console.log('店舗の状態（' + rows.length + '件）\n');
    rows.forEach((r) => {
      console.log([r.id, r.name, r.status + (r.until ? '（' + r.until + 'まで）' : ''),
        r.org + (r.area ? '/' + r.area : ''), r.ver ? 'アプリ ' + r.ver : ''].filter(Boolean).join('  '));
      r.warn.forEach((w) => console.log('    ⚠ ' + w));
    });
    const bad = rows.filter((r) => r.warn.length).length;
    console.log('\n' + (bad ? '⚠ 気になる店舗が ' + bad + '件あります（上の ⚠）' : '問題は見つかりませんでした'));
    return;
  }

  /* ===== 開通 ===== */
  let list;
  if (o.file) list = readCsv(o.file);
  else if (o.id) list = [{ id: o.id, name: o.name || o.id, org: o.org || '', area: o.area || '', trial: o.trial }];
  else die('店舗の一覧（--file）か、1店舗ぶんの指定（--id と --name）が要ります。--help で使い方が出ます。');

  const mode = o.active ? 'active' : 'trial';
  console.log('== 店舗の開通' + (o.run ? '' : '（下見。何も作りません）') + ' ==');
  console.log('ログインのメール: <店舗ID>@' + DOMAIN);
  console.log('契約: ' + (mode === 'active' ? '本契約（active）' : 'お試し（trial）') + '\n');

  const done = [];
  for (const s of list) {
    const days = mode === 'trial' ? (s.trial != null ? s.trial : o.trial) : 0;
    const email = s.id + '@' + DOMAIN;
    const pass = o.pass || makePass(12);
    const end = trialEnd(days);
    let uid = null, existed = false;
    try { const u = await auth.getUserByEmail(email); uid = u.uid; existed = true; } catch (e) {}

    const head = s.id + '  ' + s.name;
    if (!o.run) {
      console.log(head);
      console.log('    ' + (existed ? '既にあるアカウントを使います（UID ' + uid + '）' : 'アカウントを作ります'));
      console.log('    contracts: status=' + mode + (mode === 'trial' ? '・' + ymdJst(end) + 'まで' : '')
        + (s.org ? '・org=' + s.org : '') + (s.area ? '・area=' + s.area : ''));
      console.log('    stores: 店舗名「' + s.name + '」');
      continue;
    }

    if (!existed) {
      const u = await auth.createUser({ email: email, password: pass, displayName: s.name });
      uid = u.uid;
    }
    const cRef = db.collection('contracts').doc(uid);
    const cur = await cRef.get();
    if (cur.exists && !o.force) {
      console.log(head + '  → 契約の器はすでにあります（そのままにしました。上書きは --force）');
    } else {
      const data = { status: mode, storeId: s.id, storeName: s.name };
      if (s.org) data.org = s.org;
      if (s.area) data.area = s.area;
      if (mode === 'trial') data.trialEndsAt = Store.Timestamp.fromDate(end);
      await cRef.set(data, { merge: true });
    }
    // 店舗名を先に入れておく（店舗は担当者の登録から始められる）
    const sRef = db.collection('stores').doc(uid);
    const sCur = await sRef.get();
    if (!sCur.exists) {
      const sd = { storeName: s.name, clientId: 'provision' };
      if (o.tel) sd.storeTel = o.tel;
      await sRef.set(sd, { merge: true });
    }
    done.push({ id: s.id, name: s.name, pass: existed ? '（既存のまま）' : pass,
      until: mode === 'trial' ? ymdJst(end) : '', uid: uid });
    console.log(head + '  → できました（UID ' + uid + '）');
  }

  if (!o.run) {
    console.log('\nこの内容でよければ、同じコマンドに --run を付けて実行してください。');
    return;
  }

  /* ---------- 店舗へ渡す一覧 ---------- */
  const sheet = ['店舗ID,パスワード,店舗名,お試し期限']
    .concat(done.map((d) => [d.id, d.pass, d.name, d.until].join(',')))
    .join('\n');
  console.log('\n===== 店舗へお渡しする内容（パスワードはここにしか出ません） =====');
  console.log(sheet);
  console.log('=================================================================');
  if (o.out) {
    fs.writeFileSync(o.out, sheet + '\n');
    console.log('\n' + o.out + ' に保存しました。渡し終えたら消してください（パスワードが入っています）。');
  }
  console.log('\n次にすること:');
  console.log('  1. 店舗IDとパスワードを、店舗の管理者へ安全な方法で伝える');
  console.log('  2. 店舗側で担当者を登録してもらう（アプリの初期設定が案内します）');
  console.log('  3. 上位アカウント（代理店・エリア）を使う場合は、org / area の札が合っているか確認する');
})().catch((e) => {
  console.error('\n失敗しました: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
