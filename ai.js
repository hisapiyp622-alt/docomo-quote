/* =========================================================
 * AI相談（実験中）— 社内版のみ
 * 現在の見積もりと料金マスタを添えて Anthropic API（Claude）に相談し、
 * AIが提案した変更（dq-patch）を「反映」ボタンで見積もりへ取り込む。
 *
 * ・APIキーはこの端末の localStorage にだけ保存する（dq-ai-key-v1）。
 *   店舗間同期・バックアップには含めない（外に出ると課金・漏えい事故になるため）。
 * ・お客様名（custName）はAPIへ送らない（app.js の aiSnapshot が最初から含めない）。
 * ・見積もりへの書き込みは window.DQ_APP.aiApply() だけを通す（項目と値は app.js 側で検証）。
 * ========================================================= */
(function () {
  "use strict";
  var KEY_STORE = "dq-ai-key-v1";
  var MODEL_STORE = "dq-ai-model-v1";
  var API_URL = "https://api.anthropic.com/v1/messages";
  var MODELS = [
    { id: "claude-sonnet-5", name: "標準（Sonnet）" },
    { id: "claude-haiku-4-5-20251001", name: "速い・低コスト（Haiku）" },
    { id: "claude-opus-5", name: "高精度・高コスト（Opus）" }
  ];
  var QUICK = [
    "今の見積もりを確認して、気になる点や提案があれば教えて",
    "月額をできるだけ安くする案を出して",
    "お客様に説明するための短い説明文を作って"
  ];
  // 見積もり項目の日本語名（提案カードの表示用）
  var FIELD_LABELS = {
    procType: "手続き", planGroup: "プラン世代", planId: "料金プラン", tierIdx: "データ量の段階",
    minna: "みんなドコモ割", dSet: "ドコモ光/home 5G セット割", dCard: "dカードお支払割",
    dDenki: "ドコモでんきセット割", choki: "長期利用割", voice: "通話オプション",
    deviceName: "機種名", devicePrice: "機種代金", couponOff: "クーポン値引き", campaignOff: "キャンペーン値引き",
    payMethod: "お支払い方法", kaedoki23: "カエドキ23回分総額", kaedokiFee: "カエドキ手数料",
    atamakin: "頭金", jimuFee: "事務手数料",
    currentInst: "支払い中の分割金", currentInstMonths: "分割金の残回数",
    pointPoikatsu: "ポイ活還元pt", pointPoikatsuFamily: "ポイ活ファミリーpt",
    pointDcard: "dカード還元pt", pointBakuage: "爆アゲ還元pt", pointApply: "ポイントを月額へ充当",
    quoteMemo: "見積もりメモ"
  };
  var VALUE_LABELS = {
    procType: { "": "（未選択）", shinki: "新規契約", mnp: "のりかえ（MNP）", kishu: "機種変更", plan_only: "プラン変更" },
    minna: { "0": "適用なし", "2": "2回線", "3": "3回線以上" },
    dCard: { none: "適用なし", normal: "dカード", goldu: "GOLD U", gold: "GOLD", platinum: "PLATINUM" },
    choki: { none: "適用なし", y10: "10年以上", y20: "20年以上" },
    payMethod: { none: "端末購入なし", ikkatsu: "一括", b12: "分割12回", b24: "分割24回", b36: "分割36回", b48: "分割48回", kaedoki: "いつでもカエドキ" }
  };

  var msgs = [];        // {role:"user"|"assistant", content:string} APIへ送る履歴
  var patches = [];     // 提案カードの patch 本体（描画側は data-pi でここを引く）
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function getKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } }
  function getModel() {
    var m = "";
    try { m = localStorage.getItem(MODEL_STORE) || ""; } catch (e) {}
    return MODELS.some(function (x) { return x.id === m; }) ? m : MODELS[0].id;
  }

  /* ---------- システムプロンプト ----------
   * 毎回の送信時に作り直す。反映後の最新の見積もりがAIに見えるように、
   * 履歴には残さずここに現在値を入れる。 */
  function systemPrompt() {
    var snap = window.DQ_APP.aiSnapshot();
    return [
      "あなたはドコモショップの店頭見積もりアプリに組み込まれたAIアシスタントです。",
      "相手はショップの店員で、お客様への提案（見積もり）を作りながら相談しています。",
      "",
      "## いまの見積もりと、この店の料金マスタ（JSON）",
      "state が編集中のパターン" + snap.pattern + "、result がその計算結果、master がこの店の料金表です。",
      "```json",
      JSON.stringify({ master: snap.master, pattern: snap.pattern, state: snap.state, result: snap.result, otherPatterns: snap.otherPatterns }),
      "```",
      "",
      "## 見積もりの変更を提案するとき",
      "説明の文章に加えて、次の形式のコードブロックを出力してください。店員の画面に「反映」ボタンが付き、押すと見積もりに反映されます（勝手には反映されません）。",
      "",
      "```dq-patch",
      '{"set": {"planId": "max", "minna": "3"}, "options": {"anshin_pack": true}, "adhocMonthly": [{"name": "○○値引き", "amount": -550, "months": 12}]}',
      "```",
      "",
      "使えるキー:",
      '- set: procType("shinki"|"mnp"|"kishu"|"plan_only"), planId, tierIdx(0始まり), minna("0"|"2"|"3"), dSet(真偽), dCard("none"|"normal"|"goldu"|"gold"|"platinum"), dDenki(真偽), choki("none"|"y10"|"y20"), voice, deviceName, devicePrice, couponOff, campaignOff, payMethod("none"|"ikkatsu"|"b12"|"b24"|"b36"|"b48"|"kaedoki"), kaedoki23, kaedokiFee, atamakin, jimuFee, currentInst, currentInstMonths, pointPoikatsu, pointPoikatsuFamily, pointDcard, pointBakuage, pointApply(真偽), quoteMemo',
      "- options / feeItems / campaigns: {id: true|false} で付け外し。id は master にあるものだけ。",
      "- adhocMonthly: [{name, amount(円・マイナス可), months(0=ずっと)}] を追加。adhocInitial: [{name, amount}] を追加。",
      "- clearAdhocMonthly / clearAdhocInitial: true で自由入力欄をいったん空にする。",
      "1つの提案 = 1ブロック。別案を並べるときはブロックを分け、それぞれ何の案か文章で説明してください。",
      "",
      "## 注意",
      "- 金額はすべて税込。master にある金額だけを使い、料金・割引を推測で作らないでください。最新の公式料金は分からない前提で、確認が要るものは「店頭で要確認」と書いてください。",
      "- master に無い planId やオプションid を使わないでください（反映時に弾かれます）。",
      "- お客様の氏名などの個人情報は扱いません（送られてきません）。",
      "- カエドキ(payMethod=kaedoki)は devicePrice と kaedoki23（23回分の総額）の両方が必要です。",
      "- 回答は店員がそのまま読める簡潔な日本語で。長い前置きは不要です。"
    ].join("\n");
  }

  /* ---------- 提案カード ---------- */
  function nameOf(list, id) {
    var hit = (list || []).filter(function (o) { return o.id === id; })[0];
    return hit ? hit.name : id;
  }
  function describePatch(patch, snap) {
    var out = [];
    var set = patch.set || {};
    Object.keys(set).forEach(function (k) {
      var label = FIELD_LABELS[k] || k;
      var v = set[k];
      if (k === "planId") v = nameOf(snap.master.plans, String(v));
      else if (k === "voice") v = nameOf(snap.master.voiceOptions, String(v));
      else if (VALUE_LABELS[k]) v = VALUE_LABELS[k][String(v)] != null ? VALUE_LABELS[k][String(v)] : v;
      else if (typeof v === "boolean") v = v ? "あり" : "なし";
      out.push(label + " → " + v);
    });
    [["options", "options", "オプション"], ["feeItems", "feeItems", "初期費用"], ["campaigns", "campaigns", "キャンペーン"]].forEach(function (m) {
      Object.keys(patch[m[0]] || {}).forEach(function (id) {
        out.push(m[2] + "「" + nameOf(snap.master[m[1]], id) + "」を" + (patch[m[0]][id] ? "付ける" : "外す"));
      });
    });
    if (patch.clearAdhocMonthly) out.push("自由入力の月額をすべて削除");
    if (patch.clearAdhocInitial) out.push("自由入力の初期費用をすべて削除");
    (patch.adhocMonthly || []).forEach(function (it) {
      if (it && it.name) out.push("月額に「" + it.name + "」 " + (it.amount > 0 ? "+" : "") + it.amount + "円" + (it.months ? "×" + it.months + "か月" : "（ずっと）") + " を追加");
    });
    (patch.adhocInitial || []).forEach(function (it) {
      if (it && it.name) out.push("初期費用に「" + it.name + "」 " + it.amount + "円 を追加");
    });
    return out;
  }

  /* ---------- 本文の描画（Markdownの最小限） ---------- */
  function inlineFmt(s) {
    return esc(s)
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }
  function renderAssistant(text) {
    var snap = window.DQ_APP.aiSnapshot();
    var html = "";
    // 行ごとに走査し、```dq-patch は提案カード、その他の ``` は <pre> にする
    var inFence = false, fenceKind = "", buf = [];
    String(text).split("\n").forEach(function (line) {
      var m = /^```[ \t]*([A-Za-z-]*)/.exec(line);
      if (m && !inFence) { inFence = true; fenceKind = m[1] || ""; buf = []; return; }
      if (/^```/.test(line) && inFence) {
        inFence = false;
        var body = buf.join("\n");
        if (fenceKind === "dq-patch") {
          var patch = null;
          try { patch = JSON.parse(body); } catch (e) {}
          if (patch) {
            var lines = describePatch(patch, snap);
            var pi = patches.length;
            patches.push(patch);
            html += '<div class="ai-patch"><div class="ai-patch-title">見積もりの変更案</div><ul>'
              + lines.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("")
              + '</ul><button type="button" class="ai-apply" data-pi="' + pi + '">この内容を見積もりへ反映</button></div>';
          } else {
            html += "<pre>" + esc(body) + "</pre>";
          }
        } else {
          html += "<pre>" + esc(body) + "</pre>";
        }
        return;
      }
      if (inFence) { buf.push(line); return; }
      html += inlineFmt(line) + "<br>";
    });
    if (inFence) html += "<pre>" + esc(buf.join("\n")) + "</pre>"; // 閉じ忘れ
    return html;
  }

  function addBubble(cls, html) {
    var log = $("aiLog");
    var div = document.createElement("div");
    div.className = "ai-msg " + cls;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  /* ---------- 送受信 ---------- */
  function send(text) {
    if (busy || !text) return;
    var key = getKey();
    if (!key) { showKeyCard(true); return; }
    busy = true;
    $("aiSend").disabled = true;
    msgs.push({ role: "user", content: text });
    addBubble("ai-user", inlineFmt(text));
    var thinking = addBubble("ai-wait", "考えています…");
    // 履歴は直近20往復ぶんに絞る（トークン量と料金を抑えるため）
    var hist = msgs.slice(-40);
    fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        /* ブラウザから直接呼ぶための明示ヘッダー（Anthropic公式のCORS許可）。
         * キーが端末の外に出ない構成のための、承知の上の選択。 */
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: getModel(), max_tokens: 3000, system: systemPrompt(), messages: hist })
    }).then(function (res) {
      return res.json().then(function (j) { return { ok: res.ok, status: res.status, body: j }; });
    }).then(function (r) {
      thinking.remove();
      if (!r.ok) {
        // 失敗した発言は履歴から下ろす（次の送信で同じ内容から再開できる）
        msgs.pop();
        var why = r.status === 401 ? "APIキーが正しくないようです。「APIキー」から入れ直してください。"
          : r.status === 429 ? "利用の上限にかかりました。少し待ってからもう一度お試しください。"
          : (r.status === 529 || r.status === 503) ? "AI側が混み合っています。少し待ってからもう一度お試しください。"
          : "エラーが発生しました（" + r.status + "）。" + esc((r.body && r.body.error && r.body.error.message) || "");
        addBubble("ai-error", why);
        return;
      }
      var text2 = (r.body.content || []).filter(function (b) { return b.type === "text"; })
        .map(function (b) { return b.text; }).join("\n");
      msgs.push({ role: "assistant", content: text2 });
      var bub = addBubble("ai-assistant", renderAssistant(text2));
      var u = r.body.usage || {};
      if (u.input_tokens) {
        var meta = document.createElement("div");
        meta.className = "ai-usage";
        meta.textContent = "トークン: 入力 " + u.input_tokens.toLocaleString("ja-JP") + " / 出力 " + (u.output_tokens || 0).toLocaleString("ja-JP");
        bub.appendChild(meta);
      }
      $("aiLog").scrollTop = $("aiLog").scrollHeight;
    }).catch(function () {
      thinking.remove();
      msgs.pop();
      addBubble("ai-error", "通信できませんでした。電波のある場所でもう一度お試しください。");
    }).then(function () {
      busy = false;
      $("aiSend").disabled = false;
    });
  }

  /* ---------- 画面 ---------- */
  function showKeyCard(show) {
    $("aiKeyCard").hidden = !show;
    $("aiChat").hidden = show;
    if (show) $("aiKeyInput").value = "";
    $("aiKeyDel").hidden = !getKey();
  }
  function resetChat() {
    msgs = [];
    patches = [];
    $("aiLog").innerHTML = "";
    addBubble("ai-assistant",
      "いまの見積もり内容とこの店の料金マスタを見ながら相談に乗ります。<br>"
      + "プラン選び・割引の組み合わせ・お客様への説明文など、なんでも聞いてください。<br>"
      + "<span class='ai-note'>変更案には「反映」ボタンが付きます。押すまで見積もりは変わりません。</span>");
  }

  function init() {
    if (!window.DQ_APP || !$("aiLog")) return;
    var sel = $("aiModel");
    MODELS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.id; o.textContent = m.name;
      sel.appendChild(o);
    });
    sel.value = getModel();
    sel.addEventListener("change", function () {
      try { localStorage.setItem(MODEL_STORE, sel.value); } catch (e) {}
    });
    QUICK.forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ai-quickbtn"; b.textContent = q;
      b.addEventListener("click", function () { $("aiInput").value = q; $("aiInput").focus(); });
      $("aiQuick").appendChild(b);
    });
    $("aiKeySave").addEventListener("click", function () {
      var v = $("aiKeyInput").value.trim();
      if (!v) { window.alert("APIキーを入れてください。"); return; }
      try { localStorage.setItem(KEY_STORE, v); } catch (e) {}
      showKeyCard(false);
      if (!msgs.length) resetChat();
    });
    $("aiKeyDel").addEventListener("click", function () {
      if (!window.confirm("この端末からAPIキーを削除しますか？")) return;
      try { localStorage.removeItem(KEY_STORE); } catch (e) {}
      showKeyCard(true);
    });
    $("aiKeyOpen").addEventListener("click", function () { showKeyCard(true); });
    $("aiReset").addEventListener("click", function () {
      if (msgs.length && !window.confirm("今の相談内容を消して、新しく始めますか？")) return;
      resetChat();
    });
    $("aiSend").addEventListener("click", function () {
      var v = $("aiInput").value.trim();
      if (!v) return;
      $("aiInput").value = "";
      send(v);
    });
    $("aiInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $("aiSend").click(); }
    });
    // 提案カードの「反映」（ログ全体で1回だけ拾う）
    $("aiLog").addEventListener("click", function (e) {
      var t = e.target;
      if (!t.classList || !t.classList.contains("ai-apply")) return;
      var patch = patches[+t.getAttribute("data-pi")];
      if (!patch) return;
      var r = window.DQ_APP.aiApply(patch);
      t.disabled = true;
      t.textContent = "反映しました";
      var note = "見積もりへ反映しました。";
      if (r.rejected.length) note += "<br>反映できなかった項目: " + r.rejected.map(esc).join(" / ");
      addBubble("ai-note", note + "<br>内容は「見積もり」タブでご確認ください。");
    });
    if (getKey()) { showKeyCard(false); resetChat(); }
    else showKeyCard(true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
