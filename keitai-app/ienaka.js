/* ── イエナカ見積もり（フロントークに組み込む版） ────────────
 * 単体版（ienaka-app/app.js）から、料金の計算と入力画面だけを移してある。
 * 保存・端末間同期・ログイン・担当者はケータイ側が持っているので入れない。
 *
 * 画面のidは、ケータイ側とぶつからないよう頭に ie を付けている
 * （product → ieProduct）。data-属性も同じ理由で ie を付けている。
 *
 * 入力内容はケータイ側の store.ienaka を直接読み書きする。
 * 光は世帯に1本なので、回線ごとのパターン（回線1・2・3）では分けない。
 *
 * 計算そのものは単体版と同じ。直すときは両方に同じ変更を入れること。 */
(function () {
  "use strict";

  var state = null;                 // ケータイ側の store.ienaka を指す
  var onChange = function () {};    // 保存と再描画をケータイ側へ知らせる

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function yen(n) { return (n < 0 ? "\u2212" : "") + Math.abs(Math.round(n)).toLocaleString("ja-JP") + "円"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function recalc() { render(); onChange(); }

  /* 標準料金（2026-07-24 ドコモ公式サイト調査値。入力欄でいつでも変更可） */
  var PRODUCTS = {
    hikari1g: {
      name: "ドコモ光 1ギガ",
      monthly: { ht: { A: 5720, B: 5940 }, ms: { A: 4400, B: 4620 } },
      jimu: 4950, koji: { ht: 28600, ms: 28600 },
      note: "2年定期契約・税込。タイプBはタイプA＋220円。新規工事料28,600円（実質0円特典あり・エントリー不要）。"
    },
    hikari10g: {
      name: "ドコモ光 10ギガ",
      monthly: { ht: { A: 6380, B: 6600 }, ms: { A: 6380, B: 6600 } },
      jimu: 4950, koji: { ht: 28600, ms: 28600 },
      note: "2年定期契約・税込。提供エリア・対応設備の確認が必要。新規工事料28,600円（実質0円特典あり・エントリー不要）。"
    },
    hikaric: {
      name: "ドコモ光 1ギガ タイプC",
      monthly: { ht: { A: 5720, B: 5720 }, ms: { A: 4400, B: 4400 } },
      jimu: 4950, koji: { ht: 28600, ms: 28600 }, noPtype: true, typec: true,
      /* 料金はタイプAと同額（docomo.ne.jp/internet/hikari/charge/type_c/ 2026-08-20確認）。
       * ケーブルテレビ（ZTV等）の設備で提供。お電話・テレビはケーブルテレビ契約のまま残る。
       * 新規工事料の公表額が見当たらないため1ギガと同額を仮置き（入力欄で変更可）。 */
      note: "2年定期契約・税込・料金はタイプAと同額。ケーブルテレビ（ZTV等）の設備で提供。お電話・テレビはケーブルテレビのご契約のまま（ドコモ光電話・テレビオプション申込不可）。ZTVは集合住宅対象外。"
    },
    ahamo1g: {
      name: "ahamo光 1ギガ",
      monthly: { ht: { A: 4950, B: 4950 }, ms: { A: 3630, B: 3630 } },
      jimu: 4950, koji: { ht: 28600, ms: 28600 }, noPtype: true,
      note: "ahamoユーザー専用（ペア回線必須）・2年定期契約・税込・プロバイダ一体型。ドコモ光セット割の対象外。ルーターはレンタル330円/月または持込。"
    },
    ahamo10g: {
      name: "ahamo光 10ギガ",
      monthly: { ht: { A: 5610, B: 5610 }, ms: { A: 5610, B: 5610 } },
      jimu: 4950, koji: { ht: 28600, ms: 28600 }, noPtype: true,
      note: "ahamoユーザー専用（ペア回線必須）・2年定期契約・税込・戸建/マンション共通5,610円。セット割対象外。ルーターはレンタル550円/月または持込。"
    },
    home5g: {
      name: "home 5G",
      monthly: 5280,
      jimu: 4950, koji: 0,
      note: "工事不要・コンセントに挿すだけ。プラン月額5,280円（税込）・事務手数料4,950円（店頭）。"
    }
  };
  function is10g() { return state.product === "hikari10g" || state.product === "ahamo10g"; }
  /* 10Gルーターを買っていただくのはドコモ光 10ギガだけ。
   * ahamo光はプロバイダ一体型で、対応ルーターは月額レンタルか持込になる。 */
  function canBuy10gRouter() { return state.product === "hikari10g"; }
  /* 10ギガの対応ルーターは、プロバイダによって取り扱いが違う。
   *
   * @nifty … 優待価格の分割購入。バッファロー WSR6500BE6P-10G を
   *          月額418円（税込）×48回＝総額20,064円（税込）。
   *          ニフティで購入する場合、ドコモの「10Gbps対応無線LANルーター」
   *          （月額550円）の契約は不要。
   *          ※ページの「380円/月・総額18,240円」は税抜表示。
   *            この見積もりは全体を税込で作っているため税込額を既定にしている。
   *          出典: https://setsuzoku.nifty.com/docomo/option/router_purchase/
   *                （2026-07-30 確認）
   *          @nifty は一括か48回分割のみ（36回の取り扱いは無い）。
   * GMOとくとくBB … 月額190円（税込）×36回＝総額6,840円（税込）。
   *          一括か36回分割のみ。
   * それ以外 … 取り扱いが分からないので、一括・36回・48回すべて出す。 */
  var ROUTER10G = {
    "@nifty": { price: 20064, pay: "b48", pays: ["once", "b48"] },
    "GMOとくとくBB": { price: 6840, pay: "b36", pays: ["once", "b36"] }
  };
  var ROUTER10G_DEFAULT_PAYS = ["once", "b36", "b48"];
  /* ルーターの分割回数と、選択肢に出す名前。
   * 回数を増やすときは、この2つの表に足すだけでよい（画面・計算・見積書・
   * 引き継ぎシートは、すべてこの表を見て動く）。 */
  var ROUTER10G_SPLIT = { b36: 36, b48: 48 };
  var ROUTER10G_PAY_LABEL = {
    once: "一括（初期費用）",
    b36: "36回分割（3年・月額に加算）",
    b48: "48回分割（月額に加算）"
  };
  function router10gSplitN() { return ROUTER10G_SPLIT[state.router10gPay] || 0; }
  /* そのプロバイダで実際に選べる払い方だけを出す。
   * 取り扱いの無い回数を選べてしまうと、店頭で存在しない支払い方法を
   * 案内することになるため。取り扱いが分からないプロバイダは全部出す。 */
  function router10gPays() {
    var d = ROUTER10G[state.provider];
    return (d && d.pays) || ROUTER10G_DEFAULT_PAYS;
  }
  function renderRouter10gPays(sel) {
    if (!sel) return;
    var pays = router10gPays();
    // 選べない払い方が選ばれたままにならないようにする
    if (pays.indexOf(state.router10gPay) < 0) state.router10gPay = pays[0];
    var h = "";
    pays.forEach(function (k) {
      h += '<option value="' + k + '">' + ROUTER10G_PAY_LABEL[k] + "</option>";
    });
    sel.innerHTML = h;
  }
  var ROUTER10G_DEFAULT = { price: 6780, pay: "once" };
  function router10gDefault() { return ROUTER10G[state.provider] || ROUTER10G_DEFAULT; }
  /* プロバイダや商材が変わったら、ルーターの価格と払い方を既定に戻す。
   * 手で直した金額は、そのプロバイダの中で入力しているあいだは残る。 */
  function applyRouter10gDefault() {
    var d = router10gDefault();
    state.router10gPrice = d.price;
    state.router10gPay = d.pay;
  }
  /* 住居タイプ。マンションは設備の最大速度で 100M と 1G に分かれるが、
   * 料金はどちらも同じなので、料金表を引くときは "ms" にまとめる。
   * 100M かどうかは表示と引き継ぎシートのために持っておく。 */
  var HOUSING_LABEL = { ht: "戸建", ms: "マンション", ms100: "マンション100M" };
  function hKey() { return state.housing === "ms100" ? "ms" : state.housing; }
  function isHikari() { return state.product !== "home5g"; }
  /* 月額オプション（チェック式・金額は見積もりごとに編集可）
   * koji: チェック時に初期費用へ自動加算される工事料（同時申込時の公式価格） */
  var IENAKA_OPTS = [
    /* phone: 光電話の印。番号ポータビリティの選択と、同番移行2,200円・
     * 10ギガ機器設置1,650円の判定に使う。
     * 交換機等工事費1,100円（koji）は初期費用に自動で入れるが、
     * タイル横の「工事料+1,100円」の表示は出さない（店舗の指定・2026-08-09）。 */
    { id: "denwa", name: "ドコモ光電話", price: 550, phone: true, koji: 1100, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "denwaBV", name: "ドコモ光電話バリュー", price: 1650, phone: true, koji: 1100, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    /* 電話の付加サービス。金額と「バリューに含まれるか（inBV）」は
     * docomo.ne.jp/internet/hikari/tell_service/service/ の表のとおり（2026-08-14 確認）。
     * inBV の6つはバリュー選択中はタイルを出さない（含まれているため）。 */
    { id: "dpNumDisp", name: "発信者番号表示（ナンバー・ディスプレイ）", price: 440, needsPhone: true, inBV: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpCatch", name: "通話中着信", price: 330, needsPhone: true, inBV: true, phoneMore: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpNumReq", name: "ナンバー・リクエスト", price: 220, needsPhone: true, inBV: true, phoneMore: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpMeiwaku", name: "迷惑電話ストップサービス", price: 220, needsPhone: true, inBV: true, phoneMore: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpChakushin", name: "着信お知らせメール", price: 110, needsPhone: true, inBV: true, phoneMore: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpTensou", name: "転送でんわ", price: 550, needsPhone: true, inBV: true, phoneMore: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpWch", name: "ダブルチャネル", price: 220, needsPhone: true, phoneMore: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpAddNum", name: "追加番号", price: 110, needsPhone: true, phoneMore: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "tv", name: "ドコモ光テレビオプション", price: 990, tvKoji: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "skyp", name: "映像サービス", price: 0, sumOf: "needsVideo", for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    /* 映像サービスの内訳（「映像サービス」にチェックしたときだけ表示）。金額は見積もりごとに変更可。
     * 社内版（ienaka/ienaka.js）から移植。これまで見出し1行・0円のままで、
     * チェックしても月額に乗らない誤りがあった。 */
    { id: "vsHikariTv", name: "ひかりTV 専門チャンネルプラン（チューナーレンタル込み）", price: 3850, needsVideo: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "vsHikariHajime", name: "ひかりTV初めて割（2年間）", price: -1100, timedMonths: 24, needsVideo: true, needsHikariTv: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "vsSkyBase", name: "スカパー！基本料", price: 429, needsVideo: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "vsSkyBasic", name: "スカパー！基本プラン", price: 3960, needsVideo: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "vsSelect5", name: "スカパー！セレクト5", price: 1980, needsVideo: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "vsSelect10", name: "スカパー！セレクト10", price: 2860, needsVideo: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    /* 無線LANのレンタルは回線の速さで品目と月額が違う（公式の機器使用料の表・2026-08-14 確認）。
     * 1ギガは330円、10ギガは「10ギガ対応無線LANルーター」550円。 */
    { id: "lanCard", name: "無線LANカード", price: 330, for: ["hikari1g"] },
    { id: "lanRouter10g", name: "10ギガ対応無線LANルーター（レンタル）", price: 550, for: ["hikari10g"] },
    /* ahamo光はプロバイダ一体型で、OCNバーチャルコネクト対応ルーターが要る。
     * ドコモからの月額レンタルか、お客様の持込になる（優待購入の取り扱いは無い）。
     * 1ギガ330円／10ギガ550円。
     * 出典: https://www.docomo.ne.jp/internet/ahamo_hikari/10g_plan/ （2026-07-30 確認） */
    { id: "ahamoRouter", name: "ルーターレンタル（OCNバーチャルコネクト対応）", price: 330, for: ["ahamo1g"] },
    { id: "ahamoRouter10g", name: "ルーターレンタル（10ギガ・OCNバーチャルコネクト対応）", price: 550, for: ["ahamo10g"] },
    { id: "apHome", name: "あんしんパック ホーム（デジタル機器補償＋ネットトータルサポート＋ネットワークセキュリティ）", price: 968, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g", "home5g"] },
    { id: "h5hosho", name: "smartあんしん補償", price: 330, for: ["home5g"] },
    { id: "h5pack", name: "home 5G パック（smartあんしん補償＋ネットワークセキュリティ・165円割引込）", price: 550, for: ["home5g"] }
  ];
  /* テレビ工事の選択肢
   * koji=ドコモ請求の工事料（分割対象）/ reg=視聴サービス登録料（手数料・分割対象外・常に一括）
   * onsite=スカパーへ工事当日に現地払いする接続工事費（ドコモ請求外・分割対象外） */
  var TV_KOJI = {
    sky: { label: "スカパー工事（スカパー同時申込・接続工事無料）", rowName: "テレビ基本工事料（スカパー工事・接続工事無料）", koji: 3300, reg: 3080, onsite: 0 },
    skyOnly: { label: "スカパー工事のみ（未加入・接続工事は当日現地払い）", rowName: "テレビ基本工事料（スカパー工事のみ）", koji: 3300, reg: 3080, onsite: 10000 },
    ntt1: { label: "NTT工事（テレビ1台）", rowName: "テレビ工事料（NTT工事・1台）", koji: 10450, reg: 3080, onsite: 0 },
    ntt24: { label: "NTT工事（テレビ2〜4台）", rowName: "テレビ工事料（NTT工事・2〜4台）", koji: 28380, reg: 3080, onsite: 0 }
  };

  function defaultState() {
    return {
      product: "hikari1g", applyType: "shinki", housing: "ht", ptype: "A", provider: "", providerType: "shinki", routerRental: "ari",
      visitSupport: false,             // 訪問設定サポート希望（@niftyフォローコールで日程調整）
      baseMonthly: 5720, tvPoint: true,
      h5DeviceName: "home 5G HR02", h5DevicePrice: 73260, h5Pay: "b48", h5Support: true,
      opts: {}, optPrices: {},
      extraMonthly: [], extraInitial: [],
      jimuFee: 4950, kojiFee: 28600, kojiPay: "b24", kojiFree: true, tvKoji: "sky",
      denwaBanpo: "mnp", onecoin: true, tvKojiFee: null, tvOnsiteFee: null,
      router10g: true, router10gPrice: 6780, router10gPay: "once",
      dcard: "none", dcardPt: null, h5Mig: false, storeCash: 0, storePt: 0, setWariTotal: 0,
      dpoint: 20000, custName: "", staffName: "", quoteMemo: "",
      typecKeepAmt: 0,                 // タイプC: ケーブルテレビに残る月額（参考表示のみ・計算に入れない）
      /* 転用（タイプC）のいまの回線設備。hikari=光回線（工事なし）／coax=同軸ケーブル
       * （光への切り替え工事あり。工事はケーブルテレビ会社が行う・2026-08-29共有）。
       * typecKoji はその工事料（同社の案内額。わかるときだけ入れる・初期費用に載る） */
      typecLine: "hikari", typecKoji: null,
      curLine: "", curLineOther: "",   // 現在お使いの回線（ヒアリング・奪還比較の入口）
      /* 現在の固定回線ヒアリング（電話・テレビ）。J:COMはテレビを残したまま
       * ネットだけ乗り換えるご案内があるため、テレビの有無と残すかどうかを控える */
      curPhone: "", curTv: "", curTvDigi: false, curTvBs: false, curTvCs: false, curTvKeep: false,
      flowDates: {},                   // 開通までの流れ（1枚）の予定日メモ {工程番号: 文字}
      enabled: false   // この見積もりに光・home 5G を含めるか（見積書に出すかどうか）
    };
  }

  /* 商材・住居・タイプ変更時に標準料金をセット */
  function applyDefaults() {
    if (!state) return;
    var p = PRODUCTS[state.product];
    /* タイプCはマンションタイプの提供がない（提携ケーブルテレビの提供条件）。
     * 料金を引く前に戸建へ寄せる（マンションのまま引くと金額がずれる） */
    if (p.typec && state.housing !== "ht") state.housing = "ht";
    if (state.product === "home5g") {
      state.baseMonthly = p.monthly;
      state.kojiFee = 0; state.kojiFree = false;
    } else {
      state.baseMonthly = p.monthly[hKey()][state.ptype];
      state.kojiFee = p.koji[hKey()];
      if (canBuy10gRouter()) applyRouter10gDefault();
    }
    state.jimuFee = p.jimu;
  }

  // 見出しオプション（映像サービスなど）に紐づく、選択中の内訳の合計月額
  function groupTotal(parent) {
    var t = 0;
    IENAKA_OPTS.forEach(function (c) {
      if (!c[parent.sumOf] || !state.opts[c.id]) return;
      if (c.for.indexOf(state.product) < 0) return;
      if (c.needsHikariTv && !state.opts.vsHikariTv) return;
      t += state.optPrices[c.id] != null ? num(state.optPrices[c.id]) : c.price;
    });
    return t;
  }
  // 見出しの合計表示だけを更新する（内訳の金額を編集した直後に使う）
  function updateGroupTotals() {
    IENAKA_OPTS.forEach(function (o) {
      if (!o.sumOf || !state.opts[o.id]) return;
      var cb = document.querySelector('#ieOptList input[data-ieopt="' + o.id + '"]');
      if (!cb) return;
      var span = cb.parentElement.querySelector(".opt-price");
      if (span) span.textContent = "合計 " + yen(groupTotal(o)) + "/月";
    });
  }

  /* ---------- 計算 ---------- */
  function calc() {
    var p = PRODUCTS[state.product];
    var rows = [{ name: p.name + productLabel(), amount: num(state.baseMonthly) }];
    var phoneOn = !!(state.opts.denwa || state.opts.denwaBV);
    var optTimed = []; // 期間限定のオプション割引（あとで月額の推移へ反映）
    IENAKA_OPTS.forEach(function (o) {
      if (o.for.indexOf(state.product) < 0) return;
      if (o.needsPhone && !phoneOn) return; // 光電話の付加サービスは光電話利用時のみ
      if (o.needsVideo && !state.opts.skyp) return; // 映像サービスの内訳は映像サービス利用時のみ
      if (o.needsHikariTv && !state.opts.vsHikariTv) return; // ひかりTV利用時のみ
      if (!state.opts[o.id]) return;
      var pr = state.optPrices[o.id] != null ? num(state.optPrices[o.id]) : o.price;
      if (o.timedMonths) { optTimed.push({ name: o.name, amount: pr, from: 1, to: o.timedMonths }); return; }
      if (o.sumOf) return; // 見出し行。金額は内訳側で計上する
      // 映像サービス（ひかりTV・スカパー）はドコモ光の利用料金ではないため、dカード還元の対象外
      rows.push({ name: o.name, amount: pr, noDcard: !!(o.needsVideo || o.needsHikariTv) });
    });
    state.extraMonthly.forEach(function (a) {
      if (!a.name && !num(a.amount)) return;
      rows.push({ name: a.name || "追加項目", amount: num(a.amount) });
    });

    // dカードGOLD/PLATINUM還元: 利用料金1,100円（税込）ごとに100pt（GOLD 10%）/ 200pt（PLATINUM 20%）
    var dcardEligible = 0;
    rows.forEach(function (x) { if (x.amount > 0 && !x.noDcard) dcardEligible += x.amount; });
    var dcardRate = state.dcard === "gold" ? 100 : state.dcard === "platinum" ? 200 : 0;
    var dcardAutoPt = dcardRate > 0 ? Math.floor(dcardEligible / 1100) * dcardRate : 0;
    var dcardPt = state.dcard === "none" ? 0 : (state.dcardPt != null ? Math.max(0, num(state.dcardPt)) : dcardAutoPt);
    if (dcardPt > 0) {
      // ポイント進呈ではなく、毎月の料金へ自動充当される体裁で月額から差引
      rows.push({ name: "dカード" + (state.dcard === "gold" ? "GOLD" : "PLATINUM") + "還元 充当（利用料金の" + (state.dcard === "gold" ? "10" : "20") + "%）", amount: -dcardPt });
    }

    // 期間限定の月額項目 {name, amount, from, to}（工事費分割・ポイント充当・端末分割）
    var timed = [], deviceNote = "";
    optTimed.forEach(function (t) { timed.push(t); });

    // 10ギガ ワンコインキャンペーン: 開通〜最大6か月目まで基本料500円（税込）
    var onecoinOn = is10g() && state.onecoin && num(state.baseMonthly) > 500;
    if (onecoinOn) {
      timed.push({ name: "10ギガ ワンコインキャンペーン（基本料500円・〜6か月目）", amount: -(num(state.baseMonthly) - 500), from: 1, to: 6 });
    }
    if (state.product === "home5g") {
      var dp = num(state.h5DevicePrice);
      var dName = state.h5DeviceName || "home 5G 端末";
      if (dp > 0) {
        var dm = Math.floor(dp / 48);
        if (state.h5Pay !== "ikkatsu") {
          timed.push({ name: dName + " 分割支払金（48回）", amount: dm, from: 1, to: 48 });
        }
        if (state.h5Support) {
          timed.push({ name: "月々サポート（48か月間）", amount: -dm, from: 1, to: 48 });
          deviceNote = state.h5Pay === "ikkatsu"
            ? "月々サポート適用: 毎月の料金から" + yen(dm) + "×48か月を割引"
            : "月々サポート適用で端末実質負担0円（48か月継続利用の場合）";
        } else if (state.h5Pay === "ikkatsu") {
          deviceNote = "端末代金は一括払い（初期費用に計上）";
        }
      }
    }

    // 工事費（ドコモ光のみ）: 回線の新規工事料＋オプション工事料（光電話・テレビ）
    // 分割24回を選ぶと工事料の合計を24回で分割。テレビ視聴サービス登録料は手数料のため分割対象外（常に一括）
    // 回線工事費: 申込区分から自動判定（新規=標準28,600円／転用・事業者変更=0円）
    var koji = 0;
    if (isHikari() && state.applyType === "shinki") {
      koji = PRODUCTS[state.product].koji[hKey()];
    }
    // オプション工事料も新規のみ自動加算（転用・事業者変更は設備そのまま移行のため0円）
    var optKoji = 0, optKojiRows = [], tvRegRows = [], phoneKoji = 0, phoneChecked = false;
    if (isHikari() && state.applyType === "shinki") {
      IENAKA_OPTS.forEach(function (o) {
        if (o.for.indexOf(state.product) < 0 || !state.opts[o.id]) return;
        if (o.phone) phoneChecked = true;
        if (o.koji) phoneKoji += o.koji;
        if (o.tvKoji) {
          var tk = TV_KOJI[state.tvKoji] || TV_KOJI.sky;
          var tkFee = state.tvKojiFee != null ? num(state.tvKojiFee) : tk.koji; // 金額は編集可
          optKoji += tkFee;
          optKojiRows.push({ name: tk.rowName, amount: tkFee });
          tvRegRows.push({ name: "テレビ視聴サービス登録料（手数料・分割対象外）", amount: tk.reg });
          // スカパーへ工事当日に現地払いする接続工事費（ドコモ請求外・分割対象外）
          var onsite = state.tvOnsiteFee != null ? num(state.tvOnsiteFee) : (tk.onsite || 0);
          if (onsite > 0) {
            tvRegRows.push({ name: "テレビ接続工事費（スカパーへ工事当日お支払い・現地払い）", amount: onsite });
          }
        }
      });
      // 番号ポータビリティ（同番移行）: 光電話利用時のみ・2,200円/番号（公式PDF確認値）
      if (phoneChecked && state.denwaBanpo === "mnp") phoneKoji += 2200;
      // 10ギガで光電話利用時は対応ルーターの機器設置工事料1,650円が追加（公式PDF＊8）
      if (phoneChecked && is10g()) phoneKoji += 1650;
      // 光電話まわりの工事料（交換機等・同番移行・10G機器設置）は1行にまとめて表示
      if (phoneKoji > 0) {
        optKoji += phoneKoji;
        optKojiRows.unshift({ name: "光電話工事費", amount: phoneKoji });
      }
    }
    var kojiTotal = koji + optKoji;
    /* 実質0円特典のポイントは回線の新規工事料相当分のみ。
     * 進呈は「ご利用開始月の7か月後の月から24か月間分割」（＝8か月目〜31か月目）。
     * 2026年6月1日以降のお申込み分から、それまでの「1か月後の月から」より
     * 6か月遅くなった。エントリーは不要で、条件を満たせば自動で対象になる。
     * 出典: https://www.docomo.ne.jp/campaign_event/hikari_shinkikojiryo_free/
     *       https://www.docomo.ne.jp/info/notice/page/260423_00.html （2026-07-30 確認） */
    var kojiPt = Math.floor(koji / 24);
    if (kojiTotal > 0 && state.kojiPay === "b24") {
      timed.push({ name: "工事料 分割（24回・総額" + yen(kojiTotal) + "）", amount: Math.floor(kojiTotal / 24), from: 1, to: 24 });
    }
    if (koji > 0 && state.kojiFree) {
      timed.push({ name: "工事費相当ポイント充当（利用開始の7か月後から24回進呈）", amount: -kojiPt, from: 8, to: 31 });
    }
    // 10Gルーターの分割購入。一括のときは下の初期費用へ回す
    var r10g = canBuy10gRouter() && state.router10g ? num(state.router10gPrice) : 0;
    var r10gN = router10gSplitN();
    var r10gSplit = r10g > 0 && r10gN > 0;
    if (r10gSplit) {
      timed.push({ name: "10Gルーター 分割（" + r10gN + "回・総額" + yen(r10g) + "）",
        amount: Math.floor(r10g / r10gN), from: 1, to: r10gN });
    }

    // 期間セグメント（変化点ごとの月額）
    var permanent = 0;
    rows.forEach(function (r) { permanent += r.amount; });
    var startSet = { 1: 1 };
    timed.forEach(function (t) { startSet[t.from] = 1; startSet[t.to + 1] = 1; });
    var starts = Object.keys(startSet).map(Number).sort(function (a, b) { return a - b; });
    var segs = [];
    starts.forEach(function (s, i) {
      var end = i + 1 < starts.length ? starts[i + 1] - 1 : null;
      var m = permanent;
      timed.forEach(function (t) { if (s >= t.from && s <= t.to) m += t.amount; });
      m = Math.max(0, m);
      if (segs.length && segs[segs.length - 1].monthly === m) { segs[segs.length - 1].to = end; return; }
      segs.push({ from: s, to: end, monthly: m });
    });

    var initRows = [];
    if (num(state.jimuFee) > 0) initRows.push({ name: "契約事務手数料", amount: num(state.jimuFee) });
    if (kojiTotal > 0 && state.kojiPay !== "b24") {
      if (koji > 0) initRows.push({ name: "新規工事料（一括）", amount: koji });
      optKojiRows.forEach(function (x) { initRows.push(x); });
    }
    // 視聴サービス登録料は手数料のため常に一括で初期費用へ
    tvRegRows.forEach(function (x) { initRows.push(x); });
    // 10Gルーター購入費用（10ギガ選択時・チェック式）。分割のときは月額に入っている
    if (r10g > 0 && !r10gSplit) {
      initRows.push({ name: "10Gルーター購入費用", amount: r10g });
    }
    if (state.product === "home5g" && state.h5Pay === "ikkatsu" && num(state.h5DevicePrice) > 0) {
      initRows.push({ name: (state.h5DeviceName || "home 5G 端末") + "（一括）", amount: num(state.h5DevicePrice) });
    }
    /* 転用（タイプC）で、いまの回線が同軸ケーブルの場合の光切り替え工事料。
     * 工事はケーブルテレビ会社が行い、金額も同社の案内による（2026-08-29共有）。
     * 金額がわかっているときだけ入力してもらい、一括の初期費用として載せる。 */
    if (isHikari() && state.applyType === "kirikae"
        && (state.typecLine || "hikari") === "coax" && num(state.typecKoji) > 0) {
      initRows.push({ name: "光切り替え工事料（ケーブルテレビ会社の請求）", amount: num(state.typecKoji) });
    }
    state.extraInitial.forEach(function (a) {
      if (!a.name && !num(a.amount)) return;
      initRows.push({ name: a.name || "追加項目", amount: num(a.amount) });
    });
    var initial = 0;
    initRows.forEach(function (r) { initial += r.amount; });

    // テレビオプションが選択されているか（特典判定用・区分によらず）
    var tvOn = false;
    IENAKA_OPTS.forEach(function (o) {
      if (o.tvKoji && o.for.indexOf(state.product) >= 0 && state.opts[o.id]) tvOn = true;
    });

    return {
      rows: rows, timed: timed, segs: segs, deviceNote: deviceNote,
      monthly: segs[0].monthly, koji: koji, kojiPt: kojiPt,
      kojiTotal: kojiTotal, optKojiRows: optKojiRows, tvRegRows: tvRegRows,
      tvOn: tvOn,
      dcardAutoPt: dcardAutoPt, dcardPt: dcardPt, dcardEligible: dcardEligible,
      initRows: initRows, initial: Math.max(0, initial)
    };
  }
  function segLabel(sg) {
    if (sg.to == null) return sg.from === 1 ? "毎月" : sg.from + "か月目以降";
    return (sg.from === 1 ? "〜" : sg.from + "〜") + sg.to + "か月目";
  }
  /* kirikae（内部の値の名前は昔のまま）＝ケーブルテレビのネットからタイプCへの
   * 乗り換え。表記は「転用（タイプC）」（店舗の指定・2026-08-29。工事なしの扱いは変わらない） */
  var APPLY_LABEL = { shinki: "新規", tenyo: "転用", jigyosha: "事業者変更", kirikae: "転用（タイプC）" };
  function productLabel() {
    if (state.product === "home5g") return "";
    var parts = [HOUSING_LABEL[state.housing] || "戸建"];
    if (!PRODUCTS[state.product].noPtype) parts.push("タイプ" + state.ptype);
    parts.push(APPLY_LABEL[state.applyType] || "新規");
    return "（" + parts.join("・") + "）";
  }

  /* ---------- 画面描画 ----------
   * 月額オプションは、スマホの補償・セキュリティと同じタイルで選ぶ
   * （小川さんの指定・2026-08-13）。グループはスケッチの構成に合わせる。
   *   でんわ（基本・排他）→ でんわ追加 → TV（地デジ・BS）→ スカパー！（CS）
   *   → ひかりTV → そのほか
   * 「映像サービス」の見出し（skyp）はタイルに出さず、内訳が選ばれているか
   * どうかで自動で付ける（計算と見積書の互換のため）。 */
  /* 出番の少ないものは畳んでおく（店舗の指定・2026-08-14）。
   *   でんわ追加 … 表に出すのは発信者番号表示だけ。「その他のでんわオプション」
   *                 のチェックで残りが出る（state.opts.phoneMore）
   *   スカパー！・ひかりTV … 「映像系サービス」のチェックで出る（state.opts.skyp。
   *                 昔の「映像サービス」見出しと同じキーなので、計算・見積書・
   *                 保存済みデータとの互換はそのまま） */
  var IE_OPT_GROUPS = [
    { title: "でんわオプション（基本）", ids: ["denwa", "denwaBV"], phoneBase: true },
    { title: "でんわ追加オプション",
      ids: ["dpNumDisp", "dpCatch", "dpNumReq", "dpMeiwaku", "dpChakushin", "dpTensou", "dpWch", "dpAddNum"],
      needsPhone: true, moreToggle: true },
    { title: "TVオプション（地デジ・BS）", ids: ["tv"], tvBase: true, videoToggleAfter: true },
    { title: "スカパー！（CS）", ids: ["vsSkyBase", "vsSkyBasic", "vsSelect5", "vsSelect10"], needsVideo: true },
    { title: "ひかりTV", ids: ["vsHikariTv", "vsHikariHajime"], needsVideo: true },
    { title: "そのほかのオプション", ids: ["lanCard", "lanRouter10g", "ahamoRouter", "ahamoRouter10g", "apHome", "h5hosho", "h5pack"] }
  ];
  function ieOptById(id) {
    return IENAKA_OPTS.filter(function (x) { return x.id === id; })[0];
  }
  function toggleIeOpt(id) {
    var od = ieOptById(id);
    if (!od) return;
    var on = !state.opts[id];
    state.opts[id] = on;
    /* でんわの基本は排他。バリューを選んだら、含まれている
     * 発信者番号表示・転送でんわの単品も外す（二重にならないように） */
    if (on && id === "denwa") delete state.opts.denwaBV;
    if (on && id === "denwaBV") {
      delete state.opts.denwa;
      IENAKA_OPTS.forEach(function (o) { if (o.inBV) delete state.opts[o.id]; });
    }
    if (!state.opts.denwa && !state.opts.denwaBV) {
      IENAKA_OPTS.forEach(function (o) { if (o.needsPhone) delete state.opts[o.id]; });
    }
    if (id === "vsHikariTv" && !on) delete state.opts.vsHikariHajime;
    /* 10ギガのルーターは、レンタルと購入のどちらか一方。
     * レンタルを選んだら購入のチェックを外す（店舗の指定・2026-08-14） */
    if (id === "lanRouter10g" && on) { state.router10g = false; syncForm(); }
    renderOpts();
    recalc();
  }
  function renderOpts() {
    if (!state) return;
    var shinki = state.applyType === "shinki" && state.product !== "home5g";
    var phoneOn = !!(state.opts.denwa || state.opts.denwaBV);
    var h = "";
    IE_OPT_GROUPS.forEach(function (g) {
      if (g.needsPhone && !phoneOn) return;
      if (g.needsVideo && !state.opts.skyp) return;
      var items = g.ids.map(ieOptById).filter(function (o) {
        if (!o || o.for.indexOf(state.product) < 0) return false;
        if (o.needsHikariTv && !state.opts.vsHikariTv) return false;
        /* バリューに含まれるものは、バリュー選択中は出さない */
        if (state.opts.denwaBV && o.inBV) return false;
        /* 出番の少ない電話オプションは「その他」を開いたときだけ */
        if (o.phoneMore && !state.opts.phoneMore) return false;
        return true;
      });
      var toggles = "";
      if (g.moreToggle) {
        toggles += '<label class="check ie-more"><input type="checkbox" data-ieopt="phoneMore"'
          + (state.opts.phoneMore ? " checked" : "") + "> その他のでんわオプションを表示</label>";
      }
      if (g.videoToggleAfter) {
        toggles += '<label class="check ie-more"><input type="checkbox" data-ieopt="skyp"'
          + (state.opts.skyp ? " checked" : "") + "> 映像系サービス（スカパー！・ひかりTV）を表示</label>";
      }
      if (!items.length && !toggles) return;
      h += '<div class="opt-cat">' + esc(g.title) + "</div>";
      h += '<div class="tile-grid ie-grid">' + items.map(function (o) {
        var on = !!state.opts[o.id];
        var pr = state.optPrices[o.id] != null ? state.optPrices[o.id] : o.price;
        var months = o.timedMonths ? "・" + o.timedMonths + "か月" : "";
        var priceHtml = on
          ? '<span class="t-price"><input type="number" data-ieoptprice="' + o.id + '" value="' + pr + '">円/月' + months + "</span>"
          : '<span class="t-price">' + yen(pr) + "/月" + months + "</span>";
        return '<div class="tile' + (on ? " on" : "") + '" role="checkbox" aria-checked="' + (on ? "true" : "false")
          + '" tabindex="0" data-ietile="' + o.id + '">'
          + '<span class="t-name">' + esc(o.name) + "</span>" + priceHtml + "</div>";
      }).join("") + "</div>" + toggles;

      /* グループ直下の付帯UI（従来のまま） */
      if (g.phoneBase) {
        if (shinki && phoneOn) {
          h += '<div class="field tv-koji"><label>電話番号</label><select data-iebanpo="1">'
            + '<option value="new"' + (state.denwaBanpo !== "mnp" ? " selected" : "") + '>新規発番</option>'
            + '<option value="mnp"' + (state.denwaBanpo === "mnp" ? " selected" : "") + '>番号ポータビリティあり</option>'
            + "</select></div>"
            + '<p class="hint">番号ポータビリティの場合、NTT加入電話の利用休止工事料が別途NTT東西から請求される場合があります。</p>';
        }
        if (state.opts.denwaBV) {
          h += '<p class="hint">※ 光電話バリューには発信者番号表示・転送でんわ・迷惑電話ストップなど6つの付加サービスと528円分の無料通話が含まれます（含まれるサービスの個別追加は不要です）。</p>';
        }
      }
      if (g.tvBase && shinki && state.opts.tv) {
        var curTk = TV_KOJI[state.tvKoji] || TV_KOJI.sky;
        var curFee = state.tvKojiFee != null ? state.tvKojiFee : curTk.koji;
        h += '<div class="field tv-koji"><label>テレビ工事</label><select data-ietvkoji="1">'
          + Object.keys(TV_KOJI).map(function (k) {
              return '<option value="' + k + '"' + (state.tvKoji === k ? " selected" : "") + ">" + esc(TV_KOJI[k].label) + "</option>";
            }).join("")
          + "</select></div>"
          + '<div class="field tv-koji"><label>テレビ工事費（ドコモ請求）</label><input type="number" data-ietvkojifee="1" value="' + curFee + '" inputmode="numeric" min="0"> 円'
          + '<span class="opt-price">（ブースター等の追加工事がある場合はここで調整）</span></div>';
        if (curTk.onsite > 0 || state.tvOnsiteFee != null) {
          var curOnsite = state.tvOnsiteFee != null ? state.tvOnsiteFee : curTk.onsite;
          h += '<div class="field tv-koji"><label>接続工事費（現地払い）</label><input type="number" data-ietvonsite="1" value="' + curOnsite + '" inputmode="numeric" min="0"> 円'
            + '<span class="opt-price">スカパーへ工事当日お支払い。通常19,800円・キャンペーンで10,000円（2026年8月も継続中）</span></div>';
        }
      }
    });
    $("ieOptList").innerHTML = h || '<p class="hint">この商材に該当する定番オプションはありません。</p>';
  }

  // 表示中のセクションだけで①②③…を振り直す（home 5G端末セクションが隠れても番号が飛ばないように）
  var MARU = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];
  function renumberSteps() {
    var i = 0;
    document.querySelectorAll("#tab-ienaka .step").forEach(function (s) {
      if (s.hidden) return;
      var h2 = s.querySelector("h2[data-iet]");
      if (h2) h2.textContent = MARU[i++] + " " + h2.getAttribute("data-iet");
    });
  }

  function renderExtras(listId, key, addLabel) {
    var el = $(listId), h = "";
    state[key].forEach(function (a, i) {
      h += '<div class="adhoc-row">'
        + '<input type="text" placeholder="項目名" value="' + esc(a.name || "") + '" data-iex="' + key + '" data-iei="' + i + '" data-ief="name">'
        + '<input type="number" placeholder="金額（円）" value="' + (a.amount || "") + '" data-iex="' + key + '" data-iei="' + i + '" data-ief="amount">'
        + '<button class="del" data-iexdel="' + key + '" data-iei="' + i + '" type="button" aria-label="削除">×</button>'
        + "</div>";
    });
    el.innerHTML = h;
  }

  function syncForm() {
    if (!state) return;
    $("ieProduct").value = state.product;
    /* タイプC: 関西の提携ケーブルテレビはマンションタイプを提供していない
     * （店舗の共有・2026-08-29）。住居タイプは戸建だけにする。 */
    var isCms = !!(PRODUCTS[state.product] && PRODUCTS[state.product].typec);
    if (isCms && state.housing !== "ht") state.housing = "ht";
    Array.prototype.forEach.call($("ieHousing").options, function (o) {
      if (o.value !== "ht") { o.disabled = isCms; o.hidden = isCms; }
    });
    $("ieHousing").value = state.housing;
    /* 100M の設備を選んだときの案内。月額はマンションと同じ。
     * 10ギガは対応設備が要るので、組み合わせが合っていないことを知らせる。 */
    var hn = $("ieHousingNote");
    if (isCms) {
      hn.hidden = false;
      hn.innerHTML = "タイプCは<strong>マンションタイプの提供がありません</strong>（提携ケーブルテレビの提供条件）。戸建のみです。";
    } else if (state.housing !== "ms100" || state.product === "home5g") {
      hn.hidden = true;
    } else {
      hn.hidden = false;
      hn.innerHTML = is10g()
        ? '<strong style="color:var(--red)">⚠ 10ギガは10ギガ対応設備が必要です。</strong>'
          + "100Mbpsの設備のままではお申し込みいただけません。設備をご確認ください。"
        : "100Mbpsの設備（VDSL方式・LAN配線方式）です。<strong>月額はマンションと同じ</strong>です。";
    }
    $("iePtype").value = state.ptype;
    $("ieBaseMonthly").value = state.baseMonthly || "";
    $("ieHikariFields").hidden = state.product === "home5g";
    $("ieApplyTypeField").hidden = state.product === "home5g";
    $("ieApplyType").value = state.applyType || "shinki";
    var clSel = $("ieCurLine");
    if (clSel) {
      if (!clSel.options.length) {
        CUR_LINES.forEach(function (c) {
          var o = document.createElement("option");
          o.value = c.id; o.textContent = c.name;
          clSel.appendChild(o);
        });
      }
      clSel.value = state.curLine || "";
      $("ieCurLineOtherField").hidden = state.curLine !== "other";
      $("ieCurLineOther").value = state.curLineOther || "";
      var clh = $("ieCurLineHint");
      var cd = curLineDef();
      if (cd && cd.id !== "none" && (cd.tel || cd.cancel)) {
        clh.hidden = false;
        clh.textContent = (cd.tel ? "解約窓口: " + cd.tel + (cd.telNote ? "（" + cd.telNote + "）" : "") : cd.cancel)
          + (state.applyType === "jigyosha" && cd.jgTel
              ? "　／　承諾番号の窓口: " + cd.jgTel + (cd.jgTelNote ? "（" + cd.jgTelNote + "）" : "")
              : "")
          + "　※ 見積書の「開通までの流れ」に解約のご案内が載ります";
      } else {
        clh.hidden = true;
      }
    }
    if ($("ieCurPhone")) {
      $("ieCurPhone").value = state.curPhone || "";
      $("ieCurTv").value = state.curTv || "";
      $("ieCurTvBands").hidden = state.curTv !== "yes";
      $("ieCurTvDigi").checked = !!state.curTvDigi;
      $("ieCurTvBs").checked = !!state.curTvBs;
      $("ieCurTvCs").checked = !!state.curTvCs;
      /* J:COMはテレビを残したままネットだけ乗り換えるご案内がある。
       * その場合、お電話もJ:COMに残したほうがお客様のご負担が安くなる。 */
      var jc = state.curLine === "jcom";
      $("ieCurTvKeepField").hidden = !jc;
      if (!jc && state.curTvKeep) state.curTvKeep = false;
      $("ieCurTvKeep").checked = !!state.curTvKeep;
      var kh = $("ieCurTvKeepHint");
      kh.hidden = !(jc && state.curTvKeep);
      if (!kh.hidden) {
        kh.textContent = "テレビを残す場合、お電話もJ:COMに残したほうがお客様のご負担が安くなります。"
          + "J:COMへのご連絡では「解約するのはインターネットのみ」と必ずお伝えください（開通までの流れにも記載されます）。";
      }
    }
    $("iePtypeField").hidden = !!PRODUCTS[state.product].noPtype;
    $("ieProviderField").hidden = !isHikari() || !!PRODUCTS[state.product].noPtype;
    $("ieProvider").value = state.provider || "";
    /* 新規申込でも、いまのプロバイダを残してメールアドレスを引き継ぐことがあるため、
     * 申込区分によらず、プロバイダを選んだら聞く。 */
    var ptOn = !$("ieProviderField").hidden && !!state.provider;
    /* 店舗ごとの機能スイッチ（契約の器の features）。切のときは
     * タイプCの入り口（商材・切替・ZTVヒアリング）をすべて隠す。
     * 例: ZTVエリアの無い代理店の店舗では typec: false を書く。 */
    var typecOk = typeof window.KQ_FEAT !== "function" || window.KQ_FEAT("typec");
    var hOpt = $("ieProduct").querySelector('option[value="hikaric"]');
    if (hOpt) hOpt.hidden = !typecOk;
    var zOpt = $("ieCurLine") && $("ieCurLine").querySelector('option[value="ztv"]');
    if (zOpt) zOpt.hidden = !typecOk;
    /* タイプC: 申込種別は「新規／転用（タイプC）」（内部値 kirikae）だけ。他の商材では出さない。
     * ケーブルテレビ設備なのでフレッツ転用・事業者変更は当たらないため。 */
    var isC = !!PRODUCTS[state.product].typec;
    if (isC && (state.applyType === "tenyo" || state.applyType === "jigyosha")) state.applyType = "kirikae";
    if (!isC && state.applyType === "kirikae") state.applyType = "shinki";
    ["tenyo", "jigyosha"].forEach(function (v) {
      var o = $("ieApplyType").querySelector('option[value="' + v + '"]');
      if (o) o.hidden = isC;
    });
    /* 「転用（タイプC）」は常に出す（機能スイッチが切の店舗を除く）。タイプC以外で
     * 選んだら、商材を自動でタイプCへ切り替える（受け取り側で処理）。 */
    var kOptF = $("ieApplyType").querySelector('option[value="kirikae"]');
    if (kOptF) kOptF.hidden = !typecOk;
    $("ieApplyType").value = state.applyType || "shinki";
    $("ieTypecKeepField").hidden = !isC;
    $("ieTypecHint").hidden = !isC;
    if (document.activeElement !== $("ieTypecKeep")) $("ieTypecKeep").value = state.typecKeepAmt || "";
    // 転用（タイプC）: いまの回線設備で工事の有無が変わる
    var isKirikae = isC && state.applyType === "kirikae";
    var coax = (state.typecLine || "hikari") === "coax";
    $("ieTypecLineField").hidden = !isKirikae;
    $("ieTypecLine").value = state.typecLine || "hikari";
    $("ieTypecKojiField").hidden = !(isKirikae && coax);
    $("ieTypecLineHint").hidden = !(isKirikae && coax);
    if (document.activeElement !== $("ieTypecKoji")) $("ieTypecKoji").value = state.typecKoji || "";
    $("ieProviderTypeField").hidden = !ptOn;
    // 訪問設定サポートは@niftyのフォローコールで日程調整できるため、@nifty選択時だけ出す
    $("ieVisitWrap").hidden = $("ieProviderField").hidden || state.provider !== "@nifty";
    $("ieVisit").checked = !!state.visitSupport;
    if (!ptOn && state.providerType !== "shinki") state.providerType = "shinki";
    $("ieProviderType").value = state.providerType || "shinki";
    // プロバイダ無料無線ルーターレンタルは1ギガのみ（10ギガは対象プロバイダなし・別途購入）
    $("ieRouterRentalField").hidden = state.product !== "hikari1g";
    $("ieRouterRental").value = state.routerRental || "ari";
    $("ieOnecoinWrap").hidden = !is10g();
    $("ieOnecoin").checked = !!state.onecoin;
    $("ieHome5gStep").hidden = state.product !== "home5g";
    var shinkiKoji = isHikari() && state.applyType === "shinki";
    $("ieKojiPayField").hidden = !shinkiKoji;
    $("ieKojiFreeWrap").hidden = !shinkiKoji;
    $("ieH5DeviceName").value = state.h5DeviceName;
    $("ieH5DevicePrice").value = state.h5DevicePrice || "";
    $("ieH5Pay").value = state.h5Pay;
    $("ieH5Support").checked = !!state.h5Support;
    $("ieKojiPay").value = state.kojiPay || "b24";
    $("ieKojiFree").checked = !!state.kojiFree;
    $("ieDpoint").value = state.dpoint || "";
    $("ieDpointField").hidden = !isHikari();
    $("ieDpointHint").hidden = !isHikari();
    $("ieDcard").value = state.dcard || "none";
    $("ieRouter10gWrap").hidden = !canBuy10gRouter();
    $("ieRouter10g").checked = state.router10g !== false;
    var r10gOn = canBuy10gRouter() && state.router10g !== false;
    $("ieRouter10gPriceField").hidden = !r10gOn;
    $("ieRouter10gPrice").value = state.router10gPrice || "";
    $("ieRouter10gPayField").hidden = !r10gOn;
    renderRouter10gPays($("ieRouter10gPay"));
    $("ieRouter10gPay").value = state.router10gPay || "once";
    var r10gHint = $("ieRouter10gHint");
    r10gHint.hidden = !r10gOn;
    if (r10gOn) {
      var rp10 = num(state.router10gPrice);
      var nSp = router10gSplitN();
      r10gHint.innerHTML = (state.provider === "@nifty"
        ? "@nifty の優待価格（バッファロー WSR6500BE6P-10G）。<strong>税込20,064円</strong>"
          + "（ページの「18,240円」は税抜）。ニフティで購入する場合、ドコモの"
          + "「10Gbps対応無線LANルーター」（月額550円）の契約は不要です。"
        : state.provider === "GMOとくとくBB"
        ? "GMOとくとくBB の分割購入。<strong>月額190円（税込）×36回＝総額6,840円</strong>。"
        : "プロバイダによって取り扱いが違います。金額は店頭でご確認ください。")
        + (nSp > 0 && rp10 > 0
          ? "　" + nSp + "回分割で <strong>" + yen(Math.floor(rp10 / nSp)) + "/月</strong>（総額 " + yen(rp10) + "）"
          : "");
    }
    // 店舗独自特典（相対対応）: 入力があるときだけ開いておく。普段は折りたたみ
    $("ieStoreCash").value = state.storeCash || "";
    $("ieStorePt").value = state.storePt || "";
    if (num(state.storeCash) > 0 || num(state.storePt) > 0) $("ieStoreTokutenBox").hidden = false;
    renderOpts();
    renderExtras("ieExtraMonthlyList", "extraMonthly");
    renderExtras("ieExtraInitialList", "extraInitial");
    renumberSteps();
  }

  function dpointDefaultFor(product, applyType) {
    if (product === "home5g" || applyType === "tenyo" || applyType === "kirikae") return 0;
    if (product !== "hikari1g" && product !== "hikari10g") return 0; // ahamo光は公式特典の対象記載なし
    if (applyType === "jigyosha") return 10000;
    return product === "hikari1g" ? 20000 : 15000;
  }
  function syncDpointDefault(prevDef) {
    if (!num(state.dpoint) || num(state.dpoint) === prevDef) {
      state.dpoint = dpointDefaultFor(state.product, state.applyType);
    }
  }


  /* ---------- イエナカのタブの表示を整える ----------
   * 単体版の recalc() のうち、画面の表示にあたる部分。
   * 合計の表示と見積書はケータイ側が受け持つ。 */
  function render() {
    if (!state) return;
    var r = calc();
    var sum = $("ieSummary");
    if (sum) {
      var s0 = r.segs[0], sL = r.segs[r.segs.length - 1];
      var t = "月額 " + yen(s0.monthly) + (r.segs.length > 1 ? "（" + segLabel(s0) + "）" : "");
      if (r.segs.length > 1) t += "　→　" + yen(sL.monthly) + "（" + segLabel(sL) + "）";
      t += "　／　初期費用 " + yen(r.initial);
      sum.textContent = t;
    }
    // 初期費用のまとめ表示: 手数料 → 工事費合計・分割時月額 → 工事費内訳 → その他費用
    var ks = $("ieKojiSummary");
    if (state.product === "home5g") {
      ks.hidden = true;
    } else {
      var regTotal = 0, onsite = [];
      r.tvRegRows.forEach(function (x) {
        if (x.name.indexOf("現地払い") >= 0) onsite.push(x); else regTotal += x.amount;
      });
      var kh = "";
      // 手数料（事務手数料＋テレビ視聴登録料）
      var feeTotal = num(state.jimuFee) + regTotal;
      kh += "<div>手数料: <b>" + yen(feeTotal) + "</b>"
        + (regTotal > 0 ? "（事務" + yen(num(state.jimuFee)) + "＋テレビ視聴登録" + yen(regTotal) + "）" : "") + "</div>";
      // 工事費合計と分割時月額
      kh += "<div>工事費合計: <b>" + yen(r.kojiTotal) + "</b>"
        + (r.kojiTotal > 0 && state.kojiPay !== "b24" ? "（一括払い）" : "") + "</div>";
      if (r.kojiTotal > 0 && state.kojiPay === "b24") {
        kh += "<div>分割時: <b>" + yen(Math.floor(r.kojiTotal / 24)) + "/月</b>（24回）</div>";
      }
      // 工事費内訳
      if (r.kojiTotal > 0) {
        kh += '<div class="ks-sub">工事費内訳）</div>';
        if (r.koji > 0) kh += '<div class="ks-item">・回線 新規工事料 ' + yen(r.koji) + "</div>";
        r.optKojiRows.forEach(function (x) { kh += '<div class="ks-item">・' + esc(x.name) + " " + yen(x.amount) + "</div>"; });
      }
      // その他費用（請求外・購入品）
      var others = [];
      onsite.forEach(function (x) { others.push("スカパー工事 現地徴収分 " + yen(x.amount) + "（工事当日スカパーへ）"); });
      if (canBuy10gRouter() && state.router10g && num(state.router10gPrice) > 0) {
        var rp = num(state.router10gPrice);
        var rn = router10gSplitN();
        others.push(rn > 0
          ? "10Gルーター " + rn + "回分割 " + yen(Math.floor(rp / rn)) + "/月（総額 " + yen(rp) + "）"
          : "10Gルーター購入費用 " + yen(rp));
      }
      if (PRODUCTS[state.product].typec) {
        others.push("お電話・テレビはケーブルテレビ（ZTV等）契約のまま残す（請求は別）"
          + (num(state.typecKeepAmt) > 0 ? "・参考 " + yen(num(state.typecKeepAmt)) + "/月" : ""));
      }
      if (others.length) {
        kh += '<div class="ks-sub">その他費用）</div>';
        others.forEach(function (t) { kh += '<div class="ks-item">・' + t + "</div>"; });
      }
      ks.hidden = false;
      ks.innerHTML = kh;
    }
    var hint = PRODUCTS[state.product].note + (r.deviceNote ? "　" + r.deviceNote : "");
    $("ieH5Hint").textContent = state.product === "home5g" ? hint : "";
    // 特典（⑤）: テレビ同時申込ポイント・工事費実質0円の進呈内容
    var tvPtOk = r.tvOn && isHikari() && state.applyType !== "tenyo";
    $("ieTvPointWrap").hidden = !tvPtOk;
    if (tvPtOk) $("ieTvPoint").checked = state.tvPoint !== false;
    // home 5G→ドコモ光 移行特典は1ギガのみ表示（10ギガ・ahamo光・home 5Gは対象外）
    $("ieH5MigWrap").hidden = state.product !== "hikari1g";
    $("ieH5Mig").checked = !!state.h5Mig;
    var kp = $("ieKojiPointInfo");
    if (isHikari() && state.applyType === "shinki" && state.kojiFree && r.koji > 0) {
      kp.hidden = false;
      kp.textContent = "工事費 実質0円特典: " + r.koji.toLocaleString("ja-JP")
        + "pt（期間・用途限定）を、ご利用開始月の7か月後の月から24か月間に分けて進呈。"
        + "エントリーは不要です（条件を満たせば自動で対象）。料金充当した場合の月額推移は見積書に表示されます。";
    } else { kp.hidden = true; }
    // dカードGOLD/PLATINUM還元
    var dcOn = state.dcard !== "none";
    $("ieDcardPtField").hidden = !dcOn;
    $("ieDcardHint").hidden = !dcOn;
    if (dcOn) {
      if (state.dcardPt == null && document.activeElement !== $("ieDcardPt")) {
        $("ieDcardPt").value = r.dcardAutoPt || "";
      }
      $("ieDcardHint").textContent = "自動計算: 対象月額" + yen(r.dcardEligible) + " → " + (r.dcardAutoPt || 0)
        + "pt/月（1,100円ごとに" + (state.dcard === "gold" ? "100pt・10%" : "200pt・20%") + "）。還元対象・上限はカード規約をご確認ください。数値は直接編集できます。"
        + (state.dcard === "platinum"
          ? "　改定予告（2026-09-01発表）: 2026年12月ご利用分から、PLATINUMのドコモ光利用料金への還元は最大12%（中部・関西・九州電力エリアは最大8%）に引き下げられます。"
          : "");
    }
  }


  /* ---------- 入力の受け取り ---------- */
  function bind() {
    $("ieProduct").addEventListener("change", function () {
      var prevDef = dpointDefaultFor(state.product, state.applyType);
      var wasC = !!PRODUCTS[state.product].typec;
      state.product = this.value;
      /* タイプCを選んだ直後は「転用（タイプC）」を既定にする（主な使いどころが
       * ケーブルテレビのネットからの切替のため）。逆に出たら新規へ戻す。 */
      var nowC = !!PRODUCTS[state.product].typec;
      if (nowC && !wasC) state.applyType = "kirikae";
      if (!nowC && wasC && state.applyType === "kirikae") state.applyType = "shinki";
      applyDefaults();
      syncDpointDefault(prevDef);
      syncForm(); recalc();
    });
    $("ieHousing").addEventListener("change", function () { state.housing = this.value; applyDefaults(); syncForm(); recalc(); });
    $("iePtype").addEventListener("change", function () { state.ptype = this.value; applyDefaults(); syncForm(); recalc(); });
    $("ieProvider").addEventListener("change", function () {
      state.provider = this.value;
      // 10ギガの対応ルーターはプロバイダで変わるため、価格と払い方を入れ直す
      if (canBuy10gRouter()) applyRouter10gDefault();
      syncForm(); recalc();
    });
    $("ieProviderType").addEventListener("change", function () { state.providerType = this.value; recalc(); });
    $("ieVisit").addEventListener("change", function () { state.visitSupport = this.checked; recalc(); });
    $("ieRouterRental").addEventListener("change", function () { state.routerRental = this.value; recalc(); });
    $("ieBaseMonthly").addEventListener("input", function () { state.baseMonthly = num(this.value); recalc(); });
    $("ieH5DeviceName").addEventListener("input", function () { state.h5DeviceName = this.value; recalc(); });
    $("ieH5DevicePrice").addEventListener("input", function () { state.h5DevicePrice = num(this.value); recalc(); });
    $("ieH5Pay").addEventListener("change", function () { state.h5Pay = this.value; recalc(); });
    $("ieH5Support").addEventListener("change", function () { state.h5Support = this.checked; recalc(); });
    $("ieKojiPay").addEventListener("change", function () { state.kojiPay = this.value; recalc(); });
    // 申込区分からドコモショップ特典の進呈ポイントを自動判定（西日本固定・公式2026-07時点・手入力は上書きしない）
    // 西日本: 1G新規20,000pt・10G新規15,000pt・事業者変更10,000pt ／ 転用は対象外
    function dpointDefaultFor(product, applyType) {
      if (product === "home5g" || applyType === "tenyo" || applyType === "kirikae") return 0;
      if (product !== "hikari1g" && product !== "hikari10g") return 0; // ahamo光は公式特典の対象記載なし
      if (applyType === "jigyosha") return 10000;
      return product === "hikari1g" ? 20000 : 15000;
    }
    function syncDpointDefault(prevDef) {
      if (!num(state.dpoint) || num(state.dpoint) === prevDef) {
        state.dpoint = dpointDefaultFor(state.product, state.applyType);
      }
    }
    $("ieCurLine").addEventListener("change", function () { state.curLine = this.value; syncForm(); recalc(); });
    $("ieCurLineOther").addEventListener("input", function () { state.curLineOther = this.value; recalc(); });
    $("ieCurPhone").addEventListener("change", function () { state.curPhone = this.value; recalc(); });
    $("ieCurTv").addEventListener("change", function () { state.curTv = this.value; syncForm(); recalc(); });
    [["ieCurTvDigi", "curTvDigi"], ["ieCurTvBs", "curTvBs"], ["ieCurTvCs", "curTvCs"]].forEach(function (pr) {
      $(pr[0]).addEventListener("change", function () { state[pr[1]] = this.checked; recalc(); });
    });
    $("ieCurTvKeep").addEventListener("change", function () { state.curTvKeep = this.checked; syncForm(); recalc(); });
    $("ieApplyType").addEventListener("change", function () {
      var prevDef = dpointDefaultFor(state.product, state.applyType);
      state.applyType = this.value;
      /* 「転用（タイプC）」を選んだら、商材も自動でタイプCにする。
       * 切替はケーブルテレビ設備（タイプC）でしか起きないため。 */
      if (this.value === "kirikae" && !PRODUCTS[state.product].typec) {
        state.product = "hikaric";
        applyDefaults();
      }
      syncDpointDefault(prevDef);
      syncForm(); recalc();
    });
    $("ieTvPoint").addEventListener("change", function () { state.tvPoint = this.checked; recalc(); });
    $("ieH5Mig").addEventListener("change", function () { state.h5Mig = this.checked; recalc(); });
    $("ieStoreTokutenBtn").addEventListener("click", function () {
      var box = $("ieStoreTokutenBox");
      box.hidden = !box.hidden;
    });
    $("ieStoreCash").addEventListener("input", function () { state.storeCash = num(this.value); recalc(); });
    $("ieTypecKeep").addEventListener("input", function () { state.typecKeepAmt = num(this.value); recalc(); });
    $("ieTypecLine").addEventListener("change", function () { state.typecLine = this.value; syncForm(); recalc(); });
    $("ieTypecKoji").addEventListener("input", function () { state.typecKoji = num(this.value); recalc(); });
    $("ieStorePt").addEventListener("input", function () { state.storePt = num(this.value); recalc(); });
    $("ieDcard").addEventListener("change", function () { state.dcard = this.value; state.dcardPt = null; syncForm(); recalc(); });
    $("ieDcardPt").addEventListener("input", function () { state.dcardPt = num(this.value); recalc(); });
    $("ieRouter10g").addEventListener("change", function () {
      state.router10g = this.checked;
      /* 購入に切り替えたら、レンタルのタイルを外す（どちらか一方のため） */
      if (this.checked && state.opts.lanRouter10g) { delete state.opts.lanRouter10g; renderOpts(); }
      syncForm(); recalc();
    });
    $("ieRouter10gPrice").addEventListener("input", function () { state.router10gPrice = num(this.value); syncForm(); recalc(); });
    $("ieRouter10gPay").addEventListener("change", function () { state.router10gPay = this.value; syncForm(); recalc(); });
    $("ieKojiFree").addEventListener("change", function () { state.kojiFree = this.checked; recalc(); });
    $("ieDpoint").addEventListener("input", function () { state.dpoint = num(this.value); recalc(); });
    $("ieOnecoin").addEventListener("change", function () { state.onecoin = this.checked; recalc(); });
  $("ieOptList").addEventListener("click", function (e) {
      if (e.target.closest("input,select,a,label")) return;
      var t = e.target.closest("[data-ietile]");
      if (t) toggleIeOpt(t.getAttribute("data-ietile"));
    });
    $("ieOptList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var t = e.target.closest && e.target.closest("[data-ietile]");
      if (t) { e.preventDefault(); toggleIeOpt(t.getAttribute("data-ietile")); }
    });
    $("ieOptList").addEventListener("change", function (e) {
      var id = e.target.getAttribute("data-ieopt");
      if (id) {
        state.opts[id] = e.target.checked;
        /* 畳んだら、見えなくなる項目の選択も外す（見えない金額が乗らないように） */
        if (id === "skyp" && !e.target.checked) {
          IENAKA_OPTS.forEach(function (o) { if (o.needsVideo) delete state.opts[o.id]; });
        }
        if (id === "phoneMore" && !e.target.checked) {
          IENAKA_OPTS.forEach(function (o) { if (o.phoneMore) delete state.opts[o.id]; });
        }
        renderOpts(); recalc(); return;
      }
      if (e.target.getAttribute("data-ietvkoji")) { state.tvKoji = e.target.value; state.tvKojiFee = null; state.tvOnsiteFee = null; renderOpts(); recalc(); return; }
      if (e.target.getAttribute("data-iebanpo")) { state.denwaBanpo = e.target.value; recalc(); }
    });
    $("ieOptList").addEventListener("input", function (e) {
      if (e.target.getAttribute("data-ietvkojifee")) { state.tvKojiFee = num(e.target.value); recalc(); return; }
      if (e.target.getAttribute("data-ietvonsite")) { state.tvOnsiteFee = num(e.target.value); recalc(); }
    });
    $("ieOptList").addEventListener("input", function (e) {
      var id = e.target.getAttribute("data-ieoptprice");
      if (!id) return;
      state.optPrices[id] = num(e.target.value);
      recalc();
      var od = IENAKA_OPTS.filter(function (x) { return x.id === id; })[0];
      if (od && (od.needsVideo || od.needsHikariTv)) updateGroupTotals();
    });
    function bindExtras(listId) {
      $(listId).addEventListener("input", function (e) {
        var key = e.target.getAttribute("data-iex");
        if (!key) return;
        var i = +e.target.getAttribute("data-iei"), f = e.target.getAttribute("data-ief");
        state[key][i][f] = f === "amount" ? num(e.target.value) : e.target.value;
        recalc();
      });
      $(listId).addEventListener("click", function (e) {
        var key = e.target.getAttribute("data-iexdel");
        if (!key) return;
        state[key].splice(+e.target.getAttribute("data-iei"), 1);
        renderExtras(listId, key);
        recalc();
      });
    }
    bindExtras("ieExtraMonthlyList");
    bindExtras("ieExtraInitialList");
    $("ieAddExtraMonthly").addEventListener("click", function () {
      state.extraMonthly.push({ name: "", amount: "" });
      renderExtras("ieExtraMonthlyList", "extraMonthly"); recalc();
    });
    $("ieAddExtraInitial").addEventListener("click", function () {
      state.extraInitial.push({ name: "", amount: "" });
      renderExtras("ieExtraInitialList", "extraInitial"); recalc();
    });
    var en = $("ieEnabled");
    if (en) en.addEventListener("change", function () {
      state.enabled = this.checked;
      $("ieBody").hidden = !this.checked;
      recalc();
    });
  }



  /* ---------- 光の見積書（単体の1枚） ----------
   * 単体版（ienaka-app）の見積書と同じ内容。表題・お客様名・発行元・注意書きは
   * ケータイ側が付けるので、ここでは中身だけを返す。
   * セット割はケータイ側で実際に引いている金額を受け取る。 */
  /* ---------- 現在お使いの回線（ヒアリング） ----------
   * 将来の「奪還比較ツール」への入口として、どの回線から乗り換えるかを記録する。
   * 開通までの流れに解約のご案内を出すのにも使う。
   * tel は一次情報で確認できたものだけ載せる（誤った番号のご案内は事故になるため。
   * 確認でき次第、ここに追加する）。 */
  var CUR_LINES = [
    { id: "", name: "（未ヒアリング）" },
    { id: "none", name: "利用なし（固定回線なし）" },
    { id: "jcom", name: "J:COM NET", tel: "0120-999-000", telNote: "J:COMカスタマーセンター" },
    { id: "eo", name: "eo光", tel: "0120-919-151", telNote: "eoサポートダイヤル" },
    { id: "nuro", name: "NURO光" },
    /* jgTel は事業者変更承諾番号の専用窓口。解約の窓口（tel）とは別 */
    { id: "sbhikari", name: "ソフトバンク光", tel: "0800-111-2009", telNote: "10:00〜19:00・通話無料",
      jgTel: "0800-111-6710", jgTelNote: "事業者変更承諾番号 専用窓口" },
    { id: "biglobe", name: "BIGLOBE光", tel: "0120-86-0962", telNote: "ビッグローブ カスタマーサポート・ガイダンスは ②→⑤ と入力" },
    { id: "ocn", name: "OCN光", tel: "0120-506-506", telNote: "OCNカスタマーズフロント・日祝は休み" },
    { id: "collabo", name: "その他コラボ光（So-net光・@nifty光 など）" },
    { id: "flets", name: "フレッツ光（NTT東・西）", tel: "0120-116-116", telNote: "NTT東西・9:00〜17:00" },
    { id: "sbair", name: "SoftBank Air", cancel: "解約はSoftBankサポートセンターへ（My SoftBankでも手続きを確認できます）" },
    { id: "auhikari", name: "auひかり", cancel: "解約はご契約のプロバイダ（So-net・BIGLOBE・@niftyなど）の窓口へ" },
    { id: "rakuten", name: "楽天ひかり" },
    { id: "ztv", name: "ZTV（タイプCへ切替）", cancel: "タイプCへ切り替える場合、ネットの解約手続きは不要です（切替日で自動精算・日割で返金）。テレビ・お電話はZTVのご契約のまま続きます" },
    { id: "cable", name: "ケーブルテレビのネット" },
    { id: "homerouter", name: "他社ホームルーター・モバイルWi-Fi" },
    { id: "other", name: "その他" }
  ];
  var CUR_PHONE_NAMES = { set: "回線とセット（あり）", analog: "アナログ電話（NTT加入電話）", none: "なし" };
  /* ヒアリング内容を1行にまとめる（引き継ぎシート用） */
  function curHearingText() {
    if (!state) return "";
    var a2 = [];
    if (state.curLine) a2.push("ネット: " + curLineLabel());
    if (state.curPhone) a2.push("電話: " + (CUR_PHONE_NAMES[state.curPhone] || state.curPhone));
    if (state.curTv) {
      var tv = state.curTv === "yes" ? "あり" : "なし（アンテナ）";
      if (state.curTv === "yes") {
        var b2 = [];
        if (state.curTvDigi) b2.push("地デジ");
        if (state.curTvBs) b2.push("BS");
        if (state.curTvCs) b2.push("CS");
        if (b2.length) tv += "（" + b2.join("・") + "）";
      }
      a2.push("テレビ: " + tv);
    }
    if (state.curTvKeep) a2.push("J:COMのテレビを残す（解約はネットのみ）");
    return a2.join(" ／ ");
  }
  function curLineDef() {
    if (!state.curLine) return null;
    return CUR_LINES.filter(function (c) { return c.id === state.curLine; })[0] || null;
  }
  function curLineLabel() {
    var d = curLineDef();
    if (!d) return "";
    return d.id === "other" ? (state.curLineOther || "その他") : d.name;
  }

  /* ---------- 開通までの流れ（見積書のお客様説明用） ----------
   * 商材と申込区分で工程が変わる。日数は「目安」として書く
   * （工事の混み具合・地域で前後するため、断定しない）。 */
  /* 流れの中身。見積書の下の枠と、A4・1枚もの（flowSheetHtml）で共用する */
  function flowData(r) {
    var steps = [];
    function step(t, d, icon, when) { steps.push({ t: t, d: d || "", icon: icon || "", when: when || "", notes: [] }); }
    /* 注意事項は末尾にまとめず、関係する工程の中に書く（店舗の指定・2026-08-09）。
     * match は工程名の一部。見つからないときは最後の工程に付ける。 */
    function noteTo(match, text) {
      for (var i = steps.length - 1; i >= 0; i--) {
        if (steps[i].t.indexOf(match) >= 0) { steps[i].notes.push(text); return; }
      }
      if (steps.length) steps[steps.length - 1].notes.push(text);
    }
    if (state.product === "home5g") {
      step("お申込み", "本日、店頭でお手続きが完了しました", "shop", "本日");
      step("本体のお受け取り", "home 5G の本体をお受け取りください", "box", "本日");
      step("コンセントに挿して利用開始", "工事は不要です。電源を入れれば、その日からインターネットが使えます", "plug", "本日から");
    } else if (PRODUCTS[state.product].typec) {
      if (state.applyType === "kirikae" && (state.typecLine || "hikari") === "coax") {
        /* いまが同軸ケーブルの場合は、光への切り替え工事が入る（工事はケーブルテレビ会社） */
        step("お申込み", "本日、店頭でお手続きが完了しました（ケーブルテレビのネットからの切り替え）", "shop", "本日");
        step("光への切り替え工事（立ち会いをお願いします）", "いまの同軸ケーブルから光回線へ切り替える工事です。ケーブルテレビ会社が行います（日程・工事料は同社からのご案内をご確認ください）", "tools", "後日");
        step("ご利用開始", "切り替え前のケーブルテレビのネット料金は、日割で精算・返金されます", "start", "工事の当日から");
        noteTo("ご利用開始", "お電話・テレビはケーブルテレビのご契約のまま続きます（ドコモとケーブルテレビで請求が分かれます）");
      } else if (state.applyType === "kirikae") {
        step("お申込み", "本日、店頭でお手続きが完了しました（ケーブルテレビのネットからの切替）", "shop", "本日");
        step("回線切替日", "工事や設定変更はありません。いまお使いの機器のままです", "router", "切替日");
        step("ご利用開始", "切替前のケーブルテレビのネット料金は、日割で精算・返金されます", "start", "切替日から");
        noteTo("ご利用開始", "お電話・テレビはケーブルテレビのご契約のまま続きます（ドコモとケーブルテレビで請求が分かれます）");
      } else {
        step("お申込み", "本日、店頭でお手続きが完了しました", "shop", "本日");
        step("宅内工事（立ち会いをお願いします）", "ケーブルテレビ会社がお部屋まで光ファイバーの配線工事をします", "tools", "後日");
        step("ご利用開始", "", "start", "工事の当日から");
        noteTo("ご利用開始", "お電話・テレビはケーブルテレビのご契約のまま続きます（ドコモとケーブルテレビで請求が分かれます）");
      }
    } else if (state.applyType === "shinki") {
      /* 公式の「新規ご契約までの流れ」STEP1〜5 に合わせた5工程
       * （出典: docomo.ne.jp ドコモ光お申込みページ・2026-08-07確認） */
      step("お申込み", "本日、店頭でお手続きが完了しました", "shop", "本日");
      step("必要な書類のお受け取り", "開通のご案内が届きます。あわせて後日、工事日を決めるお電話がありますので、ご都合のよい日をお伝えください", "doc", "7〜10日後");
      // 訪問設定サポート希望（@nifty）: 書類が届いたらフォローコールで日程を決める
      if (state.provider === "@nifty" && state.visitSupport) {
        step("訪問サポートの日程を決める", "@niftyのフォローコール（電話）で、訪問設定サポートの日程を決めます", "phone", "書類の到着後");
      }
      /* 工事の前にルーターを手元にそろえておく工程。
       * レンタルまたは購入があるときだけ出す（お手持ちの持ち込みのときは出さない） */
      var rentalS = (state.product === "hikari1g" && state.routerRental !== "nashi")
        || !!(state.opts || {}).ahamoRouter || !!(state.opts || {}).ahamoRouter10g;
      if (rentalS) {
        step("ルーターのお受け取り", "レンタルの無線ルーターが、プロバイダから郵送で届きます。工事の日まで大切に保管してください", "box", "工事日まで");
      } else if (state.product === "hikari10g" && state.router10g && num(state.router10gPrice) > 0) {
        step("ルーターのご準備", "ご購入の10ギガ対応ルーターを、工事の日までにご用意ください", "box", "工事日まで");
      }
      step("開通工事（立ち会いをお願いします）", "お申込みから2週間〜1か月程度が目安です（時期・地域により前後します）", "tools", "2週間〜1か月後");
      step("ルーターなどの接続・設定", "ルーターをつなぐと、インターネットが使えるようになります", "router", "工事の当日");
      step("ご利用開始", "", "start", "工事の当日から");
      if (r.tvOn) noteTo("開通工事", "テレビオプションの接続工事は、開通工事と同じ日に行います");
      if (state.product === "hikari10g" && state.router10g && num(state.router10gPrice) > 0) {
        noteTo("ルーターなど", "ご購入の10ギガ対応ルーターは、開通後に接続・設定してください");
      }
    } else {
      /* 事業者変更は「事業者変更承諾番号」が要る。
       * ドコモ光側はダミーの番号で先に登録できる（お客様には開示しない）ため、
       * 「お申込み → 承諾番号の取得 → ドコモ光サービスセンターへご連絡」で回せる。
       * 番号の取り方は事業者で違うので、そこだけ分ける（店舗の指定・2026-08-09）。 */
      var jgLine = curLineDef();
      var jg = state.applyType === "jigyosha" ? ((jgLine && jgLine.id) || "") : "";
      step("お申込み", "本日、店頭でお手続きが完了しました", "shop", "本日");
      if (jg) {
        if (jg === "ocn") {
          // OCNはその場でお電話して承諾番号を受け取れる
          step("事業者変更承諾番号の取得（OCNへお電話）",
            "店頭でOCNへお電話し、事業者変更承諾番号をお受け取りいただきます", "phone", "本日・店頭");
          noteTo("承諾番号の取得", "OCNのご連絡先: 0120-506-506（OCNカスタマーズフロント）");
          noteTo("承諾番号の取得", "**日曜・祝日はお電話がつながりません。**その場合は後日、お客様からお電話いただき、承諾番号を店舗へお知らせください");
        } else if (jg === "biglobe") {
          /* BIGLOBEは「折り返しのお電話の日程を予約 → その日のお電話で承諾番号の
           * 発行手続き → 後日お手元に届く」の順。 */
          step("BIGLOBEからのお電話のご予約",
            "店頭でお時間があれば、BIGLOBEへお電話し、BIGLOBEから折り返しお電話がかかってくる日程をこの場でお取りします", "phone", "本日・店頭");
          noteTo("ご予約", "BIGLOBEのご連絡先: 0120-86-0962（ビッグローブ カスタマーサポート・ガイダンスは ②→⑤ と入力）");
          noteTo("ご予約", "店頭でお時間がないときは、後日お客様からお電話いただいてご予約ください");
          step("BIGLOBEからのお電話で承諾番号のお手続き",
            "ご予約の日にBIGLOBEからお電話があります。そこで事業者変更承諾番号の発行手続きをしていただきます", "phone", "ご予約の日");
          noteTo("承諾番号のお手続き", "承諾番号は、このお電話のあと**後日お手元に届きます**（その場では分かりません）");
        } else {
          step("事業者変更承諾番号の取得（いまのご契約先へお電話）",
            "いまご契約の事業者へお電話し、事業者変更承諾番号をお受け取りください", "phone", "本日・店頭");
          /* 承諾番号の専用窓口が分かっていればそちらを、無ければ契約先の窓口を出す */
          var jgT = jgLine && (jgLine.jgTel || jgLine.tel);
          var jgN = jgLine && (jgLine.jgTel ? jgLine.jgTelNote : jgLine.telNote);
          noteTo("承諾番号の取得", jgT
            ? (jgLine.jgTel ? "承諾番号のご連絡先: " : "いまのご契約先: ")
              + jgLine.name + " " + jgT + (jgN ? "（" + jgN + "）" : "")
            : "ご連絡先は、ご契約の書面・公式サイト・マイページでご確認ください");
        }
        step("承諾番号をドコモ光サービスセンターへご連絡",
          "承諾番号を受け取ったら、ドコモ光サービスセンターへお伝えいただくと切替日が確定します", "phone", "承諾番号のお受け取り後");
        noteTo("ドコモ光サービスセンター", "ドコモ光サービスセンター: 0120-766-156（ドコモのケータイからは **15715**）");
        noteTo("ドコモ光サービスセンター", "**承諾番号には有効期限があります。**受け取ったらお早めにご連絡ください");
      }
      step("必要な書類のお受け取り", "切替日のご案内が書類・SMSで届きます", "doc", "数日〜1週間後");
      // 訪問設定サポート希望（@nifty）: 書類が届いたらフォローコールで日程を決める
      if (state.provider === "@nifty" && state.visitSupport) {
        step("訪問サポートの日程を決める", "@niftyのフォローコール（電話）で、訪問設定サポートの日程を決めます", "phone", "書類の到着後");
      }
      // レンタルがあるときは、切替日の前にルーターを受け取っておく工程を入れる
      var rentalT = (state.product === "hikari1g" && state.routerRental !== "nashi")
        || !!(state.opts || {}).ahamoRouter || !!(state.opts || {}).ahamoRouter10g;
      if (rentalT) {
        step("ルーターのお受け取り", "レンタルの無線ルーターが、プロバイダから郵送で届きます。切替日まで大切に保管してください", "box", "切替日まで");
      }
      step("切替日に自動で切替", "工事・立ち会いはありません。お申込みから1〜2週間程度が目安です", "switchi", "1〜2週間後");
      step("ルーターなどの設定の確認", "つながらないときは、ルーターの設定をご確認ください", "router", "切替日の当日");
      step("ご利用開始", "", "start", "切替日の当日から");
    }
    /* レンタルルーターの到着案内は、新規・転用・事業者変更とも
     * 「ルーターのお受け取り」の工程として流れに入れたので、注記は無し */
    if (isHikari() && state.provider === "@nifty") {
      if (state.visitSupport) {
        // 訪問設定サポートを希望した場合は、設定の工程に「訪問が来る」ことを書く
        noteTo("ルーターなど", "@niftyの訪問設定サポートのスタッフがご自宅へ伺い、"
          + "ルーターの接続・設定を行います（日程は事前のお電話で調整します）");
      } else {
        noteTo("ルーターなど", "設定でお困りのときは、@niftyのフォローコール（電話サポート）でご相談いただけます");
      }
    }
    // いまの回線の解約。転用・事業者変更は解約が不要なので、案内だけ変える
    var cl = curLineDef();
    if (cl && cl.id !== "none") {
      if (state.product === "home5g" || state.applyType === "shinki") {
        var jcKeep = cl.id === "jcom" && state.curTvKeep;
        step("いまの回線（" + curLineLabel() + "）の解約" + (jcKeep ? "**（ネットのみ）**" : ""),
          "開通・利用開始を確認してから、解約のお手続きをしてください", "phone", "開通の確認後");
        noteTo("の解約", cl.tel
          ? "解約のご連絡先: " + cl.name + " " + cl.tel + (cl.telNote ? "（" + cl.telNote + "）" : "")
          : (cl.cancel || "解約のご連絡先は、ご契約の書面・公式サイト・マイページでご確認ください"));
        /* J:COMはテレビ・お電話を残したままネットだけ乗り換えるご案内がある。
         * まとめて解約されると事故になるため、連絡時の言い方を必ず載せる。 */
        if (cl.id === "jcom") {
          noteTo("の解約", "J:COMへのご連絡では、**解約するのはインターネットのみ**と必ずお伝えください。まとめて解約されると、テレビ・お電話も止まってしまいます");
          if (jcKeep) {
            noteTo("の解約", "**テレビはJ:COMに残します。**お電話もJ:COMに残されたほうが、お客様のご負担は安くなります");
          }
        }
        noteTo("の解約", "開通前に解約すると、インターネットの使えない期間ができます。違約金・工事費の残りの有無はご契約内容をご確認ください");
      } else if (state.applyType === "tenyo") {
        noteTo("切替", "転用では、フレッツ光の回線契約はそのまま移行するため解約は不要です。プロバイダ（OCN・So-netなど）は別途解約が必要な場合があります");
      } else if (state.applyType === "jigyosha") {
        noteTo("切替", "事業者変更では、いまの光コラボ（" + curLineLabel() + "）の解約手続きは不要です（自動で切り替わります）。メールアドレスなどのオプションだけ残る場合があります");
        /* ソフトバンク光からの事業者変更は、レンタル機器（光BBユニットなど）の
         * 返却が必要。返却先は公式ページで確認した住所（2026-08確認）。 */
        if (cl.id === "sbhikari") {
          step("レンタル機器（光BBユニットなど）の返却",
            "ソフトバンクからのレンタル機器がある場合は、切替を確認してから梱包して返却してください（送料はお客様のご負担・利用停止月の翌月20日まで）",
            "box", "切替の確認後");
          noteTo("の返却", "返却先: 〒272-0001 千葉県市川市二俣678-55 "
            + "ESR市川ディストリビューションセンター 3階 北棟N8 ソフトバンク返品センター宛");
        }
      }
    }
    /* ドコモ光 乗り換え特典（他社の解約金・撤去工事費・端末残債をdポイントで還元）。
     * 対象は「事業者変更」と「他社回線からの新規」。フレッツ光からの転用は対象外。
     * 解約金の請求書などが要るため、解約の工程よりあとに置く。
     * （出典: ドコモ光 乗り換え特典の案内・2026-08確認） */
    var otherLine = cl && cl.id !== "none" && cl.id !== "flets";
    var needCancel = otherLine && (state.product === "home5g" || state.applyType === "shinki");
    if (isHikari() && (state.applyType === "jigyosha" || (state.applyType === "shinki" && otherLine))) {
      step("ドコモ光 乗り換え特典のお申込み",
        "他社の解約金・撤去工事費・端末の残債が、dポイント（期間・用途限定）で還元される特典です。お客様ご自身でのお申込みが必要です",
        "doc", needCancel ? "解約金のご請求後" : "開通の確認後");
      noteTo("乗り換え特典", "お申込みには、他社の解約金などが分かる書面（請求書・利用明細など）が必要です。捨てずに保管してください");
      noteTo("乗り換え特典", "利用開始月の4か月後の月末時点でドコモ光をご契約中であることなどの条件があります。金額の上限・お申込みの締切は公式の案内をご確認ください");
    }
    // 店舗独自特典があるときは、来店してのお申込みが必要
    if (num(state.storeCash) > 0 || num(state.storePt) > 0) {
      step("店舗特典のお申込み（ご来店）",
        "開通日から7日以降に、当店へご来店のうえ特典のお申し込みをお願いします",
        "shop", "開通の7日後以降");
      noteTo("店舗特典", "ご来店の際は、ご契約者さまの本人確認書類をお持ちください");
    }
    return { steps: steps };
  }
  // 見積書の下に出す小さい枠
  /* 見積書の下に出していた小さい枠。いまは使っていない（別紙の1枚ものに一本化）。
   * また見積書に入れたくなったら、hikariSheetHtml の末尾で呼び出す。 */
  function flowHtml(r) {
    var fd = flowData(r);
    var fh = '<div class="ie-flow"><h3>開通までの流れ</h3><ol>'
      + fd.steps.map(function (st2) {
          return "<li>" + (st2.when ? "<b>【" + esc(st2.when) + "】</b>" : "") + noteHtml(st2.t) + (st2.d ? "。" + esc(st2.d) : "")
            + (st2.notes.length ? "<br>" + st2.notes.map(function (n2) { return "※ " + noteHtml(n2); }).join("<br>") : "")
            + "</li>";
        }).join("") + "</ol>";
    return fh + "</div>";
  }
  /* A4・1枚の「開通までの流れ」。お客様へお渡しする説明用の紙。
   * 公式の流れ図と同じく、アイコン＋STEP＋赤い▼の縦並び。
   * 右側に「予定日」の書き込み欄を付ける（画面ではタップして入力もできる） */
  var FLOW_ICONS = {
    shop: '<path d="M4 9.5l1.6-4.5h12.8L20 9.5v1.3a2.4 2.4 0 0 1-4.8 0 2.4 2.4 0 0 1-4.8 0 2.4 2.4 0 0 1-4.8 0z" fill="#2a6df4"/><path d="M5.8 13.2V19h12.4v-5.8" fill="none" stroke="#38507a" stroke-width="1.8"/><rect x="10.2" y="14.6" width="3.6" height="4.4" fill="#38507a"/>',
    doc: '<rect x="3.5" y="8" width="14" height="11" rx="1.2" fill="#f5cf87"/><path d="M3.5 9l7 4.6L17.5 9" fill="none" stroke="#d3a94f" stroke-width="1.3"/><rect x="11" y="3.5" width="9.5" height="11.5" rx="1" fill="#eaf3ff" stroke="#2a6df4" stroke-width="1.2"/><path d="M13 7h5.5M13 9.4h5.5M13 11.8h3.8" stroke="#2a6df4" stroke-width="1.1"/>',
    tools: '<path d="M5.2 18.8l6.8-6.8" stroke="#38507a" stroke-width="2.6" stroke-linecap="round"/><path d="M11.6 8.9a4.3 4.3 0 0 1 5.5-5.2l-2.3 2.3 1 2.5 2.5 1 2.3-2.3a4.3 4.3 0 0 1-5.2 5.5z" fill="#2a6df4"/><path d="M14.6 14.6l4.4 4.4" stroke="#2a6df4" stroke-width="2.6" stroke-linecap="round"/>',
    router: '<rect x="8.4" y="9.5" width="7.2" height="10.5" rx="1" fill="#38507a"/><circle cx="12" cy="13" r="1" fill="#fff"/><path d="M12 7.2V4.4M8.5 6.4a5.2 5.2 0 0 1 7 0" fill="none" stroke="#2a6df4" stroke-width="1.7" stroke-linecap="round"/>',
    start: '<rect x="4.8" y="5.2" width="14.4" height="9.4" rx="1" fill="#38507a"/><rect x="6.2" y="6.6" width="11.6" height="6.6" fill="#bfe0ff"/><path d="M3.4 17.4h17.2l-1.5 2.4H4.9z" fill="#38507a"/><path d="M20.6 4.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" fill="#e8a33d"/>',
    switchi: '<path d="M6.5 8.5h9.5l-2.6-2.6M17.5 15.5H8l2.6 2.6" fill="none" stroke="#2a6df4" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
    box: '<path d="M4 8l8-4 8 4v9l-8 4-8-4z" fill="#dca763"/><path d="M4 8l8 4 8-4M12 12v9" fill="none" stroke="#aa7b40" stroke-width="1.4"/>',
    plug: '<path d="M9 3.8v4.7M15 3.8v4.7" stroke="#38507a" stroke-width="2" stroke-linecap="round"/><path d="M7 8.5h10v3.2a5 5 0 0 1-4 4.9v3.6h-2v-3.6a5 5 0 0 1-4-4.9z" fill="#2a6df4"/>',
    phone: '<path d="M4.6 8.4C4.6 6.5 7.9 5 12 5s7.4 1.5 7.4 3.4l-.8 2.4c-.2.6-.8 1-1.4.8l-2.4-.5c-.5-.1-.9-.5-1-1l-.2-1.3a9.8 9.8 0 0 0-3.2 0l-.2 1.3c-.1.5-.5.9-1 1l-2.4.5c-.6.2-1.2-.2-1.4-.8z" fill="#38507a"/><rect x="10.4" y="12.4" width="3.2" height="7" rx="1.3" fill="#2a6df4"/>'
  };
  /* 注意書きの中の電話番号は、お客様が見て分かるように本文と同じ大きさ＋太字＋赤にする
   * （小さい字のままだと解約のご連絡先が読めない、という店頭の指摘・2026-08-09） */
  function noteHtml(t) {
    /* **…** で囲んだところは、電話番号と同じく本文と同じ大きさ＋太字＋赤にする
     * （J:COMの「解約はインターネットのみ」のように、読み飛ばされると事故になる箇所） */
    return esc(t)
      .replace(/0\d{1,3}[-‐−ー]\d{2,4}[-‐−ー]\d{3,4}/g, function (m) {
        return '<span class="f2-tel">' + m + "</span>";
      })
      .replace(/\*\*([^*]+)\*\*/g, function (m, in1) {
        return '<span class="f2-em">' + in1 + "</span>";
      });
  }

  function flowSheetHtml() {
    var r = calc();
    var fd = flowData(r);
    /* 工程が多いときもA4・1枚に収める。
     * 8工程以上は余白と文字を詰め（flow2-dense）、9工程以上はさらに全体を縮小する。 */
    var nStep = fd.steps.length;
    var dense = nStep >= 8 ? " flow2-dense" : "";
    var zoom = nStep >= 9 ? Math.max(0.62, 8.4 / nStep) : 0;
    var h = '<div class="flow-sheet flow2' + dense + '"'
      + (zoom ? ' style="zoom:' + zoom.toFixed(2) + '"' : "") + ">";
    h += '<div class="flow-target">' + esc(PRODUCTS[state.product].name + productLabel()) + "</div>";
    h += '<div class="flow2-list">';
    fd.steps.forEach(function (st2, i) {
      if (i > 0) h += '<div class="f2-sep" aria-hidden="true">▼</div>';
      h += '<div class="f2-row">'
        + '<span class="f2-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' + (FLOW_ICONS[st2.icon] || "") + "</svg></span>"
        + '<div class="f2-body">'
        + '<span class="f2-step">STEP ' + (i + 1) + "</span>"
        + (st2.when ? '<span class="f2-when">' + esc(st2.when) + "</span>" : "")
        + '<div class="f2-t">' + noteHtml(st2.t) + "</div>"
        + (st2.d ? '<div class="f2-d">' + esc(st2.d) + "</div>" : "")
        + (st2.notes.length
            ? '<ul class="f2-n">' + st2.notes.map(function (n2) { return "<li>" + noteHtml(n2) + "</li>"; }).join("") + "</ul>"
            : "")
        + "</div>"
        + '<div class="f2-date"><span class="f2-date-label">予定日</span>'
        + '<span class="f2-date-line" contenteditable="true" data-fi="' + i + '">'
        + esc((state.flowDates || {})[i] || "") + "</span></div>"
        + "</div>";
    });
    h += "</div>";
    // 注意事項は各工程の中に書くため、末尾の「ご注意・ご案内」の枠は出さない
    return h + "</div>";
  }

  function sheetHtml(setWariFromPhone) {
    var r = calc();
    var h = "";
    var seg0 = r.segs[0], segLast = r.segs[r.segs.length - 1];
      h += '<div class="big-monthly">';
      // 通常時のお支払い目安: 最初の期間と最後の期間を1枠にまとめて表示
      // 目安は最終期間（31か月目以降など）の金額のみ表示。途中の変化は「お支払いの推移」表で確認
      h += '<div class="bm-box"><div class="bm-label">通常時お支払い目安' + (segLast.from > 1 ? "（" + segLabel(segLast) + "）" : "") + '</div><div class="bm-value">' + yen(segLast.monthly) + "</div>"
        + (r.deviceNote ? '<div class="bm-sub">' + esc(r.deviceNote) + "</div>" : "") + "</div>";
      // 光セット割の合計を加味した実質価格（入力があるときだけ表示）
      var setWari = Math.max(0, num(setWariFromPhone));
      if (setWari > 0) {
        h += '<div class="bm-box"><div class="bm-label">実質お支払い目安' + (segLast.from > 1 ? "（" + segLabel(segLast) + "）" : "") + '</div><div class="bm-value">' + yen(Math.max(0, segLast.monthly - setWari)) + "</div>"
          + '<div class="bm-sub">ご家族スマホの光セット割 −' + yen(setWari) + "/月 を差引いた金額</div></div>";
      }
      h += '<div class="bm-box"><div class="bm-label">初期費用</div><div class="bm-value">' + yen(r.initial) + "</div></div>";
      // dポイント進呈特典のまとめ
      var ptRows = [];
      if (num(state.dpoint) > 0) {
        ptRows.push({ name: "ドコモ光お申込みdポイント進呈（利用開始4か月後の月末・期間用途限定）", pt: Math.round(num(state.dpoint)) });
      }
      if (r.tvOn && isHikari() && state.applyType !== "tenyo" && state.tvPoint !== false) {
        ptRows.push({ name: "テレビオプション同時申込特典（転用は除く）", pt: 5000 });
      }
      // home 5G→ドコモ光 移行特典: 1ギガ（2年定期）のみ・20,000pt（公式・利用開始4か月後の月）
      if (state.product === "hikari1g" && state.h5Mig) {
        ptRows.push({ name: "「home 5G」→「ドコモ光」移行特典（1ギガ 2年定期のみ・利用開始4か月後の月）", pt: 20000 });
      }
      // 店舗独自特典のポイントはdポイントなので進呈特典と合算して表示
      if (num(state.storePt) > 0) {
        ptRows.push({ name: "店舗独自特典ポイント進呈", pt: Math.round(num(state.storePt)) });
      }
      if (isHikari() && state.applyType === "shinki" && state.kojiFree && r.koji > 0) {
        ptRows.push({ name: "新規工事料 実質0円特典（エントリー不要・利用開始月の7か月後の月から24か月間分割で進呈）", pt: r.koji });
      }
      var ptTotal = 0;
      ptRows.forEach(function (x) { if (!x.monthly) ptTotal += x.pt; });
      if (ptTotal > 0) {
        h += '<div class="bm-box"><div class="bm-label">dポイント進呈 合計</div><div class="bm-value">' + ptTotal.toLocaleString("ja-JP") + 'pt</div><div class="bm-sub">進呈条件・時期は店頭でご確認ください</div></div>';
      }
      h += "</div>";

      // お支払いの推移（横並び・1か月目は初期費用等を合算して表示）
      var onsiteTotal = 0;
      r.initRows.forEach(function (x) { if (x.name.indexOf("現地払い") >= 0) onsiteTotal += x.amount; });
      var billInit = r.initial - onsiteTotal; // ドコモ請求される初期費用（事務手数料・登録料・一括工事費など）
      if (r.segs.length > 1 || billInit > 0 || onsiteTotal > 0) {
        var cols = [];
        var subs1 = [];
        if (billInit > 0) subs1.push("うち初期費用等 " + yen(billInit));
        if (onsiteTotal > 0) subs1.push("ほかに現地徴収 " + yen(onsiteTotal));
        cols.push({ label: "1か月目", amount: seg0.monthly + billInit, subs: subs1 });
        r.segs.forEach(function (sg) {
          var from = sg.from === 1 ? 2 : sg.from;
          if (sg.to != null && sg.to < from) return; // 1か月目だけの区間は左の列で表現済み
          var label = sg.to == null
            ? from + "か月目以降"
            : from + "〜" + sg.to + "か月目";
          cols.push({ label: label, amount: sg.monthly, subs: [] });
        });
        h += "<h3>お支払いの推移" + (state.kojiFree && r.koji > 0 ? "（工事費相当ポイントを料金充当した場合）" : "") + "</h3>";
        h += '<table class="trans-table"><tbody>';
        h += "<tr>" + cols.map(function (c) { return "<th>" + c.label + "</th>"; }).join("") + "</tr>";
        h += "<tr>" + cols.map(function (c) {
          return '<td class="trans-amt">' + yen(c.amount)
            + c.subs.map(function (s) { return '<div class="trans-sub">' + s + "</div>"; }).join("")
            + "</td>";
        }).join("") + "</tr>";
        h += "</tbody></table>";
      }

      /* 月額内訳は8か月目を含む期間（例: 8〜24か月目）を基準に表示する。
       * 工事費の分割（1〜24か月目）とポイント充当（8〜31か月目）が
       * どちらも効いている代表的な期間のため。 */
      var repSeg = seg0;
      for (var si = 0; si < r.segs.length; si++) {
        var sgi = r.segs[si];
        if (sgi.from <= 8 && (sgi.to == null || 8 <= sgi.to)) { repSeg = sgi; break; }
      }
      var repLabeled = repSeg.to != null || repSeg.from > 1;
      h += "<h3>月額内訳" + (repLabeled ? "（" + segLabel(repSeg) + "）" : "") + "</h3><table><tbody>";
      // dカード還元充当の行は工事費相当ポイント充当の下（表の最後）に配置する
      var dcardRow = null;
      r.rows.forEach(function (x) {
        if (x.name.indexOf("dカード") === 0) { dcardRow = x; return; }
        h += "<tr><td>" + esc(x.name) + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
      });
      r.timed.forEach(function (t) {
        // この期間に有効な項目のみ表示（期間外の項目は推移表・注記で案内）
        if (!(t.from <= repSeg.from && repSeg.from <= t.to)) return;
        h += "<tr><td>" + esc(t.name) + '</td><td class="amt">' + yen(t.amount) + "</td></tr>";
      });
      if (dcardRow) {
        h += "<tr><td>" + esc(dcardRow.name) + '</td><td class="amt">' + yen(dcardRow.amount) + "</td></tr>";
      }
      h += '<tr class="total"><td>月額合計' + (repLabeled ? "（" + segLabel(repSeg) + "）" : "") + '</td><td class="amt">' + yen(repSeg.monthly) + "</td></tr>";
      h += "</tbody></table>";
      if (state.kojiFree && r.koji > 0) {
        h += '<p class="memo">※ 実質0円特典: 工事費相当のdポイント（総額' + r.koji.toLocaleString("ja-JP")
          + 'pt・期間用途限定）が、ご利用開始月の<b>7か月後の月から24か月間</b>に分けて進呈されます。'
          + '<b>エントリーのお手続きは不要です</b>（条件を満たせば自動で対象）。'
          + '進呈されるdポイントの有効期限は、進呈月を含む6か月です。'
          + '上の推移は進呈ポイントを毎月の料金に充当した場合の目安です。</p>';
      }
      if (r.tvRegRows && r.tvRegRows.some(function (x) { return x.name.indexOf("現地払い") >= 0; })) {
        h += '<p class="memo">※ テレビ接続工事費は、工事当日にスカパーJSATへ直接お支払いください（ドコモからの請求には含まれません）。</p>';
      }
      if (is10g() && state.onecoin) {
        h += '<p class="memo">※ ワンコインキャンペーン: 開通月〜6か月目まで基本料500円（開通当月は日割り）。1ギガからのプラン変更は対象外。</p>';
      }

      // 初期費用とdポイント進呈特典は左右2列に並べて縦の長さを圧縮（10Gなど項目が多くても1枚に収める）
      var initHtml = "";
      if (r.initRows.length) {
        initHtml += "<h3>初期費用</h3><table><tbody>";
        r.initRows.forEach(function (x) {
          var label = esc(x.name) + (x.strike ? '　<s>' + yen(x.strike) + "</s>" : "");
          initHtml += "<tr><td>" + label + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
        });
        initHtml += '<tr class="total"><td>初期費用合計</td><td class="amt">' + yen(r.initial) + "</td></tr>";
        initHtml += "</tbody></table>";
      }
      var ptHtml = "";
      if (ptRows.length) {
        ptHtml += "<h3>dポイント進呈特典</h3><table><tbody>";
        ptRows.forEach(function (x) {
          ptHtml += "<tr><td>" + esc(x.name) + '</td><td class="amt">' + x.pt.toLocaleString("ja-JP") + (x.monthly ? "pt/月" : "pt") + "</td></tr>";
        });
        if (ptTotal > 0) {
          ptHtml += '<tr class="total"><td>進呈ポイント合計（一括進呈分）</td><td class="amt">' + ptTotal.toLocaleString("ja-JP") + "pt</td></tr>";
        }
        ptHtml += "</tbody></table>";
      }
      if (initHtml && ptHtml) {
        h += '<div class="sheet-cols"><div class="sheet-col">' + initHtml + '</div><div class="sheet-col">' + ptHtml + "</div></div>";
      } else {
        h += initHtml + ptHtml;
      }
      // 店舗独自特典（相対対応）: 現金キャッシュバックのみ別枠（ポイントはdポイント進呈特典に合算済み）
      if (num(state.storeCash) > 0) {
        h += "<h3>店舗独自特典</h3><table><tbody>";
        h += '<tr><td>現金キャッシュバック</td><td class="amt">' + yen(num(state.storeCash)) + "</td></tr>";
        h += "</tbody></table>";
      }
      if (state.dcard !== "none" && r.dcardPt > 0) {
        h += '<p class="memo">※ dカード' + (state.dcard === "gold" ? "GOLD" : "PLATINUM") + '特典分（利用料金の' + (state.dcard === "gold" ? "10" : "20") + '%）は毎月のお支払いへ自動充当した金額です。還元対象・上限はカード規約によります。</p>';
      }

      if (setWari > 0) {
        h += '<p class="memo">※ ドコモ光／home 5G セット割 −' + yen(setWari)
          + "/月 は、ご家族のスマホ料金から割引されます（この見積書の月額には含まれていません）。</p>";
      } else {
        h += '<p class="memo">※ ドコモ光／home 5G セット割は、ご家族のスマホ料金から割引されます（この見積書の月額には含まれていません）。</p>';
      }
      if (PRODUCTS[state.product].typec) {
        h += '<p class="memo" style="color:#C62828;font-weight:700">※ お電話・テレビはケーブルテレビ（ZTV等）のご契約のまま残ります。ドコモからの請求とは別に、ケーブルテレビからの請求が続きます。</p>';
        if (num(state.typecKeepAmt) > 0) {
          h += "<h3>ケーブルテレビに残るお支払い（参考）</h3><table><tbody>"
            + '<tr><td>お電話・テレビなど（ケーブルテレビからの請求）</td><td class="amt">' + yen(num(state.typecKeepAmt)) + "</td></tr>"
            + "</tbody></table>"
            + '<p class="memo">※ 上の月額には含まれていません。ケーブルテレビ側のセット割引の有無・金額は、切替のお手続き時にご確認ください。</p>';
        }
      }
    /* 開通までの流れは、見積書には入れない（店舗の指定・2026-08-09）。
     * 必要なときは見積書タブの「開通までの流れ（1枚）」で別紙として印刷する。 */
    return h;
  }

  /* ケータイ側から使うもの */
  window.KQ_IENAKA = {
    defaultState: defaultState,
    attach: function (st, cb) {
      state = st;
      onChange = cb || function () {};
    },
    bind: bind,
    syncForm: syncForm,
    applyDefaults: applyDefaults,
    calc: calc,
    render: render,
    segLabel: segLabel,
    isOn: function () { return !!(state && state.enabled); },
    label: function () { return state ? PRODUCTS[state.product].name + productLabel() : ""; },
    /* プロバイダ無料無線ルーターのレンタル。1ギガだけの取り扱いなので、
     * それ以外は空を返して引き継ぎシートにも出さない。 */
    routerRental: function () {
      if (!state || state.product !== "hikari1g") return "";
      return state.routerRental === "nashi" ? "nashi" : "ari";
    },
    isHikari: isHikari,
    sheetHtml: sheetHtml,
    flowSheetHtml: flowSheetHtml,
    // ヒアリングした現在の回線（未ヒアリングなら空）。引き継ぎシートと奪還比較の入口
    curLine: function () { return state && state.curLine ? curLineLabel() : ""; },
    curHearing: function () { return state ? curHearingText() : ""; },
    // 入れ物を差し替えずに中身だけ初期化する（ケータイ側の store.ienaka を指したまま）
    reset: function () {
      var d = defaultState();
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(d).forEach(function (k) { state[k] = d[k]; });
      applyDefaults(); syncForm(); recalc();
    }
  };
})();
