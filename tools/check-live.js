#!/usr/bin/env node
/* 配信先を実際に叩いて確かめる道具（2026-09-08・配信先の引っ越し）
 *
 *   node tools/check-live.js https://frontalk.curacon.co.jp            製品版
 *   node tools/check-live.js https://<名前>.pages.dev --internal       社内版
 *   node tools/check-live.js https://hisapiyp622-alt.github.io/docomo-quote --oldsite   旧住所の案内ページ
 *     --expect 1.185.0   … アプリの版がこれであること
 *     --commit <sha>     … version.json の commit がこれであること（配ったものが原本のどのコミットか）
 *
 * 「配ったつもり」「隠したつもり」を機械で確かめる。見るもの:
 *   ・アプリの版（app.js の APP_VERSION）と version.json の一致
 *   ・オフライン用の控え一覧（sw.js の ASSETS）が全部 200 で取れること（1つ欠けると圏外で起動できない）
 *   ・存在しない住所が 404 になること（Cloudflare Pages は 404.html が無いとトップを返して壊れが隠れる）
 *   ・道具・テスト・設計文書・サーバー側の取り決めが読めないこと（404）
 *   ・http → https の転送、/index.html → / の転送
 *   ・見出し（Cache-Control が既定のまま・nosniff）
 * 通信には curl を使う（この作業環境の中継サーバー設定を引き継ぐため）。 */
"use strict";
const { execFileSync } = require("child_process");
const { MUST_NOT_SERVE } = require("./lib/dist-extras");

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) || "").replace(/\/+$/, "");
const INTERNAL = args.includes("--internal");
const OLDSITE = args.includes("--oldsite");
function opt(n) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ""; }
const EXPECT = opt("--expect"), COMMIT = opt("--commit");
if (!BASE) { console.error("使い方: node tools/check-live.js https://<住所> [--internal|--oldsite] [--expect <版>] [--commit <sha>]"); process.exit(2); }

