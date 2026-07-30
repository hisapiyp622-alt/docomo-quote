/* ── クラウド保存（店舗アカウント）の設定 ──────────────────────────────
 * Firebaseプロジェクトを作成し、下の値を差し替えると
 *   ・店舗アカウントでのログイン
 *   ・端末間の自動同期（iPad ⇄ PC）
 * が有効になります。
 *
 * 空のままでも、この端末内だけで完結する形でそのまま使えます（設定不要）。
 * 手順は ienaka-app/SETUP.md と同じです。
 * ここに書く値は公開されても問題ないもので、データの保護は
 * Firestoreのセキュリティルール（firestore.rules）で行います。 */
var DAKKAN_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

if (typeof firebase !== "undefined" && DAKKAN_FIREBASE.projectId) {
  try { firebase.initializeApp(DAKKAN_FIREBASE); } catch (e) {}
}
