/**
 * Category browsing for the Cashier POS. Display-only: it decides which dishes are on screen and never changes a dish.
 * The stall that receives an order item comes from the dish itself on the server, not from anything chosen here.
 *
 * menu_categories belong to a stall, so two stalls can each have a "Pizza" row. The cashier sees one Pizza chip holding
 * both stalls' dishes, so chips are grouped by name rather than by category id.
 */
export interface CatalogCategory {
  id: number;
  stall_id?: number | null;
  name: string;
  display_order?: number | null;
  is_active?: boolean | null;
}

export interface CatalogItem {
  name: string;
  stall_id: number;
  stall: { name: string };
  category: { id: number; name: string };
}

export interface CategoryGroup {
  key: string;
  name: string;
  count: number;
  order: number;
}

export const ALL_CATEGORIES = 'all';

const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Prefixed so that a category literally named "All" can never be mistaken for All Categories. */
export const categoryKey = (name: string) => `category:${normalize(name)}`;

/**
 * Dishes the cashier may browse. `categories` / `stalls` are null when that list could not be loaded: nothing is hidden then.
 * `stalls` is the server's list of open stalls; the server refuses orders for dishes of a closed stall, so they are hidden.
 */
export const eligibleItems = <T extends CatalogItem>(
  items: T[],
  categories: CatalogCategory[] | null,
  stalls: CatalogStall[] | null = null
): T[] => {
  const inactive = new Set((categories ?? []).filter((c) => c.is_active === false).map((c) => c.id));
  const open = stalls ? new Set(stalls.filter((s) => s.is_active !== false).map((s) => s.id)) : null;
  return items.filter((item) => !inactive.has(item.category.id) && (!open || open.has(item.stall_id)));
};

/* ---------------------------------------------------------------- stalls */

export interface CatalogStall {
  id: number;
  name: string;
  code?: string | null;
  is_active?: boolean | null;
}

export interface StallTab {
  id: number;
  name: string;
  code: string | null;
  /** "Stall 01": the stall's place in the food court's stall list (by id), padded to at least two digits. */
  label: string;
  count: number;
}

export const ALL_STALLS = 'all';
export type StallSelection = typeof ALL_STALLS | number;

/**
 * One tab per open stall, numbered in the server's order (by id). Without the stall list the tabs come from the dishes,
 * so selling never depends on it.
 */
export const buildStallTabs = (stalls: CatalogStall[] | null, items: (CatalogItem & { stall: { id?: number; code?: string | null } })[]): StallTab[] => {
  const source = new Map<number, { name: string; code: string | null }>();
  if (stalls) {
    for (const s of stalls) if (s.is_active !== false) source.set(s.id, { name: s.name, code: s.code ?? null });
  } else {
    for (const item of items) if (!source.has(item.stall_id)) source.set(item.stall_id, { name: item.stall.name, code: item.stall.code ?? null });
  }
  const counts = new Map<number, number>();
  for (const item of items) counts.set(item.stall_id, (counts.get(item.stall_id) ?? 0) + 1);

  const ids = [...source.keys()].sort((a, b) => a - b);
  const width = Math.max(2, String(ids.length).length);
  return ids.map((id, index) => ({
    id,
    name: source.get(id)!.name.trim(),
    code: source.get(id)!.code,
    label: `Stall ${String(index + 1).padStart(width, '0')}`,
    count: counts.get(id) ?? 0,
  }));
};

/** The cashier's stall while it is still open, otherwise All Stalls. */
export const resolveSelectedStall = (tabs: StallTab[], selected: StallSelection): StallSelection =>
  selected !== ALL_STALLS && tabs.some((t) => t.id === selected) ? selected : ALL_STALLS;

export const itemsOfStall = <T extends CatalogItem>(items: T[], stall: StallSelection): T[] =>
  stall === ALL_STALLS ? items : items.filter((item) => item.stall_id === stall);

/** The category rows of one stall (all of them for All Stalls), so the category picker only offers that stall's categories. */
export const categoriesOfStall = (categories: CatalogCategory[] | null, stall: StallSelection): CatalogCategory[] | null =>
  categories && stall !== ALL_STALLS ? categories.filter((c) => c.stall_id === stall) : categories;

/* ------------------------------------------------------------ categories */

