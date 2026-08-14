# 作業ルール

> **このリポジトリを初めて触る場合は、先に `HANDOVER.md`（引き継ぎ指示書）を読んでください。**
> 経緯・現状・やってはいけないことがまとまっています。

## アプリ構成

| パス | 位置づけ |
|---|---|
| `/keitai-app/` | ケータイ見積もり **製品版**（代理店向け販売用・自己完結）。**開発はここだけで行う** |
| `/`（ルート） | ケータイ見積もり **社内版**（阪南店の日常業務用）。**生成物・直接編集しない**（下記） |
| `/ienaka-app/` | イエナカ見積もり **製品版**（代理店向け販売用・自己完結。ケータイ製品版の光・5Gタブとは3重管理） |
| `/ienaka/` | イエナカ見積もり 旧・社内単体版（ルートの旧ブックマーク用に残置。原則触らない） |
| `/ienaka-tiles/` | タイル式UIの試作（凍結） |
| `/ienaka-demo/` | イエナカ **デモ版**（ログイン不要・オンライン専用。営業のQR配布用。製品版から手動コピーで更新） |

## 社内版はビルドで生成する（2026-08-14 以降のルール）

社内版（ルート）は**製品版と同じコードを読み込む薄いラッパー**になった。

- ルートの `index.html` と `sw.js` は **`node tools/build-internal.js` が生成する。直接編集しない**
- `app.js`・`style.css`・`data.js` などの本体はルートに存在せず、`keitai-app/` のものをそのまま読み込む
- 社内版だけの違いは `keitai-app/app.js` の **`INTERNAL` フラグ分岐**（`window.KEITAI_INTERNAL`）に集約:
  店舗ログイン無し／localStorage 接頭辞 `dq-`／同期先 `settings/docomoQuoteStore`（recipe-box プロジェクト・ルートの `firebase-config.js`）
- つまり **ケータイ見積もりの修正はすべて `keitai-app/` に対して行えばよく、社内版は自動で同じになる。**
  `keitai-app/index.html` か `sw.js` を変えたときだけ、`node tools/build-internal.js` を実行してルートを作り直してコミットする

### イエナカ見積もり

- 修正は `/keitai-app/ienaka.js`（ケータイ内蔵）と `/ienaka-app/`（単体版）の両方に反映する（属性名などに差があるため機械的コピー不可）
- デモ版（`/ienaka-demo/`）は単体版更新時に指示があれば同期する

## リリース手順（共通）

1. 変更後 `node --check`・`node tests/run-calc-tests.js`・Playwright で動作確認
2. `keitai-app/app.js` の `APP_VERSION` と `keitai-app/sw.js` の `CACHE` を必ず両方上げ、`changelog.js` に1件足す
3. **`node tools/build-internal.js` を実行**してルートを再生成する（社内版のキャッシュ名も追従する）
4. コミット → `git rebase --onto origin/main HEAD~N` → force-with-lease で push → PR作成 → squashマージ
5. GitHub Pages に新バージョンが出るまで確認してから完了報告する
