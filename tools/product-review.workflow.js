export const meta = {
  name: 'frontalk-product-review',
  description: 'フロントーク製品化レビュー: 13の観点で欠点を洗い出し、反証で確定し、優先順位付きの改善計画を日本語でまとめる',
  whenToUse: '製品化・大規模展開の前に、アプリ・運用・契約・保守の弱点を網羅的に洗い直すとき',
  phases: [
    { title: '理解', detail: '6人の読み手が担当領域の地図を作る' },
    { title: '発見', detail: '13の観点ごとに欠点・改善点を挙げる' },
    { title: '反証', detail: '1件ごとに別々の視点で反証し、生き残ったものだけ確定' },
    { title: '補完', detail: '見落とした観点を洗い出して追加で探す' },
    { title: '統合', detail: '優先順位付きの改善計画を日本語のレポートに' },
  ],
}

/* ───────────────────────────────────────────────────────────────
 * フロントーク 製品化レビュー（指示書）
 *
 * 使い方（安藤さんは「製品化レビューの指示書を実行して」と言うだけ）:
 *   Workflow({ scriptPath: '/home/user/docomo-quote/tools/product-review.workflow.js',
 *              args: { date: 'YYYY-MM-DD', reportPath: '<レポートの保存先>' } })
 *
 * 方針:
 *   ・コードを実際に読んで根拠（ファイル:行）を示す。推測で書かない
 *   ・「既知の課題」は再発見して騒がない。ただし本当に未解決かは検証する
 *   ・自動で修正はしない。成果物は「改善計画のレポート」だけ
 *   ・読み手は開発が本業でない方。レポートは専門用語を避けた日本語で
 * ─────────────────────────────────────────────────────────────── */

const DATE = (args && args.date) || '日付未指定'
const REPORT_PATH = (args && args.reportPath) || '/workspace/docomo-quote-internal/PRODUCT_REVIEW_' + DATE + '.md'
const ROOT = '/home/user/docomo-quote'
const INTERNAL = '/workspace/docomo-quote-internal'

/* 既知の課題・前提（見つけても「新発見」として数えない。ただし未解決かは検証してよい） */
const KNOWN = [
  'ガスが大阪ガス固定・でんきが関西圏前提（HANDOVER.md に記載。製品化では店舗ごとに設定できる必要がある）',
  'Firebase は無料枠（Spark）。多店舗展開時は Blaze への切替が必要（契約本決まり時に行う方針）',
  'イエナカ常盤東店版の同期は recipe-box 側のルール追記が未了（SYNC_DIFF.md）',
  'ZTV（ケーブルテレビ）の詳細は保留中',
  'ドコモ 2026年12月改定（ポイ活プランの還元対象額、PLATINUM の光還元最大12%）の計算切替は 11/20 に実装予定。10月のでんきGreen改定はアプリで計算していないため対応不要',
  'リポジトリは public（hisapiyp622-alt/docomo-quote）。内部資料は別の非公開リポジトリ',
  '保守用アカウントの UID が firestore.rules に直書き（設計として承知の上）',
  'keitai-app/app.js は約12,000行の単一ファイル（ES5・IIFE・フレームワーク無し）',
  '料金の自動監視（tools/docomo-watch.py）は 2026-09-01 に RSS 8本へ拡大済み',
  '約款一式は 2026-08-27 改定済み（TERMS/LICENSE/PRIVACY/SUPPORT）',
]

