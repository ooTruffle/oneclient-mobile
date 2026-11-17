// PolyPlus chat emoji. OneClient players type shortcodes like :sob: and the
// message is sent as that text; PolyPlus draws it as an emoji in game. The app
// shows the same emoji by swapping each known shortcode for the real one.
//
// emojiShortcodes.json is generated from PolyPlus's own list
// (assets/polyplus/emoji/shortcodes.json + unicode.json in the mod), so the
// same 777 codes work here, and unknown ":text:" is left alone.

import SHORTCODES from './emojiShortcodes.json';

const map = SHORTCODES as Record<string, string>;

// Names are letters, digits, _, + and - (e.g. :+1:, :t-rex:, :100:).
const PATTERN = /:([a-z0-9_+-]+):/gi;

/** "gg :sob:" → "gg 😭". Codes PolyPlus doesn't know stay as typed. */
export function renderEmoji(text: string): string {
  if (!text.includes(':')) return text;
  return text.replace(PATTERN, (code, name: string) => map[name.toLowerCase()] ?? code);
}

// Built on first use, inside try: \p{...} needs Unicode property support in
// the regex engine. Without it, nothing is shown jumbo.
let emojiOnly: RegExp | null | undefined;
let pictograph: RegExp | null = null;

function buildPatterns() {
  try {
    // Only emoji, their modifiers/joiners, and spaces.
    emojiOnly = new RegExp('^(?:\\p{Extended_Pictographic}|\\p{Emoji_Component}|\\u200d|\\ufe0f|\\s)+$', 'u');
    // One emoji, counting ZWJ sequences (e.g. heart on fire, families) as one.
    pictograph = new RegExp(
      '\\p{Extended_Pictographic}\\ufe0f?(?:\\p{Emoji_Modifier})?(?:\\u200d\\p{Extended_Pictographic}\\ufe0f?(?:\\p{Emoji_Modifier})?)*',
      'gu',
    );
  } catch {
    emojiOnly = null;
  }
}

/** True for messages of just 1–3 emoji ("😭", "🙏🙏"), which chat shows bigger. */
export function isJumboEmoji(text: string): boolean {
  if (emojiOnly === undefined) buildPatterns();
  const trimmed = text.trim();
  if (!emojiOnly || !pictograph || !trimmed || !emojiOnly.test(trimmed)) return false;
  const count = trimmed.match(pictograph)?.length ?? 0;
  return count >= 1 && count <= 3;
}

export interface EmojiMatch {
  name: string;
  emoji: string;
}

const NAMES = Object.keys(map);

/**
 * Shortcodes for autocomplete, best first: names starting with the query, then
 * names with a word starting with it (":fire" → "fire", "fire_engine", then
 * "campfire"-style matches last), shorter names first within each group.
 */
export function searchEmoji(query: string, limit = 8): EmojiMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const rank = (name: string) => {
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.split(/[_-]/).some((word) => word.startsWith(q))) return 2;
    // Mid-word matches are noise for 2 letters (":sk" → "mask"), useful from 3.
    if (q.length >= 3 && name.includes(q)) return 3;
    return -1;
  };
  return NAMES.map((name) => ({ name, r: rank(name) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name }) => ({ name, emoji: map[name] }));
}

/**
 * The shortcode being typed right before the cursor, e.g. "hi :so|" → "so".
 * Needs at least two characters after the colon, so a plain ":" or ":)"
 * doesn't pop suggestions up.
 */
export function shortcodeAtCursor(text: string, cursor: number): { query: string; start: number } | null {
  const match = /(?:^|\s):([a-z0-9_+-]{2,})$/i.exec(text.slice(0, cursor));
  if (!match) return null;
  return { query: match[1], start: cursor - match[1].length - 1 };
}
