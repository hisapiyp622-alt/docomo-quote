# 引き継ぎ指示書（2026-08-16 時点）

新しいセッションはこの1枚を読めば作業を続けられます。
あわせて `CLAUDE.md`（作業ルール）と `_internal/SYNC_DIFF.md`（社内版との違い）を読んでください。

---

## 0. まず知っておくこと

- 開発者は**安藤久詞**（ドコモショップ阪南店）。販売は**株式会社Curacon**（営業担当: 小川さん、代表取締役: 山口 直）
- 製品名は**ミツモリン**（料金見積もりシミュレーション）。GitHub Pages で配信
- 作業ブランチは **`claude/docomo-estimate-print-layout-tbeyi6`**。main へ直接 push しない
- ユーザーへの回答は**日本語**。店舗の方が読む文章は、仕組みではなく「何ができるか」で書く

---

## 1. いまの版（2026-08-16）

| アプリ | パス | 版 | キャッシュ |
|---|---|---|---|
| 製品版ケータイ（ミツモリン） | `keitai-app/` | **1.108.0** | kq-v213 |
| 社内版ケータイ | `/`（生成物） | 同上 | dq-v213 |
| 製品版イエナカ単体 | `ienaka-app/` | **2.6.8** | ienaka-v23 |
| 社内版イエナカ単体 | `ienaka/`（生成物） | 同上 | ienaka-internal-v23 |
| デモ版イエナカ | `ienaka-demo/` | **2.6.8-demo** | （SWなし） |

料金マスタの版 `masterVersion` は **6**（配信するときだけ +1）。

---

## 2. 構成（2026-08-14 に大きく変えた）

**社内版は製品版から生成する薄いラッパーになりました。手作業の同期は廃止です。**

| 社内版 | 生成元 | 生成されるファイル |
|---|---|---|
| `/`（ケータイ） | `keitai-app/` | `index.html`・`sw.js` |
| `/ienaka/`（イエナカ単体） | `ienaka-app/` | `index.html`・`sw.js`・`manifest.webmanifest` |

- 生成コマンド: **`node tools/build-internal.js`**（生成物は直接編集しない）
- 社内版の違いはフラグ分岐に集約
  - ケータイ … `keitai-app/app.js` の `INTERNAL`（`window.KEITAI_INTERNAL`）。ログイン無し／localStorage 接頭辞 `dq-`／同期先 `settings/docomoQuoteStore`／契約の器なし
  - イエナカ … `ienaka-app/app.js` の `INTERNAL`（`window.IENAKA_INTERNAL`）。ログイン無し／保存領域 `ienaka-internal-*`／同期先 `settings/ienakaInternalStore`
  - デモ版 … `DEMO`（`window.IENAKA_DEMO`）。保存領域 `ienaka-demo-*`・引き渡しを受け取らない・同期なし
- **修正は `keitai-app/` と `ienaka-app/` に入れれば、社内版へ自動で反映されます**
- デモ版（`ienaka-demo/app.js`）は `ienaka-app/app.js` の写し。単体版を直したら**同じ変更をデモにも入れる**

---

## 3. リリース手順（必ずこの順で）

1. `keitai-app/` または `ienaka-app/` を修正
2. `node --check`（変更した全JS）・`node tests/run-calc-tests.js`（32件）・Playwright で確認
3. `keitai-app/app.js` の `APP_VERSION` と `keitai-app/sw.js` の `CACHE` を**両方**上げ、`changelog.js` の先頭に1件足す
   （イエナカを直したときは `ienaka-app/app.js` の版と `ienaka-app/sw.js` の CACHE、デモ版の版も）
4. **`node tools/build-internal.js`** を実行して生成物を作り直す
5. ブランチを main から切り直して commit → push → PR（draft→ready）→ squash マージ
6. GitHub Pages に新しい版が出るまで curl で確認してから完了報告

**push の定型**（force-with-lease が "stale info" で落ちるため）:
```
git fetch origin <branch>; R=$(git rev-parse FETCH_HEAD)
git push --force-with-lease=<branch>:$R -u origin <branch>
```
PR は `mcp__github__*` を使う（`gh` は使えない）。コミット・PRに**モデル名を書かない**（`Co-Authored-By: Claude Opus 5` は可）。

---

## 4. 絶対に守ること

