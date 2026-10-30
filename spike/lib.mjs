/* Throwaway helpers for the Phase 0 mpv spike. Not app code. */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');
export const MPV = join(ROOT, 'resources', 'mpv', 'mpv.exe');
export const OUT = join(here, 'output');
mkdirSync(OUT, { recursive: true });

export const MUSIC = 'D:\\Music\\Nightwish\\Human II Nature\\Human\\Music.flac';
export const NOISE = 'D:\\Music\\Nightwish\\Human II Nature\\Human\\Noise.flac';

export const HEADLESS = [
  '--no-config', '--idle=yes', '--vid=no', '--audio-display=no', '--cover-art-auto=no',
  '--terminal=no', '--load-scripts=no', '--osc=no', '--ytdl=no',
  '--input-default-bindings=no', '--input-vo-keyboard=no', '--input-media-keys=no',
];

let pipeCounter = 0;
export function startMpv(extraArgs = [], { log = false } = {}) {
  const pipe = `\\\\.\\pipe\\mp-spike-${process.pid}-${++pipeCounter}`;
  const args = [...HEADLESS, `--input-ipc-server=${pipe}`, ...extraArgs];
  const child = spawn(MPV, args, { stdio: 'ignore', windowsHide: true });
  return connect(pipe, child, log);
}

async function connect(pipe, child, log) {
  const started = Date.now();
  for (;;) {
    try {
      const socket = await new Promise((ok, fail) => {
        const s = net.connect(pipe);
        s.once('connect', () => ok(s));
        s.once('error', fail);
      });
      return new Client(socket, child, log);
    } catch (error) {
      if (Date.now() - started > 8000) throw error;
      await sleep(30);
    }
  }
}

export class Client {
  constructor(socket, child, log) {
    this.socket = socket; this.child = child; this.log = log;
    this.nextId = 1; this.pending = new Map(); this.events = []; this.listeners = new Set();
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        this.onMessage(JSON.parse(line));
      }
    });
    socket.on('error', () => {});
  }
  onMessage(message) {
    if (message.request_id !== undefined && this.pending.has(message.request_id)) {
      const { ok } = this.pending.get(message.request_id);
      this.pending.delete(message.request_id);
      ok(message);
      return;
    }
    if (message.event) {
      const stamped = { t: Date.now(), ...message };
      this.events.push(stamped);
      if (this.log) console.log(JSON.stringify(stamped));
      for (const listener of this.listeners) listener(stamped);
    }
  }
  command(...args) {
    const request_id = this.nextId++;
    return new Promise((ok) => {
      this.pending.set(request_id, { ok });
      this.socket.write(`${JSON.stringify({ command: args, request_id })}\n`);
    });
  }
  async get(name) { const r = await this.command('get_property', name); return r.error === 'success' ? r.data : `<${r.error}>`; }
  set(name, value) { return this.command('set_property', name, value); }
  observe(id, name) { return this.command('observe_property', id, name); }
  waitFor(predicate, timeoutMs = 15000, label = 'event') {
    return new Promise((ok, fail) => {
      const existing = this.events.find(predicate);
      if (existing) return ok(existing);
      const timer = setTimeout(() => { this.listeners.delete(listener); fail(new Error(`timeout waiting for ${label}`)); }, timeoutMs);
      const listener = (event) => { if (predicate(event)) { clearTimeout(timer); this.listeners.delete(listener); ok(event); } };
      this.listeners.add(listener);
    });
  }
  clearEvents() { this.events = []; }
  async quit() {
    try { this.socket.write(`${JSON.stringify({ command: ['quit'] })}\n`); } catch {}
    await new Promise((ok) => { const t = setTimeout(() => { this.child.kill(); ok(); }, 2000); this.child.once('exit', () => { clearTimeout(t); ok(); }); });
  }
}

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
