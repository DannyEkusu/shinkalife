// Timezone helpers + recurrence expansion. Rules are stored separately from occurrences; wall-clock time is kept stable across DST.
const cache = new Map(), MIN = 6e4;
function parts(ms, tz) {
  let f = cache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); cache.set(tz, f); }
  const o = {}; for (const p of f.formatToParts(ms)) o[p.type] = +p.value; return o;
}
export const offsetMin = (ms, tz) => { const o = parts(ms, tz); return (Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(ms / 1000) * 1000) / MIN; };
export function zonedToUtc(y, m, d, hh, mm, tz) { const g = Date.UTC(y, m - 1, d, hh, mm); let t = g - offsetMin(g, tz) * MIN; t = g - offsetMin(t, tz) * MIN; return t; }
export function localDate(ms, tz) { const o = parts(ms, tz); return { y: o.year, m: o.month, d: o.day, hh: o.hour, mm: o.minute, wd: new Date(Date.UTC(o.year, o.month - 1, o.day)).getUTCDay() }; }
export const dayKey = (ms, tz) => { const l = localDate(ms, tz); return `${l.y}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`; };
export const hm = s => s.split(':').map(Number);

// rule: {id,title,freq:'daily'|'weekly',byday:[0-6],start_time:'HH:MM',duration_min,tz,start_date:'YYYY-MM-DD',until_date?}
// exceptions: [{date:'YYYY-MM-DD', action:'skip'} | {date, action:'move', start, end}]  (affect ONE occurrence only)
export function expandRule(rule, fromMs, toMs, exceptions = []) {
  const out = [], tz = rule.tz, [h, m] = hm(rule.start_time), f = localDate(fromMs, tz), ex = new Map(exceptions.map(e => [e.date, e]));
  for (let i = -1; i <= Math.ceil((toMs - fromMs) / 864e5) + 1; i++) {
    const dt = new Date(Date.UTC(f.y, f.m - 1, f.d + i)), y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const key = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (key < rule.start_date || (rule.until_date && key > rule.until_date)) continue;
    if (rule.freq === 'weekly' && !(rule.byday ?? []).includes(dt.getUTCDay())) continue;
    let start = zonedToUtc(y, mo, d, h, m, tz), end = start + rule.duration_min * MIN, moved = false;
    const e = ex.get(key); if (e?.action === 'skip') continue; if (e?.action === 'move') { start = e.start; end = e.end; moved = true; }
    if (end > fromMs && start < toMs) out.push({ rule_id: rule.id, title: rule.title, date: key, start, end, moved });
  }
  return out.sort((a, b) => a.start - b.start);
}