- **お客様名（custName）は端末内のみ**。クラウド送信・バックアップ・引き渡し・デモ版のどれにも出さない
  （`quotePayload` / `pushSaved` / `buildBackup` / `forwardSaved` で除去。`wonData.patterns[].custName` も忘れない）
- **営業の禁句**（`_internal/SALES.md`）: 「ドコモ公式」と言わない／金額は概算／見積書の注記は消さない／補助金は断定しない
- 独自商材のリンクの小窓は「ページを開く」（公式と書かない）
- 出荷ファイル（`keitai-app/` `ienaka-app/` `ienaka-demo/`）に**社内の店舗名（阪南など）を書かない**
- 料金は**一次情報で確認**してから入れる（URLは HTTP 200 を確認したものだけ）

---

## 5. 未処理・待ちの案件（優先順）

> **解決済み（2026-08-16）: Firestore ルールの修正。**
> 社内版の同期不具合の根本原因だった。recipe-box の旧ルールは `match /settings/{document}` で
> **サブコレクションに効いておらず**、`quotes/` `saved/` `templates/` が同期されなかった。
> ユーザーがコンソールで適用済み。**再着手しないこと。**
> 同期が怪しいときの切り分けは `_internal/SYNC_DIFF.md` の「社内版の同期先」を見る。

### ① Blaze（Firestore の自動バックアップ）— 待ち
- 小川さんが**山口社長に確認中**。こちらから催促しない
- 承認が出たら: Blaze切替（カード登録はユーザー操作）→ 日次バックアップ・PITR・予算アラートを設定
- 費用は7店舗規模で月100〜300円の見込み
- 期限の目安は「最初のお試し店舗にデータが入る前」

### ② 販売店契約の締結（安藤 ⇔ Curacon）
`_internal/CONTRACT_CURACON.md`。条件は確定済み:
- 秘密保持3年・自動更新の申し出2か月前・是正30日
- 月額: 管理費10%控除後の残りを50/50・翌月末払い
- 初期費用: **甲（安藤さん）へ1店舗あたり30,000円の固定額**（乙が値付けを変えても不変）
- 残: 別紙②サポート分担表・弁護士レビューの判断・締結
- **締結日と甲住所はファイルに書かない**（リポジトリが公開のため。締結時の紙に直接記入）

### ③ 器の移管（販売開始前が期限）
- 独自ドメインの取得（Curacon名義推奨）→ 決まればCNAME設定と移行手順書を作る
- Firebase（`keitai-quote`）に Curacon の Google アカウントをオーナー追加
- GitHub の権限付与
- **URL変更は1店舗目を売ったあとにはできない**（各店舗のPWAデータが切れる）

### ④ `_internal/` を非公開リポジトリへ移す（ユーザー作業待ち）
リポジトリが public なので分配率・営業メモが誰でも読める。
ユーザーが `docomo-quote-internal`（**Private**）を作ったら、こちらで移動・参照の書き換えを行う。
（このセッションのGitHub連携にはリポジトリ作成権限が無い）

### ⑤ 販売開始前のFirebaseチェックリスト（`_internal/OPERATIONS.md`）
1. セルフサインアップの停止（最優先・無料）
2. `keitai-app/firestore.rules` の最新をコンソールへ貼る（**契約の器の検査が入っている**）
3. 日次バックアップ（①のあと）

### ⑥ カメラ読み取り（アプリ内OCR）の精度 — 保留
1.106.0 で入れたが、紙の請求書での精度が実用に足りず 1.108.0 で**切った**
（`keitai-app/app.js` 先頭の `var OCR_ON = false;`）。

- **戻すのはこの1行を `true` にするだけ**。部品（`keitai-app/ocr/`・約14MB・Apache-2.0）と
  処理（`ocrRecognize` / `ocrPrepImage` / `#curBillCam`）は消していない
- 切っている間は部品を読み込まない（通信なし・SWの事前キャッシュにも入れていない）
- **そのまま戻しても精度は変わらない。** 撮影前の二値化、読み取る範囲の指定、
  traineddata を best にする、などの案は `keitai-app/ocr/README.md` に書いてある
- 貼り付け（iPadの「テキストをスキャン」・写真からのコピー）は切っていても使える

### ⑦ そのほか
- 「ミツモリン」の**商標確認**（J-PlatPat）が未実施
- 提案書の「WHO WE ARE」（会社紹介）は小川さんから内容待ち
- キッズケータイプランのハーティ割引額が不明

