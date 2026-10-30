import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/cn';

describe('cn', () => {
  it('lets a caller override a class of the same kind', () => {
    expect(cn('px-3', 'px-5')).toBe('px-5');
  });

  it('keeps a font size and a color from the token system apart', () => {
    expect(cn('text-body text-text-muted')).toBe('text-body text-text-muted');
  });

  it('knows that two font sizes conflict', () => {
    expect(cn('text-body', 'text-meta')).toBe('text-meta');
  });

  it('knows that the semantic spacing steps are spacing', () => {
    expect(cn('h-4', 'h-row')).toBe('h-row');
    expect(cn('min-h-tap', 'min-h-8')).toBe('min-h-8');
  });

  it('drops falsy values', () => {
    expect(cn('flex', false, null, undefined, 'gap-2')).toBe('flex gap-2');
  });
});
