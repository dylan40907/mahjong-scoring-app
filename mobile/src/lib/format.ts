/**
 * Formatting helpers.
 *
 * Signed point totals appear everywhere in this app, in lists where the eye
 * scans a column of them. An explicit plus sign and a true minus glyph keep
 * that column readable; the hyphen a naive `String(n)` produces is narrower
 * than the digits beside it and makes the column look ragged.
 */

const MINUS = '−';

export function signed(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `${MINUS}${Math.abs(value)}`;
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

const DAY = 86_400_000;

export function relativeDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const days = Math.round((startOfToday - startOfThen) / DAY);

  if (days === 0) {
    return then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export const WIND_LABEL: Record<string, string> = {
  east: 'East',
  south: 'South',
  west: 'West',
  north: 'North',
};

export const WIND_GLYPH: Record<string, string> = {
  east: '東',
  south: '南',
  west: '西',
  north: '北',
};

/** "3 tai", "6 faan", "4 han", "24 points" - the unit belongs to the ruleset. */
export function scoreLabel(total: number, unit: string): string {
  return `${total} ${unit}`;
}
