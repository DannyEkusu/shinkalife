// Deterministic scheduler + independent validator. No randomness, no network, no DOM.
import { zonedToUtc, localParts, dateKey } from './recur-core.js';
export const DEFAULTS = { horizonDays: 7, granularity: 5, minSession: 25, maxSession: 90, breakMin: 10, maxDailyMin: 360, defaultEst: 30 };
const MIN = 60000, ceilTo = (ms, g) => Math.ceil(ms / (g * MIN)) * g * MIN, overlaps = (a, b) => a.start < b.end && b.start < a.end;
const fmtDue = (iso, tz) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz });

function windowsFor(y, mo, d, wd, availability, tz) {
  return availability.filter(w => w.weekday === wd && w.start_min < w.end_min).map(w => [
    zonedToUtc(y, mo, d, Math.floor(w.start_min / 60), w.start_min % 60, tz),
    w.end_min >= 1440 ? zonedToUtc(y, mo, d + 1, 0, 0, tz) : zonedToUtc(y, mo, d, Math.floor(w.end_min / 60), w.end_min % 60, tz)]);
}
export function freeSlots({ availability, busy, nowMs, tz, s }) {
  const np = localParts(nowMs, tz), base = Date.UTC(np.y, np.mo - 1, np.d), raw = [];
  for (let k = 0; k <= s.horizonDays; k++) { const dt = new Date(base + k * 864e5);
    for (let [a, b] of windowsFor(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), dt.getUTCDay(), availability, tz)) { a = Math.max(a, ceilTo(nowMs, s.granularity)); if (b > a) raw.push([a, b]); } }
  raw.sort((p, q) => p[0] - q[0]); let cur = [];
  for (const [a, b] of raw) { const l = cur[cur.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else cur.push([a, b]); }
  for (const x of busy) { const nxt = []; for (const [a, b] of cur) { if (x.end <= a || x.start >= b) { nxt.push([a, b]); continue; } if (x.start > a) nxt.push([a, x.start]); if (x.end < b) nxt.push([x.end, b]); } cur = nxt; }
  return cur.map(([a, b]) => [ceilTo(a, s.granularity), b]).filter(([a, b]) => b - a >= s.granularity * MIN);
}
export function splitSessions(est, s) {
  const n = Math.max(1, Math.min(Math.ceil(est / s.maxSession), Math.floor(est / s.minSession))), each = Math.ceil(est / n / s.granularity) * s.granularity, out = []; let rem = est;
  for (let i = 0; i < n && rem > 0; i++) { const size = Math.min(each, Math.ceil(rem / s.granularity) * s.granularity); out.push(size); rem -= size; } return out;
}
export function schedule({ tasks, availability, busy = [], nowMs, tz, settings = {} }) {
  const s = { ...DEFAULTS, ...settings }, slots = freeSlots({ availability, busy, nowMs, tz, s }), perDay = new Map(), blocks = [], unscheduled = [], explanations = [];
  const due = t => (t.due_at ? Date.parse(t.due_at) : Infinity);
  const order = tasks.filter(t => t.status !== 'done').sort((a, b) => { const x = due(a), y = due(b); return x !== y ? (x < y ? -1 : 1) : (b.priority - a.priority) || String(a.id).localeCompare(String(b.id)); });
  let requested = 0, placed = 0;
  for (const t of order) {
    const est = t.est_minutes || s.defaultEst, sizes = splitSessions(est, s); let short = 0, reason = null, n = 0; requested += est;
    for (const size of sizes) {
      let ok = false;
      for (let i = 0; i < slots.length && !ok; i++) {
        const [a, b] = slots[i], end = a + size * MIN, dk = dateKey(localParts(a, tz));
        if (end > b) continue;
        if (end > due(t)) { reason = 'no_time_before_deadline'; break; }
        if ((perDay.get(dk) || 0) + size > s.maxDailyMin) { reason = reason || 'daily_limit'; continue; }
        blocks.push({ task_id: t.id, title: t.title, start: a, end, session: ++n, of: sizes.length }); perDay.set(dk, (perDay.get(dk) || 0) + size); placed += size;
        const next = ceilTo(end + s.breakMin * MIN, s.granularity); if (next < b) slots[i] = [next, b]; else slots.splice(i, 1); ok = true;
      }
      if (!ok) short += size;
    }
    const got = est - Math.min(est, short);
    if (short) { reason = reason || 'no_time_in_horizon';
      const why = { no_time_before_deadline: `Only ${got} of ${est} minutes fit before the deadline${t.due_at ? ' (' + fmtDue(t.due_at, tz) + ')' : ''}. Move the deadline, shorten the task, or add available hours.`,
        daily_limit: `Your daily limit of ${s.maxDailyMin} minutes is full on the available days, so ${short} minutes were left out.`, no_time_in_horizon: `No free time in the next ${s.horizonDays} days for ${short} minutes.` }[reason];
      unscheduled.push({ task_id: t.id, title: t.title, minutes_short: short, reason, explain: why }); }
    if (got > 0) explanations.push(t.due_at ? `“${t.title}” was placed early because it is due ${fmtDue(t.due_at, tz)}.` : `“${t.title}” has no deadline, so it fills the earliest free time after dated work.`);
  }
  blocks.sort((p, q) => p.start - q.start);
  return { blocks, unscheduled, explanations, stats: { requestedMin: requested, placedMin: placed, daysUsed: perDay.size }, settings: s };
}
export function findConflicts(blocks) { const b = [...blocks].sort((p, q) => p.start - q.start), out = []; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length && b[j].start < b[i].end; j++) out.push([b[i], b[j]]); return out; }

