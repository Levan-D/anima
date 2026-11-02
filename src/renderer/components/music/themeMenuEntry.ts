import { CalendarDays } from 'lucide-react';
import { THEMES, type ThemeMark } from '@shared/themes';
import type { MenuEntry } from '@/components/ui/menuEntries';
import { markTheme, type ThemeTarget } from '@/lib/seasons';

function marksFor(target: ThemeTarget, what: string): MenuEntry[] {
  const item = (label: string, mark: ThemeMark, message: string): MenuEntry => ({
    kind: 'item',
    label,
    onSelect: () => markTheme(target, mark, message),
  });
  return [
    ...THEMES.map(({ id, label }) => item(label, id, `${what}: ${label}`)),
    item('No theme', 'none', `${what}: no theme`),
    item('Automatic', 'auto', `${what}: automatic`),
  ];
}

type Scope = { label: string; target: ThemeTarget };

/** For one song with its album and artist beside it, or for a selection. */
export function themeMenuEntry(scopes: readonly Scope[]): MenuEntry {
  return {
    kind: 'submenu',
    label: 'Season theme',
    icon: CalendarDays,
    entries: scopes.flatMap(({ label, target }): MenuEntry[] => [{ kind: 'label', label }, ...marksFor(target, label)]),
  };
}
