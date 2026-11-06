import { describe, expect, it } from 'vitest';
import { RADIO_ENERGY_DEFAULT } from '@shared/domain';
import { SEASONS_DEFAULT } from '@shared/themes';
import { COMMAND_NAMES, type CommandName } from '@shared/ipc/channels';
import { commands, eqSettingsSchema } from '@shared/ipc/contract';

const NO_INPUT_COMMANDS: CommandName[] = [
  'library.status',
  'library.chooseFolder',
  'library.retryOpen',
  'library.restoreBackup',
  'library.rebuild',
  'library.artists',
  'library.genres',
  'library.removeMissing',
  'scan.start',
  'scan.cancel',
  'scan.state',
  'scan.issues',
  'player.state',
  'player.position',
  'player.queue',
  'player.toggle',
  'player.pause',
  'player.resume',
  'player.stop',
  'player.next',
  'player.previous',
  'player.clearQueue',
  'player.retry',
  'radio.preview',
  'radio.startOptions',
  'seasons.contents',
  'eq.clearPreset',
  'headphones.state',
  'playlist.list',
  'stats.summary',
  'settings.get',
  'system.storageInfo',
  'window.state',
  'window.toggleFullscreen',
];

/** One valid input for each command that takes one. */
const VALID_INPUTS: { [N in CommandName]?: unknown } = {
  'library.artist': { artistId: 1 },
  'report.tracks': { checkId: 'missing' },
  'library.artistsInGenre': { genreId: 2 },
  'eq.applyPreset': { name: 'A' },
  'eq.createPreset': { name: 'A' },
  'eq.savePreset': { name: 'A' },
  'eq.renamePreset': { name: 'A', newName: 'B' },
  'eq.deletePreset': { name: 'A' },
  'eq.exportPreset': { name: 'A' },
  'headphones.curve': { kind: 'measurement', id: 1 },
  'headphones.import': {
    kind: 'target',
    name: 'A',
    source: 'B',
    rig: { family: 'unknown', detail: null },
    form: null,
  },
  'headphones.select': { measurementId: 1, targetId: null },
  'headphones.remove': { kind: 'target', id: 1 },
  'headphones.setOption': { bassDb: 4 },
  'headphones.usePreset': { measurementId: 1 },
  'headphones.match': { measurementId: 1, targetId: 2 },
  'headphones.setMatch': { measurementId: 1, setting: { seal: 'varies' } },
  'headphones.compare': { on: true, sampleRate: 44_100 },
  'autoeq.search': { query: 'acme' },
  'autoeq.fetch': { entryId: 1 },
  'library.albums': { artistId: null, genreId: 2 },
  'library.album': { albumId: 1 },
  'library.tracks': { filter: { kind: 'genre', genreId: 3 } },
  'library.search': { query: 'nightwish' },
  'player.play': { trackIds: [1, 2], startIndex: 0 },
  'player.playQueueIndex': { index: 0 },
  'player.seek': { positionMs: 1000 },
  'player.setVolume': { volume: 50 },
  'player.setMuted': { muted: true },
  'player.setOutputMode': { mode: 'exclusive' },
  'player.setReplayGainMode': { mode: 'track' },
  'player.setEq': { eq: { enabled: true, bands: [], preamp: { auto: true, db: 0 } } },
  'player.setEndless': { on: true },
  'radio.play': { trackId: null },
  'radio.start': {
    from: {
      kind: 'blend',
      parts: [
        { kind: 'track', id: 1 },
        { kind: 'artist', id: 2 },
      ],
    },
    wander: 0.5,
  },
  'radio.setWander': { wander: 1 },
  'radio.setEnergy': { energy: RADIO_ENERGY_DEFAULT },
  'seasons.set': { seasons: SEASONS_DEFAULT },
  'seasons.mark': { target: { kind: 'album', albumId: 1 }, mark: 'none' },
  'player.enqueue': { trackIds: [1], where: 'next' },
  'player.removeFromQueue': { queueIds: [1] },
  'player.moveInQueue': { queueIds: [1], toIndex: 0 },
  'playlist.get': { playlistId: 1 },
  'playlist.create': { name: 'Road trip', trackIds: [] },
  'playlist.save': { playlistId: 1, name: 'Road trip', trackIds: [2, 1] },
  'playlist.export': { playlistId: 1 },
  'playlist.delete': { playlistId: 1 },
  'playlist.addTracks': { playlistId: 1, trackIds: [1], index: null },
  'playlist.removeMissing': { playlistId: 1 },
  'lyrics.get': { trackId: 1 },
  'lyrics.refresh': { trackId: 1 },
  'lyrics.setOffset': { trackId: 1, offsetMs: -500 },
  'lyrics.search': { query: 'plum pear' },
  'lyrics.choose': { trackId: 1, recordId: 2 },
  'lyrics.loadFile': { trackId: 1 },
  'lyrics.paste': { trackId: 1, text: 'A line' },
  'lyrics.clear': { trackId: 1 },
  'waveform.get': { trackId: 1 },
  'recommend.discoverDetail': { key: 'radiohead' },
  'recommend.similarToTrack': { trackId: 1 },
  'recommend.similarToPlaylist': { playlistId: 1 },
  'data.update': { dataset: 'lyrics' },
  'data.cancel': { dataset: null },
  'settings.update': { uiScale: 1.5 },
  'system.revealTrack': { trackId: 1 },
  'system.revealPath': { target: 'logs' },
  'system.logError': { message: 'boom', stack: null },
  'window.setMiniPlayer': { enabled: true },
};

