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
 * 【どのプランの金額を拾うか（2026-08-20・厳守）】
 * ・定期契約（2年・3年などの自動更新プラン）がある回線は、必ず【定期契約ありの金額】を入れる。
 *   「定期契約なし」「縛りなし」プランの金額は入れない。店頭でお会いするお客様の大半が
 *   定期契約ありのため、そちらでないと比較がずれる。
 * ・定期契約なしのプランしか無い回線は、そのままその金額でよい（So-net 光・WiMAX・
 *   Rakuten Turbo など）。「定期契約なししか無い」旨を note に書く。
 * ・割引で定期契約を表している回線（フレッツ光の「光はじめ割」など）は、その割引の
 *   適用後の金額を入れる。解約金と基準がそろうようにする。
 * ・どのプランから採ったかは必ず note に書く（契約年数・自動更新の有無・受付終了の予定）。
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
    /* ---- 光コラボ（事業者変更） ---- */
    {
      id: "sb", type: "collabo", name: "SoftBank 光",
      monthly: { ht: 5720, ms: 4180 },
      penalty: { ht: 5720, ms: 4180 },
      /* 10ギガは戸建・マンションとも同額。解除料は月額料金相当額。
       * 別途、必須オプション「ホームゲートウェイ（S）」550円が掛かる。
       * 出典: https://www.softbank.jp/internet/sbhikari/price/ （2026-08-20 確認・税込） */
      monthly10g: { ht: 6380, ms: 6380 },
      penalty10g: { ht: 6380, ms: 6380 },
      option10g: 550,
      note10g: "SoftBank 光・10ギガの2年自動更新プランの月額基本料金です（戸建・マンション同額）。別途、必須オプション「ホームゲートウェイ（S）」550円が掛かるため、実際のご請求は6,930円程度になります。自動更新なしプランは7,590円。解除料は月額料金相当額。2026年12月1日の一律+330円の改定は、10ギガは対象外です。",
      numberFee: 0,
      note: "1ギガ「2年自動更新プラン」の割引前の標準月額。光コラボのためプロバイダ料込み。解除料は2022年7月1日以降の契約分で基本料1カ月分。契約期間満了月とその翌月・翌々月の解約は0円。2022年6月30日以前の旧契約は戸建・マンションとも10,450円のため既契約者は要確認。公式に2026年12月1日から一律+330円改定(戸建6,050円／マンション4,510円、解除料も同額)の告知あり。　【税表記】税込。出典2ページとも本文に「表示価格は特に断りがない限り税込です。」と明記。掲載値をそのまま税込として採用し、税抜→税込の換算はしていない。",
      tel: "", url: "https://www.softbank.jp/internet/cancellation-fee/",
      src: "https://www.softbank.jp/internet/sbhikari/price/ （2026-08-20 確認） / https://www.softbank.jp/internet/cancellation-fee/ （2026-08-20 確認） ※ https://www.softbank.jp/support/faq/view/14908 および https://www.softbank.jp/support/faq/view/13668 はHTTP403で到達できず根拠から除外"
    },
    {
      id: "rakuten", type: "collabo", name: "楽天ひかり",
      monthly: { ht: 5280, ms: 4180 },
      penalty: { ht: 5280, ms: 4180 },
      numberFee: null,
      note: "ファミリープラン(戸建)／マンションプラン(集合住宅)の割引前の標準月額。光コラボのためプロバイダ料込み。契約期間は2年・自動更新で本ツールの基準と一致。解除料は基本料1カ月分と同額。24〜26カ月目に解約申請すれば0円。キャンペーン適用中や2022年6月30日以前の申込は条件が異なるためメンバーズステーションで要確認。開通月は無料、途中解約の日割りなし。　【税表記】税込。公式料金ページは「3,800円（税込4,180円）」等と税抜・税込を併記しており、併記された税込値をそのまま採用(1.1倍の換算はしていない)。重要事項説明書の解除料も税込額で記載。",
      tel: "", url: "https://network.mobile.rakuten.co.jp/hikari/support/cancellation/",
      src: "https://network.mobile.rakuten.co.jp/hikari/fee/pricelist/ （2026-08-20 確認） / https://network.mobile.rakuten.co.jp/hikari/terms/important_explanation_20251001/ （2026-08-20 確認） / https://network.mobile.rakuten.co.jp/hikari/support/cancellation/ （2026-08-20 確認・金額の明示なし）"
    },
    {
      id: "biglobe", type: "collabo", name: "ビッグローブ光",
      monthly: { ht: 5478, ms: 4378 },
      penalty: { ht: 4100, ms: 3000 },
      /* 10ギガタイプは2年プランで、戸建・マンションとも同額。
       * 出典: https://join.biglobe.ne.jp/ftth/hikari/price/ （2026-08-20 確認・月額は税込／違約金は不課税） */
      monthly10g: { ht: 6270, ms: 6270 },
      penalty10g: { ht: 4620, ms: 4620 },
      note10g: "BIGLOBE光 10ギガタイプ「2年プラン」の月額料金です（戸建・マンション同額）。1ギガは3年プランですが、10ギガは2年プランになります。契約解除料は4,620円（不課税）。プロバイダ料込み。",
      numberFee: null,
      note: "【契約年数が他社と異なる。必ず説明すること】BIGLOBE光 1ギガタイプ「3年プラン」(36カ月・以降36カ月ごと自動更新)の割引前の標準月額。Web申込は3年プランのみで、2年プラン(戸建5,698円／マンション4,488円)は申込相談予約が必要。違約金(不課税)は2024年2月1日以降の申込が対象で2年・3年共通、更新月とその翌月・翌々月は0円。旧申込分は金額が異なるため要確認。プロバイダ料込み。　【税表記】税込。月額は公式申込サイト(join.biglobe.ne.jp)の料金ページ・FAQに「表示金額は税込です」と明記。会員サポートの料金表には税込／税抜の表記がないが値が一致するため税込と判断。違約金は「4,100円(不課税)」「3,000円(不課税)」で消費税の加算なし。当方での換算はしていない。",
      tel: "", url: "https://support.biglobe.ne.jp/jimu/ryokin/course/bighikari_3years.html",
      src: "https://join.biglobe.ne.jp/ftth/hikari/price/ （2026-08-20 確認） / https://support.biglobe.ne.jp/jimu/ryokin/course/bighikari_3years.html （2026-08-20 確認） / https://support.biglobe.ne.jp/jimu/ryokin/course/bighikari.html （2026-08-20 確認・2年プランの参考値） / https://join.biglobe.ne.jp/ftth/hikari/faq/faq-bh008.html （2026-08-20 確認）"
    },
    {
      id: "sonet", type: "collabo", name: "So-net 光",
      monthly: { ht: 5995, ms: 4895 },
      penalty: { ht: 0, ms: 0 },
      numberFee: null,
      note: "「So-net 光 M」(1ギガ・光コラボ、プロバイダ料込み、NTT東西同額)の割引前の標準月額。現行はS(4,500円／3,400円)・M・L(7,095円／5,995円)の3プランで、標準としてMを採用。重要事項説明に「定期契約期間および解約金の設定はありません」と明記のため解約金は0円(縛りなし)。2年定期契約の設定自体がない。解約時に工事費残債が一括請求される場合がある点は必ず案内。　【税表記】税込。出典に「記載の金額は、別途記載があるものを除いてすべて税込金額です。」と明記。静的HTMLソース上にも5,995円／4,895円がそのまま存在し、スクリプトによる税込換算ではないことを確認済み。換算なしで採用。",
      tel: "", url: "https://www.so-net.ne.jp/guide/hikari_sml/applications/",
      src: "https://www.so-net.ne.jp/guide/hikari_sml/price.html （2026-08-20 確認） / https://www.so-net.ne.jp/signup/kiyaku/important/hikari_m.html （2026-08-20 確認） / https://www.so-net.ne.jp/access/hikari/1g/ （2026-08-20 確認） / https://www.so-net.ne.jp/guide/hikari_sml/applications/ （2026-08-20 確認・金額の明示なし）"
    },
    {
      id: "nifty", type: "collabo", name: "@nifty 光",
      monthly: { ht: 5720, ms: 4378 },
      penalty: { ht: 4840, ms: 3630 },
      numberFee: null,
      note: "「@nifty光 1ギガ」ホーム／マンション・ギガタイプの割引前の標準月額。光コラボのためプロバイダ料込み。契約期間は2年プラン(N)・3年プラン(N)から選択でき1ギガはどちらも同額。解除手数料(不課税)は2022年7月1日以降の申込分で、更新期間(満了月から翌々月の3カ月)は0円。2022年6月30日以前の旧プランは3年22,000円／2年10,450円のため既契約者は要確認。　【税表記】税込。月額は「5,200円(税込5,720円)」等と税抜・税込を併記しており、併記された税込額を採用(1.1倍の換算はしていない)。解除手数料は表の見出しが「金額（不課税）」で消費税が加算されないため、4,840円／3,630円がそのまま請求額。",
      tel: "", url: "https://setsuzoku.nifty.com/niftyhikari/price/cancel_charge/",
      src: "https://setsuzoku.nifty.com/niftyhikari/price/hinmoku/ （2026-08-20 確認） / https://setsuzoku.nifty.com/niftyhikari/price/cancel_charge/ （2026-08-20 確認） / https://setsuzoku.nifty.com/niftyhikari/price/ （2026-08-20 確認）"
    },
    {
      id: "ocn", type: "collabo", name: "OCN インターネット",
      monthly: { ht: 5720, ms: 4400 },
      penalty: { ht: 5500, ms: 4180 },
      numberFee: null,
      note: "【注意】単独の光回線ではなくドコモ光専用プロバイダ。掲載額はドコモ光1ギガ タイプA・2年定期契約の割引前料金(プロバイダ料込み)のため、他社光回線と並べる扱いは要確認。契約期間なしだと戸建7,370円／マンション5,500円。解約金は更新期間(満了月の当月・翌月・翌々月)以外の解約時。2022年6月30日以前の申込は戸建14,300円／マンション8,800円のため要確認。　【税表記】税込。出典は各金額に「（税込）」を個別に明記(例：5,720円（税込）/月、解約金 戸建5,500円（税込）)。ページ内に税抜表記は一切なし。静的HTMLソースでも同じ形で記載されており、スクリプト換算ではないことを確認済み。換算なしで採用。",
      tel: "", url: "https://service.ocn.ne.jp/hikari/ocn-internet/charge/",
      src: "https://service.ocn.ne.jp/hikari/ocn-internet/charge/ （2026-08-20 確認・WebFetchは403のためcurlでHTTP200取得し静的HTMLで確認） / https://service.ocn.ne.jp/hikari/ （2026-08-20 確認・金額の明示なし）"
    },
    {
      id: "gmo", type: "collabo", name: "GMOとくとくBB光",
      monthly: { ht: null, ms: null },
      penalty: { ht: null, ms: null },
      numberFee: null,
      note: "【要確認】公式サイト(gmobb.jp／help.gmobb.jp)がボット対策で全ページHTTP403となり本文を確認できなかったため、月額・解約金とも数値を入れていない(null=要確認が正しい状態)。検索結果に「縛りなし・違約金なし」等の断片はあるが公式で裏取りできず、対象プラン・割引前後・税込税抜も不明のため不採用。金額提示が必要な場合はスタッフがgmobb.jpをブラウザで直接開いて確認すること。　【税表記】確認不可。公式サイトのページ本文に到達できなかったため、税込／税抜のどちらの表記かも確認できていない。",
      tel: "", url: "",
      src: "一次情報として採用できる到達可能な公式URLなし。到達試行(curl・WebFetch双方)：https://gmobb.jp/service/gmohikari/price/ （2026-08-20 確認・HTTP403で本文に到達できず金額の明示なし） / https://gmobb.jp/service/gmohikari/ （2026-08-20 確認・HTTP403） / https://gmobb.jp/lp/gmohikari/ （2026-08-20 確認・HTTP403） / https://gmobb.jp/service/gmohikari/support/faq/monthly-fee/ （2026-08-20 確認・HTTP403） / https://help.gmobb.jp/faq/faq_detail.html?id=1020918 （2026-08-20 確認・HTTP403） / https://help.gmobb.jp/app/answers/detail/a_id/020598 （2026-08-20 確認・HTTP403）"
    },

    /* ---- フレッツ光（転用） ---- */
    {
      id: "fletsw", type: "flets", name: "フレッツ光（NTT西日本）",
      monthly: { ht: 4411, ms: 3333 },
      penalty: { ht: 4400, ms: 2200 },
      numberFee: null,
      note: "【回線利用料のみ／プロバイダ料は別】【いまフレッツ光を使い続けている方＝長期割引の最安を想定】「光もっと2割」（自動延伸・8年以上のご利用）の額です。2025年2月からの割引額見直し（＝値上げ）後の金額を入れています。戸建=ファミリー・スーパーハイスピードタイプ隼 5,940円→4,411円（見直し前は3,971円）、マンション=マンションタイプ プラン1 4,070円→3,333円（同 3,113円）。プロバイダ料は割引の対象外で別途掛かります。解約金は見直し後の一律額で、戸建4,400円／マンション2,200円（見直し前は年数により最大33,000円）。「Web光もっと2割」の場合は戸建4,411円で同額、マンション プラン1は3,333円で同額。マンションはプラン2・ミニ、LAN方式で額が異なるため要確認。　【税表記】税込。flets-w.com に「本ホームページの料金・解約金等は特に記載のない限り税込です。」と明記(about_tax ページを実地確認)。掲載値をそのまま税込として採用し、1.1倍の換算はしていない。解約金4,400円／2,200円も同じ税込ルールの対象。",
      tel: "", url: "https://flets-w.com/user/confirm/kaiyaku/",
      src: "https://flets-w.com/service/next/price/new/ （2026-08-20 確認） / https://flets-w.com/limited/hajimenext/ （2026-08-20 確認） / https://flets-w.com/about_tax/ （2026-08-20 確認・税込表示方針、金額の明示なし） / https://flets-w.com/user/confirm/kaiyaku/ （2026-08-20 確認・金額の明示なし） ※ https://flets-w.com/limited/hajimewari/charge/ は2024年10月31日受付終了の旧「光はじめ割」ページのため根拠から除外"
    },
    {
      id: "fletse", type: "flets", name: "フレッツ光（NTT東日本）",
      monthly: { ht: 5940, ms: 3795 },
      penalty: { ht: null, ms: null },
      numberFee: null,
      note: "【回線利用料のみ／プロバイダ料は別】戸建=ファミリー・ギガラインタイプ、マンション=マンション・ギガラインタイプ プラン1の標準額。現行は適用できる期間割引（定期契約）がないため、この額がそのまま基準になる。マンションはプラン2が3,355円、ミニ4,455円と建物により異なるため要確認。解約金は公式の解約手続きページに金額の記載が一切なく戸建・マンションとも要確認(NTT東日本0120-116116)。推測額を伝えないこと。　【税表記】税込。flets.com の各料金ページ下部に「表示価格は、特別な記載がない限りすべて税込です。」と明記(ファミリー／マンション両ページおよび料金改定ページの実HTMLで確認)。掲載値をそのまま税込として採用し、1.1倍の換算はしていない。",
      tel: "", url: "https://flets.com/support/flets-hikari/cancel/",
      src: "https://flets.com/flets-hikari/next/ （2026-08-20 確認） / https://flets.com/flets-hikari/next/mn_index.html （2026-08-20 確認） / https://flets.com/2024_rebalance/ （2026-08-20 確認・2025年4月1日料金改定） / https://flets.com/support/flets-hikari/cancel/ （2026-08-20 確認・金額の明示なし） ※ https://flets.com/ninenwari/ は到達不可(HTTP403)のため根拠から除外"
    },

    /* ---- 独自回線（関西で多い順） ---- */
    {
      id: "eo", type: "dokuji", name: "eo光",
      monthly: { ht: 5500, ms: null },
      penalty: { ht: 5000, ms: null },
      removal: null,
      note: "戸建=eo光ネット【ホームタイプ】1ギガコース「即割」適用時の標準月額(キャンペーン適用外・プロバイダ料込み)。即割は2年の最低利用期間があり期間内解約で5,000円、25カ月目以降は0円で自動更新はない。即割なしは最低1年・2,290円。マンションは物件ごとに料金が異なり公式に標準額の記載がないため月額・解約金とも要確認(解約金は月額基本料−990円)。撤去費・工事費残債は別途。コース・電話／テレビの有無で月額が変わるため、①の「eo光の料金表から選ぶ」から拾えます。　【税表記】当方で税込に換算済み。support.eonet.jp はHTMLソース上の金額が税抜で、ページ内スクリプト(contents.js の var tax=1.10／Math.floor)が表示時に税込へ換算している(マークアップにも <!--税込--> の制作者コメントあり)。月額5,000円×1.1=5,500円、解約精算金4,546円×1.1=5,000円(切捨)。eonet.jp の料金JSON(price:5500)、gofaq.eonet.jp の税込表記FAQとも一致し三重に裏取り済み。既存データの4,546円は税抜値の誤用。",
      tel: "", url: "https://support.eonet.jp/inquiry/cancel/",
      src: "https://eonet.jp/home/charge/pricelist/ および料金データ https://eonet.jp/home/charge/common/data/service.json （2026-08-20 確認・net_1gb price:5500） / https://support.eonet.jp/usqa/other/3000264_14146.html （2026-08-20 確認・税抜ソース5,000円→表示税込5,500円） / https://support.eonet.jp/usqa/other/3000265_14146.html （2026-08-20 確認・即割は2年・自動更新なし） / https://gofaq.eonet.jp/faq/show/29?site_domain=default （2026-08-20 確認・税込5,000円） / https://support.eonet.jp/usqa/other/3000272_14146.html （2026-08-20 確認・税抜4,546円→表示税込5,000円） / https://support.eonet.jp/usqa/js/contents.js （2026-08-20 確認・var tax=1.10, Math.floor） / https://eonet.jp/mansion/ および https://support.eonet.jp/usqa/other/3006687_14146.html （2026-08-20 確認・マンション月額は物件ごとに異なり金額の明示なし） / https://eonet.jp/mansion/service/net/flow/terms/hikari.html （2026-08-20 確認・解約精算金は月額基本料−990円、固定額の明示なし） / https://support.eonet.jp/inquiry/cancel/ （2026-08-20 確認・金額の明示なし）"
    },
    {
      id: "auhikari", type: "dokuji", name: "auひかり",
      monthly: { ht: 5720, ms: 4180 },
      penalty: { ht: 4460, ms: 2290 },
      removal: null,
      note: "戸建=auひかり ホーム1ギガ「ギガ得プラン」ネットのみ、2年自動更新で満了月の当月・翌月・翌々月は解除料0円。マンションはタイプV16契約以上(お得プランA)基準で、タイプGは解除料2,730円、マンションギガは4,455円／2,290円と物件タイプで変わるため要確認。掲載額は口座振替・クレカ割引(110円/月)適用後で、窓口払いは別途473円/月。撤去工事は原則不要。　【税表記】税込。au.com の各料金ページに「表記の金額は特に記載のある場合を除きすべて税込です。」と明記。掲載値をそのまま税込として採用(換算なし)。ただし掲載額そのものが口座振替・クレジットカード割引(110円/月)適用時の金額である点に注意。",
      tel: "", url: "https://www.au.com/support/faq/details/00/0000/000033/pg00003392/",
      src: "https://www.au.com/internet/auhikari_1g/charge/gigatoku/ （2026-08-20 確認） / https://www.au.com/internet/auhikari_1g/charge/zuttogigatoku/ （2026-08-20 確認・3年契約は解除料4,730円） / https://www.au.com/internet/mansion/typeV/charge/typeV16-100m/ （2026-08-20 確認） / https://www.au.com/internet/mansion/typeG/charge/typeG16-otoku/ （2026-08-20 確認・解除料2,730円） / https://www.au.com/internet/mansion/mansion-giga/charge/ （2026-08-20 確認・4,455円／2,290円） / https://www.au.com/support/faq/details/00/0000/000033/pg00003392/ （2026-08-20 確認・撤去工事の要否、月額・解除料の明示なし）"
    },
    {
      id: "nuro", type: "dokuji", name: "NURO 光",
      monthly: { ht: null, ms: null },
      penalty: { ht: 0, ms: 0 },
      removal: null,
      note: "【要確認】確認日時点の現行月額は戸建5,500円／マンション3,850円だが、2026年9月1日施行の改定後は戸建5,720円／マンション4,235円。日付で変わり単一の数字を載せると誤りになるため月額はnullとした。2026年8月31日で現行プランの新規受付終了、9月1日からの新プランは条件未公表。解除料は現行販売プランが0円(縛りなし)だが旧プラン契約者は3,740〜4,400円のため契約プラン名を要確認。　【税表記】税込。nuro.jp の各料金ページに「特に注記のない限り、記載の金額は全て税込金額です」と明記、料金改定PDFも税込表記。換算はしていない。月額をnullにしたのは税込／税抜ではなく適用時期の問題(下記note)。",
      tel: "", url: "https://www.nuro.jp/hikari/price/rel_price.html",
      src: "https://www.nuro.jp/hikari/house/price/ （2026-08-20 確認・改定前5,500円／改定後5,720円、解約金0円） / https://www.nuro.jp/hikari/mansion/price/ （2026-08-20 確認・改定前3,850円／改定後4,235円、契約解除料無料） / https://www.nuro.jp/hikari/price/rel_price.html （2026-08-20 確認・旧プラン解除料3,740円／3,850円／4,400円） / https://www.nuro.jp/news_release/20260615/price-revision.pdf （2026-08-20 確認・効力発生日2026年9月1日）"
    },

    /* ---- CATV（関西） ---- */
    {
      id: "jcom", type: "catv", name: "J:COM NET",
      monthly: { ht: null, ms: 5258 },
      penalty: { ht: null, ms: null },
      removal: null,
      note: "【要確認】集合住宅1Gコースは公式2ページとも割引終了後5,258円で一致のため採用。ただし「1G＋Wi-Fi」のセット・WEB限定スタート割終了後の通常額で、2年契約・自動更新が前提。ネット単品の額ではない。戸建は公式内で5,610円と5,808円が併存し単品額も不明のためnull。解除料は公式に「マイページで確認」とあるだけで金額の記載がなく戸建・マンションとも要確認。　【税表記】税込。jcom.co.jp に「【税込金額について】表記の金額は特に記載のある場合を除き税込金額。」と明記。掲載値をそのまま税込として採用(換算なし)。",
      tel: "", url: "https://cs.myjcom.jp/articles/%E3%82%B5%E3%83%BC%E3%83%93%E3%82%B9%E5%85%A8%E8%88%AC/%E9%95%B7%E6%9C%9F%E5%A5%91%E7%B4%84%E3%82%B5%E3%83%BC%E3%83%93%E3%82%B9-%E5%A5%91%E7%B4%84%E6%9B%B4%E6%96%B0%E6%9C%9F%E9%96%93%E3%81%A8%E5%A5%91%E7%B4%84%E8%A7%A3%E9%99%A4%E6%96%99%E9%87%91/6790bebfad2e841b2e335a14",
      src: "https://www.jcom.co.jp/price/ （2026-08-20 確認・戸建5,610円／集合住宅5,258円、いずれも割引終了後） / https://www.jcom.co.jp/price/hikari-n/ （2026-08-20 確認・戸建5,808円／集合住宅5,258円、光(N)の解除料3,850円(税込)） / https://www.jcom.co.jp/service/net/course/ （2026-08-20 確認・金額の明示なし、料金シミュレーション案内のみ） / https://cs.myjcom.jp/articles/%E3%82%B5%E3%83%BC%E3%83%93%E3%82%B9%E5%85%A8%E8%88%AC/%E9%95%B7%E6%9C%9F%E5%A5%91%E7%B4%84%E3%82%B5%E3%83%BC%E3%83%93%E3%82%B9-%E5%A5%91%E7%B4%84%E6%9B%B4%E6%96%B0%E6%9C%9F%E9%96%93%E3%81%A8%E5%A5%91%E7%B4%84%E8%A7%A3%E9%99%A4%E6%96%99%E9%87%91/6790bebfad2e841b2e335a14 （2026-08-20 確認・金額の明示なし）"
    },
    {
      id: "baycom", type: "catv", name: "ベイ・コミュニケーションズ",
      monthly: { ht: null, ms: null },
      penalty: { ht: null, ms: null },
      removal: null,
      note: "【要確認】1ギガ相当でネット単品・割引前の標準月額が公式に見当たらないため全項目null。集合住宅限定は「マンション長割」(NET30・30Mベース、通常5,016円、2年契約)で1ギガではない。5,731円はNET160(160M)で住居区分の記載なし。一戸建て限定のBaycom光1ギガは「3,454円〜」等のパック価格のみ。違約金も「1カ月分の利用料」とあるだけで固定額の明示なし。別途 契約基本料396円/月。　【税表記】不整合。baycom.jp は「表示の料金は特に断り書きがあるものを除きすべて税込です」と明記する一方、マンション長割ページの「NET30 通常4,560円→3,500円」は税抜値で、×1.1すると他ページの税込値(5,016円／3,850円)と一致する。サイト内で税込／税抜が食い違うため、金額は必ず他ページの税込値と突き合わせること。",
      tel: "", url: "",
      src: "https://baycom.jp/pack/hikari/ （2026-08-20 確認・3年契約、違約金は「1カ月分の利用料」で金額の明示なし） / https://baycom.jp/service/net/ （2026-08-20 確認・パック通常料金、契約基本料396円） / https://baycom.jp/service/net/cable/ （2026-08-20 確認・NET160=5,731円等、住居区分・契約期間・違約金の明示なし） / https://baycom.jp/pack/price/ （2026-08-20 確認・集合住宅／一戸建ての区分なし） / https://baycom.jp/pack/ （2026-08-20 確認・一戸建て限定1ギガ3,454円〜／集合住宅限定マンション長割3,850円〜、割引前の標準額の明示なし） / https://baycom.jp/campaign/chowari/ （2026-08-20 確認・NET30通常4,560円→3,500円は税抜表示、2年契約以降1年自動更新）"
    },

    /* ---- 他社ホームルーター ---- */
    {
      id: "sbair", type: "hr", name: "SoftBank Air",
      monthly: { ht: 5368, ms: 5368 },
      penalty: { ht: 0, ms: 0 },
      note: "「Air 4G/5G共通プラン」(全機種共通)の基本料金。ホームルーターのため戸建・マンションの区分なし・同額。プロバイダ料込みで、Airターミナル本体代・事務手数料4,950円等は別途。解除料は現行プラン「なし」と公式FAQに明記のため0円。2021年9月14日受付終了の旧「2年自動更新プラン」継続中の方は解除料が発生する場合がありMy SoftBankで要確認。2026年12月1日から+330円の5,698円に改定告知あり。　【税表記】税込。料金ページ末尾に「表示価格は特に断りがない限り税込です。」、FAQに「表示価格は税込です」と実ページで確認済み。1.1倍の換算はしていない(換算不要)。",
      tel: "", url: "https://www.softbank.jp/internet/support/sbair/cancel/",
      src: "https://www.softbank.jp/internet/air/price/ （2026-08-20 確認・基本料金5,368円／月、2026年12月1日+330円改定の告知） / https://www.softbank.jp/support/faq/view/51651 （2026-08-20 確認・Air 4G/5G共通プラン 契約解除料金なし／月額5,368円） / https://www.softbank.jp/internet/support/sbair/cancel/ （2026-08-20 確認・金額の明示なし、My SoftBankで確認との案内）"
    },
    {
      id: "wimax", type: "hr", name: "WiMAX（UQ・各プロバイダ）",
      monthly: { ht: 5280, ms: 5280 },
      penalty: { ht: 0, ms: 0 },
      note: "「WiMAX +5G ギガ放題プラスS」の割引前の月額。ホームルーター／モバイルルーター共通で戸建・マンションの区分なし・同額、プロバイダ料込み。「WiMAX +5G割」適用で13カ月間4,598円になるが期間限定割引のため不採用。端末代・登録料3,300円、プラスエリアモード利用月1,100円は別途。契約期間の条件がないプランのため解除料0円。旧2年自動更新プランは更新期間外の解約で1,100円のため要確認。　【税表記】税込。プランページに「※ 表記の金額は特に記載のある場合を除きすべて税込です。」と実ページで確認済み。1.1倍の換算はしていない(換算不要)。",
      tel: "", url: "https://www.uqwimax.jp/wimax/support/okomari/index2.html",
      src: "https://www.uqwimax.jp/wimax/plan/gigahodai_plus_s/ （2026-08-20 確認・月額料金(割引前)5,280円） / https://www.uqwimax.jp/wimax/support/qa/pages/000003241/ （2026-08-20 確認・ギガ放題プラスSは解除料なし、旧2年自動更新プランは税込1,100円） / https://www.uqwimax.jp/wimax/support/qa/pages/000003309/ （2026-08-20 確認・契約期間の条件がない料金プラン） / https://www.uqwimax.jp/wimax/support/okomari/index2.html （2026-08-20 確認・金額の明示なし）"
    },
    {
      id: "turbo", type: "hr", name: "Rakuten Turbo",
      monthly: { ht: 4840, ms: 4840 },
      penalty: { ht: 0, ms: 0 },
      note: "Rakuten Turbo(現行の単一プラン)のプラン料金。ホームルーターのため戸建・マンションの区分なし・同額、プロバイダ料込み。「製品代金実質0円キャンペーン」の48カ月間-867円は割引後のため不採用で、割引前の標準額を採用。端末代・事務手数料は別途。公式FAQに「契約期間の縛りや最低利用期間はありません」「契約解除料は発生しません」と明記のため0円。分割払い中の端末残債は解約後も支払いが継続。　【税表記】税込。料金ページに「※表記の金額はすべて税込です」と明記。料金表(約款系)は「月額4,400円（税込4,840円）」と併記で4,400×1.1=4,840と整合しており、税抜値を税込と取り違えてはいない。",
      tel: "", url: "https://network.mobile.rakuten.co.jp/internet/turbo/support/contract/cancel/",
      src: "https://network.mobile.rakuten.co.jp/internet/turbo/fee/ （2026-08-20 確認・プラン料金4,840円） / https://network.mobile.rakuten.co.jp/terms/rakuten_turbo_pricelist/ （2026-08-20 確認・月額4,400円（税込4,840円）） / https://network.mobile.rakuten.co.jp/faq/detail/10000694/ （2026-08-20 確認・契約解除料は発生しません） / https://network.mobile.rakuten.co.jp/faq/detail/10000618/ （2026-08-20 確認・契約期間の縛りや最低利用期間なし） / https://network.mobile.rakuten.co.jp/internet/turbo/support/contract/cancel/ （2026-08-20 確認・金額の明示なし）"
    }
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
    src: "eo光 カタログ 料金表（2026-08-20 転記）／ https://eonet.jp/home/charge/pricelist/",
    /* マンションタイプは物件ごとに料金が異なるため、この表では出せない。
     * オプテージの「導入済みマンション検索」で物件を引くと料金が分かる。
     * eonet.jp/mansion/ の「検索」リンクがこのURLへ転送している（2026-08-20 確認）。 */
    mansionUrl: "https://apply.eonet.jp/mansion",
    mansionLabel: "eo光 導入済みマンション検索",

    /* 撤去工事費。現地の状況で額が決まるので手入力ではなく選択制にする。
     * テレビの有無で選べる額が変わる。
     * 出典: https://gofaq.eonet.jp/faq/show/88 （テレビあり・2026-08-20 確認）
     *       https://support.eonet.jp/usqa/other/3000272_14146.html （ネットのみ・2026-08-20 確認） */
    removalOptions: {
      withTv: [
        { v: 5500,  name: "部分撤去（引込線を残す・アンテナ切替なし） 5,500円" },
        { v: 24200, name: "全撤去（引込線も撤去） 24,200円" }
      ],
      noTv: [
        { v: 0,     name: "残置（回線終端装置のみ撤去） 0円" },
        { v: 16500, name: "全撤去（引込線も撤去） 16,500円" }
      ],
      noteTv: "テレビがある場合の額です。引込線を残し、アンテナへの切り替え作業も行わないときが5,500円。引込線まで撤去すると24,200円です。eo光テレビチューナーが2台以上あるときは、1台につき5,500円〜が別途加算されます。",
      noteNet: "ネットのみの場合の額です。回線終端装置だけの撤去は無料ですが、引込線を残すには建物所有者・管理組合の残置承諾が必要です。承諾が得られないときは引込線を含む撤去で16,500円になります。",
      src: "https://gofaq.eonet.jp/faq/show/88 ／ https://support.eonet.jp/usqa/other/3000272_14146.html （2026-08-20 確認）"
    },

    /* 解約精算金。料金表でどの期間の金額を選んだかで変わる。
     *   即割期間（ご利用開始月・2カ月目〜＝1〜2年目）… 即割の最低利用期間2年
     *   長割期間（3〜5年目・6年目以降）           … 長割の最低利用期間3年
     * 出典: https://gofaq.eonet.jp/faq/show/29 （即割・2026-08-20 確認）
     *       https://eonet.jp/home/service/net/longplan/ （長割・2026-08-20 確認）
     * ※長割の額は、同ページの割引額（10ギガ227円／5ギガ198円／1ギガ171円）が
     *   カタログの税込料金差と一致するため税込と判断した。 */
    penaltyByPeriod: {
      soku: { "10g": 6090, "5g": 5520, "1g": 5000 },
      naga: { "10g": 5350, "5g": 4660, "1g": 4030 },
      none: 2290,
      hint: "eo光の解約精算金は、即割期間（1〜2年目）が 1ギガ5,000円／5ギガ5,520円／10ギガ6,090円、長割期間（3年目以降）が 1ギガ4,030円／5ギガ4,660円／10ギガ5,350円です。更新月・満了月は0円。即割をお申し込みでない場合は最低利用期間1年で2,290円。「eo光の料金表から選ぶ」で金額を選ぶと、その期間の額が自動で入ります。"
    }
  }
};
