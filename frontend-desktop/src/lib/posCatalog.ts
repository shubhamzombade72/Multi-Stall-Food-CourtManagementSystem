/**
 * Category browsing for the Cashier POS. Display-only: it decides which dishes are on screen and never changes a dish.
 * The stall that receives an order item comes from the dish itself on the server, not from anything chosen here.
 *
 * menu_categories belong to a stall, so two stalls can each have a "Pizza" row. The cashier sees one Pizza chip holding
 * both stalls' dishes, so chips are grouped by name rather than by category id.
 */
export interface CatalogCategory {
  id: number;
  name: string;
  display_order?: number | null;
  is_active?: boolean | null;
}

export interface CatalogItem {
  name: string;
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

/** Dishes the cashier may browse. `categories` is null when the list could not be loaded: nothing is hidden then. */
export const eligibleItems = <T extends CatalogItem>(items: T[], categories: CatalogCategory[] | null): T[] => {
  const inactive = new Set((categories ?? []).filter((c) => c.is_active === false).map((c) => c.id));
  return items.filter((item) => !inactive.has(item.category.id));
};

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

/** The category on screen: the cashier's choice while it still exists, otherwise the first one that has dishes. */
export const resolveSelectedCategory = (groups: CategoryGroup[], selected: string | null): string => {
  if (selected === ALL_CATEGORIES) return ALL_CATEGORIES;
  if (selected && groups.some((g) => g.key === selected)) return selected;
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
