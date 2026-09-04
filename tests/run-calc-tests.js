/* 金額計算のゴールデンテスト
 *
 * 使い方:
 *   node tests/run-calc-tests.js                  … golden.json と突き合わせて検算
 *   node tests/run-calc-tests.js --update         … 差分を見せるだけ（書き換えない）
 *   node tests/run-calc-tests.js --update --yes   … 見たうえで golden.json を作り直す
 *
 * 仕組み: keitai-app を ?kqtest=1 付きで Chromium に読み込み、
 * app.js 内の window.__KQ_TEST__.run() で代表パターンの金額を計算して比較する。
 * Firebase(gstatic) はネットワーク遮断し、端末内モードで動かす。
 *
 * 3つの見張り方（製品化レビュー 4-8・4-36）:
 *  1. golden.json との突き合わせ … 前回から金額が動いていないか
 *  2. HAND（手計算の期待値）      … 代表ケースは、公式の金額から人が計算した値で固定する。
 *     golden とは別に持ち、--update では**書き換わらない**。アプリの出力を
 *     そのまま正解にしてしまう事故（8月の取り違えの原因）を防ぐため
 *  3. ケースのキー検査            … 書き間違えた指定は黙って無視されるので、実行前に弾く
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GOLDEN = path.join(__dirname, 'golden.json');
const UPDATE = process.argv.indexOf('--update') >= 0;
/* --update は既定で「差分を見せるだけ」。書き換えるには --yes を付ける（製品化レビュー 4-36）。
 * アプリが出した数字をそのまま正解として焼き直すと、間違いをテストで固定してしまう。 */
const YES = process.argv.indexOf('--yes') >= 0;

function playwright() {
  try { return require('playwright'); } catch (e) {}
  return require('/opt/node22/lib/node_modules/playwright');
}

/* 代表パターン。フィールドは app.js の defaultState() に対する差分。
 * ケースを足すときはここに追記して --update で golden を作り直す。 */
