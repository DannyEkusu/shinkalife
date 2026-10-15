// Pure reminder planning. Works while the app is open; background delivery needs a server (see docs/NOTIFICATIONS_AND_ANDROID.md).
import { localDate, dayKey, hm } from './recurrence.js';
const MIN = 6e4;
export function inQuiet(ms, tz, q) {
  if (!q?.enabled) return false; const l = localDate(ms, tz), m = l.hh * 60 + l.mm, [sh, sm] = hm(q.start), [eh, em] = hm(q.end), s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? m >= s && m < e : m >= s || m < e;
}
export function quietEnd(ms, tz, q) { const l = localDate(ms, tz), m = l.hh * 60 + l.mm, [eh, em] = hm(q.end); return ms + (((eh * 60 + em - m) + 1440) % 1440) * MIN; }
// items: [{id,start,title}]; prefs: {leadMin,quiet:{enabled,start,end},maxPerDay,pausedUntil}. Reminders landing in quiet hours move to the end of quiet time, or are dropped if that is too late.
export function planReminders({ items, prefs, now, tz, sent = new Set() }) {
  if (prefs.pausedUntil && now < prefs.pausedUntil) return [];
  const out = [], perDay = {};
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    const key = `${it.id}:${it.start}`; let at = it.start - prefs.leadMin * MIN;
    if (inQuiet(at, tz, prefs.quiet)) at = quietEnd(at, tz, prefs.quiet);
    if (at >= it.start) continue; const dk = dayKey(at, tz);
    if (sent.has(key)) { perDay[dk] = (perDay[dk] ?? 0) + 1; continue; }
    if ((perDay[dk] ?? 0) >= prefs.maxPerDay) continue; perDay[dk] = (perDay[dk] ?? 0) + 1;
    out.push({ key, at, start: it.start, title: it.title });
  }
  return out;
}
export const dueNow = (plan, now) => plan.filter(r => r.at <= now && now < r.start);