/* ───────── 出力の型 ───────── */
const MAP_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    summary: { type: 'string', description: '担当領域の要点（日本語・1200字以内）。主要な関数名・ファイル:行・データの流れ・気になった点' },
    hotspots: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, line: { type: 'integer' }, note: { type: 'string' } }, required: ['file', 'note'] } },
  },
  required: ['area', 'summary', 'hotspots'],
}
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string', description: '欠点の一言（40字以内）' },
      dimension: { type: 'string' },
      severity: { type: 'string', enum: ['致命', '重大', '中', '軽'] },
      file: { type: 'string' },
      line: { type: 'integer' },
      evidence: { type: 'string', description: '根拠。コードや文書の該当箇所を引用して、なぜそう言えるか' },
      impact: { type: 'string', description: '製品として売る・多店舗で使うときに何が起きるか（店舗・お客様・販売側の視点で具体的に）' },
      fix: { type: 'string', description: '改善案（何をどう直すか）' },
      effort: { type: 'string', enum: ['小', '中', '大'] },
      confidence: { type: 'number', description: '0〜1' },
      known: { type: 'boolean', description: '既知の課題リストに含まれる内容なら true' },
    }, required: ['title', 'dimension', 'severity', 'file', 'evidence', 'impact', 'fix', 'effort', 'confidence', 'known'] } },
    coverage_note: { type: 'string', description: '何を読み、何を読めなかったか（正直に）' },
  },
  required: ['findings', 'coverage_note'],
}
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    severity: { type: 'string', enum: ['致命', '重大', '中', '軽'], description: '検証後に妥当と思う重さ' },
  },
  required: ['refuted', 'reason', 'severity'],
}
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    missing_angles: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, prompt: { type: 'string', description: 'その観点で探すための具体的な指示（日本語）' } },
      required: ['name', 'prompt'] } },
    unverified_claims: { type: 'array', items: { type: 'string' } },
  },
  required: ['missing_angles', 'unverified_claims'],
}

/* ───────── 共通の前置き ───────── */
const PREAMBLE = `あなたはフロントーク（ドコモショップ向けの料金見積もりアプリ・PWA）の製品化レビューの担当です。
リポジトリ: ${ROOT}（keitai-app=ケータイ見積もり本体, ienaka-app=イエナカ単体版, dakkan-app=別製品（今回は対象外）, tools=ビルド・監視, tests=自動テスト, keitai-app/*.md=約款類, HANDOVER*.md=引き継ぎ, CLAUDE.md=開発の決まり）。
内部資料: ${INTERNAL}（存在すれば読む。無ければ無視）。
必ず実物のコード・文書を読んで根拠を示すこと（ファイル:行）。推測や一般論は書かない。
既知の課題（新発見として数えない）:\n- ${KNOWN.join('\n- ')}`

/* ───────── 理解フェーズの分担 ───────── */
const AREAS = [
  { key: 'core', name: '本体の骨格', prompt: 'keitai-app/app.js の全体構造: 状態(state/store/patterns)の持ち方、保存(localStorage)、画面描画の流れ、起動処理(bootIntegrityCheck など)、担当者・マスタの関門、成約実績の集計。行番号付きで主要関数を列挙する。' },
  { key: 'calc', name: '金額計算と料金データ', prompt: 'keitai-app/data.js（標準料金表）と keitai-app/app.js の calcFor/calc まわり: プラン・割引・オプション・端末分割・ポイント・税の計算の流れ、マスタ(MASTER)と標準データの関係、tests/run-calc-tests.js が何を検算しているか。' },
  { key: 'cloud', name: 'クラウド同期と権限', prompt: 'keitai-app/app.js の CLOUD/Firebase まわり（ログイン、stores/quotes/saved/templates/history の読み書き、contracts と roles、superActing/effectiveUid、detachActingStore、wipeStoreLocal）と keitai-app/firestore.rules。誰が何を読め・書けるか、オフライン時・競合時に何が起きるか。' },
  { key: 'ienaka', name: '光・5G と PWA 配信', prompt: 'keitai-app/ienaka.js と ienaka-app/app.js（重複の度合い、同期先 recipe-box）、keitai-app/sw.js と ienaka-app/sw.js（キャッシュ更新の仕組み）、tools/build-internal.js と tools/build-product.js（社内版と出荷版の違い、何を除いているか）。' },
  { key: 'ops', name: 'テスト・CI・リリース・監視', prompt: 'tests/ の3本、.github/workflows/ci.yml、CLAUDE.md のリリース手順、tools/docomo-watch.py と docomo-watch-sync.sh。何が自動で守られていて、何が人の手順に依存しているか。' },
  { key: 'docs', name: '文書・契約・運用資料', prompt: 'keitai-app/TERMS.md LICENSE.md PRIVACY.md SUPPORT.md README.md STATS_GUIDE.md、HANDOVER.md、HANDOVER-CURACON.md、（あれば）内部資料の OPERATIONS.md APPLICATION_FORM.md CONTRACT_CURACON.md SALES.md SETUP.md LOGIN_HIERARCHY.md。実装と食い違う記述、古くなった記述、抜けている手順。' },
]

