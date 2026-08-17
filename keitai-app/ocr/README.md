# ocr/ — カメラ読み取りの部品（同梱ライブラリ）

「現在のお支払い」カードの**カメラ読み取り**が使う、端末内OCRの部品です。
撮った写真はこの部品で端末の中だけで文字にし、外部への送信はありません。

## いまは切ってある（2026-08-16）

紙の請求書での**読み取り精度が実用に足りなかった**ため、機能をいったん切っています。
文字や金額の誤認が多く、直す手間が手入力より大きくなっていました。
貼り付け（iPadの「テキストをスキャン」・写真からのコピー）はそのまま使えます。

### 戻し方

`keitai-app/app.js` の**先頭にある1行を `true` にするだけ**です。

```js
var OCR_ON = false;   // ← true にするとカメラ読み取りが出る
```

これだけで「カメラで読み取る」ボタン・カメラ向けの案内文・ヘルプの文面が戻ります
（つないでいる処理 `ocrRecognize` / `ocrPrepImage` / `#curBillCam` は消していません）。
リリース手順は通常どおり（版・CACHE を上げ、changelog に1件、`node tools/build-internal.js`）。

**切っている間、この部品は一切読み込まれません**（通信も発生しません）。
Service Worker の事前キャッシュにも入れていないので、店舗の端末に配られることもありません。

### 戻す前に検討する「精度を上げる案」

そのまま戻しても精度は変わりません。次のどれかと組み合わせるのが前提です。

1. **撮影前の画像処理**（実装が軽い・効果は中）
   グレースケール化 → コントラスト強調 → 二値化（大津の方法など）を
   `ocrPrepImage` の canvas に足す。感熱紙・薄い印字にはこれが一番効く
2. **読み取る範囲をユーザーに選ばせる**（効果は大）
   撮った写真を表示して、「項目名と金額」の表の部分だけを枠で囲ってもらう。
   宛名・注記・広告が混ざらなくなるので誤認が大きく減る
3. **traineddata を fast → best に替える**（効果は中・重い）
   `jpn.traineddata` を [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) の
   ものにする。2.4MB → 13.7MB になり、解析も数倍遅くなる
4. **数字だけの読み取りを別に走らせる**（効果は中）
   金額の列だけ `tessedit_char_whitelist` を数字とカンマに絞って2回目を走らせ、
   金額の精度を上げる（項目名は日本語のまま）
5. **PaddleOCR（PP-OCRv5）への差し替え**（効果は大・重い）
   日本語精度は明確に上だが、合計25〜40MB＋前後処理の自作が必要

いずれにしても、読み取り結果は**必ず人が確認して直す**前提の入力補助です
（行リストの編集と、合計行とのズレの⚠はそのために付けてあります）。

## 中身

| ファイル | 出どころ | 版 |
|---|---|---|
| `tesseract.min.js` / `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 |
| `tesseract-core-*-lstm.wasm.js`（3種） | [tesseract.js-core](https://github.com/naptha/tesseract.js) | 7.0.0（simd／relaxedsimd／無印を端末に合わせて自動選択） |
| `jpn.traineddata` | [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) | 日本語（fast） |

- ライセンスはいずれも Apache-2.0（`LICENSE.tesseract.txt`）
- **手で編集しない**。更新するときは同じ配布元から同じファイル名で差し替える
- 消さないこと（消すと上の「戻し方」が1行では済まなくなる）
