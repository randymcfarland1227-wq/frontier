/* eslint-disable */
// Node test script (CommonJS on purpose): node tests/flow-migration.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
function load(file){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText.replace(/import\.meta/g,'({ env: {} })');vm.runInNewContext(code,{module,exports:module.exports,require:m=>m.startsWith('.')?load(require('node:path').join(require('node:path').dirname(file),m)+'.ts'):require(m),structuredClone,Date,Map,Set,Object,JSON,Number,Error},{filename:file});return module.exports;}
const {migrateSorting}=load('lib/flowMigration.ts'),{mergeState,emptyState}=load('lib/syncState.ts');
const time='2026-10-08T12:00:00.000Z';
const entry={source:'ticktick',taskId:'old-id',title:'Music Session- Main',completedAt:'2026-10-07T17:00:00.000Z',via:'hub',focusAreaId:'self',focusManual:true};
const key='ticktick::t:music session- main';
const before={rules:{[key]:{area:'self',goal:'none',at:'2026-10-01T12:00:00.000Z'},'gmail::*':{area:'work',goal:'none',at:time}},completions:{entries:{old:entry,unrelated:{...entry,source:'candle',taskId:'c1'}}}};
const snapshot=JSON.stringify(before);
const {next,audit}=migrateSorting(before,[{key,area:'creative'}],['self','creative'],[],time);
assert.equal(JSON.stringify(before),snapshot,'input not mutated');assert.equal(Object.keys(next.completions.entries).length,2);assert.equal(next.completions.entries.old.completedAt,entry.completedAt);assert.equal(next.completions.entries.old.taskId,'old-id');assert.equal(next.rules[key].goal,'none','intentional goal remains when no replacement selected');assert.equal(next.completions.entries.old.focusAreaId,'creative');assert.equal(next.completions.entries.unrelated.focusAreaId,'self');assert.equal(audit.changes.length,1);assert.equal(migrateSorting(next,[{key,area:'creative'}],['creative'],[],time).audit.changes.length,0,'idempotent');
assert.throws(()=>migrateSorting(before,[{key,area:'missing'}],['self'],[],time));assert.throws(()=>migrateSorting(before,[{key:'ticktick::*',area:'self'}],['self'],[],time));assert.throws(()=>migrateSorting(before,[{key,area:'self',goal:'missing'}],['self'],[],time));
const oldState={...emptyState(),...before},newState={...emptyState(),...next};
for(const [a,b] of [[oldState,newState],[newState,oldState]]){const merged=mergeState(a,b);assert.equal(merged.completions.entries.old.focusAreaId,'creative','old device cannot resurrect old manual bucket');assert.equal(merged.rules[key].area,'creative');assert.equal(Object.keys(merged.completions.entries).length,2);}
const map=JSON.parse(fs.readFileSync('public/data/flow-map.json'));const focus=JSON.parse(fs.readFileSync('public/data/focus-areas.json'));const goals=JSON.parse(fs.readFileSync('public/data/goals.json'));
assert.equal(map.records.length,74);assert.equal(map.routines.length,87);assert.equal(new Set(map.buckets.map(b=>b.id)).size,9);for(const id of ['self','money','body','work','venture','marvel','home'])assert.ok(focus.areas.some(a=>a.id===id));assert.equal(goals.categories.length,6);assert.equal(goals.efforts.length,20);assert.equal(goals.supplementalEfforts.length,8);assert.ok(goals.supplementalEfforts.some(e=>e.id==="mental-grounding"&&e.category==="mental"));
assert.ok(!focus.areas.find(a=>a.id==='body').sourceMap.some(r=>r.source==='move'));assert.ok(focus.areas.find(a=>a.id==='home').sourceMap.some(r=>r.source==='move'));assert.deepEqual(focus.excludeSources,['repair']);
// No-credit (orientation / container) items stay listed on the TickTick card: they're in noCredit, not the hidden ignore list.
for(const t of map.records.filter(t=>!t.credit))assert.ok(focus.noCredit.ticktick.titles.includes(t.title)||(focus.noCredit.ticktick.titleIncludes||[]).some(x=>t.title.toLowerCase().includes(x)),t.title);
assert.equal(focus.ignore.ticktick.titles.length,0,'nothing on TickTick is hidden: the card matches TickTick');
for(const t of ['Daily Work & Income Flow','Creative / Tinkering & Project Menu','Rest & Sleep Priorities'])assert.ok(!focus.ignore.ticktick.titles.includes(t),`${t} must stay visible`);
console.log('Migration checks pass: immutable input, stable counts/identity/dates, explicit manual reassignment, intentional no-goal, validation, idempotence, both merge orders, preserved original IDs and definitions.');
// Non-TickTick history (Self / Radall …) uses the same path: count, ids and dates kept; only the chosen key moves.
{
  const selfKey = 'self::t:ting';
  const s = { rules: {}, completions: { entries: {
    a: { source: 'self', taskId: 's3', title: 'Ting', completedAt: '2026-10-01T10:00:00.000Z', via: 'self', focusAreaId: 'self' },
    b: { source: 'self', taskId: 's3', title: 'Ting', completedAt: '2026-10-05T10:00:00.000Z', via: 'self', focusAreaId: 'body' },
    c: { source: 'radall', taskId: 'r1', title: 'Pay rent', completedAt: '2026-10-02T10:00:00.000Z', via: 'hub', focusAreaId: 'money' },
  } } };
  const { next, audit } = migrateSorting(s, [{ key: selfKey, area: 'home', goal: 'none' }], ['self', 'body', 'money', 'home'], [], time);
  assert.equal(Object.keys(next.completions.entries).length, 3);
  assert.equal(next.completions.entries.a.focusAreaId, 'home');
  assert.equal(next.completions.entries.b.focusAreaId, 'home', 'mixed history settles on the reviewed bucket');
  assert.equal(next.completions.entries.b.completedAt, '2026-10-05T10:00:00.000Z');
  assert.equal(next.completions.entries.c.focusAreaId, 'money', 'other tasks untouched');
  assert.equal(next.rules[selfKey].goal, 'none');
  assert.equal(audit.changes[0].entries.length, 2);
  console.log('Non-TickTick history checks pass.');
}
// Peculiar Candle bundle sync: newest wins; first sync (no times) → more progress wins.
{
  const { mergeCandle } = load('lib/candleSync.ts');
  const mk = (done, steps) => JSON.stringify({ state: { tasks: [...Array(done)].map(() => ({ status: 'COMPLETE' })).concat([{ status: 'OPEN', steps: [...Array(steps)].map(() => ({ value: 'x' })) }]) } });
  const mac = { raw: mk(11, 3), at: '' }, phone = { raw: mk(0, 0), at: '' };
  assert.equal(mergeCandle(phone, mac).raw, mac.raw, 'first sync: more progress wins');
  assert.equal(mergeCandle(mac, phone).raw, mac.raw, 'first sync, either order');
  const later = { raw: mk(1, 0), at: '2026-10-09T10:00:00.000Z' };
  assert.equal(mergeCandle({ ...mac, at: '2026-10-08T10:00:00.000Z' }, later).raw, later.raw, 'newest edit wins after that');
  assert.equal(mergeCandle(undefined, mac).raw, mac.raw);
  assert.equal(mergeCandle({ raw: null, at: '' }, mac).raw, mac.raw, 'a device without Candle data never wipes it');
  console.log('Candle sync checks pass.');
}

