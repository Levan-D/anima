import { describe, expect, it } from 'vitest';
import { addressOf, checkAddress, ONLINE_SERVICES_DEFAULT } from './onlineServices';

describe('checkAddress', () => {
  it('takes https anywhere, without a trailing slash', () => {
    expect(checkAddress('  https://lyrics.example.org/api/  ')).toEqual({
      ok: true,
      value: 'https://lyrics.example.org/api',
    });
    expect(checkAddress('https://mirror.example:8443')).toEqual({ ok: true, value: 'https://mirror.example:8443' });
  });

  it('takes plain http only on this PC or the home network', () => {
    for (const address of [
      'http://localhost:3000',
      'http://127.0.0.1/api',
      'http://192.168.1.20:8080',
      'http://10.0.0.5',
      'http://172.20.1.1',
      'http://nas.local',
    ]) {
      expect(checkAddress(address).ok, address).toBe(true);
    }
    for (const address of ['http://lrclib.net/api', 'http://172.32.0.1', 'ftp://example.org']) {
      expect(checkAddress(address).ok, address).toBe(false);
    }
  });

  it('refuses what requests could not be built on', () => {
    for (const address of [
      'lrclib.net',
      '',
      'https://a.example/api?key=1',
      'https://a.example/#top',
      'https://me:pw@a.example',
    ]) {
      expect(checkAddress(address).ok, address).toBe(false);
    }
  });
});

describe('addressOf', () => {
  it("is the service's own until one is set", () => {
    expect(addressOf(ONLINE_SERVICES_DEFAULT, 'lrclib')).toBe('https://lrclib.net/api');
    const moved = {
      ...ONLINE_SERVICES_DEFAULT,
      lrclib: { isOn: true, address: 'https://mirror.example/api', script: null },
    };
    expect(addressOf(moved, 'lrclib')).toBe('https://mirror.example/api');
  });
});
