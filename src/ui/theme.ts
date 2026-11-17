// Material 3 theme: colours come from the scheme generated from the accent
// seed, so they change at runtime. Read them with useTheme(), or build styles
// with makeStyles() — never with a module-level StyleSheet, which would freeze
// the colours from when the module loaded.

import { StyleSheet, type TextStyle } from 'react-native';
import { useAccent } from './accent';
import { schemeFor, type Scheme } from './scheme';

export type { Scheme } from './scheme';
export { withAlpha } from './scheme';

export function useTheme(): Scheme {
  return schemeFor(useAccent().seed);
}

/**
 * `const useStyles = makeStyles((c) => ({ box: { backgroundColor: c.surface } }))`
 * then `const styles = useStyles()` in the component. Built once per scheme.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(build: (c: Scheme) => T): () => T {
  const cache = new WeakMap<Scheme, T>();
  return function useStyles() {
    const scheme = useTheme();
    let styles = cache.get(scheme);
    if (!styles) {
      styles = StyleSheet.create(build(scheme));
      cache.set(scheme, styles);
    }
    return styles;
  };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/** M3 shape scale. */
export const radius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 28, pill: 999 };

/** M3 type scale (Roboto on Android, the system font elsewhere). */
export const type = {
  headlineSmall: { fontSize: 24, lineHeight: 32, fontWeight: '400' },
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: '400' },
  titleMedium: { fontSize: 16, lineHeight: 24, fontWeight: '500', letterSpacing: 0.15 },
  titleSmall: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0.5 },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: 0.25 },
  bodySmall: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0.4 },
  labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 },
  labelSmall: { fontSize: 11, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 },
} satisfies Record<string, TextStyle>;
