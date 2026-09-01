/* =========================================================
 * フロントーク（料金見積もりシミュレーション） — アプリ本体
 * 3パターン同時見積もり／期間セグメント式の月額計算
 * ========================================================= */
(function () {
  "use strict";

  var APP_VERSION = "1.138.1";

  /* ---------- カメラ読み取り（アプリ内OCR）の入・切 ----------
   * 「現在のお支払い」カードの「カメラで読み取る」を出すかどうか。
   *
   * 2026-08-16: 紙の請求書での読み取り精度が実用に足りず、いったん切ってある。
   *   （店頭で撮った写真では文字や金額の誤認が多く、直す手間が入力より大きい）
   *
   * ★ 戻すときは、この1行を true にするだけでよい。
   *   ・OCRの部品は keitai-app/ocr/ に入れたまま（消していない）
   *   ・つないでいる処理（ocrRecognize / ocrPrepImage / #curBillCam）もそのまま残してある
   *   ・文面とボタンの出し分けはこのフラグだけを見ている
   *   ・精度を上げてから戻すなら keitai-app/ocr/README.md の「精度を上げる案」を見る
   * 貼り付け（iPadの「テキストをスキャン」・写真からのコピー）は、切っていても使える。 */
  var OCR_ON = false;

  /* ---------- 「現在のお支払い（請求内訳の読み取り）」の入・切 ----------
   * 2026-08-18 商品化にあたり、いったん画面から外した（機能は残してある）。
   * ★ 戻すときは、この1行を true にするだけでよい。
   *   （社内版だけ戻すなら INTERNAL にする） */
  var CUR_BILL_ON = false;

  /* 社内版（当方の店舗用・リポジトリ直下）から読み込まれたときの印。
   * 社内版は店舗ログインを使わず、データの置き場（localStorageの接頭辞 dq と
   * 同期先 settings/docomoQuoteStore）だけが違う。機能・画面は製品版と同じ。
   * root/index.html と root/sw.js は tools/build-internal.js が生成する。 */
  var INTERNAL = typeof window !== "undefined" && !!window.KEITAI_INTERNAL;
  var NS = INTERNAL ? "dq" : "kq";
  if (INTERNAL) {
    /* 旧・社内版（〜2026.08.14-85）のデータを新しいキー名へ一回だけ引っ越す。
     * 旧キーは消さない（前の版に戻しても動くように）。 */
    try {
      if (!localStorage.getItem("dq-master-v1") && localStorage.getItem("dq-master-v3")) {
        localStorage.setItem("dq-master-v1", localStorage.getItem("dq-master-v3"));
      }
      var mig = [];
      for (var mi = 0; mi < localStorage.length; mi++) {
        var mk = localStorage.key(mi);
        if (mk && mk.indexOf("dq-state-v3:") === 0) mig.push(mk);
      }
      mig.forEach(function (mk2) {
        var nk = "dq-state-v1:" + mk2.slice("dq-state-v3:".length);
        if (!localStorage.getItem(nk)) localStorage.setItem(nk, localStorage.getItem(mk2));
      });
      // 店舗の切り替え判定で消されないように、社内版の印を入れておく
      localStorage.setItem("dq-store-uid", "internal");
    } catch (eMig) {}
  }
  /* ---------- 更新の谷間の安全網 ----------
   * アップデートの配信とかち合う瞬間に開くと、画面（index.html）と
   * プログラム（app.js）が別々の版で混ざることがまれにある
   * （以前、チェック欄が消えて見える形で実際に起きた）。
   * 起動時に大事な部品が揃っているかを確かめ、欠けていたら1回だけ自動で
   * 開き直す（開き直せば両方とも最新版が揃う）。それでも欠けているときは、
   * 中途半端に動かして入力が消えたように見せるより、案内を出して止める。
   * この確認より下の処理は部品が欠けていると途中で止まるため、必ずこの位置
   * （DOMに触る処理より前）に置くこと。新しい版で大事な部品を足したら、
   * この一覧にも id を足す。 */
  var INTEGRITY_IDS = ["planId", "voiceTiles", "optionList", "accTileList",
    "feeItemList", "pointApply", "dCardSub", "mnpBenefitWrap", "summaryBar",
    "masterBody", "helpPop", "mailTile"];
  var INTEGRITY_KEY = NS + "-integrity-reload";
  var integrityMissing = INTEGRITY_IDS.filter(function (id) {
    return !document.getElementById(id);
  });
  if (integrityMissing.length) {
    var integrityReloaded = false;
    try { integrityReloaded = sessionStorage.getItem(INTEGRITY_KEY) === "1"; } catch (eInt1) {}
    if (!integrityReloaded) {
      try { sessionStorage.setItem(INTEGRITY_KEY, "1"); } catch (eInt2) {}
      location.reload();
      return; // 開き直すので、壊れたままの状態では動かさない
    }
    var integrityBar = document.createElement("div");
    integrityBar.setAttribute("role", "alert");
    integrityBar.style.cssText = "position:sticky;top:0;z-index:9999;background:#b3261e;color:#fff;"
      + "padding:10px 14px;font-size:14px;line-height:1.6;";
    integrityBar.textContent = "アプリの更新が途中の状態で開かれています。このタブをいったん閉じて、開き直してください。"
      + "（それでも直らないときは、ほかのタブで開いたままのこのアプリを閉じてから、もう一度お試しください）";
    if (document.body) {
      document.body.insertBefore(integrityBar, document.body.firstChild);
      document.body.classList.remove("booting"); // 目隠しを外して案内を見えるようにする
    }
    return; // ここで止める（入力しても保存されない状態で触らせない）
  }
  try { sessionStorage.removeItem(INTEGRITY_KEY); } catch (eInt3) {}

  var MASTER_KEY = NS + "-master-v1"; // 料金マスタ（全担当・全端末で共通）
  var STATE_KEY = NS + "-state-v1";   // 見積もり（担当グループごとに分かれる）
  // 見積もりデータは担当グループごとに別領域へ保存する（担当Aは従来キーを引き継ぐ）
  // 見積もりは担当者ごとに別の領域へ保存する
  function quoteKey(staffId) {
    return STATE_KEY + ":" + (staffId || activeStaff().id);
  }
  /* 1商談の中の別の番号（回線）。表示名は「回線1・回線2・回線3」 */
  var PAT_NAMES = ["回線1", "回線2", "回線3"];
  var OPT_CATEGORIES = ["補償", "バックアップ", "セキュリティ", "エンタメ", "その他"];
  /* ④のカテゴリの表示順。店舗が並び替えたら MASTER.optCatOrder に入る。
   * 中身の判定（どのカテゴリに属すか）は従来どおり OPT_CATEGORIES を使い、
   * こちらは「表示する順番」だけを差し替える。 */
  function optCategories() {
    var o = (typeof MASTER !== "undefined" && MASTER && MASTER.optCatOrder) || null;
    if (!o || !o.length) return OPT_CATEGORIES;
    var seen = {};
    var out = o.filter(function (c) {
      if (seen[c] || OPT_CATEGORIES.indexOf(c) < 0) return false;
      seen[c] = true; return true;
    });
    OPT_CATEGORIES.forEach(function (c) { if (!seen[c]) out.push(c); });
    return out;
  }
  /* ①〜⑨のカードの表示順（見積もり画面）。MASTER.quoteCardOrder に入る。
   * 丸数字はカードの名前の一部なので、並び替えても番号はそのカードに付いて動く。 */
  var QUOTE_CARDS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];
  var QUOTE_CARD_NAMES = {
    c1: "① 契約内容", c2: "② 通話・メール", c3: "③ 割引", c4: "④ オプション・サービス",
    c5: "⑤ 端末代金", c6: "⑥ アクセサリ", c7: "⑦ 初期費用", c8: "⑧ ポイント", c9: "⑨ 備考・その他特記事項"
  };
  function quoteCardOrder() {
    var o = (typeof MASTER !== "undefined" && MASTER && MASTER.quoteCardOrder) || null;
    if (!o || !o.length) return QUOTE_CARDS;
    var seen = {};
    var out = o.filter(function (c) {
      if (seen[c] || QUOTE_CARDS.indexOf(c) < 0) return false;
      seen[c] = true; return true;
    });
    QUOTE_CARDS.forEach(function (c) { if (!seen[c]) out.push(c); });
    return out;
  }
  /* ①〜⑨の丸数字を、いまの並び順に合わせて振り直す。
   * 番号はカードの見出しと「?」の説明の題名に出る。
   * 説明文やボタンの文の中に出てくる丸数字（「⑦の事務手数料」など）は、
   * remapCircled() でその都度置き換える。 */
  var CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
  function renumberQuoteCards() {
    var order = quoteCardOrder();
    order.forEach(function (k, i) {
      var card = document.querySelector("#tab-quote .card." + k);
      var h2 = card && card.querySelector("h2");
      if (h2 && h2.firstChild && h2.firstChild.nodeType === 3) {
        h2.firstChild.nodeValue = h2.firstChild.nodeValue.replace(/^[①-⑨]/, CIRCLED[i]);
      }
      if (typeof QUOTE_HELP === "object" && QUOTE_HELP && QUOTE_HELP[k] && QUOTE_HELP[k].t) {
        QUOTE_HELP[k].t = QUOTE_HELP[k].t.replace(/^[①-⑨]/, CIRCLED[i]);
      }
    });
    /* 画面（index.html）に直書きの説明文のうち、data-remap-circled の印が
     * 付いたものは文中の番号も追随させる。元の文を data-orig に控えておき、
     * 毎回そこから置き換える（置き換えの上に置き換えを重ねない）。 */
    document.querySelectorAll("[data-remap-circled]").forEach(function (el) {
      if (!el.getAttribute("data-orig")) el.setAttribute("data-orig", el.innerHTML);
      el.innerHTML = remapCircled(el.getAttribute("data-orig")); // 元は直書きの固定文だけ（入力値は入らない）
    });
  }
  /* 文中の丸数字を、いまの並び順の番号に置き換える。
   * 説明文はどれも初期の並び（①契約内容 … ⑨備考）を前提に書いてあるため、
   * 「その番号のカードが、いま何番目にあるか」で置き換える。初期の並びなら何もしない。
   * 注意: 「①〜⑨」のような範囲の言い方には使わない（範囲の意味が壊れるため）。 */
  function remapCircled(text) {
    var order = quoteCardOrder();
    if (order.join(",") === QUOTE_CARDS.join(",")) return String(text);
    return String(text).replace(/[①-⑨]/g, function (d) {
      var pos = order.indexOf(QUOTE_CARDS[CIRCLED.indexOf(d)]);
      return pos >= 0 ? CIRCLED[pos] : d;
    });
  }
  /* 並びの指定どおりにカードを差し替える。既定の並びのときは何もせず、
   * 2列レイアウトの列の固定（CSS）もそのまま生かす。 */
  function applyQuoteCardOrder() {
    var tab = document.getElementById("tab-quote");
    if (!tab) return;
    var order = quoteCardOrder();
    var custom = order.join(",") !== QUOTE_CARDS.join(",");
    var els = {};
    QUOTE_CARDS.forEach(function (k) { els[k] = tab.querySelector(".card." + k); });
    if (QUOTE_CARDS.some(function (k) { return !els[k]; })) return;
    tab.classList.toggle("custom-order", custom);
    // 現在の並びと同じなら差し替えない（入力中のフォーカスを守る）
    var cur = [];
    QUOTE_CARDS.map(function (k) { return els[k]; })
      .sort(function (a, b) { return a.compareDocumentPosition(b) & 2 ? 1 : -1; })
      .forEach(function (el) {
        QUOTE_CARDS.forEach(function (k) { if (els[k] === el) cur.push(k); });
      });
    if (cur.join(",") === order.join(",")) { renumberQuoteCards(); return; }
    var anchor = els[cur[cur.length - 1]].nextSibling; // いまの最後のカードの直後
    order.forEach(function (k) { tab.insertBefore(els[k], anchor); });
    renumberQuoteCards();
  }

  /* ---------- 店舗設定（店舗名・担当者） ---------- */
  /* ---------- 端末内保存の共通入口 ----------
   * localStorage への大事な保存はすべて lsSet() を通す。
   * 容量超過などで保存に失敗すると、以前は何も出ないまま「保存できたつもり」に
   * なり、あとからデータが消えた形で発覚していた。失敗したら画面上部に警告を出す。 */
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      storageWarn();
      return false;
    }
  }
  var storageWarnTimer = null;
  function storageWarn() {
    var el = document.getElementById("storageWarn");
    if (!el) return;
    el.hidden = false;
    clearTimeout(storageWarnTimer);
    storageWarnTimer = setTimeout(function () { el.hidden = true; }, 12000);
  }
  // この端末（同じサイトの全アプリ合計）の保存領域の使用量
  function storageUsageText() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        total += (k.length + (localStorage.getItem(k) || "").length) * 2;
      }
    } catch (e) { return "不明"; }
    return (total / 1024 / 1024).toFixed(2) + "MB";
  }

  var CFG_KEY = NS + "-config-v1";
  var config;
  function defaultConfig() {
    return {
      storeName: "", storeTel: "", staff: [{ id: "s1", name: "担当1", code: "" }], activeStaffId: "s1",
      // 端末内で使う場合の店舗ログイン（Firebase未設定のときだけ使う）
      lock: { storeId: "", hash: "", salt: "", algo: "" },
      // マスタ設定を開くためのパスワード（未設定なら店舗ログインのパスワードを使う）
      adminLock: { hash: "", salt: "", algo: "" }
    };
  }
  function loadConfig() {
    config = defaultConfig();
    try {
      var saved = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (saved && saved.staff && saved.staff.length) config = Object.assign(defaultConfig(), saved);
    } catch (e) {}
    if (!config.lock) config.lock = { storeId: "", hash: "", salt: "", algo: "" };
    if (!config.adminLock) config.adminLock = { hash: "", salt: "", algo: "" };
    config.staff.forEach(function (s2, i) {
      if (!s2.id) s2.id = "s" + (i + 1);
      if (typeof s2.code !== "string") s2.code = "";
    });
  }
  function saveConfig() {
    lsSet(CFG_KEY, JSON.stringify(config));
    if (typeof pushConfig === "function") pushConfig();
  }
  function activeStaff() {
    var s2 = config.staff.filter(function (x) { return x.id === config.activeStaffId; })[0];
    if (!s2) { s2 = config.staff[0]; config.activeStaffId = s2.id; }
    return s2;
  }
  /* 担当者のID。空き番号の再利用はしない。
   * 以前は最小の空き番号を使っていたため、退職者を消して新しい人を足すと
   * 同じIDになり、クラウドに残った前任者の保存見積もり・テンプレを
   * 新しい人がそのまま引き継いでしまった。 */
  function newStaffId() {
    var mx = 0;
    config.staff.forEach(function (s2) {
      var m = /^s(\d+)$/.exec(s2.id || "");
      if (m) mx = Math.max(mx, +m[1]);
    });
    config.staffSeq = Math.max(num(config.staffSeq), mx) + 1;
    return "s" + config.staffSeq;
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
  // マスタ設定のパスワードの状態を画面に反映する
  function renderAdminLock() {
    var st = $("adminLockState");
    if (!st) return;
    var on = adminLockEnabled();
    st.textContent = on
      ? "設定中です。マスタ設定を開くときは、このパスワードを使います。"
      : "未設定です。マスタ設定を開くときは、店舗ID＋店舗のパスワードを使います。";
    st.className = "hint" + (on ? " lock-on" : "");
    var clr = $("adminLockClearBtn");
    if (clr) clr.hidden = !on;
    var save = $("adminLockSaveBtn");
    if (save) save.textContent = on ? "パスワードを変更する" : "この内容で設定する";
  }
  // 設定タブの店舗設定カードを描き直す
  function renderStoreConfig() {
    var nameEl = $("storeNameInput");
    if (nameEl && nameEl.value !== (config.storeName || "")) nameEl.value = config.storeName || "";
    var telEl = $("storeTelInput");
    if (telEl && telEl.value !== (config.storeTel || "")) telEl.value = config.storeTel || "";
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
  var TPL_KEY = NS + "-tpl-v1";
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
    lsSet(tplKey(), JSON.stringify(templates));
    if (typeof pushTemplates === "function") pushTemplates();
  }
  /* 店舗共通テンプレート（3枠）。担当者の3枠とは別に、店の「鉄板構成」を
   * 全担当で共有する。誰でも保存・削除できる（枠が別なので、担当者ごとの
   * テンプレートが上書きされる昔の事故は起きない）。
   * 端末内は kq-tpl-v1:_store、クラウドは templates/_store に持つ。 */
  var STORE_TPL_ID = "_store";
  var storeTemplates = [null, null, null];
  function loadStoreTemplates() {
    storeTemplates = [null, null, null];
    try {
      var a = JSON.parse(localStorage.getItem(tplKey(STORE_TPL_ID)) || "null");
      if (a && a.length === 3) storeTemplates = a;
    } catch (e) {}
  }
  function persistStoreTemplates() {
    lsSet(tplKey(STORE_TPL_ID), JSON.stringify(storeTemplates));
    if (typeof pushStoreTemplates === "function") pushStoreTemplates();
  }

  var SAVED_KEY = NS + "-saved-v1";
  /* 保存できる件数。1か月をあとから振り返って分析するため多めに持つ。
   * ただしクラウドは1件のデータに上限（約1MB）があるので、
   * 新しい SAVED_FULL 件だけ見積もりの中身をそのまま持ち、
   * それより古いものは実績の集計に要る項目だけに軽くする（slimSavedItem）。 */
  var SAVED_MAX = 300;
  var SAVED_FULL = 60;
  /* 実績の集計で見ているパターンの項目。これ以外は古い保存から落とす。 */
  var HEARTY_VOICE_OFF = 880;   // ハーティ割引の通話オプション割引（税込）
  /* 子育てサポート割引の通話オプション割引（税込）。
   * 出典: docomo.ne.jp/charge/kosodate_wari/（2026-08-20 確認）
   * 月額の割引額はプランごとに違うため data.js の discounts.kosodate に持つ。 */
  var KOSODATE_VOICE_OFF = 880;
  var SLIM_PATTERN_KEYS = ["planId", "planChange", "procType", "procTodo", "visitPurposes", "visitPurpose", "hearty", "kosodate",
    "kaimashi", "u15", "devicePrice", "atamakin", "deviceName", "payMethod", "todoDcard", "todoDcardType", "todoDenki", "todoDenkiType",
    "todoGas", "todoHikari", "options", "optionKubun", "feeItems", "accSel"];

  /* ---------- 大阪ガス（ドコモガス）エリアの目安判定 ----------
   * 郵便番号の上3桁 → その番号帯に含まれる市区町村と、供給エリア上の扱い。
   *   2 = 全域が供給エリア ／ 1 = 一部のみ（番地単位の除外あり・要確認） ／ 0 = 資料の対象外
   * 出典: ドコモガス取扱いの大阪ガス供給エリア資料（2024-02-01版）を
   *       郵便番号データ（日本郵便・2026-08時点の写し）と突き合わせて機械生成。
   * あくまで目安。最終判定はお申込み時の受付で行われる旨を必ず添える。
   * 入力した郵便番号はどこにも保存しない（判定にだけ使う）。 */
  var GAS_AREA_ZIP = {"520":[["京都市左京区",1],["大津市",1],["栗東市",1],["湖南市",1],["甲賀市",1],["蒲生郡竜王町",1],["野洲市",1],["高島市",0]],"521":[["彦根市",1],["東近江市",1],["米原市",1],["近江八幡市",1]],"522":[["彦根市",1],["犬上郡多賀町",1],["犬上郡甲良町",1]],"523":[["蒲生郡竜王町",1],["近江八幡市",1]],"524":[["守山市",1]],"525":[["草津市",1]],"526":[["長浜市",1]],"527":[["東近江市",1]],"528":[["甲賀市",1]],"529":[["彦根市",1],["愛知郡愛荘町",1],["東近江市",1],["甲賀市",1],["蒲生郡日野町",1],["長浜市",1],["犬上郡豊郷町",0]],"530":[["大阪市中央区",2],["大阪市北区",2]],"531":[["大阪市北区",2]],"532":[["大阪市淀川区",2]],"533":[["大阪市東淀川区",2]],"534":[["大阪市都島区",2]],"535":[["大阪市旭区",2]],"536":[["大阪市城東区",2]],"537":[["大阪市東成区",2]],"538":[["大阪市鶴見区",2]],"539":[["伊丹市",2],["大阪市中央区",2]],"540":[["大阪市中央区",2]],"541":[["大阪市中央区",2]],"542":[["大阪市中央区",2]],"543":[["大阪市天王寺区",2]],"544":[["大阪市生野区",2]],"545":[["大阪市阿倍野区",2]],"546":[["大阪市東住吉区",2]],"547":[["大阪市平野区",2]],"549":[["泉南郡田尻町",2],["泉佐野市",1],["泉南市",1]],"550":[["大阪市西区",2]],"551":[["大阪市大正区",2]],"552":[["大阪市港区",2]],"553":[["大阪市福島区",2]],"554":[["大阪市此花区",2]],"555":[["大阪市西淀川区",2]],"556":[["大阪市浪速区",2]],"557":[["大阪市西成区",2]],"558":[["大阪市住吉区",2]],"559":[["大阪市住之江区",2]],"560":[["豊中市",2]],"561":[["豊中市",2]],"562":[["箕面市",1]],"563":[["伊丹市",2],["池田市",1],["箕面市",1],["豊能郡能勢町",1],["豊能郡豊能町",1]],"564":[["吹田市",2]],"565":[["吹田市",2]],"566":[["摂津市",2]],"567":[["茨木市",1]],"568":[["茨木市",1]],"569":[["高槻市",1]],"570":[["守口市",2]],"571":[["門真市",2]],"572":[["寝屋川市",2]],"573":[["枚方市",2]],"574":[["大東市",1]],"575":[["四條畷市",1]],"576":[["交野市",1]],"577":[["東大阪市",2]],"578":[["東大阪市",2]],"579":[["東大阪市",2]],"580":[["松原市",2]],"581":[["八尾市",2]],"582":[["柏原市",2]],"583":[["羽曳野市",2],["藤井寺市",2],["南河内郡太子町",1]],"584":[["富田林市",1]],"585":[["南河内郡河南町",1],["南河内郡千早赤阪村",0]],"586":[["河内長野市",1]],"587":[["堺市美原区",2]],"589":[["大阪狭山市",1]],"590":[["堺市堺区",2],["堺市南区",1],["泉南市",1],["泉南郡熊取町",1],["貝塚市",1]],"591":[["堺市北区",2]],"592":[["堺市西区",2],["高石市",2]],"593":[["堺市西区",2]],"594":[["和泉市",1]],"595":[["泉北郡忠岡町",2],["泉大津市",2],["高石市",2]],"596":[["岸和田市",1]],"597":[["貝塚市",1]],"598":[["泉南郡田尻町",2],["泉佐野市",1]],"599":[["堺市中区",2],["堺市東区",2],["泉南郡岬町",1],["阪南市",1]],"600":[["京都市下京区",2]],"601":[["京都市南区",2],["京都市伏見区",1],["京都市北区",1],["京都市右京区",1],["京都市左京区",1],["宇治市",1],["南丹市",0]],"602":[["京都市上京区",2]],"603":[["京都市北区",1]],"604":[["京都市中京区",2]],"605":[["京都市東山区",2]],"606":[["京都市左京区",1]],"607":[["京都市山科区",1]],"610":[["京田辺市",1],["京都市西京区",1],["城陽市",1],["綴喜郡井手町",1],["綴喜郡宇治田原町",1]],"611":[["宇治市",1]],"612":[["京都市伏見区",1]],"613":[["久世郡久御山町",2],["八幡市",2],["京都市伏見区",1]],"614":[["八幡市",2]],"615":[["京都市右京区",1],["京都市西京区",1]],"616":[["京都市右京区",1],["京都市西京区",1]],"617":[["向日市",2],["長岡京市",1]],"618":[["乙訓郡大山崎町",2],["三島郡島本町",1]],"619":[["木津川市",1],["相楽郡精華町",1],["相楽郡南山城村",0],["相楽郡和束町",0],["相楽郡笠置町",0]],"620":[["福知山市",0]],"621":[["亀岡市",1]],"622":[["南丹市",0],["船井郡京丹波町",0]],"623":[["綾部市",0]],"624":[["舞鶴市",0]],"625":[["舞鶴市",0]],"626":[["与謝郡伊根町",0],["宮津市",0]],"627":[["京丹後市",0]],"629":[["与謝郡与謝野町",0],["京丹後市",0],["南丹市",0],["宮津市",0],["福知山市",0],["綾部市",0],["船井郡京丹波町",0]],"630":[["東大阪市",2],["奈良市",1],["生駒市",1],["山辺郡山添村",0]],"631":[["奈良市",1]],"632":[["天理市",1],["奈良市",1],["宇陀市",0]],"633":[["吉野郡東吉野村",0],["宇陀市",0],["宇陀郡御杖村",0],["宇陀郡曽爾村",0],["桜井市",0]],"634":[["橿原市",0],["高市郡明日香村",0]],"635":[["北葛城郡広陵町",1],["大和高田市",1],["高市郡高取町",0]],"636":[["北葛城郡王寺町",2],["生駒郡三郷町",2],["北葛城郡河合町",1],["生駒郡平群町",1],["生駒郡斑鳩町",1],["磯城郡川西町",1],["磯城郡田原本町",1],["磯城郡三宅町",0]],"637":[["五條市",0],["吉野郡十津川村",0],["吉野郡野迫川村",0]],"638":[["五條市",0],["吉野郡下市町",0],["吉野郡大淀町",0],["吉野郡天川村",0],["吉野郡黒滝村",0]],"639":[["北葛城郡上牧町",1],["大和郡山市",1],["生駒郡安堵町",1],["香芝市",1],["吉野郡上北山村",0],["吉野郡下北山村",0],["吉野郡吉野町",0],["吉野郡大淀町",0],["吉野郡川上村",0],["御所市",0],["葛城市",0]],"640":[["和歌山市",1],["海南市",1],["伊都郡かつらぎ町",0],["海草郡紀美野町",0],["紀の川市",0]],"641":[["和歌山市",1]],"642":[["海南市",1]],"643":[["伊都郡かつらぎ町",0],["有田郡広川町",0],["有田郡有田川町",0],["有田郡湯浅町",0]],"644":[["御坊市",0],["日高郡印南町",0],["日高郡日高川町",0],["日高郡美浜町",0]],"645":[["日高郡みなべ町",0],["日高郡日高川町",0],["田辺市",0]],"646":[["田辺市",0],["西牟婁郡白浜町",0]],"647":[["吉野郡十津川村",0],["新宮市",0],["東牟婁郡北山村",0],["熊野市",0],["田辺市",0]],"648":[["伊都郡かつらぎ町",0],["伊都郡九度山町",0],["伊都郡高野町",0],["吉野郡野迫川村",0],["橋本市",0]],"649":[["和歌山市",1],["岩出市",1],["海南市",1],["伊都郡かつらぎ町",0],["御坊市",0],["日高郡印南町",0],["日高郡日高川町",0],["日高郡日高町",0],["日高郡由良町",0],["有田市",0],["東牟婁郡串本町",0],["東牟婁郡古座川町",0],["東牟婁郡太地町",0],["東牟婁郡那智勝浦町",0],["橋本市",0],["紀の川市",0],["西牟婁郡すさみ町",0],["西牟婁郡上富田町",0],["西牟婁郡白浜町",0]],"650":[["神戸市中央区",2],["神戸市西区",1]],"651":[["神戸市中央区",2],["神戸市須磨区",2],["神戸市北区",1],["神戸市西区",1],["西宮市",1]],"652":[["神戸市兵庫区",2],["神戸市北区",1]],"653":[["神戸市長田区",2]],"654":[["神戸市須磨区",2]],"655":[["神戸市垂水区",2]],"656":[["南あわじ市",0],["洲本市",0],["淡路市",0]],"657":[["神戸市東灘区",2],["神戸市灘区",2]],"658":[["神戸市東灘区",2]],"659":[["芦屋市",2]],"660":[["尼崎市",2]],"661":[["尼崎市",2]],"662":[["西宮市",1]],"663":[["西宮市",1]],"664":[["伊丹市",2]],"665":[["宝塚市",1],["川西市",1]],"666":[["宝塚市",1],["川西市",1],["川辺郡猪名川町",1]],"667":[["美方郡香美町",0],["養父市",0]],"668":[["豊岡市",0]],"669":[["三田市",1],["宝塚市",1],["神戸市北区",1],["西宮市",1],["丹波市",0],["丹波篠山市",0],["朝来市",0],["美方郡新温泉町",0],["美方郡香美町",0],["豊岡市",0]],"670":[["姫路市",1]],"671":[["たつの市",1],["姫路市",1],["揖保郡太子町",1],["高砂市",1],["宍粟市",0]],"672":[["姫路市",1]],"673":[["明石市",2],["三木市",1],["加東市",1]],"674":[["明石市",2]],"675":[["加古郡播磨町",2],["加古川市",1],["加古郡稲美町",1],["加西市",1],["小野市",1]],"676":[["高砂市",1]],"677":[["多可郡多可町",0],["西脇市",0]],"678":[["相生市",1],["赤穂市",1],["赤穂郡上郡町",0]],"679":[["たつの市",1],["佐用郡佐用町",1],["加東市",1],["加西市",1],["姫路市",1],["多可郡多可町",0],["朝来市",0],["神崎郡市川町",0],["神崎郡神河町",0],["神崎郡福崎町",0],["西脇市",0]],"700":[["岡山市中区",0],["岡山市北区",0],["岡山市南区",0],["岡山市東区",0]],"701":[["倉敷市",0],["備前市",0],["岡山市北区",0],["岡山市南区",0],["瀬戸内市",0],["美作市",0],["赤磐市",0],["都窪郡早島町",0]],"702":[["岡山市中区",0],["岡山市南区",0]],"703":[["岡山市中区",0],["岡山市北区",0],["岡山市東区",0]],"704":[["岡山市東区",0]],"705":[["備前市",0]],"706":[["玉野市",0]],"707":[["美作市",0],["英田郡西粟倉村",0]],"708":[["久米郡美咲町",0],["勝田郡奈義町",0],["津山市",0],["苫田郡鏡野町",0]],"709":[["久米郡久米南町",0],["久米郡美咲町",0],["備前市",0],["加賀郡吉備中央町",0],["勝田郡勝央町",0],["和気郡和気町",0],["岡山市北区",0],["岡山市南区",0],["岡山市東区",0],["津山市",0],["美作市",0],["赤磐市",0]],"710":[["倉敷市",0],["岡山市南区",0],["総社市",0]],"711":[["倉敷市",0]],"712":[["倉敷市",0]],"713":[["倉敷市",0]],"714":[["井原市",0],["小田郡矢掛町",0],["浅口市",0],["笠岡市",0]],"715":[["井原市",0]],"716":[["加賀郡吉備中央町",0],["真庭市",0],["高梁市",0]],"717":[["真庭市",0],["真庭郡新庄村",0]],"718":[["新見市",0]],"719":[["新見市",0],["浅口市",0],["浅口郡里庄町",0],["真庭市",0],["総社市",0],["高梁市",0]]};
  function renderGasArea() {
    var inp = $("gasAreaZip"), out = $("gasAreaResult");
    if (!inp || !out) return;
    var d = String(inp.value || "").replace(/\D/g, "");
    if (d.length < 3) { out.innerHTML = ""; return; }
    var list = GAS_AREA_ZIP[d.slice(0, 3)];
    var h;
    if (!list) {
      h = '<span style="color:#C62828">× この郵便番号は、大阪ガスの供給エリア資料の対象外です</span>';
    } else {
      h = list.map(function (x) {
        return x[1] === 2 ? '<b style="color:#1B5E20">○ ' + esc(x[0]) + "（全域が対象）</b>"
             : x[1] === 1 ? '<b style="color:#B26A00">△ ' + esc(x[0]) + "（一部対象外あり・要確認）</b>"
             : '<span style="color:#C62828">× ' + esc(x[0]) + "（対象外）</span>";
      }).join("　");
    }
    out.innerHTML = h + '<span class="hint" style="display:block">郵便番号の上3桁での目安です。番地単位の除外があるため、最終のエリア判定はお申込み時の受付で確認されます。入力した郵便番号は保存されません。</span>';
  }

  function slimData(d) {
    if (!d) return d;
    var out = { active: d.active | 0, patterns: (d.patterns || []).map(function (pt) {
      var o = {};
      SLIM_PATTERN_KEYS.forEach(function (k) { if (pt && pt[k] !== undefined) o[k] = pt[k]; });
      return o;
    }) };
    if (d.ienaka) out.ienaka = { enabled: !!d.ienaka.enabled, product: d.ienaka.product || "" };
    return out;
  }
  function slimSavedItem(it) {
    if (!it || it.slim) return it;
    it.data = slimData(it.data);
    if (it.wonData) it.wonData = slimData(it.wonData);
    it.slim = true;
    return it;
  }
  /* 新しい方から SAVED_FULL 件を残して、それより古いものを軽くする。
   * 件数の上限も合わせてここで掛ける。 */
  function trimSavedList(list) {
    list.sort(function (a2, b2) { return (b2.savedAt || 0) - (a2.savedAt || 0); });
    if (list.length > SAVED_MAX) list = list.slice(0, SAVED_MAX);
    for (var i = SAVED_FULL; i < list.length; i++) slimSavedItem(list[i]);
    return list;
  }
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
    lsSet(savedKey(), JSON.stringify(savedList));
    if (typeof pushSaved === "function") pushSaved();
  }
  /* 保存一覧は端末をまたいで使う（iPadで見積もり→PCで印刷など）ため、
   * クラウドとは全文の置き換えではなく「統合（マージ）」で揃える。
   * ・同じ保存は、更新時刻（upAt/resultAt/savedAt）の新しい方を採用
   * ・削除だけは下の記録で他の端末へ伝える（無いと削除した保存が復活する） */
  var SAVED_DEL_KEY = NS + "-saved-del-v1";
  function savedDelKey(staffId) { return SAVED_DEL_KEY + ":" + (staffId || activeStaff().id); }
  function loadSavedDel(staffId) {
    try { return JSON.parse(localStorage.getItem(savedDelKey(staffId)) || "null") || {}; } catch (e) { return {}; }
  }
  function saveSavedDel(staffId, map) {
    // 90日より古い削除の記録は捨てる（増え続けるだけのため）
    var lim = Date.now() - 90 * 24 * 60 * 60 * 1000;
    Object.keys(map).forEach(function (k) { if (map[k] < lim) delete map[k]; });
    lsSet(savedDelKey(staffId), JSON.stringify(map));
  }
  function savedItemTs(it) { return it.upAt || it.resultAt || it.savedAt || 0; }
  // 保存名は他の端末にも同期されるため、お客様名は既定に入れない
  function savedDefaultName() {
    var d = new Date();
    var mm = ("0" + (d.getMonth() + 1)).slice(-2), dd = ("0" + d.getDate()).slice(-2);
    var plan = state.planId ? currentPlan().name : "";
    return (d.getFullYear() + "/" + mm + "/" + dd) + (plan ? " " + plan : "");
  }
  var quickSaveTimer = null;
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
      upAt: Date.now(),
      data: JSON.parse(JSON.stringify(store))
    };
    savedList.unshift(item);
    savedList = trimSavedList(savedList);
    persistSaved();
    renderSaved();
    // いま保存した内容＝この応対の提案。あとで「成約」を押したらここに紐づく
    propSrcId = item.id;
    if (!propSnap) propSnap = JSON.parse(JSON.stringify(item.data));
    return item;
  }
  // 保存済みの見積もりを開く（いまの入力内容は置き換わる）
  function loadSavedQuote(id) {
    var it = savedList.filter(function (x) { return x.id === id; })[0];
    if (!it || !it.data || !it.data.patterns) return false;
    store.active = Math.min(Math.max(it.data.active | 0, 0), 2);
    for (var i = 0; i < 3; i++) {
      store.patterns[i] = Object.assign(defaultState(), it.data.patterns[i] || {});
      migratePattern(store.patterns[i]);
    }
    state = store.patterns[store.active];
    applyIenaka(it.data.ienaka);
    saveState();
    syncFormFromState();
    recalc();
    // この応対はこの保存の続き。保存した内容を提案として控える
    propSrcId = id;
    propSnap = JSON.parse(JSON.stringify(it.data));
    return true;
  }
  function deleteSavedQuote(id) {
    savedList = savedList.filter(function (x) { return x.id !== id; });
    var del = loadSavedDel();
    del[id] = Date.now();
    saveSavedDel(null, del);
    persistSaved();
    renderSaved();
  }
  function savedNote(text) {
    var el = $("savedMsg");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    if (savedNote.t) clearTimeout(savedNote.t);
    savedNote.t = setTimeout(function () { el.hidden = true; }, 6000);
  }

  /* ---------- 見積もりなしの成約 ----------
   * 故障・操作・問合せなどで来店され、見積もりを作らずに何かが決まったとき、
   * 成約した項目を −・＋の件数で残す（2台の機種変更なら2件）。応対1件としても数える。 */
  function openNoQuoteDlg() {
    var dlg = $("nqDlg");
    if (!dlg) return;
    var vWrap = $("nqVisits"), iWrap = $("nqItems"), err = $("nqErr");
    vWrap.innerHTML = VISIT_ORDER.map(function (k) {
      return '<label class="check"><input type="checkbox" data-nqv="' + k + '"> ' + esc(VISIT_NAMES[k]) + "</label>";
    }).join("");
    var cat = statsCatalog();
    var nqOrder = ["proc:kishu", "kaimashi", "proc:mnp", "proc:shinki", "u15", "highend", "device",
      "proc:", "plan:", "dcard:", "denki:", "gas", "ie:", "opt:", "maxAmazon", "fee:", "own:", "acc:"];
    function nqRank(k) {
      for (var i = 0; i < nqOrder.length; i++) if (k.indexOf(nqOrder[i]) === 0) return i;
      return nqOrder.length;
    }
    var nqKeys = Object.keys(cat).sort(function (a2, b2) {
      return (nqRank(a2) - nqRank(b2)) || (cat[a2] < cat[b2] ? -1 : 1);
    });
    // 成約の確認画面と同じ −・＋の行。0のままの項目は数えない
    var counts = {};
    function nqRow(k) {
      var n = counts[k] || 0;
      return '<div class="res-item' + (n === 0 ? " res-zero" : "") + '" data-nqk="' + esc(k) + '">'
        + '<span class="res-name">' + esc(cat[k]) + "</span>"
        + '<button type="button" class="adjb" data-nq-d="-1" aria-label="1件減らす">−</button>'
        + '<b class="res-n">' + n + "</b>"
        + '<button type="button" class="adjb" data-nq-d="1" aria-label="1件増やす">＋</button>'
        + "</div>";
    }
    function nqRender() { iWrap.innerHTML = nqKeys.map(nqRow).join(""); }
    nqRender();
    function onItems(e) {
      var b = e.target.closest && e.target.closest("[data-nq-d]");
      if (!b) return;
      var k = b.closest("[data-nqk]").getAttribute("data-nqk");
      var next = (counts[k] || 0) + parseInt(b.getAttribute("data-nq-d"), 10);
      if (next < 0 || next > 99) return;
      if (next) counts[k] = next; else delete counts[k];
      nqRender();
    }
    iWrap.addEventListener("click", onItems);
    err.hidden = true;
    dlg.hidden = false;

    function close() {
      dlg.hidden = true;
      iWrap.removeEventListener("click", onItems);
      $("nqGo").removeEventListener("click", go);
      $("nqCancel").removeEventListener("click", close);
    }
    function go() {
      var vis = {}, its = {}, nItems = 0;
      Array.prototype.forEach.call(vWrap.querySelectorAll("[data-nqv]"), function (c) {
        if (c.checked) vis[c.getAttribute("data-nqv")] = true;
      });
      // 件数をそのまま持つ（以前の保存の true は「1件」として読む）
      Object.keys(counts).forEach(function (k) { its[k] = counts[k]; nItems++; });
      if (!nItems) {
        err.textContent = "成約した項目に、＋で件数を入れてください。";
        err.hidden = false;
        return;
      }
      var now = Date.now();
      var names = Object.keys(its).map(function (k) { return cat[k] || k; });
      var item = {
        id: "q" + now.toString(36) + Math.random().toString(36).slice(2, 6),
        name: "（見積もりなし）" + names.slice(0, 2).join("・") + (names.length > 2 ? " ほか" : ""),
        custName: "", planName: "", monthly: 0, initial: 0,
        savedAt: now, upAt: now,
        noQuote: true, noQuoteItems: its,
        result: "won", resultAt: now, resultStaff: activeStaff().id,
        data: { active: 0, patterns: [{ visitPurposes: vis }] }
      };
      savedList.unshift(item);
      savedList = trimSavedList(savedList);
      persistSaved();
      renderSaved();
      close();
      savedNote("見積もりなしの成約を記録しました（" + nItems + "項目）。");
      if (!$("statsPanel").hidden) renderStats(true);
    }
    $("nqGo").addEventListener("click", go);
    $("nqCancel").addEventListener("click", close);
  }

  /* 見積もりを他の担当へ渡す。
   * 店頭の流れ: コンデザが提案の見積もりを作る → 商談する担当者へ渡す →
   * 担当者が自分の保存一覧から開いて商談し、実際の成約内容を記録する。
   * 実績は「提案＝作った担当（コンデザ）」「成約・収益＝渡された担当」。
   * すでに成約・見送りが付いている場合は記録ごと渡す（渡した元は実績に
   * 数えないため、消すと成約が実績から消えてしまう）。成約・収益は
   * resultStaff（記録を付けた担当）のまま変わらない。
   * お客様名は端末内だけの情報なので渡さない。 */
  function forwardSaved(id) {
    var it = savedList.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var others = config.staff.filter(function (s2) { return s2.id !== activeStaff().id; });
    if (!others.length) { savedNote("渡せる担当がいません。マスタ設定で担当者を追加してください。"); return; }
    pickStaff({
      title: "担当へ渡す",
      lead: "「" + it.name + "」を担当の保存一覧に渡します。実績（提案・成約・収益）はすべて渡した担当に付き、この見積もりはあなたの実績には数えません。"
        + (it.result
            ? "すでに付いている成約・見送りの記録は消えずに一緒に渡ります（成約・収益は記録を付けた担当のままです）。"
            : "")
        + "お客様名と請求内訳の読み取りは渡りません（端末内だけの情報のため）。",
      label: "渡す担当", choices: others, value: others[0].id, okText: "渡す"
    }, function (to) {
      if (!to) return;
      var now = Date.now();
      var copy = JSON.parse(JSON.stringify(it));
      copy.id = "q" + now + "x" + Math.floor(Math.random() * 10000);
      copy.savedAt = now; copy.upAt = now;
      /* 成約・見送りの記録は消さずに控えごと渡す。渡した元は「渡し済み」で
       * 実績に数えないため、ここで消すと付けた成約が実績から消えてしまう。
       * 決めた担当（resultStaff）を必ず入れておき、渡した先の実績と混ざらないようにする。 */
      if (copy.result) {
        if (!copy.resultStaff) copy.resultStaff = activeStaff().id;
      } else {
        copy.result = ""; copy.resultAt = 0;
        delete copy.resultStaff; delete copy.wonData; delete copy.wonPattern;
      }
      delete copy.sentTo; delete copy.sentAt; delete copy.sentId;
      copy.fromStaff = activeStaff().id;
      copy.srcId = it.id;
      copy.custName = "";
      ((copy.data || {}).patterns || []).forEach(function (pt) { pt.custName = ""; delete pt.curBill; });
      // 成約時の控え（wonData）にもお客様名が入っている
      ((copy.wonData || {}).patterns || []).forEach(function (pt) { pt.custName = ""; delete pt.curBill; });
      it.sentTo = to; it.sentAt = now; it.sentId = copy.id; it.upAt = now;
      persistSaved();
      renderSaved();
      sendSavedTo(to, copy, it);
    });
  }
  function sendSavedTo(to, copy, src) {
    var nm = staffName(to);
    function localAdd() {
      var cur = [];
      try { cur = JSON.parse(localStorage.getItem(savedKey(to)) || "null") || []; } catch (e) {}
      if (!cur.some(function (x) { return x.id === copy.id; })) cur.unshift(copy);
      lsSet(savedKey(to), JSON.stringify(cur));
    }
    if (!cloudOn()) {
      localAdd();
      savedNote(nm + " に渡しました。この端末で " + nm + " に切り替えると保存一覧に入っています。");
      return;
    }
    syncStatus("同期中…", "");
    savedDoc(to).get().then(function (snap) {
      var d = snap.exists ? snap.data() : null;
      var list = [];
      try { list = JSON.parse((d && d.list) || "[]") || []; } catch (e) {}
      if (!list.some(function (x) { return x.id === copy.id; })) list.unshift(copy);
      return savedDoc(to).set(stamp({ list: JSON.stringify(list), del: (d && d.del) || "{}" }));
    }).then(function () {
      localAdd(); cloudOk();
      savedNote(nm + " に渡しました。" + nm + " の保存一覧に入っています。");
    }, function (err) {
      cloudNg(err);
      // 渡せなかったときは「渡した」印を戻す（成約を記録できないまま残らないように）
      if (src) { delete src.sentTo; delete src.sentAt; delete src.sentId; src.upAt = Date.now(); persistSaved(); renderSaved(); }
      savedNote("いまは渡せませんでした。通信できる場所でもう一度お試しください。");
    });
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
    // 検索と状態での絞り込み（保存タブの上の欄）
    var q = (($("savedSearch") && $("savedSearch").value) || "").trim().toLowerCase();
    var stFil = ($("savedStatus") && $("savedStatus").value) || "all";
    var list = savedList.filter(function (it) {
      if (stFil !== "all" && (it.result || "") !== stFil) return false;
      if (!q) return true;
      var hay = [it.name, it.custName, it.planName, savedWhen(it.savedAt)].join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if (!list.length) {
      el.innerHTML = '<p class="hint">条件に合う保存が見つかりません。</p>';
      return;
    }
    el.innerHTML = list.map(function (it) {
      return '<div class="saved-row">'
        + '<div class="saved-main">'
        + '<div class="saved-name">' + esc(it.name) + "</div>"
        + '<div class="saved-sub">' + savedWhen(it.savedAt)
        + (it.planName ? "　" + esc(it.planName) : "")
        + "　月額 " + yen(it.monthly || 0)
        + (it.initial ? "　初期費用 " + yen(it.initial) : "")
        + "</div></div>"
        + (it.noQuote
            ? '<div class="saved-status"><span class="saved-nq-mark">成約</span></div>'
            : it.sentTo
            ? '<div class="saved-status"><span class="saved-sent">' + esc(staffName(it.sentTo)) + " へ引き渡し済み</span></div>"
            : '<div class="saved-status">'
              + [["", "提案中"], ["won", "成約"], ["lost", "見送り"]].map(function (st2) {
                  return '<button type="button" class="saved-st' + ((it.result || "") === st2[0] ? " on" : "")
                    + '" data-savedresult="' + st2[0] + '" data-savedrid="' + it.id + '">' + st2[1] + "</button>";
                }).join("")
              + "</div>")
        + (it.noQuote
            ? '<span class="saved-nq">見積もりなしの成約</span>'
            : (it.slim
                ? '<span class="saved-slim">実績用（開けません）</span>'
                : '<button class="btn-sub" data-savedload="' + it.id + '" type="button">開く</button>'))
        + (config.staff.length > 1 && !it.fromStaff && !it.sentTo && !it.noQuote
            ? '<button class="btn-sub" data-savedsend="' + it.id + '" type="button">担当へ渡す</button>' : "")
        + '<button class="btn-sub saved-del" data-saveddel="' + it.id + '" type="button">削除</button>'
        + (it.result === "won" && it.wonData
            ? '<div class="saved-wonnote">成約した内容を記録済み（保存したときの提案内容と分けて実績に集計されます）</div>'
            : "")
        + (it.fromStaff
            ? '<div class="saved-wonnote">' + esc(staffName(it.fromStaff))
              + " から受け取った見積もりです"
              + (it.result && it.resultStaff && it.resultStaff !== activeStaff().id
                  ? "（成約・見送りの記録ごと受け取りました）"
                  : "（提案・成約・収益はすべてあなたの実績になります）")
              + "</div>"
            : "")
        + (it.sentTo
            ? '<div class="saved-wonnote">' + esc(staffName(it.sentTo))
              + " に渡しました（実績は " + esc(staffName(it.sentTo))
              + " に付きます。この見積もりはあなたの実績には数えません）</div>"
            : "")
        + (it.result && it.resultStaff && it.resultStaff !== activeStaff().id
            ? '<div class="saved-wonnote">' + (it.result === "won" ? "成約" : "見送り") + "を決めた担当: "
              + esc(staffName(it.resultStaff))
              + "（収益はこの担当に付きます）</div>"
            : "")
        + "</div>";
    }).join("");
  }

  /* ---------- 実績のかんたん記録 ----------
   * 店頭の流れを増やさないための仕組み。
   * ・見積書タブを開いた時点（＝お客様に見せた時点）の内容を、
   *   自動で「提案内容」として控える（操作は要らない）
   * ・応対の最後に、見積もり画面の「成約」「見送り」を1回押すだけで、
   *   控えてある提案内容＋いまの内容（成約時）が実績として保存される
   * ・保存から開いた応対はその保存に紐づける（二重登録しない）。
   *   「現在の見積もりを保存」も同じ応対として紐づける */
  var propSnap = null;   // 提案内容の控え（store のクローン）
  var propSrcId = null;  // この応対が紐づく保存のid
  function markPropOpened() {
    // 見積書を最初に開いたときだけ控える（開き直しでは上書きしない）
    if (!propSnap) propSnap = JSON.parse(JSON.stringify(store));
  }
  function resetPropTracking() { propSnap = null; propSrcId = null; }
  /* 成約・見送りを記録するときの確認。担当が2名以上いる店舗では
   * 「決めた担当」を選べる（コンデザが提案を作り、担当者が成約を決める運用）。
   * 既定はログイン中の担当なので、1人で完結する運用では今までどおり。 */
  /* 担当を選ぶ小さなダイアログ。成約を決めた担当と、見積もりの引き渡し先で使う */
  function pickStaff(opt, done) {
    var dlg = $("resultDlg");
    if (!dlg) { done(null); return; }
    $("resultDlgTitle").textContent = opt.title;
    $("resultDlgLead").textContent = opt.lead || "";
    var sel = $("resultDlgStaff");
    sel.innerHTML = opt.choices.map(function (s2) {
      return '<option value="' + esc(s2.id) + '">' + esc(s2.name || s2.id) + "</option>";
    }).join("");
    if (opt.value) sel.value = opt.value;
    $("resultDlgStaffWrap").querySelector("label").textContent = opt.label;
    $("resultDlgOk").textContent = opt.okText || "記録する";
    dlg.hidden = false;
    function close() {
      dlg.hidden = true;
      $("resultDlgOk").removeEventListener("click", ok);
      $("resultDlgCancel").removeEventListener("click", close);
    }
    function ok() { var v = sel.value; close(); done(v); }
    $("resultDlgOk").addEventListener("click", ok);
    $("resultDlgCancel").addEventListener("click", close);
  }
  function staffName(id) {
    return (config.staff.filter(function (s2) { return s2.id === id; })[0] || {}).name || "－";
  }
  function askResult(result, done) {
    var label = result === "won" ? "成約" : "見送り";
    if (!$("resultDlg") || config.staff.length < 2) {
      if (window.confirm("この応対を「" + label + "」として実績に記録します。よろしいですか？")) done(activeStaff().id);
      return;
    }
    pickStaff({
      title: label + "として記録",
      lead: "この応対を「" + label + "」として実績に記録します。",
      label: label + "を決めた担当",
      choices: config.staff, value: activeStaff().id, okText: "記録する"
    }, function (v) { if (v) done(v); });
  }

  /* 成約の確認画面。実績に数える項目の一覧を出し、−・＋で件数をその場で
   * 直せる（数え違い・「これは付けていない」をその場で正せるように）。
   * done(担当id, 補正) — 補正は {項目キー: ±差分}（直していなければ null）。 */
  function askWonItems(itemsMap, done) {
    var dlg = $("resultDlg");
    if (!dlg) {
      if (window.confirm("この応対を「成約」として実績に記録します。よろしいですか？")) done(activeStaff().id, null);
      return;
    }
    var keys = Object.keys(itemsMap);
    /* 見積もりから拾えなかった項目もすべて出せるようにする（0件から＋で足す）。
     * 一覧が長くなるので、ふだんは畳んでおき「ほかの項目を足す」で開く。 */
    var catalog = statsCatalog();
    var extraKeys = Object.keys(catalog).filter(function (k) { return !itemsMap[k]; });
    var extraOpen = false;
    var baseOf = {};   // 項目キー → 補正前の件数
    keys.forEach(function (k) { baseOf[k] = itemsMap[k].n; });
    extraKeys.forEach(function (k) { baseOf[k] = 0; });
    var nameOf = {};
    keys.forEach(function (k) { nameOf[k] = itemsMap[k].name; });
    extraKeys.forEach(function (k) { nameOf[k] = catalog[k]; });
    var adj = {};
    $("resultDlgTitle").textContent = "成約として記録";
    $("resultDlgLead").textContent = keys.length
      ? "実績に、次の項目を数えます。"
      : "見積もりから拾える項目はありません（「ほかの項目を足す」から足せます）。";
    var wrapI = $("resultDlgItems"), list = $("resultDlgItemList");
    function rowHtml(k) {
      var n = baseOf[k] + (adj[k] || 0);
      return '<div class="res-item' + (n === 0 ? " res-zero" : "") + '" data-resk="' + esc(k) + '">'
        + '<span class="res-name">' + esc(nameOf[k]) + "</span>"
        + '<button type="button" class="adjb" data-res-d="-1" aria-label="1件減らす">−</button>'
        + '<b class="res-n">' + n + "</b>"
        + '<button type="button" class="adjb" data-res-d="1" aria-label="1件増やす">＋</button>'
        + "</div>";
    }
    function renderList() {
      if (!list) return;
      var h = keys.map(rowHtml).join("");
      if (extraOpen) {
        h += '<p class="hint" style="margin:10px 0 2px"><b>ほかの項目</b>（見積もりに無いものは、＋で足すと実績に数えます）</p>';
        h += extraKeys.map(rowHtml).join("");
      } else if (extraKeys.length) {
        h += '<div class="actions" style="margin-top:8px">'
          + '<button type="button" class="btn-sub" data-res-more="1">＋ ほかの項目を足す（全項目を表示）</button></div>';
      }
      list.innerHTML = h;
    }
    if (wrapI) { wrapI.hidden = false; renderList(); }
    // 決めた担当の選択は、担当が2名以上の店舗だけ（従来どおり）
    var multi = config.staff.length >= 2;
    var sw = $("resultDlgStaffWrap"), sel = $("resultDlgStaff");
    if (sw) sw.hidden = !multi;
    if (multi && sel) {
      sel.innerHTML = config.staff.map(function (s2) {
        return '<option value="' + esc(s2.id) + '">' + esc(s2.name || s2.id) + "</option>";
      }).join("");
      sel.value = activeStaff().id;
      sw.querySelector("label").textContent = "成約を決めた担当";
    }
    $("resultDlgOk").textContent = "記録する";
    dlg.hidden = false;
    function onList(e) {
      var more = e.target.closest && e.target.closest("[data-res-more]");
      if (more) { extraOpen = true; renderList(); return; }
      var b = e.target.closest && e.target.closest("[data-res-d]");
      if (!b) return;
      var k = b.closest("[data-resk]").getAttribute("data-resk");
      var d = parseInt(b.getAttribute("data-res-d"), 10);
      var next = baseOf[k] + (adj[k] || 0) + d;
      if (next < 0 || next > 99) return;
      adj[k] = (adj[k] || 0) + d;
      if (!adj[k]) delete adj[k];
      renderList();
    }
    function close() {
      dlg.hidden = true;
      if (wrapI) wrapI.hidden = true;
      if (sw) sw.hidden = false;   // 担当引き渡しなど、他の用途の表示を戻す
      if (list) { list.removeEventListener("click", onList); list.innerHTML = ""; }
      $("resultDlgOk").removeEventListener("click", ok);
      $("resultDlgCancel").removeEventListener("click", close);
    }
    function ok() {
      var v = multi && sel ? sel.value : activeStaff().id;
      var a = Object.keys(adj).length ? adj : null;
      close();
      done(v, a);
    }
    if (list) list.addEventListener("click", onList);
    $("resultDlgOk").addEventListener("click", ok);
    $("resultDlgCancel").addEventListener("click", close);
  }
  function recordOutcome(result) {
    if (result === "won") {
      // いま画面の内容がそのまま「成約した内容」になる（recordOutcome2 と同じ元データ）
      askWonItems(statsDataItems(JSON.parse(JSON.stringify(store)), true), function (byStaff, wonAdj) {
        recordOutcome2(result, byStaff, wonAdj);
      });
      return;
    }
    askResult(result, function (byStaff) { recordOutcome2(result, byStaff); });
  }
  function recordOutcome2(result, byStaff, wonAdj) {
    var label = result === "won" ? "成約" : "見送り";
    var src = propSrcId ? savedList.filter(function (x) { return x.id === propSrcId; })[0] : null;
    var it;
    if (src) {
      it = src;
    } else {
      var r = calc();
      it = {
        id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: savedDefaultName(),
        custName: state.custName || "",
        planName: state.planId ? r.plan.name : "",
        monthly: r.segs[0].monthly,
        initial: r.initialTotal,
        savedAt: Date.now(),
        data: propSnap || JSON.parse(JSON.stringify(store))
      };
      savedList.unshift(it);
      savedList = trimSavedList(savedList);
    }
    it.result = result;
    it.resultAt = Date.now();
    it.resultStaff = byStaff || activeStaff().id;
    it.upAt = Date.now();
    if (result === "won") {
      it.wonData = JSON.parse(JSON.stringify(store));
      // 成約の確認画面で −・＋した補正。押し直したときは新しい補正で置き換える
      if (wonAdj) it.wonAdj = wonAdj; else delete it.wonAdj;
    } else {
      delete it.wonData;
      delete it.wonAdj;
    }
    delete it.wonPattern;
    persistSaved();
    renderSaved();
    /* 同じ応対でもう一度押したら「記録し直し」になるように紐づけたままにする。
     * 次のお客様は「入力をクリア」か保存の読み込みで区切られる */
    propSrcId = it.id;
    if (!propSnap) propSnap = JSON.parse(JSON.stringify(it.data));
    var msg = $("recOutcomeMsg");
    if (msg) {
      var byName = (config.staff.filter(function (s2) { return s2.id === it.resultStaff; })[0] || {}).name || "";
      msg.textContent = "実績に記録しました（" + label
        + (byName && it.resultStaff !== activeStaff().id ? "・" + byName : "") + "）";
      msg.hidden = false;
      clearTimeout(recordOutcome._t);
      recordOutcome._t = setTimeout(function () { msg.hidden = true; }, 4000);
    }
  }

  /* ---------- 実績（提案と成約） ----------
   * 「保存」した見積もり1件＝1応対の「最初に提案した内容」として数える。
   * 成約にするとき、いま画面に開いている見積もりを「成約した内容」（wonData）
   * として一緒に記録できる。提案のあとに内容を直して決まった場合でも、
   * 最初の提案（提案数）と実際の成約（成約数）を分けて集計できる。
   * マークとwonDataは保存リストと一緒にクラウドへ同期される（お客様名は除く）。 */
  function setSavedResult(id, result) {
    var it = savedList.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    if (!result) { setSavedResult2(it, result, "", null, false); return; }   // 「提案中」に戻すだけ
    if (result === "won") {
      if (it.noQuote) {
        // 見積もりなしの成約は、チェックした項目がそのまま中身（wonData は使わない）
        askWonItems(statsSavedItems(it, true, true), function (byStaff, wonAdj) {
          setSavedResult2(it, "won", byStaff, wonAdj, false);
        });
        return;
      }
      /* いま開いている内容＝店頭で最後に調整した内容。これを成約内容として
       * 記録すれば、保存したときの「最初の提案」と比べられる。 */
      var useCurrent = window.confirm(
        "「" + it.name + "」を成約にします。\n\n"
        + "OK：いま画面に開いている見積もりを『成約した内容』として記録します\n"
        + "（保存したときの提案内容と分けて実績に集計されます）\n\n"
        + "キャンセル：保存したときの内容のまま成約にします");
      var base = useCurrent ? store : it.data;
      askWonItems(statsDataItems(JSON.parse(JSON.stringify(base)), true), function (byStaff, wonAdj) {
        setSavedResult2(it, "won", byStaff, wonAdj, useCurrent);
      });
      return;
    }
    askResult(result, function (byStaff) { setSavedResult2(it, result, byStaff, null, false); });
  }
  function setSavedResult2(it, result, byStaff, wonAdj, useCurrent) {
    if (result === "won") {
      /* 回線1・2・3 は1商談の中の別の番号なので、どれか1つを選ばせない。
       * 使っているパターンぶんがそのまま成約として数えられる。 */
      if (useCurrent) {
        it.wonData = JSON.parse(JSON.stringify(store));
      } else if (!it.noQuote) {
        delete it.wonData;
      }
      if (wonAdj) it.wonAdj = wonAdj; else delete it.wonAdj;
      delete it.wonPattern;
    } else {
      delete it.wonData;
      delete it.wonPattern;
      delete it.wonAdj;
    }
    it.result = result;
    it.resultAt = result ? Date.now() : 0;
    if (result) it.resultStaff = byStaff || activeStaff().id;
    else delete it.resultStaff;
    it.upAt = Date.now();
    persistSaved();
    renderSaved();
  }

  /* ---------- 実績で追う項目の設定 ----------
   * どの項目を実績に数えるかは店舗ごとに違うため、マスタ設定の
   * 「実績で追う項目」で選べるようにし、料金マスタ（MASTER.statsCfg）に持つ。
   * マスタと同じ経路で保存・同期・履歴が効く。
   * 初期値は最初の導入店の指定（2026-08-04）に合わせてある。
   * 設定は集計のたびに参照する（保存済みの見積もりは作り直さないので、
   * 設定を変えると過去の分も新しい設定で数え直される）。 */
  function statsCfg() {
    if (!MASTER.statsCfg) MASTER.statsCfg = {};
    var c = MASTER.statsCfg;
    if (!c.procs) c.procs = { shinki: true, mnp: true, kishu: true, plan: false };
    if (typeof c.visit === "undefined") c.visit = true;        // 来店目的
    if (typeof c.kaimashi === "undefined") c.kaimashi = true;  // プラスワン（再掲）
    if (!c.plans) c.plans = { max: true, poikatsu_max: true };
    if (!c.device) c.device = "kw";           // off=追わない / all=全機種 / kw=キーワード
    if (typeof c.deviceKw !== "string") c.deviceKw = "Pixel";
    if (!c.dcard) c.dcard = "type";           // off / one=まとめて1行 / type=種別ごと
    if (!c.denki) c.denki = "type";           // off / one / type=メニューごと
    if (!c.gas) c.gas = "one";                // off / one
    if (typeof c.hikari === "undefined") c.hikari = true;
    if (typeof c.highend === "undefined") c.highend = true;      // （再掲）機種ハイエンド
    if (typeof c.highendYen !== "number") c.highendYen = 100000; // Androidでハイエンドとみなす金額
    if (typeof c.highendIpKw !== "string") c.highendIpKw = "Pro、Air";  // iPhoneでハイエンドとみなす機種名
    if (typeof c.u15 === "undefined") c.u15 = true;              // （再掲）U15
    if (!c.optSkip) c.optSkip = { smart_hosho: true, anshin_pack: true };
    if (!c.feeSkip) c.feeSkip = {};
    if (typeof c.accs === "undefined") c.accs = true;
    /* 全担当の実績を全員に公開するか（店舗の方針で選ぶ）。
     * 初期値は「公開しない」＝管理者だけが全担当を見られる。 */
    if (typeof c.openAll === "undefined") c.openAll = false;
    return c;
  }
  // 「Pixel、iPhone」のように読点・カンマ区切りで複数キーワードを許す
  /* ハイエンドの判定（店舗の指定・2026-08-11）。
   * ・iPhone … 機種名に Pro / Air が入っていればハイエンド（金額は見ない）
   * ・それ以外（Android）… 元値が決めた金額以上。元値は「端末代金総額 − 店頭頭金」
   *   （端末代金総額は頭金を含んだ金額を入れる決まりのため）。
   *   割引（クーポン・店舗独自・ダイレクト割）は元値なので引かない。 */
  function statsIsHighEnd(pt, cfg) {
    if (num(pt.devicePrice) <= 0) return false;
    var name = String(pt.deviceName || "");
    if (/iphone/i.test(name)) return statsKwTest(cfg.highendIpKw, name);
    return (num(pt.devicePrice) - num(pt.atamakin)) >= num(cfg.highendYen);
  }
  /* U15のプラン。新規・MNPでこれを選んでいたら「（再掲）U15」に数える */
  var U15_PLANS = { u15_debut: true, u15: true };
  function statsKwTest(kw, name) {
    var n = String(name || "").toLowerCase();
    return String(kw || "").split(/[、,]/).some(function (w) {
      w = w.trim().toLowerCase();
      return !!w && n.indexOf(w) >= 0;
    });
  }

  /* 光・5Gの集計はブランドを分けず速度でまとめる。
   * ドコモ光1ギガ＋ahamo光1ギガ＝「光 1ギガ」、10ギガも同様。 */
  var STATS_IE_NAMES = {
    hikari1g: "光 1ギガ", ahamo1g: "光 1ギガ",
    hikari10g: "光 10ギガ", ahamo10g: "光 10ギガ",
    home5g: "home 5G"
  };
  var STATS_IE_KEYS = { hikari1g: "1g", ahamo1g: "1g", hikari10g: "10g", ahamo10g: "10g", home5g: "home5g" };

  // 1パターンから「提案した項目」を拾う {key: 表示名}
  /* 何を数えるかは statsCfg()（マスタ設定の「実績で追う項目」）に従う。
   * 固定のルール:
   * ・引き継ぎの「ドコモ光」チェックは数えない（光・5Gタブの商材で数える）
   * ・オプションの「継続」は提案に数えない
   * ・ドコモの商材の手数料・再発行、請求書払いのものは数えない
   * ・アクセサリは登録品だけ（自由入力は数えない） */
  var STATS_PROC_NAMES = { shinki: "新規契約", mnp: "のりかえ（MNP）", kishu: "機種変更", plan: "プラン変更" };
  // 手続き種別（procType）から手続き内容（procTodo）の形へ
  var PROC_TYPE_TO_TODO = { shinki: "shinki", mnp: "mnp", kishu: "kishu", plan_only: "plan" };
  function procTodoEmpty(todo) {
    return !Object.keys(todo || {}).some(function (k) { return todo[k]; });
  }
  function procTodoOf(pt) {
    var todo = (pt && pt.procTodo) || {};
    if (!procTodoEmpty(todo)) return todo;
    // 手続き内容のチェックが無くても、手続き種別が入っていればそれで数える
    var k = PROC_TYPE_TO_TODO[(pt && pt.procType) || ""];
    if (k) { var o = {}; o[k] = true; return o; }
    return null;
  }
  var VISIT_NAMES = {
    buy: "端末購入", plan: "プラン見直し", repair: "故障",
    howto: "操作", ask: "問合せ", other: "その他"
  };
  var VISIT_ORDER = ["buy", "plan", "repair", "howto", "ask", "other"];
  /* ご来店の目的。以前は1つだけ選ぶ形（visitPurpose）だったため、
   * 古い保存もそのまま読めるようにここでまとめる。 */
  function visitPurposesOf(st) {
    var v = (st && st.visitPurposes) || null;
    if (v && Object.keys(v).length) return v;
    if (st && st.visitPurpose) { var o = {}; o[st.visitPurpose] = true; return o; }
    return {};
  }
  function visitKeys(st) {
    var v = visitPurposesOf(st);
    return VISIT_ORDER.filter(function (k) { return !!v[k]; });
  }
  /* もともと実績に数えないもの。
   * ・ドコモメールオプション … プランに付いてくるかどうかの選択で、獲得ではない
   * ・無料データ移行 … 無料でお付けするサービス（有料の初期設定サポートは数える）
   * （店舗の指定・2026-08-11） */
  function statsSkipOpt(o) {
    if (!o) return false;
    return o.id === "docomomail" || (o.name || "").indexOf("ドコモメール") >= 0;
  }
  function statsSkipFee(f) {
    if (!f) return false;
    return !!f.dataMove && !num(f.price);
  }
  /* Amazonプライムのように「もともとご自身で入っていたものをドコモ経由に移す」
   * ことがあるオプションは、区分に「既存」を足す。マスタで kubunExist を
   * 立てたもの（＋名前にAmazonが入るもの）が対象。 */
  function optHasExist(o) {
    return !!(o && (o.kubunExist === true || /amazon/i.test(o.name || "")));
  }
  // Amazonプライムのオプションid（実績の加入率で使う）
  function amazonOptIds() {
    return (MASTER.options || []).filter(optHasExist).map(function (o) { return o.id; });
  }
  // 新規AmazonPrime加入率の対象プラン（ドコモMAX・ポイ活MAX・ドコモmini）
  var AMAZON_TARGET_PLANS = { max: "ドコモ MAX", poikatsu_max: "ドコモ ポイ活 MAX", mini: "ドコモ mini" };
  /* ドコモ MAX・ポイ活 MAX の獲得は「料金プランの変更」で数える指標のため、
   * 成約として数えるのは料金プランの「変更あり」（state.planChange）に
   * チェックが入っているときだけにする。手続きの種類（新規・機種変更など）は問わない
   * （店舗の指定・2026-08-10）。提案はこれまでどおり、選んだ時点で数える。 */
  var PLAN_WON_NEEDS_CHANGE = { max: true, poikatsu_max: true };
  /* ご来店の目的は「1商談に1つ」なので、回線1（patterns[0]）のものを使う。
   * 古い保存はパターンごとに入っていることがあるので、回線1が空なら
   * そのパターン自身のものを見る。 */
  function visitStateOf(d, pt) {
    var p0 = ((d && d.patterns) || [])[0];
    return (p0 && visitKeys(p0).length) ? p0 : pt;
  }
  function statsPatternItems(ptRaw, won, vpSt, baseTodo) {
    var pt = Object.assign(defaultState(), ptRaw || {});
    var cfg = statsCfg();
    var out = {};
    /* 手続きは回線ごとに持っているが、店頭では回線1で選んだら
     * 回線2・3では選び直さないことが多い。中身が入っている回線で
     * 手続きが選ばれていないときは、回線1と同じ手続きとして数える
     * （2台の機種変更なら機種変更2件・店舗の指定・2026-08-14）。 */
    var todo = procTodoOf(pt) || baseTodo || {};
    Object.keys(STATS_PROC_NAMES).forEach(function (k) {
      if (todo[k] && cfg.procs[k]) out["proc:" + k] = STATS_PROC_NAMES[k];
    });
    /* 来店目的そのものは項目別に混ぜない（「何を成約したか」の一覧ではないため）。
     * 目的ごとの応対数は「来店目的別」の表で見る（店舗の指定・2026-08-10）。 */
    var vks = visitKeys(vpSt || pt);
    /* 買い増し: 端末購入以外のご用件で来店されて機種変更が入った場合と、
     * 端末購入で来店されて「買い増しあり」にチェックした場合。
     * 機種変更の実績はそのまま数え、これは再掲として別に数える。 */
    /* 新料金（ドコモMAX・ポイ活MAX・ドコモmini）への変更と同時に、
     * Amazonプライムにご加入いただいた分。ドコモの指標に合わせて
     * 「料金プランの変更あり」のチェックが入っていることを条件にする。
     * 区分は新規・既存のどちらでも数える（継続・廃止は数えない）。 */
    if (AMAZON_TARGET_PLANS[pt.planId] && pt.planChange) {
      var azOn = false;
      (MASTER.options || []).forEach(function (o2) {
        if (!optHasExist(o2) || !(pt.options || {})[o2.id]) return;
        var kb9 = (pt.optionKubun || {})[o2.id] || "new";
        if (kb9 === "new" || kb9 === "exist") azOn = true;
      });
      if (azOn) out["maxAmazon"] = "（再掲）新プラン × Amazon Prime";
    }
    if (cfg.kaimashi) {
      var buyOn = vks.indexOf("buy") >= 0;
      var kaimashiOn = buyOn ? !!pt.kaimashi : !!(vks.length && todo.kishu);
      if (kaimashiOn) out["kaimashi"] = "プラスワン（再掲）";
    }
    if (pt.planId && cfg.plans[pt.planId]
        && !(won && PLAN_WON_NEEDS_CHANGE[pt.planId] && !pt.planChange)) {
      var pl = planById(pt.planId);
      out["plan:" + pt.planId] = "プラン: " + (pl ? pl.name : pt.planId);
    }
    /* （再掲）U15: 新規・MNPのご契約で、U15のプランを選んだか
     * 「U15」にチェックしたとき。機種変更のときは数えない。 */
    if (cfg.u15) {
      var newLine = !!(todo.shinki || todo.mnp) || pt.procType === "shinki" || pt.procType === "mnp";
      if (newLine && (U15_PLANS[pt.planId] || pt.u15)) out["u15"] = "（再掲）U15";
    }
    /* （再掲）機種ハイエンド。機種販売の行はそのまま数えたうえで、
     * 再掲として別に1件数える。 */
    /* 支払い方法が「端末購入なし」のときは、機種名・端末代金が残っていても
     * 端末は売れていないので数えない（見積もりの金額にも入っていない）。
     * 判定は保存された内容（ptRaw）で行う。既定値とまぜた pt を見ると、
     * 支払い方法を持たない古い保存まで「端末購入なし」になり、
     * 過去の実績から機種販売が消えてしまう。 */
    var devBought = !ptRaw || !("payMethod" in ptRaw) || ptRaw.payMethod !== "none";
    if (cfg.highend && devBought && statsIsHighEnd(pt, cfg)) {
      out["highend"] = "（再掲）機種ハイエンド";
    }
    if (pt.deviceName && devBought) {
      if (cfg.device === "all") out["device"] = "機種販売";
      else if (cfg.device === "kw" && statsKwTest(cfg.deviceKw, pt.deviceName)) {
        out["device"] = "（再掲）" + cfg.deviceKw;
      }
    }
    if (pt.todoDcard && cfg.dcard !== "off") {
      if (cfg.dcard === "one") {
        out["dcard"] = "dカード";
      } else {
        var dcNames = { normal: "dカード", goldu: "dカード GOLD U", gold: "dカード GOLD", platinum: "dカード PLATINUM" };
        out["dcard:" + (pt.todoDcardType || "x")] = dcNames[pt.todoDcardType] || "dカード（種別未選択）";
      }
    }
    if (pt.todoDenki && cfg.denki !== "off") {
      if (cfg.denki === "one") {
        out["denki"] = "ドコモでんき";
      } else {
        var dnNames = { basic: "でんき Basic", green: "でんき Green" };
        out["denki:" + (pt.todoDenkiType || "x")] = dnNames[pt.todoDenkiType] || "でんき（メニュー未選択）";
      }
    }
    if (pt.todoGas && cfg.gas !== "off") out["gas"] = "ドコモガス";
    /* ドコモ MAX・ポイ活 MAX の「選べる特典」（対象サービスから毎月2つ無料）で
     * 無料になっているものは、お客様のご負担が無く獲得ではないため数えない。
     * 3つ目以降（通常料金でお支払いいただくもの）はこれまでどおり数える
     * （店舗の指定・2026-08-11）。 */
    var bonusFree = maxBonusFree(pt, pt.planId);
    Object.keys(pt.options || {}).forEach(function (id) {
      if (!pt.options[id] || cfg.optSkip[id] || bonusFree[id]) return;
      var kb2 = (pt.optionKubun || {})[id];
      if (kb2 === "keep") return; // 継続は提案に数えない
      var def = MASTER.options.filter(function (o) { return o.id === id; })[0];
      if (statsSkipOpt(def)) return;
      /* 店舗独自サービス（マスタ設定で「店舗独自」にしたもの）は
       * 「独自: 」として別のまとまりで集計する */
      if (def && def.own) out["own:o:" + id] = "独自: " + def.name;
      else if (kb2 === "exist") {
        // 既存（もともとご加入のものをドコモ経由へ）は新規と分けて数える
        out["opt:" + id + ":exist"] = "オプション: " + (def ? def.name : id) + "（既存）";
      } else {
        /* 既存の区分がある商材（Amazonプライム）は、どちらの行か分かるように
         * 新規にも区分を付ける。区分の無い商材はこれまでどおり名前だけ。 */
        out["opt:" + id] = "オプション: " + (def ? def.name : id)
          + (optHasExist(def) ? "（新規）" : "");
      }
    });
    Object.keys(pt.feeItems || {}).forEach(function (id) {
      if (!pt.feeItems[id] || cfg.feeSkip[id]) return;
      var def = MASTER.feeItems.filter(function (o) { return o.id === id; })[0];
      if (!def || statsSkipFee(def)) return;
      if (def.own) {
        /* 独自商材は名前に「手数料」と付いていても数える（店の商品なので）。
         * 請求書払い（bill）のものだけは対象外 */
        if (def.pay === "bill") return;
        out["own:f:" + id] = "独自: " + def.name;
      } else {
        if (def.pay === "bill" || /手数料|再発行/.test(def.name || "")) return; // 手数料類は提案項目ではない
        out["fee:" + id] = def.name;
      }
    });
    if (cfg.accs) {
      Object.keys(pt.accSel || {}).forEach(function (id) {
        if (!pt.accSel[id]) return;
        var def = MASTER.accessories.filter(function (o) { return o.id === id; })[0];
        out["acc:" + id] = "アクセサリ: " + (def ? def.name : id);
      });
    }
    return out;
  }

  // 3パターン一式＋光・5G（store のクローン）から項目を拾う
  /* 見積もり1件（＝1商談）から項目を数える。返す形は {キー: {name, n}}。
   * 回線1・2・3 のパターンは「1商談の中の、別の番号の手続き」なので、
   * 使っているパターンのぶんを足し上げる。2台の機種変更なら 機種変更 2件。
   * 光・5G は1商談に1つなので、パターン数にかかわらず1件。 */
  function statsDataItems(d, won) {
    var out = {};
    function add(map) {
      Object.keys(map).forEach(function (k) {
        if (!out[k]) out[k] = { name: map[k], n: 0 };
        out[k].n++;
      });
    }
    var pats = (d && d.patterns) || [];
    var used = [];
    pats.forEach(function (pt, i) {
      var m = Object.assign(defaultState(), pt || {});
      if (isPatternUsed(m) || m.planId || m.procType) used.push(i);
    });
    /* 手続き内容だけを入れた（金額を触っていない）成約は、
     * 上の判定では拾えないので、開いていたパターンを1つ数える。 */
    if (won && !used.length && pats.length) used = [(d.active | 0)];
    var vpSt = visitStateOf(d, null);
    // 回線1（＝この商談の手続き）。手続きを選んでいない回線はこれで数える
    var baseTodo = procTodoOf(pats[0]);
    used.forEach(function (i) { add(statsPatternItems(pats[i], won, vpSt || pats[i], baseTodo)); });

    var ie = d && d.ienaka;
    if (ie && ie.enabled && ie.product && statsCfg().hikari) {
      /* 成約として数えるのは「光申し込み」にチェックがあるときだけ。
       * 金額をお見せしただけ（提案）と、実際にお申込みいただいた（成約）を
       * 分けるため（店舗の指定・2026-08-10）。 */
      var applied = true;
      if (won) applied = pats.some(function (pt) { return pt && pt.todoHikari; });
      if (applied) {
        out["ie:" + (STATS_IE_KEYS[ie.product] || ie.product)] =
          { name: "光・5G: " + (STATS_IE_NAMES[ie.product] || ie.product), n: 1 };
      }
    }
    return out;
  }

  // 1件の保存から項目を拾う。wonOnly は「成約した内容」だけ。
  // noAdj は成約の確認画面用（−・＋の補正を掛ける前の素の件数を出す）
  function statsSavedItems(it, wonOnly, noAdj) {
    /* 見積もりなしの成約は、チェックした項目がそのまま成約の中身。
     * 金額をお見せしていないので、提案には数えない。 */
    var out;
    if (it.noQuote) {
      if (!wonOnly) return {};
      var cat0 = statsCatalog();
      out = {};
      Object.keys(it.noQuoteItems || {}).forEach(function (k) {
        var v = it.noQuoteItems[k];
        // 以前の保存はチェック式（true）＝1件。いまは −・＋の件数がそのまま入る
        var n = v === true ? 1 : Math.max(0, num(v));
        if (n) out[k] = { name: cat0[k] || k, n: n };
      });
    } else {
      if (!wonOnly) return statsDataItems(it.data);
      // 成約時に記録した内容があればそれを、無ければ保存した内容を使う
      out = statsDataItems(it.wonData || it.data, true);
    }
    /* 成約の確認画面で −・＋した補正を反映する。0件になった項目は数えない */
    if (!noAdj && it.wonAdj) {
      var cat1 = null;
      Object.keys(it.wonAdj).forEach(function (k) {
        var d = num(it.wonAdj[k]);
        if (!d) return;
        if (!out[k]) {
          cat1 = cat1 || statsCatalog();
          out[k] = { name: cat1[k] || k, n: 0 };
        }
        out[k].n = Math.max(0, out[k].n + d);
        if (!out[k].n) delete out[k];
      });
    }
    return out;
  }

  /* 成約・見送りを決めた担当。入っていない古い保存は、その保存を作った
   * 担当（＝保存リストの持ち主）が決めたものとして扱う。 */
  function resStaffOf(it, ownerId) { return it.resultStaff || ownerId; }

  /* 件数の手修正（管理者）。数え違い・二重計上を直すための補正値を
   * 「担当×月」で持つ。MASTER に入れるので全端末で揃う。
   * 例: MASTER.statsAdjust["s1"]["2026/08"] = {prop: -1, won: 1, lost: 0} */
  function statsAdjOf(sid, month) {
    var a = ((MASTER.statsAdjust || {})[sid] || {})[month];
    return a ? { prop: num(a.prop), won: num(a.won), lost: num(a.lost) } : { prop: 0, won: 0, lost: 0 };
  }
  // 表示中の期間・担当ぶんの項目補正を合計する（"all" は全部を足す）
  function statsAdjItemSum(sid, month) {
    var per = MASTER.statsAdjItem || {};
    var out = {};
    Object.keys(per).forEach(function (s2) {
      if (sid !== "all" && s2 !== sid) return;
      Object.keys(per[s2] || {}).forEach(function (m) {
        if (month !== "all" && m !== month) return;
        var o = per[s2][m] || {};
        Object.keys(o).forEach(function (k) {
          if (!out[k]) out[k] = { prop: 0, won: 0 };
          out[k].prop += num(o[k].prop);
          out[k].won += num(o[k].won);
        });
      });
    });
    return out;
  }
  /* 実績で数えうる項目の一覧（キー→表示名）。
   * この期間に1件も出ていない項目を、修正で足すときに使う。
   * キーの作り方は statsPatternItems / statsDataItems と揃える。 */
  function statsCatalog() {
    var cfg = statsCfg();
    var out = {};
    Object.keys(STATS_PROC_NAMES).forEach(function (k) {
      if (cfg.procs[k]) out["proc:" + k] = STATS_PROC_NAMES[k];
    });
    if (cfg.kaimashi) out["kaimashi"] = "プラスワン（再掲）";
    if (cfg.u15) out["u15"] = "（再掲）U15";
    if (cfg.highend) out["highend"] = "（再掲）機種ハイエンド";
    (MASTER.plans || []).forEach(function (pl) {
      if (cfg.plans[pl.id]) out["plan:" + pl.id] = "プラン: " + pl.name;
    });
    out["maxAmazon"] = "（再掲）新プラン × Amazon Prime";
    if (cfg.device === "all") out["device"] = "機種販売";
    else if (cfg.device === "kw") out["device"] = "（再掲）" + cfg.deviceKw;
    if (cfg.dcard === "one") out["dcard"] = "dカード";
    else if (cfg.dcard === "type") {
      var dcN = { normal: "dカード", goldu: "dカード GOLD U", gold: "dカード GOLD", platinum: "dカード PLATINUM" };
      Object.keys(dcN).forEach(function (k) { out["dcard:" + k] = dcN[k]; });
    }
    if (cfg.denki === "one") out["denki"] = "ドコモでんき";
    else if (cfg.denki === "type") {
      out["denki:basic"] = "でんき Basic";
      out["denki:green"] = "でんき Green";
    }
    if (cfg.gas !== "off") out["gas"] = "ドコモガス";
    if (cfg.hikari) {
      out["ie:1g"] = "光・5G: 光 1ギガ";
      out["ie:10g"] = "光・5G: 光 10ギガ";
      out["ie:home5g"] = "光・5G: home 5G";
    }
    (MASTER.options || []).forEach(function (o) {
      if (cfg.optSkip[o.id] || statsSkipOpt(o)) return;
      if (o.own) { out["own:o:" + o.id] = "独自: " + o.name; return; }
      out["opt:" + o.id] = "オプション: " + o.name + (optHasExist(o) ? "（新規）" : "");
      if (optHasExist(o)) out["opt:" + o.id + ":exist"] = "オプション: " + o.name + "（既存）";
    });
    (MASTER.feeItems || []).forEach(function (o) {
      if (cfg.feeSkip[o.id] || statsSkipFee(o)) return;
      if (o.own) { if (o.pay !== "bill") out["own:f:" + o.id] = "独自: " + o.name; return; }
      if (o.pay === "bill" || /手数料|再発行/.test(o.name || "")) return;
      out["fee:" + o.id] = o.name;
    });
    if (cfg.accs) {
      (MASTER.accessories || []).forEach(function (o) { out["acc:" + o.id] = "アクセサリ: " + o.name; });
    }
    return out;
  }

  // 期間ぶんの補正を足す（「全期間」のときは登録されている月をすべて足す）
  function statsAdjSum(sid, month) {
    if (month !== "all") return statsAdjOf(sid, month);
    var per = (MASTER.statsAdjust || {})[sid] || {};
    var out = { prop: 0, won: 0, lost: 0 };
    Object.keys(per).forEach(function (m) {
      out.prop += num(per[m].prop); out.won += num(per[m].won); out.lost += num(per[m].lost);
    });
    return out;
  }

  // 全担当の保存リストを集める。クラウド利用時は最新を読みにいく
  var statsLists = null; // {staffId: list}
  var statsLast = null;  // 直近に表示した集計（CSV出力用）
  var statsCloudOk = true; // クラウドから全担当ぶんを読めたか（確定してよいかの判断に使う）
  function loadAllSaved(done) {
    var lists = {};
    var mine = activeStaff().id;
    function local(sid) {
      try { return JSON.parse(localStorage.getItem(savedKey(sid)) || "null") || []; } catch (e) { return []; }
    }
    /* 全担当の保存を読む。担当者の画面に他人の数字は出さないが、
     * 「自分が成約を決めた件」が他の担当（コンデザ）の保存に入っていることが
     * あるため、集計の材料としては全担当分が要る。 */
    config.staff.forEach(function (s) {
      lists[s.id] = s.id === mine ? savedList : local(s.id);
    });
    if (!cloudOn()) { statsCloudOk = true; statsLists = lists; done(); return; }
    statsCloudOk = true;
    var jobs = config.staff.map(function (s) {
      if (s.id === mine) return Promise.resolve(); // 自分の分は手元が最新
      return savedDoc(s.id).get().then(function (snap) {
        var d = snap.exists ? snap.data() : null;
        if (d && d.list) lists[s.id] = JSON.parse(d.list) || [];
      }).catch(function () { statsCloudOk = false; });
    });
    Promise.all(jobs).then(function () { statsLists = lists; done(); }, function () { statsLists = lists; done(); });
  }

  /* ---------- 実績の手修正 ----------
   * ・担当者は「当日ぶん」だけ直せる（日付キー MASTER.statsAdjDay）。
   *   日付でキーを分けているので、翌日になると前日ぶんには手が届かない。
   * ・管理者は月ぶんをまとめて直せる（月キー MASTER.statsAdjItem）。
   * どちらも料金マスタに入るため、店舗内の全端末で揃う。 */
  function adjTodayKey() {
    var d = new Date();
    return d.getFullYear() + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + ("0" + d.getDate()).slice(-2);
  }
  function statsAdjDayBag(sid, day) {
    return (((MASTER.statsAdjDay || {})[sid] || {})[day]) || {};
  }
  // その期間の項目補正（担当者の当日ぶん＋管理者の月ぶん）を合算する
  function statsAdjItemTotal(sid, month) {
    var out = {};
    function add(o) {
      Object.keys(o || {}).forEach(function (k) {
        if (!out[k]) out[k] = { prop: 0, won: 0 };
        out[k].prop += num(o[k].prop);
        out[k].won += num(o[k].won);
      });
    }
    var perDay = MASTER.statsAdjDay || {};
    Object.keys(perDay).forEach(function (s2) {
      if (sid !== "all" && s2 !== sid) return;
      Object.keys(perDay[s2] || {}).forEach(function (day) {
        if (month !== "all" && day.slice(0, 7) !== month) return;
        add(perDay[s2][day]);
      });
    });
    add(statsAdjItemSum(sid, month));
    return out;
  }

  function statsMonthOf(ms) {
    var d = new Date(ms || 0);
    return d.getFullYear() + "/" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  /* ---------- 実績の集計 ----------
   * 提案・応対・未記録は「応対した担当」、成約は「成約を決めた担当」で数える。
   * 画面の描画と、月次の確定（スナップショット）で同じものを使う。 */
  function statsAggregate(lists, mFil, sFil, mineOnlyFn) {
    var items = {};      // 項目キー -> {name, prop, won, byVisit}
    var visitUsed = {};  // 使われた来店目的
    var vpAgg = {};      // 来店目的 -> {prop, won}
    var byDay = {};      // 日 -> {prop, won, dow, items:{項目キー -> 成約件数}}
    var staffAgg = {};   // 担当id -> {prop, won, undone}
    var cross = {};      // 担当id -> {項目キー -> 成約件数}

    config.staff.forEach(function (s) {
      staffAgg[s.id] = { prop: 0, won: 0, undone: 0 };
      cross[s.id] = {};
    });
    function bagItem(k, name) {
      if (!items[k]) items[k] = { name: name, prop: 0, won: 0, byVisit: {} };
      return items[k];
    }
    function inPeriod(it) { return mFil === "all" || statsMonthOf(it.savedAt) === mFil; }

    Object.keys(lists).forEach(function (sid) {
      (lists[sid] || []).filter(inPeriod).forEach(function (it) {
        if (it.sentTo || !mineOnlyFn(it, sid)) return;
        var decider = resStaffOf(it, sid);
        var ownMatch = (sFil === "all" || sid === sFil);       // 応対した担当
        var decMatch = (sFil === "all" || decider === sFil);   // 成約を決めた担当
        if (!ownMatch && !decMatch) return;

        /* ご来店の目的は1商談に1つ。回線1（patterns[0]）に入っている。 */
        var pats0 = ((it.data || {}).patterns) || [];
        var pt0 = pats0[0] || pats0[((it.data || {}).active | 0)] || {};
        var vks = visitKeys(pt0);
        if (!vks.length) vks = visitKeys(pats0[((it.data || {}).active | 0)] || {});
        if (!vks.length) vks = ["_none"];
        var wonI = it.result === "won" ? statsSavedItems(it, true) : null;
        var dt = new Date(it.savedAt || 0);
        var dk = dt.getFullYear() + "/" + ("0" + (dt.getMonth() + 1)).slice(-2)
          + "/" + ("0" + dt.getDate()).slice(-2);

        if (ownMatch) {
          if (staffAgg[sid]) {
            staffAgg[sid].prop++;
            if (!it.result) staffAgg[sid].undone++;
          }
          if (!byDay[dk]) byDay[dk] = { prop: 0, won: 0, dow: dt.getDay(), items: {} };
          byDay[dk].prop++;
          // 提案した項目
          var propI = statsSavedItems(it, false);
          Object.keys(propI).forEach(function (k) {
            bagItem(k, propI[k].name).prop += propI[k].n;
          });
          vks.forEach(function (vk) {
            if (!vpAgg[vk]) vpAgg[vk] = { prop: 0, won: 0 };
            vpAgg[vk].prop++;
            if (vk !== "_none") visitUsed[vk] = true;
          });
        }
        if (wonI && decMatch) {
          if (staffAgg[decider]) staffAgg[decider].won++;
          if (!byDay[dk]) byDay[dk] = { prop: 0, won: 0, dow: dt.getDay(), items: {} };
          byDay[dk].won++;
          vks.forEach(function (vk) {
            if (!vpAgg[vk]) vpAgg[vk] = { prop: 0, won: 0 };
            vpAgg[vk].won++;
            if (vk !== "_none") visitUsed[vk] = true;
          });
          Object.keys(wonI).forEach(function (k) {
            var n = wonI[k].n;
            var b = bagItem(k, wonI[k].name);
            b.won += n;
            byDay[dk].items[k] = (byDay[dk].items[k] || 0) + n;   // その日の成約内訳
            // どの来店目的からの成約か（目的が複数なら按分せず両方に立てる）
            vks.forEach(function (vk) { b.byVisit[vk] = (b.byVisit[vk] || 0) + n; });
            if (cross[decider]) cross[decider][k] = (cross[decider][k] || 0) + n;
          });
        }
      });
    });

    /* 手修正を足す（0件で表に出ていない項目も、修正が入っていれば行を出す） */
    var catalog = statsCatalog();
    var itemAdj = statsAdjItemTotal(sFil, mFil);
    Object.keys(itemAdj).forEach(function (k) {
      var b = bagItem(k, catalog[k] || k);
      b.prop = Math.max(0, b.prop + itemAdj[k].prop);
      b.won = Math.max(0, b.won + itemAdj[k].won);
    });
    return { items: items, visitUsed: visitUsed, vpAgg: vpAgg,
      byDay: byDay, staffAgg: staffAgg, cross: cross };
  }

  /* ---------- 月次の確定（スナップショット） ----------
   * 保存は担当ごとに300件までなので、忙しい店では1〜2か月で古いものから
   * こぼれてしまう。そうなる前に、先々月ぶんの集計値を確定して料金マスタに残し、
   * 生の保存は消して枠を空ける。確定済みの月は、この数字を表示する。
   * 確定は自動（実績を開いたとき）。取り返しがつかない削除なので、
   * ・当月と先月は触らない
   * ・クラウド利用時は全担当ぶんを読めたときだけ確定する
   * ・すでに確定した月は数字を作り直さない
   * ・削除は「確定済みの月」の自分の保存だけ
   * という順で守っている。 */
  var STATS_SNAP_KEEP = 24;   // 確定を残す月数

  function monthShift(m, n) {
    var y = +m.slice(0, 4), mo = +m.slice(5) + n;
    y += Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    return y + "/" + ("0" + mo).slice(-2);
  }
  function statsSnapshots() { return MASTER.statsSnapshot || {}; }

  // 1か月ぶんの確定データを作る（担当ごとに持ち、合計は足し上げて出す）
  function statsBuildSnapshot(month, lists) {
    var all = function () { return true; };
    var names = {}, staff = {};
    config.staff.forEach(function (s) {
      var a = statsAggregate(lists, month, s.id, all);
      var st = { prop: 0, won: 0, undone: 0, items: {}, vp: {}, days: {} };
      var sa = a.staffAgg[s.id] || { prop: 0, won: 0, undone: 0 };
      st.prop = sa.prop; st.won = sa.won; st.undone = sa.undone;
      Object.keys(a.items).forEach(function (k) {
        var x = a.items[k];
        if (!x.prop && !x.won) return;
        names[k] = x.name;
        st.items[k] = [x.prop, x.won, x.byVisit];
      });
      Object.keys(a.vpAgg).forEach(function (vk) {
        st.vp[vk] = [a.vpAgg[vk].prop, a.vpAgg[vk].won];
      });
      Object.keys(a.byDay).forEach(function (d) {
        st.days[d] = [a.byDay[d].prop, a.byDay[d].won, a.byDay[d].dow, a.byDay[d].items || {}];
      });
      if (st.prop || st.won || Object.keys(st.items).length) staff[s.id] = st;
    });
    return { at: Date.now(), names: names, staff: staff };
  }

  // 2つの集計を足し合わせる（「全期間」で、生の保存と確定データを合わせるのに使う）
  function statsMergeAgg(a, b) {
    Object.keys(b.items).forEach(function (k) {
      var x = b.items[k];
      if (!a.items[k]) a.items[k] = { name: x.name, prop: 0, won: 0, byVisit: {} };
      a.items[k].prop += x.prop;
      a.items[k].won += x.won;
      Object.keys(x.byVisit || {}).forEach(function (vk) {
        a.items[k].byVisit[vk] = (a.items[k].byVisit[vk] || 0) + x.byVisit[vk];
      });
    });
    Object.keys(b.visitUsed).forEach(function (vk) { a.visitUsed[vk] = true; });
    Object.keys(b.vpAgg).forEach(function (vk) {
      if (!a.vpAgg[vk]) a.vpAgg[vk] = { prop: 0, won: 0 };
      a.vpAgg[vk].prop += b.vpAgg[vk].prop;
      a.vpAgg[vk].won += b.vpAgg[vk].won;
    });
    Object.keys(b.byDay).forEach(function (d) {
      if (!a.byDay[d]) a.byDay[d] = { prop: 0, won: 0, dow: b.byDay[d].dow, items: {} };
      a.byDay[d].prop += b.byDay[d].prop;
      a.byDay[d].won += b.byDay[d].won;
      var bi = b.byDay[d].items || {};
      Object.keys(bi).forEach(function (k) {
        a.byDay[d].items[k] = (a.byDay[d].items[k] || 0) + bi[k];
      });
    });
    Object.keys(b.staffAgg).forEach(function (sid) {
      if (!a.staffAgg[sid]) a.staffAgg[sid] = { prop: 0, won: 0, undone: 0 };
      a.staffAgg[sid].prop += b.staffAgg[sid].prop;
      a.staffAgg[sid].won += b.staffAgg[sid].won;
      a.staffAgg[sid].undone += b.staffAgg[sid].undone;
    });
    Object.keys(b.cross).forEach(function (sid) {
      if (!a.cross[sid]) a.cross[sid] = {};
      Object.keys(b.cross[sid]).forEach(function (k) {
        a.cross[sid][k] = (a.cross[sid][k] || 0) + b.cross[sid][k];
      });
    });
    return a;
  }

  // 確定データを、画面が使う形（statsAggregate と同じ形）に戻す
  function statsFromSnapshot(snap, sFil) {
    var items = {}, visitUsed = {}, vpAgg = {}, byDay = {}, staffAgg = {}, cross = {};
    config.staff.forEach(function (s) { staffAgg[s.id] = { prop: 0, won: 0, undone: 0 }; cross[s.id] = {}; });
    Object.keys(snap.staff || {}).forEach(function (sid) {
      if (sFil !== "all" && sid !== sFil) return;
      var st = snap.staff[sid];
      staffAgg[sid] = { prop: st.prop, won: st.won, undone: st.undone };
      if (!cross[sid]) cross[sid] = {};
      Object.keys(st.items || {}).forEach(function (k) {
        var a = st.items[k];
        if (!items[k]) items[k] = { name: (snap.names || {})[k] || k, prop: 0, won: 0, byVisit: {} };
        items[k].prop += a[0];
        items[k].won += a[1];
        Object.keys(a[2] || {}).forEach(function (vk) {
          items[k].byVisit[vk] = (items[k].byVisit[vk] || 0) + a[2][vk];
          if (vk !== "_none") visitUsed[vk] = true;
        });
        if (a[1]) cross[sid][k] = a[1];
      });
      Object.keys(st.vp || {}).forEach(function (vk) {
        if (!vpAgg[vk]) vpAgg[vk] = { prop: 0, won: 0 };
        vpAgg[vk].prop += st.vp[vk][0];
        vpAgg[vk].won += st.vp[vk][1];
        if (vk !== "_none") visitUsed[vk] = true;
      });
      Object.keys(st.days || {}).forEach(function (d) {
        if (!byDay[d]) byDay[d] = { prop: 0, won: 0, dow: st.days[d][2], items: {} };
        byDay[d].prop += st.days[d][0];
        byDay[d].won += st.days[d][1];
        var di = st.days[d][3] || {};   // 1.82.0 までの確定には内訳が無い
        Object.keys(di).forEach(function (k) {
          byDay[d].items[k] = (byDay[d].items[k] || 0) + di[k];
        });
      });
    });
    return { items: items, visitUsed: visitUsed, vpAgg: vpAgg,
      byDay: byDay, staffAgg: staffAgg, cross: cross };
  }

  /* 先々月以前で、保存が残っているのに確定していない月を確定する。
   * 数字を作れなかった（読めなかった）ときは何もしない。 */
  function statsAutoSettle(lists) {
    if (cloudOn() && !statsCloudOk) return false;   // 全担当ぶんを読めていない
    var snaps = MASTER.statsSnapshot || (MASTER.statsSnapshot = {});
    var limit = monthShift(statsMonthOf(Date.now()), -2);
    var todo = {};
    Object.keys(lists).forEach(function (sid) {
      (lists[sid] || []).forEach(function (it) {
        var m = statsMonthOf(it.savedAt);
        if (m <= limit && !snaps[m]) todo[m] = true;
      });
    });
    var keys = Object.keys(todo);
    if (!keys.length) return false;
    keys.forEach(function (m) { snaps[m] = statsBuildSnapshot(m, lists); });
    // 古い確定は間引く（料金マスタが際限なく大きくならないように）
    var all = Object.keys(snaps).sort();
    while (all.length > STATS_SNAP_KEEP) { delete snaps[all.shift()]; }
    saveMaster();
    return true;
  }

  /* 確定済みの月の保存（自分のぶん）を消して、保存の枠を空ける。
   * 数字は確定データに残っているので、実績の表示は変わらない。 */
  function statsPurgeSettled() {
    var snaps = statsSnapshots();
    if (!Object.keys(snaps).length) return 0;
    var del = loadSavedDel();
    var now = Date.now(), removed = 0;
    var keep = savedList.filter(function (it) {
      if (!snaps[statsMonthOf(it.savedAt)]) return true;
      del[it.id] = now;
      removed++;
      return false;
    });
    if (!removed) return 0;
    savedList = keep;
    saveSavedDel(null, del);
    persistSaved();
    renderSaved();
    return removed;
  }

  /* 実績の画面。
   * 主役は「何の応対から何を成約したか」の早見表。
   * 成約率などの分析は、現場が記録に慣れてからにする（店舗の指定・2026-08-10）。 */
  function renderStats(refresh) {
    var body = $("statsBody");
    if (!body) return;
    if (refresh || !statsLists) {
      body.innerHTML = '<p class="hint">読み込み中…</p>';
      loadAllSaved(function () {
        /* 先々月ぶんを確定して、確定済みの月の保存を消す（保存の枠を空ける）。
         * 数字は確定データに残るので、実績の表示は変わらない。 */
        statsAutoSettle(statsLists);
        if (statsPurgeSettled()) { statsLists[activeStaff().id] = savedList; }
        renderStats(false);
      });
      return;
    }
    var lists = statsLists;
    var admin = statsAdminOk();          // 件数の修正など、管理の操作ができるか
    var viewAll = statsViewAll();        // 全担当の実績を見られるか（公開設定を含む）
    var me = activeStaff().id;
    /* 担当者の画面に出すのは、自分が応対した件と、自分が成約・見送りを決めた件だけ */
    function mineOnly(it, sid) { return viewAll || sid === me || resStaffOf(it, sid) === me; }
    /* 引き渡した元（コンデザが作って担当へ渡した見積もり）は数えない。
     * 渡した先の控えが1件として数えられる。 */
    function isSent(it) { return !!it.sentTo; }

    /* ---- 期間・担当の選択 ---- */
    var monthSel = $("statsMonth"), staffSel = $("statsStaff");
    var months = {};
    Object.keys(lists).forEach(function (sid) {
      lists[sid].forEach(function (it) { if (mineOnly(it, sid)) months[statsMonthOf(it.savedAt)] = true; });
    });
    var curMonth = statsMonthOf(Date.now());
    months[curMonth] = true;                 // 当月は保存がなくても選べるようにする
    var snaps = statsSnapshots();
    Object.keys(snaps).forEach(function (m) { months[m] = true; });  // 確定済みの月も選べる
    var mKeys = Object.keys(months).sort().reverse();
    var mPrev = monthSel.value || curMonth;
    monthSel.innerHTML = mKeys.map(function (m) {
      return '<option value="' + m + '">' + m
        + (m === curMonth ? "（今月）" : (snaps[m] ? "（確定）" : "")) + "</option>";
    }).join("") + '<option value="all">全期間</option>';
    monthSel.value = (mPrev === "all" || months[mPrev]) ? mPrev : curMonth;

    var unlockBtn = $("statsUnlockBtn");
    if (unlockBtn) unlockBtn.hidden = viewAll;
    var mornBtn = $("statsMorning");
    if (mornBtn) mornBtn.hidden = !viewAll;
    if (staffSel.parentElement) staffSel.parentElement.style.display = viewAll ? "" : "none";
    var sPrev = staffSel.value || "all";
    staffSel.innerHTML = '<option value="all">全員</option>' + config.staff.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>";
    }).join("");
    staffSel.value = config.staff.some(function (s) { return s.id === sPrev; }) ? sPrev : "all";
    // 管理者以外は、常に自分（ログイン中の担当）の実績だけ
    var mFil = monthSel.value, sFil = viewAll ? staffSel.value : me;
    var settled = snaps[mFil] || null;   // 確定済みの月は、この数字を出す
    var sName = "全員";
    if (sFil !== "all") {
      var ssNow = config.staff.filter(function (s) { return s.id === sFil; })[0];
      sName = (ssNow && ssNow.name) || sFil;
    }

    var agg;
    if (settled) {
      agg = statsFromSnapshot(settled, sFil);
    } else {
      agg = statsAggregate(lists, mFil, sFil, mineOnly);
      // 「全期間」では、確定済みの月ぶんも足す（保存を消したぶんが欠けないように）
      if (mFil === "all") {
        Object.keys(snaps).forEach(function (m) {
          statsMergeAgg(agg, statsFromSnapshot(snaps[m], sFil));
        });
      }
    }
    var items = agg.items, visitUsed = agg.visitUsed, vpAgg = agg.vpAgg;
    var byDay = agg.byDay, staffAgg = agg.staffAgg, cross = agg.cross;
    var catalog = statsCatalog();

    /* ---- 並び順 ---- */
    var order = ["proc:kishu", "kaimashi", "proc:mnp", "proc:shinki", "u15", "highend", "device",
      "proc:", "plan:", "dcard:", "denki:", "gas", "ie:", "opt:", "maxAmazon", "fee:", "own:", "acc:"];
    function rank(k) {
      for (var i = 0; i < order.length; i++) if (k.indexOf(order[i]) === 0) return i;
      return order.length;
    }
    var iKeys = Object.keys(items).filter(function (k) {
      return items[k].prop > 0 || items[k].won > 0;
    }).sort(function (a2, b2) {
      return (rank(a2) - rank(b2)) || (items[b2].won - items[a2].won)
        || (items[b2].prop - items[a2].prop) || (items[a2].name < items[b2].name ? -1 : 1);
    });
    /* Amazonプライムは「新規 → 既存 →（再掲）新プラン × Amazon Prime」の順で
     * 固めて出す。件数の多い順に並べると3つが離れてしまい読みにくいため
     * （店舗の指定・2026-08-11）。 */
    var azIds = amazonOptIds();
    azIds.forEach(function (id) {
      var kNew = "opt:" + id, kEx = kNew + ":exist";
      var iEx = iKeys.indexOf(kEx);
      if (iEx < 0) return;
      var iNew = iKeys.indexOf(kNew);
      if (iNew < 0) return;                 // 新規の行が無いときはそのまま
      iKeys.splice(iEx, 1);
      iKeys.splice(iKeys.indexOf(kNew) + 1, 0, kEx);
    });
    var lastAz = -1;
    iKeys.forEach(function (k, i) {
      azIds.forEach(function (id) {
        if (k === "opt:" + id || k === "opt:" + id + ":exist") lastAz = i;
      });
    });
    var reIdx = iKeys.indexOf("maxAmazon");
    if (reIdx >= 0 && lastAz >= 0) {
      iKeys.splice(reIdx, 1);
      if (reIdx < lastAz) lastAz--;
      iKeys.splice(lastAz + 1, 0, "maxAmazon");
    }
    var vCols = VISIT_ORDER.filter(function (k) { return visitUsed[k]; });
    if (vpAgg["_none"]) vCols.push("_none");
    function vName(k) { return k === "_none" ? "（未選択）" : VISIT_NAMES[k]; }
    function vShort(k) {
      var m2 = { buy: "端末購入", plan: "プラン見直し", repair: "故障", howto: "操作", ask: "問合せ", other: "その他", _none: "未選択" };
      return m2[k] || k;
    }

    /* ---- 手修正ができるか ----
     * 担当者は当月の自分ぶんだけ（当日の記録として足し引きされる）。
     * 管理者は担当と月を選んでいればいつでも。 */
    var canAdj = !settled && sFil !== "all" && mFil !== "all"
      && (admin || (sFil === me && mFil === curMonth));
    var adjScope = (admin && mFil !== curMonth) ? "month" : "day";

    var h = "";

    /* ---- ロック未設定のお知らせ ----
     * 店舗ログインもマスタ設定のパスワードも無い店舗では、仕切りようが無く
     * 全員が全担当の実績を見られる。気づかないまま公開されないよう、
     * その状態であることと、分けたいときの設定場所を知らせる。
     * 店舗の判断で「公開する」を選んだ場合（openAll）は出さない。 */
    if (viewAll && !statsUnlocked && !statsCfg().openAll
        && !adminLockEnabled() && !lockEnabled() && !cloudOn()
        && config.staff.length > 1) {
      h += '<div class="stats-undone"><b style="color:var(--red)">いまは全担当の実績が全員に見えています。</b>'
        + "店舗ログインもマスタ設定のパスワードも設定していないため、担当者ごとに仕切れない状態です。"
        + "担当者ごとに分けたいときは、マスタ設定で「マスタ設定のパスワード」を設定してください。"
        + "全員で見る運用のままでよいときは、マスタ設定の「実績で追う項目」で「全担当の実績を全員に公開する」にチェックを入れると、このお知らせは出なくなります。"
        + '<button type="button" class="btn-sub" id="statsLockHintBtn">マスタ設定を開く</button></div>';
    }

    /* ---- 結果が未記録の応対 ---- */
    var myUndone = (!settled && staffAgg[sFil]) ? staffAgg[sFil].undone : 0;
    if (sFil !== "all" && myUndone > 0) {
      h += '<div class="stats-undone">結果が未記録の応対が <b>' + myUndone + "件</b>あります。"
        + '<button type="button" class="btn-sub" id="statsUndoneBtn">保存タブで記録する</button></div>';
    }

    /* ---- 主役: 成約の早見表 ---- */
    h += "<h3>" + (mFil === "all" ? "全期間" : esc(mFil)) + "の成約"
      + (sFil === "all" ? "（全員）" : "（" + esc(sName) + "）")
      + (settled ? '<span class="settled-mark">確定済み</span>' : "") + "</h3>";
    /* この表は「何の応対から何が成約したか」を見るためのもの。
     * 提案の数は出さない（店舗の指定・2026-08-13）。
     * そのぶん、成約が0の項目は行ごと落とす。ただし「修正」が使える画面
     * （担当と月を選んでいるとき）では、＋で足せるように提案だけの行も残す。 */
    var iShow = iKeys.filter(function (k) {
      return items[k].won > 0 || (canAdj && items[k].prop > 0);
    });
    /* 表は3つに分ける（店舗の指定・2026-08-13）。
     *   ① 手続き・プラン・オプションなど
     *   ② 独自商材（月額のもの＝マスタで「店舗独自」にしたオプション）
     *   ③ アクセサリ（キャリアのものも店舗のものも一緒）
     * 数が多くて種類も違うので、1つの表に混ぜると見づらいため。
     * 一括払いの独自商材（own:f:）は①に残す。 */
    var iOwn = iShow.filter(function (k) { return k.indexOf("own:o:") === 0; });
    var iAcc = iShow.filter(function (k) { return k.indexOf("acc:") === 0; });
    var iMain = iShow.filter(function (k) {
      return k.indexOf("own:o:") !== 0 && k.indexOf("acc:") !== 0;
    });

    /* 3つとも同じ列（項目・成約・ご来店の目的・修正）で出す */
    function mainTable(keys) {
      var t = '<div class="stats-scroll"><table class="stats-table stats-main"><tr><th>項目</th><th>成約</th>'
        + vCols.map(function (k) { return "<th>" + esc(vShort(k)) + "</th>"; }).join("")
        + (canAdj ? "<th>修正</th>" : "") + "</tr>";
      /* 縦の合計は出さない。「（再掲）」の行が二重に足されるので、
       * 足した数字に意味がないため（応対数・成約数は「担当別」の表で見る）。 */
      keys.forEach(function (k) {
        var x = items[k];
        t += "<tr><td>" + esc(x.name) + "</td>"
          + '<td class="n-won">' + (x.won || "－") + "</td>"
          + vCols.map(function (vk) { return "<td>" + (x.byVisit[vk] || "") + "</td>"; }).join("")
          + (canAdj
              ? '<td class="adj-cell"><button type="button" class="adjb" data-adjk="' + esc(k) + '" data-adjd="-1">−</button>'
                + '<button type="button" class="adjb" data-adjk="' + esc(k) + '" data-adjd="1">＋</button></td>'
              : "")
          + "</tr>";
      });
      return t + "</table></div>";
    }

    if (!iShow.length) {
      h += '<p class="hint">'
        + (iKeys.length ? "この期間はまだ成約の記録がありません。" : "この期間の記録がまだありません。")
        + "</p>";
    } else {
      if (iMain.length) h += mainTable(iMain);
      /* 見出しは h3 のまま（朝礼の印刷が h3 と表だけを拾うため）。
       * 小さく見せるのは stats-sub のスタイルで行う。 */
      if (iOwn.length) h += '<h3 class="stats-sub">独自商材（月額）</h3>' + mainTable(iOwn);
      if (iAcc.length) h += '<h3 class="stats-sub">アクセサリ</h3>' + mainTable(iAcc);
      if (canAdj) {
        h += '<p class="hint">数え違いがあれば「修正」の <b>＋ −</b> で直せます'
          + (adjScope === "day" ? "（今日の記録として足し引きされます）" : "（" + esc(mFil) + " の調整として足し引きされます）")
          + "。</p>";
      }
    }

    /* 成約の内訳を「機種変更 3・dカード GOLD 1」の形にする。
     * 来店目的ごとの表と、日別の表の両方で使う。 */
    var dCat = statsCatalog();
    function dItemName(k) { return (items[k] && items[k].name) || dCat[k] || k; }
    function dItemText(bag) {
      var ks = Object.keys(bag || {});
      if (!ks.length) return "";
      ks.sort(function (x, y) {
        return (rank(x) - rank(y)) || (bag[y] - bag[x])
          || (dItemName(x) < dItemName(y) ? -1 : 1);
      });
      return ks.map(function (k) {
        return dItemName(k) + (bag[k] > 1 ? " " + bag[k] : "");
      }).join("・");
    }

    /* ---- 来店目的ごとの応対と、そこから決まったもの ----
     * 「操作で12件応対して、そこから機種変更が3件」を1行で読めるようにする
     * （店舗の指定・2026-08-11）。 */
    var vpKeys = VISIT_ORDER.filter(function (k) { return vpAgg[k]; });
    if (vpAgg["_none"]) vpKeys.push("_none");
    var vpItemBag = {};   // 目的 -> {項目キー: 成約件数}
    iKeys.forEach(function (k) {
      var bv = (items[k] || {}).byVisit || {};
      Object.keys(bv).forEach(function (vk) {
        if (!vpItemBag[vk]) vpItemBag[vk] = {};
        vpItemBag[vk][k] = (vpItemBag[vk][k] || 0) + bv[vk];
      });
    });
    var vpRows = [];
    if (statsCfg().visit && vpKeys.length) {
      h += "<h3>ご来店の目的</h3>";
      h += '<div class="stats-scroll"><table class="stats-table"><tr><th>目的</th><th>応対</th>'
        + "<th>成約</th><th>成約率</th><th>成約した内容</th></tr>";
      vpKeys.forEach(function (k) {
        var pr = vpAgg[k].prop, wn = vpAgg[k].won;
        var rate = pr ? Math.round(wn * 100 / pr) + "%" : "－";
        var txt = dItemText(vpItemBag[k]);
        vpRows.push({ name: vName(k), prop: pr, won: wn, rate: rate, items: txt });
        h += "<tr><td>" + esc(vName(k)) + "</td><td>" + pr + "</td><td>" + wn + "</td>"
          + "<td>" + rate + "</td>"
          + '<td class="day-items">' + (txt ? esc(txt) : "－") + "</td></tr>";
      });
      h += "</table></div>";
      h += '<p class="hint"><strong>応対</strong>はその目的で来店されたお客様の数、'
        + "<strong>成約</strong>はそのうち成約になった数です。"
        + "目的を2つ以上選んだ応対は、それぞれの行に数えます。</p>";
    }

    /* ---- 日別（折りたたみ）----
     * その日に何が成約になったかまで出す。あとから振り返るときに、
     * 日付と件数だけでは中身が思い出せないため。 */
    var dayRows = [];
    if (mFil !== "all") {
      var dKeys = Object.keys(byDay).sort();
      var DOW = ["日", "月", "火", "水", "木", "金", "土"];
      var dTot = { prop: 0, won: 0 };
      var dHtml = "";
      dKeys.forEach(function (k5) {
        var v5 = byDay[k5];
        dTot.prop += v5.prop; dTot.won += v5.won;
        var label = k5.slice(5) + "（" + DOW[v5.dow] + "）";
        var txt5 = dItemText(v5.items);
        dayRows.push({ date: k5, label: label, prop: v5.prop, won: v5.won, items: txt5 });
        /* 成約の件数は出さない。何が決まったかは右の内訳で読めるため
         * （店舗の指定・2026-08-11）。 */
        dHtml += '<tr class="' + (v5.dow === 0 ? "d-sun" : (v5.dow === 6 ? "d-sat" : "")) + '"><td>'
          + esc(label) + "</td><td>" + v5.prop + "</td>"
          + '<td class="day-items">' + (txt5 ? esc(txt5) : "－") + "</td></tr>";
      });
      if (dKeys.length) {
        h += '<details class="stats-days"><summary>日別（応対 ' + dTot.prop + "・成約 " + dTot.won + "）</summary>"
          + '<div class="stats-scroll"><table class="stats-table"><tr><th>日付</th><th>応対</th>'
          + "<th>成約した内容</th></tr>"
          + dHtml + "</table></div></details>";
      }
    }

    /* ---- ここから管理者（または公開設定の店舗では全員）だけ ---- */
    if (viewAll) {
      // 担当別（担当を選んでいるときは1行だけになるので出さない）
      var sRows = (sFil === "all" ? config.staff : []).map(function (s) {
        var a3 = staffAgg[s.id] || { prop: 0, won: 0, undone: 0 };
        var ad3 = statsAdjSum(s.id, mFil);
        return { id: s.id, name: s.name,
          prop: Math.max(0, a3.prop + ad3.prop), won: Math.max(0, a3.won + ad3.won), undone: a3.undone };
      });
      var anyUndone = sRows.some(function (r) { return r.undone > 0; });
      if (sRows.length) {
      h += "<h3>担当別</h3>";
      h += '<div class="stats-scroll"><table class="stats-table"><tr><th>担当</th><th>応対</th><th>成約</th>'
        + (anyUndone ? "<th>未記録</th>" : "") + "</tr>";
      var sT = { prop: 0, won: 0, undone: 0 };
      sRows.forEach(function (r) {
        sT.prop += r.prop; sT.won += r.won; sT.undone += r.undone;
        h += "<tr><td>" + esc(r.name) + "</td><td>" + r.prop + "</td><td>" + r.won + "</td>"
          + (anyUndone ? '<td class="' + (r.undone ? "warn-cell" : "") + '">' + (r.undone || "") + "</td>" : "")
          + "</tr>";
      });
      if (sRows.length > 1) {
        h += '<tr class="stats-total"><td>合計</td><td>' + sT.prop + "</td><td>" + sT.won + "</td>"
          + (anyUndone ? "<td>" + (sT.undone || "") + "</td>" : "") + "</tr>";
      }
      h += "</table></div>";
      }

      // 担当 × 項目（誰が何を決めたか）
      if (sFil === "all" && iKeys.length && config.staff.length > 1) {
        h += "<h3>担当 × 項目（成約）</h3>";
        h += '<div class="stats-scroll"><table class="stats-table"><tr><th>項目</th>'
          + config.staff.map(function (s) { return "<th>" + esc(s.name) + "</th>"; }).join("")
          + "<th>合計</th></tr>";
        iKeys.forEach(function (k) {
          if (!items[k].won) return;
          h += "<tr><td>" + esc(items[k].name) + "</td>"
            + config.staff.map(function (s) {
                var n2 = (cross[s.id] || {})[k] || 0;
                return "<td>" + (n2 || "") + "</td>";
              }).join("")
            + "<td><b>" + items[k].won + "</b></td></tr>";
        });
        h += "</table></div>";
      }

      // 目標と進捗（目標はマスタ設定で入れる）
      var goals = MASTER.statsGoalItems || {};
      var gKeys = Object.keys(goals).filter(function (k) { return num(goals[k]) > 0; });
      if (gKeys.length && mFil !== "all") {
        var d9 = new Date();
        var isCur = mFil === curMonth;
        var daysIn = new Date(+mFil.slice(0, 4), +mFil.slice(5), 0).getDate();
        var passed = isCur ? d9.getDate() : daysIn;
        h += "<h3>目標と進捗（" + esc(mFil) + "）</h3>";
        h += '<div class="stats-scroll"><table class="stats-table"><tr><th>項目</th><th>目標</th><th>成約</th><th>残り</th><th>着地見込み</th></tr>';
        gKeys.sort(function (a4, b4) { return rank(a4) - rank(b4); }).forEach(function (k) {
          var g = num(goals[k]);
          var w = (items[k] && items[k].won) || 0;
          var est = passed ? Math.round(w * daysIn / passed) : 0;
          h += "<tr><td>" + esc(catalog[k] || k) + "</td><td>" + g + "</td><td>" + w + "</td>"
            + '<td class="' + (w >= g ? "ok-cell" : "warn-cell") + '">' + Math.max(0, g - w) + "</td>"
            + "<td>" + (isCur ? est : w) + "</td></tr>";
        });
        h += "</table></div>";
        h += '<p class="hint">目標は<strong>マスタ設定 →「実績の目標」</strong>で決めます。着地見込みは、今のペースが月末まで続いた場合の件数です。</p>';
      }
    }

    body.innerHTML = h;

    // CSV出力用に、いま表示した集計を控えておく
    statsLast = {
      month: mFil, staffName: sName, admin: viewAll,
      items: items, iKeys: iKeys, vCols: vCols, vName: vName,
      visits: vpRows,
      days: dayRows,
      staff: config.staff.filter(function (s) { return sFil === "all" || s.id === sFil; }).map(function (s) {
        var a5 = staffAgg[s.id] || { prop: 0, won: 0, undone: 0 };
        var ad5 = statsAdjSum(s.id, mFil);
        return { name: s.name, prop: Math.max(0, a5.prop + ad5.prop), won: Math.max(0, a5.won + ad5.won), undone: a5.undone };
      }),
      cross: cross
    };
  }

  /* ---------- 実績のCSV出力（Excelで開ける形式） ---------- */
  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  /* ---------- 分析用CSV（1行1件のたて長） ----------
   * 店舗責任者がスプレッドシートに貼り付けて、SUMIFS やピボットで
   * 自由に集計するための形。画面の表と違い、1枚のまっすぐな表にする。
   *   日付 / 曜日 / 担当 / 来店目的 / 種別 / 項目 / 件数
   * 種別は「応対」「成約応対」「提案」「成約」の4つ。
   *   応対     … その目的で応対した件数（分母。項目は空）
   *   成約応対 … そのうち成約になった件数（項目は空）
   *   提案・成約 … 項目ごとの件数
   * 担当は、応対・提案は応対した担当、成約応対・成約は成約を決めた担当。
   * 目的を2つ以上選んだ応対は、目的ごとに行を作る（足すと二重になる）。 */
  var CSV_DOW = ["日", "月", "火", "水", "木", "金", "土"];
  function statsFlatRows(lists, mFil, sFil, mineOnlyFn) {
    var rows = [];
    function inPeriod(it) { return mFil === "all" || statsMonthOf(it.savedAt) === mFil; }
    function vLabel(k) { return k === "_none" ? "（未選択）" : VISIT_NAMES[k]; }
    Object.keys(lists).forEach(function (sid) {
      (lists[sid] || []).filter(inPeriod).forEach(function (it) {
        if (it.sentTo || !mineOnlyFn(it, sid)) return;
        var decider = resStaffOf(it, sid);
        var ownMatch = (sFil === "all" || sid === sFil);
        var decMatch = (sFil === "all" || decider === sFil);
        if (!ownMatch && !decMatch) return;

        var pats0 = ((it.data || {}).patterns) || [];
        var pt0 = pats0[0] || pats0[((it.data || {}).active | 0)] || {};
        var vks = visitKeys(pt0);
        if (!vks.length) vks = visitKeys(pats0[((it.data || {}).active | 0)] || {});
        if (!vks.length) vks = ["_none"];
        var dt = new Date(it.savedAt || 0);
        var dk = dt.getFullYear() + "/" + ("0" + (dt.getMonth() + 1)).slice(-2)
          + "/" + ("0" + dt.getDate()).slice(-2);
        var dow = CSV_DOW[dt.getDay()];
        /* 目的を2つ選んだ応対は目的ごとに行を作るので、目的をまたいで足すと
         * 二重に数えてしまう。全体の数を出すための「（全体）」の行を別に作り、
         * 集計するときは目的で絞れば済むようにする。 */
        var vLabels = ["（全体）"].concat(vks.map(vLabel));
        function put(staffId, vl, kind, name, n) {
          rows.push([dk, dow, staffName(staffId) || staffId, vl, kind, name || "", n]);
        }
        if (ownMatch) {
          var propI = statsSavedItems(it, false);
          vLabels.forEach(function (vl) {
            put(sid, vl, "応対", "", 1);
            Object.keys(propI).forEach(function (k) {
              put(sid, vl, "提案", propI[k].name, propI[k].n);
            });
          });
        }
        if (it.result === "won" && decMatch) {
          var wonI = statsSavedItems(it, true);
          vLabels.forEach(function (vl) {
            put(decider, vl, "成約応対", "", 1);
            Object.keys(wonI).forEach(function (k) {
              put(decider, vl, "成約", wonI[k].name, wonI[k].n);
            });
          });
        }
      });
    });
    rows.sort(function (a2, b2) {
      return (a2[0] < b2[0] ? -1 : a2[0] > b2[0] ? 1 : 0)
        || (a2[2] < b2[2] ? -1 : a2[2] > b2[2] ? 1 : 0)
        || (a2[3] < b2[3] ? -1 : a2[3] > b2[3] ? 1 : 0);
    });
    return rows;
  }
  function downloadStatsFlatCsv() {
    var L = statsLast;
    if (!L) return;
    var mFil = L.month;
    var viewAll = statsViewAll();
    var me = activeStaff().id;
    var sFil = viewAll ? ($("statsStaff") || {}).value || "all" : me;
    var rows = statsFlatRows(statsLists, mFil, sFil, function (it, sid) {
      return viewAll || sid === me || resStaffOf(it, sid) === me;
    });
    var lines = ["日付,曜日,担当,来店目的,種別,項目,件数"];
    rows.forEach(function (r) { lines.push(r.map(csvCell).join(",")); });
    var csv = "\uFEFF" + lines.join("\r\n");
    var store2 = (config.storeName || "店舗").replace(/[\\/:*?"<>|\s]/g, "");
    var fname = "実績_分析用_" + store2 + "_"
      + (mFil === "all" ? "全期間" : mFil.replace("/", "")) + ".csv";
    csvDownload(csv, fname);
  }
  // Blobを作ってダウンロードさせる（2つのCSVで同じ処理を使う）
  function csvDownload(csv, fname) {
    try {
      var blob = new Blob([csv], { type: "text/csv" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {}
  }
  function downloadStatsCsv() {
    var L = statsLast;
    if (!L) return;
    var period = L.month === "all" ? "全期間" : L.month;
    var lines = [];
    lines.push(["実績", "期間: " + period, "担当: " + L.staffName, "出力: " + savedWhen(Date.now())].map(csvCell).join(","));

    // 成約の早見表（項目 × 来店目的）。画面と同じ並び・同じ列
    lines.push("");
    lines.push("成約の早見表");
    lines.push(["項目", "提案", "成約"].concat(L.vCols.map(function (k) { return L.vName(k); })).map(csvCell).join(","));
    L.iKeys.forEach(function (k) {
      var x = L.items[k];
      lines.push([x.name, x.prop, x.won].concat(L.vCols.map(function (vk) {
        return x.byVisit[vk] || 0;
      })).map(csvCell).join(","));
    });

    if (L.visits && L.visits.length) {
      lines.push("");
      lines.push("ご来店の目的");
      lines.push("目的,応対,成約,成約率,成約した内容");
      L.visits.forEach(function (v2) {
        lines.push([v2.name, v2.prop, v2.won, v2.rate, v2.items || ""].map(csvCell).join(","));
      });
    }
    if (L.days && L.days.length) {
      lines.push("");
      lines.push("日別");
      lines.push("日付,応対,成約,成約した内容");
      L.days.forEach(function (d3) {
        lines.push([d3.date, d3.prop, d3.won, d3.items || ""].map(csvCell).join(","));
      });
    }
    if (L.admin && L.staff && L.staff.length) {
      lines.push("");
      lines.push("担当別");
      lines.push("担当,応対,成約,未記録");
      L.staff.forEach(function (r2) {
        lines.push([r2.name, r2.prop, r2.won, r2.undone].map(csvCell).join(","));
      });
      /* スプレッドシートでのピボット用に、1行＝担当×項目の明細も出す */
      lines.push("");
      lines.push("明細（担当×項目の成約）");
      lines.push("担当,項目,成約");
      config.staff.forEach(function (s2) {
        var bag = (L.cross || {})[s2.id] || {};
        L.iKeys.forEach(function (k) {
          if (!bag[k]) return;
          lines.push([s2.name, L.items[k].name, bag[k]].map(csvCell).join(","));
        });
      });
    }
    // 先頭のBOMで、Excelが文字コードを正しく認識する（無いと文字化けする）
    var csv = "\uFEFF" + lines.join("\r\n");
    var store2 = (config.storeName || "店舗").replace(/[\\/:*?"<>|\s]/g, "");
    var d = new Date();
    function z(n) { return ("0" + n).slice(-2); }
    var fname = "実績_" + store2 + "_" + (L.month === "all" ? "全期間" : L.month.replace("/", "")) + "_"
      + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + ".csv";
    csvDownload(csv, fname);
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
  // マスタ設定専用のパスワードを決めているか
  function adminLockEnabled() { return !!(config.adminLock && config.adminLock.hash); }

  /* ---------- 料金マスタの履歴 ----------
   * 料金改定の前に戻せるように、マスタの内容をまるごと控えておく。
   * ・マスタ設定を開いてから最初の編集で、編集前の内容を自動で1件残す
   * ・「いまの内容を履歴に残す」でメモを付けて任意に残せる
   * クラウド利用時は stores/{UID}/history/{id} に置き、店舗内の全端末で同じ履歴を見る。 */
  var HIST_KEY = NS + "-master-hist-v1";
  var HIST_MAX = 20;
  var HIST_SETTLE_MS = 60 * 1000; // これだけ編集が途切れたら、ひと区切りとみなす
  var histList = [];
  var histLoaded = false;      // クラウドからの読み込みは開いたとき1回だけ
  var histBaseline = "";       // ひと区切り前のマスタの内容
  var histBurst = false;       // いま編集が続いている最中か
  var histBurstEntry = null;   // いま編集中のかたまりに対応する履歴（あとで変更点を書き込む）
  var histSettleTimer = null;
  function histLoadLocal() {
    histList = [];
    histBurstEntry = null;
    try {
      var a = JSON.parse(localStorage.getItem(HIST_KEY) || "null");
      if (a && a.length) histList = a;
    } catch (e) {}
  }
  function histSaveLocal() {
    lsSet(HIST_KEY, JSON.stringify(histList));
  }
  function histEditor() {
    if (typeof masterOnly !== "undefined" && masterOnly) return "管理者";
    var s = activeStaff();
    return (s && s.name) || "担当";
  }
  /* ---------- 何を変更したのかを割り出す ----------
   * 控えておいた「変更前の内容」と、いまの内容を突き合わせて、
   * 店舗の方が読んで分かる日本語の一覧にする。 */
  var HIST_MAX_LINES = 12;     // 1件の履歴に残す変更点の上限（超えた分は件数だけ）
  var HIST_FEE_LABELS = {
    jimu_shinki: "事務手数料（新規）", jimu_mnp: "事務手数料（MNP）",
    jimu_kishu: "事務手数料（機種変更）", atamakin_default: "店頭頭金（初期値）"
  };
  var HIST_DISC_LABELS = {
    minna2: "みんなドコモ割（2回線）", minna3: "みんなドコモ割（3回線〜）",
    set: "光／home 5G セット割", dcard: "dカードお支払割",
    dcardGold: "dカードお支払割（GOLD系）", denki: "でんきセット割",
    choki10: "長期利用割（10年〜）", choki20: "長期利用割（20年〜）"
  };
  var HIST_LISTS = [
    ["plans", "プラン"], ["voiceOptions", "通話オプション"], ["options", "オプション"],
    ["feeItems", "初期費用"], ["accessories", "アクセサリ"], ["campaigns", "キャンペーン"]
  ];
  var HIST_FIELD_LABELS = {
    price: "の金額", note: "の説明", category: "の置き場所",
    url: "の公式ページ", desc: "のご案内文",
    carrier: "のdカードGOLD10%対象", own: "の店舗独自",
    pay: "の支払い先", defaultPay: "の支払い方法（初期値）",
    dataMove: "の「データ移行」の印",
    bakuage: "の爆アゲ率（MAX系）", bakuage2: "の爆アゲ率（その他）",
    bakuageFixed: "の爆アゲ固定pt",
    priceChoices: "の金額の選択肢", priceLabels: "の選択肢の名前",
    months: "の期間", plans: "の対象プラン", amountChoices: "の割引額の選択肢",
    bakuageTier: "の爆アゲ区分", dcard10: "のdカードGOLD10%対象",
    includes5min: "の5分通話無料", group: "の表示グループ",
    voiceOverrides: "の通話オプションの金額"
  };
  var HIST_UNITS = { bakuage: "%", bakuage2: "%", bakuageFixed: "pt", months: "か月" };
  function histIsNum(v) { return typeof v === "number" && isFinite(v); }
  function histAmt(v, unit) {
    if (!histIsNum(v)) return "（なし）";
    return v.toLocaleString("ja-JP") + (unit || "円");
  }
  function histText(v) {
    if (v === true) return "あり";
    if (v === false) return "なし";
    if (v === null || typeof v === "undefined" || v === "") return "（空欄）";
    var s = String(v);
    return s.length > 24 ? s.slice(0, 24) + "…" : s;
  }
  function histSame(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  // 名前が空のまま追加された行もあるので、その場合は「名称未設定」と書く
  function histName(x) {
    var n = String((x && x.name) || "").trim();
    return n ? "「" + histText(n) + "」" : "（名称未設定）";
  }
  // 基本料金の段階（〜1GB など）
  function histDiffTiers(head, a, b, out) {
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var x = a[i], y = b[i];
      if (!x) { out.push(head + "に段階「" + histText(y && y.label) + "」を追加"); continue; }
      if (!y) { out.push(head + "の段階「" + histText(x.label) + "」を削除"); continue; }
      if (x.label !== y.label) {
        out.push(head + "の段階名を「" + histText(x.label) + "」→「" + histText(y.label) + "」に変更");
      }
      if (x.price !== y.price) {
        out.push(head + "の基本料金（" + histText(y.label) + "） " + histAmt(x.price) + " → " + histAmt(y.price));
      }
    }
  }
  // プランごとの割引額
  function histDiffDisc(head, a, b, out) {
    var keys = {}, k;
    for (k in a) keys[k] = 1;
    for (k in b) keys[k] = 1;
    Object.keys(keys).forEach(function (k2) {
      if (a[k2] === b[k2]) return;
      var lab = HIST_DISC_LABELS[k2] || k2;
      if (!(k2 in b)) { out.push(head + "の" + lab + "を削除"); return; }
      if (!(k2 in a)) { out.push(head + "に" + lab + "を追加（" + histAmt(b[k2]) + "）"); return; }
      out.push(head + "の" + lab + " " + histAmt(a[k2]) + " → " + histAmt(b[k2]));
    });
  }
  function histDiffFields(sec, x, y, out) {
    var head = sec + histName(y.name ? y : x);
    var keys = {}, k;
    for (k in x) keys[k] = 1;
    for (k in y) keys[k] = 1;
    Object.keys(keys).forEach(function (k2) {
      if (k2 === "id" || k2.charAt(0) === "_") return;
      var va = x[k2], vb = y[k2];
      if (histSame(va, vb)) return;
      if (k2 === "name") {
        out.push(sec + histName(x) + "の名前を" + histName(y) + "に変更");
        return;
      }
      if (k2 === "tiers") { histDiffTiers(head, va || [], vb || [], out); return; }
      if (k2 === "discounts") { histDiffDisc(head, va || {}, vb || {}, out); return; }
      var lab = HIST_FIELD_LABELS[k2] || ("の" + k2);
      if (histIsNum(va) || histIsNum(vb)) {
        out.push(head + lab + " " + histAmt(va, HIST_UNITS[k2]) + " → " + histAmt(vb, HIST_UNITS[k2]));
      } else if (va && typeof va === "object" || vb && typeof vb === "object") {
        out.push(head + lab + "を変更");
      } else {
        out.push(head + lab + "を「" + histText(vb) + "」に変更");
      }
    });
  }
  function histDiffList(sec, la, lb, out) {
    var ia = {}, ib = {};
    la.forEach(function (x) { ia[x.id] = x; });
    lb.forEach(function (x) { ib[x.id] = x; });
    lb.forEach(function (x) { if (!ia[x.id]) out.push(sec + histName(x) + "を追加"); });
    la.forEach(function (x) { if (!ib[x.id]) out.push(sec + histName(x) + "を削除"); });
    la.forEach(function (x) { if (ib[x.id]) histDiffFields(sec, x, ib[x.id], out); });
    // 並べ替えだけの変更も分かるようにする（増減した分は除いて比べる）
    var oa = la.filter(function (x) { return ib[x.id]; }).map(function (x) { return x.id; }).join(",");
    var ob = lb.filter(function (x) { return ia[x.id]; }).map(function (x) { return x.id; }).join(",");
    if (oa !== ob) out.push(sec + "の並び順を変更");
  }
  /* 変更前後の差を返す。まったく同じなら null（履歴に残す意味がない）。 */
  function histChanges(beforeJson, afterJson) {
    if (beforeJson === afterJson) return null;
    var a, b;
    try { a = JSON.parse(beforeJson) || {}; b = JSON.parse(afterJson) || {}; }
    catch (e) { return { lines: ["内容を変更しました"], more: 0 }; }
    var out = [];
    var fa = a.fees || {}, fb = b.fees || {};
    Object.keys(HIST_FEE_LABELS).forEach(function (k) {
      if (fa[k] === fb[k]) return;
      out.push(HIST_FEE_LABELS[k] + " " + histAmt(fa[k]) + " → " + histAmt(fb[k]));
    });
    HIST_LISTS.forEach(function (s) { histDiffList(s[1], a[s[0]] || [], b[s[0]] || [], out); });
    if (!out.length) out.push("内容を変更しました");
    return { lines: out.slice(0, HIST_MAX_LINES), more: Math.max(0, out.length - HIST_MAX_LINES) };
  }
  /* 控えたときの内容と、いまの内容の差を、その履歴に書き込む。
   * 触っただけで結局元に戻した場合は、履歴を残さず消す。 */
  function histAttachChanges(entry, afterJson) {
    if (!entry) return;
    var c = histChanges(entry.data, afterJson);
    if (!c) { histDelete(entry.id); return; }
    entry.changes = c.lines;
    entry.more = c.more;
    histSaveLocal();
    renderHistList();
    if (typeof histPush === "function") histPush(entry, []);
  }
  // 一覧に太字で出す見出し。変更点が分かっていればそれを出す
  function histTitle(e) {
    var ch = (e && e.changes) || [];
    return ch.length ? ch[0] : ((e && e.label) || "（メモなし）");
  }

  function histAdd(label, dataJson, auto) {
    var e = {
      id: "h" + Date.now() + Math.random().toString(36).slice(2, 6),
      at: nowStamp(),
      by: histEditor(),
      label: String(label || "").slice(0, 40),
      auto: !!auto,
      data: dataJson
    };
    histList.unshift(e);
    var over = histList.slice(HIST_MAX);
    histList = histList.slice(0, HIST_MAX);
    histSaveLocal();
    renderHistList();
    if (typeof histPush === "function") histPush(e, over);
    return e;
  }
  /* 編集のたびに残すと履歴が埋まってしまうため、編集の「かたまり」ごとに1件残す。
   * 編集が始まったらその直前の内容を控え、しばらく編集が途切れたらひと区切りにする。
   * これで、続けて何度直しても段階的に戻せる。 */
  function histAutoSnapshot() {
    if (histSettleTimer) clearTimeout(histSettleTimer);
    histSettleTimer = setTimeout(histSettle, HIST_SETTLE_MS);
    if (histBurst || !histBaseline) return;
    histBurst = true;
    histBurstEntry = histAdd("編集前の内容", histBaseline, true);
  }
  // かたまりが終わった時点で、何を変更したのかを履歴に書き込む
  function histFinishBurst() {
    if (!histBurstEntry) return;
    var e = histBurstEntry;
    histBurstEntry = null;
    histAttachChanges(e, JSON.stringify(MASTER));
  }
  // ひと区切り。次の編集は新しい戻し先になる
  function histSettle() {
    if (histSettleTimer) { clearTimeout(histSettleTimer); histSettleTimer = null; }
    if (!histBurst) return;
    histBurst = false;
    histFinishBurst();
    histBaseline = JSON.stringify(MASTER);
  }
  function histMark() {
    if (histSettleTimer) { clearTimeout(histSettleTimer); histSettleTimer = null; }
    histFinishBurst();
    histBaseline = JSON.stringify(MASTER);
    histBurst = false;
  }
  function nowStamp() {
    var d = new Date();
    function z(n) { return ("0" + n).slice(-2); }
    return d.getFullYear() + "/" + z(d.getMonth() + 1) + "/" + z(d.getDate())
      + " " + z(d.getHours()) + ":" + z(d.getMinutes());
  }
  function histRestore(id) {
    var e = histList.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    histSettle(); // 編集の途中なら、ここでひと区切りにしてから戻す
    // 戻す操作自体もやり直せるように、いまの内容を残しておく
    var back = histAdd("戻す前の内容", JSON.stringify(MASTER), true);
    lsSet(MASTER_KEY, e.data);
    loadMaster();
    histAttachChanges(back, JSON.stringify(MASTER)); // 戻したことで何が変わったか
    histMark();
    renderMasterTab();
    renderPlanSelect(); renderVoiceSelect(); renderMailOpt();
    renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
    renderCampaigns(); renderDiscountHint();
    syncFormFromState();
    recalc();
    histMsg("「" + histTitle(e) + "」の時点の内容に戻しました");
  }
  function histDelete(id) {
    histList = histList.filter(function (x) { return x.id !== id; });
    histSaveLocal();
    if (typeof histDeleteCloud === "function") histDeleteCloud(id);
    renderHistList();
  }
  function histChangesHtml(e) {
    var ch = e.changes || [];
    if (!ch.length) return "";
    return '<details class="hist-diff"><summary>変更した内容（' + (ch.length + (e.more || 0)) + '件）</summary><ul>'
      + ch.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("")
      + (e.more ? '<li class="hist-omit">ほか' + e.more + "件</li>" : "")
      + "</ul></details>";
  }
  function histListHtml() {
    if (!histList.length) return '<p class="hint">まだ履歴はありません。</p>';
    return '<div class="hist-list">' + histList.map(function (e) {
      var ch = e.changes || [];
      var rest = (ch.length - 1) + (e.more || 0);
      return '<div class="hist-row">'
        + '<div class="hist-info">'
        + '<b>' + esc(histTitle(e))
        + (rest > 0 ? '<span class="hist-more">ほか' + rest + "件</span>" : "")
        + (e.auto ? '<span class="hist-auto">自動</span>' : "") + "</b>"
        + '<span class="hint">' + esc(e.at) + "　" + esc(e.by || "") + "</span>"
        + histChangesHtml(e)
        + "</div>"
        + '<button class="btn-sub" data-hist-restore="' + esc(e.id) + '" type="button">'
        + (ch.length ? "この変更の前に戻す" : "この内容に戻す") + "</button>"
        + '<button class="del" data-hist-del="' + esc(e.id) + '" type="button" aria-label="削除">×</button>'
        + "</div>";
    }).join("") + "</div>";
  }
  function renderHistList() {
    var box = $("histBox");
    if (box) box.innerHTML = histListHtml();
  }
  function histMsg(t) {
    var el = $("histMsg");
    if (!el) return;
    el.textContent = t;
    el.hidden = !t;
  }

  /* ---------- 光・home 5G（イエナカ） ----------
   * 計算と入力画面は ienaka.js が持つ。ここでは入れ物と、見積書への合流を受け持つ。
   * セット割はケータイ側の③割引で既に引いているため、光側では引かない（二重引きの防止）。 */
  function initIenaka() {
    if (typeof KQ_IENAKA === "undefined") return;
    KQ_IENAKA.attach(store.ienaka, function () {
      saveState();
      renderIenakaWarn(calc());
      if ($("tab-sheet").classList.contains("active")) renderSheet();
    });
    KQ_IENAKA.bind();
    KQ_IENAKA.syncForm();
    KQ_IENAKA.render();
    var en = $("ieEnabled");
    if (en) en.checked = !!store.ienaka.enabled;
    var body = $("ieBody");
    if (body) body.hidden = !store.ienaka.enabled;
    var wrap = $("sheetScopeWrap");
    if (wrap) wrap.addEventListener("change", function (e) {
      if (e.target.name !== "sheetScope") return;
      sheetScope = e.target.value;
      renderSheet();
    });
  }
  /* 見積書に出す内容。
   *   phone  … スマホのみ（2枚）
   *   hikari … スマホの見積書はそのままに、光の明細を3枚目の別紙として付ける（3枚）
   *              光の基本料はスマホの月額に含めない（請求が分かれるため）
   *   ienaka … 光のみ（イエナカ単体の見積書。裏面に開通までの流れ＝両面1枚）
   * 「スマホ＋光（世帯の合計）」は 1.112.0 でやめた。請求が分かれるものを
   * 1つの合計で見せると、ドコモの請求額と合わず店頭で説明に困るため。 */
  var sheetScope = "phone";
  var otherWariOpen = false;  // ③割引「その他割引」を手で開いたか（見積もりには保存しない）
  /* 光を申し込むのにスマホ側でセット割を選んでいない、という付け忘れに気づけるようにする。
   * 逆（セット割だけ選んで光を入れていない）は、ご家族の既契約という場合があるので出さない。 */
  function renderIenakaWarn(r) {
    var el = $("ieSetWarn");
    if (!el) return;
    var miss = ienakaOn() && !(r && r.dSet > 0);
    el.hidden = !miss;
    if (miss) {
      el.textContent = remapCircled("スマホ側で「ドコモ光／home 5G セット割」を選んでいません。"
        + "対象のプランであれば、見積もりタブの③割引でチェックを入れてください。");
    }
  }
  function ienakaOn() {
    return typeof KQ_IENAKA !== "undefined" && KQ_IENAKA.isOn();
  }
  /* 開通までの流れ（A4・1枚）。お客様へお渡しする説明用の紙 */
  function flowOnlySheet() {
    var today = new Date();
    var h = '<h2 class="sheet-title">開通までの流れ</h2>';
    h += '<div class="sheet-meta"><span>作成日: ' + today.getFullYear() + "年"
      + (today.getMonth() + 1) + "月" + today.getDate() + '日</span><span></span></div>';
    if (state.custName) h += '<div class="cust">' + esc(state.custName) + "</div>";
    h += KQ_IENAKA.flowSheetHtml();
    var sign = [];
    if (config.storeName) sign.push(esc(config.storeName));
    if (activeStaff().name) sign.push("担当: " + esc(activeStaff().name));
    if (config.storeTel) sign.push("TEL: " + esc(config.storeTel));
    if (sign.length) h += '<div class="sheet-sign">' + sign.join("　") + "</div>";
    h += '<div class="disclaimer">工事日・切替日や所要日数は目安です。お申込み内容・時期・地域により前後します。'
      + "ご不明な点は店頭スタッフへご確認ください。<br>アプリ版 " + APP_VERSION + "</div>";
    return h;
  }
  /* 光だけの見積書（別紙）。中身はイエナカ側が作り、表題と発行元はここで付ける。 */
  function ienakaOnlySheet(setWari) {
    var today = new Date();
    var h = '<h2 class="sheet-title">お見積書（ドコモ光・home 5G）</h2>';
    h += '<div class="sheet-meta"><span>作成日: ' + today.getFullYear() + "年"
      + (today.getMonth() + 1) + "月" + today.getDate() + '日</span><span></span></div>';
    if (state.custName) h += '<div class="cust">' + esc(state.custName) + "</div>";
    h += KQ_IENAKA.sheetHtml(setWari);
    if (state.quoteMemo) h += '<p class="memo">※ ' + esc(state.quoteMemo) + "</p>";
    var sign = [];
    if (config.storeName) sign.push(esc(config.storeName));
    if (activeStaff().name) sign.push("担当: " + esc(activeStaff().name));
    if (config.storeTel) sign.push("TEL: " + esc(config.storeTel));
    if (sign.length) h += '<div class="sheet-sign">' + sign.join("　") + "</div>";
    h += '<div class="disclaimer">本見積もりは概算です。実際のご契約時の金額・適用条件とは異なる場合があります。'
      + "提供エリア・設備状況によりご契約いただけない場合があります。詳細は店頭スタッフへご確認ください。"
      + "本書は当店が作成したご案内であり、NTTドコモが発行するものではありません。<br>"
      + "アプリ版 " + APP_VERSION + "</div>";
    return h;
  }

  /* ---------- 初期設定（初めて使うとき） ----------
   * 新しい店舗が最初に開いたときに、店舗名・担当者・マスタ設定のパスワードを
   * 順に聞く。マスタ設定の場所を知らないまま接客に入ってしまい、
   * 見積書に店舗名が出ない・担当者が「担当1」のまま、という状態を防ぐ。
   *
   * すでに使っている店舗には出さない。判定は保存されている内容だけで行い、
   * 別の端末を足したときにも出ないようにする（クラウドの設定を受け取ってから判定する）。 */
  var WIZ_SKIP_KEY = NS + "-setup-skipped";
  var WIZ_LAST = 4;
  var wizStep = 1;

  function wizSkipped() {
    try { return localStorage.getItem(WIZ_SKIP_KEY) === "1"; } catch (e) { return false; }
  }
  function wizMarkDone() {
    try { localStorage.setItem(WIZ_SKIP_KEY, "1"); } catch (e) {}
  }
  /* まだ一度も設定していない店舗か。
   * 店舗名が入っている、担当者を足している、コードを付けている——
   * どれか1つでもあれば「設定済み」とみなす。 */
  function wizNeeded() {
    if (wizSkipped()) return false;
    if (String(config.storeName || "").trim()) return false;
    var list = config.staff || [];
    if (list.length !== 1) return false;
    var s = list[0];
    if (String(s.code || "").trim()) return false;
    var nm = String(s.name || "").trim();
    return nm === "" || nm === "担当1";
  }
  function wizShow(show) {
    var el = $("setupOverlay");
    if (!el) return;
    el.hidden = !show;
    if (!show) return;
    /* 初期値の「担当1」が入ったままだと、そのまま登録されて
     * 見積書の担当者名が「担当1」になってしまう。自分の名前を書いてもらう。 */
    if (wizStaffUntouched()) config.staff[0].name = "";
    wizStep = 1;
    wizRender();
  }
  // 担当者が初期状態のまま（1人・コードなし・既定の名前）か
  function wizStaffUntouched() {
    var list = config.staff || [];
    if (list.length !== 1) return false;
    if (String(list[0].code || "").trim()) return false;
    var nm = String(list[0].name || "").trim();
    return nm === "担当1" || nm === "";
  }
  function wizErr(t) {
    var el = $("setupErr");
    if (!el) return;
    el.textContent = t || "";
    el.hidden = !t;
  }
  var WIZ_TEXT = [
    null,
    { t: "店舗の情報", l: "見積書に印字されます。あとからマスタ設定で変えられます。" },
    { t: "担当者の登録", l: "見積もりは担当者ごとに分かれて保存されます。" },
    { t: "マスタ設定のパスワード", l: "料金を書き換えられる人を絞るための設定です。" },
    { t: "準備ができました", l: "" }
  ];
  function wizRender() {
    wizErr("");
    var i;
    var dots = "";
    for (i = 1; i <= WIZ_LAST; i++) dots += '<span' + (i <= wizStep ? ' class="on"' : "") + "></span>";
    $("setupSteps").innerHTML = dots;
    $("setupTitle").textContent = WIZ_TEXT[wizStep].t;
    var lead = $("setupLead");
    lead.textContent = WIZ_TEXT[wizStep].l;
    lead.hidden = !WIZ_TEXT[wizStep].l;
    for (i = 1; i <= WIZ_LAST; i++) $("setupStep" + i).hidden = i !== wizStep;
    $("setupBack").hidden = wizStep === 1;
    $("setupNext").textContent = wizStep === WIZ_LAST ? "はじめる" : "次へ";
    $("setupSkipWrap").hidden = wizStep === WIZ_LAST;
    if (wizStep === 1) {
      $("setupStoreName").value = config.storeName || "";
      $("setupStoreTel").value = config.storeTel || "";
      setTimeout(function () { $("setupStoreName").focus(); }, 60);
    }
    if (wizStep === 2) wizRenderStaff();
    if (wizStep === 4) wizRenderSummary();
  }
  function wizRenderStaff() {
    $("setupStaffList").innerHTML = (config.staff || []).map(function (s, i) {
      return '<div class="setup-row">'
        + '<input type="text" value="' + esc(s.name || "") + '" data-wizname="' + i + '" placeholder="担当者名">'
        + '<input type="text" value="' + esc(s.code || "") + '" data-wizcode="' + i + '" placeholder="コード" inputmode="numeric">'
        + (config.staff.length > 1 ? '<button class="del" data-wizdel="' + i + '" type="button" aria-label="削除">×</button>' : "")
        + "</div>";
    }).join("");
  }
  function wizRenderSummary() {
    var codes = (config.staff || []).filter(function (s) { return String(s.code || "").trim(); }).length;
    var h = "<li>店舗名: <b>" + esc(config.storeName || "（未入力）") + "</b></li>";
    h += "<li>電話番号: " + esc(config.storeTel || "（未入力）") + "</li>";
    h += "<li>担当者: <b>" + config.staff.length + "名</b>"
      + (codes ? "（うち " + codes + "名にコードを設定）" : "（コードなし）") + "</li>";
    h += "<li>マスタ設定のパスワード: " + (adminLockEnabled() ? "<b>設定しました</b>" : "設定していません") + "</li>";
    $("setupSummary").innerHTML = h;
  }
  /* 各段階の内容を config へ書き込む。問題があればメッセージを返す。 */
  function wizCommit() {
    if (wizStep === 1) {
      var nm = String($("setupStoreName").value || "").trim();
      if (!nm) return "店舗名を入力してください。見積書に印字されます。";
      config.storeName = nm;
      config.storeTel = String($("setupStoreTel").value || "").trim();
      saveConfig();
      renderStoreConfig();
      applyStoreDefaults(true);
      return "";
    }
    if (wizStep === 2) {
      // 名前もコードも空の行は捨てる
      var list = (config.staff || []).filter(function (s) {
        return String(s.name || "").trim() || String(s.code || "").trim();
      });
      if (!list.length) return "担当者を1名以上登録してください。";
      var blank = list.filter(function (s) { return !String(s.name || "").trim(); });
      if (blank.length) return "担当者名を入力してください。";
      var seen = {}, dup = false;
      list.forEach(function (s) {
        var c = String(s.code || "").trim();
        if (!c) return;
        if (seen[c]) dup = true;
        seen[c] = 1;
      });
      if (dup) return "同じ担当者コードが複数あります。別の番号にしてください。";
      config.staff = list;
      if (!config.staff.some(function (s) { return s.id === config.activeStaffId; })) {
        config.activeStaffId = config.staff[0].id;
      }
      saveConfig();
      renderStoreConfig();
      applyStoreDefaults(true);
      return "";
    }
    if (wizStep === 3) {
      var p1 = $("setupPass").value;
      var p2 = $("setupPass2").value;
      if (!p1 && !p2) return "";                       // 設定しないで進む
      if (p1.length < 4) return "パスワードは4文字以上にしてください。";
      if (p1 !== p2) return "パスワードが一致しません。";
      var salt = lockSalt();
      var algo = lockAlgo();
      // 保存は非同期。完了してから次の段階へ進める
      return lockHash(p1, salt, algo).then(function (h) {
        config.adminLock = { hash: h, salt: salt, algo: algo };
        saveConfig();
        $("setupPass").value = "";
        $("setupPass2").value = "";
        renderAdminLock();
        masterUnlocked = true;   // 決めた本人なので、このまま操作を続けられるようにする
        return "";
      });
    }
    return "";
  }
  function wizNext() {
    var r = wizCommit();
    if (r && typeof r.then === "function") {
      r.then(function (msg) { wizAdvance(msg); });
      return;
    }
    wizAdvance(r);
  }
  function wizAdvance(msg) {
    if (msg) { wizErr(msg); return; }
    if (wizStep >= WIZ_LAST) { wizFinish(); return; }
    wizStep++;
    wizRender();
  }
  function wizFinish() {
    wizMarkDone();
    wizShow(false);
    if (anyStaffCode()) showStaffGate(true);
    else enterStaff(activeStaff());
  }
  function initWizard() {
    var nx = $("setupNext");
    if (nx) nx.addEventListener("click", wizNext);
    var bk = $("setupBack");
    if (bk) bk.addEventListener("click", function () {
      if (wizStep > 1) { wizStep--; wizRender(); }
    });
    var sk = $("setupSkip");
    if (sk) sk.addEventListener("click", function () {
      if (!window.confirm("初期設定をとばします。\n\nマスタ設定の「店舗設定」からいつでも設定できます。よろしいですか？")) return;
      if (wizStaffUntouched()) config.staff[0].name = "担当1";   // 空にしたぶんを戻す
      wizFinish();
    });
    var add = $("setupStaffAdd");
    if (add) add.addEventListener("click", function () {
      config.staff.push({ id: newStaffId(), name: "", code: "" });
      wizRenderStaff();
    });
    var list = $("setupStaffList");
    if (list) {
      list.addEventListener("input", function (e) {
        var t = e.target;
        var n = t.getAttribute && t.getAttribute("data-wizname");
        var c = t.getAttribute && t.getAttribute("data-wizcode");
        if (n != null) config.staff[+n].name = t.value;
        else if (c != null) config.staff[+c].code = t.value;
      });
      list.addEventListener("click", function (e) {
        var d = e.target.getAttribute && e.target.getAttribute("data-wizdel");
        if (d == null) return;
        config.staff.splice(+d, 1);
        wizRenderStaff();
      });
    }
    // マスタ設定からやり直せるようにする
    var again = $("setupAgainBtn");
    if (again) again.addEventListener("click", function () {
      switchTab("quote");
      wizShow(true);
    });
  }

  /* ---------- バックアップ ----------
   * 店舗のデータ（店舗情報・担当者・料金マスタ・マスタ履歴・保存した見積もり・
   * テンプレート）を1つのファイルにまとめて書き出し、読み込みで戻せるようにする。
   *
   * クラウド同期は「いまの状態を写す」もので、間違えて消した・壊した場合の
   * 備えにはならない。誤操作からの復旧と、店舗が自分のデータを持ち出せることの
   * 両方をこれで担保する。
   *
   * お客様名は既定で含めない。料金設定を残すのが主目的で、
   * 個人情報を持ち出す必要が無いため。必要なときだけチェックで含める。 */
  var BACKUP_KIND = "keitai-quote-backup";
  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function buildBackup(withCust) {
    var saved = {}, tpl = {};
    (config.staff || []).forEach(function (s) {
      var sv = readJson(SAVED_KEY + ":" + s.id);
      if (sv && sv.length) {
        /* 請求内訳の読み取り（curBill）はお客様の請求情報なので、
         * 「お客様名を含める」の指定に関係なく、控えには一切入れない */
        sv.forEach(function (it) {
          ((it.data || {}).patterns || []).forEach(function (pt) { delete pt.curBill; });
          ((it.wonData || {}).patterns || []).forEach(function (pt) { delete pt.curBill; });
        });
        if (!withCust) {
          sv = JSON.parse(JSON.stringify(sv));
          sv.forEach(function (it) {
            it.custName = "";
            if (it.data && it.data.patterns) {
              it.data.patterns.forEach(function (pt) { pt.custName = ""; });
            }
            // 成約時の控え（wonData）にもお客様名が入っている
            if (it.wonData && it.wonData.patterns) {
              it.wonData.patterns.forEach(function (pt) { pt.custName = ""; });
            }
          });
        }
        saved[s.id] = sv;
      }
      var tp = readJson(TPL_KEY + ":" + s.id);
      if (tp && tp.length) tpl[s.id] = tp;
    });
    // 店舗共通テンプレートも控えに入れる（復元時も同じ鍵に戻る）
    var tpStore = readJson(TPL_KEY + ":" + STORE_TPL_ID);
    if (tpStore && tpStore.length) tpl[STORE_TPL_ID] = tpStore;
    return {
      kind: BACKUP_KIND,
      version: 1,
      at: nowStamp(),
      appVersion: APP_VERSION,
      // どの店舗アカウントで作ったか（別の店舗への取り込みを検知するため）
      uid: cloudOn() && CLOUD.user ? CLOUD.user.uid : "",
      storeName: config.storeName || "",
      withCustomerName: !!withCust,
      config: config,
      master: MASTER,
      history: histList,
      saved: saved,
      templates: tpl
    };
  }
  function backupFileName() {
    var d = new Date();
    function z(n) { return ("0" + n).slice(-2); }
    var store = (config.storeName || "店舗").replace(/[\\/:*?"<>|\s]/g, "");
    return "見積もりバックアップ_" + store + "_"
      + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + ".json";
  }
  function doBackup() {
    var withCust = !!($("bkWithCust") && $("bkWithCust").checked);
    var json = JSON.stringify(buildBackup(withCust), null, 2);
    try {
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      backupMsg("バックアップを保存しました（" + backupFileName() + "）。安全な場所に保管してください。");
    } catch (e) {
      backupMsg("保存できませんでした。お使いのブラウザがファイルの保存に対応していない可能性があります。");
    }
  }
  function backupMsg(t, warn) {
    var el = $("backupMsg");
    if (!el) return;
    el.textContent = t || "";
    el.hidden = !t;
    el.className = "hint" + (warn ? " backup-warn" : "");
  }
  /* 読み込んだ内容で置き換える。戻す前の内容はマスタ履歴に残す。 */
  /* ---------- バックアップの中身の検査 ----------
   * ここを通らないファイルは端末にもクラウドにも書かない。
   * 検査が甘いと、壊れたファイルが localStorage と Firestore の両方に書かれて
   * 店舗内の全端末が起動できなくなり、再ログインしても壊れた内容が降ってくるため
   * 実質復旧できなくなる。 */
  function bkIsArr(x) { return Object.prototype.toString.call(x) === "[object Array]"; }
  function bkIsObj(x) { return !!x && typeof x === "object" && !bkIsArr(x); }
  function validateMasterObj(m) {
    if (!bkIsObj(m)) return "料金マスタがありません";
    if (!bkIsArr(m.plans) || !m.plans.length) return "料金プランの形が正しくありません";
    if (m.plans.some(function (p) { return !bkIsObj(p) || !p.id || !bkIsArr(p.tiers) || !p.tiers.length; })) {
      return "料金プランの形が正しくありません";
    }
    if (!bkIsArr(m.options)) return "オプションの形が正しくありません";
    if (!bkIsArr(m.feeItems)) return "商材・初期費用の形が正しくありません";
    if (m.accessories != null && !bkIsArr(m.accessories)) return "アクセサリの形が正しくありません";
    return null;
  }
  function validateBackup(d) {
    var mErr = validateMasterObj(d.master);
    if (mErr) return mErr;
    if (d.config != null) {
      if (!bkIsObj(d.config)) return "店舗設定の形が正しくありません";
      if (!bkIsArr(d.config.staff) || !d.config.staff.length
          || d.config.staff.some(function (s2) { return !bkIsObj(s2) || !s2.id; })) {
        return "担当者の形が正しくありません";
      }
    }
    if (d.history != null && !bkIsArr(d.history)) return "マスタ履歴の形が正しくありません";
    if (d.saved != null) {
      if (!bkIsObj(d.saved)) return "保存した見積もりの形が正しくありません";
      var badS = Object.keys(d.saved).some(function (id) {
        var list = d.saved[id];
        if (!bkIsArr(list)) return true;
        return list.some(function (it) {
          return !bkIsObj(it) || !it.id || !bkIsObj(it.data) || !bkIsArr(it.data.patterns);
        });
      });
      if (badS) return "保存した見積もりの形が正しくありません";
    }
    if (d.templates != null) {
      if (!bkIsObj(d.templates)) return "テンプレートの形が正しくありません";
      if (Object.keys(d.templates).some(function (id) { return !bkIsArr(d.templates[id]); })) {
        return "テンプレートの形が正しくありません";
      }
    }
    return null;
  }

  function restoreBackup(d) {
    if (!d || d.kind !== BACKUP_KIND) {
      backupMsg("このファイルはバックアップではないようです。", true);
      return;
    }
    var verr = validateBackup(d);
    if (verr) {
      backupMsg("このファイルは復元できません（" + verr + "）。壊れているか、対応していない形式です。", true);
      return;
    }
    /* 別の店舗アカウントで作られたバックアップの取り込みは、
     * 店舗内の全端末がその内容に置き換わる事故につながるため、強めに確認する */
    if (cloudOn() && CLOUD.user && d.uid && d.uid !== CLOUD.user.uid) {
      if (!window.confirm("このバックアップは別の店舗アカウントで作られたもののようです。\n"
        + "（バックアップの店舗名: " + (d.storeName || "不明") + "）\n\n"
        + "読み込むと、この店舗の全端末がこの内容に置き換わります。\n本当に続けますか？")) return;
    }
    var msg = "バックアップを読み込みます。\n\n"
      + "作成日時: " + (d.at || "不明") + "\n"
      + "店舗: " + (d.storeName || "（未設定）") + "\n"
      + "お客様名: " + (d.withCustomerName ? "含む" : "含まない") + "\n\n"
      + "いまの内容はすべて置き換わります。よろしいですか？";
    if (!window.confirm(msg)) return;

    histSettle();
    /* 戻す前の内容は、復元後の履歴の先頭に置く。
     * 先に histAdd してしまうと、直後に履歴ごと上書きされて消えてしまう。 */
    var backEntry = {
      id: "h" + Date.now() + Math.random().toString(36).slice(2, 6),
      at: nowStamp(), by: histEditor(),
      label: "バックアップを読み込む前の内容", auto: true,
      data: JSON.stringify(MASTER)
    };
    var cfg2 = null;
    /* 書き込む前の値を控えておき、途中で失敗したら全部元に戻す。
     * 途中まで書けた中途半端な状態を残さないため。 */
    var touched = {};
    function writeLS(key, val) {
      if (!(key in touched)) touched[key] = localStorage.getItem(key);
      localStorage.setItem(key, val);
    }
    try {
      if (d.config) {
        cfg2 = Object.assign({}, d.config);
        /* ロック（店舗ID・パスワード・マスタ設定のパスワード）は
         * この端末・この店舗のものを残す。バックアップ側の値を入れると、
         * 他店のバックアップを読んだときに知らないパスワードでロックされ、
         * データ全消去でしか戻せなくなる。 */
        cfg2.lock = config.lock || cfg2.lock;
        cfg2.adminLock = config.adminLock || cfg2.adminLock;
        writeLS(CFG_KEY, JSON.stringify(cfg2));
      }
      writeLS(MASTER_KEY, JSON.stringify(d.master));
      var hs = (d.history && d.history.length) ? d.history.slice(0, HIST_MAX - 1) : [];
      hs.unshift(backEntry);
      writeLS(HIST_KEY, JSON.stringify(hs));
      Object.keys(d.saved || {}).forEach(function (id) {
        writeLS(SAVED_KEY + ":" + id, JSON.stringify(d.saved[id]));
      });
      Object.keys(d.templates || {}).forEach(function (id) {
        writeLS(TPL_KEY + ":" + id, JSON.stringify(d.templates[id]));
      });
    } catch (e) {
      Object.keys(touched).forEach(function (k) {
        try {
          if (touched[k] == null) localStorage.removeItem(k);
          else localStorage.setItem(k, touched[k]);
        } catch (e2) {}
      });
      backupMsg("読み込みに失敗したため、元の内容に戻しました。端末の空き容量をご確認ください。", true);
      return;
    }
    /* クラウド利用時は、読み込んだ内容をその場でクラウドへ書き戻す。
     * これをしないと、立ち上げ直したときにクラウドの古い内容が
     * 降ってきて、復元した内容が数秒で元に戻ってしまう（復元が効かない）。 */
    if (cloudOn()) {
      var jobs = [];
      var cfgPush = cfg2 || config;
      jobs.push(storeDoc().set(stamp({
        master: localStorage.getItem(MASTER_KEY) || "",
        storeName: cfgPush.storeName || "",
        storeTel: cfgPush.storeTel || "",
        staff: cfgPush.staff || config.staff,
        adminLock: cfgPush.adminLock || { hash: "", salt: "", algo: "" }
      }), { merge: true }));
      Object.keys(d.saved || {}).forEach(function (id) {
        // お客様名・請求内訳（個人情報）はクラウドへ送らない
        var list = JSON.parse(JSON.stringify(d.saved[id]));
        list.forEach(function (it) {
          it.custName = "";
          ((it.data || {}).patterns || []).forEach(function (pt) { pt.custName = ""; delete pt.curBill; });
          ((it.wonData || {}).patterns || []).forEach(function (pt) { pt.custName = ""; delete pt.curBill; });
        });
        jobs.push(savedDoc(id).set(stamp({ list: JSON.stringify(list) })));
      });
      Object.keys(d.templates || {}).forEach(function (id) {
        jobs.push(tplDoc(id).set(stamp({ list: JSON.stringify(d.templates[id]) })));
      });
      Promise.all(jobs).then(function () {
        window.alert("バックアップを読み込み、クラウドへも反映しました。画面を読み込み直します。");
        location.reload();
      }, function () {
        window.alert("端末には読み込みましたが、クラウドへの反映に失敗しました。\n"
          + "通信できる場所で、もう一度バックアップを読み込んでください。\n"
          + "（このまま使うと、クラウドの古い内容に戻ることがあります）");
        location.reload();
      });
      return;
    }
    // 反映漏れが出ないよう、読み直して立ち上げ直す
    window.alert("バックアップを読み込みました。画面を読み込み直します。");
    location.reload();
  }
  function initBackup() {
    var b = $("backupBtn");
    if (b) b.addEventListener("click", doBackup);
    var f = $("restoreFile");
    if (f) f.addEventListener("change", function () {
      var file = this.files && this.files[0];
      this.value = "";
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        var d = null;
        try { d = JSON.parse(String(fr.result)); } catch (e) {}
        restoreBackup(d);
      };
      fr.onerror = function () { backupMsg("ファイルを読めませんでした。", true); };
      fr.readAsText(file);
    });
  }

  /* ---------- 料金表の更新（配信） ----------
   * 料金改定はこちらが data.js を更新して配る。ただし店舗のマスタが優先されるため、
   * そのままでは価格の改定が届かない。版数を比べて「更新があります」と知らせ、
   * 店舗が内容を確かめてから適用する形にしている。
   *
   * 更新するのはドコモの料金だけ。店舗が登録したもの（独自サービス・アクセサリ・
   * 頭金の初期値・並び順・カテゴリ・担当者）はそのまま残す。
   * 適用前の内容は履歴に残るので、あとから戻せる。 */
  /* ---------- 見積書のサービス名をタップして出す小窓 ----------
   * マスタに「説明（desc）」か「公式ページ（url）」があるサービスだけ押せるようにする。
   * ドコモの公式ページは x-frame-options: SAMEORIGIN で外部サイトへの埋め込みを
   * 禁止しているため、小窓の中にサイトを表示することはできない。
   * 小窓には説明を出し、ボタンで別のタブに開く。
   *
   * url は標準マスタから配信する（料金改定で最新に入れ替わる）。
   * desc は店舗が書くものなので、配信では上書きしない。 */
  var DCM_URL = "https://www.docomo.ne.jp/";
  /* マスタに項目が無い、組み込みの割引・サービス。 */
  var SVC_FIXED = {
    "x:minna":    { name: "みんなドコモ割", url: DCM_URL + "charge/minna_docomo/" },
    "x:hikari":   { name: "ドコモ光／home 5G セット割", url: DCM_URL + "charge/hikari_set/" },
    "x:dcardpay": { name: "dカードお支払割", url: DCM_URL + "charge/dcard_oshiharai/" },
    "x:denki":    { name: "ドコモでんき", url: DCM_URL + "denki/" },
    "x:dcard":    { name: "dカード", url: DCM_URL + "service/dcard/" },
    "x:kosodate": { name: "子育てサポート割引", url: DCM_URL + "charge/kosodate_wari/",
      desc: "ひとり親世帯の方向けの割引です。児童扶養手当受給者証などの確認書類が必要で、お子さまが18歳になったあと最初の3月31日まで割引が続きます。" },
    "x:hearty":   { name: "ハーティ割引", url: DCM_URL + "charge/hearty/",
      desc: "障がい者手帳などをお持ちの方向けの割引です。基本使用料と通話オプションが安くなり、各種手数料も無料になります。みんなドコモ割・dカードお支払割とは重ねてご利用いただけません。" }
  };
  var SVC_LISTS = { pl: "plans", vo: "voiceOptions", op: "options",
    fi: "feeItems", ac: "accessories" };
  function svcFind(key) {
    if (!key) return null;
    if (SVC_FIXED[key]) return SVC_FIXED[key];
    var i = key.indexOf(":");
    if (i < 0) return null;
    var arr = MASTER[SVC_LISTS[key.slice(0, i)]] || [];
    var id = key.slice(i + 1);
    for (var k = 0; k < arr.length; k++) if (arr[k].id === id) return arr[k];
    return null;
  }
  /* 商材の写真。説明のサイトが無い独自商材でも、パンフレットの写真などを
   * 見積書の小窓でお見せできるようにする。
   * 料金マスタと一緒に保存・同期するため、そのままでは重すぎる。
   * 長辺900pxまで縮めてJPEGにし、それでも大きいときは段階的に落とす。 */
  var SVC_IMG_MAX_CHARS = 160000;   // 1枚あたりの上限（データURLの長さ・約120KB）
  var MASTER_SOFT_LIMIT = 700000;   // 料金マスタ全体の目安（クラウドの1件上限900KBの手前）
  function shrinkImageFile(file, cb) {
    var fr = new FileReader();
    fr.onerror = function () { cb(null, "写真を読み込めませんでした。"); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null, "写真の形式に対応していません（JPEG・PNGなどをお選びください）。"); };
      img.onload = function () {
        var steps = [[900, 0.72], [760, 0.66], [640, 0.6], [520, 0.55]];
        for (var i = 0; i < steps.length; i++) {
          var max = steps[i][0], q = steps[i][1];
          var sc = Math.min(1, max / Math.max(img.width, img.height));
          var cw = Math.max(1, Math.round(img.width * sc));
          var ch = Math.max(1, Math.round(img.height * sc));
          var cv = document.createElement("canvas");
          cv.width = cw; cv.height = ch;
          try {
            cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
            var out = cv.toDataURL("image/jpeg", q);
          } catch (e) { cb(null, "写真を変換できませんでした。"); return; }
          if (out.length <= SVC_IMG_MAX_CHARS) { cb(out, ""); return; }
        }
        cb(null, "写真が大きすぎます。少し小さい写真をお選びください。");
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  }
  /* リンクとして開いてよいURLか。店舗が自分で入力できるようになったため、
   * javascript: のような危険な指定を弾き、http/https だけを通す。 */
  function svcUrlOk(u) {
    return /^https?:\/\/\S+$/i.test(String(u || "").trim());
  }
  function svcHas(key) {
    var o = svcFind(key);
    return !!(o && (svcUrlOk(o.url) || o.desc || o.img));
  }
  /* 見積書に出す名前。説明かリンクがあるときだけボタンにする（印刷では普通の文字）。 */
  function svcName(name, key) {
    if (!svcHas(key)) return esc(name);
    return '<button type="button" class="svc-link" data-svc="' + esc(key) + '">' + esc(name) + "</button>";
  }
  function openSvcDlg(key) {
    var o = svcFind(key), dlg = $("svcDlg");
    if (!o || !dlg) return;
    $("svcDlgTitle").textContent = o.name || "サービスのご案内";
    var d = $("svcDlgDesc");
    d.textContent = o.desc || "";
    d.hidden = !o.desc;
    /* 写真（店舗が登録したもの）。説明サイトが無い独自商材でも、
     * パンフレットの写真などをそのままお見せできる。 */
    var im = $("svcDlgImg");
    if (im) {
      if (o.img) { im.src = o.img; im.hidden = false; }
      else { im.removeAttribute("src"); im.hidden = true; }
    }
    var btn = $("svcDlgOpen"), note = $("svcDlgUrlNote");
    var urlOk = svcUrlOk(o.url);
    btn.hidden = !urlOk;
    note.hidden = !urlOk;
    /* 店舗独自の商材は、ドコモのページではなくお店が決めたリンク先なので、
     * 「公式」とは書かない（ドコモ公式と誤解されないようにする）。 */
    var own = !!o.own || String(key).indexOf("ac:") === 0;   // アクセサリは全て店舗の商品
    btn.textContent = own ? "ページを開く" : "公式ページを開く";
    note.textContent = own
      ? "詳しい内容は、当店のご案内ページでご確認いただけます。"
      : "詳しい内容は、ドコモの公式ページでご確認いただけます。";
    /* window.open はブラウザやPWAの設定で塞がれることがあるので、
     * ふつうのリンクとして開く（別のタブになる）。 */
    btn.setAttribute("href", urlOk ? o.url : "#");
    if (!o.desc && !urlOk && !o.img) return;
    dlg.hidden = false;
  }

  function masterUpdateAvailable() {
    return num(DEFAULT_DATA.masterVersion) > num(MASTER.masterVersion);
  }
  // 上書きしない項目（店舗が決めるもの）
  var FEE_KEEP = { atamakin_default: true };
  // 標準から引き継ぐ項目（金額と、計算に効く条件だけ。名前・置き場所は店舗のまま）
  var PLAN_TAKE = ["tiers", "discounts", "includes5min", "dcard10",
    "bakuageTier", "poikatsuPt", "maxBonus", "voiceOverrides", "group", "url"];
  var OPT_TAKE = ["price", "priceChoices", "priceLabels", "carrier",
    "bakuage", "bakuage2", "bakuageFixed", "note", "kubunExist", "url"];
  var FEE_ITEM_TAKE = ["price", "pay", "note", "dataMove", "url"];
  var CAMP_TAKE = ["months", "plans", "amountChoices", "note"];

  function takeFields(dst, src, keys) {
    keys.forEach(function (k) {
      if (typeof src[k] === "undefined") return;
      dst[k] = (src[k] && typeof src[k] === "object")
        ? JSON.parse(JSON.stringify(src[k])) : src[k];
    });
  }
  /* 新しい標準を当てたマスタを作って返す（この時点では保存しない）。 */
  function buildUpdatedMaster() {
    var next = JSON.parse(JSON.stringify(MASTER));
    var removed = next.removedIds || [];
    var D = DEFAULT_DATA;

    next.fees = next.fees || {};
    Object.keys(D.fees || {}).forEach(function (k) {
      if (FEE_KEEP[k]) return;             // 店頭頭金の初期値は店舗のもの
      next.fees[k] = D.fees[k];
    });

    (D.plans || []).forEach(function (dp) {
      var cur = next.plans.filter(function (x) { return x.id === dp.id; })[0];
      if (!cur) {
        if (removed.indexOf(dp.id) < 0) next.plans.push(JSON.parse(JSON.stringify(dp)));
        return;
      }
      takeFields(cur, dp, PLAN_TAKE);
    });

    (D.voiceOptions || []).forEach(function (dv) {
      var cur = (next.voiceOptions || []).filter(function (x) { return x.id === dv.id; })[0];
      if (!cur) {
        if (removed.indexOf(dv.id) < 0) next.voiceOptions.push(JSON.parse(JSON.stringify(dv)));
        return;
      }
      cur.price = dv.price;
      if (dv.url) cur.url = dv.url;
    });

    [["options", OPT_TAKE], ["feeItems", FEE_ITEM_TAKE]].forEach(function (pair) {
      var key = pair[0], take = pair[1];
      (D[key] || []).forEach(function (di) {
        var cur = (next[key] || []).filter(function (x) { return x.id === di.id; })[0];
        if (!cur) {
          if (removed.indexOf(di.id) < 0) next[key].push(JSON.parse(JSON.stringify(di)));
          return;
        }
        if (cur.own) return;               // 店舗独自にしているものは触らない
        takeFields(cur, di, take);
      });
    });

    (D.campaigns || []).forEach(function (dc) {
      var cur = (next.campaigns || []).filter(function (x) { return x.id === dc.id; })[0];
      if (!cur) {
        if (removed.indexOf(dc.id) < 0) next.campaigns.push(JSON.parse(JSON.stringify(dc)));
        return;
      }
      takeFields(cur, dc, CAMP_TAKE);
    });

    // でんき・ガスの会社は、増えたものだけ足す。店舗が直した番号は上書きしない
    ["denki", "gas"].forEach(function (k) {
      var src = (D.energyCompanies && D.energyCompanies[k]) || [];
      if (!next.energyCompanies) next.energyCompanies = {};
      if (!next.energyCompanies[k]) next.energyCompanies[k] = [];
      src.forEach(function (c) {
        if (next.energyCompanies[k].some(function (x) { return x.id === c.id; })) return;
        if (removed.indexOf(c.id) >= 0) return;
        next.energyCompanies[k].push(JSON.parse(JSON.stringify(c)));
      });
    });
    next.masterVersion = num(D.masterVersion);
    next.updated = D.updated;
    return next;
  }
  // 更新で何が変わるかの一覧（履歴の差分と同じ仕組みを使う）
  function masterUpdateChanges() {
    return histChanges(JSON.stringify(MASTER), JSON.stringify(buildUpdatedMaster()));
  }
  function applyMasterUpdate() {
    var next = buildUpdatedMaster();
    histSettle();
    var back = histAdd("料金表の更新前", JSON.stringify(MASTER), true);
    lsSet(MASTER_KEY, JSON.stringify(next));
    loadMaster();
    histAttachChanges(back, JSON.stringify(MASTER));
    histMark();
    renderMasterTab();
    renderPlanSelect(); renderVoiceSelect(); renderMailOpt();
    renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
    renderCampaigns(); renderDiscountHint();
    syncFormFromState();
    recalc();
    renderStaffGateNotice();
  }
  function masterUpdateHtml() {
    if (!masterUpdateAvailable()) return "";
    var c = masterUpdateChanges();
    var lines = (c && c.lines) || [];
    var total = lines.length + ((c && c.more) || 0);
    var h = '<div class="master-plan mu-box"><h3>料金表の更新があります</h3>';
    h += '<p class="hint">新しい標準の料金表（' + esc(DEFAULT_DATA.updated || "") + '）が届いています。'
      + '<strong>お店で登録した独自サービス・アクセサリ・店頭頭金・並び順・カテゴリはそのまま残ります。</strong>'
      + '適用する前の内容は履歴に残るので、あとから戻せます。</p>';
    if (total) {
      h += '<details class="hist-diff" open><summary>変わる内容（' + total + '件）</summary><ul>'
        + lines.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("")
        + ((c && c.more) ? '<li class="hist-omit">ほか' + c.more + "件</li>" : "")
        + "</ul></details>";
    } else {
      h += '<p class="hint">金額の変更はありません（版数だけが新しくなります）。</p>';
    }
    h += '<div class="actions"><button class="btn-main" id="muApply" type="button">この内容に更新する</button></div>';
    h += "</div>";
    return h;
  }
  // 担当者コードの画面にも一行出す（マスタ設定は毎日は開かないため）
  function renderStaffGateNotice() {
    var el = $("staffUpdateNote");
    if (!el) return;
    var on = masterUpdateAvailable();
    el.hidden = !on;
    if (on) el.textContent = "料金表の更新が届いています。マスタ設定から適用してください。";
  }

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
    // 爆アゲセレクションの還元率・プラン区分を初期データから補完
    var defBaku = {};
    (DEFAULT_DATA.options || []).forEach(function (o) { defBaku[o.id] = o; });
    MASTER.options.forEach(function (o) {
      var d2 = defBaku[o.id];
      if (!d2) return;
      if (typeof o.bakuage === "undefined" && typeof d2.bakuage === "number") o.bakuage = d2.bakuage;
      if (typeof o.bakuage2 === "undefined" && typeof d2.bakuage2 === "number") o.bakuage2 = d2.bakuage2;
      if (typeof o.bakuageFixed === "undefined" && typeof d2.bakuageFixed === "number") o.bakuageFixed = d2.bakuageFixed;
    });
    var defTier = {};
    (DEFAULT_DATA.plans || []).forEach(function (pl) { defTier[pl.id] = pl.bakuageTier; });
    MASTER.plans.forEach(function (pl) {
      if (typeof pl.bakuageTier === "undefined" && typeof defTier[pl.id] === "string") pl.bakuageTier = defTier[pl.id];
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
    /* 通話オプションの新旧の表示名を短くする（1.128.0）。
     * タイルの中のプルダウンで新旧を選ぶ形にしたため、名前の但し書きは不要になった */
    MASTER.voiceOptions.forEach(function (v) {
      if (v.id === "v5l" && v.name === "5分通話無料オプション（留守電・キャッチホン無料なし）") v.name = "5分通話無料オプション（旧）";
      if (v.id === "kakel" && v.name === "かけ放題オプション（留守電・キャッチホン無料なし）") v.name = "かけ放題オプション（旧）";
    });
    // dヒッツ: 330円コースは扱わないため、保存済みマスタからも選択肢を外す
    MASTER.options.forEach(function (o) {
      if (o.id === "dhits" && o.priceChoices) { delete o.priceChoices; delete o.priceLabels; }
    });
    // smartあんしんパック: 初期値を792円→1,452円へ（一度だけ。以降は店舗が選んだ額を尊重する）
    if (!MASTER.anshinPack1452) {
      MASTER.options.forEach(function (o) {
        if (o.id === "anshin_pack" && num(o.price) === 792) o.price = 1452;
      });
      MASTER.anshinPack1452 = true;
    }
    // 1.5.7 で一時的に作った買い切りオプションを取り下げ、アクセサリへ戻す
    MASTER.options = MASTER.options.filter(function (o) { return o.id !== "op_photocube256"; });
    MASTER.options.forEach(function (o) { delete o.once; });
    // アクセサリも初期データから追記する（置き場所・初期の支払いは未設定のときだけ補う）
    if (!MASTER.accessories) MASTER.accessories = [];
    (DEFAULT_DATA.accessories || []).forEach(function (d) {
      if (MASTER.accessories.some(function (a) { return a.id === d.id; })) return;
      if (MASTER.removedIds && MASTER.removedIds.indexOf(d.id) >= 0) return;
      MASTER.accessories.push(JSON.parse(JSON.stringify(d)));
    });
    var defAcc = {};
    (DEFAULT_DATA.accessories || []).forEach(function (d) { defAcc[d.id] = d; });
    MASTER.accessories.forEach(function (a) {
      var d = defAcc[a.id];
      if (!d) return;
      if (typeof a.category === "undefined" && d.category) a.category = d.category;
      if (typeof a.defaultPay === "undefined" && d.defaultPay) a.defaultPay = d.defaultPay;
    });
    // NETFLIX 旧3項目（広告付ST/ST/PR）→ 料金選択式の1項目「netflix」へ統合
    var nfOldIds = ["op_1784430991714", "op_1784431033021", "op_1784431044456"];
    MASTER.options = MASTER.options.filter(function (o) { return nfOldIds.indexOf(o.id) < 0; });
    /* お客様の見積書にも出る名前なので、社内表記（「（爆アゲ）」など）を外す。
     * 保存済みマスタが昔の名前のままのときだけ直し、
     * 店舗が自分で付け直した名前は変えない。 */
    var NAME_FIXES = {
      bk_disney: ["ディズニープラス（爆アゲ）", "ディズニープラス"],
      bk_lemino: ["Leminoプレミアム（爆アゲ）", "Leminoプレミアム"],
      bk_spotify: ["Spotify Premium（爆アゲ）", "Spotify Premium"],
      bk_youtube: ["YouTube Premium（爆アゲ）", "YouTube Premium"],
      bk_jump: ["週刊少年ジャンプ 定期購読（爆アゲ）", "週刊少年ジャンプ 定期購読"],
      bk_danime: ["dアニメストア（爆アゲ）", "dアニメストア"],
      bk_googleone: ["Google One（爆アゲ）", "Google One"],
      bk_appleone: ["Apple One（爆アゲ）", "Apple One"],
      netflix: ["NETFLIX", "Netflix"],
      op_1785221644318: ["店頭安心サポートミニプラン", "店頭あんしんサポートミニプラン"],
      anshin_pack: ["あんしんパック", "smartあんしんパック"]
    };
    MASTER.options.forEach(function (o) {
      var nf = NAME_FIXES[o.id];
      if (nf && o.name === nf[0]) o.name = nf[1];
    });
    /* プランの性質を初期データから補完する。
     * 初期データに無いプラン（店舗が自分で登録したもの）は、
     * 昔と同じ判定（idに poikatsu を含む／idが max）で埋めておく。 */
    var defPlanDef = {};
    (DEFAULT_DATA.plans || []).forEach(function (p) { defPlanDef[p.id] = p; });
    MASTER.plans.forEach(function (pl) {
      var dp = defPlanDef[pl.id];
      if (typeof pl.poikatsuPt === "undefined") {
        pl.poikatsuPt = (dp && typeof dp.poikatsuPt === "number") ? dp.poikatsuPt
          : (/poikatsu/.test(pl.id) ? (pl.id === "poikatsu_20" ? 2500 : 5000) : 0);
      }
      if (typeof pl.maxBonus === "undefined") {
        pl.maxBonus = (dp && typeof dp.maxBonus === "boolean") ? dp.maxBonus
          : (pl.id === "max" || pl.id === "poikatsu_max");
      }
      if (!pl.tiers || !pl.tiers.length) pl.tiers = [{ label: "", price: 0 }];
      if (!pl.discounts) pl.discounts = {};
      if (pl.group !== "current" && pl.group !== "legacy") pl.group = "current";
    });
    // でんき・ガスの「現在の会社」と連絡先（初期データから補完）
    if (!MASTER.energyCompanies) MASTER.energyCompanies = {};
    ["denki", "gas"].forEach(function (k) {
      if (!MASTER.energyCompanies[k] || !MASTER.energyCompanies[k].length) {
        MASTER.energyCompanies[k] = JSON.parse(JSON.stringify(
          (DEFAULT_DATA.energyCompanies && DEFAULT_DATA.energyCompanies[k]) || []));
      }
    });
    /* 引き継ぎシートの「データ移行」に出す項目の印を初期データから補完する。
     * 初期データに無い項目（店舗が自分で足したもの）は名前から推定しておく。 */
    var defDM = {};
    (DEFAULT_DATA.feeItems || []).forEach(function (f) { defDM[f.id] = !!f.dataMove; });
    MASTER.feeItems.forEach(function (f) {
      if (typeof f.dataMove !== "undefined") return;
      f.dataMove = (f.id in defDM) ? defDM[f.id]
        : /データ移行|店頭サポート/.test(f.name || "");
    });
    /* 料金表の版数。すでに使っている店舗は「いまの内容が最新」として扱い、
     * 次の改定から知らせる。 */
    if (typeof MASTER.masterVersion !== "number") {
      MASTER.masterVersion = num(DEFAULT_DATA.masterVersion);
    }
    // 初期データに後から増えた項目を保存済みマスタへ追記（ユーザーが削除済みのものは復活させない）
    if (!MASTER.removedIds) MASTER.removedIds = [];
    (DEFAULT_DATA.options || []).forEach(function (d) {
      if (MASTER.options.some(function (o) { return o.id === d.id; })) return;
      if (MASTER.removedIds.indexOf(d.id) >= 0) return;
      MASTER.options.push(JSON.parse(JSON.stringify(d)));
    });
    // 初期費用の定番項目も同様に追記
    (DEFAULT_DATA.feeItems || []).forEach(function (d) {
      if (MASTER.feeItems.some(function (f) { return f.id === d.id; })) return;
      if (MASTER.removedIds.indexOf(d.id) >= 0) return;
      MASTER.feeItems.push(JSON.parse(JSON.stringify(d)));
    });
    /* 通話オプションも同様に追記する。
     * これが無いと、すでにお使いの店舗（保存済みマスタがある店舗）には
     * 1.125.0 で足した「旧」の通話オプションが出てこない（2026-08-24 修正）。
     * 並びは初期データと同じ位置に入れて、新→旧の順に見えるようにする。 */
    if (!MASTER.voiceOptions) MASTER.voiceOptions = [];
    (DEFAULT_DATA.voiceOptions || []).forEach(function (d, di) {
      if (MASTER.voiceOptions.some(function (v) { return v.id === d.id; })) return;
      if (MASTER.removedIds.indexOf(d.id) >= 0) return;
      MASTER.voiceOptions.splice(Math.min(di, MASTER.voiceOptions.length), 0, JSON.parse(JSON.stringify(d)));
    });
    /* 「このプランでは選べない」の指定（hideOnPlans）も初期データから補う。
     * 先に別の道筋で追記されていた場合に、指定が抜けたままにならないようにする。 */
    var defVoiceHide = {};
    (DEFAULT_DATA.voiceOptions || []).forEach(function (d) {
      if (d.hideOnPlans) defVoiceHide[d.id] = d.hideOnPlans;
    });
    MASTER.voiceOptions.forEach(function (v) {
      if (!v.hideOnPlans && defVoiceHide[v.id]) v.hideOnPlans = defVoiceHide[v.id].slice();
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
    applyQuoteCardOrder(); // 保存済みの並びを見積もり画面へ反映（同期で届いたときも通る）
  }
  function saveMaster() {
    lsSet(MASTER_KEY, JSON.stringify(MASTER));
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
      minna: "0", dSet: false, dCard: "none", dDenki: false, choki: "none", hearty: false, kosodate: false,
      voice: "none", voiceChange: false, planChange: false, netSvc: {}, netSvcOff: {}, netSvcKubun: {},
      options: {}, optionPrices: {}, feeItems: {},
      optionKubun: {},    // オプションの区分 {id: "new"|"keep"|"off"} ※offは廃止（料金には含めない）
      campaigns: {}, campaignAmounts: {},
      pointPoikatsu: 0, pointDcard: 0,   // ポイント自動充当（実質額案内用・pt/月）
      pointPoikatsuFamily: 0,            // ポイ活ファミリー特典（手動入力・pt/月）
      /* ポイントの扱い。true=月額から充当 / false=もらえるポイントとして案内。
       * 既定は充当しない。進呈されるポイントであって毎月の請求が下がるものではないため、
       * 実質額を多めに見せないようにする。充当してご案内するときは⑧で切り替える。 */
      pointApply: false,
      pointBakuage: 0, pointBakuageAuto: 0,  // 爆アゲセレクションの還元（自動計算・編集可）
      bakuageInclude: true,              // 爆アゲの還元を見積もりに充当するか
      pointDcardAuto: 0,                 // 直近の自動計算値（手入力と区別するための記録）
      /* dカード還元特典を月額から充当するか（GOLD系を選んだとき）。
       * 既定は充当しない。カードの利用状況で変わるうえ、進呈されるポイントであって
       * 毎月の請求が自動で下がるものではないため、実質額を多めに見せないようにする。
       * 充当してご案内するときは、⑧のチェックを入れる。 */
      dcardGoldAuto: false,
      currentInst: 0, currentInstMonths: 0,  // 見直し前から支払い中の分割金（0=ずっと）
      /* 現在のお支払い（請求内訳の読み取り）。{ lines: [{n, a}], total, month }
       * お客様の請求情報なので、お客様名と同じく端末内のみ。
       * クラウド・バックアップ・引き渡しには一切出さない（出口で必ず削除する）。 */
      curBill: null,
      adhocMonthly: [],   // {name, amount, months} amountは±、months 0=ずっと
      accessories: [],    // {name, price, pay: "once"|"b12"|"b24"|"b36"}
      accSel: {},         // マスタ登録アクセサリの選択 {id: pay}
      deviceName: "", devicePrice: 0, couponOff: 0, tebikiOff: 0, directOff: 0,
      payMethod: "none", kaedoki23: 0, kaedokiFee: 0,
      atamakin: 0, jimuFee: 0,
      adhocInitial: [],   // {name, amount} ±
      custName: "", shopName: "", staffName: "", shopTel: "", quoteMemo: "",
      // 手続き内容（引き継ぎシートに記載）
      /* ご来店の目的。①端末購入 以外で来店されて機種変更が入った場合は
       * 「買い増し」として実績に再掲する。①のときは買い増しの有無をチェックで持つ。 */
      visitPurposes: {}, kaimashi: false, u15: false,
      procTodo: {}, todoDcard: false, todoDenki: false, todoGas: false, todoHikari: false,
      todoGasEco: "",     // ガスの区分（std=スタンダード / eco=エコジョーズ）
      todoDenkiNow: "", todoGasNow: "",   // 現在ご契約中の会社（解約のご案内用）
      todoDcardType: "", todoDenkiType: "", todoGasType: "", todoGasDiscount: {},
      todoOther: "",      // 引き継ぎシートの自由記入
      /* MNP（SIMのみ・端末購入なし）のときにご案内した特典。
       * 何をいくらでご案内したかを残すためのもので、月額・初期費用の
       * 計算には入れない（後日のお渡し・進呈になるため）。 */
      mnpBenefitType: "",  // "" | "cash"（キャッシュバック）| "dpoint"（dポイント還元）
      mnpBenefitAmt: 0,
      // 店頭お支払い（頭金・付属品など）の支払方法
      storePay: {}, usePoint: false, usePointAmount: 0,
      // データ移行の項目だけ、支払い先をこの見積もりで変えられる（未指定はマスタの設定）
      feeItemPay: {},
    };
  }
  /* 光・home 5G（イエナカ）は世帯に1本なので、回線ごとのパターンの外に置く。
   * store ごと保存・同期されるため、保存した見積もりやテンプレートにも自然に付いてくる。 */
  function newIenaka() {
    return (typeof KQ_IENAKA !== "undefined" && KQ_IENAKA) ? KQ_IENAKA.defaultState() : {};
  }
  /* gen は「お客様の区切り」の通し番号。入力のクリア・担当入り直しで +1 して同期にも乗せる。
   * 請求内訳の読み取り（curBill）は同期しないため、他端末から届いた内容に
   * この端末の読み取りを付け直すときに、同じお客様のものかをこの番号で見分ける。
   * （番号だけで個人情報は含まない） */
  var store = { active: 0, gen: 0, patterns: [defaultState(), defaultState(), defaultState()], ienaka: newIenaka() };
  var state = store.patterns[0];

  /* 見積もりを読み込んだ時点の「最後に直した時刻」。
   * 画面を開くだけでも自動保存が走って時刻が今に更新されるため、
   * クラウドと比べるときは“開く前の値”を使う。 */
  var quoteAtLoaded = {};
  function loadState() {
    try { quoteAtLoaded[activeStaff().id] = quoteAt(activeStaff().id); } catch (eQ) {}
    try {
      var s = JSON.parse(localStorage.getItem(quoteKey()) || "null");
      if (s && s.patterns && s.patterns.length) {
        store.active = Math.min(Math.max(s.active | 0, 0), 2);
        store.gen = s.gen | 0;
        for (var i = 0; i < 3; i++) {
          store.patterns[i] = Object.assign(defaultState(), s.patterns[i] || {});
        }
      } else {
        // 保存がない担当者に切り替えたときは、前の担当の内容を引き継がない
        store.active = 0;
        store.gen = 0;
        for (var j = 0; j < 3; j++) store.patterns[j] = defaultState();
      }
    } catch (e) {}
    store.patterns.forEach(migratePattern);
    state = store.patterns[store.active];
    var savedIe = null;
    try { savedIe = JSON.parse(localStorage.getItem(quoteKey()) || "null"); } catch (e2) {}
    applyIenaka(savedIe && savedIe.ienaka);
  }
  /* 光の内容を差し替える。無い・壊れている場合は初期値に戻す。
   * イエナカ側は store.ienaka の参照を握っているので、
   * 入れ物は替えずに中身だけ入れ替える。 */
  function applyIenaka(src) {
    var ie = Object.assign(newIenaka(), src || {});
    /* ahamo光のルーターレンタルを1ギガと10ギガで分けた（2026-07-30）。
     * 10ギガは月額550円のため、以前の見積もりを新しい項目へ移す。 */
    if (ie.product === "ahamo10g" && ie.opts && ie.opts.ahamoRouter && !ie.opts.ahamoRouter10g) {
      ie.opts.ahamoRouter10g = true;
      delete ie.opts.ahamoRouter;
    }
    if (!store.ienaka) store.ienaka = {};
    Object.keys(store.ienaka).forEach(function (k) { delete store.ienaka[k]; });
    Object.keys(ie).forEach(function (k) { store.ienaka[k] = ie[k]; });
    if (typeof KQ_IENAKA !== "undefined") { KQ_IENAKA.syncForm(); KQ_IENAKA.render(); }
    var ieb = $("ieBody");
    if (ieb) ieb.hidden = !store.ienaka.enabled;
    var iec = $("ieEnabled");
    if (iec) iec.checked = !!store.ienaka.enabled;
  }
  /* でんき・ガスのチェックの移り変わり
   *   〜2026-07: todoDenki / todoGas（別々）
   *   2026-07  : todoDenkiGas（1つにまとめていた時期）
   *   2026-07-30〜: todoDenki / todoGas（また別々。料金メニューが増えたため）
   * まとめていた時期のデータは、選ばれている料金メニューから振り分ける。
   * どちらのメニューも未選択なら、判断できないので両方を立てる。
   * 起動時のほか、保存した見積もりを開いたときと端末間同期で受け取ったときにも通す。 */
  function migrateEnergyTodo(pt) {
    if (!pt) return;
    if (pt.todoDenkiGas && !pt.todoDenki && !pt.todoGas) {
      if (pt.todoDenkiType || pt.todoGasType) {
        pt.todoDenki = !!pt.todoDenkiType;
        pt.todoGas = !!pt.todoGasType;
      } else {
        pt.todoDenki = true;
        pt.todoGas = true;
      }
    }
    delete pt.todoDenkiGas;
  }
  /* 古い形の見積もりを、いまの形へ引き継ぐ。
   * 起動時・保存済みを開くとき・端末間同期・テンプレ適用の
   * すべての復元経路から呼ぶこと。1か所でも漏れると、
   * 古い見積もりを開いたときだけ値引きなどが消える（実際に起きた）。 */
  function migratePattern(pt) {
    if (!pt) return;
    // カエドキ: 旧「残価」入力から「23回分の総額（頭金込み）」へ移行
    if (!pt.kaedoki23 && pt.zanka) {
      pt.kaedoki23 = Math.max(0, num(pt.devicePrice) - num(pt.zanka));
    }
    delete pt.zanka;
    if (!pt.optionKubun) pt.optionKubun = {};
    /* 重なる組み合わせが両方入っている保存は、含んでいるほう（パック）を残す */
    OPT_EXCLUSIVE.forEach(function (pair) {
      if ((pt.options[pair[0]] || pt.optionKubun[pair[0]])
          && (pt.options[pair[1]] || pt.optionKubun[pair[1]])) {
        optExclusiveOff(pair[0], pt);
      }
    });
    migrateEnergyTodo(pt);
    /* 「キャンペーン値引き」を「手値引き」と「ダイレクト割」に分けた（2026-07-30）。
     * 以前の入力はドコモ側の施策を指していたため、ダイレクト割として引き継ぐ。 */
    if (pt.campaignOff && !pt.directOff && !pt.tebikiOff) pt.directOff = pt.campaignOff;
    delete pt.campaignOff;
    if (!pt.procTodo || !Object.keys(pt.procTodo).length) {
      pt.procTodo = {};
      if (pt.procType) pt.procTodo[pt.procType === "plan_only" ? "plan" : pt.procType] = true;
    }
    // 旧・代理店サービスのチェック状態をオプションへ統合
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
  }
  /* この端末で見積もりを最後に直した時刻。クラウドの内容と比べて、
   * 「クラウドの方が古いのに、この端末の入力を消してしまう」のを防ぐために使う。 */
  function quoteAtKey(sid) { return NS + "-quote-at:" + (sid || activeStaff().id); }
  function quoteAt(sid) {
    try { return num(localStorage.getItem(quoteAtKey(sid))); } catch (e) { return 0; }
  }
  var quoteAtWrote = {};
  function markQuoteAt(sid, t) {
    var now = t || Date.now();
    // 1文字ごとに書かない（1秒に1回で足りる。比べるのは秒単位のため）
    if (quoteAtWrote[sid] && now - quoteAtWrote[sid] < 1000) return;
    quoteAtWrote[sid] = now;
    try { localStorage.setItem(quoteAtKey(sid), String(now)); } catch (e) {}
  }
  function saveState() {
    /* 管理者としてマスタ設定だけを開いているとき（masterOnly）は書かない。
     * この状態は内部的に担当1として動いているため、ここで書くと
     * 担当1の作りかけの見積もりを黙って上書きし、クラウドへも送ってしまう。 */
    if (typeof masterOnly !== "undefined" && masterOnly) return;
    lsSet(quoteKey(), JSON.stringify(store));
    markQuoteAt(activeStaff().id, Date.now());
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
    role: null,         // 上位アカウント（代理店・エリア）の役割。roles/{uid} から読む
    roleFetched: false, // 役割を確かめ終えたか（店舗は該当なしのまま進む）
    suppress: false, cfgTimer: null, quoteTimer: null, masterTimer: null,
    quoteSynced: false, // クラウドの見積もりを一度受け取るまで、この端末からは送らない
    unsubStore: null, unsubQuote: null, watchingStaffId: null,
    savedTimer: null, unsubSaved: null, watchingSavedId: null,
    tplTimer: null, unsubTpl: null, watchingTplId: null,
    tplStoreTimer: null, unsubTplStore: null,
    clientId: Math.random().toString(36).slice(2) + Date.now().toString(36)
  };
  function cloudOn() { return CLOUD.enabled && CLOUD.user && CLOUD.db; }
  function syncStatus(msg, cls) {
    var el = $("syncStatus");
    if (el) { el.textContent = msg || ""; el.className = "sync-status" + (cls ? " " + cls : ""); }
  }
  function cloudOk() { syncStatus("同期✓", "ok"); }
  function cloudNg(err) {
    var denied = /permission|insufficient/i.test(String(err));
    syncStatus(denied ? "同期:権限エラー" : "同期:オフライン", "err");
    /* 権限エラーは通信の一時的な不調と違い、放っておいても直らない。
     * 気づかないまま使い続けると、この端末の内容がほかの端末へ渡らないので、
     * 画面の上に出して知らせる（オフラインは復帰するので出さない）。 */
    if (denied) showCloudDenied();
  }
  function showCloudDenied() {
    var el = $("cloudWarn");
    if (!el || !el.hidden) return;
    el.innerHTML = "⚠ クラウドに保存できませんでした（権限エラー）。"
      + "<b>この端末の内容は残っていますが、ほかの端末には届きません。</b>"
      + "販売元へご連絡ください。";
    el.hidden = false;
  }
  /* 保守用（開発者専用）アカウント。firebase-config.js の KEITAI_DEV_UID と
   * 一致するアカウントでログインしたときだけ、店舗を選んでその店舗として
   * データを確認・修正できる（Firestoreルール側にも同じUIDの例外が必要）。 */
  function devUid() {
    return (typeof KEITAI_DEV_UID === "string" && KEITAI_DEV_UID) ? KEITAI_DEV_UID : "";
  }
  function isDevUser() {
    return !!(CLOUD.user && devUid() && CLOUD.user.uid === devUid());
  }
  /* 上位アカウント（代理店・エリア）。roles/{uid} に販売側がコンソールで
   * { type: "agency"（代理店・全店）|"area"（エリア）, org: "札", area: "札" } を
   * 書いたアカウントは、担当範囲の店舗を選んで、その店舗として表示・編集できる。
   * 店舗のログイン・使い勝手には影響しない（設計は内部資料 LOGIN_HIERARCHY.md）。 */
  function isRoleUser() {
    return !!CLOUD.role;
  }
  function roleDoc() {
    return CLOUD.db.collection("roles").doc(CLOUD.user.uid);
  }
  // 「このUIDは上位アカウントだと確認できた」端末内の控え（通信できない起動時の安全弁）
  var ROLE_HINT_KEY = NS + "-was-role-uid";
  /* 保守モードで店舗を選んで、その店舗のデータを見ている状態か。
   * この状態では、担当者コードとマスタ設定のパスワードの関門を通さない。
   * 開発者は店舗の担当者コードやマスタのパスワードを知らないため、
   * 関門があると中身の確認（サポート・修理）が何もできない。
   * 保守アカウント自体のログインで本人確認は済んでいる。 */
  function devActing() {
    return isDevUser() && !!CLOUD.actAsUid;
  }
  /* 保守（開発者）または上位アカウントで、店舗を選んで見ている状態。
   * どちらも店舗の担当者コード・マスタ設定のパスワードを知らない立場で、
   * 本人確認はそのアカウントのログインで済んでいるため、関門を通さない。 */
  function superActing() {
    return (isDevUser() || isRoleUser()) && !!CLOUD.actAsUid;
  }
  // いま「どの店舗のデータ」を見ているか（保守モード・上位アカウントで店舗を選んだときだけ変わる）
  function effectiveUid() {
    return ((isDevUser() || isRoleUser()) && CLOUD.actAsUid) ? CLOUD.actAsUid : (CLOUD.user && CLOUD.user.uid);
  }
  function storeDoc() {
    // 社内版はログインを使わないため、決め打ちの置き場（従来と同じ）と同期する
    if (INTERNAL) return CLOUD.db.collection("settings").doc("docomoQuoteStore");
    return CLOUD.db.collection("stores").doc(effectiveUid());
  }
  function quoteDoc(staffId) { return storeDoc().collection("quotes").doc(staffId); }
  /* 同じ内容を何度も送らないための控え。送る直前に見比べて、
   * 変わっていなければ通信しない（電池と通信量の節約）。 */
  var CLOUD_SENT = {};
  function cloudSame(key, sig) {
    if (CLOUD_SENT[key] === sig) return true;
    CLOUD_SENT[key] = sig;
    return false;
  }
  function stamp(extra) {
    var o = { clientId: CLOUD.clientId, updatedAtMs: Date.now(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }

  /* ---------- 契約の器（お試し・本契約・停止） ----------
   * 契約状態は contracts/{店舗UID} に販売側が入れる（Firebaseコンソールから。
   * アプリからは読み取りだけで、書き込みはルールで禁止）。
   *   status: "trial"=お試し（trialEndsAt まで）／ "active"=本契約 ／ "suspended"=停止
   * ドキュメントが無い店舗は従来どおり動く（既存店舗を壊さないため）。
   * オフラインでも効くように、最後に読めた内容を端末に控えて起動時はそれを使う。
   * 手順は非公開リポジトリ docomo-quote-internal の OPERATIONS.md「契約の器」を参照。 */
  var CONTRACT_KEY = NS + "-contract-v1";
  var contractInfo = null;   // { uid, status, trialEndsAt(ms), fetchedAt }
  function loadContractCache() {
    try { contractInfo = JSON.parse(localStorage.getItem(CONTRACT_KEY) || "null"); } catch (e) { contractInfo = null; }
  }
  function saveContractCache() {
    try {
      if (contractInfo) localStorage.setItem(CONTRACT_KEY, JSON.stringify(contractInfo));
      else localStorage.removeItem(CONTRACT_KEY);
    } catch (e) {}
  }
  function contractsDoc() { return CLOUD.db.collection("contracts").doc(effectiveUid()); }
  function fetchContract() {
    if (INTERNAL) return Promise.resolve(false);   // 社内版に契約の器は無い
    if (!cloudOn()) return Promise.resolve(false);
    var uid = CLOUD.user.uid;
    return contractsDoc().get().then(function (snap) {
      if (!snap.exists) {
        contractInfo = null;
      } else {
        var d = snap.data() || {};
        var t = d.trialEndsAt, ends = 0;
        if (t && typeof t.toMillis === "function") ends = t.toMillis();
        else if (t) ends = num(t);
        contractInfo = { uid: uid, status: String(d.status || ""), trialEndsAt: ends, fetchedAt: Date.now(),
          /* 店舗ごとの機能スイッチ。販売側がコンソールで features に
           * { typec: false } のように書くと、その店舗だけ機能が消える。 */
          features: (d.features && typeof d.features === "object") ? d.features : null };
      }
      saveContractCache();
      renderContract();
      applyFeaturesUi();
      return true;
    }, function () { renderContract(); return false; });  // 読めないときは手元の控えのまま
  }
  /* 店舗ごとの機能スイッチ。書いていない機能は「あり」。
   * 社内版・器の無い店舗・お試し中も、書かれていない限り全部あり。 */
  function featOn(key) {
    var f = contractInfo && contractInfo.features;
    return !f || f[key] !== false;
  }
  window.KQ_FEAT = featOn;   // 光・5Gタブ（ienaka.js）からも同じ判定を使う
  /* スイッチが切り替わったら、出し分けのある画面を描き直す */
  function applyFeaturesUi() {
    try { if (typeof KQ_IENAKA !== "undefined" && store && store.ienaka) KQ_IENAKA.syncForm(); } catch (e) {}
  }
  /* 使えない状態か。"" = 使える ／ "trialEnded"=お試し終了 ／ "suspended"=停止 */
  function contractBlocked() {
    var c = contractInfo;
    if (!c) return "";
    if (c.status === "suspended") return "suspended";
    if (c.status === "trial" && c.trialEndsAt && Date.now() > c.trialEndsAt) return "trialEnded";
    return "";
  }
  function contractDateStr(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function renderContract() {
    var bar = $("trialBar"), ov = $("contractOverlay");
    if (!bar || !ov) return;
    var blocked = contractBlocked();
    var c = contractInfo;
    var showBar = !!(c && c.status === "trial" && c.trialEndsAt && !blocked);
    bar.hidden = !showBar;
    if (showBar) {
      var left = Math.max(0, Math.ceil((c.trialEndsAt - Date.now()) / 86400000));
      bar.innerHTML = "無料お試し期間中です（<b>" + contractDateStr(c.trialEndsAt) + "まで・残り" + left + "日</b>）。"
        + "続けてお使いいただく場合のお申し込みは " + esc(vendorInfo().contact) + " へ。";
    }
    ov.hidden = !blocked;
    if (!blocked) return;
    var v = vendorInfo();
    $("contractTitle").textContent = blocked === "suspended"
      ? "ご利用が停止されています" : "無料お試し期間が終了しました";
    $("contractMsg").innerHTML =
      (blocked === "suspended"
        ? "ご契約状況をご確認ください。お心当たりがない場合は、お手数ですが下記までご連絡ください。"
        : "お試しをご利用いただきありがとうございました。続けてお使いいただくには、ご利用のお申し込みが必要です。")
      + "<br>入力済みの見積もり・料金マスタは消えていません。お手続きが済むと、そのままの内容でお使いいただけます。";
    $("contractContact").textContent = "お問い合わせ: " + v.name + "　" + v.contact + (v.hours ? "（" + v.hours + "）" : "");
  }
  function initContract() {
    loadContractCache();
    renderContract();
    applyFeaturesUi();
    var btn = $("contractRecheck");
    if (btn) btn.addEventListener("click", function () {
      var msgEl = $("contractRecheckMsg");
      if (msgEl) msgEl.hidden = true;
      btn.disabled = true;
      fetchContract().then(function (ok) {
        btn.disabled = false;
        if (msgEl && (!ok || contractBlocked())) {
          msgEl.textContent = ok
            ? "ご契約状態は変わっていません。お手続き済みの場合は、少し時間をおいてもう一度お試しください。"
            : "確認できませんでした。通信できる場所でもう一度お試しください。";
          msgEl.hidden = false;
        }
      });
    });
    // 開きっぱなしの端末でも、お試し期限が来たら気づけるようにする
    setInterval(renderContract, 60 * 60 * 1000);
  }

  // 店舗設定（店舗名・担当者一覧）の送信
  function pushConfig() {
    if (!cloudOn() || CLOUD.suppress || contractBlocked()) return;
    if (CLOUD.cfgTimer) clearTimeout(CLOUD.cfgTimer);
    syncStatus("同期中…", "");
    CLOUD.cfgTimer = setTimeout(function () {
      CLOUD.cfgTimer = null;
      if (!cloudOn()) return; // 送信待ちの間にログアウトした場合は送らない
      var cfgSig = JSON.stringify([config.storeName || "", config.storeTel || "", config.staff, config.adminLock]);
      if (cloudSame("config", cfgSig)) { cloudOk(); return; }
      storeDoc().set(stamp({
        storeName: config.storeName || "",
        storeTel: config.storeTel || "",
        staff: config.staff,
        adminLock: config.adminLock || { hash: "", salt: "", algo: "" }
      }), { merge: true })
        .then(cloudOk, cloudNg);
    }, 800);
  }
  // 料金マスタ（店舗で共通）の送信
  function markMasterEdit() {
    if (!cloudOn() || CLOUD.suppress || contractBlocked()) return;
    if (CLOUD.masterTimer) clearTimeout(CLOUD.masterTimer);
    syncStatus("同期中…", "");
    CLOUD.masterTimer = setTimeout(function () {
      CLOUD.masterTimer = null;
      if (!cloudOn()) return;
      var mSig = localStorage.getItem(MASTER_KEY) || "";
      if (cloudSame("master", mSig)) { cloudOk(); return; }
      storeDoc().set(stamp({ master: mSig }), { merge: true })
        .then(cloudOk, cloudNg);
    }, 1200);
  }
  // 送信用の見積もりデータ。お客様名・請求内訳（個人情報）はクラウドへ送らない
  function quotePayload() {
    try {
      var s = JSON.parse(JSON.stringify(store));
      (s.patterns || []).forEach(function (pt) { pt.custName = ""; delete pt.curBill; });
      return JSON.stringify(s);
    } catch (e) { return ""; }
  }
  function markLocalEdit() {
    if (!cloudOn() || CLOUD.suppress || contractBlocked()) return;
    /* ログイン・担当切替の直後、クラウドの見積もりを受け取る前は送らない。
     * ここで送ると、この端末に残っていた古い（空の）見積もりが予約され、
     * その予約がある間はクラウドから届く内容も無視されるため、
     * 「iPadで作成→PCで印刷しようとログイン→両方消える」事故になっていた。 */
    if (!CLOUD.quoteSynced) return;
    var sid = activeStaff().id;
    if (CLOUD.quoteTimer) clearTimeout(CLOUD.quoteTimer);
    syncStatus("同期中…", "");
    CLOUD.quoteTimer = setTimeout(function () {
      CLOUD.quoteTimer = null;
      if (!cloudOn()) return;
      var qSig = quotePayload();
      if (cloudSame("quote:" + sid, qSig)) { cloudOk(); return; }
      quoteDoc(sid).set(stamp({ data: qSig })).then(cloudOk, cloudNg);
    }, 800);
  }

  /* 履歴は店舗で共通。件数が少ないので、マスタ設定を開いたときに読む */
  function histCol() { return storeDoc().collection("history"); }
  function histPush(entry, dropped) {
    if (!cloudOn() || CLOUD.suppress) return;
    histCol().doc(entry.id).set(entry).then(cloudOk, cloudNg);
    (dropped || []).forEach(function (d) { histCol().doc(d.id).delete().catch(function () {}); });
  }
  function histDeleteCloud(id) {
    if (!cloudOn()) return;
    histCol().doc(id).delete().catch(function () {});
  }
  function histLoadCloud() {
    if (!cloudOn() || histLoaded) return;
    histLoaded = true;
    histCol().orderBy("at", "desc").limit(HIST_MAX).get().then(function (snap) {
      var seen = {};
      histList.forEach(function (e) { seen[e.id] = true; });
      snap.forEach(function (doc) {
        var d = doc.data();
        if (!d || !d.data || seen[d.id || doc.id]) return;
        histList.push(d);
      });
      histList.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      histList = histList.slice(0, HIST_MAX);
      histSaveLocal();
      renderHistList();
    }, function () { histLoaded = false; });
  }

  function tplDoc(staffId) { return storeDoc().collection("templates").doc(staffId || activeStaff().id); }
  function pushTemplates() {
    if (!cloudOn() || CLOUD.suppress || contractBlocked()) return;
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
        lsSet(tplKey(sid), JSON.stringify(templates));
        renderTplBar();
      } catch (e) {}
    }, function () {});
  }
  // 店舗共通テンプレート（templates/_store）。担当者に関係なく店舗で1つ
  function pushStoreTemplates() {
    if (!cloudOn() || CLOUD.suppress || contractBlocked()) return;
    if (CLOUD.tplStoreTimer) clearTimeout(CLOUD.tplStoreTimer);
    syncStatus("同期中…", "");
    CLOUD.tplStoreTimer = setTimeout(function () {
      CLOUD.tplStoreTimer = null;
      if (!cloudOn()) return;
      tplDoc(STORE_TPL_ID).set(stamp({ list: JSON.stringify(storeTemplates) })).then(cloudOk, cloudNg);
    }, 1000);
  }
  function watchStoreTemplates() {
    if (!cloudOn() || CLOUD.unsubTplStore) return;
    CLOUD.unsubTplStore = tplDoc(STORE_TPL_ID).onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (!d || !d.list) return;
      if (d.clientId === CLOUD.clientId) return;
      if (CLOUD.tplStoreTimer) return; // 送信待ちのローカル変更がある間は上書きしない
      try {
        var a = JSON.parse(d.list);
        if (!a || a.length !== 3) return;
        storeTemplates = a;
        lsSet(tplKey(STORE_TPL_ID), JSON.stringify(storeTemplates));
        renderTplBar();
      } catch (e) {}
    }, function () {});
  }

  function savedDoc(staffId) { return storeDoc().collection("saved").doc(staffId || activeStaff().id); }
  function pushSaved() {
    if (!cloudOn() || CLOUD.suppress || contractBlocked()) return;
    var sid = activeStaff().id;
    if (CLOUD.savedTimer) clearTimeout(CLOUD.savedTimer);
    syncStatus("同期中…", "");
    CLOUD.savedTimer = setTimeout(function () {
      CLOUD.savedTimer = null;
      if (!cloudOn()) return;
      // お客様名・請求内訳（個人情報）はクラウドへ送らない
      var list = JSON.parse(JSON.stringify(savedList));
      list.forEach(function (it) {
        it.custName = "";
        (it.data.patterns || []).forEach(function (pt) { pt.custName = ""; delete pt.curBill; });
        ((it.wonData || {}).patterns || []).forEach(function (pt) { pt.custName = ""; delete pt.curBill; });
      });
      savedDoc(sid).set(stamp({
        list: JSON.stringify(list),
        // 削除の記録も一緒に送る（他の端末で該当の保存を消してもらうため）
        del: JSON.stringify(loadSavedDel(sid))
      })).then(cloudOk, cloudNg);
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
      try {
        var incoming = JSON.parse(d.list) || [];
        // 削除の記録を統合（新しい方を残す）
        var del = loadSavedDel(sid);
        var rdel = {};
        try { rdel = JSON.parse(d.del || "{}") || {}; } catch (e3) {}
        Object.keys(rdel).forEach(function (k) {
          if (!del[k] || rdel[k] > del[k]) del[k] = rdel[k];
        });
        // お客様名・請求内訳は同期しないため、この端末に残っている内容を引き継ぐ
        var mine = {};
        savedList.forEach(function (x) { mine[x.id] = x; });
        incoming.forEach(function (x) {
          var old = mine[x.id];
          if (!old) return;
          if (!x.custName && old.custName) x.custName = old.custName;
          var op = (old.data && old.data.patterns) || [];
          ((x.data && x.data.patterns) || []).forEach(function (pt, i) {
            if (!pt.custName && op[i] && op[i].custName) pt.custName = op[i].custName;
            if (!pt.curBill && op[i] && op[i].curBill) pt.curBill = op[i].curBill;
          });
          var owp = (old.wonData && old.wonData.patterns) || [];
          ((x.wonData && x.wonData.patterns) || []).forEach(function (pt, i) {
            if (!pt.custName && owp[i] && owp[i].custName) pt.custName = owp[i].custName;
            if (!pt.curBill && owp[i] && owp[i].curBill) pt.curBill = owp[i].curBill;
          });
        });
        /* 全文の置き換えではなく統合する。
         * 以前は「あとから送った端末の一覧」で丸ごと置き換えていたため、
         * 2台で別々に保存すると片方の保存が消えることがあった。
         * 同じ保存は更新時刻の新しい方を採用し、削除の記録より新しい
         * 更新が無いものは取り除く。 */
        var byId = {};
        savedList.forEach(function (x) { byId[x.id] = x; });
        incoming.forEach(function (x) {
          var cur = byId[x.id];
          if (!cur || savedItemTs(x) >= savedItemTs(cur)) byId[x.id] = x;
        });
        var merged = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (x) {
          return !(del[x.id] && del[x.id] >= savedItemTs(x));
        });
        merged = trimSavedList(merged);
        // この端末にしか無い保存・削除が混ざっていたら、統合の結果をクラウドへも返す
        var inIds = {};
        incoming.forEach(function (x) { inIds[x.id] = savedItemTs(x); });
        var needPush = merged.some(function (x) { return !inIds[x.id] || inIds[x.id] < savedItemTs(x); })
          || incoming.length !== merged.length
          || Object.keys(del).some(function (k) { return !rdel[k] || rdel[k] < del[k]; });
        savedList = merged;
        saveSavedDel(sid, del);
        lsSet(savedKey(sid), JSON.stringify(savedList));
        renderSaved();
        if (needPush) pushSaved();
      } catch (e) {}
    }, function () {});
  }

  /* その担当の見積もり・保存・テンプレートがこの端末に残っているか。
   * クラウドの担当者一覧に入っていない担当を、黙って切り捨てないための判定。 */
  function staffHasLocalData(sid) {
    if (!sid) return false;
    try {
      if (localStorage.getItem(SAVED_KEY + ":" + sid)) return true;
      if (localStorage.getItem(STATE_KEY + ":" + sid)) return true;
      if (localStorage.getItem(TPL_KEY + ":" + sid)) return true;
    } catch (e) {}
    return false;
  }
  function applyRemoteStore(d) {
    CLOUD.suppress = true;
    var lostStaff = false;
    try {
      if (typeof d.storeName === "string") config.storeName = d.storeName;
      if (typeof d.storeTel === "string") config.storeTel = d.storeTel;
      // マスタ設定のパスワードは店舗共通（解除も伝わるよう、空でも受け取る）
      if (d.adminLock && typeof d.adminLock.hash === "string") config.adminLock = d.adminLock;
      if (d.staff && d.staff.length) {
        /* 担当者一覧は店舗で共通なので、他の端末の変更をそのまま受け取る。
         * ただし「選択中の担当が消えた」と判断するのは、
         * こちらで担当を確定している場合だけにする。
         * 担当を選び直している最中（activeStaffIdが空）に他の端末から
         * 設定が届くと、そのたびに担当者コードの画面へ引き戻されてしまうため。 */
        var prevId = config.activeStaffId;
        var prevStaff = config.staff || [];
        config.staff = d.staff;
        if (prevId && !config.staff.some(function (s) { return s.id === prevId; })) {
          /* 届いた一覧にこの端末の担当がいない場合、その担当の見積もり・保存は
           * この端末に残っているのに開けなくなる（担当ごとに分けて持っているため）。
           * 中身がある担当は消さずに残し、そのまま使い続けられるようにする。
           * 一覧の整理はマスタ設定で店舗が行う。 */
          if (staffHasLocalData(prevId)) {
            var keep = prevStaff.filter(function (s) { return s.id === prevId; })[0];
            if (keep) config.staff = config.staff.concat([keep]);
          } else {
            config.activeStaffId = "";
            lostStaff = true;
          }
        }
      }
      saveConfig();
      if (d.master) {
        try {
          lsSet(MASTER_KEY, d.master);
          loadMaster();
          histMark();
          renderMasterTab();
          renderPlanSelect(); renderVoiceSelect(); renderMailOpt();
          renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
          renderCampaigns(); renderDiscountHint();
        } catch (e) {}
      }
      renderStoreConfig();
      syncFormFromState();
      recalc();
      renderDevBar(); // 店舗名が届いたら、保守・上位アカウントのバーもID表示から店名に描き直す
    } finally { CLOUD.suppress = false; }
    /* 担当が本当に消えたときだけ選び直してもらう。
     * マスタ設定を開いている最中や、ログイン画面を出している最中は割り込まない。 */
    if (lostStaff) {
      if (masterOnly) return;
      var lv = $("loginOverlay");
      if (lv && !lv.hidden) return;
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
      /* お客様名・請求内訳は同期しないため、この端末で入力済みの内容を保持する。
       * 請求内訳は「お客様の区切り（gen）」が同じときだけ付け直す。
       * 他端末で入力をクリアして次のお客様を始めたときに、
       * 前のお客様の請求内訳がこの端末で新しい見積もりに付くのを防ぐ */
      for (var i = 0; i < 3; i++) {
        var mine = (store.patterns[i] || {}).custName;
        var mineBill = (store.patterns[i] || {}).curBill;
        var pt = incoming.patterns[i] || {};
        if (!pt.custName && mine) pt.custName = mine;
        if (!pt.curBill && mineBill && (incoming.gen | 0) === (mineBill.gen | 0)) pt.curBill = mineBill;
        store.patterns[i] = Object.assign(defaultState(), pt);
        migratePattern(store.patterns[i]);
      }
      store.active = Math.min(Math.max(incoming.active | 0, 0), 2);
      store.gen = incoming.gen | 0;
      state = store.patterns[store.active];
      applyIenaka(incoming.ienaka);
      lsSet(quoteKey(), JSON.stringify(store));
      markQuoteAt(activeStaff().id, num(d.updatedAtMs) || Date.now());
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
  /* この端末の見積もりに中身があるか。空のままの端末が
   * 「こちらの方が新しい」と主張して、ほかの端末の内容を消さないようにする。 */
  function localQuoteHasContent() {
    var used = store.patterns.some(function (pt) {
      return pt && (isPatternUsed(pt) || pt.planId || pt.procType || num(pt.devicePrice) > 0);
    });
    return used || !!(store.ienaka && store.ienaka.enabled);
  }
  function watchQuote() {
    if (!cloudOn() || !config.activeStaffId) return;
    var sid = activeStaff().id;
    if (CLOUD.unsubQuote && CLOUD.watchingStaffId === sid) return;
    if (CLOUD.unsubQuote) { CLOUD.unsubQuote(); CLOUD.unsubQuote = null; }
    CLOUD.watchingStaffId = sid;
    CLOUD.quoteSynced = false; // 初回スナップショットを受け取るまで、この端末からの送信を止める
    CLOUD.unsubQuote = quoteDoc(sid).onSnapshot(function (snap) {
      var first = !CLOUD.quoteSynced;
      CLOUD.quoteSynced = true;
      var d = snap.exists ? snap.data() : null;
      if (!d) { markLocalEdit(); return; } // クラウドに見積もりが無ければ、この端末の内容を初期値にする
      if (d.clientId === CLOUD.clientId) { cloudOk(); return; }
      /* 初回はクラウドの内容を取り込む（別の端末で続きを開くための動き）。
       * ただし、この端末の方が新しいときは取り込まない。
       * クラウドが古いまま（送信できていない・久しぶりに同期を始めた等）だと、
       * 開き直すたびにこの端末の入力が古い内容へ戻ってしまうため。 */
      if (first) {
        var rAt = num(d.updatedAtMs);
        var lAt = num(quoteAtLoaded[sid]);   // 開く前の時刻（自動保存で更新される前）
        if (lAt && rAt && lAt > rAt && localQuoteHasContent()) {
          markLocalEdit(); cloudOk(); return;
        }
      }
      if (!first && CLOUD.quoteTimer) return; // 送信待ちのローカル編集がある間は上書きしない（後勝ち）
      applyRemoteQuote(d);
    }, function () { syncStatus("同期:接続エラー", "err"); });
  }

  /* ---------- 画面の出し分け（店舗ログイン → 担当者コード → 本体） ---------- */
  /* 立ち上がりの目隠しを外す。
   * どの画面を出すか決まるまで body.booting のままにしておくことで、
   * ログイン画面が出るより先に見積もり画面が一瞬見えるのを防ぐ。 */
  var bootRevealed = false;
  function bootDone() {
    if (bootRevealed) return;
    bootRevealed = true;
    if (document.body) document.body.className =
      document.body.className.replace(/\bbooting\b/g, "").replace(/\s+/g, " ").trim();
  }
  /* 店舗IDはその端末で最後に使ったものを覚えておき、次から入力済みにする。
   * 秘密の情報ではないので保存してもリスクは増えない。
   * パスワードはアプリに保存しない（ブラウザの保存機能に任せる）。 */
  var LAST_STORE_ID_KEY = NS + "-last-store-id";
  function rememberedStoreId() {
    try { return localStorage.getItem(LAST_STORE_ID_KEY) || ""; } catch (e) { return ""; }
  }
  function rememberStoreId(id) {
    try { localStorage.setItem(LAST_STORE_ID_KEY, String(id || "")); } catch (e) {}
  }
  function fillStoreId() {
    var si = $("loginStoreId");
    if (!si) return;
    si.value = rememberedStoreId();
    // 入力済みのときは、続きのパスワード欄から始められるようにする
    if (si.value) {
      var sp = $("loginPass");
      if (sp) setTimeout(function () { sp.focus(); }, 60);
    }
  }
  function showLogin(show) {
    var el = $("loginOverlay");
    if (el) el.hidden = !show;
    if (show) { fillStoreId(); bootDone(); }
  }
  function showStaffGate(show) {
    var el = $("staffOverlay");
    if (el) el.hidden = !show;
    if (!show) return;
    var f = $("staffCode");
    if (f) { f.value = ""; setTimeout(function () { f.focus(); }, 50); }
    var e2 = $("staffErr"); if (e2) e2.hidden = true;
    renderStaffGateNotice();
    // コードを設定していない担当者は、名前を押して入れるようにする
    // （一部の担当者だけコードを付けた場合に、他の担当者が入れなくなるのを防ぐ）
    // 保守モード・上位アカウントはコードを知らないため、全担当を名前で選べるようにする
    var free = superActing() ? config.staff
      : config.staff.filter(function (s) { return String(s.code || "").trim() === ""; });
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
  /* 見積書に出す店舗名・電話番号・担当者名を、店舗設定とログイン中の担当者から入れる。
   * force のときは上書きする（店舗設定を変えたとき・新しいお客様を始めるとき）。
   * それ以外は空欄のときだけ補う（その見積もりだけ手で変えた内容を消さないため）。 */
  function applyStoreDefaults(force) {
    var st = activeStaff();
    var vals = {
      shopName: config.storeName || "",
      shopTel: config.storeTel || "",
      staffName: (st && st.name) || ""
    };
    var changed = false;
    store.patterns.forEach(function (pt) {
      Object.keys(vals).forEach(function (k) {
        if (!vals[k]) return;                  // 店舗設定が空なら手入力を消さない
        if (!force && pt[k]) return;
        if (pt[k] === vals[k]) return;
        pt[k] = vals[k];
        changed = true;
      });
    });
    if (!changed) return;
    syncFormFromState();
    recalc();
  }
  function resetQuoteForNewCustomer() {
    var src = store.patterns[store.active] || {};
    var st0 = activeStaff();
    var shop = config.storeName || src.shopName || "";
    var staff = (st0 && st0.name) || src.staffName || "";
    var tel = config.storeTel || src.shopTel || "";
    store.active = 0;
    store.gen = (store.gen | 0) + 1;  // お客様の区切り（前のお客様の読み取りを他端末で付け直さない）
    for (var i = 0; i < 3; i++) {
      store.patterns[i] = defaultState();
      store.patterns[i].shopName = shop;
      store.patterns[i].staffName = staff;
      store.patterns[i].shopTel = tel;
    }
    state = store.patterns[0];
    /* 光は世帯で1本のためパターンの外（store.ienaka）にある。
     * ここで消さないと、前のお客様の光の内容が次のお客様に残る。 */
    applyIenaka(null);
    // クラウド利用時はこの内容が送信される。購読を始めた直後に
    // 前の内容で上書きされないよう、watchQuote より先に呼ぶ
    saveState();
  }
  // fresh=true … 担当者コード画面から入ったとき（新しいお客様として始める）
  function enterStaff(s, fresh) {
    masterOnly = false; // 担当者が決まったので通常の画面に戻す
    resetPropTracking(); // 担当が替わったら前の応対と切り離す
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
    else applyStoreDefaults(false); // 空欄なら店舗設定から補う
    syncFormFromState();
    renderStaffBar();
    switchTab("quote"); // マスタ設定から担当者を選んだときも見積もり画面から始める
    recalc();
    watchQuote();
    watchSaved();
    watchTemplates();
    // 初めての端末では、フロントークの使い方案内を出す（画面が落ち着いてから）
    setTimeout(maybeStartTour, 400);
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

  /* 同じ端末で別の店舗にログインしたときの片付け。
   * 見積もり・料金マスタ・担当者・履歴は端末内にも保存しているため、
   * そのままだと前の店舗の内容が見えてしまう（クラウドには残っているので消えない）。
   * この端末で初めてログインする場合だけは、端末内の内容をその店舗の初期値にする。 */
  var STORE_UID_KEY = NS + "-store-uid";
  function wipeStoreLocal() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k === MASTER_KEY || k === CFG_KEY || k === HIST_KEY || k === CONTRACT_KEY
          || k === WIZ_SKIP_KEY                      // 「初期設定は済み」の印（前の店舗のものを持ち込まない）
          || k.indexOf(NS + "-quote-at:") === 0      // 見積もりを最後に直した時刻の控え
          || k.indexOf(STATE_KEY + ":") === 0
          || k.indexOf(SAVED_KEY + ":") === 0
          || k.indexOf(TPL_KEY + ":") === 0) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }
  function switchStoreIfNeeded(uid) {
    var prev = "";
    try { prev = localStorage.getItem(STORE_UID_KEY) || ""; } catch (e) {}
    try { localStorage.setItem(STORE_UID_KEY, uid); } catch (e) {}
    if (!prev || prev === uid) return;
    CLOUD.suppress = true; // 片付けの途中の内容をクラウドへ送らない
    try {
      wipeStoreLocal();
      loadConfig();
      loadMaster();
      histLoadLocal();
      histMark();
      histLoaded = false;
      loadState();
      state = store.patterns[store.active];
      loadSaved();
      loadTemplates();
      loadStoreTemplates();
      loadContractCache();
      renderContract();
      renderStoreConfig();
      renderLockConfig();
      renderAdminLock();
      renderPlanSelect(); renderVoiceSelect(); renderMailOpt();
      renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
      renderCampaigns(); renderDiscountHint();
      renderSaved(); renderTplBar(); renderStaffBar();
      renderMasterTab();
      syncFormFromState();
      recalc();
      renderDevBar(); // 店舗名が届いたら、保守・上位アカウントのバーもID表示から店名に描き直す
    } finally { CLOUD.suppress = false; }
  }

  /* 保守モードの店舗選択。stores の一覧を読み、選んだ店舗として動く。 */
  function showDevPicker() {
    var old = document.getElementById("devPicker");
    if (old) old.remove();
    var ov = document.createElement("div");
    ov.id = "devPicker";
    ov.className = "login-overlay no-print";
    ov.innerHTML = '<div class="login-box"><h2>保守モード：店舗を選択</h2>'
      + '<p class="hint">選んだ店舗のデータを、その店舗として表示・修正します。</p>'
      + '<div id="devPickList"><p class="hint">読み込み中…</p></div>'
      + '<div class="actions"><button class="btn-sub" id="devPickLogout" type="button">ログアウト</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById("devPickLogout").addEventListener("click", function () {
      CLOUD.auth.signOut();
      ov.remove();
    });
    CLOUD.db.collection("stores").get().then(function (qs) {
      var h = "";
      qs.forEach(function (doc) {
        var d = doc.data() || {};
        h += '<button class="btn-sub dev-pick" data-dev-uid="' + esc(doc.id) + '" type="button" style="display:block;width:100%;text-align:left;margin-bottom:6px">'
          + '<b>' + esc(d.storeName || "（店舗名未設定）") + "</b><br>"
          + '<span style="font-size:11px;color:#888">' + esc(doc.id) + "</span></button>";
      });
      var list = document.getElementById("devPickList");
      if (list) list.innerHTML = h || '<p class="hint">店舗がまだありません。</p>';
      Array.prototype.forEach.call(ov.querySelectorAll("[data-dev-uid]"), function (b) {
        b.addEventListener("click", function () {
          detachActingStore(); // 前に見ていた店舗への購読・送信を止めてから切り替える
          CLOUD.actAsUid = b.getAttribute("data-dev-uid");
          ov.remove();
          onSignedIn(CLOUD.user); // 選んだ店舗として通常の流れをやり直す
        });
      });
    }, function (err) {
      var list = document.getElementById("devPickList");
      if (list) list.innerHTML = '<p class="hint">一覧を読めませんでした。firestore.rules に保守用UIDの例外（DEV_UID_HERE の置き換え）が入っているか確認してください。<br>' + esc(String(err)) + "</p>";
    });
  }
  /* 保守・上位アカウントが「見る店舗」を替えるときの片付け。
   * 前の店舗への購読（見積もり・保存・テンプレ・店舗情報）と、送信待ちの
   * タイマーをすべて止める。残したままだと、前の店舗の内容が次の店舗や
   * 上位アカウント自身の領域（stores/{上位UID}）へ書き込まれてしまう。 */
  function detachActingStore() {
    ["unsubStore", "unsubQuote", "unsubSaved", "unsubTpl", "unsubTplStore"].forEach(function (k) {
      if (CLOUD[k]) { try { CLOUD[k](); } catch (eD) {} CLOUD[k] = null; }
    });
    CLOUD.watchingStaffId = null;
    CLOUD.watchingSavedId = null;
    CLOUD.watchingTplId = null;
    ["cfgTimer", "quoteTimer", "masterTimer", "savedTimer", "tplTimer", "tplStoreTimer"].forEach(function (k) {
      if (CLOUD[k]) { clearTimeout(CLOUD[k]); CLOUD[k] = null; }
    });
    CLOUD.quoteSynced = false; // 次の店舗の見積もりを受け取るまで、この端末からは送らない
  }
  /* 上位アカウント（代理店・エリア）の店舗選択。
   * 契約の器（contracts）を所属の札（org・エリアは area も）で絞って一覧にし、
   * 店舗名は stores から1件ずつ補う（ルール上、担当範囲の店舗しか読めない）。 */
  function roleScopeName() {
    var role = CLOUD.role || {};
    return role.type === "agency" ? esc(role.org || "") + "・全店" : "エリア: " + esc(role.area || "");
  }
  function showRolePicker() {
    var old = document.getElementById("devPicker");
    if (old) old.remove();
    var role = CLOUD.role || {};
    var ov = document.createElement("div");
    ov.id = "devPicker";
    ov.className = "login-overlay no-print";
    ov.innerHTML = '<div class="login-box"><h2>店舗を選択（' + roleScopeName() + '）</h2>'
      + '<p class="hint">選んだ店舗の実績・マスタを表示・編集できます。店舗側の操作には影響しません。</p>'
      + '<div id="devPickList"><p class="hint">読み込み中…</p></div>'
      + '<div class="actions"><button class="btn-sub" id="devPickLogout" type="button">ログアウト</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById("devPickLogout").addEventListener("click", function () {
      CLOUD.auth.signOut();
      ov.remove();
    });
    var q = CLOUD.db.collection("contracts").where("org", "==", String(role.org || ""));
    if (role.type !== "agency") q = q.where("area", "==", String(role.area || ""));
    q.get().then(function (qs) {
      var ids = [];
      qs.forEach(function (doc) { ids.push(doc.id); });
      if (!ids.length) {
        var l0 = document.getElementById("devPickList");
        if (l0) l0.innerHTML = '<p class="hint">担当範囲の店舗がまだ登録されていません。販売元へご連絡ください。</p>';
        return;
      }
      // 店舗名を stores から補う（読めなかった店舗はIDのまま出す）
      Promise.all(ids.map(function (id) {
        return CLOUD.db.collection("stores").doc(id).get().then(function (s) {
          var d = s.exists ? (s.data() || {}) : {};
          return { id: id, name: d.storeName || "" };
        }, function () { return { id: id, name: "" }; });
      })).then(function (list) {
        var h = "";
        list.forEach(function (st2) {
          h += '<button class="btn-sub dev-pick" data-dev-uid="' + esc(st2.id) + '" type="button" style="display:block;width:100%;text-align:left;margin-bottom:6px">'
            + "<b>" + esc(st2.name || "（店舗名未設定）") + "</b><br>"
            + '<span style="font-size:11px;color:#888">' + esc(st2.id) + "</span></button>";
        });
        var l1 = document.getElementById("devPickList");
        if (l1) l1.innerHTML = h;
        Array.prototype.forEach.call(ov.querySelectorAll("[data-dev-uid]"), function (b) {
          b.addEventListener("click", function () {
            detachActingStore(); // 前に見ていた店舗への購読・送信を止めてから切り替える
            CLOUD.actAsUid = b.getAttribute("data-dev-uid");
            ov.remove();
            onSignedIn(CLOUD.user); // 選んだ店舗として通常の流れをやり直す
          });
        });
      });
    }, function (err) {
      var l2 = document.getElementById("devPickList");
      if (l2) l2.innerHTML = '<p class="hint">一覧を読めませんでした。新しい firestore.rules（roles・org/area 対応版）が公開されているかご確認ください。<br>' + esc(String(err)) + "</p>";
    });
  }
  /* 上位アカウントの役割（roles）を読めなかったときの案内。
   * 「前回まで上位アカウントだった」ことが分かっているのに店舗として動かすと、
   * 端末の内容を消してしまうため、ここで止めて再試行してもらう。 */
  function showRoleRetry(err) {
    var old = document.getElementById("devPicker");
    if (old) old.remove();
    var ov = document.createElement("div");
    ov.id = "devPicker";
    ov.className = "login-overlay no-print";
    ov.innerHTML = '<div class="login-box"><h2>役割を確認できません</h2>'
      + '<p class="hint">通信の状態を確認して「再試行」を押してください。上位アカウントの登録が外れた場合は、販売元へご連絡ください。<br>'
      + esc(String((err && err.message) || err || "")) + "</p>"
      + '<div class="actions"><button class="btn-sub" id="rolePickLogout" type="button">ログアウト</button>'
      + '<button class="btn-main" id="roleRetryBtn" type="button">再試行</button></div></div>';
    document.body.appendChild(ov);
    document.getElementById("rolePickLogout").addEventListener("click", function () {
      CLOUD.auth.signOut();
      ov.remove();
    });
    document.getElementById("roleRetryBtn").addEventListener("click", function () {
      ov.remove();
      onSignedIn(CLOUD.user);
    });
  }
  /* 保守モード・上位アカウント中の上部バー（どの店舗を見ているか常に分かるように）。
   * 保守（開発者）は赤、上位アカウント（代理店・エリア）は青で区別する。 */
  function renderDevBar() {
    var bar = document.getElementById("devBar");
    if (!superActing()) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "devBar";
      bar.className = "no-print";
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.style.cssText = "position:sticky;top:0;z-index:60;color:#fff;font-size:12px;padding:6px 12px;display:flex;gap:10px;align-items:center;background:"
      + (isDevUser() ? "#B33" : "#1565C0");
    var name = esc((MASTER && MASTER.storeName) || $("storeNameInput") && $("storeNameInput").value || CLOUD.actAsUid);
    bar.innerHTML = (isDevUser()
        ? "<span>保守モード：<b>" + name + "</b> のデータを表示中</span>"
        : "<span><b>" + name + "</b> を表示中（" + roleScopeName() + "）</span>")
      + '<button class="btn-sub" id="devSwitchStore" type="button" style="margin-left:auto">店舗を切り替える</button>';
    document.getElementById("devSwitchStore").addEventListener("click", function () {
      detachActingStore(); // 前の店舗への購読・送信待ちを止める
      CLOUD.actAsUid = null;
      renderDevBar();      // バーを消す（残っているとピッカーの上に被さる）
      if (isDevUser()) showDevPicker(); else showRolePicker();
    });
  }
  function onSignedIn(user) {
    CLOUD.user = user;
    if (isDevUser() && !CLOUD.actAsUid) {
      // 保守モード: まず「どの店舗を見るか」を選んでもらう
      showLogin(false);
      showDevPicker();
      return;
    }
    /* 上位アカウント（代理店・エリア）かどうかを、ログイン後に1回だけ確かめる。
     * 普通の店舗は roles に載っていない（読めない）ので、そのまま店舗として続く。
     * 新しいルールが未公開の環境では読み取りが権限エラーになるが、
     * その場合も店舗として続行するので何も壊れない。 */
    if (!isDevUser() && !CLOUD.roleFetched) {
      showLogin(false);
      syncStatus("確認中…", "");
      roleDoc().get().then(function (snap) {
        CLOUD.roleFetched = true;
        var d = snap.exists ? (snap.data() || null) : null;
        CLOUD.role = (d && d.type && d.org) ? d : null;
        /* 「このUIDは上位アカウント」の控え。通信できない起動時に、上位アカウントを
         * 誤って店舗として動かして端末の内容を消してしまわないための安全弁 */
        try {
          if (CLOUD.role) localStorage.setItem(ROLE_HINT_KEY, user.uid);
          else if (localStorage.getItem(ROLE_HINT_KEY) === user.uid) localStorage.removeItem(ROLE_HINT_KEY);
        } catch (eRH) {}
        onSignedIn(user);
      }, function (err) {
        /* 読めない理由は2通り: 権限（普通の店舗・旧ルール）と通信できない。
         * 前回まで上位アカウントだったと分かっているときは、店舗として続行しない
         * （店舗として動くと switchStoreIfNeeded が端末の内容を消してしまう） */
        var wasRole = false;
        try { wasRole = localStorage.getItem(ROLE_HINT_KEY) === user.uid; } catch (eRH2) {}
        if (wasRole) {
          CLOUD.roleFetched = false; // 再試行でもう一度読み直す
          showRoleRetry(err);
          return;
        }
        CLOUD.roleFetched = true;
        CLOUD.role = null;
        onSignedIn(user);
      });
      return;
    }
    if (isRoleUser() && !CLOUD.actAsUid) {
      // 上位アカウント: 担当範囲の店舗を選んでもらう
      showLogin(false);
      showRolePicker();
      return;
    }
    rememberStoreId(String(user.email || "").replace(/@.*$/, ""));
    switchStoreIfNeeded(effectiveUid()); // 前の店舗の内容を持ち込まない
    showLogin(false);
    syncStatus("同期中…", "");
    var ai = $("accountInfo");
    if (ai) ai.textContent = "ログイン中の店舗: " + String(user.email || "").replace(/@.*$/, "");
    var lo = $("logoutBtn"); if (lo) lo.hidden = false;
    renderDevBar();
    watchStore();
    watchStoreTemplates();
    fetchContract();   // 契約状態（お試し・本契約・停止）を確かめる
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
    CLOUD.actAsUid = null;
    CLOUD.role = null;
    CLOUD.roleFetched = false;
    renderDevBar();
    masterUnlocked = false;
    statsUnlocked = false;
    masterGateFrom = null;
    showMasterGate(false);
    if (CLOUD.unsubStore) { CLOUD.unsubStore(); CLOUD.unsubStore = null; }
    if (CLOUD.unsubQuote) { CLOUD.unsubQuote(); CLOUD.unsubQuote = null; }
    if (CLOUD.unsubSaved) { CLOUD.unsubSaved(); CLOUD.unsubSaved = null; }
    if (CLOUD.unsubTpl) { CLOUD.unsubTpl(); CLOUD.unsubTpl = null; }
    if (CLOUD.unsubTplStore) { CLOUD.unsubTplStore(); CLOUD.unsubTplStore = null; }
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
    var sp1 = $("loginPass"); if (sp1) sp1.value = "";
    showLogin(true); // 店舗IDはここで入力済みに戻る
  }

  /* ---------- 自動ログアウト ----------
   * 店頭の共有端末を開いたまま離席したときのために、
   * 操作が長く途切れたらログイン画面へ戻す。 */
  /* 日中の接客中には落ちず、閉店から翌朝までの間隔では確実に落ちる長さにしている。
   * 短くすると店頭で店舗パスワードを打ち直す手間が増える。 */
  var IDLE_MS = 12 * 60 * 60 * 1000;
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
  /* ---------- 画面を見ていない間は休む（電池の持ちのため） ----------
   * ほかのアプリに切り替えている間・画面を消している間は、
   * クラウドの受信（つなぎっぱなしの通信）と30秒ごとの見張りを止める。
   * 戻ってきたら、その場でつなぎ直して最新を受け取る。
   * 送りかけの内容は、止める前に必ず送り切る。 */
  var CLOUD_PAUSED = false;
  function cloudFlushNow() {
    // 待ち時間の途中でも、いま送る
    [["cfgTimer", pushConfig], ["masterTimer", markMasterEdit], ["quoteTimer", markLocalEdit],
     ["savedTimer", pushSaved], ["tplTimer", pushTemplates], ["tplStoreTimer", pushStoreTemplates]]
      .forEach(function (pair) {
        if (!CLOUD[pair[0]]) return;
        clearTimeout(CLOUD[pair[0]]);
        CLOUD[pair[0]] = null;
        try { pair[1](); } catch (e) {}
      });
  }
  function cloudDetach() {
    ["unsubStore", "unsubQuote", "unsubSaved", "unsubTpl", "unsubTplStore"].forEach(function (k) {
      if (CLOUD[k]) { try { CLOUD[k](); } catch (e) {} CLOUD[k] = null; }
    });
    CLOUD.watchingStaffId = null;
    CLOUD.watchingSavedId = null;
    CLOUD.watchingTplId = null;
  }
  function cloudReattach() {
    if (!cloudOn()) return;
    watchStore();
    watchStoreTemplates();
    if (config.activeStaffId) { watchQuote(); watchSaved(); watchTemplates(); }
  }
  function initPowerSave() {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (cloudOn()) { cloudFlushNow(); cloudDetach(); CLOUD_PAUSED = true; }
        if (IDLE.timer) { clearInterval(IDLE.timer); IDLE.timer = null; }   // 見張りは止める（戻ったときに見る）
      } else {
        if (CLOUD_PAUSED) { CLOUD_PAUSED = false; cloudReattach(); }
        if (IDLE.armed && !IDLE.timer) IDLE.timer = setInterval(idleCheck, 30000);
      }
    });
    // 閉じる・別ページへ移るときも、送りかけを送り切る
    window.addEventListener("pagehide", function () { if (cloudOn()) cloudFlushNow(); });
  }
  // ログアウト（自動・手動の共通処理）
  function doLogout(auto) {
    histSettle();
    masterOnly = false;
    clearActiveStaff();
    masterUnlocked = false;
    statsUnlocked = false;
    masterGateFrom = null;
    showMasterGate(false);
    switchTab("quote");
    armIdle(false);
    // ロック画面のまま印刷されてもお客様情報が出ないよう、画面の内容を消す
    var sb1 = $("sheetBody"); if (sb1) sb1.innerHTML = "";
    var sb2 = $("staffSheetBody"); if (sb2) sb2.innerHTML = "";
    showStaffGate(false);
    var sb = $("staffBar"); if (sb) sb.hidden = true;
    var sp0 = $("loginPass"); if (sp0) sp0.value = "";
    fillStoreId();
    var le = $("loginErr");
    if (le) {
      if (auto) { le.textContent = "しばらく操作がなかったため、自動でログアウトしました。"; le.hidden = false; }
      else le.hidden = true;
    }
    if (CLOUD.enabled && CLOUD.auth) { CLOUD.auth.signOut(); return; }
    showLogin(true);
  }

  // 店舗ログインを通過したあとの共通処理（担当者コードへ進む）
  function afterStoreLogin() {
    showLogin(false);
    var lo = $("logoutBtn");
    if (lo) lo.hidden = INTERNAL || !(lockEnabled() || cloudOn());
    // 社内版にはログインが無いので、自動ログアウトも掛けない
    armIdle(!INTERNAL && (lockEnabled() || cloudOn()));
    if (takeHandoffFromIenaka()) { bootDone(); return; }
    /* 保守モード・上位アカウント: 担当者コードは聞かずにそのまま中へ入る
     * （店舗のコードを知らない立場。どの店舗を見ているかは上部バーで分かる） */
    if (superActing()) { enterStaff(activeStaff()); bootDone(); return; }
    // まだ一度も設定していない店舗は、先に初期設定を出す
    if (wizNeeded()) { wizShow(true); bootDone(); return; }
    if (anyStaffCode()) showStaffGate(true);
    else enterStaff(activeStaff());
    bootDone();
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
    statsUnlocked = false;
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
      masterOnly = false;
      switchTab("quote");
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
    var mb = $("masterBackBtn");
    if (mb) mb.addEventListener("click", function () {
      histSettle(); // 設定を離れるので、ここでひと区切り
      masterOnly = false;
      switchTab("quote"); // 設定の内容をコード入力画面の裏に残さない
      if (anyStaffCode()) { clearActiveStaff(); showStaffGate(true); }
    });
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
      enterMasterOnly();
    });
  }

  function initCloud() {
    /* 社内版: 店舗ログインは使わない。Firebaseが読み込めていれば
     * 従来どおり settings/docomoQuoteStore とそのまま同期する。 */
    if (INTERNAL) {
      var lbI = $("lockBox"); if (lbI) lbI.hidden = true;
      var abI = $("adminLockBox"); if (abI) abI.hidden = true;
      showLogin(false);
      if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) {
        try {
          CLOUD.db = firebase.firestore();
          CLOUD.user = { uid: "internal", email: "" };
          CLOUD.enabled = true;
        } catch (eIc) {}
      }
      if (cloudOn()) {
        syncStatus("同期中…", "");
        watchStore();
        watchStoreTemplates();
        storeDoc().get().then(function (snap) {
          var dIc = snap.exists ? snap.data() : null;
          if (dIc) applyRemoteStore(dIc);
          afterStoreLogin();
        }, function () {
          afterStoreLogin(); // 取得できなくても端末内の内容で続行する
        });
      } else {
        syncStatus("", "");
        afterStoreLogin();
      }
      return;
    }
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
  /* 爆アゲ セレクションの還元は税抜価格が基準。
   * マスタには税込で登録するため、消費税分を割り戻して使う。 */
  var TAX_RATE = 0.1;
  function bakuageExTax(taxIncluded) {
    return Math.round(num(taxIncluded) / (1 + TAX_RATE));
  }
  // ドコモ MAX／ドコモ ポイ活 MAX の「選べる特典」
  // 対象4サービスから毎月2つまで追加料金なし。3つ目以降は通常料金
  var MAX_BONUS_IDS = ["bk_lemino", "bk_danime", "dazn", "nba"];
  var MAX_BONUS_LIMIT = 2;
  var MAX_BONUS_NOTE = "選べる特典";
  function planById(id) {
    return MASTER.plans.filter(function (p) { return p.id === id; })[0] || null;
  }
  // 対象かどうかはマスタ設定の「選べる特典の対象」で決まる
  function maxBonusPlan(planId) { var p = planById(planId); return !!(p && p.maxBonus); }
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
    { id: "melody", name: "メロディコール", price: 110 }
  ];
  // オプションパック（上の3つ＋転送でんわ をまとめると割引。転送でんわは単品でも無料）
  var NET_PACK_PRICE = 440;
  var NET_PACK_NAME = "オプションパック（留守番電話・キャッチホン・メロディコール・転送でんわ）";
  // 新カケホーダイ系の通話オプション。付けると留守番電話・キャッチホンは無料になる
  function kakeVoice(v) { return v === "v5" || v === "kake"; }
  /* ネットワークサービスの区分（新規／継続／廃止）。
   * オプション欄の区分と同じ考え方: 新規・継続は月額に入れ、廃止は入れない。
   * 1.113.0 以前の「廃止」チェック（netSvcOff）は区分の廃止として読む。 */
  function netKubun(st, id) {
    var k = (st.netSvcKubun || {})[id];
    if (k) return k;
    if ((st.netSvcOff || {})[id]) return "off";
    return "new";
  }
  function netSvcOn(st, id) {
    return !!(st.netSvc || {})[id] || !!(st.netSvcOff || {})[id];
  }
  // 選択中のネットワークサービスを、料金を確定させた行にして返す
  function netSvcCalc(st) {
    var free = kakeVoice(st.voice);
    var on = NET_SVC.filter(function (n) { return netSvcOn(st, n.id); });
    var offRows = on.filter(function (n) { return netKubun(st, n.id) === "off"; });
    var picked = on.filter(function (n) { return netKubun(st, n.id) !== "off"; });
    var rows = [], total = 0;
    if (!free && picked.length === NET_SVC.length) {
      // 3つとも継続ならパックも継続。1つでも新規があれば新規として扱う
      var allKeep = picked.every(function (n) { return netKubun(st, n.id) === "keep"; });
      rows.push({ name: NET_PACK_NAME, price: NET_PACK_PRICE, kubun: allKeep ? "keep" : "new" });
      total = NET_PACK_PRICE;
    } else {
      picked.forEach(function (n) {
        var f = free && n.freeWithKake;
        rows.push({ name: n.name + (f ? "（通話オプションに込み）" : ""), base: n.short || n.name,
          incl: !!f, price: f ? 0 : n.price, kubun: netKubun(st, n.id) });
        total += f ? 0 : n.price;
      });
    }
    return { rows: rows, total: total, off: offRows,
      pack: rows.length === 1 && rows[0].name === NET_PACK_NAME };
  }
  // 頭金・事務手数料を自動で入れるのは新規契約・機種変更のときだけ（未選択は0円）
  // MNPも新規契約なので、事務手数料（jimu_mnp）は自動判定の対象
  function autoFeeProc(proc) { return proc === "shinki" || proc === "kishu" || proc === "mnp"; }
  /* 頭金の自動判定はMNPを含めない。MNPはSIMのみや頭金なし機種の
   * ご案内が多いため、基本なし（2026-07-30 安藤さん）。必要なときは手入力。 */
  function autoAtamaProc(proc) { return proc === "shinki" || proc === "kishu"; }
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
  /* スタンダードプラン／エコジョーズプランに分かれる料金メニュー。
   * 高効率給湯器「エコジョーズ」をお使いのお客さまはエコジョーズプラン、
   * それ以外はスタンダードプランが適用される（単位料金が違う）。
   * 出典: 大阪ガス GAS得プラン 各メニューのページ（2026-07-30 確認）
   *   床暖料金       https://home.osakagas.co.jp/energy/gas/price/p_03.html
   *   あっためトク料金 https://home.osakagas.co.jp/energy/gas/price/p_08/
   *   ハウス空調料金  https://home.osakagas.co.jp/energy/gas/price/p_02/
   * 他のメニュー（一般料金・一般料金S・まとめトク・スマート発電・家事トク・
   * もっと割・マイホーム発電）にはこの区分が無いことも同ページで確認済み。 */
  var GAS_ECO_TYPES = { attame: true, house: true, yukadan: true };
  var GAS_ECO_LABEL = { std: "スタンダードプラン", eco: "エコジョーズプラン" };
  function gasEcoNeeded() { return !!GAS_ECO_TYPES[state.todoGasType]; }
  /* でんき・ガスの「現在ご契約中の会社」。
   * ご連絡先をその場で出せるようにするためのもの。
   * 会社と電話番号はマスタ設定で編集できる（番号は変わるため）。 */
  function energyList(kind) {
    return (MASTER.energyCompanies && MASTER.energyCompanies[kind]) || [];
  }
  function energyTypePicked(kind) {
    return kind === "gas" ? state.todoGasType : state.todoDenkiType;
  }
  function energyPicked(kind) {
    // プランを選んでいないときは、現在の会社も無いものとして扱う
    if (!energyTypePicked(kind)) return null;
    var id = kind === "gas" ? state.todoGasNow : state.todoDenkiNow;
    if (!id) return null;
    return energyList(kind).filter(function (c) { return c.id === id; })[0] || null;
  }
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
  /* 手続き種別を切り替え、頭金・事務手数料の自動判定もあわせて行う。
   * 手で直した金額は消さない。前の種別の自動値のままのときだけ、
   * 新しい自動値へ入れ替える（手続き内容のチェックを変えるたびに
   * 呼ばれるので、無条件に上書きすると手入力が黙って消える）。 */
  function applyProcType(v) {
    var prev = state.procType;
    var prevJimu = autoFeeProc(prev) ? jimuFeeFor(prev) : 0;
    var prevAtama = autoAtamaProc(prev) ? MASTER.fees.atamakin_default : 0;
    state.procType = v;
    if (num(state.jimuFee) === num(prevJimu)) {
      state.jimuFee = autoFeeProc(v) ? jimuFeeFor(v) : 0;
    }
    if (num(state.atamakin) === num(prevAtama)) {
      state.atamakin = autoAtamaProc(v) ? MASTER.fees.atamakin_default : 0;
    }
    /* カエドキの「23回分の総額」も手続きで変わることがある（端末マスタに
     * MNP用・新規用が入っているとき）。前の手続きの金額のままなら入れ替える。
     * 手で書き換えた金額は、そのまま残す。 */
    var dev = devByName(state.deviceName);
    if (dev) {
      var prevK23 = devKaedoki23(dev, prev);
      var nextK23 = devKaedoki23(dev, v);
      if (nextK23 !== null && prevK23 !== null && num(state.kaedoki23) === num(prevK23)) {
        state.kaedoki23 = nextK23;
        var k23el = $("kaedoki23");
        if (k23el) k23el.value = state.kaedoki23 || "";
      }
    }
    $("procType").value = v;
    $("jimuFee").value = state.jimuFee;
    $("atamakin").value = state.atamakin;
  }
  // GOLD系カード（お支払割はGOLD区分・還元特典の自動計算対象）
  function isGoldCard(c) { return c === "goldu" || c === "gold" || c === "platinum"; }
  // 券種チェック（R・G・U・P）。並びは画面の順のまま返る
  function dcardKindBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll('#dCardSub [data-dcard]'));
  }
  var lastDcardKind = "";  // 割引を入→切→入としたときに券種を覚えておく
  // 還元特典の自動計算: 対象額 税込1,100円ごとのpt（GOLD U 5%／GOLD 10%／PLATINUM 20%）
  function dcardRatePt(c) { return c === "platinum" ? 200 : c === "gold" ? 100 : c === "goldu" ? 50 : 0; }
  function optPrice(o, st) {
    if (o.priceChoices && st.optionPrices[o.id] != null
        && o.priceChoices.indexOf(st.optionPrices[o.id]) >= 0) return st.optionPrices[o.id];
    return o.price;
  }
  /* 通話オプションがそのプランで選べないとき（hideOnPlans）は、
   * 同じ内容の標準版（留守電・キャッチホン無料つき）へ読み替える。
   * 保存済みの見積もりでプランだけ mini に変えた場合の取りこぼし防止。 */
  var VOICE_FALLBACK = { v5l: "v5", kakel: "kake" };
  /* ②の通話オプションはタイルで選ぶ。中身が同じで新旧2種類あるものは
   * 1つのタイルにまとめ、タイルの中のプルダウンで新旧を選ぶ。
   *   新 … 留守番電話・キャッチホンが無料で付く（2025年〜の料金）
   *   旧 … 留守番電話・キャッチホンは別料金（それ以前からのご契約） */
  var VOICE_GROUP = { v5: "v5", v5l: "v5", kake: "kake", kakel: "kake" };
  var VOICE_GROUP_NAME = { v5: "5分通話無料オプション", kake: "かけ放題オプション" };
  var VOICE_ERA = { v5: "新", v5l: "旧", kake: "新", kakel: "旧" };
  /* 画面に出す並びで、タイルごとに中身（新旧）をまとめて返す。
   * このプランで選べないもの（hideOnPlans）は外す。 */
  function voiceTiles(plan) {
    var tiles = [], byKey = {};
    MASTER.voiceOptions.forEach(function (v) {
      if (voiceHiddenOn(plan, v)) return;
      var key = VOICE_GROUP[v.id] || v.id;
      if (!byKey[key]) {
        byKey[key] = { key: key, name: VOICE_GROUP_NAME[key] || v.name, items: [] };
        tiles.push(byKey[key]);
      }
      byKey[key].items.push(v);
    });
    return tiles;
  }
  function voiceTileKey(id) { return VOICE_GROUP[id] || id; }
  function voiceHiddenOn(plan, vo) {
    return !!(vo && vo.hideOnPlans && vo.hideOnPlans.indexOf(plan.id) >= 0);
  }
  function effectiveVoice(plan, id) {
    var vo = MASTER.voiceOptions.filter(function (v) { return v.id === id; })[0]
             || MASTER.voiceOptions[0];
    if (voiceHiddenOn(plan, vo)) {
      var fb = MASTER.voiceOptions.filter(function (v) { return v.id === VOICE_FALLBACK[vo.id]; })[0];
      if (fb) return fb;
    }
    return vo;
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
    /* ハーティ割引は「みんなドコモ割」「dカードお支払割」と重ねられない
     * （docomo.ne.jp/charge/hearty/about.html に明記）。
     * 選ばれていたら、その2つは当たらないものとして計算する。 */
    var dHearty = st.hearty ? (d.hearty || 0) : 0;
    /* 子育てサポート割引（ひとり親世帯）。ハーティ割引とは同時に適用できないため、
     * 両方付いた保存（この決まりを入れる前のもの）が来たときはハーティだけを引く。 */
    var dKosodate = (st.kosodate && !dHearty) ? (d.kosodate || 0) : 0;
    /* みんなドコモ割は、ハーティとも子育てサポートとも重ねられない。
     * 選んでいても計算には入れない（チェックは外さず、注意書きで知らせる）。 */
    var dMinna = (dHearty || dKosodate) ? 0
               : st.minna === "2" ? (d.minna2 || 0)
               : st.minna === "3" ? (d.minna3 || 0) : 0;
    var dSet = st.dSet ? (d.set || 0) : 0;
    var dCard = dHearty ? 0
              : st.dCard === "normal" ? (d.dcard || 0)
              : isGoldCard(st.dCard) ? (d.dcardGold || 0) : 0;
    var dDenki = st.dDenki ? (d.denki || 0) : 0;
    var dChoki = st.choki === "y10" ? (d.choki10 || 0)
               : st.choki === "y20" ? (d.choki20 || 0) : 0;
    var planMonthly = Math.max(0, tier.price - dMinna - dSet - dCard - dDenki - dChoki - dHearty - dKosodate);

    // 通話オプション（プランで選べないものは標準版へ読み替え）
    var vo = effectiveVoice(plan, st.voice);
    var voicePrice = voicePriceFor(plan, vo);
    /* ハーティ割引は通話オプションも 880円 引く（5分は無料、かけ放題は1,100円）。
     * 「はじめてスマホプラン」は通話オプションの割引対象外。 */
    var dHeartyVoice = 0;
    if (dHearty && plan.id !== "hajimete" && (vo.id === "v5" || vo.id === "kake")) {
      dHeartyVoice = Math.min(HEARTY_VOICE_OFF, voicePrice);
      voicePrice -= dHeartyVoice;
    }
    // 子育てサポート割引も通話オプションを880円引く（ハーティと同じ形。引き切ったら0円まで）
    var dKosodateVoice = 0;
    if (dKosodate && (vo.id === "v5" || vo.id === "kake")) {
      dKosodateVoice = Math.min(KOSODATE_VOICE_OFF, voicePrice);
      voicePrice -= dKosodateVoice;
    }
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
      optRows.push({ id: o.id, name: o.name + (lb ? "（" + lb + "）" : ""), price: pr });
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
    /* 端末代金総額（頭金を含む）から値引きを引く。
     * クーポン値引きと店舗独自キャンペーンは、店頭でのお支払いが軽くなるよう
     * 「頭金 → 分割する分 → 残価」の順に引く。
     * ダイレクト割は頭金からは引かず、分割する分（あふれたら残価）から引く。 */
    /* 「端末購入なし」のときは、機種名・端末代金・頭金・値引きが入力に残っていても
     * 端末のお支払いは一切計上しない（端末代金総額を0として扱うと、頭金・値引きも
     * 0にそろう）。機種を選んだあとに「端末購入なし」へ戻したとき、店頭頭金だけが
     * 初期費用に残ってしまうのを防ぐ。
     * 2026-08-26 からは「購入なし」へ切り替えた時点で入力そのものも消す（⑤の
     * change 処理）。ここの0扱いは、消す前に保存された見積もり・履歴・テンプレを
     * 読み込んだときのための保険として残す（残っていれば payWarn で知らせる）。 */
    var deviceList = st.payMethod === "none" ? 0 : num(st.devicePrice);
    var devOffCoupon = Math.min(Math.max(0, num(st.couponOff)), deviceList);
    var devOffTebiki = Math.min(Math.max(0, num(st.tebikiOff)), Math.max(0, deviceList - devOffCoupon));
    var devOffDirect = Math.min(Math.max(0, num(st.directOff)),
      Math.max(0, deviceList - devOffCoupon - devOffTebiki));
    var devOffTotal = devOffCoupon + devOffTebiki + devOffDirect;
    var atamaInput = Math.max(0, Math.min(num(st.atamakin), deviceList));
    // ①頭金から引く（クーポン・店舗独自キャンペーンだけ）
    var offAtama = devOffCoupon + devOffTebiki;
    var deviceAtama = Math.max(0, atamaInput - offAtama);
    /* 分割する分へ回す値引き。
     * 頭金で引ききれなかった分と、ダイレクト割（はじめから頭金には当てない）。 */
    var off = Math.max(0, offAtama - atamaInput) + devOffDirect;
    var deviceTotal = Math.max(0, deviceList - devOffTotal);
    device.list = deviceList;
    device.offCoupon = devOffCoupon;
    device.offTebiki = devOffTebiki;
    device.offDirect = devOffDirect;
    device.offTotal = devOffTotal;
    device.atamaList = atamaInput;
    device.atama = deviceAtama;
    device.atamaOff = atamaInput - deviceAtama;
    /* 分割・残価から引ききれなかった値引き。ダイレクト割は頭金に当てないため、
     * 頭金が大きいと引き先が無くなることがある。0より大きいときは
     * 「値引き後の端末代金」と実際のお支払い合計が食い違うので、警告を出す。 */
    device.offLeft = 0;

    /* dポイント利用（1pt = 1円）。
     * 値引きと同じく、店頭でのお支払いが軽くなるよう
     * 「頭金 → 分割する分 → 残価」の順に充当する。
     * 一括払いは頭金の区別が無いため、店頭でお支払いいただく総額から充当する。 */
    var ptUse = st.usePoint ? Math.max(0, num(st.usePointAmount)) : 0;
    var ptLeft = ptUse;
    device.pointUse = ptUse;
    device.atamaBeforePoint = deviceAtama;
    device.atamaPoint = 0;
    device.pointIkkatsu = 0;
    device.pointSplit = 0;
    device.pointZanka = 0;
    if (st.payMethod !== "ikkatsu") {
      // ①頭金へ充当する
      device.atamaPoint = Math.min(ptLeft, deviceAtama);
      device.atama = deviceAtama - device.atamaPoint;
      ptLeft -= device.atamaPoint;
    }

    if (st.payMethod === "ikkatsu") {
      // 一括は頭金の区別が無いため、値引き後の総額をそのまま店頭でお支払い
      initialDevice = deviceTotal;
      device.atama = 0;
      device.atamaOff = 0;
      device.atamaBeforePoint = 0;
      device.pointIkkatsu = Math.min(ptLeft, initialDevice);
      ptLeft -= device.pointIkkatsu;
    } else if (/^b\d+$/.test(st.payMethod)) {
      // ②残った値引きを分割する分から引く
      var pBase = Math.max(0, deviceList - atamaInput);
      var p = Math.max(0, pBase - off);
      device.offLeft = Math.max(0, off - pBase);
      // 頭金で引ききれなかったポイントも、続けて分割する分から引く
      device.pointSplit = Math.min(ptLeft, p);
      p -= device.pointSplit;
      ptLeft -= device.pointSplit;
      var n = parseInt(st.payMethod.slice(1), 10);
      if (p > 0) {
        device.monthly = Math.floor(p / n);
        device.months = n;
        device.firstExtra = p - device.monthly * n;
      }
    } else if (st.payMethod === "kaedoki") {
      // 入力は「23回分の総額（頭金込み）」。残価は 端末代金総額 − その額 で決まる
      var t23In = Math.min(Math.max(0, num(st.kaedoki23)), deviceList);
      // ②23回で分割する分から引く
      var split23Base = Math.max(0, t23In - atamaInput);
      var split23 = Math.max(0, split23Base - off);
      off = Math.max(0, off - split23Base);
      // 頭金で引ききれなかったポイントも、続けて23回分から引く
      device.pointSplit = Math.min(ptLeft, split23);
      split23 -= device.pointSplit;
      ptLeft -= device.pointSplit;
      // ③残価から引く
      var zBase = Math.max(0, deviceList - t23In);
      var z = Math.max(0, zBase - off);
      device.offLeft = Math.max(0, off - zBase);
      // それでも余ったポイントは残価から引く
      device.pointZanka = Math.min(ptLeft, z);
      z -= device.pointZanka;
      ptLeft -= device.pointZanka;
      // ポイント充当後の「23回分の総額（頭金込み）」
      var t23 = device.atama + split23;
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
    device.total = deviceTotal;
    // 充当しきれなかったポイント（お支払いより多く入れたとき）
    device.pointLeft = ptLeft;

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
        accMonthlyRows.push({ svc: "ac:" + a.id, name: a.name, monthly: am2, months: an2 });
        accFirstExtra += a.price - am2 * an2;
      } else {
        accOnceRows.push({ svc: "ac:" + a.id, name: a.name, amount: a.price });
      }
    });

    /* dカード還元特典の自動計算
     * 対象＝プラン基本料（みんなドコモ割・お支払割など各種割引の適用後）
     * 　　＋通話オプション＋対象（carrier）オプションのみ。
     * 公式の還元条件が「各種割引適用後のご利用料金」のため、割引後で計算する。
     * （2026-08-23修正: 以前は割引前の定価で計算しており、ポイントが多く出て
     * 　実質額を安く見せすぎていた） */
    // 税込1,100円ごとに GOLD U 50pt／GOLD 100pt／PLATINUM 200pt
    var dcardGoldBase = planMonthly + voicePrice + net.total;
    MASTER.options.forEach(function (o) {
      if (!st.options[o.id] || !o.carrier) return;
      if (bonusFree[o.id]) return;   // 選べる特典で0円のものは支払いが無いため対象外
      dcardGoldBase += optPrice(o, st);
    });
    // 対象外プラン（ドコモmini・ahamo・irumoなど dcard10:false）は還元なし
    var dcardAutoPt = plan.dcard10 === false ? 0 : Math.floor(dcardGoldBase / 1100) * dcardRatePt(st.dCard);

    /* 爆アゲセレクションの還元ポイント。
     * 還元率はプランの区分で変わる（ドコモMAX・ポイ活MAX と、それ以外の対象プラン）。
     * 対象外のプラン（ドコモmini・irumo・キッズなど）では還元されない。
     * 選べる特典で0円になっているものも、支払いが無いため対象外。 */
    var bakuTier = plan.bakuageTier || "";
    var bakuageRows = [];
    var bakuageAutoPt = 0;
    MASTER.options.forEach(function (o) {
      if (!st.options[o.id]) return;
      if (bonusFree[o.id]) return;      // 0円のものは支払いが無いため還元されない
      var fixed = num(o.bakuageFixed);
      var pr = optPrice(o, st);
      var pt = 0, label = "", exTax = 0;
      if (fixed > 0) {
        // 固定ポイントはプランの区分によらず進呈するもの
        pt = fixed;
        label = "固定";
      } else if (bakuTier) {
        var rate = num(bakuTier === "max" ? o.bakuage : o.bakuage2);
        if (!rate) return;
        /* 還元は税抜価格が基準で、端数は切り上げ。
         * 出典: https://ssw.web.docomo.ne.jp/bakuage/
         * 「プランごとの税抜価格に還元率を乗じ小数切上で、還元ポイントを算出しています。」
         * マスタの金額は税込なので、割り戻してから計算する。 */
        exTax = bakuageExTax(pr);
        pt = Math.ceil(exTax * rate / 100);
        label = rate + "%";
      }
      if (pt <= 0) return;
      bakuageRows.push({ name: o.name, rate: label, price: pr, exTax: exTax, pt: pt });
      bakuageAutoPt += pt;
    });

    // ポイント自動充当（実質額の案内用・入力pt=円で月額から差引）
    // dカード還元は入力欄の値をそのまま使う（GOLD選択時は自動計算値が初期セットされるが編集可）
    // ポイ活プラン以外では、入力が残っていても充当しない
    var isPoikatsu = poikatsuPlan(plan.id);

    /* もらえるポイント（実額）。「見積もりに含める」のチェックとは関係なく、
     * お客様が実際に受け取る分。 */
    var earnPoikatsu = isPoikatsu ? Math.max(0, num(st.pointPoikatsu)) : 0;
    var earnFamily = isPoikatsu ? Math.max(0, num(st.pointPoikatsuFamily)) : 0;
    var earnBakuage = Math.max(0, num(st.pointBakuage));
    var earnDcard = Math.max(0, num(st.pointDcard));

    /* 月額から差し引く分。個別の「見積もりに含める」を外したものは引かない。 */
    var ptPoikatsu = earnPoikatsu;
    var ptFamily = earnFamily;
    var ptBakuage = st.bakuageInclude === false ? 0 : earnBakuage;
    /* 「見積もりに含める」を外していたら、カードの種類によらず引かない。
     * GOLD系から通常カードへ切り替えたとき、手入力の値が
     * チェックボックスごと消えて引かれ続ける事故があった。 */
    var ptDcard = st.dcardGoldAuto === false ? 0 : earnDcard;

    /* ポイントの扱い。
     * 充当する … 選んだものを月額から差し引いて「実質のお支払い額」として出す
     * 充当しない … 何も引かない。差し引く相手がいないので、
     *   もらえるポイントは個別のチェックによらず全部を合算して案内する
     *   （爆アゲもdカード特典も、実際にはもらえるため） */
    var pointApply = st.pointApply === true;
    var pointRows = [];
    function addPointRow(name, used, earned) {
      var v = pointApply ? used : earned;
      if (v > 0) pointRows.push({ name: name, amount: v });
    }
    addPointRow("爆アゲ セレクション還元", ptBakuage, earnBakuage);
    addPointRow("ポイ活プラン還元", ptPoikatsu, earnPoikatsu);
    addPointRow("ポイ活ファミリー特典", ptFamily, earnFamily);
    addPointRow("dカード還元特典", ptDcard, earnDcard);
    var pointTotal = 0;
    pointRows.forEach(function (x) { pointTotal += x.amount; });
    var pointUsed = pointApply ? pointTotal : 0;

    /* 充当できるのは、プラン・オプションなどの恒久部分が0円になるまで。
     * 超えて引くと、見積書が「小計0円＋分割◯円＝月額合計0円」のような
     * 破綻した表になる。引ききれない分は反映せず、注記で案内する。 */
    var monthlyBeforePoint = planMonthly + voicePrice + optTotal + adhocPerm;
    var pointOver = Math.max(0, pointUsed - Math.max(0, monthlyBeforePoint));
    pointUsed -= pointOver;

    // 月額（恒久部分）
    var baseMonthly = monthlyBeforePoint - pointUsed;

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
    var atama = device.atama; // 値引きを引いたあとの頭金
    // where: "store"=店頭お支払い / "bill"=翌月の携帯料金と合算
    var initialRows = [];
    if (num(st.jimuFee) > 0) initialRows.push({ name: "契約事務手数料", amount: num(st.jimuFee), where: "bill" });
    if (initialDevice > 0) {
      // 一括購入時は頭金も総額に含まれているため、「店頭頭金」の行は出さず1行で表示
      initialRows.push({ name: "機種代金（一括）", amount: initialDevice, where: "store" });
      if (device.pointIkkatsu > 0) {
        initialRows.push({ name: "dポイント充当", amount: -device.pointIkkatsu, where: "store" });
      }
    } else if (device.atamaBeforePoint > 0) {
      initialRows.push({ name: "店頭頭金", amount: device.atamaBeforePoint, where: "store" });
      if (device.atamaPoint > 0) {
        initialRows.push({ name: "dポイント充当", amount: -device.atamaPoint, where: "store" });
      }
    }
    (MASTER.feeItems || []).forEach(function (f) {
      if (st.feeItems[f.id]) initialRows.push({ svc: "fi:" + f.id, name: f.name, amount: f.price, where: feeItemPayOf(st, f) });
    });
    accOnceRows.forEach(function (a) {
      initialRows.push({ svc: a.svc, name: a.name + "（アクセサリ・一括）", amount: a.amount, where: "store" });
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
      dHearty: dHearty, dHeartyVoice: dHeartyVoice, dKosodate: dKosodate, dKosodateVoice: dKosodateVoice,
      planMonthly: planMonthly,
      voice: vo, voicePrice: voicePrice, voiceNote: voiceNote,
      optRows: optRows, optTotal: optTotal, netRows: net.rows, bonusRows: bonusRows,
      adhocPerm: adhocPerm, adhocLimited: adhocLimited, campaignRows: campaignRows, pointRows: pointRows,
      pointApply: pointApply, pointTotal: pointTotal, pointOver: pointOver,
      dcardAutoPt: dcardAutoPt, dcardGoldBase: dcardGoldBase,
      bakuageRows: bakuageRows, bakuageAutoPt: bakuageAutoPt, bakuageTier: bakuTier,
      accMonthlyRows: accMonthlyRows, accOnceRows: accOnceRows,
      device: device, baseMonthly: baseMonthly,
      segs: segs, firstExtra: firstExtra,
      initialRows: initialRows, initialTotal: initialTotal,
      storeRows: storeRows, billRows: billRows, storeTotal: storeTotal, billTotal: billTotal,
    };
  }
  function calc() { return calcFor(state); }

  // ポイ活プラン選択時の還元ポイント初期値（ポイ活20は上限2,500pt）
  // ポイ活プランかどうか（還元ポイントの入力欄と、実質額への充当はこのプランだけ）
  // ポイ活プランかどうかは、マスタ設定の「ポイ活の還元上限」が0より大きいかで決まる
  function poikatsuDefaultPt(planId) {
    var p = planById(planId);
    return p ? Math.max(0, num(p.poikatsuPt)) : 0;
  }
  function poikatsuPlan(planId) { return poikatsuDefaultPt(planId) > 0; }
  // プラン切替時に初期値を自動セット（手入力した値は上書きしない）
  function syncPoikatsuDefault(prevPlanId) {
    var cur = num(state.pointPoikatsu);
    if (cur && cur !== poikatsuDefaultPt(prevPlanId)) return;
    state.pointPoikatsu = poikatsuDefaultPt(state.planId);
    $("ptPoikatsu").value = state.pointPoikatsu || "";
  }
  function isPatternUsed(st) {
    var d = defaultState();
    var keys = ["minna", "dSet", "dCard", "dDenki", "choki", "hearty", "kosodate", "voice", "devicePrice", "payMethod", "tierIdx", "planGroup", "deviceName", "custName", "pointPoikatsu", "pointPoikatsuFamily", "pointDcard"];
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
  var tplStoreSaveMode = false;
  function renderTplBar() {
    document.querySelectorAll(".tpl[data-tpl]").forEach(function (b) {
      var t = templates[+b.dataset.tpl];
      b.textContent = t ? t.name : "未設定";
      b.classList.toggle("filled", !!t);
      b.classList.toggle("empty", !t);
    });
    document.querySelectorAll(".tpl[data-tplst]").forEach(function (b) {
      var t = storeTemplates[+b.dataset.tplst];
      b.textContent = t ? t.name : "未設定";
      b.classList.toggle("filled", !!t);
      b.classList.toggle("empty", !t);
    });
    var bar = document.querySelector(".tpl[data-tpl]").closest(".pattern-bar");
    bar.classList.toggle("tpl-saving", tplSaveMode);
    var sbar = document.querySelector(".tpl-store-bar");
    if (sbar) sbar.classList.toggle("tpl-saving", tplStoreSaveMode);
    closeTplMenu();
    $("saveTplBtn").textContent = tplSaveMode ? "保存先のテンプレボタンをタップ（ここを押すとキャンセル）" : "現在の内容をテンプレに保存";
    var ssb = $("saveStoreTplBtn");
    if (ssb) ssb.textContent = tplStoreSaveMode ? "保存先の店舗共通ボタンをタップ（ここを押すとキャンセル）" : "現在の内容を店舗共通に保存";
  }
  function tplSnapshot() {
    var snap = JSON.parse(JSON.stringify(state));
    delete snap.custName; delete snap.shopName; delete snap.staffName; delete snap.shopTel;
    delete snap.curBill;  // 請求内訳の読み取りは端末内のみ（テンプレにも入れない）
    return snap;
  }
  function tplApply(i, isStore) {
    var t = (isStore ? storeTemplates : templates)[i];
    if (!t) {
      tplMsg(isStore
        ? "店舗共通" + (i + 1) + "は未設定です。「現在の内容を店舗共通に保存」から登録してください"
        : "テンプレ" + (i + 1) + "は未設定です。「現在の内容をテンプレに保存」から登録してください");
      return;
    }
    var keep = { custName: state.custName, shopName: state.shopName, staffName: state.staffName, shopTel: state.shopTel, curBill: state.curBill || null };
    store.patterns[store.active] = Object.assign(defaultState(), JSON.parse(JSON.stringify(t.state)), keep);
    migratePattern(store.patterns[store.active]);
    state = store.patterns[store.active];
    syncFormFromState();
    recalc();
  }
  /* テンプレートの長押し削除
   * 長押し（またはPCの右クリック）で、そのテンプレートを消すかどうかを聞く。
   * 長押しのあとに click が続けて発生するため、直後の1回は無視する。 */
  var tplHold = { timer: null, fired: false, slot: -1, store: false };
  function closeTplMenu() {
    var m = $("tplMenu");
    if (m) m.hidden = true;
    tplHold.slot = -1;
  }
  function openTplMenu(i, btn, isStore) {
    var t = (isStore ? storeTemplates : templates)[i];
    if (!t) return;                      // 未設定の枠では出さない
    if (tplSaveMode || tplStoreSaveMode) return;  // 保存先を選んでいる最中は出さない
    tplHold.slot = i;
    tplHold.store = !!isStore;
    var m = $("tplMenu");
    $("tplMenuName").textContent = (isStore ? "店舗共通: " : "") + t.name;
    m.hidden = false;
    // ボタンのすぐ下に出す（画面からはみ出さないように寄せる）
    var r = btn.getBoundingClientRect();
    var w = m.offsetWidth || 200;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    m.style.left = left + "px";
    m.style.top = (r.bottom + 6) + "px";
  }
  /* 長押しで「つかむ」。つかんだまま別のボタンへ動かして離すと並べ替え、
   * 動かさずにそのまま離すと従来どおり削除メニューを出す。 */
  var tplDrag = null;   // { i, store, btn, moved }
  function tplDragClear() {
    if (!tplDrag) return;
    tplDrag.btn.classList.remove("tpl-grab");
    document.querySelectorAll(".tpl.tpl-over").forEach(function (x) { x.classList.remove("tpl-over"); });
    document.body.classList.remove("sorting");
    tplDrag = null;
  }
  // いま指している先が、入れ替え先として有効なボタンなら返す（別の列へは移さない）
  function tplTargetAt(x, y) {
    var el = document.elementFromPoint(x, y);
    var over = el && el.closest && el.closest(".tpl");
    if (!over || !tplDrag || over === tplDrag.btn) return null;
    if (over.hasAttribute("data-tplst") !== tplDrag.store) return null;
    return over;
  }
  function initTplHold() {
    document.querySelectorAll(".tpl").forEach(function (b) {
      var isStore = b.hasAttribute("data-tplst");
      var i = isStore ? +b.dataset.tplst : +b.dataset.tpl;
      function start(e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        tplHold.fired = false;
        clearTimeout(tplHold.timer);
        var pid = e.pointerId;
        tplHold.timer = setTimeout(function () {
          tplHold.fired = true;
          var t = (isStore ? storeTemplates : templates)[i];
          if (!t) return;                               // 未設定の枠はつかめない
          if (tplSaveMode || tplStoreSaveMode) return;  // 保存先を選んでいる最中はつかめない
          tplDrag = { i: i, store: isStore, btn: b, moved: false };
          b.classList.add("tpl-grab");
          document.body.classList.add("sorting");
          try { b.setPointerCapture(pid); } catch (e2) {}
        }, 550);
      }
      function cancel() { clearTimeout(tplHold.timer); }
      b.addEventListener("pointerdown", start);
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
        b.addEventListener(ev, cancel);
      });
      // PCは右クリックでも削除メニューを出せる
      b.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        tplHold.fired = true;
        openTplMenu(i, b, isStore);
      });
    });
    // つかんだあとの移動と、離したときの入れ替え／削除メニュー
    document.addEventListener("pointermove", function (e) {
      if (!tplDrag) return;
      e.preventDefault();
      document.querySelectorAll(".tpl.tpl-over").forEach(function (x) { x.classList.remove("tpl-over"); });
      var over = tplTargetAt(e.clientX, e.clientY);
      if (over) { over.classList.add("tpl-over"); tplDrag.moved = true; }
    }, { passive: false });
    document.addEventListener("pointerup", function (e) {
      if (!tplDrag) return;
      var d = tplDrag;
      var over = tplTargetAt(e.clientX, e.clientY);
      tplDragClear();
      if (over) {
        var j = d.store ? +over.dataset.tplst : +over.dataset.tpl;
        var list = d.store ? storeTemplates : templates;
        var tmp = list[d.i]; list[d.i] = list[j]; list[j] = tmp;
        if (d.store) persistStoreTemplates(); else persistTemplates();
        renderTplBar();
        tplMsg((d.store ? "店舗共通の" : "") + "テンプレートを並べ替えました");
      } else if (!d.moved) {
        openTplMenu(d.i, d.btn, d.store);   // 動かさず離した → 削除メニュー
      }
    });
    document.addEventListener("pointercancel", function () { tplDragClear(); });
    // つかんでいる間は画面ごとスクロールさせない（iPad）
    document.addEventListener("touchmove", function (e) {
      if (tplDrag) e.preventDefault();
    }, { passive: false });
    $("tplMenuDel").addEventListener("click", function () {
      var i = tplHold.slot;
      var list = tplHold.store ? storeTemplates : templates;
      if (i < 0 || !list[i]) { closeTplMenu(); return; }
      var nm = list[i].name;
      list[i] = null;
      if (tplHold.store) persistStoreTemplates(); else persistTemplates();
      renderTplBar();
      closeTplMenu();
      tplMsg((tplHold.store ? "店舗共通の" : "") + "「" + nm + "」を削除しました");
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
  var tplPendingStore = false;
  function tplMsg(text) {
    $("tplMsg").textContent = text;
    if (text) setTimeout(function () { if ($("tplMsg").textContent === text) $("tplMsg").textContent = ""; }, 4000);
  }
  function tplSave(i, isStore) {
    // iPadのホーム画面起動(PWA)ではprompt()が使えないため、画面内の入力欄で名前を付ける
    var plan = currentPlan();
    var procLabel = { shinki: "新規", mnp: "MNP", kishu: "機種変更", plan_only: "プラン変更" }[state.procType] || "";
    var cur = (isStore ? storeTemplates : templates)[i];
    tplPendingSlot = i;
    tplPendingStore = !!isStore;
    $("tplNameInput").value = cur ? cur.name
      : ((state.planId ? plan.name + " " : "") + procLabel).trim().slice(0, 20);
    $("tplNameBox").hidden = false;
    $("saveTplBtn").hidden = true;
    var ssb = $("saveStoreTplBtn"); if (ssb) ssb.hidden = true;
    tplMsg("");
    $("tplNameInput").focus();
  }
  function tplSaveDone(ok) {
    if (ok && tplPendingSlot != null) {
      var name = $("tplNameInput").value.trim()
        || ((tplPendingStore ? "店舗共通" : "テンプレ") + (tplPendingSlot + 1));
      var entry = { name: name.slice(0, 20), state: tplSnapshot() };
      if (tplPendingStore) {
        storeTemplates[tplPendingSlot] = entry;
        persistStoreTemplates();
        tplMsg("店舗共通に「" + entry.name + "」を保存しました（全担当で使えます）");
      } else {
        templates[tplPendingSlot] = entry;
        persistTemplates();
        tplMsg("「" + entry.name + "」を保存しました");
      }
    }
    tplPendingSlot = null;
    tplPendingStore = false;
    tplSaveMode = false;
    tplStoreSaveMode = false;
    $("tplNameBox").hidden = true;
    $("saveTplBtn").hidden = false;
    var ssb = $("saveStoreTplBtn"); if (ssb) ssb.hidden = false;
    renderTplBar();
  }
  /* ご来店の目的まわりの表示。
   * ①端末購入のときだけ「買い増しあり」のチェックを出し、
   * それ以外の目的で機種変更が入っているときは、買い増しとして数える旨を出す。 */
  function renderVisitPurpose() {
    var f = $("kaimashiField"), n = $("kaimashiNote");
    if (!f || !n) return;
    /* ご来店の目的は1商談に1つなので、回線1（patterns[0]）に持つ。
     * 回線2・3ではチェック欄を出さず、回線1の内容を文で出す。 */
    var vst = store.patterns[0] || state;
    var v = visitPurposesOf(vst);
    document.querySelectorAll("[data-visit]").forEach(function (cb) {
      cb.checked = !!v[cb.getAttribute("data-visit")];
    });
    var vks = visitKeys(vst);
    var onL1 = (store.active | 0) === 0;
    var chk = $("visitChecks"), n1 = $("visitOnLine1");
    if (chk) chk.hidden = !onL1;
    if (n1) {
      n1.hidden = onL1;
      n1.innerHTML = "ご来店の目的は<b>回線1</b>でまとめて入力します。"
        + (vks.length
            ? "（回線1：" + esc(vks.map(function (k) { return VISIT_NAMES[k]; }).join("・")) + "）"
            : "（回線1でまだ選んでいません）");
    }
    var buy = vks.indexOf("buy") >= 0;
    f.hidden = !buy;
    $("kaimashi").checked = !!state.kaimashi;
    var auto = !buy && vks.length > 0 && !!(state.procTodo || {}).kishu;
    n.hidden = !auto;
    if (auto) {
      n.textContent = "「" + vks.map(function (k) { return VISIT_NAMES[k]; }).join("・")
        + "」でのご来店から機種変更になったため、"
        + "実績では機種変更に加えて「プラスワン（再掲）」としても数えます。";
    }
  }

  /* U15の欄は、新規・MNPのときだけ出す。U15のプランを選んでいれば
   * チェックが無くても実績に入るので、その旨を出しておく。 */
  function renderU15() {
    var f = $("u15Field"), n = $("u15Note"), cb = $("u15");
    if (!f || !cb) return;
    var todo = state.procTodo || {};
    var newLine = !!(todo.shinki || todo.mnp) || state.procType === "shinki" || state.procType === "mnp";
    f.hidden = !newLine;
    cb.checked = !!state.u15;
    var byPlan = newLine && !!U15_PLANS[state.planId];
    if (n) {
      n.hidden = !byPlan;
      if (byPlan) n.textContent = "U15のプランを選んでいるので、チェックが無くても実績の「（再掲）U15」に入ります。";
    }
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
  /* MNP特典の欄は、MNPで端末を購入しないとき（SIMのみ）だけ出す。
   * 端末代金が入っていれば端末購入ありと見なす。 */
  function mnpSimOnly(st) {
    var todo = st.procTodo || {};
    var isMnp = !!todo.mnp || st.procType === "mnp";
    return isMnp && num(st.devicePrice) === 0;
  }
  var MNP_BENEFIT_NAMES = { cash: "キャッシュバック", dpoint: "dポイント還元" };
  // ご案内した特典の文字（見積書・引き継ぎシートで共通）
  function mnpBenefitText(st) {
    var t = st.mnpBenefitType;
    if (!t || !MNP_BENEFIT_NAMES[t]) return "";
    var a = num(st.mnpBenefitAmt);
    if (!a) return MNP_BENEFIT_NAMES[t];
    return MNP_BENEFIT_NAMES[t] + " "
      + (t === "dpoint" ? a.toLocaleString("ja-JP") + "pt" : yen(a));
  }
  function renderMnpBenefit() {
    var wrap = $("mnpBenefitWrap");
    if (!wrap) return;
    var on = mnpSimOnly(state);
    wrap.hidden = !on;
    if (!on) return;
    $("mnpBenefitType").value = state.mnpBenefitType || "";
    $("mnpBenefitAmt").value = num(state.mnpBenefitAmt) || "";
    $("mnpBenefitAmtWrap").hidden = !state.mnpBenefitType;
    $("mnpBenefitUnit").textContent = state.mnpBenefitType === "dpoint" ? "pt" : "円";
  }
  // ネットワークサービスの選択欄（通話オプションで金額が変わるので描き直す）
  function renderNetSvc() {
    var free = kakeVoice(state.voice);
    var net = netSvcCalc(state);
    $("netSvcList").innerHTML = NET_SVC.map(function (n) {
      var on = netSvcOn(state, n.id);
      var kb = netKubun(state, n.id);
      var isOff = on && kb === "off";
      var f = free && n.freeWithKake;
      // 廃止のときは元の金額に取り消し線を引く（もう払わない金額だと分かるように）
      var pr = isOff ? '<span style="text-decoration:line-through;opacity:.5">' + yen(n.price) + "/月</span>"
        : f ? "無料（通話オプションに込み）"
        : (!free && net.pack && on ? "パック適用" : yen(n.price) + "/月");
      var h = '<div class="opt-row"><label class="check"><input type="checkbox" data-netsvc="' + n.id + '"'
        + (on ? " checked" : "") + "> " + esc(n.name) + "</label>";
      // 区分は、チェックしているものだけに出す（オプション欄と同じ考え方）
      if (on) {
        h += '<select class="net-kubun" data-netkubun="' + n.id + '">'
          + [["new", "新規"], ["keep", "継続"], ["off", "廃止"]].map(function (k) {
              return '<option value="' + k[0] + '"' + (kb === k[0] ? " selected" : "") + ">" + k[1] + "</option>";
            }).join("") + "</select>";
      }
      return h + '<span class="price">' + pr + "</span></div>";
    }).join("");
    var msg;
    if (free) {
      msg = "通話オプション（880円／1,980円）を付けているため、留守番電話・キャッチホンは無料です。";
      if (netSvcOn(state, "melody") && netKubun(state, "melody") !== "off") msg += "メロディコールは110円/月かかります。";
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
    /* このプランで選べないもの（hideOnPlans）は選択肢に出さない。
     * 選択中だった場合は標準版（留守電・キャッチホン無料つき）へ戻す */
    var cur = MASTER.voiceOptions.filter(function (v) { return v.id === state.voice; })[0];
    if (cur && voiceHiddenOn(plan, cur)) {
      state.voice = VOICE_FALLBACK[cur.id] || "none";
    }
    var curKey = voiceTileKey(state.voice);
    $("voiceTiles").innerHTML = voiceTiles(plan).map(function (t) {
      var on = t.key === curKey;
      // タイルの中で選ばれているもの（選んでいなければ先頭＝新）
      var sel = t.items.filter(function (v) { return v.id === state.voice; })[0] || t.items[0];
      var pr = voicePriceFor(plan, sel);
      var priceHtml;
      if (t.key === "none") {
        priceHtml = "";
      } else if (t.items.length > 1) {
        // 新旧が選べるものは、タイルの中にプルダウンを出す
        priceHtml = '<select data-voice-era="' + esc(t.key) + '">'
          + t.items.map(function (v) {
              var p2 = voicePriceFor(plan, v);
              return '<option value="' + esc(v.id) + '"' + (v.id === sel.id ? " selected" : "") + ">"
                + esc(VOICE_ERA[v.id] || "") + " " + (p2 === 0 ? "プランに込み" : yen(p2)) + "</option>";
            }).join("") + "</select>";
      } else {
        priceHtml = '<span class="t-price">' + (pr === 0 ? "プランに込み" : yen(pr) + "/月") + "</span>";
      }
      return tileHtml("data-voice", t.key, t.name, on, priceHtml);
    }).join("");
    var hint = $("voiceHint");
    if (hint) {
      var hasEra = voiceTiles(plan).some(function (t) { return t.items.length > 1; });
      hint.textContent = hasEra
        ? "「新」は留守番電話・キャッチホンが無料で付きます。「旧」はそれ以前からのご契約で、留守番電話・キャッチホンは別料金です。"
        : "";
      hint.hidden = !hasEra;
    }
  }
  /* ドコモメールが「有料オプション」になるプラン。ここに無いプランは
   * 標準で込みなので、②のプルダウン自体を出さない（2026-08-21 店頭確認）。
   * 対象を増減するときは、この一覧を直すだけでよい。 */
  var MAIL_PAID_PLANS = ["mini", "ahamo", "irumo"];
  function mailPaidPlan() { return MAIL_PAID_PLANS.indexOf(currentPlan().id) >= 0; }
  function mailOptDef() {
    return MASTER.options.filter(function (o) {
      return o.id === "docomomail" || (o.name || "").indexOf("ドコモメール") >= 0;
    })[0];
  }
  function renderMailOpt() {
    var mo = mailOptDef();
    var paid = !!mo && mailPaidPlan();
    var field = $("mailField");
    if (field) field.hidden = !paid;
    $("mailHint").hidden = !paid;
    /* 標準込みのプランへ切り替えたら、残っていた有料メールの選択は外す。
     * 隠れたまま月額に乗り続けるのを防ぐ（続くrecalcで金額にも反映される）。 */
    if (!paid && mo && (state.options[mo.id] || state.optionKubun[mo.id])) {
      state.options[mo.id] = false;
      delete state.optionKubun[mo.id];
    }
    if (!paid) return;
    // ④のオプションタイルと同じ形: タップで選び、タイルの中で新規／継続／廃止を選ぶ
    var on = !!state.options[mo.id];
    var kb = state.optionKubun[mo.id] || (on ? "new" : "");
    var isOff = kb === "off";
    var kubunHtml = (on || isOff)
      ? '<span class="t-kubun">'
        + [["new", "新規"], ["keep", "継続"], ["off", "廃止"]].map(function (k) {
            return '<label class="kb' + (kb === k[0] ? " on" : "") + '">'
              + '<input type="checkbox" data-mailkubun="' + esc(mo.id) + '" value="' + k[0] + '"'
              + (kb === k[0] ? " checked" : "") + "> " + k[1] + "</label>";
          }).join("") + "</span>"
      : "";
    var priceHtml = '<span class="t-price">' + yen(optPrice(mo, state)) + "/月</span>";
    $("mailTile").innerHTML = tileHtml("data-mail", mo.id, mo.name, on, priceHtml + kubunHtml, isOff ? "kubun-off" : "");
    $("mailHint").textContent = "このプランはドコモメールが有料オプションです（" + yen(mo.price) + "/月）。タイルを押して選び、中の新規／継続／廃止で区分を選べます（廃止は月額に入れません）。";
  }
  function tileHtml(attr, id, name, on, priceHtml, extraClass) {
    return '<div class="tile' + (on ? " on" : "") + (extraClass ? " " + extraClass : "")
      + '" role="checkbox" aria-checked="' + (on ? "true" : "false")
      + '" tabindex="0" ' + attr + '="' + esc(id) + '">'
      + '<span class="t-name">' + esc(name) + "</span>"
      + priceHtml
      + "</div>";
  }
  /* 選んだときに公式ページへの参照リンクを出すオプション。
   * 金額が機種などで変わるものは、その場で正確な額を調べられるようにする。 */
  var OPT_INFO_LINKS = {
    smart_hosho: "https://www.docomo.ne.jp/service/smart_anshin_hoshou/charge.html",
    anshin_pack: "https://www.docomo.ne.jp/service/smart_anshinpack/"
  };
  /* 中身が重なるオプションの組み合わせ（片方を選ぶと、もう片方は自動で外れる）。
   * dバリューパス パックは dバリューパス を含むため、両方を数えると二重になる。 */
  var OPT_EXCLUSIVE = [["dvaluepass", "dvaluepass_single"]];
  function optExclusiveOther(id) {
    var other = null;
    OPT_EXCLUSIVE.forEach(function (pair) {
      if (pair[0] === id) other = pair[1];
      else if (pair[1] === id) other = pair[0];
    });
    return other;
  }
  /* id を選んだときに、重なるほうを外す */
  function optExclusiveOff(id, pt) {
    var st = pt || state;
    var other = optExclusiveOther(id);
    if (!other) return false;
    if (!st.options[other] && !st.optionKubun[other]) return false;
    st.options[other] = false;
    if (st.optionKubun) delete st.optionKubun[other];
    return true;
  }
  function renderOptionList() {
    // カテゴリ（フォルダ）ごとに横5列のタイルで表示
    var h = "";
    optCategories().forEach(function (cat) {
      var mailDef = mailOptDef();
      var items = MASTER.options.filter(function (o) {
        if (mailDef && o.id === mailDef.id) return false; // ②で選択するため除外
        return (o.category || "その他") === cat;
      });
      var accItems = accInCategory(cat);
      if (!items.length && !accItems.length) return;
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
        var kbList = optHasExist(o)
          ? [["new", "新規"], ["exist", "既存"], ["keep", "継続"], ["off", "廃止"]]
          : [["new", "新規"], ["keep", "継続"], ["off", "廃止"]];
        var kubunHtml = (on || isOff)
          ? '<span class="t-kubun">'
            + kbList.map(function (k) {
                return '<label class="kb' + (kb === k[0] ? " on" : "") + '">'
                  + '<input type="checkbox" data-optkubun="' + esc(o.id) + '" value="' + k[0] + '"'
                  + (kb === k[0] ? " checked" : "") + "> " + k[1] + "</label>";
              }).join("") + "</span>"
          : "";
        var linkHtml = (on && OPT_INFO_LINKS[o.id])
          ? '<a class="t-link" href="' + OPT_INFO_LINKS[o.id] + '" target="_blank" rel="noopener">公式の料金表を開く ↗</a>'
          : "";
        return tileHtml("data-opt", o.id, o.name, on, priceHtml + kubunHtml + linkHtml, isOff ? "kubun-off" : "");
      }).join("") + accItems.map(accTileHtml).join("") + "</div>";
    });
    $("optionList").innerHTML = h;
  }
  /* 初期費用の支払い先。
   * データ移行の項目は、お客様のご希望で店頭払いにも翌月合算にもなるため、
   * この見積もりだけ変えられるようにしている。指定がなければマスタの設定を使う。 */
  var FEE_PAYS = { store: "店頭払い", bill: "翌月合算" };
  function feeItemPayOf(st, f) {
    var v = (st.feeItemPay || {})[f.id];
    if (v === "store" || v === "bill") return v;
    return f.pay === "bill" ? "bill" : "store";
  }
  function renderFeeItemList() {
    var list = MASTER.feeItems || [];
    $("feeItemList").innerHTML = '<div class="tile-grid">' + list.map(function (f) {
      var on = !!state.feeItems[f.id];
      var body = '<span class="t-price">' + yen(f.price) + "</span>";
      var name = f.name;
      // データ移行の項目は、選んでいるときだけ支払い先をその場で選べるようにする
      if (f.dataMove && on) {
        var cur = feeItemPayOf(state, f);
        body += '<select data-feepay="' + esc(f.id) + '">'
          + Object.keys(FEE_PAYS).map(function (v) {
              return '<option value="' + v + '"' + (cur === v ? " selected" : "") + ">" + FEE_PAYS[v] + "</option>";
            }).join("") + "</select>";
      } else if (f.pay === "bill") {
        name += "（翌月合算）";
      }
      return tileHtml("data-fee", f.id, name, on, body);
    }).join("") + "</div>";
  }
  /* アクセサリのタイル。
   * カテゴリを設定したものは「⑥アクセサリ」ではなく、オプションのそのカテゴリの中に並べる。
   * 物販でも一括と分割を選べる必要があるため、選択肢はアクセサリのまま持ち回る。 */
  function accInCategory(cat) {
    return (MASTER.accessories || []).filter(function (a) {
      return OPT_CATEGORIES.indexOf(a.category) >= 0 && a.category === cat;
    });
  }
  function accDefaultPay(a) {
    return ACC_PAYS.indexOf(a.defaultPay) >= 0 ? a.defaultPay : "once";
  }
  var ACC_PAYS = ["once", "b12", "b24", "b36"];
  var ACC_PAY_LABELS = { once: "一括", b12: "分割12回", b24: "分割24回", b36: "分割36回" };
  function accTileHtml(a) {
    var pay = state.accSel[a.id];
    var on = !!pay;
    var body = on
      ? '<select data-acsel="' + esc(a.id) + '">'
        + ACC_PAYS.map(function (v) {
            return '<option value="' + v + '"' + (pay === v ? " selected" : "") + ">" + ACC_PAY_LABELS[v] + "</option>";
          }).join("") + "</select>"
      : '<span class="t-price">' + yen(a.price) + "</span>";
    return '<div class="tile' + (on ? " on" : "") + '" role="checkbox" aria-checked="' + (on ? "true" : "false")
      + '" tabindex="0" data-acc="' + esc(a.id) + '">'
      + '<span class="t-name">' + esc(a.name) + (on ? "<br>" + yen(a.price) : "") + "</span>"
      + body + "</div>";
  }
  function renderAccessoryTiles() {
    // カテゴリを設定したものはオプション側に出るため、ここでは除く
    var list = (MASTER.accessories || []).filter(function (a) {
      return OPT_CATEGORIES.indexOf(a.category) < 0;
    });
    if (!list.length) { $("accTileList").innerHTML = ""; return; }
    $("accTileList").innerHTML = '<div class="tile-grid">' + list.map(accTileHtml).join("") + "</div>";
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
  /* 選んだプランで効かない割引は出さない。
   * 出しておくと、対象外なのに選べてしまい、案内を誤りやすいため。
   * 何が対象外なのかは1行にまとめて下に出す。 */
  var DISCOUNT_FIELDS = [
    { wrap: "minnaWrap", name: "みんなドコモ割", note: "回線数のカウントには含まれます",
      on: function (d) { return !!(d.minna2 || d.minna3); } },
    { wrap: "dSetWrap", name: "ドコモ光／home 5G セット割", on: function (d) { return !!d.set; } },
    { wrap: "dCardWrap", name: "dカードお支払割", on: function (d) { return !!(d.dcard || d.dcardGold); } },
    { wrap: "dDenkiWrap", name: "ドコモでんきセット割", on: function (d) { return !!d.denki; } },
    { wrap: "chokiWrap", name: "長期利用割", on: function (d) { return !!d.choki10; } },
    { wrap: "heartyWrap", name: "ハーティ割引", on: function (d) { return !!d.hearty; } },
    { wrap: "kosodateWrap", name: "子育てサポート割引", on: function (d) { return !!d.kosodate; } }
  ];
  function renderDiscountHint() {
    var plan = currentPlan();
    var shown = hasPlan();
    var offs = [];
    /* ハーティ割引を選んでいるときは、重ねられない割引をその場で知らせる */
    var hw = $("heartyNote");
    if (hw) hw.hidden = !(state.hearty && (plan.discounts || {}).hearty);
    DISCOUNT_FIELDS.forEach(function (f) {
      var el = $(f.wrap);
      if (!el) return;
      var ok = !shown || f.on(plan.discounts || {});
      el.hidden = !ok;
      if (!ok) offs.push(f.name + (f.note ? "（" + f.note + "）" : ""));
    });
    // ポイ活の還元ポイントは、ポイ活プランのときだけ出す
    var pk = !shown || poikatsuPlan(plan.id);
    ["ptPoikatsuWrap", "ptPoikatsuFamilyWrap"].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = !pk;
    });
    var off = $("discountOff");
    if (off) {
      off.textContent = offs.length
        ? esc(plan.name) + " は " + offs.join("／") + " の対象外です。"
        : "";
      off.hidden = !offs.length;
    }
    $("discountHint").textContent = "";
  }
  function syncFormFromState() {
    renderPatternTabs();
    $("procType").value = state.procType;
    $("planGroup").value = state.planGroup;
    renderPlanSelect();
    $("minnaOn").checked = state.minna !== "0";
    $("minnaSub").hidden = state.minna === "0";
    var mr = document.querySelector('input[name="minnaN"][value="' + (state.minna === "3" ? "3" : "2") + '"]');
    if (mr) mr.checked = true;
    $("dSet").checked = state.dSet;
    $("dCardOn").checked = state.dCard !== "none";
    $("dCardSub").hidden = state.dCard === "none";
    dcardKindBoxes().forEach(function (b) {
      b.checked = b.getAttribute("data-dcard") === state.dCard;
    });
    $("dDenki").checked = state.dDenki;
    $("chokiOn").checked = state.choki !== "none";
    $("chokiSub").hidden = state.choki === "none";
    var cr = document.querySelector('input[name="chokiY"][value="' + (state.choki === "y20" ? "y20" : "y10") + '"]');
    if (cr) cr.checked = true;
    /* その他割引は、どちらかを選んでいるか、開くと自分で押したときに開いた状態にする */
    var otherOn = state.hearty || state.kosodate || otherWariOpen;
    $("otherWariOn").checked = otherOn;
    $("otherWariBox").hidden = !otherOn;
    $("hearty").checked = state.hearty;
    $("kosodate").checked = state.kosodate;
    var kn = $("kosodateNote");
    if (kn) kn.hidden = !state.kosodate;
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
    renderDeviceSelect();
    $("couponOff").value = state.couponOff || "";
    $("tebikiOff").value = state.tebikiOff || "";
    $("directOff").value = state.directOff || "";
    $("payMethod").value = state.payMethod;
    $("kaedoki23").value = state.kaedoki23 || "";
    $("kaedokiFee").value = state.kaedokiFee || "";
    $("atamakin").value = state.atamakin;
    $("jimuFee").value = state.jimuFee;
    $("currentInst").value = state.currentInst || "";
    $("currentInstMonths").value = state.currentInstMonths || "";
    $("currentInstMonthsField").hidden = !num(state.currentInst);
    renderCurBill();
    $("custName").value = state.custName;
    $("shopName").value = state.shopName;
    $("staffName").value = state.staffName;
    $("shopTel").value = state.shopTel || "";
    $("quoteMemo").value = state.quoteMemo;
    ["todoDcard", "todoDenki", "todoGas", "todoHikari"].forEach(function (k) { $(k).checked = !!state[k]; });
    $("kaimashi").checked = !!state.kaimashi;
    renderVisitPurpose();
    $("voiceChange").checked = !!state.voiceChange;
    renderNetSvc();
    $("planChange").checked = !!state.planChange;
    document.querySelectorAll("[data-storepay]").forEach(function (cb) {
      cb.checked = !!(state.storePay || {})[cb.getAttribute("data-storepay")];
    });
    /* dポイント利用は⑤端末代金と⑦初期費用の両方から操作できる。
     * 充当先が店頭頭金（⑤で決める金額）なので、端末代金を入れながら
     * その場で決められるようにしてある。設定はひとつを共有する。 */
    ["", "dev"].forEach(function (pre) {
      var chk = $(pre ? "devUsePoint" : "usePoint");
      var fld = $(pre ? "devUsePointField" : "usePointField");
      var amt = $(pre ? "devUsePointAmount" : "usePointAmount");
      if (chk) chk.checked = !!state.usePoint;
      if (fld) fld.hidden = !state.usePoint;
      if (amt && document.activeElement !== amt) amt.value = state.usePointAmount || "";
    });
    renderPointUse();
    $("todoOther").value = state.todoOther || "";
    $("dcardTypeWrap").hidden = !state.todoDcard;
    $("denkiTypeWrap").hidden = !state.todoDenki;
    $("gasTypeWrap").hidden = !state.todoGas;
    if (state.todoGas) renderGasArea();
    document.querySelectorAll("[data-dcardtype]").forEach(function (cb) { cb.checked = state.todoDcardType === cb.getAttribute("data-dcardtype"); });
    document.querySelectorAll("[data-denkitype]").forEach(function (cb) { cb.checked = state.todoDenkiType === cb.getAttribute("data-denkitype"); });
    document.querySelectorAll("[data-gastype]").forEach(function (cb) { cb.checked = state.todoGasType === cb.getAttribute("data-gastype"); });
    renderGasEco();
    renderGasDiscounts();
    renderEnergyNow();
    document.querySelectorAll("[data-proc]").forEach(function (cb) {
      cb.checked = !!(state.procTodo || {})[cb.getAttribute("data-proc")];
    });
    renderU15();
    $("ptPoikatsu").value = state.pointPoikatsu || "";
    $("ptPoikatsuFamily").value = state.pointPoikatsuFamily || "";
    $("ptBakuage").value = state.pointBakuage || "";
    $("pointApply").value = state.pointApply === true ? "1" : "0";
    $("ptDcard").value = state.pointDcard || "";
    $("kaedoki23Field").hidden = state.payMethod !== "kaedoki";
    $("kaedokiFeeField").hidden = state.payMethod !== "kaedoki";
    // 端末購入なしのときは、購入時にしか使わない入力をまとめて隠す（現在の分割支払金は残す）
    $("devBuyDetail").hidden = state.payMethod === "none";
    renderCampaigns();
    renderDiscountHint();
  }

  /* ---------- 端末入力の不整合チェック ---------- */
  /* dポイントをどこへいくら充当したかの内訳。
   * 入力欄の案内・見積書・引き継ぎシートで同じ並びを使う。 */
  function pointUseParts(d) {
    var a = [];
    if (d.atamaPoint > 0) a.push({ name: "店頭頭金", pt: d.atamaPoint });
    if (d.pointIkkatsu > 0) a.push({ name: "機種代金（一括）", pt: d.pointIkkatsu });
    if (d.pointSplit > 0) a.push({ name: d.kaedoki ? "23回分の分割支払金" : "分割支払金", pt: d.pointSplit });
    if (d.pointZanka > 0) a.push({ name: "残価", pt: d.pointZanka });
    return a;
  }
  function pointUseText(d) {
    return pointUseParts(d).map(function (x) {
      return x.name + "へ " + x.pt.toLocaleString("ja-JP") + "pt";
    }).join("／");
  }
  /* dポイントを充当した結果を、入力欄の下に出す。
   * 入れた分をどこから引いたのか、余りがあるのかが分かるようにするため。 */
  function renderPointUse(r) {
    var els = [$("usePointHint"), $("devUsePointHint")].filter(Boolean);
    if (!els.length) return;
    var d = (r || calcFor(state)).device;
    if (!state.usePoint || !d.pointUse) {
      els.forEach(function (e) { e.hidden = true; });
      return;
    }
    var inner = pointUseText(d);
    var t = inner
      ? d.pointUse.toLocaleString("ja-JP") + "pt のうち <strong>" + inner + "</strong> を充当しました"
      : "充当できるお支払いがありません";
    if (d.pointLeft > 0) {
      t += "。残り " + d.pointLeft.toLocaleString("ja-JP")
        + "pt は<strong>充当先がないため反映していません</strong>（レジでのご案内になります）。";
    } else {
      t += "。";
    }
    els.forEach(function (e) { e.innerHTML = t; e.hidden = false; });
  }
  // 機種名・機種代金が入っているのに見積もりへ反映されないケースを検出する
  // 値引きを入れたときに、いくらになったのかを入力欄の下に出す
  function renderDeviceOff(r) {
    var el = $("deviceOffHint");
    if (!el) return;
    if (!r || !r.device.offTotal) { el.hidden = true; return; }
    var parts = [];
    if (r.device.offCoupon > 0) parts.push("クーポン " + yen(r.device.offCoupon));
    if (r.device.offTebiki > 0) parts.push("店舗独自キャンペーン " + yen(r.device.offTebiki));
    if (r.device.offDirect > 0) parts.push("ダイレクト割 " + yen(r.device.offDirect));
    var msg = "端末代金 " + yen(r.device.list) + " − 値引き " + yen(r.device.offTotal)
      + (parts.length > 1 ? "（" + parts.join("＋") + "）" : "")
      + " = <strong>" + yen(r.device.total) + "</strong>";
    if (r.device.atamaOff > 0) {
      msg += "　クーポン・店舗独自キャンペーンはまず頭金から引きます（頭金 " + yen(r.device.atamaList)
        + " → <strong>" + yen(r.device.atama) + "</strong>）。";
    } else {
      msg += "　クーポン・店舗独自キャンペーンは 頭金 → 分割 → 残価 の順に引きます。";
    }
    if (r.device.offDirect > 0) {
      msg += "<strong>ダイレクト割は頭金からは引かず、分割金から引きます。</strong>";
    }
    el.innerHTML = msg;
    el.hidden = false;
  }
  function deviceInputWarning() {
    var p = num(state.devicePrice);
    if (state.payMethod === "none" && (p > 0 || state.deviceName)) {
      return "機種" + (state.deviceName ? "「" + state.deviceName + "」" : "")
        + (p > 0 ? "（" + yen(p) + "）" : "") + "が入力されていますが、支払い方法が「端末購入なし」のため"
        + "機種代金が見積もりに含まれていません。支払い方法（分割・カエドキ・一括）を選択してください。";
    }
    if (state.payMethod === "kaedoki" && p > 0) {
      var t = num(state.kaedoki23);
      if (t <= 0) {
        return "支払い方法がカエドキですが「23回分の総額（頭金込み）」が未入力です。"
          + "未入力のままだと端末代金の全額が残価になり、頭金も二重に数えられて、正しい見積もりになりません。";
      }
      if (t > p) {
        return "23回分の総額（" + yen(t) + "）が端末代金総額（" + yen(p) + "）を超えています。"
          + "23回分の総額は、端末代金総額のうち残価を除いた金額（頭金込み）を入力してください。";
      }
      if (t > 0 && t < Math.max(0, num(state.atamakin))) {
        return "23回分の総額（" + yen(t) + "）が店頭頭金（" + yen(num(state.atamakin)) + "）を下回っています。"
          + "23回分の総額には頭金を含めた金額を入力してください。";
      }
    }
    // 値引きの引き先が無い（頭金が大きい×ダイレクト割が大きい等）
    var dvOff = calcFor(state).device;
    if (dvOff.offLeft > 0) {
      return "値引きのうち " + yen(dvOff.offLeft) + " が分割金・残価から引ききれていません。"
        + "このままだと「値引き後の端末代金」と実際のお支払い合計が合いません。"
        + "ダイレクト割は頭金からは引かないため、頭金を減らすか、値引きの配分をご確認ください。";
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

  /* ---------- 現在のお支払い（請求内訳の読み取り） ----------
   * お客様の請求書・My docomo の「ご利用料金の内訳」の文字を貼り付けると
   * （iPadなら入力欄の「テキストをスキャン」でカメラから直接入れられる）、
   * 行ごとの項目と金額に起こして、いまのお支払いとこの見積もりを比べられる。
   * 読み取りはこの端末の中だけで完結し、外部への送信はない。
   * 電話番号・お客様番号など、金額でない番号の行は読み取り結果に残さない。
   * 読み取った内容（state.curBill）はお客様名と同じく端末内のみ（同期しない）。 */

  // 全角の英数・記号を半角にそろえ、マイナスの表記ゆれを「-」に寄せる
  function normBillLine(s) {
    return String(s || "")
      .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, " ")
      .replace(/[，]/g, ",")
      .replace(/[￥]/g, "¥")
      .replace(/[−‒–—―▲△]/g, "-")
      /* OCRの読み癖を直す: 金額の桁区切りカンマは「.」に誤認されやすい
       * （円の金額に小数は無いので、数字+ピリオド+3桁は桁区切りとみなす）。
       * 「5, 078」のように区切りの後に空白が入るのも同じくつなぐ */
      .replace(/(\d)[.]\s?(\d{3})(?!\d)/g, "$1,$2")
      .replace(/(\d),\s+(\d{3})(?!\d)/g, "$1,$2")
      .replace(/\s+/g, " ")
      .trim();
  }
  /* 個人情報や案内の行か（読み取り結果に残してはいけない行）。
   * 請求書には電話番号・お客様番号・振込用のバーコードなどが載っている。 */
  function billLinePrivate(s) {
    if (/電話番号|お客様番号|お問い合わせ|お問合せ|フリーダイヤル|受付時間|口座|振替|支払期限|お支払い期限|送付先|ご請求先|郵便|〒|住所/.test(s)) return true;
    if (/様\s*$|御中\s*$/.test(s)) return true;
    if (/0120[-\s]?\d/.test(s)) return true;
    /* 市外局番形式の電話番号（例 090-0123-4567 / 06-1234-5678）。
     * スキャンではハイフンが「.」「・」に化けることがあるので、区切りに含める */
    if (/(^|[^0-9])0\d{1,4}[-()\s.・･]\d{1,4}[-()\s.・･]\d{3,4}([^0-9]|$)/.test(s)) return true;
    // 長い番号の並び（バーコード・お客様番号など。金額はカンマ区切りでもここまで長くない）
    if (/\d{10,}/.test(s.replace(/[-,\s.・･]/g, ""))) return true;
    // 宛先の住所行（都道府県名から始まる行。番地の数字を金額と読み違えないよう除く）
    if (/^(北海道|東京都|京都府|大阪府)/.test(s) || /^[一-龠々]{2,3}県/.test(s)) return true;
    return false;
  }
  // 表の見出しや案内など、金額の行として拾わない行か
  function billLineNoise(s) {
    return /^(内訳項目|内訳金額|金額\(?円\)?|請求内訳等詳細|税区分|ご利用料金の内訳|ご請求内訳|ご利用期間|ご利用月|前月|ポイント残高|請求書|ご請求のご案内)/.test(s);
  }
  /* 請求内訳の文字起こしを {lines:[{n,a}], total, month, dropped} にする。
   * ・「◇」付きや「（計）」付きはカテゴリの小計行。紙の請求書は小計と明細の両方が
   *   載っているため、明細の行があるときは小計を捨てて二重計上を防ぐ。
   *   My docomo で内訳を開かずに写した場合など、小計しか無いときは小計を使う
   * ・「合計」「ご請求金額」は行にせず total に入れる（行の合計との突き合わせ用）
   * ・スキャンで金額が次の行に割れたときは、直前の項目名とつないで1行にする
   * ※ 全角の英数・記号は normBillLine で半角にそろえてから見るので、
   *   ここの正規表現は半角の「(計)」で書く */
  function parseBillText(text) {
    var out = { lines: [], total: null, month: "", dropped: 0 };
    var subs = [];      // カテゴリ小計行の控え（明細が1行も無いときに使う）
    var pendName = "";  // 金額が次の行へ割れたときのための、直前の項目名
    var pendCat = false;  // 控えた項目名がカテゴリ小計（◇付き）だったか
    String(text || "").split(/\r?\n/).forEach(function (rawLine) {
      var s = normBillLine(rawLine);
      if (!s) return;  // 空行では pendName を保持（スキャンは行が細かく割れるため）
      if (billLinePrivate(s)) { out.dropped++; pendName = ""; return; }
      var mm = s.match(/((?:19|20)\d{2})年\s*(\d{1,2})月/);
      if (mm && /請求/.test(s)) { out.month = mm[1] + "年" + (mm[2] | 0) + "月"; pendName = ""; return; }
      if (billLineNoise(s)) { pendName = ""; return; }
      // 税区分の列（内税・合算など）が末尾に付いてきたら外す
      var body = s.replace(/(内税|外税|合算|非課税|非対象等?)\s*$/, "").trim();
      if (!body) return;
      var isCat = /^[◇◆■□]/.test(body);  // ◇はカテゴリ小計の印（請求書の書式）
      var amt = null, name = "";
      if (/^-?\s*¥?\s*[0-9][0-9,]*\s*円?$/.test(body)) {
        // 金額だけの行 → 直前の項目名とつなぐ（無ければ読み飛ばす）
        if (!pendName) return;
        amt = billAmount(body);
        name = pendName;
        isCat = pendCat;
        pendName = "";
      } else {
        /* 金額は「区切り（空白）のあとの数字で終わる」形だけを拾う。
         * 「U15」「Wi-Fi 6」のような項目名の末尾の数字を金額と読み違えないため */
        var m = body.match(/(^|[\s])(-?)\s*¥?\s*([0-9][0-9,]{0,12})\s*円?$/);
        if (!m) {
          /* 項目名だけの行。次の行に金額が来ることがあるので控えておく。
           * 長い文・句点入りは注釈（「◯回目のご請求です。」など）なので控えない。
           * 「(税込)」のような括弧だけの行は、控えた項目名を消さずに読み飛ばす */
          if (/^\(.*\)$/.test(body)) return;
          pendName = (body.length <= 30 && body.indexOf("。") < 0) ? cleanBillName(body) : "";
          pendCat = isCat;
          return;
        }
        amt = billAmount(m[0]);
        name = cleanBillName(body.slice(0, body.length - m[0].length));
        pendName = "";
      }
      if (amt === null || !name) return;
      if (Math.abs(amt) > 10000000) return;  // 読み間違いの桁あふれは拾わない
      // 「ご請求金額(税込)」「ご利用料金合計」のような合計行の表記ゆれも合計として扱う
      var nameNoParen = name.replace(/\(.*\)$/, "").trim();
      if (/^(合計|合計金額|ご請求金額|ご請求額|請求金額|ご利用料金合計|お支払い合計)$/.test(nameNoParen)) { out.total = amt; return; }
      if (isCat || /\(小?計\)$/.test(name)) {
        subs.push({ n: name.replace(/\(小?計\)$/, "").trim(), a: amt });
        return;
      }
      out.lines.push({ n: name, a: amt });
    });
    if (!out.lines.length && subs.length) out.lines = subs;
    if (!out.lines.length && out.total !== null) out.lines = [{ n: "ご請求金額", a: out.total }];
    return out;
  }
  function billAmount(s) {
    var neg = /-/.test(s);
    var d = String(s).replace(/[^0-9]/g, "");
    if (!d) return null;
    return (neg ? -1 : 1) * parseInt(d, 10);
  }
  function cleanBillName(s) {
    return String(s || "").replace(/^[◇◆■□●○・･*＊\s]+/, "").replace(/[:：\s]+$/, "").trim();
  }
  // 読み取った請求内訳の月額合計（比較に使う数字）。読み取りが無ければ0
  function curBillTotal(st) {
    if (!CUR_BILL_ON) return 0;  // 切のときは比較も見積書の欄もすべて出ない
    var b = st && st.curBill;
    if (!b || !b.lines || !b.lines.length) return 0;
    var t = 0;
    b.lines.forEach(function (ln) { t += num(ln.a); });
    return Math.round(t);
  }
  // 差額の表示（下がる場合は−、上がる場合は+を付ける）
  function billDiffText(diff) {
    return (diff > 0 ? "+" : diff < 0 ? "−" : "±") + yen(Math.abs(diff));
  }
  /* 読み取り結果の一覧（編集できる行）を描く。
   * 入力のたびに描き直すとカーソルが外れるので、文字の入力では描き直さず
   * updateCurBillMeta() で合計の表示だけ更新する（端末マスタ編集表と同じ考え方）。 */
  function renderCurBill() {
    var edit = $("curBillEdit"), clearBtn = $("curBillClearBtn"), open = $("curBillOpenBtn");
    if (!edit) return;
    var b = state.curBill;
    if (clearBtn) clearBtn.hidden = !b;
    if (open) {
      // カメラが使えるときは、貼り付けが「もう一つの入れ方」だと分かる名前にする
      open.textContent = OCR_ON
        ? (b ? "貼り付けで読み取り直す" : "文字の貼り付けで読み取る")
        : (b ? "読み取り直す" : "請求内訳を読み取る");
    }
    if (!b || !b.lines || !b.lines.length) { edit.innerHTML = ""; return; }
    var h = '<table class="curbill-table"><tbody>';
    b.lines.forEach(function (ln, i) {
      h += '<tr><td><input type="text" value="' + esc(ln.n) + '" data-cb-n="' + i + '" placeholder="項目名"></td>'
        + '<td class="cb-amt"><input type="number" inputmode="numeric" value="' + num(ln.a) + '" data-cb-a="' + i + '"> 円</td>'
        + '<td class="cb-x"><button type="button" data-cb-del="' + i + '" title="この行を消す" aria-label="この行を消す">×</button></td></tr>';
    });
    h += "</tbody></table>";
    h += '<div class="actions"><button class="btn-sub" type="button" data-cb-add="1">行を足す</button>';
    var instIdx = -1;
    b.lines.forEach(function (ln, i) { if (instIdx < 0 && /分割支払金|分割払金/.test(String(ln.n))) instIdx = i; });
    if (instIdx >= 0) {
      h += '<button class="btn-sub" type="button" data-cb-toinst="' + instIdx + '">' + remapCircled("この分割金を⑤の「現在の分割支払金」へ") + "</button>";
    }
    h += "</div>";
    h += '<p class="hint" id="cbSumLine"></p>';
    h += '<div class="cb-compare" id="cbCompare">現在のお支払い <b id="cbCmpNow"></b> → この見積もり <b id="cbCmpNew"></b>（毎月の差額 <b id="cbCmpDiff"></b>）</div>';
    edit.innerHTML = h;
    updateCurBillMeta();
  }
  function updateCurBillMeta() {
    var el = $("cbSumLine"), b = state.curBill;
    if (!el || !b) return;
    var t = curBillTotal(state);
    var h = (b.month ? esc(b.month) + "分・" : "") + "行の合計: <b>" + yen(t) + "/月</b>";
    if (b.total !== null && b.total !== undefined && Math.round(num(b.total)) !== t) {
      h += '<span class="cb-warn">　⚠ 読み取った「合計」（' + yen(num(b.total))
        + "）と一致していません。行の消し忘れ・読み落としがないかご確認ください。</span>";
    }
    el.innerHTML = h;
    el.hidden = false;
  }
  /* ---------- カメラ読み取り（アプリ内OCR） ----------
   * 同梱の tesseract.js（keitai-app/ocr/・Apache-2.0）で、撮った写真を
   * この端末の中だけで文字にする。写真はどこにも保存せず、解析が終わると捨てる
   * （カメラはOSの撮影画面を使うが、この方式では写真アプリにも残らない）。
   * 部品（約6.5MB）は初回だけ読み込む。SWが控えるので2回目からはオフラインでも動く。 */
  var OCR_BASE = (INTERNAL ? "keitai-app/" : "") + "ocr/";
  var ocrScriptLoading = null;
  function ocrLoadScript() {
    if (window.Tesseract) return Promise.resolve();
    if (ocrScriptLoading) return ocrScriptLoading;
    ocrScriptLoading = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = OCR_BASE + "tesseract.min.js";
      s.onload = function () { res(); };
      s.onerror = function () {
        ocrScriptLoading = null;
        s.parentNode && s.parentNode.removeChild(s);
        rej(new Error("ocr-load"));
      };
      document.head.appendChild(s);
    });
    return ocrScriptLoading;
  }
  function ocrRecognize(canvas, onProgress) {
    // Worker の中では相対パスの起点が変わるため、絶対URLにして渡す
    var abs = new URL(OCR_BASE, location.href).href.replace(/\/$/, "");
    var worker = null;
    return ocrLoadScript().then(function () {
      return Tesseract.createWorker("jpn", 1, {
        workerPath: abs + "/worker.min.js",
        corePath: abs,
        langPath: abs,
        gzip: false,
        logger: function (m) {
          if (m && m.status === "recognizing text" && onProgress) {
            onProgress(Math.round((m.progress || 0) * 100));
          }
        }
      });
    }).then(function (w) {
      worker = w;
      // 請求内訳は1かたまりの表として読む（レシート類の定石。行がばらけにくい）
      return worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    }).then(function () {
      return worker.recognize(canvas);
    }).then(function (r) {
      var text = (r && r.data && r.data.text) || "";
      worker.terminate().catch(function () {});
      return text;
    }, function (err) {
      if (worker) worker.terminate().catch(function () {});
      throw err;
    });
  }
  /* 撮った写真をOCR向けの大きさ（長辺2200px）のcanvasにする。
   * 写真のファイルはここで使い終わり、どこにも保存しない */
  function ocrPrepImage(file, cb) {
    function toCanvas(img, w, h) {
      var max = 2200, scale = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas");
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      cb(c, "");
    }
    if (window.createImageBitmap) {
      // 撮影の向き（EXIF）を正しく反映してくれる読み方
      createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
        toCanvas(bmp, bmp.width, bmp.height);
        bmp.close && bmp.close();
      }, function () { legacy(); });
    } else { legacy(); }
    function legacy() {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () { toCanvas(img, img.naturalWidth, img.naturalHeight); };
        img.onerror = function () { cb(null, "写真を読み込めませんでした。"); };
        img.src = String(fr.result || "");
      };
      fr.onerror = function () { cb(null, "写真を読み込めませんでした。"); };
      fr.readAsDataURL(file);
    }
  }

  function initCurBill() {
    if (!CUR_BILL_ON) {
      var card = $("curBillCard");
      if (card) card.hidden = true;
      return;
    }
    var openBtn = $("curBillOpenBtn"), clearBtn = $("curBillClearBtn"),
        wrap = $("curBillWrap"), box = $("curBillBox"),
        go = $("curBillGo"), cancel = $("curBillCancel"),
        msg = $("curBillMsg"), edit = $("curBillEdit"),
        cam = $("curBillCam");
    if (!openBtn) return;
    var ocrBusy = false;
    /* カメラ読み取りの入・切（OCR_ON）で、カメラのボタンとカメラ向けの文を出し分ける。
     * 切のときは OCR の部品を一切読み込まない（通信もしない） */
    ["curBillCamWrap", "curBillCamHint", "curBillCamNote", "curBillPasteLead"].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = !OCR_ON;
    });
    function say(t, err) {
      msg.textContent = t;
      msg.hidden = false;
      msg.style.color = err ? "#C62828" : "";
    }
    // 文字起こしを行リストに取り込む（カメラ・貼り付け共通の受け口）
    function takeBillText(text, fromCam) {
      var r = parseBillText(text);
      if (!r.lines.length) {
        say(fromCam
          ? "金額の行を読み取れませんでした。請求内訳の「項目名と金額」の部分がはっきり写るように、明るい場所でまっすぐ撮り直してください。"
          : "金額の行を読み取れませんでした。請求内訳の「項目名と金額」が写るように読み取ってください。", true);
        return;
      }
      state.curBill = { lines: r.lines, total: r.total, month: r.month, gen: store.gen | 0 };
      wrap.hidden = true;
      box.value = "";
      say(r.lines.length + "行を読み取りました。"
        + (r.dropped ? "電話番号などの行は自動で除いています。" : "")
        + "内容を確かめて、違う行は直すか「×」で消してください。"
        + (fromCam ? "写真は保存していません。" : ""));
      renderCurBill();
      recalc();
    }
    if (cam && OCR_ON) {
      cam.addEventListener("change", function () {
        var f = this.files && this.files[0];
        this.value = "";
        if (!f || ocrBusy) return;
        ocrBusy = true;
        say("写真をこの端末の中で読み取っています…");
        ocrPrepImage(f, function (canvas, err) {
          if (!canvas) { ocrBusy = false; say(err, true); return; }
          ocrRecognize(canvas, function (pct) {
            say("写真をこの端末の中で読み取っています… " + pct + "%");
          }).then(function (text) {
            ocrBusy = false;
            takeBillText(text, true);
          }, function () {
            ocrBusy = false;
            say("読み取れませんでした。初めて使うときはネットワークが必要です"
              + "（読み取りの部品 約6.5MB を一度だけ読み込みます。以後はオフラインでも動きます）。"
              + "接続を確かめて、もう一度お試しください。", true);
          });
        });
      });
    }
    openBtn.addEventListener("click", function () {
      wrap.hidden = !wrap.hidden;
      msg.hidden = true;
      if (!wrap.hidden) box.focus();
    });
    cancel.addEventListener("click", function () { wrap.hidden = true; box.value = ""; });
    go.addEventListener("click", function () { takeBillText(box.value, false); });
    clearBtn.addEventListener("click", function () {
      if (!window.confirm("読み取った請求内訳を消します。よろしいですか？")) return;
      state.curBill = null;
      msg.hidden = true;
      renderCurBill();
      recalc();
    });
    edit.addEventListener("input", function (e) {
      var t = e.target, b = state.curBill, i;
      if (!b || !t) return;
      if (t.hasAttribute("data-cb-n")) {
        i = t.getAttribute("data-cb-n") | 0;
        if (b.lines[i]) b.lines[i].n = t.value;
      } else if (t.hasAttribute("data-cb-a")) {
        i = t.getAttribute("data-cb-a") | 0;
        if (b.lines[i]) b.lines[i].a = num(t.value);
      } else return;
      updateCurBillMeta();
      recalc();  // 保存とサマリー・見積書の更新（行は描き直さない）
    });
    edit.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t || !state.curBill) return;
      if (t.hasAttribute("data-cb-del")) {
        state.curBill.lines.splice(t.getAttribute("data-cb-del") | 0, 1);
        if (!state.curBill.lines.length) { state.curBill = null; msg.hidden = true; }
        renderCurBill();
        recalc();
      } else if (t.hasAttribute("data-cb-add")) {
        state.curBill.lines.push({ n: "", a: 0 });
        renderCurBill();
        recalc();
        var ins = edit.querySelectorAll("input[data-cb-n]");
        if (ins.length) ins[ins.length - 1].focus();
      } else if (t.hasAttribute("data-cb-toinst")) {
        var ln = state.curBill.lines[t.getAttribute("data-cb-toinst") | 0];
        if (!ln) return;
        state.currentInst = Math.max(0, Math.round(num(ln.a)));
        syncFormFromState();
        recalc();
        say(remapCircled("⑤端末代金の「現在の分割支払金」に " + yen(state.currentInst) + " を入れました。残り回数がわかれば⑤で入力してください。"));
      }
    });
  }

  /* ---------- サマリーバー ---------- */
  function renderSummary(r) {
    var seg0 = r.segs[0];
    var lbl = segLabel(seg0);
    $("sumMonthlyLabel").textContent = "月額" + (lbl ? "（" + lbl + "）" : "") + "｜" + PAT_NAMES[store.active];
    $("sumMonthly").textContent = yen(seg0.monthly);
    $("sumInitial").textContent = yen(r.initialTotal);

    // 請求内訳を読み取っているときは「現在のお支払い」を並べて出す
    var cbT = curBillTotal(state);
    var cbw = $("sumCurBillWrap");
    if (cbw) {
      cbw.hidden = !(cbT > 0);
      if (cbT > 0) $("sumCurBill").textContent = yen(cbT);
    }
    var cbCmp = $("cbCompare");
    if (cbCmp) {
      // 行の編集で合計が0円以下になったときは、古い比較を出したままにしない
      cbCmp.hidden = !(cbT > 0);
      if (cbT > 0) {
        $("cbCmpNow").textContent = yen(cbT);
        $("cbCmpNew").textContent = yen(seg0.monthly) + (lbl ? "（" + lbl + "）" : "");
        $("cbCmpDiff").textContent = billDiffText(seg0.monthly - cbT);
      }
    }

    var k2 = $("kaedoki23Hint");
    if (state.payMethod === "kaedoki") {
      k2.hidden = false;
      // ポイントを充当したときは、充当後の金額で読めるように添える
      var ptK2 = r.device.atamaPoint + r.device.pointSplit + r.device.pointZanka;
      k2.textContent = "端末代金総額 " + yen(r.device.total || 0)
        + (ptK2 > 0
          ? "（dポイント " + ptK2.toLocaleString("ja-JP") + "pt 充当後 "
            + yen(Math.max(0, (r.device.total || 0) - ptK2)) + "）"
          : "")
        + " のうち、はじめの23回で "
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
    // 爆アゲ: 対象サービスを選んでいるときだけ出す
    var bakuOn = (r.bakuageRows || []).length > 0 || num(state.pointBakuage) > 0;
    /* 充当しないときは、個別の「見積もりに含める」は効かない（何も引かないため）。
     * 出しておくと誤解を生むので隠す。 */
    var applyOn = state.pointApply === true;
    // もらえるポイントの合計と、それを使った場合の実質月額
    var psum = $("pointSummary");
    if (psum) {
      var ptt = r.pointTotal || 0;
      psum.hidden = ptt <= 0;
      if (ptt > 0) {
        var m0 = r.segs[0].monthly;
        psum.innerHTML = r.pointApply
          ? "毎月もらえるポイント <b>" + ptt.toLocaleString("ja-JP") + "pt</b> を差し引いた金額でご案内しています（月額 " + yen(m0) + "）。"
          : "毎月もらえるポイント <b>" + ptt.toLocaleString("ja-JP") + "pt</b>。月額 " + yen(m0)
            + " から差し引くと <b>実質 " + yen(Math.max(0, m0 - ptt)) + "/月</b> になります。";
      }
    }
    $("ptBakuageWrap").hidden = !bakuOn;
    $("bakuageHint").hidden = !bakuOn;
    if (bakuOn) {
      $("bakuageHint").innerHTML = "内訳: "
        + (r.bakuageRows || []).map(function (x) {
            return esc(x.name) + " " + esc(x.rate)
              + (x.exTax ? "（税抜 " + x.exTax.toLocaleString("ja-JP") + "円 → " + x.pt.toLocaleString("ja-JP") + "pt）"
                         : "（" + x.pt.toLocaleString("ja-JP") + "pt）");
          }).join("／")
        + "　" + (r.bakuageTier === "max" ? "率はドコモ MAX／ポイ活 MAX のもの"
            : r.bakuageTier ? "率はポイ活20・ahamo・eximo・ギガホのもの" : "")
        + "です。還元率はマスタ設定のオプション欄で変更できます。";
    }
    // 対象外のプランを選んでいるときは、その旨を出す
    var bakuOff = $("bakuageOff");
    if (bakuOff) {
      var offNow = hasPlan() && !r.bakuageTier;
      bakuOff.hidden = !offNow;
      if (offNow) bakuOff.textContent = currentPlan().name + " は爆アゲ セレクションの対象プランではありません（固定ポイントのものだけ加算されます）。";
    }
    $("bakuageReset").hidden = !bakuOn || num(state.pointBakuage) === (r.bakuageAutoPt || 0);
    $("bakuageIncludeWrap").hidden = !bakuOn || !applyOn;
    if (bakuOn) {
      $("bakuageInclude").checked = state.bakuageInclude !== false;
      $("bakuageIncludeLabel").textContent = "爆アゲ セレクションの還元を見積もりに含める"
        + (state.bakuageInclude === false
          ? "（いまは含めていません。もらえるポイントは " + num(state.pointBakuage).toLocaleString("ja-JP") + "pt/月）"
          : "（月額から " + num(state.pointBakuage).toLocaleString("ja-JP") + "円ぶん差し引いて案内します）");
    }
    // 手入力の値が残っているあいだは、GOLD系でなくてもチェックを見せる（消すと外せなくなる）
    var dcShow = goldOn || num(state.pointDcard) > 0;
    $("dcardAutoWrap").hidden = !dcShow || !applyOn;
    $("dcardAutoHint").hidden = !goldOn;
    $("dcardAutoReset").hidden = !goldOn || num(state.pointDcard) === (r.dcardAutoPt || 0);
    if (dcShow) {
      $("dcardAutoInclude").checked = state.dcardGoldAuto !== false;
      $("dcardAutoLabel").textContent = "dカード還元特典を見積もりに含める"
        + (!goldOn
          ? "（手入力 " + num(state.pointDcard).toLocaleString("ja-JP") + "pt/月）"
          : r.plan && r.plan.dcard10 === false
            ? "（" + r.plan.name + "は利用料金還元の対象外プランのため自動計算0pt）"
            : state.dcardGoldAuto === false
              ? "（いまは含めていません。もらえるポイントは " + (r.dcardAutoPt || 0) + "pt/月）"
              : "（自動計算: " + (r.dcardAutoPt || 0) + "pt/月・還元" + (dcardRatePt(state.dCard) / 10) + "%・対象額" + yen(r.dcardGoldBase || 0) + "）");
    }
  }

  // ガスの割引オプション欄を料金メニューに合わせて描き直す
  /* 現在の会社のチェックと、選んだ会社の連絡先 */
  function renderEnergyNow() {
    ["denki", "gas"].forEach(function (kind) {
      var wrap = $(kind === "gas" ? "gasNowWrap" : "denkiNowWrap");
      if (!wrap) return;
      var list = energyList(kind);
      var on = kind === "gas" ? state.todoGas : state.todoDenki;
      if (!on || !energyTypePicked(kind) || !list.length) {
        wrap.hidden = true; wrap.innerHTML = ""; return;
      }
      wrap.hidden = false;
      var cur = kind === "gas" ? state.todoGasNow : state.todoDenkiNow;
      var h = '<span class="sub-label">' + (kind === "gas" ? "ガス" : "でんき") + "の現在の会社</span>";
      h += list.map(function (c) {
        return '<label class="check"><input type="checkbox" data-energynow="' + kind + ":" + esc(c.id) + '"'
          + (cur === c.id ? " checked" : "") + "> " + esc(c.name) + "</label>";
      }).join("");
      var picked = energyPicked(kind);
      if (picked) {
        h += '<span class="sub-note energy-tel">' + esc(picked.name) + " の連絡先: "
          + (picked.tel
              ? '<b>' + esc(picked.tel) + "</b>"
              : '<span class="tel-none">未登録（マスタ設定で登録してください）</span>')
          + "</span>";
      }
      wrap.innerHTML = h;
    });
  }
  /* ガスの区分（スタンダード／エコジョーズ）。
   * 対象の料金メニューを選んだときだけ出す。 */
  function renderGasEco() {
    var wrap = $("gasEcoWrap");
    if (!wrap) return;
    if (!state.todoGas || !gasEcoNeeded()) { wrap.hidden = true; wrap.innerHTML = ""; return; }
    wrap.hidden = false;
    var h = '<span class="sub-label">' + esc(GAS_TYPE[state.todoGasType]) + "の区分</span>";
    ["std", "eco"].forEach(function (k) {
      h += '<label class="check"><input type="checkbox" data-gaseco="' + k + '"'
        + (state.todoGasEco === k ? " checked" : "") + "> " + GAS_ECO_LABEL[k] + "</label>";
    });
    h += '<span class="sub-note' + (state.todoGasEco ? " gas-eco-note" : "") + '">'
      + (state.todoGasEco
        ? (state.todoGasEco === "eco"
          ? "高効率給湯器「エコジョーズ」をお使いのお客さま向けの単位料金です。"
          : "「エコジョーズ」以外のお客さま向けの単位料金です。")
        : "エコジョーズの有無で単位料金が変わります。どちらかを選んでください。")
      + "</span>";
    wrap.innerHTML = h;
  }
  function renderGasDiscounts() {
    var wrap = $("gasDiscountWrap");
    var list = gasDiscountList();
    if (!state.todoGas || !list.length) { wrap.hidden = true; wrap.innerHTML = ""; return; }
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
    // ドコモ光か（ahamo光・home 5G は別の扱いになる）
    function isDocomoHikari(ie) {
      return ie.product === "hikari1g" || ie.product === "hikari10g";
    }
    /* 無線ルーターの申し込み先。プロバイダごとに違う。 */
    var ROUTER_QR = {
      "OCN インターネット": "router1gOcn",
      "@nifty": "router1gNifty",
      "andline": "router1gAndline"
    };
    // 10ギガはレンタルが無く、ルーターを買っていただく
    var ROUTER10G_QR = {
      "OCN インターネット": "router10gOcn",
      "@nifty": "router10gNifty"
    };
    /* 手続きに要るページのQR。登録スタッフがその場で読み取れるよう、
     * 引き継ぎシートに置く。図形は qr.js に持っているので、
     * 店頭がオフラインでも印刷でも出る。画面上はそのまま押しても開ける。
     *
     * 出す条件
     *   toss         … ドコモ光のとき（工事日を確定させるのに毎回入力が要る）
     *                    ahamo光は取り扱いが違うため出さない
     *   router1g:*   … 1ギガ・ルーターレンタルありのとき、プロバイダごとの申し込みページ
     *   niftyFollow  … ドコモ光×@niftyのとき（フォローコールを光と同時に申込できる）
     *   router10g:*  … ドコモ光10ギガでルーターを買っていただくとき（プロバイダごと）
     *
     * GMOとくとくBBは、IDとパスワードが届いてからお客様ご自身でお申し込みいただく
     * ため、QRは出さずに引き継ぎシートへその旨を出す（ROUTER_QR に入れない）。 */
    function qrRowHtml(ieOn) {
      if (typeof KEITAI_QR === "undefined") return "";
      var ie = store.ienaka || {};
      var keys = [];
      /* 「光・5G」の入力がまだ無いときは、どの商材か分からないので出しておく
       * （手続き内容で光にチェックがあるとき）。 */
      if (ieOn ? isDocomoHikari(ie) : state.todoHikari) keys.push("toss");
      if (ieOn) {
        if (ie.product === "hikari1g" && KQ_IENAKA.routerRental() === "ari"
          && ROUTER_QR[ie.provider]) {
          keys.push(ROUTER_QR[ie.provider]);
        }
        /* @niftyはフォローコール（開通までの電話サポート）の申込が
         * 光の申込と同時にできるため、プロバイダが@niftyなら常に出す */
        if (isDocomoHikari(ie) && ie.provider === "@nifty") keys.push("niftyFollow");
        // ahamo光はプロバイダ一体型で、ルーターの優待購入の取り扱いが無い
        if (ie.product === "hikari10g" && ie.router10g && num(ie.router10gPrice) > 0
          && ROUTER10G_QR[ie.provider]) {
          keys.push(ROUTER10G_QR[ie.provider]);
        }
        /* スカパーが絡む受付では、申込フォームのQRを出す。
         * 絡む＝スカパー工事のテレビオプション（新規のみ工事が発生）か、
         * 映像サービスでスカパー系の内訳を選んでいるとき。 */
        var opts = ie.opts || {};
        var skySvc = !!(opts.skyp && (opts.vsSkyBase || opts.vsSkyBasic || opts.vsSelect5 || opts.vsSelect10));
        var skyKoji = !!(opts.tv && ie.product !== "home5g" && ie.applyType === "shinki"
          && (ie.tvKoji || "sky").indexOf("sky") === 0);
        if (skySvc || skyKoji) keys.push("skyperForm");
      }
      var cards = keys.map(function (k) {
        var q = KEITAI_QR[k];
        if (!q) return "";
        return '<span style="display:inline-block;vertical-align:top;text-align:center;margin-right:12px">'
          + '<a href="' + esc(q.url) + '" target="_blank" rel="noopener"'
          + ' style="width:28mm;height:28mm;display:block;border:1px solid var(--line)">'
          + q.svg + "</a>"
          + '<span style="display:block;width:28mm;margin-top:2px;font-size:.8em;line-height:1.25">'
          + esc(q.label) + "</span></span>";
      }).join("");
      return cards ? row("QR（スマホで読み取り）", cards) : "";
    }

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
    var vkS = visitKeys(store.patterns[0] || state);   // 目的は回線1に持つ
    if (vkS.length) {
      anyTodo = true;
      var buyS = vkS.indexOf("buy") >= 0;
      h += row("ご来店の目的", "<b>" + esc(vkS.map(function (k) { return VISIT_NAMES[k]; }).join("　／　")) + "</b>"
        + (buyS && state.kaimashi ? "　<b>買い増しあり</b>" : "")
        + (!buyS && (state.procTodo || {}).kishu ? "　<b>買い増し（機種変更）</b>" : ""));
    }
    if (procs.length) { anyTodo = true; h += row("手続き", "<b>" + procs.join("　／　") + "</b>"); }
    var apps = [];
    if (state.todoDcard) {
      apps.push("dカード申し込み" + (state.todoDcardType ? "（" + DCARD_TYPE[state.todoDcardType] + "）" : ""));
    }
    /* でんき・ガスの中身（料金メニュー・割引オプション・現在の会社）は、
     * 下の「ドコモでんき・ドコモガス」の欄にまとめて出す。
     * ここでは何を同時に申し込むかだけを並べる。 */
    if (state.todoDenki) apps.push("でんき申し込み");
    if (state.todoGas) apps.push("ガス申し込み");
    if (state.todoHikari) apps.push("光申し込み");
    if (apps.length) { anyTodo = true; h += row("同時申し込み", "<b>" + apps.join("　／　") + "</b>"); }
    /* データ移行にあたる初期費用。あんしん店頭サポートのように名前に
     * 「データ移行」が入らないものもあるため、マスタ設定の印で判定する。 */
    var dataMove = (MASTER.feeItems || []).filter(function (f) {
      return state.feeItems[f.id] && f.dataMove;
    });
    anyTodo = true;
    h += row("データ移行", dataMove.length
      ? '<b style="color:var(--red)">あり</b>　' + dataMove.map(function (f) {
          // 登録スタッフが金額を取り違えないよう、無料か有料かを添える
          var pr = num(f.price);
          var tag = pr === 0
            ? (String(f.name || "").indexOf("無料") < 0 ? "（無料）" : "")
            : "（" + yen(pr) + "・" + FEE_PAYS[feeItemPayOf(state, f)] + "）";
          return esc(f.name) + tag;
        }).join("／")
      : "<b>なし</b>");
    var mnpBene = mnpSimOnly(state) ? mnpBenefitText(state) : "";
    if (mnpBene) {
      anyTodo = true;
      h += row("MNP特典（SIMのみ）", "<b>" + esc(mnpBene) + "</b>");
    }
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
    /* ドコモメールは②のプルダウンで選ぶが、中身はほかのオプションと同じ
     * state.options に入っている。ここを state.mailOpt（どこにも入らない値）で
     * 見ていたため、付けても必ず「無し」になっていた（1.89.3〜1.107.1）。 */
    var mailDefSheet = mailOptDef();
    var mailKbSheet = mailDefSheet
      ? (state.optionKubun[mailDefSheet.id] || (state.options[mailDefSheet.id] ? "new" : ""))
      : "";
    h += row("ドコモメール", !mailPaidPlan()
      ? "プランに標準で込み"
      : mailKbSheet === "off"
        ? '<b style="color:var(--red)">廃止</b>'
        : mailKbSheet
          ? (mailKbSheet === "keep" ? "継続" : "<b>新規</b>") + "　" + yen(optPrice(mailDefSheet, state)) + "/月"
          : "無し");
    h += "</tbody></table>";

    var secContract = h; h = "";
    // オプション（新規／継続／廃止をまとめる）
    var kNew = [], kKeep = [], kOff = [], kExist = [];
    var netSheet = netSvcCalc(state);
    netSheet.rows.forEach(function (n) {
      (n.kubun === "keep" ? kKeep : kNew).push({ name: n.name, price: n.price });
    });
    netSheet.off.forEach(function (n) { kOff.push(n.name); });
    MASTER.options.forEach(function (o) {
      // ドコモメールは上の「ご契約内容」に出しているので、ここでは重ねて出さない
      if (mailDefSheet && o.id === mailDefSheet.id) return;
      var kb = state.optionKubun[o.id] || (state.options[o.id] ? "new" : "");
      if (!kb) return;
      var pr = optPrice(o, state);
      var lb = o.priceLabels && o.priceLabels[String(pr)];
      var nm = o.name + (lb ? "（" + lb + "）" : "");
      if (kb === "off") kOff.push(nm);
      else if (kb === "keep") kKeep.push({ name: nm, price: pr });
      else if (kb === "exist") kExist.push({ name: nm, price: pr });
      else kNew.push({ name: nm, price: pr });
    });
    h += "<h3>オプション</h3><table><tbody>";
    var anyOpt = false;
    /* 廃止と新規が同時にあるときは「付け替え」として矢印でまとめる。
     * 別々の行に分けるより、何を何へ替えるのかが一目で分かる（店舗の指定・2026-08-09）。
     * 例）smartあんしんパック → dバリューパス パック */
    if (kOff.length && kNew.length) {
      anyOpt = true;
      h += row("<b>付け替え</b>", '<div class="kubun-swap">'
        + '<span class="sw-old">' + kOff.map(function (x) { return esc(x); }).join("・") + "</span>"
        + '<span class="sw-arrow">→</span>'
        + '<span class="sw-new">'
        + kNew.map(function (x) { return esc(x.name) + "　" + yen(x.price) + "/月"; }).join("・")
        + "</span></div>");
    } else {
      if (kNew.length) {
        anyOpt = true;
        h += row("<b>新規</b>", '<div class="kubun-list">'
          + kNew.map(function (x) { return "<i>" + esc(x.name) + "　" + yen(x.price) + "/月</i>"; }).join("") + "</div>");
      }
      if (kOff.length) {
        anyOpt = true;
        h += row("<b>廃止</b>", '<div class="kubun-list" style="color:var(--red);font-weight:700">'
          + kOff.map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") + "</div>");
      }
    }
    if (kExist.length) {
      // 既存: もともとご加入のものをドコモ経由へ移す（新規加入とは分けて出す）
      anyOpt = true;
      h += row("<b>既存</b>", '<div class="kubun-list">'
        + kExist.map(function (x) { return "<i>" + esc(x.name) + "　" + yen(x.price) + "/月　※ドコモ経由へ移行</i>"; }).join("") + "</div>");
    }
    if (kKeep.length) {
      anyOpt = true;
      h += row("継続", '<div class="kubun-list">'
        + kKeep.map(function (x) { return "<i>" + esc(x.name) + "　" + yen(x.price) + "/月</i>"; }).join("") + "</div>");
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
    if (num(state.devicePrice) > 0 || state.deviceName || r.device.offTotal > 0
        || r.accMonthlyRows.length || r.accOnceRows.length) {
      h += "<h3>端末・アクセサリ</h3><table><tbody>";
      if (state.deviceName || num(state.devicePrice) > 0 || r.device.offTotal > 0) {
        h += row("機種", "<b>" + esc(state.deviceName || "（機種名未入力）") + "</b>　" + yen(r.device.list));
        if (r.device.offCoupon > 0) h += row("　クーポン値引き", "−" + yen(r.device.offCoupon));
        // 引き継ぎシートは店内の呼び方に合わせる（お客様向けは「店舗独自キャンペーン」）
        if (r.device.offTebiki > 0) h += row("　手値引き", "−" + yen(r.device.offTebiki));
        /* ダイレクト割は「案内したかどうか」が分かるよう、無い場合も行を出す。 */
        h += row("　ダイレクト割", r.device.offDirect > 0
          ? "−" + yen(r.device.offDirect) + "　<b>分割金から差引</b>"
          : '<span style="color:var(--muted)">なし</span>');
        if (r.device.offTotal > 0) h += row("　<b>値引き後の端末代金</b>", "<b>" + yen(r.device.total) + "</b>"
          + (r.device.atamaOff > 0
            ? "　店頭頭金 " + yen(r.device.atamaList) + " → " + yen(r.device.atamaBeforePoint) : ""));
        h += row("お支払い方法", "<b>" + payLabel + "</b>"
          + (r.device.monthly > 0 ? "　" + yen(r.device.monthly) + "/月 × " + r.device.months + "回" : ""));
        /* 残価・実質負担・返却後の金額は、引き継ぎ（登録作業）には要らない（店舗の指定・2026-08-09）。
         * 登録に要るのは、値引きの有無・ダイレクト割・一括か分割かだけ。
         * これらの金額は見積書（お客様向け）には従来どおり出る。 */
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
      var ptInnerS = pointUseText(r.device);
      h += row("dポイント利用", state.usePoint
        ? '<b style="color:var(--red)">あり</b>'
          + (r.device.pointUse > 0 ? "　" + r.device.pointUse.toLocaleString("ja-JP") + "pt" : "")
          + (ptInnerS ? "（" + ptInnerS + " 充当）" : "")
          + (r.device.pointLeft > 0
            ? '<span style="color:var(--red)">　残り ' + r.device.pointLeft.toLocaleString("ja-JP")
              + "pt は見積もり未反映</span>" : "")
        : "なし");
      h += "</tbody></table>";
    }

    var secInit = h; h = "";
    /* 受付メモだけ。ポイントの内訳・月額の目安・ポイント充当のご案内は、
     * 登録作業には使わないため引き継ぎシートには出さない（店舗の指定・2026-08-10）。
     * 金額はお客様向けの見積書で確認する。 */
    if (state.quoteMemo) {
      h += "<h3>受付メモ</h3><table><tbody>";
      h += row("受付メモ", esc(state.quoteMemo));
      h += "</tbody></table>";
    }

    var secPoint = h; h = "";
    /* ドコモでんき・ドコモガス。
     * 後工程がそのまま手続きできるよう、プラン（料金メニュー）・割引オプション・
     * いまご契約中の会社を1か所にまとめる。光の欄のすぐ上に置く。 */
    if (state.todoDenki || state.todoGas) {
      h += "<h3>ドコモでんき・ドコモガス</h3><table><tbody>";
      if (state.todoDenki) {
        h += row("でんき　プラン", state.todoDenkiType
          ? "<b>" + DENKI_TYPE[state.todoDenkiType] + "</b>" : "<b>未選択</b>");
        var dc = energyPicked("denki");
        if (dc) {
          h += row("でんき　現在の会社", "<b>" + esc(dc.name) + "</b>"
            + (dc.tel ? "　連絡先: <b>" + esc(dc.tel) + "</b>" : "　（連絡先は未登録）"));
        }
      }
      if (state.todoGas) {
        // 旧データ（料金メニュー未対応）はエリア名だけを表示する
        var gname = state.todoGasType
          ? (GAS_TYPE[state.todoGasType] ? GAS_AREA + " " + GAS_TYPE[state.todoGasType] : GAS_AREA)
          : "";
        if (gname && state.todoGasEco && gasEcoNeeded()) {
          gname += "・" + GAS_ECO_LABEL[state.todoGasEco];
        }
        h += row("ガス　プラン", gname ? "<b>" + esc(gname) + "</b>" : "<b>未選択</b>");
        var gd2 = gasDiscountPicked();
        if (gd2.length) {
          h += row("ガス　割引オプション", "<b>" + gd2.map(function (d) {
            return esc(d.name) + " " + d.rate + "%";
          }).join("　／　") + "</b>　合計 " + gasDiscountRate() + "%（上限4,400円/月）");
        }
        var gc = energyPicked("gas");
        if (gc) {
          h += row("ガス　現在の会社", "<b>" + esc(gc.name) + "</b>"
            + (gc.tel ? "　連絡先: <b>" + esc(gc.tel) + "</b>" : "　（連絡先は未登録）"));
        }
      }
      h += "</tbody></table>";
    }
    var secEnergy = h; h = "";
    /* 光・home 5G。後工程がそのまま手続きできるよう、申込区分と工事まわりを残す。
     * 世帯で1本なので、パターンを切り替えても同じ内容が出る。 */
    var ieOn = ienakaOn();
    if (ieOn || state.todoHikari) {
      h += "<h3>ドコモ光・home 5G</h3><table><tbody>";
    }
    if (ieOn) {
      var ir = KQ_IENAKA.calc();
      h += row("商材", "<b>" + esc(KQ_IENAKA.label()) + "</b>");
      // 奪還の比較につなげるためのヒアリング記録
      var curH = KQ_IENAKA.curHearing ? KQ_IENAKA.curHearing() : "";
      if (curH) {
        h += row("現在の固定回線（ヒアリング）", esc(curH));
      } else if (KQ_IENAKA.curLine && KQ_IENAKA.curLine()) {
        h += row("現在の回線（ヒアリング）", esc(KQ_IENAKA.curLine()));
      }
      /* 光の月額・初期費用・工事費のお支払いは、登録作業には使わないため出さない
       * （店舗の指定・2026-08-10）。金額はお客様向けの見積書で確認する。 */
      var ieOpts = ir.rows.slice(1).filter(function (x) { return x.amount >= 0; });
      h += row("オプション", ieOpts.length
        ? ieOpts.map(function (x) {
            /* 光電話は、登録作業に要るのは金額ではなく「番号をどうするか」。
             * 新規は番ポの有無、転用・事業者変更は番号がそのまま移ることを出す。 */
            if (/光電話/.test(x.name)) {
              var bp = store.ienaka.applyType === "shinki"
                ? (store.ienaka.denwaBanpo === "mnp" ? "<b>番ポあり</b>" : "新規発番")
                : "番号はそのまま引き継ぎ";
              return esc(x.name) + "（" + bp + "）";
            }
            return esc(x.name) + "（" + yen(x.amount) + "）";
          }).join("　／　")
        : "なし");
      /* プロバイダは、選ばれていないときも行を出す。
       * 選ばないとルーター申込・フォローコールのQRが出ないため、
       * 出ていない理由がその場で分かるようにする（店頭の指摘・2026-08-11）。 */
      if (KQ_IENAKA.isHikari()) {
        h += row("プロバイダ", store.ienaka.provider
          ? esc(store.ienaka.provider) + "（" + (store.ienaka.providerType === "keizoku" ? "継続" : "新規") + "）"
          : '<b style="color:var(--red)">未選択</b>　※ 申込ページのQRは、プロバイダを選ぶと出ます');
      }
      // 無料レンタルでも申し込みの手続きが要るため、あり/なしを必ず出す
      var rr = KQ_IENAKA.routerRental();
      if (rr) {
        var rrText = rr === "ari"
          ? '<b style="color:var(--red)">申込あり</b>　プロバイダの無料無線ルーター'
          : "なし（お客様でご用意）";
        /* GMOとくとくBBは、IDとパスワードが届いてからお客様ご自身での
         * お申し込みになるため、店頭で申し込めないことを書き添える。 */
        if (rr === "ari" && store.ienaka.provider === "GMOとくとくBB") {
          rrText += '<br><b style="color:var(--red)">IDとパスワードが届いてから、お客様でお申し込みいただきます</b>';
        }
        h += row("ルーターレンタル", rrText);
      }
    } else if (state.todoHikari) {
      // 手続き内容で光にチェックはあるが、「光・5G」の入力がまだ無いとき
      h += row("お申し込み", '<b style="color:var(--red)">光申し込み</b>　※「光・5G」の入力はありません');
    }
    if (ieOn || state.todoHikari) {
      h += qrRowHtml(ieOn);
      h += "</tbody></table>";
    }
    var secIenaka = h; h = "";
    // 機種購入があるときは、端末と初期費用（支払方法）を先に読めるよう前へ出す
    var hasDevice = state.payMethod !== "none" && (num(state.devicePrice) > 0 || state.deviceName);
    h = h0 + (hasDevice
      ? secDevice + secInit + secContract + secOpt
      : secContract + secOpt + secDevice + secInit)
      + secPoint + secEnergy + secIenaka;
    h += '<div class="disclaimer">店舗内引き継ぎ用（お客様控えではありません）。アプリ版 ' + APP_VERSION + "</div>";
    $("staffSheetBody").innerHTML = h;
  }

  /* ---------- 見積書描画 ---------- */
  function renderSheet() {
    var r = calc();
    // 光を含める設定のときだけ、見積書に出す内容の切替を見せる
    var scopeWrap = $("sheetScopeWrap");
    if (scopeWrap) {
      scopeWrap.hidden = !ienakaOn();
      if (!ienakaOn()) sheetScope = "phone";
      var rb = scopeWrap.querySelector('input[value="' + sheetScope + '"]');
      if (rb) rb.checked = true;
    }
    // 開通までの流れ（1枚）は、見積書と別の紙としてまるごと差し替える
    if (sheetScope === "flow" && ienakaOn()) {
      $("sheetBody").innerHTML = flowOnlySheet();
      return;
    }
    /* 光のみ（イエナカ単体の見積書）も同じく、まるごと差し替える。
     * 店頭は両面印刷なので、裏面（2ページ目）に「開通までの流れ」を付けて
     * 紙1枚で表＝金額・裏＝段取り、の形で渡せるようにする。 */
    if (sheetScope === "ienaka" && ienakaOn()) {
      $("sheetBody").innerHTML = ienakaOnlySheet(r.dSet || 0)
        + '<div class="sheet-page2">'
        + '<div class="page2-note no-print">――― 印刷時はここから2ページ目（裏面・開通までの流れ） ―――</div>'
        + flowOnlySheet() + "</div>";
      return;
    }
    var today = new Date();
    var dateStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    var procLabel = procName(state.procType);
    var seg0 = r.segs[0], segLast = r.segs[r.segs.length - 1];

    var h = "";
    h += '<h2 class="sheet-title">お見積書</h2>';
    h += '<div class="sheet-meta"><span>作成日: ' + dateStr + "</span><span></span></div>";
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
      /* カエドキは「返却しない場合」を月額として並べる。
       * 返却した場合の推移は出さない（行が増えて読みにくく、返却時の金額は
       * 上の月額ボックスと端末代金の明細で分かるため・店舗の指定・2026-08-14）。 */
      h += "<tr><td>月額" + (r.device.kaedoki ? "（返却しない場合）" : "") + "</td>"
        + r.segs.map(function (sg) { return '<td class="trans-amt">' + yen(sg.monthlyKeep != null ? sg.monthlyKeep : sg.monthly) + "</td>"; }).join("") + "</tr>";
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
      h += row(svcName(r.plan.name, "pl:" + r.plan.id) + "（" + esc(r.tier.label) + "）"
        + (bonus.length ? "（" + bonus.map(function (x) { return esc(x.base); }).join("・") + "）" : ""),
        yen(r.tier.price), true);
    }
    // プランの割引は「セット割」1行にまとめ、内訳を横並びで小さく表記
    var setWari = [];
    if (r.dMinna) setWari.push({ key: "x:minna", name: "みんなドコモ割（" + (state.minna === "2" ? "2回線" : "3回線以上") + "）", amt: r.dMinna });
    if (r.dSet) setWari.push({ key: "x:hikari", name: "ドコモ光／home 5G", amt: r.dSet });
    if (r.dCard) setWari.push({ key: "x:dcardpay", name: "dカードお支払割" + (isGoldCard(state.dCard) ? "（GOLD系）" : ""), amt: r.dCard });
    if (r.dDenki) setWari.push({ key: "x:denki", name: "ドコモでんき", amt: r.dDenki });
    if (r.dChoki) setWari.push({ name: "長期利用割（" + (state.choki === "y20" ? "20年" : "10年") + "以上）", amt: r.dChoki });
    if (r.dHearty) setWari.push({ key: "x:hearty", name: "ハーティ割引", amt: r.dHearty });
    if (r.dHeartyVoice) setWari.push({ key: "x:hearty", name: "ハーティ割引（通話オプション）", amt: r.dHeartyVoice });
    if (r.dKosodate) setWari.push({ key: "x:kosodate", name: "子育てサポート割引", amt: r.dKosodate });
    if (r.dKosodateVoice) setWari.push({ key: "x:kosodate", name: "子育てサポート割引（通話オプション）", amt: r.dKosodateVoice });
    if (setWari.length) {
      var setTotal = 0, setDetail = [];
      setWari.forEach(function (w) { setTotal += w.amt; setDetail.push(svcName(w.name, w.key) + " −" + yen(w.amt)); });
      h += "<tr><td>セット割・各種割引"
        + '<div class="subrow">' + setDetail.join("／") + "</div>"
        + '</td><td class="amt">−' + yen(setTotal) + "</td></tr>";
    }
    r.campaignRows.forEach(function (c) {
      h += row(esc(c.name) + "（" + c.months + "か月間）", "−" + yen(c.amount), true);
    });
    if (r.pointApply) {
      r.pointRows.forEach(function (p) {
        h += row("ポイント充当（" + esc(p.name) + "）※", "−" + yen(p.amount), true);
      });
    }
    var netIncl = (r.netRows || []).filter(function (n) { return n.incl; });
    if (r.voice.id !== "none") {
      h += row(svcName(r.voice.name, "vo:" + r.voice.id) + esc(r.voiceNote)
        + (netIncl.length ? "（" + netIncl.map(function (n) { return esc(n.base); }).join("・") + "）" : ""),
        yen(r.voicePrice), true);
    }
    (r.netRows || []).forEach(function (n) {
      if (n.incl) return;   // 通話オプションの行に含めたので単独では出さない
      h += row(esc(n.name), yen(n.price), true);
    });
    r.optRows.forEach(function (o) { h += row(svcName(o.name, o.id ? "op:" + o.id : ""), yen(o.price), true); });
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
    /* 充当しない場合は、月額はそのままにして、
     * もらえるポイントと、それを使った場合の実質額を続けて出す。 */
    if (!r.pointApply && r.pointTotal > 0) {
      h += row("毎月もらえるdポイント（" + r.pointRows.map(function (p) { return esc(p.name); }).join("・") + "）※",
        r.pointTotal.toLocaleString("ja-JP") + "pt/月", true);
      h += '<tr class="total"><td>ポイントを使った場合の実質※</td><td class="amt">'
        + yen(Math.max(0, seg0.monthly - r.pointTotal)) + "</td></tr>";
    }
    var mnpBeneSheet = mnpSimOnly(state) ? mnpBenefitText(state) : "";
    if (mnpBeneSheet) {
      h += row("MNP特典（SIMのみ）", "<b>" + esc(mnpBeneSheet) + "</b>", true);
    }
    h += "</tbody></table>";
    if (r.pointRows.length) {
      h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">※ '
        + (r.pointApply ? "ポイント充当は" : "実質額は")
        + 'dポイント（期間・用途限定含む）を利用した場合の負担額の目安です。獲得ポイントはご利用状況により変動します。'
        + (r.pointApply && r.pointOver > 0
          ? "充当しきれない " + r.pointOver.toLocaleString("ja-JP") + "pt/月 は月額に反映していません。"
          : "")
        + "</p>";
    }
    if (hasInstallment) {
      h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">※ 機種代金などの分割支払金・初期費用は2ページ目に記載しています。</p>';
    }
    // 現在のお支払いとの比較（請求内訳を読み取ったときだけ出す）
    var cbT = curBillTotal(state);
    if (cbT > 0) {
      h += "<h3>現在のお支払いとの比較</h3><table><tbody>";
      h += row("現在のお支払い（ご請求内訳より"
        + (state.curBill && state.curBill.month ? "・" + esc(state.curBill.month) + "分" : "") + "）※", yen(cbT), true);
      h += row("この見積もりの月額" + (lbl0 ? "（" + lbl0 + "）" : ""), yen(seg0.monthly), true);
      h += '<tr class="total"><td>毎月の差額</td><td class="amt">' + billDiffText(seg0.monthly - cbT) + "</td></tr>";
      h += "</tbody></table>";
      h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">'
        + "※ 現在のお支払いは、お客様のご請求内訳（当月分）の読み取り値です。"
        + "通話料・日割り・期間限定の割引などにより、通常月のお支払いとは異なる場合があります。</p>";
    }
    /* 別紙のときは光の基本料をスマホの見積もりに含めない。
     * スマホの月額はドコモの請求と一致させ、光は別の請求として別紙で案内するため。 */
    if (sheetScope === "hikari" && ienakaOn()) {
      h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">'
        + "※ " + esc(KQ_IENAKA.label()) + "のお見積もりは<b>別紙</b>でご案内します。"
        + "光のご利用料金は<b>上の月額には含まれていません</b>（お支払いが分かれます）。"
        + (r.dSet > 0
          ? "ドコモ光／home 5G セット割（" + yen(r.dSet) + "/月）は、上の月額から差し引いています。"
          : "")
        + "</p>";
    }

    // ---- 2ページ目: 本体分割金・初期費用（印刷時はここで改ページ） ----
    var p2 = "";

    // 端末代金の値引き（クーポン・キャンペーン）
    if (r.device.offTotal > 0) {
      p2 += "<h3>端末代金の値引き</h3><table><tbody>";
      p2 += row((state.deviceName ? esc(state.deviceName) : "端末代金") + "　定価", yen(r.device.list), true);
      if (r.device.offCoupon > 0) p2 += row("クーポン値引き", "−" + yen(r.device.offCoupon), true);
      if (r.device.offTebiki > 0) p2 += row("店舗独自キャンペーン", "−" + yen(r.device.offTebiki), true);
      if (r.device.offDirect > 0) p2 += row("ダイレクト割", "−" + yen(r.device.offDirect), true);
      p2 += '<tr class="total"><td>値引き後の端末代金</td><td class="amt">' + yen(r.device.total) + "</td></tr>";
      if (r.device.atamaOff > 0) {
        p2 += row("店頭頭金（値引き適用後）",
          yen(r.device.atamaList) + " → " + yen(r.device.atamaBeforePoint), true);
      }
      p2 += "</tbody></table>";
    }

    // 本体分割金（機種代金・アクセサリの分割）
    if (hasInstallment) {
      p2 += "<h3>端末代金・分割支払金</h3><table><tbody>";
      if (r.device.monthly > 0) {
        var dLabel = state.deviceName ? esc(state.deviceName) : "機種代金";
        dLabel += r.device.kaedoki ? "（いつでもカエドキプログラム・〜23回）" : "（分割" + r.device.months + "回）";
        p2 += row(dLabel, yen(r.device.monthly), true);
      }
      r.accMonthlyRows.forEach(function (a) {
        p2 += row(svcName(a.name, a.svc) + "（アクセサリ・分割" + a.months + "回）", yen(a.monthly), true);
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
      /* 「総額 − ポイント充当 ＝ 23回分の総額 ＋ 残価」で読めるよう、充当分を1行で見せる
       * （23回分の総額には頭金が含まれている）。 */
      var ptKae = r.device.atamaPoint + r.device.pointSplit + r.device.pointZanka;
      if (ptKae > 0) p2 += row("dポイント充当", "−" + yen(ptKae), true);
      if (r.device.atama > 0) p2 += row("店頭頭金（総額のうち店頭でお支払い）", yen(r.device.atama), true);
      p2 += row("23回分の総額（頭金込み）", yen(r.device.total23 || 0), true);
      p2 += row("残価（24回目支払分）", yen(r.device.zanka || 0), true);
      p2 += row("返却しない場合（24か月目以降）", yen(r.device.after) + "/月 × 24回", true);
      if (r.device.kaedokiFee > 0) p2 += row("プログラム利用料（返却時・ドコモで買替えの場合は免除）", yen(r.device.kaedokiFee), true);
      p2 += row("23か月目までに返却した場合の実質負担", yen(r.device.jisshitsu || 0), true);
      p2 += "</tbody></table>";
    }

    // dポイントの充当先。金額はすでに反映済みなので、内訳だけを添える
    if (r.device.pointUse > 0) {
      var ptInner = pointUseText(r.device);
      if (ptInner) {
        p2 += '<p class="memo">※ dポイント ' + r.device.pointUse.toLocaleString("ja-JP")
          + "pt のうち " + ptInner + " を充当しています（1pt = 1円）。"
          + (r.device.pointLeft > 0
            ? "残り " + r.device.pointLeft.toLocaleString("ja-JP") + "pt は充当していません。" : "")
          + "</p>";
      }
    }

    // 初期費用（店頭お支払い／翌月合算払い）
    if (r.storeRows.length) {
      p2 += "<h3>店頭お支払い金額</h3><table><tbody>";
      r.storeRows.forEach(function (x) {
        p2 += row(svcName(x.name, x.svc), (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount)), true);
      });
      p2 += '<tr class="total"><td>店頭お支払い合計</td><td class="amt">' + yen(r.storeTotal) + "</td></tr>";
      p2 += "</tbody></table>";
    }
    if (r.billRows.length) {
      p2 += "<h3>翌月合算払い（携帯料金と合算請求）</h3><table><tbody>";
      r.billRows.forEach(function (x) {
        p2 += row(svcName(x.name, x.svc), (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount)), true);
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

    /* パターン（回線1・2・3）は複数台のご提案に使うもので、案を見比べる
     * ためのものではないため、見積書に比較表は出さない（店舗の指定・2026-08-10）。 */

    if (state.quoteMemo) h += '<div class="memo">※ ' + esc(state.quoteMemo) + "</div>";

    // 発行元（店舗名・担当者名・電話番号）。お客様が後から連絡できるように下端へ置く
    var signParts = [];
    if (state.shopName) signParts.push("<b>" + esc(state.shopName) + "</b>");
    if (state.staffName) signParts.push("担当: " + esc(state.staffName));
    if (state.shopTel) signParts.push("TEL: " + esc(state.shopTel));
    if (signParts.length) h += '<div class="sheet-sign">' + signParts.join("　") + "</div>";

    h += '<div class="disclaimer">本見積もりは概算です。実際のご契約時の金額・適用条件とは異なる場合があります。'
      + "キャンペーン・割引の適用可否は契約条件により変わります。詳細は店頭スタッフへご確認ください。"
      + "本書は当店が作成したご案内であり、NTTドコモが発行するものではありません。<br>"
      + "料金データ基準日: " + esc(MASTER.updated) + "｜アプリ版 " + APP_VERSION + "</div>";

    /* 光の明細は、スマホの見積書に続く3枚目としてお渡しする。
     * 1ページ目には世帯の合計だけを出し、内訳はこちらで見ていただく。 */
    if (sheetScope === "hikari" && ienakaOn()) {
      h += '<div class="sheet-page3">'
        + '<div class="page2-note no-print">――― 印刷時はここから3ページ目（光の別紙） ―――</div>'
        + ienakaOnlySheet(r.dSet || 0) + "</div>";
    }

    $("sheetBody").innerHTML = h;

    function row(name, val, amt) {
      return "<tr><td>" + name + '</td><td class="' + (amt ? "amt" : "") + '">' + val + "</td></tr>";
    }
  }

  /* ---------- マスタ設定タブ ---------- */
  /* マスタ設定の「実績で追う項目」カード。設定は MASTER.statsCfg（statsCfg() 参照）。 */
  function statsCfgHtml() {
    var sc = statsCfg();
    var h = '<div class="master-plan" data-mroom="stats"><h3>実績で追う項目</h3>';
    h += '<p class="hint">実績タブの「項目別」で<strong>どの項目を数えるか</strong>を選べます。'
      + '店舗として力を入れている商材だけに絞ると、表が見やすくなります。<br>'
      + '設定は保存済みの見積もりには手を加えず、<strong>集計するときに数え直す</strong>ため、'
      + 'あとから変えても過去の分に新しい設定が効きます。店舗内の全端末で共通です。</p>';

    h += '<div class="plan-sec"><span class="plan-lbl">実績の公開範囲</span><div class="sub-checks">'
      + '<label class="check"><input type="checkbox" data-sc-flag="openAll"' + (sc.openAll ? " checked" : "")
      + "> 全担当の実績を全員に公開する</label></div>"
      + '<p class="hint">チェックすると、担当者コードだけの人も実績タブで<strong>全担当・担当別の表・目標と進捗</strong>を見られます（店舗の方針に合わせてお選びください）。'
      + 'チェックしないときは、マスタ設定のパスワードを通った管理者だけが全担当を見られます。'
      + '件数の「修正」は、これまでどおり自分の当月ぶんと管理者だけです。</p></div>';

    h += '<div class="plan-sec"><span class="plan-lbl">手続き</span><div class="sub-checks">';
    [["shinki", "新規契約"], ["mnp", "のりかえ（MNP）"], ["kishu", "機種変更"], ["plan", "プラン変更"]].forEach(function (p) {
      h += '<label class="check"><input type="checkbox" data-sc-proc="' + p[0] + '"'
        + (sc.procs[p[0]] ? " checked" : "") + "> " + p[1] + "</label>";
    });
    h += "</div></div>";

    h += '<div class="plan-sec"><span class="plan-lbl">ご来店の目的・プラスワン</span><div class="sub-checks">'
      + '<label class="check"><input type="checkbox" data-sc-visit="1"' + (sc.visit ? " checked" : "")
      + "> 「来店目的別」の表を出す（目的ごとの応対数・成約・成約になった内容）</label>"
      + '<label class="check"><input type="checkbox" data-sc-kaimashi="1"' + (sc.kaimashi ? " checked" : "")
      + "> プラスワン（再掲）</label></div>"
      + '<p class="hint">プラスワンは、<strong>端末購入以外のご用件で来店されて機種変更になった場合</strong>と、'
      + '<strong>端末購入で「買い増しあり」にチェックした場合</strong>に数えます。'
      + '機種変更の実績はそのまま数えたうえで、<strong>再掲</strong>として別に1件数えます。</p></div>';

    h += '<div class="plan-sec"><span class="plan-lbl">プラン（チェックしたものだけ数えます）</span><div class="sub-checks">';
    MASTER.plans.forEach(function (pl) {
      h += '<label class="check"><input type="checkbox" data-sc-plan="' + esc(pl.id) + '"'
        + (sc.plans[pl.id] ? " checked" : "") + "> " + esc(pl.name)
        + (pl.group === "legacy" ? "（旧）" : "") + "</label>";
    });
    h += "</div></div>";

    h += '<div class="plan-sec"><span class="plan-lbl">機種販売・dカード・でんき・ガス・光</span><div class="sub-checks">';
    h += '<label class="check">機種販売 <select id="scDevice">'
      + '<option value="off"' + (sc.device === "off" ? " selected" : "") + ">追わない</option>"
      + '<option value="all"' + (sc.device === "all" ? " selected" : "") + ">全機種</option>"
      + '<option value="kw"' + (sc.device === "kw" ? " selected" : "") + ">機種名で絞る</option>"
      + "</select></label>";
    h += '<input type="text" id="scDeviceKw" value="' + esc(sc.deviceKw) + '"'
      + ' placeholder="例）Pixel、iPhone（読点区切りで複数可）"' + (sc.device === "kw" ? "" : " hidden") + ">";
    h += '<label class="check">dカード <select data-sc-sel="dcard">'
      + '<option value="off"' + (sc.dcard === "off" ? " selected" : "") + ">追わない</option>"
      + '<option value="one"' + (sc.dcard === "one" ? " selected" : "") + ">まとめて1行</option>"
      + '<option value="type"' + (sc.dcard === "type" ? " selected" : "") + ">種別ごと</option>"
      + "</select></label>";
    h += '<label class="check">でんき <select data-sc-sel="denki">'
      + '<option value="off"' + (sc.denki === "off" ? " selected" : "") + ">追わない</option>"
      + '<option value="one"' + (sc.denki === "one" ? " selected" : "") + ">まとめて1行</option>"
      + '<option value="type"' + (sc.denki === "type" ? " selected" : "") + ">メニューごと</option>"
      + "</select></label>";
    h += '<label class="check">ガス <select data-sc-sel="gas">'
      + '<option value="off"' + (sc.gas === "off" ? " selected" : "") + ">追わない</option>"
      + '<option value="one"' + (sc.gas === "one" ? " selected" : "") + ">1行で数える</option>"
      + "</select></label>";
    h += '<label class="check"><input type="checkbox" data-sc-flag="hikari"'
      + (sc.hikari ? " checked" : "") + "> 光・5G（1ギガ／10ギガ／home 5G）</label>";
    h += '<label class="check"><input type="checkbox" data-sc-flag="accs"'
      + (sc.accs ? " checked" : "") + "> アクセサリ（登録品）</label>";
    h += "</div></div>";

    h += '<div class="plan-sec"><span class="plan-lbl">再掲の項目</span><div class="sub-checks">';
    h += '<label class="check"><input type="checkbox" data-sc-flag="highend"'
      + (sc.highend ? " checked" : "") + "> （再掲）機種ハイエンド</label>";
    h += '<label class="check">Android はこの金額以上 <input type="number" id="scHighendYen" min="0" inputmode="numeric" value="'
      + (num(sc.highendYen) || 0) + '"' + (sc.highend ? "" : " hidden") + "> 円</label>";
    h += '<label class="check">iPhone はこの言葉を含む <input type="text" id="scHighendIpKw" value="'
      + esc(sc.highendIpKw) + '" placeholder="例）Pro、Air（読点区切り）"' + (sc.highend ? "" : " hidden") + "></label>";
    h += '<label class="check"><input type="checkbox" data-sc-flag="u15"'
      + (sc.u15 ? " checked" : "") + "> （再掲）U15（新規・MNPのとき）</label>";
    h += "</div>"
      + '<p class="hint"><strong>機種ハイエンド</strong>は、機種販売とは別に1件数えます。'
      + '<strong>iPhone</strong>（機種名に iPhone を含むもの）は、上の言葉（Pro・Air）が機種名に入っていればハイエンドです（金額は見ません）。'
      + '<strong>それ以外（Android）</strong>は、<strong>元値（端末代金総額 − 店頭頭金）</strong>がこの金額以上のときです。'
      + 'クーポンや店舗独自キャンペーンの値引きは引かずに判定します。'
      + '<strong>U15</strong>は、新規・MNPで<strong>U15のプランを選んだとき</strong>か、手続き内容の'
      + '<strong>「U15（15歳以下）」にチェックしたとき</strong>に数えます。</p></div>';

    h += '<div class="plan-sec"><span class="plan-lbl">オプション（チェックを外すと数えません）</span><div class="sub-checks">';
    MASTER.options.forEach(function (o) {
      if (statsSkipOpt(o)) return;   // もともと数えないものは出さない
      h += '<label class="check"><input type="checkbox" data-sc-opt="' + esc(o.id) + '"'
        + (sc.optSkip[o.id] ? "" : " checked") + "> " + esc(o.name)
        + (o.own ? "（独自）" : "") + "</label>";
    });
    h += "</div></div>";

    // もともと数えない商材（手数料・再発行・請求書払い）は一覧に出さない
    var countableFees = (MASTER.feeItems || []).filter(function (o) {
      if (o.pay === "bill" || statsSkipFee(o)) return false;
      return o.own || !/手数料|再発行/.test(o.name || "");
    });
    if (countableFees.length) {
      h += '<div class="plan-sec"><span class="plan-lbl">商材・サービス（チェックを外すと数えません）</span><div class="sub-checks">';
      countableFees.forEach(function (o) {
        h += '<label class="check"><input type="checkbox" data-sc-fee="' + esc(o.id) + '"'
          + (sc.feeSkip[o.id] ? "" : " checked") + "> " + esc(o.name)
          + (o.own ? "（独自）" : "") + "</label>";
      });
      h += "</div></div>";
    }
    h += '<p class="hint">手数料・再発行・請求書払いの商材と、オプションの「継続」は、もともと数えない決まりです。</p>';
    h += "</div>";

    /* 月の目標。入れた項目だけが実績の「目標と進捗」に出る（管理者だけに見えます）。 */
    var goals = MASTER.statsGoalItems || {};
    var cat = statsCatalog();
    var gOrder = ["proc:kishu", "kaimashi", "proc:mnp", "proc:shinki", "u15", "highend", "device",
      "proc:", "plan:", "dcard:", "denki:", "gas", "ie:", "opt:", "maxAmazon", "fee:", "own:", "acc:"];
    function gRank(k) {
      for (var i = 0; i < gOrder.length; i++) if (k.indexOf(gOrder[i]) === 0) return i;
      return gOrder.length;
    }
    h += '<div class="master-plan" data-mroom="stats"><h3>実績の目標（月あたり・管理者）</h3>';
    h += '<p class="hint">項目ごとの<strong>月の成約目標</strong>を入れると、実績に「目標と進捗」の表が出ます'
      + '（残りの件数と、いまのペースでの着地見込み）。空欄の項目は出ません。</p>';
    h += '<div class="goal-grid">';
    Object.keys(cat).sort(function (a2, b2) {
      return (gRank(a2) - gRank(b2)) || (cat[a2] < cat[b2] ? -1 : 1);
    }).forEach(function (k) {
      h += '<label class="goal-item"><span>' + esc(cat[k]) + "</span>"
        + '<input type="number" min="0" data-sc-goal="' + esc(k) + '" value="'
        + (num(goals[k]) || "") + '" placeholder="－"></label>';
    });
    h += "</div></div>";
    h += "</div>";
    return h;
  }

  /* 料金プランの一覧のたたみ状態（プランidごと）。再描画しても消えないようここに持つ。
   * 保存はしない：開き直したら全部たたまれた状態から始まる。 */
  var planOpen = {};
  var planShowLegacy = false;
  function planVisible(pl) {
    return planShowLegacy || pl.group !== "legacy" || !!planOpen[pl.id];
  }
  /* たたんだ行に出す月額のあらまし（段階が複数なら 最低〜最高） */
  function planPriceSummary(pl) {
    var ps = (pl.tiers || []).map(function (t) { return num(t.price); });
    if (!ps.length) return "";
    var mn = Math.min.apply(null, ps), mx = Math.max.apply(null, ps);
    return mn === mx ? yen(mn) : yen(mn) + "〜" + yen(mx);
  }
  /*/* マスタ設定は5つの部屋（お店の商材／ドコモの料金／画面と道具／実績／店舗情報）に
   * 分かれている。data-mroom の付いたカード・セクションを、選んだ部屋のものだけ表示する。
   * 検索中（項目を探す）は、結果を隠さないため全部屋を表示する。 */
  var masterRoom = "shop";
  function applyMasterRoom() {
    var showAll = masterSearchActive();
    Array.prototype.forEach.call(document.querySelectorAll('#tab-master [data-mroom]'), function (el) {
      el.hidden = !showAll && el.getAttribute("data-mroom") !== masterRoom;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-mroom-btn]'), function (b) {
      b.classList.toggle("on", b.getAttribute("data-mroom-btn") === masterRoom);
    });
  }
  function initMasterRooms() {
    var bar = $("mroomTabs");
    if (!bar) return;
    bar.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-mroom-btn]");
      if (!b) return;
      masterRoom = b.getAttribute("data-mroom-btn");
      applyMasterRoom();
    });
  }
  /* マスタ設定の各項目（見出しごと）を開閉できるようにする。
   * 画面を開き直す（マスタ設定を開き直す）と、すべてたたんだ状態に戻る。保存はしない。
   * 検索中（masterSearch に入力がある間）は、結果を隠さないためすべて開く。 */
  var masterFoldOpen = {};
  function masterSearchActive() {
    var el = $("masterSearch");
    return !!(el && el.value.trim());
  }
  // headerEl（h2/h3）以降のきょうだい要素をひとつの開閉できる箱にまとめる
  function foldifySection(headerEl, key) {
    if (!headerEl || headerEl.dataset.msecDone) return;
    headerEl.dataset.msecDone = "1";
    headerEl.dataset.msecKey = key;
    var body = document.createElement("div");
    body.className = "msec-body";
    var parent = headerEl.parentNode;
    var sib = headerEl.nextSibling;
    while (sib) {
      var next = sib.nextSibling;
      body.appendChild(sib);
      sib = next;
    }
    parent.appendChild(body);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "msec-toggle";
    btn.setAttribute("data-msec-toggle", key);
    headerEl.appendChild(btn);
    updateFoldUi(headerEl, body, key);
  }
  function updateFoldUi(headerEl, body, key) {
    var open = !!masterFoldOpen[key] || masterSearchActive();
    body.hidden = !open;
    var btn = headerEl.querySelector(".msec-toggle");
    if (btn) btn.textContent = open ? "たたむ ▴" : "開く ▾";
  }
  // 現在ある開閉状態を、検索の有無に合わせて表示だけ更新する（DOMの再構築はしない）
  function applyMasterFoldState() {
    Array.prototype.forEach.call(document.querySelectorAll("#masterBody [data-msec-key]"), function (headerEl) {
      var body = headerEl.nextElementSibling;
      if (!body || !body.classList.contains("msec-body")) return;
      updateFoldUi(headerEl, body, headerEl.dataset.msecKey);
    });
  }
  // masterBody 直下の各見出し（h3）を開閉できるようにする。再描画のたびに呼ぶ
  // （innerHTML の入れ替えで前回のラップは消えているため、そのつど作り直す）。
  function foldifyMasterSections() {
    Array.prototype.forEach.call(document.querySelectorAll("#masterBody > .master-plan"), function (sec) {
      var h3 = sec.querySelector("h3");
      if (h3) foldifySection(h3, "sec:" + h3.textContent.trim());
    });
  }
  function renderMasterTab() {
    $("masterUpdated").textContent = MASTER.updated + "｜アプリ版 " + APP_VERSION;
    var su = $("storageUsage");
    if (su) su.textContent = "この端末の保存領域の使用量: " + storageUsageText()
      + "（このサイトの全アプリ合計。目安の上限は5MB前後。上限に近いと保存に失敗することがあります）";
    var h = masterUpdateHtml();

    h += '<div class="master-plan" data-mroom="docomo"><h3>共通費用</h3><div class="master-grid">';
    h += mInput("事務手数料（新規）", "fees.jimu_shinki");
    h += mInput("事務手数料（MNP）", "fees.jimu_mnp");
    h += mInput("事務手数料（機種変更）", "fees.jimu_kishu");
    h += mInput("店頭頭金（初期値）", "fees.atamakin_default");
    h += "</div></div>";

    // キャンペーン割引（名称・期間・割引額を編集可）
    h += '<div class="master-plan" data-mroom="docomo"><h3>キャンペーン割引</h3>';
    h += '<p class="hint">' + remapCircled("対象プラン選択時に「③割引」へ表示されます。") + "終了したキャンペーンは×で削除してください。</p>";
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
    var BAKU_TIERS = [
      ["", "対象外"],
      ["max", "ドコモ MAX／ポイ活 MAX の率"],
      ["std", "ポイ活20・ahamo・eximo・ギガホ の率"]
    ];
    h += '<div class="master-plan" data-mroom="docomo"><h3>料金プラン</h3>';
    h += '<p class="hint">新しいプランが出たときは、ここから登録できます。'
      + '<strong>似ているプランの「複製」から作ると早いです</strong>（割引や詳細設定がそのまま写ります）。'
      + '見積もり画面のプルダウンには、ここで「現行」にしたものだけが出ます。'
      + '<strong>プラン名を押すと編集が開きます。</strong></p>';
    var visIdx = [];
    MASTER.plans.forEach(function (pl, pi) { if (planVisible(pl)) visIdx.push(pi); });
    MASTER.plans.forEach(function (pl, pi) {
      if (!planVisible(pl)) return;
      var firstVis = pi === visIdx[0];
      var lastVis = pi === visIdx[visIdx.length - 1];
      var mvBtns = '<button class="mv" data-pl-up="' + pi + '" type="button" aria-label="上へ"' + (firstVis ? " disabled" : "") + ">▲</button>"
        + '<button class="mv" data-pl-down="' + pi + '" type="button" aria-label="下へ"' + (lastVis ? " disabled" : "") + ">▼</button>";
      if (!planOpen[pl.id]) {
        /* たたんだ行：名前と月額のあらましだけ。行を押すと開く */
        h += '<div class="plan-edit plan-closed"><div class="plan-head">'
          + mvBtns
          + '<button class="plan-open-btn" data-pl-open="' + pi + '" type="button">'
          + '<span class="plan-open-name">' + esc(pl.name || "（名前なし）") + "</span>"
          + (pl.group === "legacy" ? '<span class="plan-badge">旧</span>' : "")
          + '<span class="plan-sum">' + planPriceSummary(pl) + "</span>"
          + '<span class="plan-open-mark">開く ▾</span>'
          + "</button></div></div>";
        return;
      }
      h += '<div class="plan-edit">';
      h += '<div class="plan-head">'
        + mvBtns
        + '<input type="text" class="plan-name" value="' + esc(pl.name) + '" placeholder="プラン名" data-pl-name="' + pi + '">'
        + '<select data-pl-group="' + pi + '">'
        + '<option value="current"' + (pl.group === "current" ? " selected" : "") + ">現行</option>"
        + '<option value="legacy"' + (pl.group === "legacy" ? " selected" : "") + ">旧プラン</option>"
        + "</select>"
        + '<button class="btn-sub" data-pl-close="' + pi + '" type="button">たたむ ▴</button>'
        + '<button class="btn-sub" data-pl-copy="' + pi + '" type="button">複製</button>'
        + '<button class="del" data-pl-del="' + pi + '" type="button" aria-label="削除">×</button>'
        + "</div>";

      h += '<div class="plan-sec"><span class="plan-lbl">基本料金</span>';
      pl.tiers.forEach(function (t, ti) {
        h += '<div class="plan-tier">'
          + '<input type="text" value="' + esc(t.label || "") + '" placeholder="段階名（例）〜3GB）" data-pl-tlabel="' + pi + ":" + ti + '">'
          + '<input type="number" value="' + num(t.price) + '" data-pl-tprice="' + pi + ":" + ti + '">'
          + '<span class="unit">円</span>'
          + '<button class="del" data-pl-tdel="' + pi + ":" + ti + '" type="button" aria-label="削除"' + (pl.tiers.length < 2 ? " disabled" : "") + ">×</button>"
          + "</div>";
      });
      h += '<button class="btn-sub" data-pl-tadd="' + pi + '" type="button">＋ 段階を追加</button>';
      h += '<p class="hint">段階が1つだけのときは、見積もり画面に段階のプルダウンを出しません。</p>';
      h += "</div>";

      h += '<div class="plan-sec"><span class="plan-lbl">割引</span><div class="plan-disc">';
      D_LABELS.forEach(function (dl) {
        var on = dl[0] in pl.discounts;
        h += '<label class="disc-row">'
          + '<input type="checkbox" data-pl-dison="' + pi + ":" + dl[0] + '"' + (on ? " checked" : "") + ">"
          + "<span>" + dl[1] + "</span>"
          + '<input type="number" value="' + (on ? num(pl.discounts[dl[0]]) : "") + '" placeholder="0" data-pl-disamt="' + pi + ":" + dl[0] + '"' + (on ? "" : " disabled") + ">円"
          + "</label>";
      });
      h += '</div><p class="hint">' + remapCircled("チェックを外した割引は、このプランを選んだときに③の欄へ出しません。") + "</p></div>";

      h += '<details class="plan-more"><summary>詳細設定</summary><div class="plan-sec">';
      h += '<label class="plan-f"><span>爆アゲ セレクションの区分</span>'
        + '<select data-pl-baku="' + pi + '">'
        + BAKU_TIERS.map(function (b) {
            return '<option value="' + b[0] + '"' + ((pl.bakuageTier || "") === b[0] ? " selected" : "") + ">" + b[1] + "</option>";
          }).join("")
        + "</select></label>";
      h += '<label class="plan-f"><span>ポイ活の還元上限</span>'
        + '<input type="number" min="0" value="' + (num(pl.poikatsuPt) || "") + '" placeholder="0" data-pl-poi="' + pi + '">pt/月'
        + '<span class="hint">0にすると、このプランではポイ活の欄を出しません</span></label>';
      h += '<label class="plan-f chk"><input type="checkbox" data-pl-5min="' + pi + '"' + (pl.includes5min ? " checked" : "") + ">"
        + "<span>5分通話無料がプランに含まれる</span></label>";
      h += '<label class="plan-f chk"><input type="checkbox" data-pl-dcard10="' + pi + '"' + (pl.dcard10 === false ? "" : " checked") + ">"
        + "<span>dカード GOLD系の10%還元の対象</span></label>";
      h += '<label class="plan-f chk"><input type="checkbox" data-pl-maxbonus="' + pi + '"' + (pl.maxBonus ? " checked" : "") + ">"
        + "<span>「選べる特典」（対象サービスから毎月2つ無料）の対象</span></label>";
      h += '<label class="plan-f"><span>メモ</span>'
        + '<input type="text" value="' + esc(pl.note || "") + '" placeholder="社内用。お客様には出ません" data-pl-note="' + pi + '"></label>'
        + '<label class="plan-desc">ご案内文'
        + '<textarea rows="2" placeholder="見積書で名前を押すと出ます（任意・改行できます）" data-pl-desc="' + pi + '">'
        + esc(pl.desc || "") + "</textarea></label>"
        + (pl.url ? '<span class="svc-desc-url">公式ページ: ' + esc(pl.url) + "</span>" : "");
      h += "</div></details>";
      h += "</div>";
    });
    var legacyN = MASTER.plans.filter(function (pl) { return pl.group === "legacy"; }).length;
    h += '<div class="actions">'
      + (legacyN ? '<button class="btn-sub" data-pl-legacy-toggle="1" type="button">'
          + (planShowLegacy ? "旧プランを隠す ▴" : "受付終了の旧プランを表示（" + legacyN + "件）▾") + "</button>" : "")
      + '<button class="btn-sub" data-pl-add="1" type="button">＋ プランを追加</button></div>';
    h += "</div>";

    h += '<div class="master-plan" data-mroom="docomo"><h3>通話オプション</h3><div class="master-grid">';
    MASTER.voiceOptions.forEach(function (v, vi) {
      if (v.id === "none") return;
      h += mInput(esc(v.name), "voiceOptions." + vi + ".price");
    });
    h += "</div></div>";

    // オプション・サービス（すべて月額。追加・削除・並び替え・カテゴリ変更可）
    /* 金額をプルダウンで選ぶ「選択式」の編集。
     * 補償のように機種で金額が変わるものや、コースが複数あるものに使う。
     * 行が横に伸びないよう、行の下に折りたたんで出す。 */
    function optChoicesHtml(o) {
      if (!openChoices[o.id]) return "";
      var cs = o.priceChoices || [];
      var h = '<div class="choice-box">';
      h += '<p class="hint">お客様には金額のプルダウンとして出ます。ラベルは省略できます（例）「スタンダード」）。'
        + '行の<strong>金額欄（' + yen(num(o.price)) + '）が初期値</strong>です。'
        + '金額欄の値が選択肢に無くなった場合は、一番上の金額に合わせます。</p>';
      if (!cs.length) {
        h += '<p class="hint">選択肢がありません。「＋ 選択肢を追加」から作ってください。</p>';
      } else {
        h += cs.map(function (c, k) {
          var lb = (o.priceLabels && o.priceLabels[String(c)]) || "";
          return '<div class="choice-row">'
            + '<input type="number" value="' + c + '" data-op-cprice="' + o.__i + ":" + k + '">'
            + '<span class="price">円/月</span>'
            + '<input type="text" value="' + esc(lb) + '" placeholder="ラベル（任意）" data-op-clabel="' + o.__i + ":" + k + '">'
            + '<button class="del" data-op-cdel="' + o.__i + ":" + k + '" type="button" aria-label="削除">×</button>'
            + "</div>";
        }).join("");
      }
      h += '<div class="actions">'
        + '<button class="btn-sub" data-op-cadd="' + o.__i + '" type="button">＋ 選択肢を追加</button>'
        + '<button class="btn-sub" data-op-coff="' + o.__i + '" type="button">選択式をやめる</button>'
        + "</div></div>";
      return h;
    }
    function optExtra(o) {
      return '<select data-op-cat="' + o.__i + '">'
        + optCategories().map(function (c) {
            return '<option value="' + c + '"' + ((o.category || "その他") === c ? " selected" : "") + ">" + c + "</option>";
          }).join("")
        + "</select>"
        + '<label class="gold-flag"><input type="checkbox" data-op-gold="' + o.__i + '"' + (o.carrier ? " checked" : "") + '>GOLD10%</label>'
        + '<label class="gold-flag baku-flag" title="ドコモMAX／ポイ活MAXの還元率">爆アゲMAX<input type="number" min="0" max="100" value="' + (num(o.bakuage) || "") + '" placeholder="0" data-op-baku="' + o.__i + '">%</label>'
        + '<label class="gold-flag baku-flag" title="ポイ活20・ahamo・eximo・ギガホの還元率">他<input type="number" min="0" max="100" value="' + (num(o.bakuage2) || "") + '" placeholder="0" data-op-baku2="' + o.__i + '">%</label>'
        + '<label class="gold-flag baku-flag" title="率ではなく固定のポイント数で進呈するもの。プランの区分によらず加算します">固定<input type="number" min="0" value="' + (num(o.bakuageFixed) || "") + '" placeholder="0" data-op-bakufix="' + o.__i + '">pt</label>'
        + '<button class="btn-sub choice-btn" data-op-choices="' + o.__i + '" type="button">'
        + (o.priceChoices ? "選択式 " + o.priceChoices.length + "件" : "選択式にする")
        + (openChoices[o.id] ? " ▲" : "") + "</button>";
    }
    function feeExtra(o) {
      return '<select data-fi-pay="' + o.__i + '">'
        + '<option value="store"' + (o.pay !== "bill" ? " selected" : "") + ">店頭払い</option>"
        + '<option value="bill"' + (o.pay === "bill" ? " selected" : "") + ">翌月合算</option>"
        + "</select>"
        + '<label class="own-flag" title="引き継ぎシートの「データ移行」の欄に出します">'
        + '<input type="checkbox" data-fi-dm="' + o.__i + '"' + (o.dataMove ? " checked" : "") + ">データ移行</label>";
    }
    var isOwn = function (o) { return !!o.own; };
    var isCarrier = function (o) { return !o.own; };

    // 見積もり画面の並べ替え（本物の画面の上で長押しドラッグ）
    h += '<div class="master-plan" data-mroom="tools"><h3>見積もり画面の並べ替え</h3>';
    h += '<p class="hint">本物の見積もり画面に移って、<strong>長押しでつかんで動かす</strong>だけで並べ替えられます（iPhoneのホーム画面と同じ要領）。動かせるのは、'
      + '<strong>①〜⑨のカード</strong>・<strong>' + remapCircled("④⑥⑦").split("").sort().join("") + 'のタイル</strong>（' + remapCircled("④") + 'はカテゴリをまたいで移動可）・<strong>' + remapCircled("④") + 'のカテゴリ名</strong>（丸ごと移動）の3種類。'
      + '<strong>カードを並び替えると、①〜⑨の番号も新しい並び順に振り直されます。</strong>動かしたそばから本番と同じ見た目で確認できます。</p>';
    h += '<div class="actions"><button class="btn-main" data-arrange-start="1" type="button">並べ替えを開始</button>';
    if (quoteCardOrder().join(",") !== QUOTE_CARDS.join(",")) {
      h += '<button class="btn-sub" data-qc-reset="1" type="button">カードの並びを初期に戻す</button>';
    }
    if (optCategories().join(",") !== OPT_CATEGORIES.join(",")) {
      h += '<button class="btn-sub" data-oc-reset="1" type="button">カテゴリの並びを初期に戻す</button>';
    }
    h += "</div></div>";

    h += '<div class="master-plan" data-mroom="docomo"><h3>オプション・サービス（月額・ドコモ）</h3>';
    h += '<p class="hint">名称・月額・カテゴリを自由に設定できます。一括で払うもの（コーティング・手数料など）は「初期費用の定番項目」へ。金額選択式のもの（補償など）は選択肢の初期値が単価になります。<br>'
      + '「<strong>店舗独自</strong>」にチェックを入れると、<strong>「お店の商材」の「店舗独自サービス」へ移ります</strong>。見積もり画面の表示は変わりません（従来どおりカテゴリごとに並びます）。</p>';
    h += listEditor(MASTER.options, "op", optExtra, isCarrier, optChoicesHtml);
    h += '<div class="actions">'
      + '<button class="btn-sub" data-add="options" type="button">＋ ドコモの商材を追加</button></div></div>';

    h += '<div class="master-plan" data-mroom="shop"><h3>店舗独自サービス（月額）</h3>';
    h += '<p class="hint">お店で扱う月額のサービス。名称・月額・カテゴリを自由に設定でき、見積もり画面ではカテゴリごとにドコモの商材と同じ場所へ並びます。<br>'
      + '「<strong>店舗独自</strong>」のチェックを外すと「ドコモの料金」の一覧へ戻ります。</p>';
    h += listEditor(MASTER.options, "op", optExtra, isOwn, optChoicesHtml);
    h += '<div class="actions">'
      + '<button class="btn-sub" data-add="optionsOwn" type="button">＋ 店舗独自サービスを追加</button></div></div>';

    // 初期費用の定番項目（手数料・コーティング等の一括もの）
    h += '<div class="master-plan" data-mroom="docomo"><h3>初期費用の定番項目（ドコモ・手数料など）</h3>';
    h += '<p class="hint">契約時に一括で支払うもの。「' + remapCircled("⑦初期費用") + '」にチェックボックスとして表示されます。「<strong>店舗独自</strong>」にチェックを入れると「お店の商材」の一覧へ移ります。</p>';
    h += listEditor(MASTER.feeItems, "fi", feeExtra, isCarrier);
    h += '<div class="actions">'
      + '<button class="btn-sub" data-add="feeItems" type="button">＋ ドコモの商材を追加</button></div></div>';

    h += '<div class="master-plan" data-mroom="shop"><h3>初期費用の店舗独自項目（コーティングなど）</h3>';
    h += '<p class="hint">お店で扱う一括のもの。「' + remapCircled("⑦初期費用") + '」にチェックボックスとして表示されます。「<strong>店舗独自</strong>」のチェックを外すと「ドコモの料金」の一覧へ戻ります。</p>';
    h += listEditor(MASTER.feeItems, "fi", feeExtra, isOwn);
    h += '<div class="actions">'
      + '<button class="btn-sub" data-add="feeItemsOwn" type="button">＋ 店舗独自サービスを追加</button></div></div>';

    // アクセサリの定番商品
    h += '<div class="master-plan" data-mroom="shop"><h3>アクセサリの定番商品（docomo select など）</h3>';
    h += '<p class="hint">「' + remapCircled("⑥アクセサリ") + '」にタイルとして表示されます。単価は店舗の取扱商品に合わせて編集を。<br>'
      + '<strong>置き場所</strong>でカテゴリを選ぶと、「' + remapCircled("⑥アクセサリ") + '」ではなく<strong>オプションのそのカテゴリ</strong>に並びます。'
      + '一括・分割の選び方は変わりません。<strong>初期の支払い</strong>は、タイルを押したときに最初に入る払い方です。</p>';
    h += listEditor(MASTER.accessories, "ac", function (a) {
      return '<select data-ac-cat="' + a.__i + '">'
        + '<option value="">置き場所: ' + remapCircled("⑥アクセサリ") + "</option>"
        + optCategories().map(function (c) {
            return '<option value="' + c + '"' + (a.category === c ? " selected" : "") + ">置き場所: " + c + "</option>";
          }).join("")
        + "</select>"
        + '<select data-ac-pay="' + a.__i + '">'
        + ACC_PAYS.map(function (v) {
            return '<option value="' + v + '"' + (accDefaultPay(a) === v ? " selected" : "") + ">初期: " + ACC_PAY_LABELS[v] + "</option>";
          }).join("")
        + "</select>";
    });
    h += '<div class="actions"><button class="btn-sub" data-add="accessories" type="button">＋ 商品を追加</button></div></div>';

    // でんき・ガスの現在の会社と連絡先
    h += '<div class="master-plan" data-mroom="docomo"><h3>でんき・ガスの現在の会社</h3>';
    h += '<p class="hint">でんき・ガスをお申し込みのとき、<strong>いまご契約中の会社を選ぶとご連絡先が出ます</strong>。'
      + '電話番号は変わることがあるので、変わったらここで直してください。'
      + '<strong>番号が空欄の会社は、お手元の番号を登録してお使いください。</strong></p>';
    [["denki", "でんき"], ["gas", "ガス"]].forEach(function (kd) {
      var key = kd[0];
      var list = (MASTER.energyCompanies && MASTER.energyCompanies[key]) || [];
      h += '<div class="plan-sec"><span class="plan-lbl">' + kd[1] + "</span>";
      list.forEach(function (c, i) {
        h += '<div class="adhoc-row">'
          + '<button class="mv" data-en-up="' + key + ":" + i + '" type="button" aria-label="上へ"' + (i === 0 ? " disabled" : "") + ">▲</button>"
          + '<button class="mv" data-en-down="' + key + ":" + i + '" type="button" aria-label="下へ"' + (i === list.length - 1 ? " disabled" : "") + ">▼</button>"
          + '<input type="text" value="' + esc(c.name || "") + '" placeholder="会社名" data-en-name="' + key + ":" + i + '">'
          + '<input type="tel" value="' + esc(c.tel || "") + '" placeholder="連絡先（例）0120-000-000" data-en-tel="' + key + ":" + i + '">'
          + '<button class="del" data-en-del="' + key + ":" + i + '" type="button" aria-label="削除">×</button>'
          + "</div>";
      });
      h += '<div class="actions"><button class="btn-sub" data-en-add="' + key + '" type="button">＋ 会社を追加</button></div>';
      h += "</div>";
    });
    h += "</div>";

    // 実績で追う項目
    h += statsCfgHtml();

    // 料金マスタの履歴
    h += '<div class="master-plan" data-mroom="store"><h3>料金マスタの履歴</h3>';
    h += '<p class="hint">料金改定の前に戻せます。<strong>編集すると自動で控えが残り、何を変更したのかも記録されます</strong>'
      + '（編集の区切りごとに1件。続けて直しているあいだは1件にまとめます）。'
      + '「変更した内容」を開くと、変更した項目と金額の前後が分かります。'
      + '大きく変える前は、メモを付けて残しておくと分かりやすくなります（最大' + HIST_MAX + '件・古いものから消えます）。</p>';
    h += '<div class="hist-save">'
      + '<input type="text" id="histLabel" maxlength="40" placeholder="メモ（例）2026年8月の料金改定">'
      + '<button class="btn-sub" id="histSaveBtn" type="button">いまの内容を履歴に残す</button></div>';
    h += '<p class="hint" id="histMsg" hidden></p>';
    h += '<div id="histBox">' + histListHtml() + "</div>";
    h += "</div>";

    /* テンプレートの管理はマスタ設定から外した（2026-08-25）。
     * 保存・削除・並べ替えは見積もり画面のテンプレートのボタン（長押しメニュー）で
     * できるため、こちらに置く意味がなくなった。 */
    $("masterBody").innerHTML = h;
    foldifyMasterSections();
    applyMasterRoom();
    applyMasterSearch(); // 検索中に再描画されても絞り込みを維持する

    /* filter を渡すと、その条件に合う項目だけを並べる。
     * 並べ替えは同じグループの中で入れ替わるよう、相手の位置を data-*-swap で渡す。
     * 位置（data-*-name など）は元の一覧での位置をそのまま使う。 */
    function listEditor(list, prefix, extra, filter, after) {
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
          + "</div>"
          /* 見積書で名前をタップしたときに出る小窓の中身。空なら押せないままになる。
           * リンク先は店舗独自の商材だけ入力できる（ドコモの商材のURLは
           * 料金表の配信で入れ替わるため、手で書いても次の更新で戻ってしまう）。 */
          + '<div class="svc-desc-row"><label>ご案内文'
          + '<textarea rows="2" placeholder="見積書で名前を押すと出ます（任意・改行できます）" data-' + prefix + '-desc="' + i + '">'
          + esc(o.desc || "") + "</textarea></label>"
          + (o.own || prefix === "ac"
              ? '<label>リンク先<input type="url" value="' + esc(o.url || "")
                + '" placeholder="https://… （任意）" data-' + prefix + '-url="' + i + '"></label>'
                + '<label class="svc-img-pick">写真'
                + '<input type="file" accept="image/*" data-' + prefix + '-img="' + i + '"></label>'
                + (o.img
                    ? '<span class="svc-img-has"><img src="' + esc(o.img) + '" alt="">'
                      + '<button class="btn-sub" data-' + prefix + '-imgdel="' + i + '" type="button">写真を消す</button></span>'
                    : "")
              : (o.url ? '<span class="svc-desc-url">公式ページ: ' + esc(o.url) + "</span>" : ""))
          + "</div>"
          + (after ? after(o) : "");
      }).join("");
    }
    function mInput(label, path) {
      return "<label>" + label + '</label><input type="number" min="0" data-mpath="' + path + '" value="' + getPath(path) + '">';
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
  /* 爆アゲの還元ポイントを自動でセットする。
   * 手で書き換えた値は残し、自動セットのままだったものだけ追従させる。 */
  function syncBakuageAuto() {
    var stillAuto = num(state.pointBakuage) === num(state.pointBakuageAuto || 0);
    var auto = calcFor(state).bakuageAutoPt;
    if (stillAuto) {
      state.pointBakuage = auto;
      $("ptBakuage").value = auto || "";
    }
    state.pointBakuageAuto = auto;
  }
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
    syncBakuageAuto();
    renderNetSvc();
    var r = calc();
    renderDeviceOff(r);
    renderPointUse(r);
    renderSummary(r);
    renderVisitPurpose();
    renderU15();
    renderMnpBenefit();
    renderPatternTabs();
    renderIenakaWarn(r);
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
  /* 実績タブの「全担当表示」の解錠状態。管理者（マスタ設定のパスワードを知っている人）だけが
   * 全担当の実績を見られるようにするための仕切り。担当切替・ログアウトで畳む。 */
  var statsUnlocked = false;
  function statsAdminOk() {
    // ロックを何も設定していない店舗では仕切りようがないので、従来どおり全員に見せる
    return statsUnlocked || !masterGateOn();
  }
  /* 全担当の実績を「見られる」か。管理者のほかに、店舗の設定
   * （実績で追う項目 → 全担当の実績を全員に公開する）を入れた店舗では
   * 全員が見られる。件数の修正など管理の操作は statsAdminOk のまま。 */
  function statsViewAll() {
    return statsAdminOk() || !!statsCfg().openAll;
  }
  var masterGateFrom = null; // キャンセルしたときに戻る先
  /* マスタ設定のパスワードを忘れたときは、店舗ID＋店舗のパスワードで開けるようにする。
   * 店舗の資格情報のほうが上位なので、これを塞ぐと復旧手段が無くなってしまう。 */
  var masterGateFallback = false;
  /* 担当者コードの画面からマスタ設定へ入った状態。
   * このときはまだ「誰が使うか」が決まっていないため、
   * ほかのタブへ移ろうとしたら担当者コードの入力に戻す。 */
  var masterOnly = false;
  function enterMasterOnly() {
    masterOnly = anyStaffCode();
    if (masterOnly) { var sb = $("staffBar"); if (sb) sb.hidden = true; }
  }
  function masterGateAdminMode() { return adminLockEnabled() && !masterGateFallback; }
  function masterGateOn() {
    // 保守モード・上位アカウントは関門を掛けない（店舗のパスワードを知らないため。
    // 実績の全担当表示も同じ判定を使っているので、あわせて見られるようになる）
    if (superActing()) return false;
    // 社内版はログインが無いため、クラウド同期中でも関門は掛けない（従来どおり）
    return !masterUnlocked && (adminLockEnabled() || lockEnabled() || (cloudOn() && !INTERNAL));
  }
  function showMasterGate(show) {
    var el = $("masterGate");
    if (!el) return;
    el.hidden = !show;
    if (!show) return;
    var err = $("masterGateErr"); if (err) err.hidden = true;
    var pw = $("masterGatePass"); if (pw) pw.value = "";
    masterGateFallback = false;
    renderMasterGateFields();
    setTimeout(function () { if (pw) pw.focus(); }, 50);
  }
  // 「マスタ設定のパスワード」で聞くか、「店舗ID＋パスワード」で聞くかを切り替える
  function renderMasterGateFields() {
    var admin = masterGateAdminMode();
    // マスタ設定のパスワードを決めている場合は、店舗IDは使わない
    var wrap = $("masterGateIdWrap");
    if (wrap) wrap.hidden = admin;
    var forgot = $("masterGateForgot");
    if (forgot) forgot.hidden = !admin;
    var lead = $("masterGateLead");
    if (lead) {
      lead.innerHTML = admin
        ? "マスタ設定は店舗の管理者のみが開けます。<br>マスタ設定のパスワードを入力してください。"
        : "マスタ設定は店舗の管理者のみが開けます。<br>店舗IDとパスワードを入力してください。";
    }
    var pwLabel = $("masterGatePassLabel");
    if (pwLabel) pwLabel.textContent = admin ? "マスタ設定のパスワード" : "パスワード";
    var id = $("masterGateId");
    if (id) {
      id.required = !admin;
      // ログイン中の店舗IDを入れておく（クラウド利用時は変更できない）
      id.value = cloudOn() ? String(CLOUD.user.email || "").replace(/@.*$/, "")
        : (config.lock && config.lock.storeId) || "";
      id.readOnly = cloudOn();
    }
  }
  function masterGateFail(msg) {
    var err = $("masterGateErr");
    if (err) { err.textContent = msg; err.hidden = false; }
    var pw = $("masterGatePass"); if (pw) pw.value = "";
  }
  // 入力された内容を照合する（Promise<bool>）
  function masterGateVerify(id, pass) {
    // マスタ設定のパスワードを決めている場合は、そちらだけで判定する
    if (masterGateAdminMode()) {
      var al = config.adminLock;
      if (al.algo === "sha256" && lockAlgo() !== "sha256") {
        return Promise.reject(new Error("この環境では確認できません。設定したときと同じ方法（https）でお開きください。"));
      }
      return lockHash(pass, al.salt, al.algo).then(function (h) { return h === al.hash; });
    }
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
        if (!ok) {
          masterGateFail(masterGateAdminMode()
            ? "パスワードが正しくありません。"
            : "店舗IDまたはパスワードが正しくありません。");
          return;
        }
        masterUnlocked = true;
        $("masterGatePass").value = "";
        showMasterGate(false);
        // 実績タブの「全担当を表示」から来た場合は、マスタ設定ではなく実績へ戻す
        if (masterGateFrom === "stats") {
          masterGateFrom = null;
          statsUnlocked = true;
          openStats();
          return;
        }
        var fromGate = masterGateFrom === "staff";
        if (fromGate) {
          masterGateFrom = null;
          if (!config.activeStaffId) enterStaff(config.staff[0]);
        }
        switchTab("master");
        if (fromGate) enterMasterOnly();
      }, function (e2) {
        btn.disabled = false;
        masterGateFail((e2 && e2.message) || "確認できませんでした。時間をおいて再度お試しください。");
      });
    });
    $("masterGateForgot").addEventListener("click", function () {
      masterGateFallback = true;
      var err = $("masterGateErr"); if (err) err.hidden = true;
      $("masterGatePass").value = "";
      renderMasterGateFields();
      var idEl = $("masterGateId");
      setTimeout(function () { (idEl && !idEl.readOnly ? idEl : $("masterGatePass")).focus(); }, 50);
    });
    $("masterGateCancel").addEventListener("click", function () {
      showMasterGate(false);
      if (masterGateFrom === "staff") { masterGateFrom = null; showStaffGate(true); return; }
      if (masterGateFrom === "stats") { masterGateFrom = null; openStats(); return; }
      switchTab("quote");
    });
  }

  /* ---------- 電卓 ----------
   * 店頭で「これはいくら？」を確かめるための簡単な電卓。
   * 見積もりの金額とはつながっていない（数字を書き戻すことはしない）。
   * iPadのホーム画面起動（PWA）ではブラウザの電卓が使えないため、
   * アプリの中に用意しておく。 */
  var CALC = { cur: "0", prev: null, op: null, fresh: true };
  function calcFmt(n) {
    if (!isFinite(n)) return "エラー";
    // 小数は最大4桁まで（円の計算で丸めすぎないように）
    var r = Math.round(n * 10000) / 10000;
    var s2 = String(r);
    if (s2.indexOf(".") < 0) return Number(r).toLocaleString("ja-JP");
    var p2 = s2.split(".");
    return Number(p2[0]).toLocaleString("ja-JP") + "." + p2[1];
  }
  function calcRender() {
    var o = $("calcOut"), e = $("calcExpr");
    if (!o || !e) return;
    var n = parseFloat(CALC.cur);
    o.textContent = isNaN(n) ? CALC.cur : calcFmt(n);
    var sign = { "+": "＋", "-": "−", "*": "×", "/": "÷" };
    e.textContent = CALC.op ? calcFmt(CALC.prev) + " " + sign[CALC.op] : "";
  }
  function calcApply() {
    var a = num(CALC.prev), b = parseFloat(CALC.cur);
    if (isNaN(b)) b = 0;
    var r = a;
    if (CALC.op === "+") r = a + b;
    else if (CALC.op === "-") r = a - b;
    else if (CALC.op === "*") r = a * b;
    else if (CALC.op === "/") r = b === 0 ? NaN : a / b;
    return r;
  }
  function calcKey(k) {
    if (/^[0-9]$/.test(k)) {
      CALC.cur = (CALC.fresh || CALC.cur === "0") ? k : CALC.cur + k;
      CALC.fresh = false;
    } else if (k === ".") {
      if (CALC.fresh) { CALC.cur = "0."; CALC.fresh = false; }
      else if (CALC.cur.indexOf(".") < 0) CALC.cur += ".";
    } else if (k === "clear") {
      CALC.cur = "0"; CALC.prev = null; CALC.op = null; CALC.fresh = true;
    } else if (k === "back") {
      if (!CALC.fresh && CALC.cur.length > 1) CALC.cur = CALC.cur.slice(0, -1);
      else { CALC.cur = "0"; CALC.fresh = true; }
    } else if (k === "pct") {
      CALC.cur = String(parseFloat(CALC.cur) / 100);
      CALC.fresh = true;
    } else if (k === "+" || k === "-" || k === "*" || k === "/") {
      if (CALC.op !== null && !CALC.fresh) CALC.cur = String(calcApply());
      CALC.prev = parseFloat(CALC.cur);
      CALC.op = k;
      CALC.fresh = true;
    } else if (k === "=") {
      if (CALC.op !== null) {
        CALC.cur = String(calcApply());
        CALC.prev = null; CALC.op = null; CALC.fresh = true;
      }
    }
    calcRender();
  }
  // 表示中の数字に掛ける・割る（税込・税抜の計算）
  function calcTimes(v) {
    var n = parseFloat(CALC.cur);
    if (isNaN(n)) return;
    CALC.cur = String(Math.round(n * v * 10000) / 10000);
    CALC.prev = null; CALC.op = null; CALC.fresh = true;
    calcRender();
  }
  function showCalc(show) {
    var d = $("calcDlg");
    if (!d) return;
    d.hidden = !show;
    if (show) { calcRender(); calcKeepInView(); }
  }
  /* 電卓を押したまま動かせるようにする（見積もりの見たい所が隠れたときに逃がす）。
   * 置いた場所はこの端末に覚えておく（次に開いたときも同じ場所）。 */
  var CALC_POS_KEY = NS + "-calc-pos";
  function calcPlace(x, y) {
    var d = $("calcDlg"), box = $("calcBox");
    if (!d || !box) return;
    d.classList.add("calc-moved");
    box.style.left = Math.round(x) + "px";
    box.style.top = Math.round(y) + "px";
  }
  // 画面の外へ出ないように収める（端末の向きを変えたときにも呼ぶ）
  function calcKeepInView() {
    var d = $("calcDlg"), box = $("calcBox");
    if (!d || !box || !d.classList.contains("calc-moved")) {
      // 置き場所を覚えていれば、それを使う
      var sv = null;
      try { sv = JSON.parse(localStorage.getItem(CALC_POS_KEY) || "null"); } catch (e) {}
      if (sv && typeof sv.x === "number") calcPlace(sv.x, sv.y);
      else return;
    }
    var r = box.getBoundingClientRect();
    var maxX = Math.max(0, window.innerWidth - r.width - 6);
    var maxY = Math.max(0, window.innerHeight - r.height - 6);
    calcPlace(Math.min(Math.max(6, r.left), maxX), Math.min(Math.max(6, r.top), maxY));
  }
  function initCalcDrag() {
    var head = $("calcHead"), box = $("calcBox");
    if (!head || !box) return;
    var drag = null;
    head.addEventListener("pointerdown", function (e) {
      /* ✕ボタンの上では、つかむ処理を始めない。
       * つかむ処理が先に走ると、ポインタを取り込んで（setPointerCapture）
       * ✕のクリックが発火せず、PCのマウスで閉じられなくなる。 */
      if (e.target && e.target.id === "calcClose") return;
      var r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
      calcPlace(r.left, r.top);   // いまの位置から動かし始める
      try { head.setPointerCapture(e.pointerId); } catch (e2) {}
      e.preventDefault();
    });
    head.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var x = Math.min(Math.max(6, e.clientX - drag.dx), Math.max(6, window.innerWidth - drag.w - 6));
      var y = Math.min(Math.max(6, e.clientY - drag.dy), Math.max(6, window.innerHeight - drag.h - 6));
      calcPlace(x, y);
      e.preventDefault();
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      head.addEventListener(ev, function () {
        if (!drag) return;
        drag = null;
        var r = box.getBoundingClientRect();
        try { localStorage.setItem(CALC_POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch (e3) {}
      });
    });
    window.addEventListener("resize", function () {
      var d = $("calcDlg");
      if (d && !d.hidden) calcKeepInView();
    });
  }
  function initCalc() {
    var open = $("calcOpenBtn");
    if (open) open.addEventListener("click", function () { showCalc(true); });
    initCalcDrag();
    var close = $("calcClose");
    if (close) close.addEventListener("click", function () { showCalc(false); });
    var pad = $("calcPad");
    if (pad) pad.addEventListener("click", function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute("data-calc");
      if (k) calcKey(k);
    });
    var t10 = $("calcTax10");
    if (t10) t10.addEventListener("click", function () { calcTimes(1.1); });
    var tex = $("calcTaxEx");
    if (tex) tex.addEventListener("click", function () { calcTimes(1 / 1.1); });
    // キーボードでも打てるようにする（PCで使うとき）
    document.addEventListener("keydown", function (e) {
      var d = $("calcDlg");
      if (!d || d.hidden) return;
      var k = e.key;
      if (/^[0-9.]$/.test(k)) { calcKey(k); e.preventDefault(); }
      else if (k === "+" || k === "-" || k === "*" || k === "/") { calcKey(k); e.preventDefault(); }
      else if (k === "Enter" || k === "=") { calcKey("="); e.preventDefault(); }
      else if (k === "Backspace") { calcKey("back"); e.preventDefault(); }
      else if (k === "Escape") { showCalc(false); e.preventDefault(); }
    });
  }

  /* ---------- このアプリについて ----------
   * 提供元・版・商標・免責をまとめて出す。担当者コードを持たない人でも見られるよう、
   * マスタ設定ではなくヘッダーとログイン画面から開けるようにしている。 */
  function vendorInfo() {
    var v = (typeof KEITAI_VENDOR !== "undefined" && KEITAI_VENDOR) || {};
    return {
      name: v.name || "（未設定）",
      contact: v.contact || "ご契約の際にご案内します",
      hours: v.hours || ""
    };
  }
  /* 更新履歴。前回見たときの版を覚えておき、それより新しいものに印を付ける。
   * 何が変わったのかを店舗の方が自分で確かめられるようにするため。 */
  var SEEN_VER_KEY = NS + "-seen-version";
  function changelog() {
    return (typeof KEITAI_CHANGELOG !== "undefined" && KEITAI_CHANGELOG) || [];
  }
  function seenVersion() {
    try { return localStorage.getItem(SEEN_VER_KEY) || ""; } catch (e) { return ""; }
  }
  function markVersionSeen() {
    try { localStorage.setItem(SEEN_VER_KEY, APP_VERSION); } catch (e) {}
    var b = $("aboutBtn");
    if (b) b.classList.remove("has-new");
  }
  // 前回見た版より新しい項目の数（初めて使う端末では0）
  function newSinceSeen() {
    var seen = seenVersion();
    if (!seen) return 0;
    var log = changelog();
    var at = -1;
    log.forEach(function (e, i) { if (at < 0 && e.v === seen) at = i; });
    if (at < 0) return 0;   // 覚えている版が履歴に無い場合は印を付けない
    return at;
  }
  function changelogHtml() {
    var log = changelog();
    if (!log.length) return '<p class="hint">更新履歴はありません。</p>';
    var newCount = newSinceSeen();
    return log.map(function (e, i) {
      return '<div class="log-entry' + (i < newCount ? " is-new" : "") + '">'
        + '<div class="log-head">' + esc(e.v)
        + (i < newCount ? '<span class="log-new">新着</span>' : "")
        + '<span class="log-date">' + esc(e.d || "") + "</span></div>"
        + "<ul>" + (e.items || []).map(function (x) {
            // 履歴の本文は自前の文（changelog.js）だけなので、<b>だけ許可して戻す
            return "<li>" + esc(x).replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>") + "</li>";
          }).join("") + "</ul>"
        + "</div>";
    }).join("");
  }
  /* ---------- 規約などの文書 ----------
   * Markdownのまま開くと、ブラウザによってはダウンロードになり、
   * 表示できても記号がそのまま見えてしまう。アプリの中で整形して出す。 */
  function mdInline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function mdTable(rows) {
    var cells = rows.map(function (r) {
      return r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); });
    });
    var out = "<table>";
    cells.forEach(function (c, i) {
      // 2行目の「---|---」は区切り線なので出さない
      if (i === 1 && c.every(function (x) { return /^:?-{2,}:?$/.test(x); })) return;
      var tag = i === 0 ? "th" : "td";
      out += "<tr>" + c.map(function (x) { return "<" + tag + ">" + mdInline(x) + "</" + tag + ">"; }).join("") + "</tr>";
    });
    return out + "</table>";
  }
  function mdToHtml(src) {
    var lines = String(src).replace(/\r/g, "").split("\n");
    var h = "", list = null, i, L, m;
    function closeList() { if (list) { h += "</" + list + ">"; list = null; } }
    for (i = 0; i < lines.length; i++) {
      L = lines[i];
      if (/^\s*$/.test(L)) { closeList(); continue; }
      if ((m = L.match(/^(#{1,4})\s+(.*)$/))) {
        closeList();
        var lv = Math.min(m[1].length + 1, 5);
        h += "<h" + lv + ">" + mdInline(m[2]) + "</h" + lv + ">";
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(L)) { closeList(); h += "<hr>"; continue; }
      if ((m = L.match(/^\s*>\s?(.*)$/))) {
        closeList(); h += "<blockquote>" + mdInline(m[1]) + "</blockquote>"; continue;
      }
      if (/^\s*\|/.test(L)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        i--;
        closeList(); h += mdTable(rows); continue;
      }
      if ((m = L.match(/^\s*[-*]\s+(.*)$/))) {
        if (list !== "ul") { closeList(); h += "<ul>"; list = "ul"; }
        h += "<li>" + mdInline(m[1]) + "</li>"; continue;
      }
      if ((m = L.match(/^\s*\d+\.\s+(.*)$/))) {
        if (list !== "ol") { closeList(); h += "<ol>"; list = "ol"; }
        h += "<li>" + mdInline(m[1]) + "</li>"; continue;
      }
      closeList();
      h += "<p>" + mdInline(L) + "</p>";
    }
    closeList();
    return h;
  }
  var DOC_CACHE = {};
  function openDoc(file, title) {
    var ov = $("docOverlay");
    if (!ov) return;
    $("docTitle").textContent = title;
    var body = $("docBody");
    ov.hidden = false;
    if (DOC_CACHE[file]) { body.innerHTML = DOC_CACHE[file]; body.scrollTop = 0; return; }
    body.innerHTML = '<p class="hint">読み込んでいます…</p>';
    fetch(file, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (t) {
        DOC_CACHE[file] = mdToHtml(t);
        body.innerHTML = DOC_CACHE[file];
        body.scrollTop = 0;
      })
      .catch(function () {
        body.innerHTML = '<p class="hint">読み込めませんでした。通信環境をご確認のうえ、もう一度お試しください。</p>';
      });
  }
  function showAbout(show) {
    var el = $("aboutOverlay");
    if (!el) return;
    if (show) {
      var v = vendorInfo();
      var rows = [
        ["アプリ名", "フロントーク（料金見積もりシミュレーション）"],
        ["アプリ版", APP_VERSION],
        ["料金データ基準日", MASTER.updated],
        ["提供元", v.name],
        ["お問い合わせ", v.contact]
      ];
      if (v.hours) rows.push(["受付時間", v.hours]);
      $("aboutMeta").innerHTML = rows.map(function (r) {
        return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
      }).join("");
      var n = newSinceSeen();
      var lb = $("aboutLogBtn");
      if (lb) lb.textContent = n > 0 ? "更新履歴（新着 " + n + "件）" : "更新履歴を見る";
      $("aboutLogBox").innerHTML = changelogHtml();
      $("aboutLogBox").hidden = n === 0;   // 新しい版があるときは開いた状態で出す
    }
    el.hidden = !show;
    if (!show) markVersionSeen();
  }
  /* ---------- イエナカ見積もりへの移動 ----------
   * 同じサイトの別アプリなので、店舗名・担当者名・お客様名を引き渡して、
   * 移った先で入力し直さなくて済むようにする。
   * 受け渡しは localStorage（同一オリジンのため読める）。一度読んだら消える。 */
  var HANDOFF_KEY = NS + "-handoff-v1";
  function initIenakaLink() {
    var a = $("toIenaka");
    if (!a) return;
    /* イエナカ単体版は製品の提供内容から外した（2026-08-20）。
     * 社内版は /ienaka/ がこれまでどおり動くので、リンクは社内版だけに出す。
     * ★ 単体版を製品に戻すときは、次の2行を消し、tools/build-product.js の
     *   同梱も戻す（あちらにも目印コメントがある）。 */
    if (!INTERNAL) { a.hidden = true; return; }
    a.addEventListener("click", function () {
      var st = activeStaff();
      try {
        localStorage.setItem(HANDOFF_KEY, JSON.stringify({
          storeName: config.storeName || "",
          storeTel: config.storeTel || "",
          staffName: (st && st.name) || "",
          custName: (state && state.custName) || "",
          from: "keitai", at: Date.now()
        }));
      } catch (e) {}
      // リンクの既定の動作でそのまま移動する
    });
  }
  /* イエナカ見積もりから戻ってきたときは、担当者コードの入力を省く。
   * 同じ端末で数分前まで使っていた担当者なので、聞き直す意味がない。
   * 作りかけの見積もりは消さない（同じお客様の続きのため、enterStaff に fresh を渡さない）。 */
  function takeHandoffFromIenaka() {
    var raw = null;
    try { raw = localStorage.getItem(HANDOFF_KEY); } catch (e) {}
    if (!raw) return false;
    var d = null;
    try { d = JSON.parse(raw); } catch (e) {}
    if (!d || d.from !== "ienaka") return false;   // 自分が書いたものは読まない
    try { localStorage.removeItem(HANDOFF_KEY); } catch (e) {}
    if (!d.at || Date.now() - d.at > 10 * 60 * 1000) return false;
    var hit = config.staff.filter(function (s) { return (s.name || "") === d.staffName; })[0];
    if (!hit) return false;   // 登録が無い担当者なら、いつもどおりコードを聞く
    enterStaff(hit);
    if (d.custName && state && !state.custName) {
      state.custName = d.custName;
      var ce = $("custName");
      if (ce) ce.value = d.custName;
      saveState();
    }
    return true;
  }
  function initDocs() {
    var ov = $("docOverlay");
    if (!ov) return;
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var f = t.getAttribute("data-doc");
      if (f) { openDoc(f, t.getAttribute("data-doc-title") || t.textContent); return; }
      if (t.id === "docClose") ov.hidden = true;
    });
  }
  function initAbout() {
    ["aboutBtn", "aboutFromLogin"].forEach(function (id) {
      var b = $(id);
      if (b) b.addEventListener("click", function () { showAbout(true); });
    });
    $("aboutClose").addEventListener("click", function () { showAbout(false); });
    $("aboutLogBtn").addEventListener("click", function () {
      var box = $("aboutLogBox");
      box.hidden = !box.hidden;
    });
    // 前回開いたときより新しくなっていたら、情報ボタンに印を付ける
    if (seenVersion() && seenVersion() !== APP_VERSION) {
      var ab = $("aboutBtn");
      if (ab) ab.classList.add("has-new");
    }
    if (!seenVersion()) markVersionSeen(); // 初めて使う端末では印を付けない
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") showAbout(false);
    });
  }

  /* ---------- 使い方の案内（チュートリアル） ----------
   * 「見積書を開いた時点が提案として控えられる」というかんたん記録の要は、
   * 説明が無いと気づけないため、端末ごとに初回だけ自動で出す。
   * 以前はマスコットが案内する形だったが、2026-08-18 にキャラクターを外した
   * （画像は keitai-app/img/ に残してある。戻すときはそこから）。 */
  var TOUR_KEY = NS + "-tour-done-v1";
  var TOUR_STEPS = [
    { t: "使い方をかんたんにご案内します。見積もり画面は、①から⑨を上から入れていくだけです。月々のお支払いがその場で出ます。ご家族の複数台は、回線1・回線2・回線3に分けて入れてください。" },
    { t: "できあがったら「見積書」タブへ。印刷やPDF保存ができ、文字サイズも大・中・小から選べます。見積書を開いた時点の内容が「ご提案」として自動で控えられます（操作は不要です）。" },
    { t: "応対が終わったら、画面下の「成約」か「見送り」を1回押すだけで実績に入ります。次のお客様の前には「入力をクリア」をお忘れなく。" },
    { t: "「実績」タブでは、担当別・項目別に提案と成約が見られ、CSVで保存もできます。どの項目を数えるかは、マスタ設定の「実績で追う項目」で選べます。" },
    { t: "わからなくなったら、ヘッダーの「情報」からこの案内をもう一度見られます。それでは、よい接客を。" }
  ];
  var tourStep = 0;
  function renderTourStep() {
    var st = TOUR_STEPS[tourStep];
    $("tourText").textContent = st.t;
    $("tourDots").innerHTML = TOUR_STEPS.map(function (x, i) {
      return "<span" + (i === tourStep ? ' class="on"' : "") + "></span>";
    }).join("");
    $("tourNext").textContent = tourStep === TOUR_STEPS.length - 1 ? "はじめる！" : "次へ";
    $("tourSkip").hidden = tourStep === TOUR_STEPS.length - 1;
  }
  function showTour() {
    tourStep = 0;
    var ov = $("tourOverlay");
    if (!ov) return;
    ov.hidden = false;
    renderTourStep();
  }
  function endTour() {
    $("tourOverlay").hidden = true;
    try { localStorage.setItem(TOUR_KEY, "1"); } catch (e) {}
  }
  function maybeStartTour() {
    var done = "";
    try { done = localStorage.getItem(TOUR_KEY) || ""; } catch (e) {}
    if (done) return;
    // ログイン・初期設定・担当者コードなどの画面が出ている間は出さない
    var busy = ["loginOverlay", "setupOverlay", "staffOverlay", "masterGate", "tourOverlay", "contractOverlay"].some(function (id) {
      var el = $(id);
      return el && !el.hidden;
    });
    if (busy || masterOnly) return;
    showTour();
  }
  /* 実績は保存タブの中にしまってある（お客様に見える所に「実績」の文字を出さないため）。
   * ここを通ると保存タブへ移動し、実績のパネルを開いて読み込む。 */
  function openStats() {
    switchTab("saved");
    var p = $("statsPanel");
    if (p) p.hidden = false;
    var b = $("statsOpenBtn");
    if (b) b.textContent = "実績を閉じる";
    renderStats(true);
  }
  function initTour() {
    $("tourNext").addEventListener("click", function () {
      if (tourStep >= TOUR_STEPS.length - 1) { endTour(); return; }
      tourStep++;
      renderTourStep();
    });
    $("tourSkip").addEventListener("click", endTour);
    var tb = $("aboutTourBtn");
    if (tb) tb.addEventListener("click", function () { showAbout(false); showTour(); });
  }

  /* ---------- 見積書の文字サイズ（大・中・小） ----------
   * お客様に画面のまま見せるとき・印刷するときの文字の大きさを選べる。
   * 端末ごとの設定（印刷する端末で選べばよいので同期しない）。 */
  var SHEET_FS_KEY = NS + "-sheet-fs";
  function applySheetFs(v) {
    var el = $("tab-sheet");
    if (!el) return;
    el.classList.remove("fs-l", "fs-s");
    if (v === "l") el.classList.add("fs-l");
    if (v === "s") el.classList.add("fs-s");
  }
  function initSheetFs() {
    var v = "m";
    try { v = localStorage.getItem(SHEET_FS_KEY) || "m"; } catch (e) {}
    var r = document.querySelector('input[name="sheetFs"][value="' + v + '"]');
    if (r) r.checked = true;
    applySheetFs(v);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="sheetFs"]'), function (el) {
      el.addEventListener("change", function () {
        if (!this.checked) return;
        applySheetFs(this.value);
        try { localStorage.setItem(SHEET_FS_KEY, this.value); } catch (e) {}
      });
    });
  }

  /* ---------- お客様提示モード ----------
   * 見積書タブで、操作ボタン類を隠して見積書だけを大きく見せる。
   * お客様に画面を向けて説明するときに使う。終了は右下のボタンかEscキー。 */
  function initPresent() {
    var b = $("presentBtn"), x = $("presentExit");
    if (!b || !x) return;
    function end() { document.body.classList.remove("present"); x.hidden = true; }
    b.addEventListener("click", function () {
      document.body.classList.add("present");
      x.hidden = false;
      window.scrollTo(0, 0);
    });
    x.addEventListener("click", end);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") end(); });
  }

  /* ---------- マスタ設定の検索 ----------
   * 項目名で行を絞り込む。プラン・オプション・商材・アクセサリ・でんきガスの行が対象。 */
  function applyMasterSearch() {
    var inp = $("masterSearch");
    if (!inp) return;
    var q = inp.value.trim().toLowerCase();
    var rows = document.querySelectorAll("#masterBody .adhoc-row, #masterBody .plan-edit");
    Array.prototype.forEach.call(rows, function (r2) {
      if (!q) { r2.hidden = false; return; }
      var t = (r2.textContent || "").toLowerCase();
      // 名称は入力欄の中にあるため value も見る
      Array.prototype.forEach.call(r2.querySelectorAll('input[type="text"]'), function (i2) {
        t += " " + (i2.value || "").toLowerCase();
      });
      r2.hidden = t.indexOf(q) < 0;
    });
    // 検索中はたたんだ項目も開き、全部屋を表示する（結果を隠さないため）。
    // 空にしたら開閉状態・選んでいた部屋に戻す
    applyMasterFoldState();
    applyMasterRoom();
  }
  function initMasterSearch() {
    var inp = $("masterSearch");
    if (inp) inp.addEventListener("input", applyMasterSearch);
  }

  /* ---------- マスタ構成の取り込み ----------
   * 「現在のマスタ構成をコピー」した文字列を貼り付けて、この端末（店舗）の
   * 料金マスタを置き換える。取り込む前の内容は履歴に残す。 */
  /* ---------- 端末マスタ（商品マスタ）----------
   * 代理店からもらった「機種名と本体価格の一覧」を取り込み、
   * 見積もりの機種名をプルダウンにして本体代金を自動で入れる。
   * MASTER に持たせるので、料金マスタと同じくクラウドで他の端末にも同期される。
   * 取り込んでいない店舗は、これまでどおり手入力で使える。 */
  function deviceMaster() {
    return (MASTER && Array.isArray(MASTER.devices)) ? MASTER.devices : [];
  }
  /* いつでもカエドキプログラムの「23回分の総額」は、同じ機種でも
   * 手続き（機種変更／MNP／新規）で変わることがある。
   * 端末マスタに手続きごとの金額を入れられるようにし、
   * 入っていない手続きは共通の値（kaedoki23）を使う。 */
  var DEV_K23_BY_PROC = { mnp: "kaedoki23Mnp", shinki: "kaedoki23Shinki" };
  function devKaedoki23(d, proc) {
    if (!d) return null;
    var k = DEV_K23_BY_PROC[proc];
    if (k && typeof d[k] === "number") return num(d[k]);
    return (typeof d.kaedoki23 === "number") ? num(d.kaedoki23) : null;
  }
  // いま入力されている機種名と同じ登録を返す（手続きを変えたときの入れ替えに使う）
  function devByName(name) {
    var n = String(name || "").trim();
    if (!n) return null;
    return deviceMaster().filter(function (d) { return String(d.name || "").trim() === n; })[0] || null;
  }
  /* CSV・TSVを1行1機種で読む。列は「機種名」と「本体価格」があればよい。
   * 見出し行・「円」・カンマ・全角数字は自動で外す。
   * 1行目が見出しで「頭金」「23回」などの列があれば、それも読む。
   * 見出しが無いときは、代理店のCSVに在庫数などの数字が入っていることが
   * あるので、本体価格（最初の数字）だけを読む。 */
  function devDigits(v) {
    return String(v).replace(/[，,円\s]/g, "")
      .replace(/[０-９]/g, function (z) { return String.fromCharCode(z.charCodeAt(0) - 0xFEE0); });
  }
  function parseDeviceText(text) {
    var out = [], skipped = 0;
    var head = null;   // 見出しがあれば {price, atamakin, kaedoki23} の列番号
    String(text || "").split(/\r\n|\r|\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var cols = (line.indexOf("\t") >= 0 ? line.split("\t") : splitCsvLine(line))
        .map(function (c) { return String(c).replace(/^"|"$/g, "").trim(); });
      if (cols.length < 2) { skipped++; return; }
      // 見出し行は読み飛ばす（どの列が何かはここで覚える）
      if (i === 0 && !/\d/.test(cols.join("").replace(/23/g, ""))) {
        head = {};
        cols.forEach(function (c, j) {
          if (j === 0) return;
          var k23col = /(23|カエドキ|残価)/.test(c);
          if (head.atamakin === undefined && /頭金/.test(c)) head.atamakin = j;
          // 「MNP残価」「新規23回分」のように手続きが書いてある列は、その手続きの金額として読む
          else if (head.kaedoki23Mnp === undefined && k23col && /(MNP|ＭＮＰ|のりかえ|乗り換え|乗換)/i.test(c)) head.kaedoki23Mnp = j;
          else if (head.kaedoki23Shinki === undefined && k23col && /新規/.test(c)) head.kaedoki23Shinki = j;
          else if (head.kaedoki23 === undefined && k23col) head.kaedoki23 = j;
          else if (head.price === undefined && /(本体|価格|代金|機種代|金額)/.test(c)) head.price = j;
        });
        return;
      }
      var name = cols[0];
      var price = 0, found = false;
      if (head && head.price !== undefined && /^\d+$/.test(devDigits(cols[head.price] || ""))) {
        price = parseInt(devDigits(cols[head.price]), 10);
        found = true;
      } else {
        for (var j = 1; j < cols.length; j++) {
          var v = devDigits(cols[j]);
          if (!/^\d+$/.test(v)) continue;
          /* 「145,200」のように、桁区切りのカンマで列が割れている場合をつなぎ直す。
           * 先頭が1〜3桁で、続く列がちょうど3桁の数字なら同じ金額とみなす。 */
          while (/^\d{1,3}$/.test(v) && j + 1 < cols.length && /^\d{3}$/.test(devDigits(cols[j + 1]))) {
            v += devDigits(cols[j + 1]);
            j++;
          }
          price = parseInt(v, 10);
          found = true;
          break;
        }
      }
      if (!name || !found) { skipped++; return; }
      if (name.length > 60) name = name.slice(0, 60);
      var rec = { name: name, price: price };
      if (head) {
        ["atamakin", "kaedoki23", "kaedoki23Mnp", "kaedoki23Shinki"].forEach(function (k) {
          if (head[k] === undefined) return;
          var v2 = devDigits(cols[head[k]] || "");
          if (/^\d+$/.test(v2)) rec[k] = parseInt(v2, 10);
        });
      }
      out.push(rec);
    });
    return { list: out, skipped: skipped };
  }
  // 「a,"b,c",d」のような引用符付きCSVを1行分に分ける
  function splitCsvLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === "," ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function renderDeviceMaster() {
    var list = deviceMaster();
    var cnt = $("devMasterCount");
    if (cnt) {
      cnt.textContent = list.length
        ? "いま登録されている機種: " + list.length + "件"
        : "まだ登録がありません（機種名は手入力です）";
    }
    /* 一覧の下見は、件数が多くて1つずつの編集を出せないときだけ。
     * 少ないときは下の編集の表と同じ中身になり、二重に出てしまう。 */
    var wrap = $("devMasterPreview"), tb = $("devMasterTable");
    if (wrap && tb) {
      wrap.hidden = list.length <= DEV_EDIT_MAX;
      if (!wrap.hidden) {
        var head = "<tr><th>機種名</th><th>本体価格</th><th>店頭頭金</th><th>23回分の総額</th></tr>";
        function cell9(v) { return "<td>" + (typeof v === "number" ? yen(v) : "－") + "</td>"; }
        var rows = list.slice(0, 8).map(function (d) {
          return "<tr><td>" + esc(d.name) + "</td><td>" + yen(d.price) + "</td>"
            + cell9(d.atamakin) + cell9(d.kaedoki23) + "</tr>";
        }).join("");
        if (list.length > 8) {
          rows += '<tr><td colspan="4">ほか ' + (list.length - 8) + "件</td></tr>";
        }
        tb.innerHTML = head + rows;
      }
    }
    renderDeviceEdit();
    renderDeviceSelect();
  }
  /* 「よく出る機種」を1つずつ登録する表。
   * 商品マスタを丸ごと取り込むと、価格が変わるたびに入れ替えが要る。
   * よくご案内する機種だけを手で持てるようにして、金額はここで直す。
   * 取り込みで件数が多くなっている店舗では、1つずつの編集は出さない
   * （入力欄が数百個になり、設定画面が重くなるため）。 */
  var DEV_EDIT_MAX = 60;
  function renderDeviceEdit() {
    var tb = $("devMasterEditTable"), note = $("devMasterEditNote"), add = $("devMasterAdd");
    if (!tb) return;
    var list = deviceMaster();
    var many = list.length > DEV_EDIT_MAX;
    if (note) {
      note.hidden = !many;
      note.textContent = many
        ? "登録が " + list.length + "件と多いため、ここでの1つずつの編集は出していません。"
          + "入れ替えるときは、上の取り込みをお使いください。"
        : "";
    }
    if (add) add.hidden = many;
    if (many) { tb.innerHTML = ""; tb.hidden = true; return; }
    tb.hidden = false;
    var h = "<tr><th>機種名</th><th>本体代金</th><th>店頭頭金</th>"
      + "<th>23回分の総額<br><small>（カエドキ）</small></th>"
      + "<th>23回分の総額<br><small>MNPのとき</small></th>"
      + "<th>23回分の総額<br><small>新規のとき</small></th><th></th></tr>";
    if (!list.length) {
      h += '<tr class="dev-empty"><td colspan="7">まだ登録がありません。「機種を追加」から入れてください。</td></tr>';
    }
    /* 頭金・23回分の総額は、入れたときだけ見積もりに入る。
     * 空のままなら、機種を選んでもその欄はいまの入力のまま。 */
    function devCell(d, i, k) {
      var v = (typeof d[k] === "number") ? d[k] : "";
      return '<td><input type="number" data-devfield="' + k + '" data-devi="' + i + '"'
        + ' min="0" inputmode="numeric" placeholder="未設定" value="' + v + '"> 円</td>';
    }
    list.forEach(function (d, i) {
      h += "<tr><td>"
        + '<input type="text" data-devfield="name" data-devi="' + i + '" value="' + esc(d.name || "") + '" placeholder="例) iPhone 17 128GB"></td>'
        + '<td><input type="number" data-devfield="price" data-devi="' + i + '" min="0" inputmode="numeric" value="' + (num(d.price) || 0) + '"> 円</td>'
        + devCell(d, i, "atamakin")
        + devCell(d, i, "kaedoki23")
        + devCell(d, i, "kaedoki23Mnp")
        + devCell(d, i, "kaedoki23Shinki")
        + '<td class="dev-del"><button class="btn-sub" type="button" data-devdel="' + i + '">削除</button></td></tr>';
    });
    tb.innerHTML = h;
  }
  // 見積もり画面の機種プルダウン（端末マスタがあるときだけ出す）
  function renderDeviceSelect() {
    var fld = $("deviceSelectField"), sel = $("deviceSelect");
    if (!fld || !sel) return;
    var list = deviceMaster();
    fld.hidden = !list.length;
    if (!list.length) return;
    sel.innerHTML = '<option value="">（手入力）</option>'
      + list.map(function (d, i) {
          return '<option value="' + i + '">' + esc(d.name) + "　" + yen(d.price) + "</option>";
        }).join("");
    // いまの入力と同じ機種名があれば選んだ状態にする
    var hit = -1;
    list.forEach(function (d, i) { if (hit < 0 && d.name === state.deviceName) hit = i; });
    sel.value = hit >= 0 ? String(hit) : "";
  }
  function initDeviceMaster() {
    var file = $("devMasterFile"), pasteBtn = $("devMasterPasteBtn"), wrap = $("devMasterPasteWrap"),
        box = $("devMasterBox"), go = $("devMasterGo"), cancel = $("devMasterCancel"),
        clear = $("devMasterClear"), msg = $("devMasterMsg"), sel = $("deviceSelect");
    function say(t, err) {
      if (!msg) return;
      msg.textContent = t;
      msg.hidden = false;
      msg.style.color = err ? "#C62828" : "";
    }
    function take(text) {
      var r = parseDeviceText(text);
      if (!r.list.length) {
        say("読み取れる行がありませんでした。1行に「機種名」と「本体価格」が並んでいるかご確認ください。", true);
        return;
      }
      if (!window.confirm(r.list.length + "件の機種を取り込みます。いまの端末マスタは置き換わります。よろしいですか？")) return;
      histSettle();
      var back = histAdd("端末マスタの取り込み前", JSON.stringify(MASTER), true);
      MASTER.devices = r.list;
      saveMaster();
      histAttachChanges(back, JSON.stringify(MASTER));
      histMark();
      renderDeviceMaster();
      say(r.list.length + "件を取り込みました。"
        + (r.skipped ? "（読み取れなかった " + r.skipped + "行は飛ばしました）" : "")
        + "見積もりの機種名がプルダウンになります。");
      if (wrap) { wrap.hidden = true; box.value = ""; }
    }
    if (file) {
      file.addEventListener("change", function () {
        var f = this.files && this.files[0];
        this.value = "";
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () { take(String(rd.result || "")); };
        rd.onerror = function () { say("ファイルを読み込めませんでした。", true); };
        /* 代理店のCSVはShift_JISのことが多い。まずUTF-8で読み、
         * 文字化けの記号が出たらShift_JISで読み直す。 */
        rd.readAsText(f, "UTF-8");
        rd.onload = function () {
          var t = String(rd.result || "");
          if (t.indexOf("\uFFFD") >= 0) {
            var rd2 = new FileReader();
            rd2.onload = function () { take(String(rd2.result || "")); };
            rd2.onerror = function () { take(t); };
            try { rd2.readAsText(f, "Shift_JIS"); } catch (e) { take(t); }
            return;
          }
          take(t);
        };
      });
    }
    if (pasteBtn && wrap) {
      pasteBtn.addEventListener("click", function () {
        wrap.hidden = !wrap.hidden;
        if (msg) msg.hidden = true;
        if (!wrap.hidden) box.focus();
      });
      cancel.addEventListener("click", function () { wrap.hidden = true; box.value = ""; });
      go.addEventListener("click", function () { take(box.value); });
    }
    if (clear) {
      clear.addEventListener("click", function () {
        if (!deviceMaster().length) { say("端末マスタはまだ取り込まれていません。"); return; }
        if (!window.confirm("端末マスタを削除します。機種名は手入力に戻ります。よろしいですか？")) return;
        histSettle();
        var back = histAdd("端末マスタの削除前", JSON.stringify(MASTER), true);
        delete MASTER.devices;
        saveMaster();
        histAttachChanges(back, JSON.stringify(MASTER));
        histMark();
        renderDeviceMaster();
        say("削除しました。");
      });
    }
    /* よく出る機種の表。打っている最中に描き直すと入力欄から
     * カーソルが外れるので、文字の入力では描き直さない。 */
    var edit = $("devMasterEdit");
    if (edit) {
      edit.addEventListener("input", function (e) {
        var t = e.target, f = t.getAttribute && t.getAttribute("data-devfield");
        if (!f) return;
        var i = parseInt(t.getAttribute("data-devi"), 10);
        var list = MASTER.devices || (MASTER.devices = []);
        if (!list[i]) return;
        if (f === "name") list[i].name = t.value;
        else if (f === "price") list[i].price = Math.max(0, num(t.value));
        else if (String(t.value).trim() === "") delete list[i][f];   // 空欄は「未設定」
        else list[i][f] = Math.max(0, num(t.value));
        markEdited();
        renderDeviceSelect();
      });
      edit.addEventListener("click", function (e) {
        var t = e.target;
        var del = t.getAttribute && t.getAttribute("data-devdel");
        if (del !== null && del !== undefined) {
          var i2 = parseInt(del, 10);
          var l2 = MASTER.devices || [];
          if (!l2[i2]) return;
          if (!window.confirm("「" + (l2[i2].name || "（名前なし）") + "」を削除します。よろしいですか？")) return;
          l2.splice(i2, 1);
          if (!l2.length) delete MASTER.devices;
          markEdited();
          renderDeviceMaster();
          return;
        }
        if (t.id === "devMasterAdd") {
          var l3 = MASTER.devices || (MASTER.devices = []);
          if (l3.length >= DEV_EDIT_MAX) {
            window.alert("登録できるのは " + DEV_EDIT_MAX + "件までです。");
            return;
          }
          l3.push({ name: "", price: 0 });
          markEdited();
          renderDeviceMaster();
          var ins = edit.querySelectorAll('[data-devfield="name"]');
          if (ins.length) ins[ins.length - 1].focus();
        }
      });
    }
    if (sel) {
      sel.addEventListener("change", function () {
        var list = deviceMaster();
        var d = this.value === "" ? null : list[parseInt(this.value, 10)];
        if (!d) return;                      // 「手入力」を選んだときは今の入力のまま
        state.deviceName = d.name;
        state.devicePrice = num(d.price);
        $("deviceName").value = state.deviceName;
        $("devicePrice").value = state.devicePrice || "";
        /* 頭金・23回分の総額は、その機種の条件として入れ直す。
         * 端末マスタが空のときは既定に戻す（前に選んだ機種の頭金が
         * そのまま残ると、別の機種の金額として出てしまうため）。 */
        state.atamakin = (typeof d.atamakin === "number") ? num(d.atamakin)
          : (autoFeeProc(state.procType) ? num(MASTER.fees.atamakin_default) : 0);
        $("atamakin").value = state.atamakin || "";
        var k23 = devKaedoki23(d, state.procType);
        state.kaedoki23 = (k23 === null) ? 0 : k23;
        $("kaedoki23").value = state.kaedoki23 || "";
        saveState();
        recalc();
      });
    }
    renderDeviceMaster();
  }

  function initImportMaster() {
    var btn = $("importMasterBtn"), wrap = $("importMasterWrap"), box = $("importMasterBox"),
        go = $("importMasterGo"), cancel = $("importMasterCancel"), msg = $("importMasterMsg");
    if (!btn || !wrap) return;
    function say(t, err) {
      msg.textContent = t;
      msg.hidden = false;
      msg.style.color = err ? "#C62828" : "";
    }
    btn.addEventListener("click", function () {
      wrap.hidden = !wrap.hidden;
      msg.hidden = true;
      if (!wrap.hidden) box.focus();
    });
    cancel.addEventListener("click", function () {
      wrap.hidden = true;
      box.value = "";
      msg.hidden = true;
    });
    go.addEventListener("click", function () {
      var d = null;
      try { d = JSON.parse(box.value); } catch (e) {}
      if (!d) {
        say("貼り付けた内容が読み取れません。「現在のマスタ構成をコピー」した内容を、そのまま貼り付けてください。", true);
        return;
      }
      var verr = validateMasterObj(d);
      if (verr) { say("取り込めません（" + verr + "）。", true); return; }
      if (!window.confirm("貼り付けた内容で料金マスタを置き換えます。\nいまの内容は履歴に残るので、あとから戻せます。よろしいですか？")) return;
      histSettle();
      var back = histAdd("取り込み前の内容", JSON.stringify(MASTER), true);
      lsSet(MASTER_KEY, JSON.stringify(d));
      loadMaster();
      histAttachChanges(back, JSON.stringify(MASTER));
      histMark();
      renderMasterTab();
      renderPlanSelect(); renderVoiceSelect(); renderMailOpt();
      renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
      renderCampaigns(); renderDiscountHint();
      syncFormFromState();
      recalc();
      box.value = "";
      wrap.hidden = true;
      say("取り込みました。前の内容は「料金マスタの履歴」から戻せます。クラウド利用時は他の端末にも同期されます。");
    });
  }

  /* ---------- タブ ---------- */
  function switchTab(name) {
    // 担当者が決まっていないままマスタ設定から出ようとしたら、コードを入れてもらう
    if (masterOnly && name !== "master") {
      masterOnly = false;
      // 設定中にコードを全部消した場合は聞きようがないので、そのまま通す
      if (anyStaffCode()) {
        switchTab("quote");
        clearActiveStaff();
        showStaffGate(true);
        return;
      }
    }
    if (name === "master" && masterGateOn()) { showMasterGate(true); return; }
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab-page").forEach(function (pg) {
      pg.classList.toggle("active", pg.id === "tab-" + name);
    });
    // マスタ設定を開いている間はタブを出さない。
    // 出口は「← 担当者の選択に戻る」だけにして、担当者を決めずに見積もりへ移れないようにする
    var nav = $("tabsNav");
    if (nav) nav.hidden = (name === "master");
    if (name === "sheet") { markPropOpened(); renderSheet(); }
    if (name === "staff") renderStaffSheet();
    if (name === "master") { histMark(); histLoadCloud(); renderMasterTab(); }
    else histSettle();
    if (name === "saved") { renderSaved(); $("saveQuoteName").placeholder = savedDefaultName(); }

    // 見積もり・見積書のどちらでも実績を記録できるよう、まとめバーは両方で出す
    $("summaryBar").style.display = (name === "quote" || name === "sheet") ? "" : "none";
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
    return optCategories().map(function (cat) {
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
    var prefix = root.getAttribute("data-sorter");
    /* ①〜⑨のカードと④のカテゴリは、MASTERの並び配列へ書き戻す */
    if (prefix === "qc" || prefix === "oc") {
      var ids = [];
      Array.prototype.forEach.call(root.querySelectorAll(".sort-chip"), function (c) {
        ids.push(c.getAttribute("data-sid"));
      });
      if (prefix === "qc") {
        var qo = ids.filter(function (k) { return QUOTE_CARDS.indexOf(k) >= 0; });
        if (qo.join(",") === QUOTE_CARDS.join(",")) delete MASTER.quoteCardOrder;
        else MASTER.quoteCardOrder = qo;
        markEdited();
        applyQuoteCardOrder();
      } else {
        var co = ids.filter(function (c2) { return OPT_CATEGORIES.indexOf(c2) >= 0; });
        if (co.join(",") === OPT_CATEGORIES.join(",")) delete MASTER.optCatOrder;
        else MASTER.optCatOrder = co;
        markEdited();
        renderOptionList();
      }
      recalc();
      renderMasterTab();
      return;
    }
    var def = SORT_LISTS[prefix];
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

  /* ---------- 並べ替えモード（UI・タイル変更） ----------
   * 本物の見積もり画面の上で、カード（①〜⑨）・④のカテゴリ見出し・
   * タイル（④・⑥・⑦）を長押しでつかんで並べ替える。
   * iPhoneのホーム画面のアイコン並べ替えと同じ考え方。
   * モード中は金額入力やチェックは効かせない（動かす専用）。 */
  var arrangeOn = false;
  var arrangeWasMasterOnly = false;
  var ARR = { kind: "", el: null, pair: null, ghost: null, timer: null, active: false, x0: 0, y0: 0 };
  function arrangeBarShow(show) {
    var bar = document.getElementById("arrangeBar");
    if (!show) { if (bar) bar.remove(); return; }
    if (bar) return;
    bar = document.createElement("div");
    bar.id = "arrangeBar";
    bar.className = "no-print";
    bar.innerHTML = '<span>並べ替え中：カード・タイル・' + remapCircled("④") + 'のカテゴリ名を<b>長押しでつかんで</b>動かします</span>'
      + '<button class="btn-main" id="arrangeDone" type="button">完了</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById("arrangeDone").addEventListener("click", exitArrange);
  }
  function enterArrange() {
    if (arrangeOn) return;
    arrangeOn = true;
    arrangeWasMasterOnly = masterOnly;
    masterOnly = false; // マスタ設定の外へ出るときの担当者コードの問い直しを止める
    document.body.classList.add("arranging");
    switchTab("quote");
    arrangeBarShow(true);
    window.scrollTo(0, 0);
  }
  function exitArrange() {
    if (!arrangeOn) return;
    arrEnd(false);
    arrangeOn = false;
    document.body.classList.remove("arranging");
    arrangeBarShow(false);
    masterOnly = arrangeWasMasterOnly;
    switchTab("master");
  }
  /* モード中は見積もり画面のクリック・変更を全部止める（つかむ操作だけにする） */
  ["click", "change", "input"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (!arrangeOn) return;
      if (e.target.closest && e.target.closest("#arrangeBar")) return;
      if (e.target.closest && e.target.closest("#tab-quote")) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  });
  function arrCancelHold() { if (ARR.timer) { clearTimeout(ARR.timer); ARR.timer = null; } }
  function arrBegin(kind, el, x, y) {
    var r = el.getBoundingClientRect();
    ARR.kind = kind; ARR.el = el; ARR.active = true; ARR.x0 = x; ARR.y0 = y;
    ARR.pair = kind === "cat" ? el.nextElementSibling : null; // カテゴリはタイル一覧ごと動かす
    var g = el.cloneNode(true);
    g.className += " sort-ghost arr-ghost";
    g.style.left = r.left + "px"; g.style.top = r.top + "px";
    g.style.width = r.width + "px"; g.style.height = r.height + "px";
    document.body.appendChild(g);
    ARR.ghost = g;
    el.classList.add("sort-src");
    document.body.classList.add("sorting");
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }
  /* タイルがどの入れ物へ移れるか。data-opt=④のカテゴリ内、
   * data-acsel=④のカテゴリ内と⑥、data-fee=⑦の中だけ */
  function arrTileAllowed(tile, grid) {
    if (tile.hasAttribute("data-opt")) return !!grid.closest("#optionList");
    if (tile.hasAttribute("data-acsel")) return !!(grid.closest("#optionList") || grid.closest("#accTileList"));
    if (tile.hasAttribute("data-fee")) return !!grid.closest("#feeItemList");
    return false;
  }
  function arrMove(x, y) {
    ARR.ghost.style.transform = "translate(" + (x - ARR.x0) + "px," + (y - ARR.y0) + "px)";
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return;
    if (ARR.kind === "card") {
      var over = el.closest("#tab-quote .card");
      if (!over || over === ARR.el) return;
      if (!/\bc[1-9]\b/.test(over.className)) return; // ①〜⑨以外のカードの位置へは入れない
      var r = over.getBoundingClientRect();
      var after = y > r.top + r.height / 2;
      over.parentNode.insertBefore(ARR.el, after ? over.nextSibling : over);
    } else if (ARR.kind === "cat") {
      var overCat = el.closest("#optionList .opt-cat");
      if (!overCat || overCat === ARR.el) return;
      var rc = overCat.getBoundingClientRect();
      var afterC = y > rc.top + rc.height / 2;
      var ref = afterC ? overCat.nextElementSibling.nextElementSibling : overCat;
      ARR.el.parentNode.insertBefore(ARR.el, ref);
      ARR.el.parentNode.insertBefore(ARR.pair, ARR.el.nextElementSibling);
    } else if (ARR.kind === "tile") {
      var grid = el.closest(".tile-grid");
      if (!grid || !arrTileAllowed(ARR.el, grid)) return;
      var overT = el.closest(".tile");
      if (overT && overT !== ARR.el) {
        var rt = overT.getBoundingClientRect();
        var afterT = x > rt.left + rt.width / 2;
        grid.insertBefore(ARR.el, afterT ? overT.nextSibling : overT);
      } else if (!overT && grid !== ARR.el.parentNode) {
        grid.appendChild(ARR.el);
      }
    }
  }
  /* いまの画面の姿を、そのままマスタへ書き戻す */
  function arrCommit() {
    if (ARR.kind === "card") {
      var order = [];
      document.querySelectorAll("#tab-quote .card").forEach(function (c) {
        var m = c.className.match(/\bc([1-9])\b/);
        if (m) order.push("c" + m[1]);
      });
      if (order.length === QUOTE_CARDS.length) {
        if (order.join(",") === QUOTE_CARDS.join(",")) delete MASTER.quoteCardOrder;
        else MASTER.quoteCardOrder = order;
        markEdited();
        applyQuoteCardOrder();
      }
    } else if (ARR.kind === "cat") {
      var cats = [];
      document.querySelectorAll("#optionList .opt-cat").forEach(function (c) {
        if (OPT_CATEGORIES.indexOf(c.textContent) >= 0) cats.push(c.textContent);
      });
      if (cats.join(",") === OPT_CATEGORIES.join(",")) delete MASTER.optCatOrder;
      else MASTER.optCatOrder = cats;
      markEdited();
      renderOptionList();
    } else if (ARR.kind === "tile") {
      /* ④のカテゴリごとのタイル並びからオプションとアクセサリの並び・カテゴリを、
       * ⑦からは初期費用の並びを作り直す */
      var optSeq = [], accSeq = [], feeSeq = [], optById = {}, accById = {}, feeById = {};
      (MASTER.options || []).forEach(function (o) { optById[o.id] = o; });
      (MASTER.accessories || []).forEach(function (a) { accById[a.id] = a; });
      (MASTER.feeItems || []).forEach(function (f) { feeById[f.id] = f; });
      document.querySelectorAll("#optionList .opt-cat").forEach(function (catEl) {
        var cat = catEl.textContent;
        var grid = catEl.nextElementSibling;
        if (!grid || !grid.classList.contains("tile-grid")) return;
        grid.querySelectorAll(".tile").forEach(function (t) {
          var oid = t.getAttribute("data-opt");
          var aid = t.getAttribute("data-acsel");
          if (oid && optById[oid]) { optById[oid].category = cat; optSeq.push(optById[oid]); }
          if (aid && accById[aid]) { accById[aid].category = cat; accSeq.push(accById[aid]); }
        });
      });
      document.querySelectorAll("#accTileList .tile[data-acsel]").forEach(function (t) {
        var a = accById[t.getAttribute("data-acsel")];
        if (a) { a.category = ""; accSeq.push(a); }
      });
      document.querySelectorAll("#feeItemList .tile[data-fee]").forEach(function (t) {
        var f = feeById[t.getAttribute("data-fee")];
        if (f) feeSeq.push(f);
      });
      var seen = {};
      function mergeBack(seq, list) {
        var next = [];
        seq.forEach(function (o) { if (!seen[o.id]) { next.push(o); seen[o.id] = true; } });
        (list || []).forEach(function (o) { if (!seen[o.id]) { next.push(o); seen[o.id] = true; } });
        return next;
      }
      MASTER.options = mergeBack(optSeq, MASTER.options);
      seen = {};
      MASTER.accessories = mergeBack(accSeq, MASTER.accessories);
      seen = {};
      MASTER.feeItems = mergeBack(feeSeq, MASTER.feeItems);
      markEdited();
      renderOptionList();
      renderAccessoryTiles();
      renderFeeItemList();
    }
  }
  function arrEnd(commit) {
    arrCancelHold();
    if (!ARR.active) return;
    ARR.active = false;
    if (ARR.ghost) { ARR.ghost.remove(); ARR.ghost = null; }
    if (ARR.el) ARR.el.classList.remove("sort-src");
    document.body.classList.remove("sorting");
    if (commit) arrCommit();
    ARR.el = null; ARR.pair = null; ARR.kind = "";
  }
  function initArrange() {
    document.addEventListener("pointerdown", function (e) {
      if (!arrangeOn) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      var t = e.target;
      if (!t.closest || t.closest("#arrangeBar")) return;
      var kind = "", el = null;
      var cat = t.closest("#optionList .opt-cat");
      var tile = t.closest("#tab-quote .tile");
      var card = t.closest("#tab-quote .card");
      if (cat) { kind = "cat"; el = cat; }
      else if (tile && (tile.hasAttribute("data-opt") || tile.hasAttribute("data-acsel") || tile.hasAttribute("data-fee"))) { kind = "tile"; el = tile; }
      else if (card && /\bc[1-9]\b/.test(card.className)) { kind = "card"; el = card; }
      if (!el) return;
      arrCancelHold();
      var x = e.clientX, y = e.clientY;
      ARR.x0 = x; ARR.y0 = y;
      ARR.timer = setTimeout(function () { ARR.timer = null; arrBegin(kind, el, x, y); }, 400);
    });
    document.addEventListener("pointermove", function (e) {
      if (!arrangeOn) return;
      if (!ARR.active) {
        if (ARR.timer && (Math.abs(e.clientX - ARR.x0) > 8 || Math.abs(e.clientY - ARR.y0) > 8)) arrCancelHold();
        return;
      }
      e.preventDefault();
      arrMove(e.clientX, e.clientY);
    }, { passive: false });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      document.addEventListener(ev, function () { if (arrangeOn) arrEnd(ev === "pointerup"); });
    });
    document.addEventListener("touchmove", function (e) {
      if (arrangeOn && ARR.active) e.preventDefault();
    }, { passive: false });
    document.addEventListener("keydown", function (e) {
      if (arrangeOn && e.key === "Escape") arrEnd(false);
    });
  }

  // 選択式の編集を開いているオプション（マスタ設定を描き直しても開いたままにする）
  var openChoices = {};
  /* 選択肢を整える。並びはそのままにして、
   * 初期値（o.price）が選択肢に無い場合は先頭に合わせる。 */
  function normalizeChoices(o) {
    if (!o.priceChoices || !o.priceChoices.length) {
      delete o.priceChoices;
      delete o.priceLabels;
      return;
    }
    var labels = {};
    o.priceChoices = o.priceChoices.map(function (c) { return Math.max(0, num(c)); });
    o.priceChoices.forEach(function (c) {
      var lb = o.priceLabels && o.priceLabels[String(c)];
      if (lb) labels[String(c)] = lb;
    });
    o.priceLabels = labels;
    if (o.priceChoices.indexOf(num(o.price)) < 0) o.price = o.priceChoices[0];
  }

  /* でんき・ガスの会社と連絡先の編集 */
  function energyTouch(full) {
    markEdited();
    if (full) renderMasterTab();
    renderEnergyNow();
    renderStaffSheet();
  }
  function handleEnergyEvent(t, evType) {
    if (!t || !t.getAttribute) return false;
    function g(n) { return t.getAttribute("data-en-" + n); }
    var v, parts, list;
    function listOf(k) {
      if (!MASTER.energyCompanies) MASTER.energyCompanies = {};
      if (!MASTER.energyCompanies[k]) MASTER.energyCompanies[k] = [];
      return MASTER.energyCompanies[k];
    }
    if (evType === "input") {
      if ((v = g("name")) != null) { parts = v.split(":"); listOf(parts[0])[+parts[1]].name = t.value; energyTouch(false); return true; }
      if ((v = g("tel")) != null) { parts = v.split(":"); listOf(parts[0])[+parts[1]].tel = t.value; energyTouch(false); return true; }
    }
    if (evType !== "click") return false;
    if ((v = g("add")) != null) {
      listOf(v).push({ id: "en_" + Date.now(), name: "", tel: "" });
      energyTouch(true); return true;
    }
    if ((v = g("del")) != null) {
      parts = v.split(":");
      list = listOf(parts[0]);
      var c = list[+parts[1]];
      if (!window.confirm("「" + (c.name || "この会社") + "」を削除しますか？")) return true;
      store.patterns.forEach(function (pt) {
        var k = parts[0] === "gas" ? "todoGasNow" : "todoDenkiNow";
        if (pt[k] === c.id) pt[k] = "";
      });
      list.splice(+parts[1], 1);
      energyTouch(true); return true;
    }
    var up = g("up"), dn = g("down");
    if (up != null || dn != null) {
      parts = (up != null ? up : dn).split(":");
      list = listOf(parts[0]);
      var i = +parts[1], j = up != null ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return true;
      var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      energyTouch(true); return true;
    }
    return false;
  }

  /* ---------- 料金プランの編集 ----------
   * 新しいプランが出たときに、店舗がここから登録できるようにする。 */
  function newPlan() {
    return {
      id: "pl_" + Date.now(), group: "current", name: "",
      tiers: [{ label: "", price: 0 }], discounts: {},
      includes5min: false, poikatsuPt: 0, maxBonus: false, bakuageTier: "", note: ""
    };
  }
  // 入力中は作り直さない（作り直すと入力欄からカーソルが外れるため）
  function planTouch() {
    markEdited();
    renderPlanSelect();
    renderDiscountHint();
    recalc();
  }
  // 増減・並べ替えなど、画面の作りが変わるとき
  function planRestructure() {
    markEdited();
    renderMasterTab();
    renderPlanSelect();
    renderDiscountHint();
    syncFormFromState();
    recalc();
  }
  function handlePlanEvent(t, evType) {
    if (!t || !t.getAttribute) return false;
    function g(n) { return t.getAttribute("data-pl-" + n); }
    var v, p, parts;

    if (evType === "input") {
      if ((v = g("name")) != null) { MASTER.plans[+v].name = t.value; planTouch(); return true; }
      if ((v = g("note")) != null) { MASTER.plans[+v].note = t.value; markEdited(); return true; }
      if ((v = g("desc")) != null) { MASTER.plans[+v].desc = t.value; markEdited(); return true; }
      if ((v = g("poi")) != null) { MASTER.plans[+v].poikatsuPt = Math.max(0, num(t.value)); planTouch(); return true; }
      if ((v = g("tlabel")) != null) {
        parts = v.split(":");
        MASTER.plans[+parts[0]].tiers[+parts[1]].label = t.value;
        markEdited(); renderTierSelect(); return true;
      }
      if ((v = g("tprice")) != null) {
        parts = v.split(":");
        MASTER.plans[+parts[0]].tiers[+parts[1]].price = num(t.value);
        planTouch(); return true;
      }
      if ((v = g("disamt")) != null) {
        parts = v.split(":");
        MASTER.plans[+parts[0]].discounts[parts[1]] = num(t.value);
        planTouch(); return true;
      }
    }

    if (evType === "change") {
      if ((v = g("group")) != null) { MASTER.plans[+v].group = t.value; planRestructure(); return true; }
      if ((v = g("baku")) != null) { MASTER.plans[+v].bakuageTier = t.value; planTouch(); return true; }
      if ((v = g("5min")) != null) { MASTER.plans[+v].includes5min = t.checked; planTouch(); return true; }
      if ((v = g("dcard10")) != null) { MASTER.plans[+v].dcard10 = t.checked; planTouch(); return true; }
      if ((v = g("maxbonus")) != null) { MASTER.plans[+v].maxBonus = t.checked; planTouch(); return true; }
      if ((v = g("dison")) != null) {
        parts = v.split(":");
        p = MASTER.plans[+parts[0]];
        if (t.checked) { if (!(parts[1] in p.discounts)) p.discounts[parts[1]] = 0; }
        else { delete p.discounts[parts[1]]; }
        planRestructure(); return true;
      }
    }

    if (evType !== "click") return false;

    /* たたんだ行は中の文字（名前・金額）を押しても開くように、ボタンまでさかのぼる */
    var openBtn = t.closest ? t.closest("[data-pl-open]") : null;
    if (openBtn) {
      planOpen[MASTER.plans[+openBtn.getAttribute("data-pl-open")].id] = true;
      renderMasterTab(); return true;
    }
    if ((v = g("close")) != null) {
      delete planOpen[MASTER.plans[+v].id];
      renderMasterTab(); return true;
    }
    if (g("legacy-toggle") != null) {
      planShowLegacy = !planShowLegacy;
      renderMasterTab(); return true;
    }

    if (g("add") != null) {
      var np = newPlan();
      planOpen[np.id] = true; // 追加したプランはすぐ編集できるよう開いておく
      MASTER.plans.push(np);
      planRestructure(); return true;
    }

    if ((v = g("copy")) != null) {
      var src = MASTER.plans[+v];
      var cp = JSON.parse(JSON.stringify(src));
      cp.id = "pl_" + Date.now();
      cp.name = (src.name || "プラン") + "（コピー）";
      planOpen[cp.id] = true; // 複製もすぐ編集できるよう開いておく
      MASTER.plans.splice(+v + 1, 0, cp);
      planRestructure(); return true;
    }

    if ((v = g("del")) != null) {
      p = MASTER.plans[+v];
      if (MASTER.plans.length < 2) { window.alert("プランを1つも無い状態にはできません。"); return true; }
      if (!window.confirm("「" + (p.name || "このプラン") + "」を削除しますか？\nこのプランを選んでいる見積もりは、プラン未選択に戻ります。")) return true;
      store.patterns.forEach(function (pt) {
        if (pt.planId === p.id) { pt.planId = ""; pt.tierIdx = 0; }
      });
      // 初期データにあるプランを消したときは、次回起動で復活しないよう覚えておく
      if (!MASTER.removedIds) MASTER.removedIds = [];
      if (MASTER.removedIds.indexOf(p.id) < 0) MASTER.removedIds.push(p.id);
      MASTER.plans.splice(+v, 1);
      planRestructure(); return true;
    }

    var up = g("up"), dn = g("down");
    if (up != null || dn != null) {
      var i = +(up != null ? up : dn);
      var dir = up != null ? -1 : 1;
      var j = i + dir;
      /* 隠している旧プランは飛び越えて、見えている隣と入れ替える */
      while (j >= 0 && j < MASTER.plans.length && !planVisible(MASTER.plans[j])) j += dir;
      if (j < 0 || j >= MASTER.plans.length) return true;
      var tmp = MASTER.plans[i]; MASTER.plans[i] = MASTER.plans[j]; MASTER.plans[j] = tmp;
      planRestructure(); return true;
    }

    if ((v = g("tadd")) != null) {
      MASTER.plans[+v].tiers.push({ label: "", price: 0 });
      planRestructure(); return true;
    }
    if ((v = g("tdel")) != null) {
      parts = v.split(":");
      p = MASTER.plans[+parts[0]];
      if (p.tiers.length < 2) return true;
      p.tiers.splice(+parts[1], 1);
      store.patterns.forEach(function (pt) {
        if (pt.planId === p.id && pt.tierIdx >= p.tiers.length) pt.tierIdx = 0;
      });
      planRestructure(); return true;
    }
    return false;
  }

  /* ---------- 汎用: マスタのリスト編集ハンドラ ---------- */
  var LIST_DEFS = {
    op: { key: "options", newItem: function () { return { id: "op_" + Date.now(), name: "", price: 0, category: "その他", note: "" }; }, stateKey: "options", render: renderOptionList },
    fi: { key: "feeItems", newItem: function () { return { id: "fi_" + Date.now(), name: "", price: 0 }; }, stateKey: "feeItems", render: renderFeeItemList },
    ac: { key: "accessories", newItem: function () { return { id: "acc_" + Date.now(), name: "", price: 0 }; }, stateKey: "accSel", render: renderAccessoryTiles },
  };
  function markEdited() {
    histAutoSnapshot(); // 編集前の内容を控えてから書き換える
    MASTER.updated = MASTER.updated.replace(/（編集済み.*$/, "") + "（編集済み）";
    saveMaster();
  }
  /* 「実績で追う項目」の操作。設定は MASTER.statsCfg に入れて markEdited() で
   * 料金マスタと同じ経路（保存・同期・履歴）に乗せる。 */
  function handleStatsCfgEvent(t, kind) {
    if (!t.getAttribute) return false;
    var sc;
    if (kind === "input") {
      if (t.id === "scDeviceKw") { statsCfg().deviceKw = t.value; markEdited(); return true; }
      if (t.id === "scHighendYen") { statsCfg().highendYen = Math.max(0, num(t.value)); markEdited(); return true; }
      if (t.id === "scHighendIpKw") { statsCfg().highendIpKw = t.value; markEdited(); return true; }
      return false;
    }
    if (t.hasAttribute("data-sc-proc")) {
      statsCfg().procs[t.getAttribute("data-sc-proc")] = t.checked;
      markEdited(); return true;
    }
    if (t.hasAttribute("data-sc-goal")) {
      // 月の目標。頻繁に触るものではないが、履歴を増やさないよう直接保存する
      if (!MASTER.statsGoalItems) MASTER.statsGoalItems = {};
      var gk = t.getAttribute("data-sc-goal");
      var gv = Math.max(0, Math.round(num(t.value)));
      if (gv) MASTER.statsGoalItems[gk] = gv; else delete MASTER.statsGoalItems[gk];
      saveMaster();
      return true;
    }
    if (t.hasAttribute("data-sc-visit")) { statsCfg().visit = t.checked; markEdited(); return true; }
    if (t.hasAttribute("data-sc-kaimashi")) { statsCfg().kaimashi = t.checked; markEdited(); return true; }
    if (t.hasAttribute("data-sc-plan")) {
      sc = statsCfg();
      var pid = t.getAttribute("data-sc-plan");
      if (t.checked) sc.plans[pid] = true; else delete sc.plans[pid];
      markEdited(); return true;
    }
    if (t.hasAttribute("data-sc-opt")) {
      sc = statsCfg();
      var oid = t.getAttribute("data-sc-opt");
      if (t.checked) delete sc.optSkip[oid]; else sc.optSkip[oid] = true;
      markEdited(); return true;
    }
    if (t.hasAttribute("data-sc-fee")) {
      sc = statsCfg();
      var fid = t.getAttribute("data-sc-fee");
      if (t.checked) delete sc.feeSkip[fid]; else sc.feeSkip[fid] = true;
      markEdited(); return true;
    }
    if (t.hasAttribute("data-sc-flag")) {
      statsCfg()[t.getAttribute("data-sc-flag")] = t.checked;
      if (t.getAttribute("data-sc-flag") === "highend") {
        ["scHighendYen", "scHighendIpKw"].forEach(function (id9) {
          var el9 = $(id9);
          if (el9) el9.hidden = !t.checked;
        });
      }
      markEdited(); return true;
    }
    if (t.id === "scDevice") {
      statsCfg().device = t.value;
      var kwEl = $("scDeviceKw");
      if (kwEl) kwEl.hidden = t.value !== "kw";
      markEdited(); return true;
    }
    if (t.hasAttribute("data-sc-sel")) {
      statsCfg()[t.getAttribute("data-sc-sel")] = t.value;
      markEdited(); return true;
    }
    return false;
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
      } else if (evType === "input" && attr("desc") != null) {
        list[+attr("desc")].desc = t.value;
      } else if (evType === "change" && attr("img") != null) {
        var io = list[+attr("img")];
        var f = t.files && t.files[0];
        t.value = "";
        if (!f) return true;
        shrinkImageFile(f, function (data, err) {
          if (!data) { window.alert(err || "写真を登録できませんでした。"); return; }
          var before = io.img;
          io.img = data;
          // 料金マスタ全体が大きくなりすぎると、端末間の同期に失敗する
          var size = 0;
          try { size = JSON.stringify(MASTER).length; } catch (e) {}
          if (size > MASTER_SOFT_LIMIT) {
            if (before) io.img = before; else delete io.img;
            window.alert("写真の合計が大きすぎるため登録できませんでした。\n"
              + "ほかの商材の写真を減らしてから、もう一度お試しください。");
            return;
          }
          markEdited();
          renderMasterTab();
        });
        return true;
      } else if (evType === "click" && attr("imgdel") != null) {
        delete list[+attr("imgdel")].img;
        markEdited();
        renderMasterTab();
        return true;
      } else if (evType === "input" && attr("url") != null) {
        // 店舗独自の商材のリンク先。開けるのは http/https だけにする
        var uo = list[+attr("url")];
        var uv = String(t.value || "").trim();
        if (!uv) delete uo.url; else uo.url = uv;
      } else if (evType === "change" && prefix === "op" && attr("cat") != null) {
        list[+attr("cat")].category = t.value;
      } else if (prefix === "op" && attr("choices") != null && evType === "click") {
        var co = list[+attr("choices")];
        if (openChoices[co.id]) delete openChoices[co.id];
        else {
          openChoices[co.id] = true;
          if (!co.priceChoices || !co.priceChoices.length) {
            co.priceChoices = [num(co.price)];
            co.priceLabels = {};
            markEdited();
          }
        }
        renderMasterTab();
        return true;
      } else if (prefix === "op" && attr("cadd") != null && evType === "click") {
        var ao = list[+attr("cadd")];
        if (!ao.priceChoices) ao.priceChoices = [];
        var nv = 0;
        while (ao.priceChoices.indexOf(nv) >= 0) nv += 100; // 金額が重なるとラベルが混ざる
        ao.priceChoices.push(nv);
        normalizeChoices(ao);
        markEdited();
        renderMasterTab();
        renderOptionList();
        recalc();
        return true;
      } else if (prefix === "op" && attr("coff") != null && evType === "click") {
        var fo = list[+attr("coff")];
        delete fo.priceChoices;
        delete fo.priceLabels;
        delete openChoices[fo.id];
        // 選択中の金額の記録も外す（選択式でなくなるため）
        store.patterns.forEach(function (pt) { delete pt.optionPrices[fo.id]; });
        markEdited();
        renderMasterTab();
        renderOptionList();
        recalc();
        return true;
      } else if (prefix === "op" && attr("cdel") != null && evType === "click") {
        var dp = attr("cdel").split(":");
        var doo = list[+dp[0]];
        doo.priceChoices.splice(+dp[1], 1);
        normalizeChoices(doo);
        markEdited();
        renderMasterTab();
        renderOptionList();
        recalc();
        return true;
      } else if (prefix === "op" && attr("cprice") != null && evType === "input") {
        var pp = attr("cprice").split(":");
        var po = list[+pp[0]];
        var oldVal = po.priceChoices[+pp[1]];
        var newVal = Math.max(0, num(t.value));
        // ラベルは金額をキーに持っているため、いったん行の位置で取り出してから付け直す
        var byIdx = po.priceChoices.map(function (c) {
          return (po.priceLabels && po.priceLabels[String(c)]) || "";
        });
        po.priceChoices[+pp[1]] = newVal;
        po.priceLabels = {};
        po.priceChoices.forEach(function (c, idx) {
          if (byIdx[idx]) po.priceLabels[String(c)] = byIdx[idx];
        });
        if (num(po.price) === oldVal) po.price = newVal; // 初期値にしていた行を追いかける
        normalizeChoices(po);
      } else if (prefix === "op" && attr("clabel") != null && evType === "input") {
        var lp = attr("clabel").split(":");
        var lo = list[+lp[0]];
        if (!lo.priceLabels) lo.priceLabels = {};
        var key = String(lo.priceChoices[+lp[1]]);
        if (t.value.trim()) lo.priceLabels[key] = t.value.trim();
        else delete lo.priceLabels[key];
      } else if (evType === "input" && prefix === "op" && attr("baku2") != null) {
        list[+attr("baku2")].bakuage2 = Math.max(0, Math.min(100, num(t.value)));
      } else if (evType === "input" && prefix === "op" && attr("bakufix") != null) {
        list[+attr("bakufix")].bakuageFixed = Math.max(0, num(t.value));
      } else if (evType === "input" && prefix === "op" && attr("baku") != null) {
        list[+attr("baku")].bakuage = Math.max(0, Math.min(100, num(t.value)));
      } else if (evType === "change" && prefix === "op" && attr("gold") != null) {
        list[+attr("gold")].carrier = t.checked;
      } else if (evType === "change" && attr("own") != null) {
        list[+attr("own")].own = t.checked;
        markEdited();
        renderMasterTab();
        return true;
      } else if (evType === "change" && prefix === "ac" && attr("cat") != null) {
        list[+attr("cat")].category = t.value;
        markEdited();
        renderOptionList();
        renderAccessoryTiles();
        recalc();
        return true;
      } else if (evType === "change" && prefix === "ac" && attr("pay") != null) {
        list[+attr("pay")].defaultPay = t.value;
      } else if (evType === "change" && prefix === "fi" && attr("pay") != null) {
        list[+attr("pay")].pay = t.value;
      } else if (evType === "change" && prefix === "fi" && attr("dm") != null) {
        list[+attr("dm")].dataMove = t.checked;
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
    document.querySelectorAll(".tpl[data-tpl]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (tplHold.fired) { tplHold.fired = false; return; } // 長押しで開いた直後は反応させない
        closeTplMenu();
        var i = +b.dataset.tpl;
        if (tplSaveMode) tplSave(i, false);
        else tplApply(i, false);
      });
    });
    document.querySelectorAll(".tpl[data-tplst]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (tplHold.fired) { tplHold.fired = false; return; }
        closeTplMenu();
        var i = +b.dataset.tplst;
        if (tplStoreSaveMode) tplSave(i, true);
        else tplApply(i, true);
      });
    });
    $("saveTplBtn").addEventListener("click", function () {
      tplSaveMode = !tplSaveMode;
      tplStoreSaveMode = false;
      renderTplBar();
    });
    $("saveStoreTplBtn").addEventListener("click", function () {
      tplStoreSaveMode = !tplStoreSaveMode;
      tplSaveMode = false;
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
      store.patterns[next].visitPurposes = {};   // 目的は回線1のものだけ
      delete store.patterns[next].visitPurpose;
      // 請求内訳の読み取りは番号ごとの請求なので、別の回線へは複製しない
      delete store.patterns[next].curBill;
      switchPattern(next);
    });
    $("toSheet").addEventListener("click", function () { switchTab("sheet"); });
    $("backToQuote").addEventListener("click", function () { switchTab("quote"); });
    /* 開通までの流れ（1枚）の「予定日」入力。
     * 印刷直前（beforeprint）に見積書を描き直すため、書いた内容は
     * 見積もりの状態（store.ienaka.flowDates）に持たせて描き直しでも残す。
     * 保存・成約の記録にも予定日が一緒に残る。 */
    $("sheetBody").addEventListener("input", function (e) {
      var t = e.target;
      if (t.classList && t.classList.contains("f2-date-line")) {
        if (!store.ienaka.flowDates) store.ienaka.flowDates = {};
        store.ienaka.flowDates[t.getAttribute("data-fi")] = t.textContent.slice(0, 20);
        saveState();
      }
    });
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
    function minnaN() {
      var r2 = document.querySelector('input[name="minnaN"]:checked');
      return r2 ? r2.value : "2";
    }
    function chokiY() {
      var r2 = document.querySelector('input[name="chokiY"]:checked');
      return r2 ? r2.value : "y10";
    }
    $("minnaOn").addEventListener("change", function () {
      state.minna = this.checked ? minnaN() : "0";
      $("minnaSub").hidden = !this.checked;
      recalc();
    });
    document.querySelectorAll('input[name="minnaN"]').forEach(function (rb) {
      rb.addEventListener("change", function () { state.minna = this.value; recalc(); });
    });
    $("dSet").addEventListener("change", function () { state.dSet = this.checked; recalc(); });
    $("dCardOn").addEventListener("change", function () {
      // 入にしたときは、前回の券種（無ければ R=dカード）で始める
      state.dCard = this.checked ? (lastDcardKind || "normal") : "none";
      syncFormFromState(); recalc();
    });
    /* 券種は R・G・U・P の頭文字チェック。カードは1枚なので、
     * 1つ選ぶと他は外れる（ハーティ／子育てと同じ排他の形）。
     * 選択中のものを外したときは、割引ごと切る。 */
    dcardKindBoxes().forEach(function (b) {
      b.addEventListener("change", function () {
        var kind = this.getAttribute("data-dcard");
        if (this.checked) { state.dCard = kind; lastDcardKind = kind; }
        else if (state.dCard === kind) state.dCard = "none";
        syncFormFromState(); recalc();
      });
    });
    $("dDenki").addEventListener("change", function () { state.dDenki = this.checked; recalc(); });
    $("chokiOn").addEventListener("change", function () {
      state.choki = this.checked ? chokiY() : "none";
      $("chokiSub").hidden = !this.checked;
      recalc();
    });
    document.querySelectorAll('input[name="chokiY"]').forEach(function (rb) {
      rb.addEventListener("change", function () { state.choki = this.value; recalc(); });
    });
    /* その他割引（ハーティ・子育てサポート）は普段は畳んでおく。
     * 閉じたときは中の割引も外す（見えないのに効いている状態を作らない） */
    $("otherWariOn").addEventListener("change", function () {
      otherWariOpen = this.checked;
      if (!this.checked) { state.hearty = false; state.kosodate = false; $("hearty").checked = false; $("kosodate").checked = false; }
      $("otherWariBox").hidden = !this.checked;
      recalc(); renderDiscountHint();
    });
    /* 重ねられない割引の注意書きを出し直すため、ここだけ renderDiscountHint も呼ぶ */
    /* ハーティ割引と子育てサポート割引は同時に適用できない（2026-08-20 確認）。
     * 片方にチェックを入れたら、もう片方は自動で外す。 */
    $("hearty").addEventListener("change", function () {
      state.hearty = this.checked;
      if (this.checked && state.kosodate) {
        state.kosodate = false;
        $("kosodate").checked = false;
        $("kosodateNote").hidden = true;
      }
      recalc(); renderDiscountHint();
    });
    $("kosodate").addEventListener("change", function () {
      state.kosodate = this.checked;
      if (this.checked && state.hearty) {
        state.hearty = false;
        $("hearty").checked = false;
      }
      $("kosodateNote").hidden = !this.checked;
      recalc(); renderDiscountHint();
    });
    $("campaignList").addEventListener("change", function (e) {
      var cid = e.target.getAttribute("data-cp");
      if (cid) { state.campaigns[cid] = e.target.checked; recalc(); return; }
      var aid = e.target.getAttribute("data-cpamt");
      if (aid) { state.campaignAmounts[aid] = num(e.target.value); recalc(); }
    });
    $("ptPoikatsu").addEventListener("input", function () { state.pointPoikatsu = num(this.value); recalc(); });
    $("ptPoikatsuFamily").addEventListener("input", function () { state.pointPoikatsuFamily = num(this.value); recalc(); });
    $("ptBakuage").addEventListener("input", function () { state.pointBakuage = num(this.value); recalc(); });
    $("pointApply").addEventListener("change", function () { state.pointApply = this.value === "1"; recalc(); });
    $("bakuageInclude").addEventListener("change", function () { state.bakuageInclude = this.checked; recalc(); });
    $("bakuageReset").addEventListener("click", function () {
      state.pointBakuage = calcFor(state).bakuageAutoPt;
      $("ptBakuage").value = state.pointBakuage || "";
      recalc();
    });
    $("ptDcard").addEventListener("input", function () { state.pointDcard = num(this.value); recalc(); });
    $("dcardAutoInclude").addEventListener("change", function () { state.dcardGoldAuto = this.checked; recalc(); });
    $("dcardAutoReset").addEventListener("click", function () {
      state.pointDcard = state.pointDcardAuto || 0;
      $("ptDcard").value = state.pointDcard || "";
      recalc();
    });
    /* 通話オプションのタイル。タイルを押すとその種類に切り替え、
     * 中のプルダウンでは新旧を選ぶ（プルダウンの操作でタイルも選ばれた状態にする） */
    $("voiceTiles").addEventListener("change", function (e) {
      var key = e.target.getAttribute && e.target.getAttribute("data-voice-era");
      if (!key) return;
      state.voice = e.target.value;
      renderVoiceSelect();
      recalc();
    });
    function pickVoiceTile(t) {
      var key = t.getAttribute("data-voice");
      if (voiceTileKey(state.voice) === key) return; // 同じタイルの押し直しでは新旧を変えない
      var sel = t.querySelector("select[data-voice-era]");
      state.voice = sel ? sel.value : key;
      renderVoiceSelect();
      recalc();
    }
    $("voiceTiles").addEventListener("click", function (e) {
      if (e.target.closest("select")) return; // プルダウンの操作はタイル選択にしない
      var t = e.target.closest("[data-voice]");
      if (t) pickVoiceTile(t);
    });
    $("voiceTiles").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var t = e.target.closest && e.target.closest("[data-voice]");
      if (t) { e.preventDefault(); pickVoiceTile(t); }
    });
    /* ②のドコモメールのタイル。タップで対象／対象外を切り替え、
     * タイルの中の新規／継続／廃止で区分を選ぶ（④のオプションタイルと同じ動き） */
    function toggleMailTile(e) {
      if (e.target.closest(".t-kubun")) return; // 区分の操作ではタイルの選択を変えない
      var tile = e.target.closest("[data-mail]");
      if (!tile) return;
      var mo = mailOptDef();
      if (!mo) return;
      if (state.options[mo.id] || state.optionKubun[mo.id] === "off") {
        state.options[mo.id] = false;
        delete state.optionKubun[mo.id];
      } else {
        state.options[mo.id] = true;
        state.optionKubun[mo.id] = "new";
      }
      renderMailOpt();
      recalc();
    }
    $("mailTile").addEventListener("click", toggleMailTile);
    $("mailTile").addEventListener("keydown", function (e) {
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.target.classList && e.target.classList.contains("tile")) { e.preventDefault(); toggleMailTile(e); }
    });
    $("mailTile").addEventListener("change", function (e) {
      var kid = e.target.getAttribute("data-mailkubun");
      if (!kid) return;
      if (e.target.checked) {
        state.optionKubun[kid] = e.target.value;
        state.options[kid] = e.target.value !== "off"; // 廃止は月額に含めない
      }
      renderMailOpt(); // チェックを外した場合は元の区分に戻す
      recalc();
    });

    // タイルのタップ／キー操作で選択切替（タイル内のプルダウン操作では切替しない）
    function toggleTile(e) {
      // タイル内のリンク（公式の料金表など）のタップでは選択を切り替えない
      if (e.target.closest("select") || e.target.closest(".t-kubun") || e.target.closest("a")) return;
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
          optExclusiveOff(optId);
        }
        renderOptionList();
      }
      if (feeId) {
        state.feeItems[feeId] = !state.feeItems[feeId];
        if (!state.feeItems[feeId]) delete (state.feeItemPay || {})[feeId];
        renderFeeItemList();
      }
      if (accId) {
        if (state.accSel[accId]) delete state.accSel[accId];
        else {
          var accDef = (MASTER.accessories || []).filter(function (a) { return a.id === accId; })[0];
          state.accSel[accId] = accDef ? accDefaultPay(accDef) : "once";
        }
        renderAccessoryTiles();
        renderOptionList(); // カテゴリの中に置いたアクセサリも描き直す
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
    // 初期費用タイルの支払い先（データ移行の項目だけ出る）
    $("feeItemList").addEventListener("change", function (e) {
      var fp = e.target.getAttribute("data-feepay");
      if (!fp) return;
      if (!state.feeItemPay) state.feeItemPay = {};
      state.feeItemPay[fp] = e.target.value;
      recalc();
      renderStaffSheet();
    });
    $("accTileList").addEventListener("change", function (e) {
      var id = e.target.getAttribute("data-acsel");
      if (id) { state.accSel[id] = e.target.value; recalc(); }
    });
    $("optionList").addEventListener("change", function (e) {
      var aid = e.target.getAttribute("data-acsel");
      if (aid) { state.accSel[aid] = e.target.value; renderOptionList(); recalc(); return; }
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
    $("deviceName").addEventListener("input", function () {
      state.deviceName = this.value;
      renderDeviceSelect();   // 手で直したらプルダウンの選択も合わせる
      saveState();
    });
    $("devicePrice").addEventListener("input", function () { state.devicePrice = num(this.value); recalc(); });
    $("couponOff").addEventListener("input", function () { state.couponOff = num(this.value); recalc(); });
    $("tebikiOff").addEventListener("input", function () { state.tebikiOff = num(this.value); recalc(); });
    $("directOff").addEventListener("input", function () { state.directOff = num(this.value); recalc(); });
    $("payMethod").addEventListener("change", function () {
      state.payMethod = this.value;
      $("kaedoki23Field").hidden = state.payMethod !== "kaedoki";
      $("kaedokiFeeField").hidden = state.payMethod !== "kaedoki";
      $("devBuyDetail").hidden = state.payMethod === "none";
      /* 「端末購入なし」に変えたら、購入のときにしか使わない入力はその場で消す。
       * 以前は隠したまま残して警告だけ出していたが、消えないという声があった。
       * 残っていると、MNPのSIMのみ特典の欄も「端末購入あり」と見なされて出ない。
       * 「現在の分割支払金」と店頭頭金（⑦・手続き種別から自動）は購入と別の話なので残す。 */
      if (state.payMethod === "none") {
        state.deviceName = "";
        state.devicePrice = 0;
        state.couponOff = 0;
        state.tebikiOff = 0;
        state.directOff = 0;
        state.kaedoki23 = 0;
        state.kaedokiFee = 0;
        syncFormFromState();
      }
      recalc();
    });
    $("kaedoki23").addEventListener("input", function () { state.kaedoki23 = num(this.value); recalc(); });
    $("kaedokiFee").addEventListener("input", function () { state.kaedokiFee = num(this.value); recalc(); });
    $("atamakin").addEventListener("input", function () { state.atamakin = num(this.value); recalc(); });
    $("jimuFee").addEventListener("input", function () { state.jimuFee = num(this.value); recalc(); });

    // お客様情報
    ["custName", "shopName", "staffName", "shopTel", "quoteMemo"].forEach(function (id) {
      $(id).addEventListener("input", function () { state[id] = this.value; saveState(); });
    });
    $("mnpBenefitType").addEventListener("change", function () {
      state.mnpBenefitType = this.value;
      if (!this.value) state.mnpBenefitAmt = 0;
      recalc();
    });
    $("mnpBenefitAmt").addEventListener("input", function () {
      state.mnpBenefitAmt = Math.max(0, num(this.value));
      saveState();
      if ($("tab-sheet").classList.contains("active")) renderSheet();
      if ($("tab-staff").classList.contains("active")) renderStaffSheet();
    });
    $("todoOther").addEventListener("input", function () {
      state.todoOther = this.value; saveState(); renderStaffSheet();
    });
    document.querySelectorAll("[data-visit]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var vst = store.patterns[0] || state;   // 目的は回線1に持つ
        if (!vst.visitPurposes) vst.visitPurposes = {};
        var k = cb.getAttribute("data-visit");
        if (cb.checked) vst.visitPurposes[k] = true; else delete vst.visitPurposes[k];
        if (visitKeys(vst).indexOf("buy") < 0) {
          store.patterns.forEach(function (pt) { pt.kaimashi = false; });
        }
        renderVisitPurpose();
        recalc();
      });
    });
    $("kaimashi").addEventListener("change", function () {
      state.kaimashi = this.checked;
      recalc();
    });
    ["todoDcard", "todoDenki", "todoGas", "todoHikari"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state[id] = this.checked;
        /* 光申込にチェック＝光の見積もりを作る流れなので、「この見積もりに含める」を自動で入れる。
         * ③割引のセット割では入れない（ご家族の既契約回線で割引だけ受ける場合があるため）。
         * 外すときは自動で外さない（入力済みの光の内容を勝手に消さないため）。 */
        if (id === "todoHikari" && this.checked && !store.ienaka.enabled) {
          store.ienaka.enabled = true;
          var ieb = $("ieBody"); if (ieb) ieb.hidden = false;
          var iec = $("ieEnabled"); if (iec) iec.checked = true;
          recalc();
        }
        if (id === "todoDcard") { $("dcardTypeWrap").hidden = !this.checked; if (!this.checked) state.todoDcardType = ""; }
        if (id === "todoDenki" && !this.checked) {
          state.todoDenkiType = ""; state.todoDenkiNow = "";
        }
        if (id === "todoGas" && !this.checked) {
          state.todoGasType = ""; state.todoGasDiscount = {};
          state.todoGasNow = ""; state.todoGasEco = "";
        }
        syncFormFromState();
        saveState(); renderStaffSheet();
      });
    });
    // ガスの区分（同時に1つだけ・もう一度押すと解除）
    var geWrap = $("gasEcoWrap");
    if (geWrap) geWrap.addEventListener("change", function (e) {
      var v = e.target.getAttribute && e.target.getAttribute("data-gaseco");
      if (!v) return;
      state.todoGasEco = e.target.checked ? v : "";
      renderGasEco();
      saveState();
      renderStaffSheet();
    });
    // 現在の会社（同時に1社だけ・もう一度押すと解除）
    ["denkiNowWrap", "gasNowWrap"].forEach(function (id) {
      var enWrap = $(id);
      if (!enWrap) return;
      enWrap.addEventListener("change", function (e) {
        var v = e.target.getAttribute && e.target.getAttribute("data-energynow");
        if (!v) return;
        var parts = v.split(":");
        var key = parts[0] === "gas" ? "todoGasNow" : "todoDenkiNow";
        state[key] = e.target.checked ? parts[1] : "";
        renderEnergyNow();
        saveState();
        renderStaffSheet();
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
          if (pair[1] === "todoGasType") {
            state.todoGasDiscount = {};
            // 区分の無いメニューへ移ったときは、選んでいた区分を外す
            if (!gasEcoNeeded()) state.todoGasEco = "";
            renderGasDiscounts();
            renderGasEco();
          }
          if (pair[1] === "todoDenkiType" || pair[1] === "todoGasType") {
            // プランを外したら、その現在の会社の選択も外す
            if (!state.todoDenkiType) state.todoDenkiNow = "";
            if (!state.todoGasType) state.todoGasNow = "";
            renderEnergyNow();
          }
          saveState(); renderStaffSheet();
        });
      });
    });
    /* 見積もりページの一番下からも保存できるようにする。
     * 入力を終えた場所でそのまま保存できるのが狙いなので、名前は日付とプラン名から
     * 自動で付ける。名前を決めて保存したいときは「保存」タブを使う。
     * ここに名前の入力欄を置かないのは、保存名が他の端末にも同期されるため。
     * 急いでいるとお客様の氏名を入れてしまいやすい。 */
    var quickSave = $("quickSaveBtn");
    if (quickSave) quickSave.addEventListener("click", function () {
      if (!state.planId && !window.confirm("料金プランを選んでいません。このまま保存しますか？")) return;
      var it = saveQuote("");
      var m = $("quickSaveMsg");
      if (!m) return;
      m.innerHTML = "「" + esc(it.name) + "」として保存しました。"
        + '<button type="button" class="link-btn" id="quickSaveOpen">保存した見積もりを見る</button>';
      m.hidden = false;
      clearTimeout(quickSaveTimer);
      quickSaveTimer = setTimeout(function () { m.hidden = true; }, 8000);
    });
    var qm = $("quickSaveMsg");
    if (qm) qm.addEventListener("click", function (e) {
      if (e.target && e.target.id === "quickSaveOpen") switchTab("saved");
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
    if ($("statsMonth")) {
      $("statsMonth").addEventListener("change", function () { renderStats(false); });
      $("statsStaff").addEventListener("change", function () { renderStats(false); });
      $("statsOpenBtn").addEventListener("click", function () {
        var p = $("statsPanel");
        p.hidden = !p.hidden;
        this.textContent = p.hidden ? "実績を見る" : "実績を閉じる";
        if (!p.hidden) renderStats(true);
      });
      $("statsReload").addEventListener("click", function () { renderStats(true); });
      $("noQuoteBtn").addEventListener("click", openNoQuoteDlg);
      $("statsUnlockBtn").addEventListener("click", function () {
        if (statsAdminOk()) { renderStats(true); return; }
        masterGateFrom = "stats";
        showMasterGate(true);
      });
      $("statsCsv").addEventListener("click", downloadStatsCsv);
      $("statsCsvFlat").addEventListener("click", downloadStatsFlatCsv);
      $("statsPrint").addEventListener("click", function () {
        document.body.classList.add("print-stats");
        window.print();
        setTimeout(function () { document.body.classList.remove("print-stats"); }, 800);
      });
      window.addEventListener("afterprint", function () {
        document.body.classList.remove("print-stats");
        document.body.classList.remove("print-morning");
      });
      // 朝礼サマリ: 目標と進捗・担当別だけをA4に出す（管理者）
      $("statsMorning").addEventListener("click", function () {
        document.body.classList.add("print-stats");
        document.body.classList.add("print-morning");
        window.print();
        setTimeout(function () {
          document.body.classList.remove("print-stats");
          document.body.classList.remove("print-morning");
        }, 800);
      });
      /* 件数の手修正（早見表の「修正」の ＋ −）。
       * 担当者は当月だけで、今日の記録として足し引きされる（日付キー）。
       * 管理者が過去の月を直すときは、その月の調整として足し引きする（月キー）。 */
      $("statsBody").addEventListener("click", function (e) {
        var t = e.target;
        if (t.id === "statsLockHintBtn") {
          // ロック未設定のお知らせから。この状態ではマスタ設定の関門は無いのでそのまま開く
          switchTab("master");
          return;
        }
        if (t.id === "statsUndoneBtn") {
          var st2 = $("savedStatus");
          if (st2) { st2.value = ""; renderSaved(); }
          var el2 = $("savedList");
          if (el2 && el2.scrollIntoView) el2.scrollIntoView({ block: "start" });
          return;
        }
        var key = t.getAttribute && t.getAttribute("data-adjk");
        if (!key) return;
        var dir = num(t.getAttribute("data-adjd"));
        var sSel = statsAdminOk() ? $("statsStaff").value : activeStaff().id;
        var mSel = $("statsMonth").value;
        if (!sSel || sSel === "all" || !mSel || mSel === "all") return;
        var curM = statsMonthOf(Date.now());
        var useDay = !statsAdminOk() || mSel === curM;
        var bag;
        if (useDay) {
          var day = adjTodayKey();
          if (!MASTER.statsAdjDay) MASTER.statsAdjDay = {};
          if (!MASTER.statsAdjDay[sSel]) MASTER.statsAdjDay[sSel] = {};
          if (!MASTER.statsAdjDay[sSel][day]) MASTER.statsAdjDay[sSel][day] = {};
          bag = MASTER.statsAdjDay[sSel][day];
        } else {
          if (!MASTER.statsAdjItem) MASTER.statsAdjItem = {};
          if (!MASTER.statsAdjItem[sSel]) MASTER.statsAdjItem[sSel] = {};
          if (!MASTER.statsAdjItem[sSel][mSel]) MASTER.statsAdjItem[sSel][mSel] = {};
          bag = MASTER.statsAdjItem[sSel][mSel];
        }
        var cur = bag[key] || { prop: 0, won: 0 };
        cur.won = Math.round(num(cur.won)) + dir;
        if (!cur.prop && !cur.won) delete bag[key]; else bag[key] = cur;
        saveMaster();
        renderStats(false);
      });
      // 保存タブの検索・絞り込み
      var ss = $("savedSearch"), sst = $("savedStatus");
      if (ss) ss.addEventListener("input", renderSaved);
      if (sst) sst.addEventListener("change", renderSaved);
    }
    var savedEl = $("savedList");
    if (savedEl) {
      savedEl.addEventListener("click", function (e) {
        var t = e.target;
        var lid = t.getAttribute && t.getAttribute("data-savedload");
        var did = t.getAttribute && t.getAttribute("data-saveddel");
        var rid = t.getAttribute && t.getAttribute("data-savedrid");
        var sid2 = t.getAttribute && t.getAttribute("data-savedsend");
        if (sid2) { forwardSaved(sid2); return; }
        if (rid) {
          setSavedResult(rid, t.getAttribute("data-savedresult") || "");
          return;
        }
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
    var adminSave = $("adminLockSaveBtn");
    if (adminSave) {
      adminSave.addEventListener("click", function () {
        var msg = $("adminLockMsg");
        var p1 = $("adminPass").value;
        var p2 = $("adminPass2").value;
        function say(t, ok) { msg.textContent = t; msg.className = "hint" + (ok ? " lock-on" : " lock-err"); msg.hidden = false; }
        if (!p1) return say("パスワードを入力してください。", false);
        if (p1.length < 4) return say("パスワードは4文字以上にしてください。", false);
        if (p1 !== p2) return say("パスワードが一致しません。", false);
        var salt = lockSalt();
        var algo = lockAlgo();
        lockHash(p1, salt, algo).then(function (h) {
          config.adminLock = { hash: h, salt: salt, algo: algo };
          saveConfig();
          $("adminPass").value = "";
          $("adminPass2").value = "";
          renderAdminLock();
          masterUnlocked = true; // 決めた本人なので、いまの操作は続けられるようにする
          say("マスタ設定のパスワードを設定しました。次に開くときから有効になります。", true);
        });
      });
    }
    var adminClear = $("adminLockClearBtn");
    if (adminClear) {
      adminClear.addEventListener("click", function () {
        config.adminLock = { hash: "", salt: "", algo: "" };
        saveConfig();
        renderAdminLock();
        var msg = $("adminLockMsg");
        msg.textContent = "解除しました。マスタ設定は店舗ID＋店舗のパスワードで開きます。";
        msg.className = "hint";
        msg.hidden = false;
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
        applyStoreDefaults(true); // 見積書の表示にすぐ反映する
      });
    }
    var storeTelEl = $("storeTelInput");
    if (storeTelEl) {
      storeTelEl.addEventListener("input", function () {
        config.storeTel = this.value;
        saveConfig();
        applyStoreDefaults(true);
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
        applyStoreDefaults(true); // 担当者名を変えたら見積書の表示にも反映する
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
        /* クラウド側の保存（見積もり・保存済み・テンプレ）も消す。
         * 残しておくと、IDが同じ担当者を作ったときに引き継がれてしまう。 */
        if (cloudOn()) {
          try {
            quoteDoc(removed.id).delete().catch(function () {});
            savedDoc(removed.id).delete().catch(function () {});
            tplDoc(removed.id).delete().catch(function () {});
          } catch (e3) {}
        }
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
      if (!state.netSvcKubun) state.netSvcKubun = {};
      var id = t.getAttribute("data-netsvc");
      if (id) {
        state.netSvc[id] = t.checked;
        if (!t.checked) delete state.netSvcKubun[id];   // 外したら区分も忘れる
      } else {
        id = t.getAttribute("data-netkubun");
        if (!id) return;
        state.netSvc[id] = true;
        state.netSvcKubun[id] = t.value;
      }
      if (state.netSvcOff) state.netSvcOff[id] = false;  // 旧形式（1.113.0以前）の印は消す
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
    ["usePoint", "devUsePoint"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state.usePoint = this.checked;
        syncFormFromState();
        recalc();
        renderStaffSheet();
      });
    });
    ["usePointAmount", "devUsePointAmount"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        state.usePointAmount = num(this.value);
        var other = $(id === "usePointAmount" ? "devUsePointAmount" : "usePointAmount");
        if (other) other.value = this.value;
        recalc();
      });
    });
    document.querySelectorAll("[data-proc]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (!state.procTodo) state.procTodo = {};
        state.procTodo[cb.getAttribute("data-proc")] = cb.checked;
        applyProcType(procTypeFromTodo());
        renderU15();
        recalc();
      });
    });
    $("u15").addEventListener("change", function () {
      state.u15 = this.checked;
      recalc();
    });

    /* 次のお客様の応対として仕切り直すので、回線1〜3をまとめて消す。
     * 1回線しか使っていないときは今までどおり黙って消し、
     * ほかの回線にも入力があるときだけ、消してよいか確かめる。 */
    /* 入力をクリアは、回線のバー（上）と操作の並び（下）の両方に置いてある。 */
    function clearQuoteAll() {
      var others = [];
      store.patterns.forEach(function (pt, i) {
        if (i === (store.active | 0)) return;
        var m = Object.assign(defaultState(), pt || {});
        if (isPatternUsed(m) || m.planId || m.procType) others.push("回線" + (i + 1));
      });
      if (others.length && !window.confirm(
            others.join("・") + " にも入力があります。\n回線1〜3をすべて消してよろしいですか？")) return;
      resetPropTracking();
      var keep = { shopName: state.shopName, staffName: state.staffName, shopTel: state.shopTel };
      store.gen = (store.gen | 0) + 1;  // お客様の区切り（前のお客様の読み取りを他端末で付け直さない）
      store.patterns = [defaultState(), defaultState(), defaultState()];
      /* 光・5Gもリセットする。パターンの外（store.ienaka）にあるため、ここで消さないと
       * 前のお客様の光が次の見積もりに残り、「含める」が勝手に入っているように見える。 */
      applyIenaka(null);
      store.active = 0;
      state = store.patterns[0];
      state.shopName = keep.shopName;
      state.staffName = keep.staffName;
      state.shopTel = keep.shopTel;
      state.jimuFee = autoFeeProc(state.procType) ? jimuFeeFor(state.procType) : 0;
      state.atamakin = autoFeeProc(state.procType) ? MASTER.fees.atamakin_default : 0;
      renderPatternTabs();
      syncFormFromState();
      recalc();
    }
    $("clearQuote").addEventListener("click", clearQuoteAll);
    $("clearQuoteTop").addEventListener("click", clearQuoteAll);

    // マスタ編集
    $("masterBody").addEventListener("input", function (e) {
      var t = e.target;
      if (handlePlanEvent(t, "input")) return;
      if (handleEnergyEvent(t, "input")) return;
      if (handleStatsCfgEvent(t, "input")) return;
      var path = t.getAttribute("data-mpath");
      if (path) {
        /* マイナスは受け付けない。料金マスタに負の値が入ると、
         * 店舗内の全端末の全見積もりが狂う（値引きは値引きの欄で入れる）。 */
        setPath(path, Math.max(0, num(t.value)));
        markEdited();
        recalc();
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
      if (handlePlanEvent(e.target, "change")) return;
      if (handleStatsCfgEvent(e.target, "change")) return;
      handleListEvent(e.target, "change");
    });
    $("masterBody").addEventListener("click", function (e) {
      if (e.target.getAttribute && e.target.getAttribute("data-arrange-start")) {
        enterArrange();
        return;
      }
      if (e.target.getAttribute && e.target.getAttribute("data-qc-reset")) {
        delete MASTER.quoteCardOrder;
        markEdited(); applyQuoteCardOrder(); renderMasterTab();
        return;
      }
      if (e.target.getAttribute && e.target.getAttribute("data-oc-reset")) {
        delete MASTER.optCatOrder;
        markEdited(); renderOptionList(); renderMasterTab();
        return;
      }
      var msecHead = e.target.closest && e.target.closest("[data-msec-key]");
      if (msecHead) {
        var msecKey = msecHead.dataset.msecKey;
        masterFoldOpen[msecKey] = !masterFoldOpen[msecKey];
        applyMasterFoldState();
        return;
      }
      if (handlePlanEvent(e.target, "click")) return;
      if (handleEnergyEvent(e.target, "click")) return;
      var hr = e.target.getAttribute && e.target.getAttribute("data-hist-restore");
      if (hr) {
        if (window.confirm("この時点の内容に戻しますか？\nいまの内容も履歴に残るので、あとから戻せます。")) histRestore(hr);
        return;
      }
      if (e.target.id === "muApply") {
        if (window.confirm("新しい料金表に更新しますか？\n更新前の内容は履歴に残るので、あとから戻せます。")) applyMasterUpdate();
        return;
      }
      var hd = e.target.getAttribute && e.target.getAttribute("data-hist-del");
      if (hd) {
        if (window.confirm("この履歴を削除しますか？")) histDelete(hd);
        return;
      }
      if (e.target.id === "histSaveBtn") {
        var lb = $("histLabel").value.trim();
        histAdd(lb || "手動で保存", JSON.stringify(MASTER), false);
        $("histLabel").value = "";
        histMsg("履歴に残しました");
        return;
      }
      var t = e.target;
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
  /* ---------- 金額計算のテスト用フック ----------
   * URL に ?kqtest=1 を付けたときだけ有効。CI（tests/run-calc-tests.js）が
   * 代表パターンの金額を検算するために使う。通常の利用では作られない。 */
  if (/[?&]kqtest=1/.test(location.search)) {
    window.__KQ_TEST__ = {
      version: APP_VERSION,
      run: function (patch) {
        var keep = JSON.parse(JSON.stringify(store.patterns[store.active]));
        var p = Object.assign(defaultState(), patch || {});
        migratePattern(p);
        store.patterns[store.active] = p;
        state = p;
        var r = calc();
        var out = {
          initial: r.initialTotal,
          store: r.storeTotal,
          bill: r.billTotal,
          dcardPt: r.dcardAutoPt || 0,   // dカード還元の自動計算（割引後ベース）も golden で見張る
          segs: r.segs.map(function (sg) {
            var o = { from: sg.from, to: sg.to === Infinity ? "inf" : sg.to, monthly: sg.monthly };
            if (typeof sg.monthlyKeep === "number") o.keep = sg.monthlyKeep;
            return o;
          })
        };
        store.patterns[store.active] = Object.assign(defaultState(), keep);
        state = store.patterns[store.active];
        recalc();
        return out;
      },
      // 請求内訳の読み取り（tests/run-bill-tests.js が使う）
      parseBill: function (t) { return parseBillText(t); },
      // curBill が同期ペイロードに漏れないことの検査用
      setCurBill: function (b) { state.curBill = b || null; },
      quotePayload: function () { return quotePayload(); },
      // メール欄の検査用: 店舗マスタに入っている前提のメールオプションを足す
      ensureMailOpt: function () {
        if (!mailOptDef()) MASTER.options.push({ id: "docomomail", name: "ドコモメールオプション", price: 330, category: "その他" });
        renderMailOpt(); recalc();
      }
    };
  }

  loadConfig();
  loadMaster();
  loadState();
  if (!state.jimuFee && autoFeeProc(state.procType) && !localStorage.getItem(quoteKey())) {
    state.jimuFee = jimuFeeFor(state.procType);
    state.atamakin = MASTER.fees.atamakin_default;
  }
  /* 成約・見送りは「⋯」を押したときだけ出す。
   * お客様に画面を見せながら操作するため、常時「成約」「見送り」の文字が
   * 見えていると印象が悪い。 */
  $("recMenuBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    var m = $("recMenu");
    m.hidden = !m.hidden;
  });
  document.addEventListener("click", function (e) {
    var m = $("recMenu");
    if (!m || m.hidden) return;
    if (!e.target.closest || !e.target.closest(".sum-rec")) m.hidden = true;
  });
  /* ---------- 入力のしかたの小窓（カード見出しの「?」） ----------
   * 見積もり画面の各カードに「?」を置き、その項目に何をどう入れるかを出す。
   * 文面はここで持つ（マスタではない）。自動入力の決まりなど、
   * 仕組みを知らないと戸惑うところを優先して書く。 */
  var QUOTE_HELP = {
    tpl: { t: "テンプレート", b: "よく使う見積もりの形を3つまで登録して、1タップで呼び出せます。\n・保存: 「現在の内容をテンプレに保存」→ 保存先のボタンをタップ → 名前を付けて保存\n・呼び出し: ボタンをタップ（お客様名と店舗情報は今の内容のまま残ります）\n・<b>削除: ボタンを長押しして、動かさずに離す</b>と出るメニューで「削除」を選びます（PCは右クリックでも出ます）\n・<b>並べ替え: 長押しでつかんだまま、別のボタンの上へ動かして離す</b>と入れ替わります\n・「テンプレート」は担当ごと、「店舗共通」は全担当で共有です" },
    purpose: { t: "ご来店の目的", b: "お客様が何をしに来られたかにチェックします（複数可）。金額には影響しません。\n・引き継ぎシートと実績の集計に使われます\n・1商談に1つで、回線1に入れた内容が使われます\n・「端末購入」以外で来られて、その場で機種もご購入になったときは「買い増しあり」にチェックすると、実績に買い増しとして数えられます" },
    proc: { t: "手続き内容", b: "今回の応対でやることにチェックします。引き継ぎシートの「やること」欄になります。\n・機種変更・新規・MNP・プラン変更は①の手続き種別と連動し、事務手数料の判定に使われます（複数チェックのときは MNP → 新規 → 機種変更 → プラン変更 の順で判定）\n・dカード・でんき・ガス・光にチェックすると、種類を選ぶ欄が開きます\n・「その他」は引き継ぎシートにそのまま載ります。お客様名などの個人情報は書かないでください" },
    c1: { t: "① 契約内容", b: "・手続き種別: <b>新規契約・機種変更を選ぶと、⑦の事務手数料と店頭頭金が自動で入ります</b>（MNP・プラン変更は店頭で発生しないため入りません）。未選択の間はどちらも0円のままです\n・プラン世代: いま受付中の「現行プラン」と、継続中の方向けの「旧プラン（受付終了）」を切り替えます\n・料金プラン: 選ぶと月額の計算が始まります。段階制プランは「想定データ利用量」も選びます\n・「料金プランの変更あり」は引き継ぎシート用のチェックです" },
    c2: { t: "② 通話・メール", b: "・通話オプション: 5分通話無料／かけ放題を選びます。<b>かけ放題のときは留守番電話・キャッチホンが無料の扱い</b>になり、見積書では通話オプションの行にまとめて出ます\n・ネットワークサービス: 留守番電話などにチェックし、新規／継続／廃止を選びます。継続は月額に入り、廃止は入りません（引き継ぎシートに廃止として載ります）\n・ドコモメール: mini・ahamo・irumo など<b>メールが有料オプションのプランを選んだときだけ</b>タイルが出ます。タップで選び、タイルの中で新規／継続／廃止を選びます。新規・継続は月額に入り、廃止は入りません。標準で込みのプラン（MAX等）ではタイルごと出ません" },
    c3: { t: "③ 割引", b: "チェックを入れると適用されます。みんなドコモ割は回線数、dカードお支払割はカードの種類、長期利用割は年数がチェックの下に開きます。\n・「その他割引」を開くと、ハーティ割引と子育てサポート割引（ひとり親世帯・要確認書類）が選べます\n月額から引かれる割引を選びます。割引額はプランごとにマスタ設定で決まっています。\n・みんなドコモ割: ご家族の回線数で選びます\n・ドコモ光／home 5G セット割: 光やhome 5Gと一緒にお使いになる場合にチェックします\n・dカードお支払割: 券種は頭文字で選びます（R=dカード／G=GOLD／U=GOLD U／P=PLATINUM）。券種で⑧のdカード還元の自動計算も変わります\n・ハーティ割引: みんなドコモ割・dカードお支払割とは重ねられません（重なったときは計算に入れません）\n・子育てサポート割引: みんなドコモ割とは重ねられません（重なったときは計算に入れません）。子育てサポート割引とも同時適用できず、片方を選ぶともう片方は外れます\n・キャンペーンの割引をチェックすると、<b>終了後の金額まで見積書の「月額の推移」に自動で出ます</b>" },
    c4: { t: "④ オプション・サービス", b: "お客様が使うサービスをタップで選びます。\n・区分（新規・継続・廃止）を選ぶと引き継ぎシートに反映されます。「廃止」は料金に入れません\n・金額が複数あるサービスはプルダウンで選べます\n・並び順・単価・取り扱いはマスタ設定タブで変えられます（タイルの長押しドラッグで並べ替え）\n・「＋ 月額の追加項目」で、リストにない項目を±の金額で足せます（割引はマイナスで）。<b>月数を入れると「◯か月間だけ」になり、月額の推移に反映されます</b>" },
    c5: { t: "⑤ 端末代金", b: "・支払い方法を選ぶと、必要な入力欄が開きます\n・端末代金総額は<b>頭金を含んだ総額</b>を入れます。分割は「総額 − 店頭頭金」で計算します\n・いつでもカエドキは、残価ではなく<b>「23回分の総額（頭金込み）」</b>を入れます。店頭でご案内する実質額がそのまま入力値になり、残価は自動で逆算されます\n・クーポン値引きなどの値引きは<b>頭金から先に</b>引きます（店頭のお支払いが先に軽くなります）\n・「現在の分割支払金」は、いま支払い中の機種代金を続けて払う場合に入れます。残り回数を入れると、払い終わったあとの金額も月額の推移に出ます\n・端末マスタを取り込んでいる店舗は、機種を選ぶと金額が自動で入ります" },
    c6: { t: "⑥ アクセサリ", b: "・定番商品はタイルをタップして選び、タイルの中で一括／分割を選びます\n・リストにない商品は「＋ アクセサリを追加」から名前と金額を入れます\n・一括のぶんは⑦の店頭お支払いに、分割（12・24・36回）は月額に入ります\n・定番商品の内容はマスタ設定で編集できます" },
    c7: { t: "⑦ 初期費用", b: "・契約事務手数料と店頭頭金は、①の手続き種別から自動で入ります（手で書き換えられます）\n・データ移行サポートなどの項目はチェックで足します\n・「＋ 初期費用の追加項目」は±の金額で自由に足せます（下取りなどの値引きはマイナスで）\n・店頭お支払いの方法（現金・カード・d払い）のチェックは引き継ぎシートに載ります\n・dポイント利用は<b>頭金 → 分割金 → 残価</b>の順に充当します（1pt = 1円）\n・見積書では「店頭でお支払い」と「翌月の携帯料金と合算」に分かれて出ます" },
    c8: { t: "⑧ ポイント", b: "もらえるdポイントを「実質額」のご案内に使えます。\n・爆アゲセレクションやdカードの還元は、④と③の選択から自動で計算されます（金額は直接書き換えられます）\n・はじめの設定は<b>「充当しない」</b>: 月額はそのままに、もらえるポイントと実質額を見積書に添えます\n・「月額から充当する」にすると、月額からポイントを引いた実質額でご案内します\n・進呈ポイントは毎月の請求が下がるものではないため、実質額を多めに見せない作りにしています\n・<b>MNP特典（SIMのみ）</b>: MNPで端末を購入しないときだけ欄が出ます。キャッシュバックかdポイント還元と金額を入れると、見積書と引き継ぎシートに「いくらでご案内したか」が残ります。月額・初期費用の計算には入りません" },
    c9: { t: "⑨ 備考・その他特記事項", b: "自由に書ける欄と、見積書に入るお客様情報です。\n・「その他・特記事項」は<b>引き継ぎシートの「その他」</b>に載ります（例：データ移行あり／来店時にSIM再発行）。お客様名などの個人情報は書かないでください\n・「メモ」は<b>見積書の下</b>に「※」付きで載ります\n・お客様名は<b>この端末の中だけ</b>に保存され、端末間で同期されません。印刷する端末で入力してください\n・店舗名・担当・電話番号は、マスタ設定の店舗情報とログイン中の担当者から自動で入り、見積書の下端に載ります。この見積もりだけ変えたいときは書き換えられます" },
    curbill: {
      t: "現在のお支払い（請求内訳の読み取り）",
      b: "お客様のいまのお支払いを読み取って、この見積もりと比べられます。\n"
        + (OCR_ON
          ? "・「カメラで読み取る」で請求書や My docomo の内訳を撮ると、行ごとの金額になります（初回だけ読み取りの部品 約6.5MB を読み込みます。以後はオフラインでも動きます）\n・撮った写真は解析が終わると破棄され、どこにも保存されません\n"
          : "")
        + "・「請求内訳を読み取る」→ iPadは入力欄をタップしてもう一度タップ →「テキストをスキャン」でカメラを請求書にかざすと文字が入ります（iPadOS 16以降）。写真アプリで文字を長押し →「すべてを選択」→ コピー → 貼り付けでも入ります\n"
        + "・読み取った行は<b>必ず内容を確かめて</b>、違う行は直すか「×」で消してください。合計行とズレがあると⚠でお知らせします\n"
        + "・読み取った内容が外部へ送信されることはありません\n"
        + "・読み取ると、画面下のバーと見積書に「現在のお支払いとの比較」が出ます\n"
        + "・お客様名と同じく端末間では同期されません（この端末の中だけ）"
    }
  };
  /* 押した「?」の横に吹き出しで出す。画面を覆わないので、
   * 説明を読みながらそのまま入力できる。
   * ページと一緒に動くよう、body に絶対位置（ページ座標）で置く。 */
  function closeHelpPop() {
    var pop = $("helpPop");
    if (pop && !pop.hidden) {
      pop.hidden = true;
      if (helpPopBtn) helpPopBtn.setAttribute("aria-expanded", "false");
      helpPopBtn = null;
    }
  }
  var helpPopBtn = null;
  function openHelpPop(btn, key) {
    var h = QUOTE_HELP[key], pop = $("helpPop");
    if (!h || !pop || !btn) return;
    $("helpPopTitle").textContent = h.t;
    // 文面はこのファイルに直書きの固定文だけ（入力値は入らない）。
    // 文中の丸数字（「⑦の事務手数料」など）は、カードの並び順に合わせて置き換える
    $("helpPopBody").innerHTML = remapCircled(h.b);
    // 大きさを測るために、いったん出してから位置を決める
    pop.style.left = "0px";
    pop.style.top = "0px";
    pop.hidden = false;
    helpPopBtn = btn;
    btn.setAttribute("aria-expanded", "true");

    var GAP = 10, EDGE = 8;
    var r = btn.getBoundingClientRect();
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var sx = window.pageXOffset, sy = window.pageYOffset;
    // 「?」の中央に寄せ、画面からはみ出す分を内側へ戻す
    var left = r.left + r.width / 2 - pw / 2;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - pw - EDGE));
    /* 下に入りきらず、上には入るときだけ上に出す。
     * 入りきらない場合でも下に出す（吹き出し自体が縦にスクロールする） */
    var upper = r.top - GAP - ph;
    var above = (r.bottom + GAP + ph > window.innerHeight - EDGE) && upper > EDGE;
    var top = above ? upper : r.bottom + GAP;
    pop.classList.toggle("pop-above", above);
    pop.style.left = Math.round(left + sx) + "px";
    pop.style.top = Math.round(top + sy) + "px";
    // 矢印は「?」の真下（真上）を指す
    var ax = Math.max(14, Math.min(r.left + r.width / 2 - left, pw - 14));
    $("helpPopArrow").style.left = Math.round(ax - 6) + "px";
  }
  /* 見積書のサービス名をタップしたら説明の小窓、カードの「?」なら入力のしかたの吹き出しを出す */
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;
    var hb = e.target.closest(".card-help");
    if (hb) {
      // 開いている「?」をもう一度押したら閉じる
      if (helpPopBtn === hb) closeHelpPop();
      else openHelpPop(hb, hb.getAttribute("data-help"));
      return;
    }
    if (!e.target.closest("#helpPop") || e.target.id === "helpPopClose") closeHelpPop();
    var b = e.target.closest(".svc-link");
    if (b) { openSvcDlg(b.getAttribute("data-svc")); return; }
    var dlg = $("svcDlg");
    if (dlg && !dlg.hidden && (e.target === dlg || e.target.id === "svcDlgClose")) dlg.hidden = true;
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var dlg = $("svcDlg");
    if (dlg && !dlg.hidden) dlg.hidden = true;
    closeHelpPop();
  });
  /* 画面の幅が変わると位置がずれるので閉じる（回転・キーボードの開閉）。
   * 縦スクロールはページ座標で置いているため一緒に動く。
   * タブ切替など他の場所をタップしたときは、上の「外側タップ」で閉じる */
  window.addEventListener("resize", closeHelpPop);
  $("recWonBtn").addEventListener("click", function () { $("recMenu").hidden = true; recordOutcome("won"); });
  $("recLostBtn").addEventListener("click", function () { $("recMenu").hidden = true; recordOutcome("lost"); });
  bindEvents();
  syncFormFromState();
  renderTplBar();
  recalc();
  loadSaved();
  renderSaved();
  loadTemplates();
  loadStoreTemplates();
  renderTplBar();
  renderStoreConfig();
  applyStoreDefaults(false);
  renderLockConfig();
  renderAdminLock();
  histLoadLocal();
  histMark();
  initIdle();
  initLocalLock();
  initStaffGate();
  initMasterGate();
  initPowerSave();
  initCalc();
  initAbout();
  initDocs();
  initContract();
  initIenaka();
  initWizard();
  initBackup();
  initIenakaLink();
  initTileSort();
  initTplHold();
  initTour();
  initSheetFs();
  initPresent();
  initMasterSearch();
  initMasterRooms();
  initArrange();
  renumberQuoteCards(); // 保存済みの並びがある店舗は、開いた時点で番号を振り直す
  initImportMaster();
  initDeviceMaster();
  initCurBill();
  var gasZipInp = $("gasAreaZip");
  if (gasZipInp) gasZipInp.addEventListener("input", renderGasArea);
  initCloud(); // ログイン・端末間同期はUI初期化が終わってから開始
  // 何かの理由で画面の決定に至らなくても、隠したままにはしない
  setTimeout(bootDone, 6000);
})();
