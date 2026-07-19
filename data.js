/* =========================================================
 * 料金マスタ（初期値）
 * すべて税込。2026年7月10日にドコモ公式（docomo.ne.jp）・ahamo公式を
 * Web調査し、独立検証を通した確定値。
 * マスタ設定タブでの編集は localStorage に保存され、ここより優先される。
 * ========================================================= */
const DEFAULT_DATA = {
  updated: "2026-07-10（公式サイト調査・相互検証済み）",

  fees: {
    jimu_shinki: 4950,   // 契約事務手数料: 新規（店頭・2025年9月5日改定）
    jimu_mnp: 4950,      // MNP（店頭）※Web手続きは無料
    jimu_kishu: 4950,    // 機種変更（店頭）
    atamakin_default: 22000, // 店頭頭金の初期値（本人設定値。店舗ごとにマスタ設定タブで変更可）
  },

  /* --- 料金プラン ---
   * tiers: 段階制プランは複数。tier.dOverride で段階ごとに割引を上書き可
   *        （例: irumo 0.5GB は割引対象外、ギガライト〜1GBは光割対象外）。
   * discounts: 割引額（0 = 対象外）
   *   minna2 / minna3 : みんなドコモ割（2回線 / 3回線以上）
   *   set             : ドコモ光セット割 / home 5G セット割
   *   dcard           : dカードお支払割（通常dカード）
   *   dcardGold       : dカードお支払割（GOLD U / GOLD / PLATINUM）
   *   denki           : ドコモでんきセット割
   *   choki10/choki20 : 長期利用割（10年以上 / 20年以上）※MAX・ポイ活MAXのみ
   * includes5min: 5分通話無料が標準込み
   * voiceOverrides: プラン固有の通話オプション価格（例: ahamoかけ放題1,100円）
   */
  plans: [
    {
      id: "max", group: "current", name: "ドコモ MAX",
      tiers: [
        { label: "〜1GB", price: 5698 },
        { label: "1GB超〜3GB", price: 6798 },
        { label: "3GB超〜無制限", price: 8448 },
      ],
      discounts: { minna2: 550, minna3: 1210, set: 1210, dcard: 220, dcardGold: 550, denki: 110, choki10: 110, choki20: 220 },
      includes5min: false,
      note: "3段階制・無制限。エンタメ特典（Lemino/dアニメ/DAZN/NBAから毎月2つ無料）・Amazonプライム最大6か月無料・海外ローミング30GB/15日込み。",
    },
    {
      id: "poikatsu_max", group: "current", name: "ドコモ ポイ活 MAX",
      tiers: [{ label: "無制限", price: 11748 }],
      discounts: { minna2: 550, minna3: 1210, set: 1210, dcard: 220, dcardGold: 550, denki: 110, choki10: 110, choki20: 220 },
      includes5min: false,
      note: "d払い/dカード決済にポイント還元（PLATINUM10%/GOLD系5%/その他3%・上限5,000pt/月）。還元は月額とは別枠。",
    },
    {
      id: "poikatsu_20", group: "current", name: "ドコモ ポイ活 20",
      tiers: [
        { label: "〜20GB", price: 7898 },
        { label: "20GB超〜無制限", price: 9570 },
      ],
      discounts: { minna2: 550, minna3: 1210, set: 1210, dcard: 220, dcardGold: 550, denki: 110 },
      includes5min: false,
      note: "還元はPLATINUM5%/GOLD系2%/その他1%・上限2,500pt/月。長期利用割は対象外。",
    },
    {
      id: "mini", group: "current", name: "ドコモ mini",
      tiers: [
        { label: "4GB", price: 2750 },
        { label: "10GB", price: 3850 },
      ],
      discounts: { minna2: 0, minna3: 0, set: 1210, dcard: 220, dcardGold: 550, denki: 110 },
      includes5min: false,
      note: "小容量プラン。みんなドコモ割・長期利用割は対象外（回線数カウントには含まれる）。",
    },
    {
      id: "ahamo", group: "current", name: "ahamo",
      tiers: [
        { label: "30GB", price: 2970 },
        { label: "110GB（大盛りオプション込み）", price: 4950 },
      ],
      discounts: { minna2: 0, minna3: 0, set: 0, dcard: 0, dcardGold: 0 },
      includes5min: true,
      voiceOverrides: { kake: 1100 },
      note: "5分通話無料込み。各種割引の適用外（みんなドコモ割の回線数カウントには含まれる）。店頭は「WEBお申込みサポート」3,300円/回（オンライン専用プランのため）。",
    },
    {
      id: "u15", group: "current", name: "U15はじめてスマホプラン",
      tiers: [
        { label: "5GB", price: 1980 },
        { label: "10GB", price: 2860 },
      ],
      discounts: { minna2: 0, minna3: 0, set: 0, dcard: 187, dcardGold: 187 },
      includes5min: true,
      note: "15歳以下・5分通話無料込み。U15はじめてスマホISP割（−165円）は「月額の追加項目」で追加を。U15ポイント特典（5GB:500pt/10GB:1,000pt×最大12か月）あり。みんなドコモ割はカウントのみ。",
    },
    {
      id: "eximo", group: "legacy", name: "eximo",
      tiers: [
        { label: "〜1GB", price: 4565 },
        { label: "1GB超〜3GB", price: 5665 },
        { label: "3GB超〜無制限", price: 7315 },
      ],
      discounts: { minna2: 550, minna3: 1100, set: 1100, dcard: 187, dcardGold: 187 },
      includes5min: false,
      note: "2025年6月4日新規受付終了。既存契約者の比較・プラン変更提案用。",
    },
    {
      id: "eximo_poikatsu", group: "legacy", name: "eximo ポイ活",
      tiers: [{ label: "無制限", price: 10615 }],
      discounts: { minna2: 550, minna3: 1100, set: 1100, dcard: 187, dcardGold: 187 },
      includes5min: false,
      note: "2025年6月4日新規受付終了。d払い/dカード決済3〜10%還元（上限5,000pt/月）。",
    },
    {
      id: "irumo", group: "legacy", name: "irumo",
      tiers: [
        { label: "0.5GB（割引対象外・最大3Mbps）", price: 550, dOverride: { set: 0, dcard: 0, dcardGold: 0 } },
        { label: "3GB", price: 2167 },
        { label: "6GB", price: 2827 },
        { label: "9GB", price: 3377 },
      ],
      discounts: { minna2: 0, minna3: 0, set: 1100, dcard: 187, dcardGold: 187 },
      includes5min: false,
      note: "2025年6月4日新規受付終了（他プランからの変更受付も終了）。みんなドコモ割はカウントのみ（0.5GBはカウント対象外）。",
    },
    {
      id: "gigaho_premier", group: "legacy", name: "5Gギガホ プレミア",
      tiers: [
        { label: "〜3GBの月", price: 5665 },
        { label: "3GB超（無制限）", price: 7315 },
      ],
      discounts: { minna2: 550, minna3: 1100, set: 1100, dcard: 187, dcardGold: 187 },
      includes5min: false,
      note: "2023年6月30日新規受付終了。",
    },
    {
      id: "gigalite", group: "legacy", name: "5Gギガライト／ギガライト",
      tiers: [
        { label: "〜1GB", price: 3465, dOverride: { set: 0 } },
        { label: "1GB超〜3GB", price: 4565, dOverride: { set: 550 } },
        { label: "3GB超〜5GB", price: 5665 },
        { label: "5GB超〜7GB", price: 6765 },
      ],
      discounts: { minna2: 550, minna3: 1100, set: 1100, dcard: 187, dcardGold: 187 },
      includes5min: false,
      note: "2023年6月30日新規受付終了。光セット割は段階により異なる（〜1GB対象外/〜3GB−550円）。7GB超過後は最大128kbps。",
    },
  ],

  voiceOptions: [
    { id: "none", name: "通話オプションなし", price: 0 },
    { id: "v5", name: "5分通話無料オプション", price: 880 },
    { id: "kake", name: "かけ放題オプション", price: 1980 },
    { id: "kake1000", name: "かけ放題オプション(1000)", price: 1100 },
  ],

  /* --- オプション・サービス（キャリア・代理店を区別せず1リスト・すべて月額） ---
   * priceChoices があるものは見積もり画面で金額を選択できる（機種別料金など）
   * マスタ設定タブで追加・削除・並び替え可。
   * 一括で払うもの（コーティング施工・手数料など）はここではなく feeItems へ。
   */
  options: [
    { id: "smart_hosho", name: "smartあんしん補償", price: 990, category: "補償",
      priceChoices: [330, 490, 550, 605, 825, 860, 990, 1100, 1460, 1720],
      note: "機種により330〜1,720円（2022/9/15以降発売機種）" },
    { id: "keitai_hosho", name: "ケータイ補償サービス", price: 825, category: "補償",
      priceChoices: [363, 550, 825, 1100],
      note: "機種により363〜1,100円（2022/8/31以前発売機種）" },
    { id: "ag_support", name: "店舗あんしんサポート", price: 550, category: "補償" },
    { id: "ag_hozon", name: "hozon", price: 550, category: "バックアップ" },
    { id: "anshin_pack", name: "あんしんパック", price: 462, category: "セキュリティ", note: "" },
    { id: "ag_secpack", name: "あんしんセキュリティパック", price: 1650, category: "セキュリティ" },
    { id: "dvaluepass", name: "dバリューパス パック", price: 682, category: "エンタメ", note: "旧いちおしパック（2026年3月改定・初回31日無料）" },
    { id: "ag_connect_p", name: "コネクトα -PLATINUM-", price: 1280, category: "エンタメ" },
    { id: "ag_connect", name: "コネクトα -Plus-", price: 550, category: "エンタメ" },
    { id: "docomomail", name: "ドコモメールオプション", price: 330, category: "その他", note: "ahamo・irumo等でドコモメールを利用" },
    /* 爆アゲ セレクション対象サブスク（2026-07-19 公式ページ確認。還元はdポイント期間・用途限定・税抜額基準）
     * MAX/ポイ活MAX契約者の還元率: Disney+/Netflix/Lemino/ジャンプ/Google One/Switch 20%・Spotify 25%・YouTube/dアニメ/Apple One 10%
     * （ポイ活20/ahamo/eximo/ギガホは概ね半分。Nintendo Switch Onlineは都度購入型のため未収載） */
    /* ↓本人登録分（idは本人環境のlocalStorageと揃えてある＝重複追記防止） */
    { id: "op_1784430972981", name: "amazon prime", price: 600, category: "エンタメ", note: "ドコモMAX特典で最大6か月無料あり" },
    { id: "op_1784430991714", name: "NETFLIX 広告付ST", price: 890, category: "エンタメ", note: "爆アゲ対象・最大15%還元" },
    { id: "op_1784431033021", name: "NETFLIX ST", price: 1590, category: "エンタメ", note: "爆アゲ対象・最大20%還元" },
    { id: "op_1784431044456", name: "NETFLIX PR", price: 2290, category: "エンタメ", note: "爆アゲ対象・最大20%還元" },
    { id: "bk_disney", name: "ディズニープラス（爆アゲ）", price: 1250, category: "エンタメ", note: "スタンダード1,250円〜・最大20%還元" },
    { id: "bk_lemino", name: "Leminoプレミアム（爆アゲ）", price: 1540, category: "エンタメ", note: "最大20%還元・MAX系特典適用中は対象外" },
    { id: "bk_spotify", name: "Spotify Premium（爆アゲ）", price: 1080, category: "エンタメ", note: "最大25%還元" },
    { id: "bk_youtube", name: "YouTube Premium（爆アゲ）", price: 1280, category: "エンタメ", note: "最大10%還元" },
    { id: "bk_jump", name: "週刊少年ジャンプ 定期購読（爆アゲ）", price: 980, category: "エンタメ", note: "最大20%還元" },
    { id: "bk_danime", name: "dアニメストア（爆アゲ）", price: 660, category: "エンタメ", note: "最大10%還元・MAX系特典適用中は対象外" },
    { id: "bk_googleone", name: "Google One（爆アゲ）", price: 290, category: "エンタメ", note: "290円〜（容量による）・最大20%還元" },
    { id: "bk_appleone", name: "Apple One（爆アゲ）", price: 1200, category: "エンタメ",
      priceChoices: [1200, 1980], note: "個人1,200/ファミリー1,980・最大10%還元" },
  ],

  /* 初期費用の定番項目（手数料・コーティング施工など契約時一括のもの。⑤にチェックボックスで表示） */
  feeItems: [
    { id: "fee_sim", name: "SIM／eSIM再発行（店頭）", price: 4950 },
    { id: "ag_coating", name: "ハルトコーティング両面", price: 6600 },
    { id: "ag_coating_s", name: "ハルトコーティング片面", price: 4400 },
    { id: "ag_setup", name: "初期設定・データ移行サポート", price: 3300 },
  ],

  kaedoki: {
    note: "23か月目までに返却で残価（24回目分）が不要。返却しない場合は残価を24回に再分割。2026年3月5日以降の加入分は返却時に「プログラム利用料」（機種・手続きにより0〜22,000円）が発生する場合あり。ドコモでの買い替え（機種変更等）なら「ドコモで買替えおトク割」で免除。",
  },
};
