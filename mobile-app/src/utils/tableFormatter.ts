/**
 * Formats a table identifier for UI display without duplicating prefixes (e.g. 'T-').
 *
 * Requirements:
 *  - Prevents 'T-T-01' when table_number already has 'T-' in database
 *  - Handles tables with or without prefix ('T-01' -> 'T-01', '01' -> 'T-01')
 *  - Idempotent: formatTableLabel(formatTableLabel(x)) === formatTableLabel(x)
 */
export const formatTableLabel = (tableNumber?: string | null): string => {
  if (!tableNumber) return '';
  const trimmed = tableNumber.trim();
  if (!trimmed) return '';

  // Collapse any duplicate 'T-' or 't-' prefixes (e.g. 'T-T-01' -> 'T-01')
  const collapsed = trimmed.replace(/^(T-)+/i, 'T-');

  // If already prefixed with 'T-', return it
  if (/^T-/i.test(collapsed)) {
    return 'T-' + collapsed.slice(2);
  }

  // If prefixed with another section code (e.g. 'VIP-01'), preserve as-is
  if (/^[A-Za-z]+-/i.test(collapsed)) {
    return collapsed;
  }

  // Bare number or numeric string (e.g. '01', '1', '12') -> prefix with 'T-'
  return `T-${collapsed}`;
};

