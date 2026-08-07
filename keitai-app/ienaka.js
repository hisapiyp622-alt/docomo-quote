/* ── イエナカ見積もり（ケータイ見積もりに組み込む版） ────────────
 * 単体版（ienaka-app/app.js）から、料金の計算と入力画面だけを移してある。
 * 保存・端末間同期・ログイン・担当者はケータイ側が持っているので入れない。
 *
 * 画面のidは、ケータイ側とぶつからないよう頭に ie を付けている
 * （product → ieProduct）。data-属性も同じ理由で ie を付けている。
 *
 * 入力内容はケータイ側の store.ienaka を直接読み書きする。
 * 光は世帯に1本なので、見積もりのパターンA/B/Cでは分けない。
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
   * それ以外 … 一括購入の想定。 */
  var ROUTER10G = {
    "@nifty": { price: 20064, pay: "b48" }
  };
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
    { id: "denwa", name: "ドコモ光電話", price: 550, koji: 1100, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "denwaBV", name: "ドコモ光電話バリュー", price: 1650, koji: 1100, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpNumDisp", name: "発信者番号表示（ナンバー・ディスプレイ）", price: 440, needsPhone: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpTensou", name: "転送でんわ", price: 550, needsPhone: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpWch", name: "ダブルチャネル", price: 220, needsPhone: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "dpAddNum", name: "追加番号", price: 110, needsPhone: true, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
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
    { id: "lanCard", name: "無線LANカード", price: 330, for: ["hikari1g", "hikari10g"] },
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
      baseMonthly: 5720, tvPoint: true,
      h5DeviceName: "home 5G HR02", h5DevicePrice: 73260, h5Pay: "b48", h5Support: true,
      opts: {}, optPrices: {},
      extraMonthly: [], extraInitial: [],
      jimuFee: 4950, kojiFee: 28600, kojiPay: "b24", kojiFree: true, tvKoji: "sky",
      denwaBanpo: "new", onecoin: true, tvKojiFee: null, tvOnsiteFee: null,
      router10g: true, router10gPrice: 6780, router10gPay: "once",
      dcard: "none", dcardPt: null, h5Mig: false, storeCash: 0, storePt: 0, setWariTotal: 0,
      dpoint: 20000, custName: "", staffName: "", quoteMemo: "",
      curLine: "", curLineOther: "",   // 現在お使いの回線（ヒアリング・奪還比較の入口）
      enabled: false   // この見積もりに光・home 5G を含めるか（見積書に出すかどうか）
    };
  }

  /* 商材・住居・タイプ変更時に標準料金をセット */
  function applyDefaults() {
    if (!state) return;
    var p = PRODUCTS[state.product];
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
        if (o.koji) { phoneKoji += o.koji; phoneChecked = true; }
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
    // 10Gルーターの分割購入（48回）。一括のときは下の初期費用へ回す
    var r10g = canBuy10gRouter() && state.router10g ? num(state.router10gPrice) : 0;
    var r10gSplit = r10g > 0 && state.router10gPay === "b48";
    if (r10gSplit) {
      timed.push({ name: "10Gルーター 分割（48回・総額" + yen(r10g) + "）", amount: Math.floor(r10g / 48), from: 1, to: 48 });
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
  var APPLY_LABEL = { shinki: "新規", tenyo: "転用", jigyosha: "事業者変更" };
  function productLabel() {
    if (state.product === "home5g") return "";
    var parts = [HOUSING_LABEL[state.housing] || "戸建"];
    if (!PRODUCTS[state.product].noPtype) parts.push("タイプ" + state.ptype);
    parts.push(APPLY_LABEL[state.applyType] || "新規");
    return "（" + parts.join("・") + "）";
  }

  /* ---------- 画面描画 ---------- */
  function renderOpts() {
    if (!state) return;
    var h = "", banpoShown = false;
    IENAKA_OPTS.forEach(function (o) {
      if (o.for.indexOf(state.product) < 0) return;
      var shinki = state.applyType === "shinki" && state.product !== "home5g";
      if (o.needsPhone && !(state.opts.denwa || state.opts.denwaBV)) return; // 光電話チェック時のみ表示
      if (o.needsVideo && !state.opts.skyp) return; // 映像サービスチェック時のみ表示
      if (o.needsHikariTv && !state.opts.vsHikariTv) return; // ひかりTV利用時のみ
      var pr = state.optPrices[o.id] != null ? state.optPrices[o.id] : o.price;
      // 見出し行は金額の入力欄を持たず、選んだ内訳の合計を出す
      var priceHtml = o.sumOf
        ? (state.opts[o.id] ? ' <span class="opt-price">合計 ' + yen(groupTotal(o)) + "/月</span>" : "")
        : ' <span class="opt-price"><input type="number" data-ieoptprice="' + o.id + '" value="' + pr + '" style="width:5.5em;text-align:right;padding:4px 6px;border:1px solid var(--line);border-radius:5px;font:inherit">円/月</span>';
      h += '<label class="check ienaka-opt' + (o.needsPhone || o.needsVideo ? " sub" : "") + '"><input type="checkbox" data-ieopt="' + o.id + '"' + (state.opts[o.id] ? " checked" : "") + "> "
        + esc(o.name) + priceHtml
        + (o.koji && shinki ? ' <span class="opt-price">工事料+' + o.koji.toLocaleString("ja-JP") + "円</span>" : "")
        + "</label>";
      // 光電話: 番号ポータビリティの選択（新規のみ・チェック時に1回だけ表示）
      if (shinki && o.koji && state.opts[o.id] && !banpoShown) {
        banpoShown = true;
        h += '<div class="field tv-koji"><label>電話番号</label><select data-iebanpo="1">'
          + '<option value="new"' + (state.denwaBanpo !== "mnp" ? " selected" : "") + '>新規発番（工事料1,100円のみ）</option>'
          + '<option value="mnp"' + (state.denwaBanpo === "mnp" ? " selected" : "") + '>番号ポータビリティあり（＋同番移行2,200円）</option>'
          + "</select></div>"
          + '<p class="hint">番号ポータビリティの場合、NTT加入電話の利用休止工事料が別途NTT東西から請求される場合があります。</p>';
      }
      // テレビオプション: 工事方法の選択＋工事費（新規のみ・金額は編集可・チェック時のみ表示）
      if (shinki && o.tvKoji && state.opts[o.id]) {
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
    if (state.opts.denwaBV) {
      h += '<p class="hint">※ 光電話バリューには発信者番号表示・転送でんわ・迷惑電話ストップなど6つの付加サービスと528円分の無料通話が含まれます（含まれるサービスの個別追加は不要です）。</p>';
    }
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
    $("ieHousing").value = state.housing;
    /* 100M の設備を選んだときの案内。月額はマンションと同じ。
     * 10ギガは対応設備が要るので、組み合わせが合っていないことを知らせる。 */
    var hn = $("ieHousingNote");
    if (state.housing !== "ms100" || state.product === "home5g") {
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
          + "　※ 見積書の「開通までの流れ」に解約のご案内が載ります";
      } else {
        clh.hidden = true;
      }
    }
    $("iePtypeField").hidden = !!PRODUCTS[state.product].noPtype;
    $("ieProviderField").hidden = !isHikari() || !!PRODUCTS[state.product].noPtype;
    $("ieProvider").value = state.provider || "";
    /* 新規申込でも、いまのプロバイダを残してメールアドレスを引き継ぐことがあるため、
     * 申込区分によらず、プロバイダを選んだら聞く。 */
    var ptOn = !$("ieProviderField").hidden && !!state.provider;
    $("ieProviderTypeField").hidden = !ptOn;
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
    $("ieRouter10gPay").value = state.router10gPay || "once";
    var r10gHint = $("ieRouter10gHint");
    r10gHint.hidden = !r10gOn;
    if (r10gOn) {
      var rp10 = num(state.router10gPrice);
      r10gHint.innerHTML = (state.provider === "@nifty"
        ? "@nifty の優待価格（バッファロー WSR6500BE6P-10G）。<strong>税込20,064円</strong>"
          + "（ページの「18,240円」は税抜）。ニフティで購入する場合、ドコモの"
          + "「10Gbps対応無線LANルーター」（月額550円）の契約は不要です。"
        : "プロバイダによって取り扱いが違います。金額は店頭でご確認ください。")
        + (state.router10gPay === "b48" && rp10 > 0
          ? "　48回分割で <strong>" + yen(Math.floor(rp10 / 48)) + "/月</strong>（総額 " + yen(rp10) + "）"
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
    if (product === "home5g" || applyType === "tenyo") return 0;
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
        others.push(state.router10gPay === "b48"
          ? "10Gルーター 48回分割 " + yen(Math.floor(rp / 48)) + "/月（総額 " + yen(rp) + "）"
          : "10Gルーター購入費用 " + yen(rp));
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
        + "pt/月（1,100円ごとに" + (state.dcard === "gold" ? "100pt・10%" : "200pt・20%") + "）。還元対象・上限はカード規約をご確認ください。数値は直接編集できます。";
    }
  }


  /* ---------- 入力の受け取り ---------- */
  function bind() {
    $("ieProduct").addEventListener("change", function () {
      var prevDef = dpointDefaultFor(state.product, state.applyType);
      state.product = this.value;
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
      if (product === "home5g" || applyType === "tenyo") return 0;
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
    $("ieApplyType").addEventListener("change", function () {
      var prevDef = dpointDefaultFor(state.product, state.applyType);
      state.applyType = this.value;
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
    $("ieStorePt").addEventListener("input", function () { state.storePt = num(this.value); recalc(); });
    $("ieDcard").addEventListener("change", function () { state.dcard = this.value; state.dcardPt = null; syncForm(); recalc(); });
    $("ieDcardPt").addEventListener("input", function () { state.dcardPt = num(this.value); recalc(); });
    $("ieRouter10g").addEventListener("change", function () { state.router10g = this.checked; syncForm(); recalc(); });
    $("ieRouter10gPrice").addEventListener("input", function () { state.router10gPrice = num(this.value); syncForm(); recalc(); });
    $("ieRouter10gPay").addEventListener("change", function () { state.router10gPay = this.value; syncForm(); recalc(); });
    $("ieKojiFree").addEventListener("change", function () { state.kojiFree = this.checked; recalc(); });
    $("ieDpoint").addEventListener("input", function () { state.dpoint = num(this.value); recalc(); });
    $("ieOnecoin").addEventListener("change", function () { state.onecoin = this.checked; recalc(); });
  $("ieOptList").addEventListener("change", function (e) {
      var id = e.target.getAttribute("data-ieopt");
      if (id) { state.opts[id] = e.target.checked; renderOpts(); recalc(); return; }
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
    { id: "none", name: "固定回線なし" },
    { id: "flets", name: "フレッツ光（NTT東・西）", tel: "0120-116-116", telNote: "NTT東西・9:00〜17:00" },
    { id: "sbhikari", name: "ソフトバンク光", tel: "0800-111-2009", telNote: "10:00〜19:00・通話無料" },
    { id: "sbair", name: "SoftBank Air", cancel: "解約はSoftBankサポートセンターへ（My SoftBankでも手続きを確認できます）" },
    { id: "auhikari", name: "auひかり", cancel: "解約はご契約のプロバイダ（So-net・BIGLOBE・@niftyなど）の窓口へ" },
    { id: "nuro", name: "NURO光" },
    { id: "rakuten", name: "楽天ひかり" },
    { id: "jcom", name: "J:COM NET" },
    { id: "eo", name: "eo光" },
    { id: "collabo", name: "他社光コラボ（ビッグローブ光・So-net光・OCN光 など）" },
    { id: "cable", name: "ケーブルテレビのネット" },
    { id: "homerouter", name: "他社ホームルーター・モバイルWi-Fi" },
    { id: "other", name: "その他" }
  ];
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
  function flowHtml(r) {
    var steps = [], notes = [];
    if (state.product === "home5g") {
      steps.push("お申込み（店頭で本日完了）");
      steps.push("本体をお受け取り");
      steps.push("ご自宅のコンセントに挿すだけで、その日から利用開始（工事不要）");
    } else if (state.applyType === "shinki") {
      steps.push("お申込み（店頭で本日完了）");
      steps.push("工事日を決めるお電話（後日）で日程を決定");
      steps.push("開通工事（立ち会いをお願いします）。お申込みから2週間〜1か月程度が目安（時期・地域により前後します）");
      steps.push("ルーターを接続・設定して利用開始");
      if (r.tvOn) notes.push("テレビオプションの接続工事は、開通工事と同じ日に行います");
      if (state.product === "hikari10g" && state.router10g && num(state.router10gPrice) > 0) {
        notes.push("ご購入の10ギガ対応ルーターは、開通後に接続・設定してください");
      }
    } else {
      steps.push("お申込み（店頭で本日完了）");
      steps.push("切替日を書類・SMSでご案内");
      steps.push("切替日に自動で切り替わります（工事・立ち会いなし）。お申込みから1〜2週間程度が目安");
      steps.push("ルーターの設定を確認して利用開始");
    }
    // レンタルルーターが届くご案内（1ギガのプロバイダレンタル・ahamo光のレンタル）
    var rental = (state.product === "hikari1g" && state.routerRental !== "nashi")
      || !!(state.opts || {}).ahamoRouter || !!(state.opts || {}).ahamoRouter10g;
    if (state.product !== "home5g" && rental) {
      notes.push("レンタルの無線ルーターは、" + (state.applyType === "shinki" ? "工事日" : "切替日") + "までにプロバイダから届きます");
    }
    if (isHikari() && state.provider === "@nifty") {
      notes.push("開通までのご不明点は、@niftyのフォローコール（電話サポート）でご相談いただけます");
    }
    // いまの回線の解約。転用・事業者変更は解約が不要なので、案内だけ変える
    var cl = curLineDef();
    if (cl && cl.id !== "none") {
      if (state.product === "home5g" || state.applyType === "shinki") {
        steps.push("いまの回線（" + curLineLabel() + "）の解約手続き（開通・利用開始を確認してから）");
        notes.push(cl.tel
          ? "解約のご連絡先: " + cl.name + " " + cl.tel + (cl.telNote ? "（" + cl.telNote + "）" : "")
          : (cl.cancel || "解約のご連絡先は、ご契約の書面・公式サイト・マイページでご確認ください"));
        notes.push("開通前に解約すると、インターネットの使えない期間ができます。違約金・工事費の残りの有無はご契約内容をご確認ください");
      } else if (state.applyType === "tenyo") {
        notes.push("転用では、フレッツ光の回線契約はそのまま移行するため解約は不要です。プロバイダ（OCN・So-netなど）は別途解約が必要な場合があります");
      } else if (state.applyType === "jigyosha") {
        notes.push("事業者変更では、いまの光コラボ（" + curLineLabel() + "）の解約手続きは不要です（自動で切り替わります）。メールアドレスなどのオプションだけ残る場合があります");
      }
    }
    var fh = '<div class="ie-flow"><h3>開通までの流れ</h3><ol>'
      + steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    if (notes.length) {
      fh += '<ul class="ie-flow-notes">' + notes.map(function (s) { return "<li>※ " + esc(s) + "</li>"; }).join("") + "</ul>";
    }
    return fh + "</div>";
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
        h += '<p class="memo">※ ワンコインキャンペーン: 開通月〜6か月目まで基本料500円（開通当月は日割り）。さらに開通7か月後にルーターレンタル料6か月分相当のdポイント3,300pt（期間・用途限定）を一括進呈。1ギガからのプラン変更は対象外。</p>';
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
    h += flowHtml(r);
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
    // ヒアリングした現在の回線（未ヒアリングなら空）。引き継ぎシートと奪還比較の入口
    curLine: function () { return state && state.curLine ? curLineLabel() : ""; },
    // 入れ物を差し替えずに中身だけ初期化する（ケータイ側の store.ienaka を指したまま）
    reset: function () {
      var d = defaultState();
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(d).forEach(function (k) { state[k] = d[k]; });
      applyDefaults(); syncForm(); recalc();
    }
  };
})();
