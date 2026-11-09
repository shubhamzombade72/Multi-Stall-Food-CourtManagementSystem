import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CATEGORIES, ALL_STALLS, CARD_PREVIEW_ROWS, effectiveOrder, moveCard, orderCards, parseCardLayout, stepCard, buildCategoryCards, buildCategoryGroups, buildStallTabs, categoriesOfStall, categoryKey, eligibleItems, filterCatalog,
  itemsOfStall, menuImageUrl, resolveSelectedCategory, resolveSelectedStall,
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

/* ---------------------------------------------------------------- stall tabs */

const stallCategories = categories.map((c) => ({ ...c, stall_id: c.id >= 20 ? stallB.id : stallA.id }));

test('stall tabs come from the open-stall list, numbered in id order, with their dish counts', () => {
  const tabs = buildStallTabs([{ id: 2, name: ' Stall B ', code: 'S-2' }, { id: 1, name: 'Stall A', code: 'S-1' }], eligibleItems(items, categories));
  assert.deepEqual(tabs.map((t) => [t.label, t.name, t.code, t.count]), [['Stall 01', 'Stall A', 'S-1', 2], ['Stall 02', 'Stall B', 'S-2', 1]]);
});

test('an open stall with no dishes still gets a tab; closed stalls get none and their dishes are hidden', () => {
  const stalls = [{ id: 1, name: 'Stall A', is_active: true }, { id: 2, name: 'Stall B', is_active: false }, { id: 3, name: 'Empty', is_active: true }];
  const eligible = eligibleItems(items, categories, stalls);
  assert.deepEqual(eligible.map((i) => i.id), [1, 3], 'Stall B is closed: the server would refuse its dishes');
  assert.deepEqual(buildStallTabs(stalls, eligible).map((t) => [t.label, t.name, t.count]), [['Stall 01', 'Stall A', 2], ['Stall 02', 'Empty', 0]]);
});

test('a dish whose stall is missing from the open-stall list is not offered', () => {
  assert.deepEqual(eligibleItems(items, categories, [{ id: 2, name: 'Stall B' }]).map((i) => i.id), [2]);
});

test('without the stall list, tabs are built from the dishes and nothing is hidden', () => {
  const eligible = eligibleItems(items, categories, null);
  assert.equal(eligible.length, 3);
  assert.deepEqual(buildStallTabs(null, eligible).map((t) => [t.label, t.name]), [['Stall 01', 'Stall A'], ['Stall 02', 'Stall B']]);
});

test('numbers widen past 99 stalls instead of repeating', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `S${i + 1}` }));
  const tabs = buildStallTabs(many, []);
  assert.equal(tabs[0].label, 'Stall 001');
  assert.equal(tabs[119].label, 'Stall 120');
});

test('a selected stall is kept while open and falls back to All Stalls when it closes', () => {
  const tabs = buildStallTabs([{ id: 1, name: 'Stall A' }], []);
  assert.equal(resolveSelectedStall(tabs, 1), 1);
  assert.equal(resolveSelectedStall(tabs, 2), ALL_STALLS);
  assert.equal(resolveSelectedStall(tabs, ALL_STALLS), ALL_STALLS);
});

test('a stall shows only its own dishes and only its own categories', () => {
  const eligible = eligibleItems(items, stallCategories);
  assert.deepEqual(itemsOfStall(eligible, stallB.id).map((i) => i.name), ['Corn Pizza']);
  assert.equal(itemsOfStall(eligible, ALL_STALLS), eligible);
  const groups = buildCategoryGroups(categoriesOfStall(stallCategories, stallA.id), itemsOfStall(eligible, stallA.id));
  assert.deepEqual(groups.map((g) => [g.name, g.count]), [['Burger', 1], ['Pizza', 1]], "no Soups: that row is Stall B's");
  assert.equal(categoriesOfStall(null, stallA.id), null);
});

test('stall + category + search combine; a picked stall opens on its whole menu', () => {
  const eligible = eligibleItems(items, stallCategories);
  const a = itemsOfStall(eligible, stallA.id);
  const groups = buildCategoryGroups(categoriesOfStall(stallCategories, stallA.id), a);
  assert.equal(resolveSelectedCategory(groups, null, ALL_CATEGORIES), ALL_CATEGORIES);
  assert.equal(resolveSelectedCategory(groups, categoryKey('Soups'), ALL_CATEGORIES), ALL_CATEGORIES, 'a category this stall lacks falls back to its whole menu');
  assert.equal(resolveSelectedCategory(groups, categoryKey('Pizza'), ALL_CATEGORIES), categoryKey('Pizza'));
  assert.deepEqual(filterCatalog(a, categoryKey('Pizza'), '').map((i) => i.name), ['Cheese Pizza'], "Stall B's pizza is not shown");
  assert.deepEqual(filterCatalog(a, ALL_CATEGORIES, 'corn'), []);
});

/* ------------------------------------------------------------ category cards */

