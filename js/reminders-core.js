// Reminder policy: quiet hours, daily limit, pause. Pure logic; delivery (browser or push) is separate.
import { localParts, expandOccurrences } from './recur-core.js';
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
export const remindersFor = (blocks, leadMin) => blocks.map(b => ({ key: `${b.task_id ?? b.id}:${b.start}`, title: b.title, start: b.start, at: b.start - leadMin * 60000, cat: b.cat }));

// ---------- user-created reminders ----------
export const KINDS = { task: 'Task', deadline: 'Deadline', study: 'Study session', habit: 'Habit', activity: 'Activity', custom: 'Custom' };
export const CATEGORY_OF = { task: 'task', deadline: 'task', study: 'session', habit: 'habit', activity: 'event', custom: 'custom' };
export const CATEGORIES = { session: 'Study & planned sessions', event: 'Calendar events & activities', task: 'Task & deadline reminders', habit: 'Habits', custom: 'Custom reminders' };
const DAY = 864e5;
export function validateReminder(r) {
  const e = [], title = String(r.title ?? '').trim(), notes = String(r.notes ?? '').trim(), at = Date.parse(r.remind_at), rr = r.rrule;
  if (!title || title.length > 120) e.push('Title must be 1–120 characters.');
  if (notes.length > 500) e.push('Notes are limited to 500 characters.');
  if (!(r.kind in KINDS)) e.push('Choose a reminder type.');
  if (isNaN(at)) e.push('Choose a valid date and time.');
  try { new Intl.DateTimeFormat('en', { timeZone: r.tz }); } catch { e.push('Unknown timezone.'); }
  if (rr) { if (!['daily', 'weekly'].includes(rr.freq)) e.push('Repeat must be daily or weekly.'); if (rr.interval != null && !(Number.isInteger(rr.interval) && rr.interval >= 1 && rr.interval <= 52)) e.push('Repeat interval must be 1–52.');
    if (rr.days && !(Array.isArray(rr.days) && rr.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6))) e.push('Invalid weekdays.'); if (rr.until && isNaN(Date.parse(rr.until))) e.push('Invalid repeat end date.'); }
  return { ok: !e.length, errors: e, value: { title, notes: notes || null, kind: r.kind, remind_at: e.length ? null : new Date(at).toISOString(), tz: r.tz, rrule: rr || null, task_id: r.task_id || null } };
}
// Alerts of one reminder inside [from, to]. Occurrences at/before skip_until were already handled (done/dismissed/snoozed); a snooze adds one extra alert.
export function reminderAlerts(rem, fromMs, toMs) {
  if (rem.status !== 'active') return [];
  const skip = rem.skip_until ? Date.parse(rem.skip_until) : -Infinity, start = Date.parse(rem.remind_at), out = [];
  const ev = { id: rem.id, title: rem.title, tz: rem.tz, start_at: rem.remind_at, end_at: new Date(start + 60000).toISOString(), rrule: rem.rrule };
  for (const o of expandOccurrences(ev, Math.max(fromMs, 0) - 60000, toMs)) if (o.start > skip && o.start >= fromMs && o.start <= toMs) out.push({ key: `${rem.id}:${o.start}`, reminder_id: rem.id, title: rem.title, kind: rem.kind, at: o.start, base: o.start, snooze: false });
  const sn = rem.snoozed_until ? Date.parse(rem.snoozed_until) : null;
  if (sn && sn >= fromMs && sn <= toMs) out.push({ key: `${rem.id}:snooze:${sn}`, reminder_id: rem.id, title: rem.title, kind: rem.kind, at: sn, base: isFinite(skip) ? skip : 0, snooze: true });
  return out.sort((a, b) => a.at - b.at);
}
// "Due now": for each reminder only the latest unhandled occurrence (a daily reminder missed for 5 days is ONE card, not five) plus any due snooze.
export function dueAlerts(reminders, nowMs, lookbackMs = 7 * DAY) {
  return reminders.flatMap(r => { const a = reminderAlerts(r, r.rrule ? nowMs - lookbackMs : 0, nowMs), normal = a.filter(x => !x.snooze); return [...normal.slice(-1), ...a.filter(x => x.snooze)]; }).sort((x, y) => x.at - y.at);
}
export const upcomingAlerts = (reminders, nowMs, horizonMs) => reminders.flatMap(r => reminderAlerts(r, nowMs + 1, nowMs + horizonMs)).sort((a, b) => a.at - b.at);
