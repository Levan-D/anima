import { describe, expect, it } from 'vitest';
import { runScript } from './sandbox';

const run = (script: string, name = 'f', args: unknown[] = [], timeoutMs = 250) =>
  runScript({ script, name, args, timeoutMs });

function messageOf(result: Awaited<ReturnType<typeof runScript>>): string | null {
  return result.ok ? null : result.error.message;
}

describe('runScript', () => {
  it('calls the function with plain data and gives back plain data', async () => {
    const script = 'function f(track, n) { return { title: track.title.toUpperCase(), twice: n * 2, none: null } }';
    expect(await run(script, 'f', [{ title: 'plum' }, 21])).toEqual({
      ok: true,
      value: { title: 'PLUM', twice: 42, none: null },
    });
  });

  it('takes nothing back as null', async () => {
    expect(await run('function f() {}')).toEqual({ ok: true, value: null });
  });

  it('says when the function is not there, or the script does not read', async () => {
    expect(messageOf(await run('function g() { return 1 }'))).toBe('Your script has no f function');
    expect(messageOf(await run('function f( {'))).toMatch(/^Your script failed: SyntaxError/);
  });

  it('passes on what the script threw', async () => {
    expect(messageOf(await run("function f() { throw new TypeError('no plums') }"))).toBe(
      'Your script failed: TypeError: no plums',
    );
  });

  it('stops a script that runs forever, in about the time it was given', async () => {
    const startedAt = performance.now();
    const result = await run('function f() { while (true) {} }', 'f', [], 100);
    expect(messageOf(result)).toBe('Your script took longer than 100 ms, so it was stopped');
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  it('stops one that runs forever before it is even called', async () => {
    expect(messageOf(await run('for (;;) {}\nfunction f() { return 1 }', 'f', [], 100))).toMatch(/longer than 100 ms/);
  });

  it('stops one that eats memory, and one that recurses without end, without taking the app down', async () => {
    const hungry = await run("function f() { let s = 'x'; for (;;) s += s; }", 'f', [], 5_000);
    expect(hungry.ok).toBe(false);
    const deep = await run('function f() { return f() + 1 }', 'f', [], 5_000);
    expect(messageOf(deep)).toMatch(/^Your script failed/);
    // Still working after both.
    expect(await run('function f() { return 1 }')).toEqual({ ok: true, value: 1 });
  });

  it('reaches nothing outside: no Node, no network, no timers, no host modules', async () => {
    const script = `function f() {
      return [typeof require, typeof process, typeof fetch, typeof XMLHttpRequest, typeof setTimeout,
        typeof std, typeof os, typeof Deno, typeof module, typeof globalThis.electron];
    }`;
    expect(await run(script)).toEqual({ ok: true, value: Array.from({ length: 10 }, () => 'undefined') });
  });

  it('starts every call fresh, so nothing carries from one song to the next', async () => {
    const script =
      'var calls = 0; function f() { globalThis.seen = (globalThis.seen ?? 0) + 1; return ++calls + seen }';
    expect(await run(script)).toEqual({ ok: true, value: 2 });
    expect(await run(script)).toEqual({ ok: true, value: 2 });
  });

  it('has the language a script needs to read an answer', async () => {
    const script = `function f(body) {
      const data = JSON.parse(body);
      return [encodeURIComponent('a b&c'), data.lines.map((line) => line.trim()).join('|'), /\\d+/.exec('at 42')[0]];
    }`;
    expect(await run(script, 'f', ['{"lines":[" one ","two "]}'])).toEqual({
      ok: true,
      value: ['a%20b%26c', 'one|two', '42'],
    });
  });
});
