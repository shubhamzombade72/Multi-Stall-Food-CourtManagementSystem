/**
 * Screen-size rules shared by every screen, so a phone, a phone on its side and a tablet each get a layout that fits.
 * Widths are in density-independent points (what useWindowDimensions reports), not pixels.
 */

/** Horizontal padding of the list screens (16 each side). */
export const SCREEN_PADDING = 32;

/** How many columns fit when each item needs at least `minItemWidth` points; always 1 to `max`. */
export const columnsFor = (screenWidth: number, minItemWidth: number, max: number, min = 1): number => {
  const usable = Math.max(0, screenWidth - SCREEN_PADDING);
  const fit = Math.floor(usable / minItemWidth);
  return Math.max(min, Math.min(max, fit || 1));
};

/** Column counts for each list: tables are small tiles, dishes and serving cards need more room per item. */
export const tableColumns = (w: number) => columnsFor(w, 200, 6, 2);
export const menuColumns = (w: number) => columnsFor(w, 360, 4);
export const serveColumns = (w: number) => columnsFor(w, 440, 3);

/** Forms (sign-in, server address) never stretch wider than this on a tablet. */
export const FORM_MAX_WIDTH = 520;
