# 社内版と製品版の違い（2026-08-14 全面改訂）

**手作業での同期は廃止しました。** 社内版は `tools/build-internal.js` が
製品版から生成する薄いラッパーで、本体コードは製品版のファイルをそのまま読み込みます。
修正は製品版（`keitai-app/`・`ienaka-app/`）にだけ入れれば、社内版は自動で同じになります。

| 社内版 | URL | 生成元 |
|---|---|---|
| ケータイ見積もり | `/` | `keitai-app/` |
| イエナカ見積もり（単体） | `/ienaka/` | `ienaka-app/` |

## 意図的に異なる箇所（すべて INTERNAL フラグと生成物に集約）

| 項目 | 製品版 | 社内版 |
|---|---|---|
| 店舗ログイン | 店舗ID＋パスワード（Firebase Auth） | 無し（開いたら担当者から） |
| localStorage 接頭辞 | `kq-` | `dq-`（旧データは初回に v3→v1 へ自動引っ越し・旧キーは残す） |
| 同期先 | `keitai-quote` プロジェクト `stores/{uid}` | `recipe-box` プロジェクト `settings/docomoQuoteStore`（認証なし・従来どおり） |
| firebase-config.js | `keitai-app/` の製品用 | ルートの社内用（このファイルだけ手書き） |
| 契約の器（お試し・停止） | あり | 無し（INTERNAL では読まない） |
| マスタ設定の関門 | クラウド利用時は店舗パスワード | 掛けない（従来どおり素通し。adminLock を設定すれば掛かる） |
| 自動ログアウト | ロック/クラウド利用時にあり | 無し |
| キャッシュ名 | `kq-vNNN` | `dq-vNNN`（ビルドが製品版の番号に追従） |

- 分岐の実体は `keitai-app/app.js` 冒頭の `INTERNAL` / `NS` と、`initCloud`・`storeDoc`・
  `masterGateOn`・`afterStoreLogin`・`fetchContract` の各分岐だけ。これ以外に差はない
- 担当の切り替えも製品版と同じ**担当者コード方式**になった（コード未設定の担当は名前タップで入れる。
  全員未設定だと「担当切替」はマスタ設定へ誘導するので、コードか名前入りの担当者を登録しておくこと）

## イエナカ単体版（`/ienaka/` ＝ 社内版 ／ `/ienaka-app/` ＝ 製品版）

| 項目 | 製品版 | 社内版 |
|---|---|---|
| ログイン | 店舗アカウント（Firebase Auth） | 無し |
| 端末間同期 | 店舗アカウントの `stores/{uid}` | **あり**。`recipe-box` の `settings/ienakaInternalStore`（認証なし・ルートの `firebase-config.js` を共用） |
| 保存領域 | `ienaka-app-v1` / `ienaka-app-config-v1` | `ienaka-internal-v1` / `ienaka-internal-config-v1` |
| キャッシュ名 | `ienaka-vNN` | `ienaka-internal-vNN` |
| 「← ケータイ見積もり」 | `/keitai-app/`（製品版） | `/`（社内版） |

### 社内版の同期先（recipe-box プロジェクト）

| アプリ | ドキュメント | 中身 |
|---|---|---|
| ケータイ（`/`） | `settings/docomoQuoteStore` | 店舗名・担当者・料金マスタ ＋ サブコレクション `quotes/{担当ID}`・`saved/{担当ID}`・`templates/{担当ID}`・`templates/_store`・`history/{id}` |
| イエナカ（`/ienaka/`） | `settings/ienakaInternalStore` | 店舗名・担当者 ＋ サブコレクション `quotes/{担当ID}` |

**お客様名はどちらも送りません**（端末内だけ）。

ヘッダーの表示が「同期:権限エラー」になるときは、recipe-box の Firestore ルールで
`settings/` 配下が許可されていません。Firebaseコンソール → Firestore Database → ルールに
次を足してください（社内版は認証を使わないため、この2つのドキュメントだけを開けます）。

```
match /settings/{doc} {
  allow read, write: if doc == 'docomoQuoteStore' || doc == 'ienakaInternalStore';
  match /{sub}/{id} {
    allow read, write: if doc == 'docomoQuoteStore' || doc == 'ienakaInternalStore';
  }
}
```

> **注意（社内版だけの割り切り）**: 認証なしで読み書きするため、プロジェクトIDを知る第三者が
> 触れる可能性があります。阪南店の運用データ（お客様名を含まない）に限る前提です。
> 製品版（`keitai-quote`）は店舗アカウントのログインが必須で、この構成とは無関係です。

- 分岐の実体は `ienaka-app/app.js` 冒頭の `INTERNAL`（`KEY` / `CFG_KEY` / `HANDOFF_KEY`）だけ
- **社内版と製品版でデータは混ざらない。** 同一オリジンだが保存キーが別
- ケータイ⇄イエナカの引き渡し（店舗名・担当者名・お客様名）も系統ごとに閉じている:
  社内版どうしは `dq-handoff-v1`、製品版どうしは `kq-handoff-v1`
- 旧・社内単体イエナカ（手書きの `/ienaka/ienaka.js`）は 2026-08-14 に廃止。
  同じURLに生成版が入ったので、店舗のブックマーク・ホーム画面はそのまま使える

## デモ版（`/ienaka-demo/`）

営業でお客さまにお見せするデモです。**実際の店舗の内容が出ないよう、次の2つで隔離しています。**

- 保存領域は `ienaka-demo-v1` / `ienaka-demo-config-v1`（製品版・社内版と別）。
  同じサイトに同居しているため、保存名が同じだと**実店舗で使った内容がデモに出ます**（2026-08-14 に発生）
- ケータイ見積もりからの引き渡し（店舗名・担当者名・**お客様名**）を受け取らない
- Firebase の設定を持たないので同期もしない（端末内だけ・開くたびに白紙に近い状態）
