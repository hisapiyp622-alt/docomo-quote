/* 試作: 画面内のプルダウンをすべてタイル選択に置き換える
 *
 * 計算ロジック（app.js）には手を入れず、表示だけを差し替える方式。
 * 元の <select> は残したまま非表示にし、タイルを押すと select の値を変えて
 * change イベントを発火させるため、既存の処理はそのまま動く。 */
(function () {
  "use strict";

  // タイル化する固定のプルダウン（プロバイダは専用UI・ヘッダーの担当者切り替えは対象外）
  var IDS = ["product", "applyType", "housing", "ptype", "routerRental", "kojiPay", "dcard", "h5Pay"];

  /* プロバイダ: よく使う4社はロゴタイル、それ以外は「その他プロバイダ」から一覧で選ぶ
   * logos/<id>.svg（または .png）を置くとロゴ画像で表示され、無い間は名前を表示する */
  /* mark/color はロゴ画像が入るまでの識別用（各社のロゴではなく、こちらで用意した色分け表示）。
   * 色やマークの文字は自由に変更してよい。 */
  var PROV_MAIN = [
    { v: "OCN インターネット", id: "ocn", mark: "OCN", color: "#1B6AC9" },
    { v: "GMOとくとくBB", id: "gmo", mark: "GMO", color: "#E2571E" },
    { v: "@nifty", id: "nifty", mark: "@n", color: "#6A3FA0" },
    { v: "ANDLINE", id: "andline", mark: "AND", color: "#1E9E6A" }
  ];
  var PROV_OTHER = [
    { label: "タイプA", items: ["BIGLOBE", "SIS", "hi-ho", "IC-NET", "BB.excite", "エディオンネット", "Tigers-net.com", "シナプス", "楽天ブロードバンド", "DTI", "ネスク", "TikiTikiインターネット", "ドコモnet", "plala"] },
    { label: "タイプB", items: ["@T COM", "TNC", "AsahiNet", "@ちゃんぷるネット", "WAKWAK", "OCN"] }
  ];
  function isMainProvider(v) {
    return PROV_MAIN.some(function (p) { return p.v === v; });
  }
  function setProvider(v) {
    var sel = document.getElementById("provider");
    if (!sel || sel.value === v) return;
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function logoInto(box, p) {
    var id = p.id, name = p.v;
    // ロゴ画像が無い間の表示（識別用のマーク＋社名）
    var fb = document.createElement("span");
    fb.className = "prov-fallback";
    var mark = document.createElement("span");
    mark.className = "prov-mark";
    mark.style.background = p.color || "#6E7075";
    mark.textContent = p.mark || name.slice(0, 3);
    var txt = document.createElement("span");
    txt.className = "prov-name";
    txt.textContent = name;
    fb.appendChild(mark);
    fb.appendChild(txt);
    box.appendChild(fb);
    ["svg", "png"].forEach(function (ext) {
      var img = new Image();
      img.onload = function () {
        if (box.querySelector("img")) return;
        img.className = "prov-logo";
        img.alt = name;
        box.insertBefore(img, fb);
        fb.style.display = "none";
      };
      img.src = "logos/" + id + "." + ext;
    });
  }
  function buildProvider() {
    var sel = document.getElementById("provider");
    if (!sel) return;
    var field = sel.closest(".field");
    var wrap = document.createElement("div");
    wrap.className = "tiles prov-tiles";
    wrap.id = "provTiles";

    PROV_MAIN.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tile-btn prov-tile";
      b.setAttribute("data-val", p.v);
      logoInto(b, p);
      b.addEventListener("click", function () { setProvider(p.v); setTimeout(syncProvider, 0); });
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

    var panel = document.createElement("div");
    panel.className = "prov-panel";
    panel.id = "provPanel";
    panel.hidden = true;
    PROV_OTHER.forEach(function (g) {
      var h = document.createElement("div");
      h.className = "prov-group";
      h.textContent = g.label;
      panel.appendChild(h);
      var row = document.createElement("div");
      row.className = "tiles prov-list";
      g.items.forEach(function (v) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "tile-btn prov-small";
        b.setAttribute("data-val", v);
        b.textContent = v;
        b.addEventListener("click", function () { setProvider(v); setTimeout(syncProvider, 0); });
        row.appendChild(b);
      });
      panel.appendChild(row);
    });

    field.parentNode.insertBefore(panel, field.nextSibling);
    field.parentNode.insertBefore(wrap, field.nextSibling);
    field.classList.add("tiled-field");
    sel.setAttribute("data-prov-tiled", "1");
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
    var v = sel.value;
    var other = v !== "" && !isMainProvider(v);
    if (other) panel.hidden = false;
    Array.prototype.forEach.call(wrap.children, function (b) {
      var bv = b.getAttribute("data-val");
      b.classList.toggle("on", bv === "__other" ? other : bv === v);
    });
    Array.prototype.forEach.call(panel.querySelectorAll(".prov-small"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-val") === v);
    });
  }
  // オプション選択に応じて後から作られるプルダウン
  var DYNAMIC = "select[data-tvkoji], select[data-banpo]";

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
        setTimeout(sync, 0);
      });
      wrap.appendChild(b);
    });
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    if (field) field.classList.add("tiled-field");
    sel.__tiles = wrap;
    sel.setAttribute("data-tiled", "1");
  }

  function scan() {
    targets().forEach(function (sel) {
      if (sel.getAttribute("data-tiled") !== "1" || !sel.__tiles || !sel.__tiles.isConnected) build(sel);
    });
    var prov = document.getElementById("provider");
    if (prov && prov.getAttribute("data-prov-tiled") !== "1") buildProvider();
    sync();
    syncProvider();
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

  // オプションの選択でプルダウンが作り直されるため、DOMの変化を見て追従する
  var timer = null;
  new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () { timer = null; scan(); }, 60);
  }).observe(document.querySelector("main"), { childList: true, subtree: true });

  document.addEventListener("change", function () { setTimeout(function () { sync(); syncProvider(); }, 0); });
  document.addEventListener("input", function () { setTimeout(function () { sync(); syncProvider(); }, 0); });

  scan();
})();
