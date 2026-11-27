export interface PaginationMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ListParams {
  page: number;
  perPage: number;
  q?: string;
  status?: string;
  source?: string;
}

/**
 * Clamp a page number to be within valid bounds [1, totalPages].
 */
export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(Math.floor(page), totalPages));
}

/**
 * Build a pagination meta object from total count, current page, and page size.
 */
export function buildMeta(
  total: number,
  page: number,
  perPage: number,
): PaginationMeta {
  const safePer = Math.max(1, Math.min(perPage, 100));
  const safeTotal = Math.max(0, total);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePer));
  const safePage = clampPage(page, totalPages);

  return {
    total: safeTotal,
    page: safePage,
    perPage: safePer,
    totalPages,
  };
}

/**
 * Parse common list query parameters from a URLSearchParams object.
 */
export function parseListParams(params: URLSearchParams): ListParams {
  const rawPage = parseInt(params.get('page') ?? '1', 10);
  const rawPerPage = parseInt(params.get('perPage') ?? '25', 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const perPage = isNaN(rawPerPage)
    ? 25
    : Math.max(1, Math.min(rawPerPage, 100));

  const result: ListParams = { page, perPage };

  const q = params.get('q');
  if (q && q.trim().length > 0) {
    result.q = q.trim();
  }

  const status = params.get('status');
  if (status && status.trim().length > 0) {
    result.status = status.trim();
  }

  const source = params.get('source');
  if (source && source.trim().length > 0) {
    result.source = source.trim();
  }

  return result;
}
