// Material 3 colour scheme generated from one seed colour (the user's accent or
// the Material You wallpaper colour).
//
// M3 builds tonal palettes in its HCT colour space, where "tone" is CIE L*.
// This uses CIE LCh instead (same tone axis, close enough hue/chroma), which
// keeps it dependency-free: each palette keeps the seed's hue at a fixed
// chroma, and a role is just "palette at tone N". The tones and chromas below
// follow M3's dark "tonal spot" scheme.

export interface Scheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  surface: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  scrim: string;
  /** Presence dots. Not M3 roles, but fixed hues people recognise. */
  online: string;
  offline: string;
}

export const DEFAULT_SEED = '#2567d8';

// --- sRGB <-> CIE Lab (D65) -------------------------------------------------

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const WHITE = [0.95047, 1, 1.08883];

const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > EPS ? t ** 3 : (116 * t - 16) / KAPPA);

function hexToLch(hex: string): { l: number; c: number; h: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear((n >> 16) & 255);
  const g = toLinear((n >> 8) & 255);
  const b = toLinear(n & 255);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0];
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1];
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2];
  const fy = f(y);
  const a = 500 * (f(x) - fy);
  const bb = 200 * (fy - f(z));
  return { l: 116 * fy - 16, c: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
}

/** Linear RGB for an LCh colour (may fall outside 0..1 if out of gamut). */
function lchToLinear(l: number, c: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const fy = (l + 16) / 116;
  const fx = fy + (c * Math.cos(rad)) / 500;
  const fz = fy - (c * Math.sin(rad)) / 200;
  const x = fInv(fx) * WHITE[0];
  const y = (l > KAPPA * EPS ? fy ** 3 : l / KAPPA) * WHITE[1];
  const z = fInv(fz) * WHITE[2];
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

function toHex(rgb: number[]): string {
  return `#${rgb
    .map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** The colour at this tone with the hue kept and chroma reduced until it fits sRGB. */
function tone(hue: number, chroma: number, t: number): string {
  const rgb = lchToLinear(t, chroma, hue);
  if (inGamut(rgb)) return toHex(rgb);
  let lo = 0;
  let hi = chroma;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(lchToLinear(t, mid, hue))) lo = mid;
    else hi = mid;
  }
  return toHex(lchToLinear(t, lo, hue));
}

// --- Scheme -----------------------------------------------------------------

function build(seed: string): Scheme {
  const { c, h } = hexToLch(seed);
  // Keep greys grey-ish and very loud seeds from glowing.
  const P = (t: number) => tone(h, Math.min(Math.max(c, 16), 48), t);
  const S = (t: number) => tone(h, 16, t);
  const T = (t: number) => tone(h + 60, 24, t);
  const N = (t: number) => tone(h, 4, t);
  const NV = (t: number) => tone(h, 8, t);
  return {
    primary: P(80),
    onPrimary: P(20),
    primaryContainer: P(30),
    onPrimaryContainer: P(90),
    secondary: S(80),
    onSecondary: S(20),
    secondaryContainer: S(30),
    onSecondaryContainer: S(90),
    tertiary: T(80),
    onTertiary: T(20),
    tertiaryContainer: T(30),
    onTertiaryContainer: T(90),
    // M3's fixed error palette.
    error: '#ffb4ab',
    onError: '#690005',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    surface: N(6),
    surfaceContainerLowest: N(4),
    surfaceContainerLow: N(10),
    surfaceContainer: N(12),
    surfaceContainerHigh: N(17),
    surfaceContainerHighest: N(22),
    onSurface: N(90),
    onSurfaceVariant: NV(80),
    outline: NV(60),
    outlineVariant: NV(30),
    inverseSurface: N(90),
    inverseOnSurface: N(20),
    inversePrimary: P(40),
    scrim: '#000000',
    online: '#4ade80',
    offline: NV(50),
  };
}

// One object per seed, so styles cached against it stay valid.
const cache = new Map<string, Scheme>();

export function schemeFor(seed: string): Scheme {
  let scheme = cache.get(seed);
  if (!scheme) {
    scheme = build(seed);
    cache.set(seed, scheme);
  }
  return scheme;
}

/** "#rrggbb" + alpha → "rgba(...)", for state layers and tints. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
