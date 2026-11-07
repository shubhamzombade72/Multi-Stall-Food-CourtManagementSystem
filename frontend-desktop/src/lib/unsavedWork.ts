/**
 * Tells the main process what an update would lose right now, so the app never closes under a cashier. Screens mark their own
 * work (cart, payment dialog), and a form with typed input marks itself. Silence counts as busy on the other side, so this
 * reports on a timer even when nothing has changed.
 */
import { desktop } from '../desktop/bridge';

const REPORT_MS = 20_000;
const FORM_IDLE_MS = 30 * 60_000; // a form left half typed for this long must not hold back updates for ever

const marks = new Set<string>();
let formTouchedAt = 0;
let started = false;

const current = (): string[] => {
  const list = [...marks];
  if (formTouchedAt && Date.now() - formTouchedAt < FORM_IDLE_MS) list.push('form');
  return list;
};

const report = (): void => {
  void desktop()?.updateReportActivity(current()).catch(() => undefined);
};

/** `key` is a short lower-case name such as `cart`. */
export const setUnsavedWork = (key: string, active: boolean): void => {
  const before = marks.has(key);
  if (active) marks.add(key);
  else marks.delete(key);
  if (before !== active) report();
};

/** Begins reporting. Safe to call more than once, and does nothing outside the desktop app. */
export const startUnsavedWorkReporting = (): void => {
  if (started || !desktop()) return;
  started = true;
  document.addEventListener('input', (e) => {
    if ((e.target as Element | null)?.closest?.('form')) formTouchedAt = Date.now();
  }, true);
  const clearForm = () => {
    formTouchedAt = 0;
  };
  document.addEventListener('submit', clearForm, true);
  window.addEventListener('hashchange', clearForm);
  window.setInterval(report, REPORT_MS);
  report();
};
