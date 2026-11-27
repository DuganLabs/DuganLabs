import { describe, it, expect } from 'vitest';
import { clampPage, buildMeta, parseListParams } from './pagination';

describe('clampPage', () => {
  it('returns 1 for page 0', () => {
    expect(clampPage(0, 10)).toBe(1);
  });

  it('returns 1 for negative page', () => {
    expect(clampPage(-5, 10)).toBe(1);
  });

  it('clamps to totalPages when page exceeds it', () => {
    expect(clampPage(15, 10)).toBe(10);
  });

  it('returns the page if within bounds', () => {
    expect(clampPage(5, 10)).toBe(5);
  });

  it('returns 1 when totalPages is 0', () => {
    expect(clampPage(1, 0)).toBe(1);
  });

  it('returns 1 when totalPages is negative', () => {
    expect(clampPage(3, -1)).toBe(1);
  });

  it('floors fractional page numbers', () => {
    expect(clampPage(2.7, 10)).toBe(2);
  });
});

describe('buildMeta', () => {
  it('builds correct meta for normal case', () => {
    expect(buildMeta(100, 2, 25)).toEqual({
      total: 100,
      page: 2,
      perPage: 25,
      totalPages: 4,
    });
  });

  it('caps perPage at 100', () => {
    const meta = buildMeta(200, 1, 200);
    expect(meta.perPage).toBe(100);
  });

  it('ensures perPage is at least 1', () => {
    const meta = buildMeta(10, 1, 0);
    expect(meta.perPage).toBe(1);
  });

  it('handles 0 total', () => {
    expect(buildMeta(0, 1, 25)).toEqual({
      total: 0,
      page: 1,
      perPage: 25,
      totalPages: 1,
    });
  });

  it('clamps page if it exceeds totalPages', () => {
    const meta = buildMeta(10, 5, 10);
    expect(meta.page).toBe(1);
    expect(meta.totalPages).toBe(1);
  });

  it('handles negative total', () => {
    const meta = buildMeta(-5, 1, 25);
    expect(meta.total).toBe(0);
  });

  it('calculates totalPages with ceiling division', () => {
    const meta = buildMeta(26, 1, 25);
    expect(meta.totalPages).toBe(2);
  });
});

describe('parseListParams', () => {
  it('returns defaults for empty params', () => {
    const params = new URLSearchParams();
    expect(parseListParams(params)).toEqual({ page: 1, perPage: 25 });
  });

  it('parses page and perPage', () => {
    const params = new URLSearchParams('page=3&perPage=50');
    expect(parseListParams(params)).toEqual({ page: 3, perPage: 50 });
  });

  it('caps perPage at 100', () => {
    const params = new URLSearchParams('perPage=500');
    expect(parseListParams(params).perPage).toBe(100);
  });

  it('ensures perPage is at least 1', () => {
    const params = new URLSearchParams('perPage=-10');
    expect(parseListParams(params).perPage).toBe(1);
  });

  it('defaults page to 1 for invalid values', () => {
    const params = new URLSearchParams('page=abc');
    expect(parseListParams(params).page).toBe(1);
  });

  it('defaults page to 1 for negative values', () => {
    const params = new URLSearchParams('page=-1');
    expect(parseListParams(params).page).toBe(1);
  });

  it('parses q parameter', () => {
    const params = new URLSearchParams('q=john');
    expect(parseListParams(params).q).toBe('john');
  });

  it('trims q parameter', () => {
    const params = new URLSearchParams('q=  john  ');
    expect(parseListParams(params).q).toBe('john');
  });

  it('omits q if empty', () => {
    const params = new URLSearchParams('q=');
    expect(parseListParams(params).q).toBeUndefined();
  });

  it('parses status parameter', () => {
    const params = new URLSearchParams('status=new');
    expect(parseListParams(params).status).toBe('new');
  });

  it('parses source parameter', () => {
    const params = new URLSearchParams('source=referral');
    expect(parseListParams(params).source).toBe('referral');
  });

  it('parses all parameters together', () => {
    const params = new URLSearchParams(
      'page=2&perPage=10&q=test&status=active&source=web',
    );
    expect(parseListParams(params)).toEqual({
      page: 2,
      perPage: 10,
      q: 'test',
      status: 'active',
      source: 'web',
    });
  });
});
