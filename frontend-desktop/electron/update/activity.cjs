/**
 * The idle gate: may the application close for an update right now? No Electron imports.
 *
 * Fails closed: any signal that cannot be read counts as busy. Saved open orders and pending bills are deliberately NOT
 * signals. They are in the database, survive an update and are verified by the data comparison, and blocking on them would
 * mean a busy food court never updates. What blocks is work that an update would lose or interrupt.
 */
const QUIET_MS = 2 * 60 * 1000;
// Chromium slows the timers of a hidden window to about once a minute, so this allows for several missed reports
const RENDERER_STALE_MS = 4 * 60 * 1000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UNSAVED = /^[a-z_]{1,30}$/;

function createActivity({ now = () => Date.now(), printBusy, maintenanceBusy, openUpiCount, hasWindow, quietMs = QUIET_MS, rendererStaleMs = RENDERER_STALE_MS }) {
  const inFlight = new Set();
  let lastWrite = 0;
  let renderer = null; // { at, unsaved: [] }
  let rendererLost = false;

  return {
    requestStarted(id, method) {
      if (!WRITE_METHODS.has(String(method).toUpperCase())) return;
      inFlight.add(id);
      lastWrite = now();
    },
    requestFinished(id) {
      if (inFlight.delete(id)) lastWrite = now();
    },
    /** The renderer's own report of unsaved work. Unknown names are dropped, and the rest are only ever compared to empty. */
    rendererReport(unsaved) {
      renderer = { at: now(), unsaved: (Array.isArray(unsaved) ? unsaved : []).filter((k) => typeof k === 'string' && UNSAVED.test(k)).slice(0, 20) };
      rendererLost = false;
    },
    rendererGone() {
      rendererLost = true;
    },
    /**
     * Resolves { idle, reasons }. `reasons` holds short codes for the log and the Updates screen, never business data.
     * `ownerPressed`: the owner is at the screen and chose this, so the quiet period is not needed. Everything else still applies.
     */
    async evaluate({ ownerPressed = false } = {}) {
      const reasons = [];
      if (inFlight.size > 0) reasons.push('request_in_flight');
      if (!ownerPressed && lastWrite && now() - lastWrite < quietMs) reasons.push('recent_write');

      let windowOpen = true;
      try {
        windowOpen = hasWindow();
      } catch {
        reasons.push('window_unknown');
      }
      // No window means nobody can have unsaved work. A crashed or silent renderer might have, so it counts as busy.
      if (windowOpen) {
        if (rendererLost) reasons.push('renderer_crashed');
        else if (!renderer || now() - renderer.at > rendererStaleMs) reasons.push('renderer_unknown');
        else renderer.unsaved.forEach((k) => reasons.push(`unsaved_${k}`));
      }

      const read = async (name, fn) => {
        try {
          return await fn();
        } catch {
          reasons.push(`${name}_unknown`);
          return null;
        }
      };
      if (await read('printing', printBusy)) reasons.push('print_jobs');
      if (await read('maintenance', maintenanceBusy)) reasons.push('backup_or_restore');
      // Asked last, because it starts a process
      if (reasons.length === 0) {
        const open = await read('upi', openUpiCount);
        if (open === null || open === undefined) {
          if (!reasons.includes('upi_unknown')) reasons.push('upi_unknown');
        } else if (open > 0) {
          reasons.push('upi_payment_open');
        }
      }
      return { idle: reasons.length === 0, reasons };
    },
  };
}

module.exports = { createActivity, QUIET_MS, RENDERER_STALE_MS };
