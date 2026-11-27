import { describe, expect, it } from 'vitest';
import {
  tenantFooterHtml,
  tenantHeaderHtml,
  tenantTabsHtml,
  type TenantChrome,
} from './surface-pages';

const chrome: TenantChrome = {
  workspaceName: 'Reed HVAC',
  trade: 'HVAC',
  phone: '+15125550142',
  phoneDisplay: '(512) 555-0142',
  email: 'hello@reed.example',
  logoUrl: '',
  initials: 'RH',
  markBg: '#123456',
  markFg: '#ffffff',
  markAccent: '#abcdef',
  markTreatment: 'solid',
  markShape: 'square',
  markTurn: '0',
  license: '',
  areaSuffix: ' in Denver, CO',
  hasQuote: false,
  active: 'home',
};

describe('tenant chrome', () => {
  it('uses the shared rail, tab bar and footer', () => {
    const header = tenantHeaderHtml(chrome);
    const tabs = tenantTabsHtml(chrome);
    const footer = tenantFooterHtml(chrome);
    expect(header).toContain('data-bn="bn-topbar"');
    expect(header).toContain('data-bn="bn-rail"');
    expect(header).not.toContain('data-bn="bn-tab-bar"');
    expect(tabs).toContain('data-bn="bn-tab-bar" data-placement="floating"');
    expect(tabs).toContain('stroke-width="2.25"');
    expect(tabs.match(/data-bn="bn-symbol"/g)).toHaveLength(4);
    expect(header).toContain('data-bn="bn-brand"');
    expect(footer).toContain('data-bn="bn-site-footer"');
    expect(footer).toContain('data-bn-column');
  });

  it('names the price only when a flow is published', () => {
    expect(tenantHeaderHtml(chrome)).toContain(
      '<a href="/contact" data-bn="nav-cta-link">Get a quote</a>',
    );
    expect(tenantHeaderHtml(chrome)).not.toContain('Get a price');
    expect(
      tenantHeaderHtml({ ...chrome, hasQuote: true, active: 'home' }),
    ).toContain('<a href="/quote" data-bn="nav-cta-link">Get a price</a>');
  });
});
