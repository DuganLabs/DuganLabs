const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Format ISO string to "Mar 20, 2026" style.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return 'Invalid date';
  }
  const month = MONTHS_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

/**
 * Format ISO string to "Mar 20, 2026, 2:30 PM".
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return 'Invalid date';
  }
  const datePart = formatDate(iso);
  const hours24 = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  const minutesStr = minutes.toString().padStart(2, '0');
  return `${datePart}, ${hours12}:${minutesStr} ${period}`;
}

/**
 * Check if timestamp is in the past.
 */
export function isExpired(iso: string): boolean {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return false;
  }
  return d.getTime() < Date.now();
}

/**
 * Days between two ISO strings (absolute value).
 */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) {
    return 0;
  }
  const msPerDay = 86_400_000;
  return Math.round(Math.abs(da.getTime() - db.getTime()) / msPerDay);
}

/**
 * Returns ISO string at midnight UTC for the given date.
 */
export function startOfDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return 'Invalid date';
  }
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Relative time string: "just now", "2 hours ago", "3 days ago", etc.
 */
export function toRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return 'Invalid date';
  }
  const now = Date.now();
  const diffMs = now - d.getTime();

  if (diffMs < 0) {
    return 'in the future';
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }

  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}
