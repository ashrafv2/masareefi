import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const app=read('index.html'),code=read('projects.js');
function api(){const window={};const context={window};vm.createContext(context);vm.runInContext(app.match(/function savingsEditPlan\(state,which,changes\)\{[\s\S]*?\n\}/)[0],context);vm.runInContext(code,context);return window.masareefiProjects}
const base=()=>({incomeAssets:[],savingAccounts:[{id:'bank',name:'Bank'}],savings:[{id:'start',type:'deposit',account:'bank',amount:3000}],transactions:[],receivables:[],debts:[],goals:[],themeColor:'#985acf'});
let seq=0;const keys=()=>Object.fromEntries(['project','account','event','movement','item','debt','receivable'].map(k=>[k,k+(++seq)]));
function setup(){const a=api(),k=keys();let s=a.configure(base(),null,{name:'الأجهزة',startDate:'2026-11-13',assetIds:[]},k);return {a,s,k}}
function posting(a,s,p,type,value,extras={}){return a.post(s,p,{type,amount:value,date:'2026-11-13',note:'test',...extras},keys())}
const pstate=(s,k)=>s.incomeAssets.find(p=>p.id===k.project);
test('project documents and scripts parse and are included in offline shell',()=>{assert.doesNotThrow(()=>new vm.Script(code));assert.match(read('sw.js'),/\.\/projects\.js/);assert.match(read('sw.js'),/\.\/projects\.css/);assert.match(app,/projects\.js\?v=32/)});
test('inventory, actual cash and realized profit remain separate without double counting',()=>{
 let {a,s,k}=setup();s=posting(a,s,k.project,'capital',1000,{otherAccount:'bank'});s=posting(a,s,k.project,'itemPurchase',200,{itemName:'غسالة'});let p=pstate(s,k),item=p.items[0].id,m=a.metrics(s,p,'2026-11-13');assert.equal(m.inventory,200);assert.equal(m.cash,800);assert.equal(m.profit,0);
 s=posting(a,s,k.project,'itemCost',80,{itemId:item,category:'قطع'});s=posting(a,s,k.project,'itemCost',30,{itemId:item,category:'نقل'});s=posting(a,s,k.project,'sale',450,{itemId:item,closeItem:'yes',channel:'used'});m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.profit,140);assert.equal(m.cash,1140);assert.equal(m.inventory,0);
 s=posting(a,s,k.project,'ownerDraw',100,{otherAccount:'bank'});m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.cash,1040);assert.equal(m.profit,140);
 s=posting(a,s,k.project,'loan',500,{monthly:50});m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.liabilities,500);assert.equal(m.profit,140);assert.equal(m.netWorth,1040);
});
test('credit sales and vendor debts recognize business results once, settlements only move cash',()=>{
 let {a,s,k}=setup();s=posting(a,s,k.project,'capital',1000,{otherAccount:'bank'});s=posting(a,s,k.project,'service',500,{payment:'credit'});let p=pstate(s,k),e=p.events.at(-1),m=a.metrics(s,p,'2026-11-13');assert.equal(m.profit,500);assert.equal(m.cash,1000);assert.equal(m.receivable,500);
 s=a.settle(s,k.project,'receivables',e.sourceId,200,{movement:'collection',date:'2026-11-13'});m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.cash,1200);assert.equal(m.receivable,300);assert.equal(m.profit,500);assert.throws(()=>a.removeEvent(s,k.project,e.id),/تحصيل/);
 s=a.editEvent(s,k.project,e.id,{amount:600,date:'2026-11-13',note:'changed'});assert.equal(s.receivables[0].remaining,400);
 s=posting(a,s,k.project,'operating',100,{payment:'credit'});let debt=s.debts[0];s=a.settle(s,k.project,'debts',debt.id,50,{movement:'payment',date:'2026-11-13'});m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.profit,500);assert.equal(m.cash,1150);assert.equal(m.liabilities,50);
 const event=pstate(s,k).events.at(-1);s=a.editEvent(s,k.project,event.id,{amount:150,date:'2026-11-13',note:'cost'});assert.equal(s.debts[0].remaining,100);assert.equal(a.metrics(s,pstate(s,k),'2026-11-13').profit,450);
});
test('scrap proceeds are deferred until closing; writeoffs recognize cost as a loss',()=>{
 let {a,s,k}=setup();s=posting(a,s,k.project,'capital',500,{otherAccount:'bank'});s=posting(a,s,k.project,'itemPurchase',100,{itemName:'سكراب'});let item=pstate(s,k).items[0];s=posting(a,s,k.project,'sale',30,{itemId:item.id,channel:'scrap'});let m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.pending,30);assert.equal(m.profit,0);assert.equal(m.netWorth,500);
 pstate(s,k).items[0].status='scrap';m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.profit,-70);assert.equal(m.inventory,0);assert.equal(m.pending,0);
});
test('project edits and deletions keep original snapshots and reverse matching cash exactly once',()=>{
 let {a,s,k}=setup();s=posting(a,s,k.project,'capital',1000,{otherAccount:'bank'});s=posting(a,s,k.project,'operating',100);const before=JSON.stringify(s),event=pstate(s,k).events.at(-1);let next=a.editEvent(s,k.project,event.id,{amount:150,date:'2026-11-13',note:'new'});assert.equal(JSON.stringify(s),before);assert.equal(a.metrics(next,pstate(next,k),'2026-11-13').cash,850);
 next=a.removeEvent(next,k.project,event.id);assert.equal(a.metrics(next,pstate(next,k),'2026-11-13').cash,1000);assert.equal(a.metrics(next,pstate(next,k),'2026-11-13').profit,0);assert.throws(()=>a.removeEvent(next,k.project,event.id),/غير موجود/);
 assert.throws(()=>posting(a,next,k.project,'operating',1001),/رصيد/);
});
test('linked vehicle depreciation and legacy operation data feed project without duplicating purchases',()=>{
 let {a,s,k}=setup();s.incomeAssets.push({id:'car',projectId:k.project,name:'Car',purchaseCost:12000,purchaseDate:'2025-11-13',usefulLifeYears:5,businessUsePercent:100,salvageValue:0});pstate(s,k).startDate='2025-11-13';s.transactions.push({id:'service',type:'income',amount:1000,incomeAssetId:'car'},{id:'cost',type:'expense',amount:200,incomeAssetId:'car'});s.savings.push({id:'fuel',type:'withdrawal',account:'bank',incomeAssetId:'car',amount:50},{id:'purchase',type:'withdrawal',account:'bank',assetId:'car',amount:12000});
 const m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.revenue,1000);assert.equal(m.operating,250);assert.ok(m.depreciation>2398&&m.depreciation<2400);assert.equal(m.profit,Math.round((750-m.depreciation)*100)/100);
});
test('canceling an asset purchase refunds its exact original account and rejects paid financing',()=>{
 const remove=app.match(/function incomeAssetRemovalPlan\(state,which\)\{[\s\S]*?\n\}/)[0],refund=app.match(/function incomeAssetRefundPlan\(state,which\)\{[\s\S]*?\n\}/)[0];const plan=new Function(remove+'\n'+refund+';return incomeAssetRefundPlan')();
 const s=base();s.incomeAssets=[{id:'car',purchaseCost:500}];s.savings.push({id:'buy',assetId:'car',type:'withdrawal',account:'bank',amount:500});const before=JSON.stringify(s),next=plan(s,'car');assert.equal(JSON.stringify(s),before);assert.equal(next.savings.length,1);assert.equal(api().balances(next).bank,300000);assert.equal(next.incomeAssets.length,0);assert.throws(()=>plan(next,'car'),/العثور/);
 s.savings=[];assert.throws(()=>plan(s,'car'),/حركة شراء/);s.incomeAssets[0].debtId='loan';s.debts=[{id:'loan',total:500,remaining:400}];assert.throws(()=>plan(s,'car'),/سداد/);s.debts[0].remaining=500;assert.equal(plan(s,'car').debts.length,0);
});

