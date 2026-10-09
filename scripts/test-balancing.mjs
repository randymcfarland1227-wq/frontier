import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ SpreadsheetApp: { Dimension: { ROWS: 'ROWS' } } });
vm.runInContext(readFileSync(new URL('../apps-script/LifeHubMoney.gs', import.meta.url), 'utf8'), context);
const logs = [];
context.lhMoneyLog_ = (...args) => logs.push(args);

// Model the sheet's column-local insertion and Sheets' automatic formula-reference shifts.
function fixture(items = [['Chase', '165', ''], ['Poshmark', '0', '32']]) {
  const grid = [['Balancing and Planning', '', '', 'Neighbor'], ['Account', 'Amount', 'Pend', 'Keep'], ...items.map(row => [...row, 'untouched']), ['', 'SUM', '', 'outside']];
  const formulas = new Map([[`${grid.length}:2`, `=SUM(B3:B${grid.length - 1})`]]);
  const sheet = {
    getLastRow: () => grid.length,
    getDataRange: () => ({
      createTextFinder: () => ({ matchEntireCell: () => ({ findNext: () => range(1, 1, 1, 1) }) }),
      getFormulas: () => grid.map((row, ri) => row.map((_, ci) => formulas.get(`${ri + 1}:${ci + 1}`) || '')),
    }),
    getRange: (...args) => range(...args),
  };
  function range(r, c, height = 1, width = 1) {
    return {
      getRow: () => r, getColumn: () => c, getNumColumns: () => width,
      getMergedRanges: () => r === 1 ? [range(1, 1, 1, 3)] : [],
      getDisplayValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => grid[r - 1 + i]?.[c - 1 + j] || '')),
      getFormulas: () => [Array.from({ length: width }, (_, i) => formulas.get(`${r}:${c + i}`) || '')],
      getFormula: () => formulas.get(`${r}:${c}`) || '',
      setFormula: formula => formulas.set(`${r}:${c}`, formula),
      insertCells: dimension => {
        assert.equal(dimension, 'ROWS');
        const moved = [...formulas]; formulas.clear();
        for (const [key, formula] of moved) {
          const [fr, fc] = key.split(':').map(Number);
          formulas.set(`${fr >= r && fc >= c && fc < c + width ? fr + 1 : fr}:${fc}`, formula.replace(/B(\d+)/g, (_, row) => `B${Number(row) >= r ? Number(row) + 1 : row}`));
        }
        grid.push([]);
        for (let i = grid.length - 1; i >= r; i--) for (let j = c - 1; j < c - 1 + width; j++) grid[i][j] = grid[i - 1][j];
        for (let j = c - 1; j < c - 1 + width; j++) grid[r - 1][j] = '';
      },
      setValues: values => { values[0].forEach((v, i) => { grid[r - 1][c - 1 + i] = v; }); return range(r, c, height, width); },
      setFontLine: () => range(r, c, height, width),
      getA1Notation: () => `A${r}:C${r}`,
    };
  }
  return { sheet, grid, formulas };
}
const edit = { tab: 'Randy', insertBalancing: true, r: 3, startCol: 0, expectRow: ['Poshmark', '0', '32'], values: ['Cash', '25', '10'] };
let f = fixture();
assert.equal(context.lhInsertBalancing_({}, f.sheet, edit).ok, true);
assert.deepEqual(f.grid[3].slice(0, 3), edit.values);
assert.deepEqual(f.grid[4].slice(0, 3), edit.expectRow);
assert.equal(f.grid[3][3], 'untouched');
assert.equal(f.formulas.get('6:2'), '=SUM(B3:B5)');
assert.equal(logs.length, 1);

for (const change of [
  { expectRow: ['stale', '0', '32'], error: 'changed' },
  { values: ['=HYPERLINK("x")', '0', ''], error: 'bad value' },
  { values: ['Cash', 'invalid', ''], error: 'bad value' },
  { tab: 'Paylater', error: 'tab not allowed' },
  { r: 4, expectRow: ['', 'SUM', ''], error: 'formula' },
  { startCol: 1, error: 'bad range' },
]) {
  f = fixture(); const before = JSON.stringify(f.grid);
  assert.equal(context.lhInsertBalancing_({}, f.sheet, { ...edit, ...change }).error, change.error);
  assert.equal(JSON.stringify(f.grid), before);
}
f = fixture([['Chase', '165', '']]);
assert.equal(context.lhInsertBalancing_({}, f.sheet, { ...edit, r: 2, expectRow: ['Chase', '165', ''] }).ok, true);
assert.equal(f.formulas.get('5:2'), '=SUM(B3:B4)');
assert.deepEqual(f.grid[3].slice(0, 3), ['Chase', '165', '']);
f = fixture([['', '', '']]);
assert.equal(context.lhInsertBalancing_({}, f.sheet, { ...edit, r: 2, expectRow: ['', '', ''] }).ok, true);
assert.deepEqual(f.grid[2].slice(0, 3), edit.values);
console.log('Balancing tests passed: insertion, totals, neighboring columns, stale edits, formula protection, validation, and single-item list.');
