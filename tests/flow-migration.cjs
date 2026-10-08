/* eslint-disable */
// Node test script (CommonJS on purpose): node tests/flow-migration.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
function load(file){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require,structuredClone,Date,Map,Set,Object,JSON,Number,Error},{filename:file});return module.exports;}
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
assert.equal(map.records.length,74);assert.equal(map.routines.length,87);assert.equal(new Set(map.buckets.map(b=>b.id)).size,9);for(const id of ['self','money','body','work','venture','marvel','home'])assert.ok(focus.areas.some(a=>a.id===id));assert.equal(goals.categories.length,6);assert.equal(goals.efforts.length,20);assert.equal(goals.supplementalEfforts.length,7);
assert.ok(!focus.areas.find(a=>a.id==='body').sourceMap.some(r=>r.source==='move'));assert.ok(focus.areas.find(a=>a.id==='home').sourceMap.some(r=>r.source==='move'));assert.deepEqual(focus.excludeSources,['repair']);
for(const t of map.records.filter(t=>!t.credit))assert.ok(focus.ignore.ticktick.titles.includes(t.title));
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
