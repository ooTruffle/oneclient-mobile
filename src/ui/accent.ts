// The seed colour the whole Material 3 scheme is generated from (see scheme.ts):
// a preset, a custom hex, or the Material You wallpaper colour. Saved on this
// device only.

import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { getSystemAccent } from '../../modules/material-you';
import { PREFS, usePref } from '@/state/prefs';
import { DEFAULT_SEED } from './scheme';

/** Seed presets. Any colour works: the scheme picks readable tones from it. */
export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: 'Blue', value: DEFAULT_SEED },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Teal', value: '#0d9488' },
  { name: 'Slate', value: '#475569' },
];

const HEX = /^#?([0-9a-f]{6})$/i;

/** "#AbC123" / "abc123" → "#abc123", or null if it isn't a 6-digit hex colour. */
export function parseHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** Saved instead of a hex colour to follow the wallpaper (Material You). */
export const SYSTEM_ACCENT = 'system';

// The wallpaper colour, re-read when the app comes back to the foreground in
// case the wallpaper changed meanwhile.
let systemAccent = getSystemAccent();
const listeners = new Set<() => void>();
AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  const next = getSystemAccent();
  if (next !== systemAccent) {
    systemAccent = next;
    listeners.forEach((l) => l());
  }
});
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSystem = () => systemAccent;

export function useAccent(): {
  /** The colour the scheme is built from. Use useTheme() for actual UI colours. */
  seed: string;
  setAccent: (hexOrSystem: string) => void;
  /** Following the wallpaper colour. */
  isSystem: boolean;
  /** The wallpaper colour, or null where Material You isn't available (Android < 12, iOS, web). */
  systemAccent: string | null;
} {
  const [stored, setStored] = usePref(PREFS.accent, DEFAULT_SEED);
  const system = useSyncExternalStore(subscribe, getSystem, getSystem);
  const isSystem = stored === SYSTEM_ACCENT;
  const seed = (isSystem ? system : parseHex(stored)) ?? DEFAULT_SEED;
  return { seed, setAccent: setStored, isSystem, systemAccent: system };
}
