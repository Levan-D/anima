/* What a headphone measurement and a target are, as they cross IPC. No numbers from anyone's measurement live in this repo. */

export const RIG_FAMILIES = ['iec711-pinna', 'iec711-coupler', 'bk5128', 'hms', 'kemar', 'ears', 'unknown'] as const;
export type RigFamily = (typeof RIG_FAMILIES)[number];

export const RIG_FAMILY_WORDS: Record<RigFamily, string> = {
  'iec711-pinna': 'GRAS 43AG or 45CA, or a 711 with a pinna (over-ear)',
  'iec711-coupler': 'GRAS RA0045 or 43AC, or a 711 (in-ear)',
  bk5128: 'B&K 5128 or 4620',
  hms: 'HEAD acoustics HMS II.3',
  kemar: 'GRAS KEMAR',
  ears: 'miniDSP EARS',
  unknown: 'Unknown rig',
};

/** What goes in brackets after a name when only the family is known. */
export const RIG_FAMILY_SHORT: Record<RigFamily, string> = {
  'iec711-pinna': 'GRAS or 711 with a pinna',
  'iec711-coupler': 'GRAS or 711 coupler',
  bk5128: 'B&K 5128',
  hms: 'HMS II.3',
  kemar: 'KEMAR',
  ears: 'EARS',
  unknown: 'unknown rig',
};

export type RigTag = {
  family: RigFamily;
  /** The exact rig where it's known. Only two equal details count as the same rig. */
  detail: string | null;
};

export type FrCurve = {
  hz: number[];
  db: number[];
};

export type HeadphoneOrigin = { kind: 'file' } | { kind: 'autoeq'; commit: string };

export const HEADPHONE_FORMS = ['in-ear', 'over-ear', 'earbud'] as const;
export type HeadphoneForm = (typeof HEADPHONE_FORMS)[number];

export type HeadphoneMeasurement = {
  id: number;
  headphone: string;
  /** Who measured it. */
  source: string;
  rig: RigTag;
  /** Null for what was stored before this was kept, or a file whose importer didn't say. */
  form: HeadphoneForm | null;
  origin: HeadphoneOrigin;
  /** False for a preset with no public measurement behind it. No response is ever read back out of a preset. */
  hasCurve: boolean;
  hasPreset: boolean;
  match: MatchSettings;
};

export type HeadphoneTarget = {
  id: number;
  name: string;
  source: string;
  rig: RigTag;
  /** Moved onto this rig by someone, such as AutoEq's own translated targets. Approximate however well the rig matches. */
  isTranslated: boolean;
  origin: HeadphoneOrigin;
};

export type HeadphoneOptions = {
  isOpen: boolean;
  showRaw: boolean;
  showDifference: boolean;
  /** Added to the target as a shelf. Levels stay what they are, only the line moves. */
  bassDb: number;
  showRange: boolean;
};

export const HEADPHONE_DEFAULT_OPTIONS: HeadphoneOptions = {
  isOpen: false,
  showRaw: false,
  showDifference: false,
  bassDb: 0,
  showRange: false,
};

export type HeadphoneState = {
  measurements: HeadphoneMeasurement[];
  targets: HeadphoneTarget[];
  measurementId: number | null;
  targetId: number | null;
  options: HeadphoneOptions;
  /** When AutoEq's curves were last fetched. Null means they never have been. */
  targetsFetchedAt: number | null;
};

/** How a fetch of AutoEq's curves went. Some can fail and leave the rest, and nothing that was kept is lost. */
export type AutoEqTargetsFetch = {
  state: HeadphoneState;
  added: number;
  updated: number;
  failed: number;
};

export const HEADPHONE_KINDS = ['measurement', 'target'] as const;
export type HeadphoneKind = (typeof HEADPHONE_KINDS)[number];

export const HEADPHONE_NAME_MAX = 120;

/** From Olive's clusters: 2 dB less, up to 4 to 6 dB more. */
export const TARGET_BASS_MIN_DB = -2;
export const TARGET_BASS_MAX_DB = 6;

/** AutoEq's cap on boost, DEFAULT_MAX_GAIN in its constants.py. Above the bass it's the cap at every setting. */
export const BOOST_CAP_DB = 6;

export const SEAL_FITS = ['open', 'sealed', 'varies'] as const;
export type SealFit = (typeof SEAL_FITS)[number];

export const CORRECT_UP_TO_HZ = [2000, 6000, 10_000] as const;
export type CorrectUpToHz = (typeof CORRECT_UP_TO_HZ)[number];

/** What the listener knows about their pair and a measurement can't say. Each is per headphone, and feeds Match to target. */
export type MatchSettings = {
  /** The most boost below about 100 Hz. */
  bassLimitDb: number;
  seal: SealFit;
  correctUpToHz: CorrectUpToHz;
};

