// Material You wallpaper colour. Android 12+ only; null everywhere else
// (older Android, iOS, web), so callers fall back to a fixed accent.
import { requireOptionalNativeModule } from 'expo';

interface MaterialYouModule {
  getAccent(): string | null;
}

const native = requireOptionalNativeModule<MaterialYouModule>('MaterialYou');

/** "#rrggbb" from the current wallpaper, or null if the device can't say. */
export function getSystemAccent(): string | null {
  try {
    return native?.getAccent() ?? null;
  } catch {
    return null;
  }
}
