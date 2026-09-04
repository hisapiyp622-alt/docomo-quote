#!/usr/bin/env node
/* 製品版（フロントーク）の配信用リポジトリの中身を作る。
 *
 *   node tools/build-product.js [出力先]              既定: dist-product/
 *   node tools/build-product.js --with-ienaka [出力先] イエナカ単体版も同梱する
 *
 * このリポジトリ（docomo-quote）が原本です。ここから製品版だけを取り出して、
 * 独自ドメインで配信するリポジトリ（frontalk）の中身に組み替えます。
 * 阪南の社内版は原本のまま動き続けるので、そちらには一切影響しません。
 *
 * ── できあがる形 ──────────────────────────────
 *   /                → 製品版ケータイ（keitai-app の中身をルートへ）
 *   /ienaka-app/     → 製品版イエナカ単体
 *   /demo/           → 営業用デモ（ログイン不要）
 *   /CNAME           → 独自ドメイン名（GitHub Pages がこれを読む）
 *
 * ── 入れないもの ──────────────────────────────
 *   社内版・tools・tests・dakkan-app・ienaka-tiles
 *   （社内文書は非公開リポジトリ docomo-quote-internal へ移設済み）
 *
 * ケータイとイエナカは相対パスで参照し合っているため、
 * 階層を変えるぶんだけ書き換えます（下の REWRITES）。
 * 書き換え漏れがあると本番で404になるので、対象が見つからないときは止めます。 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
/* イエナカ単体版の同梱（既定は入れない・2026-08-20 販売方針）。
 * 「光だけ使いたい」という店舗の希望があったときだけ --with-ienaka を付けてビルドする。
 * 同梱してもケータイ⇄イエナカの行き来リンクは出さない（行き来すると端末間同期が
 * 混ざって事故のもとになるため。単体版は単体で完結して使ってもらう）。 */
const WITH_IENAKA = process.argv.includes("--with-ienaka");
const args = process.argv.slice(2).filter(function (a) { return a !== "--with-ienaka"; });
const OUT = path.resolve(args[0] || path.join(ROOT, "dist-product"));
const DOMAIN = "frontalk.curacon.co.jp";

/* 階層が変わることで直す必要のある参照。
 * from が1つも無かった場合はエラーで止める（黙って壊れるのを防ぐ）。 */
const REWRITES = [
  /* 「イエナカ単体版 →」の行き先。単体版は出荷しない（2026-08-20）ため実体は無いが、
   * リンク自体は app.js が製品版では隠すので、参照だけ無害な形に直しておく。
   * ★ 単体版を出荷に戻すときは、下の「単体版を戻すとき」ブロックも戻すこと。 */
  { file: "index.html", from: '"../ienaka-app/"', to: '"ienaka-app/"' },
  // デモは /demo/ に移るが、qr.js はルートにある
  { file: "demo/index.html", from: '"../keitai-app/qr.js"', to: '"../qr.js"' },
];
if (WITH_IENAKA) {
  /* 単体版の分。qr.js はルート（旧 keitai-app）にあるものを使う。
   * 「← ケータイ見積もり」リンクの href も無害な形に直す（表示自体は
   * ienaka-app/app.js が製品版では隠す）。 */
  REWRITES.push(
    { file: "ienaka-app/index.html", from: '"../keitai-app/qr.js"', to: '"../qr.js"' },
    { file: "ienaka-app/index.html", from: '"../keitai-app/"', to: '"../"' },
    { file: "ienaka-app/sw.js", from: '"../keitai-app/qr.js"', to: '"../qr.js"' }
  );
}

/* 出荷物に残っていてはいけない参照。1つでもあれば止める。
 * （引用符つきのものだけを見るので、日本語コメント中の説明は引っかからない） */
const FORBIDDEN = ['"../keitai-app/', "'../keitai-app/", '"../ienaka-app/',
  '"ienaka-demo/', "mitsumorin-hello.png", "mitsumorin-sheet.png"];

/* カメラ読み取り（OCR）が「入」のときだけ、重い読み取り用ファイル（14MB）を入れる。
 * app.js の OCR_ON を見ているので、あちらを true にすれば次のビルドから自動で入る。 */
function ocrEnabled() {
  const src = fs.readFileSync(path.join(ROOT, "keitai-app", "app.js"), "utf8");
  const m = src.match(/var\s+OCR_ON\s*=\s*(true|false)\s*;/);
  if (!m) {
    console.error("keitai-app/app.js に OCR_ON の行が見つかりません。");
    process.exit(1);
  }
  return m[1] === "true";
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skip && skip.includes(name)) continue;
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

const OCR = ocrEnabled();
/* 出荷に入れないもの
 *   firestore.rules … サーバー側（Firebase）の取り決め。お店のアプリでは使わない。
 *     配ると、どこに何を保存しているか・誰が読めるかの作りがそのまま見えてしまう。
 *     公開の場所に置く理由が無いので外す（原本はこのリポジトリに残る）
 *   ocr/ … カメラ読み取りが「切」のときは使われないので入れない（14MB）
 *   mitsumorin-*.png … 旧マスコット。今はどこからも使っていない */
