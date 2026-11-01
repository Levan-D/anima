/*
 * What's where on the frequency axis. Facts, in Hz, after the Independent Recording Network's interactive chart (2006).
 * That chart is images, so nothing here could be read as data. The zones and instrument fundamentals are read from its
 * hover panels. The rest is measured off the pixels of its main image, at x = 176 + 190 · log10(hz / 100), which lands on
 * the panels' numbers within a few percent: harmonic ends the panels don't state, vocal and percussion spans, the words.
 * Where a panel and a bar disagree, as on the flute's top end, the panel wins. All the wording is ours.
 */

export type HzRange = readonly [lowHz: number, highHz: number];

export const HZ_LINES = [20, 40, 60, 100, 200, 400, 600, 1000, 2000, 4000, 6000, 10_000, 16_000, 20_000] as const;
/** Drawn stronger, as the decades that let the eye find its place. */
export const MAJOR_HZ_LINES: readonly number[] = [100, 1000, 10_000];

export type ChartNote = {
  name: string;
  range: HzRange;
  note: string;
};

// The chart starts its sub bass at 16 Hz, below where the plot does.
export const ZONES: readonly ChartNote[] = [
  {
    name: 'Sub bass',
    range: [20, 60],
    note: 'Felt in the chest as much as heard. A boost adds weight, but too much blurs everything above it',
  },
  {
    name: 'Bass',
    range: [60, 250],
    note: 'Where the groove lives. Boost for a thicker sound, cut to slim it down. Overdone, it booms',
  },
  {
    name: 'Midrange',
    range: [250, 2000],
    note: 'The first harmonics of nearly everything. Too much reads as honky low down, tinny higher up',
  },
  {
    name: 'High mids',
    range: [2000, 6000],
    note: 'Attack, words and clarity. A boost pushes a part forward. Too much is tiring, a cut tames esses',
  },
  {
    name: 'High freqs',
    range: [6000, 20_000],
    note: 'Sparkle. Too little sounds dull, too much turns sharp or brittle. Right at the top you notice it rather than hear it',
  },
];

export type SoundWord = ChartNote & {
  /** Which row of words it sits on, counted up from the bottom, so that neighbours don't overlap. */
  lane: 0 | 1 | 2;
};

export const SOUND_WORDS: readonly SoundWord[] = [
  {
    name: 'Chest/Thump',
    range: [20, 36],
    lane: 0,
    note: 'The push you feel from a big speaker. Boost for impact, cut if the speakers can only strain at it',
  },
  {
    name: 'Rumble',
    range: [26, 39],
    lane: 1,
    note: 'Low noise from traffic, stands and old records. Usually better cut than boosted',
  },
  {
    name: 'AC/Ground',
    range: [49, 67],
    lane: 0,
    note: 'Where mains hum sits, at 50 or 60 Hz. A narrow cut removes it',
  },
  {
    name: 'Bottom',
    range: [62, 91],
    lane: 1,
    note: 'The floor under a mix. Boost for heft, cut if the low end feels bloated',
  },
  {
    name: 'Boom/Punch',
    range: [99, 173],
    lane: 0,
    note: 'The hit of a kick and a bass note. Boost for punch, cut when it starts to boom',
  },
  {
    name: 'Warmth',
    range: [137, 234],
    lane: 1,
    note: 'Body and comfort. A boost makes things round, a cut makes them lean and cool',
  },
  {
    name: 'Fullness/Mud',
    range: [239, 428],
    lane: 0,
    note: 'Thickness that clouds fast when many parts pile up. Cutting here is the usual way to clear a mix',
  },
  {
    name: 'Honk',
    range: [495, 844],
    lane: 0,
    note: 'A nasal, megaphone quality. Boost to poke through small speakers, cut if voices sound boxed in',
  },
  {
    name: 'Whack',
    range: [886, 1510],
    lane: 0,
    note: 'The slap of a snare and the bite of a bass. Boost for attack, cut if it sounds hard',
  },
  {
    name: 'Tinny',
    range: [1115, 1901],
    lane: 1,
    note: 'A small, phone-speaker sound. Too much of this gets thin and cheap, so it is more often cut',
  },
  {
    name: 'Crunch',
    range: [2308, 3442],
    lane: 0,
    note: 'Grit in guitars and consonants. Boost for aggression, cut when it starts to grate',
  },
  {
    name: 'Treble',
    range: [2280, 18_780],
    lane: 2,
    note: 'Everything from the top of the mids upward. What a tone knob turns as a whole',
  },
  {
    name: 'Edge',
    range: [3747, 5197],
    lane: 1,
    note: 'What lets a sound cut through. Boost for presence, cut if it gets harsh',
  },
  {
    name: 'Sibilance',
    range: [4281, 8967],
    lane: 0,
    note: 'The hiss in s and sh. Cut narrowly when esses spit, boost only with care',
  },
  {
    name: 'Definition',
    range: [6623, 9527],
    lane: 1,
    note: 'Small detail and separation. Boost for clarity, cut if it feels too etched',
  },
  {
    name: 'Pierce',
    range: [9076, 11_565],
    lane: 0,
    note: 'Hard shine from cymbals and bright recordings. A cut here takes the sting off',
  },
  {
    name: 'Air',
    range: [15_099, 20_000],
    lane: 0,
    note: 'Openness more than a pitch. A gentle high shelf adds space, a cut makes things closer',
  },
];

