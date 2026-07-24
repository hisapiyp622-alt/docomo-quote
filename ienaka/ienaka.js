/* イエナカ見積もり（ドコモ光・home 5G） */
(function () {
  "use strict";
  var APP_VERSION = "2026.07.24-24";
  var KEY = "ienaka-v1";

  /* 標準料金（選択時の初期値。入力欄でいつでも変更可） */
  var PRODUCTS = {
    hikari1g: {
      name: "ドコモ光 1ギガ",
      monthly: { ht: { A: 5720, B: 5940 }, ms: { A: 4400, B: 4620 } },
      jimu: 3300, koji: { ht: 22000, ms: 16500 },
      note: "2年定期契約・税込。タイプBはタイプA＋220円。"
    },
    hikari10g: {
      name: "ドコモ光 10ギガ",
      monthly: { ht: { A: 6380, B: 6600 }, ms: { A: 6380, B: 6600 } },
      jimu: 3300, koji: { ht: 22000, ms: 16500 },
      note: "2年定期契約・税込。提供エリア・対応設備の確認が必要。"
    },
    home5g: {
      name: "home 5G",
      monthly: 4950,
      jimu: 4950, koji: 0,
      note: "工事不要・コンセントに挿すだけ。プラン月額4,950円（税込）。"
    }
  };
  /* 月額オプション（チェック式・金額は見積もりごとに編集可） */
  var IENAKA_OPTS = [
    { id: "denwa", name: "ドコモ光電話", price: 550, for: ["hikari1g", "hikari10g"] },
    { id: "denwaBV", name: "ドコモ光電話バリュー", price: 1650, for: ["hikari1g", "hikari10g"] },
    { id: "tv", name: "ドコモ光テレビオプション", price: 825, for: ["hikari1g"] },
    { id: "skyp", name: "スカパー！等の映像サービス", price: 0, for: ["hikari1g"] },
    { id: "network", name: "ネットワークセキュリティ", price: 385, for: ["hikari1g", "hikari10g", "home5g"] }
  ];

  function defaultState() {
    return {
      product: "hikari1g", housing: "ht", ptype: "A",
      baseMonthly: 5720,
      h5DeviceName: "home 5G HR02", h5DevicePrice: 71280, h5Pay: "support36",
      opts: {}, optPrices: {},
      extraMonthly: [], extraInitial: [],
      jimuFee: 3300, kojiFee: 22000, kojiFree: true,
      dpoint: 0, custName: "", staffName: "", quoteMemo: ""
    };
  }
  var state = defaultState();
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved) state = Object.assign(defaultState(), saved);
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
    IENAKA_OPTS.forEach(function (o) {
      if (o.for.indexOf(state.product) < 0) return;
      if (!state.opts[o.id]) return;
      var pr = state.optPrices[o.id] != null ? num(state.optPrices[o.id]) : o.price;
      rows.push({ name: o.name, amount: pr });
    });
    state.extraMonthly.forEach(function (a) {
      if (!a.name && !num(a.amount)) return;
      rows.push({ name: a.name || "追加項目", amount: num(a.amount) });
    });

    var deviceRows = [], deviceNote = "";
    if (state.product === "home5g") {
      var dp = num(state.h5DevicePrice);
      var dName = state.h5DeviceName || "home 5G 端末";
      if (dp > 0) {
        if (state.h5Pay === "ikkatsu") {
          deviceNote = "端末代金は一括払い（初期費用に計上）";
        } else {
          var months = state.h5Pay === "b12" ? 12 : 36;
          var m = Math.floor(dp / months);
          deviceRows.push({ name: dName + "（分割" + months + "回）", amount: m });
          if (state.h5Pay === "support36") {
            deviceRows.push({ name: "月々サポート（36か月間）", amount: -m });
            deviceNote = "月々サポート適用で端末実質負担0円（36か月継続利用の場合）";
          }
        }
      }
    }

    var monthly = 0;
    rows.concat(deviceRows).forEach(function (r) { monthly += r.amount; });
    monthly = Math.max(0, monthly);

    var initRows = [];
    if (num(state.jimuFee) > 0) initRows.push({ name: "契約事務手数料", amount: num(state.jimuFee) });
    if (state.product !== "home5g") {
      if (state.kojiFree) initRows.push({ name: "新規工事料（無料特典適用）", amount: 0, strike: num(state.kojiFee) });
      else if (num(state.kojiFee) > 0) initRows.push({ name: "新規工事料", amount: num(state.kojiFee) });
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

    return { rows: rows, deviceRows: deviceRows, deviceNote: deviceNote, monthly: monthly, initRows: initRows, initial: Math.max(0, initial) };
  }
  function productLabel() {
    if (state.product === "home5g") return "";
    return "（" + (state.housing === "ht" ? "戸建" : "マンション") + "・タイプ" + state.ptype + "）";
  }

  /* ---------- 画面描画 ---------- */
  function renderOpts() {
    var h = "";
    IENAKA_OPTS.forEach(function (o) {
      if (o.for.indexOf(state.product) < 0) return;
      var pr = state.optPrices[o.id] != null ? state.optPrices[o.id] : o.price;
      h += '<label class="check ienaka-opt"><input type="checkbox" data-opt="' + o.id + '"' + (state.opts[o.id] ? " checked" : "") + "> "
        + esc(o.name) + ' <span class="opt-price"><input type="number" data-optprice="' + o.id + '" value="' + pr + '" style="width:5.5em;text-align:right;padding:4px 6px;border:1px solid var(--line);border-radius:5px;font:inherit">円/月</span></label>';
    });
    $("ienakaOptList").innerHTML = h || '<p class="hint">この商材に該当する定番オプションはありません。</p>';
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
    $("home5gStep").hidden = state.product !== "home5g";
    $("kojiField").hidden = state.product === "home5g";
    $("kojiFreeWrap").hidden = state.product === "home5g";
    $("h5DeviceName").value = state.h5DeviceName;
    $("h5DevicePrice").value = state.h5DevicePrice || "";
    $("h5Pay").value = state.h5Pay;
    $("jimuFee").value = state.jimuFee || "";
    $("kojiFee").value = state.kojiFee || "";
    $("kojiFree").checked = !!state.kojiFree;
    $("dpoint").value = state.dpoint || "";
    $("custName").value = state.custName;
    $("staffName").value = state.staffName;
    $("quoteMemo").value = state.quoteMemo;
    renderOpts();
    renderExtras("extraMonthlyList", "extraMonthly");
    renderExtras("extraInitialList", "extraInitial");
  }
  function recalc() {
    var r = calc();
    $("sumMonthly").textContent = yen(r.monthly);
    $("sumInitial").textContent = yen(r.initial);
    var hint = PRODUCTS[state.product].note + (r.deviceNote ? "　" + r.deviceNote : "");
    $("h5Hint").textContent = state.product === "home5g" ? hint : "";
    save();
    if ($("tab-sheet").classList.contains("active")) renderSheet();
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

    h += '<div class="big-monthly">';
    h += '<div class="bm-box"><div class="bm-label">毎月のお支払い目安</div><div class="bm-value">' + yen(r.monthly) + "</div>"
      + (r.deviceNote ? '<div class="bm-sub">' + esc(r.deviceNote) + "</div>" : "") + "</div>";
    h += '<div class="bm-box"><div class="bm-label">初期費用</div><div class="bm-value">' + yen(r.initial) + "</div></div>";
    if (num(state.dpoint) > 0) {
      h += '<div class="bm-box"><div class="bm-label">dポイントプレゼント特典</div><div class="bm-value">' + Math.round(num(state.dpoint)).toLocaleString("ja-JP") + 'pt</div><div class="bm-sub">条件・進呈時期は店頭でご確認ください</div></div>';
    }
    h += "</div>";

    h += "<h3>月額内訳</h3><table><tbody>";
    r.rows.concat(r.deviceRows).forEach(function (x) {
      h += "<tr><td>" + esc(x.name) + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
    });
    h += '<tr class="total"><td>月額合計</td><td class="amt">' + yen(r.monthly) + "</td></tr>";
    h += "</tbody></table>";

    if (r.initRows.length) {
      h += "<h3>初期費用</h3><table><tbody>";
      r.initRows.forEach(function (x) {
        var label = esc(x.name) + (x.strike ? '　<s>' + yen(x.strike) + "</s>" : "");
        h += "<tr><td>" + label + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
      });
      h += '<tr class="total"><td>初期費用合計</td><td class="amt">' + yen(r.initial) + "</td></tr>";
      h += "</tbody></table>";
    }

    h += '<p class="memo">※ スマホの「ドコモ光／home 5G セット割」は携帯料金側の見積もりに適用されます。</p>';
    if (state.quoteMemo) h += '<div class="memo">※ ' + esc(state.quoteMemo) + "</div>";
    h += '<div class="disclaimer">本見積もりは概算です。実際のご契約時の金額・適用条件とは異なる場合があります。提供エリア・設備状況により契約できない場合があります。詳細は店頭スタッフへご確認ください。<br>イエナカ見積もり 版 ' + APP_VERSION + "</div>";
    $("sheetBody").innerHTML = h;
  }

  /* ---------- タブ・イベント ---------- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    document.querySelectorAll(".tab-page").forEach(function (s) { s.classList.toggle("active", s.id === "tab-" + name); });
    if (name === "sheet") renderSheet();
    $("summaryBar").style.display = name === "sheet" ? "none" : "";
  }
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.dataset.tab); });
  });
  $("toSheet").addEventListener("click", function () { switchTab("sheet"); });
  $("backToQuote").addEventListener("click", function () { switchTab("quote"); });
  $("printBtn").addEventListener("click", function () { window.print(); });
  window.addEventListener("beforeprint", renderSheet);

  $("product").addEventListener("change", function () { state.product = this.value; applyDefaults(); syncForm(); recalc(); });
  $("housing").addEventListener("change", function () { state.housing = this.value; applyDefaults(); syncForm(); recalc(); });
  $("ptype").addEventListener("change", function () { state.ptype = this.value; applyDefaults(); syncForm(); recalc(); });
  $("baseMonthly").addEventListener("input", function () { state.baseMonthly = num(this.value); recalc(); });
  $("h5DeviceName").addEventListener("input", function () { state.h5DeviceName = this.value; recalc(); });
  $("h5DevicePrice").addEventListener("input", function () { state.h5DevicePrice = num(this.value); recalc(); });
  $("h5Pay").addEventListener("change", function () { state.h5Pay = this.value; recalc(); });
  $("jimuFee").addEventListener("input", function () { state.jimuFee = num(this.value); recalc(); });
  $("kojiFee").addEventListener("input", function () { state.kojiFee = num(this.value); recalc(); });
  $("kojiFree").addEventListener("change", function () { state.kojiFree = this.checked; recalc(); });
  $("dpoint").addEventListener("input", function () { state.dpoint = num(this.value); recalc(); });
  $("custName").addEventListener("input", function () { state.custName = this.value; recalc(); });
  $("staffName").addEventListener("input", function () { state.staffName = this.value; recalc(); });
  $("quoteMemo").addEventListener("input", function () { state.quoteMemo = this.value; recalc(); });

  $("ienakaOptList").addEventListener("change", function (e) {
    var id = e.target.getAttribute("data-opt");
    if (id) { state.opts[id] = e.target.checked; recalc(); }
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
