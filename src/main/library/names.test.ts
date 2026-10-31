import { describe, expect, it } from 'vitest';
import { artistKey, normalizeName, titleKey } from './names';

describe('names', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeName('Björk')).toBe('bjork');
    expect(normalizeName('AC/DC')).toBe('ac dc');
    expect(normalizeName('Simon & Garfunkel')).toBe('simon and garfunkel');
  });

  it('keeps a name that is all punctuation', () => {
    expect(normalizeName(' !!! ')).toBe('!!!');
  });

  it('treats an artist with or without The and featured guests as one', () => {
    expect(artistKey('The Beatles')).toBe(artistKey('Beatles'));
    expect(artistKey('Beatles feat. Billy Preston')).toBe('beatles');
    expect(artistKey('The The')).toBe('the');
  });

  it('leaves names that only look like a guest credit', () => {
    expect(artistKey('Ft. Lauderdale')).toBe('ft lauderdale');
  });

  it('reads a title without what versions add to it', () => {
    expect(titleKey('Song (Remastered 2011)')).toBe('song');
    expect(titleKey('Song - 2011 Remaster')).toBe('song');
    expect(titleKey('Song feat. Someone')).toBe('song');
  });
});
