# 作業ルール

> **このリポジトリを初めて触る場合は、先に `HANDOVER.md`（引き継ぎ指示書）を読んでください。**
> 経緯・現状・やってはいけないことがまとまっています。

## アプリ構成

| パス | 位置づけ |
|---|---|
| `/`（ルート） | ケータイ見積もり **社内利用版**（阪南店の日常業務用・開発はここで行う） |
| `/keitai-app/` | ケータイ見積もり **製品版**（代理店向け販売用・自己完結） |
| `/ienaka/` | イエナカ見積もり **社内利用版**（開発はここで行う） |
| `/ienaka-app/` | イエナカ見積もり **製品版**（代理店向け販売用・自己完結） |
| `/ienaka-tiles/` | タイル式UIの試作（イエナカ製品版のコピー＋`tiles.js`） |

## 修正の反映先（重要）

- **どちらか明示がない修正依頼は、社内版にのみ反映する。**
  - ケータイ見積もりの依頼 → ルート（`app.js` / `index.html` / `data.js` / `style.css`）
  - イエナカの依頼 → `/ienaka/`
  ケータイ見積もりは社内版と製品版の中身が揃っているため、片方を直したらもう一方にも反映する（差分は下記）。
- **「製品版」と明示された依頼は、対応する製品版フォルダに反映する。**
- 社内版の内容が固まったら、依頼を受けてから製品版へまとめて同期する。

## 製品版へ同期するときの差分（意図的に異なる箇所・同期時も維持すること）

### ケータイ見積もり（`/keitai-app/` ⇄ ルート）

2026-07-28 に、社内版（ルート）を製品版の内容で置き換えた。**中身は同じで、ルートはログインの仕組みだけ外してある。**
どちらかを直したらもう一方へも反映すること。同期時に上書きしてはいけない差分は次のとおり。

1. `app.js`
   - `APP_VERSION` … 製品版は `1.x.y`、社内版は日付採番（`2026.07.28-72`）
   - 保存領域は必ず分ける（**同じドメインに同居するため**）
     製品版 `kq-*` / 社内版 `dq-*`（`MASTER_KEY` `STATE_KEY` `CFG_KEY` `TPL_KEY` `SAVED_KEY` `HIST_KEY` `STORE_UID_KEY`）
   - 社内版はログインの仕組みを使わない。関数は残したまま入口だけ閉じている
     `lockEnabled()` `adminLockEnabled()` `anyStaffCode()` `masterGateOn()` … すべて `false` を返す
     `armIdle()` … 何もしない（自動ログアウトなし）
     `initCloud()` … Firebase Auth を使わず Firestore を直接使う
     `storeDoc()` … 製品版 `stores/{UID}` / 社内版 `settings/docomoQuoteStore`
     `cloudOn()` … 社内版は `CLOUD.syncOn`（ヘッダの「同期OFF」）で判定
   - 社内版はヘッダの担当者セレクタ（`#staffSelect` / `renderStaffSelect()` / `initStaffSelect()`）で担当を切り替える
   - 社内版の `config.staff` 初期値は 担当A/B/C（旧・同期グループと同じ考え方）
   - 社内版の「情報」は提供元・規約を出さない（代理店向けの文書は製品版のみ）
   - **社内版の旧キー（`dq-master-v2` / `dq-state-v1`）からの移行処理は製品版に持ち込まない**
2. `index.html`
   - 社内版のみ … イエナカ見積もりへのリンク（`.app-link`）、`#staffSelect`、タブに「マスタ設定」
   - 製品版のみ … `#staffBar` `#switchStaffBtn` `#logoutBtn`、「情報」の規約リンク（`.about-links`）
   - ログイン用のオーバーレイ（`#loginOverlay` `#staffOverlay` `#masterGate`）は**両方のHTMLに残してある**。社内版では表示されないだけ
3. `changelog.js` … 版の付け方が違うので共有しない（それぞれ別内容）
4. `firebase-config.js`
   - 製品版 … `keitai-quote` プロジェクト＋ `KEITAI_VENDOR` `KEITAI_STORE_DOMAIN`
   - 社内版 … `recipe-box-bd642`（レシピアプリと共用）
5. `data.js`
   - 製品版 … ドコモ商材のみ（店舗独自は各店舗が登録する）
   - 社内版 … 阪南店の独自商材（コネクトα・ハルトコーティング・photocube など）を含む
6. `sw.js`（製品版 `kq-v*` / 社内版 `dq-v*`）、`manifest.webmanifest`、`icon.svg`、`README.md`、`firestore.rules`、
   `TERMS.md` `LICENSE.md` `SUPPORT.md` は製品版専用。社内用の手順書は `_internal/`（GitHub Pages では公開されない）
7. `style.css` … 共通（そのままコピーでよい）

### イエナカ見積もり（`/ienaka/` → `/ienaka-app/`）

`ienaka-app/` は `ienaka/` のコピーではなく、以下の点を変えている。同期時はこれらを上書きしないこと。

1. `app.js`（社内版の `ienaka.js` に相当）
   - `APP_VERSION` は製品版の採番（`1.0.0` 系）。社内版の日付採番は持ち込まない
   - `KEY = "ienaka-app-v1"`（保存領域を分離）
   - 見積書の注記: 「※ ドコモ光／home 5G セット割は、ご家族のスマホ料金から割引されます（本見積もりの月額には含まれません）。」
2. `index.html`
   - ケータイ見積もりへのリンク（`.app-link`）なし
   - `manifest.webmanifest` / `icon.svg` / `theme-color` を読み込む
   - スタイルは `style.css` 1枚、スクリプトは `app.js`、Service Worker は同フォルダの `sw.js`
   - ⑤末尾の注記とメモ欄プレースホルダーが単体アプリ向けの文言
3. `style.css` = ルートの `style.css` ＋ `ienaka/ienaka.css` を連結したもの（この順序を守る）
4. `sw.js`（`CACHE = "ienaka-v1"` 系・アセットは同フォルダのみ）、`manifest.webmanifest`、`icon.svg`、`README.md` は製品版専用

## リリース手順（共通）

1. 変更後 `node --check` と Playwright で動作確認
2. `APP_VERSION` と `sw.js` の `CACHE` を必ず両方上げる（端末の自動更新に使われる）
3. コミット → `git rebase --onto origin/main HEAD~N` → force-with-lease で push → PR作成 → squashマージ
4. GitHub Pages に新バージョンが出るまで確認してから完了報告する
