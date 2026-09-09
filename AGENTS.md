<!-- このファイルは tools/build-agents.js が CLAUDE.md から生成します。直接編集しないでください。
     作業ルールを変えるときは CLAUDE.md を直し、node tools/build-agents.js を実行してください。 -->

> **このファイルは `CLAUDE.md` と同じ中身です。**
> 名前が2つあるのは、AIアシスタントによって自動で読むファイルが違うためです
> （Claude Code は `CLAUDE.md`、Codex は `AGENTS.md`）。
> どちらで作業しても、同じルール・同じ手順・同じテストで進めてください。

# 作業ルール

> **このリポジトリを初めて触る場合は、先に `HANDOVER.md`（引き継ぎ指示書）を読んでください。**
> 経緯・現状・やってはいけないことがまとまっています。
>
> **クラコン（Curacon）側の担当者として作業する場合は、`HANDOVER-CURACON.md` を先に読んでください。**
> main へ直接 push しない・生成物を編集しない等の決まりがあります。
>
> **販売・契約・運用の文書は、非公開リポジトリ `docomo-quote-internal` にあります。**
> そちらの `HANDOFF.md` が最新の作業状況です。このリポジトリは public なので、
> 分配率・営業メモ・契約の中身・連絡先は**ここには書かないでください**。

## 説明のしかた（ユーザーへの回答）

**開発者（安藤さん）はプログラミングの専門家ではありません。専門用語で説明しないでください。**
コードは任せてもらっていますが、判断はご本人がするので、判断材料は日常のことばで出します。

- **カタカナ語・英語の略語は、使う前に身近なたとえで言い換える**
  （例: 「リポジトリ」→「アプリの元ファイルの保管場所」／「Organization」→「会社名義の共有アカウント」）
- どうしても用語が必要なときは、**初めて出てきた場所で1行の説明を添える**
- 「**何がどうなるか**」「**何が困るか**」を先に書く。仕組みの話は後ろに回すか、省く
- 判断をお願いするときは、**選択肢とおすすめ**、そして選ぶと何が変わるかをセットで出す
- 影響の大きさを正直に伝える。「大変です」と煽らない／「簡単です」と省かない
- 分からないまま進むより聞き返してもらうほうが早いので、**聞き返しやすい書き方**にする

## アプリ構成

| パス | 位置づけ |
|---|---|
| `/keitai-app/` | ケータイ見積もり **製品版**（代理店向け販売用・自己完結）。**開発はここだけで行う** |
| `/`（ルート） | ケータイ見積もり **社内版**（阪南店の日常業務用）。**生成物・直接編集しない**（下記） |
| `/ienaka-app/` | イエナカ単体版の原本（**出荷はしない** 2026-08-20〜。社内版 `/ienaka/` の生成元として維持） |
| `/ienaka/` | イエナカ見積もり **社内版**（阪南店用）。**生成物・直接編集しない**（下記） |
| `/ienaka-tiles/` | タイル式UIの試作（凍結） |
| `/ienaka-demo/` | イエナカ **デモ版**（ログイン不要・オンライン専用。営業のQR配布用。製品版から手動コピーで更新） |

## 社内版はビルドで生成する（2026-08-14 以降のルール）

社内版は**製品版と同じコードを読み込む薄いラッパー**になった。2つある。

| 社内版 | 生成元 | 生成されるファイル |
|---|---|---|
| `/`（ケータイ） | `keitai-app/` | `index.html`・`sw.js`（本体は `keitai-app/` を読む） |
| `/ienaka/`（イエナカ単体） | `ienaka-app/` | `index.html`・`sw.js`・`manifest.webmanifest`（本体は `ienaka-app/` を読む） |

- 上記の生成ファイルは **`node tools/build-internal.js` が作る。直接編集しない**
- 社内版だけの違いはフラグ分岐に集約:
  - ケータイ … `keitai-app/app.js` の `INTERNAL`（`window.KEITAI_INTERNAL`）。店舗ログイン無し／localStorage 接頭辞 `dq-`／同期先 `settings/docomoQuoteStore`（ルートの `firebase-config.js`）／契約の器なし
  - イエナカ … `ienaka-app/app.js` の `INTERNAL`（`window.IENAKA_INTERNAL`）。ログイン無し／保存領域 `ienaka-hannan-*`
