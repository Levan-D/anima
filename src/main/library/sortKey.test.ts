import { describe, expect, it } from 'vitest';
import { searchText, sortKey } from '@main/library/sortKey';

describe('sortKey', () => {
  it('lowercases', () => {
    expect(sortKey('Nightwish')).toBe('nightwish');
  });

  it('removes diacritics', () => {
    expect(sortKey('Björk')).toBe('bjork');
    expect(sortKey('Sigur Rós')).toBe('sigur ros');
    expect(sortKey('Mötley Crüe')).toBe('motley crue');
  });

  it('flattens letters that have no decomposed form', () => {
    expect(sortKey('Mø')).toBe('mo');
    expect(sortKey('Straße')).toBe('strasse');
    expect(sortKey('Æther')).toBe('aether');
  });

  it('moves a leading "the " to the end', () => {
    expect(sortKey('The Beatles')).toBe('beatles, the');
    expect(sortKey('the xx')).toBe('xx, the');
    expect(sortKey('THE DOORS')).toBe('doors, the');
  });

  it('leaves "the" alone anywhere else', () => {
    expect(sortKey('Theory of a Deadman')).toBe('theory of a deadman');
    expect(sortKey('Florence + The Machine')).toBe('florence + the machine');
    expect(sortKey('The')).toBe('the');
  });

  it('trims', () => {
    expect(sortKey('  Spaced  ')).toBe('spaced');
  });
});

describe('searchText', () => {
  it('leaves alone what the tokenizer handles by itself', () => {
    expect(searchText('Nightwish')).toBe('Nightwish');
    expect(searchText('Björk')).toBe('Björk');
    expect(searchText('Human II Nature')).toBe('Human II Nature');
  });

  it('adds how punctuated names get typed', () => {
    expect(searchText('AC/DC')).toBe('AC/DC acdc');
    expect(searchText('R.E.M.')).toBe('R.E.M. rem');
    expect(searchText('B.o.B')).toBe('B.o.B bob');
    expect(searchText("Don't Stop")).toBe("Don't Stop dont stop");
  });

  it('adds letters the tokenizer does not flatten', () => {
    expect(searchText('Chløë Black')).toBe('Chløë Black chloe black');
    expect(searchText('MØ')).toBe('MØ mo');
    expect(searchText('Straße')).toBe('Straße strasse');
  });

  it('copes with nothing', () => {
    expect(searchText('')).toBe('');
  });
});
