import { describe, expect, it } from 'vitest';
import { isEditorialVisualPreview } from '../visualPreview';

describe('editorial visual preview switch', () => {
  it('keeps the approved layout unless specifically opted in', () => {
    expect(isEditorialVisualPreview('')).toBe(false);
    expect(isEditorialVisualPreview('?visual=original')).toBe(false);
    expect(isEditorialVisualPreview('?visual=editorialish')).toBe(false);
    expect(isEditorialVisualPreview('?visual=editorial')).toBe(true);
    expect(isEditorialVisualPreview('?foo=bar&visual=editorial')).toBe(true);
  });
});
