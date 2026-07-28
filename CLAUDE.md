# 作業ルール

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
  開発段階のため、製品版（`/keitai-app/`・`/ienaka-app/`）は勝手に触らない。
- **「製品版」と明示された依頼は、対応する製品版フォルダに反映する。**
- 社内版の内容が固まったら、依頼を受けてから製品版へまとめて同期する。

## 製品版へ同期するときの差分（意図的に異なる箇所・同期時も維持すること）

### ケータイ見積もり（ルート → `/keitai-app/`）

`keitai-app/` はルートのコピーに以下の変更を加えている。同期時はこれらを上書きしないこと。

1. `app.js`
   - `APP_VERSION` は製品版の採番（`1.0.0` 系）。社内版の日付採番は持ち込まない
   - `MASTER_KEY = "kq-master-v1"` / `STATE_KEY = "kq-state-v1"`（**同じドメインに社内版が同居するため必須**）
   - `SYNC_GROUP_KEY = "kq-sync-group"` / `syncMsKey()` / `MASTER_MS_KEY = "kq-master-sync-ms"`
   - Firestoreのドキュメントは `settings/keitaiQuote〔A|B|C〕` と `settings/keitaiQuoteMaster`
   - **社内版の旧キー（`dq-master-v2` / `dq-state-v1`）からの移行処理は削除している**。
     同一ドメインに社内版のデータが残っているため、拾うと阪南店のデータを引き継いでしまう
2. `index.html` — イエナカ見積もりへのリンク（`.app-link`）なし
3. `firebase-config.js` — 空の雛形（`KEITAI_FIREBASE`）。**レシピアプリと共用の `recipe-box-bd642` は使わない**
4. `sw.js`（`CACHE = "kq-v1"` 系）、`manifest.webmanifest`、`icon.svg`、`README.md`、`SETUP.md`、`firestore.rules` は製品版専用
5. `data.js` / `style.css` はルートと同一（同期時はそのままコピーでよい）

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
