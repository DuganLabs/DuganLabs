import { describe, expect, it } from 'vitest';
import { field } from './field.js';

describe('field', () => {
  it('associates the label with the input via for/id', () => {
    const input = document.createElement('input');
    const wrapper = field('First name', input);
    const label = wrapper.querySelector('label');
    expect(label?.textContent).toBe('First name');
    expect(label?.getAttribute('for')).toBe(input.id);
    expect(input.id).not.toBe('');
  });

  it('uses an explicit id when given', () => {
    const input = document.createElement('input');
    field('Email', input, 'lead-email');
    expect(input.id).toBe('lead-email');
  });

  it('reuses the id an input already has', () => {
    const input = document.createElement('input');
    input.id = 'existing-id';
    const wrapper = field('Notes', input);
    expect(wrapper.querySelector('label')?.getAttribute('for')).toBe(
      'existing-id',
    );
  });

  it('assigns distinct ids across calls when none is given', () => {
    const a = field('A', document.createElement('input'));
    const b = field('B', document.createElement('input'));
    const idA = a.querySelector('input')?.id;
    const idB = b.querySelector('input')?.id;
    expect(idA).not.toBe(idB);
  });
});
