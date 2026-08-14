# 作業ルール

> **このリポジトリを初めて触る場合は、先に `HANDOVER.md`（引き継ぎ指示書）を読んでください。**
> 経緯・現状・やってはいけないことがまとまっています。

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

## リリース手順（共通）

1. 変更後 `node --check`・`node tests/run-calc-tests.js`・Playwright で動作確認
2. `keitai-app/app.js` の `APP_VERSION` と `keitai-app/sw.js` の `CACHE` を必ず両方上げ、`changelog.js` に1件足す
3. **`node tools/build-internal.js` を実行**してルートを再生成する（社内版のキャッシュ名も追従する）
4. コミット → `git rebase --onto origin/main HEAD~N` → force-with-lease で push → PR作成 → squashマージ
5. GitHub Pages に新バージョンが出るまで確認してから完了報告する
