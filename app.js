/* =========================================================
 * ドコモ料金見積もり — アプリ本体
 * 3パターン同時見積もり／期間セグメント式の月額計算
 * ========================================================= */
(function () {
  "use strict";

  var APP_VERSION = "2026.07.19-11";
  var MASTER_KEY = "dq-master-v3"; // v1,v2=開発時（読まない）
  var STATE_KEY = "dq-state-v2";   // v1=単一パターン形式（移行あり）
  var PAT_NAMES = ["A", "B", "C"];
  var OPT_CATEGORIES = ["補償", "バックアップ", "セキュリティ", "エンタメ", "その他"];

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
      if (saved && saved.plans) {
        MASTER = saved;
      } else {
        // ユーザー編集済みの旧マスタ（v2）があれば引き継ぐ
        var v2 = JSON.parse(localStorage.getItem("dq-master-v2") || "null");
        MASTER = v2 && v2.plans ? upgradeV2(v2) : JSON.parse(JSON.stringify(DEFAULT_DATA));
      }
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
    // 初期データに後から増えた項目を保存済みマスタへ追記（ユーザーが削除済みのものは復活させない）
    if (!MASTER.removedIds) MASTER.removedIds = [];
    (DEFAULT_DATA.options || []).forEach(function (d) {
      if (MASTER.options.some(function (o) { return o.id === d.id; })) return;
      if (MASTER.removedIds.indexOf(d.id) >= 0) return;
      MASTER.options.push(JSON.parse(JSON.stringify(d)));
    });
    saveMaster();
  }
  function saveMaster() {
    try { localStorage.setItem(MASTER_KEY, JSON.stringify(MASTER)); } catch (e) {}
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
      procType: "shinki", planGroup: "current", planId: "", tierIdx: 0,
      minna: "0", dSet: false, dCard: "none", dDenki: false, choki: "none",
      voice: "none", options: {}, optionPrices: {}, feeItems: {},
      campaigns: {}, campaignAmounts: {},
      pointPoikatsu: 0, pointDcard: 0,   // ポイント自動充当（実質額案内用・pt/月）
      adhocMonthly: [],   // {name, amount, months} amountは±、months 0=ずっと
      accessories: [],    // {name, price, pay: "once"|"b12"|"b24"|"b36"}
      accSel: {},         // マスタ登録アクセサリの選択 {id: pay}
      deviceName: "", devicePrice: 0, payMethod: "none", zanka: 0, kaedokiFee: 0,
      atamakin: 0, jimuFee: 0,
      adhocInitial: [],   // {name, amount} ±
      custName: "", shopName: "", staffName: "", quoteMemo: "",
    };
  }
  var store = { active: 0, patterns: [defaultState(), defaultState(), defaultState()] };
  var state = store.patterns[0];

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
      if (s && s.patterns && s.patterns.length) {
        store.active = Math.min(Math.max(s.active | 0, 0), 2);
        for (var i = 0; i < 3; i++) {
          store.patterns[i] = Object.assign(defaultState(), s.patterns[i] || {});
        }
      } else {
        // 旧v1（単一パターン）からの移行
        var old = JSON.parse(localStorage.getItem("dq-state-v1") || "null");
        if (old && typeof old === "object") {
          if (typeof old.dCard === "boolean") old.dCard = old.dCard ? "normal" : "none";
          store.patterns[0] = Object.assign(defaultState(), old);
        }
      }
    } catch (e) {}
    // 旧・代理店サービスのチェック状態をオプションへ統合（全パターン共通）
    store.patterns.forEach(function (pt) {
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
    });
    state = store.patterns[store.active];
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(store)); } catch (e) {}
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
  function planOf(st) {
    var p = MASTER.plans.filter(function (x) { return x.id === st.planId; })[0];
    if (!p) {
      p = MASTER.plans.filter(function (x) { return x.group === st.planGroup; })[0] || MASTER.plans[0];
      st.planId = p.id;
    }
    return p;
  }
  function currentPlan() { return planOf(state); }
  function jimuFeeFor(proc) {
    if (proc === "plan_only") return 0;
    if (proc === "shinki") return MASTER.fees.jimu_shinki;
    if (proc === "mnp") return MASTER.fees.jimu_mnp;
    return MASTER.fees.jimu_kishu;
  }
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
              : st.dCard === "gold" ? (d.dcardGold || 0) : 0;
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
    var optRows = [], optTotal = 0;
    MASTER.options.forEach(function (o) {
      if (!st.options[o.id]) return;
      var pr = optPrice(o, st);
      optRows.push({ name: o.name, price: pr });
      optTotal += pr;
    });

    // 月額の追加項目（ずっと／期間限定）
    var adhocPerm = 0, adhocLimited = [];
    st.adhocMonthly.forEach(function (a) {
      if (!a.name && !a.amount) return;
      if (num(a.months) > 0) adhocLimited.push({ name: a.name, amount: num(a.amount), months: Math.round(num(a.months)) });
      else adhocPerm += num(a.amount);
    });

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
    var device = { monthly: 0, months: 0, after: 0, firstExtra: 0, kaedoki: false, zanka: 0, kaedokiFee: 0, jisshitsu: 0 };
    var initialDevice = 0;
    var p = num(st.devicePrice);
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
      var z = Math.min(num(st.zanka), p);
      if (p > 0) {
        device.kaedoki = true;
        device.monthly = Math.floor((p - z) / 23);
        device.months = 23;
        device.firstExtra = (p - z) - device.monthly * 23;
        device.after = z > 0 ? Math.floor(z / 24) : 0;
        device.zanka = z;
        device.kaedokiFee = num(st.kaedokiFee);
        device.jisshitsu = (p - z) + device.kaedokiFee;
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

    // ポイント自動充当（実質額の案内用・入力pt=円で月額から差引）
    var ptPoikatsu = Math.max(0, num(st.pointPoikatsu));
    var ptDcard = Math.max(0, num(st.pointDcard));
    var pointRows = [];
    if (ptPoikatsu > 0) pointRows.push({ name: "ポイント充当（ポイ活プラン還元）", amount: ptPoikatsu });
    if (ptDcard > 0) pointRows.push({ name: "ポイント充当（還元特典）", amount: ptDcard });

    // 月額（恒久部分）
    var baseMonthly = planMonthly + voicePrice + optTotal + adhocPerm - ptPoikatsu - ptDcard;

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
    var atama = num(st.atamakin); // 頭金は入力があれば常に店頭お支払いへ合算
    // where: "store"=店頭お支払い / "bill"=翌月の携帯料金と合算
    var initialRows = [];
    if (num(st.jimuFee) > 0) initialRows.push({ name: "契約事務手数料", amount: num(st.jimuFee), where: "bill" });
    if (initialDevice > 0) initialRows.push({ name: "機種代金（一括）", amount: initialDevice, where: "store" });
    if (atama > 0) initialRows.push({ name: "店頭頭金", amount: atama, where: "store" });
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
      optRows: optRows, optTotal: optTotal,
      adhocPerm: adhocPerm, adhocLimited: adhocLimited, campaignRows: campaignRows, pointRows: pointRows,
      accMonthlyRows: accMonthlyRows, accOnceRows: accOnceRows,
      device: device, baseMonthly: baseMonthly,
      segs: segs, firstExtra: firstExtra,
      initialRows: initialRows, initialTotal: initialTotal,
      storeRows: storeRows, billRows: billRows, storeTotal: storeTotal, billTotal: billTotal,
    };
  }
  function calc() { return calcFor(state); }
  function isPatternUsed(st) {
    var d = defaultState();
    var keys = ["minna", "dSet", "dCard", "dDenki", "choki", "voice", "devicePrice", "payMethod", "tierIdx", "planGroup", "deviceName", "custName", "pointPoikatsu", "pointDcard"];
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
      var t = MASTER.templates[+b.dataset.tpl];
      b.textContent = t ? t.name : "未設定";
      b.classList.toggle("filled", !!t);
      b.classList.toggle("empty", !t);
    });
    var bar = document.querySelector(".tpl").closest(".pattern-bar");
    bar.classList.toggle("tpl-saving", tplSaveMode);
    $("saveTplBtn").textContent = tplSaveMode ? "保存先のテンプレボタンをタップ（ここを押すとキャンセル）" : "現在の内容をテンプレに保存";
  }
  function tplSnapshot() {
    var snap = JSON.parse(JSON.stringify(state));
    delete snap.custName; delete snap.shopName; delete snap.staffName;
    return snap;
  }
  function tplApply(i) {
    var t = MASTER.templates[i];
    if (!t) { tplMsg("テンプレ" + (i + 1) + "は未設定です。「現在の内容をテンプレに保存」から登録してください"); return; }
    var keep = { custName: state.custName, shopName: state.shopName, staffName: state.staffName };
    store.patterns[store.active] = Object.assign(defaultState(), JSON.parse(JSON.stringify(t.state)), keep);
    state = store.patterns[store.active];
    syncFormFromState();
    recalc();
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
    var cur = MASTER.templates[i];
    tplPendingSlot = i;
    $("tplNameInput").value = cur ? cur.name : (plan.name + " " + procLabel).slice(0, 20);
    $("tplNameBox").hidden = false;
    $("saveTplBtn").hidden = true;
    tplMsg("");
    $("tplNameInput").focus();
  }
  function tplSaveDone(ok) {
    if (ok && tplPendingSlot != null) {
      var name = $("tplNameInput").value.trim() || ("テンプレ" + (tplPendingSlot + 1));
      MASTER.templates[tplPendingSlot] = { name: name.slice(0, 20), state: tplSnapshot() };
      saveMaster();
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
    sel.innerHTML = opts.map(function (pl) {
      return '<option value="' + esc(pl.id) + '">' + esc(pl.name) + "</option>";
    }).join("");
    if (!opts.some(function (pl) { return pl.id === state.planId; })) {
      state.planId = opts.length ? opts[0].id : "";
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
  function renderVoiceSelect() {
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
  function tileHtml(attr, id, name, on, priceHtml) {
    return '<div class="tile' + (on ? " on" : "") + '" role="checkbox" aria-checked="' + (on ? "true" : "false")
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
      h += '<div class="tile-grid">' + items.map(function (o) {
        var on = !!state.options[o.id];
        var priceHtml;
        if (o.priceChoices && o.priceChoices.length) {
          var cur = optPrice(o, state);
          priceHtml = '<select data-optprice="' + esc(o.id) + '">'
            + o.priceChoices.map(function (c) {
                return '<option value="' + c + '"' + (c === cur ? " selected" : "") + ">" + yen(c) + "/月</option>";
              }).join("") + "</select>";
        } else {
          priceHtml = '<span class="t-price">' + yen(o.price) + "/月</span>";
        }
        return tileHtml("data-opt", o.id, o.name, on, priceHtml);
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
    if (!list.length) { $("campaignList").innerHTML = ""; return; }
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
    $("zanka").value = state.zanka || "";
    $("kaedokiFee").value = state.kaedokiFee || "";
    $("atamakin").value = state.atamakin;
    $("jimuFee").value = state.jimuFee;
    $("custName").value = state.custName;
    $("shopName").value = state.shopName;
    $("staffName").value = state.staffName;
    $("quoteMemo").value = state.quoteMemo;
    $("ptPoikatsu").value = state.pointPoikatsu || "";
    $("ptDcard").value = state.pointDcard || "";
    $("zankaField").hidden = state.payMethod !== "kaedoki";
    $("kaedokiFeeField").hidden = state.payMethod !== "kaedoki";
    renderCampaigns();
    renderDiscountHint();
  }

  /* ---------- サマリーバー ---------- */
  function renderSummary(r) {
    var seg0 = r.segs[0];
    var lbl = segLabel(seg0);
    $("sumMonthlyLabel").textContent = "月額" + (lbl ? "（" + lbl + "）" : "") + "｜パターン" + PAT_NAMES[store.active];
    $("sumMonthly").textContent = yen(seg0.monthly);
    $("sumInitial").textContent = yen(r.initialTotal);

    var kh = $("kaedokiHint");
    if (r.device.kaedoki) {
      kh.hidden = false;
      kh.textContent = "カエドキ: 23か月目までに返却で残価" + yen(r.device.zanka || 0)
        + "の支払い不要。実質負担 " + yen(r.device.jisshitsu || 0)
        + (r.device.kaedokiFee > 0 ? "（プログラム利用料" + yen(r.device.kaedokiFee) + "込・ドコモで買替えなら免除）" : "")
        + "。返却しない場合は24か月目以降 " + yen(r.device.after) + "/月を加算。";
    } else { kh.hidden = true; }
  }

  /* ---------- 見積書描画 ---------- */
  function renderSheet() {
    var r = calc();
    var today = new Date();
    var dateStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    var procLabel = { shinki: "新規契約", mnp: "のりかえ（MNP）", kishu: "機種変更", plan_only: "プラン変更" }[state.procType];
    var seg0 = r.segs[0], segLast = r.segs[r.segs.length - 1];

    var h = "";
    h += '<h2 class="sheet-title">お見積書</h2>';
    h += '<div class="sheet-meta"><span>作成日: ' + dateStr + "</span><span>"
      + esc(state.shopName || "") + (state.staffName ? "　担当: " + esc(state.staffName) : "") + "</span></div>";
    if (state.custName) h += '<div class="cust">' + esc(state.custName) + "</div>";

    // 月額目安ボックス
    var lbl0 = segLabel(seg0);
    h += '<div class="big-monthly">';
    h += '<div class="bm-box"><div class="bm-label">毎月のお支払い目安' + (lbl0 ? "（" + lbl0 + "）" : "") + '</div>'
      + '<div class="bm-value">' + yen(seg0.monthly) + "</div>"
      + (r.firstExtra > 0 ? '<div class="bm-sub">初回のみ＋' + yen(r.firstExtra) + "（端数調整）</div>" : "")
      + "</div>";
    if (r.device.kaedoki) {
      h += '<div class="bm-box"><div class="bm-label">' + segLabel(segLast) + "（端末返却の場合）</div>"
        + '<div class="bm-value">' + yen(segLast.monthly) + "</div>"
        + '<div class="bm-sub">返却しない場合: ' + yen(segLast.monthlyKeep != null ? segLast.monthlyKeep : segLast.monthly) + "/月</div></div>";
    } else if (r.segs.length > 1) {
      h += '<div class="bm-box"><div class="bm-label">' + segLabel(segLast) + "</div>"
        + '<div class="bm-value">' + yen(segLast.monthly) + "</div></div>";
    }
    h += '<div class="bm-box"><div class="bm-label">店頭お支払い金額</div>'
      + '<div class="bm-value">' + yen(r.storeTotal) + "</div>"
      + (r.billTotal > 0 ? '<div class="bm-sub">ほかに翌月合算払い ' + yen(r.billTotal) + "</div>" : "")
      + "</div>";
    h += "</div>";

    // 月額の推移（期間が2つ以上あるとき）
    if (r.segs.length > 1) {
      h += "<h3>月額の推移</h3><table><tbody>";
      h += "<tr><th>期間</th><th>月額" + (r.device.kaedoki ? "（端末返却の場合）" : "") + "</th>"
        + (r.device.kaedoki ? "<th>返却しない場合</th>" : "") + "</tr>";
      r.segs.forEach(function (sg) {
        h += "<tr><td>" + segLabel(sg) + '</td><td class="amt">' + yen(sg.monthly) + "</td>"
          + (r.device.kaedoki ? '<td class="amt">' + yen(sg.monthlyKeep != null ? sg.monthlyKeep : sg.monthly) + "</td>" : "")
          + "</tr>";
      });
      h += "</tbody></table>";
    }

    // 月額内訳
    h += "<h3>月額内訳（" + segLabel(seg0) + (lbl0 ? "" : "毎月") + "）</h3><table><tbody>";
    h += row("手続き種別", procLabel, false);
    h += row(esc(r.plan.name) + "（" + esc(r.tier.label) + "）", yen(r.tier.price), true);
    if (r.dMinna) h += row("みんなドコモ割（" + (state.minna === "2" ? "2回線" : "3回線以上") + "）", "−" + yen(r.dMinna), true);
    if (r.dSet) h += row("ドコモ光／home 5G セット割", "−" + yen(r.dSet), true);
    if (r.dCard) h += row("dカードお支払割" + (state.dCard === "gold" ? "（GOLD系）" : ""), "−" + yen(r.dCard), true);
    if (r.dDenki) h += row("ドコモでんきセット割", "−" + yen(r.dDenki), true);
    if (r.dChoki) h += row("長期利用割（" + (state.choki === "y20" ? "20年" : "10年") + "以上）", "−" + yen(r.dChoki), true);
    r.campaignRows.forEach(function (c) {
      h += row(esc(c.name) + "（" + c.months + "か月間）", "−" + yen(c.amount), true);
    });
    r.pointRows.forEach(function (p) {
      h += row(esc(p.name) + "※", "−" + yen(p.amount), true);
    });
    if (r.voice.id !== "none") h += row(esc(r.voice.name) + esc(r.voiceNote), yen(r.voicePrice), true);
    r.optRows.forEach(function (o) { h += row(esc(o.name), yen(o.price), true); });
    state.adhocMonthly.forEach(function (a) {
      if (!a.name && !a.amount) return;
      var label2 = esc(a.name || "調整") + (num(a.months) > 0 ? "（" + num(a.months) + "か月間）" : "");
      h += row(label2, (num(a.amount) < 0 ? "−" : "") + yen(Math.abs(num(a.amount))), true);
    });
    if (r.device.monthly > 0) {
      var dLabel = state.deviceName ? esc(state.deviceName) : "機種代金";
      dLabel += r.device.kaedoki ? "（いつでもカエドキプログラム・〜23回）" : "（分割" + r.device.months + "回）";
      h += row(dLabel, yen(r.device.monthly), true);
    }
    r.accMonthlyRows.forEach(function (a) {
      h += row(esc(a.name) + "（アクセサリ・分割" + a.months + "回）", yen(a.monthly), true);
    });
    h += '<tr class="total"><td>月額合計' + (lbl0 ? "（" + lbl0 + "）" : "")
      + '</td><td class="amt">' + yen(seg0.monthly) + "</td></tr>";
    h += "</tbody></table>";
    if (r.pointRows.length) {
      h += '<p class="memo" style="font-size:11.5px;color:#6E7075;margin:4px 0 0">※ ポイント充当はdポイント（期間・用途限定含む）を利用した場合の実質負担額の目安です。獲得ポイントはご利用状況により変動します。</p>';
    }

    // カエドキ説明
    if (r.device.kaedoki) {
      h += "<h3>いつでもカエドキプログラム</h3><table><tbody>";
      h += row("機種代金（総額）", yen(num(state.devicePrice)), true);
      h += row("残価（24回目支払分）", yen(r.device.zanka || 0), true);
      if (r.device.kaedokiFee > 0) h += row("プログラム利用料（返却時・ドコモで買替えの場合は免除）", yen(r.device.kaedokiFee), true);
      h += row("23か月目までに返却した場合の実質負担", yen(r.device.jisshitsu || 0), true);
      h += row("返却しない場合（24か月目以降）", yen(r.device.after) + "/月 × 24回", true);
      h += "</tbody></table>";
    }

    // 初期費用（店頭お支払い／翌月合算払い）
    if (r.storeRows.length) {
      h += "<h3>店頭お支払い金額</h3><table><tbody>";
      r.storeRows.forEach(function (x) {
        h += row(esc(x.name), (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount)), true);
      });
      h += '<tr class="total"><td>店頭お支払い合計</td><td class="amt">' + yen(r.storeTotal) + "</td></tr>";
      h += "</tbody></table>";
    }
    if (r.billRows.length) {
      h += "<h3>翌月合算払い（携帯料金と合算請求）</h3><table><tbody>";
      r.billRows.forEach(function (x) {
        h += row(esc(x.name), (x.amount < 0 ? "−" : "") + yen(Math.abs(x.amount)), true);
      });
      h += '<tr class="total"><td>翌月合算払い合計</td><td class="amt">' + yen(r.billTotal) + "</td></tr>";
      h += "</tbody></table>";
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
    h += '<div class="master-plan"><h3>オプション・サービス（月額）</h3>';
    h += '<p class="hint">名称・月額・カテゴリを自由に設定できます。一括で払うもの（コーティング・手数料など）は下の「初期費用の定番項目」へ。金額選択式のもの（補償など）は選択肢の初期値が単価になります。</p>';
    h += listEditor(MASTER.options, "op", function (o) {
      return '<select data-op-cat="' + o.__i + '">'
        + OPT_CATEGORIES.map(function (c) {
            return '<option value="' + c + '"' + ((o.category || "その他") === c ? " selected" : "") + ">" + c + "</option>";
          }).join("")
        + "</select>"
        + (o.priceChoices ? '<span class="price">選択式</span>' : "");
    });
    h += '<div class="actions"><button class="btn-sub" data-add="options" type="button">＋ オプション・サービスを追加</button></div></div>';

    // 初期費用の定番項目（手数料・コーティング等の一括もの）
    h += '<div class="master-plan"><h3>初期費用の定番項目（手数料・コーティングなど）</h3>';
    h += '<p class="hint">契約時に一括で支払うもの。「⑦初期費用」にチェックボックスとして表示されます。</p>';
    h += listEditor(MASTER.feeItems, "fi", function (o) {
      return '<select data-fi-pay="' + o.__i + '">'
        + '<option value="store"' + (o.pay !== "bill" ? " selected" : "") + ">店頭払い</option>"
        + '<option value="bill"' + (o.pay === "bill" ? " selected" : "") + ">翌月合算</option>"
        + "</select>";
    });
    h += '<div class="actions"><button class="btn-sub" data-add="feeItems" type="button">＋ 項目を追加</button></div></div>';

    // アクセサリの定番商品
    h += '<div class="master-plan"><h3>アクセサリの定番商品（docomo select など）</h3>';
    h += '<p class="hint">「⑥アクセサリ」にタイルとして表示されます。単価は店舗の取扱商品に合わせて編集を。</p>';
    h += listEditor(MASTER.accessories, "ac", function () { return ""; });
    h += '<div class="actions"><button class="btn-sub" data-add="accessories" type="button">＋ 商品を追加</button></div></div>';

    // テンプレート管理
    h += '<div class="master-plan"><h3>テンプレート</h3>';
    h += '<p class="hint">保存は見積もり画面の「現在の内容をテンプレに保存」から。ここでは名前変更と削除ができます。</p>';
    MASTER.templates.forEach(function (t, i) {
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

    function listEditor(list, prefix, extra) {
      return (list || []).map(function (o, i) {
        o.__i = i;
        return '<div class="adhoc-row">'
          + '<button class="mv" data-' + prefix + '-up="' + i + '" type="button" aria-label="上へ"' + (i === 0 ? " disabled" : "") + ">▲</button>"
          + '<button class="mv" data-' + prefix + '-down="' + i + '" type="button" aria-label="下へ"' + (i === list.length - 1 ? " disabled" : "") + ">▼</button>"
          + '<input type="text" value="' + esc(o.name) + '" placeholder="名称" data-' + prefix + '-name="' + i + '">'
          + '<input type="number" value="' + o.price + '" data-' + prefix + '-price="' + i + '">'
          + extra(o)
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
  function recalc() {
    var r = calc();
    renderSummary(r);
    renderPatternTabs();
    saveState();
    if ($("tab-sheet").classList.contains("active")) renderSheet();
  }

  /* ---------- タブ ---------- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".tab-page").forEach(function (pg) {
      pg.classList.toggle("active", pg.id === "tab-" + name);
    });
    if (name === "sheet") renderSheet();
    if (name === "master") renderMasterTab();
    $("summaryBar").style.display = name === "sheet" ? "none" : "";
  }
  function switchPattern(i) {
    store.active = i;
    state = store.patterns[i];
    if (!state.jimuFee && state.procType !== "plan_only" && !state.planId) {
      state.jimuFee = jimuFeeFor(state.procType);
      state.atamakin = MASTER.fees.atamakin_default;
    }
    syncFormFromState();
    recalc();
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
        var j = attr("up") != null ? i - 1 : i + 1;
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
    window.addEventListener("beforeprint", renderSheet); // メニュー印刷でも最新の見積書を出す

    $("procType").addEventListener("change", function () {
      state.procType = this.value;
      state.jimuFee = jimuFeeFor(state.procType);
      $("jimuFee").value = state.jimuFee;
      recalc();
    });
    $("planGroup").addEventListener("change", function () {
      state.planGroup = this.value;
      renderPlanSelect();
      renderVoiceSelect();
      renderMailOpt();
      renderCampaigns();
      renderDiscountHint();
      recalc();
    });
    $("planId").addEventListener("change", function () {
      state.planId = this.value;
      state.tierIdx = 0;
      renderTierSelect();
      renderVoiceSelect();
      renderMailOpt();
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
    $("ptDcard").addEventListener("input", function () { state.pointDcard = num(this.value); recalc(); });
    $("voice").addEventListener("change", function () { state.voice = this.value; recalc(); });
    $("mailOpt").addEventListener("change", function () {
      var mo = mailOptDef();
      if (mo) { state.options[mo.id] = this.value === "yes"; }
      recalc();
    });

    // タイルのタップ／キー操作で選択切替（タイル内のプルダウン操作では切替しない）
    function toggleTile(e) {
      if (e.target.closest("select")) return;
      var tile = e.target.closest(".tile");
      if (!tile) return;
      var optId = tile.getAttribute("data-opt");
      var feeId = tile.getAttribute("data-fee");
      var accId = tile.getAttribute("data-acc");
      if (optId) { state.options[optId] = !state.options[optId]; renderOptionList(); }
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
      $("zankaField").hidden = state.payMethod !== "kaedoki";
      $("kaedokiFeeField").hidden = state.payMethod !== "kaedoki";
      recalc();
    });
    $("zanka").addEventListener("input", function () { state.zanka = num(this.value); recalc(); });
    $("kaedokiFee").addEventListener("input", function () { state.kaedokiFee = num(this.value); recalc(); });
    $("atamakin").addEventListener("input", function () { state.atamakin = num(this.value); recalc(); });
    $("jimuFee").addEventListener("input", function () { state.jimuFee = num(this.value); recalc(); });

    // お客様情報
    ["custName", "shopName", "staffName", "quoteMemo"].forEach(function (id) {
      $(id).addEventListener("input", function () { state[id] = this.value; saveState(); });
    });

    $("clearQuote").addEventListener("click", function () {
      var keep = { shopName: state.shopName, staffName: state.staffName };
      store.patterns[store.active] = defaultState();
      state = store.patterns[store.active];
      state.shopName = keep.shopName;
      state.staffName = keep.staffName;
      state.jimuFee = jimuFeeFor(state.procType);
      state.atamakin = MASTER.fees.atamakin_default;
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
        if (MASTER.templates[tpi]) { MASTER.templates[tpi].name = t.value.slice(0, 20); markEdited(); renderTplBar(); }
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
        MASTER.templates[+t.getAttribute("data-tp-del")] = null;
        markEdited(); renderMasterTab(); renderTplBar();
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
      if (addKey === "options") { MASTER.options.push(LIST_DEFS.op.newItem()); }
      else if (addKey === "feeItems") { MASTER.feeItems.push(LIST_DEFS.fi.newItem()); }
      else if (addKey === "accessories") { MASTER.accessories.push(LIST_DEFS.ac.newItem()); }
      else { handleListEvent(t, "click"); return; }
      markEdited();
      renderMasterTab();
      renderOptionList(); renderFeeItemList(); renderAccessoryTiles();
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
  loadMaster();
  loadState();
  if (!state.jimuFee && state.procType !== "plan_only" && !localStorage.getItem(STATE_KEY)) {
    state.jimuFee = jimuFeeFor(state.procType);
    state.atamakin = MASTER.fees.atamakin_default;
  }
  bindEvents();
  syncFormFromState();
  renderTplBar();
  recalc();
})();
