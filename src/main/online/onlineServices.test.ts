import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/domain';
import { ONLINE_SERVICES_DEFAULT } from '@shared/onlineServices';
import { err, ok } from '@shared/result';
import { DEFAULT_SETTINGS } from '@main/settings/settings';
import { onlineServiceHandlers, serviceWhere } from './onlineServices';

function harness() {
  let settings: AppSettings = DEFAULT_SETTINGS;
  const store = {
    get: () => settings,
    update(patch: Partial<AppSettings>) {
      settings = { ...settings, ...patch };
      return settings;
    },
  };
  const onChange = vi.fn();
  let clock = 0;
  const lrclibTest = vi.fn(() => {
    clock += 240;
    return Promise.resolve(ok());
  });
  const handlers = onlineServiceHandlers({
    settings: store,
    tests: {
      lrclib: lrclibTest,
      musicbrainz: () => Promise.resolve(err('network', "Couldn't reach mb.example")),
      listenbrainz: () => Promise.resolve(ok({ note: 'It found timed lyrics for Adele, Hello' })),
      autoeq: () => Promise.resolve(ok()),
    },
    onChange,
    now: () => clock,
  });
  return { handlers, store, onChange, lrclibTest };
}

describe('online.set', () => {
  it('keeps a checked address, and a client reads it from then on', () => {
    const { handlers, store, onChange } = harness();
    const where = serviceWhere(store, 'lrclib');
    expect(where.address()).toBe('https://lrclib.net/api');

    expect(handlers['online.set']({ service: 'lrclib', address: ' https://mirror.example/api/ ' }).ok).toBe(true);

    expect(where.address()).toBe('https://mirror.example/api');
    expect(store.get().onlineServices.lrclib).toEqual({
      isOn: true,
      address: 'https://mirror.example/api',
      script: null,
    });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('refuses an address that does not pass, and changes nothing', () => {
    const { handlers, store, onChange } = harness();
    const refused = handlers['online.set']({ service: 'lrclib', address: 'http://lyrics.example.org' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(store.get().onlineServices).toEqual(ONLINE_SERVICES_DEFAULT);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes the service's own address, typed or as null, as going back to it", () => {
    const { handlers, store } = harness();
    handlers['online.set']({ service: 'musicbrainz', address: 'https://mb.example/ws/2' });
    handlers['online.set']({ service: 'musicbrainz', address: 'https://musicbrainz.org/ws/2/' });
    expect(store.get().onlineServices.musicbrainz.address).toBeNull();

    handlers['online.set']({ service: 'musicbrainz', address: 'https://mb.example/ws/2' });
    handlers['online.set']({ service: 'musicbrainz', address: null });
    expect(store.get().onlineServices.musicbrainz.address).toBeNull();
  });

  it('turns one off without forgetting its address, and leaves the others alone', () => {
    const { handlers, store } = harness();
    handlers['online.set']({ service: 'lrclib', address: 'https://mirror.example/api' });
    handlers['online.set']({ service: 'lrclib', isOn: false });

    expect(store.get().onlineServices.lrclib).toEqual({
      isOn: false,
      address: 'https://mirror.example/api',
      script: null,
    });
    expect(serviceWhere(store, 'lrclib').isOn()).toBe(false);
    expect(store.get().onlineServices.listenbrainz).toEqual(ONLINE_SERVICES_DEFAULT.listenbrainz);
  });
});

describe('a script in place of a service', () => {
  it('is kept for one that can take one, and goes with null or nothing but spaces', () => {
    const { handlers, store, onChange } = harness();
    expect(handlers['online.set']({ service: 'lrclib', script: 'function request() {}' }).ok).toBe(true);
    expect(store.get().onlineServices.lrclib).toEqual({ isOn: true, address: null, script: 'function request() {}' });
    expect(onChange).toHaveBeenCalledOnce();

    handlers['online.set']({ service: 'lrclib', isOn: false });
    expect(store.get().onlineServices.lrclib.script).toBe('function request() {}');
    handlers['online.set']({ service: 'lrclib', script: '   ' });
    expect(store.get().onlineServices.lrclib.script).toBeNull();
    handlers['online.set']({ service: 'lrclib', script: 'function request() {}' });
    handlers['online.set']({ service: 'lrclib', script: null });
    expect(store.get().onlineServices.lrclib.script).toBeNull();
  });

  it('is refused for one that cannot take one yet', () => {
    const { handlers, store } = harness();
    expect(handlers['online.set']({ service: 'musicbrainz', script: 'function request() {}' })).toMatchObject({
      ok: false,
      error: { message: "A script can't stand in for MusicBrainz yet" },
    });
    expect(store.get().onlineServices.musicbrainz.script).toBeNull();
  });
});

describe('online.test', () => {
  it('passes on what a test made of the answer', async () => {
    const { handlers } = harness();
    expect(await handlers['online.test']({ service: 'listenbrainz' })).toEqual({
      ok: true,
      value: { ms: 0, note: 'It found timed lyrics for Adele, Hello' },
    });
  });

  it('says how long a working one took', async () => {
    const { handlers, lrclibTest } = harness();
    expect(await handlers['online.test']({ service: 'lrclib' })).toEqual({ ok: true, value: { ms: 240, note: null } });
    expect(lrclibTest).toHaveBeenCalledOnce();
  });

  it('passes on what went wrong', async () => {
    const { handlers } = harness();
    expect(await handlers['online.test']({ service: 'musicbrainz' })).toMatchObject({
      ok: false,
      error: { message: "Couldn't reach mb.example" },
    });
  });
});
