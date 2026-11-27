/**
 * Format cents to a US dollar string like "$1,234.56".
 */
export function formatCurrency(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '$0.00';
  }

  const dollars = cents / 100;
  const isNegative = dollars < 0;
  const absDollars = Math.abs(dollars);

  const [whole, fraction = '00'] = absDollars.toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return isNegative
    ? `-$${withCommas}.${fraction}`
    : `$${withCommas}.${fraction}`;
}

/**
 * Parse a display currency string like "$1,234.56" back to cents (123456).
 * Returns 0 for unparseable input.
 */
export function parseCurrency(display: string): number {
  const cleaned = display.replace(/[$,\s]/g, '');
  const value = parseFloat(cleaned);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100);
}