// Independent of the scheduler: also used to validate manual edits and AI-derived proposals.
export function validateSchedule({ blocks, tasks = [], availability, busy = [], tz, settings = {} }) {
  const s = { ...DEFAULTS, ...settings }, problems = [], add = (severity, type, message, ref) => problems.push({ severity, type, message, ref }), perDay = new Map(), perTask = new Map();
  for (const b of blocks) {
    if (!(b.end > b.start)) { add('error', 'bad_range', 'A block ends before it starts.', b); continue; }
    const p = localParts(b.start, tz), q = localParts(b.end - 1, tz);
    if (!windowsFor(p.y, p.mo, p.d, p.wd, availability, tz).some(([a, z]) => b.start >= a && b.end <= z) || dateKey(p) !== dateKey(q)) add('error', 'outside_availability', `“${b.title}” falls outside your available hours.`, b);
    for (const x of busy) if (overlaps(b, x)) { add('error', 'busy_overlap', `“${b.title}” overlaps a fixed commitment.`, b); break; }
    const t = tasks.find(t => t.id === b.task_id); if (t?.due_at && b.end > Date.parse(t.due_at)) add('error', 'after_deadline', `“${b.title}” ends after its deadline.`, b);
    const m = (b.end - b.start) / MIN, dk = dateKey(p); perDay.set(dk, (perDay.get(dk) || 0) + m); perTask.set(b.task_id, (perTask.get(b.task_id) || 0) + m);
  }
  for (const [x, y] of findConflicts(blocks)) { add('error', 'overlap', `“${x.title}” overlaps “${y.title}”.`, [x, y]); if (y.start - x.end < s.breakMin * MIN && y.start >= x.end) add('warning', 'missing_break', 'No break between two sessions.', [x, y]); }
  const sorted = [...blocks].sort((p, q) => p.start - q.start); for (let i = 1; i < sorted.length; i++) { const gap = sorted[i].start - sorted[i - 1].end; if (gap >= 0 && gap < s.breakMin * MIN && sorted[i].task_id !== undefined) add('warning', 'missing_break', `Less than ${s.breakMin} minutes between “${sorted[i - 1].title}” and “${sorted[i].title}”.`, sorted[i]); }
  for (const [d, m] of perDay) if (m > s.maxDailyMin) add('error', 'daily_limit', `${d}: ${m} minutes scheduled, above your ${s.maxDailyMin}-minute daily limit.`, d);
  for (const [id, m] of perTask) { const t = tasks.find(t => t.id === id); if (t && m > (t.est_minutes || s.defaultEst) + s.granularity) add('warning', 'over_estimate', `“${t.title}” has more time scheduled than estimated.`, id); }
  return { ok: !problems.some(p => p.severity === 'error'), problems };
}
// Missed-work recovery without duplicates: only the shortfall is re-planned; future planned blocks count toward it.
export function planRecovery({ blocks, tasks, availability, busy = [], nowMs, tz, settings = {} }) {
  const s = { ...DEFAULTS, ...settings }, missed = blocks.filter(b => b.status === 'planned' && b.end < nowMs), min = b => (b.end - b.start) / MIN, need = [];
  for (const t of tasks.filter(t => t.status !== 'done' && missed.some(b => b.task_id === t.id))) {
    const mine = blocks.filter(b => b.task_id === t.id), done = mine.filter(b => b.status === 'done').reduce((a, b) => a + min(b), 0), future = mine.filter(b => b.status === 'planned' && b.start >= nowMs).reduce((a, b) => a + min(b), 0);
    const left = Math.max(0, (t.est_minutes || s.defaultEst) - done - future); if (left > 0) need.push({ ...t, est_minutes: left });
  }
  const futureBusy = [...busy, ...blocks.filter(b => b.status === 'planned' && b.start >= nowMs)];
  return { markMissed: missed.map(b => b.id), proposal: schedule({ tasks: need, availability, busy: futureBusy, nowMs, tz, settings }) };
}
