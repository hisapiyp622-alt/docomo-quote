# ocr/ — カメラ読み取りの部品（同梱ライブラリ）

「現在のお支払い」カードの**カメラ読み取り**が使う、端末内OCRの部品です。
撮った写真はこの部品で端末の中だけで文字にし、外部への送信はありません。

| ファイル | 出どころ | 版 |
|---|---|---|
| `tesseract.min.js` / `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 |
| `tesseract-core-*-lstm.wasm.js`（3種） | [tesseract.js-core](https://github.com/naptha/tesseract.js/tree/master/src/worker-script) | 7.0.0（simd／relaxedsimd／無印を端末に合わせて自動選択） |
| `jpn.traineddata` | [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) | 日本語（fast） |

- ライセンスはいずれも Apache-2.0（`LICENSE.tesseract.txt`）
- **手で編集しない**。更新するときは同じ配布元から同じファイル名で差し替える
- Service Worker の事前キャッシュには**入れていない**（使わない店舗にまで
  約6.5MBを配らないため）。初回利用時に読み込み、既存の「ネット優先・
  成功したら控える」仕組みでキャッシュされ、2回目からはオフラインでも動く
