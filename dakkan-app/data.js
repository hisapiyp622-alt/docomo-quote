/* 他社ネット回線のマスタデータ（奪還ツール）
 *
 * 【この表の扱い（指示書 第4章・厳守）】
 * 1. 一次情報（各社の公式サイト）で確認できた値だけを入れる
 * 2. 確認できなかったものは null のままにする。推測した数字を入れない
 *    → null は画面と別紙に「要確認」と赤字で出て、費用の合計には入りません
 * 3. 出典URLと確認日を、各社の src に残す
 * 4. すべてマスタ設定から編集できる（店舗が最新の値に直せる）
 * 5. 画面と別紙に「料金データ基準日」を出す
 *
 * 【値の入れ方の決め（2026-07-31）】
 * ・公式ページが「いまの標準的なご契約」に対して1つの金額を明示しているものだけ目安を入れる
 * ・公式ページ自身が「マイページでご確認ください」としているもの（J:COM・SoftBank Air など）は
 *   null のままにする。店頭で請求書・マイページを見て入力する
 * ・条件（申込時期・プラン）は note に書き、画面のヒントに出す
 *
 * 金額はすべて【税込】。他社サイトは税抜表示が混ざるので、転記時に必ず税込へ直すこと。
 * 違約金は不課税のものもあり、その場合は記載額をそのまま入れている。
 */
