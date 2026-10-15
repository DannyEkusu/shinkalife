// Deterministic scheduling engine. Same input => same output. AI (if any) never places blocks; it can only propose tasks.
import { zonedToUtc, localDate, dayKey, hm } from './recurrence.js';
const MIN = 6e4;
export const DEFAULTS = { slotMin: 15, maxBlockMin: 90, minBlockMin: 30, breakMin: 10, maxDailyMin: 360, horizonDays: 14 };
const snap = (ms, slot) => Math.ceil(ms / slot) * slot;

export function freeWindows({ now, tz, availability, busy = [], horizonDays, slotMin }) {
  const l = localDate(now, tz), slot = slotMin * MIN; let wins = [];
  for (let i = 0; i < horizonDays; i++) {
    const dt = new Date(Date.UTC(l.y, l.m - 1, l.d + i));
    for (const [a, b] of availability[dt.getUTCDay()] ?? []) {
      const [ah, am] = hm(a), [bh, bm] = hm(b), y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      wins.push([Math.max(zonedToUtc(y, m, d, ah, am, tz), now), zonedToUtc(y, m, d, bh, bm, tz)]);
    }
  }
  for (const [bs, be] of busy) { const next = []; for (const [s, e] of wins) { if (be <= s || bs >= e) next.push([s, e]); else { if (bs > s) next.push([s, bs]); if (be < e) next.push([be, e]); } } wins = next; }
  return wins.map(([s, e]) => [snap(s, slot), e]).filter(([s, e]) => e - s >= slot).sort((a, b) => a[0] - b[0]);
}

// tasks: [{id,title,est_minutes,priority(1-3),due_at}]; fixed/existing: [{start,end}] in ms; availability: {0-6: [['09:00','17:00'],...]}
export function schedule({ tasks, fixed = [], existing = [], availability, tz, now, settings = {} }) {
  const S = { ...DEFAULTS, ...settings }, slot = S.slotMin * MIN;
  const wins = freeWindows({ now, tz, availability, busy: [...fixed, ...existing].map(b => [b.start, b.end]), horizonDays: S.horizonDays, slotMin: S.slotMin });
  const dl = t => (t.due_at ? new Date(t.due_at).getTime() : Infinity), used = {}, blocks = [], unscheduled = [], explain = [];
  const order = [...tasks].sort((a, b) => dl(a) - dl(b) || b.priority - a.priority || b.est_minutes - a.est_minutes || (a.id < b.id ? -1 : 1));
  for (const t of order) {
    const deadline = dl(t); let rem = Math.ceil(t.est_minutes / S.slotMin) * S.slotMin, n = 0, first = null;
    while (rem > 0) {
      const want = Math.min(rem, S.maxBlockMin); let placed = false;
      for (const w of wins) {
        if (w[0] >= deadline) break;
        const key = dayKey(w[0], tz), avail = (Math.min(w[1], deadline) - w[0]) / MIN, cap = S.maxDailyMin - (used[key] ?? 0);
        const len = Math.floor(Math.min(want, avail, cap) / S.slotMin) * S.slotMin;
        if (len > 0 && len >= Math.min(want, S.minBlockMin)) {
          blocks.push({ task_id: t.id, title: t.title, start: w[0], end: w[0] + len * MIN }); first ??= w[0];
          w[0] = snap(w[0] + (len + S.breakMin) * MIN, slot); used[key] = (used[key] ?? 0) + len; rem -= len; n++; placed = true; break;
        }
      }
      if (!placed) break;
    }
    if (rem > 0) {
      const left = Math.round(wins.reduce((s, w) => s + Math.max(0, Math.min(w[1], deadline) - w[0]), 0) / MIN);
      unscheduled.push({ task_id: t.id, title: t.title, missing_minutes: rem, reason: `Needs ${rem} more minutes, but only ${left} minutes of free time remain ${deadline === Infinity ? 'in the planning window' : 'before the deadline'} after fixed commitments, breaks and the daily limit. Try a later deadline, a smaller estimate, or freeing time.` });
    }
    if (n) explain.push({ task_id: t.id, text: `${t.title}: ${n} block${n > 1 ? 's' : ''} from ${dayKey(first, tz)}. Tasks are placed by earliest deadline, then priority; blocks are capped at ${S.maxBlockMin} min with ${S.breakMin}-minute breaks.` });
  }
  blocks.sort((a, b) => a.start - b.start);
  return { blocks, unscheduled, explain, summary: { tasks: tasks.length, blocks: blocks.length, unscheduled: unscheduled.length } };
}

// Independent validator: never trusts the scheduler (or an AI) that produced the blocks.
export function validateSchedule(blocks, { fixed = [], availability, tz, settings = {}, deadlines = {} }) {
  const S = { ...DEFAULTS, ...settings }, issues = [], day = {};
  const win = b => { const l = localDate(b.start, tz), y = l.y, m = l.m, d = l.d;
    return (availability[l.wd] ?? []).some(([a, z]) => { const [ah, am] = hm(a), [zh, zm] = hm(z); return b.start >= zonedToUtc(y, m, d, ah, am, tz) && b.end <= zonedToUtc(y, m, d, zh, zm, tz); }); };
  blocks.forEach((b, i) => {
    if (!(b.end > b.start)) issues.push({ type: 'invalid', index: i });
    if ((b.end - b.start) / MIN > S.maxBlockMin) issues.push({ type: 'too-long', index: i });
    if (!win(b)) issues.push({ type: 'outside-availability', index: i });
    const dd = deadlines[b.task_id]; if (dd && b.end > dd) issues.push({ type: 'past-deadline', index: i });
    for (const f of fixed) if (b.start < f.end && f.start < b.end) issues.push({ type: 'fixed-conflict', index: i });
    for (let j = i + 1; j < blocks.length; j++) if (b.start < blocks[j].end && blocks[j].start < b.end) issues.push({ type: 'overlap', index: i, other: j });
    const k = dayKey(b.start, tz); day[k] = (day[k] ?? 0) + (b.end - b.start) / MIN;
  });
  for (const [k, v] of Object.entries(day)) if (v > S.maxDailyMin) issues.push({ type: 'daily-cap', day: k, minutes: v });
  return issues;
}

// Missed-task recovery: one entry per task (no duplicate sessions), only the minutes that were actually missed.
export function recoverMissed(blocks, doneTaskIds, now) {
  const m = new Map();
  for (const b of blocks) { if (b.status === 'done' || b.end > now || doneTaskIds.has(b.task_id)) continue;
    const e = m.get(b.task_id) ?? { id: b.task_id, title: b.title, est_minutes: 0, priority: b.priority ?? 2, due_at: b.due_at ?? null }; e.est_minutes += (b.end - b.start) / MIN; m.set(b.task_id, e); }
  return [...m.values()];
}
