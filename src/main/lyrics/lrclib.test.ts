import { describe, expect, it } from 'vitest';
import {
  baseTitle,
  createLrclibClient,
  isSameSong,
  lastTimestampSeconds,
  lyricsFrom,
  mayAnswer,
  normalizeName,
  pickBestRecord,
  pickLooseRecord,
  titlesNearlyMatch,
  trackNamedInTitle,
  WIDEST_DURATION_SECONDS,
  type LrclibLyrics,
  type LrclibRecord,
  type LrclibTrack,
} from '@main/lyrics/lrclib';

const TRACK: LrclibTrack = { title: 'Human', artist: 'Nightwish', album: 'Human II Nature', durationMs: 200_000 };
const WORDS = 'a line of made up words long enough for the matcher to believe it is a song';
const SYNCED = `[00:10.00] ${WORDS}\n[03:10.50] last line`;
const SYNCED_PARTLY = `[00:10.00] ${WORDS}\n[01:00.00] last line`;

function record(overrides: Partial<LrclibRecord> = {}): LrclibRecord {
  return {
    id: 1,
    trackName: 'Human',
    artistName: 'Nightwish',
    albumName: 'Human II Nature',
    duration: 200,
    instrumental: false,
    plainLyrics: WORDS,
    syncedLyrics: SYNCED,
    ...overrides,
  };
}

const flaggedInstrumental = (id: number) => record({ id, instrumental: true, plainLyrics: null, syncedLyrics: null });

const plainOnly = () => record({ syncedLyrics: null });
const wordsOf = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
const reply = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init);
const found = (overrides: Partial<LrclibRecord> = {}) => reply(record(overrides));
const missing = () => reply({ statusCode: 404, name: 'TrackNotFound', message: 'none' }, { status: 404 });
const failing = (status: number, retryAfter?: string) =>
  reply({ statusCode: status }, { status, headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter } });

function server(replies: (Response | Error)[]) {
  const requests: { url: URL; at: number; userAgent: string | null }[] = [];
  const sleeps: number[] = [];
  let clock = 1_000;
  const client = createLrclibClient('music-player v0.1.0', {
    fetch: (url, init) => {
      requests.push({ url: new URL(url), at: clock, userAgent: new Headers(init.headers).get('User-Agent') });
      const next = replies.shift();
      if (next === undefined) return Promise.reject(new Error(`No reply left for ${url}`));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    random: () => 0.5,
  });
  return { client, requests, sleeps };
}

function expectFound(lyrics: LrclibLyrics | undefined) {
  if (lyrics?.status !== 'found') throw new Error(`Expected found, got ${lyrics?.status ?? 'a failure'}`);
  return lyrics;
}

describe('lookup', () => {
  it('asks for the exact record first and identifies itself', async () => {
    const { client, requests } = server([found()]);
    const answer = await client.lookup(TRACK);

    const lyrics = expectFound(answer.ok ? answer.value : undefined);
    expect(lyrics.match.via).toBe('exact');
    expect(lyrics.syncedLrc).toBe(SYNCED);
    expect(lyrics.plainText).toBe(WORDS);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.userAgent).toBe('music-player v0.1.0');
    expect(requests[0]?.url.pathname).toBe('/api/get');
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
      track_name: 'Human',
      artist_name: 'Nightwish',
      album_name: 'Human II Nature',
      duration: '200',
    });
  });

  it('starts without an album when the track has none', async () => {
    const { client, requests } = server([found()]);
    const answer = await client.lookup({ ...TRACK, album: null });

    expect(expectFound(answer.ok ? answer.value : undefined).match.via).toBe('any_album');
    expect(requests[0]?.url.searchParams.has('album_name')).toBe(false);
  });

  it('widens to any album, then to search', async () => {
    const { client, requests } = server([
      missing(),
      missing(),
      reply([record({ artistName: 'Nightwish feat. Someone', trackName: 'Human (Live)' })]),
    ]);
    const answer = await client.lookup({ ...TRACK, title: 'Human (Remastered)' });

    expect(expectFound(answer.ok ? answer.value : undefined).match.via).toBe('search');
    expect(requests[1]?.url.searchParams.has('album_name')).toBe(false);
    expect(requests[2]?.url.pathname).toBe('/api/search');
    expect(requests[2]?.url.searchParams.get('track_name')).toBe('Human');
  });

  it('keeps looking for synced lyrics after a plain match, and keeps the plain one if none turn up', async () => {
    const { client, requests } = server([reply(plainOnly()), reply(plainOnly()), reply([]), reply([])]);
    const answer = await client.lookup(TRACK);

    const lyrics = expectFound(answer.ok ? answer.value : undefined);
    expect(requests).toHaveLength(4);
    expect(lyrics.match.via).toBe('exact');
    expect(lyrics.syncedLrc).toBeNull();
  });

  it('takes synced lyrics from a wider step over a plain exact match', async () => {
    const { client, requests } = server([reply(plainOnly()), found()]);
    const answer = await client.lookup(TRACK);

    const lyrics = expectFound(answer.ok ? answer.value : undefined);
    expect(requests).toHaveLength(2);
    expect(lyrics.match.via).toBe('any_album');
    expect(lyrics.syncedLrc).toBe(SYNCED);
  });

  it('keeps looking for a sync that reaches the end after one that stops partway', async () => {
    const { client, requests } = server([found({ syncedLyrics: SYNCED_PARTLY }), found()]);
    const answer = await client.lookup(TRACK);

    const lyrics = expectFound(answer.ok ? answer.value : undefined);
    expect(requests).toHaveLength(2);
    expect(lyrics.match.via).toBe('any_album');
    expect(lyrics.syncedLrc).toBe(SYNCED);
  });

  it('keeps a sync that stops partway if nothing better turns up', async () => {
    const { client, requests } = server([
      found({ syncedLyrics: SYNCED_PARTLY }),
      reply(plainOnly()),
      reply([]),
      reply([]),
    ]);
    const answer = await client.lookup(TRACK);

    const lyrics = expectFound(answer.ok ? answer.value : undefined);
    expect(requests).toHaveLength(4);
    expect(lyrics.match.via).toBe('exact');
    expect(lyrics.syncedLrc).toBe(SYNCED_PARTLY);
  });

  describe('an instrumental flag', () => {
    const flag = () => reply(flaggedInstrumental(5));

    it("doesn't end the search, since people flag sung songs", async () => {
      const { client, requests } = server([flag(), missing(), reply([record()])]);
      const answer = await client.lookup(TRACK);

      expect(expectFound(answer.ok ? answer.value : undefined).match.via).toBe('search');
      expect(requests).toHaveLength(3);
    });

    it('stands when nothing with words turns up', async () => {
      const { client, requests } = server([flag(), flag(), reply([]), reply([])]);
      const answer = await client.lookup(TRACK);

      expect(answer.ok && answer.value.status).toBe('instrumental');
      expect(requests).toHaveLength(4);
    });

    it("doesn't beat plain lyrics, whichever comes first", async () => {
      const plainFirst = server([reply(plainOnly()), flag(), reply([]), reply([])]);
      const flagFirst = server([flag(), reply(plainOnly()), reply([]), reply([])]);

      const kept = await plainFirst.client.lookup(TRACK);
      const replaced = await flagFirst.client.lookup(TRACK);

      expect(expectFound(kept.ok ? kept.value : undefined).match.via).toBe('exact');
      expect(expectFound(replaced.ok ? replaced.value : undefined).match.via).toBe('any_album');
    });
  });

  it('calls a record instrumental when the tags say so, whatever it carries', async () => {
    const album = 'Human (Instrumental Version)';
    const { client, requests } = server([found({ albumName: album })]);
    const answer = await client.lookup({ ...TRACK, album });

    expect(answer.ok && answer.value.status).toBe('instrumental');
    expect(requests).toHaveLength(1);
  });

  it('skips the sung record for a track tagged as having no vocals', async () => {
    const { client, requests } = server([found(), found(), reply([record()]), reply([record()])]);

    expect(await client.lookup({ ...TRACK, album: 'Human (Instrumental Version)' })).toEqual({
      ok: true,
      value: { status: 'not_found' },
    });
    expect(requests).toHaveLength(4);
  });

  it('reports not_found once every step has come up empty', async () => {
    const { client, requests } = server([missing(), missing(), reply([]), reply([])]);

    expect(await client.lookup(TRACK)).toEqual({ ok: true, value: { status: 'not_found' } });
    expect(requests).toHaveLength(4);
  });

  describe('searching', () => {
    const notFound = { ok: true, value: { status: 'not_found' } };

    it('turns down a stranger with the same title', async () => {
      const stranger = record({ artistName: 'Someone Else', albumName: 'Other' });
      const { client } = server([missing(), missing(), reply([stranger]), reply([stranger])]);

      expect(await client.lookup(TRACK)).toEqual(notFound);
    });

    it('turns down a record too far off in length, shorter or longer', async () => {
      const shorter = record({ duration: 184 });
      const longer = record({ duration: 216 });
      const { client } = server([missing(), missing(), reply([shorter, longer]), reply([])]);

      expect(await client.lookup(TRACK)).toEqual(notFound);
    });

    it('takes the best result, not the first', async () => {
      const results = [record({ id: 2, syncedLyrics: null }), record({ id: 3 })];
      const { client } = server([missing(), missing(), reply(results)]);
      const answer = await client.lookup(TRACK);

      expect(expectFound(answer.ok ? answer.value : undefined).match.id).toBe(3);
    });

    it('asks by album last, for a soundtrack whose songs are credited to their singers', async () => {
      const singer = record({ artistName: 'Someone Else', albumName: 'Human II Nature (Original Soundtrack)' });
      const { client, requests } = server([missing(), missing(), reply([]), reply([singer])]);
      const answer = await client.lookup(TRACK);

      expect(expectFound(answer.ok ? answer.value : undefined).match.via).toBe('same_album');
      expect(requests).toHaveLength(4);
      expect(Object.fromEntries(requests[3]?.url.searchParams ?? [])).toEqual({
        track_name: 'Human',
        album_name: 'Human II Nature',
      });
    });

    it("doesn't ask by album for a track with none", async () => {
      const { client, requests } = server([missing(), reply([])]);

      expect(await client.lookup({ ...TRACK, album: null })).toEqual(notFound);
      expect(requests).toHaveLength(2);
    });
  });

  it("doesn't ask about a track LRCLIB's duration limit would reject", async () => {
    const { client, requests } = server([]);

    expect(await client.lookup({ ...TRACK, durationMs: 3_700_000 })).toEqual({
      ok: true,
      value: { status: 'not_found' },
    });
    expect(await client.lookup({ ...TRACK, durationMs: 100 })).toEqual({ ok: true, value: { status: 'not_found' } });
    expect(requests).toHaveLength(0);
  });

  it('drops synced lyrics timed past the end of the song', async () => {
    const { client } = server([found({ syncedLyrics: `[09:00.00] ${WORDS}` }), missing(), reply([]), reply([])]);
    const answer = await client.lookup(TRACK);

    const lyrics = expectFound(answer.ok ? answer.value : undefined);
    expect(lyrics.syncedLrc).toBeNull();
    expect(lyrics.plainText).toBe(WORDS);
  });

  it('treats a record with only blank lyrics as no answer', async () => {
    const { client } = server([found({ plainLyrics: '  ', syncedLyrics: '' }), missing(), reply([]), reply([])]);

    expect(await client.lookup(TRACK)).toEqual({ ok: true, value: { status: 'not_found' } });
  });

  it('treats a record that only names the song as no answer', async () => {
    const stub = 'Artist: Nightwish\r\nAlbum: Human II Nature\r\nTitle: Human\r\n';
    const { client } = server([found({ plainLyrics: stub, syncedLyrics: stub }), missing(), reply([]), reply([])]);

    expect(await client.lookup(TRACK)).toEqual({ ok: true, value: { status: 'not_found' } });
  });
});