/* ───────── 発見フェーズの観点（13） ───────── */
const DIMENSIONS = [
  { key: 'security', name: 'セキュリティ・権限', prompt: 'Firestore ルールの穴、店舗間のデータ分離、上位アカウント・保守アカウントの権限、innerHTML 等による表示の脆弱さ、公開リポジトリに置いてはいけない情報、認証情報の扱い、想定外のクライアントからの書き込み。' },
  { key: 'data', name: 'データ保全・同期', prompt: 'オフライン→オンライン復帰時の上書き・競合、端末間同期の一貫性、端末の保存領域が消えるケース（wipe/切替/バージョン移行）、バックアップと復元の手段、契約停止・お試し切れのときのデータの扱い、保存件数が増えたときの限界。' },
  { key: 'calc', name: '金額計算の正しさ', prompt: '計算の条件分岐の抜け（割引の重複・排他、端数、税、分割回数、ポイント充当の順序、キャンペーンの期間）、data.js の料金が現行のドコモ公式と合っているか（公式ページの確認は可）、テストの網羅性（tests/run-calc-tests.js が守れていない組み合わせ）。' },
  { key: 'docomo', name: 'ドコモ改定への追従', prompt: '料金改定が出たとき、標準データ・各店舗のマスタ・見積書の文言のどこをどう直す必要があるか、その経路に属人性や漏れがないか、日付付きの改定（例: 12月から）を扱う仕組みの有無、監視→反映→配信の流れの弱点。' },
  { key: 'ux', name: '店頭の使い勝手・業務適合', prompt: '接客中の入力の速さ、誤操作の起きやすさ（消える・戻せない）、見積書・引き継ぎシートの読みやすさと印刷、タブレット/スマホでの操作、担当者切替、成約実績の入力負担、初めての店員が迷う点。実際の画面（index.html/style.css）と描画コードから判断する。' },
  { key: 'multi', name: '多店舗・多代理店への展開', prompt: '店舗ごとに変えたい設定（ガス・でんき・エリア・提携CATV・機種・キャンペーン）を変えられるか、店舗別の機能フラグ、開通（オンボーディング）と初期設定の手順の重さ、上位アカウント運用、13店舗→100店舗になったときの Firestore の読み書き量・費用・管理の破綻点。' },
  { key: 'reliability', name: '信頼性・更新の配信', prompt: 'PWA の更新の谷間（古いHTML+新しいJS）、bootIntegrityCheck の限界、配信のロールバック手段、エラーの収集・監視が無いことの影響、ログ、障害時にサポートが原因を追える設計か、frontalk（出荷版）と社内版の二重管理のリスク。' },
  { key: 'maintain', name: '保守性・引き継ぎ可能性', prompt: '12,000行の単一ファイル・グローバル状態・ES5 の構造が、開発者交代や機能追加のときにどう効くか。テスト戦略の穴、ビルド手順の属人性、CLAUDE.md/HANDOVER の充足度、命名・重複コード（ienaka の二重実装）、依存の少なさの利点と欠点。' },
  { key: 'legal', name: '法務・契約・個人情報', prompt: '約款・プラポリ・使用許諾・サポート規定と実装の食い違い、個人情報（お客様名・電話・請求内訳の読み取り）の保存先と扱い、商標表記、見積書の免責文、料金誤りの責任の所在、公開リポジトリと契約書の関係。' },
  { key: 'sales', name: '販売・導入・サポートの運用', prompt: '契約→開通→研修→日常サポート→停止・解約の流れで、手順が無い・人に依存する・時間がかかる箇所。お試し課金の起算、停止時のアプリの挙動、問い合わせ導線、FAQ、店舗が自力で解決できる範囲。内部資料の OPERATIONS/APPLICATION_FORM/SALES と実装を突き合わせる。' },
  { key: 'perf', name: '性能・端末互換・アクセシビリティ', prompt: '古い iPad/Android・低速回線・低メモリでの起動と操作、描画の重さ（innerHTML の全再描画など）、印刷の崩れ、文字サイズ、色のみで区別している箇所、キーボード操作、画面の小ささ。' },
  { key: 'product', name: '製品としての完成度・差別化', prompt: '機能の穴（競合や店舗の現場から見て「無いと困る」もの）、デモ・営業資料と実物の差、命名やブランドの一貫性（フロントーク/ケータイ見積もり/イエナカ）、更新履歴やヘルプの分かりやすさ、ドコモ公式ツールとの関係で誤解を招く点。' },
  { key: 'known', name: '既知の課題の再検証', prompt: '既知の課題リストとHANDOVER.md・内部資料のTODOを1つずつ、いまも未解決か・解決済みか・状況が変わったかをコードで確認する。未解決のものは、製品化の観点で重さを付け直す（known=true で報告）。' },
]

