/*
 * Downloads the bundled mpv build into resources/mpv and the sound model into resources/models, pinned by version and
 * SHA-256. Neither goes in git: run this once after cloning.
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

const MODEL_DIR = 'https://essentia.upf.edu/models';
const MODEL = {
  file: 'discogs-effnet-bsdynamic-1.onnx',
  url: `${MODEL_DIR}/feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx`,
  sha256: 'a280825b334797cf677939db8cd5762c0392aedd0ca6415dbc1cd083f045e43c',
};
// Non-commercial, so it stays out of git and its terms travel beside it.
const MODEL_LICENSE = {
  file: 'LICENSE.txt',
  url: `${MODEL_DIR}/LICENSE`,
  sha256: 'f0c076094cc08acb265ea3304ec522cf331917d19bdd271ed69f10ef174f3ea4',
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'resources', 'mpv');
const versionFile = join(target, '.version');
const modelsTarget = join(root, 'resources', 'models');
// System32's tar handles zip archives. Git Bash ships a different tar first on PATH.
const windowsTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

function isInstalled() {
  return (
    existsSync(join(target, 'mpv.exe')) &&
    existsSync(versionFile) &&
    readFileSync(versionFile, 'utf8').trim() === MPV.version
  );
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

function verify(bytes, name, sha256) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) throw new Error(`SHA-256 mismatch for ${name}: expected ${sha256}, got ${actual}`);
}

async function fetchModelFile({ file, url, sha256 }) {
  const path = join(modelsTarget, file);
  if (existsSync(path) && createHash('sha256').update(readFileSync(path)).digest('hex') === sha256) {
    console.log(`${file} already in resources/models`);
    return;
  }
  console.log(`Downloading ${url}`);
  const bytes = await download(url);
  verify(bytes, file, sha256);
  mkdirSync(modelsTarget, { recursive: true });
  writeFileSync(path, bytes);
  console.log(`${file} installed to resources/models`);
}

async function fetchMpv() {
  if (isInstalled()) {
    console.log(`mpv ${MPV.version} already in resources/mpv`);
    return;
  }
  const url = `https://github.com/mpv-player/mpv/releases/download/${MPV.version}/${MPV.asset}`;
  console.log(`Downloading ${url}`);
  const bytes = await download(url);
  verify(bytes, MPV.asset, MPV.sha256);

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
}

await fetchMpv();
await fetchModelFile(MODEL);
await fetchModelFile(MODEL_LICENSE);
