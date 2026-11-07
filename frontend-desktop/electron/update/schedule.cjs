/**
 * When an update may install (no Electron imports; the rules are pure so every case can be tested).
 *
 * Modes:
 *   idle          downloaded updates install on their own as soon as nobody is using the PC, the default
 *   silent        downloaded updates install on their own in the maintenance window
 *   approve_once  the owner approves a version once, and it then installs in the window
 *   ask           installs only when the owner presses Update Now
 *
 * Times are the PC's local time, so a change of time zone simply moves the window with the clock.
 */
const DEFAULT_POLICY = Object.freeze({ mode: 'idle', window: Object.freeze({ start: '02:00', end: '05:00' }) });
const MODES = ['idle', 'silent', 'approve_once', 'ask'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const minutesOf = (hhmm) => {
  const m = TIME.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Anything unreadable falls back to the default rather than to "install at any time". */
function normalizePolicy(input) {
  const mode = MODES.includes(input?.mode) ? input.mode : DEFAULT_POLICY.mode;
  const start = minutesOf(input?.window?.start);
  const end = minutesOf(input?.window?.end);
  const valid = start !== null && end !== null && start !== end;
  return { mode, window: valid ? { start: input.window.start, end: input.window.end } : { ...DEFAULT_POLICY.window } };
}

/** True when `date` falls inside the window. A window may cross midnight (22:00 to 04:00). */
function inWindow(date, window) {
  const now = date.getHours() * 60 + date.getMinutes();
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

const atMinutes = (date, minutes) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);

/** The next moment the window opens, or `date` itself when it is open now. */
function nextWindowStart(date, window) {
  if (inWindow(date, window)) return date;
  const today = atMinutes(date, minutesOf(window.start));
  return today > date ? today : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, today.getHours(), today.getMinutes());
}

/**
 * True when a whole window has closed since the update became ready, meaning the PC was off or busy through it. Such an
 * update installs at the next start of the app, before anyone can begin working.
 */
function windowMissed(readyAtMs, nowMs, window) {
  if (!Number.isFinite(readyAtMs) || nowMs <= readyAtMs) return false;
  const closeToday = atMinutes(new Date(nowMs), minutesOf(window.end)).getTime();
  const lastClose = closeToday <= nowMs ? closeToday : closeToday - DAY_MS;
  return readyAtMs < lastClose;
}

/** An install that already failed and was rolled back is never retried on its own: someone has to look. */
const previouslyFailed = (lastResult, version) => Boolean(lastResult && lastResult.version === version && ['recovered', 'needs_developer'].includes(lastResult.outcome));

/**
 * May this ready update install now, automatically? `trigger` is 'tick' (app open, checked each minute), 'task' (the daily
 * scheduled task with the app closed) or 'start' (the app is opening).
 * Returns { install, reason }. Whether the POS is idle is decided separately and must also pass.
 */
function automaticInstall({ pending, policy, currentVersion, lastResult, now, trigger, compareVersions, snooze }) {
  if (!pending) return { install: false, reason: 'nothing_ready' };
  if (compareVersions(pending.version, currentVersion) <= 0) return { install: false, reason: 'not_newer' };
  if (previouslyFailed(lastResult, pending.version)) return { install: false, reason: 'failed_before' };
  // "Remind me later" is a promise, whichever rule is set
  if (snooze && snooze.version === pending.version && snooze.until > now.getTime()) return { install: false, reason: 'snoozed' };
  if (policy.mode === 'ask') return { install: false, reason: 'needs_owner' };
  // Nobody can have started work yet at 'start'. At 'tick' the agent also requires that nobody has touched the PC for a while
  if (policy.mode === 'idle' && trigger === 'tick') return { install: true, reason: 'idle' };
  if (policy.mode === 'idle' && trigger === 'start') return { install: true, reason: 'app_opening' };
  if (policy.mode === 'approve_once' && !pending.approved) return { install: false, reason: 'needs_approval' };
  if (inWindow(now, policy.window)) return { install: true, reason: 'in_window' };
  if (trigger === 'start' && windowMissed(Date.parse(pending.ready_at), now.getTime(), policy.window)) return { install: true, reason: 'window_missed' };
  return { install: false, reason: 'outside_window' };
}

const TASK_NAME = 'MangalMurti POS Maintenance';

/** Arguments for schtasks: a per-user daily task. It needs no administrator rights and runs only while that user is signed in. */
function taskCreateArgs(exePath, window) {
  return ['/Create', '/F', '/SC', 'DAILY', '/TN', TASK_NAME, '/ST', window.start, '/TR', `"${exePath}" --fc-maintenance`];
}

module.exports = { DEFAULT_POLICY, MODES, TASK_NAME, normalizePolicy, inWindow, nextWindowStart, windowMissed, previouslyFailed, automaticInstall, taskCreateArgs };