const CASES = {
  // --- プラン単体 ---
  'max_shinki': { procType: 'shinki', planId: 'max', jimuFee: 4950 },
  'max_kishu': { procType: 'kishu', planId: 'max' },
  'poikatsu_max': { procType: 'shinki', planId: 'poikatsu_max', jimuFee: 4950 },
  'poikatsu20': { planId: 'poikatsu_20' },
  'mini_t0': { planId: 'mini', tierIdx: 0 },
  'mini_t1': { planId: 'mini', tierIdx: 1 },
  'ahamo': { planId: 'ahamo' },
  'u15_t0': { planId: 'u15_debut', tierIdx: 0 },
  'u15_t1': { planId: 'u15_debut', tierIdx: 1 },
  // --- 割引の組み合わせ ---
  'max_minna3_set': { planId: 'max', minna: '3', dSet: true },
  'max_minna2': { planId: 'max', minna: '2' },
  'max_dcard': { planId: 'max', dCard: 'normal' },
  'max_dcard_gold': { planId: 'max', dCard: 'gold' },
  'max_denki': { planId: 'max', dDenki: true },
  'max_choki10': { planId: 'max', choki: 'y10' },
  'max_choki20_full': { planId: 'max', minna: '3', dSet: true, dCard: 'gold', dDenki: true, choki: 'y20' },
  'u15_dcard_gold': { planId: 'u15_debut', tierIdx: 0, dCard: 'gold' },
  /* 2026-09-04 追加（製品化レビュー 5-1）。PLATINUM の還元率は
   * 初年度20%／2年目以降は前年のご利用額により10〜20%。率を選べるようにした。 */
  'max_platinum': { planId: 'max', dCard: 'platinum' },
  'max_platinum_12': { planId: 'max', dCard: 'platinum', dcardPlatRate: 12 },
  /* 2026-09-03 追加（製品化レビュー 4-4・4-5）。手計算の根拠:
   * ・dマガジン 580（コンテンツ使用料）は還元の対象外。月額は 5,148＋580＝5,728 でも
   *   対象額は 5,148 → 4×100pt = 400pt（直す前は 5×100pt = 500pt だった）
   * ・smartあんしん補償 990（付加機能使用料）は対象。5,148＋990＝6,138 → 5×100pt = 500pt
   * ・ハーティ/子育ての通話オプション割引は、旧オプション（2023-06-30 まで）は 770円。
   *   5分（旧）770 → 0円、かけ放題（旧）1,870 → 1,100円 */
  'gold_dmagazine_content': { planId: 'max', dCard: 'gold', options: { dmagazine: true } },
  'gold_hosho_taisho': { planId: 'max', dCard: 'gold', options: { smart_hosho: true } },
  'hearty_v5l': { planId: 'max', hearty: true, voice: 'v5l' },
  /* 2026-09-03 追加（製品化レビュー 4-2）。手計算の根拠:
   * 公式の注意事項「U22割が優先。U22割の割引終了後、でんきセット割・長期利用割は継続適用」。
   * ・u22_denki_choki: 5,698 −でんき110 −長期110 ＝5,478。1〜7か月目は U22割 −2,728 だが
   *   でんき・長期は止まるので +220 → 2,970円。8か月目から 5,478円
   * ・u22_u29_both: 両方入れても U22割だけ（−2,728・7か月）→ 1〜7か月 2,970／8か月目 5,698 */
  'u22_denki_choki': { planId: 'max', dDenki: true, choki: 'y10', campaigns: { u22: true } },
  'u22_u29_both': { planId: 'max', campaigns: { u22: true, u29: true } },
  'u29_denki': { planId: 'max', dDenki: true, campaigns: { u29: true } },
  /* 2026-09-03 追加（製品化レビュー 4-3）。公式は「各種割引適用後のご利用料金」が
   * 還元の対象。MAX 5,698 −dカードお支払割(GOLD)550 ＝5,148 から、U22割 −2,728 も
   * 引いた 2,420円が対象額 → 2×100pt＝200pt（直す前は 5,148円で400pt だった）。
   * キャンペーンが終わる8か月目からは 5,148円→400pt に戻る（ヒントに表示）。 */
  'gold_u22_campaign': { planId: 'max', dCard: 'gold', campaigns: { u22: true } },
  'hearty_kakel': { planId: 'max', hearty: true, voice: 'kakel' },
  'kosodate_kakel': { planId: 'max', kosodate: true, voice: 'kakel' },
  // --- キャンペーン ---
  'u15_oyako': { planId: 'u15_debut', tierIdx: 0, campaigns: { oyako_u15: true } },
  'max_oyako_family': { planId: 'max', campaigns: { oyako_family: true } },
  // --- 通話オプション ---
  'max_voice5min': { planId: 'max', voice: 'v5' },
  'max_voice_full': { planId: 'max', voice: 'kake' },
  // --- オプション ---
  'max_hosho990': { planId: 'max', options: { smart_hosho: true }, optionKubun: { smart_hosho: 'new' } },
  'max_hosho330': { planId: 'max', options: { smart_hosho: true }, optionKubun: { smart_hosho: 'new' }, optionPrices: { smart_hosho: 330 } },
  'max_anshin_pack': { planId: 'max', options: { anshin_pack: true }, optionKubun: { anshin_pack: 'new' } },
  // --- 端末購入 ---
  'device_ikkatsu': { planId: 'max', payMethod: 'ikkatsu', devicePrice: 129800, deviceName: 'テスト機', jimuFee: 4950 },
  'device_ikkatsu_coupon': { planId: 'max', payMethod: 'ikkatsu', devicePrice: 129800, couponOff: 22000, deviceName: 'テスト機' },
  'device_b24': { planId: 'max', payMethod: 'b24', devicePrice: 129800, deviceName: 'テスト機' },
  'device_b36_atamakin': { planId: 'max', payMethod: 'b36', devicePrice: 98000, atamakin: 11000, deviceName: 'テスト機' },
  'device_kaedoki': { planId: 'max', payMethod: 'kaedoki', devicePrice: 129800, kaedoki23: 58000, deviceName: 'テスト機' },
  // --- 子育てサポート割引（1.115.0〜） ---
  'kosodate_max': { planId: 'max', kosodate: true },
  'kosodate_max_kake': { planId: 'max', kosodate: true, voice: 'kake' },
  'kosodate_hearty_both': { planId: 'max', kosodate: true, hearty: true },
  /* 2026-09-04 追加（製品化レビュー 4-8）。いままで1件も通っていなかった道:
   * ハーティ単独・ポイントの充当・dカード還元の充当・カエドキ＋頭金・
   * 爆アゲ セレクション・MAX の選べる特典。 */
  'hearty_only': { planId: 'max', hearty: true },
  'poikatsu_no_apply': { planId: 'poikatsu_max', pointPoikatsu: 5000 },
  'poikatsu_apply': { planId: 'poikatsu_max', pointPoikatsu: 5000, pointApply: true },
  /* ⑧「ポイントの扱い」を『月額から充当』にしたとき。dカード還元は
   * 既定では引かない（dcardGoldAuto: false）ので、引く側の指定も入れる。 */
  'gold_point_apply': { planId: 'max', dCard: 'gold', pointDcard: 400,
    pointApply: true, dcardGoldAuto: true },
  'device_kaedoki_atamakin': { planId: 'max', payMethod: 'kaedoki', devicePrice: 129800,
    kaedoki23: 58000, atamakin: 11000, deviceName: 'テスト機' },
  'bakuage_netflix': { planId: 'max', options: { netflix: true }, optionKubun: { netflix: 'new' } },
  'bakuage_std_plan': { planId: 'poikatsu_20', options: { netflix: true }, optionKubun: { netflix: 'new' } },
  'maxbonus_two': { planId: 'max', options: { bk_lemino: true, bk_danime: true },
    optionKubun: { bk_lemino: 'new', bk_danime: 'new' } },
  'maxbonus_three': { planId: 'max', options: { bk_lemino: true, bk_danime: true, dazn: true },
    optionKubun: { bk_lemino: 'new', bk_danime: 'new', dazn: 'new' } },
  // --- その他の枠 ---
  'adhoc_monthly': { planId: 'max', adhocMonthly: [{ name: 'テスト割', amount: -550, months: 12 }] },
  'adhoc_initial': { planId: 'max', adhocInitial: [{ name: 'テスト商材', amount: 3300 }] },
  'accessories': { planId: 'max', accessories: [{ name: 'ケース', price: 4400, pay: 'once' }, { name: 'ガラス', price: 3300, pay: 'b24' }] }
};