- 社内版どうし・製品版どうしでリンクと引き渡しが閉じている（`/` ⇄ `/ienaka/` は `dq-handoff-v1`、`/keitai-app/` ⇄ `/ienaka-app/` は `kq-handoff-v1`）
- つまり **修正はすべて `keitai-app/`・`ienaka-app/` に対して行えばよく、社内版は自動で同じになる。**
  生成元の `index.html`・`sw.js`・`manifest` を変えたときだけ `node tools/build-internal.js` を実行して生成物を作り直す

### イエナカ見積もり

- 修正は `/keitai-app/ienaka.js`（ケータイ内蔵）と `/ienaka-app/`（単体版）の両方に反映する（属性名などに差があるため機械的コピー不可）
- デモ版（`/ienaka-demo/`）は `ienaka-app/app.js` の写しなので、単体版を直したら同じ変更を入れる

## 出荷用（独自ドメイン版）はビルドで生成する

製品版は `frontalk.curacon.co.jp` から配信する。配信用リポジトリ（`frontalk`）の中身は
**`node tools/build-product.js`** が作る。**このリポジトリが原本。配信用は直接編集しない。**

| 出荷後のアドレス | 中身 |
|---|---|
| `/` | `keitai-app/`（ルートへ移す） |
| `/demo/` | `ienaka-demo/` |

- イエナカ単体版（`ienaka-app/`）は**出荷しない**（2026-08-20 販売方針）。
  阪南の社内版 `/ienaka/` の生成元としては残す。戻し方は `tools/build-product.js` 内のコメント

- 社内版・`tools`・`tests` は入らない。阪南の社内版は原本のまま動き続ける
- 社内文書（分配率・営業メモ・契約）は 非公開リポジトリ `docomo-quote-internal` にある。**このリポジトリは public なので書かない**
- `ocr/`（14MB）は `keitai-app/app.js` の `OCR_ON` が `true` のときだけ同梱
- 階層が変わるぶん相対パスを書き換えている（`tools/build-product.js` の `REWRITES`）。
  **書き換え漏れは本番でだけ404になる**ので、`keitai-app/index.html` や `ienaka-app/` の
  相対パスを触ったら `node tests/run-product-layout-test.js` で確認する（CI にも入っている）

## 配信先の引っ越し（2026-09-08〜・Cloudflare Pages へ）

配信先を GitHub Pages から Cloudflare Pages に移し、元ファイル（このリポジトリ）を非公開にする作業を進めている。
手順書・進み具合は非公開リポジトリ `docomo-quote-internal` の `migration/`。**ここには住所・名前・合鍵を書かない。**

| 配信単位 | 中身を作る道具 | 配信のしかた |
|---|---|---|
| 製品版（`frontalk.curacon.co.jp`） | `node tools/build-product.js` | CI の `deploy` ジョブ（`.github/workflows/ci.yml`）が、main のテストが**全部通ったあとだけ** Cloudflare へ配る |
| 社内版（阪南・常盤東） | `node tools/build-internal-dist.js`（**許可リスト方式**。要るファイルだけ） | 同上（別プロジェクト） |
| 旧・社内版の住所（github.io） | `node tools/build-oldsite-stub.js --old-path /docomo-quote/ [出力先]`（**新しい住所は入れない**。店内で伝える） | 「引っ越しました」の案内と、片付け用の sw.js を全入口に置く |

- 配信物には `404.html`・`_headers`・`version.json` が入る（`tools/lib/dist-extras.js`）。
  **Cloudflare Pages は `404.html` が無いと、無い住所にトップページを返す**（壊れが隠れる）ので必ず入れる。
  `_headers` に **Cache-Control は書かない**（既定の「毎回確かめる」が最良）。
- 配ったものは `node tools/check-live.js <住所> [--internal|--oldsite] [--expect <版>] [--commit <sha>]` で機械確認する
  （版・控え一覧・存在しない住所が404・道具や設計文書が読めない・転送・見出し）。
- 製品版は**許す住所の一覧**（`keitai-app/app.js` の `PROD_HOSTS`）以外で開くとログインを止める。
  `*.pages.dev` の試用の住所から本番のクラウドに入れないため。**独自ドメインを変えるときは、
  先に新しい名前を一覧に足した版を配ってから DNS を変える**（逆だと全店がログアウトされる）。
