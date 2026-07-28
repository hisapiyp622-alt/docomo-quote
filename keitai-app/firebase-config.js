/* ── 端末間同期（クラウド保存）の設定 ────────────────────────────────
 * ご自身のFirebaseプロジェクトを作成し、下の値を差し替えると
 *   ・iPad ⇄ PC ⇄ スマホ の見積もり自動同期
 *   ・料金マスタの全端末共有
 * が有効になります。
 *
 * 空のままでも、その端末の中だけで完結する形でそのまま使えます（設定不要）。
 * 手順は同じフォルダの SETUP.md を参照してください。
 * ここに書く値は公開されても問題ないもので、データの保護は
 * Firestoreのセキュリティルール（firestore.rules）で行います。 */
var KEITAI_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

/* 店舗IDをログイン用のアドレスへ変換するときのドメイン。
 * Firebaseの認証はメールアドレス形式を必要とするため、
 * 店舗ID「hannan01」→「hannan01@（このドメイン）」として扱います。
 * 実在するドメインである必要はありません。値は店舗を作るときと揃えてください。 */
var KEITAI_STORE_DOMAIN = "keitai-quote.example";

if (typeof firebase !== "undefined" && KEITAI_FIREBASE.projectId) {
  try { firebase.initializeApp(KEITAI_FIREBASE); } catch (e) {}
}
