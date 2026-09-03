/* 「調子が悪いときの情報」のテスト（製品化レビュー 4-26）
 *
 * 使い方: node tests/run-diag-tests.js
 *
 * 店舗から「動かない」と言われたときに、こちらが原因を追える情報が
 * ちゃんと残り、店舗がコピーして渡せることを見張る。
 * あわせて「お客様の情報が混ざっていないこと」も見る。
 */
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=require('path').resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.md':'text/markdown'};
const srv=http.createServer((q,s)=>{let p=q.url.split('?')[0];if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,decodeURIComponent(p));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);s.end('nf');return;}s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});s.end(fs.readFileSync(f));});
srv.listen(0,'127.0.0.1',async()=>{
const {chromium}=(function(){try{return require('playwright');}catch(e){return require('/opt/node22/lib/node_modules/playwright');}})();
const lo={args:['--no-sandbox']};if(fs.existsSync('/opt/pw-browsers/chromium'))lo.executablePath='/opt/pw-browsers/chromium';
const b=await chromium.launch(lo);
const ctx=await b.newContext({serviceWorkers:'block',viewport:{width:1200,height:1000},permissions:['clipboard-read','clipboard-write']});
const p=await ctx.newPage(); p.setDefaultTimeout(8000);
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
p.on('dialog',d=>d.accept());
await ctx.route('**/*',r=>{const u=r.request().url();
  if(u.includes('gstatic.com'))return r.abort();
  if(u.endsWith('firebase-config.js'))return r.fulfill({contentType:'application/javascript',body:'window.KEITAI_FIREBASE={};'});
  return r.continue();});
const base=`http://127.0.0.1:${srv.address().port}`;
await p.goto(base+'/keitai-app/?kqtest=1'); await p.waitForTimeout(900);
await p.click('#setupSkip').catch(()=>{}); await p.waitForTimeout(300);
await p.click('#tourSkip').catch(()=>{}); await p.waitForTimeout(300);
let ng=0,okN=0; function chk(l,cond,x){console.log((cond?'OK  ':'NG  ')+l+(x?'  '+x:''));if(cond)okN++;else ng++;}

// わざとエラーを起こして、記録に残るかを見る
await p.evaluate(()=>{ setTimeout(()=>{ throw new Error('テスト用のエラー'); },0); });
await p.evaluate(()=>{ Promise.reject(new Error('テスト用の失敗')); });
await p.waitForTimeout(400);

await p.click('#aboutBtn'); await p.waitForTimeout(300);
const box0 = await p.evaluate(()=>document.getElementById('aboutDiagBox').hidden);
chk('① 情報を開いた時点では、診断の欄はたたまれている', box0===true);
await p.click('#aboutDiagBtn'); await p.waitForTimeout(300);
const txt = await p.evaluate(()=>document.getElementById('aboutDiagText').textContent);
chk('② アプリ版・料金表・端末IDが出る', /アプリ版: 1\./.test(txt)&&/料金表: v/.test(txt)&&/この端末のID:/.test(txt), txt.split('\n')[0]);
chk('③ 起きたエラーが記録に残る', /テスト用のエラー/.test(txt), (txt.match(/\[エラー\][^\n]*/g)||[]).join(' | ').slice(0,120));
chk('③ 処理の失敗（unhandledrejection）も残る', /テスト用の失敗/.test(txt));
chk('④ 起動の記録がある', /\[起動\]/.test(txt));
chk('⑤ お客様の情報が入っていない', !/custName|お客様名/.test(txt));
// コピー
await p.click('#aboutDiagCopy'); await p.waitForTimeout(400);
const msg = await p.evaluate(()=>{const e=document.getElementById('aboutDiagMsg');return e.hidden?'':e.textContent;});
chk('⑥ コピーの結果を知らせる', /コピー/.test(msg), msg);
const clip = await p.evaluate(()=>navigator.clipboard.readText().catch(()=>''));
chk('⑥ 実際にコピーされている', /アプリ版:/.test(clip), clip.slice(0,60));
// 閉じて開き直すと、またたたまれている
await p.click('#aboutClose'); await p.waitForTimeout(200);
await p.click('#aboutBtn'); await p.waitForTimeout(300);
chk('⑦ 開き直すと、また閉じた状態から', await p.evaluate(()=>document.getElementById('aboutDiagBox').hidden)===true);
// 開発用アドレスの案内は、127.0.0.1 では出ない
chk('⑧ ふつうのアドレスでは、開発用の帯は出ない', await p.evaluate(()=>document.getElementById('cloudWarn').hidden)===true);
await b.close();

/* ---- 配信元がふたつある問題（4-28）。本物のホスト名で開いて確かめる ---- */
const b2=await chromium.launch({args:['--no-sandbox','--host-resolver-rules=MAP * 127.0.0.1:'+srv.address().port],
  ...(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{})});
async function openAs(host, internal){
  const c=await b2.newContext({serviceWorkers:'block'});
  await c.route('**/*',r=>{const u=new URL(r.request().url());
    if(u.hostname.includes('gstatic.com'))return r.abort();
    if(u.pathname.endsWith('firebase-config.js'))return r.fulfill({contentType:'application/javascript',
      body:'var KEITAI_FIREBASE={projectId:"t"};window.KEITAI_FIREBASE=KEITAI_FIREBASE;'
        +'var KEITAI_STORE_DOMAIN="keitai-quote.example";var KEITAI_DEV_UID="D";var KEITAI_PROVIDER={};'
        +(internal?'window.KEITAI_INTERNAL=true;':'')});
    return r.continue();});
  const pg=await c.newPage(); pg.setDefaultTimeout(8000);
  pg.on('dialog',d=>d.accept());
  await pg.addInitScript(()=>{
    window.__SIGNIN=0;
    const auth={onAuthStateChanged(cb){setTimeout(()=>cb(null),0);},
      signInWithEmailAndPassword(){window.__SIGNIN++;return Promise.resolve();},signOut(){return Promise.resolve();}};
    const doc={get:()=>Promise.resolve({exists:false,data:()=>null,metadata:{fromCache:false}}),
      set:()=>Promise.resolve(),onSnapshot:()=>()=>{},
      collection:()=>({doc:()=>doc,get:()=>Promise.resolve({forEach:()=>{}}),onSnapshot:()=>()=>{},
        orderBy(){return this;},limit(){return this;},where(){return this;}})};
    window.firebase={apps:[{}],initializeApp:()=>({}),
      auth:Object.assign(function(){return auth;},{EmailAuthProvider:{credential:()=>({})}}),
      firestore:Object.assign(function(){return {collection:()=>({doc:()=>doc,get:()=>Promise.resolve({forEach:()=>{}}),where(){return this;}})};},
        {FieldValue:{serverTimestamp:()=>'TS'}})};
  });
  await pg.goto('http://'+host+'/keitai-app/?kqtest=1');
  await pg.waitForTimeout(1100);
  return {pg,c};
}
async function trySignIn(pg){
  await pg.evaluate(()=>{const i=document.getElementById('loginStoreId'),w=document.getElementById('loginPass');
    if(i)i.value='riwa01'; if(w)w.value='x';
    document.getElementById('loginForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await pg.waitForTimeout(300);
  return pg.evaluate(()=>window.__SIGNIN);
}
let g=await openAs('hisapiyp622-alt.github.io',false);
chk('⑨ 開発用のアドレスでは、その旨の帯が出る',
  await g.pg.evaluate(()=>{const e=document.getElementById('cloudWarn');return !!e&&!e.hidden&&/開発用/.test(e.textContent);}));
chk('⑨ 開発用のアドレスからはログインできない', (await trySignIn(g.pg))===0);
chk('⑨ 画面に理由が出る',
  await g.pg.evaluate(()=>{const e=document.getElementById('loginErr');return !!e&&!e.hidden&&/開発用/.test(e.textContent);}));
await g.c.close();
g=await openAs('frontalk.curacon.co.jp',false);
chk('⑩ 配信元（frontalk）では帯を出さず、ログインできる',
  (await g.pg.evaluate(()=>document.getElementById('cloudWarn').hidden))===true && (await trySignIn(g.pg))===1);
await g.c.close();
g=await openAs('hisapiyp622-alt.github.io',true);
chk('⑪ 社内版は同じアドレスでも止めない',
  (await g.pg.evaluate(()=>{const e=document.getElementById('cloudWarn');return !e||e.hidden;}))===true);
await g.c.close();
await b2.close();
srv.close();
const bad=errs.filter(e=>!/テスト用/.test(e));
if(bad.length){console.error('JSエラーが発生しました:\n'+bad.join('\n'));process.exit(1);}
if(ng){console.error('調子が悪いときの情報のテスト: NG '+ng+'件');process.exit(1);}
console.log('調子が悪いときの情報・配信元のテスト: '+okN+'/'+okN+' OK');
});