window.DAKKAN_DATA = {

  /* 料金データ基準日。data.js の値を更新したらここも更新する（画面と別紙に出ます） */
  dataDate: "2026-08-20",

  /* 回線の種類。ドコモ側の申込区分をここで決める（指示書 第1章の表）
   *   apply   … イエナカ側 applyType への提案値（担当者が変更できる）
   *   product … イエナカ側 商材への提案値（未指定なら変更しない）
   *   removal … 撤去工事費の入力欄を出すか
   *   zansaiLabel … 残債の呼び方（光は工事費、ホームルーターは端末） */
  lineTypes: [
    { id: "collabo", name: "他社の光コラボ（SoftBank 光・楽天ひかり など）", apply: "jigyosha", removal: false, zansaiLabel: "工事費の残債", koji: false },
    { id: "flets",   name: "フレッツ光（NTT東西と直接契約）",                 apply: "tenyo",    removal: false, zansaiLabel: "工事費の残債", koji: false },
    { id: "dokuji",  name: "独自回線（eo光・auひかり・NURO 光 など）",         apply: "shinki",   removal: true,  zansaiLabel: "工事費の残債", koji: true },
    { id: "catv",    name: "CATV（J:COM NET など）",                          apply: "shinki",   removal: true,  zansaiLabel: "工事費の残債", koji: true },
    { id: "hr",      name: "他社のホームルーター（SoftBank Air・WiMAX など）", apply: "shinki",   removal: false, zansaiLabel: "端末の残債",   koji: false, product: "home5g" }
  ],

  /* 会社ごとの目安（安藤さんの判断 2026-07-30: 目安を持ちつつ、その場で直せるようにする）
   *
   *   type      … 上の lineTypes の id
   *   monthly   … 標準月額の目安 { ht: 戸建, ms: マンション }。請求額の入力があれば常にそちらを優先
   *   penalty   … 解約違約金の目安 { ht, ms }（更新月以外）。更新月は 0 として扱う
   *   removal   … 撤去工事費（撤去が条件になる会社のみ）
   *   numberFee … 事業者変更承諾番号／転用承諾番号の発行手数料
   *   note      … 条件・注意（画面のヒントに出る）
   *   tel / url … 解約・事業者変更の連絡先。電話番号は一次情報で確認できた分だけ
   *   src       … 出典URLと確認日
   *
   * ★ null = 未確認。画面では「要確認」になり、合計に入りません。 */
  carriers: [
    /* ---- 光コラボ ---- */
    {
      id: "sb", type: "collabo", name: "SoftBank 光",
      monthly: { ht: null, ms: null },
      penalty: { ht: 5720, ms: 4180 },
      numberFee: 0,
      note: "2022年7月1日以降のご契約（2年自動更新）の解除料。それ以前のご契約は戸建10,450円・5年自動更新16,500円など、金額が異なります。事業者変更手数料3,300円は2022年7月1日以降のご契約では撤廃。",
      tel: "", url: "https://www.softbank.jp/internet/support/return/sbhikari/",
      src: "https://www.softbank.jp/internet/cancellation-fee/ （2026-07-31 確認）"
    },
    {
      id: "rakuten", type: "collabo", name: "楽天ひかり",
      monthly: { ht: null, ms: null },
      penalty: { ht: 5280, ms: 4180 },
      numberFee: null,
      note: "重要事項説明書の契約解除料。工事費を分割中の場合、残債は解約後に一括請求。承諾番号の発行手数料は公式に記載がないため要確認。",
      tel: "", url: "https://network.mobile.rakuten.co.jp/hikari/support/cancellation/",
      src: "https://network.mobile.rakuten.co.jp/hikari/terms/important_explanation/ （2026-07-31 確認）"
    },
    {
      id: "biglobe", type: "collabo", name: "ビッグローブ光",
      monthly: { ht: null, ms: null },
      penalty: { ht: 4100, ms: 3000 },
      numberFee: null,
      note: "2024年2月1日以降お申し込みの1ギガタイプ3年プランの違約金（不課税）。10ギガタイプ2年プランは戸建・マンションとも4,620円。2024年1月31日以前のお申し込みは金額が異なります。",
      tel: "", url: "https://support.biglobe.ne.jp/jimu/keiyaku/kaiyaku/bighikari-kaiyakuchuui.html",
      src: "https://join.biglobe.ne.jp/ftth/hikari/faq/faq-bh054.html （2026-07-31 確認）"
    },
    { id: "sonet", type: "collabo", name: "So-net 光",          monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, numberFee: null, note: "", tel: "", url: "", src: "" },
    { id: "nifty", type: "collabo", name: "@nifty 光",          monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, numberFee: null, note: "", tel: "", url: "", src: "" },
    { id: "ocn",   type: "collabo", name: "OCN インターネット", monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, numberFee: null, note: "", tel: "", url: "", src: "" },
    { id: "gmo",   type: "collabo", name: "GMOとくとくBB光",    monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, numberFee: null, note: "", tel: "", url: "", src: "" },

    /* ---- フレッツ光（転用） ---- */
    {
      id: "fletsw", type: "flets", name: "フレッツ光（NTT西日本）",
      monthly: { ht: null, ms: null },
      penalty: { ht: 0, ms: 0 },
      numberFee: null,
      note: "転用の場合、「光はじめ割」等の割引に係る解約金はNTT西日本から請求されません（公式記載）。工事費を分割中の場合の残債の扱いは公式に記載がないため要確認。転用は工事不要。",
      tel: "", url: "https://flets-w.com/collabo/tenyou/",
      src: "https://flets-w.com/collabo/tenyou/ （2026-07-31 確認）"
    },
    { id: "fletse", type: "flets", name: "フレッツ光（NTT東日本）", monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, numberFee: null, note: "阪南店の商圏は西日本のため未調査。東日本のお客様のときは公式で確認して入力してください。", tel: "", url: "", src: "" },

    /* ---- 独自回線（関西で多い順） ---- */
    {
      id: "eo", type: "dokuji", name: "eo光",
      monthly: { ht: 5500, ms: null },
      penalty: { ht: 5000, ms: null },
      removal: null,
      note: "標準月額は戸建（ホームタイプ／メゾンタイプ）1ギガ・即割ありの金額です。コース・ご契約年数・電話／テレビの有無で変わるため、①の「eo光の料金表から選ぶ」で拾ってください。解約精算金は1ギガ・即割ありの金額で、10ギガ6,090円・5ギガ5,520円・即割なし2,290円。撤去費用は「引込線を含む撤去16,500円／回線終端装置のみの撤去は無料（建物所有者・管理組合の残置承諾が必要）」で、どちらになるかは現地の設備によるため要確認。標準工事費29,700円を分割中の場合は残債を一括請求。マンションタイプは月額・解約精算金とも物件により異なります（解約精算金は月額基本料金から990円を差し引いた額）。",
      tel: "", url: "https://support.eonet.jp/inquiry/cancel/",
      src: "https://gofaq.eonet.jp/faq/show/29 ／ https://support.eonet.jp/usqa/other/3000272_14146.html （2026-08-20 確認・税込）"
    },
    { id: "auhikari", type: "dokuji", name: "auひかり",  monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, removal: null, note: "戸建では撤去工事が条件になる場合があります。金額は未調査のため、公式で確認して入力してください。", tel: "", url: "", src: "" },
    { id: "nuro",     type: "dokuji", name: "NURO 光",   monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, removal: null, note: "未調査。公式で確認して入力してください。", tel: "", url: "", src: "" },

    /* ---- CATV（関西） ---- */
    {
      id: "jcom", type: "catv", name: "J:COM NET",
      monthly: { ht: null, ms: null },
      penalty: { ht: null, ms: null },
      removal: null,
      note: "契約解除料金・撤去費用とも、公式サイトが「ご契約プラン・住居形態により異なる。マイページでご確認ください」としているため、お客様のマイページ／サポートでご確認のうえ入力してください。",
      tel: "", url: "https://cs.myjcom.jp/page/cancellation",
      src: "https://cs.myjcom.jp/page/cancellation （2026-07-31 確認・金額の明示なし）"
    },
    { id: "baycom", type: "catv", name: "ベイ・コミュニケーションズ", monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, removal: null, note: "未調査。公式で確認して入力してください。", tel: "", url: "", src: "" },

    /* ---- 他社ホームルーター ---- */
    {
      id: "sbair", type: "hr", name: "SoftBank Air",
      monthly: { ht: null, ms: null },
      penalty: { ht: null, ms: null },
      note: "解除料は「割引前の月額料金相当額」で、金額はMy SoftBankでの確認が必要（公式記載）。契約満了月の当月・翌月・翌々月は解除料不要。Airターミナルの分割残債は、解約後も分割継続か一括支払いを選択。",
      tel: "", url: "https://www.softbank.jp/internet/support/sbair/cancel/",
      src: "https://www.softbank.jp/support/faq/view/18973 （2026-07-31 確認・金額の明示なし）"
    },
    {
      id: "wimax", type: "hr", name: "WiMAX（UQ・各プロバイダ）",
      monthly: { ht: null, ms: null },
      penalty: { ht: 0, ms: 0 },
      note: "現行の「ギガ放題プラスS」は契約解除料なし（公式記載）。旧プラン（2年自動更新あり／なし）では1,100円が発生する場合があります。UQ以外のプロバイダ（GMO等）で契約されている場合は、そのプロバイダの条件をご確認ください。端末を分割中の場合は残債が残ります。",
      tel: "", url: "https://www.uqwimax.jp/wimax/support/okomari/index2.html",
      src: "https://www.uqwimax.jp/wimax/support/qa/pages/000003241/ （2026-07-31 確認）"
    },
    { id: "turbo", type: "hr", name: "Rakuten Turbo", monthly: { ht: null, ms: null }, penalty: { ht: null, ms: null }, note: "未調査。公式で確認して入力してください。", tel: "", url: "", src: "" }
  ],

  /* eo光の料金表（ホームタイプ／メゾンタイプ・税込）
   *
   * 関西の商圏では eo光 が最も多いため、請求書がお手元に無いお客様でも
   * 「ご契約の内容」から月額を拾えるようにしたもの。①の「月々のお支払い」に入ります。
   *
   * ★ マンションタイプは物件ごとに料金が異なるため、この表は使えません。
   *   マンションのお客様は請求書・マイページの金額を入力してください。
   * ★ 数値はカタログの料金表からの転記です。カタログと公式サイトで
   *   1ギガ即割 5,500円／10ギガ 6,530円／5ギガ 5,960円 が一致することを確認しています。
   *
   * price の配列は periods と同じ並びで [ご利用開始月, 2カ月目〜, 3〜5年目, 6年目以降3年ごと]。
   * ご利用開始月の欄はカタログ上 ※1 が付いています（電話・テレビの課金開始前）。
   */
  eoPlans: {
    lead: "ホームタイプ／メゾンタイプ・即割適用時の月額（税込）",
    periods: ["ご利用開始月", "2カ月目〜", "3〜5年目", "6年目以降"],
    courses: [
      { id: "10g", name: "10ギガコース" },
      { id: "5g",  name: "5ギガコース" },
      { id: "1g",  name: "1ギガコース" }
    ],
    tvCourses: [
      { id: "premium", name: "CSプレミアム／スマートプレミアム" },
      { id: "basic",   name: "CSベーシック／スマートベーシック" },
      { id: "compact", name: "スマートコンパクト" },
      { id: "chideji", name: "地デジ・BSコース" }
    ],
    sets: [
      { id: "net",      name: "eo光ネットのみ",                   net: true,  tel: false, tv: false },
      { id: "netTel",   name: "eo光ネット＋eo光電話",             net: true,  tel: true,  tv: false },
      { id: "netTelTv", name: "eo光ネット＋eo光電話＋eo光テレビ", net: true,  tel: true,  tv: true  },
      { id: "netTv",    name: "eo光ネット＋eo光テレビ",           net: true,  tel: false, tv: true  },
      { id: "telTv",    name: "eo光電話＋eo光テレビ",             net: false, tel: true,  tv: true  },
      { id: "tv",       name: "eo光テレビのみ",                   net: false, tel: false, tv: true  }
    ],
    price: {
      net:    { "10g": [6530, 6530, 6303, 5971], "5g": [5960, 5960, 5762, 5458], "1g": [5500, 5500, 5329, 5049] },
      netTel: { "10g": [6530, 6844, 6617, 6285], "5g": [5960, 6274, 6076, 5772], "1g": [5500, 5814, 5643, 5363] },
      netTelTv: {
        "10g": { premium: [6530, 11574, 11347, 11015], basic: [6530, 10144, 9917, 9585], compact: [6530, 8844, 8617, 8285], chideji: [6530, 8544, 8317, 7985] },
        "5g":  { premium: [5960, 11004, 10806, 10502], basic: [5960, 9574, 9376, 9072],  compact: [5960, 8274, 8076, 7772], chideji: [5960, 7974, 7776, 7472] },
        "1g":  { premium: [5500, 10544, 10373, 10093], basic: [5500, 9114, 8943, 8663],  compact: [5500, 7814, 7643, 7363], chideji: [5500, 7514, 7343, 7063] }
      },
      netTv: {
        "10g": { premium: [6530, 11260, 11033, 10701], basic: [6530, 9830, 9603, 9271], compact: [6530, 8530, 8303, 7971], chideji: [6530, 8230, 8003, 7671] },
        "5g":  { premium: [5960, 10690, 10492, 10188], basic: [5960, 9260, 9062, 8758], compact: [5960, 7960, 7762, 7458], chideji: [5960, 7660, 7462, 7158] },
        "1g":  { premium: [5500, 10230, 10059, 9779],  basic: [5500, 8800, 8629, 8349], compact: [5500, 7500, 7329, 7049], chideji: [5500, 7200, 7029, 6749] }
      },
      telTv: { premium: [0, 7506, 7506, 7506], basic: [0, 6076, 6076, 6076], compact: [0, 4776, 4776, 4776], chideji: [0, 4476, 4476, 4476] },
      tv:    { premium: [0, 6710, 6710, 6710], basic: [0, 5280, 5280, 5280], compact: [0, 3980, 3980, 3980], chideji: [0, 3680, 3680, 3680] }
    },
    /* 即割をお申し込みされない場合の通常料金。カタログにはネット単体分だけが載っています */
    normal: {
      periods: ["ご利用開始月〜12カ月目", "2年目〜", "3年目〜"],
      "10g": [6635, 6582, 6530], "5g": [6065, 6012, 5960], "1g": [5610, 5555, 5500]
    },
    notes: [
      "eo光電話の2番号サービスは、1番号サービスの月額料金に943円プラスとなります。",
      "工事完了月の翌月を1カ月目とし、2年目（13カ月目）から長割の割引料金を適用します。",
      "Netflixパックは上記月額料金に1,480円プラスとなります。",
      "eo光テレビチューナーの追加（2〜5台目）は別途、スマートプレミアム3,368円／スマートベーシック1,938円／スマートコンパクト1,214円（各1台）。録画機能付きは+770円、ブルーレイ搭載は+1,980円。"
    ],
    src: "eo光 カタログ 料金表（2026-08-20 転記）／ https://eonet.jp/home/charge/pricelist/"
  }
};