const understandPrompt = (a) => `${PREAMBLE}

【役割: 理解フェーズ／担当領域「${a.name}」】
${a.prompt}
読んだ結果を、あとで13人の調査担当が短時間で全体を掴めるよう、要点と「気になった点」を行番号付きでまとめてください。評価や改善案はここでは書かず、事実だけ。`

const findPrompt = (d, mapText) => `${PREAMBLE}

【役割: 発見フェーズ／観点「${d.name}」】
${d.prompt}

先に理解フェーズが作った地図（参考。必ず自分でも該当コードを読むこと）:
${mapText}

指示:
- この観点で、製品として売る・多店舗で使うときの欠点と改善点を、根拠付きで挙げる。件数の上限は設けない。見つかった分だけ
- 1件ごとに severity（致命=売ってはいけない/データや金額を壊す, 重大=導入後すぐ問題になる, 中=規模が増えると効く, 軽=あると良い）と effort を付ける
- 既知の課題は known=true。同じ内容を新発見のように書かない
- 確信の持てない指摘は confidence を下げて正直に書く（あとで別の担当が反証する）
- 一般論・想像・「〜かもしれない」だけの指摘は書かない`

const LENSES = {
  fact: (f) => `${PREAMBLE}

【役割: 反証フェーズ／視点「事実確認」】
次の指摘が事実として正しいか、該当箇所のコード・文書を実際に読んで確かめてください。存在しない挙動・読み違い・古い情報なら refuted=true。
迷ったら refuted=true（確信が持てない指摘は残さない）。

指摘: ${f.title}
場所: ${f.file}${f.line ? ':' + f.line : ''}
根拠: ${f.evidence}
影響: ${f.impact}`,
  product: (f) => `${PREAMBLE}

【役割: 反証フェーズ／視点「製品化の観点で本当に問題か」】
次の指摘は、ドコモショップで店員が毎日使い、代理店が複数店舗に売る製品として、実際に困ることか。
「理屈上の懸念」「起きる確率が極めて低い」「店舗運用で自然に吸収される」なら refuted=true。困るなら refuted=false とし、重さを付け直す。

指摘: ${f.title}
場所: ${f.file}${f.line ? ':' + f.line : ''}
根拠: ${f.evidence}
影響: ${f.impact}
改善案: ${f.fix}`,
  handled: (f) => `${PREAMBLE}

【役割: 反証フェーズ／視点「すでに対策済み・意図的な設計ではないか」】
次の指摘が、別の場所ですでに対策されている、CLAUDE.md や HANDOVER.md・changelog.js・内部資料で意図的な設計として説明されている、または既知の課題の言い換えに過ぎないなら refuted=true。
未対策・未記載なら refuted=false。

指摘: ${f.title}
場所: ${f.file}${f.line ? ':' + f.line : ''}
根拠: ${f.evidence}`,
}