test('deleting an item sale reopens stock and reverses revenue and cash once',()=>{
 let {a,s,k}=setup();s=posting(a,s,k.project,'capital',500,{otherAccount:'bank'});s=posting(a,s,k.project,'itemPurchase',100,{itemName:'جهاز'});const item=pstate(s,k).items[0];s=posting(a,s,k.project,'sale',150,{itemId:item.id,closeItem:'yes'});const e=pstate(s,k).events.at(-1);s=a.removeEvent(s,k.project,e.id);const m=a.metrics(s,pstate(s,k),'2026-11-13');assert.equal(m.inventory,100);assert.equal(m.profit,0);assert.equal(m.cash,400);assert.equal(pstate(s,k).items[0].status,'stock');
});
test('project loan edits keep repayments; repayment edits update the liability',()=>{
 let {a,s,k}=setup();s=posting(a,s,k.project,'loan',1000,{monthly:100});const e=pstate(s,k).events[0];s=a.settle(s,k.project,'debts',e.debtId,200,{movement:'pay',date:'2026-11-13'});assert.equal(s.debts[0].remaining,800);s=a.editEvent(s,k.project,e.id,{amount:1200,date:'2026-11-13',note:'loan'});assert.equal(s.debts[0].remaining,1000);assert.equal(a.metrics(s,pstate(s,k),'2026-11-13').profit,0);assert.throws(()=>a.editEvent(s,k.project,e.id,{amount:100,date:'2026-11-13'}),/السداد|رصيد/);const adjust=new Function(app.match(/function savingsEditPlan\(state,which,changes\)\{[\s\S]*?\n\}/)[0]+';return savingsEditPlan')();const changed=adjust(s,'pay',{amount:150,account:k.account,date:'2026-11-13',note:'تصحيح سداد'});assert.equal(changed.debts[0].remaining,1050);assert.throws(()=>a.removeEvent(s,k.project,e.id),/سداد/);
});
test('historical unlinked purchase refund requires an explicit matching movement and preserves unrelated records',()=>{
 const a=api(),s=base();s.savings.push({id:'old',type:'withdrawal',account:'bank',amount:500,note:'شراء أصل مدر للدخل: سيارة محذوفة'});const before=JSON.stringify(s);assert.equal(a.orphanPurchases(s).length,1);const next=a.refundOrphan(s,'old');assert.equal(JSON.stringify(s),before);assert.equal(a.balances(next).bank,300000);assert.equal(next.savings.length,1);assert.throws(()=>a.refundOrphan(next,'old'),/حركة/);
 s.incomeAssets.push({id:'live',name:'سيارة محذوفة',purchaseCost:500});assert.equal(a.orphanPurchases(s).length,0);assert.throws(()=>a.refundOrphan(s,'old'),/حركة/);
});

