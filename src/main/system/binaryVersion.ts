import { execFile } from 'node:child_process';

const TIMEOUT_MS = 5_000;

const known = new Map<string, Promise<string | null>>();

export function askTheBinary(path: string, args: string[], pattern: RegExp): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(path, args, { windowsHide: true, timeout: TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? null : (pattern.exec(stdout)?.[1] ?? null));
    });
  });
}

/** A bundled binary can't change while the app runs, so this only looks once. */
export function versionOnce(path: string, read: () => Promise<string | null>): Promise<string | null> {
  const asked = known.get(path) ?? read();
  known.set(path, asked);
  return asked;
}

export function ffmpegVersion(path: string): Promise<string | null> {
  return versionOnce(path, () => askTheBinary(path, ['-hide_banner', '-version'], /^ffmpeg version (\S+)/));
}