/** One chip per category name, in display order, with the number of eligible dishes in each. */
export const buildCategoryGroups = (categories: CatalogCategory[] | null, items: CatalogItem[]): CategoryGroup[] => {
  const groups = new Map<string, CategoryGroup>();
  const groupFor = (name: string, order: number) => {
    const key = categoryKey(name);
    const group = groups.get(key) ?? { key, name: name.trim(), count: 0, order };
    group.order = Math.min(group.order, order);
    groups.set(key, group);
    return group;
  };

  for (const category of categories ?? []) {
    if (category.is_active !== false) groupFor(category.name, category.display_order ?? 0);
  }
  for (const item of items) groupFor(item.category.name, Number.MAX_SAFE_INTEGER).count += 1;

  return [...groups.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
};

/**
 * The category on screen: the cashier's choice while it still exists, otherwise the fallback. With `fallback` 'first'
 * that is the first category that has dishes (All Stalls opens on one category, not on every dish of the food court);
 * with ALL_CATEGORIES (one stall picked) it is that stall's whole menu.
 */
export const resolveSelectedCategory = (
  groups: CategoryGroup[],
  selected: string | null,
  fallback: 'first' | typeof ALL_CATEGORIES = 'first'
): string => {
  if (selected === ALL_CATEGORIES) return ALL_CATEGORIES;
  if (selected && groups.some((g) => g.key === selected)) return selected;
  if (fallback === ALL_CATEGORIES) return ALL_CATEGORIES;
  return (groups.find((g) => g.count > 0) ?? groups[0])?.key ?? ALL_CATEGORIES;
};

/**
 * An uploaded photo is saved with the server's address at upload time, but the built-in server takes a new port each launch.
 * Point our own photos at the current server; any other image address is left alone.
 */
export const menuImageUrl = (url: string | null | undefined, apiBase: string | undefined): string | null => {
  if (!url) return null;
  const path = url.indexOf('/public/menu-images/');
  return path >= 0 && apiBase ? apiBase.replace(/\/$/, '') + url.slice(path) : url;
};

export const filterCatalog = <T extends CatalogItem>(items: T[], selected: string, query: string): T[] => {
  const term = query.trim().toLowerCase();
  return items.filter((item) => {
    if (selected !== ALL_CATEGORIES && categoryKey(item.category.name) !== selected) return false;
    return (
      item.name.toLowerCase().includes(term) ||
      item.stall.name.toLowerCase().includes(term) ||
      item.category.name.toLowerCase().includes(term)
    );
  });
};

/* --------------------------------------------------------- category cards */

export interface CategoryCard<T> {
  key: string;
  name: string;
  /** Dishes on this card, in the order the menu returned them. */
  items: T[];
  /** More than one stall's dishes share this card, so each dish row names its stall. */
  multiStall: boolean;
}

/**
 * The cashier's catalogue as cards: one per category name (in display order), each holding its dishes, in a single pass
 * over the dishes. Categories without a dish on screen get no card. A dish appears on exactly one card, once.
 */
export const buildCategoryCards = <T extends CatalogItem & { id: number }>(groups: CategoryGroup[], items: T[]): CategoryCard<T>[] => {
  const byKey = new Map<string, { items: T[]; stalls: Set<number> }>();
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const key = categoryKey(item.category.name);
    const bucket = byKey.get(key) ?? { items: [], stalls: new Set<number>() };
    bucket.items.push(item);
    bucket.stalls.add(item.stall_id);
    byKey.set(key, bucket);
  }
  const cards: CategoryCard<T>[] = [];
  const placed = new Set<string>();
  const push = (key: string, name: string) => {
    const bucket = byKey.get(key);
    if (!bucket || placed.has(key)) return;
    placed.add(key);
    cards.push({ key, name, items: bucket.items, multiStall: bucket.stalls.size > 1 });
  };
  for (const group of groups) push(group.key, group.name);
  // A dish whose category is not in the groups (should not happen) still gets a card rather than vanishing
  for (const [key, bucket] of byKey) push(key, bucket.items[0].category.name.trim());
  return cards;
};

/** How many dish rows a closed card shows; the rest open in place with "Show all". */
export const CARD_PREVIEW_ROWS = 6;

/* ------------------------------------------------- the cashier's card layout */

/**
 * The cashier's own card order and collapsed cards, kept on this PC. Display only: it never changes a category or a dish.
 * Keys are category keys, so the layout holds across stalls and survives a restart.
 */
export interface CardLayout {
  order: string[];
  collapsed: string[];
}

export const EMPTY_LAYOUT: CardLayout = { order: [], collapsed: [] };
export const CARD_LAYOUT_STORAGE_KEY = 'foodcourt.pos.cardLayout.v1';

export const parseCardLayout = (raw: string | null | undefined): CardLayout => {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const strings = (a: unknown) => (Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === 'string'))] : []);
    return { order: strings(v?.order), collapsed: strings(v?.collapsed) };
  } catch {
    return EMPTY_LAYOUT;
  }
};

/**
 * Every key in the cashier's order: saved keys first as saved, and any category the cashier has not placed yet (a new one)
 * slotted in right after the card it follows in the menu's own order, so it shows up where the owner put it.
 */
export const effectiveOrder = (defaultKeys: string[], saved: string[]): string[] => {
  const known = new Set(defaultKeys);
  const out = saved.filter((k) => known.has(k));
  const placed = new Set(out);
  defaultKeys.forEach((key, i) => {
    if (placed.has(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = out.indexOf(defaultKeys[j]);
      if (prev >= 0) {
        at = prev + 1;
        break;
      }
    }
    out.splice(at, 0, key);
    placed.add(key);
  });
  return out;
};

/** The cards on screen in the cashier's order. */
export const orderCards = <C extends { key: string }>(cards: C[], order: string[]): C[] => {
  if (order.length === 0) return cards;
  const rank = new Map(order.map((k, i) => [k, i]));
  return cards
    .map((c, i) => ({ c, r: rank.get(c.key) ?? Number.MAX_SAFE_INTEGER, i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
};

/** Moves one card next to another. Works on the full order, so dragging inside one stall's view keeps every other card. */
export const moveCard = (order: string[], key: string, target: string, place: 'before' | 'after'): string[] => {
  if (key === target || !order.includes(key) || !order.includes(target)) return order;
  const out = order.filter((k) => k !== key);
  const at = out.indexOf(target) + (place === 'after' ? 1 : 0);
  out.splice(at, 0, key);
  return out;
};

/** Moves a card one place among the cards on screen (keyboard: Alt + arrow). */
export const stepCard = (order: string[], visible: string[], key: string, delta: -1 | 1): string[] => {
  const i = visible.indexOf(key);
  const neighbour = visible[i + delta];
  if (i < 0 || !neighbour) return order;
  return moveCard(order, key, neighbour, delta < 0 ? 'before' : 'after');
};
