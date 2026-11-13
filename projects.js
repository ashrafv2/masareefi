/* Business records share the existing incomeAssets envelope, backups and encrypted sync.
 * Business documents and cash movements are distinct; no automatic data migration. */
(function(){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const num=x=>Number(x)||0,round=x=>Math.round((x+Number.EPSILON)*100)/100;
const projects=s=>(s.incomeAssets||[]).filter(x=>x.kind==='project');
const same=(a,b)=>String(a)===String(b);
function fail(message){throw Error(message)}
function amount(value,zero=false){const n=Number(value);if(!Number.isFinite(n)||n<(zero?0:0.01)||n>99999999999||Math.abs(n*100-Math.round(n*100))>0.00001)fail('أدخل مبلغًا صحيحًا بخانتين عشريتين كحد أقصى.');return n}
function day(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('اختر تاريخًا صحيحًا.');return value}
function balances(s){const out={};for(const r of s.savings){const v=Math.round(num(r.amount)*100),a=r.account||'bank';out[a]=(out[a]||0)+(r.type==='withdrawal'||r.type==='transfer'?-v:v);if(r.type==='transfer')out[r.toAccount]=(out[r.toAccount]||0)+v}return out}
function checkBalances(before,next){const a=balances(before),b=balances(next);for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if((b[key]||0)<Math.min(0,a[key]||0))fail('رصيد الحساب لا يكفي لهذه العملية. موّل حساب المشروع أو راجع الحركات أولًا.')}
function project(s,key){const p=projects(s).find(x=>same(x.id,key));if(!p)fail('المشروع غير موجود.');if(!Array.isArray(p.items))p.items=[];if(!Array.isArray(p.events))p.events=[];return p}
function sourceRow(s,event){return event.source&&Array.isArray(s[event.source])?s[event.source].find(x=>same(x.id,event.sourceId)):null}
function eventValue(s,event){const row=sourceRow(s,event);return row?num(event.source==='debts'?row.total:row.amount):num(event.amount)}
function assetCenter(a){return a?.assetClass==='vehicle'||(!a?.assetClass&&/سيار|مركبة|شاحنة|وانيت|car|vehicle/i.test(a?.name||''))?'vehicle':'general'}
function eventCenter(s,e){
 if(['itemPurchase','itemCost','sale'].includes(e.type))return 'devices';
 if(e.type!=='operating')return 'general';
 if(['vehicle','devices','general'].includes(e.costCenter))return e.costCenter;
 const row=sourceRow(s,e),asset=s.incomeAssets.find(a=>same(a.id,e.assetId||row?.incomeAssetId));
 if(asset)return assetCenter(asset);
 return ['وقود','صيانة السيارة','تأمين','رسوم السيارة'].includes(e.category||row?.category)?'vehicle':'general';
}
function costBreakdown(s,p,asof){
 const groups={vehicle:{operating:0,depreciation:0,rows:[]},devices:{operating:0,purchases:0,repairs:0,rows:[]},general:{operating:0,depreciation:0,rows:[]}};
 const events=p.events||[],seen=new Set(events.map(e=>e.source+':'+e.sourceId)),related=s.incomeAssets.filter(a=>a.kind!=='project'&&same(a.projectId,p.id));
 for(const e of events){const center=eventCenter(s,e),v=eventValue(s,e);if(['operating','itemPurchase','itemCost'].includes(e.type))groups[center].rows.push({...e,value:v});if(e.type==='operating')groups[center].operating+=v;if(e.type==='itemPurchase')groups.devices.purchases+=v;if(e.type==='itemCost')groups.devices.repairs+=v}
 for(const source of ['transactions','savings'])for(const r of s[source]){
  if(r.projectEventId||seen.has(source+':'+r.id)||!(related.some(a=>same(a.id,r.incomeAssetId))||(same(r.projectId,p.id)&&r.projectAssetOperation)))continue;
  if(!['expense','withdrawal'].includes(r.type))continue;
  const e={id:r.id,type:'operating',date:r.date,note:r.note,category:r.category,assetId:r.incomeAssetId,source,sourceId:r.id},center=eventCenter(s,e);
  groups[center].operating+=num(r.amount);groups[center].rows.push({...e,value:num(r.amount),legacy:true});
 }
 for(const a of related){const price=num(a.purchaseCost),salvage=Math.min(price,Math.max(0,num(a.salvageValue))),years=num(a.usefulLifeYears)||5,use=Math.min(100,Math.max(0,a.businessUsePercent==null?100:num(a.businessUsePercent)))/100,start=[a.purchaseDate||asof,p.startDate||asof].sort().at(-1),days=Math.max(0,(Date.parse(asof)-Date.parse(start))/86400000);groups[assetCenter(a)].depreciation+=Math.min(price-salvage,(price-salvage)/years*days/365.25)*use}
 for(const g of Object.values(groups))for(const k of Object.keys(g))if(k!=='rows')g[k]=round(g[k]);
 return groups;
}
function metrics(s,p,asof){
 const events=p.events||[],items=p.items||[],related=(s.incomeAssets||[]).filter(a=>a.kind!=='project'&&same(a.projectId,p.id));
 const costOf=i=>round(events.filter(e=>same(e.itemId,i.id)&&['itemPurchase','itemCost'].includes(e.type)).reduce((v,e)=>v+eventValue(s,e),0));
 const proceeds=i=>round(events.filter(e=>same(e.itemId,i.id)&&e.type==='sale').reduce((v,e)=>v+eventValue(s,e),0));
 let revenue=0,cost=0,inventory=0,operating=0,pending=0;
 for(const i of items){if(i.status==='stock'){inventory+=costOf(i);pending+=proceeds(i)}else{cost+=costOf(i);revenue+=proceeds(i)}}
 for(const e of events){const value=eventValue(s,e);if(e.type==='service'||(e.type==='sale'&&!e.itemId))revenue+=value;if(e.type==='operating')operating+=value}
 let depreciation=0,assetValue=0;
 for(const a of related){const price=num(a.purchaseCost),salvage=Math.min(price,Math.max(0,num(a.salvageValue))),years=num(a.usefulLifeYears)||5,use=Math.min(100,Math.max(0,a.businessUsePercent==null?100:num(a.businessUsePercent)))/100;
  const start=[a.purchaseDate||asof,p.startDate||asof].sort().at(-1),days=Math.max(0,(Date.parse(asof)-Date.parse(start))/86400000),fullDep=Math.min(price-salvage,(price-salvage)/years*days/365.25);
  depreciation+=fullDep*use;assetValue+=price-fullDep;
 }
 const eventSources=new Set(events.map(e=>e.source+':'+e.sourceId)),assetIds=new Set(related.map(a=>String(a.id)));
 for(const r of s.transactions||[])if(!r.projectEventId&&(assetIds.has(String(r.incomeAssetId))||(same(r.projectId,p.id)&&r.projectAssetOperation))&&!eventSources.has('transactions:'+r.id)){if(r.type==='income')revenue+=num(r.amount);else operating+=num(r.amount)}
 for(const r of s.savings||[])if(!r.projectEventId&&(assetIds.has(String(r.incomeAssetId))||(same(r.projectId,p.id)&&r.projectAssetOperation))&&!eventSources.has('savings:'+r.id)){if(r.type==='deposit')revenue+=num(r.amount);else if(r.type==='withdrawal')operating+=num(r.amount)}
 const debtIds=new Set(related.map(a=>String(a.debtId)).filter(x=>x!=='undefined'&&x!=='null'));
 const liabilities=(s.debts||[]).filter(d=>same(d.projectId,p.id)||debtIds.has(String(d.id))).reduce((v,d)=>v+num(d.remaining),0);
 const receivable=(s.receivables||[]).filter(r=>same(r.projectId,p.id)).reduce((v,r)=>v+num(r.remaining),0),cash=(balances(s)[p.accountId]||0)/100;
 return {revenue:round(revenue),cost:round(cost),operating:round(operating),depreciation:round(depreciation),profit:round(revenue-cost-operating-depreciation),cash:round(cash),inventory:round(inventory),receivable:round(receivable),liabilities:round(liabilities),assetValue:round(assetValue),netWorth:round(cash+inventory+receivable+assetValue-liabilities-pending),pending:round(pending),items:items.map(i=>({...i,cost:costOf(i),proceeds:proceeds(i),margin:round(proceeds(i)-costOf(i))}))};
}
function configure(state,key,values,keys){
 const next=clone(state),name=String(values.name||'').trim();if(!name||name.length>80)fail('أدخل اسم مشروع واضحًا.');
 const startDate=day(values.startDate);let p;
 if(key){p=project(next,key);const account=next.savingAccounts.find(a=>same(a.id,p.accountId));if(account&&account.name==='حساب '+p.name)account.name='حساب '+name;Object.assign(p,{name,startDate})}
 else{const accountId=keys.account;p={id:keys.project,kind:'project',name,startDate,accountId,items:[],events:[]};next.incomeAssets.push(p);next.savingAccounts.push({id:accountId,name:'حساب '+name,type:'bank',projectId:p.id})}
 const selected=values.assetIds||[];
 for(const a of next.incomeAssets.filter(a=>a.kind!=='project')){
  if(selected.some(k=>same(k,a.id))){if(a.projectId&&!same(a.projectId,p.id))fail('أحد الأصول مرتبط بمشروع آخر.');a.projectId=p.id;
   if(a.debtId!=null){const d=next.debts.find(d=>same(d.id,a.debtId));if(d){if(d.projectId&&!same(d.projectId,p.id))fail('تمويل الأصل مرتبط بمشروع آخر.');d.projectId=p.id}}
   for(const row of [...next.transactions,...next.savings])if(same(row.incomeAssetId,a.id)&&!row.projectEventId)Object.assign(row,{projectId:p.id,projectAssetOperation:true});
   const years=Number(values['life-'+a.id]||5),use=Number(values['use-'+a.id]??100),salvage=amount(values['salvage-'+a.id]||0,true);
   if(!Number.isFinite(years)||years<=0||years>100||!Number.isFinite(use)||use<0||use>100||salvage>num(a.purchaseCost))fail('راجع سنوات الاستخدام ونسبة الاستخدام وقيمة الخردة للأصل.');
   Object.assign(a,{assetClass:values['class-'+a.id]||a.assetClass||(assetCenter(a)==='vehicle'?'vehicle':'equipment'),usefulLifeYears:years,businessUsePercent:use,salvageValue:salvage});
  }else if(same(a.projectId,p.id))delete a.projectId;
 }
 return next;
}
function post(state,key,values,keys){
 const next=clone(state),p=project(next,key),type=values.type,date=day(values.date),value=amount(values.amount),note=String(values.note||'').trim();
 const allowed=['capital','ownerDraw','loan','itemPurchase','itemCost','sale','service','operating'];if(!allowed.includes(type))fail('نوع العملية غير صحيح.');
 if(!next.savingAccounts.some(a=>same(a.id,p.accountId)))fail('حساب المشروع غير موجود.');
 let itemId=values.itemId||'';
 if(type==='itemPurchase'){const name=String(values.itemName||'').trim();if(!name)fail('أدخل اسم الجهاز.');itemId=keys.item;p.items.push({id:itemId,name,status:'stock',date})}
 if(itemId){const item=p.items.find(i=>same(i.id,itemId));if(!item||item.status!=='stock')fail('اختر جهازًا مفتوحًا في المخزون.');if(type==='sale'&&values.closeItem==='yes')item.status=values.channel==='scrap'?'scrap':'sold'}
 if(type==='itemCost'&&!itemId)fail('اختر الجهاز المرتبط بالتكلفة.');
 const e={id:keys.event,type,amount:value,date,note,itemId,category:String(values.category||''),costCenter:['vehicle','devices','general'].includes(values.costCenter)?values.costCenter:'',channel:values.channel||'',closesItem:!!itemId&&type==='sale'&&values.closeItem==='yes',source:'savings',sourceId:keys.movement};
 if(values.assetId&&!next.incomeAssets.some(a=>a.kind!=='project'&&same(a.id,values.assetId)&&same(a.projectId,p.id)))fail('الأصل غير مرتبط بالمشروع.');
 const row={id:keys.movement,category:String(values.category||labels[type]||type),projectId:p.id,projectEventId:e.id,projectKind:type,itemId,amount:value,date,note:note||p.name,account:p.accountId,type:['sale','service','loan'].includes(type)?'deposit':'withdrawal'};
 if(values.assetId){row.incomeAssetId=values.assetId;e.assetId=values.assetId}
 if(type==='capital'||type==='ownerDraw'){
  const other=values.otherAccount;if(!next.savingAccounts.some(a=>a.id===other)||same(other,p.accountId))fail('اختر حسابًا آخر للتحويل.');
  row.type='transfer';row.account=type==='capital'?other:p.accountId;row.toAccount=type==='capital'?p.accountId:other;
 }else if(type==='loan'){
  const monthly=amount(values.monthly||0,true);e.debtId=keys.debt;next.debts.push({id:keys.debt,projectId:p.id,name:'تمويل '+p.name,total:value,remaining:value,monthly,due:''});
 }else if(values.payment==='credit'){
  if(['sale','service'].includes(type)){e.source='receivables';e.sourceId=keys.receivable;next.receivables.push({id:keys.receivable,projectId:p.id,name:note||p.name,amount:value,remaining:value,debtDate:date,note})}
  else if(['itemPurchase','itemCost','operating'].includes(type)){e.source='debts';e.sourceId=keys.debt;next.debts.push({id:keys.debt,projectId:p.id,name:note||p.name,total:value,remaining:value,monthly:0,due:''})}
  else fail('لا يدعم هذا النوع التسجيل الآجل.');
 }
 if(e.source==='savings')next.savings.push(row);
 p.events.push(e);checkBalances(state,next);return next;
}
function editEvent(state,key,eventId,values){
 let next=clone(state),p=project(next,key),e=p.events.find(x=>same(x.id,eventId));if(!e)fail('المستند غير موجود.');
 const value=amount(values.amount),date=day(values.date),note=String(values.note||'').trim(),row=sourceRow(next,e);
 if(!row)fail('الحركة المالية المرتبطة محذوفة. أعد مراجعة المستند والنسخة الاحتياطية بدل تعديل مبلغ غير مرتبط.');
 if(e.source==='savings'){
  const changes={amount:value,account:row.account||'bank',toAccount:row.toAccount,date,note};
  next=savingsEditPlan(next,row.id,changes);p=project(next,key);e=p.events.find(x=>same(x.id,eventId));
 }else if(e.source==='receivables'){
  if(!Number.isFinite(Number(row.amount))||!Number.isFinite(Number(row.remaining))||num(row.remaining)<0||num(row.remaining)>num(row.amount))fail('بيانات المستحق تحتاج مراجعة.');const paid=round(num(row.amount)-num(row.remaining));if(value<paid)fail('المبلغ أقل من التحصيلات المسجلة.');Object.assign(row,{amount:value,remaining:round(value-paid),note,debtDate:date});
 }else if(e.source==='debts'){
  if(!Number.isFinite(Number(row.total))||!Number.isFinite(Number(row.remaining))||num(row.remaining)<0||num(row.remaining)>num(row.total))fail('بيانات الالتزام تحتاج مراجعة.');const paid=round(num(row.total)-num(row.remaining));if(value<paid)fail('المبلغ أقل من السداد المسجل.');Object.assign(row,{total:value,remaining:round(value-paid),name:note||row.name});
 }
 if(e.debtId){const d=next.debts.find(d=>same(d.id,e.debtId));if(!d)fail('التمويل المرتبط غير موجود.');const paid=round(num(d.total)-num(d.remaining));if(value<paid)fail('المبلغ أقل من السداد المسجل.');Object.assign(d,{total:value,remaining:round(value-paid)})}
 if(e.type==='operating'&&['vehicle','devices','general'].includes(values.costCenter))e.costCenter=values.costCenter;
 Object.assign(e,{amount:value,date,note});return next;
}
function removeEvent(state,key,eventId){
 const next=clone(state),p=project(next,key),e=p.events.find(x=>same(x.id,eventId));if(!e)fail('المستند غير موجود.');
 const row=sourceRow(next,e);
 if((e.source==='receivables'&&row&&num(row.amount)!==num(row.remaining))||(e.source==='debts'&&row&&num(row.total)!==num(row.remaining)))fail('للمستند تحصيل أو سداد. لا يمكن حذفه قبل مراجعته.');
 if(e.debtId){const d=next.debts.find(d=>same(d.id,e.debtId));if(!d||num(d.total)!==num(d.remaining))fail('للتمويل سداد، فلا يمكن حذف مستنده.');next.debts=next.debts.filter(d=>!same(d.id,e.debtId))}
 if(e.type==='itemPurchase'&&p.events.some(x=>!same(x.id,e.id)&&same(x.itemId,e.itemId)))fail('للجهاز مصروفات أو مبيعات. احذفها أو صححها قبل حذف شرائه.');
 if(row)next[e.source]=next[e.source].filter(x=>!same(x.id,e.sourceId));
 if(e.type==='itemPurchase')p.items=p.items.filter(i=>!same(i.id,e.itemId));
 p.events=p.events.filter(x=>!same(x.id,e.id));
 if(e.closesItem&&!p.events.some(x=>same(x.itemId,e.itemId)&&x.closesItem)){const item=p.items.find(i=>same(i.id,e.itemId));if(item&&['sold','scrap'].includes(item.status))item.status='stock'}
 checkBalances(state,next);return next;
}
function settle(state,key,source,which,value,keys){
 const next=clone(state),p=project(next,key);if(!next.savingAccounts.some(a=>same(a.id,p.accountId)))fail('حساب المشروع غير موجود.');if(!['debts','receivables'].includes(source))fail('نوع المستند غير صحيح.');
 const r=next[source].find(x=>same(x.id,which));const linkedAsset=next.incomeAssets.some(a=>same(a.projectId,p.id)&&same(a.debtId,which));
 if(!r||(!same(r.projectId,p.id)&&!linkedAsset))fail('المستند غير مرتبط بالمشروع.');
 const v=amount(value);if(v>num(r.remaining))fail('المبلغ أكبر من المتبقي.');r.remaining=round(num(r.remaining)-v);
 next.savings.push({id:keys.movement,type:source==='debts'?'withdrawal':'collection',account:p.accountId,amount:v,date:keys.date,note:source==='debts'?'سداد '+r.name:'تحصيل '+r.name,projectId:p.id,...(source==='receivables'?{receivableId:r.id}:{projectDebtId:r.id})});checkBalances(state,next);return next;
}
function orphanPurchases(s){return s.savings.filter(r=>r.type==='withdrawal'&&String(r.note||'').startsWith('شراء أصل مدر للدخل: ')&&!r.incomeAssetId&&!r.projectEventId&&!r.receivableId&&!r.projectDebtId&&!s.incomeAssets.some(a=>a.kind!=='project'&&(same(a.id,r.assetId)||'شراء أصل مدر للدخل: '+a.name===r.note)))}
function refundOrphan(state,which){
 const rows=orphanPurchases(state).filter(r=>same(r.id,which));
 if(rows.length!==1||state.savings.filter(r=>same(r.id,which)).length!==1)fail('لا توجد حركة شراء قديمة واحدة قابلة للمراجعة.');
 const row=rows[0];amount(row.amount);if(!state.savingAccounts.some(a=>same(a.id,row.account||'bank')))fail('الحساب الأصلي غير موجود.');
 return {...state,savings:state.savings.filter(r=>!same(r.id,which))};
}
const labels={capital:'تمويل من حساب آخر',ownerDraw:'سحب شخصي',loan:'تمويل أو قرض',itemPurchase:'شراء جهاز للمخزون',itemCost:'إصلاح أو نقل جهاز',sale:'بيع جهاز أو سكراب',service:'أجر صيانة أو توصيل',operating:'مصروف تشغيل'};
const UI=()=>typeof document!=='undefined';
function commit(next){localStorage.setItem(KEY,JSON.stringify(next));data=next;closeModal();render();window.masareefiSyncV19?.onPersist?.()}
function fields(name,title,type='text',value='',extra=''){return `<div class="field"><label for="business-${safe(name)}">${title}</label><input id="business-${safe(name)}" name="${safe(name)}" type="${type}" value="${safe(value)}" ${extra}></div>`}
function form(title,body,submit){
 const original=JSON.stringify(data);
 openModal(title,`<form id="businessForm">${body}<p id="businessError" class="negative" role="alert"></p><div class="actions"><button type="submit" class="btn">حفظ</button><button type="button" class="btn secondary" id="businessCancel">إلغاء</button></div></form>`);
 el('businessCancel').onclick=closeModal;el('businessForm').onsubmit=e=>{e.preventDefault();try{if(JSON.stringify(data)!==original)fail('تغيرت البيانات أثناء فتح النافذة. أعد فتحها لمراجعة أحدث نسخة.');const values=Object.fromEntries(new FormData(e.currentTarget).entries());values.assetIds=new FormData(e.currentTarget).getAll('assetIds');commit(submit(values))}catch(err){el('businessError').textContent=err.name==='QuotaExceededError'?'تعذر الحفظ. لم تتغير البيانات.':err.message}};
}
function configureUI(key){
 const p=key?project(clone(data),key):null;
 const candidates=data.incomeAssets.filter(a=>a.kind!=='project'&&(!a.projectId||same(a.projectId,key)));
 const assets=candidates.map(a=>`<fieldset class="business-asset-option"><legend><label><input type="checkbox" name="assetIds" value="${safe(a.id)}" ${same(a.projectId,key)&&key?'checked':''}> ${safe(a.name)}</label></legend><div class="field"><label>نوع الأصل لتجميع التكاليف</label><select name="class-${safe(a.id)}"><option value="vehicle" ${assetCenter(a)==='vehicle'?'selected':''}>سيارة / مركبة</option><option value="equipment" ${assetCenter(a)!=='vehicle'?'selected':''}>معدات أخرى</option></select></div>${fields('life-'+a.id,'العمر الإنتاجي بالسنوات','number',a.usefulLifeYears||5,'min="0.1" max="100" step="0.1"')}${fields('use-'+a.id,'حصة المشروع من الاستهلاك %','number',a.businessUsePercent??100,'min="0" max="100"')}${fields('salvage-'+a.id,'القيمة المتبقية عند نهاية العمر','number',a.salvageValue||0,'min="0" step="0.01"')}</fieldset>`).join('');
 form(p?'إعدادات المشروع':'إنشاء مشروع',fields('name','اسم المشروع','text',p?.name||'','required maxlength="80" placeholder="مشروع الأجهزة الكهربائية"')+fields('startDate','تاريخ بدء النشاط','date',p?.startDate||today(),'required')+`<p class="notice">${p?'يبقى حساب المشروع وحركاته كما هي.':'سيُنشأ حساب ادخار مستقل بصفر. استخدم «تمويل المشروع» لنقل رأس مال إليه، دون احتسابه إيرادًا.'}</p><h3>الأصول التابعة للمشروع</h3><p class="footnote">الربط لا يعيد تسجيل ثمن السيارة أو سحبه. الاستهلاك تقديري بطريقة القسط الثابت وفق العمر والقيمة المتبقية وحصة المشروع من الاستهلاك المدخلة أدناه؛ قيمة الأصل الدفترية كاملة، من تاريخ الاقتناء أو بدء المشروع أيهما أحدث.</p>${assets||'<p>يمكن إضافة سيارة أو معدات من «＋ أصل» ثم ربطها بالمشروع.</p>'}`,
 v=>configure(data,key,v,{project:id(),account:id()}));
}
const viewSelection=new Map();
const centerNames={all:'الكل',vehicle:'السيارة',devices:'الأجهزة وإصلاحها',general:'المصاريف العامة'};
function centerField(value){return `<div class="field"><label for="business-costCenter">القسم</label><select name="costCenter" id="business-costCenter">${['vehicle','devices','general'].map(c=>`<option value="${c}" ${value===c?'selected':''}>${centerNames[c]}</option>`).join('')}</select></div>`}
function costView(s,p,m){
 const groups=costBreakdown(s,p,today()),selected=viewSelection.get(String(p.id))||'all';
 const card=(c,title,html)=>selected==='all'||selected===c?`<section class="business-cost-panel" data-cost-panel="${c}"><h3>${title}</h3>${html}</section>`:'';
 const line=(label,v)=>`<div class="business-cost-line"><span>${label}</span><b>${money(v)}</b></div>`;
 const car=groups.vehicle,devices=groups.devices,general=groups.general;
 return `<div class="business-cost-tabs" role="group" aria-label="عرض تكاليف المشروع">${Object.entries(centerNames).map(([c,name])=>`<button type="button" data-business="costView" data-project="${safe(p.id)}" data-view="${c}" aria-pressed="${selected===c}">${name}</button>`).join('')}</div><div class="business-cost-panels">${card('vehicle','تكاليف السيارة',line('تشغيل: وقود وصيانة وتأمين وغيرها',car.operating)+line('استهلاك تقديري',car.depreciation)+line('الإجمالي',round(car.operating+car.depreciation)))}${card('devices','تكاليف الأجهزة وإصلاحها',line('شراء الأجهزة المسجل',devices.purchases)+line('إصلاح ونقل الأجهزة المسجل',devices.repairs)+line('تشغيل / قطع صيانة العملاء',devices.operating)+line('تكلفة الأجهزة المباعة والتالفة',m.cost)+line('تكلفة الأجهزة المتبقية بالمخزون',m.inventory)+line('هامش الأجهزة المقفلة قبل التشغيل',round(m.items.filter(i=>i.status!=='stock').reduce((v,i)=>v+i.proceeds,0)-m.cost)))}${card('general','المصاريف العامة',line('تشغيل عام',general.operating)+line('استهلاك المعدات الأخرى',general.depreciation)+line('الإجمالي',round(general.operating+general.depreciation)))}</div><p class="footnote">التقسيم للعرض فقط؛ لا ينشئ مصروفًا جديدًا. نقل جهاز مسجل في تكلفته لا يُخصم مرة ثانية. المشتريات والإصلاحات الخاصة بالمخزون لا تدخل الربح حتى إقفال الجهاز.</p>${selected!=='all'?`<details open><summary>حركات ${centerNames[selected]}</summary>${groups[selected].rows.map(e=>`<div class="business-event"><b>${safe(labels[e.type]||e.type)} — ${money(e.value)}</b><small>${safe(e.category||'')} · ${safe(e.date||'')} · ${safe(e.note||'')}</small>${!e.legacy?`<button type="button" class="subtlelink" data-business="edit" data-project="${safe(p.id)}" data-id="${safe(e.id)}">تعديل</button>`:''}</div>`).join('')||'<p class="empty">لا توجد حركات في هذا القسم.</p>'}</details>`:''}`;
}
function postUI(key,type,assetId,initialCenter){
 const p=project(clone(data),key),items=p.items.filter(i=>i.status==='stock');
 const itemSelect=`<div class="field"><label for="business-itemId">الجهاز</label><select id="business-itemId" name="itemId">${items.map(i=>`<option value="${safe(i.id)}">${safe(i.name)}</option>`).join('')}${type==='sale'?'<option value="">سكراب أو بيع عام دون جهاز مسجل</option>':''}</select></div>`;
 let body=(assetId?`<input type="hidden" name="assetId" value="${safe(assetId)}">`:'')+`<p class="notice">الحساب: ${safe(accountLabel(p.accountId))}. الرصيد ${money(savingAccountTotal(p.accountId))}.</p>`;
 if(type==='itemPurchase')body+=fields('itemName','اسم أو رقم الجهاز','text','','required placeholder="غسالة سامسونج رقم 1"');
 if(['itemCost','sale'].includes(type))body+=itemSelect;
 body+=fields('amount','المبلغ (ريال)','number','','required min="0.01" step="0.01"')+fields('date','التاريخ','date',today(),'required')+fields('note','العميل أو المورد / الوصف');
 if(['capital','ownerDraw'].includes(type))body+=`<div class="field"><label for="business-otherAccount">${type==='capital'?'التحويل من':'التحويل إلى'}</label><select name="otherAccount" id="business-otherAccount">${data.savingAccounts.filter(a=>!same(a.id,p.accountId)).map(a=>`<option value="${safe(a.id)}">${safe(a.name)} — ${money(savingAccountTotal(a.id))}</option>`).join('')}</select></div>`;
 if(type==='loan')body+=fields('monthly','القسط الشهري (اختياري)','number',0,'min="0" step="0.01"');
 if(['itemPurchase','itemCost','operating','sale','service'].includes(type))body+=`<div class="field"><label for="business-payment">طريقة التسجيل</label><select name="payment" id="business-payment"><option value="cash">${['sale','service'].includes(type)?'تحصيل في حساب المشروع':'دفع من حساب المشروع'}</option><option value="credit">${['sale','service'].includes(type)?'آجل — مستحق على العميل':'آجل — التزام للمورد'}</option></select></div>`;
 if(type==='operating')body+=centerField(initialCenter||(assetId?assetCenter(data.incomeAssets.find(a=>same(a.id,assetId))):(['vehicle','devices','general'].includes(viewSelection.get(String(key)))?viewSelection.get(String(key)):'general')));
 if(type==='operating'||type==='itemCost')body+=`<div class="field"><label for="business-category">التصنيف</label><select name="category" id="business-category">${(type==='itemCost'?['قطع غيار','إصلاح','نقل الجهاز']:['أخرى','وقود','صيانة السيارة','رسوم السيارة','إيجار','عمالة','كهرباء','إعلان','نقل','تأمين','قطع غيار صيانة العملاء','تكلفة تمويل']).map(x=>`<option>${x}</option>`).join('')}</select></div>`;
 if(type==='sale')body+=`<div class="field"><label for="business-channel">نوع البيع</label><select name="channel" id="business-channel"><option value="used">جهاز مستعمل</option><option value="scrap">سكراب أو قطع</option></select></div><label class="business-check"><input type="checkbox" name="closeItem" value="yes" checked> إقفال الجهاز وإخراجه من المخزون بعد هذه البيعة.</label><p class="footnote">للبيع على أجزاء أزل الإشارة حتى اكتمال البيع. المتحصلات تظهر في السيولة، ويُحسب ربح الجهاز عند إقفاله.</p>`;
 if(type==='operating')body+='<p class="footnote">للمصاريف المشتركة مع الاستخدام الشخصي، سجّل نصيب المشروع فقط. نسبة الاستخدام في إعدادات الأصل تخص الاستهلاك، ولا تُقسّم الفاتورة تلقائيًا.</p>';
 form(labels[type],body,v=>post(data,key,{...v,type},{event:id(),movement:id(),item:id(),debt:id(),receivable:id()}));
}
function editUI(key,eventId){const p=project(clone(data),key),e=p.events.find(e=>same(e.id,eventId));if(!e)return;form('تعديل '+labels[e.type],fields('amount','المبلغ','number',eventValue(data,e),'required min="0.01" step="0.01"')+fields('date','التاريخ','date',e.date,'required')+fields('note','الوصف','text',e.note||'')+(e.type==='operating'?centerField(eventCenter(data,e)):'')+'<p class="footnote">يُحدّث المستند وحركته المرتبطة مع الحفاظ على التحصيل أو السداد السابق. لا يتغير الجهاز أو نوع العملية.</p>',v=>editEvent(data,key,eventId,v))}
function settleUI(key,source,which){const r=data[source].find(x=>same(x.id,which));if(!r)return;form(source==='debts'?'سداد من حساب المشروع':'تحصيل إلى حساب المشروع',`<p>${safe(r.name)} — المتبقي ${money(r.remaining)}</p>`+fields('amount','المبلغ','number',r.remaining,'required min="0.01" step="0.01"'),v=>settle(data,key,source,which,v.amount,{movement:id(),date:today()}))}
function renderUI(){
 const root=el('businessProjects');if(!root)return;
 root.innerHTML=projects(data).map(p=>{
  const m=metrics(data,p,today()),assets=data.incomeAssets.filter(a=>a.kind!=='project'&&same(a.projectId,p.id));
  const receivables=data.receivables.filter(r=>same(r.projectId,p.id)&&num(r.remaining)>0),loans=data.debts.filter(d=>(same(d.projectId,p.id)||assets.some(a=>same(a.debtId,d.id)))&&num(d.remaining)>0);
  const action=(a,text)=>`<button type="button" class="btn secondary" data-business="${a}" data-project="${safe(p.id)}">${text}</button>`;
  const values=[['السيولة المتاحة',m.cash],['الربح / الخسارة',m.profit],['قيمة المخزون',m.inventory],['المستحقات',m.receivable],['الالتزامات',m.liabilities],['صافي القيمة الدفترية',m.netWorth]];
  return `<article class="card business-project"><div class="sectionbar"><div><h2>${safe(p.name)}</h2><small>${safe(accountLabel(p.accountId))}</small></div>${action('configure','إعدادات المشروع')}</div><div class="business-metrics">${values.map(([label,value])=>`<div><small>${label}</small><strong class="${value<0?'negative':''}">${money(value)}</strong></div>`).join('')}</div>${costView(data,p,m)}<details class="business-accounting"><summary>كيف حُسب الربح؟</summary><p>إيرادات معترف بها ${money(m.revenue)} − تكلفة الأجهزة المباعة والتالفة ${money(m.cost)} − تشغيل ${money(m.operating)} − استهلاك تقديري للأصول ${money(m.depreciation)}.</p><p>تمويل الحساب والسحب الشخصي وأصل أقساط الدين لا تدخل في الربح. تكلفة الجهاز المفتوح تبقى مخزونًا. متحصلات أجهزة لم تُقفل: ${money(m.pending)}، لا تُحتسب ربحًا حتى الإقفال. القيمة الدفترية للأصول ${money(m.assetValue)}. صافي القيمة يستبعد متحصلات الأجهزة غير المقفلة مؤقتًا. العمليات السابقة للأصول المرتبطة تدخل في الربح دون نقل أرصدتها إلى حساب المشروع. قيمة المخزون والأصول بالقيمة الدفترية وليست سعر البيع المتوقع.</p></details><div class="business-actions">${[['capital','تمويل المشروع'],['itemPurchase','شراء جهاز'],['itemCost','إصلاح / نقل جهاز'],['sale','بيع جهاز / سكراب'],['service','إيراد صيانة / توصيل'],['vehicleExpense','مصروف السيارة'],['operating','مصروف عام / صيانة عملاء'],['ownerDraw','سحب شخصي'],['loan','تمويل أو قرض']].map(([a,t])=>action(a,t)).join('')}</div><details><summary>الأجهزة والمخزون (${m.items.length})</summary>${m.items.map(i=>`<div class="business-item"><b>${safe(i.name)}</b><small>${({stock:'في المخزون',sold:'مباع',scrap:'سكراب مقفل',writtenOff:'تالف / خسارة'})[i.status]||safe(i.status)}</small><div>التكلفة ${money(i.cost)} · المبيعات ${money(i.proceeds)}${i.status==='stock'?'':' · الربح / الخسارة '+money(i.margin)}</div><button type="button" class="subtlelink" data-business="item" data-project="${safe(p.id)}" data-item="${safe(i.id)}">تعديل الاسم والحالة</button></div>`).join('')||'<p class="empty">سجّل أول جهاز من «شراء جهاز».</p>'}</details>${receivables.length?`<details><summary>تحصيل المستحقات</summary>${receivables.map(r=>`<div class="listrow"><span class="rowmain">${safe(r.name)} — ${money(r.remaining)}</span><button class="btn secondary" data-business="collect" data-project="${safe(p.id)}" data-id="${safe(r.id)}">تحصيل</button></div>`).join('')}</details>`:''}${loans.length?`<details><summary>سداد الالتزامات</summary>${loans.map(d=>`<div class="listrow"><span class="rowmain">${safe(d.name)} — ${money(d.remaining)}</span><button class="btn secondary" data-business="pay" data-project="${safe(p.id)}" data-id="${safe(d.id)}">سداد</button></div>`).join('')}</details>`:''}<details><summary>سجل مستندات المشروع (${(p.events||[]).length})</summary>${(p.events||[]).slice().reverse().map(e=>`<div class="business-event"><b>${labels[e.type]||safe(e.type)} — ${money(eventValue(data,e))}</b><small>${safe(e.date)} · ${safe(e.note||'')}</small>${!sourceRow(data,e)?'<small class="negative">حركة الحساب الأصلية غير موجودة؛ المستند التجاري محفوظ.</small>':''}<div class="actions"><button class="btn secondary" data-business="edit" data-project="${safe(p.id)}" data-id="${safe(e.id)}">تعديل</button><button class="btn danger" data-business="delete" data-project="${safe(p.id)}" data-id="${safe(e.id)}">حذف المستند وحركته</button></div></div>`).join('')||'<p class="empty">لا مستندات بعد.</p>'}</details></article>`;
 }).join('')||'<div class="card notice">أنشئ مشروعًا يجمع السيارة والأجهزة والمبيعات والمصاريف. لن تتغير الأصول أو الأرصدة الحالية تلقائيًا.</div>';
 const orphans=orphanPurchases(data);
 if(orphans.length)root.innerHTML+=`<section class="card"><h3>مراجعة سحوبات شراء قديمة</h3><p class="footnote">هذه حركات بوصف شراء أصل لا يظهر ارتباطه بأصل حالي. راجعها، ولا تُلغِ إلا شراءً تريد التراجع عنه. لن يُرد أي مبلغ تلقائيًا.</p>${orphans.map(r=>`<div class="business-event"><b>${safe(r.note)}</b><small>${safe(accountLabel(r.account||'bank'))} · ${safe(r.date||'')} · ${money(r.amount)}</small><button type="button" class="btn secondary" data-business="orphanRefund" data-id="${safe(r.id)}">مراجعة وإلغاء سحب الشراء</button></div>`).join('')}</section>`;
}
window.masareefiProjects={costBreakdown,eventCenter,orphanPurchases,refundOrphan,metrics,configure,post,editEvent,removeEvent,settle,balances,render:renderUI,routeFinanceAction(action,which){
 if(!['collect','payDebt','deleteDebt','deleteReceivable'].includes(action))return false;
 const source=action==='collect'||action==='deleteReceivable'?'receivables':'debts',r=data[source].find(x=>same(x.id,which));if(!r)return false;
 const asset=data.incomeAssets.find(a=>a.kind!=='project'&&a.projectId&&same(a.debtId,which)),p=projects(data).find(p=>same(p.id,r.projectId)||same(p.id,asset?.projectId));if(!p)return false;
 if(action==='collect'||action==='payDebt'){settleUI(p.id,source,which);return true}
 if(asset){alert('الالتزام مرتبط بشراء أصل. استخدم خيارات حذف الأصل لمراجعة أثر إلغاء الشراء.');return true}
 const e=(p.events||[]).find(e=>(e.source===source&&same(e.sourceId,which))||same(e.debtId,which));if(!e){alert('المستند مرتبط بمشروع. راجع سجله قبل حذف الالتزام.');return true}
 if(confirm('حذف مستند المشروع وحركته المالية وإعادة حساب الأرصدة؟')){try{commit(removeEvent(data,p.id,e.id))}catch(err){alert(err.message)}}return true
 },openAssetTransaction(asset,type){postUI(asset.projectId,type==='income'?'service':'operating',asset.id)},editMovement(which){const row=data.savings.find(x=>same(x.id,which));if(!row?.projectEventId)return false;const p=projects(data).find(p=>same(p.id,row.projectId));if(!p?.events?.some(e=>same(e.id,row.projectEventId)))return false;editUI(p.id,row.projectEventId);return true},assetEvent(row,action){if(!row.projectEventId)return false;if(action==='edit')editUI(row.projectId,row.projectEventId);else if(action==='delete'&&confirm('حذف المستند وحركته المالية وإعادة حساب الرصيد والربح؟')){try{commit(removeEvent(data,row.projectId,row.projectEventId))}catch(err){alert(err.message)}}return true}};
if(!UI())return;
el('addBusinessProject').onclick=()=>configureUI();
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-business]');if(!b)return;const key=b.dataset.project,action=b.dataset.business;
 if(action==='costView'){if(!Object.hasOwn(centerNames,b.dataset.view))return;viewSelection.set(String(key),b.dataset.view);renderUI();rootFocus(key,b.dataset.view);return}
 if(action==='orphanRefund'){const row=orphanPurchases(data).find(r=>same(r.id,b.dataset.id));if(!row)return;if(!confirm('هل تريد إلغاء سحب '+money(row.amount)+' من حساب '+accountLabel(row.account||'bank')+'؟ سيعود أثر المبلغ إلى الحساب نفسه. تأكد أن الشراء أُلغي فعلًا؛ هذه العملية لا تلغي أي تمويل أو بيع سابق.'))return;try{commit(refundOrphan(data,row.id))}catch(err){alert(err.message)}return}
 if(action==='vehicleExpense'){postUI(key,'operating',null,'vehicle');return}
 if(action==='configure'){configureUI(key);return}if(labels[action]){postUI(key,action);return}
 if(action==='edit'){editUI(key,b.dataset.id);return}if(action==='collect'||action==='pay'){settleUI(key,action==='collect'?'receivables':'debts',b.dataset.id);return}
 if(action==='delete'){if(!confirm('حذف المستند وحركته المالية وإعادة حساب الرصيد والربح؟ لا يُحذف مستند سُدد أو حُصّل جزئيًا.'))return;try{commit(removeEvent(data,key,b.dataset.id))}catch(err){alert(err.message)}return}
 if(action==='item'){
  const p=project(clone(data),key),i=p.items.find(i=>same(i.id,b.dataset.item));if(!i)return;
  form('تعديل الجهاز',fields('name','اسم الجهاز','text',i.name,'required maxlength="120"')+`<div class="field"><label for="business-status">الحالة</label><select id="business-status" name="status">${[['stock','في المخزون / البيع لم يكتمل'],['sold','بيع مكتمل'],['scrap','بيع سكراب مكتمل'],['writtenOff','تالف / إعدام بالخسارة']].map(([v,t])=>`<option value="${v}" ${i.status===v?'selected':''}>${t}</option>`).join('')}</select></div><p class="notice">إقفال الجهاز يعترف بتكلفته ومبيعاته في الربح أو الخسارة. تغيير الحالة لا ينقل أموالًا.</p>`,v=>{const next=clone(data),item=project(next,key).items.find(x=>same(x.id,i.id));if(!v.name.trim()||!['stock','sold','scrap','writtenOff'].includes(v.status))fail('أدخل اسم الجهاز وحالة صحيحة.');Object.assign(item,{name:v.name.trim(),status:v.status});return next});
 }
});
function rootFocus(key,view){const button=[...document.querySelectorAll('[data-business=costView]')].find(b=>same(b.dataset.project,key)&&b.dataset.view===view);button?.focus({preventScroll:true})}
renderUI();
})();
