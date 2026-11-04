/**
 * Masareefi 2.0 V24 — read-only source regression tests + isolated mock login.
 * Run: node --test tests/rc23.test.mjs
 * Never reads browser storage, real Firebase or financial data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const app=read('index.html'),cloud=read('cloud-sync.js'),
  vault=read('device-vault.js'),worker=read('sw.js'),rules=read('firestore.rules');
const localKey='masareefi_v2_official';

test('merchant suggestions reuse saved categories without crossing types or removed categories',()=>{
 const source=app.match(/function rememberedMerchantCategory\(merchant,type,options,transactions\)\{[\s\S]*?\n\}/)[0];
 const recall=new Function(source+';return rememberedMerchantCategory')();
 const options=['فواتير','فواتير / اتصالات','بقالة'];
 const records=[{note:' MOBILY ',type:'expense',category:'فواتير / اتصالات'},{note:'Mobily',type:'expense',category:'بقالة'}];
 assert.equal(recall('mobily','expense',options,records),'فواتير / اتصالات');
 assert.equal(recall('Mobily','income',options,records),'');
 assert.equal(recall('Mobily','expense',['فواتير'],records),'');
 assert.equal(recall('Unknown','expense',options,records),'');
 assert.equal(recall('عملية بنكية','expense',options,[{note:'عملية بنكية',type:'expense',category:'بقالة'}]),'');
 assert.equal(recall('Mobily','expense',options,[{note:'Mobily',type:'expense',category:'فواتير'},...records]),'فواتير');
});

function merchantParser(){
 const normalize=app.match(/function normalize\(str\)\{[\s\S]*?\n\}/)?.[0];
 const findMerchant=app.match(/function findMerchant\(message\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(normalize&&findMerchant,'merchant parser source missing');
 return new Function(`${normalize}\n${findMerchant}\nreturn findMerchant`)();
}
function batchSplitter(){
 const source=app.match(/function splitMessages\(value\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(source,'batch splitter source missing');
 return new Function(`${source}\nreturn splitMessages`)();
}

test('JavaScript sources and all inline scripts parse',()=>{
 for(const [name,source] of [['cloud',cloud],['vault',vault],['worker',worker]])
  assert.doesNotThrow(()=>new vm.Script(source,{filename:name}));
 for(const match of app.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
  assert.doesNotThrow(()=>new vm.Script(match[1]));
});
test('payday budget cycles use configured dates and retain original financial stores',()=>{
 const module=app.match(/<script id="payday-cycle-module">([\s\S]*?)<\/script>/);
 assert.ok(module,'payday cycle module missing');
 const window={};
 vm.runInNewContext(module[1],{window});
 const cycle=window.masareefiPaydayCycle;
 assert.equal(cycle.currentEndMonth('2026-11-02',27),'2026-11');
 assert.equal(cycle.currentEndMonth('2026-11-27',27),'2026-12');
 assert.deepEqual(JSON.parse(JSON.stringify(cycle.forEndMonth('2026-11',27))),{start:'2026-10-27',end:'2026-11-27'});
 assert.deepEqual(JSON.parse(JSON.stringify(cycle.forEndMonth('2026-03',31))),{start:'2026-02-28',end:'2026-03-31'});
 const label=cycle.label('2026-11',27);
 assert.match(label,/أكتوبر/);
 assert.match(label,/نوفمبر/);
 assert.doesNotMatch(label,/جمادى|هـ/);
 assert.ok(app.includes("const KEY='masareefi_v2_official'"));
 assert.ok(app.includes("const DB_NAME='masareefi_v2_receipts_official'"));
});
test('payday defaults to day 27 and allows settings from 1 to 31',()=>{
 assert.match(app,/paydayDay:27/);
 assert.match(app,/id="paydaySettings"/);
 assert.match(app,/id="paydayDaySelect"/);
 assert.match(app,/الإصدار الرسمي 26/);
 assert.match(app,/d\.paydayDay<1\|\|d\.paydayDay>31/);
});
test('official build keeps financial key, isolated sync credentials and user-specific Firestore',()=>{
 assert.ok(app.includes("const KEY='"+localKey+"'"));
 assert.match(cloud,/masareefi_finance_sync_v19_official/);
 assert.match(vault,/masareefi_v22_device_vault_official/);
 assert.match(app,/https:\/\/ashrafv2\.github\.io\/masareefi\//);
 assert.match(rules,/request\.auth\.uid == userId/);
 assert.match(rules,/allow list, delete: if false;/);
});
test('manual backup contains attachments while cloud omits them',()=>{
 assert.match(app,/async function backupWithFiles\(\)/);
 assert.match(app,/_receiptBackup:\{format:1,attachments\}/);
 assert.match(cloud,/k!=='_receiptBackup'/);
});
test('all three restore flows explicitly pause cloud sync',()=>{
 assert.equal((app.match(/onBulkRestore/g)||[]).length,3);
 assert.match(cloud,/function onBulkRestore\(\)/);
 assert.match(cloud,/setRestoreHold\(\)/);
 assert.match(cloud,/if\(hasRestoreHold\(\)&&!choice\)/);
});
test('cloud writes use atomic manifest condition and stale-data guard',()=>{
 assert.match(cloud,/existing\?\{updateTime:existing\.updateTime\}:\{exists:false\}/);
 assert.match(cloud,/if\(\(await currentHash\(\)\)!==hash\)throw Error/);
 assert.match(cloud,/if\(\(await currentHash\(\)\)!==originalHash\)/);
});
test('automatic reconnect is opt-in; the vault does not persist plaintext passwords',()=>{
 assert.match(vault,/async function rememberAutomatic\(secrets\)/);
 assert.match(vault,/generateKey\(\{name:'AES-GCM',length:256\},false/);
 assert.ok(!vault.includes('localStorage'));
 assert.match(cloud,/syncAutoV22/);
});
test('PWA cache is refreshed and both sync scripts stay available',()=>{
 assert.match(worker,/masareefi-official-shell-v26-20261104/);
 assert.match(worker,/'\.\/device-vault\.js','\.\/cloud-sync\.js'/);
 assert.match(app,/cloud-sync\.js\?v=23/);
});
test('AlAhli POS SMS extracts merchant after the Arabic "من" marker',()=>{
 const findMerchant=merchantParser();
 const sms='شراء-POS\nبـ5 SAR\nمن Badr Hani\nمدى-ابل*0687\nفي 01:03 03/11/26';
 assert.equal(findMerchant(sms),'Badr Hani');
});
test('AlAhli POS merchant parsing stops before card metadata and time',()=>{
 const findMerchant=merchantParser();
 const sms='شراء-POS\nبـ5 SAR\nمن Badr Hani مدى-ابل*0687\nفي 01:03 03/11/26';
 assert.equal(findMerchant(sms),'Badr Hani');
});
test('non-POS bank transfer text is not mistaken for a merchant',()=>{
 const findMerchant=merchantParser();
 assert.equal(findMerchant('حوالة واردة\nمن حساب 1234'),null);
});
test('batch paste mode exposes split, preview and bulk-save flow',()=>{
 assert.match(app,/id="smartPasteAnalyzeBatch"/);
 assert.match(app,/function splitMessages\(value\)/);
 assert.match(app,/function analyzeBatch\(\)/);
 assert.match(app,/function saveBatch\(\)/);
 assert.match(app,/smartPasteBatchSave/);
});
test('batch paste splits consecutive Al Rajhi messages without blank lines',()=>{
 const splitMessages=batchSplitter();
 const text='شراء 5 SAR من متجر A بتاريخ 03/11/2026 شراء 12 SAR من متجر B بتاريخ 03/11/2026';
 assert.equal(splitMessages(text).length,2);
});
test('batch paste still supports blank-line-separated messages',()=>{
 const splitMessages=batchSplitter();
 assert.equal(splitMessages('شراء 5 SAR من متجر A\n\nشراء 12 SAR من متجر B').length,2);
});
test('English POS, deposit and online notifications split without blank lines',()=>{
 const split=batchSplitter();
 const pos='PoS Purchase\nBy:0000;mada-Apple Pay\nAmount: SAR 50\nAt:Test Store\n28/10/26 19:13';
 const deposit='Deposit:Saving Account Monthly Profit\nAmount:SAR 1.08\nTo:0000\n1/11/26 07:47';
 const online='Online Purchase\nAmount:SR 28.75\nAt:Test Telecom\n2/11/26 14:31';
 assert.equal(split(Array(21).fill(pos).concat([deposit,online]).join('\n')).length,23);
 const amount=app.match(/function amountNumber\(str\)\{[\s\S]*?\n\}/)[0];
 const find=app.match(/function findAmount\(text\)\{[\s\S]*?\n\}/)[0];
 assert.equal(new Function(amount+'\n'+find+'\nreturn findAmount')( )('Amount:SR 28.75'),28.75);
});
test('batch analysis falls back to the single-message parser for one pasted SMS',()=>{
 assert.match(app,/if\(messages\.length===1\)\{\s*analyze\(\);/);
 assert.doesNotMatch(app,/if\(messages\.length<2\)\{status\.textContent='لم أجد رسالتين منفصلتين/);
});
test('classification blocks concurrent changes rather than selecting a winner',()=>{
 const source=cloud.match(/function classification\(remoteHash,localHash,baselineHash\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(source,'classification source missing');
 const classify=new Function(source+'; return classification')();
 assert.equal(classify('r','r','base'),'equal');
 assert.equal(classify(null,'l',null),'empty');
 assert.equal(classify('base','changed','base'),'upload');
 assert.equal(classify('changed','base','base'),'download');
 assert.equal(classify('cloud','local','base'),'conflict');
});
function client(localStorage){
 const window={addEventListener(){}};
 const document={getElementById(id){
  return id==='financeSyncSettingsV19'?{addEventListener(){}}:null;
 },addEventListener(){},querySelector(){return null},visibilityState:'visible'};
 const nav={onLine:true},fetch=async(url)=>{
  if(String(url).includes('signInWithPassword'))return {ok:true,status:200,json:async()=>({
   localId:'unit_test_user_12345',idToken:'unit-test-token',
   refreshToken:'unit-test-refresh-token-1234567890',expiresIn:3600
  })};
  if(String(url).includes('/sync/meta'))return {ok:false,status:404,json:async()=>({error:{status:'NOT_FOUND'}})};
  throw Error('Unexpected mock URL: '+String(url));
 };
 const inject="window.masareefiSyncV19={onPersist,onBulkRestore,openSettings,synchronize,stableStringify,classification,disconnect};";
 assert.ok(cloud.includes(inject));
 const script=cloud.replace(inject,inject+"window.__rcAudit={signIn,onBulkRestore,getState:()=>session,getNotice:()=>session.notice};");
 vm.runInNewContext(script,{
  window,document,localStorage,navigator:nav,fetch,crypto:webcrypto,
  TextEncoder,TextDecoder,URL,URLSearchParams,AbortController,
  btoa:binary=>Buffer.from(binary,'binary').toString('base64'),
  atob:encoded=>Buffer.from(encoded,'base64').toString('binary'),
  setTimeout(){return 1},clearTimeout(){},setInterval(){},
  data:{transactions:[],savings:[],receivables:[],goals:[],debts:[],budgets:{}},
  openModal(){},safe:String,hydrate:x=>x,render(){},KEY:'isolated_mock_financial_data',
 });
 return window.__rcAudit;
}
test('a restored backup stays quarantined after page reload and login',async()=>{
 const map=new Map();
 const store={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),
  removeItem:k=>map.delete(k)};
 let first=client(store);
 await first.signIn('masareefi-finance-33a25','FAKE_PUBLIC_WEB_KEY_123456',
  'person@example.test','test-password','long-test-encryption-phrase');
 first.onBulkRestore();
 assert.equal(map.get('masareefi_finance_sync_v23_restore_hold_official'),'1');
 const second=client(store);
 await second.signIn('masareefi-finance-33a25','FAKE_PUBLIC_WEB_KEY_123456',
  'person@example.test','test-password','long-test-encryption-phrase');
 assert.equal(second.getState().active,false);
 assert.match(second.getNotice(),/المزامنة التلقائية معلّقة/);
});
