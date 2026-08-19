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
| `/ienaka-app/` | イエナカ見積もり **製品版**（代理店向け販売用・自己完結。ケータイ製品版の光・5Gタブとは3重管理） |
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
| `/ienaka-app/` | `ienaka-app/` |
| `/demo/` | `ienaka-demo/` |

- 社内版・`tools`・`tests` は入らない。阪南の社内版は原本のまま動き続ける
- 社内文書（分配率・営業メモ・契約）は 非公開リポジトリ `docomo-quote-internal` にある。**このリポジトリは public なので書かない**
- `ocr/`（14MB）は `keitai-app/app.js` の `OCR_ON` が `true` のときだけ同梱
- 階層が変わるぶん相対パスを書き換えている（`tools/build-product.js` の `REWRITES`）。
  **書き換え漏れは本番でだけ404になる**ので、`keitai-app/index.html` や `ienaka-app/` の
  相対パスを触ったら `node tests/run-product-layout-test.js` で確認する（CI にも入っている）

## リリース手順（共通）

1. 変更後 `node --check`・`node tests/run-calc-tests.js`・`node tests/run-bill-tests.js`・
   `node tests/run-product-layout-test.js`・Playwright で動作確認
2. `keitai-app/app.js` の `APP_VERSION` と `keitai-app/sw.js` の `CACHE` を必ず両方上げ、`changelog.js` に1件足す
3. **`node tools/build-internal.js` を実行**してルートを再生成する（社内版のキャッシュ名も追従する）
4. コミット → `git rebase --onto origin/main HEAD~N` → force-with-lease で push → PR作成 → squashマージ
5. GitHub Pages に新バージョンが出るまで確認してから完了報告する
