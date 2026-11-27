import { describe, expect, it } from 'vitest';
import { badgeVariant, statusBadge } from './badge.js';

describe('statusBadge', () => {
  it('renders the component markup with the status hook and a text label', () => {
    const node = statusBadge('qualified', 'Qualified');
    expect(node.tagName).toBe('SPAN');
    expect(node.getAttribute('data-bn')).toBe('badge');
    expect(node.getAttribute('data-variant')).toBe('success');
    expect(node.getAttribute('data-bn-status')).toBe('qualified');
    expect(node.textContent).toBe('Qualified');
  });

  it('never interprets the label as markup', () => {
    const node = statusBadge('new', '<img src=x onerror=alert(1)>');
    expect(node.children).toHaveLength(0);
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('honours an explicit variant', () => {
    expect(statusBadge('x', 'X', 'warning').getAttribute('data-variant')).toBe(
      'warning',
    );
  });
});

describe('badgeVariant', () => {
  it('maps every domain status family and falls back to default', () => {
    expect(badgeVariant('won')).toBe('success');
    expect(badgeVariant('new')).toBe('primary');
    expect(badgeVariant('proposal_sent')).toBe('warning');
    expect(badgeVariant('lost')).toBe('error');
    expect(badgeVariant('draft')).toBe('default');
    expect(badgeVariant('something-else')).toBe('default');
  });

  it('maps CustomDomainStatus values', () => {
    expect(badgeVariant('none')).toBe('default');
    expect(badgeVariant('pending')).toBe('warning');
    expect(badgeVariant('verifying')).toBe('warning');
    expect(badgeVariant('active')).toBe('success');
    expect(badgeVariant('failed')).toBe('error');
  });
});
