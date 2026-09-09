/* テスト用の「にせクラウド」（Firestore のまね）
 *
 * Playwright の addInitScript で差し込む。本物のクラウドには一切つながない。
 *
 *   window.__FAKE.offline        … true のあいだは「端末内の控え」しか無い状態（fromCache=true・中身なし）
 *   window.__FAKE.docs[path]     … クラウドにある書類（path は "settings/docomoQuoteStore/quotes/s1" の形）
 *   window.__FAKE.sets           … アプリが送った書き込みの記録 [{path, data, opts}]
 *   window.__FAKE.deliver(path, data) … 通信が戻って本物の中身が届いたことにする（購読者へ配る）
 *   window.__FAKE.goOnline()     … 通信が戻ったことにする（中身なしのまま本物のお知らせを配る）
 *
 * 使いどころ: 「空の端末を圏外で開いても、白紙をクラウドへ送らないこと」のように、
 * 本物のクラウドでは試せない（試すと本番が壊れる）ことを確かめる。 */
module.exports = function fakeFirestoreScript(opts) {
  const o = Object.assign({ offline: true, docs: {} }, opts || {});
  return `(function(){
    var F = window.__FAKE = { offline: ${o.offline ? 'true' : 'false'}, docs: ${JSON.stringify(o.docs)}, sets: [], listeners: {} };
    function snap(path, fromCache) {
      var d = F.docs[path];
      return { exists: !!d, id: path.split('/').pop(), data: function () { return d ? JSON.parse(JSON.stringify(d)) : null; },
        metadata: { fromCache: !!fromCache } };
    }
    function colSnap(path, fromCache) {
      var ids = Object.keys(F.docs).filter(function (p) { return p.indexOf(path + '/') === 0 && p.slice(path.length + 1).indexOf('/') < 0; });
      var docs = ids.map(function (p) { return snap(p, fromCache); });
      return { docs: docs, empty: !docs.length, size: docs.length, metadata: { fromCache: !!fromCache },
        forEach: function (cb) { docs.forEach(cb); }, docChanges: function () { return docs.map(function (s) { return { type: 'added', doc: s }; }); } };
    }
    function merge(a, b) { var r = Object.assign({}, a || {}); Object.keys(b || {}).forEach(function (k) { r[k] = b[k]; }); return r; }
    function docRef(path) {
      return {
        path: path,
        get: function () {
          if (F.offline) return F.docs[path] ? Promise.resolve(snap(path, true)) : Promise.reject(new Error('Failed to get document because the client is offline.'));
          return Promise.resolve(snap(path, false));
        },
        set: function (data, o2) {
          F.sets.push({ path: path, data: JSON.parse(JSON.stringify(data)), opts: o2 || null, at: Date.now() });
          F.docs[path] = (o2 && o2.merge) ? merge(F.docs[path], data) : JSON.parse(JSON.stringify(data));
          return Promise.resolve();
        },
        update: function (data) { F.sets.push({ path: path, data: data, opts: { update: true } }); F.docs[path] = merge(F.docs[path], data); return Promise.resolve(); },
        delete: function () { F.sets.push({ path: path, data: null, opts: { del: true } }); delete F.docs[path]; return Promise.resolve(); },
        onSnapshot: function (cb, err) {
          (F.listeners[path] = F.listeners[path] || []).push(cb);
          setTimeout(function () { try { cb(snap(path, F.offline)); } catch (e) {} }, 0);
          return function () { F.listeners[path] = (F.listeners[path] || []).filter(function (x) { return x !== cb; }); };
        },
        collection: function (name) { return colRef(path + '/' + name); }
      };
    }
    function colRef(path) {
      var q = {
        doc: function (id) { return docRef(path + '/' + id); },
        get: function () { return Promise.resolve(colSnap(path, F.offline)); },
        onSnapshot: function (cb) { (F.listeners[path] = F.listeners[path] || []).push(cb);
          setTimeout(function () { try { cb(colSnap(path, F.offline)); } catch (e) {} }, 0); return function () {}; },
        where: function () { return q; }, orderBy: function () { return q; }, limit: function () { return q; }
      };
      return q;
    }
    F.deliver = function (path, data) {
      F.offline = false;
      if (data !== undefined) F.docs[path] = data;
      (F.listeners[path] || []).forEach(function (cb) { try { cb(snap(path, false)); } catch (e) {} });
    };
    F.goOnline = function () {
      F.offline = false;
      Object.keys(F.listeners).forEach(function (p) {
        (F.listeners[p] || []).forEach(function (cb) { try { cb(F.docs[p] !== undefined || p.split('/').length % 2 === 0 ? snap(p, false) : colSnap(p, false)); } catch (e) {} });
      });
    };
    var db = { collection: function (name) { return colRef(name); }, doc: function (p) { return docRef(p); } };
    var auth = { onAuthStateChanged: function (cb) { setTimeout(function () { cb(null); }, 0); },
      signInWithEmailAndPassword: function () { return Promise.resolve(); }, signOut: function () { return Promise.resolve(); } };
    window.firebase = { apps: [{}], initializeApp: function () { return {}; },
      auth: Object.assign(function () { return auth; }, { EmailAuthProvider: { credential: function () { return {}; } } }),
      firestore: Object.assign(function () { return db; }, { FieldValue: { serverTimestamp: function () { return 'TS'; } } }) };
  })();`;
};
