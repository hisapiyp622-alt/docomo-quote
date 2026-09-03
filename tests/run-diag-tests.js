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
let ng=0; function chk(l,ok,x){console.log((ok?'OK  ':'NG  ')+l+(x?'  '+x:''));if(!ok)ng++;}

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
await b.close(); srv.close();
const bad=errs.filter(e=>!/テスト用/.test(e));
if(bad.length){console.error('JSエラーが発生しました:\n'+bad.join('\n'));process.exit(1);}
if(ng){console.error('調子が悪いときの情報のテスト: NG '+ng+'件');process.exit(1);}
console.log('調子が悪いときの情報のテスト: 10/10 OK');
});
