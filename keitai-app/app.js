/* =========================================================
 * ミツモリン（料金見積もりシミュレーション） — アプリ本体
 * 3パターン同時見積もり／期間セグメント式の月額計算
 * ========================================================= */
(function () {
  "use strict";

  var APP_VERSION = "1.55.3";
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

  var CFG_KEY = "kq-config-v1";
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
    lsSet(tplKey(), JSON.stringify(templates));
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
    lsSet(savedKey(), JSON.stringify(savedList));
    if (typeof pushSaved === "function") pushSaved();
  }
  /* 保存一覧は端末をまたいで使う（iPadで見積もり→PCで印刷など）ため、
   * クラウドとは全文の置き換えではなく「統合（マージ）」で揃える。
   * ・同じ保存は、更新時刻（upAt/resultAt/savedAt）の新しい方を採用
   * ・削除だけは下の記録で他の端末へ伝える（無いと削除した保存が復活する） */
  var SAVED_DEL_KEY = "kq-saved-del-v1";
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
    if (savedList.length > SAVED_MAX) savedList = savedList.slice(0, SAVED_MAX);
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
        + '<div class="saved-status">'
        + [["", "提案中"], ["won", "成約"], ["lost", "見送り"]].map(function (st2) {
            return '<button type="button" class="saved-st' + ((it.result || "") === st2[0] ? " on" : "")
              + '" data-savedresult="' + st2[0] + '" data-savedrid="' + it.id + '">' + st2[1] + "</button>";
          }).join("")
        + "</div>"
        + '<button class="btn-sub" data-savedload="' + it.id + '" type="button">開く</button>'
        + '<button class="btn-sub saved-del" data-saveddel="' + it.id + '" type="button">削除</button>'
        + (it.result === "won" && it.wonData
            ? '<div class="saved-wonnote">成約した内容を記録済み（保存したときの提案内容と分けて実績に集計されます）</div>'
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
  function recordOutcome(result) {
    var label = result === "won" ? "成約" : "見送り";
    if (!window.confirm("この応対を「" + label + "」として実績に記録します。よろしいですか？")) return;
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
      if (savedList.length > SAVED_MAX) savedList = savedList.slice(0, SAVED_MAX);
    }
    it.result = result;
    it.resultAt = Date.now();
    it.upAt = Date.now();
    if (result === "won") {
      it.wonData = JSON.parse(JSON.stringify(store));
      it.wonPattern = store.active;
    } else {
      delete it.wonData;
      delete it.wonPattern;
    }
    persistSaved();
    renderSaved();
    /* 同じ応対でもう一度押したら「記録し直し」になるように紐づけたままにする。
     * 次のお客様は「入力をクリア」か保存の読み込みで区切られる */
    propSrcId = it.id;
    if (!propSnap) propSnap = JSON.parse(JSON.stringify(it.data));
    var msg = $("recOutcomeMsg");
    if (msg) {
      msg.textContent = "実績に記録しました（" + label + "）";
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
    if (result === "won") {
      /* いま開いている内容＝店頭で最後に調整した内容。これを成約内容として
       * 記録すれば、保存したときの「最初の提案」と比べられる。 */
      var useCurrent = window.confirm(
        "「" + it.name + "」を成約にします。\n\n"
        + "OK：いま画面に開いている見積もりを『成約した内容』として記録します\n"
        + "（保存したときの提案内容と分けて実績に集計されます）\n\n"
        + "キャンセル：保存したときの内容のまま成約にします");
      if (useCurrent) {
        it.wonData = JSON.parse(JSON.stringify(store));
        it.wonPattern = store.active;
      } else {
        delete it.wonData;
        // どのパターンで成約したか。2つ以上使っていたら聞く
        var used = [];
        ((it.data && it.data.patterns) || []).forEach(function (pt, i) {
          var m = Object.assign(defaultState(), pt || {});
          if (isPatternUsed(m) || m.planId || m.procType) used.push(i);
        });
        var idx = (it.data && it.data.active) | 0;
        if (used.length > 1) {
          var ans = window.prompt("どのパターンで成約しましたか？（" + used.map(function (i) { return i + 1; }).join("・") + "）", String(idx + 1));
          if (ans === null) return; // やめた
          var n2 = (parseInt(ans, 10) || 0) - 1;
          if (used.indexOf(n2) >= 0) idx = n2;
        }
        it.wonPattern = idx;
      }
    } else {
      delete it.wonData;
      delete it.wonPattern;
    }
    it.result = result;
    it.resultAt = result ? Date.now() : 0;
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
    if (!c.plans) c.plans = { max: true, poikatsu_max: true };
    if (!c.device) c.device = "kw";           // off=追わない / all=全機種 / kw=キーワード
    if (typeof c.deviceKw !== "string") c.deviceKw = "Pixel";
    if (!c.dcard) c.dcard = "type";           // off / one=まとめて1行 / type=種別ごと
    if (!c.denki) c.denki = "type";           // off / one / type=メニューごと
    if (!c.gas) c.gas = "one";                // off / one
    if (typeof c.hikari === "undefined") c.hikari = true;
    if (!c.optSkip) c.optSkip = { smart_hosho: true, anshin_pack: true };
    if (!c.feeSkip) c.feeSkip = {};
    if (typeof c.accs === "undefined") c.accs = true;
    return c;
  }
  // 「Pixel、iPhone」のように読点・カンマ区切りで複数キーワードを許す
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
  function statsPatternItems(ptRaw) {
    var pt = Object.assign(defaultState(), ptRaw || {});
    var cfg = statsCfg();
    var out = {};
    var todo = pt.procTodo || {};
    Object.keys(STATS_PROC_NAMES).forEach(function (k) {
      if (todo[k] && cfg.procs[k]) out["proc:" + k] = STATS_PROC_NAMES[k];
    });
    if (pt.planId && cfg.plans[pt.planId]) {
      var pl = planById(pt.planId);
      out["plan:" + pt.planId] = "プラン: " + (pl ? pl.name : pt.planId);
    }
    if (pt.deviceName) {
      if (cfg.device === "all") out["device"] = "機種販売";
      else if (cfg.device === "kw" && statsKwTest(cfg.deviceKw, pt.deviceName)) {
        out["device"] = "機種販売（" + cfg.deviceKw + "）";
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
    Object.keys(pt.options || {}).forEach(function (id) {
      if (!pt.options[id] || cfg.optSkip[id]) return;
      if ((pt.optionKubun || {})[id] === "keep") return; // 継続は提案に数えない
      var def = MASTER.options.filter(function (o) { return o.id === id; })[0];
      /* 店舗独自サービス（マスタ設定で「店舗独自」にしたもの）は
       * 「独自: 」として別のまとまりで集計する */
      if (def && def.own) out["own:o:" + id] = "独自: " + def.name;
      else out["opt:" + id] = "オプション: " + (def ? def.name : id);
    });
    Object.keys(pt.feeItems || {}).forEach(function (id) {
      if (!pt.feeItems[id] || cfg.feeSkip[id]) return;
      var def = MASTER.feeItems.filter(function (o) { return o.id === id; })[0];
      if (!def) return;
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
  function statsDataItems(d, onlyPattern) {
    var out = {};
    var pats = (d && d.patterns) || [];
    if (typeof onlyPattern === "number") {
      Object.assign(out, statsPatternItems(pats[onlyPattern]));
    } else {
      pats.forEach(function (pt) {
        var m = Object.assign(defaultState(), pt || {});
        if (!(isPatternUsed(m) || m.planId || m.procType)) return;
        Object.assign(out, statsPatternItems(pt));
      });
    }
    var ie = d && d.ienaka;
    if (ie && ie.enabled && ie.product && statsCfg().hikari) {
      out["ie:" + (STATS_IE_KEYS[ie.product] || ie.product)] = "光・5G: " + (STATS_IE_NAMES[ie.product] || ie.product);
    }
    return out;
  }

  // 1件の保存から項目を拾う。wonOnly は「成約した内容」だけ
  function statsSavedItems(it, wonOnly) {
    if (!wonOnly) return statsDataItems(it.data);
    // 成約時に記録した内容があればそれを、無ければ保存内容の成約パターンを使う
    if (it.wonData) {
      return statsDataItems(it.wonData, (it.wonData.active | 0));
    }
    var wi = typeof it.wonPattern === "number" ? it.wonPattern : (it.data && it.data.active) | 0;
    return statsDataItems(it.data, wi);
  }

  // 全担当の保存リストを集める。クラウド利用時は最新を読みにいく
  var statsLists = null; // {staffId: list}
  var statsLast = null;  // 直近に表示した集計（CSV出力用）
  function loadAllSaved(done) {
    var lists = {};
    var mine = activeStaff().id;
    function local(sid) {
      try { return JSON.parse(localStorage.getItem(savedKey(sid)) || "null") || []; } catch (e) { return []; }
    }
    config.staff.forEach(function (s) { lists[s.id] = s.id === mine ? savedList : local(s.id); });
    if (!cloudOn()) { statsLists = lists; done(); return; }
    var jobs = config.staff.map(function (s) {
      if (s.id === mine) return Promise.resolve(); // 自分の分は手元が最新
      return savedDoc(s.id).get().then(function (snap) {
        var d = snap.exists ? snap.data() : null;
        if (d && d.list) lists[s.id] = JSON.parse(d.list) || [];
      }).catch(function () {});
    });
    Promise.all(jobs).then(function () { statsLists = lists; done(); }, function () { statsLists = lists; done(); });
  }

  function statsMonthOf(ms) {
    var d = new Date(ms || 0);
    return d.getFullYear() + "/" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  function renderStats(refresh) {
    var body = $("statsBody");
    if (!body) return;
    if (refresh || !statsLists) {
      body.innerHTML = '<p class="hint">読み込み中…</p>';
      loadAllSaved(function () { renderStats(false); });
      return;
    }
    var lists = statsLists;
    // 期間の選択肢（保存がある月）
    var monthSel = $("statsMonth"), staffSel = $("statsStaff");
    var months = {};
    Object.keys(lists).forEach(function (sid) {
      lists[sid].forEach(function (it) { months[statsMonthOf(it.savedAt)] = true; });
    });
    var mKeys = Object.keys(months).sort().reverse();
    var curMonth = statsMonthOf(Date.now());
    var mPrev = monthSel.value || (months[curMonth] ? curMonth : "all");
    monthSel.innerHTML = '<option value="all">全期間</option>' + mKeys.map(function (m) {
      return '<option value="' + m + '">' + m + "</option>";
    }).join("");
    monthSel.value = (mPrev === "all" || months[mPrev]) ? mPrev : "all";
    var sPrev = staffSel.value || "all";
    staffSel.innerHTML = '<option value="all">全員</option>' + config.staff.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>";
    }).join("");
    staffSel.value = config.staff.some(function (s) { return s.id === sPrev; }) ? sPrev : "all";
    var mFil = monthSel.value, sFil = staffSel.value;
    function inPeriod(it) { return mFil === "all" || statsMonthOf(it.savedAt) === mFil; }

    // 担当別のまとめ
    var rows = [];
    var totals = { prop: 0, won: 0, lost: 0 };
    config.staff.forEach(function (s) {
      if (sFil !== "all" && s.id !== sFil) return;
      var a = (lists[s.id] || []).filter(inPeriod);
      var won = a.filter(function (it) { return it.result === "won"; }).length;
      var lost = a.filter(function (it) { return it.result === "lost"; }).length;
      totals.prop += a.length; totals.won += won; totals.lost += lost;
      rows.push({ name: s.name, prop: a.length, won: won, lost: lost });
    });
    function rate(w, p2) { return p2 ? Math.round(w * 100 / p2) + "%" : "－"; }

    // ---- 目標（店舗全体・月あたりの成約件数。料金マスタに保存して全端末で共通） ----
    var head = "";
    var goal = num(MASTER.statsGoal || 0);
    head += '<div class="stats-goal"><label>月の成約目標 <input type="number" id="statsGoalInput" min="0" value="'
      + (goal || "") + '" placeholder="未設定"> 件</label>';
    if (goal > 0 && mFil !== "all" && sFil === "all") {
      var pct = Math.min(100, Math.round(totals.won * 100 / goal));
      head += '<div class="goal-bar"><div class="goal-fill" style="width:' + pct + '%"></div></div>'
        + '<span class="goal-note">' + esc(mFil) + " の成約 " + totals.won + " / " + goal
        + " 件（達成率 " + Math.round(totals.won * 100 / goal) + "%）</span>";
    } else if (goal > 0) {
      head += '<span class="goal-note">目標は店舗全体の件数です。期間で月を、担当で「全員」を選ぶと達成率が出ます</span>';
    }
    head += "</div>";

    // ---- 前月との比較（月を選んでいるときだけ） ----
    if (mFil !== "all") {
      var pmY = +mFil.slice(0, 4), pmM = +mFil.slice(5) - 1;
      if (!pmM) { pmY--; pmM = 12; }
      var pm = pmY + "/" + ("0" + pmM).slice(-2);
      var prev = { prop: 0, won: 0, lost: 0 };
      config.staff.forEach(function (s2) {
        if (sFil !== "all" && s2.id !== sFil) return;
        var a2 = (lists[s2.id] || []).filter(function (it) { return statsMonthOf(it.savedAt) === pm; });
        prev.prop += a2.length;
        prev.won += a2.filter(function (it) { return it.result === "won"; }).length;
        prev.lost += a2.filter(function (it) { return it.result === "lost"; }).length;
      });
      function scBox(label, cur, pv, unit) {
        var d2 = cur - pv;
        var cls = d2 > 0 ? "up" : (d2 < 0 ? "down" : "");
        var dTxt = d2 > 0 ? "＋" + d2 : (d2 < 0 ? "−" + (-d2) : "±0");
        return '<div class="sc-box"><span class="sc-label">' + label + "</span>"
          + '<span class="sc-value">' + cur + (unit || "") + "</span>"
          + '<span class="sc-diff ' + cls + '">前月 ' + pv + (unit || "") + "（" + dTxt + "）</span></div>";
      }
      var curRate = totals.prop ? Math.round(totals.won * 100 / totals.prop) : 0;
      var prevRate = prev.prop ? Math.round(prev.won * 100 / prev.prop) : 0;
      head += '<div class="stats-compare">'
        + scBox("提案", totals.prop, prev.prop, "件")
        + scBox("成約", totals.won, prev.won, "件")
        + scBox("見送り", totals.lost, prev.lost, "件")
        + scBox("成約率", curRate, prevRate, "%")
        + "</div>";
    }

    var h = head + '<h3>担当別</h3><table class="stats-table"><tr><th>担当</th><th>提案</th><th>成約</th><th>見送り</th><th>成約率</th></tr>';
    rows.forEach(function (r2) {
      h += "<tr><td>" + esc(r2.name) + "</td><td>" + r2.prop + "</td><td>" + r2.won + "</td><td>" + r2.lost + "</td><td>" + rate(r2.won, r2.prop) + "</td></tr>";
    });
    if (rows.length > 1) {
      h += '<tr class="stats-total"><td>合計</td><td>' + totals.prop + "</td><td>" + totals.won + "</td><td>" + totals.lost + "</td><td>" + rate(totals.won, totals.prop) + "</td></tr>";
    }
    h += "</table>";

    // 項目別のまとめ（提案＝最初に保存した内容、成約＝実際に成約した内容）
    var items = {}; // key -> {name, prop, won}
    Object.keys(lists).forEach(function (sid) {
      if (sFil !== "all" && sid !== sFil) return;
      (lists[sid] || []).filter(inPeriod).forEach(function (it) {
        var prop = statsSavedItems(it, false);
        Object.keys(prop).forEach(function (k) {
          if (!items[k]) items[k] = { name: prop[k], prop: 0, won: 0 };
          items[k].prop++;
        });
        if (it.result === "won") {
          var wonItems = statsSavedItems(it, true);
          Object.keys(wonItems).forEach(function (k) {
            if (!items[k]) items[k] = { name: wonItems[k], prop: 0, won: 0 };
            items[k].won++;
          });
        }
      });
    });
    var order = ["proc:", "plan:", "device", "dcard:", "denki:", "gas", "ie:", "opt:", "fee:", "own:", "acc:"];
    function rank(k) {
      for (var i = 0; i < order.length; i++) if (k.indexOf(order[i]) === 0) return i;
      return order.length;
    }
    var iKeys = Object.keys(items).sort(function (a2, b2) {
      return (rank(a2) - rank(b2)) || (items[b2].prop - items[a2].prop) || (items[a2].name < items[b2].name ? -1 : 1);
    });
    h += '<h3>項目別</h3>';
    if (!iKeys.length) {
      h += '<p class="hint">この期間の保存がありません。</p>';
    } else {
      h += '<table class="stats-table"><tr><th>項目</th><th>提案</th><th>成約</th><th>成約率</th></tr>';
      iKeys.forEach(function (k) {
        var x = items[k];
        h += "<tr><td>" + esc(x.name) + "</td><td>" + x.prop + "</td><td>" + x.won + "</td><td>" + rate(x.won, x.prop) + "</td></tr>";
      });
      h += "</table>";
      h += '<p class="hint">提案＝保存したとき（最初の提案）にその項目が入っていた件数（3パターンのどれかにあれば1件）。'
        + '成約＝成約にした応対で、実際の成約内容にその項目が入っていた件数。'
        + '提案0で成約が付いている項目は、最初の提案には無く、成約までの調整で加わったものです。'
        + 'オプションの「継続」は数えません。どの項目を数えるかは、マスタ設定の<strong>「実績で追う項目」</strong>で選べます'
        + '（設定を変えると、過去の保存分も新しい設定で数え直されます）。</p>';
    }
    body.innerHTML = h;
    // CSV出力用に、いま表示した集計を控えておく
    var sName = "全員";
    if (sFil !== "all") {
      var ss = config.staff.filter(function (s) { return s.id === sFil; })[0];
      sName = (ss && ss.name) || sFil;
    }
    statsLast = { rows: rows, totals: totals, items: items, iKeys: iKeys, month: mFil, staffName: sName };
  }

  /* ---------- 実績のCSV出力（Excelで開ける形式） ---------- */
  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadStatsCsv() {
    var L = statsLast;
    if (!L) return;
    function rateTxt(w, p2) { return p2 ? Math.round(w * 100 / p2) + "%" : ""; }
    var period = L.month === "all" ? "全期間" : L.month;
    var lines = [];
    lines.push(["実績集計", "期間: " + period, "担当: " + L.staffName, "出力: " + savedWhen(Date.now())].map(csvCell).join(","));
    lines.push("");
    lines.push("担当別");
    lines.push("担当,提案,成約,見送り,成約率");
    L.rows.forEach(function (r2) {
      lines.push([r2.name, r2.prop, r2.won, r2.lost, rateTxt(r2.won, r2.prop)].map(csvCell).join(","));
    });
    if (L.rows.length > 1) {
      lines.push(["合計", L.totals.prop, L.totals.won, L.totals.lost, rateTxt(L.totals.won, L.totals.prop)].map(csvCell).join(","));
    }
    lines.push("");
    lines.push("項目別");
    lines.push("項目,提案,成約,成約率");
    L.iKeys.forEach(function (k) {
      var x = L.items[k];
      lines.push([x.name, x.prop, x.won, rateTxt(x.won, x.prop)].map(csvCell).join(","));
    });
    // 先頭のBOMで、Excelが文字コードを正しく認識する（無いと文字化けする）
    var csv = "\uFEFF" + lines.join("\r\n");
    var store2 = (config.storeName || "店舗").replace(/[\\/:*?"<>|\s]/g, "");
    var d = new Date();
    function z(n) { return ("0" + n).slice(-2); }
    var fname = "実績_" + store2 + "_" + (L.month === "all" ? "全期間" : L.month.replace("/", "")) + "_"
      + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + ".csv";
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
  var HIST_KEY = "kq-master-hist-v1";
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
      var zipOn = needsZip();
      $("custZipField").hidden = !zipOn;
      $("custZipHint").hidden = !zipOn;
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
   *   both   … スマホ＋光の世帯合計（2枚）
   *   hikari … スマホの見積書はそのままに、光の明細を3枚目の別紙として付ける（3枚）
   *              光の基本料はスマホの月額に含めない（請求が分かれるため） */
  /* 郵便番号が要る受付か（光・でんき・ガスは住所での登録が要る） */
  function needsZip() {
    return !!(state.todoHikari || state.todoDenki || state.todoGas || ienakaOn());
  }
  var sheetScope = "phone";
  /* 光を申し込むのにスマホ側でセット割を選んでいない、という付け忘れに気づけるようにする。
   * 逆（セット割だけ選んで光を入れていない）は、ご家族の既契約という場合があるので出さない。 */
  function renderIenakaWarn(r) {
    var el = $("ieSetWarn");
    if (!el) return;
    var miss = ienakaOn() && !(r && r.dSet > 0);
    el.hidden = !miss;
    if (miss) {
      el.textContent = "スマホ側で「ドコモ光／home 5G セット割」を選んでいません。"
        + "対象のプランであれば、見積もりタブの③割引でチェックを入れてください。";
    }
  }
  function ienakaOn() {
    return typeof KQ_IENAKA !== "undefined" && KQ_IENAKA.isOn();
  }
  /* 見積書に足す光の要約。A4 2枚に収めるため、明細ではなく数行にとどめる。
   * 光の明細が要るときは、イエナカ見積もり（単体）で別紙にする。 */
  /* 見積書に足す光の行。標準の月額だけを載せて、世帯の合計が分かるようにする。
   * 工事費・初期費用・お支払いの推移といった中身は「光のみ（別紙）」で出す。 */
  function ienakaSheetHtml(phoneMonthly, setWari) {
    var r = KQ_IENAKA.calc();
    var last = r.segs[r.segs.length - 1];
    var h = '<table class="sheet-hikari"><tbody>';
    h += '<tr class="head"><td colspan="2">ドコモ光・home 5G</td></tr>';
    h += "<tr><td>" + esc(KQ_IENAKA.label()) + '</td><td class="amt">'
      + yen(last.monthly) + "</td></tr>";
    h += '<tr class="total"><td>世帯の月額合計（スマホ＋光）</td><td class="amt">'
      + yen(phoneMonthly + last.monthly) + "</td></tr>";
    h += "</tbody></table>";
    h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">'
      + "※ 光の月額は標準のお支払い額です。初期費用・工事費・お支払いの推移は<b>別紙のお見積書</b>でご案内します。"
      + (setWari > 0
        ? "ドコモ光／home 5G セット割（" + yen(setWari) + "/月）は、上のスマホの月額から既に差し引いています。"
        : "スマホ側で「ドコモ光／home 5G セット割」を選んでいません。対象の場合は③割引でご確認ください。")
      + "</p>";
    return h;
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
  var WIZ_SKIP_KEY = "kq-setup-skipped";
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
        // お客様名（個人情報）はクラウドへ送らない
        var list = JSON.parse(JSON.stringify(d.saved[id]));
        list.forEach(function (it) {
          it.custName = "";
          ((it.data || {}).patterns || []).forEach(function (pt) { pt.custName = ""; });
          ((it.wonData || {}).patterns || []).forEach(function (pt) { pt.custName = ""; });
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
  function masterUpdateAvailable() {
    return num(DEFAULT_DATA.masterVersion) > num(MASTER.masterVersion);
  }
  // 上書きしない項目（店舗が決めるもの）
  var FEE_KEEP = { atamakin_default: true };
  // 標準から引き継ぐ項目（金額と、計算に効く条件だけ。名前・置き場所は店舗のまま）
  var PLAN_TAKE = ["tiers", "discounts", "includes5min", "dcard10",
    "bakuageTier", "poikatsuPt", "maxBonus", "voiceOverrides", "group"];
  var OPT_TAKE = ["price", "priceChoices", "priceLabels", "carrier",
    "bakuage", "bakuage2", "bakuageFixed", "note"];
  var FEE_ITEM_TAKE = ["price", "pay", "note", "dataMove"];
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
    // dヒッツ: 330円コースは扱わないため、保存済みマスタからも選択肢を外す
    MASTER.options.forEach(function (o) {
      if (o.id === "dhits" && o.priceChoices) { delete o.priceChoices; delete o.priceLabels; }
    });
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
      minna: "0", dSet: false, dCard: "none", dDenki: false, choki: "none",
      voice: "none", voiceChange: false, planChange: false, netSvc: {}, netSvcOff: {},
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
      adhocMonthly: [],   // {name, amount, months} amountは±、months 0=ずっと
      accessories: [],    // {name, price, pay: "once"|"b12"|"b24"|"b36"}
      accSel: {},         // マスタ登録アクセサリの選択 {id: pay}
      deviceName: "", devicePrice: 0, couponOff: 0, tebikiOff: 0, directOff: 0,
      payMethod: "none", kaedoki23: 0, kaedokiFee: 0,
      atamakin: 0, jimuFee: 0,
      adhocInitial: [],   // {name, amount} ±
      custName: "", shopName: "", staffName: "", shopTel: "", quoteMemo: "",
      // 手続き内容（引き継ぎシートに記載）
      procTodo: {}, todoDcard: false, todoDenki: false, todoGas: false, todoHikari: false,
      todoGasEco: "",     // ガスの区分（std=スタンダード / eco=エコジョーズ）
      todoDenkiNow: "", todoGasNow: "",   // 現在ご契約中の会社（解約のご案内用）
      todoDcardType: "", todoDenkiType: "", todoGasType: "", todoGasDiscount: {},
      todoOther: "",      // 引き継ぎシートの自由記入
      /* 郵便番号。光・でんき・ガスは住所での登録が要るため、
       * 引き継ぎシートに載せて登録スタッフへ渡す。
       * 受付の端末とレジの端末で見る必要があるので、こちらは同期する
       * （番号だけでは個人を特定できないため。お客様名は引き続き同期しない）。 */
      custZip: "",
      // 店頭お支払い（頭金・付属品など）の支払方法
      storePay: {}, usePoint: false, usePointAmount: 0,
      // データ移行の項目だけ、支払い先をこの見積もりで変えられる（未指定はマスタの設定）
      feeItemPay: {},
    };
  }
  /* 光・home 5G（イエナカ）は世帯に1本なので、パターンA/B/Cの外に置く。
   * store ごと保存・同期されるため、保存した見積もりやテンプレートにも自然に付いてくる。 */
  function newIenaka() {
    return (typeof KQ_IENAKA !== "undefined" && KQ_IENAKA) ? KQ_IENAKA.defaultState() : {};
  }
  var store = { active: 0, patterns: [defaultState(), defaultState(), defaultState()], ienaka: newIenaka() };
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
  function saveState() {
    /* 管理者としてマスタ設定だけを開いているとき（masterOnly）は書かない。
     * この状態は内部的に担当1として動いているため、ここで書くと
     * 担当1の作りかけの見積もりを黙って上書きし、クラウドへも送ってしまう。 */
    if (typeof masterOnly !== "undefined" && masterOnly) return;
    lsSet(quoteKey(), JSON.stringify(store));
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
    quoteSynced: false, // クラウドの見積もりを一度受け取るまで、この端末からは送らない
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
      quoteDoc(sid).set(stamp({ data: quotePayload() })).then(cloudOk, cloudNg);
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
        lsSet(tplKey(sid), JSON.stringify(templates));
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
        ((it.wonData || {}).patterns || []).forEach(function (pt) { pt.custName = ""; });
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
          var owp = (old.wonData && old.wonData.patterns) || [];
          ((x.wonData && x.wonData.patterns) || []).forEach(function (pt, i) {
            if (!pt.custName && owp[i] && owp[i].custName) pt.custName = owp[i].custName;
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
        merged.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        if (merged.length > SAVED_MAX) merged = merged.slice(0, SAVED_MAX);
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
        config.staff = d.staff;
        if (prevId && !config.staff.some(function (s) { return s.id === prevId; })) {
          config.activeStaffId = "";
          lostStaff = true;
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
      // お客様名は同期しないため、この端末で入力済みの名前を保持する
      for (var i = 0; i < 3; i++) {
        var mine = (store.patterns[i] || {}).custName;
        var pt = incoming.patterns[i] || {};
        if (!pt.custName && mine) pt.custName = mine;
        store.patterns[i] = Object.assign(defaultState(), pt);
        migratePattern(store.patterns[i]);
      }
      store.active = Math.min(Math.max(incoming.active | 0, 0), 2);
      state = store.patterns[store.active];
      applyIenaka(incoming.ienaka);
      lsSet(quoteKey(), JSON.stringify(store));
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
    CLOUD.quoteSynced = false; // 初回スナップショットを受け取るまで、この端末からの送信を止める
    CLOUD.unsubQuote = quoteDoc(sid).onSnapshot(function (snap) {
      var first = !CLOUD.quoteSynced;
      CLOUD.quoteSynced = true;
      var d = snap.exists ? snap.data() : null;
      if (!d) { markLocalEdit(); return; } // クラウドに見積もりが無ければ、この端末の内容を初期値にする
      if (d.clientId === CLOUD.clientId) { cloudOk(); return; }
      // 初回は必ずクラウドの内容を取り込む（ログイン直後はクラウドが正）
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
  var LAST_STORE_ID_KEY = "kq-last-store-id";
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
    // 初めての端末では、ミツモリンの使い方案内を出す（画面が落ち着いてから）
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
  var STORE_UID_KEY = "kq-store-uid";
  function wipeStoreLocal() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k === MASTER_KEY || k === CFG_KEY || k === HIST_KEY
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
    } finally { CLOUD.suppress = false; }
  }

  function onSignedIn(user) {
    CLOUD.user = user;
    rememberStoreId(String(user.email || "").replace(/@.*$/, ""));
    switchStoreIfNeeded(user.uid); // 前の店舗の内容を持ち込まない
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
  // ログアウト（自動・手動の共通処理）
  function doLogout(auto) {
    histSettle();
    masterOnly = false;
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
    if (lo) lo.hidden = !(lockEnabled() || cloudOn());
    armIdle(lockEnabled() || cloudOn());
    if (takeHandoffFromIenaka()) { bootDone(); return; }
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
    /* 端末代金総額（頭金を含む）から値引きを引く。
     * クーポン値引きと店舗独自キャンペーンは、店頭でのお支払いが軽くなるよう
     * 「頭金 → 分割する分 → 残価」の順に引く。
     * ダイレクト割は頭金からは引かず、分割する分（あふれたら残価）から引く。 */
    var deviceList = num(st.devicePrice);
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
      if (st.feeItems[f.id]) initialRows.push({ name: f.name, amount: f.price, where: feeItemPayOf(st, f) });
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
    delete snap.custName; delete snap.shopName; delete snap.staffName; delete snap.shopTel;
    return snap;
  }
  function tplApply(i) {
    var t = templates[i];
    if (!t) { tplMsg("テンプレ" + (i + 1) + "は未設定です。「現在の内容をテンプレに保存」から登録してください"); return; }
    var keep = { custName: state.custName, shopName: state.shopName, staffName: state.staffName, shopTel: state.shopTel };
    store.patterns[store.active] = Object.assign(defaultState(), JSON.parse(JSON.stringify(t.state)), keep);
    migratePattern(store.patterns[store.active]);
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
  /* 選んだときに公式ページへの参照リンクを出すオプション。
   * 金額が機種などで変わるものは、その場で正確な額を調べられるようにする。 */
  var OPT_INFO_LINKS = {
    smart_hosho: "https://www.docomo.ne.jp/service/smart_anshin_hoshou/charge.html",
    anshin_pack: "https://www.docomo.ne.jp/service/smart_anshinpack/"
  };
  function renderOptionList() {
    // カテゴリ（フォルダ）ごとに横5列のタイルで表示
    var h = "";
    OPT_CATEGORIES.forEach(function (cat) {
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
        var kubunHtml = (on || isOff)
          ? '<span class="t-kubun">'
            + [["new", "新規"], ["keep", "継続"], ["off", "廃止"]].map(function (k) {
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
    { wrap: "chokiWrap", name: "長期利用割", on: function (d) { return !!d.choki10; } }
  ];
  function renderDiscountHint() {
    var plan = currentPlan();
    var shown = hasPlan();
    var offs = [];
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
    $("custName").value = state.custName;
    $("shopName").value = state.shopName;
    $("staffName").value = state.staffName;
    $("shopTel").value = state.shopTel || "";
    $("quoteMemo").value = state.quoteMemo;
    ["todoDcard", "todoDenki", "todoGas", "todoHikari"].forEach(function (k) { $(k).checked = !!state[k]; });
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
    var zipOn = needsZip();
    $("custZipField").hidden = !zipOn;
    $("custZipHint").hidden = !zipOn;
    if (document.activeElement !== $("custZip")) $("custZip").value = state.custZip || "";
    $("dcardTypeWrap").hidden = !state.todoDcard;
    $("denkiTypeWrap").hidden = !state.todoDenki;
    $("gasTypeWrap").hidden = !state.todoGas;
    document.querySelectorAll("[data-dcardtype]").forEach(function (cb) { cb.checked = state.todoDcardType === cb.getAttribute("data-dcardtype"); });
    document.querySelectorAll("[data-denkitype]").forEach(function (cb) { cb.checked = state.todoDenkiType === cb.getAttribute("data-denkitype"); });
    document.querySelectorAll("[data-gastype]").forEach(function (cb) { cb.checked = state.todoGasType === cb.getAttribute("data-gastype"); });
    renderGasEco();
    renderGasDiscounts();
    renderEnergyNow();
    document.querySelectorAll("[data-proc]").forEach(function (cb) {
      cb.checked = !!(state.procTodo || {})[cb.getAttribute("data-proc")];
    });
    $("ptPoikatsu").value = state.pointPoikatsu || "";
    $("ptPoikatsuFamily").value = state.pointPoikatsuFamily || "";
    $("ptBakuage").value = state.pointBakuage || "";
    $("pointApply").value = state.pointApply === true ? "1" : "0";
    $("ptDcard").value = state.pointDcard || "";
    $("kaedoki23Field").hidden = state.payMethod !== "kaedoki";
    $("kaedokiFeeField").hidden = state.payMethod !== "kaedoki";
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
    /* 光・でんき・ガスは住所での登録が要るため、それぞれの欄に郵便番号を出す。
     * 登録する画面を開いたまま見られるよう、探しに戻らなくていい場所に置く。 */
    function zipRow() {
      return row("郵便番号", state.custZip
        ? '<b style="color:var(--red)">' + esc(state.custZip) + "</b>"
        : '<b style="color:var(--red)">未記入</b>　※ ご登録に必要です');
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
    if (num(state.devicePrice) > 0 || state.deviceName || r.device.offTotal > 0
        || r.accMonthlyRows.length || r.accOnceRows.length) {
      h += "<h3>端末・アクセサリ</h3><table><tbody>";
      if (state.deviceName || num(state.devicePrice) > 0 || r.device.offTotal > 0) {
        h += row("機種", "<b>" + esc(state.deviceName || "（機種名未入力）") + "</b>　" + yen(r.device.list));
        if (r.device.offCoupon > 0) h += row("　クーポン値引き", "−" + yen(r.device.offCoupon));
        // 引き継ぎシートは店内の呼び方に合わせる（お客様向けは「店舗独自キャンペーン」）
        if (r.device.offTebiki > 0) h += row("　手値引き", "−" + yen(r.device.offTebiki));
        if (r.device.offDirect > 0) {
          h += row("　ダイレクト割", "−" + yen(r.device.offDirect) + "　<b>分割金から差引</b>");
        }
        if (r.device.offTotal > 0) h += row("　<b>値引き後の端末代金</b>", "<b>" + yen(r.device.total) + "</b>"
          + (r.device.atamaOff > 0
            ? "　店頭頭金 " + yen(r.device.atamaList) + " → " + yen(r.device.atamaBeforePoint) : ""));
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
    // ポイント充当・メモ
    h += "<h3>ポイント・その他</h3><table><tbody>";
    if (r.pointRows.length) {
      r.pointRows.forEach(function (pt) {
        h += row((r.pointApply ? "ポイント充当（" + esc(pt.name) + "）" : "もらえるポイント（" + esc(pt.name) + "）"),
          pt.amount.toLocaleString("ja-JP") + "pt/月");
      });
      h += row("ポイントの扱い", r.pointApply ? "月額から充当してご案内" : "<b>充当せず</b>、もらえるポイントとしてご案内");
      if (r.pointApply && r.pointOver > 0) {
        h += row("充当しきれない分", '<b style="color:var(--red)">'
          + r.pointOver.toLocaleString("ja-JP") + "pt/月</b>　月額が0円になるため反映していません");
      }
    } else {
      h += row("ポイント", "なし");
    }
    h += row("毎月のお支払い目安", "<b>" + yen(r.segs[0].monthly) + "</b>"
      + (r.segs.length > 1 ? "（" + segLabel(r.segs[r.segs.length - 1]) + " " + yen(r.segs[r.segs.length - 1].monthly) + "）" : ""));
    if (!r.pointApply && r.pointTotal > 0) {
      h += row("ポイントを使った場合の実質", "<b>" + yen(Math.max(0, r.segs[0].monthly - r.pointTotal)) + "</b>/月");
    }
    if (state.quoteMemo) h += row("受付メモ", esc(state.quoteMemo));
    h += "</tbody></table>";

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
      h += zipRow();
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
      if (KQ_IENAKA.curLine && KQ_IENAKA.curLine()) {
        h += row("現在の回線（ヒアリング）", esc(KQ_IENAKA.curLine()));
      }
      h += row("月額", "<b>" + yen(ir.segs[0].monthly) + "</b>"
        + (ir.segs.length > 1
          ? "（" + KQ_IENAKA.segLabel(ir.segs[0]) + "）　"
            + KQ_IENAKA.segLabel(ir.segs[ir.segs.length - 1]) + " "
            + yen(ir.segs[ir.segs.length - 1].monthly)
          : ""));
      var ieOpts = ir.rows.slice(1).filter(function (x) { return x.amount >= 0; });
      h += row("オプション", ieOpts.length
        ? ieOpts.map(function (x) { return esc(x.name) + "（" + yen(x.amount) + "）"; }).join("　／　")
        : "なし");
      if (ir.initRows.length) {
        h += row("初期費用", "<b>" + yen(ir.initial) + "</b>　"
          + ir.initRows.map(function (x) { return esc(x.name) + " " + yen(x.amount); }).join("　／　"));
      }
      if (ir.kojiTotal > 0) {
        h += row("工事費のお支払い", store.ienaka.kojiPay === "b24"
          ? "<b>24回分割</b>（総額 " + yen(ir.kojiTotal) + "・月 " + yen(Math.floor(ir.kojiTotal / 24)) + "）"
          : "<b>一括</b>（" + yen(ir.kojiTotal) + "）");
      }
      if (KQ_IENAKA.isHikari() && store.ienaka.provider) {
        h += row("プロバイダ", esc(store.ienaka.provider)
          + "（" + (store.ienaka.providerType === "keizoku" ? "継続" : "新規") + "）");
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
      h += zipRow();
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
    if (r.pointApply) {
      r.pointRows.forEach(function (p) {
        h += row("ポイント充当（" + esc(p.name) + "）※", "−" + yen(p.amount), true);
      });
    }
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
    /* 充当しない場合は、月額はそのままにして、
     * もらえるポイントと、それを使った場合の実質額を続けて出す。 */
    if (!r.pointApply && r.pointTotal > 0) {
      h += row("毎月もらえるdポイント（" + r.pointRows.map(function (p) { return esc(p.name); }).join("・") + "）※",
        r.pointTotal.toLocaleString("ja-JP") + "pt/月", true);
      h += '<tr class="total"><td>ポイントを使った場合の実質※</td><td class="amt">'
        + yen(Math.max(0, seg0.monthly - r.pointTotal)) + "</td></tr>";
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
    /* 「スマホ＋光」のときだけ、ここに世帯の合計を出す。
     * 別紙のときは光の基本料をスマホの見積もりに含めない。
     * スマホの月額はドコモの請求と一致させ、光は別の請求として別紙で案内するため。 */
    if (sheetScope === "both" && ienakaOn()) {
      h += ienakaSheetHtml(seg0.monthly, r.dSet || 0);
    }
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
    var h = '<div class="master-plan"><h3>実績で追う項目</h3>';
    h += '<p class="hint">実績タブの「項目別」で<strong>どの項目を数えるか</strong>を選べます。'
      + '店舗として力を入れている商材だけに絞ると、表が見やすくなります。<br>'
      + '設定は保存済みの見積もりには手を加えず、<strong>集計するときに数え直す</strong>ため、'
      + 'あとから変えても過去の分に新しい設定が効きます。店舗内の全端末で共通です。</p>';

    h += '<div class="plan-sec"><span class="plan-lbl">手続き</span><div class="sub-checks">';
    [["shinki", "新規契約"], ["mnp", "のりかえ（MNP）"], ["kishu", "機種変更"], ["plan", "プラン変更"]].forEach(function (p) {
      h += '<label class="check"><input type="checkbox" data-sc-proc="' + p[0] + '"'
        + (sc.procs[p[0]] ? " checked" : "") + "> " + p[1] + "</label>";
    });
    h += "</div></div>";

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

    h += '<div class="plan-sec"><span class="plan-lbl">オプション（チェックを外すと数えません）</span><div class="sub-checks">';
    MASTER.options.forEach(function (o) {
      h += '<label class="check"><input type="checkbox" data-sc-opt="' + esc(o.id) + '"'
        + (sc.optSkip[o.id] ? "" : " checked") + "> " + esc(o.name)
        + (o.own ? "（独自）" : "") + "</label>";
    });
    h += "</div></div>";

    // もともと数えない商材（手数料・再発行・請求書払い）は一覧に出さない
    var countableFees = (MASTER.feeItems || []).filter(function (o) {
      if (o.pay === "bill") return false;
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
    return h;
  }

  function renderMasterTab() {
    $("masterUpdated").textContent = MASTER.updated + "｜アプリ版 " + APP_VERSION;
    var su = $("storageUsage");
    if (su) su.textContent = "この端末の保存領域の使用量: " + storageUsageText()
      + "（このサイトの全アプリ合計。目安の上限は5MB前後。上限に近いと保存に失敗することがあります）";
    var h = masterUpdateHtml();

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
    var BAKU_TIERS = [
      ["", "対象外"],
      ["max", "ドコモ MAX／ポイ活 MAX の率"],
      ["std", "ポイ活20・ahamo・eximo・ギガホ の率"]
    ];
    h += '<div class="master-plan"><h3>料金プラン</h3>';
    h += '<p class="hint">新しいプランが出たときは、ここから登録できます。'
      + '<strong>似ているプランの「複製」から作ると早いです</strong>（割引や詳細設定がそのまま写ります）。'
      + '見積もり画面のプルダウンには、ここで「現行」にしたものだけが出ます。</p>';
    MASTER.plans.forEach(function (pl, pi) {
      var last = pi === MASTER.plans.length - 1;
      h += '<div class="plan-edit">';
      h += '<div class="plan-head">'
        + '<button class="mv" data-pl-up="' + pi + '" type="button" aria-label="上へ"' + (pi === 0 ? " disabled" : "") + ">▲</button>"
        + '<button class="mv" data-pl-down="' + pi + '" type="button" aria-label="下へ"' + (last ? " disabled" : "") + ">▼</button>"
        + '<input type="text" class="plan-name" value="' + esc(pl.name) + '" placeholder="プラン名" data-pl-name="' + pi + '">'
        + '<select data-pl-group="' + pi + '">'
        + '<option value="current"' + (pl.group === "current" ? " selected" : "") + ">現行</option>"
        + '<option value="legacy"' + (pl.group === "legacy" ? " selected" : "") + ">旧プラン</option>"
        + "</select>"
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
      h += "</div><p class=\"hint\">チェックを外した割引は、このプランを選んだときに③の欄へ出しません。</p></div>";

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
        + '<input type="text" value="' + esc(pl.note || "") + '" placeholder="社内用。お客様には出ません" data-pl-note="' + pi + '"></label>';
      h += "</div></details>";
      h += "</div>";
    });
    h += '<div class="actions"><button class="btn-sub" data-pl-add="1" type="button">＋ プランを追加</button></div>';
    h += "</div>";

    h += '<div class="master-plan"><h3>通話オプション</h3><div class="master-grid">';
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
        + OPT_CATEGORIES.map(function (c) {
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
    h += listEditor(MASTER.options, "op", optExtra, isCarrier, optChoicesHtml) + "</div>";
    h += '<div class="master-sub own"><h4>店舗独自サービス</h4>';
    h += listEditor(MASTER.options, "op", optExtra, isOwn, optChoicesHtml) + "</div>";
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
    h += '<p class="hint">「⑥アクセサリ」にタイルとして表示されます。単価は店舗の取扱商品に合わせて編集を。<br>'
      + '<strong>置き場所</strong>でカテゴリを選ぶと、「⑥アクセサリ」ではなく<strong>オプションのそのカテゴリ</strong>に並びます。'
      + '一括・分割の選び方は変わりません。<strong>初期の支払い</strong>は、タイルを押したときに最初に入る払い方です。</p>';
    h += listEditor(MASTER.accessories, "ac", function (a) {
      return '<select data-ac-cat="' + a.__i + '">'
        + '<option value="">置き場所: ⑥アクセサリ</option>'
        + OPT_CATEGORIES.map(function (c) {
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
    h += '<div class="master-plan"><h3>でんき・ガスの現在の会社</h3>';
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
    h += '<div class="master-plan"><h3>料金マスタの履歴</h3>';
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
    return !masterUnlocked && (adminLockEnabled() || lockEnabled() || cloudOn());
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
      switchTab("quote");
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
  var SEEN_VER_KEY = "kq-seen-version";
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
        ["アプリ名", "ミツモリン（料金見積もりシミュレーション）"],
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
  var HANDOFF_KEY = "kq-handoff-v1";
  function initIenakaLink() {
    var a = $("toIenaka");
    if (!a) return;
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

  /* ---------- チュートリアル（ミツモリン） ----------
   * マスコット「ミツモリン」が最初のひと巡りを案内する。
   * 「見積書を開いた時点が提案として控えられる」というかんたん記録の要は、
   * 説明が無いと気づけないため、端末ごとに初回だけ自動で出す。
   * キャラクター画像は mascotSvg() の1か所にまとめてあり、
   * 正式なイラスト（PNG等）ができたらここを差し替えるだけでよい。 */
  var TOUR_KEY = "kq-tour-done-v1";
  var TOUR_STEPS = [
    { pose: "hello", t: "はじめまして、ミツモリンです！ 使い方をぱぱっとご案内しますね。見積もり画面は、①から⑨を上から入れていくだけ。月々のお支払いがその場で出ます。A・B・Cの3パターンを並べて比べられますよ。" },
    { pose: "sheet", t: "できあがったら「見積書」タブへ。印刷やPDF保存ができて、文字サイズも大・中・小から選べます。じつは、見積書を開いた時点の内容が「ご提案」として自動で控えられるんです。操作はいりません！" },
    { pose: "hello", t: "応対が終わったら、画面下の「成約」か「見送り」をポンと1回。それだけで実績に入ります。次のお客様の前には「入力をクリア」をお忘れなく！" },
    { pose: "sheet", t: "「実績」タブでは、担当別・項目別に提案と成約が見られて、CSVで保存もできます。どの項目を数えるかは、マスタ設定の「実績で追う項目」で選べますよ。" },
    { pose: "hello", t: "わからなくなったら、ヘッダーの「情報」からこの案内をもう一度見られます。それでは、よい接客を！ ミツモリンでした〜！" }
  ];
  function mascotSvg(pose) {
    var rightArm = pose === "sheet"
      ? "" // 見積書を持つポーズは、手を紙の両脇に描く
      : '<path d="M83 92 Q98 84 102 68" stroke="#3f86c9" stroke-width="9" stroke-linecap="round" fill="none"/>'
        + '<circle cx="103" cy="64" r="6.5" fill="#ffeede"/>';
    var sheet = pose === "sheet"
      ? '<g><rect x="42" y="96" width="36" height="26" rx="2.5" fill="#fff" stroke="#d94848" stroke-width="1.6"/>'
        + '<rect x="46" y="101" width="20" height="3" rx="1.5" fill="#d94848"/>'
        + '<rect x="46" y="107" width="28" height="2.4" rx="1.2" fill="#c9d3dd"/>'
        + '<rect x="46" y="112" width="28" height="2.4" rx="1.2" fill="#c9d3dd"/>'
        + '<circle cx="41" cy="110" r="6" fill="#ffeede"/>'
        + '<circle cx="79" cy="110" r="6" fill="#ffeede"/></g>'
      : '<path d="M39 92 Q30 102 33 112" stroke="#3f86c9" stroke-width="9" stroke-linecap="round" fill="none"/>'
        + '<circle cx="33" cy="115" r="6" fill="#ffeede"/>';
    return '<svg viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ミツモリン">'
      + '<ellipse cx="24" cy="78" rx="14" ry="22" fill="#cfeafd" opacity=".85" transform="rotate(-18 24 78)"/>'
      + '<ellipse cx="96" cy="78" rx="14" ry="22" fill="#cfeafd" opacity=".85" transform="rotate(18 96 78)"/>'
      + '<path d="M60 22 q1-9 9-12 q-4 7-2 12z" fill="#8ed2f4"/>'
      + '<circle cx="60" cy="54" r="33" fill="#8ed2f4"/>'
      + '<circle cx="60" cy="60" r="26" fill="#ffeede"/>'
      + '<path d="M33 56 q3-31 27-31 q24 0 27 31 q-7-12-15-12 q-5 7-12 7 q-7 0-12-7 q-8 0-15 12z" fill="#a9def7"/>'
      + '<path d="M40 34 l2.6 5.4 5.9.6 -4.4 4 1.3 5.8 -5.4-3 -5.4 3 1.3-5.8 -4.4-4 5.9-.6z" fill="#ffd94d" transform="scale(.72) translate(16 8)"/>'
      + '<circle cx="50" cy="62" r="3.4" fill="#4a3f36"/><circle cx="70" cy="62" r="3.4" fill="#4a3f36"/>'
      + '<circle cx="51.2" cy="60.8" r="1.1" fill="#fff"/><circle cx="71.2" cy="60.8" r="1.1" fill="#fff"/>'
      + '<ellipse cx="44" cy="70" rx="4" ry="2.2" fill="#ffc9c0"/><ellipse cx="76" cy="70" rx="4" ry="2.2" fill="#ffc9c0"/>'
      + '<path d="M56 71 q4 4 8 0" stroke="#c96a5a" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M46 88 h28 l5 34 q-19 8 -38 0z" fill="#3f86c9"/>'
      + '<path d="M54 88 h12 l-6 9z" fill="#fff"/>'
      + '<rect x="50" y="99" width="9" height="6" rx="1" fill="#fff" stroke="#c9d3dd"/>'
      + rightArm + sheet
      + '<ellipse cx="52" cy="128" rx="6" ry="3.4" fill="#2f5f92"/>'
      + '<ellipse cx="68" cy="128" rx="6" ry="3.4" fill="#2f5f92"/>'
      + "</svg>";
  }
  /* 正式なキャラクター画像（PNG）。keitai-app/img/ に下の名前で置くと、
   * 加工せずそのまま表示する。無い間は mascotSvg() の仮キャラで表示する。 */
  var MASCOT_IMG = { hello: "img/mitsumorin-hello.png", sheet: "img/mitsumorin-sheet.png" };
  var mascotImgOk = {}; // pose -> true(読めた) / false(無かった)
  var tourStep = 0;
  function renderMascot(pose) {
    var box = $("tourMascot");
    if (mascotImgOk[pose] === false || !MASCOT_IMG[pose]) {
      box.innerHTML = mascotSvg(pose);
      return;
    }
    var img = new Image();
    img.alt = "ミツモリン";
    img.onload = function () { mascotImgOk[pose] = true; };
    img.onerror = function () {
      mascotImgOk[pose] = false;
      box.innerHTML = mascotSvg(pose);
    };
    img.src = MASCOT_IMG[pose];
    box.innerHTML = "";
    box.appendChild(img);
  }
  function renderTourStep() {
    var st = TOUR_STEPS[tourStep];
    renderMascot(st.pose);
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
    var busy = ["loginOverlay", "setupOverlay", "staffOverlay", "masterGate", "tourOverlay"].some(function (id) {
      var el = $(id);
      return el && !el.hidden;
    });
    if (busy || masterOnly) return;
    showTour();
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
  var SHEET_FS_KEY = "kq-sheet-fs";
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
  }
  function initMasterSearch() {
    var inp = $("masterSearch");
    if (inp) inp.addEventListener("input", applyMasterSearch);
  }

  /* ---------- マスタ構成の取り込み ----------
   * 「現在のマスタ構成をコピー」した文字列を貼り付けて、この端末（店舗）の
   * 料金マスタを置き換える。取り込む前の内容は履歴に残す。 */
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
    if (name === "stats") renderStats(true);
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

    if (g("add") != null) { MASTER.plans.push(newPlan()); planRestructure(); return true; }

    if ((v = g("copy")) != null) {
      var src = MASTER.plans[+v];
      var cp = JSON.parse(JSON.stringify(src));
      cp.id = "pl_" + Date.now();
      cp.name = (src.name || "プラン") + "（コピー）";
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
      var j = up != null ? i - 1 : i + 1;
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
      return false;
    }
    if (t.hasAttribute("data-sc-proc")) {
      statsCfg().procs[t.getAttribute("data-sc-proc")] = t.checked;
      markEdited(); return true;
    }
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
    $("voice").addEventListener("change", function () { state.voice = this.value; recalc(); });
    $("mailOpt").addEventListener("change", function () {
      var mo = mailOptDef();
      if (mo) { state.options[mo.id] = this.value === "yes"; }
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
    $("deviceName").addEventListener("input", function () { state.deviceName = this.value; saveState(); });
    $("devicePrice").addEventListener("input", function () { state.devicePrice = num(this.value); recalc(); });
    $("couponOff").addEventListener("input", function () { state.couponOff = num(this.value); recalc(); });
    $("tebikiOff").addEventListener("input", function () { state.tebikiOff = num(this.value); recalc(); });
    $("directOff").addEventListener("input", function () { state.directOff = num(this.value); recalc(); });
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
    ["custName", "shopName", "staffName", "shopTel", "quoteMemo"].forEach(function (id) {
      $(id).addEventListener("input", function () { state[id] = this.value; saveState(); });
    });
    $("todoOther").addEventListener("input", function () {
      state.todoOther = this.value; saveState(); renderStaffSheet();
    });
    $("custZip").addEventListener("input", function () {
      state.custZip = this.value; saveState(); renderStaffSheet();
    });
    ["todoDcard", "todoDenki", "todoGas", "todoHikari"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state[id] = this.checked;
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
      $("statsReload").addEventListener("click", function () { renderStats(true); });
      $("statsCsv").addEventListener("click", downloadStatsCsv);
      $("statsPrint").addEventListener("click", function () {
        document.body.classList.add("print-stats");
        window.print();
        setTimeout(function () { document.body.classList.remove("print-stats"); }, 800);
      });
      window.addEventListener("afterprint", function () { document.body.classList.remove("print-stats"); });
      // 目標の入力（料金マスタに保存され、全端末で揃う）
      $("statsBody").addEventListener("change", function (e) {
        if (e.target.id !== "statsGoalInput") return;
        MASTER.statsGoal = Math.max(0, Math.round(num(e.target.value)));
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
        recalc();
      });
    });

    $("clearQuote").addEventListener("click", function () {
      resetPropTracking(); // 次のお客様の応対として仕切り直す
      var keep = { shopName: state.shopName, staffName: state.staffName, shopTel: state.shopTel };
      store.patterns[store.active] = defaultState();
      state = store.patterns[store.active];
      state.shopName = keep.shopName;
      state.staffName = keep.staffName;
      state.shopTel = keep.shopTel;
      state.jimuFee = autoFeeProc(state.procType) ? jimuFeeFor(state.procType) : 0;
      state.atamakin = autoFeeProc(state.procType) ? MASTER.fees.atamakin_default : 0;
      syncFormFromState();
      recalc();
    });

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
      if (handlePlanEvent(e.target, "change")) return;
      if (handleStatsCfgEvent(e.target, "change")) return;
      handleListEvent(e.target, "change");
    });
    $("masterBody").addEventListener("click", function (e) {
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
  $("recWonBtn").addEventListener("click", function () { $("recMenu").hidden = true; recordOutcome("won"); });
  $("recLostBtn").addEventListener("click", function () { $("recMenu").hidden = true; recordOutcome("lost"); });
  bindEvents();
  syncFormFromState();
  renderTplBar();
  recalc();
  loadSaved();
  renderSaved();
  loadTemplates();
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
  initAbout();
  initDocs();
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
  initImportMaster();
  initCloud(); // ログイン・端末間同期はUI初期化が終わってから開始
  // 何かの理由で画面の決定に至らなくても、隠したままにはしない
  setTimeout(bootDone, 6000);
})();
