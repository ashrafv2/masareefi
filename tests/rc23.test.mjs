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
test('category picker orders by usage and supports search selection',()=>{
 assert.match(app,/function openCategoryPicker\(select\)/);
 assert.match(app,/category-picker-grid/);
 assert.match(app,/counts\.get\(b\)-counts\.get\(a\)/);
 assert.match(app,/function decorateCategorySelect\(select\)/);
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
 assert.match(app,/الإصدار الرسمي 31\.3/);
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
 assert.match(worker,/masareefi-official-shell-v31-20261112-r4/);
 assert.match(worker,/'\.\/device-vault\.js','\.\/cloud-sync\.js'/);
 assert.match(app,/cloud-sync\.js\?v=23/);
});
test('income assets extend the existing financial object and encrypted cloud nonempty check',()=>{
 assert.match(app,/incomeAssets:\[\]/);
 assert.match(app,/\['transactions','goals','debts','savings','receivables','incomeAssets'\]/);
 assert.match(cloud,/recurringIncome','incomeAssets'/);
 assert.match(app,/const KEY='masareefi_v2_official'/);
 assert.match(app,/const DB_NAME='masareefi_v2_receipts_official'/);
});
test('income asset return calculations separate purchase price from operations and honor cycle dates',()=>{
 const source=app.match(/function incomeAssetTotals\(asset,transactions,period\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(source,'income asset calculation missing');
 const totals=new Function('n',source+';return incomeAssetTotals') (v=>Number(v)||0);
 const result=totals({id:'car',purchaseCost:12000},[
  {incomeAssetId:'car',type:'income',amount:2000,date:'2026-11-02'},
  {incomeAssetId:'car',type:'expense',amount:250,date:'2026-11-03'},
  {incomeAssetId:'other',type:'income',amount:999,date:'2026-11-03'},
  {incomeAssetId:'car',type:'expense',amount:50,date:'2026-10-26'}
 ],{start:'2026-10-27',end:'2026-11-27'});
 assert.deepEqual(result,{income:2000,expense:300,net:1700,periodNet:1750,cost:12000,recovered:1700,remaining:10300,recoveryPct:14});
});
test('asset purchase excludes living expenses and routes funding to savings or a debt record',()=>{
 assert.match(app,/note:'شراء أصل مدر للدخل: '\+name,assetId:asset\.id/);
 assert.match(app,/data\.debts\.push\(\{id:debtId,name:'تمويل '\+name,total:cost,remaining:cost/);
 assert.match(app,/incomeAssetId:asset\.id/);
 assert.match(app,/if\(asset\.active===false\)\{alert\('أعد تفعيل الأصل قبل تسجيل عمليات جديدة'\)/);
});
test('the asset form saves a valid purchase date and deducts the purchase once',()=>{
 const source=app.slice(app.indexOf('function createIncomeAsset(){'),app.indexOf('function renderIncomeAssets(){'));
 const data={savingAccounts:[{id:'bank',name:'Bank'}],savings:[],debts:[],incomeAssets:[],transactions:[]};
 const form={elements:{funding:{value:'bank'},name:{value:'Car'},cost:{value:'12000'},date:{value:'2026-11-10'}}};
 let saves=0;
 const context={data,el:()=>form,openModal:(_title,_body,setup)=>setup(),
  safe:String,money:String,savingAccountTotal:()=>15000,requireAmount:value=>value>0,
  today:()=>form.elements.date.value,id:()=>String(data.savings.length+1),
  alert:message=>assert.fail(message),closeModal:()=>{},persist:()=>{saves++}};
 vm.runInNewContext(source+';createIncomeAsset()',context);
 form.onsubmit({preventDefault(){}});
 assert.equal(saves,1);
 assert.equal(data.incomeAssets[0].purchaseDate,'2026-11-10');
 assert.equal(data.savings.length,1);
 assert.equal(data.savings[0].amount,12000);
 assert.equal(data.savings[0].account,'bank');
 assert.equal(data.savings[0].assetId,data.incomeAssets[0].id);
 assert.equal(data.transactions.length,0);
});
test('asset operating costs from savings only post a withdrawal and reduce asset returns',()=>{
 const start=app.indexOf('function incomeAssetTotals(');
 const end=app.indexOf('function createIncomeAsset()',start);
 const asset={id:'car',name:'Car',purchaseCost:12000};
 const purchase={type:'withdrawal',account:'bank',amount:12000,assetId:'car',date:'2026-11-01'};
 const data={incomeAssets:[asset],savingAccounts:[{id:'bank',name:'Bank'}],
  savings:[purchase],transactions:[{type:'income',amount:900,incomeAssetId:'car',date:'2026-11-05'}]};
 const form={elements:{amount:{value:'600'},category:{value:'صيانة'},date:{value:'2026-11-06'},
  note:{value:'صيانة السيارة'},savingsAccount:{value:'bank'}}};
 const notice={};
 const alerts=[];
 let saves=0;
 const context={data,asset,el:key=>key==='assetTxForm'?form:notice,safe:String,money:String,
  catOptions:()=>['صيانة'],savingAccountTotal:()=>12500-data.savings.reduce((v,x)=>v+x.amount,0),
  today:()=>form.elements.date.value,n:Number,requireAmount:v=>v>0,id:()=>String(data.savings.length),
  alert:message=>alerts.push(message),closeModal:()=>{},persist:()=>{saves++},
  openModal:(_title,body,setup)=>{assert.match(body,/الدفع من الادخار/);setup()}};
 vm.runInNewContext(app.slice(start,end)+";assetTransactionDialog(asset,'expense')",context);
 form.elements.savingsAccount.onchange();
 assert.match(notice.textContent,/سجل الادخار وعمليات الأصل فقط/);
 form.onsubmit({preventDefault(){}});
 assert.equal(alerts.length,1);
 assert.equal(saves,0);
 assert.equal(data.savings.length,1);
 form.elements.amount.value='400';
 form.onsubmit({preventDefault(){}});
 assert.equal(saves,1);
 assert.equal(data.transactions.length,1);
 assert.equal(data.savings.length,2);
 assert.equal(data.savings[1].type,'withdrawal');
 assert.equal(data.savings[1].incomeAssetId,'car');
 assert.equal(context.savingAccountTotal(),100);
 const rows=context.assetLedgerRows(data.transactions,data.savings);
 assert.equal(rows.length,2);
 const totals=context.incomeAssetTotals(asset,rows,{start:'2026-10-27',end:'2026-11-27'});
 assert.equal(totals.expense,400);
 assert.equal(totals.periodNet,500);
 assert.equal(totals.net,500);
 form.elements.savingsAccount.value='';
 form.onsubmit({preventDefault(){}});
 assert.equal(data.transactions[0].type,'expense');
 assert.equal(data.savings.length,2);
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

test('custom merchant images normalize names, restore from backup, and release replaced URLs',async()=>{
 const functions=['conciseMerchant','merchantLogoKeyV17'].map(name=>app.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0]).join('\n');
 const records=[{id:'merchant-image:boqsha',txId:'merchant-image:boqsha',name:'Boqsha',type:'image/png',size:3,blob:new Blob(['png'],{type:'image/png'})},{id:'invoice',txId:'transaction',type:'image/png',blob:new Blob(['receipt'])}];
 const revoked=[];let serial=0,renders=0;
 const context=vm.createContext({window:{},allFiles:async()=>records,render:()=>renders++,URL:{createObjectURL:()=>`blob:test-${++serial}`,revokeObjectURL:url=>revoked.push(url)}});
 const core=app.slice(app.indexOf("const MERCHANT_IMAGE_PREFIX="),app.indexOf('async function prepareMerchantImage'));
 vm.runInContext(functions+'\n'+core,context);
 await vm.runInContext('refreshMerchantImages()',context);
 assert.equal(context.window.masareefiMerchantImages.get(' BOQSHA '),'blob:test-1');
 assert.equal(context.window.masareefiMerchantImages.get('Different Store'),undefined);
 assert.equal(vm.runInContext("merchantImageKey('بُقشة')===merchantImageKey('بقشة')",context),true);
 // Round-trip the actual complete-backup format, including image id and txId.
 context.toB64=async blob=>Buffer.from(await blob.arrayBuffer()).toString('base64');context.data={transactions:[]};
 vm.runInContext(app.match(/async function backupWithFiles\(\)\{[^]*?\n\}/)[0],context);
 const backup=JSON.parse(await vm.runInContext('backupWithFiles()',context));
 assert.equal(backup._receiptBackup.attachments[0].txId,'merchant-image:boqsha');
 records.splice(0,records.length,...backup._receiptBackup.attachments.map(x=>({...x,blob:new Blob([Buffer.from(x.base64,'base64')],{type:x.type})})));
 await vm.runInContext('refreshMerchantImages()',context);
 assert.equal(context.window.masareefiMerchantImages.get('Boqsha'),'blob:test-2');
 assert.deepEqual(revoked,['blob:test-1']);
 records.splice(0,1);await vm.runInContext('refreshMerchantImages()',context);
 assert.equal(context.window.masareefiMerchantImages.get('Boqsha'),undefined);
 assert.equal(renders,3);
 assert.deepEqual(revoked,['blob:test-1','blob:test-2']);
});

test('uploaded logos take precedence without changing financial transactions',()=>{
 const resolve=app.match(/function resolveMerchantLogoV17\(t\)\{[^]*?\n\}/)[0];
 const context=vm.createContext({window:{masareefiMerchantImages:{get:()=> 'blob:custom'}}});vm.runInContext(resolve,context);
 const tx={type:'expense',note:'Boqsha',amount:81,merchantLogoV17:'none'};context.tx=tx;
 assert.equal(vm.runInContext('resolveMerchantLogoV17(tx).customImage',context),'blob:custom');
 assert.equal(vm.runInContext("resolveMerchantLogoV17({type:'income'})",context),null);
 assert.deepEqual(tx,{type:'expense',note:'Boqsha',amount:81,merchantLogoV17:'none'});
});

test('merchant image upload rejects unsupported and oversized input before decoding',async()=>{
 const prepare=app.match(/async function prepareMerchantImage\(file\)\{[^]*?\n\}/)[0];
 const context=vm.createContext({MAX_FILE:8*1024*1024});vm.runInContext(prepare,context);
 await assert.rejects(vm.runInContext("prepareMerchantImage({type:'image/svg+xml',size:10})",context),/PNG/);
 await assert.rejects(vm.runInContext("prepareMerchantImage({type:'image/png',size:9*1024*1024})",context),/8/);
 await assert.rejects(vm.runInContext("prepareMerchantImage({type:'image/png',size:0})",context),/8/);
});

test('category picker opens as modal above its owner and cleans up without changing other form data',()=>{
 const source=app.match(/function openCategoryPicker\(select\)\{[^]*?\n\}/)[0];
 class Node extends EventTarget{
  constructor(){super();this.isConnected=true;this.open=false;this.dataset={}}
  focus(){this.focused=true}
  remove(){this.isConnected=false}
  showModal(){this.open=true;this.modal=true}
  close(){this.open=false;this.dispatchEvent(new Event('close'))}
  setAttribute(){}
 }
 const owner=new Node();owner.open=true;
 const trigger=new Node(),search=new Node(),dismiss=new Node(),choice=new Node();choice.dataset.categoryValue='مطاعم';
 const select=new Node();select.options=[{value:'بقالة'},{value:'مطاعم'}];select.value='بقالة';select._categoryPickerButton=trigger;select.closest=()=>owner;
 let layer,created=0,observer,changes=0;
 select.addEventListener('change',()=>changes++);
 const doc={body:{append(){}},querySelector:()=>layer?.isConnected?layer:null,createElement:tag=>{
  assert.equal(tag,'dialog');created++;layer=new Node();layer.querySelector=s=>s.includes('search')?search:dismiss;layer.querySelectorAll=()=>[choice];return layer;
 }};
 const context=vm.createContext({document:doc,select,data:{transactions:[]},safe:x=>x,categoryIconSvg:()=>'',Event,MutationObserver:class{constructor(cb){this.callback=cb;observer=this}observe(){}disconnect(){this.disconnected=true}}});
 vm.runInContext(source,context);
 vm.runInContext('openCategoryPicker(select)',context);
 assert.equal(layer.modal,true);assert.equal(owner.open,true);
 assert.equal(search.focused,undefined);assert.equal(dismiss.focused,true);
 vm.runInContext('openCategoryPicker(select)',context);assert.equal(created,1);assert.equal(search.focused,undefined);
 choice.onclick();assert.equal(select.value,'مطاعم');assert.equal(changes,1);assert.equal(owner.open,true);assert.equal(layer.isConnected,false);assert.equal(trigger.focused,true);
 vm.runInContext('openCategoryPicker(select)',context);layer.dispatchEvent(new Event('cancel',{cancelable:true}));assert.equal(layer.isConnected,false);assert.equal(changes,1);
 vm.runInContext('openCategoryPicker(select)',context);owner.close();assert.equal(layer.isConnected,false);assert.equal(observer.disconnected,true);
 owner.open=true;vm.runInContext('openCategoryPicker(select)',context);select.isConnected=false;observer.callback();assert.equal(layer.isConnected,false);
});

test('transaction detail cards read records without writing and escape saved text',()=>{
 const source=app.match(/function showTransactionDetails\(which\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(source);
 const transaction={id:42,type:'expense',amount:499.15,category:'مقاضي <img>',date:'2026-11-12',note:'متجر <script>',method:'cash'};
 const data={transactions:[transaction]},before=JSON.stringify(data),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',onclick:null,querySelector:()=>({}),showModal(){this.open=true},close(){this.open=false}});return nodes.get(id)};
 let edited=false;
 const context={data,el:node,resolveMerchantLogoV17:()=>null,conciseMerchant:x=>x,
  categoryIconSvg:()=>'<svg></svg>',transactionIconV12:()=>'<svg></svg>',money:x=>String(x),
  safe:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  document:{activeElement:null},window:{masareefiDialogMotion:{open(){},close(){}}},editTransaction(){edited=true},act(){throw Error('detail display must not write')}};
 vm.runInNewContext(source+';showTransactionDetails("42")',context);
 assert.equal(JSON.stringify(data),before);
 assert.equal(edited,false);
 assert.equal(node('transactionDetails').open,true);
 assert.match(node('transactionDetailsBody').innerHTML,/متجر &lt;script&gt;/);
 assert.match(node('transactionDetailsBody').innerHTML,/مقاضي &lt;img&gt;/);
 assert.match(node('transactionDetailsBody').innerHTML,/499.15/);
 assert.match(node('transactionDetailsBody').innerHTML,/2026-11-12/);
 node('ticketEdit').onclick();assert.equal(edited,true);
});
