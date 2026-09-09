/* 配信用フォルダに足す「おまけ」のファイル（製品版・社内版で共通）
 *
 *   404.html      … 存在しない住所を開いたときのページ。
 *                   Cloudflare Pages はこのファイルが無いと、無い住所にトップページを
 *                   返してしまう（1ページのアプリ扱い）。そうなると、参照の書き間違いで
 *                   app.js が 404 のはずのところにトップの HTML が返り、壊れているのに
 *                   気づけない。必ず入れる。
 *   _headers      … Cloudflare Pages が読む見出しの設定（種類の推測をさせない・枠に埋め込ませない）。
 *                   Cache-Control は書かない（既定の「毎回確かめる」を使う）。
 *   robots.txt    … 社内版だけ。検索エンジンに載せない。
 *   version.json  … 配ったものが原本のどのコミットかを照合するための印。
 *                   `node tools/check-live.js <住所>` がこれを読んで版を確かめる。
 *
 * GitHub Pages で配っても害は無い（404.html はそのまま使われ、_headers は無視される）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

/* 404 ページ。アプリの JS は読み込まない（壊れた参照を隠さないため）。
 * homeHref はトップへの相対パス（製品版は "/"、社内版も "/"）。 */
function page404(title, homeHref) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ページが見つかりません｜${title}</title>
<style>
body{margin:0;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#F4F4F5;color:#222}
main{max-width:520px;margin:12vh auto;padding:24px;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h1{font-size:18px;color:#CC0033;margin:0 0 12px}
p{line-height:1.7;margin:0 0 12px}
a.btn{display:inline-block;padding:10px 18px;border-radius:8px;background:#CC0033;color:#fff;text-decoration:none;font-weight:600}
code{background:#f1f1f3;padding:2px 6px;border-radius:4px;font-size:13px}
</style>
</head>
<body>
<main>
<h1>ページが見つかりません</h1>
<p>お探しの住所にはページがありません。住所を打ち間違えているか、古い案内をお使いの可能性があります。</p>
<p><a class="btn" href="${homeHref}">${title}のトップへ</a></p>
<p><small>このページが表示された住所: <code id="u"></code></small></p>
</main>
<script>document.getElementById("u").textContent=location.pathname;</script>
</body>
</html>
`;
}

/* _headers（Cloudflare Pages の形式）。
 * Cache-Control は**書かない**。Cloudflare の既定（max-age=0, must-revalidate ＋ ETag）が
 * sw.js・app.js の更新にいちばん向いていて、ここで上書きすると新しい版が端末に届くのが遅れる。
 * Content-Security-Policy なども書かない（Firebase の部品・blob:・data: の画像が止まる）。
 * noindex のとき（社内版）は検索エンジンに載せない印を足す。 */
function headersFile(opts) {
  const o = opts || {};
  const lines = [
    "# Cloudflare Pages が読む見出しの設定（tools/lib/dist-extras.js が作る）",
    "# Cache-Control は書かない（既定の「毎回確かめる」が最良）",
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Frame-Options: SAMEORIGIN",
  ];
  if (o.noindex) lines.push("  X-Robots-Tag: noindex, nofollow");
  return lines.join("\n") + "\n";
}

function gitInfo() {
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch (e) { return ""; }
  };
  const commit = run("git rev-parse HEAD") || "unknown";
  // 出荷物に入るフォルダに、まだコミットしていない変更があるか（あれば照合に使えない）
  const dirty = run("git status --porcelain -- keitai-app ienaka-app ienaka-demo tools") !== "";
  return { commit, dirty };
}

function versionInfo(extra) {
  const app = fs.readFileSync(path.join(ROOT, "keitai-app", "app.js"), "utf8");
  const data = fs.readFileSync(path.join(ROOT, "keitai-app", "data.js"), "utf8");
  const appVer = (app.match(/var APP_VERSION = "([^"]+)"/) || [])[1];
  const master = Number((data.match(/"masterVersion":\s*(\d+)/) || [])[1]);
  if (!appVer || !master) throw new Error("APP_VERSION か masterVersion を読めませんでした");
  const g = gitInfo();
  return Object.assign({ app: appVer, master, commit: g.commit, dirty: g.dirty }, extra || {});
}

/* out に 404.html・_headers・version.json を書く。
 *   opts.title   … 404 ページに出す名前
 *   opts.noindex … true なら検索よけ（X-Robots-Tag と robots.txt）
 *   opts.extra   … version.json に足す項目（kind など） */
function writeExtras(out, opts) {
  const o = opts || {};
  fs.writeFileSync(path.join(out, "404.html"), page404(o.title || "フロントーク", o.homeHref || "/"));
  fs.writeFileSync(path.join(out, "_headers"), headersFile({ noindex: !!o.noindex }));
  fs.writeFileSync(path.join(out, "version.json"), JSON.stringify(versionInfo(o.extra), null, 2) + "\n");
  // 社内版: 検索エンジンに載せない（住所を知っている人だけが使う）
  if (o.noindex) fs.writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
}

module.exports = { writeExtras, versionInfo, page404, headersFile };
