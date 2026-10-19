/* eslint-disable */
// Node test script: node tests/money-flags.cjs — cash advances, More Cards, Item Flags (Non Critical / Pay by).
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const cache={};
function load(file){if(cache[file])return cache[file].exports;const module={exports:{}};cache[file]=module;const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/import\.meta/g,'({ env: {} })');vm.runInNewContext(code,{module,exports:module.exports,require:m=>m.startsWith('.')?load(path.join(path.dirname(file),m)+'.ts'):require(m),structuredClone,Date,Map,Set,Object,JSON,Number,Math,Error,console,fetch:undefined},{filename:file});return module.exports;}
const plain=x=>JSON.parse(JSON.stringify(x));
const money=load('lib/money.ts'),edits=load('lib/billEdits.ts'),ledger=load('lib/moneyLedger.ts');
const today=new Date(2026,9,17);
// A tiny Randy tab: Bills block (G12) + the Life Hub side blocks at S2 (0-based rows/cols, like the export).
const v=[];const set=(r,c,t)=>{while(v.length<=r)v.push([]);v[r][c]=t;};
const G=6,S=18;
set(11,G,'Bills');[['Date Due','Bill','Amount'],['September 30','Verizon ','$85.00'],['10/9','Verizon ','$95.00'],['10/11','G Force','$9.99'],['10/15','Fortiva','$21.00'],['10/24','Split P 2','$165.00']].forEach((row,i)=>row.forEach((t,j)=>set(12+i,G+j,t)));set(18,G+2,'$375.99');
set(1,S,'Cash Advances');[['Date Due','Cash Advance','Amount'],['10/20/2026','Dave','$111.50'],['10/29/2026','Cleo','$45.00'],['10/30/2026','MoneyLion','$33.99']].forEach((row,i)=>row.forEach((t,j)=>set(2+i,S+j,t)));set(6,S+2,'$190.49');
set(8,S,'More Cards');[['Card','Balance','Date Due'],['Atlas','$49.65','10/30/2026']].forEach((row,i)=>row.forEach((t,j)=>set(9+i,S+j,t)));
set(12,S,'Item Flags');[['Item','Due','Non Critical','Pay By'],['Fortiva','','Yes',''],['Verizon','10/9/2026','','10/23/2026'],['G Force','','','10/27/2026']].forEach((row,i)=>row.forEach((t,j)=>set(13+i,S+j,t)));
const tab=rows=>({gid:1,v:rows.map(r=>Array.from(r,x=>x||'')),s:[],f:[],m:[[11,6,11,8]]});
const model=money.parseMoney({source:'money',refreshedAt:today.toISOString(),tabs:{Randy:tab(v)}},today);
// Cash advances: their own kind, total row not an item
const cash=model.items.filter(i=>i.kind==='cash');
assert.deepEqual(plain(cash.map(i=>[i.name,i.date,i.amount])),[['Dave','2026-10-20',111.5],['Cleo','2026-10-29',45],['MoneyLion','2026-10-30',33.99]]);
assert.equal(money.MONEY_KINDS.cash.plural,'Cash advances');
// Existing Bills block unaffected by the side blocks
assert.deepEqual(plain(model.items.filter(i=>i.kind==='bill').map(i=>i.name.trim())),['Verizon','Verizon','G Force','Fortiva','Split P 2']);
assert.equal(model.items.find(i=>i.name==='Split P 2').date,'2026-10-24','Split P2 moved to Oct 24');
// Atlas: a card payment due Oct 30 for its balance, and a card summary
const atlas=model.items.find(i=>i.name==='Atlas');
assert.deepEqual(plain([atlas.kind,atlas.date,atlas.amount]),['card','2026-10-30',49.65]);
const sum=money.cardSummaries(model).find(c=>c.name==='Atlas');
assert.equal(sum.balance.text,'$49.65');assert.equal(sum.minDate.text,'10/30/2026');
// Flags from the sheet onto dues
const dues=money.moneyBillDues(model,new Set(),today);
const by=(n,due)=>dues.find(d=>d.bill.name.trim()===n&&(!due||d.due===due));
assert.equal(by('Fortiva').bill.nonCritical,true,'Fortiva is Non Critical');
assert.equal(by('Verizon','2026-10-09').bill.payBy,'2026-10-23','Fios (Verizon Oct 9) pay by Oct 23');
assert.equal(by('Verizon','2026-09-30').bill.payBy,undefined,'a flag with a due date only covers that due');
assert.equal(by('G Force').bill.payBy,'2026-10-27');
assert.equal(by('Dave').bill.payBy,undefined);assert.equal(by('Dave').bill.nonCritical,undefined);
// Pay by: still overdue after the due date; Non Critical overdue is not "critical" (orange, not red)
assert.equal(edits.isOverdue(by('Verizon','2026-10-09')),true,'pay-by never hides overdue');
assert.equal(edits.isOverdue(by('Fortiva')),true);assert.equal(edits.isCriticalOverdue(by('Fortiva')),false,'non-critical overdue renders orange');
assert.equal(edits.isCriticalOverdue(by('Verizon','2026-10-09')),true,'critical overdue stays red');
// Life Hub overrides win over the sheet, and keep other edits
const f=by('Fortiva'),vz=by('Verizon','2026-10-09');
const applied=edits.applyBillEdits([f,vz],{[f.key]:{nonCritical:false,at:'x'},[vz.key]:{payBy:'',note:'called them',at:'x'}},today,{});
assert.equal(applied.find(d=>d.key===f.key).bill.nonCritical,undefined,'unset on Life Hub');
assert.equal(applied.find(d=>d.key===vz.key).bill.payBy,undefined,'pay-by cleared on Life Hub');
assert.equal(applied.find(d=>d.key===vz.key).editNote,'called them');
const g=by('G Force');assert.equal(edits.applyBillEdits([g],{[g.key]:{payBy:'2026-10-29',at:'x'}},today,{})[0].bill.payBy,'2026-10-29');
// Ledger / selector: cash advances group under their own type
assert.equal(ledger.ledgerType(by('Dave')).label,'Cash advances');
const groups=ledger.selectedLedgerGroups(dues,['cash','paylater:klarna'],[by('Fortiva').key]);
assert.deepEqual(plain(groups.map(g=>[g.label,g.rows.length])),[['Cash advances',3],['Bills',1]]);
console.log('Money flag checks passed: cash advances parsed + grouped, Atlas card, Split P2 date, Non Critical (orange) and Pay by (still overdue), Life Hub overrides.');
// Follow-ups: Atlas limit, utilization over known limits only, overdue subscriptions keep their Pay by
{
  const u=money.cardUtilization(model);
  assert.equal(u.owed,49.65,'owed counts Atlas');assert.deepEqual(plain(u.noLimit),['Atlas']);assert.equal(u.used,undefined,'no known limits → no % used');
  const v2=v.map(r=>r?[...r]:r);v2[9][S+3]='Limit';v2[10][S+3]='$300';
  const m2=money.parseMoney({source:'money',refreshedAt:today.toISOString(),tabs:{Randy:tab(v2)}},today);
  const u2=money.cardUtilization(m2);assert.equal(u2.used,17,'typed limit counts');assert.equal(u2.noLimit.length,0);
  assert.equal(money.cardSummaries(m2).find(c=>c.name==='Atlas').limit.text,'$300');
  const gf=by('G Force');assert.equal(gf.bill.kind,'bill','fixture lists G Force in Bills');
  const sub={...gf,key:'money:sub:g-force:2026-10-11',bill:{...gf.bill,id:'money:sub:g-force:2026-10-11',kind:'sub'}};
  assert.equal(edits.isOverdue(sub),true,'an unpaid past subscription is overdue');assert.equal(sub.bill.payBy,'2026-10-27');
  assert.equal(edits.isOverdue({...sub,skipped:true}),false,'skipped never overdue');
  console.log('Follow-up checks passed: Atlas limit unknown/typed, % used over known limits, overdue subscription with Pay by.');
}
