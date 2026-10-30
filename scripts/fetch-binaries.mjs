/*
 * Downloads the bundled mpv build into resources/mpv, pinned by version and
 * SHA-256. The binaries stay out of git; run this once after cloning.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MPV = {
  version: 'v0.41.0',
  asset: 'mpv-v0.41.0-x86_64-w64-mingw32.zip',
  sha256: 'a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de',
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'resources', 'mpv');
const versionFile = join(target, '.version');
// System32's tar handles zip archives. Git Bash ships a different tar first on PATH.
const windowsTar = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe');

function isInstalled() {
  return existsSync(join(target, 'mpv.exe')) && existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === MPV.version;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function extract(archive) {
  execFileSync(windowsTar, ['-xf', archive, '-C', target], { stdio: 'inherit' });
  rmSync(archive);
}

function verify(bytes) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== MPV.sha256) throw new Error(`SHA-256 mismatch for ${MPV.asset}: expected ${MPV.sha256}, got ${actual}`);
}

if (isInstalled()) {
  console.log(`mpv ${MPV.version} already in resources/mpv`);
  process.exit(0);
}

const url = `https://github.com/mpv-player/mpv/releases/download/${MPV.version}/${MPV.asset}`;
console.log(`Downloading ${url}`);
const bytes = await download(url);
verify(bytes);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const archive = join(target, MPV.asset);
writeFileSync(archive, bytes);
extract(archive);
// The release zip wraps a second zip that holds the actual build.
for (const name of readdirSync(target).filter((file) => file.endsWith('.zip'))) extract(join(target, name));
if (!existsSync(join(target, 'mpv.exe'))) throw new Error('mpv.exe missing after extraction');
writeFileSync(versionFile, `${MPV.version}\n`);
console.log(`mpv ${MPV.version} installed to resources/mpv`);