/* ---- 手計算の期待値（製品化レビュー 4-8・4-36） ----
 * data.js の金額（＝公式サイトで確認した値）から、人が計算した数字。
 * golden.json とは別に持ち、--update では書き換わらない。
 * ここが合わなくなったら「計算が変わった」か「料金表が変わった」のどちらか。
 * 料金改定でここを直すときは、必ず計算の式もコメントで直すこと。
 *
 * 使っている元の金額（keitai-app/data.js・masterVersion 9 / 基準日 2026-09-03）:
 *   ドコモ MAX 〜1GB 5,698／1GB超〜3GB 6,798／3GB超〜無制限 8,448
 *   MAX の割引: みんな2 550・みんな3 1,210・光セット 1,210・dカード 220・
 *              dカードGOLD 550・でんき 110・長期10年 110・長期20年 220・
 *              ハーティ 1,980・子育て 1,210
 *   ミニ 4GB 2,750／10GB 3,850、ahamo 30GB 2,970
 *   通話オプション: 5分 880（割引 880）・5分（旧）770（割引 770）・
 *                  かけ放題 1,980（割引 880）・かけ放題（旧）1,870（割引 770）
 *   事務手数料 4,950、U22割 −2,728（7か月・でんき／長期を止める）
 *   dカードGOLD の還元: 割引後の月額 1,100円ごとに 100pt */
