/* =========================================================
 * 料金マスタ（店舗標準フォーマット初期値）
 * 2026-07-23 に本人運用中のマスタ構成を標準として焼き込み。
 * 料金は2026-07-10のドコモ公式調査値ベース＋店舗実売価格。
 * マスタ設定タブの編集(localStorage)がここより優先される。
 * 「マスタを初期値に戻す」でこの標準構成に戻る。
 * ========================================================= */
const DEFAULT_DATA = {
  "updated": "2026-07-23（店舗標準フォーマット・料金は公式調査値ベース）",
  "fees": {
    "jimu_shinki": 4950,
    "jimu_mnp": 4950,
    "jimu_kishu": 4950,
    "atamakin_default": 19800
  },
  "plans": [
    {
      "id": "max",
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
      "note": "3段階制・無制限。エンタメ特典（Lemino/dアニメ/DAZN/NBAから毎月2つ無料）・Amazonプライム最大6か月無料・海外ローミング30GB/15日込み。"
    },
    {
      "id": "poikatsu_max",
      "group": "current",
      "name": "ドコモ ポイ活 MAX",
      "tiers": [
        {
          "label": "無制限",
          "price": 11748
        }
      ],
      "discounts": {
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
      "note": "d払い/dカード決済にポイント還元（PLATINUM10%/GOLD系5%/その他3%・上限5,000pt/月）。還元は月額とは別枠。"
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
        "minna2": 550,
        "minna3": 1210,
        "set": 1210,
        "dcard": 220,
        "dcardGold": 550,
        "denki": 110
      },
      "includes5min": false,
      "note": "還元はPLATINUM5%/GOLD系2%/その他1%・上限2,500pt/月。長期利用割は対象外。"
    },
    {
      "id": "mini",
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
      "note": "小容量プラン。みんなドコモ割・長期利用割は対象外（回線数カウントには含まれる）。"
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
      "note": "5分通話無料込み。各種割引の適用外（みんなドコモ割の回線数カウントには含まれる）。店頭は「WEBお申込みサポート」3,300円/回（オンライン専用プランのため）。"
    },
    {
      "id": "u15",
      "group": "current",
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
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": true,
      "note": "15歳以下・5分通話無料込み。U15はじめてスマホISP割（−165円）は「月額の追加項目」で追加を。U15ポイント特典（5GB:500pt/10GB:1,000pt×最大12か月）あり。みんなドコモ割はカウントのみ。"
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
        "minna2": 0,
        "minna3": 0,
        "set": 0,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "ドコモケータイ（ガラホ・4G LTEケータイ）向け・データ100MB。みんなドコモ割は回線数カウントのみで割引対象外。光セット割・長期利用割も対象外。料金はマスタ設定で調整可。"
    },
    {
      "id": "kids",
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
      "note": "キッズケータイ専用（12歳以下）。国内通話・SMSは家族間無料。各種割引対象外・みんなドコモ割の回線数カウント対象外。料金はマスタ設定で調整可。"
    },
    {
      "id": "dataplus",
      "group": "current",
      "name": "データプラス",
      "tiers": [
        {
          "label": "ペア回線とシェア",
          "price": 1100
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
      "note": "タブレット・2台目端末用のデータ専用プラン。スマホのペア回線とデータ容量をシェア（単独契約不可・音声通話不可）。各種割引対象外。料金はマスタ設定で調整可。"
    },
    {
      "id": "eximo",
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
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2025年6月4日新規受付終了。既存契約者の比較・プラン変更提案用。"
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
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2025年6月4日新規受付終了。d払い/dカード決済3〜10%還元（上限5,000pt/月）。"
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
      "note": "2025年6月4日新規受付終了（他プランからの変更受付も終了）。みんなドコモ割はカウントのみ（0.5GBはカウント対象外）。"
    },
    {
      "id": "gigaho_premier",
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
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2023年6月30日新規受付終了。"
    },
    {
      "id": "gigalite",
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
        "minna2": 550,
        "minna3": 1100,
        "set": 1100,
        "dcard": 187,
        "dcardGold": 187
      },
      "includes5min": false,
      "note": "2023年6月30日新規受付終了。光セット割は段階により異なる（〜1GB対象外/〜3GB−550円）。7GB超過後は最大128kbps。"
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
      "name": "5分通話無料オプション",
      "price": 880
    },
    {
      "id": "kake",
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
      "carrier": true
    },
    {
      "id": "anshin_pack",
      "name": "あんしんパック",
      "price": 462,
      "note": "",
      "category": "補償",
      "carrier": true
    },
    {
      "id": "dvaluepass",
      "name": "dバリューパス パック",
      "price": 682,
      "note": "旧いちおしパック（2026年3月改定・初回31日無料）",
      "category": "バックアップ",
      "carrier": true
    },
    {
      "id": "ag_support",
      "name": "店舗あんしんサポートmini",
      "price": 550,
      "category": "その他"
    },
    {
      "id": "ag_secpack",
      "name": "あんしんセキュリティパック",
      "price": 1650,
      "category": "セキュリティ",
      "carrier": true
    },
    {
      "id": "ag_hozon",
      "name": "hozon",
      "price": 550,
      "category": "バックアップ"
    },
    {
      "id": "ag_connect_p",
      "name": "コネクトα -PLATINUM-",
      "price": 1280,
      "category": "補償"
    },
    {
      "id": "ag_connect",
      "name": "コネクトα -Plus-",
      "price": 550,
      "category": "補償"
    },
    {
      "id": "op_1784430850898",
      "name": "photocube 分割36回払い",
      "price": 919,
      "category": "バックアップ",
      "note": ""
    },
    {
      "id": "op_1784430913381",
      "name": "店頭あんしんサポート定額",
      "price": 990,
      "category": "その他",
      "note": ""
    },
    {
      "id": "op_1784430972981",
      "name": "amazon prime",
      "price": 600,
      "category": "エンタメ",
      "note": ""
    },
    {
      "id": "op_1784430991714",
      "name": "NETFLIX 広告付ST",
      "price": 890,
      "category": "エンタメ",
      "note": ""
    },
    {
      "id": "op_1784431033021",
      "name": "NETFLIX ST",
      "price": 1590,
      "category": "エンタメ",
      "note": ""
    },
    {
      "id": "op_1784431044456",
      "name": "NETFLIX PR",
      "price": 2290,
      "category": "エンタメ",
      "note": ""
    },
    {
      "id": "bk_disney",
      "name": "ディズニープラス（爆アゲ）",
      "price": 1250,
      "category": "エンタメ",
      "note": "スタンダード1,250円〜・最大20%還元"
    },
    {
      "id": "bk_lemino",
      "name": "Leminoプレミアム（爆アゲ）",
      "price": 1540,
      "category": "エンタメ",
      "note": "最大20%還元・MAX系特典適用中は対象外"
    },
    {
      "id": "bk_spotify",
      "name": "Spotify Premium（爆アゲ）",
      "price": 1080,
      "category": "エンタメ",
      "note": "最大25%還元"
    },
    {
      "id": "bk_youtube",
      "name": "YouTube Premium（爆アゲ）",
      "price": 1280,
      "category": "エンタメ",
      "note": "最大10%還元"
    },
    {
      "id": "bk_jump",
      "name": "週刊少年ジャンプ 定期購読（爆アゲ）",
      "price": 980,
      "category": "エンタメ",
      "note": "最大20%還元"
    },
    {
      "id": "bk_danime",
      "name": "dアニメストア（爆アゲ）",
      "price": 660,
      "category": "エンタメ",
      "note": "最大10%還元・MAX系特典適用中は対象外"
    },
    {
      "id": "bk_googleone",
      "name": "Google One（爆アゲ）",
      "price": 290,
      "category": "エンタメ",
      "note": "290円〜（容量による）・最大20%還元"
    },
    {
      "id": "bk_appleone",
      "name": "Apple One（爆アゲ）",
      "price": 1200,
      "category": "エンタメ",
      "priceChoices": [
        1200,
        1980
      ],
      "note": "個人1,200/ファミリー1,980・最大10%還元"
    },
    {
      "id": "op_1784460515071",
      "name": "あんしんセキュリティ詐欺電話対策",
      "price": 999,
      "category": "セキュリティ",
      "note": "",
      "carrier": true
    },
    {
      "id": "op_1784460542023",
      "name": "あんしんセキュリティ スタンダード",
      "price": 550,
      "category": "セキュリティ",
      "note": "",
      "carrier": true
    }
  ],
  "feeItems": [
    {
      "id": "fi_1784431925115",
      "name": "初期設定・データ移行サポート",
      "price": 2200,
      "pay": "bill"
    },
    {
      "id": "ag_setup",
      "name": "初期設定・データ移行サポート(持ち込み)",
      "price": 3300,
      "pay": "bill"
    },
    {
      "id": "fi_1784460259803",
      "name": "あんしん店頭サポート/回",
      "price": 3300,
      "pay": "bill"
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
    }
  ],
  "accessories": [
    {
      "id": "acc_charger",
      "name": "AC09(充電器)",
      "price": 3720
    },
    {
      "id": "acc_1784460319154",
      "name": "ACアダプタ(apple)",
      "price": 2728
    },
    {
      "id": "acc_1784460060451",
      "name": "ハルトコーティング(両面)",
      "price": 6600
    },
    {
      "id": "acc_1784460083417",
      "name": "ハルトコーティング(片面)",
      "price": 4400
    },
    {
      "id": "acc_1784850167723",
      "name": "ACアダプタ",
      "price": 2420
    }
  ]
};
