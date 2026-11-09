import test from 'node:test';
import assert from 'node:assert/strict';
import { columnsFor, menuColumns, serveColumns, tableColumns } from '../src/utils/layout.ts';

// Typical widths in dp: phone portrait 411, phone landscape 915, 10-inch tablet portrait 800, landscape 1280
const PHONE = 411, PHONE_LAND = 915, TAB = 800, TAB_LAND = 1280;

test('a phone in portrait keeps the layout it always had', () => {
  assert.equal(tableColumns(PHONE), 2);
  assert.equal(menuColumns(PHONE), 1);
  assert.equal(serveColumns(PHONE), 1);
});

test('a tablet uses its width: more tables per row, dishes and serving cards side by side', () => {
  assert.equal(tableColumns(TAB), 3);
  assert.equal(tableColumns(TAB_LAND), 6);
  assert.equal(menuColumns(TAB), 2);
  assert.equal(menuColumns(TAB_LAND), 3);
  assert.equal(serveColumns(TAB), 1);
  assert.equal(serveColumns(TAB_LAND), 2);
});

test('a phone on its side gets more columns too', () => {
  assert.equal(tableColumns(PHONE_LAND), 4);
  assert.equal(menuColumns(PHONE_LAND), 2);
  assert.equal(serveColumns(PHONE_LAND), 2);
});

test('columns stay within their limits on very small or very large screens', () => {
  assert.equal(columnsFor(0, 200, 6, 2), 2);
  assert.equal(columnsFor(100, 360, 4), 1);
  assert.equal(columnsFor(5000, 200, 6), 6);
});