const SKIP = ["firestore.rules", "mitsumorin-hello.png", "mitsumorin-sheet.png"]
  .concat(OCR ? [] : ["ocr"]);

/* 出荷物に絶対に混ざってはいけないファイル名。
 * SKIP はコピーの入口で外すためのもの。こちらは出来上がりを見て止める側で、
 * 別の経路（新しく足したフォルダなど）から紛れ込んでも気づけるようにする。 */
const NEVER_SHIP = ["firestore.rules", "firebase.json", ".firebaserc",
  "firestore.indexes.json", "serviceAccountKey.json", "key.json", ".env"];

// 1) ケータイ（製品版）をルートへ
copyDir(path.join(ROOT, "keitai-app"), OUT, SKIP);
// 2) イエナカ単体は既定では出荷しない（2026-08-20 販売方針。阪南の社内版 /ienaka/ は原本のまま）。
//    希望のある店舗向けに --with-ienaka を付けたときだけ /ienaka-app/ として同梱する
if (WITH_IENAKA) copyDir(path.join(ROOT, "ienaka-app"), path.join(OUT, "ienaka-app"), SKIP);
// 3) 営業用デモ（アドレスを短く /demo/ に）
copyDir(path.join(ROOT, "ienaka-demo"), path.join(OUT, "demo"));

// 4) 階層が変わったぶんの参照を直す
for (const r of REWRITES) {
  const f = path.join(OUT, r.file);
  const before = fs.readFileSync(f, "utf8");
  if (!before.includes(r.from)) {
    console.error(`書き換え対象が見つかりません: ${r.file} の ${r.from}`);
    console.error("原本の作りが変わった可能性があります。REWRITES を見直してください。");
    process.exit(1);
  }
  fs.writeFileSync(f, before.split(r.from).join(r.to));
}

// 5) 独自ドメインの指定（GitHub Pages がこのファイルを読む）
fs.writeFileSync(path.join(OUT, "CNAME"), DOMAIN + "\n");

/* GitHub Pages の下ごしらえ（Jekyll）を通さない印。
 * 出荷物はそのまま配るファイルばかりで、加工されると困ることしかない。 */
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

// 6) 配信用リポジトリの説明
fs.writeFileSync(path.join(OUT, "README.md"), `# フロントーク（配信用）

**このリポジトリは自動で作られています。直接編集しないでください。**

フロントーク（料金見積もりシミュレーション）の製品版を、
${DOMAIN} で配信するための入れ物です。

| アドレス | 中身 |
|---|---|
| https://${DOMAIN}/ | 製品版（店舗IDとパスワードでログイン） |
| https://${DOMAIN}/demo/ | 営業用デモ（ログイン不要） |${WITH_IENAKA ? `
| https://${DOMAIN}/ienaka-app/ | イエナカ単体版（光・home 5G のみ） |` : ""}

## 直すときは原本のほうで

原本は \`docomo-quote\` リポジトリです。そちらの \`keitai-app/\`
\`ienaka-demo/\` を直したあと、\`node tools/build-product.js\` を実行して
できた中身をこのリポジトリへ反映します。

**このリポジトリで直しても、次の反映で上書きされて消えます。**

## 規約など

- [利用規約](TERMS.md)／[使用許諾条件](LICENSE.md)／[サポート](SUPPORT.md)／[プライバシーポリシー](PRIVACY.md)

提供元: 株式会社Curacon
`);

// 7) 出荷物の点検（階層が変わったのに直し忘れた参照が無いか）
(function check(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { check(p); continue; }
    if (NEVER_SHIP.includes(n)) {
      console.error(`出荷物に入ってはいけないファイルがあります: ${path.relative(OUT, p)}`);
      console.error("SKIP に足してから、もう一度実行してください。");
      process.exit(1);
    }
    if (!/\.(html|js|css|webmanifest|json)$/.test(n)) continue;
    const t = fs.readFileSync(p, "utf8");
    for (const bad of FORBIDDEN) {
      if (t.includes(bad)) {
        console.error(`直し忘れの参照があります: ${path.relative(OUT, p)} の ${bad}`);
        console.error("REWRITES に足してから、もう一度実行してください。");
        process.exit(1);
      }
    }
  }
})(OUT);

// 8) 中身の確認（数え上げ）
let files = 0, bytes = 0;
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);

console.log(`できあがり: ${OUT}`);
console.log(`  ファイル ${files}件 / ${(bytes / 1024 / 1024).toFixed(1)}MB`);
console.log(`  独自ドメイン: ${DOMAIN}`);
console.log(`  カメラ読み取り: ${OCR ? "入（読み取り用ファイルを同梱）" : "切（読み取り用ファイルは入れない）"}`);
console.log(`  イエナカ単体版: ${WITH_IENAKA ? "同梱（--with-ienaka）" : "入れない（希望の店舗向けは --with-ienaka を付けて実行）"}`);
console.log("\n中身を配信用リポジトリへ入れれば、そのまま公開されます。");
