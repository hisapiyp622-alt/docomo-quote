/* =========================================================
 * 料金マスタ（店舗標準フォーマット初期値）
 * 2026-07-28 に実運用のマスタを標準として焼き込み（ドコモ商材のみ）。
 * 店舗独自の商材・価格は各店舗がマスタ設定で登録する前提のため、初期値には含めない。
 * 料金は2026-07-10のドコモ公式調査値ベース。
 * マスタ設定の編集(localStorage)がここより優先される。
 * masterVersion … 料金改定を配るときに +1 する。店舗のアプリが自分の版と
 *   比べて、新しければマスタ設定に「料金表の更新があります」と出す。
 *   手順は非公開リポジトリ docomo-quote-internal の OPERATIONS.md を参照。
 * 「マスタを初期値に戻す」でこの標準構成に戻る。
 * ========================================================= */
const DEFAULT_DATA = {
  "masterVersion": 6,
  "updated": "2026-08-13",
  "fees": {
    "jimu_shinki": 4950,
    "jimu_mnp": 4950,
    "jimu_kishu": 4950,
    "atamakin_default": 0
  },
  "plans": [
    {
      "id": "max",
      "url": "https://www.docomo.ne.jp/charge/docomo_max/",
      "group": "current",
      "name": "ドコモ MAX",
      "tiers": [
        {
          "label": "〜1GB",
          "price": 5698
        },
        {
          "label": "1GB超〜3GB",
          "price": 6798
        },
        {
          "label": "3GB超〜無制限",
          "price": 8448
        }
      ],
      "discounts": {
        "hearty": 1980,
        "minna2": 550,
        "minna3": 1210,
        "set": 1210,
        "dcard": 220,
        "dcardGold": 550,
        "denki": 110,
        "choki10": 110,
        "choki20": 220
      },
      "includes5min": false,
      "note": "3段階制・無制限。エンタメ特典（Lemino/dアニメ/DAZN/NBAから毎月2つ無料）・Amazonプライム最大6か月無料・海外ローミング30GB/15日込み。",
      "bakuageTier": "max",
      "poikatsuPt": 0,
      "maxBonus": true
    },
    {
      "id": "poikatsu_max",
      "url": "https://www.docomo.ne.jp/charge/docomo_poikatsu_max/",
      "group": "current",
      "name": "ドコモ ポイ活 MAX",
      "tiers": [
        {
          "label": "無制限",
          "price": 11748
        }
      ],
      "discounts": {
        "hearty": 1980,
        "minna2": 550,
        "minna3": 1210,
        "set": 1210,
        "dcard": 220,
        "dcardGold": 550,
        "denki": 110,
        "choki10": 110,
        "choki20": 220
      },
      "includes5min": false,
      "note": "d払い/dカード決済にポイント還元（PLATINUM10%/GOLD系5%/その他3%・上限5,000pt/月）。還元は月額とは別枠。",
      "bakuageTier": "max",
      "poikatsuPt": 5000,
      "maxBonus": true
    },
    {
      "id": "poikatsu_20",
      "group": "current",
      "name": "ドコモ ポイ活 20",
      "tiers": [
        {
          "label": "〜20GB",
          "price": 7898
        },
        {
          "label": "20GB超〜無制限",
          "price": 9570
        }
      ],
      "discounts": {
        "hearty": 1980,
        "minna2": 550,
        "minna3": 1210,
        "set": 1210,
        "dcard": 220,
        "dcardGold": 550,
        "denki": 110
      },
      "includes5min": false,
      "note": "還元はPLATINUM5%/GOLD系2%/その他1%・上限2,500pt/月。長期利用割は対象外。",
      "bakuageTier": "std",
      "poikatsuPt": 2500,
      "maxBonus": false
    },
    {
      "id": "mini",
      "url": "https://www.docomo.ne.jp/charge/docomo_mini/",
      "group": "current",
      "name": "ドコモ mini",
      "tiers": [
        {
          "label": "4GB",
          "price": 2750
        },
        {
          "label": "10GB",
          "price": 3850
        }
      ],
      "discounts": {
        "minna2": 0,
        "minna3": 0,
        "set": 1210,
        "dcard": 220,
        "dcardGold": 550,
        "denki": 110
      },
      "includes5min": false,
      "dcard10": false,
      "note": "小容量プラン。みんなドコモ割・長期利用割は対象外（回線数カウントには含まれる）。dカードGOLD/PLATINUMの利用料金10%（20%）還元も対象外。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "ahamo",
      "group": "current",
      "name": "ahamo",
      "tiers": [
        {
          "label": "30GB",
          "price": 2970
        },
        {
          "label": "110GB（大盛りオプション込み）",
          "price": 4950
        }
      ],
      "discounts": {
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 0,
        "dcardGold": 0
      },
      "includes5min": true,
      "voiceOverrides": {
        "kake": 1100
      },
      "dcard10": false,
      "note": "5分通話無料込み。各種割引の適用外（みんなドコモ割の回線数カウントには含まれる）。dカードGOLD/PLATINUMの利用料金10%（20%）還元も対象外。店頭は「WEBお申込みサポート」3,300円/回（オンライン専用プランのため）。",
      "bakuageTier": "std",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "u15_debut",
      "group": "current",
      "name": "ドコモ スマホデビュープラン U15",
      "tiers": [
        {
          "label": "〜5GB",
          "price": 2508
        },
        {
          "label": "5GB超〜20GB",
          "price": 3278
        }
      ],
      "discounts": {
        "hearty": 770,
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 220,
        "dcardGold": 550
      },
      "includes5min": false,
      "note": "5〜15歳・2段階制・家族間通話無料込み（5分通話無料は無し。必要なら⑤通話オプションから）。親子割（U15）は⑤キャンペーンから（〜5GB:-1,100円/5GB超:-1,870円×12か月）。みんなドコモ割はカウントのみ、セット割・でんき割は対象外。出典: 公式プランページ（2026-08-07確認）",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "u15",
      "url": "https://www.docomo.ne.jp/charge/u15_hajimete_plan/",
      "group": "legacy",
      "name": "U15はじめてスマホプラン",
      "tiers": [
        {
          "label": "5GB",
          "price": 1980
        },
        {
          "label": "10GB",
          "price": 2860
        }
      ],
      "discounts": {
        "hearty": 572,
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": true,
      "note": "【新規受付終了（2026-08-06）】15歳以下・5分通話無料込み。U15はじめてスマホISP割（−165円）は「月額の追加項目」で追加を。U15ポイント特典（5GB:500pt/10GB:1,000pt×最大12か月）あり。みんなドコモ割はカウントのみ。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "hajimete",
      "group": "current",
      "name": "はじめてスマホプラン",
      "tiers": [
        {
          "label": "1GB",
          "price": 1980
        }
      ],
      "discounts": {
        "hearty": 572,
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": true,
      "note": "他社3G回線からの乗りかえ（契約変更・MNP）が対象・データ1GB・5分通話無料込み。はじめてスマホISP割（−165円・継続）は「月額の追加項目」で追加を。はじめてスマホ割（−550円・最大12か月）は「月額の追加項目」で期間12か月にして追加を。割引をすべて適用すると1〜12か月目1,078円／13か月目以降1,628円（2026-08-10 公式確認）。みんなドコモ割はカウントのみ。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "keitai",
      "group": "current",
      "name": "ケータイプラン",
      "tiers": [
        {
          "label": "100MB",
          "price": 1507
        }
      ],
      "discounts": {
        "hearty": 407,
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "ドコモケータイ（ガラホ・4G LTEケータイ）向け・データ100MB。みんなドコモ割は回線数カウントのみで割引対象外。光セット割・長期利用割も対象外。料金はマスタ設定で調整可。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "kids",
      "url": "https://www.docomo.ne.jp/charge/kidskeitaiplan-2/",
      "group": "current",
      "name": "キッズケータイプラン",
      "tiers": [
        {
          "label": "定額",
          "price": 550
        }
      ],
      "discounts": {
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 0,
        "dcardGold": 0
      },
      "includes5min": false,
      "note": "キッズケータイ専用（12歳以下）。国内通話・SMSは家族間無料。各種割引対象外・みんなドコモ割の回線数カウント対象外。料金はマスタ設定で調整可。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "dataplus",
      "url": "https://www.docomo.ne.jp/charge/dataplus-2/",
      "group": "current",
      "name": "データプラス",
      "tiers": [
        {
          "label": "ペア回線とシェア",
          "price": 1100
        }
      ],
      "discounts": {
        "hearty": 220,
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 0,
        "dcardGold": 0
      },
      "includes5min": false,
      "note": "タブレット・2台目端末用のデータ専用プラン。スマホのペア回線とデータ容量をシェア（単独契約不可・音声通話不可）。各種割引対象外。料金はマスタ設定で調整可。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "eximo",
      "url": "https://www.docomo.ne.jp/charge/eximo/",
      "group": "legacy",
      "name": "eximo",
      "tiers": [
        {
          "label": "〜1GB",
          "price": 4565
        },
        {
          "label": "1GB超〜3GB",
          "price": 5665
        },
        {
          "label": "3GB超〜無制限",
          "price": 7315
        }
      ],
      "discounts": {
        "hearty": 1507,
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2025年6月4日新規受付終了。既存契約者の比較・プラン変更提案用。",
      "bakuageTier": "std",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "eximo_poikatsu",
      "group": "legacy",
      "name": "eximo ポイ活",
      "tiers": [
        {
          "label": "無制限",
          "price": 10615
        }
      ],
      "discounts": {
        "hearty": 1507,
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2025年6月4日新規受付終了。d払い/dカード決済3〜10%還元（上限5,000pt/月）。",
      "bakuageTier": "std",
      "poikatsuPt": 5000,
      "maxBonus": false
    },
    {
      "id": "irumo",
      "group": "legacy",
      "name": "irumo",
      "tiers": [
        {
          "label": "0.5GB（割引対象外・最大3Mbps）",
          "price": 550,
          "dOverride": {
            "set": 0,
            "dcard": 0,
            "dcardGold": 0
          }
        },
        {
          "label": "3GB",
          "price": 2167
        },
        {
          "label": "6GB",
          "price": 2827
        },
        {
          "label": "9GB",
          "price": 3377
        }
      ],
      "discounts": {
        "minna2": 0,
        "minna3": 0,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "dcard10": false,
      "note": "2025年6月4日新規受付終了（他プランからの変更受付も終了）。みんなドコモ割はカウントのみ（0.5GBはカウント対象外）。dカードGOLD/PLATINUMの利用料金10%（20%）還元は対象外。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "gigaho_premier",
      "url": "https://www.docomo.ne.jp/charge/5g-gigaho-premier/",
      "group": "legacy",
      "name": "5Gギガホ プレミア",
      "tiers": [
        {
          "label": "〜3GBの月",
          "price": 5665
        },
        {
          "label": "3GB超（無制限）",
          "price": 7315
        }
      ],
      "discounts": {
        "hearty": 1507,
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2023年6月30日新規受付終了。",
      "bakuageTier": "std",
      "poikatsuPt": 0,
      "maxBonus": false
    },
    {
      "id": "gigalite",
      "url": "https://www.docomo.ne.jp/charge/5g-gigalite/",
      "group": "legacy",
      "name": "5Gギガライト／ギガライト",
      "tiers": [
        {
          "label": "〜1GB",
          "price": 3465,
          "dOverride": {
            "set": 0
          }
        },
        {
          "label": "1GB超〜3GB",
          "price": 4565,
          "dOverride": {
            "set": 550
          }
        },
        {
          "label": "3GB超〜5GB",
          "price": 5665
        },
        {
          "label": "5GB超〜7GB",
          "price": 6765
        }
      ],
      "discounts": {
        "hearty": 1507,
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2023年6月30日新規受付終了。光セット割は段階により異なる（〜1GB対象外/〜3GB−550円）。7GB超過後は最大128kbps。",
      "bakuageTier": "",
      "poikatsuPt": 0,
      "maxBonus": false
    }
  ],
  "voiceOptions": [
    {
      "id": "none",
      "name": "通話オプションなし",
      "price": 0
    },
    {
      "id": "v5",
      "url": "https://www.docomo.ne.jp/charge/kakeho_light/",
      "name": "5分通話無料オプション",
      "price": 880
    },
    {
      "id": "kake",
      "url": "https://www.docomo.ne.jp/charge/kakeho/",
      "name": "かけ放題オプション",
      "price": 1980
    },
    {
      "id": "kake1000",
      "name": "かけ放題オプション(1000)",
      "price": 1100
    }
  ],
  "options": [
    {
      "id": "smart_hosho",
      "url": "https://www.docomo.ne.jp/service/smart_anshin_hoshou/",
      "name": "smartあんしん補償",
      "price": 990,
      "priceChoices": [
        330,
        490,
        550,
        605,
        825,
        860,
        990,
        1100,
        1460,
        1720
      ],
      "note": "機種により330〜1,720円（2022/9/15以降発売機種）",
      "category": "補償",
      "carrier": true,
      "own": false
    },
    {
      "id": "anshin_pack",
      "url": "https://www.docomo.ne.jp/service/anshin_pack/",
      "name": "smartあんしんパック",
      "price": 792,
      "priceChoices": [
        792,
        952,
        1012,
        1067,
        1287,
        1322,
        1452,
        1562,
        1922,
        2182
      ],
      "note": "機種により792〜2,182円（smartあんしん補償の月額＋462円）。公式ページで機種の額をご確認ください",
      "category": "補償",
      "carrier": true,
      "own": false
    },
    {
      "id": "imadoco",
      "url": "https://www.docomo.ne.jp/service/imadoco/",
      "name": "イマドコサーチ",
      "price": 330,
      "note": "見守る方に月額がかかります（初回31日間無料）",
      "category": "その他",
      "carrier": true,
      "own": false
    },
    {
      "id": "dvaluepass",
      "url": "https://www.docomo.ne.jp/service/dvaluepass/",
      "name": "dバリューパス パック",
      "price": 682,
      "note": "旧いちおしパック（2026年3月改定・初回31日無料）",
      "category": "バックアップ",
      "carrier": true,
      "own": false
    },
    {
      "id": "op_1784460515071",
      "url": "https://www.docomo.ne.jp/service/anshin_security/",
      "name": "あんしんセキュリティ詐欺電話対策",
      "price": 999,
      "category": "セキュリティ",
      "note": "",
      "carrier": true,
      "own": false
    },
    {
      "id": "op_1784460542023",
      "url": "https://www.docomo.ne.jp/service/anshin_security/",
      "name": "あんしんセキュリティ スタンダード",
      "price": 550,
      "category": "セキュリティ",
      "note": "",
      "carrier": true,
      "own": false
    },
    {
      "id": "op_1784430972981",
      "name": "amazon prime",
      "price": 600,
      "kubunExist": true,
      "category": "エンタメ",
      "note": "ドコモ公式の爆アゲ セレクションの一覧には含まれません。固定120ptとして計算しています（マスタ設定の「固定pt」で変更できます）",
      "own": false,
      "bakuage": 0,
      "bakuage2": 0,
      "bakuageFixed": 120
    },
    {
      "id": "netflix",
      "name": "Netflix",
      "price": 890,
      "priceChoices": [
        890,
        1590,
        2290
      ],
      "priceLabels": {
        "890": "広告つきスタンダード",
        "1590": "スタンダード",
        "2290": "プレミアム"
      },
      "category": "エンタメ",
      "note": "広告つきスタンダード890円／スタンダード1,590円／プレミアム2,290円・爆アゲはMAX系20%（広告つきは15%）／ポイ活20・ahamo・eximo・ギガホは10%",
      "own": false,
      "bakuage": 20,
      "bakuage2": 10
    },
    {
      "id": "bk_disney",
      "url": "https://www.docomo.ne.jp/service/disneyplus/",
      "name": "ディズニープラス",
      "price": 1250,
      "priceChoices": [
        1250,
        1670
      ],
      "priceLabels": {
        "1250": "スタンダード",
        "1670": "プレミアム"
      },
      "category": "エンタメ",
      "note": "スタンダード1,250円／プレミアム1,670円・最大20%還元",
      "carrier": true,
      "own": false,
      "bakuage": 20,
      "bakuage2": 10
    },
    {
      "id": "bk_lemino",
      "url": "https://www.docomo.ne.jp/service/lemino/",
      "name": "Leminoプレミアム",
      "price": 1540,
      "category": "エンタメ",
      "note": "最大20%還元・ドコモ MAX／ポイ活 MAX の選べる特典（毎月2つまで）の対象",
      "carrier": true,
      "own": false,
      "bakuage": 20,
      "bakuage2": 10
    },
    {
      "id": "dazn",
      "url": "https://www.docomo.ne.jp/service/dazn/",
      "name": "DAZN for docomo",
      "price": 4200,
      "category": "エンタメ",
      "note": "ドコモ MAX／ポイ活 MAX の選べる特典（毎月2つまで）の対象。爆アゲ セレクションは新規の適用が終了しています",
      "carrier": true,
      "own": false,
      "bakuage": 0,
      "bakuage2": 0
    },
    {
      "id": "nba",
      "name": "NBA docomo",
      "price": 2728,
      "priceChoices": [
        2728,
        1078
      ],
      "priceLabels": {
        "1078": "ahamo",
        "2728": "通常"
      },
      "category": "エンタメ",
      "note": "通常2,728円／ahamo 1,078円・ドコモ MAX／ポイ活 MAX の選べる特典（毎月2つまで）の対象",
      "carrier": true,
      "own": false
    },
    {
      "id": "bk_spotify",
      "name": "Spotify Premium",
      "price": 1080,
      "category": "エンタメ",
      "note": "最大25%還元",
      "own": false,
      "bakuage": 25,
      "bakuage2": 15
    },
    {
      "id": "bk_youtube",
      "name": "YouTube Premium",
      "price": 1280,
      "category": "エンタメ",
      "note": "最大10%還元",
      "own": false,
      "bakuage": 10,
      "bakuage2": 5
    },
    {
      "id": "bk_jump",
      "name": "週刊少年ジャンプ 定期購読",
      "price": 980,
      "category": "エンタメ",
      "note": "最大20%還元",
      "own": false,
      "bakuage": 20,
      "bakuage2": 10
    },
    {
      "id": "bk_danime",
      "name": "dアニメストア",
      "price": 660,
      "category": "エンタメ",
      "note": "最大10%還元・ドコモ MAX／ポイ活 MAX の選べる特典（毎月2つまで）の対象",
      "carrier": true,
      "own": false,
      "bakuage": 10,
      "bakuage2": 5
    },
    {
      "id": "bk_googleone",
      "name": "Google One",
      "price": 290,
      "priceChoices": [
        290,
        440,
        1450
      ],
      "priceLabels": {
        "290": "ベーシック(100GB)",
        "440": "スタンダード(200GB)",
        "1450": "Google AI Plus(2TB)"
      },
      "category": "エンタメ",
      "note": "ベーシック100GB 290円／スタンダード200GB 440円／Google AI Plus 2TB 1,450円・最大20%還元",
      "own": false,
      "bakuage": 20,
      "bakuage2": 10
    },
    {
      "id": "bk_appleone",
      "name": "Apple One",
      "price": 1200,
      "category": "エンタメ",
      "priceChoices": [
        1200,
        1980
      ],
      "note": "個人1,200/ファミリー1,980・最大10%還元",
      "own": false,
      "bakuage": 10,
      "bakuage2": 5
    },
    {
      "id": "dphoto",
      "name": "dフォト",
      "price": 594,
      "category": "エンタメ",
      "note": "毎月フォトブック1冊／L判プリント30枚／こよみフォト1枚のいずれか・初回31日間無料",
      "carrier": true,
      "own": false
    },
    {
      "id": "dmagazine",
      "name": "dマガジン",
      "price": 580,
      "category": "エンタメ",
      "note": "雑誌読み放題・初回7日間無料",
      "carrier": true,
      "own": false
    },
    {
      "id": "dhits",
      "name": "dヒッツ",
      "price": 690,
      "category": "エンタメ",
      "note": "音楽聴き放題",
      "carrier": true,
      "own": false
    },
    {
      "id": "dhealthcare",
      "name": "dヘルスケア",
      "price": 440,
      "category": "エンタメ",
      "note": "ドコモ公式からのお申し込み・初回31日間無料（App Store／Google Play経由は480円）",
      "carrier": true,
      "own": false
    },
    {
      "id": "op_1785221584602",
      "url": "https://www.docomo.ne.jp/info/news_release/2024/08/13_01.html",
      "name": "あんしん店頭サポート 定額プラン",
      "price": 990,
      "category": "その他",
      "note": "ドコモショップ店頭での対面サポート・月内何度でも（1日1回・1回最大30分）",
      "own": false,
      "carrier": true
    },
    {
      "id": "op_1785221644318",
      "url": "https://www.docomo.ne.jp/info/news_release/2024/08/13_01.html",
      "name": "あんしん店頭サポート 定額ミニプラン",
      "price": 550,
      "category": "その他",
      "note": "ドコモショップ店頭での対面サポート・月2回まで（1日1回・1回最大30分）",
      "own": false,
      "carrier": true
    }
  ],
  "feeItems": [
    {
      "id": "fi_1785221683603",
      "name": "初期設定・データ移行サポート",
      "price": 2200,
      "own": false,
      "pay": "bill",
      "dataMove": true
    },
    {
      "id": "fi_1785221704936",
      "name": "初期設定・データ移行サポート(持ち込み)",
      "price": 3300,
      "own": false,
      "pay": "bill",
      "dataMove": true
    },
    {
      "id": "fi_1785221719101",
      "name": "あんしん店頭サポート（1回プラン）",
      "price": 3300,
      "own": false,
      "pay": "bill",
      "dataMove": true
    }
  ],
  "kaedoki": {
    "note": "23か月目までに返却で残価（24回目分）が不要。返却しない場合は残価を24回に再分割。2026年3月5日以降の加入分は返却時に「プログラム利用料」（機種・手続きにより0〜22,000円）が発生する場合あり。ドコモでの買い替え（機種変更等）なら「ドコモで買替えおトク割」で免除。"
  },
  "campaigns": [
    {
      "id": "u22",
      "name": "ドコモU22割",
      "months": 7,
      "plans": [
        "max"
      ],
      "amountChoices": [
        {
          "label": "〜28GB",
          "a": 2728
        },
        {
          "label": "28GB超〜30GB",
          "a": 3828
        },
        {
          "label": "30GB超〜無制限",
          "a": 550
        }
      ],
      "note": "22歳以下・最大7か月。ボーナスパケット27GB/月付き"
    },
    {
      "id": "u29",
      "name": "ドコモU29割",
      "months": 3,
      "plans": [
        "max"
      ],
      "amountChoices": [
        {
          "label": "〜28GB",
          "a": 2728
        },
        {
          "label": "28GB超〜30GB",
          "a": 3828
        },
        {
          "label": "30GB超〜無制限",
          "a": 550
        }
      ],
      "note": "23〜29歳・最大3か月。ボーナスパケット27GB/月付き"
    },
    {
      "id": "ahamo_max",
      "name": "ahamo→MAXのりかえ割",
      "months": 12,
      "plans": [
        "max",
        "poikatsu_max"
      ],
      "amountChoices": [
        {
          "label": "一律",
          "a": 2750
        }
      ],
      "note": "ahamoを1年以上契約からのプラン変更・12か月間"
    },
    {
      "id": "oyako_u15",
      "name": "ドコモ 親子割（U15）",
      "months": 12,
      "plans": [
        "u15_debut"
      ],
      "amountChoices": [
        {
          "label": "〜5GB",
          "a": 1100
        },
        {
          "label": "5GB超〜20GB",
          "a": 1870
        }
      ],
      "note": "スマホデビュープランU15の契約者・最大12か月（2026-08-07開始）"
    },
    {
      "id": "oyako_family",
      "name": "ドコモ 親子割（家族）",
      "months": 12,
      "plans": [
        "max",
        "poikatsu_max",
        "ahamo"
      ],
      "amountChoices": [
        {
          "label": "一律",
          "a": 550
        }
      ],
      "note": "親子割（U15）適用回線と同一ファミリー割引グループ内・最大12か月。ahamoも対象"
    }
  ],
  "accessories": [],
  "energyCompanies": {
    "denki": [
      {
        "id": "kepco",
        "name": "関西電力",
        "tel": "0800-777-8810"
      },
      {
        "id": "osakagas",
        "name": "大阪ガスのでんき",
        "tel": "0120-000-555"
      },
      {
        "id": "au",
        "name": "auでんき",
        "tel": "0120-925-881"
      },
      {
        "id": "softbank",
        "name": "SoftBankでんき",
        "tel": "0800-170-3710"
      },
      {
        "id": "jcom",
        "name": "J:COM電力",
        "tel": ""
      },
      {
        "id": "eo",
        "name": "eo電気",
        "tel": ""
      },
      {
        "id": "coop",
        "name": "コープでんき",
        "tel": ""
      },
      {
        "id": "stoene",
        "name": "ストエネでんき",
        "tel": ""
      }
    ],
    "gas": [
      {
        "id": "osakagas",
        "name": "大阪ガス",
        "tel": "0120-099-209"
      },
      {
        "id": "kepco",
        "name": "関電ガス",
        "tel": "0800-777-7109"
      },
      {
        "id": "jcom",
        "name": "J:COMガス",
        "tel": ""
      }
    ]
  }
};
