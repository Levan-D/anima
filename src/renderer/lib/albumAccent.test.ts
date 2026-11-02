import { beforeEach, describe, expect, it } from 'vitest';
import {
  accentFrom,
  contrast,
  HARMONY_TURNS,
  harmoniesFrom,
  hueOf,
  MIN_CONTRAST,
  startAlbumAccentSync,
  type HarmonyName,
} from '@/lib/albumAccent';
import { setPlayerState } from '@/lib/playerStore';
import { playerStateWith, resetRendererState, track } from '@/lib/testing';

/** Every surface accent text can sit on, from --bg up to --surface-active in globals.css. */
const SURFACES = ['#0a0a0a', '#141414', '#1a1a1a', '#242424', '#333333'];

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function expectReadable(input: string): void {
  const result = accentFrom(input);
  if (result === null) throw new Error(`No accent for ${input}`);
  expect(result.accent).toMatch(/^#[0-9a-f]{6}$/);
  for (const surface of SURFACES) {
    expect(contrast(result.accent, surface), `${input} gave ${result.accent} on ${surface}`).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    );
  }
  expect(contrast(result.accent, result.onAccent), `${input} gave ${result.accent}`).toBeGreaterThanOrEqual(
    MIN_CONTRAST,
  );
}

describe('accentFrom', () => {
  it.each(['#000000', '#0a0a0a', '#101040', '#3a0000', '#0b132b', '#001a00', '#1c1c3a'])(
    'lifts a dark color until it reads: %s',
    expectReadable,
  );

  it.each(['#ffffff', '#f5f5f5', '#f2d7ee', '#fffde7', '#d9ed92', '#caf0f8'])(
    'keeps a light color readable, with dark text on it: %s',
    (input) => {
      expectReadable(input);
      expect(accentFrom(input)?.onAccent).toBe('#0a0a0a');
    },
  );

  it.each(['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#3a0ca3', '#f72585'])(
    'holds a saturated color inside what the screen can show: %s',
    expectReadable,
  );

  it.each(['#808080', '#333333', '#666666', '#b0b0b0', '#2b2b2b'])(
    'leaves a gray a gray, with no color of its own: %s',
    (input) => {
      expectReadable(input);
      const [red, green, blue] = channels(accentFrom(input)?.accent ?? '#000000');
      expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThanOrEqual(1);
    },
  );

  it('reads against every surface for colors from all over the cube', () => {
    for (let red = 0; red <= 255; red += 17) {
      for (let green = 0; green <= 255; green += 17) {
        for (let blue = 0; blue <= 255; blue += 17) {
          const hex = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
          const result = accentFrom(hex);
          if (result === null) throw new Error(`No accent for ${hex}`);
          // The lightest surface is the hardest one, and the rest follow from it.
          if (contrast(result.accent, '#333333') < MIN_CONTRAST) expect.fail(`${hex} gave ${result.accent}`);
          if (contrast(result.accent, result.onAccent) < MIN_CONTRAST) expect.fail(`${hex} on ${result.onAccent}`);
        }
      }
    }
  });

  it('keeps the hue, so a red album stays red and a blue one blue', () => {
    const [red, green, blue] = channels(accentFrom('#7a1010')?.accent ?? '#000000');
    expect(red).toBeGreaterThan(green);
    expect(red).toBeGreaterThan(blue);

    const [r2, g2, b2] = channels(accentFrom('#10307a')?.accent ?? '#000000');
    expect(b2).toBeGreaterThan(r2);
    expect(b2).toBeGreaterThan(g2);
  });

  it('gives a washed-out average some color back, so it looks like the album and not like gray', () => {
    const [red, green, blue] = channels(accentFrom('#6b5a4d')?.accent ?? '#000000');
    expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeGreaterThan(30);
  });

  it('does not make it glare: even a white sleeve stops short of white', () => {
    const [red] = channels(accentFrom('#ffffff')?.accent ?? '#ffffff');
    expect(red).toBeLessThan(255);
  });

  it('with no color there is no accent of its own, and the neutral one in the tokens stands', () => {
    expect(accentFrom(null)).toBeNull();
  });

  it.each(['', 'red', '#fff', '#12345', '#1234567', 'rgb(1,2,3)', '#gggggg'])(
    'treats %j as no color, since it came from a database and not from here',
    (input) => {
      expect(accentFrom(input)).toBeNull();
    },
  );

  it('accepts capitals', () => {
    expect(accentFrom('#7A1010')).toEqual(accentFrom('#7a1010'));
  });
});