// Removed items ("hidden") sync: newest change wins in both merge orders; a device without the field never un-removes.
{
  const a = { ...emptyState(), hidden: { 'radall::row-4': { mark: 'hide', at: '2026-10-09T10:00:00.000Z' } } };
  const b = { ...emptyState(), hidden: { 'radall::row-4': { mark: null, at: '2026-10-09T09:00:00.000Z' } } };
  for (const [x, y] of [[a, b], [b, a]]) assert.equal(mergeState(x, y).hidden['radall::row-4'].mark, 'hide');
  const old = { ...emptyState() };
  delete old.hidden;
  assert.equal(mergeState(old, a).hidden['radall::row-4'].mark, 'hide');
  console.log('Removed-item sync checks pass.');
}

// Life Hub subscriptions ("subs") sync: union by id, newest edit wins, removed stays removed.
{
  const s1 = { id: 'sub-1', name: 'Netflix', day: 20, cycle: 'monthly', status: 'active', createdAt: '2026-10-09T01:00:00.000Z', updatedAt: '2026-10-09T01:00:00.000Z' };
  const s1b = { ...s1, status: 'paused', updatedAt: '2026-10-09T02:00:00.000Z' };
  const s2 = { id: 'sub-2', name: 'Hulu', day: 3, cycle: 'monthly', status: 'active', removed: true, createdAt: '2026-10-09T01:30:00.000Z', updatedAt: '2026-10-09T03:00:00.000Z' };
  const a = { ...emptyState(), subs: [s1, s2] };
  const b = { ...emptyState(), subs: [s1b] };
  for (const [x, y] of [[a, b], [b, a]]) {
    const m = mergeState(x, y).subs;
    assert.equal(m.length, 2);
    assert.equal(m.find(s => s.id === 'sub-1').status, 'paused');
    assert.equal(m.find(s => s.id === 'sub-2').removed, true);
  }
  const old = { ...emptyState() };
  delete old.subs;
  assert.equal(mergeState(old, a).subs.length, 2, 'a device without the field keeps them');
  console.log('Subscription sync checks pass.');
}

