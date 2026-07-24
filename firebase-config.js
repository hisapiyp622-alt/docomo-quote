/* Firebaseプロジェクト: recipe-box (recipe-box-bd642) — レシピアプリと共用 */
/* SDKの読み込みに失敗してもアプリ本体は動く（同期のみ無効になる） */
if (typeof firebase !== "undefined") {
  try {
    firebase.initializeApp({
      apiKey: "AIzaSyDkGmaumzmTeFyRdEqOaxD4rItFzl2bn3w",
      authDomain: "recipe-box-bd642.firebaseapp.com",
      projectId: "recipe-box-bd642",
      storageBucket: "recipe-box-bd642.firebasestorage.app",
      messagingSenderId: "179572630427",
      appId: "1:179572630427:web:1189138bed0730ba9d773e"
    });
  } catch (e) {}
}