const HAND = {
  // 5,698（割引なし）。事務手数料は指定していないので初期費用0
  max_kishu: { bill: 0, initial: 0, seg1: 5698 },
  // 同上＋事務手数料 4,950 → 初期費用と翌月合算に乗る
  max_shinki: { initial: 4950, bill: 4950, seg1: 5698 },
  // 5,698 −1,210（みんな3）−1,210（光セット）＝3,278
  max_minna3_set: { seg1: 3278 },
  // 5,698 −1,210 −1,210 −550（GOLD）−110（でんき）−220（長期20年）＝2,398
  //   還元 = 2,398 ÷ 1,100 ＝ 2.18 → 2×100pt ＝ 200pt
  max_choki20_full: { seg1: 2398, dcardPt: 200 },
  mini_t1: { seg1: 3850 },
  ahamo: { seg1: 2970 },
  // 5,698 ＋ かけ放題 1,980 ＝ 7,678
  max_voice_full: { seg1: 7678, voicePrice: 1980 },
  // 5,698 −ハーティ 1,980 ＝3,718。通話は5分（旧）770 −割引 770 ＝0円
  hearty_v5l: { seg1: 3718, voicePrice: 0 },
  /* 5,698 −でんき110 −長期110 ＝5,478。
   * 1〜7か月目は U22割 −2,728 だが、でんき・長期は止まるので +220 → 2,970
   * 8か月目からは 5,478 */
  u22_denki_choki: { seg1: 2970, seg2: 5478 },
  /* 端末 129,800 を24回：129,800 ÷ 24 ＝ 5,408.33 → 毎月 5,408 円、
   * 端数 129,800 −5,408×24 ＝ 8 円は初回だけ。
   * 1〜24か月目 5,698 ＋5,408 ＝11,106、25か月目から 5,698 */
  device_b24: { seg1: 11106, seg2: 5698, deviceMonthly: 5408, firstExtra: 8 },
  /* いつでもカエドキ 129,800・23回分の総額 58,000:
   * 58,000 ÷ 23 ＝ 2,521.7 → 毎月 2,521 円、端数 58,000 −2,521×23 ＝17 円は初回。
   * 1〜23か月目 5,698 ＋2,521 ＝8,219。24か月目に返却しない場合の残価
   * 129,800 −58,000 ＝71,800 を24回 → 2,991 円（5,698 ＋2,991 ＝8,689） */
  device_kaedoki: { seg1: 8219, deviceMonthly: 2521, firstExtra: 17, keep2: 8689,
    // 残価 71,800 を24回に割ると 2,991.67 → 毎月 2,991 円。
    // 端数 71,800 −2,991×24 ＝16 円は、24か月目（残価の初回）に寄せる
    deviceAfter: 2991, deviceAfterExtra: 16 },
  /* GOLD の還元は「各種割引のあと」の金額が対象。
   * 5,698 −550 ＝5,148 から U22割 −2,728 → 2,420 が対象 → 2×100pt ＝200pt。
   * 8か月目からは 5,148 → 4×100pt ＝400pt */
  gold_u22_campaign: { seg1: 2420, seg2: 5148, dcardPt: 200, dcardPtAfter: 400 },
  /* dカード PLATINUM（5-1）。お支払割は GOLD 系と同じ 550 円。
   * 5,698 −550 ＝5,148 が還元の対象額。
   * ・20%（初年度） … 5,148 ÷1,100 ＝4.68 → 4×200pt ＝800pt
   * ・12%（2年目以降の例）… 同じ 4 に対し 4×120pt ＝480pt */
  max_platinum: { seg1: 5148, dcardPt: 800 },
  max_platinum_12: { seg1: 5148, dcardPt: 480 },

  /* ---- 2026-09-04 追加（製品化レビュー 4-8）。今まで1件も通っていなかった道 ---- */
  // 5,698 −ハーティ 1,980 ＝3,718（通話オプションを付けない場合）
  hearty_only: { seg1: 3718 },
  /* ポイ活 MAX 11,748。⑧が「もらえるポイントとして案内」のときは月額を下げない。
   * もらえるポイントの合計だけが 5,000pt として出る */
  poikatsu_no_apply: { seg1: 11748, pointTotal: 5000 },
  // 同じ入力で⑧を「月額から充当」にすると 11,748 −5,000 ＝6,748
  poikatsu_apply: { seg1: 6748, pointTotal: 5000 },
  /* dカード還元 400pt を充当。5,698 −GOLD 550 ＝5,148 −400 ＝4,748。
   * dcardPt（自動計算 400pt）とは別に、実際に引いた分が pointTotal に出る */
  gold_point_apply: { seg1: 4748, pointTotal: 400, dcardPt: 400 },
  /* いつでもカエドキ 129,800・23回分の総額 58,000・頭金 11,000:
   * 分割するのは 58,000 −11,000 ＝47,000。47,000 ÷ 23 ＝2,043.4 → 毎月 2,043 円、
   * 端数 47,000 −2,043×23 ＝11 円は初回だけ。1〜23か月目 5,698 ＋2,043 ＝7,741。
   * 頭金 11,000 は店頭お支払い（初期費用 11,000／翌月合算 0）。
   * 24か月目に返却しない場合の残価 129,800 −58,000 ＝71,800 ÷24 ＝2,991 → 8,689 */
  device_kaedoki_atamakin: { initial: 11000, bill: 0, seg1: 7741,
    deviceMonthly: 2043, firstExtra: 11, keep2: 8689 },
  /* Netflix 890 を ポイ活20 で。ポイ活20 は「MAX 系ではない」区分なので還元は 10%。
   * 890 ÷1.1 ＝809.09（税抜）→ 809.09 ×10% ＝80.9 → 切り上げ 81pt。
   * 月額は ポイ活20 7,898 ＋890 ＝8,788 */
  bakuage_std_plan: { seg1: 8788, optTotal: 890, bakuagePt: 81 },
  /* Netflix 890 を MAX で。月額は 5,698 ＋890 ＝6,588。
   * ※還元ポイントは HAND に入れていない。data.js の注記が
   *   「MAX系20%（広告つきは15%）」となっているのに、アプリは料金の選び方に
   *   かかわらず 20% で計算している（890 → 162pt。15% なら 122pt）。
   *   どちらが正しいかは公式での確認待ち。金額そのものは golden.json が見張る */
  bakuage_netflix: { seg1: 6588, optTotal: 890 },
  /* MAX の「選べる特典」は毎月2つまで0円。
   * Leminoプレミアム 1,540 ＋dアニメストア 660 の2つなら、どちらも0円 →
   * オプション合計 0・月額は 5,698 のまま。0円のものは還元の対象外なので 0pt */
  maxbonus_two: { seg1: 5698, optTotal: 0, bakuagePt: 0 },
  /* 3つ選ぶと、高いほうの2つ（DAZN 4,200・Lemino 1,540）が0円になり、
   * 残った dアニメストア 660 は支払う。月額 5,698 ＋660 ＝6,358。
   * 還元は支払っている 660 のみ: 660 ÷1.1 ＝600 → 600 ×10% ＝60pt */
  maxbonus_three: { seg1: 6358, optTotal: 660, bakuagePt: 60 }
};
// 手計算の値と、実際の計算結果を突き合わせる
function handDiff(name, got) {
  const want = HAND[name];
  if (!want || !got) return null;
  const segs = got.segs || [];
  const actual = {
    bill: got.bill, initial: got.initial, store: got.store,
    dcardPt: got.dcardPt, dcardPtAfter: got.dcardPtAfter,
    bakuagePt: got.bakuagePt, pointTotal: got.pointTotal,
    optTotal: got.optTotal, voicePrice: got.voicePrice, firstExtra: got.firstExtra,
    deviceMonthly: (got.device || {}).monthly,
    deviceAfter: (got.device || {}).after,
    deviceAfterExtra: (got.device || {}).afterFirstExtra,
    seg1: segs[0] ? segs[0].monthly : undefined,
    seg2: segs[1] ? segs[1].monthly : undefined,
    keep2: segs[1] ? segs[1].keep : undefined
  };
  /* 手計算の側にも書き間違いがありうる（seg3 など、比べる相手がない名前）。
   * 黙って通ってしまうと「見張っているつもりで見ていない」状態になる。 */
  const unknown = Object.keys(want).filter((k) => !(k in actual));
  if (unknown.length) return unknown.map((k) => `      ${k}: くらべる相手がありません`).join('\n');
  const bad = Object.keys(want).filter((k) => actual[k] !== want[k]);
  if (!bad.length) return null;
  return bad.map((k) => `      ${k}: 手計算 ${want[k]} / アプリ ${actual[k]}`).join('\n');
}

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

  /* ケースの書き間違いを弾く（4-36）。
   * 見積もりに無い名前を書いても、これまでは黙って無視されていた。
   * （8月の「長期利用割」の取り違えは、これで通ってしまっていた） */
  const validKeys = await page.evaluate(() => window.__KQ_TEST__.stateKeys());
  const keyBad = [];
  for (const [name, patch] of Object.entries(CASES)) {
    Object.keys(patch).forEach((k) => {
      if (validKeys.indexOf(k) < 0) keyBad.push(`  ✗ ${name}: 「${k}」という項目はありません`);
    });
  }
  if (keyBad.length) {
    await browser.close(); srv.close();
    console.error('ケースの書き方が違います:\n' + keyBad.join('\n')
      + '\n\n使える項目は keitai-app/app.js の defaultState() にあるものだけです。');
    process.exit(1);
  }

  const results = {};
  for (const [name, patch] of Object.entries(CASES)) {
    results[name] = await page.evaluate((p) => window.__KQ_TEST__.run(p), patch);
  }

  /* PLATINUM の還元率の欄が、画面でも出入りするか（製品化レビュー 5-1）。
   * 計算だけ直っていても、欄が出なければお店からは率を変えられない。 */
  const uiBad = [];
  await page.selectOption('#planId', 'max').catch(() => {});
  await page.waitForTimeout(300);
  const shown = (id) => page.$eval(id, (e) => {
    for (var n = e; n; n = n.parentElement) if (n.hidden) return false;
    return getComputedStyle(e).display !== 'none';
  }).catch(() => null);
  const dcPt = () => page.$eval('#dcardAutoLabel', (e) => Number((e.textContent.match(/(\d+)pt\/月/) || [])[1] || 0));
  if (await shown('#platRateWrap') !== false) uiBad.push('dカードを選ぶ前から、還元率の欄が出ています');
  await page.check('#dCardOn'); await page.waitForTimeout(200);
  await page.check('[data-dcard="gold"]'); await page.waitForTimeout(300);
  if (await shown('#platRateWrap') !== false) uiBad.push('GOLD のとき、還元率の欄が出ています');
  const goldPt = await dcPt();
  await page.check('[data-dcard="platinum"]'); await page.waitForTimeout(300);
  if (await shown('#platRateWrap') !== true) uiBad.push('PLATINUM を選んでも還元率の欄が出ません');
  if (await page.inputValue('#platRate') !== '20') uiBad.push('還元率の初期値が 20 ではありません');
  const at20 = await dcPt();
  if (!(at20 > 0 && at20 === goldPt * 2)) {
    uiBad.push(`PLATINUM 20% が GOLD 10% の2倍になりません（GOLD ${goldPt}pt / PLATINUM ${at20}pt）`);
  }
  await page.fill('#platRate', '10'); await page.dispatchEvent('#platRate', 'input');
  await page.waitForTimeout(300);
  const at10 = await dcPt();
  if (at10 !== goldPt) uiBad.push(`10% にしても GOLD と同じになりません（${at10}pt / GOLD ${goldPt}pt）`);
  await page.fill('#platRate', '99'); await page.dispatchEvent('#platRate', 'change');
  await page.waitForTimeout(300);
  if (await page.inputValue('#platRate') !== '20') uiBad.push('10〜20 の外の値が直りません');

  await browser.close();
  srv.close();

  if (errors.length) {
    console.error('JSエラーが発生しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  if (uiBad.length) {
    console.error('PLATINUM の還元率の欄に問題があります:\n  ✗ ' + uiBad.join('\n  ✗ '));
    process.exit(1);
  }
  console.log('PLATINUM の還元率の欄: 問題なし');

  /* 分割の端数が消えていないか（どのケースでも成り立つはずのこと）。
   * 見積書には「残価 ◯◯円」と「△△円/月 × 24回」を並べて出すので、
   * 掛けて足したら残価に戻らないといけない。 */
  const roundBad = [];
  for (const [name, r] of Object.entries(results)) {
    const dv = r.device || {};
    if (!dv.zanka) continue;
    const sum = dv.after * 24 + (dv.afterFirstExtra || 0);
    if (sum !== dv.zanka) {
      roundBad.push(`  ✗ ${name}: 残価 ${dv.zanka} ≠ ${dv.after}×24 ＋${dv.afterFirstExtra || 0} ＝${sum}`);
    }
  }
  if (roundBad.length) {
    console.error('残価の割り直しで端数が消えています:\n' + roundBad.join('\n'));
    process.exit(1);
  }

  /* 手計算の期待値との突き合わせ（4-8・4-36）。
   * golden.json を作り直しても、ここは人が書いた数字のまま残る。 */
  const handBad = [];
  for (const name of Object.keys(HAND)) {
    if (!(name in CASES)) { handBad.push(`  ✗ ${name}: 手計算の期待値はあるが、ケースがありません`); continue; }
    const d = handDiff(name, results[name]);
    if (d) handBad.push(`  ✗ ${name}\n${d}`);
  }
  if (handBad.length) {
    console.error('手計算の期待値と合いません（' + handBad.length + '件）:\n' + handBad.join('\n')
      + '\n\n料金表を変えたのなら、tests/run-calc-tests.js の HAND と計算の式も直してください。'
      + '\nそうでなければ、計算の側が変わっています。');
    process.exit(1);
  }
  console.log(`手計算の期待値: ${Object.keys(HAND).length}/${Object.keys(HAND).length} OK`);

  if (UPDATE) {
    const before = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
    const diffs = [];
    for (const name of Object.keys(results)) {
      const a2 = JSON.stringify(before[name]);
      const b2 = JSON.stringify(results[name]);
      if (a2 !== b2) diffs.push(`  ${name}\n    前: ${a2 === undefined ? '（新しいケース）' : a2}\n    後: ${b2}`);
    }
    for (const name of Object.keys(before)) {
      if (!(name in results)) diffs.push(`  ${name}\n    前: ${JSON.stringify(before[name])}\n    後: （ケースが消えました）`);
    }
    if (!diffs.length) { console.log('golden.json との差はありません。'); return; }
    console.log(`golden.json との差（${diffs.length}件）:\n` + diffs.join('\n'));
    if (!YES) {
      console.log('\n中身を確かめて、意図した変更であれば --yes を付けて実行してください:');
      console.log('  node tests/run-calc-tests.js --update --yes');
      return;
    }
    fs.writeFileSync(GOLDEN, JSON.stringify(results, null, 2) + '\n');
    console.log(`\ngolden.json を更新しました（${Object.keys(results).length}ケース）`);
    return;
  }

  if (!fs.existsSync(GOLDEN)) {
    console.error('tests/golden.json がありません。node tests/run-calc-tests.js --update で作成してください。');
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  let ok = 0; const bad = [];
  for (const name of Object.keys(CASES)) {
    const a = JSON.stringify(golden[name]);
    const b = JSON.stringify(results[name]);
    if (a === b) { ok++; continue; }
    bad.push(`✗ ${name}\n    期待: ${a}\n    実際: ${b}`);
  }
  for (const name of Object.keys(golden)) {
    if (!(name in CASES)) bad.push(`✗ ${name}: golden にあるがケース定義に無い`);
  }
  console.log(`金額計算テスト: ${ok}/${Object.keys(CASES).length} OK`);
  if (bad.length) {
    console.error(bad.join('\n'));
    console.error('\n意図した料金変更の場合は node tests/run-calc-tests.js --update で golden を更新してください。');
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
