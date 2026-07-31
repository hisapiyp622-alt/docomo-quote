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
      /* いまのご契約に含まれているもの。別紙の見出し「（ネット＋TEL＋TV＋CS）」に使う。
       * ドコモ側は「ドコモにした場合」で選んだオプションから自動で判定する */
      services: { net: true, tel: false, tv: false, cs: false },
      monthly: "",          // 請求額をそのまま入れる（内訳は聞かない）
      optMonthly: "",       // うちオプション分。④の比較には使わず、別紙の注記だけに使う
      setWari: false, setWariAmount: "",
      renewal: "unknown",   // renewal（更新月）／ other（それ以外）／ unknown（不明）
      penalty: null,        // 解約違約金（null＝要確認）
      penaltyKeep: null,    // 「更新月」を選ぶ前の違約金の控え（戻したときに復元する）
      zansai: null,         // 工事費の残債／ホームルーターは端末の残債
      removal: null,        // 撤去工事費（独自回線・CATVのみ）
      numberFee: null,      // 事業者変更承諾番号／転用承諾番号の発行手数料
      /* ドコモ側の「実質」を出すための割引。どちらも0なら実質は出さない
       *  hikariSetWari … ご家族スマホのドコモ光セット割の合計（円/月）。
       *    ★ スマホ側から引かれる金額なので、スマホの見積書と二重に数えないこと
       *  dcardWari … dカードお支払割（円/月）。ドコモ光の月額そのものから引かれる */
      hikariSetWari: "",
      dcardWari: "",
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

  /* サービス構成の見出し「（ネット＋TEL＋TV＋CS）」を組み立てる */
  function svcLabel(s) {
    var a = [];
    if (s.net) a.push("ネット");
    if (s.tel) a.push("TEL");
    if (s.tv) a.push("TV");
    if (s.cs) a.push("CS");
    return a.length ? "（" + a.join("＋") + "）" : "";
  }
  /* ドコモ側の構成は「ドコモにした場合」で選んだオプションから自動で判定する */
  function docomoServices() {
    var ie = env.ienakaState ? env.ienakaState() : null;
    if (!ie || !ie.opts) return { net: true };
    return {
      net: true,
      tel: !!(ie.opts.denwa || ie.opts.denwaBV),
      tv: !!ie.opts.tv,
      cs: !!ie.opts.skyp
    };
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
    /* セット割を「実質」に入れているかどうかで、書くことが変わる。
     * 入れているのに「含めていません」と書くと紙の中で矛盾するため、ここで出し分ける。
     * （実際の注記は下の実質の計算のところで push する） */
    if (segs.length > 1) {
      notes.push("ドコモ側は当初 " + yen(newFirst) + "/月、" + ie.segLabel(segs[segs.length - 1]) + " は " + yen(newMonthly) + "/月 です。上の比較には通常時の金額を使っています。");
    }

    /* サービス構成（ネット＋TEL＋TV＋CS）。他社側は①のチェック、ドコモ側はイエナカの選択から */
    var nowSvc = svcLabel(state.services || {});
    var newSvc = svcLabel(docomoServices());

    /* 実質＝ドコモの月額 −（光セット割 ＋ dカードお支払割）。
     * 光セット割はご家族スマホ側から引かれる金額。イエナカ単体版の別紙と同じ考え方で、
     * 「通常時」と「実質」を並べて出し、どこから引かれるのかを必ず注記する。 */
    var setWari = Math.max(0, num(state.hikariSetWari));
    var dcardWari = Math.max(0, num(state.dcardWari));
    var wariRows = [];
    if (setWari > 0) wariRows.push({ name: "ドコモ光セット割（ご家族スマホ側）", amount: setWari });
    if (dcardWari > 0) wariRows.push({ name: "dカードお支払割", amount: dcardWari });
    var wariTotal = setWari + dcardWari;
    var jissitsu = wariTotal > 0 ? Math.max(0, newMonthly - wariTotal) : null;

    /* お得額は「実質」があればそちらで比べる（イメージ図のとおり） */
    var cmpMonthly = jissitsu != null ? jissitsu : newMonthly;
    var saving = nowMonthly == null ? null : nowMonthly - cmpMonthly;
    var savingYear = saving == null ? null : saving * 12;

    /* ◯か月で追いつく。
     * ・切り上げ（切り捨てると実際より早く追いつくように見えて嘘になる）
     * ・差額が0以下のときは出さない
     * ・要確認が1つでも残っているあいだは出さない（不完全な合計で断定しない）
     * ・お得額と同じ土俵で計算する（実質を出しているならその差額で。紙の中で数字が食い違わないように） */
    if (pending.length) {
      monthsHold = "「" + pending.join("」「") + "」のご確認後に表示します";
    } else if (saving != null && saving > 0) {
      months = Math.ceil(total / saving);
    }

    if (setWari > 0) {
      notes.push("「実質」に含めたドコモ光セット割 " + yen(setWari) + "/月 は、ご家族のスマホ料金から割引される分です（この紙の月額そのものが下がるわけではありません）。スマホの見積書と重ねて数えないようご注意ください。");
    } else {
      notes.push("ドコモ光／home 5G セット割（ドコモのスマホ側が下がる分）は、この紙には含めていません。スマホのセット割はスマホの見積書をご覧ください。");
    }

    /* キャンペーン（dポイント進呈）。イエナカ側の入力と計算結果から組み立てる */
    var ie2 = env.ienakaState ? env.ienakaState() : null;
    var ptRows = [];
    if (ie2) {
      if (num(ie2.dpoint) > 0) ptRows.push({ name: "ドコモ光お申込みdポイント進呈", pt: Math.round(num(ie2.dpoint)), sub: "利用開始4か月後の月末・期間用途限定" });
      if (iec && iec.tvOn && ie2.product !== "home5g" && ie2.applyType !== "tenyo" && ie2.tvPoint !== false) {
        ptRows.push({ name: "テレビオプション同時申込特典", pt: 5000, sub: "転用は対象外" });
      }
      if (ie2.product === "hikari1g" && ie2.h5Mig) ptRows.push({ name: "home 5G → ドコモ光 移行特典", pt: 20000, sub: "1ギガ2年定期のみ" });
      if (num(ie2.storePt) > 0) ptRows.push({ name: "店舗独自特典ポイント進呈", pt: Math.round(num(ie2.storePt)), sub: "" });
      if (iec && ie2.product !== "home5g" && ie2.applyType === "shinki" && ie2.kojiFree && iec.koji > 0) {
        ptRows.push({ name: "新規工事料 実質0円特典", pt: iec.koji, sub: "エントリー不要・利用開始月の7か月後の月から24か月分割で進呈" });
      }
    }
    var ptTotal = 0;
    ptRows.forEach(function (x) { ptTotal += x.pt; });

    return {
      lineTypeName: lt.name, carrierName: carrierLabel(),
      applyType: suggest().applyType, koji: suggest().koji,
      nowSvc: nowSvc, newSvc: newSvc, newProduct: ie2 && window.KQ_IENAKA.label ? window.KQ_IENAKA.label() : "ドコモ光",
      nowMonthly: nowMonthly, nowIsRef: nowIsRef,
      newMonthly: newMonthly, newFirst: newFirst, segs: segs,
      wariRows: wariRows, wariTotal: wariTotal, jissitsu: jissitsu,
      saving: saving, savingYear: savingYear,
      ptRows: ptRows, ptTotal: ptTotal,
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
    var sv = state.services || {};
    $("dkSvcNet").checked = sv.net !== false;
    $("dkSvcTel").checked = !!sv.tel;
    $("dkSvcTv").checked = !!sv.tv;
    $("dkSvcCs").checked = !!sv.cs;
    $("dkHikariSetWari").value = state.hikariSetWari === "" || state.hikariSetWari == null ? "" : state.hikariSetWari;
    $("dkDcardWari").value = state.dcardWari === "" || state.dcardWari == null ? "" : state.dcardWari;
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
    h += '<div class="bm-box"><div class="bm-label">ドコモにした場合' + (r.jissitsu != null ? "（実質）" : "") + '</div><div class="bm-value">'
      + yen(r.jissitsu != null ? r.jissitsu : r.newMonthly) + "/月</div>"
      + (r.jissitsu != null ? '<div class="bm-sub">通常 ' + yen(r.newMonthly) + "/月 − 割引 " + yen(r.wariTotal) + "/月</div>" : "")
      + (r.saving == null ? "" : '<div class="bm-sub">' + (r.saving > 0 ? "−" + yen(r.saving) : r.saving === 0 ? "同額" : "＋" + yen(-r.saving)) + "/月</div>") + "</div>";
    h += '<div class="bm-box"><div class="bm-label">乗り換えに掛かる費用</div><div class="bm-value">' + yen(r.total) + "</div>"
      + (r.pending.length ? '<div class="bm-sub dk-pending">要確認あり</div>' : "") + "</div>";
    h += "</div>";
    if (r.saving != null && r.saving > 0) {
      h += '<p class="dk-saving-line">月々 <b>' + yen(r.saving) + "</b> お得　⇒　年間で <b>" + yen(r.savingYear) + "</b></p>";
    }
    /* 追いつく月数は控えめに1行（安藤さんの判断 2026-07-30） */
    if (r.months != null) {
      h += '<p class="dk-catchup">' + r.months + "か月で追いつきます（乗り換え費用 " + yen(r.total) + " ÷ 月々の差額 " + yen(r.saving) + "・切り上げ）</p>";
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
    [["dkSvcNet", "net"], ["dkSvcTel", "tel"], ["dkSvcTv", "tv"], ["dkSvcCs", "cs"]].forEach(function (p) {
      $(p[0]).addEventListener("change", function () {
        state.services = state.services || {};
        state.services[p[1]] = this.checked;
        recalc();
      });
    });
    $("dkHikariSetWari").addEventListener("input", function () { state.hikariSetWari = this.value; recalc(); });
    $("dkDcardWari").addEventListener("input", function () { state.dcardWari = this.value; recalc(); });
  }

  /* ---------- 別紙の中身（A4横・表題と発行元は呼び出し側が付ける） ----------
   * 安藤さんの手書きイメージ（2026-07-31）に合わせた構成:
   *   上段  … 左「現状」／右「ドコモ光にした場合」を左右で対比。右には割引と「実質」
   *   中段  … 「◯円/月 お得 ⇒ 年間で◯円」
   *   下段  … 左「初期費用」／右「キャンペーン」 */
  function sheetHtml() {
    var r = calc();
    if (!r) return "";
    var h = "";

    /* ===== 上段: 現状 ⇒ ドコモ ===== */
    h += '<div class="dk-face">';

    h += '<div class="dk-side dk-side-now"><div class="dk-side-h">現状</div>'
      + '<div class="dk-side-name">' + (r.carrierName === "他社" ? "（ご確認ください）" : esc(r.carrierName)) + esc(r.nowSvc) + "</div>"
      + '<div class="dk-big">' + (r.nowMonthly == null ? "—" : yen(r.nowMonthly) + '<span class="dk-per">/月</span>')
      + "</div>"
      + (r.nowIsRef ? '<div class="dk-side-sub">標準月額からの参考値</div>' : "")
      + "</div>";

    h += '<div class="dk-arrow">⇒</div>';

    h += '<div class="dk-side dk-side-new"><div class="dk-side-h">ドコモ光にした場合</div>'
      + '<div class="dk-side-name">' + esc(r.newProduct) + esc(r.newSvc) + "</div>"
      + '<div class="dk-big">' + yen(r.newMonthly) + '<span class="dk-per">/月</span></div>';
    if (r.wariRows.length) {
      h += '<ul class="dk-wari">' + r.wariRows.map(function (w) {
        return "<li>" + esc(w.name) + " <b>−" + yen(w.amount) + "/月</b></li>";
      }).join("") + "</ul>";
      h += '<div class="dk-big dk-jissitsu"><span class="dk-jl">実質</span>' + yen(r.jissitsu) + '<span class="dk-per">/月</span></div>';
    }
    h += "</div></div>";

    /* ===== 中段: お得額 ===== */
    if (r.saving != null && r.saving > 0) {
      h += '<div class="dk-saving">'
        + '<span class="dk-sv"><span class="dk-sv-l">月々</span><b>' + yen(r.saving) + '</b><span class="dk-sv-l">お得</span></span>'
        + '<span class="dk-sv-arrow">⇒</span>'
        + '<span class="dk-sv"><span class="dk-sv-l">年間で</span><b>' + yen(r.savingYear) + "</b></span>"
        + "</div>";
    } else if (r.saving != null && r.saving <= 0) {
      h += '<div class="dk-saving dk-saving-flat">月々のお支払いは ' + (r.saving === 0 ? "同額です" : yen(-r.saving) + " 上がります") + "</div>";
    }
    if (r.months != null) {
      h += '<p class="dk-catchup">' + r.months + "か月で乗り換え費用に追いつきます（乗り換え費用 ÷ 月々の差額・切り上げ）</p>";
    } else if (r.monthsHold) {
      h += '<p class="dk-catchup dk-pending">' + esc(r.monthsHold) + "</p>";
    }

    /* ===== 下段: 初期費用 ／ キャンペーン ===== */
    h += '<div class="dk-foot">';

    h += '<section class="dk-box"><h3>初期費用</h3><table><tbody>';
    r.outRows.forEach(function (x) {
      h += "<tr><td>" + esc(r.carrierName === "他社" ? "" : r.carrierName + " ") + esc(x.name) + "</td>"
        + '<td class="amt' + (x.pending ? " dk-pending" : "") + '">' + (x.pending ? "要確認" : yen(x.amount)) + "</td></tr>";
    });
    r.inRows.forEach(function (x) {
      h += "<tr><td>ドコモ " + esc(x.name) + '</td><td class="amt">' + yen(x.amount) + "</td></tr>";
    });
    h += '<tr class="total"><th>計</th><td class="amt">' + yen(r.total) + "</td></tr>";
    h += "</tbody></table>";
    if (r.pending.length) h += '<p class="dk-pending dk-foot-note">「要確認」は計に含めていません</p>';
    h += "</section>";

    h += '<section class="dk-box"><h3>キャンペーン</h3>';
    if (r.ptRows.length) {
      h += "<table><tbody>";
      r.ptRows.forEach(function (x) {
        h += "<tr><td>" + esc(x.name) + (x.sub ? '<div class="subrow">' + esc(x.sub) + "</div>" : "")
          + '</td><td class="amt">' + x.pt.toLocaleString("ja-JP") + "pt</td></tr>";
      });
      h += '<tr class="total"><th>dポイント進呈 合計</th><td class="amt">' + r.ptTotal.toLocaleString("ja-JP") + "pt</td></tr>";
      h += "</tbody></table>";
      h += '<p class="dk-foot-note">進呈条件・時期は店頭でご確認ください。</p>';
    } else {
      h += '<p class="dk-foot-note">「ドコモにした場合」でdポイント進呈の入力があると、ここに出ます。</p>';
    }
    h += "</section></div>";

    /* ===== 注意書き ===== */
    if (r.notes.length) {
      h += '<ul class="notes">' + r.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>";
    }
    if (state.memo) h += '<p class="memo">' + esc(state.memo) + "</p>";
    h += '<p class="disclaimer">'
      + "※ 他社の料金・違約金は " + esc(r.dataDate) + " 時点で確認した内容をもとにしています。"
      + "本紙は他社の公式なご案内ではありません。最新の内容・お客様のご契約内容は、ご契約中の会社へご確認ください。"
      + "記載の金額はすべて税込です。"
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