function narrowest(hz: number, notes: readonly ChartNote[]): ChartNote | null {
  let found: ChartNote | null = null;
  for (const note of notes) {
    const [low, high] = note.range;
    if (hz < low || hz > high) continue;
    if (found === null || high / low < found.range[1] / found.range[0]) found = note;
  }
  return found;
}

/** A band's frequency in one word: the tightest word around it, or the zone it's in if no word reaches that far. */
export function wordAtHz(hz: number): string {
  const note = narrowest(hz, SOUND_WORDS) ?? narrowest(hz, ZONES);
  return note === null ? '' : (note.name.split('/')[0] ?? note.name);
}

export type Instrument = {
  name: string;
  fundamentals: HzRange;
  /** Null where the chart draws only one span. */
  harmonics: HzRange | null;
  /** Breath, overblowing, or notes below the usual range: what the chart draws apart from the rest. */
  fringe: readonly HzRange[];
  note: string;
};

/** Everything it reaches, for the band it lights up on the curve. */
export function instrumentSpan({ fundamentals, harmonics, fringe }: Instrument): HzRange {
  const all = [fundamentals, ...(harmonics === null ? [] : [harmonics]), ...fringe];
  return [Math.min(...all.map(([low]) => low)), Math.max(...all.map(([, high]) => high))];
}

export type InstrumentFamily = {
  name: string;
  instruments: readonly Instrument[];
};

