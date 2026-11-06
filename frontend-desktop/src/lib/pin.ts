/**
 * What counts as an acceptable new PIN. The main process checks again (electron/auth-vault.cjs) and has the last word;
 * this copy lets the screen explain a problem right away. A test keeps the two identical.
 */
export type PinProblem = 'format' | 'weak' | null;

export const checkNewPin = (pin: string): PinProblem => {
  if (!/^(\d{4}|\d{6})$/.test(pin)) return 'format';
  if (/^(\d)\1+$/.test(pin)) return 'weak';
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10));
  if (steps.size === 1 && (steps.has(1) || steps.has(9))) return 'weak';
  return null;
};

/** "4 minutes 05 seconds" / "8 seconds" for the lock countdown. */
export const formatWait = (ms: number): string => {
  const total = Math.max(1, Math.ceil(ms / 1000));
  if (total < 60) return `${total} second${total === 1 ? '' : 's'}`;
  const minutes = Math.floor(total / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${String(total % 60).padStart(2, '0')} seconds`;
};
