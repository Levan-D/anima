/* Named EQ curves, kept per machine in the settings, and their files. The dialogs are here, so the renderer never sends a path. */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { EQ_AUTO_PREAMP, type AppSettings, type EqImport, type EqPreset, type EqSettings } from '@shared/domain';
import { err, ok, type Result } from '@shared/result';
import type { HandlerGroup } from '@main/ipc';
import type { SettingsStore } from '@main/settings/settings';
import { parseApoFile, writeApoFile } from './apoFile';
import { decodeText } from '@main/system/decodeText';

type Deps = {
  settings: SettingsStore;
  setEq: (eq: EqSettings) => Result<void>;
  pickFile: () => Promise<string | null>;
  pickSavePath: (suggestedName: string) => Promise<string | null>;
};

type ApplyDeps = Pick<Deps, 'settings' | 'setEq'>;

const sameName = (one: string, other: string) => one.toLowerCase() === other.toLowerCase();

/** `name`, or `name (2)` and on, whichever isn't taken. */
export function uniqueName(name: string, presets: readonly EqPreset[]): string {
  const isTaken = (candidate: string) => presets.some((preset) => sameName(preset.name, candidate));
  if (!isTaken(name)) return name;
  let number = 2;
  while (isTaken(`${name} (${number})`)) number++;
  return `${name} (${number})`;
}

function applyPreset({ settings, setEq }: ApplyDeps, { name, bands, preamp }: EqPreset): Result<AppSettings> {
  const set = setEq({ enabled: true, bands, preamp });
  return set.ok ? ok(settings.update({ eqPreset: name })) : set;
}

/** A preset file's text becomes a new preset under `baseName`, in use at once, with the preamp the file says. */
export function importEqPreset(deps: ApplyDeps, text: string, baseName: string): Result<EqImport> {
  const parsed = parseApoFile(text);
  if (!parsed.ok) return parsed;
  const { bands, preamp, clampedBands } = parsed.value;
  const { settings } = deps;
  const name = uniqueName(baseName, settings.get().eqPresets).slice(0, 100);
  settings.update({ eqPresets: [...settings.get().eqPresets, { name, bands, preamp }] });
  const applied = applyPreset(deps, { name, bands, preamp });
  return applied.ok ? ok({ settings: applied.value, clampedBands }) : applied;
}

/** A preset file's curve goes on the EQ, unsaved, for the person to keep under a name of their own or not. */
export function tryEqFile({ settings, setEq }: ApplyDeps, text: string): Result<EqImport> {
  const parsed = parseApoFile(text);
  if (!parsed.ok) return parsed;
  const { bands, preamp, clampedBands } = parsed.value;
  const set = setEq({ enabled: true, bands, preamp });
  return set.ok ? ok({ settings: settings.update({ eqPreset: null }), clampedBands }) : set;
}

export function eqPresetHandlers({ settings, setEq, pickFile, pickSavePath }: Deps) {
  const presets = () => settings.get().eqPresets;
  const find = (name: string) => presets().find((preset) => sameName(preset.name, name));
  const notThere = () => err('not_found', "That preset isn't there any more");
  const taken = (name: string) => err('name_taken', `There's already a preset called ${name}`);
  const apply = (preset: EqPreset) => applyPreset({ settings, setEq }, preset);

  return {
    'eq.applyPreset': ({ name }) => {
      const preset = find(name);
      return preset ? apply(preset) : notThere();
    },
    'eq.clearPreset': () => {
      const set = setEq({ enabled: false, bands: [], preamp: EQ_AUTO_PREAMP });
      return set.ok ? ok(settings.update({ eqPreset: null })) : set;
    },
    'eq.createPreset': ({ name }) => {
      if (find(name)) return taken(name);
      const { bands, preamp } = settings.get().eq;
      const preset = { name, bands, preamp };
      return ok(settings.update({ eqPresets: [...presets(), preset], eqPreset: name }));
    },
    'eq.savePreset': ({ name }) => {
      if (!find(name)) return notThere();
      const { bands, preamp } = settings.get().eq;
      return ok(
        settings.update({
          eqPresets: presets().map((preset) => (sameName(preset.name, name) ? { ...preset, bands, preamp } : preset)),
          eqPreset: name,
        }),
      );
    },
    'eq.renamePreset': ({ name, newName }) => {
      if (!find(name)) return notThere();
      if (!sameName(name, newName) && find(newName)) return taken(newName);
      const { eqPreset } = settings.get();
      return ok(
        settings.update({
          eqPresets: presets().map((preset) => (sameName(preset.name, name) ? { ...preset, name: newName } : preset)),
          eqPreset: eqPreset !== null && sameName(eqPreset, name) ? newName : eqPreset,
        }),
      );
    },
    'eq.deletePreset': ({ name }) => {
      const { eqPreset } = settings.get();
      return ok(
        settings.update({
          eqPresets: presets().filter((preset) => !sameName(preset.name, name)),
          eqPreset: eqPreset !== null && sameName(eqPreset, name) ? null : eqPreset,
        }),
      );
    },
    /** Null if cancelled. */
    'eq.importPreset': async () => {
      const path = await pickFile();
      if (path === null) return ok(null);
      let text: string;
      try {
        text = decodeText(readFileSync(path));
      } catch {
        return err('invalid_eq_file', "That file couldn't be read");
      }
      return importEqPreset({ settings, setEq }, text, basename(path, extname(path)));
    },
    /** False if cancelled. */
    'eq.exportPreset': async ({ name }) => {
      const preset = find(name);
      if (!preset) return notThere();
      const path = await pickSavePath(`${preset.name.replace(/[<>:"/\\|?*]/g, '-')}.txt`);
      if (path === null) return ok(false);
      try {
        writeFileSync(path, writeApoFile(preset.bands, preset.preamp));
      } catch {
        return err('eq_file_not_written', "That file couldn't be written");
      }
      return ok(true);
    },
  } satisfies HandlerGroup;
}
