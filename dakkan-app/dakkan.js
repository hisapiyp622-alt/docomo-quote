/* 他社奪還（イエナカ＝ネット回線の他社比較）モジュール
 *
 * 「いまお使いの他社のネット回線」を入力し、ドコモ光・home 5G へ乗り換えたときの
 * 月々の差額・乗り換えに掛かる費用・追いつく月数を出す。
 *
 * 【設計の約束（指示書 第2章）】
 * - 画面のidと data- 属性は、ひとつ残らず dk 接頭辞にする（将来ケータイ製品版へ統合するため）
 * - 計算と画面描画を、保存・同期・ログインから切り離す。attach() で外から状態を受け取る
 * - ドコモ光の料金はここで持たない・計算しない。すべて KQ_IENAKA.calc() から取る
 */
(function () {
  "use strict";

  var state = null;                 // 呼び出し側の store.dakkan を指す
  var onChange = function () {};    // 保存と再描画を呼び出し側へ知らせる
  var env = {};                     // { ienakaState: function () { ... } }

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function yen(n) { return (n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("ja-JP") + "円"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function recalc() { render(); onChange(); }

  /* 未入力（要確認）の判定。0 は「掛からないことが確認できた」なので要確認ではない */
  function blank(v) { return v === null || v === undefined || v === "" || isNaN(parseFloat(v)); }

  function DATA() { return window.DAKKAN_DATA || { dataDate: "", lineTypes: [], carriers: [] }; }
  function lineType(id) {
    var list = DATA().lineTypes, i;
    for (i = 0; i < list.length; i++) if (list[i].id === (id || (state && state.lineType))) return list[i];
    return list[0] || { id: "collabo", name: "", apply: "shinki", removal: false, zansaiLabel: "工事費の残債", koji: false };
  }
  function carrier() {
    if (!state || !state.carrierId) return null;
    var list = DATA().carriers, i;
    for (i = 0; i < list.length; i++) if (list[i].id === state.carrierId) return list[i];
    return null;
  }
  /* 表示に使う他社名。一覧から選んでいればその名前、無ければ手入力 */
  function carrierLabel() {
    var c = carrier();
    if (c) return c.name;
    return (state && state.carrierName ? state.carrierName : "") || "他社";
  }

  /* イエナカ側の住居タイプ（戸建／マンション）。①で聞き直さないために借りる */
  function housingKey() {
    var ie = env.ienakaState ? env.ienakaState() : null;
    if (!ie) return "ht";
    return ie.housing === "ht" ? "ht" : "ms";   // ms100 もマンション扱い
  }
  /* data.js の値は { ht, ms } でも数値でも書ける。住居タイプで解決する */
  function byHousing(v) {
    if (v == null) return null;
    if (typeof v === "object") return v[housingKey()] != null ? v[housingKey()] : null;
    return v;
  }

  function defaultState() {
    return {
      lineType: "collabo",
      carrierId: "", carrierName: "",
      monthly: "",          // 請求額をそのまま入れる（内訳は聞かない）
      optMonthly: "",       // うちオプション分。④の比較には使わず、別紙の注記だけに使う
      setWari: false, setWariAmount: "",
      renewal: "unknown",   // renewal（更新月）／ other（それ以外）／ unknown（不明）
      penalty: null,        // 解約違約金（null＝要確認）
      penaltyKeep: null,    // 「更新月」を選ぶ前の違約金の控え（戻したときに復元する）
      zansai: null,         // 工事費の残債／ホームルーターは端末の残債
      removal: null,        // 撤去工事費（独自回線・CATVのみ）
      numberFee: null,      // 事業者変更承諾番号／転用承諾番号の発行手数料
      memo: ""
    };
  }

  /* 回線の種類・他社が変わったときに、data.js の目安を入れ直す。
   * 目安が未確認（null）の会社は null のまま＝要確認になる（推測値を入れないため）。 */
  function applyCarrierDefaults() {
    if (!state) return;
    var c = carrier(), lt = lineType();
    state.penaltyKeep = null;   // 他社が変われば控えは無効
    applyPenaltyDefault();
    state.removal = lt.removal ? (c ? byHousing(c.removal) : null) : null;
    state.numberFee = (lt.apply === "jigyosha" || lt.apply === "tenyo")
      ? (c && c.numberFee != null ? c.numberFee : null) : null;
  }
  /* 更新月の選択だけが変わったときは、違約金だけを入れ直す。
   * （残債・撤去費・承諾番号手数料まで消すと、入力済みの値が失われる）
   * 「更新月」にすると0円になるが、戻したときに入力済みの金額が消えないよう控えを持つ。 */
  function applyPenaltyDefault() {
    if (!state) return;
    var c = carrier();
    if (state.renewal === "renewal") {
      if (state.penalty !== 0) state.penaltyKeep = state.penalty;
      state.penalty = 0;
      return;
    }
    if (state.penaltyKeep != null) { state.penalty = state.penaltyKeep; state.penaltyKeep = null; return; }
    state.penalty = c ? byHousing(c.penalty) : null;
  }

  /* イエナカ側で住居タイプが変わったとき、他社の目安も戸建／マンションを入れ直す。
   * 担当者が手で入れた金額は上書きしない（前の住居タイプの目安のままのときだけ入れ直す）。 */
  function syncDefaultsForHousing() {
    if (!state) return;
    var c = carrier();
    if (!c || state.renewal === "renewal") return;
    var other = housingKey() === "ht" ? "ms" : "ht";
    function otherOf(v) { return v && typeof v === "object" ? v[other] : null; }
    if (state.penalty == null || state.penalty === otherOf(c.penalty)) state.penalty = byHousing(c.penalty);
    if (lineType().removal && (state.removal == null || state.removal === otherOf(c.removal))) state.removal = byHousing(c.removal);
    syncForm();
  }

  /* 回線の種類からドコモ側の申込区分・商材を提案する（担当者が変更できる） */
  function suggest() {
    var lt = lineType();
    return { applyType: lt.apply, product: lt.product || null, koji: !!lt.koji };
  }

  /* ---------- 計算（画面に触らない） ---------- */
  function calc() {
    if (!state) return null;
    var ie = window.KQ_IENAKA;
    var iec = ie && ie.calc ? ie.calc() : null;
    var lt = lineType(), c = carrier();
    var pending = [];   // 要確認の項目名

    /* いまのお支払い（他社） */
    var nowMonthly = null, nowIsRef = false;
    if (!blank(state.monthly)) {
      nowMonthly = num(state.monthly);
    } else if (c && byHousing(c.monthly) != null) {
      nowMonthly = num(byHousing(c.monthly));   // 請求額が未入力のときだけ標準月額を参考表示
      nowIsRef = true;
    } else {
      pending.push("いまのお支払い");
    }

    /* ドコモにした場合（イエナカの見積もりをそのまま使う） */
    var segs = iec ? iec.segs : [];
    var newMonthly = segs.length ? segs[segs.length - 1].monthly : 0;   // 通常時の月額
    var newFirst = segs.length ? segs[0].monthly : 0;                   // 当初の月額
    var diff = nowMonthly == null ? null : nowMonthly - newMonthly;     // ＋なら安くなる

    /* 乗り換えに掛かるもの ― 出ていく側（他社に払う） */
    var outRows = [];
    function outRow(name, val, note) {
      if (blank(val)) { outRows.push({ name: name, amount: null, pending: true, note: note || "" }); pending.push(name); return; }
      outRows.push({ name: name, amount: num(val), pending: false, note: note || "" });
    }
    if (state.renewal === "renewal") {
      outRows.push({ name: "解約違約金", amount: 0, pending: false, note: "更新月のため0円" });
    } else {
      outRow("解約違約金", state.penalty, state.renewal === "unknown" ? "更新月かどうかが不明のため要確認" : "");
    }
    outRow(lt.zansaiLabel, state.zansai);
    if (lt.removal) outRow("撤去工事費", state.removal);
    if (lt.apply === "jigyosha") outRow("事業者変更承諾番号の発行手数料", state.numberFee);
    if (lt.apply === "tenyo") outRow("転用承諾番号の発行手数料", state.numberFee);

    var outTotal = 0;
    outRows.forEach(function (r) { if (!r.pending) outTotal += r.amount; });

    /* 乗り換えに掛かるもの ― 入ってくる側（ドコモに払う）。イエナカの初期費用をそのまま使う */
    var inRows = iec ? iec.initRows : [];
    var inTotal = iec ? iec.initial : 0;

    var total = outTotal + inTotal;

    /* ◯か月で追いつく。
     * ・切り上げ（切り捨てると実際より早く追いつくように見えて嘘になる）
     * ・差額が0以下のときは出さない
     * ・要確認が1つでも残っているあいだは出さない（不完全な合計で断定しない） */
    var months = null, monthsHold = "";
    if (pending.length) {
      monthsHold = "「" + pending.join("」「") + "」のご確認後に表示します";
    } else if (diff == null || diff <= 0) {
      monthsHold = "";
    } else {
      months = Math.ceil(total / diff);
    }

    /* 注意書き */
    var notes = [];
    if (nowIsRef) {
      notes.push("いまのお支払いは、" + carrierLabel() + "の標準月額（" + (housingKey() === "ht" ? "戸建" : "マンション") + "）を参考に表示しています。請求書の金額を入力すると、そちらが優先されます。");
    }
    if (!blank(state.optMonthly) && num(state.optMonthly) > 0) {
      notes.push("いまお支払いのうちオプション " + yen(num(state.optMonthly)) + "/月 は、乗り換え後に不要になる見込みです（上の比較には含めていません）。");
    }
    if (state.setWari) {
      notes.push(blank(state.setWariAmount) || num(state.setWariAmount) <= 0
        ? "他社スマホのセット割が外れます。スマホ側のお支払いが上がる場合があります。"
        : "他社スマホの割引 " + yen(num(state.setWariAmount)) + "/月 が外れます。スマホ側のお支払いが上がる場合があります。");
    }
    notes.push("ドコモ光／home 5G セット割（ドコモのスマホ側が下がる分）は、この紙には含めていません。スマホのセット割はスマホの見積書をご覧ください。");
    if (segs.length > 1) {
      notes.push("ドコモ側は当初 " + yen(newFirst) + "/月、" + ie.segLabel(segs[segs.length - 1]) + " は " + yen(newMonthly) + "/月 です。上の比較には通常時の金額を使っています。");
    }

    return {
      lineTypeName: lt.name, carrierName: carrierLabel(),
      applyType: suggest().applyType, koji: suggest().koji,
      nowMonthly: nowMonthly, nowIsRef: nowIsRef,
      newMonthly: newMonthly, newFirst: newFirst, segs: segs,
      diff: diff,
      outRows: outRows, outTotal: outTotal,
      inRows: inRows, inTotal: inTotal,
      total: total,
      pending: pending, months: months, monthsHold: monthsHold,
      notes: notes,
      dataDate: DATA().dataDate || ""
    };
  }

  var APPLY_LABEL = { shinki: "新規（工事あり）", tenyo: "転用（工事不要）", jigyosha: "事業者変更（工事不要）" };

  /* ---------- 状態 → 画面 ---------- */
  function renderLineTypeOptions() {
    var sel = $("dkLineType");
    if (!sel) return;
    sel.innerHTML = DATA().lineTypes.map(function (lt) {
      return '<option value="' + esc(lt.id) + '">' + esc(lt.name) + "</option>";
    }).join("");
  }
  function renderCarrierOptions() {
    if (!state) return;
    var sel = $("dkCarrier");
    if (!sel) return;
    var list = DATA().carriers.filter(function (c) { return c.type === state.lineType; });
    sel.innerHTML = '<option value="">（一覧にない・手入力する）</option>'
      + list.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === state.carrierId ? " selected" : "") + ">" + esc(c.name) + "</option>";
      }).join("");
  }
  function syncForm() {
    if (!state) return;
    var lt = lineType();
    renderLineTypeOptions();
    $("dkLineType").value = state.lineType;
    renderCarrierOptions();
    $("dkCarrier").value = state.carrierId || "";
    $("dkCarrierNameField").hidden = !!state.carrierId;
    $("dkCarrierName").value = state.carrierName || "";
    $("dkMonthly").value = state.monthly === "" || state.monthly == null ? "" : state.monthly;
    $("dkOptMonthly").value = state.optMonthly === "" || state.optMonthly == null ? "" : state.optMonthly;
    $("dkSetWari").checked = !!state.setWari;
    $("dkSetWariField").hidden = !state.setWari;
    $("dkSetWariAmount").value = state.setWariAmount === "" || state.setWariAmount == null ? "" : state.setWariAmount;
    $("dkRenewal").value = state.renewal;
    $("dkPenalty").value = state.penalty == null ? "" : state.penalty;
    $("dkPenaltyField").hidden = state.renewal === "renewal";
    $("dkZansaiLabel").textContent = lt.zansaiLabel;
    $("dkZansai").value = state.zansai == null ? "" : state.zansai;
    $("dkRemovalField").hidden = !lt.removal;
    $("dkRemoval").value = state.removal == null ? "" : state.removal;
    $("dkNumberFeeField").hidden = !(lt.apply === "jigyosha" || lt.apply === "tenyo");
    $("dkNumberFeeLabel").textContent = lt.apply === "tenyo" ? "転用承諾番号の発行手数料" : "事業者変更承諾番号の発行手数料";
    $("dkNumberFee").value = state.numberFee == null ? "" : state.numberFee;
    $("dkMemo").value = state.memo || "";
    var c = carrier(), info = "";
    if (c && c.note) info += '<span class="dk-note">' + esc(c.note) + "</span>";
    if (c && (c.tel || c.url)) {
      info += (info ? "<br>" : "") + "解約・お手続きの連絡先: " + esc(c.tel || "")
        + (c.url ? ' <a href="' + esc(c.url) + '" target="_blank" rel="noopener">公式ページ</a>' : "");
    }
    $("dkContact").innerHTML = info;
  }

  /* ---------- 画面の表示だけ ---------- */
  function render() {
    if (!state) return;
    var r = calc();
    if (!r) return;

    /* 申込区分の提案 */
    $("dkApplyNote").innerHTML = "ドコモ側の申込区分は <b>" + esc(APPLY_LABEL[r.applyType] || r.applyType) + "</b> になります。"
      + "（「ドコモにした場合」タブの①で変更できます）";

    /* ④ 比べる ― 出す数字は3つだけ */
    var h = '<div class="big-monthly">';
    h += '<div class="bm-box"><div class="bm-label">いまのお支払い（ネット回線）</div><div class="bm-value">'
      + (r.nowMonthly == null ? "—" : yen(r.nowMonthly) + "/月") + "</div>"
      + (r.nowIsRef ? '<div class="bm-sub">標準月額からの参考値</div>' : "") + "</div>";
    h += '<div class="bm-box"><div class="bm-label">ドコモにした場合</div><div class="bm-value">' + yen(r.newMonthly) + "/月</div>"
      + (r.diff == null ? "" : '<div class="bm-sub">' + (r.diff > 0 ? "−" + yen(r.diff) : r.diff === 0 ? "同額" : "＋" + yen(-r.diff)) + "/月</div>") + "</div>";
    h += '<div class="bm-box"><div class="bm-label">乗り換えに掛かる費用</div><div class="bm-value">' + yen(r.total) + "</div>"
      + (r.pending.length ? '<div class="bm-sub dk-pending">要確認あり</div>' : "") + "</div>";
    h += "</div>";
    /* 追いつく月数は控えめに1行（安藤さんの判断 2026-07-30） */
    if (r.months != null) {
      h += '<p class="dk-catchup">' + r.months + "か月で追いつきます（乗り換え費用 " + yen(r.total) + " ÷ 月々の差額 " + yen(r.diff) + "・切り上げ）</p>";
    } else if (r.monthsHold) {
      h += '<p class="dk-catchup dk-pending">' + esc(r.monthsHold) + "</p>";
    }
    $("dkCompare").innerHTML = h;

    /* 乗り換え費用の内訳 */
    var rows = "";
    rows += '<tr class="dk-sub"><th colspan="2">' + esc(r.carrierName) + "へ（出ていく側）</th></tr>";
    r.outRows.forEach(function (x) {
      rows += "<tr><td>" + esc(x.name) + (x.note ? ' <span class="hint">（' + esc(x.note) + "）</span>" : "") + "</td>"
        + '<td class="amt' + (x.pending ? " dk-pending" : "") + '">' + (x.pending ? "要確認" : yen(x.amount)) + "</td></tr>";
    });
    rows += '<tr class="dk-sub"><th colspan="2">ドコモへ（入ってくる側）</th></tr>';
    r.inRows.forEach(function (x) {
      rows += "<tr><td>" + esc(x.name) + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
    });
    rows += '<tr class="total"><th>合計（要確認を除く）</th><td class="amt">' + yen(r.total) + "</td></tr>";
    $("dkCostList").innerHTML = "<table class=\"cost-table\"><tbody>" + rows + "</tbody></table>";

    /* 注意書き */
    $("dkNotes").innerHTML = r.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");

    /* 上部の要約 */
    $("dkSummary").textContent = r.diff == null ? ""
      : (r.diff > 0 ? "月々 " + yen(r.diff) + " 安くなります" : r.diff === 0 ? "月々のお支払いは同額です" : "月々 " + yen(-r.diff) + " 上がります");
  }

  /* ---------- イベント登録（1回だけ） ---------- */
  function bind() {
    $("dkLineType").addEventListener("change", function () {
      state.lineType = this.value;
      state.carrierId = "";
      applyCarrierDefaults();
      /* 回線の種類からドコモ側の申込区分・商材を提案する */
      if (window.KQ_DAKKAN.onSuggest) window.KQ_DAKKAN.onSuggest(suggest());
      syncForm(); recalc();
    });
    $("dkCarrier").addEventListener("change", function () {
      state.carrierId = this.value;
      applyCarrierDefaults();
      syncForm(); recalc();
    });
    $("dkCarrierName").addEventListener("input", function () { state.carrierName = this.value; recalc(); });
    $("dkMonthly").addEventListener("input", function () { state.monthly = this.value; recalc(); });
    $("dkOptMonthly").addEventListener("input", function () { state.optMonthly = this.value; recalc(); });
    $("dkSetWari").addEventListener("change", function () {
      state.setWari = this.checked;
      $("dkSetWariField").hidden = !this.checked;
      recalc();
    });
    $("dkSetWariAmount").addEventListener("input", function () { state.setWariAmount = this.value; recalc(); });
    $("dkRenewal").addEventListener("change", function () {
      state.renewal = this.value;
      applyPenaltyDefault();
      syncForm(); recalc();
    });
    $("dkPenalty").addEventListener("input", function () { state.penalty = this.value === "" ? null : num(this.value); recalc(); });
    $("dkZansai").addEventListener("input", function () { state.zansai = this.value === "" ? null : num(this.value); recalc(); });
    $("dkRemoval").addEventListener("input", function () { state.removal = this.value === "" ? null : num(this.value); recalc(); });
    $("dkNumberFee").addEventListener("input", function () { state.numberFee = this.value === "" ? null : num(this.value); recalc(); });
    $("dkMemo").addEventListener("input", function () { state.memo = this.value; recalc(); });
  }

  /* ---------- 別紙の中身（表題・発行元は呼び出し側が付ける） ---------- */
  function sheetHtml() {
    var r = calc();
    if (!r) return "";
    var h = "";

    h += "<h3>いまのご契約</h3>";
    h += '<table><tbody>';
    h += "<tr><th>回線の種類</th><td>" + esc(r.lineTypeName) + "</td></tr>";
    /* 会社が未選択のまま渡さないよう、既定の「他社」はお客様向けには出さない */
    h += "<tr><th>ご利用中の会社</th><td>" + (r.carrierName === "他社" ? "（ご確認ください）" : esc(r.carrierName)) + "</td></tr>";
    h += "<tr><th>月々のお支払い</th><td>" + (r.nowMonthly == null ? "要確認" : yen(r.nowMonthly) + "/月" + (r.nowIsRef ? "（標準月額からの参考値）" : "")) + "</td></tr>";
    h += "</tbody></table>";

    h += "<h3>お比べください</h3>";
    h += '<div class="big-monthly">';
    h += '<div class="bm-box"><div class="bm-label">いまのお支払い</div><div class="bm-value">'
      + (r.nowMonthly == null ? "—" : yen(r.nowMonthly)) + "</div><div class=\"bm-sub\">ネット回線のみ</div></div>";
    h += '<div class="bm-box"><div class="bm-label">ドコモにした場合</div><div class="bm-value">' + yen(r.newMonthly) + "</div>"
      + (r.diff == null ? "" : '<div class="bm-sub">' + (r.diff > 0 ? "−" + yen(r.diff) : r.diff === 0 ? "同額" : "＋" + yen(-r.diff)) + "/月</div>") + "</div>";
    h += '<div class="bm-box"><div class="bm-label">乗り換えに掛かる費用</div><div class="bm-value">' + yen(r.total) + "</div>"
      + (r.pending.length ? '<div class="bm-sub dk-pending">要確認あり</div>' : "") + "</div>";
    h += "</div>";
    if (r.months != null) {
      h += '<p class="dk-catchup">' + r.months + "か月で追いつきます（乗り換え費用 ÷ 月々の差額・切り上げ）</p>";
    } else if (r.monthsHold) {
      h += '<p class="dk-catchup dk-pending">' + esc(r.monthsHold) + "</p>";
    }

    h += "<h3>乗り換えに掛かる費用の内訳</h3>";
    h += '<table><tbody>';
    h += '<tr class="dk-sub"><th colspan="2">' + esc(r.carrierName) + "へ</th></tr>";
    r.outRows.forEach(function (x) {
      h += "<tr><td>" + esc(x.name) + (x.note ? "（" + esc(x.note) + "）" : "") + "</td>"
        + '<td class="amt' + (x.pending ? " dk-pending" : "") + '">' + (x.pending ? "要確認" : yen(x.amount)) + "</td></tr>";
    });
    h += '<tr class="dk-sub"><th colspan="2">ドコモへ（' + esc(APPLY_LABEL[r.applyType] || "") + "）</th></tr>";
    r.inRows.forEach(function (x) {
      h += "<tr><td>" + esc(x.name) + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
    });
    h += '<tr class="total"><th>合計（要確認を除く）</th><td class="amt">' + yen(r.total) + "</td></tr>";
    h += "</tbody></table>";

    if (r.notes.length) {
      h += '<ul class="notes">' + r.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>";
    }
    if (state.memo) h += '<p class="memo">' + esc(state.memo) + "</p>";

    h += '<p class="disclaimer">'
      + "※ 他社の料金・違約金は " + esc(r.dataDate) + " 時点で確認した内容をもとにしています。"
      + "本紙は他社の公式なご案内ではありません。最新の内容・お客様のご契約内容は、ご契約中の会社へご確認ください。<br>"
      + "※ 記載の金額はすべて税込です。「要確認」の項目は費用の合計に含めていません。"
      + "</p>";
    return h;
  }

  window.KQ_DAKKAN = {
    defaultState: defaultState,
    /* 外から状態を渡す。env.ienakaState() でイエナカ側の状態（住居タイプ）を借りる */
    attach: function (st, cb, e) {
      state = st;
      onChange = cb || function () {};
      env = e || {};
    },
    bind: bind,
    syncForm: syncForm,
    calc: calc,
    render: render,
    sheetHtml: sheetHtml,
    suggest: suggest,
    syncDefaultsForHousing: syncDefaultsForHousing,
    onSuggest: null,          // 呼び出し側が差し込む（申込区分・商材の提案をイエナカへ反映する）
    carrierLabel: carrierLabel,
    applyLabel: function (t) { return APPLY_LABEL[t] || ""; },
    dataDate: function () { return DATA().dataDate || ""; },
    /* 入れ物を差し替えずに中身だけ初期化する */
    reset: function () {
      var d = defaultState();
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(d).forEach(function (k) { state[k] = d[k]; });
      applyCarrierDefaults(); syncForm(); recalc();
    }
  };
})();