const key = (f) => ((f.file || '') + '|' + (f.title || '').replace(/[\s　、。・「」（）()]/g, '').slice(0, 24))

async function verifyAll(findings, phaseName) {
  /* 人数を抑えつつ厳しさは保つ:
   *   致命・重大 → 事実確認＋対策済みか の2人。両方が残して確定
   *   中・軽     → 事実確認 1人。棄却なら落とす
   *   軽で自信の低いもの（confidence < 0.5）は反証前に落とす（人数の節約） */
  // 軽は反証せず「未検証（参考）」としてレポートに回す（利用枠の節約。呼び出し側で扱う）
  const targets = findings.filter((f) => f.severity !== '軽')
  return await parallel(targets.map((f) => async () => {
    const heavy = f.severity === '致命' || f.severity === '重大'
    const lenses = heavy ? ['fact', 'handled'] : ['fact']
    const votes = (await parallel(lenses.map((l) => () =>
      agent(LENSES[l](f), { label: `反証:${l}:${f.title.slice(0, 18)}`, phase: phaseName, schema: VERDICT_SCHEMA, effort: heavy ? 'medium' : 'low' })
    ))).filter(Boolean)
    if (!votes.length) return null
    const survives = votes.every((v) => !v.refuted)
    const order = ['致命', '重大', '中', '軽']
    // 反証担当が付け直した重さのうち、最も軽いものを採用（甘くしない）
    const idx = votes.map((v) => order.indexOf(v.severity)).filter((i) => i >= 0)
    const finalSev = order[Math.max(...idx, order.indexOf(f.severity))] || f.severity
    return { ...f, severity: finalSev, survives, votes: votes.map((v) => ({ refuted: v.refuted, reason: v.reason })) }
  }))
}

/* ───────── 実行 ───────── */
log(`製品化レビュー開始（${DATE}）。理解 6 → 発見 ${DIMENSIONS.length} → 反証 → 補完 → 統合`)

phase('理解')
const maps = (await parallel(AREAS.map((a) => () =>
  agent(understandPrompt(a), { label: `理解:${a.name}`, phase: '理解', schema: MAP_SCHEMA })
))).filter(Boolean)
const mapText = maps.map((m) => `■ ${m.area}\n${m.summary}\n気になった点: ${m.hotspots.map((h) => `${h.file}${h.line ? ':' + h.line : ''} ${h.note}`).join(' / ')}`).join('\n\n')
log(`理解フェーズ完了: ${maps.length}/${AREAS.length} 領域`)

phase('発見')
const seen = new Set()
const confirmed = []
const rejected = []
const unverified = []   // 軽（反証を省略したもの）
let coverageNotes = []

async function findAndVerify(dims, phaseFind, phaseVerify) {
  const found = (await parallel(dims.map((d) => () =>
    agent(findPrompt(d, mapText), { label: `発見:${d.name}`, phase: phaseFind, schema: FINDINGS_SCHEMA })
  ))).filter(Boolean)
  coverageNotes.push(...found.map((r, i) => `${dims[i] ? dims[i].name : '?'}: ${r.coverage_note}`))
  const all = found.flatMap((r) => r.findings)
  const fresh = all.filter((f) => { const k = key(f); if (seen.has(k)) return false; seen.add(k); return true })
  const light = fresh.filter((f) => f.severity === '軽')
  unverified.push(...light)
  log(`${phaseFind}: ${all.length} 件（重複除去後 ${fresh.length} 件、うち軽 ${light.length} 件は未検証扱い）→ 反証へ`)
  const verified = (await verifyAll(fresh, phaseVerify)).filter(Boolean)
  const ok = verified.filter((v) => v.survives)
  confirmed.push(...ok)
  rejected.push(...verified.filter((v) => !v.survives))
  log(`${phaseVerify}: ${ok.length} 件確定 / ${verified.length - ok.length} 件棄却`)
  return ok.length
}

await findAndVerify(DIMENSIONS, '発見', '反証')