describe('contrast', () => {
  it('is the WCAG ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('does not care which way round they are', () => {
    expect(contrast('#123456', '#fedcba')).toBe(contrast('#fedcba', '#123456'));
  });
});

describe('harmonies', () => {
  const ART = ['#7a1010', '#10307a', '#2e7a10', '#c9a227', '#7a107a'];
  const turnBetween = (one: string, other: string) => {
    const turn = Math.abs(hueOf(one) - hueOf(other)) % 360;
    return Math.min(turn, 360 - turn);
  };

  it.each(ART)('turns %s by the right angle on the wheel', (art) => {
    const accent = accentFrom(art)?.accent ?? '';
    const harmonies = harmoniesFrom(art);
    for (const [name, turn] of Object.entries(HARMONY_TURNS)) {
      const expected = Math.min(turn, 360 - turn);
      expect(Math.abs(turnBetween(accent, harmonies[name as HarmonyName]) - expected)).toBeLessThan(6);
    }
  });

  it.each(ART)('keeps every one of %s readable', (art) => {
    const harmonies = harmoniesFrom(art);
    for (const name of Object.keys(HARMONY_TURNS) as HarmonyName[]) {
      expect(contrast(harmonies[name], '#333333')).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    expect(contrast(harmonies.complement, harmonies.onComplement)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('still has color for gray art and for no art', () => {
    for (const art of ['#808080', null]) {
      const { complement } = harmoniesFrom(art);
      expect(complement).not.toBe('');
      expect(complement).toBe(harmoniesFrom(null).complement);
      expect(Math.abs(((hueOf(complement) + 360) % 360) - 260)).toBeLessThan(6);
    }
  });

  it('writes them on the root, with or without a color', () => {
    document.documentElement.style.removeProperty('--accent-complement');
    resetRendererState();
    startAlbumAccentSync();
    expect(document.documentElement.style.getPropertyValue('--accent-complement')).toBe(harmoniesFrom(null).complement);
  });
});

describe('following the album', () => {
  const { style } = document.documentElement;
  const playingWith = (artColor: string | null) => playerStateWith({ current: track({ artColor }), status: 'playing' });

  beforeEach(() => {
    resetRendererState();
    style.removeProperty('--accent');
    style.removeProperty('--on-accent');
  });

  it('writes both variables on the root when a color turns up', () => {
    startAlbumAccentSync();
    expect(style.getPropertyValue('--accent')).toBe('');

    setPlayerState(playingWith('#7a1010'));

    expect(style.getPropertyValue('--accent')).toBe(accentFrom('#7a1010')?.accent);
    expect(style.getPropertyValue('--on-accent')).toBe(accentFrom('#7a1010')?.onAccent);
  });

  it('takes them off again for a track with no color, or nothing at all', () => {
    startAlbumAccentSync();
    setPlayerState(playingWith('#7a1010'));
    setPlayerState(playingWith(null));
    expect(style.getPropertyValue('--accent')).toBe('');

    setPlayerState(playingWith('#7a1010'));
    setPlayerState(playerStateWith());
    expect(style.getPropertyValue('--on-accent')).toBe('');
  });

  it('starts from a track that was already playing when the page loaded', () => {
    setPlayerState(playingWith('#10307a'));
    startAlbumAccentSync();
    expect(style.getPropertyValue('--accent')).toBe(accentFrom('#10307a')?.accent);
  });
});
