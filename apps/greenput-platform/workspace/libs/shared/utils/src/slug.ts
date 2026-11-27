/**
 * Generate a URL-safe slug from a name.
 * Lowercases, replaces spaces and special characters with hyphens,
 * collapses multiple hyphens, and trims leading/trailing hyphens.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Validate that a slug contains only lowercase alphanumeric characters and hyphens.
 * Must not be empty, and must not start or end with a hyphen.
 */
export function isValidSlug(slug: string): boolean {
  if (slug.length === 0) {
    return false;
  }
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}