describe('the command list', () => {
  it('names every command exactly once', () => {
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
  });
});

describe('command inputs', () => {
  it.each(COMMAND_NAMES)('%s accepts a valid input', (name) => {
    const input = NO_INPUT_COMMANDS.includes(name) ? undefined : VALID_INPUTS[name];
    expect(commands[name].input.safeParse(input).success).toBe(true);
  });

  it.each(COMMAND_NAMES)('%s rejects junk', (name) => {
    for (const junk of ['a string', 42, null, [], { sneaky: true }]) {
      expect(commands[name].input.safeParse(junk).success, JSON.stringify(junk)).toBe(false);
    }
  });

  it('never takes a file path where it wants an id', () => {
    expect(commands['system.revealTrack'].input.safeParse({ trackId: 'D:\\Music\\a.flac' }).success).toBe(false);
    expect(commands['system.revealPath'].input.safeParse({ target: 'D:\\Music' }).success).toBe(false);
  });

  it.each([
    ['ids must be positive', 'library.album', { albumId: 0 }],
    ['ids must be integers', 'library.album', { albumId: 1.5 }],
    ['unknown keys are refused', 'library.album', { albumId: 1, extra: true }],
    ['unknown filters are refused', 'library.tracks', { filter: { kind: 'everything' } }],
    ['volume stays in range', 'player.setVolume', { volume: 101 }],
    ['a seek is never negative', 'player.seek', { positionMs: -1 }],
    ['the interface scale stays in range', 'settings.update', { uiScale: 99 }],
    ['a settings update names a setting', 'settings.update', {}],
    ['a settings update names one setting', 'settings.update', { uiScale: 1.5, fetchLyricsOnline: true }],
    ['a settings update has no optional fields', 'settings.update', { uiScale: undefined }],
    ['stay-awake modes are known ones', 'settings.update', { stayAwake: { pluggedIn: 'always', onBattery: 'off' } }],
    ['a playlist needs a name', 'playlist.create', { name: '   ', trackIds: [] }],
    ['settings the renderer may not change', 'settings.update', { libraryFolder: 'D:\\Music' }],
  ] as const)('%s', (_rule, name, input) => {
    expect(commands[name].input.safeParse(input).success).toBe(false);
  });
});

describe('eqSettingsSchema', () => {
  const band = { id: 0, kind: 'peak', frequencyHz: 1000, gainDb: 3, q: 1 };
  const preamp = { auto: true, db: 0 };

  it('accepts a band', () => {
    expect(eqSettingsSchema.safeParse({ enabled: true, bands: [band], preamp }).success).toBe(true);
  });

  it('refuses a band outside the audible range', () => {
    const bad = { ...band, frequencyHz: 5 };
    expect(eqSettingsSchema.safeParse({ enabled: true, bands: [bad], preamp }).success).toBe(false);
    expect(eqSettingsSchema.safeParse({ enabled: true, bands: [{ ...band, gainDb: 12.5 }], preamp }).success).toBe(
      false,
    );
  });
});
