/* イエナカ見積もり（ドコモ光・home 5G） */
(function () {
  "use strict";
  var APP_VERSION = "2026.07.25-57";
  var KEY = "ienaka-v3"; // v1,v2=旧仕様（料金改定・支払い方法変更時に破棄）

  /* 標準料金（2026-07-24 ドコモ公式サイト調査値。入力欄でいつでも変更可） */
  var PRODUCTS = {
    hikari1g: {
      name: "ドコモ光 1ギガ",
      monthly: { ht: { A: 5720, B: 5940 }, ms: { A: 4400, B: 4620 } },
      jimu: 4950, koji: { ht: 28600, ms: 28600 },
      note: "2年定期契約・税込。タイプBはタイプA＋220円。新規工事料28,600円（実質0円特典あり・進呈条件は要確認）。"
    },
    hikari10g: {
      name: "ドコモ光 10ギガ",
      monthly: { ht: { A: 6380, B: 6600 }, ms: { A: 6380, B: 6600 } },
      jimu: 4950, koji: { ht: 28600, ms: 28600 },
      note: "2年定期契約・税込。提供エリア・対応設備の確認が必要。新規工事料28,600円（実質0円特典あり）。"
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
      note: "ahamoユーザー専用（ペア回線必須）・2年定期契約・税込・戸建/マンション共通5,610円。セット割対象外。"
    },
    home5g: {
      name: "home 5G",
      monthly: 5280,
      jimu: 4950, koji: 0,
      note: "工事不要・コンセントに挿すだけ。プラン月額5,280円（税込）・事務手数料4,950円（店頭）。"
    }
  };
  function is10g() { return state.product === "hikari10g" || state.product === "ahamo10g"; }
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
    { id: "skyp", name: "スカパー！等の映像サービス", price: 0, for: ["hikari1g", "hikari10g", "ahamo1g", "ahamo10g"] },
    { id: "lanCard", name: "無線LANカード", price: 330, for: ["hikari1g", "hikari10g"] },
    { id: "ahamoRouter", name: "ルーターレンタル（OCNバーチャルコネクト対応）", price: 330, for: ["ahamo1g", "ahamo10g"] },
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
      product: "hikari1g", applyType: "shinki", housing: "ht", ptype: "A", provider: "", routerRental: "ari",
      baseMonthly: 5720, tvPoint: true,
      h5DeviceName: "home 5G HR02", h5DevicePrice: 73260, h5Pay: "b48", h5Support: true,
      opts: {}, optPrices: {},
      extraMonthly: [], extraInitial: [],
      jimuFee: 4950, kojiFee: 28600, kojiPay: "b24", kojiFree: true, tvKoji: "sky",
      denwaBanpo: "new", onecoin: true, tvKojiFee: null, tvOnsiteFee: null,
      router10g: true, router10gPrice: 6780,
      dcard: "none", dcardPt: null, h5Mig: false, storeCash: 0, storePt: 0, setWariTotal: 0,
      dpoint: 20000, custName: "", staffName: "", quoteMemo: ""
    };
  }
  var state = defaultState();
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved) {
      state = Object.assign(defaultState(), saved);
      // エリア対応前の保存データ: 旧既定値(10,000pt)のままなら新しいエリア別既定値へ更新
      if (saved.region == null && (num(state.dpoint) === 10000 || !num(state.dpoint))) {
        state.dpoint = dpointDefaultFor(state.product, state.applyType);
      }
    }
  } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function yen(n) { return (n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("ja-JP") + "円"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  /* 商材・住居・タイプ変更時に標準料金をセット */
  function applyDefaults() {
    var p = PRODUCTS[state.product];
    if (state.product === "home5g") {
      state.baseMonthly = p.monthly;
      state.kojiFee = 0; state.kojiFree = false;
    } else {
      state.baseMonthly = p.monthly[state.housing][state.ptype];
      state.kojiFee = p.koji[state.housing];
    }
    state.jimuFee = p.jimu;
  }

  /* ---------- 計算 ---------- */
  function calc() {
    var p = PRODUCTS[state.product];
    var rows = [{ name: p.name + productLabel(), amount: num(state.baseMonthly) }];
    var phoneOn = !!(state.opts.denwa || state.opts.denwaBV);
    IENAKA_OPTS.forEach(function (o) {
      if (o.for.indexOf(state.product) < 0) return;
      if (o.needsPhone && !phoneOn) return; // 光電話の付加サービスは光電話利用時のみ
      if (!state.opts[o.id]) return;
      var pr = state.optPrices[o.id] != null ? num(state.optPrices[o.id]) : o.price;
      rows.push({ name: o.name, amount: pr });
    });
    state.extraMonthly.forEach(function (a) {
      if (!a.name && !num(a.amount)) return;
      rows.push({ name: a.name || "追加項目", amount: num(a.amount) });
    });

    // dカードGOLD/PLATINUM還元: 利用料金1,100円（税込）ごとに100pt（GOLD 10%）/ 200pt（PLATINUM 20%）
    var dcardEligible = 0;
    rows.forEach(function (x) { if (x.amount > 0) dcardEligible += x.amount; });
    var dcardRate = state.dcard === "gold" ? 100 : state.dcard === "platinum" ? 200 : 0;
    var dcardAutoPt = dcardRate > 0 ? Math.floor(dcardEligible / 1100) * dcardRate : 0;
    var dcardPt = state.dcard === "none" ? 0 : (state.dcardPt != null ? Math.max(0, num(state.dcardPt)) : dcardAutoPt);
    if (dcardPt > 0) {
      // ポイント進呈ではなく、毎月の料金へ自動充当される体裁で月額から差引
      rows.push({ name: "dカード" + (state.dcard === "gold" ? "GOLD" : "PLATINUM") + "還元 充当（利用料金の" + (state.dcard === "gold" ? "10" : "20") + "%）", amount: -dcardPt });
    }

    // 期間限定の月額項目 {name, amount, from, to}（工事費分割・ポイント充当・端末分割）
    var timed = [], deviceNote = "";

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
      koji = PRODUCTS[state.product].koji[state.housing];
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
    var kojiPt = Math.floor(koji / 24); // 実質0円特典のポイントは回線の新規工事料相当分のみ
    if (kojiTotal > 0 && state.kojiPay === "b24") {
      timed.push({ name: "工事料 分割（24回・総額" + yen(kojiTotal) + "）", amount: Math.floor(kojiTotal / 24), from: 1, to: 24 });
    }
    if (koji > 0 && state.kojiFree) {
      timed.push({ name: "工事費相当ポイント充当（開通6か月後から24回進呈）", amount: -kojiPt, from: 7, to: 30 });
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
    // 10Gルーター購入費用（10ギガ選択時・チェック式）
    if (is10g() && state.router10g && num(state.router10gPrice) > 0) {
      initRows.push({ name: "10Gルーター購入費用", amount: num(state.router10gPrice) });
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
    var parts = [state.housing === "ht" ? "戸建" : "マンション"];
    if (!PRODUCTS[state.product].noPtype) parts.push("タイプ" + state.ptype);
    parts.push(APPLY_LABEL[state.applyType] || "新規");
    return "（" + parts.join("・") + "）";
  }

  /* ---------- 画面描画 ---------- */
  function renderOpts() {
    var h = "", banpoShown = false;
    IENAKA_OPTS.forEach(function (o) {
      if (o.for.indexOf(state.product) < 0) return;
      var shinki = state.applyType === "shinki" && state.product !== "home5g";
      if (o.needsPhone && !(state.opts.denwa || state.opts.denwaBV)) return; // 光電話チェック時のみ表示
      var pr = state.optPrices[o.id] != null ? state.optPrices[o.id] : o.price;
      h += '<label class="check ienaka-opt' + (o.needsPhone ? " sub" : "") + '"><input type="checkbox" data-opt="' + o.id + '"' + (state.opts[o.id] ? " checked" : "") + "> "
        + esc(o.name) + ' <span class="opt-price"><input type="number" data-optprice="' + o.id + '" value="' + pr + '" style="width:5.5em;text-align:right;padding:4px 6px;border:1px solid var(--line);border-radius:5px;font:inherit">円/月</span>'
        + (o.koji && shinki ? ' <span class="opt-price">工事料+' + o.koji.toLocaleString("ja-JP") + "円</span>" : "")
        + "</label>";
      // 光電話: 番号ポータビリティの選択（新規のみ・チェック時に1回だけ表示）
      if (shinki && o.koji && state.opts[o.id] && !banpoShown) {
        banpoShown = true;
        h += '<div class="field tv-koji"><label>電話番号</label><select data-banpo="1">'
          + '<option value="new"' + (state.denwaBanpo !== "mnp" ? " selected" : "") + '>新規発番（工事料1,100円のみ）</option>'
          + '<option value="mnp"' + (state.denwaBanpo === "mnp" ? " selected" : "") + '>番号ポータビリティあり（＋同番移行2,200円）</option>'
          + "</select></div>"
          + '<p class="hint">番号ポータビリティの場合、NTT加入電話の利用休止工事料が別途NTT東西から請求される場合があります。</p>';
      }
      // テレビオプション: 工事方法の選択＋工事費（新規のみ・金額は編集可・チェック時のみ表示）
      if (shinki && o.tvKoji && state.opts[o.id]) {
        var curTk = TV_KOJI[state.tvKoji] || TV_KOJI.sky;
        var curFee = state.tvKojiFee != null ? state.tvKojiFee : curTk.koji;
        h += '<div class="field tv-koji"><label>テレビ工事</label><select data-tvkoji="1">'
          + Object.keys(TV_KOJI).map(function (k) {
              return '<option value="' + k + '"' + (state.tvKoji === k ? " selected" : "") + ">" + esc(TV_KOJI[k].label) + "</option>";
            }).join("")
          + "</select></div>"
          + '<div class="field tv-koji"><label>テレビ工事費（ドコモ請求）</label><input type="number" data-tvkojifee="1" value="' + curFee + '" inputmode="numeric" min="0"> 円'
          + '<span class="opt-price">（ブースター等の追加工事がある場合はここで調整）</span></div>';
        if (curTk.onsite > 0 || state.tvOnsiteFee != null) {
          var curOnsite = state.tvOnsiteFee != null ? state.tvOnsiteFee : curTk.onsite;
          h += '<div class="field tv-koji"><label>接続工事費（現地払い）</label><input type="number" data-tvonsite="1" value="' + curOnsite + '" inputmode="numeric" min="0"> 円'
            + '<span class="opt-price">スカパーへ工事当日お支払い。通常19,800円・2026年6〜7月限定キャンペーンで10,000円</span></div>';
        }
      }
    });
    if (state.opts.denwaBV) {
      h += '<p class="hint">※ 光電話バリューには発信者番号表示・転送でんわ・迷惑電話ストップなど6つの付加サービスと528円分の無料通話が含まれます（含まれるサービスの個別追加は不要です）。</p>';
    }
    $("ienakaOptList").innerHTML = h || '<p class="hint">この商材に該当する定番オプションはありません。</p>';
  }
  // 表示中のセクションだけで①②③…を振り直す（home 5G端末セクションが隠れても番号が飛ばないように）
  var MARU = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];
  function renumberSteps() {
    var i = 0;
    document.querySelectorAll("#tab-quote .step").forEach(function (s) {
      if (s.hidden) return;
      var h2 = s.querySelector("h2[data-t]");
      if (h2) h2.textContent = MARU[i++] + " " + h2.getAttribute("data-t");
    });
  }
  function renderExtras(listId, key, addLabel) {
    var el = $(listId), h = "";
    state[key].forEach(function (a, i) {
      h += '<div class="adhoc-row">'
        + '<input type="text" placeholder="項目名" value="' + esc(a.name || "") + '" data-x="' + key + '" data-i="' + i + '" data-f="name">'
        + '<input type="number" placeholder="金額（円）" value="' + (a.amount || "") + '" data-x="' + key + '" data-i="' + i + '" data-f="amount">'
        + '<button class="del" data-xdel="' + key + '" data-i="' + i + '" type="button" aria-label="削除">×</button>'
        + "</div>";
    });
    el.innerHTML = h;
  }
  function syncForm() {
    $("product").value = state.product;
    $("housing").value = state.housing;
    $("ptype").value = state.ptype;
    $("baseMonthly").value = state.baseMonthly || "";
    $("hikariFields").hidden = state.product === "home5g";
    $("applyTypeField").hidden = state.product === "home5g";
    $("applyType").value = state.applyType || "shinki";
    $("ptypeField").hidden = !!PRODUCTS[state.product].noPtype;
    $("providerField").hidden = !isHikari() || !!PRODUCTS[state.product].noPtype;
    $("provider").value = state.provider || "";
    // プロバイダ無料無線ルーターレンタルは1ギガのみ（10ギガは対象プロバイダなし・別途購入）
    $("routerRentalField").hidden = state.product !== "hikari1g";
    $("routerRental").value = state.routerRental || "ari";
    $("onecoinWrap").hidden = !is10g();
    $("onecoin").checked = !!state.onecoin;
    $("home5gStep").hidden = state.product !== "home5g";
    var shinkiKoji = isHikari() && state.applyType === "shinki";
    $("kojiPayField").hidden = !shinkiKoji;
    $("kojiFreeWrap").hidden = !shinkiKoji;
    $("h5DeviceName").value = state.h5DeviceName;
    $("h5DevicePrice").value = state.h5DevicePrice || "";
    $("h5Pay").value = state.h5Pay;
    $("h5Support").checked = !!state.h5Support;
    $("kojiPay").value = state.kojiPay || "b24";
    $("kojiFree").checked = !!state.kojiFree;
    $("dpoint").value = state.dpoint || "";
    $("dpointField").hidden = !isHikari();
    $("dpointHint").hidden = !isHikari();
    $("dcard").value = state.dcard || "none";
    $("router10gWrap").hidden = !is10g();
    $("router10g").checked = state.router10g !== false;
    $("router10gPriceField").hidden = !is10g() || state.router10g === false;
    $("router10gPrice").value = state.router10gPrice || "";
    $("custName").value = state.custName;
    $("staffName").value = state.staffName;
    $("quoteMemo").value = state.quoteMemo;
    // 店舗独自特典（相対対応）: 入力があるときだけ開いておく。普段は折りたたみ
    $("storeCash").value = state.storeCash || "";
    $("storePt").value = state.storePt || "";
    $("setWariTotal").value = state.setWariTotal || "";
    if (num(state.storeCash) > 0 || num(state.storePt) > 0) $("storeTokutenBox").hidden = false;
    renderOpts();
    renderExtras("extraMonthlyList", "extraMonthly");
    renderExtras("extraInitialList", "extraInitial");
    renumberSteps();
  }
  function recalc() {
    var r = calc();
    $("sumMonthly").textContent = yen(r.monthly);
    $("sumInitial").textContent = yen(r.initial);
    // 初期費用のまとめ表示: 手数料 → 工事費合計・分割時月額 → 工事費内訳 → その他費用
    var ks = $("kojiSummary");
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
      if (is10g() && state.router10g && num(state.router10gPrice) > 0) {
        others.push("10Gルーター購入費用 " + yen(num(state.router10gPrice)));
      }
      if (others.length) {
        kh += '<div class="ks-sub">その他費用）</div>';
        others.forEach(function (t) { kh += '<div class="ks-item">・' + t + "</div>"; });
      }
      ks.hidden = false;
      ks.innerHTML = kh;
    }
    var hint = PRODUCTS[state.product].note + (r.deviceNote ? "　" + r.deviceNote : "");
    $("h5Hint").textContent = state.product === "home5g" ? hint : "";
    // 特典（⑤）: テレビ同時申込ポイント・工事費実質0円の進呈内容
    var tvPtOk = r.tvOn && isHikari() && state.applyType !== "tenyo";
    $("tvPointWrap").hidden = !tvPtOk;
    if (tvPtOk) $("tvPoint").checked = state.tvPoint !== false;
    // home 5G→ドコモ光 移行特典は1ギガのみ表示（10ギガ・ahamo光・home 5Gは対象外）
    $("h5MigWrap").hidden = state.product !== "hikari1g";
    $("h5Mig").checked = !!state.h5Mig;
    var kp = $("kojiPointInfo");
    if (isHikari() && state.applyType === "shinki" && state.kojiFree && r.koji > 0) {
      kp.hidden = false;
      kp.textContent = "工事費 実質0円特典: " + r.koji.toLocaleString("ja-JP") + "pt（期間・用途限定）を開通6か月後から24回に分けて進呈。料金充当した場合の月額推移は見積書に表示されます。";
    } else { kp.hidden = true; }
    // dカードGOLD/PLATINUM還元
    var dcOn = state.dcard !== "none";
    $("dcardPtField").hidden = !dcOn;
    $("dcardHint").hidden = !dcOn;
    if (dcOn) {
      if (state.dcardPt == null && document.activeElement !== $("dcardPt")) {
        $("dcardPt").value = r.dcardAutoPt || "";
      }
      $("dcardHint").textContent = "自動計算: 対象月額" + yen(r.dcardEligible) + " → " + (r.dcardAutoPt || 0)
        + "pt/月（1,100円ごとに" + (state.dcard === "gold" ? "100pt・10%" : "200pt・20%") + "）。還元対象・上限はカード規約をご確認ください。数値は直接編集できます。";
    }
    save();
    if ($("tab-sheet").classList.contains("active")) renderSheet();
    if ($("tab-staff").classList.contains("active")) renderStaffSheet();
  }

  /* ---------- 見積書 ---------- */
  function renderSheet() {
    var r = calc();
    var today = new Date();
    var dateStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    var h = "";
    h += '<h2 class="sheet-title">お見積書</h2>';
    h += '<div class="sheet-meta"><span>作成日: ' + dateStr + "</span><span>"
      + (state.staffName ? "担当: " + esc(state.staffName) : "") + "</span></div>";
    if (state.custName) h += '<div class="cust">' + esc(state.custName) + "</div>";

    var seg0 = r.segs[0], segLast = r.segs[r.segs.length - 1];
    h += '<div class="big-monthly">';
    // 通常時のお支払い目安: 最初の期間と最後の期間を1枠にまとめて表示
    h += '<div class="bm-box"><div class="bm-label">通常時お支払い目安' + (seg0.to != null ? "（" + segLabel(seg0) + "）" : "") + '</div><div class="bm-value">' + yen(seg0.monthly) + "</div>"
      + (r.segs.length > 1 ? '<div class="bm-sub">↓</div><div class="bm-sub">' + segLabel(segLast) + ": " + yen(segLast.monthly) + "/月</div>" : "")
      + (r.deviceNote ? '<div class="bm-sub">' + esc(r.deviceNote) + "</div>" : "") + "</div>";
    // 光セット割の合計を加味した実質価格（入力があるときだけ表示）
    var setWari = Math.max(0, num(state.setWariTotal));
    if (setWari > 0) {
      h += '<div class="bm-box"><div class="bm-label">実質お支払い目安' + (seg0.to != null ? "（" + segLabel(seg0) + "）" : "") + '</div><div class="bm-value">' + yen(Math.max(0, seg0.monthly - setWari)) + "</div>"
        + (r.segs.length > 1 ? '<div class="bm-sub">↓</div><div class="bm-sub">' + segLabel(segLast) + ": " + yen(Math.max(0, segLast.monthly - setWari)) + "/月</div>" : "")
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
      ptRows.push({ name: "新規工事料 実質0円特典（開通6か月後から24回に分けて進呈）", pt: r.koji });
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

    // 月額内訳は7か月目を含む期間（例: 7〜24か月目＝工事費分割とポイント充当が揃う代表期間）を基準に表示
    var repSeg = seg0;
    for (var si = 0; si < r.segs.length; si++) {
      var sgi = r.segs[si];
      if (sgi.from <= 7 && (sgi.to == null || 7 <= sgi.to)) { repSeg = sgi; break; }
    }
    var repLabeled = repSeg.to != null || repSeg.from > 1;
    h += "<h3>月額内訳" + (repLabeled ? "（" + segLabel(repSeg) + "）" : "") + "</h3><table><tbody>";
    r.rows.forEach(function (x) {
      h += "<tr><td>" + esc(x.name) + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
    });
    r.timed.forEach(function (t) {
      // この期間に有効な項目のみ表示（期間外の項目は推移表・注記で案内）
      if (!(t.from <= repSeg.from && repSeg.from <= t.to)) return;
      h += "<tr><td>" + esc(t.name) + '</td><td class="amt">' + yen(t.amount) + "</td></tr>";
    });
    h += '<tr class="total"><td>月額合計' + (repLabeled ? "（" + segLabel(repSeg) + "）" : "") + '</td><td class="amt">' + yen(repSeg.monthly) + "</td></tr>";
    h += "</tbody></table>";
    if (state.kojiFree && r.koji > 0) {
      h += '<p class="memo">※ 実質0円特典: 工事費相当のdポイント（総額' + r.koji.toLocaleString("ja-JP") + 'pt・期間用途限定）が開通6か月後から24回に分けて進呈されます。上の推移は進呈ポイントを毎月の料金に充当した場合の目安です。進呈条件・時期は店頭でご確認ください。</p>';
    }
    if (r.tvRegRows && r.tvRegRows.some(function (x) { return x.name.indexOf("現地払い") >= 0; })) {
      h += '<p class="memo">※ テレビ接続工事費は、工事当日にスカパーJSATへ直接お支払いください（ドコモからの請求には含まれません）。</p>';
    }
    if (is10g() && state.onecoin) {
      h += '<p class="memo">※ ワンコインキャンペーン: 開通月〜6か月目まで基本料500円（開通当月は日割り）。さらに開通7か月後にルーターレンタル料6か月分相当のdポイント3,300pt（期間・用途限定）を一括進呈。1ギガからのプラン変更は対象外。</p>';
    }

    if (r.initRows.length) {
      h += "<h3>初期費用</h3><table><tbody>";
      r.initRows.forEach(function (x) {
        var label = esc(x.name) + (x.strike ? '　<s>' + yen(x.strike) + "</s>" : "");
        h += "<tr><td>" + label + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
      });
      h += '<tr class="total"><td>初期費用合計</td><td class="amt">' + yen(r.initial) + "</td></tr>";
      h += "</tbody></table>";
    }

    // dポイント進呈特典の一覧
    if (ptRows.length) {
      h += "<h3>dポイント進呈特典</h3><table><tbody>";
      ptRows.forEach(function (x) {
        h += "<tr><td>" + esc(x.name) + '</td><td class="amt">' + x.pt.toLocaleString("ja-JP") + (x.monthly ? "pt/月" : "pt") + "</td></tr>";
      });
      if (ptTotal > 0) {
        h += '<tr class="total"><td>進呈ポイント合計（一括進呈分）</td><td class="amt">' + ptTotal.toLocaleString("ja-JP") + "pt</td></tr>";
      }
      h += "</tbody></table>";
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

    h += '<p class="memo">※ スマホの「ドコモ光／home 5G セット割」は携帯料金側の見積もりに適用されます。</p>';
    if (state.quoteMemo) h += '<div class="memo">※ ' + esc(state.quoteMemo) + "</div>";
    h += '<div class="disclaimer">本見積もりは概算です。実際のご契約時の金額・適用条件とは異なる場合があります。提供エリア・設備状況により契約できない場合があります。詳細は店頭スタッフへご確認ください。<br>イエナカ見積もり 版 ' + APP_VERSION + "</div>";
    $("sheetBody").innerHTML = h;
  }

  /* ---------- 登録スタッフ引き継ぎシート ---------- */
  function renderStaffSheet() {
    var r = calc();
    var p = PRODUCTS[state.product];
    var today = new Date();
    var dateStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    function row(k, v) { return "<tr><td style=\"width:38%\">" + k + "</td><td>" + v + "</td></tr>"; }
    var h = "";
    h += '<h2 class="sheet-title">登録スタッフ引き継ぎシート</h2>';
    h += '<div class="sheet-meta"><span>作成日: ' + dateStr + "</span><span>"
      + (state.staffName ? "受付担当: " + esc(state.staffName) : "") + "</span></div>";
    if (state.custName) h += '<div class="cust">' + esc(state.custName) + "</div>";

    h += "<h3>ご契約内容</h3><table><tbody>";
    h += row("商材", esc(p.name));
    if (isHikari()) {
      h += row("申込区分", APPLY_LABEL[state.applyType] || "新規");
      h += row("住居タイプ", state.housing === "ht" ? "戸建" : "マンション");
      if (!p.noPtype) {
        h += row("プロバイダ", (state.provider ? "<b>" + esc(state.provider) + "</b>" : "（未定）") + "（タイプ" + esc(state.ptype) + "）");
      }
      if (state.product === "hikari1g") {
        h += row("プロバイダ無料無線ルーターレンタル", state.routerRental === "nashi" ? "なし" : "<b>あり</b>（無料レンタル利用）");
      }
    }
    if (state.product === "home5g") {
      h += row("端末", esc(state.h5DeviceName || "home 5G 端末") + "　" + yen(num(state.h5DevicePrice))
        + "（" + (state.h5Pay === "ikkatsu" ? "一括" : "分割48回") + (state.h5Support ? "・月々サポートあり" : "") + "）");
    }
    h += row("月額基本料", yen(num(state.baseMonthly)));
    if (is10g() && state.onecoin) h += row("ワンコインキャンペーン", "適用（開通〜6か月目 基本料500円）");
    h += "</tbody></table>";

    h += "<h3>お申込みオプション</h3><table><tbody>";
    var phoneOn = !!(state.opts.denwa || state.opts.denwaBV);
    var anyOpt = false;
    IENAKA_OPTS.forEach(function (o) {
      if (o.for.indexOf(state.product) < 0) return;
      if (o.needsPhone && !phoneOn) return;
      if (!state.opts[o.id]) return;
      anyOpt = true;
      var pr = state.optPrices[o.id] != null ? num(state.optPrices[o.id]) : o.price;
      var extra = "";
      if (o.koji) extra = "／電話番号: " + (state.denwaBanpo === "mnp" ? "<b>番号ポータビリティ（同番移行）</b>" : "新規発番");
      if (o.tvKoji) {
        var tk = TV_KOJI[state.tvKoji] || TV_KOJI.sky;
        extra = "／工事: " + esc(tk.label);
      }
      h += row(esc(o.name), yen(pr) + "/月" + extra);
    });
    state.extraMonthly.forEach(function (a) {
      if (!a.name && !num(a.amount)) return;
      anyOpt = true;
      h += row(esc(a.name || "追加項目"), yen(num(a.amount)) + "/月");
    });
    if (!anyOpt) h += row("オプション", "なし");
    h += "</tbody></table>";

    h += "<h3>工事・初期費用</h3><table><tbody>";
    h += row("契約事務手数料", yen(num(state.jimuFee)));
    if (r.kojiTotal > 0) {
      h += row("工事費合計", yen(r.kojiTotal) + "（" + (state.kojiPay === "b24" ? "分割24回 " + yen(Math.floor(r.kojiTotal / 24)) + "/月" : "一括払い") + "）");
      if (r.koji > 0) h += row("　内訳: 回線 新規工事料", yen(r.koji));
      r.optKojiRows.forEach(function (x) { h += row("　内訳: " + esc(x.name), yen(x.amount)); });
      if (r.koji > 0) h += row("工事費 実質0円特典", state.kojiFree ? "適用（開通6か月後から24回進呈・要エントリー確認）" : "適用なし");
    } else if (isHikari()) {
      h += row("工事費", "0円（" + (APPLY_LABEL[state.applyType] || "") + "）");
    }
    r.tvRegRows.forEach(function (x) { h += row(esc(x.name), yen(x.amount)); });
    if (is10g() && state.router10g && num(state.router10gPrice) > 0) h += row("10Gルーター購入", yen(num(state.router10gPrice)));
    state.extraInitial.forEach(function (a) {
      if (!a.name && !num(a.amount)) return;
      h += row(esc(a.name || "追加項目"), yen(num(a.amount)));
    });
    h += row("初期費用合計", "<b>" + yen(r.initial) + "</b>");
    h += "</tbody></table>";

    h += "<h3>特典・その他</h3><table><tbody>";
    h += row("dカード", state.dcard === "gold" ? "GOLD（充当" + (r.dcardPt || 0) + "pt/月）"
      : state.dcard === "platinum" ? "PLATINUM（充当" + (r.dcardPt || 0) + "pt/月）" : "なし・その他");
    if (num(state.dpoint) > 0) h += row("お申込みdポイント進呈", num(state.dpoint).toLocaleString("ja-JP") + "pt（利用開始4か月後の月末）");
    if (r.tvOn && state.tvPoint && state.applyType !== "tenyo") h += row("テレビ同時申込特典", "＋5,000pt");
    if (state.product === "hikari1g" && state.h5Mig) h += row("home 5G→ドコモ光 移行特典", "＋20,000pt（1ギガ 2年定期・前月末時点でhome 5G契約・名義同一の確認）");
    if (num(state.storeCash) > 0) h += row("店舗独自特典: 現金キャッシュバック", "<b>" + yen(num(state.storeCash)) + "</b>（相対対応）");
    if (num(state.storePt) > 0) h += row("店舗独自特典: ポイント還元", "<b>" + Math.round(num(state.storePt)).toLocaleString("ja-JP") + "pt</b>（相対対応）");
    if (num(state.setWariTotal) > 0) h += row("光セット割 合計（実質表記用）", "−" + yen(num(state.setWariTotal)) + "/月（家族スマホ側の割引）");
    if (state.quoteMemo) h += row("受付メモ", esc(state.quoteMemo));
    h += "</tbody></table>";

    h += "<h3>登録スタッフ記入欄</h3><table><tbody>";
    h += row("登録日", "");
    h += row("登録担当", "");
    h += row("備考", "");
    h += "</tbody></table>";

    h += '<div class="disclaimer">店舗内引き継ぎ用（お客様控えではありません）。イエナカ見積もり 版 ' + APP_VERSION + "</div>";
    $("staffSheetBody").innerHTML = h;
  }

  /* ---------- タブ・イベント ---------- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    document.querySelectorAll(".tab-page").forEach(function (s) { s.classList.toggle("active", s.id === "tab-" + name); });
    if (name === "sheet") renderSheet();
    if (name === "staff") renderStaffSheet();
    $("summaryBar").style.display = name === "sheet" || name === "staff" ? "none" : "";
  }
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.dataset.tab); });
  });
  $("toSheet").addEventListener("click", function () { switchTab("sheet"); });
  $("backToQuote").addEventListener("click", function () { switchTab("quote"); });
  $("backToQuoteStaff").addEventListener("click", function () { switchTab("quote"); });
  $("printBtn").addEventListener("click", function () { window.print(); });
  $("printStaffBtn").addEventListener("click", function () { window.print(); });
  window.addEventListener("beforeprint", function () {
    if ($("tab-staff").classList.contains("active")) renderStaffSheet();
    else renderSheet();
  });

  $("product").addEventListener("change", function () {
    var prevDef = dpointDefaultFor(state.product, state.applyType);
    state.product = this.value;
    applyDefaults();
    syncDpointDefault(prevDef);
    syncForm(); recalc();
  });
  $("housing").addEventListener("change", function () { state.housing = this.value; applyDefaults(); syncForm(); recalc(); });
  $("ptype").addEventListener("change", function () { state.ptype = this.value; applyDefaults(); syncForm(); recalc(); });
  $("provider").addEventListener("change", function () { state.provider = this.value; recalc(); });
  $("routerRental").addEventListener("change", function () { state.routerRental = this.value; recalc(); });
  $("baseMonthly").addEventListener("input", function () { state.baseMonthly = num(this.value); recalc(); });
  $("h5DeviceName").addEventListener("input", function () { state.h5DeviceName = this.value; recalc(); });
  $("h5DevicePrice").addEventListener("input", function () { state.h5DevicePrice = num(this.value); recalc(); });
  $("h5Pay").addEventListener("change", function () { state.h5Pay = this.value; recalc(); });
  $("h5Support").addEventListener("change", function () { state.h5Support = this.checked; recalc(); });
  $("kojiPay").addEventListener("change", function () { state.kojiPay = this.value; recalc(); });
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
  $("applyType").addEventListener("change", function () {
    var prevDef = dpointDefaultFor(state.product, state.applyType);
    state.applyType = this.value;
    syncDpointDefault(prevDef);
    syncForm(); recalc();
  });
  $("tvPoint").addEventListener("change", function () { state.tvPoint = this.checked; recalc(); });
  $("h5Mig").addEventListener("change", function () { state.h5Mig = this.checked; recalc(); });
  $("storeTokutenBtn").addEventListener("click", function () {
    var box = $("storeTokutenBox");
    box.hidden = !box.hidden;
  });
  $("storeCash").addEventListener("input", function () { state.storeCash = num(this.value); recalc(); });
  $("storePt").addEventListener("input", function () { state.storePt = num(this.value); recalc(); });
  $("setWariTotal").addEventListener("input", function () { state.setWariTotal = num(this.value); recalc(); });
  $("dcard").addEventListener("change", function () { state.dcard = this.value; state.dcardPt = null; syncForm(); recalc(); });
  $("dcardPt").addEventListener("input", function () { state.dcardPt = num(this.value); recalc(); });
  $("router10g").addEventListener("change", function () { state.router10g = this.checked; syncForm(); recalc(); });
  $("router10gPrice").addEventListener("input", function () { state.router10gPrice = num(this.value); recalc(); });
  $("kojiFree").addEventListener("change", function () { state.kojiFree = this.checked; recalc(); });
  $("dpoint").addEventListener("input", function () { state.dpoint = num(this.value); recalc(); });
  $("onecoin").addEventListener("change", function () { state.onecoin = this.checked; recalc(); });
  $("custName").addEventListener("input", function () { state.custName = this.value; recalc(); });
  $("staffName").addEventListener("input", function () { state.staffName = this.value; recalc(); });
  $("quoteMemo").addEventListener("input", function () { state.quoteMemo = this.value; recalc(); });

  $("ienakaOptList").addEventListener("change", function (e) {
    var id = e.target.getAttribute("data-opt");
    if (id) { state.opts[id] = e.target.checked; renderOpts(); recalc(); return; }
    if (e.target.getAttribute("data-tvkoji")) { state.tvKoji = e.target.value; state.tvKojiFee = null; state.tvOnsiteFee = null; renderOpts(); recalc(); return; }
    if (e.target.getAttribute("data-banpo")) { state.denwaBanpo = e.target.value; recalc(); }
  });
  $("ienakaOptList").addEventListener("input", function (e) {
    if (e.target.getAttribute("data-tvkojifee")) { state.tvKojiFee = num(e.target.value); recalc(); return; }
    if (e.target.getAttribute("data-tvonsite")) { state.tvOnsiteFee = num(e.target.value); recalc(); }
  });
  $("ienakaOptList").addEventListener("input", function (e) {
    var id = e.target.getAttribute("data-optprice");
    if (id) { state.optPrices[id] = num(e.target.value); recalc(); }
  });
  function bindExtras(listId) {
    $(listId).addEventListener("input", function (e) {
      var key = e.target.getAttribute("data-x");
      if (!key) return;
      var i = +e.target.getAttribute("data-i"), f = e.target.getAttribute("data-f");
      state[key][i][f] = f === "amount" ? num(e.target.value) : e.target.value;
      recalc();
    });
    $(listId).addEventListener("click", function (e) {
      var key = e.target.getAttribute("data-xdel");
      if (!key) return;
      state[key].splice(+e.target.getAttribute("data-i"), 1);
      renderExtras(listId, key);
      recalc();
    });
  }
  bindExtras("extraMonthlyList");
  bindExtras("extraInitialList");
  $("addExtraMonthly").addEventListener("click", function () {
    state.extraMonthly.push({ name: "", amount: "" });
    renderExtras("extraMonthlyList", "extraMonthly"); recalc();
  });
  $("addExtraInitial").addEventListener("click", function () {
    state.extraInitial.push({ name: "", amount: "" });
    renderExtras("extraInitialList", "extraInitial"); recalc();
  });
  $("clearQuote").addEventListener("click", function () {
    if (!confirm("入力内容をすべてクリアしますか？")) return;
    state = defaultState(); applyDefaults(); syncForm(); recalc();
  });

  /* ---------- 起動 ---------- */
  syncForm();
  recalc();
})();