test('one card per category name in display order, each holding exactly its own dishes', () => {
  const eligible = eligibleItems(items, categories);
  const cards = buildCategoryCards(buildCategoryGroups(categories, eligible), eligible);
  assert.deepEqual(cards.map((c) => c.name), ['Burger', 'Pizza']); // Soups has no dishes: no card; Retired is inactive
  assert.deepEqual(cards[1].items.map((d) => d.name), ['Cheese Pizza', 'Corn Pizza']);
  assert.equal(cards[1].multiStall, true);
  assert.equal(cards[0].multiStall, false);
});

test('every dish lands on exactly one card, once, even if the list repeats it', () => {
  const eligible = eligibleItems(items, categories);
  const cards = buildCategoryCards(buildCategoryGroups(categories, eligible), [...eligible, eligible[0]]);
  const ids = cards.flatMap((c) => c.items.map((d) => d.id));
  assert.deepEqual([...ids].sort(), eligible.map((d) => d.id).sort());
});

test('cards follow the stall and search filters, and hand back the very same dish objects', () => {
  const eligible = eligibleItems(items, categories);
  const ofB = itemsOfStall(eligible, stallB.id);
  const cardsB = buildCategoryCards(buildCategoryGroups(categoriesOfStall(categories, stallB.id), ofB), ofB);
  assert.deepEqual(cardsB.map((c) => c.items.map((d) => d.name)), [['Corn Pizza']]);
  assert.equal(cardsB[0].items[0], eligible.find((d) => d.name === 'Corn Pizza'));
  const searched = filterCatalog(eligible, ALL_CATEGORIES, 'burger');
  assert.deepEqual(buildCategoryCards(buildCategoryGroups(categories, searched), searched).map((c) => c.name), ['Burger']);
});

test('a dish whose category is missing from the groups still gets a card', () => {
  const stray = item(9, 'Lassi', stallA, { id: 99, name: 'Drinks' });
  const cards = buildCategoryCards([], [stray]);
  assert.deepEqual(cards.map((c) => [c.name, c.items.length]), [['Drinks', 1]]);
});

test('scale: 150 categories x 60 dishes group in well under a frame budget', () => {
  const big = Array.from({ length: 9000 }, (_, i) => item(i + 1, `Dish ${i}`, i % 2 ? stallA : stallB, { id: 1000 + (i % 150), name: `Category ${i % 150}` }));
  const t0 = performance.now();
  const cards = buildCategoryCards(buildCategoryGroups(null, big), big);
  const ms = performance.now() - t0;
  assert.equal(cards.length, 150);
  assert.ok(cards.every((c) => c.items.length === 60));
  assert.ok(ms < 100, `${ms.toFixed(1)} ms`);
  assert.ok(CARD_PREVIEW_ROWS >= 4 && CARD_PREVIEW_ROWS <= 8);
});

/* ------------------------------------------------------------ card layout */

test('a saved layout is read defensively: junk, duplicates and bad JSON never break the POS', () => {
  assert.deepEqual(parseCardLayout('{"order":["a","a",3,"b"],"collapsed":"x"}'), { order: ['a', 'b'], collapsed: [] });
  assert.deepEqual(parseCardLayout('not json'), { order: [], collapsed: [] });
  assert.deepEqual(parseCardLayout(null), { order: [], collapsed: [] });
});

test('the saved order wins; a new category appears after the card it follows in the menu; removed ones are dropped', () => {
  assert.deepEqual(effectiveOrder(['a', 'b', 'c'], []), ['a', 'b', 'c']);
  assert.deepEqual(effectiveOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
  assert.deepEqual(effectiveOrder(['a', 'n', 'b', 'c'], ['c', 'a', 'b', 'gone']), ['c', 'a', 'n', 'b']);
  assert.deepEqual(effectiveOrder(['n', 'a'], ['a']), ['n', 'a']);
});

test('moving a card keeps every other card where it was, including cards of other stalls', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(moveCard(order, 'e', 'b', 'before'), ['a', 'e', 'b', 'c', 'd']);
  assert.deepEqual(moveCard(order, 'a', 'c', 'after'), ['b', 'c', 'a', 'd', 'e']);
  assert.deepEqual(moveCard(order, 'a', 'a', 'after'), order);
  assert.deepEqual(moveCard(order, 'zz', 'a', 'after'), order);
  // one stall shows only b and d: moving d before b leaves a, c, e untouched
  assert.deepEqual(stepCard(order, ['b', 'd'], 'd', -1), ['a', 'd', 'b', 'c', 'e']);
  assert.deepEqual(stepCard(order, ['b', 'd'], 'b', -1), order);
});

test('cards follow the order; cards missing from it keep their own place at the end', () => {
  const cards = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  assert.deepEqual(orderCards(cards, ['c', 'a', 'b']).map((c) => c.key), ['c', 'a', 'b']);
  assert.deepEqual(orderCards(cards, ['b']).map((c) => c.key), ['b', 'a', 'c']);
  assert.equal(orderCards(cards, []), cards);
});
