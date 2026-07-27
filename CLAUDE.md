# 作業ルール

## アプリ構成

| パス | 位置づけ |
|---|---|
| `/`（ルート） | ケータイ見積もり（社内利用） |
| `/ienaka/` | イエナカ見積もり **社内利用版**（開発はここで行う） |
| `/ienaka-app/` | イエナカ見積もり **製品版**（代理店向け販売用・自己完結） |

## 修正の反映先（重要）

- **どちらか明示がないイエナカの修正依頼は `/ienaka/`（社内版）にのみ反映する。**
  開発段階のため、`/ienaka-app/` は勝手に触らない。
- **「製品版」と明示された依頼は `/ienaka-app/` に反映する。**
- 社内版の内容が固まったら、依頼を受けてから製品版へまとめて同期する。

## 製品版へ同期するときの差分（意図的に異なる箇所・同期時も維持すること）

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
