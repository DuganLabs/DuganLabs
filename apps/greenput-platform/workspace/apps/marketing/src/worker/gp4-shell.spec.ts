import { describe, expect, it } from 'vitest';
import { gp4Density, gp4Shell } from './gp4-shell.js';
import { GP4_SPRITE } from './gp4-sprite.js';

describe('gp4 shell', () => {
  it('marks the active route in the header, footer, and tab bar', () => {
    const html = gp4Shell('<p>Page</p>', 'features');
    expect(html).toContain('href="/features" aria-current="page"');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<p>Page</p>');
    expect(html).toContain('aria-label="Main sections"');
    expect(gp4Density('contact')).toBe('comfortable');
    expect(gp4Density('home')).toBe('spacious');
  });

  it('shares one sprite of custom SVG icons, with no markup containers', () => {
    expect(GP4_SPRITE).toContain('id="i-leaf"');
    expect(GP4_SPRITE).toContain('id="i-check"');
    expect(GP4_SPRITE).toContain('id="i-chev"');
    expect(GP4_SPRITE).not.toContain('<div');
    expect(GP4_SPRITE).not.toContain('<span');
    expect(gp4Shell('', 'home')).toContain(GP4_SPRITE);
  });
});
