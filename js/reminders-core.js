// Reminder policy: quiet hours, daily limit, pause. Pure logic; delivery (browser or push) is separate.
import { localParts } from './recur-core.js';
export const DEFAULT_REMINDER_SETTINGS = { enabled: true, lead_minutes: 10, quiet_start_min: 22 * 60, quiet_end_min: 7 * 60, max_per_day: 8, paused_until: null };
export function inQuietHours(minOfDay, { quiet_start_min: a, quiet_end_min: b }) { if (a === b) return false; return a < b ? minOfDay >= a && minOfDay < b : minOfDay >= a || minOfDay < b; }
export function applyPolicy(items, settings, tz, nowMs = 0) {
  const s = { ...DEFAULT_REMINDER_SETTINGS, ...settings }, send = [], deferred = [], dropped = [], perDay = new Map();
  if (!s.enabled) return { send, deferred, dropped: items.map(i => ({ ...i, why: 'disabled' })) };
  const paused = s.paused_until ? Date.parse(s.paused_until) : 0;
  for (const it of [...items].sort((x, y) => x.at - y.at)) {
    let at = it.at; if (at < paused) { dropped.push({ ...it, why: 'paused' }); continue; }
    const p = localParts(at, tz);
    if (inQuietHours(p.h * 60 + p.mi, s)) { const mins = (s.quiet_end_min - (p.h * 60 + p.mi) + 1440) % 1440; at += mins * 60000;
      if (at >= it.start) { dropped.push({ ...it, why: 'quiet_hours' }); continue; } deferred.push({ ...it, at, was: it.at }); }
    const dk = `${localParts(at, tz).y}-${localParts(at, tz).mo}-${localParts(at, tz).d}`, n = perDay.get(dk) || 0;
    if (n >= s.max_per_day) { dropped.push({ ...it, why: 'daily_limit' }); continue; } perDay.set(dk, n + 1); send.push({ ...it, at });
  }
  return { send, deferred, dropped };
}
export const remindersFor = (blocks, leadMin) => blocks.map(b => ({ key: `${b.task_id ?? b.id}:${b.start}`, title: b.title, start: b.start, at: b.start - leadMin * 60000 }));
