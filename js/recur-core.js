// Timezone + recurrence logic. Recurring rules stay separate from occurrences; exceptions change one occurrence only.
const DAY = 864e5, WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }, pad = n => String(n).padStart(2, '0'), cache = new Map();
const dtf = tz => { if (!cache.has(tz)) cache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' })); return cache.get(tz); };
export function localParts(ms, tz) { const o = {}; for (const p of dtf(tz).formatToParts(new Date(ms))) o[p.type] = p.value; return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: WD[o.weekday] }; }
export const dateKey = p => `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
export const tzOffsetMin = (ms, tz) => { const p = localParts(ms, tz); return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000; };
// Local wall-clock -> UTC ms. Nonexistent (spring-forward) times move forward; ambiguous (fall-back) times resolve to the later instant.
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi), o1 = tzOffsetMin(guess, tz); let ms = guess - o1 * 60000;
  const o2 = tzOffsetMin(ms, tz); if (o2 !== o1) ms = guess - o2 * 60000; return ms;
}
export function expandOccurrences(ev, fromMs, toMs) {
  const tz = ev.tz, s = Date.parse(ev.start_at), dur = Date.parse(ev.end_at) - s, sp = localParts(s, tz), r = ev.rrule, out = [];
  const ex = new Map((ev.exceptions || []).map(x => [x.date, x]));
  const make = p => { const key = dateKey(p), x = ex.get(key); if (x?.action === 'skip') return;
    let st = zonedToUtc(p.y, p.mo, p.d, sp.h, sp.mi, tz), en = st + dur, moved = false;
    if (x?.action === 'move') { st = Date.parse(x.new_start); en = Date.parse(x.new_end); moved = true; }
    if (en > fromMs && st < toMs) out.push({ event_id: ev.id, title: ev.title, date: key, start: st, end: en, moved }); };
  if (!r) { make(sp); return out; }
  const base = Date.UTC(sp.y, sp.mo - 1, sp.d), until = r.until ? Date.parse(r.until) : Infinity, interval = Math.max(1, r.interval || 1), days = r.days?.length ? r.days : [sp.wd];
  const fp = localParts(fromMs, tz), tp = localParts(toMs, tz);
  const first = Math.max(0, Math.floor((Date.UTC(fp.y, fp.mo - 1, fp.d) - base) / DAY) - 1), last = Math.ceil((Date.UTC(tp.y, tp.mo - 1, tp.d) - base) / DAY) + 1;
  if (last - first > 800) throw new RangeError('Range too large');
  for (let k = first; k <= last; k++) {
    const dt = new Date(base + k * DAY), p = { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
    if (!(r.freq === 'daily' ? k % interval === 0 : days.includes(p.wd) && Math.floor(k / 7) % interval === 0)) continue;
    if (zonedToUtc(p.y, p.mo, p.d, sp.h, sp.mi, tz) > until) break; make(p);
  }
  return out;
}
