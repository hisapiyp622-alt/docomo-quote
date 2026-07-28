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
  apiKey: "AIzaSyDu1fQ-1s9CxvCsByvclJ7mIivpS0ji8kY",
  authDomain: "keitai-quote.firebaseapp.com",
  projectId: "keitai-quote",
  storageBucket: "keitai-quote.firebasestorage.app",
  messagingSenderId: "102296077296",
  appId: "1:102296077296:web:18d543d5459c1434e21335"
};

/* 提供元の表示（アプリ内の「このアプリについて」に出ます）。
 * 販売する前に必ず埋めてください。空のままだと「未設定」と表示されます。 */
var KEITAI_VENDOR = {
  name: "",      // 例）〇〇株式会社 / 屋号
  contact: "",   // 例）support@example.com
  hours: ""      // 例）平日 10:00〜18:00
};

/* 店舗IDをログイン用のアドレスへ変換するときのドメイン。
 * Firebaseの認証はメールアドレス形式を必要とするため、
 * 店舗ID「hannan01」→「hannan01@（このドメイン）」として扱います。
 * 実在するドメインである必要はありません。値は店舗を作るときと揃えてください。 */
var KEITAI_STORE_DOMAIN = "keitai-quote.example";

if (typeof firebase !== "undefined" && KEITAI_FIREBASE.projectId) {
  try { firebase.initializeApp(KEITAI_FIREBASE); } catch (e) {}
}