function fetch(url, opts) {
  /* 通信の途切れ（中継サーバーの都合など）は2回まで試し直す */
  let r = fetchOnce(url, opts);
  for (let i = 0; i < 2 && r.code === 0; i++) { execFileSync("sleep", ["1"]); r = fetchOnce(url, opts); }
  return r;
}
function fetchOnce(url, opts) {
  const o = opts || {};
  const a = ["-sS", "-o", "-", "-w", "\n%{http_code}\t%{content_type}\t%{redirect_url}", "--max-time", "20", "-H", "Cache-Control: no-cache"];
  if (o.head) a.push("-I");
  try {
    const out = execFileSync("curl", a.concat([url]), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const i = out.lastIndexOf("\n");
    const [code, ctype, redirect] = out.slice(i + 1).split("\t");
    return { code: Number(code), ctype: ctype || "", redirect: redirect || "", body: out.slice(0, i) };
  } catch (e) {
    return { code: 0, ctype: "", redirect: "", body: "", err: String(e.message || e).split("\n")[0] };
  }
}
const ok = [], ng = [];
function chk(label, cond, extra) { (cond ? ok : ng).push(label + (extra ? "（" + extra + "）" : "")); console.log((cond ? "OK  " : "NG  ") + label + (extra ? "  " + extra : "")); }

console.log("== 配信先の確認: " + BASE + (INTERNAL ? "（社内版）" : OLDSITE ? "（旧住所の案内ページ）" : "（製品版）"));

if (OLDSITE) {
  /* 旧住所: すべての入口が案内ページで、古いアプリの部品は 404 */
  for (const p of ["/", "/ienaka/", "/ienaka-tokiwahigashi/", "/keitai-app/", "/ienaka-app/", "/ienaka-demo/", "/ienaka-tiles/", "/dakkan-app/"]) {
    const r = fetch(BASE + p);
    chk("入口 " + p + " が案内ページ", r.code === 200 && /引っ越しました/.test(r.body), String(r.code));
    const sw = fetch(BASE + p + "sw.js");
    chk("入口 " + p + "sw.js が片付け用", sw.code === 200 && /unregister/.test(sw.body), String(sw.code));
  }
  const leaksOld = MUST_NOT_SERVE.oldsite.filter((p) => fetch(BASE + p).code === 200);
  chk("古い部品・設計文書が 404（" + MUST_NOT_SERVE.oldsite.length + "件）", leaksOld.length === 0, leaksOld.join(" "));
} else {
  const appPath = INTERNAL ? "/keitai-app/app.js" : "/app.js";
  const app = fetch(BASE + appPath);
  const ver = (app.body.match(/var APP_VERSION = "([^"]+)"/) || [])[1] || "";
  chk("アプリ本体（" + appPath + "）が取れる", app.code === 200 && !!ver, String(app.code) + (app.err ? " " + app.err : ""));
  chk("アプリの版: " + (ver || "?"), !!ver && (!EXPECT || ver === EXPECT), EXPECT ? "期待 " + EXPECT : "");
  const vj = fetch(BASE + "/version.json");
  let vinfo = null; try { vinfo = JSON.parse(vj.body); } catch (e) {}
  chk("version.json が取れる", vj.code === 200 && !!vinfo, String(vj.code));
  if (vinfo) {
    chk("version.json の版が app.js と一致", vinfo.app === ver, vinfo.app + " / " + ver);
    chk("version.json の kind", vinfo.kind === (INTERNAL ? "internal" : "product"), String(vinfo.kind));
    chk("配ったコミット: " + String(vinfo.commit).slice(0, 12) + (vinfo.dirty ? "（未コミットの変更あり）" : ""), !COMMIT || String(vinfo.commit).indexOf(COMMIT) === 0, COMMIT ? "期待 " + COMMIT.slice(0, 12) : "");
  }
  /* オフライン用の控え一覧（各 sw.js の ASSETS）が全部 200 で取れるか */
  const sws = INTERNAL ? ["/sw.js", "/ienaka/sw.js", "/ienaka-tokiwahigashi/sw.js"] : ["/sw.js"];
  for (const swp of sws) {
    const sw = fetch(BASE + swp);
    const m = sw.body.match(/var ASSETS\s*=\s*\[([\s\S]*?)\]/);
    chk(swp + " が取れて控え一覧が読める", sw.code === 200 && !!m, String(sw.code));
    if (!m) continue;
    const dir = swp.replace(/[^/]*$/, "");
    let missing = [];
    for (const raw of m[1].match(/"[^"]*"/g) || []) {
      const rel = raw.slice(1, -1);
      const abs = new URL(rel, "https://x" + dir).pathname;
      const r = fetch(BASE + abs);
      if (r.code !== 200) missing.push(abs + "=" + r.code);
    }
    chk(swp + " の控え一覧が全部 200", missing.length === 0, missing.join(" "));
    const cacheName = (sw.body.match(/var CACHE = "([^"]+)"/) || [])[1];
    if (cacheName) console.log("    控えの名前: " + cacheName);
  }
  /* 存在しない住所が 404（トップが返る＝壊れが隠れる） */
  const nf = fetch(BASE + "/kono-file-ha-arimasen-" + Date.now() + ".js");
  chk("存在しないファイルが 404", nf.code === 404, String(nf.code) + (nf.code === 200 ? " ← 404.html が無く、トップが返っています" : ""));
  const nf2 = fetch(BASE + "/nai-folder/nai-page/");
  chk("存在しないフォルダが 404", nf2.code === 404, String(nf2.code));
  /* 隠すべきものが読めない */
  const hidden = MUST_NOT_SERVE.common.concat(INTERNAL ? MUST_NOT_SERVE.internal : MUST_NOT_SERVE.product);
  const leaks = hidden.filter((p) => fetch(BASE + p).code === 200);
  chk("道具・テスト・設計文書・取り決めが読めない（" + hidden.length + "件）", leaks.length === 0, leaks.join(" "));
  /* 入口 */
  const top = fetch(BASE + "/");
  chk("トップが開く", top.code === 200 && /<html/i.test(top.body) && (INTERNAL ? /KEITAI_INTERNAL = true/.test(top.body) : !/KEITAI_INTERNAL = true/.test(top.body)), String(top.code));
  if (!INTERNAL) { const demo = fetch(BASE + "/demo/"); chk("/demo/ が開く", demo.code === 200, String(demo.code)); }
  if (INTERNAL) {
    for (const p of ["/ienaka/", "/ienaka-tokiwahigashi/"]) { const r = fetch(BASE + p); chk(p + " が開く（社内版）", r.code === 200 && /IENAKA_INTERNAL = true/.test(r.body), String(r.code)); }
    const rb = fetch(BASE + "/robots.txt"); chk("robots.txt で検索に載せない", rb.code === 200 && /Disallow: \//.test(rb.body), String(rb.code));
  }
  const p404 = fetch(BASE + "/404.html"); chk("404.html がある", p404.code === 200 || p404.code === 404 && /ページが見つかりません/.test(p404.body), String(p404.code));
  /* 転送 */
  const idx = fetch(BASE + "/index.html", { head: true });
  chk("/index.html は 200 か / への転送", idx.code === 200 || (idx.code >= 300 && idx.code < 400), String(idx.code) + (idx.redirect ? " → " + idx.redirect : ""));
  if (/^https:/.test(BASE)) {
    const h = fetch(BASE.replace(/^https:/, "http:") + "/", { head: true });
    chk("http → https に転送される", h.code >= 300 && h.code < 400 && /^https:/.test(h.redirect), String(h.code) + (h.redirect ? " → " + h.redirect : ""));
  }
  /* 見出し */
  const hd = fetch(BASE + "/sw.js", { head: true });
  const cc = (hd.body.match(/^cache-control:\s*(.*)$/im) || [])[1] || "";
  /* Cloudflare の既定は max-age=0（毎回確かめる）。GitHub Pages は max-age=600（10分）。
   * それより長いと、新しい版が端末に届くのが遅れる（_headers で上書きしてしまった印） */
  const maxAge = Number((cc.match(/max-age=(\d+)/i) || [])[1] || 0);
  chk("sw.js の Cache-Control が長すぎない（10分以内）", maxAge <= 600, cc || "（無し）");
  chk("sw.js の Content-Type が JavaScript", /javascript/i.test(hd.ctype) || /content-type:\s*(text|application)\/javascript/im.test(hd.body), hd.ctype);
  const ns = /x-content-type-options:\s*nosniff/i.test(hd.body);
  console.log("    X-Content-Type-Options: " + (ns ? "nosniff" : "（無し。Cloudflare なら _headers が効いていない）"));
  const mf = fetch(BASE + "/manifest.webmanifest", { head: true });
  chk("manifest.webmanifest が取れる", mf.code === 200, String(mf.code) + " " + mf.ctype);
}

console.log("\n" + (ng.length ? "NG " + ng.length + "件 / OK " + ok.length + "件" : "すべて OK（" + ok.length + "件）"));
process.exit(ng.length ? 1 : 0);
