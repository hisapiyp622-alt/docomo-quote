/* =========================================================
 * ドコモ料金見積もり — アプリ本体
 * 3パターン同時見積もり／期間セグメント式の月額計算
 * ========================================================= */
(function () {
  "use strict";

  var APP_VERSION = "1.5.2";
  var MASTER_KEY = "kq-master-v1"; // 料金マスタ（全担当・全端末で共通）
  var STATE_KEY = "kq-state-v1";   // 見積もり（担当グループごとに分かれる）
  // 見積もりデータは担当グループごとに別領域へ保存する（担当Aは従来キーを引き継ぐ）
  // 見積もりは担当者ごとに別の領域へ保存する
  function quoteKey(staffId) {
    return STATE_KEY + ":" + (staffId || activeStaff().id);
  }
  var PAT_NAMES = ["A", "B", "C"];
  var OPT_CATEGORIES = ["補償", "バックアップ", "セキュリティ", "エンタメ", "その他"];

  /* ---------- 店舗設定（店舗名・担当者） ---------- */
  var CFG_KEY = "kq-config-v1";
  var config;
  function defaultConfig() {
    return {
      storeName: "", staff: [{ id: "s1", name: "担当1", code: "" }], activeStaffId: "s1",
      // 端末内で使う場合の店舗ログイン（Firebase未設定のときだけ使う）
      lock: { storeId: "", hash: "", salt: "", algo: "" }
    };
  }
  function loadConfig() {
    config = defaultConfig();
    try {
      var saved = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (saved && saved.staff && saved.staff.length) config = Object.assign(defaultConfig(), saved);
    } catch (e) {}
    if (!config.lock) config.lock = { storeId: "", hash: "", salt: "", algo: "" };
    config.staff.forEach(function (s2, i) {
      if (!s2.id) s2.id = "s" + (i + 1);
      if (typeof s2.code !== "string") s2.code = "";
    });
  }
  function saveConfig() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(config)); } catch (e) {}
    if (typeof pushConfig === "function") pushConfig();
  }
  function activeStaff() {
    var s2 = config.staff.filter(function (x) { return x.id === config.activeStaffId; })[0];
    if (!s2) { s2 = config.staff[0]; config.activeStaffId = s2.id; }
    return s2;
  }
  function newStaffId() {
    var n = 1;
    while (config.staff.some(function (s2) { return s2.id === "s" + n; })) n++;
    return "s" + n;
  }
  // 店舗ログインの設定状態を画面に反映する
  function renderLockConfig() {
    var box = $("lockBox");
    if (!box) return;
    var on = lockEnabled();
    var st = $("lockState");
    if (st) {
      st.textContent = on
        ? "設定中です。アプリを開くと店舗ID「" + config.lock.storeId + "」のログインを求めます。"
        : "未設定です。アプリを開くとログインなしで使えます。";
      st.className = "hint" + (on ? " lock-on" : "");
    }
    var clr = $("lockClearBtn");
    if (clr) clr.hidden = !on;
    var idEl = $("lockStoreId");
    if (idEl && document.activeElement !== idEl) idEl.value = config.lock.storeId || "";
  }
  // 設定タブの店舗設定カードを描き直す
  function renderStoreConfig() {
    var nameEl = $("storeNameInput");
    if (nameEl && nameEl.value !== (config.storeName || "")) nameEl.value = config.storeName || "";
    var list = $("staffList");
    if (!list) return;
    list.innerHTML = config.staff.map(function (s2, i) {
      return '<div class="staff-row">'
        + '<input type="text" value="' + esc(s2.name) + '" data-staffname="' + i + '" placeholder="担当者名">'
        + '<input type="text" value="' + esc(s2.code || "") + '" data-staffcode="' + i + '" placeholder="コード" inputmode="numeric">'
        + (config.staff.length > 1 ? '<button class="del" data-staffdel="' + i + '" type="button" aria-label="削除">×</button>' : "")
        + "</div>";
    }).join("");
  }

  /* ---------- 保存した見積もり ----------
   * 「いまの入力内容」とは別に、3パターン一式を名前を付けて残しておける。
   * 担当者ごとに分かれ、クラウド利用時は stores/{uid}/saved/{担当ID} に同期する。 */
  /* テンプレートは担当者ごとに持つ（3枠）。
   * 以前は料金マスタの中にあり、店舗内の全担当で共有していたため、
   * 誰かが保存すると他の担当のテンプレートが上書きされていた。 */
  var TPL_KEY = "kq-tpl-v1";
  var templates = [null, null, null];
  function tplKey(staffId) { return TPL_KEY + ":" + (staffId || activeStaff().id); }
  function loadTemplates() {
    templates = [null, null, null];
    var got = false;
    try {
      var a = JSON.parse(localStorage.getItem(tplKey()) || "null");
      if (a && a.length === 3) { templates = a; got = true; }
    } catch (e) {}
    // 共有だった頃のテンプレートは、最初の1回だけ引き継ぐ
    if (!got && MASTER.templates && MASTER.templates.some(function (t) { return !!t; })) {
      templates = JSON.parse(JSON.stringify(MASTER.templates));
      persistTemplates();
    }
  }
  function persistTemplates() {
    try { localStorage.setItem(tplKey(), JSON.stringify(templates)); } catch (e) {}
    if (typeof pushTemplates === "function") pushTemplates();
  }

  var SAVED_KEY = "kq-saved-v1";
  var SAVED_MAX = 50;
  var savedList = [];
  function savedKey(staffId) { return SAVED_KEY + ":" + (staffId || activeStaff().id); }
  function loadSaved() {
    savedList = [];
    try {
      var a = JSON.parse(localStorage.getItem(savedKey()) || "null");
      if (a && a.length) savedList = a;
    } catch (e) {}
  }
  function persistSaved() {
    try { localStorage.setItem(savedKey(), JSON.stringify(savedList)); } catch (e) {}
    if (typeof pushSaved === "function") pushSaved();
  }
  // 保存名は他の端末にも同期されるため、お客様名は既定に入れない
  function savedDefaultName() {
    var d = new Date();
    var mm = ("0" + (d.getMonth() + 1)).slice(-2), dd = ("0" + d.getDate()).slice(-2);
    var plan = state.planId ? currentPlan().name : "";
    return (d.getFullYear() + "/" + mm + "/" + dd) + (plan ? " " + plan : "");
  }
  // いま開いている3パターン一式を保存する
  function saveQuote(name) {
    var r = calc();
    var item = {
      id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(name || "").trim().slice(0, 40) || savedDefaultName(),
      custName: state.custName || "",
      planName: state.planId ? r.plan.name : "",
      monthly: r.segs[0].monthly,
      initial: r.initialTotal,
      savedAt: Date.now(),
      data: JSON.parse(JSON.stringify(store))
    };
    savedList.unshift(item);
    if (savedList.length > SAVED_MAX) savedList = savedList.slice(0, SAVED_MAX);
    persistSaved();
    renderSaved();
    return item;
  }
  // 保存済みの見積もりを開く（いまの入力内容は置き換わる）
  function loadSavedQuote(id) {
    var it = savedList.filter(function (x) { return x.id === id; })[0];
    if (!it || !it.data || !it.data.patterns) return false;
    store.active = Math.min(Math.max(it.data.active | 0, 0), 2);
    for (var i = 0; i < 3; i++) {
      store.patterns[i] = Object.assign(defaultState(), it.data.patterns[i] || {});
    }
    state = store.patterns[store.active];
    saveState();
    syncFormFromState();
    recalc();
    return true;
  }
  function deleteSavedQuote(id) {
    savedList = savedList.filter(function (x) { return x.id !== id; });
    persistSaved();
    renderSaved();
  }
  function savedWhen(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + ("0" + d.getDate()).slice(-2)
      + " " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function renderSaved() {
    var el = $("savedList");
    if (!el) return;
    if (!savedList.length) {
      el.innerHTML = '<p class="hint">保存した見積もりはまだありません。</p>';
      return;
    }
    el.innerHTML = savedList.map(function (it) {
      return '<div class="saved-row">'
        + '<div class="saved-main">'
        + '<div class="saved-name">' + esc(it.name) + "</div>"
        + '<div class="saved-sub">' + savedWhen(it.savedAt)
        + (it.planName ? "　" + esc(it.planName) : "")
        + "　月額 " + yen(it.monthly || 0)
        + (it.initial ? "　初期費用 " + yen(it.initial) : "")
        + "</div></div>"
        + '<button class="btn-sub" data-savedload="' + it.id + '" type="button">開く</button>'
        + '<button class="btn-sub saved-del" data-saveddel="' + it.id + '" type="button">削除</button>'
        + "</div>";
    }).join("");
  }

  /* 端末内モードの店舗ログイン
   * パスワードはそのまま保存せず、店舗ごとの値（salt）を混ぜたハッシュだけを持つ。
   * ただし端末を操作できる人には解析されうるため、店頭端末の簡易ロックと考えること。
   * Firebaseを設定した場合は、こちらではなくFirebaseの認証を使う。 */
  function lockSalt() {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint8Array(16);
      window.crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function lockAlgo() {
    return (window.crypto && window.crypto.subtle && window.TextEncoder) ? "sha256" : "simple";
  }
  function lockHash(pass, salt, algo) {
    var text = salt + ":" + pass;
    if (algo !== "simple" && window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
        .then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ("0" + b.toString(16)).slice(-2);
          }).join("");
        })
        .catch(function () { return simpleHash(text); });
    }
    return Promise.resolve(simpleHash(text));
  }
  // crypto.subtle が使えない環境（古い端末・http）向けの控え
  function simpleHash(text) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < text.length; i++) {
      h1 = (h1 ^ text.charCodeAt(i)) >>> 0;
      h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + text.charCodeAt(i) * (i + 7)) >>> 0;
    }
    return "s" + h1.toString(16) + h2.toString(16);
  }
  function lockEnabled() { return !!(config.lock && config.lock.hash); }

  /* ---------- マスタ読み込み ---------- */
  var MASTER;
  function upgradeV2(m) {
    // v2→v3: あんしんセキュリティ→あんしんパック462円、補償オプションに金額選択肢を付与
    (m.options || []).forEach(function (o) {
      if (o.id === "security") { o.id = "anshin_pack"; o.name = "あんしんパック"; o.price = 462; o.note = ""; }
      var def = DEFAULT_DATA.options.filter(function (x) { return x.id === o.id; })[0];
      if (def && def.priceChoices && !o.priceChoices) o.priceChoices = def.priceChoices.slice();
    });
    return m;
  }
  function loadMaster() {
    try {
      var saved = JSON.parse(localStorage.getItem(MASTER_KEY) || "null");
      MASTER = (saved && saved.plans) ? saved : JSON.parse(JSON.stringify(DEFAULT_DATA));
    } catch (e) {
      MASTER = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    // 旧バージョンの保存マスタへの後方互換
    if (!MASTER.feeItems) MASTER.feeItems = JSON.parse(JSON.stringify(DEFAULT_DATA.feeItems || []));
    if (!MASTER.campaigns) MASTER.campaigns = JSON.parse(JSON.stringify(DEFAULT_DATA.campaigns || []));
    if (!MASTER.accessories) MASTER.accessories = JSON.parse(JSON.stringify(DEFAULT_DATA.accessories || []));
    if (!MASTER.templates || MASTER.templates.length !== 3) MASTER.templates = [null, null, null];
    MASTER.feeItems.forEach(function (f) {
      if (f.pay !== "store" && f.pay !== "bill") {
        f.pay = (f.id === "fee_sim" || /手数料|再発行/.test(f.name || "")) ? "bill" : "store";
      }
    });
    // 旧「代理店独自サービス」リストをオプションに統合
    if (MASTER.agencyOptions && MASTER.agencyOptions.length) {
      MASTER.agencyOptions.forEach(function (o) {
        if (MASTER.options.some(function (x) { return x.id === o.id; })) return;
        if (!o.type) o.type = "monthly";
        MASTER.options.push(o);
      });
    }
    delete MASTER.agencyOptions;
    // 一括(once)扱いだったオプションは「初期費用の定番項目」へ移動（オプションは月額のみ）
    MASTER.options = MASTER.options.filter(function (o) {
      if (o.type === "once") {
        if (!MASTER.feeItems.some(function (f) { return f.id === o.id; })) {
          MASTER.feeItems.push({ id: o.id, name: o.name, price: o.price });
        }
        return false;
      }
      delete o.type;
      return true;
    });
    // カテゴリ未設定のオプションに初期カテゴリを付与（初期データ由来はその定義、独自追加は「その他」）
    var defCat = {};
    (DEFAULT_DATA.options || []).forEach(function (o) { defCat[o.id] = o.category; });
    MASTER.options.forEach(function (o) {
      if (!o.category || OPT_CATEGORIES.indexOf(o.category) < 0) {
        o.category = defCat[o.id] || "その他";
      }
    });
    // 店舗独自かどうかを初期データから補完。
    // 初期データに無い項目は、その店舗が自分で足したものなので店舗独自として扱う
    ["options", "feeItems"].forEach(function (key) {
      var defOwn = {}, known = {};
      (DEFAULT_DATA[key] || []).forEach(function (d) { defOwn[d.id] = !!d.own; known[d.id] = true; });
      (MASTER[key] || []).forEach(function (o) {
        if (typeof o.own === "undefined") o.own = known[o.id] ? defOwn[o.id] : true;
      });
    });
    // dカードGOLD10%対象フラグを初期データから補完（保存済みマスタに未設定のもののみ）
    var defCarrier = {};
    (DEFAULT_DATA.options || []).forEach(function (o) { defCarrier[o.id] = !!o.carrier; });
    MASTER.options.forEach(function (o) {
      if (typeof o.carrier === "undefined" && defCarrier[o.id]) o.carrier = true;
    });
    // プランの10%還元対象外フラグ（dcard10:false）も初期データから補完
    var defDcard10 = {};
    (DEFAULT_DATA.plans || []).forEach(function (p) { defDcard10[p.id] = p.dcard10; });
    MASTER.plans.forEach(function (p) {
      if (typeof p.dcard10 === "undefined" && typeof defDcard10[p.id] !== "undefined") p.dcard10 = defDcard10[p.id];
    });
    // 初期データで料金選択式になったオプションへ選択肢・プラン名を補完
    (DEFAULT_DATA.options || []).forEach(function (d) {
      if (!d.priceChoices) return;
      var o = MASTER.options.filter(function (x) { return x.id === d.id; })[0];
      if (!o) return;
      if (!o.priceChoices) o.priceChoices = d.priceChoices.slice();
      if (d.priceLabels && !o.priceLabels) o.priceLabels = JSON.parse(JSON.stringify(d.priceLabels));
    });
    // dヒッツ: 330円コースは扱わないため、保存済みマスタからも選択肢を外す
    MASTER.options.forEach(function (o) {
      if (o.id === "dhits" && o.priceChoices) { delete o.priceChoices; delete o.priceLabels; }
    });
    // NETFLIX 旧3項目（広告付ST/ST/PR）→ 料金選択式の1項目「netflix」へ統合
    var nfOldIds = ["op_1784430991714", "op_1784431033021", "op_1784431044456"];
    MASTER.options = MASTER.options.filter(function (o) { return nfOldIds.indexOf(o.id) < 0; });
    // 初期データに後から増えた項目を保存済みマスタへ追記（ユーザーが削除済みのものは復活させない）
    if (!MASTER.removedIds) MASTER.removedIds = [];
    (DEFAULT_DATA.options || []).forEach(function (d) {
      if (MASTER.options.some(function (o) { return o.id === d.id; })) return;
      if (MASTER.removedIds.indexOf(d.id) >= 0) return;
      MASTER.options.push(JSON.parse(JSON.stringify(d)));
    });
    // 初期データに後から増えたプランも同様に追記（同じグループの末尾に挿入）
    (DEFAULT_DATA.plans || []).forEach(function (d) {
      if (MASTER.plans.some(function (p) { return p.id === d.id; })) return;
      if (MASTER.removedIds.indexOf(d.id) >= 0) return;
      var at = -1;
      MASTER.plans.forEach(function (p, i) { if (p.group === d.group) at = i; });
      MASTER.plans.splice(at + 1, 0, JSON.parse(JSON.stringify(d)));
    });
    saveMaster();
  }
  function saveMaster() {
    try { localStorage.setItem(MASTER_KEY, JSON.stringify(MASTER)); } catch (e) {}
    if (typeof markMasterEdit === "function") markMasterEdit();
  }
  function resetMaster() {
    localStorage.removeItem(MASTER_KEY);
    loadMaster();
    renderMasterTab();
    syncFormFromState();
    recalc();
  }

  /* ---------- 見積もり状態（3パターン） ---------- */
  function defaultState() {
    return {
      procType: "", planGroup: "current", planId: "", tierIdx: 0,
      minna: "0", dSet: false, dCard: "none", dDenki: false, choki: "none",
      voice: "none", voiceChange: false, planChange: false, netSvc: {}, netSvcOff: {},
      options: {}, optionPrices: {}, feeItems: {},
      optionKubun: {},    // オプションの区分 {id: "new"|"keep"|"off"} ※offは廃止（料金には含めない）
      campaigns: {}, campaignAmounts: {},
      pointPoikatsu: 0, pointDcard: 0,   // ポイント自動充当（実質額案内用・pt/月）
      pointPoikatsuFamily: 0,            // ポイ活ファミリー特典（手動入力・pt/月）
      pointDcardAuto: 0,                 // 直近の自動計算値（手入力と区別するための記録）
      dcardGoldAuto: true,               // dカード還元特典を見積もりに含めるか（GOLD系選択時）
      currentInst: 0, currentInstMonths: 0,  // 見直し前から支払い中の分割金（0=ずっと）
      adhocMonthly: [],   // {name, amount, months} amountは±、months 0=ずっと
      accessories: [],    // {name, price, pay: "once"|"b12"|"b24"|"b36"}
      accSel: {},         // マスタ登録アクセサリの選択 {id: pay}
      deviceName: "", devicePrice: 0, payMethod: "none", kaedoki23: 0, kaedokiFee: 0,
      atamakin: 0, jimuFee: 0,
      adhocInitial: [],   // {name, amount} ±
      custName: "", shopName: "", staffName: "", quoteMemo: "",
      // 手続き内容（引き継ぎシートに記載）
      procTodo: {}, todoDcard: false, todoDenkiGas: false, todoHikari: false,
      todoDcardType: "", todoDenkiType: "", todoGasType: "", todoGasDiscount: {},
      todoOther: "",      // 引き継ぎシートの自由記入
      // 店頭お支払い（頭金・付属品など）の支払方法
      storePay: {}, usePoint: false, usePointAmount: 0,
    };
  }
  var store = { active: 0, patterns: [defaultState(), defaultState(), defaultState()] };
  var state = store.patterns[0];

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(quoteKey()) || "null");
      if (s && s.patterns && s.patterns.length) {
        store.active = Math.min(Math.max(s.active | 0, 0), 2);
        for (var i = 0; i < 3; i++) {
          store.patterns[i] = Object.assign(defaultState(), s.patterns[i] || {});
        }
      } else {
        // 保存がない担当者に切り替えたときは、前の担当の内容を引き継がない
        store.active = 0;
        for (var j = 0; j < 3; j++) store.patterns[j] = defaultState();
      }
    } catch (e) {}
    // カエドキ: 旧「残価」入力から「23回分の総額（頭金込み）」へ移行
    store.patterns.forEach(function (pt) {
      if (!pt.kaedoki23 && pt.zanka) {
        pt.kaedoki23 = Math.max(0, num(pt.devicePrice) - num(pt.zanka));
      }
      delete pt.zanka;
    });
    // 旧・代理店サービスのチェック状態をオプションへ統合（全パターン共通）
    store.patterns.forEach(function (pt) {
      if (!pt.optionKubun) pt.optionKubun = {};
      if (pt.todoDenki || pt.todoGas) pt.todoDenkiGas = true;
      if (!pt.procTodo || !Object.keys(pt.procTodo).length) {
        pt.procTodo = {};
        if (pt.procType) pt.procTodo[pt.procType === "plan_only" ? "plan" : pt.procType] = true;
      }
      if (pt.agencyOptions) {
        Object.keys(pt.agencyOptions).forEach(function (k) {
          if (pt.agencyOptions[k]) pt.options[k] = true;
        });
        delete pt.agencyOptions;
      }
      // 初期費用の定番項目へ移動したもののチェックを引き継ぐ
      Object.keys(pt.options).forEach(function (k) {
        if (pt.options[k] && MASTER.feeItems.some(function (f) { return f.id === k; })) {
          pt.feeItems[k] = true;
          delete pt.options[k];
        }
      });
      // NETFLIX 旧3項目のチェックを統合後の1項目＋料金選択へ引き継ぐ
      var nfMap = { op_1784430991714: 890, op_1784431033021: 1590, op_1784431044456: 2290 };
      Object.keys(nfMap).forEach(function (k) {
        if (pt.options[k]) {
          pt.options.netflix = true;
          pt.optionPrices.netflix = nfMap[k];
        }
        delete pt.options[k];
      });
    });
    state = store.patterns[store.active];
  }
  function saveState() {
    try { localStorage.setItem(quoteKey(), JSON.stringify(store)); } catch (e) {}
    markLocalEdit();
  }

  /* ---------- 店舗ログイン・端末間同期（Firestore） ----------
   * 店舗ID＋パスワードで店舗アカウントにログインし、店舗内は担当者コードで担当を選ぶ。
   * データは stores/{店舗のUID} 配下にのみ保存し、他店からは読み書きできない
   * （firestore.rules で request.auth.uid == 店舗ID を要求している）。
   *
   *   stores/{uid}                  店舗名・担当者一覧・料金マスタ
   *   stores/{uid}/quotes/{担当ID}   担当者ごとの見積もり
   *
   * お客様名は個人情報のためクラウドへ送信しない。
   * Firebaseを設定していない場合は、ログイン画面を出さずに端末内保存のみで動作する。 */
  var CLOUD = {
    enabled: false, user: null, db: null, auth: null,
    suppress: false, cfgTimer: null, quoteTimer: null, masterTimer: null,
    unsubStore: null, unsubQuote: null, watchingStaffId: null,
    savedTimer: null, unsubSaved: null, watchingSavedId: null,
    tplTimer: null, unsubTpl: null, watchingTplId: null,
    clientId: Math.random().toString(36).slice(2) + Date.now().toString(36)
  };
  function cloudOn() { return CLOUD.enabled && CLOUD.user && CLOUD.db; }
  function syncStatus(msg, cls) {
    var el = $("syncStatus");
    if (el) { el.textContent = msg || ""; el.className = "sync-status" + (cls ? " " + cls : ""); }
  }
  function cloudOk() { syncStatus("同期✓", "ok"); }
  function cloudNg(err) {
    syncStatus(/permission|insufficient/i.test(String(err)) ? "同期:権限エラー" : "同期:オフライン", "err");
  }
  function storeDoc() { return CLOUD.db.collection("stores").doc(CLOUD.user.uid); }
  function quoteDoc(staffId) { return storeDoc().collection("quotes").doc(staffId); }
  function stamp(extra) {
    var o = { clientId: CLOUD.clientId, updatedAtMs: Date.now(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }

  // 店舗設定（店舗名・担当者一覧）の送信
  function pushConfig() {
    if (!cloudOn() || CLOUD.suppress) return;
    if (CLOUD.cfgTimer) clearTimeout(CLOUD.cfgTimer);
    syncStatus("同期中…", "");
    CLOUD.cfgTimer = setTimeout(function () {
      CLOUD.cfgTimer = null;
      if (!cloudOn()) return; // 送信待ちの間にログアウトした場合は送らない
      storeDoc().set(stamp({ storeName: config.storeName || "", staff: config.staff }), { merge: true })
        .then(cloudOk, cloudNg);
    }, 800);
  }
  // 料金マスタ（店舗で共通）の送信
  function markMasterEdit() {
    if (!cloudOn() || CLOUD.suppress) return;
    if (CLOUD.masterTimer) clearTimeout(CLOUD.masterTimer);
    syncStatus("同期中…", "");
    CLOUD.masterTimer = setTimeout(function () {
      CLOUD.masterTimer = null;
      if (!cloudOn()) return;
      storeDoc().set(stamp({ master: localStorage.getItem(MASTER_KEY) || "" }), { merge: true })
        .then(cloudOk, cloudNg);
    }, 1200);
  }
  // 送信用の見積もりデータ。お客様名（個人情報）はクラウドへ送らない
  function quotePayload() {
    try {
      var s = JSON.parse(JSON.stringify(store));
      (s.patterns || []).forEach(function (pt) { pt.custName = ""; });
      return JSON.stringify(s);
    } catch (e) { return ""; }
  }
  function markLocalEdit() {
    if (!cloudOn() || CLOUD.suppress) return;
    var sid = activeStaff().id;
    if (CLOUD.quoteTimer) clearTimeout(CLOUD.quoteTimer);
    syncStatus("同期中…", "");
    CLOUD.quoteTimer = setTimeout(function () {
      CLOUD.quoteTimer = null;
      if (!cloudOn()) return;
      quoteDoc(sid).set(stamp({ data: quotePayload() })).then(cloudOk, cloudNg);
    }, 800);
  }

  function tplDoc(staffId) { return storeDoc().collection("templates").doc(staffId || activeStaff().id); }
  function pushTemplates() {
    if (!cloudOn() || CLOUD.suppress) return;
    var sid = activeStaff().id;
    if (CLOUD.tplTimer) clearTimeout(CLOUD.tplTimer);
    syncStatus("同期中…", "");
    CLOUD.tplTimer = setTimeout(function () {
      CLOUD.tplTimer = null;
      if (!cloudOn()) return;
      tplDoc(sid).set(stamp({ list: JSON.stringify(templates) })).then(cloudOk, cloudNg);
    }, 1000);
  }
  function watchTemplates() {
    if (!cloudOn() || !config.activeStaffId) return;
    var sid = activeStaff().id;
    if (CLOUD.unsubTpl && CLOUD.watchingTplId === sid) return;
    if (CLOUD.unsubTpl) { CLOUD.unsubTpl(); CLOUD.unsubTpl = null; }
    CLOUD.watchingTplId = sid;
    CLOUD.unsubTpl = tplDoc(sid).onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (!d || !d.list) return;
      if (d.clientId === CLOUD.clientId) return;
      if (CLOUD.tplTimer) return; // 送信待ちのローカル変更がある間は上書きしない
      try {
        var a = JSON.parse(d.list);
        if (!a || a.length !== 3) return;
        templates = a;
        try { localStorage.setItem(tplKey(sid), JSON.stringify(templates)); } catch (e2) {}
        renderTplBar();
      } catch (e) {}
    }, function () {});
  }

  function savedDoc(staffId) { return storeDoc().collection("saved").doc(staffId || activeStaff().id); }
  function pushSaved() {
    if (!cloudOn() || CLOUD.suppress) return;
    var sid = activeStaff().id;
    if (CLOUD.savedTimer) clearTimeout(CLOUD.savedTimer);
    syncStatus("同期中…", "");
    CLOUD.savedTimer = setTimeout(function () {
      CLOUD.savedTimer = null;
      if (!cloudOn()) return;
      // お客様名（個人情報）はクラウドへ送らない
      var list = JSON.parse(JSON.stringify(savedList));
      list.forEach(function (it) {
        it.custName = "";
        (it.data.patterns || []).forEach(function (pt) { pt.custName = ""; });
      });
      savedDoc(sid).set(stamp({ list: JSON.stringify(list) })).then(cloudOk, cloudNg);
    }, 1000);
  }
  function watchSaved() {
    if (!cloudOn() || !config.activeStaffId) return;
    var sid = activeStaff().id;
    if (CLOUD.unsubSaved && CLOUD.watchingSavedId === sid) return;
    if (CLOUD.unsubSaved) { CLOUD.unsubSaved(); CLOUD.unsubSaved = null; }
    CLOUD.watchingSavedId = sid;
    CLOUD.unsubSaved = savedDoc(sid).onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (!d || !d.list) return;
      if (d.clientId === CLOUD.clientId) return;
      if (CLOUD.savedTimer) return; // 送信待ちのローカル変更がある間は上書きしない
      try {
        var incoming = JSON.parse(d.list) || [];
        // お客様名は同期しないため、この端末に残っている名前を引き継ぐ
        var mine = {};
        savedList.forEach(function (x) { mine[x.id] = x; });
        incoming.forEach(function (x) {
          var old = mine[x.id];
          if (!old) return;
          if (!x.custName && old.custName) x.custName = old.custName;
          var op = (old.data && old.data.patterns) || [];
          ((x.data && x.data.patterns) || []).forEach(function (pt, i) {
            if (!pt.custName && op[i] && op[i].custName) pt.custName = op[i].custName;
          });
        });
        savedList = incoming;
        try { localStorage.setItem(savedKey(sid), JSON.stringify(savedList)); } catch (e2) {}
        renderSaved();
      } catch (e) {}
    }, function () {});
  }

  function applyRemoteStore(d) {
    CLOUD.suppress = true;
    var lostStaff = false;
    try {
      if (typeof d.storeName === "string") config.storeName = d.storeName;
      if (d.staff && d.staff.length) {
        config.staff = d.staff;
        // 選択中の担当が消えていた場合は、担当を選び直してもらう
        // （料金マスタの取り込みはここで止めず、最後まで行う）
        if (!config.staff.some(function (s) { return s.id === config.activeStaffId; })) {
          config.activeStaffId = "";
          lostStaff = true;
        }
      }
      saveConfig();
      if (d.master) {
        try {
          localStorage.setItem(MASTER_KEY, d.master);
          loadMaster();
          renderMasterTab();
          renderPlanSelect(); renderVoiceSelect(); renderMailOpt();
          renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
          renderCampaigns(); renderDiscountHint();
        } catch (e) {}
      }
      renderStoreConfig();
      syncFormFromState();
      recalc();
    } finally { CLOUD.suppress = false; }
    // 担当が確定できない場合だけ選び直し（コード未設定の店舗は先頭の担当で続行）
    if (lostStaff) {
      if (anyStaffCode()) showStaffGate(true);
      else enterStaff(config.staff[0]);
    }
  }
  function applyRemoteQuote(d) {
    if (!d || !d.data) return;
    CLOUD.suppress = true;
    try {
      var incoming = JSON.parse(d.data);
      if (!incoming || !incoming.patterns) return;
      // お客様名は同期しないため、この端末で入力済みの名前を保持する
      for (var i = 0; i < 3; i++) {
        var mine = (store.patterns[i] || {}).custName;
        var pt = incoming.patterns[i] || {};
        if (!pt.custName && mine) pt.custName = mine;
        store.patterns[i] = Object.assign(defaultState(), pt);
      }
      store.active = Math.min(Math.max(incoming.active | 0, 0), 2);
      state = store.patterns[store.active];
      try { localStorage.setItem(quoteKey(), JSON.stringify(store)); } catch (e) {}
      syncFormFromState();
      recalc();
      cloudOk();
    } catch (e) {} finally { CLOUD.suppress = false; }
  }
  function watchStore() {
    if (!cloudOn()) return;
    if (CLOUD.unsubStore) { CLOUD.unsubStore(); CLOUD.unsubStore = null; }
    CLOUD.unsubStore = storeDoc().onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (!d) { pushConfig(); markMasterEdit(); return; } // 初回ログイン → この端末の内容を初期値にする
      if (d.clientId === CLOUD.clientId) { cloudOk(); return; }
      applyRemoteStore(d);
      cloudOk();
    }, function () { syncStatus("同期:接続エラー", "err"); });
  }
  function watchQuote() {
    if (!cloudOn() || !config.activeStaffId) return;
    var sid = activeStaff().id;
    if (CLOUD.unsubQuote && CLOUD.watchingStaffId === sid) return;
    if (CLOUD.unsubQuote) { CLOUD.unsubQuote(); CLOUD.unsubQuote = null; }
    CLOUD.watchingStaffId = sid;
    CLOUD.unsubQuote = quoteDoc(sid).onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (!d) { markLocalEdit(); return; }
      if (d.clientId === CLOUD.clientId) { cloudOk(); return; }
      if (CLOUD.quoteTimer) return; // 送信待ちのローカル編集がある間は上書きしない（後勝ち）
      applyRemoteQuote(d);
    }, function () { syncStatus("同期:接続エラー", "err"); });
  }

  /* ---------- 画面の出し分け（店舗ログイン → 担当者コード → 本体） ---------- */
  function showLogin(show) { var el = $("loginOverlay"); if (el) el.hidden = !show; }
  function showStaffGate(show) {
    var el = $("staffOverlay");
    if (el) el.hidden = !show;
    if (!show) return;
    var f = $("staffCode");
    if (f) { f.value = ""; setTimeout(function () { f.focus(); }, 50); }
    var e2 = $("staffErr"); if (e2) e2.hidden = true;
    // コードを設定していない担当者は、名前を押して入れるようにする
    // （一部の担当者だけコードを付けた場合に、他の担当者が入れなくなるのを防ぐ）
    var free = config.staff.filter(function (s) { return String(s.code || "").trim() === ""; });
    var wrap = $("staffFreeWrap");
    if (wrap) {
      wrap.hidden = !free.length;
      $("staffFreeList").innerHTML = free.map(function (s) {
        return '<button class="btn-sub" type="button" data-staffpick="' + esc(s.id) + '">' + esc(s.name || "担当") + "</button>";
      }).join("");
    }
  }
  // 担当者コードが1つも設定されていない場合は、コード入力を省いて先頭の担当で始める
  function anyStaffCode() {
    return config.staff.some(function (s) { return String(s.code || "").trim() !== ""; });
  }
  /* 担当者コード（またはお名前）で入り直したときは、新しいお客様として最初から始める。
   * 前のお客様の入力が残っていると、そのまま次の接客に持ち込んでしまうため。
   * 見積書に出す店舗名・担当者名だけは、毎回入れ直さずに済むよう引き継ぐ。
   * 作りかけの内容を残したいときは「保存」タブで保存しておく。 */
  function resetQuoteForNewCustomer() {
    var src = store.patterns[store.active] || {};
    var shop = src.shopName || "";
    var staff = src.staffName || "";
    store.active = 0;
    for (var i = 0; i < 3; i++) {
      store.patterns[i] = defaultState();
      store.patterns[i].shopName = shop;
      store.patterns[i].staffName = staff;
    }
    state = store.patterns[0];
    // クラウド利用時はこの内容が送信される。購読を始めた直後に
    // 前の内容で上書きされないよう、watchQuote より先に呼ぶ
    saveState();
  }
  // fresh=true … 担当者コード画面から入ったとき（新しいお客様として始める）
  function enterStaff(s, fresh) {
    config.activeStaffId = s.id;
    saveConfig();
    showStaffGate(false);
    loadState();
    loadSaved();
    renderSaved();
    loadTemplates();
    renderTplBar();
    state = store.patterns[store.active];
    if (fresh) resetQuoteForNewCustomer();
    syncFormFromState();
    renderStaffBar();
    recalc();
    watchQuote();
    watchSaved();
    watchTemplates();
  }
  function renderStaffBar() {
    var el = $("staffBar");
    if (!el) return;
    var s = activeStaff();
    el.textContent = (config.storeName ? config.storeName + " / " : "") + (s.name || "担当");
    el.hidden = false;
  }

  function loginErrorMessage(err) {
    var c = String((err && err.code) || "");
    if (/user-not-found|wrong-password|invalid-credential|invalid-email/.test(c)) return "店舗IDまたはパスワードが正しくありません。";
    if (/too-many-requests/.test(c)) return "試行回数が多すぎます。しばらく時間をおいて再度お試しください。";
    if (/network/.test(c)) return "通信エラーです。ネットワーク環境をご確認ください。";
    return "ログインできませんでした。時間をおいて再度お試しください。";
  }
  // 店舗IDはメールアドレスではないため、内部でログイン用のアドレスに変換する
  function storeIdToEmail(id) {
    id = String(id || "").trim();
    if (!id) return "";
    if (id.indexOf("@") >= 0) return id; // メールアドレスをそのまま入れた場合も受け付ける
    var dom = (typeof KEITAI_STORE_DOMAIN === "string" && KEITAI_STORE_DOMAIN) || "keitai-quote.example";
    return id + "@" + dom;
  }

  function onSignedIn(user) {
    CLOUD.user = user;
    showLogin(false);
    syncStatus("同期中…", "");
    var ai = $("accountInfo");
    if (ai) ai.textContent = "ログイン中の店舗: " + String(user.email || "").replace(/@.*$/, "");
    var lo = $("logoutBtn"); if (lo) lo.hidden = false;
    watchStore();
    // 店舗の担当者一覧を受け取ってから担当者コードを聞く
    storeDoc().get().then(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (d) applyRemoteStore(d);
      afterStoreLogin();
    }, function () {
      afterStoreLogin(); // 取得できなくても端末内の設定で続行する
    });
  }
  function onSignedOut() {
    CLOUD.user = null;
    masterUnlocked = false;
    masterGateFrom = null;
    showMasterGate(false);
    if (CLOUD.unsubStore) { CLOUD.unsubStore(); CLOUD.unsubStore = null; }
    if (CLOUD.unsubQuote) { CLOUD.unsubQuote(); CLOUD.unsubQuote = null; }
    if (CLOUD.unsubSaved) { CLOUD.unsubSaved(); CLOUD.unsubSaved = null; }
    if (CLOUD.unsubTpl) { CLOUD.unsubTpl(); CLOUD.unsubTpl = null; }
    CLOUD.watchingStaffId = null;
    CLOUD.watchingSavedId = null;
    CLOUD.watchingTplId = null;
    syncStatus("", "");
    armIdle(false);
    var lo = $("logoutBtn"); if (lo) lo.hidden = true;
    var sb = $("staffBar"); if (sb) sb.hidden = true;
    // 画面に残った見積書が印刷されないように消す
    var sh1 = $("sheetBody"); if (sh1) sh1.innerHTML = "";
    var sh2 = $("staffSheetBody"); if (sh2) sh2.innerHTML = "";
    showStaffGate(false);
    var si = $("loginStoreId"); if (si) si.value = "";
    var sp = $("loginPass"); if (sp) sp.value = "";
    showLogin(true);
  }

  /* ---------- 自動ログアウト ----------
   * 店頭の共有端末を開いたまま離席したときのために、
   * 操作が1時間途切れたらログイン画面へ戻す。 */
  var IDLE_MS = 60 * 60 * 1000;
  var IDLE = { last: Date.now(), timer: null, armed: false };
  function idleTouch() { IDLE.last = Date.now(); }
  function idleCheck() {
    if (!IDLE.armed) return;
    if (Date.now() - IDLE.last < IDLE_MS) return;
    doLogout(true);
  }
  function armIdle(on) {
    IDLE.armed = !!on;
    IDLE.last = Date.now();
    if (IDLE.timer) { clearInterval(IDLE.timer); IDLE.timer = null; }
    if (on) IDLE.timer = setInterval(idleCheck, 30000);
  }
  function initIdle() {
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, idleTouch, { passive: true });
    });
    // 画面を閉じていた間の経過も見る（iPadのスリープ復帰など）
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) idleCheck();
    });
  }
  // ログアウト（自動・手動の共通処理）
  function doLogout(auto) {
    clearActiveStaff();
    masterUnlocked = false;
    masterGateFrom = null;
    showMasterGate(false);
    switchTab("quote");
    armIdle(false);
    // ロック画面のまま印刷されてもお客様情報が出ないよう、画面の内容を消す
    var sb1 = $("sheetBody"); if (sb1) sb1.innerHTML = "";
    var sb2 = $("staffSheetBody"); if (sb2) sb2.innerHTML = "";
    showStaffGate(false);
    var sb = $("staffBar"); if (sb) sb.hidden = true;
    var si = $("loginStoreId"); if (si) si.value = "";
    var sp = $("loginPass"); if (sp) sp.value = "";
    var le = $("loginErr");
    if (le) {
      if (auto) { le.textContent = "1時間操作がなかったため、自動でログアウトしました。"; le.hidden = false; }
      else le.hidden = true;
    }
    if (CLOUD.enabled && CLOUD.auth) { CLOUD.auth.signOut(); return; }
    showLogin(true);
  }

  // 店舗ログインを通過したあとの共通処理（担当者コードへ進む）
  function afterStoreLogin() {
    showLogin(false);
    var lo = $("logoutBtn");
    if (lo) lo.hidden = !(lockEnabled() || cloudOn());
    armIdle(lockEnabled() || cloudOn());
    if (anyStaffCode()) showStaffGate(true);
    else enterStaff(activeStaff());
  }

  // 店舗ログイン（端末内モード）
  function initLocalLock() {
    $("loginForm").addEventListener("submit", function (e) {
      if (CLOUD.enabled) return; // Firebase設定済みのときはクラウド側の処理が受け持つ
      e.preventDefault();
      var err = $("loginErr");
      err.hidden = true;
      var id = String($("loginStoreId").value || "").trim();
      var pass = $("loginPass").value;
      // 設定したときと同じ方式で照合する（httpとhttpsで方式が変わるのを防ぐ）
      if (config.lock.algo === "sha256" && lockAlgo() !== "sha256") {
        err.textContent = "この環境ではログインを確認できません。設定したときと同じ方法（https）でお開きください。";
        err.hidden = false;
        return;
      }
      lockHash(pass, config.lock.salt, config.lock.algo).then(function (h) {
        if (id !== config.lock.storeId || h !== config.lock.hash) {
          err.textContent = "店舗IDまたはパスワードが正しくありません。";
          err.hidden = false;
          return;
        }
        $("loginPass").value = "";
        afterStoreLogin();
      });
    });
    var lo = $("logoutBtn");
    if (lo) lo.addEventListener("click", function () { doLogout(false); });
  }

  // 担当を確定していない状態にする（購読も解除する）
  function clearActiveStaff() {
    masterUnlocked = false; // 担当が変わったらマスタ設定は開き直しにする
    if (CLOUD.unsubQuote) { CLOUD.unsubQuote(); CLOUD.unsubQuote = null; }
    if (CLOUD.unsubSaved) { CLOUD.unsubSaved(); CLOUD.unsubSaved = null; }
    if (CLOUD.unsubTpl) { CLOUD.unsubTpl(); CLOUD.unsubTpl = null; }
    CLOUD.watchingStaffId = null;
    CLOUD.watchingSavedId = null;
    CLOUD.watchingTplId = null;
    config.activeStaffId = "";
    saveConfig();
  }

  // 担当者コードの入力（クラウドを使わない端末でも動く）
  function initStaffGate() {
    $("staffForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var code = String($("staffCode").value || "").trim();
      var hit = config.staff.filter(function (s) {
        return code !== "" && String(s.code || "").trim() === code;
      })[0];
      if (!hit) {
        var se = $("staffErr");
        se.textContent = "担当者コードが正しくありません。";
        se.hidden = false;
        return;
      }
      enterStaff(hit, true);
    });
    var sw2 = $("switchStaffBtn");
    if (sw2) sw2.addEventListener("click", function () {
      if (!anyStaffCode()) {
        // コード未設定のときは、設定タブで担当者を登録してもらう
        switchTab("master");
        return;
      }
      clearActiveStaff();
      showStaffGate(true);
    });
    // コードを設定していない担当者は名前を押して入る
    var fl = $("staffFreeList");
    if (fl) fl.addEventListener("click", function (e) {
      var id = e.target.getAttribute && e.target.getAttribute("data-staffpick");
      if (!id) return;
      var hit = config.staff.filter(function (s) { return s.id === id; })[0];
      if (hit) enterStaff(hit, true);
    });
    // 設定を開く逃げ道（担当者の登録・コードの変更ができなくなるのを防ぐ）
    var sc = $("staffToSetting");
    if (sc) sc.addEventListener("click", function () {
      if (masterGateOn()) {
        // 担当者を確定させる前にロックを通す。キャンセルしたらコード入力へ戻す
        masterGateFrom = "staff";
        showStaffGate(false);
        showMasterGate(true);
        return;
      }
      showStaffGate(false);
      if (!config.activeStaffId) enterStaff(config.staff[0]);
      switchTab("master");
    });
  }

  function initCloud() {
    // Firebase未設定のときは端末内モード。店舗ログインを設定していればそちらで守る
    var wantCloud = typeof KEITAI_FIREBASE !== "undefined" && !!KEITAI_FIREBASE.projectId;
    var configured = wantCloud && typeof firebase !== "undefined" && firebase.apps && firebase.apps.length;
    // クラウドを使う設定なのに読み込めない（通信不可・CDN遮断など）→ 素通りさせない
    if (wantCloud && !configured) {
      showLogin(true);
      var le0 = $("loginErr");
      if (le0) {
        le0.textContent = "サーバーに接続できないためログインできません。通信環境をご確認ください。";
        le0.hidden = false;
      }
      var lb0 = $("loginBtn"); if (lb0) lb0.disabled = true;
      return;
    }
    if (!configured) {
      // 端末内モード。店舗ログインを設定していればロック画面から始める
      if (lockEnabled()) { showLogin(true); return; }
      showLogin(false);
      afterStoreLogin();
      return;
    }
    try {
      CLOUD.auth = firebase.auth();
      CLOUD.db = firebase.firestore();
    } catch (e) {
      // 端末内ロックを設定していればそちらで守る。無ければそのまま開く
      if (lockEnabled()) { showLogin(true); return; }
      showLogin(false);
      afterStoreLogin();
      return;
    }
    CLOUD.enabled = true;
    // クラウド利用時は店舗アカウントでログインするため、端末内ロックは使わない。
    // 設定が残っていると解除できなくなるので、この時点で消しておく。
    if (lockEnabled()) {
      config.lock = { storeId: "", hash: "", salt: "", algo: "" };
      saveConfig();
    }
    var lb = $("lockBox");
    if (lb) lb.hidden = true;

    $("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("loginErr");
      err.hidden = true;
      $("loginBtn").disabled = true;
      CLOUD.auth.signInWithEmailAndPassword(storeIdToEmail($("loginStoreId").value), $("loginPass").value)
        .then(function () { $("loginPass").value = ""; }, function (e2) {
          err.textContent = loginErrorMessage(e2);
          err.hidden = false;
        })
        .then(function () { $("loginBtn").disabled = false; });
    });
    CLOUD.auth.onAuthStateChanged(function (u) {
      if (u) onSignedIn(u); else onSignedOut();
    });
  }

  /* ---------- ヘルパー ---------- */
  function $(id) { return document.getElementById(id); }
  function yen(v) { return Math.round(v).toLocaleString("ja-JP") + "円"; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // 料金プラン未選択のときに使うダミー（料金0・割引なし）
  var NO_PLAN = { id: "", name: "未選択", group: "", note: "", discounts: {}, tiers: [{ label: "", price: 0 }] };
  function planOf(st) {
    if (!st.planId) return NO_PLAN;
    var p = MASTER.plans.filter(function (x) { return x.id === st.planId; })[0];
    if (!p) {
      // マスタから消えたプランを参照していた場合だけ、同じ世代の先頭に寄せる
      p = MASTER.plans.filter(function (x) { return x.group === st.planGroup; })[0] || MASTER.plans[0];
      st.planId = p.id;
    }
    return p;
  }
  function hasPlan() { return !!state.planId; }
  function currentPlan() { return planOf(state); }
  function jimuFeeFor(proc) {
    if (proc === "plan_only") return 0;
    if (!proc) return 0;   // 未選択のあいだは0円
    if (proc === "shinki") return MASTER.fees.jimu_shinki;
    if (proc === "mnp") return MASTER.fees.jimu_mnp;
    return MASTER.fees.jimu_kishu;
  }
  var CUR_INST_LABEL = "現在の分割支払金（継続中）";
  // ドコモ MAX／ドコモ ポイ活 MAX の「選べる特典」
  // 対象4サービスから毎月2つまで追加料金なし。3つ目以降は通常料金
  var MAX_BONUS_IDS = ["bk_lemino", "bk_danime", "dazn", "nba"];
  var MAX_BONUS_LIMIT = 2;
  var MAX_BONUS_NOTE = "選べる特典";
  function maxBonusPlan(planId) { return planId === "max" || planId === "poikatsu_max"; }
  // 無料にするのは選択中の対象サービスのうち高い方から2つ
  function maxBonusFree(st, planId) {
    var free = {};
    if (!maxBonusPlan(planId)) return free;
    var picked = [];
    MASTER.options.forEach(function (o) {
      if (MAX_BONUS_IDS.indexOf(o.id) < 0 || !st.options[o.id]) return;
      picked.push({ id: o.id, price: optPrice(o, st) });
    });
    picked.sort(function (a, b) { return b.price - a.price; });
    picked.slice(0, MAX_BONUS_LIMIT).forEach(function (x) { free[x.id] = true; });
    return free;
  }
  // ②のネットワークサービス（単品の月額使用料・税込）
  var NET_SVC = [
    { id: "rusuban", name: "留守番電話サービス", short: "留守番電話", price: 330, freeWithKake: true },
    { id: "catchhone", name: "キャッチホン", price: 220, freeWithKake: true },
    { id: "melody", name: "メロディコール", price: 110, canOff: true }
  ];
  // オプションパック（上の3つ＋転送でんわ をまとめると割引。転送でんわは単品でも無料）
  var NET_PACK_PRICE = 440;
  var NET_PACK_NAME = "オプションパック（留守番電話・キャッチホン・メロディコール・転送でんわ）";
  // 新カケホーダイ系の通話オプション。付けると留守番電話・キャッチホンは無料になる
  function kakeVoice(v) { return v === "v5" || v === "kake"; }
  // 選択中のネットワークサービスを、料金を確定させた行にして返す
  function netSvcCalc(st) {
    var free = kakeVoice(st.voice);
    var offs = st.netSvcOff || {};
    var picked = NET_SVC.filter(function (n) { return (st.netSvc || {})[n.id] && !offs[n.id]; });
    var offRows = NET_SVC.filter(function (n) { return n.canOff && offs[n.id]; });
    var rows = [], total = 0;
    if (!free && picked.length === NET_SVC.length) {
      rows.push({ name: NET_PACK_NAME, price: NET_PACK_PRICE });
      total = NET_PACK_PRICE;
    } else {
      picked.forEach(function (n) {
        var f = free && n.freeWithKake;
        rows.push({ name: n.name + (f ? "（通話オプションに込み）" : ""), base: n.short || n.name, incl: !!f, price: f ? 0 : n.price });
        total += f ? 0 : n.price;
      });
    }
    return { rows: rows, total: total, off: offRows,
      pack: rows.length === 1 && rows[0].name === NET_PACK_NAME };
  }
  // 頭金・事務手数料を自動で入れるのは新規契約・機種変更のときだけ（未選択は0円）
  function autoFeeProc(proc) { return proc === "shinki" || proc === "kishu"; }
  // 手続き種別の表示名（未選択のときは空欄と分かる表記にする）
  var PROC_NAME = { shinki: "新規契約", mnp: "のりかえ（MNP）", kishu: "機種変更", plan_only: "プラン変更" };
  function procName(v) { return PROC_NAME[v] || "未選択"; }
  // 申し込みの種類（引き継ぎシートの表記）
  var DCARD_TYPE = { normal: "dカード", goldu: "dカード GOLD U", gold: "dカード GOLD", platinum: "dカード PLATINUM" };
  var DENKI_TYPE = { basic: "ドコモでんき Basic", green: "ドコモでんき Green" };
  // 関西圏のため「ドコモ ガス Supplied by 大阪ガス」の料金メニューのみ
  var GAS_AREA = "ドコモガス（大阪ガス）";
  var GAS_TYPE = {
    ippan: "一般料金", ippanS: "一般料金S", matome: "まとめトク料金",
    attame: "あっためトク料金", smart: "スマート発電料金", house: "ハウス空調料金",
    kaji: "家事トク料金", motto: "もっと割料金", yukadan: "床暖料金",
    myhome: "マイホーム発電料金"
  };
  // ガスの割引オプション（大阪ガスエリア）
  // 出典: https://denki.docomo.ne.jp/assets_brand/pdf/gas/discount_terms.pdf
  var GAS_DISC_EQUIP = [
    { id: "conro", name: "ガスコンロ", rate: 2 },
    { id: "bath", name: "ガス温水浴室暖房乾燥機", rate: 5 },
    { id: "bathmist", name: "ガス温水浴室暖房乾燥機（ミスト機能付）", rate: 7 }
  ];
  var GAS_DISCOUNT = {
    attame: [
      { id: "bath", name: "ガス温水浴室暖房乾燥機", rate: 4 },
      { id: "denki", name: "電気", rate: 3 },
      { id: "hosho", name: "ガス機器保証サービス等", rate: 2 }
    ],
    smart: [
      { id: "yukabath", name: "床暖房およびガス温水浴室暖房乾燥機", rate: 4 },
      { id: "solar", name: "太陽光発電", rate: 3 },
      { id: "battery", name: "蓄電池またはV2H", rate: 3 },
      { id: "kaitori", name: "余剰電力買取", rate: 2 }
    ],
    house: GAS_DISC_EQUIP,
    yukadan: GAS_DISC_EQUIP,
    myhome: GAS_DISC_EQUIP,
    kaji: [
      { id: "denki", name: "電気", rate: 3 },
      { id: "hosho", name: "ガス機器保証サービス等", rate: 2 }
    ],
    motto: [
      { id: "denki", name: "電気", rate: 3 }
    ]
  };
  // 割引対象を最大3つ・合計9%までに制限する料金メニュー（PDF ※2）
  var GAS_DISC_CAPPED = { smart: true, house: true, yukadan: true, myhome: true };
  function gasDiscountList() { return GAS_DISCOUNT[state.todoGasType] || []; }
  function gasDiscountPicked() {
    var picked = state.todoGasDiscount || {};
    return gasDiscountList().filter(function (d) { return picked[d.id]; });
  }
  function gasDiscountRate() {
    var r = 0;
    gasDiscountPicked().forEach(function (d) { r += d.rate; });
    return GAS_DISC_CAPPED[state.todoGasType] ? Math.min(r, 9) : r;
  }
  // 手続き内容のチェックから手続き種別を決める（複数選択時の優先順）
  var PROC_ORDER = [["mnp", "mnp"], ["shinki", "shinki"], ["kishu", "kishu"], ["plan", "plan_only"]];
  function procTypeFromTodo() {
    var t = state.procTodo || {};
    for (var i = 0; i < PROC_ORDER.length; i++) if (t[PROC_ORDER[i][0]]) return PROC_ORDER[i][1];
    return state.procType;
  }
  // 手続き種別を切り替え、頭金・事務手数料の自動判定もあわせて行う
  function applyProcType(v) {
    state.procType = v;
    state.jimuFee = autoFeeProc(v) ? jimuFeeFor(v) : 0;
    state.atamakin = autoFeeProc(v) ? MASTER.fees.atamakin_default : 0;
    $("procType").value = v;
    $("jimuFee").value = state.jimuFee;
    $("atamakin").value = state.atamakin;
  }
  // GOLD系カード（お支払割はGOLD区分・還元特典の自動計算対象）
  function isGoldCard(c) { return c === "goldu" || c === "gold" || c === "platinum"; }
  // 還元特典の自動計算: 対象額 税込1,100円ごとのpt（GOLD U 5%／GOLD 10%／PLATINUM 20%）
  function dcardRatePt(c) { return c === "platinum" ? 200 : c === "gold" ? 100 : c === "goldu" ? 50 : 0; }
  function optPrice(o, st) {
    if (o.priceChoices && st.optionPrices[o.id] != null
        && o.priceChoices.indexOf(st.optionPrices[o.id]) >= 0) return st.optionPrices[o.id];
    return o.price;
  }
  function voicePriceFor(plan, vo) {
    var p = vo.price;
    if (plan.voiceOverrides && plan.voiceOverrides[vo.id] != null) p = plan.voiceOverrides[vo.id];
    if (plan.includes5min && vo.id === "v5") p = 0;
    return p;
  }

  /* ---------- 計算エンジン ---------- */
  function calcFor(st) {
    var plan = planOf(st);
    var tierIdx = Math.min(st.tierIdx, plan.tiers.length - 1);
    var tier = plan.tiers[tierIdx];

    // 割引（段階ごとの上書き dOverride を反映）
    var d = Object.assign({}, plan.discounts, tier.dOverride || {});
    var dMinna = st.minna === "2" ? (d.minna2 || 0)
               : st.minna === "3" ? (d.minna3 || 0) : 0;
    var dSet = st.dSet ? (d.set || 0) : 0;
    var dCard = st.dCard === "normal" ? (d.dcard || 0)
              : isGoldCard(st.dCard) ? (d.dcardGold || 0) : 0;
    var dDenki = st.dDenki ? (d.denki || 0) : 0;
    var dChoki = st.choki === "y10" ? (d.choki10 || 0)
               : st.choki === "y20" ? (d.choki20 || 0) : 0;
    var planMonthly = Math.max(0, tier.price - dMinna - dSet - dCard - dDenki - dChoki);

    // 通話オプション
    var vo = MASTER.voiceOptions.filter(function (v) { return v.id === st.voice; })[0]
             || MASTER.voiceOptions[0];
    var voicePrice = voicePriceFor(plan, vo);
    var voiceNote = (plan.includes5min && vo.id === "v5") ? "（プランに標準込み）" : "";

    // オプション・サービス（すべて月額・金額選択対応）
    var optRows = [], optTotal = 0, bonusRows = [];
    var bonusFree = maxBonusFree(st, plan.id);
    MASTER.options.forEach(function (o) {
      if (!st.options[o.id]) return;
      var pr = optPrice(o, st);
      var lb = o.priceLabels && o.priceLabels[String(pr)];
      if (bonusFree[o.id]) {
        // 行は見積書で料金プランの直後にまとめるため optRows とは分けて返す
        bonusRows.push({ name: o.name + "（" + MAX_BONUS_NOTE + "）", base: o.name.replace("（爆アゲ）", ""), price: 0 });
        return;
      }
      optRows.push({ name: o.name + (lb ? "（" + lb + "）" : ""), price: pr });
      optTotal += pr;
    });

    // ②のネットワークサービス（ドコモの利用料金なので還元の対象額にも含める）
    // 行は見積書で通話オプションの直後に出すため optRows とは分けて返す
    var net = netSvcCalc(st);
    optTotal += net.total;

    // 月額の追加項目（ずっと／期間限定）
    var adhocPerm = 0, adhocLimited = [];
    st.adhocMonthly.forEach(function (a) {
      if (!a.name && !a.amount) return;
      if (num(a.months) > 0) adhocLimited.push({ name: a.name, amount: num(a.amount), months: Math.round(num(a.months)) });
      else adhocPerm += num(a.amount);
    });

    // 見直し前から支払い中の分割金（料金見直しの案内用）
    var curInst = num(st.currentInst);
    if (curInst > 0) {
      var curInstMonths = Math.round(num(st.currentInstMonths));
      if (curInstMonths > 0) adhocLimited.push({ name: CUR_INST_LABEL, amount: curInst, months: curInstMonths });
      else adhocPerm += curInst;
    }

    // キャンペーン割引（期間限定・対象プランのみ。セグメント計算に合流）
    var campaignRows = [];
    (MASTER.campaigns || []).forEach(function (c) {
      if (!st.campaigns[c.id]) return;
      if (c.plans && c.plans.length && c.plans.indexOf(plan.id) < 0) return;
      var choices = c.amountChoices || [];
      if (!choices.length) return;
      var amt = choices[0].a;
      if (choices.length > 1 && st.campaignAmounts[c.id] != null
          && choices.some(function (ch) { return ch.a === st.campaignAmounts[c.id]; })) {
        amt = st.campaignAmounts[c.id];
      }
      var months = Math.max(1, Math.round(num(c.months)));
      campaignRows.push({ name: c.name, amount: amt, months: months });
      adhocLimited.push({ name: c.name, amount: -amt, months: months });
    });

    // 端末
    var device = { monthly: 0, months: 0, after: 0, firstExtra: 0, kaedoki: false, zanka: 0, total23: 0, kaedokiFee: 0, jisshitsu: 0, total: 0, atama: 0 };
    var initialDevice = 0;
    var deviceTotal = num(st.devicePrice);          // 端末代金総額（頭金を含む）
    var deviceAtama = Math.max(0, num(st.atamakin));
    // 一括は総額をそのまま店頭でお支払い。分割は総額から頭金を引いた残りを分ける
    var p = st.payMethod === "ikkatsu" ? deviceTotal : Math.max(0, deviceTotal - deviceAtama);
    device.total = deviceTotal;
    device.atama = deviceAtama;
    if (st.payMethod === "ikkatsu") {
      initialDevice = p;
    } else if (/^b\d+$/.test(st.payMethod)) {
      var n = parseInt(st.payMethod.slice(1), 10);
      if (p > 0) {
        device.monthly = Math.floor(p / n);
        device.months = n;
        device.firstExtra = p - device.monthly * n;
      }
    } else if (st.payMethod === "kaedoki") {
      // 入力は「23回分の総額（頭金込み）」。残価は 端末代金総額 − その額 で決まる
      var t23 = Math.min(Math.max(0, num(st.kaedoki23)), deviceTotal);
      var split23 = Math.max(0, t23 - deviceAtama);   // 23回で分割する金額
      var z = Math.max(0, deviceTotal - t23);          // 残価（24回目支払分）
      if (deviceTotal > 0) {
        device.kaedoki = true;
        device.monthly = Math.floor(split23 / 23);
        device.months = 23;
        device.firstExtra = split23 - device.monthly * 23;
        device.after = z > 0 ? Math.floor(z / 24) : 0;
        device.zanka = z;
        device.total23 = t23;
        device.kaedokiFee = num(st.kaedokiFee);
        // 23回分の総額には頭金が含まれているので、そのまま実質負担になる
        device.jisshitsu = t23 + device.kaedokiFee;
      }
    }

    // アクセサリ（一括／分割）
    var accOnceRows = [], accMonthlyRows = [], accFirstExtra = 0;
    st.accessories.forEach(function (a) {
      var ap = num(a.price);
      if (!a.name && !ap) return;
      if (a.pay === "once" || !/^b\d+$/.test(a.pay || "")) {
        accOnceRows.push({ name: a.name || "アクセサリ", amount: ap });
      } else {
        var an = parseInt(a.pay.slice(1), 10);
        var am = Math.floor(ap / an);
        accMonthlyRows.push({ name: a.name || "アクセサリ", monthly: am, months: an });
        accFirstExtra += ap - am * an;
      }
    });
    (MASTER.accessories || []).forEach(function (a) {
      var pay = st.accSel[a.id];
      if (!pay) return;
      if (/^b\d+$/.test(pay)) {
        var an2 = parseInt(pay.slice(1), 10);
        var am2 = Math.floor(a.price / an2);
        accMonthlyRows.push({ name: a.name, monthly: am2, months: an2 });
        accFirstExtra += a.price - am2 * an2;
      } else {
        accOnceRows.push({ name: a.name, amount: a.price });
      }
    });

    // dカード還元特典の自動計算
    // 対象＝プラン基本料＋通話オプション＋対象（carrier）オプションのみ。
    // 税込1,100円ごとに GOLD U 50pt／GOLD 100pt／PLATINUM 200pt
    var dcardGoldBase = tier.price + voicePrice + net.total;
    MASTER.options.forEach(function (o) {
      if (!st.options[o.id] || !o.carrier) return;
      if (bonusFree[o.id]) return;   // 選べる特典で0円のものは支払いが無いため対象外
      dcardGoldBase += optPrice(o, st);
    });
    // 対象外プラン（ドコモmini・ahamo・irumoなど dcard10:false）は還元なし
    var dcardAutoPt = plan.dcard10 === false ? 0 : Math.floor(dcardGoldBase / 1100) * dcardRatePt(st.dCard);

    // ポイント自動充当（実質額の案内用・入力pt=円で月額から差引）
    // dカード還元は入力欄の値をそのまま使う（GOLD選択時は自動計算値が初期セットされるが編集可）
    var ptPoikatsu = Math.max(0, num(st.pointPoikatsu));
    var ptFamily = Math.max(0, num(st.pointPoikatsuFamily));
    var ptDcard = (isGoldCard(st.dCard) && st.dcardGoldAuto === false)
      ? 0
      : Math.max(0, num(st.pointDcard));
    var pointRows = [];
    if (ptPoikatsu > 0) pointRows.push({ name: "ポイント充当（ポイ活プラン還元）", amount: ptPoikatsu });
    if (ptFamily > 0) pointRows.push({ name: "ポイント充当（ポイ活ファミリー特典）", amount: ptFamily });
    if (ptDcard > 0) pointRows.push({ name: "ポイント充当（dカード還元特典）", amount: ptDcard });

    // 月額（恒久部分）
    var baseMonthly = planMonthly + voicePrice + optTotal + adhocPerm - ptPoikatsu - ptFamily - ptDcard;

    // --- 期間セグメント（端末・アクセサリ分割・期間限定項目の切れ目で分割） ---
    var boundarySet = {};
    if (device.months > 0) boundarySet[device.months] = 1;
    accMonthlyRows.forEach(function (a) { boundarySet[a.months] = 1; });
    adhocLimited.forEach(function (a) { boundarySet[a.months] = 1; });
    var boundaries = Object.keys(boundarySet).map(Number).filter(function (b) { return b > 0; }).sort(function (a, b) { return a - b; });

    var segs = [];
    var from = 1;
    boundaries.concat([Infinity]).forEach(function (to) {
      if (to !== Infinity && to < from) return;
      var m = baseMonthly;
      if (device.months >= from) m += device.monthly;
      accMonthlyRows.forEach(function (a) { if (a.months >= from) m += a.monthly; });
      adhocLimited.forEach(function (a) { if (a.months >= from) m += a.amount; });
      var seg = { from: from, to: to, monthly: Math.max(0, m) };
      if (device.kaedoki && from > device.months) seg.monthlyKeep = Math.max(0, m + device.after); // 返却しない場合
      segs.push(seg);
      from = to + 1;
    });

    var firstExtra = device.firstExtra + accFirstExtra;

    // 初期費用
    var atama = Math.max(0, num(st.atamakin));
    // where: "store"=店頭お支払い / "bill"=翌月の携帯料金と合算
    var initialRows = [];
    if (num(st.jimuFee) > 0) initialRows.push({ name: "契約事務手数料", amount: num(st.jimuFee), where: "bill" });
    if (initialDevice > 0) {
      // 一括購入時は頭金も総額に含まれているため、「店頭頭金」の行は出さず1行で表示
      initialRows.push({ name: "機種代金（一括）", amount: initialDevice, where: "store" });
    } else if (atama > 0) {
      initialRows.push({ name: "店頭頭金", amount: atama, where: "store" });
    }
    (MASTER.feeItems || []).forEach(function (f) {
      if (st.feeItems[f.id]) initialRows.push({ name: f.name, amount: f.price, where: f.pay === "bill" ? "bill" : "store" });
    });
    accOnceRows.forEach(function (a) {
      initialRows.push({ name: a.name + "（アクセサリ・一括）", amount: a.amount, where: "store" });
    });
    st.adhocInitial.forEach(function (a) {
      if (a.name || a.amount) initialRows.push({ name: a.name || "その他", amount: num(a.amount), where: "store" });
    });
    var initialTotal = initialRows.reduce(function (s, r) { return s + r.amount; }, 0);
    var storeRows = initialRows.filter(function (r) { return r.where === "store"; });
    var billRows = initialRows.filter(function (r) { return r.where === "bill"; });
    var storeTotal = storeRows.reduce(function (s, r) { return s + r.amount; }, 0);
    var billTotal = billRows.reduce(function (s, r) { return s + r.amount; }, 0);

    return {
      plan: plan, tier: tier, tierIdx: tierIdx,
      dMinna: dMinna, dSet: dSet, dCard: dCard, dDenki: dDenki, dChoki: dChoki,
      planMonthly: planMonthly,
      voice: vo, voicePrice: voicePrice, voiceNote: voiceNote,
      optRows: optRows, optTotal: optTotal, netRows: net.rows, bonusRows: bonusRows,
      adhocPerm: adhocPerm, adhocLimited: adhocLimited, campaignRows: campaignRows, pointRows: pointRows,
      dcardAutoPt: dcardAutoPt, dcardGoldBase: dcardGoldBase,
      accMonthlyRows: accMonthlyRows, accOnceRows: accOnceRows,
      device: device, baseMonthly: baseMonthly,
      segs: segs, firstExtra: firstExtra,
      initialRows: initialRows, initialTotal: initialTotal,
      storeRows: storeRows, billRows: billRows, storeTotal: storeTotal, billTotal: billTotal,
    };
  }
  function calc() { return calcFor(state); }

  // ポイ活プラン選択時の還元ポイント初期値（ポイ活20は上限2,500pt）
  function poikatsuDefaultPt(planId) {
    if (planId === "poikatsu_20") return 2500;
    return /poikatsu/.test(planId || "") ? 5000 : 0;
  }
  // プラン切替時に初期値を自動セット（手入力した値は上書きしない）
  function syncPoikatsuDefault(prevPlanId) {
    var cur = num(state.pointPoikatsu);
    if (cur && cur !== poikatsuDefaultPt(prevPlanId)) return;
    state.pointPoikatsu = poikatsuDefaultPt(state.planId);
    $("ptPoikatsu").value = state.pointPoikatsu || "";
  }
  function isPatternUsed(st) {
    var d = defaultState();
    var keys = ["minna", "dSet", "dCard", "dDenki", "choki", "voice", "devicePrice", "payMethod", "tierIdx", "planGroup", "deviceName", "custName", "pointPoikatsu", "pointPoikatsuFamily", "pointDcard"];
    if (keys.some(function (k) { return st[k] !== d[k]; })) return true;
    function anyOn(map) { return Object.keys(map || {}).some(function (k) { return map[k]; }); }
    if (anyOn(st.options) || anyOn(st.feeItems) || anyOn(st.accSel)) return true;
    return !!(st.adhocMonthly.length || st.adhocInitial.length || st.accessories.length);
  }
  function segLabel(seg) {
    if (seg.from === 1 && seg.to === Infinity) return "";
    if (seg.to === Infinity) return seg.from + "か月目以降";
    return (seg.from === 1 ? "〜" : seg.from + "〜") + seg.to + "か月目";
  }

  /* ---------- 見積もりフォーム描画 ---------- */
  var tplSaveMode = false;
  function renderTplBar() {
    document.querySelectorAll(".tpl").forEach(function (b) {
      var t = templates[+b.dataset.tpl];
      b.textContent = t ? t.name : "未設定";
      b.classList.toggle("filled", !!t);
      b.classList.toggle("empty", !t);
    });
    var bar = document.querySelector(".tpl").closest(".pattern-bar");
    bar.classList.toggle("tpl-saving", tplSaveMode);
    closeTplMenu();
    $("saveTplBtn").textContent = tplSaveMode ? "保存先のテンプレボタンをタップ（ここを押すとキャンセル）" : "現在の内容をテンプレに保存";
  }
  function tplSnapshot() {
    var snap = JSON.parse(JSON.stringify(state));
    delete snap.custName; delete snap.shopName; delete snap.staffName;
    return snap;
  }
  function tplApply(i) {
    var t = templates[i];
    if (!t) { tplMsg("テンプレ" + (i + 1) + "は未設定です。「現在の内容をテンプレに保存」から登録してください"); return; }
    var keep = { custName: state.custName, shopName: state.shopName, staffName: state.staffName };
    store.patterns[store.active] = Object.assign(defaultState(), JSON.parse(JSON.stringify(t.state)), keep);
    state = store.patterns[store.active];
    syncFormFromState();
    recalc();
  }
  /* テンプレートの長押し削除
   * 長押し（またはPCの右クリック）で、そのテンプレートを消すかどうかを聞く。
   * 長押しのあとに click が続けて発生するため、直後の1回は無視する。 */
  var tplHold = { timer: null, fired: false, slot: -1 };
  function closeTplMenu() {
    var m = $("tplMenu");
    if (m) m.hidden = true;
    tplHold.slot = -1;
  }
  function openTplMenu(i, btn) {
    var t = templates[i];
    if (!t) return;                      // 未設定の枠では出さない
    if (tplSaveMode) return;             // 保存先を選んでいる最中は出さない
    tplHold.slot = i;
    var m = $("tplMenu");
    $("tplMenuName").textContent = t.name;
    m.hidden = false;
    // ボタンのすぐ下に出す（画面からはみ出さないように寄せる）
    var r = btn.getBoundingClientRect();
    var w = m.offsetWidth || 200;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    m.style.left = left + "px";
    m.style.top = (r.bottom + 6) + "px";
  }
  function initTplHold() {
    document.querySelectorAll(".tpl").forEach(function (b) {
      var i = +b.dataset.tpl;
      function start(e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        tplHold.fired = false;
        clearTimeout(tplHold.timer);
        tplHold.timer = setTimeout(function () {
          tplHold.fired = true;
          openTplMenu(i, b);
        }, 550);
      }
      function cancel() { clearTimeout(tplHold.timer); }
      b.addEventListener("pointerdown", start);
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
        b.addEventListener(ev, cancel);
      });
      // PCは右クリックでも出せるようにする
      b.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        tplHold.fired = true;
        openTplMenu(i, b);
      });
    });
    $("tplMenuDel").addEventListener("click", function () {
      var i = tplHold.slot;
      if (i < 0 || !templates[i]) { closeTplMenu(); return; }
      var nm = templates[i].name;
      templates[i] = null;
      persistTemplates();
      renderTplBar();
      closeTplMenu();
      tplMsg("「" + nm + "」を削除しました");
    });
    $("tplMenuCancel").addEventListener("click", closeTplMenu);
    // ほかの場所を触ったら閉じる
    document.addEventListener("pointerdown", function (e) {
      var m = $("tplMenu");
      if (!m || m.hidden) return;
      if (m.contains(e.target) || (e.target.classList && e.target.classList.contains("tpl"))) return;
      closeTplMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeTplMenu();
    });
  }

  var tplPendingSlot = null;
  function tplMsg(text) {
    $("tplMsg").textContent = text;
    if (text) setTimeout(function () { if ($("tplMsg").textContent === text) $("tplMsg").textContent = ""; }, 4000);
  }
  function tplSave(i) {
    // iPadのホーム画面起動(PWA)ではprompt()が使えないため、画面内の入力欄で名前を付ける
    var plan = currentPlan();
    var procLabel = { shinki: "新規", mnp: "MNP", kishu: "機種変更", plan_only: "プラン変更" }[state.procType] || "";
    var cur = templates[i];
    tplPendingSlot = i;
    $("tplNameInput").value = cur ? cur.name
      : ((state.planId ? plan.name + " " : "") + procLabel).trim().slice(0, 20);
    $("tplNameBox").hidden = false;
    $("saveTplBtn").hidden = true;
    tplMsg("");
    $("tplNameInput").focus();
  }
  function tplSaveDone(ok) {
    if (ok && tplPendingSlot != null) {
      var name = $("tplNameInput").value.trim() || ("テンプレ" + (tplPendingSlot + 1));
      templates[tplPendingSlot] = { name: name.slice(0, 20), state: tplSnapshot() };
      persistTemplates();
      tplMsg("「" + name.slice(0, 20) + "」を保存しました");
    }
    tplPendingSlot = null;
    tplSaveMode = false;
    $("tplNameBox").hidden = true;
    $("saveTplBtn").hidden = false;
    renderTplBar();
  }
  function renderPatternTabs() {
    document.querySelectorAll(".pat").forEach(function (b) {
      var i = +b.dataset.pat;
      b.classList.toggle("active", i === store.active);
      var st = store.patterns[i];
      var filled = i !== store.active && (st.devicePrice > 0 || st.planId !== "" && JSON.stringify(st) !== JSON.stringify(Object.assign(defaultState(), { planId: st.planId, jimuFee: st.jimuFee, atamakin: st.atamakin })));
      b.classList.toggle("filled", !!filled);
    });
  }
  function renderPlanSelect() {
    var sel = $("planId");
    var opts = MASTER.plans.filter(function (pl) { return pl.group === state.planGroup; });
    sel.innerHTML = '<option value="">（未選択）</option>' + opts.map(function (pl) {
      return '<option value="' + esc(pl.id) + '">' + esc(pl.name) + "</option>";
    }).join("");
    // 世代を切り替えて選択中のプランが無くなったときは未選択へ戻す
    if (state.planId && !opts.some(function (pl) { return pl.id === state.planId; })) {
      state.planId = "";
    }
    sel.value = state.planId;
    renderTierSelect();
  }
  function renderTierSelect() {
    var plan = currentPlan();
    var f = $("tierField"), sel = $("tierIdx");
    if (plan.tiers.length > 1) {
      f.hidden = false;
      sel.innerHTML = plan.tiers.map(function (t, i) {
        return '<option value="' + i + '">' + esc(t.label) + "（" + yen(t.price) + "）</option>";
      }).join("");
      if (state.tierIdx >= plan.tiers.length) state.tierIdx = 0;
      sel.value = String(state.tierIdx);
    } else {
      f.hidden = true;
      state.tierIdx = 0;
    }
    $("planNote").textContent = plan.note || "";
  }
  // ネットワークサービスの選択欄（通話オプションで金額が変わるので描き直す）
  function renderNetSvc() {
    var free = kakeVoice(state.voice);
    var picked = state.netSvc || {};
    var offs = state.netSvcOff || {};
    var all = NET_SVC.every(function (n) { return picked[n.id] && !offs[n.id]; });
    $("netSvcList").innerHTML = NET_SVC.map(function (n) {
      var f = free && n.freeWithKake;
      // 廃止のときは「廃止」の文字が重ならないよう、元の金額に取り消し線を引く
      var pr = offs[n.id] ? '<span style="text-decoration:line-through;opacity:.5">' + yen(n.price) + "/月</span>"
        : f ? "無料（通話オプションに込み）"
        : (!free && all ? "パック適用" : yen(n.price) + "/月");
      var h = '<div class="opt-row"><label class="check"><input type="checkbox" data-netsvc="' + n.id + '"'
        + (picked[n.id] && !offs[n.id] ? " checked" : "") + "> " + esc(n.name) + "</label>";
      if (n.canOff) {
        h += '<label class="check net-off"><input type="checkbox" data-netsvcoff="' + n.id + '"'
          + (offs[n.id] ? " checked" : "") + "> 廃止</label>";
      }
      return h + '<span class="price">' + pr + "</span></div>";
    }).join("");
    var net = netSvcCalc(state);
    var msg;
    if (free) {
      msg = "通話オプション（880円／1,980円）を付けているため、留守番電話・キャッチホンは無料です。";
      if (picked.melody && !offs.melody) msg += "メロディコールは110円/月かかります。";
    } else if (net.pack) {
      msg = "3つまとめて " + yen(NET_PACK_PRICE) + "/月（オプションパック。単品合計660円のところ220円おトク）。転送でんわも無料で付けられます。";
    } else {
      msg = "3つすべて選ぶとオプションパックで " + yen(NET_PACK_PRICE) + "/月（単品合計660円）になります。";
    }
    $("netSvcHint").textContent = msg;
  }
  function renderVoiceSelect() {
    renderNetSvc();
    var plan = currentPlan();
    $("voice").innerHTML = MASTER.voiceOptions.map(function (v) {
      var pr = voicePriceFor(plan, v);
      var label = v.name;
      if (v.id !== "none") {
        label += pr === 0 ? "（プランに込み）" : "（" + yen(pr) + "）";
      }
      return '<option value="' + esc(v.id) + '">' + esc(label) + "</option>";
    }).join("");
    $("voice").value = state.voice;
  }
  function mailOptDef() {
    return MASTER.options.filter(function (o) {
      return o.id === "docomomail" || (o.name || "").indexOf("ドコモメール") >= 0;
    })[0];
  }
  function renderMailOpt() {
    var mo = mailOptDef();
    var sel = $("mailOpt");
    if (!mo) { sel.disabled = true; $("mailHint").textContent = "マスタに「ドコモメールオプション」がありません。"; return; }
    sel.disabled = false;
    sel.value = state.options[mo.id] ? "yes" : "no";
    sel.options[1].textContent = "有り（" + yen(mo.price) + "/月）";
    $("mailHint").textContent = "MAX・mini等のキャリアプランはドコモメール標準込み（無しのままでOK）。ahamo・irumoは有料オプション。";
  }
  function tileHtml(attr, id, name, on, priceHtml, extraClass) {
    return '<div class="tile' + (on ? " on" : "") + (extraClass ? " " + extraClass : "")
      + '" role="checkbox" aria-checked="' + (on ? "true" : "false")
      + '" tabindex="0" ' + attr + '="' + esc(id) + '">'
      + '<span class="t-name">' + esc(name) + "</span>"
      + priceHtml
      + "</div>";
  }
  function renderOptionList() {
    // カテゴリ（フォルダ）ごとに横5列のタイルで表示
    var h = "";
    OPT_CATEGORIES.forEach(function (cat) {
      var mailDef = mailOptDef();
      var items = MASTER.options.filter(function (o) {
        if (mailDef && o.id === mailDef.id) return false; // ②で選択するため除外
        return (o.category || "その他") === cat;
      });
      if (!items.length) return;
      h += '<div class="opt-cat">' + esc(cat) + "</div>";
      var bonusFree = maxBonusFree(state, currentPlan().id);
      var bonusTarget = maxBonusPlan(currentPlan().id);
      h += '<div class="tile-grid">' + items.map(function (o) {
        var on = !!state.options[o.id];
        var priceHtml;
        if (bonusFree[o.id]) {
          priceHtml = '<span class="t-price t-bonus">' + esc(MAX_BONUS_NOTE) + " 0円/月</span>";
        } else if (bonusTarget && MAX_BONUS_IDS.indexOf(o.id) >= 0) {
          priceHtml = '<span class="t-price">' + yen(optPrice(o, state)) + "/月"
            + (on ? "<br><small>3つ目以降は有料</small>" : "<br><small>" + esc(MAX_BONUS_NOTE) + "の対象</small>") + "</span>";
        } else if (o.priceChoices && o.priceChoices.length) {
          var cur = optPrice(o, state);
          priceHtml = '<select data-optprice="' + esc(o.id) + '">'
            + o.priceChoices.map(function (c) {
                var lb = o.priceLabels && o.priceLabels[String(c)] ? esc(o.priceLabels[String(c)]) + " " : "";
                return '<option value="' + c + '"' + (c === cur ? " selected" : "") + ">" + lb + yen(c) + "/月</option>";
              }).join("") + "</select>";
        } else {
          priceHtml = '<span class="t-price">' + yen(o.price) + "/月</span>";
        }
        // 区分（新規／継続／廃止）は、対象にしているオプションだけに表示する
        var kb = state.optionKubun[o.id] || (on ? "new" : "");
        var isOff = kb === "off";
        var kubunHtml = (on || isOff)
          ? '<span class="t-kubun">'
            + [["new", "新規"], ["keep", "継続"], ["off", "廃止"]].map(function (k) {
                return '<label class="kb' + (kb === k[0] ? " on" : "") + '">'
                  + '<input type="checkbox" data-optkubun="' + esc(o.id) + '" value="' + k[0] + '"'
                  + (kb === k[0] ? " checked" : "") + "> " + k[1] + "</label>";
              }).join("") + "</span>"
          : "";
        return tileHtml("data-opt", o.id, o.name, on, priceHtml + kubunHtml, isOff ? "kubun-off" : "");
      }).join("") + "</div>";
    });
    $("optionList").innerHTML = h;
  }
  function renderFeeItemList() {
    var list = MASTER.feeItems || [];
    $("feeItemList").innerHTML = '<div class="tile-grid">' + list.map(function (f) {
      return tileHtml("data-fee", f.id, f.name + (f.pay === "bill" ? "（翌月合算）" : ""), !!state.feeItems[f.id],
        '<span class="t-price">' + yen(f.price) + "</span>");
    }).join("") + "</div>";
  }
  function renderAccessoryTiles() {
    var list = MASTER.accessories || [];
    if (!list.length) { $("accTileList").innerHTML = ""; return; }
    $("accTileList").innerHTML = '<div class="tile-grid">' + list.map(function (a) {
      var pay = state.accSel[a.id];
      var on = !!pay;
      var body;
      if (on) {
        body = '<select data-acsel="' + esc(a.id) + '">'
          + [["once", "一括"], ["b12", "分割12回"], ["b24", "分割24回"], ["b36", "分割36回"]].map(function (p) {
              return '<option value="' + p[0] + '"' + (pay === p[0] ? " selected" : "") + ">" + p[1] + "</option>";
            }).join("") + "</select>";
      } else {
        body = '<span class="t-price">' + yen(a.price) + "</span>";
      }
      return '<div class="tile' + (on ? " on" : "") + '" role="checkbox" aria-checked="' + (on ? "true" : "false")
        + '" tabindex="0" data-acc="' + esc(a.id) + '">'
        + '<span class="t-name">' + esc(a.name) + (on ? "<br>" + yen(a.price) : "") + "</span>"
        + body + "</div>";
    }).join("") + "</div>";
  }
  function renderAccessories() {
    $("accessoryList").innerHTML = state.accessories.map(function (a, i) {
      function opt(v, label) {
        return '<option value="' + v + '"' + ((a.pay || "once") === v ? " selected" : "") + ">" + label + "</option>";
      }
      return '<div class="adhoc-row">'
        + '<input type="text" placeholder="品名（例: ケース）" value="' + esc(a.name || "") + '" data-ac-name="' + i + '">'
        + '<input type="number" placeholder="価格(円)" value="' + (a.price || "") + '" data-ac-price="' + i + '">'
        + '<select data-ac-pay="' + i + '">' + opt("once", "一括") + opt("b12", "分割12回") + opt("b24", "分割24回") + opt("b36", "分割36回") + "</select>"
        + '<button class="del" data-ac-del="' + i + '" type="button" aria-label="削除">×</button>'
        + "</div>";
    }).join("");
  }
  function renderAdhocMonthly() {
    $("adhocMonthlyList").innerHTML = state.adhocMonthly.map(function (a, i) {
      return '<div class="adhoc-row">'
        + '<input type="text" placeholder="項目名" value="' + esc(a.name || "") + '" data-am-name="' + i + '">'
        + '<input type="number" placeholder="±円/月" value="' + (a.amount || "") + '" data-am-amount="' + i + '">'
        + '<select data-am-months="' + i + '">'
        + '<option value="0"' + (!num(a.months) ? " selected" : "") + ">ずっと</option>"
        + [3, 6, 12, 24, 36].map(function (m) {
            return '<option value="' + m + '"' + (num(a.months) === m ? " selected" : "") + ">" + m + "か月</option>";
          }).join("")
        + "</select>"
        + '<button class="del" data-am-del="' + i + '" type="button" aria-label="削除">×</button>'
        + "</div>";
    }).join("");
  }
  function renderAdhocInitial() {
    $("adhocInitialList").innerHTML = state.adhocInitial.map(function (a, i) {
      return '<div class="adhoc-row">'
        + '<input type="text" placeholder="項目名" value="' + esc(a.name || "") + '" data-ai-name="' + i + '">'
        + '<input type="number" placeholder="±円" value="' + (a.amount || "") + '" data-ai-amount="' + i + '">'
        + '<button class="del" data-ai-del="' + i + '" type="button" aria-label="削除">×</button>'
        + "</div>";
    }).join("");
  }
  function renderCampaigns() {
    var plan = currentPlan();
    var list = (MASTER.campaigns || []).filter(function (c) {
      return !(c.plans && c.plans.length) || c.plans.indexOf(plan.id) >= 0;
    });
    if (!hasPlan() || !list.length) { $("campaignList").innerHTML = ""; return; }
    var h = '<div class="subhead">キャンペーン割引（このプランで使えるもの）</div>';
    list.forEach(function (c) {
      var checked = state.campaigns[c.id] ? " checked" : "";
      var choices = c.amountChoices || [];
      var right;
      if (choices.length > 1) {
        var cur = choices[0].a;
        if (state.campaignAmounts[c.id] != null
            && choices.some(function (ch) { return ch.a === state.campaignAmounts[c.id]; })) {
          cur = state.campaignAmounts[c.id];
        }
        right = '<select data-cpamt="' + esc(c.id) + '">'
          + choices.map(function (ch) {
              return '<option value="' + ch.a + '"' + (ch.a === cur ? " selected" : "") + ">"
                + esc(ch.label) + " −" + yen(ch.a) + "</option>";
            }).join("") + "</select>";
      } else {
        right = '<span class="price">−' + yen(choices.length ? choices[0].a : 0) + "/月</span>";
      }
      h += '<div class="opt-row"><label class="check"><input type="checkbox" data-cp="' + esc(c.id) + '"' + checked + "> "
        + esc(c.name) + "（" + c.months + "か月間）</label>" + right + "</div>";
    });
    $("campaignList").innerHTML = h;
  }
  function renderDiscountHint() {
    var plan = currentPlan();
    var msgs = [];
    if (!hasPlan()) { $("discountHint").textContent = ""; return; }
    if (!plan.discounts.minna2 && !plan.discounts.minna3) msgs.push("このプランはみんなドコモ割の割引対象外です（回線数のカウントには含まれる場合があります）。");
    if (!plan.discounts.set) msgs.push("セット割の対象外プランです。");
    if (!plan.discounts.dcard && !plan.discounts.dcardGold) msgs.push("dカードお支払割の対象外プランです。");
    if (!plan.discounts.choki10) msgs.push("長期利用割は対象外です。");
    if (!plan.discounts.denki) msgs.push("でんきセット割は対象外です。");
    $("discountHint").textContent = msgs.join(" ");
  }
  function syncFormFromState() {
    renderPatternTabs();
    $("procType").value = state.procType;
    $("planGroup").value = state.planGroup;
    renderPlanSelect();
    $("minna").value = state.minna;
    $("dSet").checked = state.dSet;
    $("dCardSel").value = state.dCard;
    $("dDenki").checked = state.dDenki;
    $("choki").value = state.choki;
    renderVoiceSelect();
    renderMailOpt();
    renderOptionList();
    renderFeeItemList();
    renderAccessoryTiles();
    renderAccessories();
    renderAdhocMonthly();
    renderAdhocInitial();
    $("deviceName").value = state.deviceName;
    $("devicePrice").value = state.devicePrice || "";
    $("payMethod").value = state.payMethod;
    $("kaedoki23").value = state.kaedoki23 || "";
    $("kaedokiFee").value = state.kaedokiFee || "";
    $("atamakin").value = state.atamakin;
    $("jimuFee").value = state.jimuFee;
    $("currentInst").value = state.currentInst || "";
    $("currentInstMonths").value = state.currentInstMonths || "";
    $("currentInstMonthsField").hidden = !num(state.currentInst);
    $("custName").value = state.custName;
    $("shopName").value = state.shopName;
    $("staffName").value = state.staffName;
    $("quoteMemo").value = state.quoteMemo;
    ["todoDcard", "todoDenkiGas", "todoHikari"].forEach(function (k) { $(k).checked = !!state[k]; });
    $("voiceChange").checked = !!state.voiceChange;
    renderNetSvc();
    $("planChange").checked = !!state.planChange;
    document.querySelectorAll("[data-storepay]").forEach(function (cb) {
      cb.checked = !!(state.storePay || {})[cb.getAttribute("data-storepay")];
    });
    $("usePoint").checked = !!state.usePoint;
    $("usePointField").hidden = !state.usePoint;
    $("usePointAmount").value = state.usePointAmount || "";
    $("todoOther").value = state.todoOther || "";
    $("dcardTypeWrap").hidden = !state.todoDcard;
    $("energyTypeWrap").hidden = !state.todoDenkiGas;
    document.querySelectorAll("[data-dcardtype]").forEach(function (cb) { cb.checked = state.todoDcardType === cb.getAttribute("data-dcardtype"); });
    document.querySelectorAll("[data-denkitype]").forEach(function (cb) { cb.checked = state.todoDenkiType === cb.getAttribute("data-denkitype"); });
    document.querySelectorAll("[data-gastype]").forEach(function (cb) { cb.checked = state.todoGasType === cb.getAttribute("data-gastype"); });
    renderGasDiscounts();
    document.querySelectorAll("[data-proc]").forEach(function (cb) {
      cb.checked = !!(state.procTodo || {})[cb.getAttribute("data-proc")];
    });
    $("ptPoikatsu").value = state.pointPoikatsu || "";
    $("ptPoikatsuFamily").value = state.pointPoikatsuFamily || "";
    $("ptDcard").value = state.pointDcard || "";
    $("kaedoki23Field").hidden = state.payMethod !== "kaedoki";
    $("kaedokiFeeField").hidden = state.payMethod !== "kaedoki";
    renderCampaigns();
    renderDiscountHint();
  }

  /* ---------- 端末入力の不整合チェック ---------- */
  // 機種名・機種代金が入っているのに見積もりへ反映されないケースを検出する
  function deviceInputWarning() {
    var p = num(state.devicePrice);
    if (state.payMethod === "none" && (p > 0 || state.deviceName)) {
      return "機種" + (state.deviceName ? "「" + state.deviceName + "」" : "")
        + (p > 0 ? "（" + yen(p) + "）" : "") + "が入力されていますが、支払い方法が「端末購入なし」のため"
        + "機種代金が見積もりに含まれていません。支払い方法（分割・カエドキ・一括）を選択してください。";
    }
    if (state.payMethod === "kaedoki" && p > 0) {
      var t = num(state.kaedoki23);
      if (t > p) {
        return "23回分の総額（" + yen(t) + "）が端末代金総額（" + yen(p) + "）を超えています。"
          + "23回分の総額は、端末代金総額のうち残価を除いた金額（頭金込み）を入力してください。";
      }
      if (t > 0 && t < Math.max(0, num(state.atamakin))) {
        return "23回分の総額（" + yen(t) + "）が店頭頭金（" + yen(num(state.atamakin)) + "）を下回っています。"
          + "23回分の総額には頭金を含めた金額を入力してください。";
      }
    }
    var at = Math.max(0, num(state.atamakin));
    if (state.payMethod !== "none" && state.payMethod !== "ikkatsu" && p > 0 && at >= p) {
      return "店頭頭金（" + yen(at) + "）が端末代金総額（" + yen(p) + "）以上のため、分割する金額が0円になっています。"
        + "端末代金総額は頭金を含んだ総額を入力してください。";
    }
    if (state.payMethod !== "none" && p <= 0 && state.deviceName) {
      return "機種「" + state.deviceName + "」の機種代金が未入力（0円）のため、端末のお支払いが見積もりに含まれていません。";
    }
    return "";
  }

  /* ---------- サマリーバー ---------- */
  function renderSummary(r) {
    var seg0 = r.segs[0];
    var lbl = segLabel(seg0);
    $("sumMonthlyLabel").textContent = "月額" + (lbl ? "（" + lbl + "）" : "") + "｜パターン" + PAT_NAMES[store.active];
    $("sumMonthly").textContent = yen(seg0.monthly);
    $("sumInitial").textContent = yen(r.initialTotal);

    var k2 = $("kaedoki23Hint");
    if (state.payMethod === "kaedoki") {
      k2.hidden = false;
      k2.textContent = "端末代金総額 " + yen(r.device.total || 0) + " のうち、はじめの23回で "
        + yen(r.device.total23 || 0) + "（店頭頭金 " + yen(r.device.atama || 0) + " を含む）をお支払い。"
        + "残りの " + yen(r.device.zanka || 0) + " が残価（24回目支払分）になります。";
    } else { k2.hidden = true; }

    var kh = $("kaedokiHint");
    if (r.device.kaedoki) {
      kh.hidden = false;
      kh.textContent = "カエドキ: 23か月目までに返却で残価" + yen(r.device.zanka || 0)
        + "の支払い不要。実質負担 " + yen(r.device.jisshitsu || 0)
        + (r.device.kaedokiFee > 0 ? "（プログラム利用料" + yen(r.device.kaedokiFee) + "込・ドコモで買替えなら免除）" : "")
        + "。返却しない場合は24か月目以降 " + yen(r.device.after) + "/月を加算。";
    } else { kh.hidden = true; }

    var pw = $("payWarn");
    var warn = deviceInputWarning();
    pw.hidden = !warn;
    pw.textContent = warn ? "⚠ " + warn : "";

    // dカード還元特典: GOLD系選択時は自動計算値を初期セット（数値は編集可）＋含める/含めないチェック
    var goldOn = isGoldCard(state.dCard);
    $("dcardAutoWrap").hidden = !goldOn;
    $("dcardAutoHint").hidden = !goldOn;
    $("dcardAutoReset").hidden = !goldOn || num(state.pointDcard) === (r.dcardAutoPt || 0);
    if (goldOn) {
      $("dcardAutoInclude").checked = state.dcardGoldAuto !== false;
      $("dcardAutoLabel").textContent = "dカード還元特典を見積もりに含める"
        + (r.plan && r.plan.dcard10 === false
          ? "（" + r.plan.name + "は利用料金還元の対象外プランのため自動計算0pt）"
          : "（自動計算: " + (r.dcardAutoPt || 0) + "pt/月・還元" + (dcardRatePt(state.dCard) / 10) + "%・対象額" + yen(r.dcardGoldBase || 0) + "）");
    }
  }

  // ガスの割引オプション欄を料金メニューに合わせて描き直す
  function renderGasDiscounts() {
    var wrap = $("gasDiscountWrap");
    var list = gasDiscountList();
    if (!state.todoDenkiGas || !list.length) { wrap.hidden = true; wrap.innerHTML = ""; return; }
    wrap.hidden = false;
    var picked = state.todoGasDiscount || {};
    var capped = GAS_DISC_CAPPED[state.todoGasType];
    var h = '<span class="sub-label">ガスの割引オプション</span>';
    list.forEach(function (d) {
      h += '<label class="check"><input type="checkbox" data-gasdisc="' + d.id + '"'
        + (picked[d.id] ? " checked" : "") + "> " + esc(d.name) + " " + d.rate + "%</label>";
    });
    var picks = gasDiscountPicked();
    var raw = 0;
    picks.forEach(function (d) { raw += d.rate; });
    var over = capped && (picks.length > 3 || raw > 9);
    if (picks.length) {
      h += '<span class="sub-note">計 ' + gasDiscountRate() + "%"
        + (over ? "（最大3つ・9%までのため " + raw + "% から減額）" : "") + "　値引きの上限は4,400円/月</span>";
    } else if (capped) {
      h += '<span class="sub-note">割引対象は最大3つ・9%まで</span>';
    }
    wrap.innerHTML = h;
  }

  /* ---------- 登録スタッフ引き継ぎシート ---------- */
  function renderStaffSheet() {
    var r = calc();
    var today = new Date();
    var dateStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    var procLabel = procName(state.procType);
    var payLabel = {
      none: "端末購入なし", ikkatsu: "一括払い", b12: "分割12回", b24: "分割24回",
      b36: "分割36回", b48: "分割48回", kaedoki: "いつでもカエドキプログラム（24回・残価設定）"
    }[state.payMethod] || "";
    function row(k, v) { return '<tr><td style="width:38%">' + k + "</td><td>" + v + "</td></tr>"; }

    var h = "";
    h += '<h2 class="sheet-title">登録スタッフ引き継ぎシート</h2>';
    h += '<div class="sheet-meta"><span>' + (state.shopName ? esc(state.shopName) + "　" : "")
      + "作成日: " + dateStr + "</span><span>"
      + (state.staffName ? "受付担当: " + esc(state.staffName) : "") + "</span></div>";
    if (state.custName) h += '<div class="cust">' + esc(state.custName) + "</div>";

    var devWarn = deviceInputWarning();
    if (devWarn) h += '<div class="warnbox">⚠ ' + esc(devWarn) + "</div>";

    // 手続き・作業内容（登録スタッフへの指示）
    h += "<h3>手続き・作業内容</h3><table><tbody>";
    var anyTodo = false;
    var PROC_LABEL = { kishu: "機種変更", shinki: "新規", mnp: "MNP", plan: "プラン変更" };
    var procs = [];
    ["kishu", "shinki", "mnp", "plan"].forEach(function (k) {
      if ((state.procTodo || {})[k]) procs.push(PROC_LABEL[k]);
    });
    if (procs.length) { anyTodo = true; h += row("手続き", "<b>" + procs.join("　／　") + "</b>"); }
    var apps = [];
    if (state.todoDcard) {
      apps.push("dカード申し込み" + (state.todoDcardType ? "（" + DCARD_TYPE[state.todoDcardType] + "）" : ""));
    }
    if (state.todoDenkiGas) {
      var eg = [];
      if (state.todoDenkiType) eg.push(DENKI_TYPE[state.todoDenkiType]);
      if (state.todoGasType) {
        // 旧データ（料金メニュー未対応）はエリア名だけを表示する
        eg.push(GAS_TYPE[state.todoGasType] ? GAS_AREA + " " + GAS_TYPE[state.todoGasType] : GAS_AREA);
      }
      apps.push("でんき・ガス申し込み" + (eg.length ? "（" + eg.join("・") + "）" : ""));
    }
    var gd = state.todoDenkiGas ? gasDiscountPicked() : [];
    if (state.todoHikari) apps.push("光申し込み");
    if (apps.length) { anyTodo = true; h += row("同時申し込み", "<b>" + apps.join("　／　") + "</b>"); }
    if (gd.length) {
      anyTodo = true;
      h += row("ガスの割引オプション", "<b>" + gd.map(function (d) {
        return esc(d.name) + " " + d.rate + "%";
      }).join("　／　") + "</b>　合計 " + gasDiscountRate() + "%（上限4,400円/月）");
    }
    var dataMove = (MASTER.feeItems || []).filter(function (f) {
      return state.feeItems[f.id] && /データ移行/.test(f.name || "");
    });
    anyTodo = true;
    h += row("データ移行", dataMove.length
      ? '<b style="color:var(--red)">あり</b>　' + dataMove.map(function (f) { return esc(f.name); }).join("／")
      : "<b>なし</b>");
    if (state.todoOther) {
      anyTodo = true;
      h += row("その他", "<b>" + esc(state.todoOther).replace(/\n/g, "<br>") + "</b>");
    }
    if (!anyTodo) h += row("作業内容", "（記入なし）");
    h += "</tbody></table>";

    // 契約内容
    var h0 = h; h = "";
    h += "<h3>ご契約内容</h3><table><tbody>";
    h += row("手続き種別", "<b>" + procLabel + "</b>");
    h += row("料金プラン", (hasPlan()
        ? "<b>" + esc(r.plan.name) + "</b>（" + esc(r.tier.label) + "）　" + yen(r.tier.price)
        : "<b>未選択</b>")
      + (state.planChange ? ' <b style="color:var(--red)">（変更あり）</b>' : '<span style="color:var(--muted)">（変更なし）</span>'));
    var voiceName = r.voice.id !== "none" ? esc(r.voice.name) + "　" + yen(r.voicePrice) + esc(r.voiceNote) : "なし";
    h += row("通話オプション", voiceName
      + (state.voiceChange ? ' <b style="color:var(--red)">（変更あり）</b>' : '<span style="color:var(--muted)">（変更なし）</span>'));
    h += row("ドコモメール", state.mailOpt === "yes" ? "有り" : "無し");
    h += "</tbody></table>";

    var secContract = h; h = "";
    // オプション（新規／継続／廃止をまとめる）
    var kNew = [], kKeep = [], kOff = [];
    var netSheet = netSvcCalc(state);
    netSheet.rows.forEach(function (n) { kNew.push({ name: n.name, price: n.price }); });
    netSheet.off.forEach(function (n) { kOff.push(n.name); });
    MASTER.options.forEach(function (o) {
      var kb = state.optionKubun[o.id] || (state.options[o.id] ? "new" : "");
      if (!kb) return;
      var pr = optPrice(o, state);
      var lb = o.priceLabels && o.priceLabels[String(pr)];
      var nm = o.name + (lb ? "（" + lb + "）" : "");
      if (kb === "off") kOff.push(nm);
      else if (kb === "keep") kKeep.push({ name: nm, price: pr });
      else kNew.push({ name: nm, price: pr });
    });
    h += "<h3>オプション（新規・継続・廃止）</h3><table><tbody>";
    var anyOpt = false;
    if (kNew.length) {
      anyOpt = true;
      h += row("<b>新規</b>", '<div class="kubun-list">'
        + kNew.map(function (x) { return "<i>" + esc(x.name) + "　" + yen(x.price) + "/月</i>"; }).join("") + "</div>");
    }
    if (kKeep.length) {
      anyOpt = true;
      h += row("継続", '<div class="kubun-list">'
        + kKeep.map(function (x) { return "<i>" + esc(x.name) + "　" + yen(x.price) + "/月</i>"; }).join("") + "</div>");
    }
    if (kOff.length) {
      anyOpt = true;
      h += row("<b>廃止</b>", '<div class="kubun-list" style="color:var(--red);font-weight:700">'
        + kOff.map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") + "</div>");
    }
    state.adhocMonthly.forEach(function (a) {
      if (!a.name && !num(a.amount)) return;
      anyOpt = true;
      h += row(esc(a.name || "追加項目"), (num(a.amount) < 0 ? "−" : "") + yen(Math.abs(num(a.amount))) + "/月"
        + (num(a.months) > 0 ? "（" + num(a.months) + "か月間）" : ""));
    });
    if (!anyOpt) h += row("オプション", "なし");
    h += "</tbody></table>";

    var secOpt = h; h = "";
    // 端末・アクセサリ
    if (num(state.devicePrice) > 0 || state.deviceName || r.accMonthlyRows.length || r.accOnceRows.length) {
      h += "<h3>端末・アクセサリ</h3><table><tbody>";
      if (state.deviceName || num(state.devicePrice) > 0) {
        h += row("機種", "<b>" + esc(state.deviceName || "（機種名未入力）") + "</b>　" + yen(num(state.devicePrice)));
        h += row("お支払い方法", "<b>" + payLabel + "</b>"
          + (r.device.monthly > 0 ? "　" + yen(r.device.monthly) + "/月 × " + r.device.months + "回" : ""));
        if (r.device.kaedoki) {
          h += row("　残価（24回目支払分）", yen(r.device.zanka || 0));
          if (r.device.kaedokiFee > 0) h += row("　プログラム利用料", yen(r.device.kaedokiFee) + "（返却時・ドコモで買替えなら免除）");
          h += row("　23か月目までに返却した場合の実質負担", yen(r.device.jisshitsu || 0));
          h += row("　返却しない場合（24か月目以降）", yen(r.device.after) + "/月 × 24回");
        }
      }
      r.accMonthlyRows.forEach(function (a) { h += row(esc(a.name) + "（アクセサリ）", yen(a.monthly) + "/月 × " + a.months + "回"); });
      r.accOnceRows.forEach(function (a) { h += row(esc(a.name) + "（アクセサリ）", yen(a.amount) + "（一括）"); });
      h += "</tbody></table>";
    }

    var secDevice = h; h = "";
    // 初期費用
    if (r.storeRows.length || r.billRows.length) {
      h += "<h3>初期費用</h3><table><tbody>";
      r.storeRows.forEach(function (x) { h += row(esc(x.name) + "（店頭）", (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount))); });
      if (r.storeRows.length) h += row("<b>店頭お支払い合計</b>", "<b>" + yen(r.storeTotal) + "</b>");
      r.billRows.forEach(function (x) { h += row(esc(x.name) + "（翌月合算）", (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount))); });
      if (r.billRows.length) h += row("<b>翌月合算払い合計</b>", "<b>" + yen(r.billTotal) + "</b>");
      var pays = [];
      if ((state.storePay || {}).cash) pays.push("現金");
      if ((state.storePay || {}).card) pays.push("カード");
      if ((state.storePay || {}).dbarai) pays.push("d払い");
      h += row("店頭お支払い方法", pays.length ? "<b>" + pays.join("　／　") + "</b>" : "（未選択）");
      h += row("dポイント利用", state.usePoint
        ? '<b style="color:var(--red)">あり</b>' + (num(state.usePointAmount) > 0 ? "　" + num(state.usePointAmount).toLocaleString("ja-JP") + "pt" : "")
        : "なし");
      h += "</tbody></table>";
    }

    var secInit = h; h = "";
    // ポイント充当・メモ
    h += "<h3>ポイント充当・その他</h3><table><tbody>";
    if (r.pointRows.length) {
      r.pointRows.forEach(function (pt) { h += row(esc(pt.name), pt.amount.toLocaleString("ja-JP") + "pt/月"); });
    } else {
      h += row("ポイント充当", "なし");
    }
    h += row("毎月のお支払い目安", "<b>" + yen(r.segs[0].monthly) + "</b>"
      + (r.segs.length > 1 ? "（" + segLabel(r.segs[r.segs.length - 1]) + " " + yen(r.segs[r.segs.length - 1].monthly) + "）" : ""));
    if (state.quoteMemo) h += row("受付メモ", esc(state.quoteMemo));
    h += "</tbody></table>";

    var secPoint = h; h = "";
    // 機種購入があるときは、端末と初期費用（支払方法）を先に読めるよう前へ出す
    var hasDevice = state.payMethod !== "none" && (num(state.devicePrice) > 0 || state.deviceName);
    h = h0 + (hasDevice
      ? secDevice + secInit + secContract + secOpt
      : secContract + secOpt + secDevice + secInit)
      + secPoint;
    h += '<div class="disclaimer">店舗内引き継ぎ用（お客様控えではありません）。アプリ版 ' + APP_VERSION + "</div>";
    $("staffSheetBody").innerHTML = h;
  }

  /* ---------- 見積書描画 ---------- */
  function renderSheet() {
    var r = calc();
    var today = new Date();
    var dateStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    var procLabel = procName(state.procType);
    var seg0 = r.segs[0], segLast = r.segs[r.segs.length - 1];

    var h = "";
    h += '<h2 class="sheet-title">お見積書</h2>';
    h += '<div class="sheet-meta"><span>作成日: ' + dateStr + "</span><span>"
      + esc(state.shopName || "") + (state.staffName ? "　担当: " + esc(state.staffName) : "") + "</span></div>";
    if (state.custName) h += '<div class="cust">' + esc(state.custName) + "</div>";

    var devWarn = deviceInputWarning();
    if (devWarn) h += '<div class="warnbox">⚠ ' + esc(devWarn) + "</div>";

    // 月額目安ボックス
    var lbl0 = segLabel(seg0);
    h += '<div class="big-monthly">';
    h += '<div class="bm-box"><div class="bm-label">毎月のお支払い目安' + (lbl0 ? "（" + lbl0 + "）" : "") + '</div>'
      + '<div class="bm-value">' + yen(seg0.monthly) + "</div>"
      + (r.firstExtra > 0 ? '<div class="bm-sub">初回のみ＋' + yen(r.firstExtra) + "（端数調整）</div>" : "")
      + "</div>";
    if (r.device.kaedoki) {
      // 24か月目以降は「返却しない場合」をメインに表記（返却時は補足）
      h += '<div class="bm-box"><div class="bm-label">' + segLabel(segLast) + "（返却しない場合）</div>"
        + '<div class="bm-value">' + yen(segLast.monthlyKeep != null ? segLast.monthlyKeep : segLast.monthly) + "</div>"
        + '<div class="bm-sub">23か月目までに端末返却の場合: ' + yen(segLast.monthly) + "/月</div></div>";
    } else if (r.segs.length > 1) {
      h += '<div class="bm-box"><div class="bm-label">' + segLabel(segLast) + "</div>"
        + '<div class="bm-value">' + yen(segLast.monthly) + "</div></div>";
    }
    h += '<div class="bm-box"><div class="bm-label">店頭お支払い金額</div>'
      + '<div class="bm-value">' + yen(r.storeTotal) + "</div>"
      + (r.billTotal > 0 ? '<div class="bm-sub">ほかに翌月合算払い ' + yen(r.billTotal) + "</div>" : "")
      + "</div>";
    h += "</div>";

    // 月額の推移（期間が2つ以上あるとき・期間を横軸に並べて時系列で読めるように）
    if (r.segs.length > 1) {
      h += '<h3>月額の推移</h3><table class="trans-table"><tbody>';
      h += "<tr><th>期間</th>" + r.segs.map(function (sg) { return "<th>" + segLabel(sg) + "</th>"; }).join("") + "</tr>";
      // カエドキは「返却しない場合」をメインの月額として表記し、返却時を補足行にする
      h += "<tr><td>月額" + (r.device.kaedoki ? "（返却しない場合）" : "") + "</td>"
        + r.segs.map(function (sg) { return '<td class="trans-amt">' + yen(sg.monthlyKeep != null ? sg.monthlyKeep : sg.monthly) + "</td>"; }).join("") + "</tr>";
      if (r.device.kaedoki) {
        h += "<tr><td>23か月目までに端末返却の場合</td>"
          + r.segs.map(function (sg) { return '<td class="trans-amt">' + yen(sg.monthly) + "</td>"; }).join("") + "</tr>";
      }
      h += "</tbody></table>";
    }

    // 分割支払金（機種代金・アクセサリ）は2ページ目にまとめる
    var devAccSum = r.device.monthly;
    r.accMonthlyRows.forEach(function (a) { devAccSum += a.monthly; });
    var hasInstallment = devAccSum > 0;

    // 月額内訳（1ページ目: プラン・オプション。分割支払金は合計行のみ・明細は2ページ目）
    h += "<h3>月額内訳（" + segLabel(seg0) + (lbl0 ? "" : "毎月") + "）</h3><table><tbody>";
    if (state.procType) h += row("手続き種別", procLabel, false);
    if (hasPlan()) {
      var bonus = r.bonusRows || [];
      h += row(esc(r.plan.name) + "（" + esc(r.tier.label) + "）"
        + (bonus.length ? "（" + bonus.map(function (x) { return esc(x.base); }).join("・") + "）" : ""),
        yen(r.tier.price), true);
    }
    // プランの割引は「セット割」1行にまとめ、内訳を横並びで小さく表記
    var setWari = [];
    if (r.dMinna) setWari.push({ name: "みんなドコモ割（" + (state.minna === "2" ? "2回線" : "3回線以上") + "）", amt: r.dMinna });
    if (r.dSet) setWari.push({ name: "ドコモ光／home 5G", amt: r.dSet });
    if (r.dCard) setWari.push({ name: "dカードお支払割" + (isGoldCard(state.dCard) ? "（GOLD系）" : ""), amt: r.dCard });
    if (r.dDenki) setWari.push({ name: "ドコモでんき", amt: r.dDenki });
    if (r.dChoki) setWari.push({ name: "長期利用割（" + (state.choki === "y20" ? "20年" : "10年") + "以上）", amt: r.dChoki });
    if (setWari.length) {
      var setTotal = 0, setDetail = [];
      setWari.forEach(function (w) { setTotal += w.amt; setDetail.push(w.name + " −" + yen(w.amt)); });
      h += "<tr><td>セット割・各種割引"
        + '<div class="subrow">' + setDetail.join("／") + "</div>"
        + '</td><td class="amt">−' + yen(setTotal) + "</td></tr>";
    }
    r.campaignRows.forEach(function (c) {
      h += row(esc(c.name) + "（" + c.months + "か月間）", "−" + yen(c.amount), true);
    });
    r.pointRows.forEach(function (p) {
      h += row(esc(p.name) + "※", "−" + yen(p.amount), true);
    });
    var netIncl = (r.netRows || []).filter(function (n) { return n.incl; });
    if (r.voice.id !== "none") {
      h += row(esc(r.voice.name) + esc(r.voiceNote)
        + (netIncl.length ? "（" + netIncl.map(function (n) { return esc(n.base); }).join("・") + "）" : ""),
        yen(r.voicePrice), true);
    }
    (r.netRows || []).forEach(function (n) {
      if (n.incl) return;   // 通話オプションの行に含めたので単独では出さない
      h += row(esc(n.name), yen(n.price), true);
    });
    r.optRows.forEach(function (o) { h += row(esc(o.name), yen(o.price), true); });
    state.adhocMonthly.forEach(function (a) {
      if (!a.name && !a.amount) return;
      var label2 = esc(a.name || "調整") + (num(a.months) > 0 ? "（" + num(a.months) + "か月間）" : "");
      h += row(label2, (num(a.amount) < 0 ? "−" : "") + yen(Math.abs(num(a.amount))), true);
    });
    var curInstRow = num(state.currentInst) > 0
      ? row("現在の分割支払金（継続中"
          + (num(state.currentInstMonths) > 0 ? "・残り" + Math.round(num(state.currentInstMonths)) + "回" : "")
          + "）", yen(num(state.currentInst)), true)
      : "";
    if (hasInstallment) {
      h += row("プラン・オプション小計", yen(Math.max(0, seg0.monthly - devAccSum - num(state.currentInst))), true);
      h += curInstRow;
      var instLabel;
      if (r.device.monthly > 0 && r.accMonthlyRows.length) instLabel = "機種代金・アクセサリ 分割支払金";
      else if (r.device.monthly > 0) instLabel = "機種代金 分割支払金" + (r.device.kaedoki ? "（〜23回）" : "（分割" + r.device.months + "回）");
      else instLabel = "アクセサリ 分割支払金";
      h += row(instLabel + "＜明細は2ページ目＞", yen(devAccSum), true);
    } else {
      h += curInstRow;
    }
    h += '<tr class="total"><td>月額合計' + (lbl0 ? "（" + lbl0 + "）" : "")
      + '</td><td class="amt">' + yen(seg0.monthly) + "</td></tr>";
    h += "</tbody></table>";
    if (r.pointRows.length) {
      h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">※ ポイント充当はdポイント（期間・用途限定含む）を利用した場合の実質負担額の目安です。獲得ポイントはご利用状況により変動します。</p>';
    }
    if (hasInstallment) {
      h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">※ 機種代金などの分割支払金・初期費用は2ページ目に記載しています。</p>';
    }

    // ---- 2ページ目: 本体分割金・初期費用（印刷時はここで改ページ） ----
    var p2 = "";

    // 本体分割金（機種代金・アクセサリの分割）
    if (hasInstallment) {
      p2 += "<h3>端末代金・分割支払金</h3><table><tbody>";
      if (r.device.monthly > 0) {
        var dLabel = state.deviceName ? esc(state.deviceName) : "機種代金";
        dLabel += r.device.kaedoki ? "（いつでもカエドキプログラム・〜23回）" : "（分割" + r.device.months + "回）";
        p2 += row(dLabel, yen(r.device.monthly), true);
      }
      r.accMonthlyRows.forEach(function (a) {
        p2 += row(esc(a.name) + "（アクセサリ・分割" + a.months + "回）", yen(a.monthly), true);
      });
      p2 += '<tr class="total"><td>分割支払金 月額合計</td><td class="amt">' + yen(devAccSum) + "</td></tr>";
      p2 += '<tr class="total"><td>お支払い月額合計（プラン・オプション＋分割支払金' + (lbl0 ? "・" + lbl0 : "")
        + '）</td><td class="amt">' + yen(seg0.monthly) + "</td></tr>";
      p2 += "</tbody></table>";
    }

    // カエドキ説明
    if (r.device.kaedoki) {
      p2 += "<h3>いつでもカエドキプログラム</h3><table><tbody>";
      p2 += row("端末代金総額", yen(r.device.total || 0), true);
      if (r.device.atama > 0) p2 += row("店頭頭金（総額のうち店頭でお支払い）", yen(r.device.atama), true);
      p2 += row("23回分の総額（頭金込み）", yen(r.device.total23 || 0), true);
      p2 += row("残価（24回目支払分）", yen(r.device.zanka || 0), true);
      p2 += row("返却しない場合（24か月目以降）", yen(r.device.after) + "/月 × 24回", true);
      if (r.device.kaedokiFee > 0) p2 += row("プログラム利用料（返却時・ドコモで買替えの場合は免除）", yen(r.device.kaedokiFee), true);
      p2 += row("23か月目までに返却した場合の実質負担", yen(r.device.jisshitsu || 0), true);
      p2 += "</tbody></table>";
    }

    // 初期費用（店頭お支払い／翌月合算払い）
    if (r.storeRows.length) {
      p2 += "<h3>店頭お支払い金額</h3><table><tbody>";
      r.storeRows.forEach(function (x) {
        p2 += row(esc(x.name), (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount)), true);
      });
      p2 += '<tr class="total"><td>店頭お支払い合計</td><td class="amt">' + yen(r.storeTotal) + "</td></tr>";
      p2 += "</tbody></table>";
    }
    if (r.billRows.length) {
      p2 += "<h3>翌月合算払い（携帯料金と合算請求）</h3><table><tbody>";
      r.billRows.forEach(function (x) {
        p2 += row(esc(x.name), (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount)), true);
      });
      p2 += '<tr class="total"><td>翌月合算払い合計</td><td class="amt">' + yen(r.billTotal) + "</td></tr>";
      p2 += "</tbody></table>";
    }

    if (p2) {
      h += '<div class="sheet-page2">'
        + '<div class="page2-note no-print">――― 印刷時はここから2ページ目 ―――</div>'
        + '<div class="page2-head">お見積書（続き）'
        + (state.custName ? "　" + esc(state.custName) : "") + '<span>作成日: ' + dateStr + "</span></div>"
        + p2 + "</div>";
    }

    // パターン比較（ユーザーが編集したパターンだけを対象に、2つ以上あるとき）
    var others = [];
    for (var i = 0; i < 3; i++) {
      if (i !== store.active && !isPatternUsed(store.patterns[i])) continue;
      others.push({ i: i, r: i === store.active ? r : calcFor(store.patterns[i]) });
    }
    if (others.length >= 2) {
      h += "<h3>パターン比較</h3><table><tbody>";
      h += "<tr><th></th>" + others.map(function (o) {
        return "<th>パターン" + PAT_NAMES[o.i] + (o.i === store.active ? "（この見積書）" : "") + "</th>";
      }).join("") + "</tr>";
      h += "<tr><td>プラン</td>" + others.map(function (o) {
        return "<td>" + esc(o.r.plan.name) + "</td>";
      }).join("") + "</tr>";
      h += "<tr><td>月額（当初）</td>" + others.map(function (o) {
        return '<td class="amt">' + yen(o.r.segs[0].monthly) + "</td>";
      }).join("") + "</tr>";
      h += "<tr><td>月額（最終）</td>" + others.map(function (o) {
        var ls = o.r.segs[o.r.segs.length - 1];
        return '<td class="amt">' + yen(ls.monthly) + "</td>";
      }).join("") + "</tr>";
      h += "<tr><td>初期費用</td>" + others.map(function (o) {
        return '<td class="amt">' + yen(o.r.initialTotal) + "</td>";
      }).join("") + "</tr>";
      h += "</tbody></table>";
    }

    if (state.quoteMemo) h += '<div class="memo">※ ' + esc(state.quoteMemo) + "</div>";

    h += '<div class="disclaimer">本見積もりは概算です。実際のご契約時の金額・適用条件とは異なる場合があります。'
      + "キャンペーン・割引の適用可否は契約条件により変わります。詳細は店頭スタッフへご確認ください。<br>"
      + "料金データ基準日: " + esc(MASTER.updated) + "｜アプリ版 " + APP_VERSION + "</div>";

    $("sheetBody").innerHTML = h;

    function row(name, val, amt) {
      return "<tr><td>" + name + '</td><td class="' + (amt ? "amt" : "") + '">' + val + "</td></tr>";
    }
  }

  /* ---------- マスタ設定タブ ---------- */
  function renderMasterTab() {
    $("masterUpdated").textContent = MASTER.updated + "｜アプリ版 " + APP_VERSION;
    var h = "";

    h += '<div class="master-plan"><h3>共通費用</h3><div class="master-grid">';
    h += mInput("事務手数料（新規）", "fees.jimu_shinki");
    h += mInput("事務手数料（MNP）", "fees.jimu_mnp");
    h += mInput("事務手数料（機種変更）", "fees.jimu_kishu");
    h += mInput("店頭頭金（初期値）", "fees.atamakin_default");
    h += "</div></div>";

    var D_LABELS = [
      ["minna2", "みんなドコモ割（2回線）"],
      ["minna3", "みんなドコモ割（3回線〜）"],
      ["set", "光／home 5G セット割"],
      ["dcard", "dカードお支払割"],
      ["dcardGold", "dカードお支払割（GOLD系）"],
      ["denki", "でんきセット割"],
      ["choki10", "長期利用割（10年〜）"],
      ["choki20", "長期利用割（20年〜）"],
    ];
    MASTER.plans.forEach(function (pl, pi) {
      h += '<div class="master-plan"><h3>' + esc(pl.name) + "</h3><div class=\"master-grid\">";
      pl.tiers.forEach(function (t, ti) {
        h += mInput("基本料金（" + esc(t.label) + "）", "plans." + pi + ".tiers." + ti + ".price");
      });
      D_LABELS.forEach(function (dl) {
        if (dl[0] in pl.discounts) h += mInput(dl[1], "plans." + pi + ".discounts." + dl[0]);
      });
      h += "</div></div>";
    });

    h += '<div class="master-plan"><h3>通話オプション</h3><div class="master-grid">';
    MASTER.voiceOptions.forEach(function (v, vi) {
      if (v.id === "none") return;
      h += mInput(esc(v.name), "voiceOptions." + vi + ".price");
    });
    h += "</div></div>";

    // オプション・サービス（すべて月額。追加・削除・並び替え・カテゴリ変更可）
    function optExtra(o) {
      return '<select data-op-cat="' + o.__i + '">'
        + OPT_CATEGORIES.map(function (c) {
            return '<option value="' + c + '"' + ((o.category || "その他") === c ? " selected" : "") + ">" + c + "</option>";
          }).join("")
        + "</select>"
        + '<label class="gold-flag"><input type="checkbox" data-op-gold="' + o.__i + '"' + (o.carrier ? " checked" : "") + '>GOLD10%</label>'
        + (o.priceChoices ? '<span class="price">選択式</span>' : "");
    }
    function feeExtra(o) {
      return '<select data-fi-pay="' + o.__i + '">'
        + '<option value="store"' + (o.pay !== "bill" ? " selected" : "") + ">店頭払い</option>"
        + '<option value="bill"' + (o.pay === "bill" ? " selected" : "") + ">翌月合算</option>"
        + "</select>";
    }
    var isOwn = function (o) { return !!o.own; };
    var isCarrier = function (o) { return !o.own; };

    // 見積もり画面のタイルの並び（長押しドラッグ）
    h += '<div class="master-plan"><h3>見積もり画面のタイルの並び</h3>';
    h += '<p class="hint">タイルを<strong>長押ししてから動かす</strong>と、順番を入れ替えたり、別のカテゴリへ移したりできます。'
      + 'ここでの並びが、そのまま見積もり画面のタイルの並びになります。</p>';
    h += sorterHtml("op", optCatGroups(), true);
    h += '<div class="subhead">初期費用の定番項目</div>';
    h += sorterHtml("fi", [{ cat: "", items: MASTER.feeItems || [] }], false);
    h += '<div class="subhead">アクセサリ</div>';
    h += sorterHtml("ac", [{ cat: "", items: MASTER.accessories || [] }], false);
    h += "</div>";

    h += '<div class="master-plan"><h3>オプション・サービス（月額）</h3>';
    h += '<p class="hint">名称・月額・カテゴリを自由に設定できます。一括で払うもの（コーティング・手数料など）は下の「初期費用の定番項目」へ。金額選択式のもの（補償など）は選択肢の初期値が単価になります。<br>'
      + '「<strong>店舗独自</strong>」にチェックを入れると、下の「店舗独自サービス」へ移ります。<strong>見積もり画面の表示は変わりません</strong>（従来どおりカテゴリごとに並びます）。</p>';
    h += '<div class="master-sub"><h4>ドコモの商材</h4>';
    h += listEditor(MASTER.options, "op", optExtra, isCarrier) + "</div>";
    h += '<div class="master-sub own"><h4>店舗独自サービス</h4>';
    h += listEditor(MASTER.options, "op", optExtra, isOwn) + "</div>";
    h += '<div class="actions">'
      + '<button class="btn-sub" data-add="options" type="button">＋ ドコモの商材を追加</button>'
      + '<button class="btn-sub" data-add="optionsOwn" type="button">＋ 店舗独自サービスを追加</button></div></div>';

    // 初期費用の定番項目（手数料・コーティング等の一括もの）
    h += '<div class="master-plan"><h3>初期費用の定番項目（手数料・コーティングなど）</h3>';
    h += '<p class="hint">契約時に一括で支払うもの。「⑦初期費用」にチェックボックスとして表示されます。</p>';
    h += '<div class="master-sub"><h4>ドコモの商材</h4>';
    h += listEditor(MASTER.feeItems, "fi", feeExtra, isCarrier) + "</div>";
    h += '<div class="master-sub own"><h4>店舗独自サービス</h4>';
    h += listEditor(MASTER.feeItems, "fi", feeExtra, isOwn) + "</div>";
    h += '<div class="actions">'
      + '<button class="btn-sub" data-add="feeItems" type="button">＋ ドコモの商材を追加</button>'
      + '<button class="btn-sub" data-add="feeItemsOwn" type="button">＋ 店舗独自サービスを追加</button></div></div>';

    // アクセサリの定番商品
    h += '<div class="master-plan"><h3>アクセサリの定番商品（docomo select など）</h3>';
    h += '<p class="hint">「⑥アクセサリ」にタイルとして表示されます。単価は店舗の取扱商品に合わせて編集を。</p>';
    h += listEditor(MASTER.accessories, "ac", function () { return ""; });
    h += '<div class="actions"><button class="btn-sub" data-add="accessories" type="button">＋ 商品を追加</button></div></div>';

    // テンプレート管理
    h += '<div class="master-plan"><h3>テンプレート</h3>';
    h += '<p class="hint">テンプレートは<strong>担当者ごと</strong>です（いまは「' + esc(activeStaff().name || "担当") + '」のもの）。'
      + '保存は見積もり画面の「現在の内容をテンプレに保存」から。ここでは名前変更と削除ができます。</p>';
    templates.forEach(function (t, i) {
      h += '<div class="adhoc-row">'
        + '<span class="price" style="min-width:2em">' + (i + 1) + '</span>'
        + (t
          ? '<input type="text" value="' + esc(t.name) + '" data-tp-name="' + i + '">'
            + '<button class="del" data-tp-del="' + i + '" type="button" aria-label="削除">×</button>'
          : '<span class="price">未設定</span>')
        + "</div>";
    });
    h += "</div>";

    // キャンペーン割引（名称・期間・割引額を編集可）
    h += '<div class="master-plan"><h3>キャンペーン割引</h3>';
    h += '<p class="hint">対象プラン選択時に「②割引」へ表示されます。終了したキャンペーンは×で削除してください。</p>';
    (MASTER.campaigns || []).forEach(function (c, i) {
      h += '<div class="adhoc-row">'
        + '<input type="text" value="' + esc(c.name) + '" placeholder="キャンペーン名" data-cp-name="' + i + '">'
        + '<input type="number" value="' + c.months + '" title="割引期間（か月）" data-cp-months="' + i + '" style="max-width:5em">'
        + '<span class="price">か月</span>'
        + '<button class="del" data-cp-del="' + i + '" type="button" aria-label="削除">×</button>'
        + "</div>";
      (c.amountChoices || []).forEach(function (ch, j) {
        h += '<div class="adhoc-row" style="margin-left:24px">'
          + '<span class="price" style="min-width:9em">' + esc(ch.label || "割引額") + "</span>"
          + '<input type="number" value="' + ch.a + '" data-cp-amt="' + i + '-' + j + '">'
          + '<span class="price">円/月引き</span>'
          + "</div>";
      });
    });
    h += "</div>";

    $("masterBody").innerHTML = h;

    /* filter を渡すと、その条件に合う項目だけを並べる。
     * 並べ替えは同じグループの中で入れ替わるよう、相手の位置を data-*-swap で渡す。
     * 位置（data-*-name など）は元の一覧での位置をそのまま使う。 */
    function listEditor(list, prefix, extra, filter) {
      var rows = [];
      (list || []).forEach(function (o, i) {
        o.__i = i;
        if (!filter || filter(o)) rows.push({ o: o, i: i });
      });
      if (!rows.length) return '<p class="hint">項目がありません。</p>';
      return rows.map(function (r, k) {
        var o = r.o, i = r.i;
        var up = k > 0 ? rows[k - 1].i : -1;
        var dn = k < rows.length - 1 ? rows[k + 1].i : -1;
        return '<div class="adhoc-row">'
          + '<button class="mv" data-' + prefix + '-up="' + i + '" data-' + prefix + '-swap="' + up + '" type="button" aria-label="上へ"' + (up < 0 ? " disabled" : "") + ">▲</button>"
          + '<button class="mv" data-' + prefix + '-down="' + i + '" data-' + prefix + '-swap="' + dn + '" type="button" aria-label="下へ"' + (dn < 0 ? " disabled" : "") + ">▼</button>"
          + '<input type="text" value="' + esc(o.name) + '" placeholder="名称" data-' + prefix + '-name="' + i + '">'
          + '<input type="number" value="' + o.price + '" data-' + prefix + '-price="' + i + '">'
          + extra(o)
          + '<label class="own-flag"><input type="checkbox" data-' + prefix + '-own="' + i + '"' + (o.own ? " checked" : "") + ">店舗独自</label>"
          + '<button class="del" data-' + prefix + '-del="' + i + '" type="button" aria-label="削除">×</button>'
          + "</div>";
      }).join("");
    }
    function mInput(label, path) {
      return "<label>" + label + '</label><input type="number" data-mpath="' + path + '" value="' + getPath(path) + '">';
    }
  }
  function getPath(path) {
    return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, MASTER);
  }
  function setPath(path, v) {
    var ks = path.split(".");
    var last = ks.pop();
    var o = ks.reduce(function (a, k) { return a == null ? a : a[k]; }, MASTER);
    if (o != null) o[last] = v;
  }

  /* ---------- 再計算 ---------- */
  // dカード還元の自動計算値を入力欄へ初期セット（手で変更した値は上書きしない）
  function syncDcardAuto() {
    var stillAuto = num(state.pointDcard) === num(state.pointDcardAuto || 0);
    if (!isGoldCard(state.dCard)) {
      // GOLD系以外に切り替えたら、自動セットのままだった値はクリア（手入力値は残す）
      if (stillAuto && num(state.pointDcard) > 0) {
        state.pointDcard = 0;
        $("ptDcard").value = "";
      }
      state.pointDcardAuto = 0;
      return;
    }
    var auto = calcFor(state).dcardAutoPt;
    if (stillAuto) {
      state.pointDcard = auto;
      $("ptDcard").value = auto || "";
    }
    state.pointDcardAuto = auto;
  }

  function recalc() {
    // ログイン画面を出している間は帳票を作らない（裏側に内容が残らないように）
    var ov = $("loginOverlay");
    if (ov && !ov.hidden) return;
    syncDcardAuto();
    renderNetSvc();
    var r = calc();
    renderSummary(r);
    renderPatternTabs();
    saveState();
    if ($("tab-sheet").classList.contains("active")) renderSheet();
    if ($("tab-staff").classList.contains("active")) renderStaffSheet();
  }

  /* ---------- マスタ設定のロック ----------
   * マスタ設定は料金・担当者・店舗ログインを触れる管理画面なので、
   * 店舗ログインと同じ店舗ID＋パスワードを通った人だけが開けるようにする。
   * 店舗ログインを使っていない（クラウド未設定かつ端末内ロック未設定）場合は、
   * 照合するものが無く、店舗ログインの設定自体がこのタブにあるため素通しにする。 */
  var masterUnlocked = false;
  var masterGateFrom = null; // キャンセルしたときに戻る先
  function masterGateOn() { return !masterUnlocked && (lockEnabled() || cloudOn()); }
  function showMasterGate(show) {
    var el = $("masterGate");
    if (!el) return;
    el.hidden = !show;
    if (!show) return;
    var err = $("masterGateErr"); if (err) err.hidden = true;
    var pw = $("masterGatePass"); if (pw) pw.value = "";
    var id = $("masterGateId");
    if (id) {
      // ログイン中の店舗IDを入れておく（クラウド利用時は変更できない）
      id.value = cloudOn() ? String(CLOUD.user.email || "").replace(/@.*$/, "")
        : (config.lock && config.lock.storeId) || "";
      id.readOnly = cloudOn();
      setTimeout(function () { (pw || id).focus(); }, 50);
    }
  }
  function masterGateFail(msg) {
    var err = $("masterGateErr");
    if (err) { err.textContent = msg; err.hidden = false; }
    var pw = $("masterGatePass"); if (pw) pw.value = "";
  }
  // 入力された店舗ID・パスワードを照合する（Promise<bool>）
  function masterGateVerify(id, pass) {
    if (cloudOn()) {
      // ログイン中の店舗と別のIDでは通さない（別アカウントに入れ替わるのを防ぐ）
      if (storeIdToEmail(id) !== String(CLOUD.user.email || "")) return Promise.resolve(false);
      try {
        var cred = firebase.auth.EmailAuthProvider.credential(CLOUD.user.email, pass);
        return CLOUD.user.reauthenticateWithCredential(cred)
          .then(function () { return true; }, function (e2) {
            // パスワード違い以外（通信不良・試行回数超過）は、その理由を出す
            var c = String((e2 && e2.code) || "");
            if (/wrong-password|invalid-credential|user-mismatch|invalid-email/.test(c)) return false;
            throw new Error(loginErrorMessage(e2));
          });
      } catch (e) {
        return Promise.reject(new Error("この環境ではパスワードを確認できませんでした。"));
      }
    }
    // 端末内モード。設定したときと同じ方式で照合する
    if (config.lock.algo === "sha256" && lockAlgo() !== "sha256") {
      return Promise.reject(new Error("この環境では確認できません。設定したときと同じ方法（https）でお開きください。"));
    }
    return lockHash(pass, config.lock.salt, config.lock.algo).then(function (h) {
      return id === config.lock.storeId && h === config.lock.hash;
    });
  }
  function initMasterGate() {
    $("masterGateForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("masterGateBtn");
      btn.disabled = true;
      var id = String($("masterGateId").value || "").trim();
      masterGateVerify(id, $("masterGatePass").value).then(function (ok) {
        btn.disabled = false;
        if (!ok) { masterGateFail("店舗IDまたはパスワードが正しくありません。"); return; }
        masterUnlocked = true;
        $("masterGatePass").value = "";
        showMasterGate(false);
        if (masterGateFrom === "staff") {
          masterGateFrom = null;
          if (!config.activeStaffId) enterStaff(config.staff[0]);
        }
        switchTab("master");
      }, function (e2) {
        btn.disabled = false;
        masterGateFail((e2 && e2.message) || "確認できませんでした。時間をおいて再度お試しください。");
      });
    });
    $("masterGateCancel").addEventListener("click", function () {
      showMasterGate(false);
      if (masterGateFrom === "staff") { masterGateFrom = null; showStaffGate(true); return; }
      switchTab("quote");
    });
  }

  /* ---------- タブ ---------- */
  function switchTab(name) {
    if (name === "master" && masterGateOn()) { showMasterGate(true); return; }
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab-page").forEach(function (pg) {
      pg.classList.toggle("active", pg.id === "tab-" + name);
    });
    if (name === "sheet") renderSheet();
    if (name === "staff") renderStaffSheet();
    if (name === "master") renderMasterTab();
    if (name === "saved") { renderSaved(); $("saveQuoteName").placeholder = savedDefaultName(); }
    $("summaryBar").style.display = name === "quote" ? "" : "none";
  }
  function switchPattern(i) {
    store.active = i;
    state = store.patterns[i];
    if (!state.jimuFee && autoFeeProc(state.procType) && !state.planId) {
      state.jimuFee = jimuFeeFor(state.procType);
      state.atamakin = MASTER.fees.atamakin_default;
    }
    syncFormFromState();
    recalc();
  }

  /* ---------- 見積もり画面のタイルの並べ替え ----------
   * マスタ設定に、見積もり画面と同じ区分けでタイルを並べたカードを出し、
   * スマホのアイコンのように長押し → ドラッグで動かせるようにする。
   * オプションはカテゴリをまたいで移せる（＝カテゴリの変更になる）。
   * 確定すると MASTER の配列そのものを並べ替えるため、見積もり画面にも反映される。 */
  var SORT_LISTS = {
    op: { key: "options", render: renderOptionList, cats: true },
    fi: { key: "feeItems", render: renderFeeItemList, cats: false },
    ac: { key: "accessories", render: renderAccessoryTiles, cats: false }
  };
  // 見積もり画面と同じ規則でカテゴリ分けする（ドコモメールは②で選ぶため除く）
  function optCatGroups() {
    var mailDef = mailOptDef();
    return OPT_CATEGORIES.map(function (cat) {
      return {
        cat: cat,
        items: MASTER.options.filter(function (o) {
          if (mailDef && o.id === mailDef.id) return false;
          var c = OPT_CATEGORIES.indexOf(o.category) >= 0 ? o.category : "その他";
          return c === cat;
        })
      };
    });
  }
  function sorterHtml(prefix, groups, showCatName) {
    return '<div class="sorter" data-sorter="' + prefix + '">' + groups.map(function (g) {
      return (showCatName ? '<div class="sort-cat">' + esc(g.cat) + "</div>" : "")
        + '<div class="sort-grid" data-cat="' + esc(g.cat) + '">'
        + g.items.map(function (o) {
            return '<div class="sort-chip' + (o.own ? " own" : "") + '" data-sid="' + esc(o.id) + '">'
              + '<span class="t-name">' + esc(o.name || "（名称未設定）") + "</span></div>";
          }).join("")
        + "</div>";
    }).join("") + "</div>";
  }
  // 画面の並びを MASTER の配列へ書き戻す
  function commitSort(root) {
    var def = SORT_LISTS[root.getAttribute("data-sorter")];
    if (!def) return;
    var list = MASTER[def.key] || [];
    var byId = {};
    list.forEach(function (o) { byId[o.id] = o; });
    var next = [], seen = {};
    Array.prototype.forEach.call(root.querySelectorAll(".sort-grid"), function (g) {
      var cat = g.getAttribute("data-cat");
      Array.prototype.forEach.call(g.querySelectorAll(".sort-chip"), function (c) {
        var o = byId[c.getAttribute("data-sid")];
        if (!o || seen[o.id]) return;
        if (def.cats && cat) o.category = cat;
        next.push(o);
        seen[o.id] = true;
      });
    });
    // 並べ替えの対象に出していないもの（ドコモメールなど）は後ろへ残す
    list.forEach(function (o) { if (!seen[o.id]) next.push(o); });
    MASTER[def.key] = next;
    markEdited();
    def.render();
    recalc();
    renderMasterTab(); // 一覧（▲▼）の位置番号を振り直す
  }

  var SORT = { chip: null, ghost: null, root: null, timer: null, active: false, x0: 0, y0: 0 };
  function sortCancelHold() { if (SORT.timer) { clearTimeout(SORT.timer); SORT.timer = null; } }
  function sortBegin(chip, x, y) {
    var r = chip.getBoundingClientRect();
    SORT.active = true;
    SORT.chip = chip;
    SORT.root = chip.closest(".sorter");
    SORT.x0 = x;
    SORT.y0 = y;
    var g = chip.cloneNode(true);
    g.className = "sort-chip sort-ghost";
    g.style.left = r.left + "px";
    g.style.top = r.top + "px";
    g.style.width = r.width + "px";
    g.style.height = r.height + "px";
    g.style.transform = "scale(1.06)";
    document.body.appendChild(g);
    SORT.ghost = g;
    chip.classList.add("sort-src");
    document.body.classList.add("sorting");
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }
  function sortEnd(commit) {
    sortCancelHold();
    if (!SORT.active) return;
    SORT.active = false;
    if (SORT.ghost) { SORT.ghost.remove(); SORT.ghost = null; }
    if (SORT.chip) SORT.chip.classList.remove("sort-src");
    document.body.classList.remove("sorting");
    var root = SORT.root;
    SORT.chip = null;
    SORT.root = null;
    if (commit && root) commitSort(root);
  }
  function initTileSort() {
    var body = $("masterBody");
    if (!body) return;
    body.addEventListener("pointerdown", function (e) {
      var chip = e.target.closest && e.target.closest(".sort-chip");
      if (!chip) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      sortCancelHold();
      var x = e.clientX, y = e.clientY;
      SORT.x0 = x; SORT.y0 = y;
      SORT.timer = setTimeout(function () { SORT.timer = null; sortBegin(chip, x, y); }, 400);
    });
    document.addEventListener("pointermove", function (e) {
      if (!SORT.active) {
        // 長押しの前に大きく動いたらスクロール操作とみなす
        if (SORT.timer && (Math.abs(e.clientX - SORT.x0) > 8 || Math.abs(e.clientY - SORT.y0) > 8)) sortCancelHold();
        return;
      }
      e.preventDefault();
      SORT.ghost.style.transform = "translate(" + (e.clientX - SORT.x0) + "px," + (e.clientY - SORT.y0) + "px) scale(1.06)";
      var el = document.elementFromPoint(e.clientX, e.clientY); // ゴーストは pointer-events:none
      if (!el || !el.closest) return;
      var grid = el.closest(".sort-grid");
      if (!grid || grid.closest(".sorter") !== SORT.root) return; // 別の一覧へは移さない
      var over = el.closest(".sort-chip");
      if (over && over !== SORT.chip) {
        var r = over.getBoundingClientRect();
        var after = e.clientX > r.left + r.width / 2;
        grid.insertBefore(SORT.chip, after ? over.nextSibling : over);
      } else if (!over && grid !== SORT.chip.parentNode) {
        grid.appendChild(SORT.chip); // 空のカテゴリへ移す
      }
    }, { passive: false });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      document.addEventListener(ev, function () { sortEnd(ev === "pointerup"); });
    });
    // iOSで指を動かしたときに画面ごとスクロールしないようにする
    document.addEventListener("touchmove", function (e) {
      if (SORT.active) e.preventDefault();
    }, { passive: false });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") sortEnd(false);
    });
  }

  /* ---------- 汎用: マスタのリスト編集ハンドラ ---------- */
  var LIST_DEFS = {
    op: { key: "options", newItem: function () { return { id: "op_" + Date.now(), name: "", price: 0, category: "その他", note: "" }; }, stateKey: "options", render: renderOptionList },
    fi: { key: "feeItems", newItem: function () { return { id: "fi_" + Date.now(), name: "", price: 0 }; }, stateKey: "feeItems", render: renderFeeItemList },
    ac: { key: "accessories", newItem: function () { return { id: "acc_" + Date.now(), name: "", price: 0 }; }, stateKey: "accSel", render: renderAccessoryTiles },
  };
  function markEdited() {
    MASTER.updated = MASTER.updated.replace(/（編集済み.*$/, "") + "（編集済み）";
    saveMaster();
  }
  function handleListEvent(t, evType) {
    for (var prefix in LIST_DEFS) {
      var def = LIST_DEFS[prefix];
      var list = MASTER[def.key];
      var attr = function (n) { return t.getAttribute("data-" + prefix + "-" + n); };
      if (evType === "input" && attr("name") != null) {
        list[+attr("name")].name = t.value;
      } else if (evType === "input" && attr("price") != null) {
        list[+attr("price")].price = num(t.value);
      } else if (evType === "change" && prefix === "op" && attr("cat") != null) {
        list[+attr("cat")].category = t.value;
      } else if (evType === "change" && prefix === "op" && attr("gold") != null) {
        list[+attr("gold")].carrier = t.checked;
      } else if (evType === "change" && attr("own") != null) {
        list[+attr("own")].own = t.checked;
        markEdited();
        renderMasterTab();
        return true;
      } else if (evType === "change" && prefix === "fi" && attr("pay") != null) {
        list[+attr("pay")].pay = t.value;
      } else if (evType === "click" && attr("del") != null) {
        var o = list[+attr("del")];
        store.patterns.forEach(function (pt) { delete pt[def.stateKey][o.id]; });
        if (!MASTER.removedIds) MASTER.removedIds = [];
        MASTER.removedIds.push(o.id); // 初期データからの自動追記で復活させないための記録
        list.splice(+attr("del"), 1);
        renderMasterTab();
      } else if (evType === "click" && (attr("up") != null || attr("down") != null)) {
        var i = +(attr("up") != null ? attr("up") : attr("down"));
        var j = attr("swap") != null ? +attr("swap") : (attr("up") != null ? i - 1 : i + 1);
        if (j < 0 || j >= list.length) return false;
        var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        renderMasterTab();
      } else {
        continue;
      }
      markEdited();
      def.render();
      recalc();
      return true;
    }
    return false;
  }

  /* ---------- イベント ---------- */
  function bindEvents() {
    document.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });
    document.querySelectorAll(".pat").forEach(function (b) {
      b.addEventListener("click", function () { switchPattern(+b.dataset.pat); });
    });
    document.querySelectorAll(".tpl").forEach(function (b) {
      b.addEventListener("click", function () {
        if (tplHold.fired) { tplHold.fired = false; return; } // 長押しで開いた直後は反応させない
        closeTplMenu();
        var i = +b.dataset.tpl;
        if (tplSaveMode) tplSave(i);
        else tplApply(i);
      });
    });
    $("saveTplBtn").addEventListener("click", function () {
      tplSaveMode = !tplSaveMode;
      renderTplBar();
    });
    $("tplNameOk").addEventListener("click", function () { tplSaveDone(true); });
    $("tplNameCancel").addEventListener("click", function () { tplSaveDone(false); });
    $("tplNameInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") tplSaveDone(true);
    });
    $("copyPattern").addEventListener("click", function () {
      var next = (store.active + 1) % 3;
      store.patterns[next] = JSON.parse(JSON.stringify(state));
      switchPattern(next);
    });
    $("toSheet").addEventListener("click", function () { switchTab("sheet"); });
    $("backToQuote").addEventListener("click", function () { switchTab("quote"); });
    $("printBtn").addEventListener("click", function () { window.print(); });
    $("printStaffBtn").addEventListener("click", function () { window.print(); });
    $("backToQuoteStaff").addEventListener("click", function () { switchTab("quote"); });
    // メニューからの印刷でも最新の内容を出す。引き継ぎタブを開いている場合はそちらを印刷する
    window.addEventListener("beforeprint", function () {
      var onStaff = $("tab-staff").classList.contains("active");
      document.body.classList.toggle("print-staff", onStaff);
      if (onStaff) renderStaffSheet(); else renderSheet();
    });

    $("procType").addEventListener("change", function () {
      // 新規契約・機種変更のときだけ頭金・事務手数料を自動セット（それ以外は0・手入力は可能）
      applyProcType(this.value);
      // 「手続き内容」のチェックも選んだ種別に合わせる
      state.procTodo = {};
      state.procTodo[this.value === "plan_only" ? "plan" : this.value] = true;
      document.querySelectorAll("[data-proc]").forEach(function (cb) {
        cb.checked = !!state.procTodo[cb.getAttribute("data-proc")];
      });
      recalc();
    });
    $("planGroup").addEventListener("change", function () {
      var prevPlan = state.planId;
      state.planGroup = this.value;
      renderPlanSelect(); // グループにないプランだった場合はここでplanIdが切り替わる
      syncPoikatsuDefault(prevPlan);
      renderVoiceSelect();
      renderMailOpt();
      renderOptionList();
      renderCampaigns();
      renderDiscountHint();
      recalc();
    });
    $("planId").addEventListener("change", function () {
      var prevPlan = state.planId;
      state.planId = this.value;
      state.tierIdx = 0;
      syncPoikatsuDefault(prevPlan);
      renderTierSelect();
      renderVoiceSelect();
      renderMailOpt();
      renderOptionList();
      renderCampaigns();
      renderDiscountHint();
      recalc();
    });
    $("tierIdx").addEventListener("change", function () { state.tierIdx = parseInt(this.value, 10) || 0; recalc(); });
    $("minna").addEventListener("change", function () { state.minna = this.value; recalc(); });
    $("dSet").addEventListener("change", function () { state.dSet = this.checked; recalc(); });
    $("dCardSel").addEventListener("change", function () { state.dCard = this.value; recalc(); });
    $("dDenki").addEventListener("change", function () { state.dDenki = this.checked; recalc(); });
    $("choki").addEventListener("change", function () { state.choki = this.value; recalc(); });
    $("campaignList").addEventListener("change", function (e) {
      var cid = e.target.getAttribute("data-cp");
      if (cid) { state.campaigns[cid] = e.target.checked; recalc(); return; }
      var aid = e.target.getAttribute("data-cpamt");
      if (aid) { state.campaignAmounts[aid] = num(e.target.value); recalc(); }
    });
    $("ptPoikatsu").addEventListener("input", function () { state.pointPoikatsu = num(this.value); recalc(); });
    $("ptPoikatsuFamily").addEventListener("input", function () { state.pointPoikatsuFamily = num(this.value); recalc(); });
    $("ptDcard").addEventListener("input", function () { state.pointDcard = num(this.value); recalc(); });
    $("dcardAutoInclude").addEventListener("change", function () { state.dcardGoldAuto = this.checked; recalc(); });
    $("dcardAutoReset").addEventListener("click", function () {
      state.pointDcard = state.pointDcardAuto || 0;
      $("ptDcard").value = state.pointDcard || "";
      recalc();
    });
    $("voice").addEventListener("change", function () { state.voice = this.value; recalc(); });
    $("mailOpt").addEventListener("change", function () {
      var mo = mailOptDef();
      if (mo) { state.options[mo.id] = this.value === "yes"; }
      recalc();
    });

    // タイルのタップ／キー操作で選択切替（タイル内のプルダウン操作では切替しない）
    function toggleTile(e) {
      if (e.target.closest("select") || e.target.closest(".t-kubun")) return;
      var tile = e.target.closest(".tile");
      if (!tile) return;
      var optId = tile.getAttribute("data-opt");
      var feeId = tile.getAttribute("data-fee");
      var accId = tile.getAttribute("data-acc");
      if (optId) {
        // 対象にしている（新規・継続・廃止のいずれか）状態と、対象外とを切り替える
        if (state.options[optId] || state.optionKubun[optId] === "off") {
          state.options[optId] = false;
          delete state.optionKubun[optId];
        } else {
          state.options[optId] = true;
          state.optionKubun[optId] = "new";
        }
        renderOptionList();
      }
      if (feeId) { state.feeItems[feeId] = !state.feeItems[feeId]; renderFeeItemList(); }
      if (accId) {
        if (state.accSel[accId]) delete state.accSel[accId];
        else state.accSel[accId] = "once";
        renderAccessoryTiles();
      }
      recalc();
    }
    function tileKey(e) {
      if (e.key === " " || e.key === "Enter") {
        if (e.target.classList && e.target.classList.contains("tile")) {
          e.preventDefault();
          toggleTile(e);
        }
      }
    }
    $("optionList").addEventListener("click", toggleTile);
    $("optionList").addEventListener("keydown", tileKey);
    $("feeItemList").addEventListener("click", toggleTile);
    $("feeItemList").addEventListener("keydown", tileKey);
    $("accTileList").addEventListener("click", toggleTile);
    $("accTileList").addEventListener("keydown", tileKey);
    $("accTileList").addEventListener("change", function (e) {
      var id = e.target.getAttribute("data-acsel");
      if (id) { state.accSel[id] = e.target.value; recalc(); }
    });
    $("optionList").addEventListener("change", function (e) {
      var pid = e.target.getAttribute("data-optprice");
      if (pid) { state.optionPrices[pid] = num(e.target.value); recalc(); }
      var kid = e.target.getAttribute("data-optkubun");
      if (kid) {
        if (e.target.checked) {
          var v = e.target.value;
          state.optionKubun[kid] = v;
          state.options[kid] = v !== "off"; // 廃止は月額に含めない
        }
        renderOptionList(); // チェックを外した場合は元の区分に戻す
        recalc();
      }
    });

    // アクセサリ
    $("addAccessory").addEventListener("click", function () {
      state.accessories.push({ name: "", price: 0, pay: "once" });
      renderAccessories();
      saveState();
    });
    $("accessoryList").addEventListener("input", function (e) {
      var t = e.target, i;
      if (t.hasAttribute("data-ac-name")) { i = +t.getAttribute("data-ac-name"); state.accessories[i].name = t.value; }
      if (t.hasAttribute("data-ac-price")) { i = +t.getAttribute("data-ac-price"); state.accessories[i].price = num(t.value); }
      recalc();
    });
    $("accessoryList").addEventListener("change", function (e) {
      var t = e.target;
      if (t.hasAttribute("data-ac-pay")) {
        state.accessories[+t.getAttribute("data-ac-pay")].pay = t.value;
        recalc();
      }
    });
    $("accessoryList").addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-ac-del")) {
        state.accessories.splice(+e.target.getAttribute("data-ac-del"), 1);
        renderAccessories();
        recalc();
      }
    });

    // 月額追加項目
    $("addAdhocMonthly").addEventListener("click", function () {
      state.adhocMonthly.push({ name: "", amount: 0, months: 0 });
      renderAdhocMonthly();
      saveState();
    });
    function onAdhocMonthlyEdit(e) {
      var t = e.target, i;
      if (t.hasAttribute("data-am-name")) { i = +t.getAttribute("data-am-name"); state.adhocMonthly[i].name = t.value; }
      else if (t.hasAttribute("data-am-amount")) { i = +t.getAttribute("data-am-amount"); state.adhocMonthly[i].amount = num(t.value); }
      else if (t.hasAttribute("data-am-months")) { i = +t.getAttribute("data-am-months"); state.adhocMonthly[i].months = num(t.value); }
      else return;
      recalc();
    }
    $("adhocMonthlyList").addEventListener("input", onAdhocMonthlyEdit);
    $("adhocMonthlyList").addEventListener("change", onAdhocMonthlyEdit);
    $("adhocMonthlyList").addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-am-del")) {
        state.adhocMonthly.splice(+e.target.getAttribute("data-am-del"), 1);
        renderAdhocMonthly();
        recalc();
      }
    });

    // 初期費用追加項目
    $("addAdhocInitial").addEventListener("click", function () {
      state.adhocInitial.push({ name: "", amount: 0 });
      renderAdhocInitial();
      saveState();
    });
    $("adhocInitialList").addEventListener("input", function (e) {
      var t = e.target, i;
      if (t.hasAttribute("data-ai-name")) { i = +t.getAttribute("data-ai-name"); state.adhocInitial[i].name = t.value; }
      if (t.hasAttribute("data-ai-amount")) { i = +t.getAttribute("data-ai-amount"); state.adhocInitial[i].amount = num(t.value); }
      recalc();
    });
    $("adhocInitialList").addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-ai-del")) {
        state.adhocInitial.splice(+e.target.getAttribute("data-ai-del"), 1);
        renderAdhocInitial();
        recalc();
      }
    });

    // 端末
    $("deviceName").addEventListener("input", function () { state.deviceName = this.value; saveState(); });
    $("devicePrice").addEventListener("input", function () { state.devicePrice = num(this.value); recalc(); });
    $("payMethod").addEventListener("change", function () {
      state.payMethod = this.value;
      $("kaedoki23Field").hidden = state.payMethod !== "kaedoki";
      $("kaedokiFeeField").hidden = state.payMethod !== "kaedoki";
      recalc();
    });
    $("kaedoki23").addEventListener("input", function () { state.kaedoki23 = num(this.value); recalc(); });
    $("kaedokiFee").addEventListener("input", function () { state.kaedokiFee = num(this.value); recalc(); });
    $("atamakin").addEventListener("input", function () { state.atamakin = num(this.value); recalc(); });
    $("jimuFee").addEventListener("input", function () { state.jimuFee = num(this.value); recalc(); });

    // お客様情報
    ["custName", "shopName", "staffName", "quoteMemo"].forEach(function (id) {
      $(id).addEventListener("input", function () { state[id] = this.value; saveState(); });
    });
    $("todoOther").addEventListener("input", function () {
      state.todoOther = this.value; saveState(); renderStaffSheet();
    });
    ["todoDcard", "todoDenkiGas", "todoHikari"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state[id] = this.checked;
        if (id === "todoDcard") { $("dcardTypeWrap").hidden = !this.checked; if (!this.checked) state.todoDcardType = ""; }
        if (id === "todoDenkiGas") {
          $("energyTypeWrap").hidden = !this.checked;
          if (!this.checked) { state.todoDenkiType = ""; state.todoGasType = ""; state.todoGasDiscount = {}; }
        }
        syncFormFromState();
        saveState(); renderStaffSheet();
      });
    });
    // 種類の選択（同時に1つだけ・もう一度押すと解除）
    [["data-dcardtype", "todoDcardType"], ["data-denkitype", "todoDenkiType"], ["data-gastype", "todoGasType"]].forEach(function (pair) {
      document.querySelectorAll("[" + pair[0] + "]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          state[pair[1]] = cb.checked ? cb.getAttribute(pair[0]) : "";
          document.querySelectorAll("[" + pair[0] + "]").forEach(function (o) {
            o.checked = state[pair[1]] === o.getAttribute(pair[0]);
          });
          if (pair[1] === "todoGasType") { state.todoGasDiscount = {}; renderGasDiscounts(); }
          saveState(); renderStaffSheet();
        });
      });
    });
    // 保存した見積もり
    var saveBtn = $("saveQuoteBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var nm = $("saveQuoteName");
        var it = saveQuote(nm.value);
        nm.value = "";
        var m = $("saveQuoteMsg");
        m.textContent = "「" + it.name + "」を保存しました。";
        m.hidden = false;
        setTimeout(function () { m.hidden = true; }, 4000);
      });
    }
    var savedEl = $("savedList");
    if (savedEl) {
      savedEl.addEventListener("click", function (e) {
        var t = e.target;
        var lid = t.getAttribute && t.getAttribute("data-savedload");
        var did = t.getAttribute && t.getAttribute("data-saveddel");
        if (lid) {
          if (!confirm("保存した見積もりを開きます。いま入力中の内容は置き換わります。よろしいですか？")) return;
          if (loadSavedQuote(lid)) switchTab("quote");
        } else if (did) {
          var it2 = savedList.filter(function (x) { return x.id === did; })[0];
          if (!it2) return;
          if (!confirm("「" + it2.name + "」を削除します。よろしいですか？")) return;
          deleteSavedQuote(did);
        }
      });
    }

    // 店舗ログイン（端末内モード）の設定
    var lockSave = $("lockSaveBtn");
    if (lockSave) {
      lockSave.addEventListener("click", function () {
        var msg = $("lockMsg");
        var id = String($("lockStoreId").value || "").trim();
        var p1 = $("lockPass").value;
        var p2 = $("lockPass2").value;
        function say(t, ok) { msg.textContent = t; msg.className = "hint" + (ok ? " lock-on" : " lock-err"); msg.hidden = false; }
        if (!id) return say("店舗IDを入力してください。", false);
        if (!p1) return say("パスワードを入力してください。", false);
        if (p1 !== p2) return say("パスワードが一致しません。", false);
        var salt = lockSalt();
        var algo = lockAlgo();
        lockHash(p1, salt, algo).then(function (h) {
          config.lock = { storeId: id, hash: h, salt: salt, algo: algo };
          saveConfig();
          $("lockPass").value = "";
          $("lockPass2").value = "";
          renderLockConfig();
          var lo = $("logoutBtn"); if (lo) lo.hidden = false;
          masterUnlocked = true; // 設定した本人なので、いまの操作は続けられるようにする
          armIdle(true);
          say("店舗ログインを設定しました。次にアプリを開いたときから有効になります。マスタ設定を開くときにも、このIDとパスワードが必要になります。", true);
        });
      });
    }
    var lockClear = $("lockClearBtn");
    if (lockClear) {
      lockClear.addEventListener("click", function () {
        config.lock = { storeId: "", hash: "", salt: "", algo: "" };
        saveConfig();
        renderLockConfig();
        var lo = $("logoutBtn"); if (lo) lo.hidden = !cloudOn();
        var msg = $("lockMsg");
        msg.textContent = "店舗ログインを解除しました。";
        msg.className = "hint";
        msg.hidden = false;
      });
    }

    // 店舗設定（店舗名・担当者）
    var storeNameEl = $("storeNameInput");
    if (storeNameEl) {
      storeNameEl.addEventListener("input", function () {
        config.storeName = this.value;
        saveConfig();
        renderStaffBar();
      });
    }
    var addStaffBtn = $("addStaffBtn");
    if (addStaffBtn) {
      addStaffBtn.addEventListener("click", function () {
        config.staff.push({ id: newStaffId(), name: "担当" + (config.staff.length + 1), code: "" });
        saveConfig();
        renderStoreConfig();
      });
    }
    var staffList = $("staffList");
    if (staffList) {
      staffList.addEventListener("input", function (e) {
        var t = e.target, i;
        if (t.hasAttribute("data-staffname")) {
          i = +t.getAttribute("data-staffname");
          config.staff[i].name = t.value;
        } else if (t.hasAttribute("data-staffcode")) {
          i = +t.getAttribute("data-staffcode");
          config.staff[i].code = t.value.trim();
        } else return;
        saveConfig();
        renderStaffBar();
      });
      staffList.addEventListener("click", function (e) {
        var t = e.target;
        if (!t.hasAttribute("data-staffdel")) return;
        var i = +t.getAttribute("data-staffdel");
        if (config.staff.length <= 1) return;
        var removed = config.staff.splice(i, 1)[0];
        try {
          localStorage.removeItem(quoteKey(removed.id));
          localStorage.removeItem(savedKey(removed.id));
          localStorage.removeItem(tplKey(removed.id));
        } catch (e2) {}
        if (config.activeStaffId === removed.id) {
          config.activeStaffId = config.staff[0].id;
          loadState(); syncFormFromState(); recalc();
        }
        saveConfig();
        renderStoreConfig();
        renderStaffBar();
      });
    }

    $("gasDiscountWrap").addEventListener("change", function (e) {
      var id = e.target.getAttribute && e.target.getAttribute("data-gasdisc");
      if (!id) return;
      if (!state.todoGasDiscount) state.todoGasDiscount = {};
      state.todoGasDiscount[id] = e.target.checked;
      renderGasDiscounts();
      saveState(); renderStaffSheet();
    });
    ["currentInst", "currentInstMonths"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        state[id] = num(this.value);
        if (id === "currentInst") {
          $("currentInstMonthsField").hidden = !state.currentInst;
          if (!state.currentInst) { state.currentInstMonths = 0; $("currentInstMonths").value = ""; }
        }
        recalc();
      });
    });
    $("netSvcList").addEventListener("change", function (e) {
      var t = e.target;
      if (!t.getAttribute) return;
      if (!state.netSvc) state.netSvc = {};
      if (!state.netSvcOff) state.netSvcOff = {};
      var id = t.getAttribute("data-netsvc");
      if (id) {
        state.netSvc[id] = t.checked;
        if (t.checked) state.netSvcOff[id] = false;   // 付けるなら廃止は外す
      } else {
        id = t.getAttribute("data-netsvcoff");
        if (!id) return;
        state.netSvcOff[id] = t.checked;
        if (t.checked) state.netSvc[id] = false;      // 廃止するなら付けるは外す
      }
      recalc();
    });
    $("voiceChange").addEventListener("change", function () { state.voiceChange = this.checked; recalc(); });
    $("planChange").addEventListener("change", function () { state.planChange = this.checked; recalc(); });
    // 店頭お支払いの支払方法
    document.querySelectorAll("[data-storepay]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (!state.storePay) state.storePay = {};
        state.storePay[cb.getAttribute("data-storepay")] = cb.checked;
        saveState(); renderStaffSheet();
      });
    });
    $("usePoint").addEventListener("change", function () {
      state.usePoint = this.checked;
      $("usePointField").hidden = !this.checked;
      saveState(); renderStaffSheet();
    });
    $("usePointAmount").addEventListener("input", function () {
      state.usePointAmount = num(this.value); saveState(); renderStaffSheet();
    });
    document.querySelectorAll("[data-proc]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (!state.procTodo) state.procTodo = {};
        state.procTodo[cb.getAttribute("data-proc")] = cb.checked;
        applyProcType(procTypeFromTodo());
        recalc();
      });
    });

    $("clearQuote").addEventListener("click", function () {
      var keep = { shopName: state.shopName, staffName: state.staffName };
      store.patterns[store.active] = defaultState();
      state = store.patterns[store.active];
      state.shopName = keep.shopName;
      state.staffName = keep.staffName;
      state.jimuFee = autoFeeProc(state.procType) ? jimuFeeFor(state.procType) : 0;
      state.atamakin = autoFeeProc(state.procType) ? MASTER.fees.atamakin_default : 0;
      syncFormFromState();
      recalc();
    });

    // マスタ編集
    $("masterBody").addEventListener("input", function (e) {
      var t = e.target;
      var path = t.getAttribute("data-mpath");
      if (path) {
        setPath(path, num(t.value));
        markEdited();
        recalc();
        return;
      }
      if (t.hasAttribute("data-tp-name")) {
        var tpi = +t.getAttribute("data-tp-name");
        if (templates[tpi]) { templates[tpi].name = t.value.slice(0, 20); persistTemplates(); renderTplBar(); }
        return;
      }
      if (t.hasAttribute("data-cp-name")) {
        MASTER.campaigns[+t.getAttribute("data-cp-name")].name = t.value;
        markEdited(); renderCampaigns(); recalc(); return;
      }
      if (t.hasAttribute("data-cp-months")) {
        MASTER.campaigns[+t.getAttribute("data-cp-months")].months = Math.max(1, Math.round(num(t.value)));
        markEdited(); renderCampaigns(); recalc(); return;
      }
      if (t.hasAttribute("data-cp-amt")) {
        var ij = t.getAttribute("data-cp-amt").split("-");
        MASTER.campaigns[+ij[0]].amountChoices[+ij[1]].a = num(t.value);
        markEdited(); renderCampaigns(); recalc(); return;
      }
      handleListEvent(t, "input");
    });
    $("masterBody").addEventListener("change", function (e) {
      handleListEvent(e.target, "change");
    });
    $("masterBody").addEventListener("click", function (e) {
      var t = e.target;
      if (t.hasAttribute("data-tp-del")) {
        templates[+t.getAttribute("data-tp-del")] = null;
        persistTemplates(); renderMasterTab(); renderTplBar();
        return;
      }
      if (t.hasAttribute("data-cp-del")) {
        var ci = +t.getAttribute("data-cp-del");
        var co = MASTER.campaigns[ci];
        store.patterns.forEach(function (pt) { delete pt.campaigns[co.id]; delete pt.campaignAmounts[co.id]; });
        MASTER.campaigns.splice(ci, 1);
        markEdited(); renderMasterTab(); renderCampaigns(); recalc();
        return;
      }
      var addKey = t.getAttribute("data-add");
      if (addKey === "options" || addKey === "optionsOwn") {
        var no = LIST_DEFS.op.newItem();
        no.own = addKey === "optionsOwn";
        MASTER.options.push(no);
      } else if (addKey === "feeItems" || addKey === "feeItemsOwn") {
        var nf = LIST_DEFS.fi.newItem();
        nf.own = addKey === "feeItemsOwn";
        MASTER.feeItems.push(nf);
      }
      else if (addKey === "accessories") { MASTER.accessories.push(LIST_DEFS.ac.newItem()); }
      else { handleListEvent(t, "click"); return; }
      markEdited();
      renderMasterTab();
      renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
    });
    $("exportMaster").addEventListener("click", function () {
      var b = $("exportMaster");
      var json = JSON.stringify(MASTER, null, 2);
      var done = function () {
        b.textContent = "コピーしました";
        setTimeout(function () { b.textContent = "現在のマスタ構成をコピー"; }, 4000);
      };
      var fallback = function () {
        // クリップボードが使えない環境では全文を表示して手動コピーしてもらう
        var box = $("exportMasterBox");
        box.hidden = false;
        box.value = json;
        box.focus();
        box.select();
        b.textContent = "下の内容を全選択してコピーしてください";
        setTimeout(function () { b.textContent = "現在のマスタ構成をコピー"; }, 6000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(done, fallback);
      } else { fallback(); }
    });
    var resetArm = null;
    $("resetMaster").addEventListener("click", function () {
      var b = $("resetMaster");
      if (resetArm) {
        clearTimeout(resetArm); resetArm = null;
        b.textContent = "マスタを初期値に戻す";
        resetMaster();
      } else {
        b.textContent = "もう一度タップすると初期値に戻します";
        resetArm = setTimeout(function () {
          resetArm = null;
          b.textContent = "マスタを初期値に戻す";
        }, 5000);
      }
    });
  }

  /* ---------- 起動 ---------- */
  loadConfig();
  loadMaster();
  loadState();
  if (!state.jimuFee && autoFeeProc(state.procType) && !localStorage.getItem(quoteKey())) {
    state.jimuFee = jimuFeeFor(state.procType);
    state.atamakin = MASTER.fees.atamakin_default;
  }
  bindEvents();
  syncFormFromState();
  renderTplBar();
  recalc();
  loadSaved();
  renderSaved();
  loadTemplates();
  renderStoreConfig();
  renderLockConfig();
  initIdle();
  initLocalLock();
  initStaffGate();
  initMasterGate();
  initTileSort();
  initTplHold();
  initCloud(); // ログイン・端末間同期はUI初期化が終わってから開始
})();
