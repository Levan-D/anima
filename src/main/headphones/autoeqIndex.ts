/*
 * AutoEq's own index, read at a pinned commit. A line of results/INDEX.md links to results/<source>/<rig and form>/<name>, and
 * nothing else is believed from it. The rig names come from AutoEq's dbtools, as the comments say. Pure.
 */

import {
  AUTOEQ_COMMIT,
  HEADPHONE_FORMS,
  type AutoEqEntry,
  type AutoEqSearch,
  type HeadphoneForm,
  type RigFamily,
  type RigTag,
} from '@shared/headphone';
import { ONLINE_SERVICES } from '@shared/onlineServices';

const AUTOEQ = ONLINE_SERVICES.autoeq.defaultAddress;

function urlAt(base: string, commit: string, path: string): string {
  return `${base}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function autoeqIndexUrl(base: string = AUTOEQ): string {
  return urlAt(base, AUTOEQ_COMMIT, 'results/INDEX.md');
}

type Form = HeadphoneForm;

// dbtools/squig_crawler.py, `_squig_rigs`, for the sources that have one rig per form and so don't say it in the index.
const SQUIG_RIGS: Record<string, Partial<Record<Form, string>>> = {
  'Auriculares Argentina': { 'in-ear': '711', 'over-ear': 'KB501x + 711' },
  Bakkwatan: { 'in-ear': '711' },
  DHRME: { 'in-ear': '711' },
  Fahryst: { 'in-ear': '711' },
  Filk: { 'in-ear': '711', 'over-ear': 'KB006x + 711' },
  freeryder05: { 'in-ear': '711' },
  Harpo: { 'in-ear': '711' },
  'Hi End Portable': { 'in-ear': '711' },
  Jaytiss: { 'in-ear': '711' },
  Kazi: { 'in-ear': '711' },
  kr0mka: { 'in-ear': '711', 'over-ear': 'KB501x + 711' },
  Kuulokenurkka: { 'in-ear': '711', 'over-ear': 'KB501x + 711' },
  'Regan Cipher': { 'in-ear': '711', 'over-ear': 'KB500x + 711' },
  RikudouGoku: { 'in-ear': '711' },
  'Super Review': { 'in-ear': '711', 'over-ear': 'KB006x + 711' },
  "Ted's Squig Hoard": { 'in-ear': '711', 'over-ear': 'KB500x + 711' },
  ToneDeafMonk: { 'in-ear': '711' },
};

// The rest of those whose folder doesn't name a rig: oratory1990_crawler.py, innerfidelity_crawler.py, headphonecom_crawler.py,
// and update_result_indexes.py's "over-ear  # Bruel & Kjaer 5128" for HypetheSonics. Its earbuds go with that, by the targets it
// calls compatible in create_webapp_data.py.
const OTHER_RIGS: Record<string, Partial<Record<Form, string>>> = {
  oratory1990: { 'in-ear': 'GRAS 43AC', 'over-ear': 'GRAS 43AG' },
  Innerfidelity: { 'in-ear': 'HMS II.3', 'over-ear': 'HMS II.3', earbud: 'HMS II.3' },
  'Headphone.com Legacy': { 'in-ear': 'HMS II.3', 'over-ear': 'HMS II.3', earbud: 'HMS II.3' },
  HypetheSonics: { 'over-ear': 'Bruel & Kjaer 5128', earbud: 'Bruel & Kjaer 5128' },
};

function familyOf(rig: string): RigFamily {
  if (rig === 'Bruel & Kjaer 5128' || rig === 'Bruel & Kjaer 4620') return 'bk5128';
  if (rig === 'HMS II.3') return 'hms';
  if (rig.startsWith('EARS')) return 'ears';
  if (rig === '711' || rig === 'GRAS RA0045' || rig === 'GRAS 43AC') return 'iec711-coupler';
  if (rig.startsWith('GRAS 43AG') || rig.startsWith('KB')) return 'iec711-pinna';
  return 'unknown';
}

/** What it was measured on, by the folder's word if it has one and then by the source's. Unknown when neither says. */
export function rigOf(source: string, form: Form, folderRig: string | null): RigTag {
  const rig = folderRig ?? SQUIG_RIGS[source]?.[form] ?? OTHER_RIGS[source]?.[form] ?? null;
  if (rig === null) return { family: 'unknown', detail: null };
  const family = familyOf(rig);
  return { family, detail: family === 'unknown' ? null : rig };
}

// measurements/crinacle holds only a name index: his measurements aren't public, so AutoEq has just the presets made from them.
const PRESET_ONLY_SOURCES = new Set(['crinacle']);

export type AutoEqIndexEntry = AutoEqEntry & {
  /** Where it is in the results and measurements folders. */
  resultsPath: string;
  measurementPath: string;
};

const LINE = /^- \[.*\]\(\.\/(.+)\) by .+$/;

function isPlainSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !/[\\/]/.test(segment);
}

function segmentsOf(encoded: string): string[] | null {
  try {
    return encoded.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function formOf(folder: string): { form: Form; rig: string | null } | null {
  for (const form of HEADPHONE_FORMS) {
    if (folder === form) return { form, rig: null };
    if (folder.endsWith(` ${form}`)) return { form, rig: folder.slice(0, -form.length - 1) };
  }
  return null;
}

/** Every line it can make out, in order. Anything else, such as its heading, isn't an entry. */
export function parseAutoEqIndex(text: string): AutoEqIndexEntry[] {
  const entries: AutoEqIndexEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const link = LINE.exec(line.trim())?.[1];
    if (link === undefined) continue;
    const segments = segmentsOf(link);
    if (segments?.length !== 3 || !segments.every(isPlainSegment)) continue;
    const [source = '', folder = '', name = ''] = segments;
    const place = formOf(folder);
    if (place === null) continue;
    entries.push({
      id: entries.length + 1,
      name,
      source,
      form: place.form,
      rig: rigOf(source, place.form, place.rig),
      isPresetOnly: PRESET_ONLY_SOURCES.has(source),
      resultsPath: `results/${source}/${folder}/${name}`,
      measurementPath:
        place.rig === null
          ? `measurements/${source}/data/${place.form}/${name}.csv`
          : `measurements/${source}/data/${place.form}/${place.rig}/${name}.csv`,
    });
  }
  return entries;
}

const SEARCH_LIMIT = 60;

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

/** Every word of the search, in any order, in the name or the source. */
export function searchAutoEq(entries: readonly AutoEqIndexEntry[], query: string): AutoEqSearch {
  const wanted = words(query);
  if (wanted.length === 0) return { entries: [], total: 0 };
  const matches = entries.filter(({ name, source }) => {
    const haystack = `${name} ${source}`.toLowerCase();
    return wanted.every((word) => haystack.includes(word));
  });
  return {
    total: matches.length,
    entries: matches.slice(0, SEARCH_LIMIT).map(({ id, name, source, form, rig, isPresetOnly }) => ({
      id,
      name,
      source,
      form,
      rig,
      isPresetOnly,
    })),
  };
}

function urlOf(path: string, base: string): string {
  return urlAt(base, AUTOEQ_COMMIT, path);
}

/** The repo holds both Rtings/ and rtings/, with some of the index's Rtings entries only in the second. */
export function measurementUrls({ measurementPath, source }: AutoEqIndexEntry, base: string = AUTOEQ): string[] {
  const urls = [urlOf(measurementPath, base)];
  if (source === 'Rtings') {
    urls.push(urlOf(measurementPath.replace('measurements/Rtings/', 'measurements/rtings/'), base));
  }
  return urls;
}

export function presetUrl({ resultsPath, name }: AutoEqIndexEntry, base: string = AUTOEQ): string {
  return urlOf(`${resultsPath}/${name} ParametricEQ.txt`, base);
}

/** GitHub's API for the same repository, which only a copy on GitHub has. */
export function autoeqApiOf(base: string = AUTOEQ): string | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  const [owner, repository, ...rest] = url.pathname.split('/').filter((part) => part !== '');
  if (url.host !== 'raw.githubusercontent.com' || owner === undefined || repository === undefined || rest.length > 0) {
    return null;
  }
  return `https://api.github.com/repos/${owner}/${repository}`;
}

/** Where AutoEq is now, unlike everything else here, so a refetch can find what's been added since. */
export function autoeqHeadUrl(api: string): string {
  return `${api}/git/ref/heads/master`;
}

export function targetListUrl(commit: string, api: string): string {
  return `${api}/contents/targets?ref=${commit}`;
}

export function targetUrl(file: string, commit: string, base: string = AUTOEQ): string {
  return urlAt(base, commit, `targets/${file}.csv`);
}