---

## 6. 2026-08-14 に入れた主な変更（経緯を知るため）

- **社内版の統一**（1.100.1）: 生成方式へ。旧データ（`dq-*-v3`）は初回起動で新キーへ引っ越し
- **契約の器**（1.100.0）: `contracts/{店舗UID}` で trial/active/suspended を管理。アプリからは読み取り専用
- **店舗共通テンプレート**（1.100.0）: 担当ごとの3枠に加えて店舗共通3枠
- **同期の事故と修正**（1.101.1〜1.101.3）: 詳細は下の「教訓」
- **独自商材の説明**（1.100.6・1.101.0）: リンク先・複数行のご案内文・**写真**（長辺900pxへ自動縮小・マスタ全体700KB上限）
- **実績の数え方**（1.100.4・1.102.1）: 端末購入なしは機種を数えない／手続き未選択の回線は回線1の手続きで数える
- **残価の手続き別対応**（1.102.0）: 端末マスタに「MNPのとき」「新規のとき」の23回分の総額
- **電卓**（1.103.0〜1.103.3）: ヘッダーから常時開ける・2/3サイズ・ドラッグ移動・位置を記憶
- **省電力**（1.104.0）: 画面を離れている間は購読と見張りを止める。同じ内容は送らない
- **デモ版の隔離**（2.6.7-demo）: 保存領域を分け、引き渡しも受け取らない（実店舗名・お客様名が出ていた）

---

## 7. 教訓（同じ失敗を繰り返さない）

1. **クラウドの内容で端末を上書きする処理は、必ず「どちらが新しいか」を見る。**
   1.101.1 で入れた時刻判定は、起動時の自動保存で時刻が更新されることを見落とし、
   **空の端末が他端末の見積もりを消す**退行を招いた（1.101.3 で修正）。
   判定には「開く前の時刻」を使い、**中身がある端末だけが優先を主張する**
2. **同一オリジンに複数アプリが同居している。** localStorage のキーとキャッシュ名の接頭辞は
   アプリごとに必ず分ける（デモ版に実店舗のデータが出た事故の原因）
3. **書き込みが拒否され読み取りだけ通る状態**は、症状が「消える」として出る。
   権限エラーは画面上部に出すようにした（`#cloudWarn`）
4. **担当ごとにデータを分けている**ため、担当者一覧が変わると「消えた」ように見える。
   中身がある担当は一覧から落とさない
5. 実装したら**必ず Playwright で再現・検証**してからリリースする。
   リリース版でバグを再現 → 修正版で解消、まで見せると確実

---

## 8. 動作確認の型（Playwright）

```js
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: {width:1180, height:820} });
await p.route('**/*', async r => {
  const u = r.request().url();
  if (u.includes('gstatic.com')) return r.fulfill({status:200, contentType:'application/javascript', body:''});
  if (u.endsWith('firebase-config.js')) return r.fulfill({status:200, contentType:'application/javascript', body:''});
  return r.continue();
});
// localStorage に config を入れてから reload。ツアーは削除する
```
- ローカル配信: `cd /workspace/docomo-quote && python3 -m http.server 8899`
- クラウドの検証は**模擬Firestore**を addInitScript で差し込む。
  localStorage に持たせるとページを再読み込みしても残るので「別端末」「開き直し」を試せる
- 画面を隠す検証は `document.hidden` と `document.visibilityState` の**両方**を差し替える

---

## 9. 参照する文書

| 文書 | 中身 |
|---|---|
| `CLAUDE.md` | 作業ルール・アプリ構成・リリース手順 |
| `_internal/SYNC_DIFF.md` | 社内版・製品版・デモ版の違い、同期先、必要なルール |
| `_internal/OPERATIONS.md` | 店舗の追加・停止・契約の器・料金改定の配り方・バックアップ |
| `_internal/CURACON_TODO.md` | クラコン（小川さん）側のやることリスト |
| `_internal/SALES.md` | 営業向け（禁句・価格・話せること） |
| `_internal/CONTRACT_CURACON.md` | 販売店契約のたたき台 |
| `_internal/APPLICATION_FORM.md` | 店舗に出す申込書 |
| `keitai-app/STATS_GUIDE.md` | 実績の使い方（店舗の方が読む） |