describe('lyricsFrom', () => {
  it("doesn't count tags and header lines as words", () => {
    const named = [
      '[ar:A Very Long Band Name That Goes On And On]',
      '[ti:A Very Long Song Name That Goes On And On Too]',
      'Artist: A Very Long Band Name That Goes On And On',
      'Title: A Very Long Song Name That Goes On And On Too',
    ].join('\n');

    expect(lyricsFrom(record({ plainLyrics: named, syncedLyrics: null }), TRACK, 'exact').status).toBe('not_found');
  });

  it('takes tags and header lines out of plain lyrics, and leaves synced ones as they are', () => {
    const plain = `[ar:Nightwish]\n[offset:0]\nArtist: Nightwish\nTitle: Human\n\n${WORDS}\n`;
    const synced = `[offset:500]\n${SYNCED}`;
    const lyrics = lyricsFrom(record({ plainLyrics: plain, syncedLyrics: synced }), TRACK, 'exact');

    expect(lyrics).toMatchObject({ status: 'found', plainText: WORDS, syncedLrc: synced });
  });

  it('leaves section labels in plain lyrics', () => {
    const plain = `[Chorus: Someone]\n${WORDS}`;

    expect(lyricsFrom(record({ plainLyrics: plain }), TRACK, 'exact')).toMatchObject({ plainText: plain });
  });

  it('only takes out whole tag and header lines', () => {
    const plain = `${WORDS} [ar:Nightwish] ${WORDS}\n[ar:Nightwish] ${WORDS}\n${WORDS} [ar:Nightwish]\nThe Title: ${WORDS}`;

    expect(lyricsFrom(record({ plainLyrics: plain }), TRACK, 'exact')).toMatchObject({ plainText: plain });
    expect(lyricsFrom(record({ plainLyrics: `[AL:Human]\n  title : Human\n${WORDS}` }), TRACK, 'exact')).toMatchObject({
      plainText: WORDS,
    });
  });

  it('takes out every kind of tag line', () => {
    const tags = ['ar', 'al', 'ti', 'au', 'by', 're', 've', 'tool', 'length', 'offset'].map((key) => `[${key}:x]`);

    expect(lyricsFrom(record({ plainLyrics: [...tags, WORDS].join('\n') }), TRACK, 'exact')).toMatchObject({
      plainText: WORDS,
    });
  });

  it('wants 15 words, not counting tags or header lines', () => {
    const statusWith = (plainLyrics: string) =>
      lyricsFrom(record({ plainLyrics, syncedLyrics: null }), TRACK, 'exact').status;

    expect(statusWith(wordsOf(14))).toBe('not_found');
    expect(statusWith(wordsOf(15))).toBe('found');
    expect(statusWith(`[Verse 1] [Verse 2]\nArtist: Nightwish\nAlbum: Human\nTitle: Human\n${wordsOf(14)}`)).toBe(
      'not_found',
    );
  });

  it("doesn't count a synced field with no timestamps as synced", () => {
    const lyrics = lyricsFrom(record({ plainLyrics: null, syncedLyrics: WORDS }), TRACK, 'exact');

    expect(lyrics).toEqual({ status: 'not_found' });
  });

  it('keeps sync whose last line is up to 5 s past the end of the song', () => {
    const endingAt = (stamp: string) => record({ syncedLyrics: `[00:10.00] ${WORDS}\n[${stamp}] last line` });

    expect(lyricsFrom(endingAt('03:25.00'), TRACK, 'exact')).toMatchObject({
      syncedLrc: `[00:10.00] ${WORDS}\n[03:25.00] last line`,
    });
    expect(lyricsFrom(endingAt('03:25.10'), TRACK, 'exact')).toMatchObject({ status: 'found', syncedLrc: null });
  });

  it('measures that against the track, not the record', () => {
    const longerRecord = record({ duration: 204, syncedLyrics: `[00:10.00] ${WORDS}\n[03:27.00] last line` });

    expect(lyricsFrom(longerRecord, TRACK, 'exact')).toMatchObject({ syncedLrc: null });
  });

  describe('text in a script the tags do not use', () => {
    const KANA = 'かきくけこ さしすせそ '.repeat(10);

    it('is not lyrics', () => {
      expect(lyricsFrom(record({ plainLyrics: KANA, syncedLyrics: `[00:10.00] ${KANA}` }), TRACK, 'exact')).toEqual({
        status: 'not_found',
      });
    });

    it('is lyrics when the tags use that script too', () => {
      const tagged = { ...TRACK, artist: 'さしすせそ' };

      expect(lyricsFrom(record({ plainLyrics: KANA, syncedLyrics: null }), tagged, 'exact').status).toBe('found');
    });

    it("is fine as a line or two among words in the tags' script", () => {
      const plainLyrics = `${wordsOf(40)}\nかきくけこ`;

      expect(lyricsFrom(record({ plainLyrics }), TRACK, 'exact').status).toBe('found');
    });

    it('starts to count as another song at about a third of the letters', () => {
      const withKana = (kana: number) => `${'abcde '.repeat(20)}${'か'.repeat(kana)}`;

      expect(lyricsFrom(record({ plainLyrics: withKana(40), syncedLyrics: null }), TRACK, 'exact').status).toBe(
        'found',
      );
      expect(lyricsFrom(record({ plainLyrics: withKana(60), syncedLyrics: null }), TRACK, 'exact').status).toBe(
        'not_found',
      );
    });
  });

  it('keeps sync for a length up to 5 s off, and only the words beyond that', () => {
    const near = lyricsFrom(record({ duration: 205 }), TRACK, 'any_album');
    const far = lyricsFrom(record({ duration: 205.5 }), TRACK, 'any_album');

    expect(near).toMatchObject({ status: 'found', syncedLrc: SYNCED });
    expect(far).toMatchObject({ status: 'found', syncedLrc: null, plainText: WORDS });
  });
});

