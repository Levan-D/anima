/* Mood stations as main and the windows both see them. The method is in main/recommend/stations.ts. */

import type { Track } from './domain';

export const EXAMPLE_KINDS = ['track', 'album', 'artist', 'genre'] as const;
export type ExampleKind = (typeof EXAMPLE_KINDS)[number];

/** Given in the search, in a check round, or while listening. */
export const EXAMPLE_SOURCES = ['picked', 'check', 'listening'] as const;
export type ExampleSource = (typeof EXAMPLE_SOURCES)[number];

/** What a station is defined by. `key` is a name key from main, so it outlasts a rescan; `label` is what to show. */
export type MoodExample = {
  kind: ExampleKind;
  key: string;
  label: string;
  isYes: boolean;
  source: ExampleSource;
};

export type MoodRules = { instrumental: boolean; calm: boolean; littleSinging: boolean };
export type MoodRule = keyof MoodRules;

export type MoodDraft = {
  name: string;
  /** In the order given, which settles a song two examples name. */
  examples: MoodExample[];
  rules: MoodRules;
  /** A main genre or decade it keeps to. */
  genre: string | null;
  decade: number | null;
};

export const MOOD_NAME_MAX = 60;
export const MOOD_EXAMPLES_MAX = 500;
/** Songs a check round asks about. */
export const MOOD_CHECK_SIZE = 12;
/** A station that plays fewer than this repeats itself soon, which is worth a warning before a filter brings it there. */
export const MOOD_FEW_SONGS = 100;

/**
 * Each album, artist and genre example hidden in turn: where its songs land among the rest, 100 at the top, and whether
 * that's where they belong. `alike` pairs a yes and a no example that sound too alike to tell apart.
 */
export type MoodGrade = {
  kind: 'too-few' | 'clear' | 'fuzzy' | 'alike';
  /** By index into the examples. */
  examples: { index: number; median: number; isRight: boolean }[];
  alike: { yes: number; no: number }[];
};

/** Whether a rule can do anything: the voice and energy models have to be there, and lyrics for some songs. */
export type MoodRuleState = 'ready' | 'unavailable';

/** A song to say yes or no to, with the key it goes by as a track example. */
export type MoodCheck = { track: Track; key: string; label: string };

/** What a draft would play, worked out without saving it. */
export type MoodTry =
  | { problem: 'no-yes' | 'no-fingerprints' }
  | {
      problem: null;
      /** Songs it plays, on this device, with the filters. */
      songs: number;
      /** The songs it's least sure about, to say yes or no to. */
      check: MoodCheck[];
      rules: Record<MoodRule, MoodRuleState>;
      /** Songs it plays in each main genre, with the decade filter but not the genre one; most first. */
      genres: { name: string; songs: number }[];
      /** And in each decade, with the genre filter but not the decade one; oldest first. */
      decades: { decade: number; songs: number }[];
      /** Known when these examples have been graded. */
      grade: MoodGrade | null;
    };

export type MoodCard = {
  id: number;
  name: string;
  /** Covers of its yes examples. */
  covers: string[];
  /** Null until it has been worked out. */
  songs: number | null;
};

export type MoodStation = MoodDraft & { id: number; grade: MoodGrade | null };

/** One kind of thing the search found, ready to add as an example. */
export type MoodFind = {
  kind: ExampleKind;
  key: string;
  label: string;
  /** Who a song or album is by. */
  by: string | null;
  /** How many songs an artist or genre has. */
  songs: number | null;
  artHash: string | null;
};