- 社内版だけの「引っ越し（住所の変更）」（マスタ設定 → バックアップの下）: 端末の中身（`dq-*`・`ienaka-internal-*`・
  `ienaka-hannan-*`）を**持ち出し → 持ち込み**で運ぶ。クラウドには書かない。製品版の開発コピー（`kq-*`）は運ばない。
  全端末が移ったら「旧アドレスを閉じる」で、クラウドの書類に `movedFrom`（閉じた旧住所の名前）を書き、その住所の端末の同期を止める。
  **社内版の新しい住所はクラウドにも旧住所の案内ページにも書かない**（社内版のクラウドの書類はログイン無しで誰でも読める）。
- **はじめて開く空の端末**は、クラウドの設定を受け取るまで中へ入れない（社内版の門）。イエナカ単体も、
  控え（fromCache）由来の「何も無い」では送らない。空の端末が圏外で開かれて白紙を全端末に配る事故を防ぐため
  （`tests/run-fresh-tests.js`）。
- `sh tools/release.sh --ship`（配信用 main へ直接 push）は**廃止**。引っ越しの間は `--pr`（配信用リポジトリの枝に入れて PR → マージ）。
  引っ越し後は CI の `deploy` に任せる。

## どのAIアシスタントで作業しても同じになるように

このアプリは、**クロコ（Claude Code）でもコーデックス（Codex）でも作業できる**ようにしてあります。
どちらか一方が止まっても、修正依頼を受けられる状態を保つためです（2026-09-06 の方針）。

- **`CLAUDE.md`（このファイル）と `AGENTS.md` は同じ中身です。**
  クロコは `CLAUDE.md` を、コーデックスは `AGENTS.md` を自動で読みます。
- `AGENTS.md` は **`node tools/build-agents.js` が `CLAUDE.md` から作ります。直接編集しないでください。**
  中身がズレていないかは CI と `tools/release-check.js` が見ています。
- 作業ルールを変えるときは `CLAUDE.md` を直し、`node tools/build-agents.js` を実行してください。

### 読む順番

1. `HANDOVER.md` … 経緯・現状・やってはいけないこと（初めて触るときは必ず）
2. `CLAUDE.md` / `AGENTS.md` … 作業ルールとリリース手順（このファイル）
3. 非公開リポジトリ `docomo-quote-internal` の `HANDOFF.md` … 最新の作業状況
   （**別リポジトリなので、そちらの読み取り権限が要ります**）

### 手元に無いと進まないもの

コードはこのリポジトリで完結していますが、次の2つは環境側の権限が要ります。

| やること | 要るもの |
|---|---|
| 配信（引っ越しの間: `sh tools/release.sh --pr`） | 配信用リポジトリ `frontalk` への書き込み権限（枝に push → PR） |
| 配信（引っ越し後: CI の `deploy`） | GitHub の Environment「production」の秘密（Cloudflare の合鍵と社内版の名前。**リポジトリにもチャットにも入れない**。Environment の枝制限は Private では Pro 以上でしか効かない） |
| 店舗の開通（`tools/provision-store.js`） | Firebase のサービスアカウント鍵（**リポジトリには絶対に入れない**） |

### これまでにやらかしたこと（同じ失敗を繰り返さないために）

新しく入る担当者・AIが最初に踏みやすいものを、実際に起きた順に並べています。

- **生成物を直接編集した** … ルートの `index.html`・`sw.js`、`/ienaka/` は `build-internal.js` が
  作ります。直すのは `keitai-app/`・`ienaka-app/`。
- **料金の表を平文に崩して読み、列を取り違えた**（2026-09-01・誤った内容を配信）
  → 公式ページの表は、**セルの結合（colspan/rowspan）まで構造で解析**して、
  列見出しと数値の対応を機械的に確かめること。**確信が持てない金額は書かない。**
- **`option` に `hidden` を付けて隠した**（2026-09-06・実機で122件出た）
  → **iPhone・iPad の Safari は `option` の `hidden` を無視します。**
  出さない選択肢は**一覧そのものから外す**こと。パソコンでは隠れて見えるので気づけません。
- **`@supports (-webkit-touch-callout: none)` の中の規則が効いていなかった**（2026-09-06）
  → `@supports` は強さを上げません。`.field select` のような**クラス付きの規則のほうが強い**ため、
  要素だけを指定した規則は負けます。Safari でしか効かない書き方は、
  **テスト側で同じ規則を当てて確かめる**こと（`tests/run-touch-tests.js` がその形です）。