// Role Hub shelves ("roleActive") sync: newest change wins in both orders; missing field never resets it.
{
  const a = { ...emptyState(), roleActive: { 'cert:C1': { mark: 'active', at: '2026-10-09T03:00:00.000Z' } } };
  const b = { ...emptyState(), roleActive: { 'cert:C1': { mark: null, at: '2026-10-09T02:00:00.000Z' } } };
  for (const [x, y] of [[a, b], [b, a]]) assert.equal(mergeState(x, y).roleActive['cert:C1'].mark, 'active');
  const old = { ...emptyState() };
  delete old.roleActive;
  assert.equal(mergeState(old, a).roleActive['cert:C1'].mark, 'active');
  console.log('Role shelf sync checks pass.');
}

// A bill's day every month ("billDays") sync: newest change wins; a reset (day null) beats an older rule.
{
  const a = { ...emptyState(), billDays: { 'bill:progressive': { day: 20, from: '2026-10', at: '2026-10-09T03:00:00.000Z' } } };
  const b = { ...emptyState(), billDays: { 'bill:progressive': { day: null, from: '2026-10', at: '2026-10-09T04:00:00.000Z' } } };
  for (const [x, y] of [[a, b], [b, a]]) assert.equal(mergeState(x, y).billDays['bill:progressive'].day, null);
  const old = { ...emptyState() };
  delete old.billDays;
  assert.equal(mergeState(old, a).billDays['bill:progressive'].day, 20);
  console.log('Bill day sync checks pass.');
}

// A bill's new day applies to every month from its start month on, and keeps the payment key.
{
  const { applyBillEdits } = load('lib/billEdits.ts');
  const days = { 'bill:progressive': { day: 20, from: '2026-10', at: '2026-10-09T00:00:00.000Z' } };
  const mk = (due) => ({ bill: { id: 'p', name: 'Progressive', kind: 'bill' }, due, days: 0, key: `money:bill:progressive:${due}` });
  const out = applyBillEdits([mk('2026-09-10'), mk('2026-10-10'), mk('2026-11-10'), mk('2027-02-10')], {}, new Date(2026, 9, 1), days);
  assert.deepEqual(out.map(d => d.due), ['2026-09-10', '2026-10-20', '2026-11-20', '2027-02-20']);
  assert.equal(out[2].key, 'money:bill:progressive:2026-11-10', 'Paid / Pin keys unchanged');
  const short = applyBillEdits([mk('2026-11-10')], {}, new Date(2026, 9, 1), { 'bill:progressive': { day: 31, from: '2026-10', at: 'x' } });
  assert.equal(short[0].due, '2026-11-30', 'the 31st becomes the last day of a short month');
  console.log('Bill day rule checks pass.');
}
