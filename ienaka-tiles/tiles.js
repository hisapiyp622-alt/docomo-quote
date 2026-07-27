/* 試作: 画面内のプルダウンをすべてタイル選択に置き換える
 *
 * 計算ロジック（app.js）には手を入れず、表示だけを差し替える方式。
 * 元の <select> は残したまま非表示にし、タイルを押すと select の値を変えて
 * change イベントを発火させるため、既存の処理はそのまま動く。 */
(function () {
  "use strict";

  // タイル化する固定のプルダウン（ヘッダーの担当者切り替えは対象外）
  var IDS = ["product", "applyType", "housing", "ptype", "provider", "routerRental", "kojiPay", "dcard", "h5Pay"];
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
    sync();
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

  document.addEventListener("change", function () { setTimeout(sync, 0); });
  document.addEventListener("input", function () { setTimeout(sync, 0); });

  scan();
})();