- **同期で「どちらを採るか」を間違えて、見積もりが消えた**（2026-09-04・2026-09-06）
  → 同期まわり（`watchQuote` / `applyRemoteQuote`）を触る前に、
  `quoteAtLoaded`（開く前の時刻）と `store.gen`（お客様の区切り）の意味を必ず読むこと。
  `tests/run-sync-tests.js` に、これまでの事故がすべてケースとして入っています。
- **テストが「隠す指定」を見ていて、不具合が出ている間も通り続けた**（2026-09-06）
  → テストは**お客様の目に映るもの**（実際の一覧・実際の文字）を見ること。
  内部の印を見ると、実機で壊れていても素通りします。

### 直したら、必ず「わざと壊して落ちること」を確かめる

このリポジトリでは、不具合を直すたびに**対策を一時的に外してテストが落ちること**を確認しています。
落ちなければ、そのテストは何も見張っていません。

## リリース手順（共通）

1. 変更後 `node --check`・`node tests/run-calc-tests.js`・`node tests/run-bill-tests.js`・
   `node tests/run-ienaka-tests.js`（光・5G。統合版と単体版の一致も見る）・
   `node tests/run-master-update-tests.js`（料金表の配信・受付終了・改定予告）・
   `node tests/run-migrate-tests.js`（古い保存データの読み直し）・
   `node tests/run-wording-tests.js`（案内文が実在しない場所を指していないか）・
   `node tests/run-sync-tests.js`（端末どうしの同期で見積もりが消えないか）・
   `node tests/run-diag-tests.js`（調子が悪いときの情報・配信元）・
   `node tests/run-touch-tests.js`（iPad・iPhone で入力欄を触ると画面が拡大しないか）・
   `node tests/run-lines-tests.js`（回線5本・成約のときに数える回線・電卓・実績のCSV）・
   `node tests/run-device-master-tests.js`（端末マスタの取り込み。頭金・23回分を捨てていないか）・
   `node tests/run-template-tests.js`（テンプレに前のお客様の内容・古い金額が残らないか）・
   `node tests/run-fresh-tests.js`（空の端末が本番を白紙にしないか・引っ越し済みの合図）・
   `node tests/run-move-tests.js`（引っ越しの持ち出し・持ち込み）・
   `node tools/build-agents.js --check`（CLAUDE.md と AGENTS.md がズレていないか）・
   `node tests/run-product-layout-test.js`・`node tests/run-internal-layout-test.js`（社内版の配信物の入れ忘れ・入れすぎ）・
   `node tests/run-oldsite-stub-test.js`（旧住所の案内ページ）・Playwright で動作確認
   （`keitai-app/firestore.rules` を触ったときは `sh tools/test-rules.sh`、
   `tools/provision-store.js` を触ったときは `sh tools/test-provision.sh` も）
2. `keitai-app/app.js` の `APP_VERSION` と `keitai-app/sw.js` の `CACHE` を必ず両方上げ、`changelog.js` に1件足す
3. **`node tools/build-internal.js` を実行**してルートを再生成する（社内版のキャッシュ名も追従する）
4. `node tools/release-check.js`（版の一致・キャッシュ名・生成物の鮮度。CIでも見ています）
5. コミット → `git rebase --onto origin/main HEAD~N` → force-with-lease で push → PR作成 → squashマージ
6. 配信:
   - 引っ越しの間（配信元がまだ GitHub Pages のとき）:
     ```
     sh tools/release.sh          # テスト＋決まりの確認＋出荷用を作る（配信はしない）
     sh tools/release.sh --pr     # 配信用リポジトリの枝 release/v<版> に入れて push し、git tag v<版> を打つ
     ```
     そのあと frontalk で PR → CI → マージ（マージで公開される）。**配信用の main へ直接 push しない。**
   - 引っ越し後: main へのマージで CI の `deploy` が Cloudflare へ配る（手作業なし）
7. 公開されるまで確認してから完了報告する
   （`node tools/check-live.js https://frontalk.curacon.co.jp --expect <版>`）

**配った版を戻したいとき**は、タグから出荷用を作り直して配信用リポジトリへ入れ直します。
手順は非公開リポジトリ `docomo-quote-internal` の `OPERATIONS.md`。