test('linking a legacy asset preserves its historical project operations after removing the asset definition',()=>{
 const a=api(),s=base();s.incomeAssets.push({id:'car',name:'Car',purchaseCost:500,purchaseDate:'2026-11-13'});s.transactions.push({id:'income',incomeAssetId:'car',type:'income',amount:100});s.savings.push({id:'op',incomeAssetId:'car',type:'withdrawal',amount:20,account:'bank'});const k=keys();let next=a.configure(s,null,{name:'Project',startDate:'2026-11-13',assetIds:['car']},k);assert.equal(next.transactions[0].projectId,k.project);assert.equal(next.savings[1].projectAssetOperation,true);
 const removal=app.match(/function incomeAssetRemovalPlan\(state,which\)\{[\s\S]*?\n\}/)[0];next=new Function(removal+';return incomeAssetRemovalPlan')()(next,'car');assert.equal(a.metrics(next,pstate(next,k),'2026-11-13').profit,80);assert.equal(next.savings[1].amount,20);
});

test('partial project depreciation does not halve the owned vehicle book value or its debt',()=>{
 const {a,s,k}=setup();const p=pstate(s,k);p.startDate='2025-11-13';s.incomeAssets.push({id:'car',projectId:k.project,purchaseCost:12000,purchaseDate:'2025-11-13',usefulLifeYears:5,businessUsePercent:50,salvageValue:0,debtId:'carloan'});s.debts.push({id:'carloan',total:12000,remaining:10000});const m=a.metrics(s,p,'2026-11-13');assert.ok(m.depreciation>1199&&m.depreciation<1200);assert.ok(m.assetValue>9600&&m.assetValue<9602);assert.equal(m.liabilities,10000);
 const reloaded=JSON.parse(JSON.stringify(s));assert.equal(a.metrics(reloaded,pstate(reloaded,k),'2026-11-13').profit,m.profit);
});

