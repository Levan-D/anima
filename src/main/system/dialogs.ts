/* The file pickers. Each is null when cancelled. Electron would start in Downloads, so each says where to start. */

import { join } from 'node:path';
import { app, BrowserWindow, dialog, type FileFilter, type OpenDialogOptions } from 'electron';

/** Over whichever window has focus, so it can't end up behind the app. */
async function openOne(options: OpenDialogOptions): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await (owner
    ? dialog.showOpenDialog(owner, options)
    : dialog.showOpenDialog(options));
  return canceled ? null : (filePaths[0] ?? null);
}

function openFile(title: string, filters: FileFilter[]): Promise<string | null> {
  return openOne({ title, defaultPath: app.getPath('documents'), filters, properties: ['openFile'] });
}

async function saveTo(title: string, suggestedName: string, filters: FileFilter[]): Promise<string | null> {
  const options = { title, defaultPath: join(app.getPath('documents'), suggestedName), filters };
  const owner = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await (owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options));
  return canceled || filePath === '' ? null : filePath;
}

const EQ_FILES = [{ name: 'Equalizer APO preset', extensions: ['txt'] }];

export const pickEqFile = () => openFile('Import an equalizer preset', EQ_FILES);
export const pickEqSavePath = (suggestedName: string) => saveTo('Export an equalizer preset', suggestedName, EQ_FILES);
export const pickFrequencyResponse = () =>
  openFile('Import a frequency response', [{ name: 'Frequency response', extensions: ['csv', 'txt'] }]);
export const pickLyricsLibrary = () =>
  openFile('Choose a lyrics library', [{ name: 'Lyrics library', extensions: ['db'] }]);
export const pickLyricsFile = () =>
  openFile('Load lyrics for this track', [{ name: 'Lyrics', extensions: ['lrc', 'txt'] }]);
export const pickPlaylistFile = () =>
  openFile('Import a playlist', [{ name: 'Playlist', extensions: ['m3u8', 'm3u'] }]);
export const pickPlaylistSavePath = (suggestedName: string) =>
  saveTo('Export a playlist', suggestedName, [{ name: 'Playlist', extensions: ['m3u8'] }]);

export function pickFolder(defaultPath: string | null): Promise<string | null> {
  return openOne({
    title: 'Choose your music folder',
    defaultPath: defaultPath ?? app.getPath('music'),
    properties: ['openDirectory'],
  });
}