export const INSTRUMENT_FAMILIES: readonly InstrumentFamily[] = [
  {
    name: 'Voice',
    instruments: [
      {
        name: 'Male vocal',
        fundamentals: [101, 919],
        harmonics: [919, 8439],
        fringe: [[8439, 16_000]],
        note: 'Body near 120 Hz, boxy near 240, intelligibility 2–4 kHz, esses 4–9 kHz, air 10–16 kHz',
      },
      {
        name: 'Female vocal',
        fundamentals: [245, 1075],
        harmonics: [1075, 8439],
        fringe: [[8439, 16_000]],
        note: 'Body near 240 Hz, intelligibility 2–4 kHz, esses 4–9 kHz, air 10–16 kHz',
      },
    ],
  },
  {
    name: 'Percussion',
    instruments: [
      {
        name: 'Kick',
        fundamentals: [51, 501],
        harmonics: [501, 8138],
        fringe: [],
        note: 'Weight 50–100 Hz, body 100–250, hollow near 400, click 3–5 kHz. Below 800 Hz it can muddy',
      },
      {
        name: 'Tympani',
        fundamentals: [62, 687],
        harmonics: [687, 3087],
        fringe: [],
        note: 'Pitch 125–150 Hz, main modes 145–360 Hz, stick attack near 3 kHz',
      },
      {
        name: 'Toms',
        fundamentals: [71, 507],
        harmonics: [507, 7476],
        fringe: [],
        note: 'Floor: body 80–120 Hz, attack near 5 kHz. Rack: body 240–400 Hz, attack 5–7 kHz',
      },
      {
        name: 'Snare',
        fundamentals: [102, 254],
        harmonics: [254, 10_245],
        fringe: [],
        note: 'Body 120–240 Hz, ring near 900 Hz, crack 2.5–5 kHz, snap near 10 kHz',
      },
      {
        name: 'Congas',
        fundamentals: [151, 1000],
        harmonics: [1000, 5325],
        fringe: [],
        note: 'Ring 200–240 Hz, slap 4–5 kHz',
      },
      {
        name: 'Cymbals',
        fundamentals: [312, 930],
        harmonics: [930, 15_658],
        fringe: [[181, 312]],
        note: 'Clang near 200 Hz, presence near 3 kHz, shimmer 7.5–12 kHz. Hi-hat too',
      },
    ],
  },
  {
    name: 'Brass',
    instruments: [
      {
        name: 'Tuba',
        fundamentals: [45, 375],
        harmonics: [375, 2000],
        fringe: [[29, 45]],
        note: 'Reaches down to B0, 29 Hz. Overtones stop around 1.5–2 kHz',
      },
      {
        name: 'French horn',
        fundamentals: [55, 700],
        harmonics: [700, 5261],
        fringe: [],
        note: 'B1 to G5. Resonances near 340 Hz and from 750 Hz to 3.5 kHz',
      },
      {
        name: 'Bass trombone',
        fundamentals: [58, 400],
        harmonics: [400, 4000],
        fringe: [[4000, 8000]],
        note: 'B♭1 to G4. Overtones to 4 kHz, overblown to 8 kHz',
      },
      {
        name: 'Tenor trombone',
        fundamentals: [82, 520],
        harmonics: [520, 5000],
        fringe: [[5000, 10_000]],
        note: 'E2 to C5. Overtones to 5 kHz, overblown to 10 kHz',
      },
      {
        name: 'Trumpet',
        fundamentals: [165, 1200],
        harmonics: [1200, 9412],
        fringe: [],
        note: 'E3 to D6. Resonances 1–1.5 and 2–3 kHz, cuts hard near 5 kHz',
      },
    ],
  },
  {
    name: 'Woodwinds',
    instruments: [
      {
        name: 'Contrabassoon',
        fundamentals: [29, 200],
        harmonics: [200, 4000],
        fringe: [],
        note: 'B♭0 to G3. Overtones to 4 kHz',
      },
      {
        name: 'Bassoon',
        fundamentals: [55, 575],
        harmonics: [575, 9000],
        fringe: [],
        note: 'B♭1 to E5. Overtones to 9 kHz',
      },
      {
        name: 'Tenor sax',
        fundamentals: [120, 725],
        harmonics: [725, 8000],
        fringe: [[8000, 13_000]],
        note: 'B2 to F5. Overtones to 8 kHz, breath to 13 kHz',
      },
      {
        name: 'Alto sax',
        fundamentals: [139, 785],
        harmonics: [785, 8000],
        fringe: [[8000, 13_000]],
        note: 'C♯3 to G5. Overtones to 8 kHz, breath to 13 kHz',
      },
      {
        name: 'Clarinet',
        fundamentals: [139, 1600],
        harmonics: [1600, 12_000],
        fringe: [],
        note: 'C♯3 to G6. Overtones to 1.5 kHz played softly, 12 kHz played loud',
      },
      {
        name: 'Oboe',
        fundamentals: [250, 1500],
        harmonics: [1500, 12_000],
        fringe: [],
        note: 'B♭3 to G6. Overtones to 12 kHz',
      },
      {
        name: 'Flute',
        fundamentals: [247, 2100],
        harmonics: [2100, 6000],
        fringe: [[6000, 8000]],
        note: 'B3 to C7. Overtones to 3–6 kHz, overblown to 8 kHz',
      },
      {
        name: 'Piccolo',
        fundamentals: [630, 4000],
        harmonics: [4000, 16_000],
        fringe: [],
        note: 'E5 to B7. Overtones to 16 kHz',
      },
    ],
  },
  {
    name: 'Strings',
    instruments: [
      {
        name: 'Bass',
        fundamentals: [41, 343],
        harmonics: [343, 5261],
        fringe: [[30, 41]],
        note: 'E1 to F4. Weight 50–80 Hz, pick 700 Hz–1 kHz, string noise near 2.5 kHz, slap harmonics to 4 kHz',
      },
      {
        name: 'Cello',
        fundamentals: [56, 520],
        harmonics: [520, 8000],
        fringe: [],
        note: 'C2 to C5. Body near 240 Hz, overtones below 8 kHz',
      },
      {
        name: 'Viola',
        fundamentals: [125, 1000],
        harmonics: [1000, 6300],
        fringe: [],
        note: 'C3 to C6, a fifth under the violin. Body 220–240 Hz, scratch 7–10 kHz',
      },
      {
        name: 'Violin',
        fundamentals: [200, 1300],
        harmonics: [1300, 16_000],
        fringe: [],
        note: 'G3 to E6. Body near 240 Hz, resonances at 300 Hz, 1 and 1.2 kHz, scratch 7–10 kHz',
      },
      {
        name: 'Guitar',
        fundamentals: [82, 1200],
        harmonics: [1200, 5197],
        fringe: [],
        note: 'E2 to D6. Acoustic: fullness near 80, body near 240, soundhole 80–100 Hz. Electric: 240–500 Hz. Presence 2–5 kHz',
      },
      {
        name: 'Harp',
        fundamentals: [29, 3100],
        harmonics: [3100, 6000],
        fringe: [],
        note: 'B♭0 to G7. Overtones to 4–6 kHz',
      },
    ],
  },
  {
    name: 'Keys',
    instruments: [
      {
        name: 'Pipe organ',
        fundamentals: [20, 7100],
        harmonics: null,
        fringe: [],
        note: 'E0 to A8. Fullness near 80 Hz, body near 240, presence 2–5 kHz',
      },
      {
        name: 'Piano',
        fundamentals: [27, 4200],
        harmonics: null,
        fringe: [],
        note: 'A0 to C8. Fullness 80–120 Hz, resonance 40–60 Hz, honky-tonk near 2.5 kHz, presence 2–5 kHz',
      },
    ],
  },
];

export const CHART_CREDIT = "Ranges after IRN's chart";