phase('補完')
let round = 0
while (round < 1) {
  round++
  const critic = await agent(`${PREAMBLE}

【役割: 補完フェーズ／完全性の批評】
ここまでに確定した指摘の一覧です:
${confirmed.map((f) => `- [${f.severity}] ${f.title}（${f.file}）`).join('\n')}

各観点の担当が「読めなかった・見られなかった」と申告した内容:
${coverageNotes.join('\n')}

問い: 製品化レビューとして、まだ探していない観点・読まれていないファイル・検証されていない主張は何か。
最大6つの「追加で探すべき観点」を、具体的な調査指示（どのファイルの何を、どういう目でみるか）付きで挙げてください。もう十分なら空配列でよい。`,
    { label: `補完:批評 第${round}回`, phase: '補完', schema: CRITIC_SCHEMA })
  if (!critic || !critic.missing_angles.length) { log(`補完 第${round}回: 追加観点なし`); break }
  log(`補完 第${round}回: 追加観点 ${critic.missing_angles.length} 件`)
  const extra = critic.missing_angles.slice(0, 4).map((m, i) => ({ key: `extra${round}_${i}`, name: m.name, prompt: m.prompt }))
  const added = await findAndVerify(extra, '補完', '補完')
  if (!added) { log(`補完 第${round}回: 新たな確定なし → 打ち切り`); break }
}

phase('統合')
const order = ['致命', '重大', '中', '軽']
confirmed.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
const summaryCounts = order.map((s) => `${s} ${confirmed.filter((f) => f.severity === s).length} 件`).join('・')
log(`確定 ${confirmed.length} 件（${summaryCounts}）。レポートを書きます`)

const report = await agent(`${PREAMBLE}

【役割: 統合フェーズ／レポート執筆】
確定した指摘（反証を生き残ったもの）:
${JSON.stringify(confirmed.map((f) => ({ severity: f.severity, title: f.title, dimension: f.dimension, file: f.file, line: f.line, evidence: f.evidence, impact: f.impact, fix: f.fix, effort: f.effort, known: f.known, votes: f.votes })), null, 1)}

反証を省略した軽い指摘（「未検証・参考」として第5章に短く載せる。確定扱いにしない）:
${JSON.stringify(unverified.map((f) => ({ title: f.title, file: f.file, line: f.line, fix: f.fix, confidence: f.confidence })), null, 1)}

棄却された指摘（参考。理由付き。レポートには「検討したが問題なしと判断したもの」として短く載せる）:
${JSON.stringify(rejected.map((f) => ({ title: f.title, votes: f.votes })), null, 1)}

次の構成で、日本語のレポートを ${REPORT_PATH} に書いてください（Write ツールを使う。読み手は開発が本業でない方。専門用語は避けるか、ひとこと説明を添える）:

# フロントーク 製品化レビュー（${DATE}）
1. 結論（3〜5行。いま売れる状態か、売る前に必ず直すものは何か）
2. 数字（確定件数の内訳、観点別）
3. 「売る前に必ず」（致命・重大）: 1件ずつ、何が困るか／どう直すか／手間の目安。根拠のファイル:行も添える
4. 「導入後すぐ」（中）
5. 「規模が増えたら」（軽・将来。反証を省略した「未検証・参考」もここに区別して載せる）
6. 既知の課題の現状（known=true のもの: 未解決・解決済みの整理）
7. 検討したが問題なしと判断したもの（棄却分・1行ずつ）
8. 推奨する進め方（順番・まとまり・依存関係。数週間の計画に落とす）
9. このレビューの限界（読めなかった範囲、確認できなかった前提）

書き終えたら、レポートの「結論」の部分だけを返してください。`,
  { label: '統合:レポート執筆', phase: '統合', effort: 'high' })

return {
  reportPath: REPORT_PATH,
  confirmedCount: confirmed.length,
  bySeverity: order.map((s) => [s, confirmed.filter((f) => f.severity === s).length]),
  rejectedCount: rejected.length,
  unverifiedCount: unverified.length,
  conclusion: report,
  confirmed: confirmed.map((f) => ({ severity: f.severity, title: f.title, file: f.file, line: f.line, effort: f.effort, known: f.known })),
}
