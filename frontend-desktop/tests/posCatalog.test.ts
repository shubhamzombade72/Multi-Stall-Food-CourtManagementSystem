import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CATEGORIES, buildCategoryGroups, categoryKey, eligibleItems, filterCatalog, menuImageUrl, resolveSelectedCategory,
} from '../src/lib/posCatalog.ts';

test('an uploaded photo follows the current server address; other images are left alone', () => {
  const base = 'http://127.0.0.1:60969/api';
  assert.equal(menuImageUrl('http://127.0.0.1:59562/api/public/menu-images/abc.png', base), 'http://127.0.0.1:60969/api/public/menu-images/abc.png');
  assert.equal(menuImageUrl('http://127.0.0.1:59562/api/public/menu-images/abc.png', `${base}/`), 'http://127.0.0.1:60969/api/public/menu-images/abc.png');
  assert.equal(menuImageUrl('https://cdn.example.com/pizza.jpg', base), 'https://cdn.example.com/pizza.jpg');
  assert.equal(menuImageUrl(null, base), null);
  assert.equal(menuImageUrl('', base), null);
});

const stallA = { id: 1, name: 'Stall A' };
const stallB = { id: 2, name: 'Stall B' };

const categories = [
  { id: 10, name: 'Pizza', display_order: 2, is_active: true },
  { id: 11, name: 'Burger', display_order: 1, is_active: true },
  { id: 20, name: ' pizza ', display_order: 5, is_active: true }, // Stall B's own Pizza row: one chip, not two
  { id: 21, name: 'Retired', display_order: 0, is_active: false },
  { id: 22, name: 'Soups', display_order: 3, is_active: true }, // active, no dishes
];

const item = (id: number, name: string, stall: typeof stallA, category: { id: number; name: string }) => ({ id, name, stall_id: stall.id, stall, category });
const items = [
  item(1, 'Cheese Pizza', stallA, { id: 10, name: 'Pizza' }),
  item(2, 'Corn Pizza', stallB, { id: 20, name: ' pizza ' }),
  item(3, 'Veg Burger', stallA, { id: 11, name: 'Burger' }),
  item(4, 'Old Special', stallA, { id: 21, name: 'Retired' }),
];

test('categoryKey ignores case and spacing, and can never collide with All Categories', () => {
  assert.equal(categoryKey(' Pizza  Slices '), categoryKey('pizza slices'));
  assert.notEqual(categoryKey('all'), ALL_CATEGORIES);
});

test('dishes in an inactive category are not eligible; everything else is', () => {
  assert.deepEqual(eligibleItems(items, categories).map((i) => i.id), [1, 2, 3]);
});

test('same-named categories of different stalls merge into one chip with a true count', () => {
  const groups = buildCategoryGroups(categories, eligibleItems(items, categories));
  assert.deepEqual(groups.map((g) => [g.name, g.count]), [['Burger', 1], ['Pizza', 2], ['Soups', 0]]);
});

test('chips follow display_order (lowest of a merged group), then name', () => {
  const groups = buildCategoryGroups(
    [
      { id: 1, name: 'Zed', display_order: 1, is_active: true },
      { id: 2, name: 'Alpha', display_order: 1, is_active: true },
      { id: 3, name: 'Mid', display_order: 9, is_active: true },
      { id: 4, name: 'mid', display_order: 0, is_active: true },
    ],
    []
  );
  assert.deepEqual(groups.map((g) => g.name), ['Mid', 'Alpha', 'Zed']);
});

test('without the category list, chips are still built from the dishes themselves', () => {
  const groups = buildCategoryGroups(null, eligibleItems(items, null));
  assert.deepEqual(groups.map((g) => [g.name, g.count]), [['Burger', 1], ['Pizza', 2], ['Retired', 1]]);
});

test('a dish whose category row is missing from the list still gets a chip', () => {
  const orphan = item(9, 'Lassi', stallA, { id: 99, name: 'Drinks' });
  const groups = buildCategoryGroups(categories, eligibleItems([orphan], categories));
  assert.deepEqual(groups.filter((g) => g.count > 0).map((g) => g.name), ['Drinks']);
});

test('default selection is the first category that has dishes, skipping empty ones', () => {
  const groups = buildCategoryGroups(
    [
      { id: 1, name: 'Soups', display_order: 1, is_active: true },
      { id: 2, name: 'Pizza', display_order: 2, is_active: true },
    ],
    [item(1, 'Cheese Pizza', stallA, { id: 2, name: 'Pizza' })]
  );
  assert.equal(resolveSelectedCategory(groups, null), categoryKey('Pizza'));
});

test('a selection is kept while valid and falls back when its category disappears', () => {
  const groups = buildCategoryGroups(categories, eligibleItems(items, categories));
  assert.equal(resolveSelectedCategory(groups, ALL_CATEGORIES), ALL_CATEGORIES);
  assert.equal(resolveSelectedCategory(groups, categoryKey('Soups')), categoryKey('Soups'), 'an empty category can stay selected');
  assert.equal(resolveSelectedCategory(groups, categoryKey('Gone')), categoryKey('Burger'));
});

test('selection with no dishes anywhere: first chip, or All Categories when there are no chips', () => {
  const emptyGroups = buildCategoryGroups([{ id: 1, name: 'Soups', display_order: 1, is_active: true }], []);
  assert.equal(resolveSelectedCategory(emptyGroups, null), categoryKey('Soups'));
  assert.equal(resolveSelectedCategory([], null), ALL_CATEGORIES);
});

test('a category shows only its own dishes, across stalls', () => {
  const eligible = eligibleItems(items, categories);
  assert.deepEqual(filterCatalog(eligible, categoryKey('Pizza'), '').map((i) => i.name), ['Cheese Pizza', 'Corn Pizza']);
  assert.deepEqual(filterCatalog(eligible, categoryKey('Burger'), '').map((i) => i.name), ['Veg Burger']);
  assert.deepEqual(filterCatalog(eligible, categoryKey('Soups'), ''), []);
});

test('All Categories shows every eligible dish', () => {
  const eligible = eligibleItems(items, categories);
  assert.equal(filterCatalog(eligible, ALL_CATEGORIES, '').length, 3);
});

test('search stays inside the selected category and clearing it restores the list', () => {
  const eligible = eligibleItems(items, categories);
  const pizza = categoryKey('Pizza');
  assert.deepEqual(filterCatalog(eligible, pizza, ' CORN ').map((i) => i.name), ['Corn Pizza']);
  assert.deepEqual(filterCatalog(eligible, pizza, 'burger'), [], 'a burger is not found while Pizza is selected');
  assert.deepEqual(filterCatalog(eligible, ALL_CATEGORIES, 'burger').map((i) => i.name), ['Veg Burger']);
  assert.equal(filterCatalog(eligible, pizza, '').length, 2);
});

test('search still matches stall and category names, as it did before', () => {
  const eligible = eligibleItems(items, categories);
  assert.deepEqual(filterCatalog(eligible, ALL_CATEGORIES, 'stall b').map((i) => i.name), ['Corn Pizza']);
  assert.equal(filterCatalog(eligible, ALL_CATEGORIES, 'pizza').length, 2);
});

test('filtering never rewrites a dish: stall ownership and price objects pass through untouched', () => {
  const eligible = eligibleItems(items, categories);
  const [cheese] = filterCatalog(eligible, categoryKey('Pizza'), 'cheese');
  assert.equal(cheese, items[0], 'same object, not a copy');
  assert.equal(cheese.stall_id, stallA.id);
});
