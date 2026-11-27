// @vitest-environment happy-dom
/**
 * The tenant site's one script, served as /js/app.js, run against the
 * contact page it ships with. render.spec.ts asserts on the markup; this
 * drives the handlers the way a browser would — the nav drawer (GP-042),
 * the form's submit (GP-043) and the ?service= preselect (GP-044).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderTenantPage,
  tenantScript,
  type ServiceType,
  type WorkspaceData,
} from './render.js';

const WORKSPACE: WorkspaceData = {
  id: 'w1',
  name: 'Reed HVAC',
  slug: 'reed-hvac',
  trade: 'HVAC',
  phone: '+15125550142',
  email: 'hello@reed-hvac.example',
  logo_url: null,
  street: '123 Main St',
  city: 'Denver',
  state: 'CO',
  zip: '80202',
};

const SERVICES: ServiceType[] = [
  { name: 'Outlet & Switch Installation', count: 1 },
  { name: 'Panel Upgrade', count: 2 },
];

/**
 * Put the rendered contact page into the document and run app.js over it,
 * as the page's own deferred <script> would. That script tag is stripped
 * first so happy-dom does not try to fetch /js/app.js from nowhere.
 */
function loadContactPage(search = ''): void {
  window.history.replaceState(null, '', `/contact${search}`);
  const html = renderTenantPage(WORKSPACE, '/contact', SERVICES, []);
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  expect(body).not.toBe('');
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  new Function(tenantScript)();
}

const form = (): HTMLFormElement =>
  document.getElementById('lead-form') as HTMLFormElement;
const button = (): HTMLButtonElement =>
  form().querySelector('[type=submit]') as HTMLButtonElement;
const message = (): HTMLElement =>
  document.getElementById('form-message') as HTMLElement;
const field = (name: string): HTMLInputElement =>
  form().querySelector(`[name="${name}"]`) as HTMLInputElement;
const select = (): HTMLSelectElement =>
  document.querySelector('[name=serviceType]') as HTMLSelectElement;

function fillIn(): void {
  field('firstName').value = 'Jane';
  field('lastName').value = 'Smith';
  field('email').value = 'jane@example.com';
  select().value = 'Panel Upgrade';
}

/** Submit and let the handler's awaits (fetch, the body parse) settle. */
async function submit(): Promise<void> {
  form().dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the contact form submit (GP-043)', () => {
  it('re-enables the button with its own label after a successful send', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(201, { data: { id: 'l1' } }));
    vi.stubGlobal('fetch', fetchMock);
    loadContactPage();
    fillIn();

    await submit();

    expect(fetchMock).toHaveBeenCalledWith(
      '/leads',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(message().hidden).toBe(false);
    expect(message().getAttribute('data-bn-status')).toBe('success');
    expect(message().textContent).toBe('Thank you! We will be in touch soon.');
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Send it to Reed HVAC');
    // The form is cleared for a second enquiry, not destroyed.
    expect(field('firstName').value).toBe('');
  });

  it('re-enables the button when the honeypot swallows the submission', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    loadContactPage();
    fillIn();
    field('website').value = 'http://spam.example';

    await submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(message().hidden).toBe(true);
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Send it to Reed HVAC');
  });

  it('turns a non-JSON 5xx into a human message with the footer contact links, never a parser error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>edge error</html>', {
          status: 500,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    loadContactPage();
    fillIn();

    await submit();

    const text = message().textContent ?? '';
    expect(message().getAttribute('data-bn-status')).toBe('error');
    expect(text).not.toMatch(/SyntaxError|JSON|edge error|Unexpected token/);
    expect(text).toContain('Something went wrong on our end');
    expect(message().querySelector('a[href^="tel:"]')).not.toBeNull();
    expect(message().querySelector('a[href^="mailto:"]')).not.toBeNull();
    // The clones are the message's own links, not restyled footer ones.
    expect(message().querySelector('[data-bn="footer-contact"]')).toBeNull();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Send it to Reed HVAC');
  });

  it('does not show the server sentence for a 5xx envelope; it offers the phone and email instead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(500, {
          error: {
            code: 'WORKSPACE_NOT_READY',
            message:
              'This site is not set up to receive requests yet. Please call or email us directly.',
          },
        }),
      ),
    );
    loadContactPage();
    fillIn();

    await submit();

    expect(message().textContent).not.toContain('not set up to receive');
    expect(
      message().querySelector('a[href="tel:+15125550142"]'),
    ).not.toBeNull();
    expect(
      message().querySelector('a[href="mailto:hello@reed-hvac.example"]'),
    ).not.toBeNull();
    expect(button().disabled).toBe(false);
  });

  it('turns an offline fetch into a connection message with a mailto link, not "Failed to fetch"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    loadContactPage();
    fillIn();

    await submit();

    const text = message().textContent ?? '';
    expect(message().getAttribute('data-bn-status')).toBe('error');
    expect(text).not.toContain('Failed to fetch');
    expect(text).toContain('could not reach the site');
    expect(message().querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Send it to Reed HVAC');
  });

  it('still marks and focuses the field a 422 names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(422, {
          error: {
            code: 'VALIDATION',
            message: 'Please enter a valid email address.',
            field: 'email',
          },
        }),
      ),
    );
    loadContactPage();
    fillIn();
    field('email').value = 'not-an-email';

    await submit();

    expect(message().textContent).toBe('Please enter a valid email address.');
    expect(message().querySelector('a')).toBeNull();
    expect(field('email').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('email'));
    expect(button().disabled).toBe(false);
  });
});

describe('the ?service= preselect (GP-044)', () => {
  it('selects a service whose name carries an ampersand from the encoded link', () => {
    loadContactPage('?service=Outlet%20%26%20Switch%20Installation');
    expect(select().value).toBe('Outlet & Switch Installation');
  });

  it('selects a plain name', () => {
    loadContactPage('?service=Panel%20Upgrade');
    expect(select().value).toBe('Panel Upgrade');
  });

  it('leaves the placeholder selected, not a blank, for a name the form does not offer', () => {
    loadContactPage('?service=Something+We+Do+Not+Offer');
    expect(select().value).toBe('');
    expect(select().selectedIndex).toBe(0);
  });
});

describe('the phone nav does not need a script (GP-042)', () => {
  it('renders the rail and the tab bar, and the script never opens a drawer', () => {
    loadContactPage();
    expect(document.querySelector('[data-bn="bn-rail"]')).not.toBeNull();
    expect(document.querySelector('[data-bn="bn-tab-bar"]')).not.toBeNull();
    expect(document.querySelector('[data-bn="nav-toggle-input"]')).toBeNull();
    expect(tenantScript).not.toContain('nav-toggle');
  });
});
