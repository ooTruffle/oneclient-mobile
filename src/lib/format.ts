import type { GroupSummary, MemberState } from '@/api/types';

export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`;
  return new Date(then).toLocaleDateString();
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Coarse countdown: "2d 5h", "5h 12m", "12m". */
export function timeLeft(untilMs: number, nowMs = Date.now()): string {
  const mins = Math.max(1, Math.ceil((untilMs - nowMs) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Display title: explicit name, otherwise the other members' names. */
export function groupTitle(group: GroupSummary, me: string, name: (id: string) => string): string {
  if (group.name) return group.name;
  const others = group.members.filter((m) => m.toLowerCase() !== me.toLowerCase());
  if (others.length === 0) return 'Just you';
  return others.map(name).join(', ');
}

/** The other participant of a DM, if any. */
export function dmPartner(group: GroupSummary, me: string): string | undefined {
  if (group.kind !== 'dm') return undefined;
  return group.members.find((m) => m.toLowerCase() !== me.toLowerCase());
}

/** Where a party member is playing, e.g. "On hypixel.net". Online/Offline when unknown. */
export function describeLocation(state?: MemberState | null, online?: boolean): string {
  const location = state?.location;
  if (!location?.kind || location.kind === 'unknown') return online ? 'Online' : 'Offline';
  switch (location.kind) {
    case 'menu':
      return 'In the menus';
    case 'singleplayer':
      return location.display ? `Singleplayer · ${location.display}` : 'Playing singleplayer';
    case 'server':
      return location.display ? `On ${location.display}` : 'On a server';
    case 'hosted_world':
      return location.display ? `Hosting ${location.display}` : 'Hosting a world';
  }
}
