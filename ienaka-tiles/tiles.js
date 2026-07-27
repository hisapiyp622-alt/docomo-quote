/* 試作: 画面内のプルダウンをすべてタイル選択に置き換える
 *
 * 計算ロジック（app.js）には手を入れず、表示だけを差し替える方式。
 * 元の <select> は残したまま非表示にし、タイルを押すと select の値を変えて
 * change イベントを発火させるため、既存の処理はそのまま動く。 */
(function () {
  "use strict";

  // タイル化する固定のプルダウン（プロバイダは専用UI・ヘッダーの担当者切り替えは対象外）
  var IDS = ["product", "applyType", "housing", "ptype", "routerRental", "kojiPay", "dcard", "h5Pay"];
  // オプション選択に応じて後から作られるプルダウン
  var DYNAMIC = "select[data-tvkoji], select[data-banpo]";

  /* プロバイダ: 料金タイプ（A / B）ごとに、よく使う社をタイルで、
   * それ以外は「その他プロバイダ」から一覧で選ぶ。
   * mark / color はロゴ画像が入るまでの識別表示（各社のロゴではない・自由に変更可）。
   * logos/<id>.svg（または .png）を置くとロゴ画像の表示に切り替わる。 */
  var PROV = {
    A: {
      main: [
        { v: "OCN インターネット", id: "ocn", mark: "OCN", color: "#1B6AC9" },
        { v: "GMOとくとくBB", id: "gmo", mark: "GMO", color: "#E2571E" },
        { v: "@nifty", id: "nifty", mark: "@n", color: "#6A3FA0" },
        { v: "ANDLINE", id: "andline", mark: "AND", color: "#1E9E6A" }
      ],
      other: ["BIGLOBE", "SIS", "hi-ho", "IC-NET", "BB.excite", "エディオンネット", "Tigers-net.com",
        "シナプス", "楽天ブロードバンド", "DTI", "ネスク", "TikiTikiインターネット", "ドコモnet", "plala"]
    },
    B: {
      main: [
        { v: "AsahiNet", id: "asahinet", mark: "Asahi", color: "#00838F" },
        { v: "WAKWAK", id: "wakwak", mark: "WAK", color: "#C2185B" }
      ],
      other: ["@T COM", "TNC", "@ちゃんぷるネット", "OCN"]
    }
  };

  function currentType() {
    var s = document.getElementById("ptype");
    return s && s.value === "B" ? "B" : "A";
  }
  function isMain(t, v) {
    return PROV[t].main.some(function (p) { return p.v === v; });
  }
  function inType(t, v) {
    return isMain(t, v) || PROV[t].other.indexOf(v) >= 0;
  }
  function setProvider(v) {
    var sel = document.getElementById("provider");
    if (!sel || sel.value === v) return;
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // ロゴ画像があれば画像、無ければ識別用のマーク＋社名を表示
  function logoInto(box, p) {
    var fb = document.createElement("span");
    fb.className = "prov-fallback";
    var mark = document.createElement("span");
    mark.className = "prov-mark";
    mark.style.background = p.color || "#6E7075";
    mark.textContent = p.mark || p.v.slice(0, 3);
    var txt = document.createElement("span");
    txt.className = "prov-name";
    txt.textContent = p.v;
    fb.appendChild(mark);
    fb.appendChild(txt);
    box.appendChild(fb);
    ["svg", "png"].forEach(function (ext) {
      var img = new Image();
      img.onload = function () {
        if (box.querySelector("img")) return;
        img.className = "prov-logo";
        img.alt = p.v;
        box.insertBefore(img, fb);
        fb.style.display = "none";
      };
      img.src = "logos/" + p.id + "." + ext;
    });
  }

  var builtType = null;
  function buildProvider(t) {
    var sel = document.getElementById("provider");
    if (!sel) return;
    var field = sel.closest(".field");
    var oldW = document.getElementById("provTiles"); if (oldW) oldW.remove();
    var oldP = document.getElementById("provPanel"); if (oldP) oldP.remove();

    var wrap = document.createElement("div");
    wrap.className = "tiles prov-tiles";
    wrap.id = "provTiles";
    var panel = document.createElement("div");
    panel.className = "prov-panel";
    panel.id = "provPanel";
    panel.hidden = true;

    PROV[t].main.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile-btn prov-tile";
      b.setAttribute("data-val", p.v);
      logoInto(b, p);
      b.addEventListener("click", function () { setProvider(p.v); panel.hidden = true; setTimeout(syncProvider, 0); });
      wrap.appendChild(b);
    });
    ["", "__other"].forEach(function (v) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile-btn" + (v === "__other" ? " prov-other" : "");
      b.setAttribute("data-val", v);
      b.textContent = v === "" ? "未定" : "その他プロバイダ";
      b.addEventListener("click", function () {
        if (v === "") { setProvider(""); panel.hidden = true; }
        else { panel.hidden = !panel.hidden; }
        setTimeout(syncProvider, 0);
      });
      wrap.appendChild(b);
    });

    // 「その他プロバイダ」の一覧は、選択中の料金タイプのものだけを出す
    var head = document.createElement("div");
    head.className = "prov-group";
    head.textContent = "タイプ" + t + " のその他プロバイダ";
    panel.appendChild(head);
    var row = document.createElement("div");
    row.className = "tiles prov-list";
    PROV[t].other.forEach(function (v) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile-btn prov-small";
      b.setAttribute("data-val", v);
      b.textContent = v;
      b.addEventListener("click", function () { setProvider(v); setTimeout(syncProvider, 0); });
      row.appendChild(b);
    });
    panel.appendChild(row);

    field.parentNode.insertBefore(panel, field.nextSibling);
    field.parentNode.insertBefore(wrap, field.nextSibling);
    field.classList.add("tiled-field");
    builtType = t;
  }
  function ensureProvider() {
    var sel = document.getElementById("provider");
    if (!sel) return;
    var t = currentType();
    var wrap = document.getElementById("provTiles");
    if (!wrap || !wrap.isConnected || builtType !== t) {
      buildProvider(t);
      // 料金タイプを変えたとき、そのタイプに無いプロバイダが残っていたら未選択に戻す
      if (sel.value && !inType(t, sel.value)) setProvider("");
    }
  }
  function syncProvider() {
    var sel = document.getElementById("provider");
    var wrap = document.getElementById("provTiles");
    var panel = document.getElementById("provPanel");
    if (!sel || !wrap || !panel) return;
    var field = sel.closest(".field");
    var hide = !!(field && field.hidden);
    wrap.hidden = hide;
    if (hide) { panel.hidden = true; return; }
    var t = builtType || currentType();
    var v = sel.value;
    var other = v !== "" && !isMain(t, v);
    if (other) panel.hidden = false;
    Array.prototype.forEach.call(wrap.children, function (b) {
      var bv = b.getAttribute("data-val");
      b.classList.toggle("on", bv === "__other" ? other : bv === v);
    });
    Array.prototype.forEach.call(panel.querySelectorAll(".prov-small"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-val") === v);
    });
  }

  function targets() {
    var list = [];
    IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) list.push(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll(DYNAMIC), function (el) { list.push(el); });
    return list;
  }

  function build(sel) {
    var field = sel.closest(".field");
    var anchor = field || sel;
    var wrap = document.createElement("div");
    wrap.className = "tiles";
    Array.prototype.forEach.call(sel.options, function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile-btn";
      b.setAttribute("data-val", o.value);
      b.textContent = o.textContent;
      b.addEventListener("click", function () {
        if (sel.value === o.value) return;
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        setTimeout(refresh, 0);
      });
      wrap.appendChild(b);
    });
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    if (field) field.classList.add("tiled-field");
    sel.__tiles = wrap;
    sel.setAttribute("data-tiled", "1");
  }

  // 選択状態と表示/非表示を元のプルダウンに合わせる
  function sync() {
    targets().forEach(function (sel) {
      var wrap = sel.__tiles;
      if (!wrap) return;
      var field = sel.closest(".field");
      wrap.hidden = !!(field && field.hidden);
      Array.prototype.forEach.call(wrap.children, function (b) {
        b.classList.toggle("on", b.getAttribute("data-val") === sel.value);
      });
    });
  }
  function refresh() {
    targets().forEach(function (sel) {
      if (sel.getAttribute("data-tiled") !== "1" || !sel.__tiles || !sel.__tiles.isConnected) build(sel);
    });
    ensureProvider();
    sync();
    syncProvider();
  }

  // オプションの選択でプルダウンが作り直されるため、DOMの変化を見て追従する
  var timer = null;
  new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () { timer = null; refresh(); }, 60);
  }).observe(document.querySelector("main"), { childList: true, subtree: true });

  document.addEventListener("change", function () { setTimeout(refresh, 0); });
  document.addEventListener("input", function () { setTimeout(function () { sync(); syncProvider(); }, 0); });

  refresh();
})();
