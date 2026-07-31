/* 他社比較（ネット回線）＝ 奪還ツール — 単体アプリの入れ物
 *
 * この app.js が持つのは「ログイン・保存・同期・担当者・マスタ設定・別紙の体裁」だけ。
 * 計算と入力画面は次の2つのモジュールが持つ:
 *   - KQ_DAKKAN（dakkan.js） … ①いまのご契約・②乗り換え費用・④比べる・別紙の中身
 *   - KQ_IENAKA（ienaka.js） … ドコモ光・home 5G の入力と計算（keitai-app からのコピー）
 *
 * ★ ienaka.js の正は keitai-app 側。直したいことが出たら keitai-app を直してからコピーし直す。
 * ★ localStorage のキーは dk- 接頭辞。同じドメインに kq-（ケータイ製品版）・dq-（社内版）・
 *   ienaka-app-（イエナカ単体版）が同居するため、絶対に衝突させない。
 */
(function () {
  "use strict";
  var APP_VERSION = "1.1.0";
  var KEY = "dk-state-v1";
  var CFG_KEY = "dk-config-v1";
  var MASTER_KEY = "dk-master-v1";

  /* ---------- 他社料金マスタ（店舗が編集できる） ---------- */
  var SHIP = JSON.parse(JSON.stringify(window.DAKKAN_DATA));   // 出荷時の値（戻せるように保持）
  function applyMaster() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(MASTER_KEY) || "null"); } catch (e) {}
    if (!saved) return;
    if (saved.dataDate) window.DAKKAN_DATA.dataDate = saved.dataDate;
    if (!saved.carriers) return;
    window.DAKKAN_DATA.carriers.forEach(function (c) {
      var o = saved.carriers[c.id];
      if (!o) return;
      Object.keys(o).forEach(function (k) { c[k] = o[k]; });
    });
  }
  applyMaster();

  /* ---------- 店舗設定・担当者 ---------- */
  function defaultConfig() {
    return { storeName: "", staff: [{ id: "s1", name: "担当1" }], activeStaffId: "s1" };
  }
  var config = defaultConfig();
  try {
    var savedCfg = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
    if (savedCfg && savedCfg.staff && savedCfg.staff.length) config = Object.assign(defaultConfig(), savedCfg);
  } catch (e) {}
  function saveConfig() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(config)); } catch (e) {}
    pushConfig();
  }
  function activeStaff() {
    var s = config.staff.filter(function (x) { return x.id === config.activeStaffId; })[0];
    if (!s) { s = config.staff[0]; config.activeStaffId = s.id; }
    return s;
  }
  function quoteKey(staffId) { return KEY + ":" + (staffId || activeStaff().id); }

  /* ---------- 状態 ----------
   * store.ienaka と store.dakkan は、モジュールが参照を握っている入れ物。
   * 復元のときは入れ物を差し替えず、中身だけ入れ替えること（イエナカ統合の教訓）。 */
  function defaultStore() {
    return {
      custName: "",
      ienaka: Object.assign(window.KQ_IENAKA.defaultState(), { enabled: true }),
      dakkan: window.KQ_DAKKAN.defaultState()
    };
  }
  var store = defaultStore();

  function fill(target, src, fallback) {
    Object.keys(target).forEach(function (k) { delete target[k]; });
    var base = fallback();
    Object.keys(base).forEach(function (k) { target[k] = base[k]; });
    if (src) Object.keys(src).forEach(function (k) { target[k] = src[k]; });
  }
  /* 保存データ・同期データを画面へ流し込む共通経路。復元はすべてここを通す */
  function applyStore(saved) {
    if (!saved) return;
    if (typeof saved.custName === "string") store.custName = saved.custName;
    fill(store.ienaka, saved.ienaka, function () {
      return Object.assign(window.KQ_IENAKA.defaultState(), { enabled: true });
    });
    fill(store.dakkan, saved.dakkan, window.KQ_DAKKAN.defaultState);
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(quoteKey());
      applyStore(JSON.parse(raw || "null"));
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(quoteKey(), JSON.stringify(store)); } catch (e) {}
    pushQuote();
  }

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function yen(n) { return (n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("ja-JP") + "円"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 再計算 ---------- */
  function recalc() {
    var r = window.KQ_DAKKAN.calc();
    if (!r) return;
    $("sumNow").textContent = r.nowMonthly == null ? "—" : yen(r.nowMonthly);
    $("sumNew").textContent = yen(r.newMonthly);
    $("sumInitial").textContent = yen(r.total);
    if ($("tab-sheet").classList.contains("active")) renderSheet();
  }
  /* モジュールから「状態が変わった」と知らされたとき */
  function onDakkanChange() { save(); syncSummary(); }
  function onIenakaChange() {
    save();
    /* 住居タイプ（戸建／マンション）はイエナカ側で持っているので、
     * 他社の違約金・撤去費の目安も戸建／マンションを合わせ直す */
    window.KQ_DAKKAN.syncDefaultsForHousing();
    window.KQ_DAKKAN.render();   // ドコモ側が変わると比較も変わる
    syncSummary();
  }
  function syncSummary() {
    var r = window.KQ_DAKKAN.calc();
    if (!r) return;
    $("sumNow").textContent = r.nowMonthly == null ? "—" : yen(r.nowMonthly);
    $("sumNew").textContent = yen(r.newMonthly);
    $("sumInitial").textContent = yen(r.total);
    if ($("tab-sheet").classList.contains("active")) renderSheet();
  }

  /* ---------- 別紙（A4 1枚） ---------- */
  function renderSheet() {
    var d = new Date();
    var h = '<h2 class="sheet-title">ネット回線 お比べのご案内</h2>';
    h += '<div class="sheet-meta"><span>' + (config.storeName ? esc(config.storeName) + "　" : "")
      + "担当 " + esc((activeStaff() || {}).name || "") + "</span>"
      + "<span>発行日 " + d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日</span></div>";
    if (store.custName) h += '<div class="cust">' + esc(store.custName) + " 様</div>";
    h += window.KQ_DAKKAN.sheetHtml();
    h += '<p class="disclaimer">本紙は概算のご案内です。実際のご請求はお客様のご契約内容により異なります。'
      + "ドコモ側の金額は同日時点の当店調べによるものです。（" + esc(APP_VERSION) + "）</p>";
    $("sheetBody").innerHTML = h;
  }

  /* ---------- マスタ設定（他社の料金データ） ---------- */
  function masterField(c, key, label, val) {
    return '<label class="dkm-f"><span>' + esc(label) + "</span>"
      + '<input type="number" inputmode="numeric" data-dkm="' + esc(c.id) + '" data-dkf="' + esc(key) + '"'
      + ' value="' + (val == null ? "" : esc(val)) + '" placeholder="未確認"></label>';
  }
  function renderMasterTab() {
    $("dataDateLabel").textContent = window.DAKKAN_DATA.dataDate || "（未設定）";
    var h = '<label class="dkm-f dkm-date"><span>料金データ基準日</span>'
      + '<input type="text" id="dkDataDate" value="' + esc(window.DAKKAN_DATA.dataDate || "") + '" placeholder="2026-07-30"></label>';
    var byType = {};
    window.DAKKAN_DATA.carriers.forEach(function (c) { (byType[c.type] = byType[c.type] || []).push(c); });
    window.DAKKAN_DATA.lineTypes.forEach(function (lt) {
      if (!byType[lt.id]) return;
      h += '<h3 class="dkm-h">' + esc(lt.name) + "</h3>";
      byType[lt.id].forEach(function (c) {
        h += '<div class="dkm-row"><div class="dkm-name">' + esc(c.name) + "</div>";
        if (c.note) h += '<p class="hint dkm-note">' + esc(c.note) + "</p>";
        h += masterField(c, "monthly.ht", "標準月額 戸建", c.monthly ? c.monthly.ht : null);
        h += masterField(c, "monthly.ms", "標準月額 ﾏﾝｼｮﾝ", c.monthly ? c.monthly.ms : null);
        h += masterField(c, "penalty.ht", "違約金 戸建", c.penalty ? c.penalty.ht : null);
        h += masterField(c, "penalty.ms", "違約金 ﾏﾝｼｮﾝ", c.penalty ? c.penalty.ms : null);
        if (lt.removal) h += masterField(c, "removal", "撤去工事費", c.removal);
        if (lt.apply === "jigyosha" || lt.apply === "tenyo") h += masterField(c, "numberFee", "承諾番号手数料", c.numberFee);
        h += '<label class="dkm-f dkm-tel"><span>解約の連絡先</span>'
          + '<input type="text" data-dkm="' + esc(c.id) + '" data-dkf="tel" value="' + esc(c.tel || "") + '" placeholder="未確認"></label>';
        if (c.src) h += '<p class="hint dkm-src">出典: ' + esc(c.src) + "</p>";
        h += "</div>";
      });
    });
    $("dkMasterList").innerHTML = h;
  }
  function saveMaster() {
    var out = { dataDate: ($("dkDataDate") || {}).value || "", carriers: {} };
    $("dkMasterList").querySelectorAll("[data-dkm]").forEach(function (el) {
      var id = el.getAttribute("data-dkm"), f = el.getAttribute("data-dkf");
      var o = out.carriers[id] = out.carriers[id] || {};
      var v = el.value.trim();
      if (f === "tel") { o.tel = v; return; }
      var n = v === "" ? null : num(v);
      var dot = f.indexOf(".");
      if (dot > 0) {
        var grp = f.slice(0, dot);
        o[grp] = o[grp] || {};
        o[grp][f.slice(dot + 1)] = n;
      } else {
        o[f] = n;
      }
    });
    /* 戸建／マンションは片側だけ書くと欠けるので、両方揃えてから保存する */
    Object.keys(out.carriers).forEach(function (id) {
      var o = out.carriers[id];
      ["monthly", "penalty"].forEach(function (g) {
        if (o[g]) { if (o[g].ht === undefined) o[g].ht = null; if (o[g].ms === undefined) o[g].ms = null; }
      });
    });
    try { localStorage.setItem(MASTER_KEY, JSON.stringify(out)); } catch (e) {}
    if (out.dataDate) window.DAKKAN_DATA.dataDate = out.dataDate;
    window.DAKKAN_DATA.carriers.forEach(function (c) {
      var o = out.carriers[c.id];
      if (o) Object.keys(o).forEach(function (k) { c[k] = o[k]; });
    });
    renderMasterTab();
    window.KQ_DAKKAN.syncForm();
    window.KQ_DAKKAN.render();
    syncSummary();
    alert("他社の料金データを保存しました。");
  }
  function resetMaster() {
    if (!confirm("他社の料金データを出荷時の状態に戻しますか？\nこの端末で編集した内容は失われます。")) return;
    try { localStorage.removeItem(MASTER_KEY); } catch (e) {}
    window.DAKKAN_DATA.dataDate = SHIP.dataDate;
    window.DAKKAN_DATA.carriers.forEach(function (c) {
      var s = SHIP.carriers.filter(function (x) { return x.id === c.id; })[0];
      if (s) Object.keys(s).forEach(function (k) { c[k] = JSON.parse(JSON.stringify(s[k])); });
    });
    renderMasterTab();
    window.KQ_DAKKAN.syncForm();
    window.KQ_DAKKAN.render();
    syncSummary();
  }

  /* ---------- 担当者 ---------- */
  function renderStaffSelect() {
    $("staffSelect").innerHTML = config.staff.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === config.activeStaffId ? " selected" : "") + ">"
        + esc(s.name || "（無名）") + "</option>";
    }).join("");
    $("storeLabel").textContent = config.storeName || "";
  }
  function renderConfigTab() {
    $("storeName").value = config.storeName || "";
    $("custName").value = store.custName || "";
    $("staffList").innerHTML = config.staff.map(function (s, i) {
      return '<div class="adhoc-row">'
        + '<input type="text" value="' + esc(s.name) + '" data-staff="' + i + '" placeholder="担当者名">'
        + (config.staff.length > 1 ? '<button class="del" data-staffdel="' + i + '" type="button" aria-label="削除">×</button>' : "")
        + "</div>";
    }).join("");
  }
  function syncAll() {
    window.KQ_IENAKA.syncForm();
    window.KQ_DAKKAN.syncForm();
    window.KQ_IENAKA.render();
    window.KQ_DAKKAN.render();
    syncSummary();
  }
  function switchStaff(id) {
    save();
    config.activeStaffId = id;
    saveConfig();
    applyStore(defaultStore());   // いったん初期化してから読み直す
    loadState();
    syncAll();
    watchQuote();
  }

  /* ---------- クラウド保存（店舗アカウント） ----------
   * Firebaseが設定されている場合のみ有効。未設定なら端末内保存のみで動作する。
   * お客様名は個人情報のためクラウドへ送信しない。 */
  var CLOUD = {
    enabled: false, user: null, db: null, auth: null,
    suppress: false, cfgTimer: null, quoteTimer: null,
    unsubStore: null, unsubQuote: null, watchingStaffId: null,
    clientId: Math.random().toString(36).slice(2) + Date.now().toString(36)
  };
  function cloudOn() { return CLOUD.enabled && CLOUD.user && CLOUD.db; }
  function cloudStatus(msg, cls) {
    var el = $("cloudStatus");
    if (el) { el.textContent = msg || ""; el.className = "sync-status" + (cls ? " " + cls : ""); }
  }
  function storeDoc() { return CLOUD.db.collection("stores").doc(CLOUD.user.uid); }
  function quoteDoc(staffId) { return storeDoc().collection("dakkan").doc(staffId); }
  function stamp(extra) {
    var o = { clientId: CLOUD.clientId, updatedAtMs: Date.now(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }
  function cloudOk() { cloudStatus("同期✓", "ok"); }
  function cloudNg(err) {
    cloudStatus(/permission|insufficient/i.test(String(err)) ? "同期:権限エラー" : "同期:オフライン", "err");
  }
  function pushConfig() {
    if (!cloudOn() || CLOUD.suppress) return;
    if (CLOUD.cfgTimer) clearTimeout(CLOUD.cfgTimer);
    cloudStatus("同期中…", "");
    CLOUD.cfgTimer = setTimeout(function () {
      CLOUD.cfgTimer = null;
      if (!cloudOn()) return;
      storeDoc().set(stamp({ storeName: config.storeName || "", staff: config.staff }), { merge: true })
        .then(cloudOk, cloudNg);
    }, 800);
  }
  // 送信用のデータ。お客様名（個人情報）はクラウドへ送らない
  function quotePayload() {
    try {
      var s = JSON.parse(JSON.stringify(store));
      s.custName = "";
      if (s.ienaka) s.ienaka.custName = "";
      return JSON.stringify(s);
    } catch (e) { return ""; }
  }
  function pushQuote() {
    if (!cloudOn() || CLOUD.suppress) return;
    var sid = activeStaff().id;
    if (CLOUD.quoteTimer) clearTimeout(CLOUD.quoteTimer);
    cloudStatus("同期中…", "");
    CLOUD.quoteTimer = setTimeout(function () {
      CLOUD.quoteTimer = null;
      if (!cloudOn()) return;
      quoteDoc(sid).set(stamp({ data: quotePayload() })).then(cloudOk, cloudNg);
    }, 800);
  }
  function applyRemoteConfig(d) {
    CLOUD.suppress = true;
    try {
      if (typeof d.storeName === "string") config.storeName = d.storeName;
      if (d.staff && d.staff.length) {
        config.staff = d.staff;
        if (!config.staff.some(function (s) { return s.id === config.activeStaffId; })) {
          config.activeStaffId = config.staff[0].id;
          loadState();
          syncAll();
        }
      }
      try { localStorage.setItem(CFG_KEY, JSON.stringify(config)); } catch (e) {}
      renderStaffSelect();
      renderConfigTab();
    } finally { CLOUD.suppress = false; }
  }
  function applyRemoteQuote(d) {
    if (!d || !d.data) return;
    CLOUD.suppress = true;
    try {
      var incoming = JSON.parse(d.data);
      // お客様名は同期しないため、この端末で入力済みの名前を保持する
      var keepName = store.custName;
      applyStore(incoming);
      if (!store.custName && keepName) store.custName = keepName;
      try { localStorage.setItem(quoteKey(), JSON.stringify(store)); } catch (e) {}
      syncAll();
      renderConfigTab();
      cloudOk();
    } catch (e) {} finally { CLOUD.suppress = false; }
  }
  function watchStore() {
    if (!cloudOn()) return;
    if (CLOUD.unsubStore) { CLOUD.unsubStore(); CLOUD.unsubStore = null; }
    CLOUD.unsubStore = storeDoc().onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (!d) { pushConfig(); return; }
      if (d.clientId === CLOUD.clientId) { cloudOk(); return; }
      applyRemoteConfig(d);
      cloudOk();
    }, function () { cloudStatus("同期:接続エラー", "err"); });
  }
  function watchQuote() {
    if (!cloudOn()) return;
    var sid = activeStaff().id;
    if (CLOUD.unsubQuote && CLOUD.watchingStaffId === sid) return;
    if (CLOUD.unsubQuote) { CLOUD.unsubQuote(); CLOUD.unsubQuote = null; }
    CLOUD.watchingStaffId = sid;
    CLOUD.unsubQuote = quoteDoc(sid).onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      if (!d) { pushQuote(); return; }
      if (d.clientId === CLOUD.clientId) { cloudOk(); return; }
      if (CLOUD.quoteTimer) return;
      applyRemoteQuote(d);
    }, function () { cloudStatus("同期:接続エラー", "err"); });
  }
  function showLogin(show) {
    var ov = $("loginOverlay");
    if (ov) ov.hidden = !show;
  }
  function onSignedIn(user) {
    CLOUD.user = user;
    showLogin(false);
    $("accountStep").hidden = false;
    $("accountInfo").textContent = "ログイン中: " + (user.email || "");
    cloudStatus("同期中…", "");
    watchStore();
    watchQuote();
  }
  function onSignedOut() {
    CLOUD.user = null;
    if (CLOUD.unsubStore) { CLOUD.unsubStore(); CLOUD.unsubStore = null; }
    if (CLOUD.unsubQuote) { CLOUD.unsubQuote(); CLOUD.unsubQuote = null; }
    CLOUD.watchingStaffId = null;
    $("accountStep").hidden = true;
    cloudStatus("", "");
    showLogin(true);
  }
  function loginErrorMessage(err) {
    var c = String((err && err.code) || "");
    if (/user-not-found|wrong-password|invalid-credential|invalid-email/.test(c)) return "メールアドレスまたはパスワードが正しくありません。";
    if (/too-many-requests/.test(c)) return "試行回数が多すぎます。しばらく時間をおいて再度お試しください。";
    if (/network/.test(c)) return "通信エラーです。ネットワーク環境をご確認ください。";
    return "ログインできませんでした。時間をおいて再度お試しください。";
  }
  function initCloud() {
    var configured = typeof DAKKAN_FIREBASE !== "undefined" && DAKKAN_FIREBASE.projectId
      && typeof firebase !== "undefined" && firebase.apps && firebase.apps.length;
    if (!configured) return; // 未設定 → 端末内保存のみで動作
    try {
      CLOUD.auth = firebase.auth();
      CLOUD.db = firebase.firestore();
    } catch (e) { return; }
    CLOUD.enabled = true;

    $("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("loginErr");
      err.hidden = true;
      $("loginBtn").disabled = true;
      CLOUD.auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPass").value)
        .then(function () { $("loginPass").value = ""; }, function (e2) {
          err.textContent = loginErrorMessage(e2);
          err.hidden = false;
        })
        .then(function () { $("loginBtn").disabled = false; });
    });
    $("logoutBtn").addEventListener("click", function () {
      if (!confirm("ログアウトしますか？")) return;
      CLOUD.auth.signOut();
    });
    CLOUD.auth.onAuthStateChanged(function (user) {
      if (user) onSignedIn(user); else onSignedOut();
    });
  }

  /* ---------- タブ ---------- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    document.querySelectorAll(".tab-page").forEach(function (s) { s.classList.toggle("active", s.id === "tab-" + name); });
    if (name === "sheet") renderSheet();
    if (name === "config") { renderConfigTab(); renderMasterTab(); }
    $("summaryBar").style.display = (name === "dakkan" || name === "ienaka") ? "" : "none";
  }
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.dataset.tab); });
  });
  $("toSheet").addEventListener("click", function () { switchTab("sheet"); });
  $("backToQuote").addEventListener("click", function () { switchTab("dakkan"); });
  $("printBtn").addEventListener("click", function () { window.print(); });
  window.addEventListener("beforeprint", function () { renderSheet(); });

  /* ---------- 設定タブのイベント ---------- */
  $("storeName").addEventListener("input", function () {
    config.storeName = this.value; saveConfig(); renderStaffSelect();
  });
  $("custName").addEventListener("input", function () { store.custName = this.value; save(); });
  $("staffSelect").addEventListener("change", function () { switchStaff(this.value); });
  $("addStaff").addEventListener("click", function () {
    config.staff.push({ id: "s" + Date.now().toString(36), name: "" });
    saveConfig(); renderConfigTab(); renderStaffSelect();
    var inputs = $("staffList").querySelectorAll("input[data-staff]");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  $("staffList").addEventListener("input", function (e) {
    var i = e.target.getAttribute("data-staff");
    if (i == null) return;
    config.staff[+i].name = e.target.value;
    saveConfig(); renderStaffSelect();
  });
  $("staffList").addEventListener("click", function (e) {
    var i = e.target.getAttribute("data-staffdel");
    if (i == null) return;
    var s = config.staff[+i];
    if (!confirm("担当者「" + (s.name || "無名") + "」を削除しますか？\nこの担当者の入力内容も削除されます。")) return;
    try { localStorage.removeItem(quoteKey(s.id)); } catch (err) {}
    config.staff.splice(+i, 1);
    var wasActive = config.activeStaffId === s.id;
    saveConfig();
    if (wasActive) { config.activeStaffId = config.staff[0].id; saveConfig(); loadState(); syncAll(); }
    renderConfigTab(); renderStaffSelect();
  });
  $("dkMasterSave").addEventListener("click", saveMaster);
  $("dkMasterReset").addEventListener("click", resetMaster);
  $("clearQuote").addEventListener("click", function () {
    if (!confirm("入力内容をすべてクリアしますか？")) return;
    var name = store.custName;
    applyStore(defaultStore());
    store.custName = name;
    window.KQ_IENAKA.applyDefaults();
    syncAll();
    save();
  });

  /* ---------- 引き継ぎ（同一オリジンの localStorage 経由・10分で期限切れ） ---------- */
  function takeHandoff() {
    var raw = null;
    try { raw = localStorage.getItem("kq-handoff-v1"); } catch (e) {}
    if (!raw) return;
    try { localStorage.removeItem("kq-handoff-v1"); } catch (e) {}
    var d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || d.from === "dakkan") return;   // 自分が書いたものは読まない
    if (!d.at || Date.now() - d.at > 10 * 60 * 1000) return;

    if (d.storeName) config.storeName = d.storeName;
    if (d.staffName) {
      var hit = config.staff.filter(function (s) { return (s.name || "") === d.staffName; })[0];
      if (!hit) {
        var n = 1;
        while (config.staff.some(function (s) { return s.id === "s" + n; })) n++;
        hit = { id: "s" + n, name: d.staffName };
        config.staff.push(hit);
      }
      config.activeStaffId = hit.id;
      loadState();
    }
    if (d.custName) store.custName = d.custName;
    saveConfig();
    save();
  }
  /* ケータイ見積もりへ戻るとき、店舗名・担当者名・お客様名を渡す。
   * ★ 受け取り側（keitai-app の takeHandoffFromIenaka）は from === "ienaka" しか読まない。
   *   ケータイ側で "dakkan" も読むようにする改修が要る（指示書 7-1）。 */
  var backLink = $("toKeitai");
  if (backLink) {
    backLink.addEventListener("click", function () {
      try {
        localStorage.setItem("kq-handoff-v1", JSON.stringify({
          storeName: config.storeName || "",
          staffName: (activeStaff() || {}).name || "",
          custName: store.custName || "",
          from: "dakkan", at: Date.now()
        }));
      } catch (e) {}
    });
  }

  /* ---------- 起動 ---------- */
  loadState();
  takeHandoff();

  window.KQ_IENAKA.attach(store.ienaka, onIenakaChange);
  window.KQ_DAKKAN.attach(store.dakkan, onDakkanChange, {
    ienakaState: function () { return store.ienaka; }
  });
  /* 回線の種類から、ドコモ側の申込区分・商材を提案する（担当者はイエナカ側で変更できる） */
  window.KQ_DAKKAN.onSuggest = function (s) {
    if (s.product && store.ienaka.product !== s.product) {
      store.ienaka.product = s.product;
      window.KQ_IENAKA.applyDefaults();
    }
    if (!s.product && store.ienaka.product === "home5g") {
      store.ienaka.product = "hikari1g";     // 光の話に戻ったら既定へ
      window.KQ_IENAKA.applyDefaults();
    }
    store.ienaka.applyType = s.applyType;
    window.KQ_IENAKA.syncForm();
    window.KQ_IENAKA.render();
  };
  window.KQ_IENAKA.bind();
  window.KQ_DAKKAN.bind();

  $("appVersion").textContent = APP_VERSION;
  renderStaffSelect();
  renderConfigTab();
  syncAll();
  initCloud();
})();
