import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@basenative/runtime';
import { mountPagination, pageCount } from './pagination.js';
import { tick } from '../../test/helpers.js';

describe('pageCount', () => {
  it('rounds up and never reports fewer than one page', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(60, 25)).toBe(3);
  });
});

describe('mountPagination', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  function mount(total: number, page = 1) {
    const pageSignal = signal(page);
    const totalSignal = signal(total);
    const onPage = vi.fn((next: number) => pageSignal.set(next));
    const pager = mountPagination({
      page: pageSignal,
      total: totalSignal,
      perPage: 25,
      onPage,
      testId: 'leads',
      label: 'Lead pages',
      noun: 'leads',
    });
    dispose = pager.dispose;
    document.body.append(pager.element);
    const q = (id: string) =>
      pager.element.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
    return {
      pager,
      onPage,
      pageSignal,
      totalSignal,
      prev: q('leads-prev'),
      next: q('leads-next'),
      summary: pager.element.querySelector('[data-bn-pagination-summary]'),
    };
  }

  it('renders the nav with the data-bn hooks and reports the total', () => {
    const { pager, summary, prev, next } = mount(60);
    expect(pager.element.hasAttribute('data-bn-pagination')).toBe(true);
    expect(pager.element.getAttribute('aria-label')).toBe('Lead pages');
    expect(pager.element.hasAttribute('hidden')).toBe(false);
    expect(summary?.textContent).toBe('Page 1 of 3 · 60 leads');
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
  });

  it('hides itself while everything fits on one page', () => {
    const { pager, totalSignal } = mount(25);
    expect(pager.element.hasAttribute('hidden')).toBe(true);
    totalSignal.set(26);
    expect(pager.element.hasAttribute('hidden')).toBe(false);
    totalSignal.set(0);
    expect(pager.element.hasAttribute('hidden')).toBe(true);
  });

  it('asks for the next and previous page and stops at the edges', async () => {
    const { onPage, prev, next, summary } = mount(60);
    next.click();
    await tick();
    expect(onPage).toHaveBeenLastCalledWith(2);
    expect(summary?.textContent).toBe('Page 2 of 3 · 60 leads');
    expect(prev.disabled).toBe(false);
    next.click();
    expect(onPage).toHaveBeenLastCalledWith(3);
    expect(next.disabled).toBe(true);
    next.click();
    expect(onPage).toHaveBeenCalledTimes(2);
    prev.click();
    expect(onPage).toHaveBeenLastCalledWith(2);
  });

  it('disables both buttons while the list is loading', () => {
    const page = signal(2);
    const loading = signal(true);
    const pager = mountPagination({
      page,
      total: () => 60,
      perPage: 25,
      onPage: () => undefined,
      testId: 'jobs',
      label: 'Job pages',
      loading,
    });
    dispose = pager.dispose;
    const prev = pager.element.querySelector(
      '[data-testid="jobs-prev"]',
    ) as HTMLButtonElement;
    const next = pager.element.querySelector(
      '[data-testid="jobs-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    loading.set(false);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(
      pager.element.querySelector('[data-bn-pagination-summary]')?.textContent,
    ).toBe('Page 2 of 3 · 60 entries');
  });

  it('stops reacting once disposed', () => {
    const { pager, totalSignal, summary } = mount(60);
    pager.dispose();
    dispose = null;
    totalSignal.set(100);
    expect(summary?.textContent).toBe('Page 1 of 3 · 60 leads');
  });
});