describe('asking politely', () => {
  it('spaces requests out', async () => {
    const { client, requests } = server([missing(), missing(), reply([])]);
    await client.lookup(TRACK);

    expect((requests[1]?.at ?? 0) - (requests[0]?.at ?? 0)).toBeGreaterThanOrEqual(700);
    expect((requests[2]?.at ?? 0) - (requests[1]?.at ?? 0)).toBeGreaterThanOrEqual(700);
  });

  it('waits out a 429 for as long as Retry-After says, plus jitter', async () => {
    const { client, requests, sleeps } = server([failing(429, '10'), found()]);
    const answer = await client.lookup(TRACK);

    expect(answer.ok).toBe(true);
    expect(sleeps).toContain(11_500);
    expect(requests).toHaveLength(2);
  });

  it('waits out a 503 the same way', async () => {
    const { client, sleeps } = server([failing(503, '1'), found()]);
    const answer = await client.lookup(TRACK);

    expect(answer.ok).toBe(true);
    expect(sleeps).toContain(1_150);
  });

  it('gives up on a 429 that never lifts, and says so', async () => {
    const { client, requests } = server(Array.from({ length: 6 }, () => failing(429, '1')));
    const answer = await client.lookup(TRACK);

    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error.code).toBe('rate_limited');
    expect(requests).toHaveLength(6);
  });

  it('backs off from server errors and gives up after six tries', async () => {
    const { client, requests, sleeps } = server(Array.from({ length: 6 }, () => failing(500)));
    const answer = await client.lookup(TRACK);

    expect(!answer.ok && answer.error.code).toBe('network');
    expect(requests).toHaveLength(6);
    expect(sleeps).toEqual(expect.arrayContaining([2_300, 4_600, 9_200, 18_400, 36_800]));
  });

  it('retries a network failure', async () => {
    const { client, requests } = server([new Error('fetch failed'), found()]);
    const answer = await client.lookup(TRACK);

    expect(answer.ok).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it('never retries a request LRCLIB rejected', async () => {
    const { client, requests } = server([failing(400)]);
    const answer = await client.lookup(TRACK);

    expect(!answer.ok && answer.error.message).toBe('LRCLIB answered 400');
    expect(requests).toHaveLength(1);
  });

  it('fails a lookup when a later step fails, so a rerun asks again', async () => {
    const { client } = server([reply(plainOnly()), failing(400)]);

    expect((await client.lookup(TRACK)).ok).toBe(false);
  });
});

describe('outside data', () => {
  it('rejects a record of the wrong shape', async () => {
    const { client } = server([reply({ id: 'nope' })]);
    const answer = await client.lookup(TRACK);

    expect(!answer.ok && answer.error.code).toBe('network');
  });

  it('retries a body that is not JSON', async () => {
    const { client, requests } = server([new Response('<html>', { status: 200 }), found()]);
    const answer = await client.lookup(TRACK);

    expect(answer.ok).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it('skips search results it cannot read and uses the rest', async () => {
    const { client } = server([missing(), missing(), reply([{ id: 'nope' }, record()])]);
    const answer = await client.lookup(TRACK);

    expect(expectFound(answer.ok ? answer.value : undefined).match.via).toBe('search');
  });

  it('reads a record with no album, which LRCLIB sends as null', async () => {
    const noAlbum = { ...record(), albumName: null };
    const direct = server([reply(noAlbum)]);
    const searched = server([missing(), missing(), reply([noAlbum])]);

    const answer = await direct.client.lookup(TRACK);
    expect(expectFound(answer.ok ? answer.value : undefined).match.album).toBe('');
    const fromSearch = await searched.client.lookup(TRACK);
    expect(expectFound(fromSearch.ok ? fromSearch.value : undefined).match.via).toBe('search');
  });
});

describe('normalizeName', () => {
  it.each([
    ['Björk', 'bjork'],
    ['AC/DC', 'ac dc'],
    ['Simon & Garfunkel', 'simon and garfunkel'],
    ["Don't  Stop", 'don t stop'],
    ['Ария', 'ария'],
    ['!!!', '!!!'],
  ])('%s becomes %s', (name, expected) => {
    expect(normalizeName(name)).toBe(expected);
  });
});

describe('baseTitle', () => {
  it.each([
    ['Human (Remastered 2011)', 'Human'],
    ['Human [Live] (2011)', 'Human'],
    ['Human - 2011 Remaster', 'Human'],
    ['Human', 'Human'],
    ["(Don't Fear) The Reaper", "(Don't Fear) The Reaper"],
    ['[Intro]', '[Intro]'],
  ])('%s becomes %s', (title, expected) => {
    expect(baseTitle(title)).toBe(expected);
  });
});

describe('isSameSong', () => {
  it('accepts the same song in different dress', () => {
    const elsewhere = { albumName: 'Other' };

    expect(isSameSong(TRACK, record({ ...elsewhere, trackName: 'HUMAN!', artistName: 'nightwish' }))).toBe(true);
    expect(isSameSong(TRACK, record({ ...elsewhere, trackName: 'Human (Live)' }))).toBe(true);
    expect(isSameSong(TRACK, record({ ...elsewhere, artistName: 'Nightwish feat. Someone' }))).toBe(true);
    expect(isSameSong({ ...TRACK, artist: 'Nightwish & Someone' }, record(elsewhere))).toBe(true);
    expect(isSameSong(TRACK, record({ duration: 202 }))).toBe(true);
    expect(isSameSong(TRACK, record({ duration: 198 }))).toBe(true);
    expect(isSameSong({ ...TRACK, title: 'Human (Live)' }, record(elsewhere))).toBe(true);
  });

  it('rejects a different song, artist or length', () => {
    expect(isSameSong(TRACK, record({ trackName: 'Human Nature' }))).toBe(false);
    expect(isSameSong(TRACK, record({ artistName: 'Rag n Bone Man', albumName: 'Human' }))).toBe(false);
    expect(isSameSong(TRACK, record({ artistName: 'Nightwisher', albumName: 'Other' }))).toBe(false);
    expect(isSameSong(TRACK, record({ duration: 202.5 }))).toBe(false);
    expect(isSameSong(TRACK, record({ duration: 197.5 }))).toBe(false);
  });

  it('tells numbered parts apart', () => {
    const titled = (title: string, trackName: string) => isSameSong({ ...TRACK, title }, record({ trackName }));

    expect(titled('Human (Part 2)', 'Human (Part 3)')).toBe(false);
    expect(titled('Human - Part 1', 'Human - Part 2')).toBe(false);
    expect(titled('Human (Pt. 1)', 'Human (Part 2)')).toBe(false);
    expect(titled('Human (Part I)', 'Human (Part II)')).toBe(false);
    expect(titled('Human (Vol. 1)', 'Human (Volume 2)')).toBe(false);
    expect(titled('Human (Part 2)', 'Human (Part II)')).toBe(true);
    expect(titled('Human (Part 2)', 'Human (Remastered)')).toBe(true);
    expect(titled('Human Part 2', 'human part 2')).toBe(true);
  });

  it('keeps instrumental and karaoke versions apart from the sung one', () => {
    expect(isSameSong({ ...TRACK, title: 'Human (Instrumental)' }, record())).toBe(false);
    expect(isSameSong(TRACK, record({ trackName: 'Human - Karaoke Version' }))).toBe(false);
    expect(isSameSong({ ...TRACK, title: 'Human (Instrumental)' }, record({ trackName: 'Human [Instrumental]' }))).toBe(
      true,
    );
  });

  it('only takes the whole word as saying there are no vocals', () => {
    expect(isSameSong(TRACK, record({ albumName: 'Orchestrally Minded' }))).toBe(true);
  });

  it('takes the album tag at its word about vocals', () => {
    const instrumental = 'Human (Instrumental Version)';

    expect(isSameSong({ ...TRACK, album: instrumental }, record())).toBe(false);
    expect(isSameSong({ ...TRACK, album: 'Human (Orchestral Verson)' }, record())).toBe(false);
    expect(isSameSong(TRACK, record({ albumName: 'Greatest Hits Instrumentals' }))).toBe(false);
    expect(isSameSong({ ...TRACK, album: instrumental }, record({ albumName: instrumental }))).toBe(true);
    expect(isSameSong({ ...TRACK, album: 'A Cappella Dreams' }, record())).toBe(true);
  });

  describe('credited by album', () => {
    const soundtrack = { ...TRACK, title: 'Debora', artist: 'Baby Driver', album: 'Baby Driver' };
    const onAlbum = (albumName: string) => record({ trackName: 'Debora', artistName: 'T. Rex', albumName });

    it('accepts another artist when the album agrees', () => {
      expect(isSameSong(soundtrack, onAlbum('Baby Driver'))).toBe(true);
      expect(isSameSong(soundtrack, onAlbum('Baby Driver (Music from the Motion Picture)'))).toBe(true);
    });

    it('rejects an album that only looks similar', () => {
      expect(isSameSong(soundtrack, onAlbum('Baby Drivers'))).toBe(false);
      expect(isSameSong(soundtrack, onAlbum(''))).toBe(false);
      expect(isSameSong({ ...soundtrack, album: '' }, onAlbum(''))).toBe(false);
      expect(isSameSong({ ...soundtrack, album: null }, onAlbum('Baby Driver'))).toBe(false);
    });

    it('rejects a record album that only fits inside the tag', () => {
      expect(isSameSong({ ...soundtrack, album: 'Band Greatest Hits' }, onAlbum('Greatest Hits'))).toBe(false);
      expect(isSameSong({ ...soundtrack, album: 'Debora For A While' }, onAlbum('Debora'))).toBe(false);
    });

    it('learns nothing from an album named after the song', () => {
      expect(isSameSong({ ...soundtrack, album: 'Debora' }, onAlbum('Debora'))).toBe(false);
      expect(isSameSong({ ...soundtrack, album: 'Debora (Single)' }, onAlbum('Debora (Single)'))).toBe(false);
      expect(isSameSong({ ...soundtrack, title: 'Debora (feat. Someone)', album: 'Debora' }, onAlbum('Debora'))).toBe(
        false,
      );
    });

    it('still needs the title and length to agree', () => {
      expect(isSameSong(soundtrack, { ...onAlbum('Baby Driver'), trackName: 'Other' })).toBe(false);
      expect(isSameSong(soundtrack, { ...onAlbum('Baby Driver'), duration: 203 })).toBe(false);
    });
  });

  it('takes a wider length when asked', () => {
    expect(isSameSong(TRACK, record({ duration: 215 }), WIDEST_DURATION_SECONDS)).toBe(true);
    expect(isSameSong(TRACK, record({ duration: 215.5 }), WIDEST_DURATION_SECONDS)).toBe(false);
  });
});

describe('pickBestRecord', () => {
  it('prefers synced lyrics, then the same album, then the closest length', () => {
    const plain = plainOnly();
    const otherAlbum = record({ id: 2, albumName: 'Other' });
    const sameAlbumFar = record({ id: 3, duration: 201 });
    const sameAlbumClose = record({ id: 4, duration: 200.5 });

    expect(pickBestRecord(TRACK, [plain, otherAlbum])?.id).toBe(2);
    expect(pickBestRecord(TRACK, [otherAlbum, sameAlbumFar])?.id).toBe(3);
    expect(pickBestRecord(TRACK, [sameAlbumFar, sameAlbumClose])?.id).toBe(4);
  });

  it('prefers the plain name to a dressed-up one, even a bit further off in length', () => {
    const dressedUp = record({ id: 2, trackName: 'Human (Paused)', duration: 200 });
    const plainName = record({ id: 3, duration: 201 });

    expect(pickBestRecord(TRACK, [dressedUp, plainName])?.id).toBe(3);
  });

  it('prefers the artist as tagged to one that only contains it', () => {
    const contains = record({ id: 2, artistName: 'Nightwish feat. Someone', duration: 200 });
    const asTagged = record({ id: 3, duration: 201 });

    expect(pickBestRecord(TRACK, [contains, asTagged])?.id).toBe(3);
  });

  it('prefers a record crediting the artist to one that only shares the album', () => {
    const shared = record({ id: 2, artistName: 'Someone Else' });
    const credited = record({ id: 3, albumName: 'Other', duration: 201 });

    expect(pickBestRecord(TRACK, [shared, credited])?.id).toBe(3);
  });

  it('takes the album over a dressed-up title, since the album says which version it is', () => {
    const onAlbum = record({ id: 2, trackName: 'Human (feat. Someone)' });
    const otherAlbum = record({ id: 3, albumName: 'Other' });

    expect(pickBestRecord(TRACK, [otherAlbum, onAlbum])?.id).toBe(2);
  });

  it('prefers a sync that reaches the end of the song, even off the album', () => {
    const partly = record({ id: 2, syncedLyrics: SYNCED_PARTLY });
    const whole = record({ id: 3, albumName: 'Other', duration: 201 });

    expect(pickBestRecord(TRACK, [partly, whole])?.id).toBe(3);
  });

  it('draws the line for reaching the end at 85% of the furthest sync', () => {
    const endingAt = (id: number, stamp: string) =>
      record({ id, syncedLyrics: `[00:10.00] ${WORDS}\n[${stamp}] last line` });
    const furthest = record({ id: 5, albumName: 'Other', syncedLyrics: `[00:10.00] ${WORDS}\n[03:20.00] last line` });

    expect(pickBestRecord(TRACK, [endingAt(2, '02:50.00'), furthest])?.id).toBe(2);
    expect(pickBestRecord(TRACK, [endingAt(3, '02:49.00'), furthest])?.id).toBe(5);
  });

  describe('when a sync holds less of the song than its last stamp says', () => {
    const closingAt = (stamp: string, words: string) => `[00:10.00] ${words}\n[01:00.00] ${words}\n[${stamp}] `;
    const whole = `[00:10.00] ${WORDS}\n[01:00.00] ${WORDS}\n[02:00.00] ${WORDS}\n[03:00.00] ${WORDS}\n[03:15.00] `;

    it('prefers one whose words go further, even off the album', () => {
      const closesLate = record({ id: 2, syncedLyrics: closingAt('03:15.00', WORDS) });
      const goesOn = record({ id: 3, albumName: 'Other', syncedLyrics: whole });

      expect(pickBestRecord(TRACK, [closesLate, goesOn])?.id).toBe(3);
    });

    it('stays when the words that go further are no more of them', () => {
      const sameWordsLater = `[02:50.00] ${WORDS}\n[03:00.00] ${WORDS}\n[03:15.00] `;
      const closesLate = record({ id: 2, syncedLyrics: closingAt('03:15.00', WORDS) });
      const later = record({ id: 3, albumName: 'Other', syncedLyrics: sameWordsLater });

      expect(pickBestRecord(TRACK, [closesLate, later])?.id).toBe(2);
    });

    it('stays when the extra words stop as early', () => {
      const closesLate = record({ id: 2, syncedLyrics: closingAt('03:15.00', WORDS) });
      const moreWords = record({
        id: 3,
        albumName: 'Other',
        syncedLyrics: closingAt('03:15.00', `${WORDS} ${WORDS}`),
      });
      const usual = record({ id: 4, albumName: 'Other', syncedLyrics: closingAt('03:15.00', WORDS) });

      expect(pickBestRecord(TRACK, [closesLate, moreWords, usual])?.id).toBe(2);
    });

    it('counts words by the rule of 15% more', () => {
      const rival = (words: number) =>
        record({
          id: 3,
          albumName: 'Other',
          syncedLyrics: `[00:10.00] ${wordsOf(words)}\n[03:00.00] end of it`,
        });
      const stopsEarly = record({
        id: 2,
        syncedLyrics: `[00:10.00] ${wordsOf(98)}\n[01:00.00] end of it\n[03:15.00] `,
      });

      expect(pickBestRecord(TRACK, [stopsEarly, rival(112)])?.id).toBe(2);
      expect(pickBestRecord(TRACK, [stopsEarly, rival(114)])?.id).toBe(3);
    });

    it('prefers the usual text to a fragment of it, as far as both go', () => {
      const fragment = record({ id: 2, syncedLyrics: `[00:10.00] ${wordsOf(20)}\n[03:10.00] end of it` });
      const usual = [3, 4, 5].map((id) =>
        record({ id, albumName: 'Other', syncedLyrics: `[00:10.00] ${wordsOf(40)}\n[03:10.00] end of it` }),
      );

      expect(pickBestRecord(TRACK, [fragment, ...usual])?.id).toBe(3);
    });

    it('counts plain uploads in what is usual, since the sync may be the odd one out', () => {
      const fragments = [2, 3].map((id) =>
        record({ id, syncedLyrics: `[00:10.00] ${wordsOf(20)}\n[03:10.00] end of it` }),
      );
      const fuller = record({
        id: 4,
        albumName: 'Other',
        syncedLyrics: `[00:10.00] ${wordsOf(36)}\n[03:10.00] end of it`,
      });
      const plains = [5, 6, 7].map((id) => record({ id, plainLyrics: wordsOf(40), syncedLyrics: null }));

      expect(pickBestRecord(TRACK, [...fragments, fuller, ...plains])?.id).toBe(4);
    });

    it('leaves a text at 70% of the usual alone', () => {
      const shorter = record({ id: 2, syncedLyrics: `[00:10.00] ${wordsOf(26)}\n[03:10.00] end of it` });
      const usual = [3, 4, 5].map((id) =>
        record({ id, albumName: 'Other', syncedLyrics: `[00:10.00] ${wordsOf(38)}\n[03:10.00] end of it` }),
      );

      expect(pickBestRecord(TRACK, [shorter, ...usual])?.id).toBe(2);
    });
  });

  it('breaks an exact tie by the lowest id, whatever order the records come in', () => {
    const [low, high] = [record({ id: 3 }), record({ id: 5 })];

    expect(pickBestRecord(TRACK, [low, high])?.id).toBe(3);
    expect(pickBestRecord(TRACK, [high, low])?.id).toBe(3);
  });

  it('treats the same gap either side of the length as a tie', () => {
    const [longer, shorter] = [record({ id: 5, duration: 201 }), record({ id: 3, duration: 199 })];

    expect(pickBestRecord(TRACK, [longer, shorter])?.id).toBe(3);
    expect(pickBestRecord(TRACK, [shorter, longer])?.id).toBe(3);
  });

  it("doesn't let a sync credited only by album show the artist's own to be unfinished", () => {
    const onAlbumOnly = record({ id: 2, artistName: 'Someone Else' });
    const artistsOwn = record({ id: 3, albumName: 'Other', syncedLyrics: SYNCED_PARTLY });

    expect(pickBestRecord(TRACK, [onAlbumOnly, artistsOwn])?.id).toBe(3);
  });

  it('compares syncs credited only by album with each other when the artist has none', () => {
    const partly = record({ id: 2, artistName: 'Someone Else', syncedLyrics: SYNCED_PARTLY });
    const whole = record({ id: 3, artistName: 'Someone Else', duration: 201 });
    const artistsPlain = record({ id: 4, albumName: 'Other', syncedLyrics: null });

    expect(pickBestRecord(TRACK, [partly, whole, artistsPlain])?.id).toBe(3);
  });

  it('takes a sync credited only by album over plain lyrics from the artist', () => {
    const onAlbumOnly = record({ id: 2, artistName: 'Someone Else' });

    expect(pickBestRecord(TRACK, [plainOnly(), onAlbumOnly])?.id).toBe(2);
  });

  it('treats syncs reaching about as far as equals', () => {
    const fullEnough = record({ id: 2, syncedLyrics: `[00:10.00] ${WORDS}\n[02:45.00] last line` });
    const further = record({ id: 3, albumName: 'Other' });

    expect(pickBestRecord(TRACK, [further, fullEnough])?.id).toBe(2);
  });

  it('still takes a partial sync over plain lyrics', () => {
    expect(pickBestRecord(TRACK, [plainOnly(), record({ id: 2, syncedLyrics: SYNCED_PARTLY })])?.id).toBe(2);
  });

  it('prefers plain lyrics over an instrumental flag or two', () => {
    expect(pickBestRecord(TRACK, [flaggedInstrumental(2), plainOnly()])?.id).toBe(1);
    expect(pickBestRecord(TRACK, [flaggedInstrumental(2), flaggedInstrumental(3), plainOnly()])?.id).toBe(1);
  });

  it('believes many instrumental flags over a lone upload with words', () => {
    const flags = [2, 3, 4, 5, 6, 7, 8].map(flaggedInstrumental);

    expect(pickBestRecord(TRACK, [record(), ...flags])?.id).toBe(2);
    expect(pickBestRecord(TRACK, [record(), ...flags.slice(1)])?.id).toBe(1);
    expect(pickBestRecord(TRACK, [record(), record({ id: 9 }), ...flags])?.id).toBe(1);
  });

  it("doesn't count a flagged record's words as sung", () => {
    const flaggedWithWords = (id: number) => record({ id, instrumental: true });

    expect(pickBestRecord(TRACK, [flaggedWithWords(2)])?.id).toBe(2);
    expect(lyricsFrom(flaggedWithWords(2), TRACK, 'exact').status).toBe('instrumental');
  });

  it("doesn't let an upload that only names the song outvote a flag", () => {
    const stub = record({ plainLyrics: 'Artist: Nightwish\nTitle: Human', syncedLyrics: null });

    expect(pickBestRecord(TRACK, [stub, flaggedInstrumental(2)])?.id).toBe(2);
  });

  describe('when nothing close has words', () => {
    const longer = record({ id: 2, duration: 210, syncedLyrics: null });

    it('looks further off in length', () => {
      expect(pickBestRecord(TRACK, [longer])?.id).toBe(2);
    });

    it("doesn't look past the widest length", () => {
      expect(pickBestRecord(TRACK, [record({ duration: 216 })])).toBeNull();
    });

    it('only looks there when nothing closer has words', () => {
      expect(pickBestRecord(TRACK, [longer, plainOnly()])?.id).toBe(1);
      expect(pickBestRecord(TRACK, [longer, record({ plainLyrics: 'too few', syncedLyrics: null })])?.id).toBe(2);
    });

    it("doesn't let an instrumental flag close by end the search", () => {
      expect(pickBestRecord(TRACK, [longer, flaggedInstrumental(3)])?.id).toBe(2);
    });

    it('still takes the vote over all of them', () => {
      const flags = [3, 4, 5, 6, 7, 8, 9].map(flaggedInstrumental);

      expect(pickBestRecord(TRACK, [longer, ...flags])?.id).toBe(3);
      expect(pickBestRecord(TRACK, [longer, record({ id: 10, duration: 212, syncedLyrics: null }), ...flags])?.id).toBe(
        2,
      );
    });

    it('keeps the closest flag when there are only flags', () => {
      const farFlag = record({ id: 2, duration: 210, instrumental: true, plainLyrics: null, syncedLyrics: null });
      const closeFlag = { ...flaggedInstrumental(3), albumName: 'Other' };

      expect(pickBestRecord(TRACK, [farFlag, closeFlag])?.id).toBe(3);
      expect(pickBestRecord(TRACK, [farFlag])?.id).toBe(2);
    });

    it("doesn't reopen a vote the closest records settled between words and flags", () => {
      const flags = [3, 4, 5, 6, 7, 8, 9].map(flaggedInstrumental);
      const farWords = [10, 11, 12].map((id) => record({ id, duration: 210, syncedLyrics: null }));

      expect(pickBestRecord(TRACK, [plainOnly(), ...flags, ...farWords])?.id).toBe(3);
    });
  });

  it('returns null when nothing is the same song or nothing has words', () => {
    expect(pickBestRecord(TRACK, [record({ trackName: 'Other' })])).toBeNull();
    expect(pickBestRecord(TRACK, [record({ plainLyrics: 'too few', syncedLyrics: null })])).toBeNull();
    expect(pickBestRecord(TRACK, [])).toBeNull();
  });

  describe('when the best within 2 s is plain', () => {
    const syncAt = (id: number, duration: number, overrides: Partial<LrclibRecord> = {}) =>
      record({ id, duration, albumName: 'Other', ...overrides });

    it('takes a sync up to 5 s off', () => {
      expect(pickBestRecord(TRACK, [plainOnly(), syncAt(2, 205)])?.id).toBe(2);
      expect(pickBestRecord(TRACK, [plainOnly(), syncAt(2, 195)])?.id).toBe(2);
    });

    it('stays plain past 5 s, where sync is no use', () => {
      expect(pickBestRecord(TRACK, [plainOnly(), syncAt(2, 205.5)])?.id).toBe(1);
    });

    it('stays plain when the sync holds too few of the words', () => {
      const long = record({ plainLyrics: wordsOf(100), syncedLyrics: null });
      const short = (words: number) => syncAt(2, 204, { syncedLyrics: `[00:10.00] ${wordsOf(words)}` });

      expect(pickBestRecord(TRACK, [long, short(69)])?.id).toBe(1);
      expect(pickBestRecord(TRACK, [long, short(70)])?.id).toBe(2);
    });

    it("doesn't swap it for plain lyrics further off", () => {
      const close = record({ id: 2, albumName: 'Other', syncedLyrics: null });
      const onTheAlbum = record({ id: 3, duration: 204, syncedLyrics: null });

      expect(pickBestRecord(TRACK, [close, onTheAlbum])?.id).toBe(2);
    });

    it('ignores a flag among them', () => {
      expect(pickBestRecord(TRACK, [plainOnly(), syncAt(2, 204, { instrumental: true })])?.id).toBe(1);
    });

    it('still needs the same song', () => {
      expect(pickBestRecord(TRACK, [plainOnly(), syncAt(2, 204, { artistName: 'Someone Else' })])?.id).toBe(1);
    });

    it('leaves a sync within 2 s alone, even one that stops partway', () => {
      const partly = record({ id: 3, syncedLyrics: SYNCED_PARTLY });

      expect(pickBestRecord(TRACK, [partly, syncAt(2, 204)])?.id).toBe(3);
    });
  });
});

describe('titlesNearlyMatch', () => {
  it.each([
    ['Whole Lot Of Rosy', 'Whole Lot Of Rsoy'],
    ['Soft Hands', 'Soft Sands'],
    ['Peanuts', 'Peanut'],
    ['U.F.O. Ninja', 'UFO Ninja (Main Version)'],
    ['Pinã Colada Ville', 'PinaColadaVille'],
    ["Don't Stop The Feeling Of Billie's Face", "Don't Stop Feeling Of Billie's Face"],
    ['Dirty Deeds Done', 'Dirty Deeds Done Cheap'],
    ['Stand Up Acustic', 'Stand Up'],
    ['Everybody Movin, Part 2', "Everybody Movin' (Guy Remix)"],
    ["Let's Fall in Love", "Let's Do It (Let's Fall In Love)"],
    ['Side A 1- Dream On', 'Dream On'],
  ])('%s is close enough to %s', (a, b) => {
    expect(titlesNearlyMatch(a, b)).toBe(true);
    expect(titlesNearlyMatch(b, a)).toBe(true);
  });

  it.each([
    ['Human', 'Humans Again'],
    ['Love', 'Love Me'],
    ['Song 1', 'Song 2'],
    ['Song II', 'Song III'],
    ['Hello', 'Help'],
    ['Soft Hands', 'Hard Sands'],
    ['Whole Lot Rosy', 'Whale Lit Rusy'],
    ['Cold', 'Gold'],
  ])('%s is not %s', (a, b) => {
    expect(titlesNearlyMatch(a, b)).toBe(false);
  });
});

describe('trackNamedInTitle', () => {
  const upload = (title: string) => ({ ...TRACK, artist: 'A Channel', album: 'A Channel', title });

  it('reads the artist out of the title', () => {
    expect(trackNamedInTitle(upload('The Band - Their Song (Some Remix)'))).toEqual({
      ...upload('Their Song (Some Remix)'),
      artist: 'The Band',
    });
  });

  it('leaves featured artists out of both', () => {
    expect(trackNamedInTitle(upload('The Band feat. Someone - Their Song'))?.artist).toBe('The Band');
    expect(trackNamedInTitle(upload('The Band ft. Someone - Their Song'))?.artist).toBe('The Band');
    expect(trackNamedInTitle(upload('The Band - Their Song feat. Someone'))?.title).toBe('Their Song');
  });

  it('wants exactly one dash with spaces around it', () => {
    expect(trackNamedInTitle(upload('Their Song'))).toBeNull();
    expect(trackNamedInTitle(upload('Twenty-One'))).toBeNull();
    expect(trackNamedInTitle(upload('Concerto - Allegro - Live'))).toBeNull();
  });
});

describe('pickLooseRecord', () => {
  const singer = { artistName: 'The Singer', albumName: 'Elsewhere' };

  describe('a soundtrack whose album only its artist tag names', () => {
    const film: LrclibTrack = { title: 'Theme', artist: 'A Film', album: 'Greatest Songs', durationMs: 200_000 };
    const onFilmAlbum = (overrides: Partial<LrclibRecord> = {}) =>
      record({ ...singer, trackName: 'Theme', albumName: 'A Film (Music From The Motion Picture)', ...overrides });

    it('takes the song', () => {
      expect(isSameSong(film, onFilmAlbum())).toBe(false);
      expect(pickBestRecord(film, [onFilmAlbum()])).toBeNull();
      expect(pickLooseRecord(film, [onFilmAlbum()])?.id).toBe(1);
    });

    it('takes it on an album named after the song too', () => {
      const titleSong = { ...film, title: 'A Film', album: 'A Film' };

      expect(pickLooseRecord(titleSong, [onFilmAlbum({ trackName: 'A Film' })])?.id).toBe(1);
    });

    it('prefers a close length, and looks out to 15 s', () => {
      const close = onFilmAlbum({ id: 2 });
      const far = onFilmAlbum({ id: 3, duration: 210 });
      const tooFar = onFilmAlbum({ id: 4, duration: 216 });

      expect(pickLooseRecord(film, [far, close])?.id).toBe(2);
      expect(pickLooseRecord(film, [far])?.id).toBe(3);
      expect(pickLooseRecord(film, [tooFar])).toBeNull();
    });

    it('takes a close length over the album the tag names further off', () => {
      const tagged = { ...film, album: 'A Film Songs' };
      const close = onFilmAlbum({ id: 2, syncedLyrics: null });
      const far = onFilmAlbum({ id: 3, duration: 210, albumName: 'A Film Songs', syncedLyrics: null });

      expect(pickLooseRecord(tagged, [far, close])?.id).toBe(2);
    });

    it('wants the same title, and the whole artist in the album', () => {
      expect(pickLooseRecord(film, [onFilmAlbum({ trackName: 'Other' })])).toBeNull();
      expect(pickLooseRecord(film, [onFilmAlbum({ albumName: 'Filmography' })])).toBeNull();
    });
  });

  describe('"Artist - Title" in the title tag', () => {
    const channel: LrclibTrack = {
      title: 'The Singer - Their Song (Some Remix)',
      artist: 'A Channel',
      album: 'A Channel',
      durationMs: 200_000,
    };
    const named = (overrides: Partial<LrclibRecord> = {}) =>
      record({ ...singer, trackName: 'Their Song (Some Remix)', ...overrides });

    it('takes the named artist and title', () => {
      expect(pickLooseRecord(channel, [named()])?.id).toBe(1);
    });

    it('prefers the remix it names to the original', () => {
      const original = named({ id: 2, trackName: 'Their Song' });
      const remix = named({ id: 3 });

      expect(pickLooseRecord(channel, [original, remix])?.id).toBe(3);
      expect(pickLooseRecord(channel, [original])?.id).toBe(2);
    });

    it('still wants the named artist', () => {
      expect(pickLooseRecord(channel, [named({ artistName: 'Someone Else' })])).toBeNull();
    });
  });

  describe('a title tag a little off', () => {
    const typo = { ...TRACK, title: 'Humen' };

    it('takes the same artist at the same length', () => {
      expect(pickLooseRecord(typo, [record()])?.id).toBe(1);
      expect(pickLooseRecord(typo, [record({ duration: 202 })])?.id).toBe(1);
    });

    it('wants the same artist', () => {
      expect(pickLooseRecord(typo, [record({ artistName: 'Someone Else' })])).toBeNull();
    });

    it('wants the same length', () => {
      expect(pickLooseRecord(typo, [record({ duration: 202.5 })])).toBeNull();
      expect(pickLooseRecord(typo, [record({ duration: 197.5 })])).toBeNull();
    });
  });

  describe('the same title at another length', () => {
    const clipped = { ...TRACK, durationMs: 180_000 };

    it('takes the words of a record longer than the file, without its timing', () => {
      const whole = record({ duration: 300 });

      expect(pickLooseRecord(clipped, [whole])?.id).toBe(1);
      expect(lyricsFrom(whole, clipped, 'loose')).toMatchObject({ status: 'found', syncedLrc: null, plainText: WORDS });
    });

    it('takes a record up to a minute shorter than the file', () => {
      expect(pickLooseRecord(clipped, [record({ duration: 120 })])?.id).toBe(1);
      expect(pickLooseRecord(clipped, [record({ duration: 119.5 })])).toBeNull();
    });

    it('wants the same name, not just the same base title', () => {
      expect(pickLooseRecord(clipped, [record({ duration: 300, trackName: 'Human (Live)' })])).toBeNull();
    });

    it('wants the same artist', () => {
      expect(pickLooseRecord(clipped, [record({ duration: 300, artistName: 'Someone Else' })])).toBeNull();
    });
  });

  it('never calls anything instrumental', () => {
    const typo = { ...TRACK, title: 'Humen' };

    expect(pickLooseRecord(typo, [flaggedInstrumental(2)])).toBeNull();
  });

  it('lets flags outvote a lone upload here too', () => {
    const typo = { ...TRACK, title: 'Humen' };
    const flags = [2, 3, 4, 5, 6, 7, 8].map(flaggedInstrumental);

    expect(pickLooseRecord(typo, [record(), ...flags])).toBeNull();
    expect(pickLooseRecord(typo, [record(), ...flags.slice(1)])?.id).toBe(1);
  });

  it('keeps instrumental and karaoke versions apart from the sung one', () => {
    const typo = { ...TRACK, title: 'Humen' };

    expect(pickLooseRecord(typo, [record({ trackName: 'Human (Karaoke)' })])).toBeNull();
  });

  it('turns to the next way of reading the tags when one finds only flags', () => {
    const film = { ...TRACK, artist: 'A Film', album: 'Other Songs' };
    const flagged = record({
      id: 2,
      ...singer,
      albumName: 'A Film Soundtrack',
      instrumental: true,
      plainLyrics: null,
      syncedLyrics: null,
    });
    const typoByFilm = record({
      id: 3,
      artistName: 'A Film',
      albumName: 'Elsewhere',
      trackName: 'Humen',
      syncedLyrics: null,
    });

    expect(pickLooseRecord(film, [flagged, typoByFilm])?.id).toBe(3);
  });
});

describe('mayAnswer', () => {
  it('takes a record that could be the same song at up to 15 s off', () => {
    expect(mayAnswer(TRACK, record({ duration: 215 }))).toBe(true);
  });

  it('takes a record only a loose reading could use', () => {
    expect(mayAnswer({ ...TRACK, title: 'Humen' }, record())).toBe(true);
    expect(mayAnswer({ ...TRACK, durationMs: 100_000 }, record({ duration: 300 }))).toBe(true);
    expect(mayAnswer({ ...TRACK, artist: 'A Film' }, record({ artistName: 'Other', albumName: 'A Film Songs' }))).toBe(
      true,
    );
    expect(
      mayAnswer(
        { ...TRACK, title: 'The Band - Their Song', artist: 'A Channel', album: null },
        record({ artistName: 'The Band', trackName: 'Their Song' }),
      ),
    ).toBe(true);
  });

  it('turns down the rest', () => {
    expect(mayAnswer(TRACK, record({ artistName: 'Someone Else', albumName: 'Other' }))).toBe(false);
    expect(mayAnswer(TRACK, record({ trackName: 'Humans Again' }))).toBe(false);
    expect(mayAnswer(TRACK, record({ duration: 120 }))).toBe(false);
    expect(mayAnswer(TRACK, record({ trackName: 'Human (Karaoke)', albumName: 'Other' }))).toBe(false);
  });
});

describe('lastTimestampSeconds', () => {
  it('finds the latest timestamp, whatever the order', () => {
    expect(lastTimestampSeconds('[01:02.50] b\n[00:10.00] a')).toBe(62.5);
    expect(lastTimestampSeconds('[00:10:50] colon form')).toBe(10.5);
    expect(lastTimestampSeconds('[00:05][00:15] two on a line')).toBe(15);
  });

  it('returns null when there are none', () => {
    expect(lastTimestampSeconds('just words [chorus]')).toBeNull();
    expect(lastTimestampSeconds('')).toBeNull();
  });

  it('copes with more stamps than a function can take as arguments', () => {
    expect(lastTimestampSeconds('[00:01.00] a\n'.repeat(200_000))).toBe(1);
  });
});