export const MATCH_DEFAULTS: MatchSettings = { bassLimitDb: BOOST_CAP_DB, seal: 'open', correctUpToHz: 10_000 };
export const BASS_LIMIT_MIN_DB = 0;
export const BASS_LIMIT_MAX_DB = 12;

export type AutoEqEntry = {
  id: number;
  name: string;
  source: string;
  form: HeadphoneForm;
  rig: RigTag;
  /** Some sources have only their presets in AutoEq, since the measurements themselves aren't public. */
  isPresetOnly: boolean;
};

export type AutoEqSearch = {
  entries: AutoEqEntry[];
  /** How many matched, which may be more than came back. */
  total: number;
};

/** The commit measurements are fetched at, so the same click gets the same bytes. Curves follow AutoEq's latest. */
export const AUTOEQ_COMMIT = '7ae0f56d53074872b028649617a22bbb4232feb7';

type AutoEqTargetChoice = {
  rig: RigTag;
  isTranslated: boolean;
};

// Which rig each is defined on: docs/research/headphone-eq.md, and AutoEq's dbtools/create_webapp_data.py for what it calls compatible.
const KNOWN_AUTOEQ_TARGETS: readonly (AutoEqTargetChoice & { file: string })[] = [
  {
    file: 'Harman over-ear 2018',
    rig: { family: 'iec711-pinna', detail: 'GRAS 45CA with a custom pinna' },
    isTranslated: false,
  },
  { file: 'Harman in-ear 2019', rig: { family: 'iec711-coupler', detail: 'GRAS RA0045' }, isTranslated: false },
  { file: 'Rtings Harman over-ear 2018', rig: { family: 'hms', detail: 'HMS II.3' }, isTranslated: true },
  { file: 'Rtings Harman in-ear 2019', rig: { family: 'hms', detail: 'HMS II.3' }, isTranslated: true },
  { file: 'Innerfidelity Harman over-ear 2018', rig: { family: 'hms', detail: 'HMS II.3' }, isTranslated: true },
  { file: 'Innerfidelity Harman in-ear 2019', rig: { family: 'hms', detail: 'HMS II.3' }, isTranslated: true },
  { file: 'Headphone.com Legacy Harman over-ear 2018', rig: { family: 'hms', detail: 'HMS II.3' }, isTranslated: true },
  {
    file: 'crinacle EARS + 711 Harman over-ear 2018',
    rig: { family: 'ears', detail: 'EARS + 711' },
    isTranslated: true,
  },
  { file: 'Diffuse field 5128', rig: { family: 'bk5128', detail: 'Bruel & Kjaer 5128' }, isTranslated: false },
  {
    file: 'Diffuse field 5128 -1dB per octave',
    rig: { family: 'bk5128', detail: 'Bruel & Kjaer 5128' },
    isTranslated: false,
  },
  { file: 'LMG 5128 0.6', rig: { family: 'bk5128', detail: 'Bruel & Kjaer 5128' }, isTranslated: false },
  { file: 'Diffuse field GRAS KEMAR', rig: { family: 'kemar', detail: 'GRAS KEMAR' }, isTranslated: false },
];

// In AutoEq's targets folder, but conversions, a loudspeaker curve or a list rather than a headphone target.
const NOT_TARGETS = new Set([
  'zero',
  '711 5128 delta',
  'All Harman Targets',
  'Innerfidelity transformation 2016 to 2017',
  'Harman loudspeaker in-room flat 2013',
]);
const HMS_DATABASES = /^(Rtings|Innerfidelity|Headphone\.com Legacy|HMS II\.3) /;
const NO_BASS = / without bass$/;

/**
 * What rig a file in AutoEq's targets folder is on, going by its name, or null for what isn't a target. A curve the app
 * has never heard of comes back unknown rather than guessed: it can be picked, and isn't drawn against a measurement.
 */
export function autoEqTargetInfo(file: string): AutoEqTargetChoice | null {
  if (NOT_TARGETS.has(file)) return null;
  const name = file.replace(NO_BASS, '');
  const known = KNOWN_AUTOEQ_TARGETS.find((target) => target.file === name);
  if (known !== undefined) return { rig: known.rig, isTranslated: known.isTranslated };
  if (HMS_DATABASES.test(name)) {
    return { rig: { family: 'hms', detail: 'HMS II.3' }, isTranslated: /Harman|AutoEq/.test(name) };
  }
  if (name.startsWith('Harman over-ear') || name === 'oratory1990 optimum hifi over-ear') {
    return { rig: { family: 'iec711-pinna', detail: null }, isTranslated: false };
  }
  if (name.startsWith('Harman in-ear') || name === 'oratory1990 in-ear') {
    return { rig: { family: 'iec711-coupler', detail: null }, isTranslated: false };
  }
  return { rig: { family: 'unknown', detail: null }, isTranslated: false };
}

/** What goes in brackets after a name: the exact rig if it's known, or else what family it's in. */
export function rigWords({ family, detail }: RigTag): string {
  return detail ?? RIG_FAMILY_SHORT[family];
}
