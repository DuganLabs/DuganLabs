import { signal } from '@basenative/runtime';
import { describe, expect, it } from 'vitest';
import { el } from '../../lib/dom.js';
import { tick } from '../../test/helpers.js';
import { buildPanel, buildPanelForm } from './panel.js';

function args(overrides: Partial<Parameters<typeof buildPanelForm>[0]> = {}) {
  return {
    body: [el('input', { 'data-testid': 'field' })],
    onSubmit: () => Promise.resolve(),
    onCancel: () => undefined,
    submitting: signal(false),
    submitError: signal<string | null>(null),
    ...overrides,
  };
}

describe('buildPanelForm', () => {
  it('renders the body, a hidden error banner and the footer buttons', () => {
    const form = buildPanelForm(args({ submitLabel: 'Go' }));
    expect(form.element.tagName).toBe('FORM');
    expect(form.element.querySelector('[data-testid="field"]')).not.toBeNull();
    expect(
      form.element.querySelector('[data-bn-error]')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(
      form.element.querySelector('[data-testid="panel-submit"]')?.textContent,
    ).toBe('Go');
    expect(
      form.element.querySelector('[data-testid="panel-cancel"]'),
    ).not.toBeNull();
    form.dispose();
  });

  it('lets a route name the submit button so two panels on one route stay distinct', () => {
    const form = buildPanelForm(args({ submitTestId: 'convert-submit' }));
    expect(
      form.element.querySelector('[data-testid="convert-submit"]'),
    ).not.toBeNull();
    expect(
      form.element.querySelector('[data-testid="panel-submit"]'),
    ).toBeNull();
    form.dispose();
  });

  it('submits without navigating, cancels, and mirrors the signals', async () => {
    let submitted = 0;
    let cancelled = 0;
    const submitting = signal(false);
    const submitError = signal<string | null>(null);
    const form = buildPanelForm(
      args({
        onSubmit: () => {
          submitted += 1;
          return Promise.resolve();
        },
        onCancel: () => {
          cancelled += 1;
        },
        submitting,
        submitError,
      }),
    );
    document.body.append(form.element);

    const submitEvent = new Event('submit', {
      bubbles: true,
      cancelable: true,
    });
    form.element.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
    expect(submitted).toBe(1);

    (
      form.element.querySelector('[data-testid="panel-cancel"]') as HTMLElement
    ).click();
    expect(cancelled).toBe(1);

    submitting.set(true);
    submitError.set('Nope');
    await tick();
    const submit = form.element.querySelector(
      '[data-testid="panel-submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Saving…');
    const banner = form.element.querySelector('[data-bn-error]') as HTMLElement;
    expect(banner.hasAttribute('hidden')).toBe(false);
    expect(banner.textContent).toBe('Nope');

    form.dispose();
    form.element.remove();
  });
});

describe('buildPanel', () => {
  it('wraps the form in a labelled aside with a close button', () => {
    let cancelled = 0;
    const panel = buildPanel({
      ...args({
        onCancel: () => {
          cancelled += 1;
        },
      }),
      title: 'New thing',
    });
    expect(panel.element.getAttribute('data-bn-panel')).toBe('');
    expect(panel.element.getAttribute('aria-labelledby')).toBe('panel-title');
    expect(panel.element.querySelector('#panel-title')?.textContent).toBe(
      'New thing',
    );
    expect(
      panel.element.querySelector('form[data-bn-panel-form]'),
    ).not.toBeNull();
    (
      panel.element.querySelector('[aria-label="Close"]') as HTMLElement
    ).click();
    expect(cancelled).toBe(1);
    panel.dispose();
  });
});
