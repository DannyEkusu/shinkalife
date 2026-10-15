// Rule-based planner: plain language -> tasks + fixed commitments + questions -> deterministic schedule. This is NOT AI and is never labelled as AI.
import { localParts, zonedToUtc } from './recur-core.js';
import { schedule, validateSchedule } from './schedule-core.js';
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function dayAt(nowMs, tz, wd, h, mi, allowToday) {
  const p = localParts(nowMs, tz); let delta = (wd - p.wd + 7) % 7; if (delta === 0 && !allowToday) delta = 7;
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + delta)); return zonedToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), h, mi, tz);
}
const timeOf = c => { const m = c.match(/\bat\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i); if (!m) return null; let h = +m[1]; if (m[3]) h = h % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0); return h < 24 ? [h, +(m[2] || 0)] : null; };
const durOf = c => { const h = c.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i), m = c.match(/(\d+)\s*(?:m|min|mins|minutes?)\b/i); return h || m ? Math.round((h ? +h[1] * 60 : 0) + (m ? +m[1] : 0)) : null; };

export function parsePlan(text, { nowMs, tz }) {
  const clauses = String(text).replace(/\s+/g, ' ').split(/[.;\n]|,\s*/).map(s => s.trim().replace(/^and\s+/i, '')).filter(Boolean);
  const tasks = [], fixed = [], questions = []; let n = 0;
  for (const c of clauses) {
    const low = c.toLowerCase(), assumptions = [], day = DAYS.findIndex(d => low.includes(d)), today = /\btoday\b/.test(low), tomorrow = /\btomorrow\b/.test(low);
    const wd = tomorrow ? (localParts(nowMs, tz).wd + 1) % 7 : today ? localParts(nowMs, tz).wd : day >= 0 ? day : null;
    const title = cap(low.replace(/^(i\s+)?(have|want to|need to|need time to|need|want|must|should)\s+(a |an |some |time to )?/, '').replace(/\b(on|by|before)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|today)\b/g, '').replace(/\s+/g, ' ').trim()) || cap(c);
    const times = low.match(/\b(a|an|one|two|three|four|five|six|seven)\s+times?\s+(?:this|a|per|each)\s+week\b|\b(\d)\s+times?\s+(?:this|a|per|each)\s+week\b/);
    const given = durOf(low);
    if (times) { const count = NUM[times[1]] || +times[2], est = given ?? 45; if (given == null) assumptions.push('Assumed 45 minutes per session.');
      const end = dayAt(nowMs, tz, 0, 23, 0, true); const base = title.replace(/\b(?:a|an|one|two|three|four|five|six|seven|\d)\s+times?\s+(?:this|a|per|each)\s+week\b/i, '').trim() || title;
      for (let i = 1; i <= count; i++) tasks.push({ id: `p${n++}`, title: `${cap(base)} (${i}/${count})`, est_minutes: est, due_at: new Date(end).toISOString(), priority: 2, quest_type: 'habit', status: 'todo', assumptions });
    } else if (/\b(test|exam|quiz)\b/.test(low) && wd != null) { const est = given ?? 120; if (given == null) assumptions.push('Assumed 2 hours of study before the test.');
      tasks.push({ id: `p${n++}`, title: `Prepare: ${title}`, est_minutes: est, due_at: new Date(dayAt(nowMs, tz, wd, 8, 0, today)).toISOString(), priority: 3, quest_type: 'main', status: 'todo', assumptions: [...assumptions, 'Due the morning of the test.'] });
    } else if (/\b(assignment|essay|homework|deadline|due|submit|report)\b/.test(low) && wd != null) { const est = given ?? 90; if (given == null) assumptions.push('Assumed 90 minutes of work.');
      tasks.push({ id: `p${n++}`, title, est_minutes: est, due_at: new Date(dayAt(nowMs, tz, wd, 23, 0, today)).toISOString(), priority: 3, quest_type: 'main', status: 'todo', assumptions: [...assumptions, 'Due 11pm that day.'] });
    } else if (/\b(session|class|lesson|meeting|lecture|rehearsal|appointment)\b/.test(low) && wd != null) { const t = timeOf(low);
      if (!t) questions.push(`What time is “${title}”? I need it to block that time out.`);
      else { const st = dayAt(nowMs, tz, wd, t[0], t[1], today), dur = given ?? 60; fixed.push({ id: `f${n++}`, title, start: st, end: st + dur * 60000 }); }
    } else { const est = given ?? (/\b(website|project|build|code)\b/.test(low) ? 90 : 45); if (given == null) assumptions.push(`Assumed ${est} minutes.`);
      tasks.push({ id: `p${n++}`, title, est_minutes: est, due_at: wd != null ? new Date(dayAt(nowMs, tz, wd, 23, 0, today)).toISOString() : null, priority: 2, quest_type: 'side', status: 'todo', assumptions }); }
  }
  return { tasks, fixed, questions };
}
export function proposeFromTasks({ tasks, fixed = [], questions = [], source }, ctx) {
  const busy = [...(ctx.busy || []), ...fixed.map(f => ({ start: f.start, end: f.end }))];
  const result = schedule({ tasks, availability: ctx.availability, busy, nowMs: ctx.nowMs, tz: ctx.tz, settings: ctx.settings });
  const validation = validateSchedule({ blocks: result.blocks, tasks, availability: ctx.availability, busy, tz: ctx.tz, settings: ctx.settings });
  return { source, tasks, fixed, questions, ...result, validation, realistic: result.unscheduled.length === 0 };
}
export const buildProposal = (text, ctx) => proposeFromTasks({ ...parsePlan(text, ctx), source: 'rules' }, ctx);
export const ALTERNATIVES = { Balanced: { maxSession: 60, breakMin: 10 }, Focused: { maxSession: 120, breakMin: 15, maxDailyMin: 420 }, Light: { maxSession: 45, breakMin: 10, maxDailyMin: 240 } };
export function compareAlternatives(text, ctx) {
  return Object.entries(ALTERNATIVES).map(([name, settings]) => { const p = buildProposal(text, { ...ctx, settings: { ...ctx.settings, ...settings } });
    return { name, settings, proposal: p, summary: { sessions: p.blocks.length, placedMin: p.stats.placedMin, shortMin: p.unscheduled.reduce((a, u) => a + u.minutes_short, 0), daysUsed: p.stats.daysUsed } }; });
}