test('cost centers split vehicle, inventory and overhead without changing cash or deducting costs twice',()=>{
 let {a,s,k}=setup();s=posting(a,s,k.project,'capital',1000,{otherAccount:'bank'});s=posting(a,s,k.project,'itemPurchase',200,{itemName:'Device'});const item=pstate(s,k).items[0].id;s=posting(a,s,k.project,'itemCost',80,{itemId:item});s=posting(a,s,k.project,'operating',50,{costCenter:'vehicle',category:'وقود'});s=posting(a,s,k.project,'operating',30,{costCenter:'general',category:'إيجار'});s=posting(a,s,k.project,'operating',20,{costCenter:'devices',category:'قطع غيار صيانة العملاء'});
 const before=JSON.stringify(s),p=pstate(s,k),m=a.metrics(s,p,'2026-11-13'),g=a.costBreakdown(s,p,'2026-11-13');assert.equal(g.vehicle.operating,50);assert.equal(g.general.operating,30);assert.equal(g.devices.operating,20);assert.equal(g.devices.purchases,200);assert.equal(g.devices.repairs,80);assert.equal(m.inventory,280);assert.equal(m.profit,-100);assert.equal(m.operating,g.vehicle.operating+g.general.operating+g.devices.operating);assert.equal(JSON.stringify(s),before);
 const e=p.events.find(e=>e.costCenter==='vehicle');s=a.editEvent(s,k.project,e.id,{amount:50,date:'2026-11-13',costCenter:'general'});assert.equal(a.costBreakdown(s,pstate(s,k),'2026-11-13').general.operating,80);assert.equal(a.metrics(s,pstate(s,k),'2026-11-13').profit,m.profit);
});

test('legacy car costs and depreciation are classified for display without duplicating ledger entries',()=>{
 const {a,s,k}=setup();const p=pstate(s,k);p.startDate='2025-11-13';s.incomeAssets.push({id:'car',projectId:k.project,name:'سيارة الأجهزة',purchaseCost:1000,purchaseDate:'2025-11-13',usefulLifeYears:5});s.savings.push({id:'fuel',type:'withdrawal',incomeAssetId:'car',amount:30,account:'bank',category:'وقود'});s.transactions.push({id:'rent',type:'expense',amount:10,projectId:k.project,projectAssetOperation:true,category:'إيجار'});const snapshot=JSON.stringify(s),g=a.costBreakdown(s,p,'2026-11-13'),m=a.metrics(s,p,'2026-11-13');assert.equal(g.vehicle.operating,30);assert.equal(g.general.operating,10);assert.equal(g.vehicle.depreciation,m.depreciation);assert.equal(g.vehicle.operating+g.general.operating,m.operating);assert.equal(JSON.stringify(s),snapshot);
});
