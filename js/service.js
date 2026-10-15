// Application rules on top of the repository. Everything here is testable without a browser or Supabase.
// Trust model: the browser may PROPOSE (tasks, blocks, XP claims); the database decides (constraints, RLS, award_task_xp).
import { expandOccurrences, localParts, dateKey, zonedToUtc } from './recur-core.js';
import { validateSchedule, findConflicts, planRecovery, DEFAULTS } from './schedule-core.js';
import { planWithAI } from './planner-ai.js';
import { compareAlternatives, proposeFromTasks } from './planner-core.js';
import { levelFromXp, skillRank, SKILLS, ACHIEVEMENTS } from './xp-core.js';
import { applyPolicy, remindersFor, DEFAULT_REMINDER_SETTINGS } from './reminders-core.js';
import { validateTask } from './tasks-core.js';
const DAY = 864e5, MIN = 60000, iso = ms => new Date(ms).toISOString();
const toBlock = b => ({ id: b.id, task_id: b.task_id, title: b.title, start: Date.parse(b.start_at), end: Date.parse(b.end_at), status: b.status, source: b.source });
const over = (a, b) => a.start < b.end && b.start < a.end;
const say = (list, n = 3) => list.slice(0, n).join(' ');

export function createService(repo, { clock = Date.now, provider = null } = {}) {
  const S = {};
  const tz = async () => (await repo.getProfile())?.timezone || 'UTC';
  async function fixedBetween(from, to, zone, skip) {
    return (await repo.listEvents()).flatMap(ev => expandOccurrences({ ...ev, tz: ev.tz || zone }, from, to)).filter(o => !(skip && o.event_id === skip.eventId && o.date === skip.date) && !(skip?.wholeEvent && o.event_id === skip.wholeEvent));
  }
  const plannedBlocks = async (from, to, exceptId) => (await repo.listBlocks(iso(from), iso(to))).filter(b => b.status === 'planned' && !(exceptId instanceof Set ? exceptId.has(b.id) : b.id === exceptId)).map(toBlock);
  async function ctx(extraBusyFrom = clock()) {
    const zone = await tz(), availability = await repo.getAvailability(), nowMs = clock(), end = nowMs + (DEFAULTS.horizonDays + 2) * DAY;
    if (!availability.length) throw new Error('Set your available hours in Settings first so plans respect your real time.');
    const busy = [...await fixedBetween(nowMs - DAY, end, zone), ...await plannedBlocks(nowMs - DAY, end)].map(x => ({ start: x.start, end: x.end }));
    return { nowMs, tz: zone, availability, busy, settings: {} };
  }

  // ---------- calendar ----------
  S.calendar = async (from, to) => {
    const zone = await tz(), fixed = await fixedBetween(from, to, zone), blocks = (await repo.listBlocks(iso(from), iso(to))).map(toBlock);
    const pairs = findConflicts([...fixed.map(f => ({ ...f, kind: 'fixed' })), ...blocks.filter(b => b.status === 'planned')]);
    return { tz: zone, fixed, blocks, conflicts: pairs.map(([a, b]) => [a.title, b.title]), conflictTitles: new Set(pairs.flat().map(x => x.id ?? `${x.event_id}:${x.date}`)) };
  };
  function checkEvent(e) {
    const errs = [], title = String(e.title ?? '').trim(), s = Date.parse(e.start_at), t = Date.parse(e.end_at);
    if (!title || title.length > 120) errs.push('Title must be 1–120 characters.');
    if (isNaN(s) || isNaN(t)) errs.push('Start and end must be valid times.'); else { if (t <= s) errs.push('The event must end after it starts.'); else if (t - s > DAY) errs.push('Events can be at most 24 hours long.'); }
    try { new Intl.DateTimeFormat('en', { timeZone: e.tz }); } catch { errs.push('Unknown timezone.'); }
    const r = e.rrule;
    if (r) { if (!['daily', 'weekly'].includes(r.freq)) errs.push('Repeat must be daily or weekly.'); if (r.interval != null && !(Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 52)) errs.push('Repeat interval must be 1–52.');
      if (r.days && !(Array.isArray(r.days) && r.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6))) errs.push('Invalid weekdays.'); if (r.until && isNaN(Date.parse(r.until))) errs.push('Invalid repeat end date.'); }
    if (errs.length) throw new Error(say(errs, 4));
    return { title, start_at: iso(s), end_at: iso(t), tz: e.tz, rrule: r || null };
  }
  async function assertEventFits(ev, selfId) { // checks the next 90 days of occurrences against other fixed events and planned blocks
    const nowMs = clock(), zone = ev.tz, to = nowMs + 90 * DAY, from = Math.max(nowMs - DAY, 0);
    const mine = expandOccurrences({ ...ev, id: selfId || 'new' }, from, to), others = [...await fixedBetween(from, to, zone, selfId ? { wholeEvent: selfId } : null), ...await plannedBlocks(from, to)];
    const clash = mine.flatMap(m => others.filter(o => over(m, o)).map(o => `“${ev.title}” on ${m.date} overlaps “${o.title}”.`));
    if (clash.length) throw new Error('Conflicting commitment: ' + say(clash, 2));
  }
  S.addEvent = async input => { const v = checkEvent(input); await assertEventFits(v); return repo.addEvent(v); };
  S.updateEvent = async (id, input) => { const v = checkEvent(input); await assertEventFits(v, id); await repo.updateEvent(id, v); };
  S.deleteEvent = id => repo.deleteEvent(id);
  S.skipOccurrence = (eventId, date) => repo.addException(eventId, date, 'skip');
  S.moveOccurrence = async (eventId, date, newStart, newEnd) => {
    if (!(newEnd > newStart) || newEnd - newStart > DAY) throw new Error('Choose a valid time range.');
    const zone = await tz(), cand = { start: newStart, end: newEnd }, from = newStart - DAY, to = newEnd + DAY;
    const others = [...await fixedBetween(from, to, zone, { eventId, date }), ...await plannedBlocks(from, to)], hit = others.find(o => over(cand, o));
    if (hit) throw new Error(`That time overlaps “${hit.title}”.`);
    await repo.addException(eventId, date, 'move', iso(newStart), iso(newEnd));
  };

  // ---------- manual blocks ----------
  async function checkBlock(b) {
    const zone = await tz(), availability = await repo.getAvailability(), tasks = await repo.listTasks(), from = b.start - DAY, to = b.end + DAY;
    const others = await plannedBlocks(from, to, b.id), fixed = await fixedBetween(from, to, zone);
    const v = validateSchedule({ blocks: [...others, { ...b, task_id: b.task_id ?? null }], tasks, availability, busy: fixed.map(f => ({ start: f.start, end: f.end })), tz: zone });
    const hard = new Set(['bad_range', 'overlap', 'busy_overlap']);
    return { errors: v.problems.filter(p => hard.has(p.type)).map(p => p.message), warnings: v.problems.filter(p => !hard.has(p.type)).map(p => p.message) };
  }
  S.addBlock = async ({ title, task_id = null, start, end }) => {
    if (!String(title || '').trim()) throw new Error('Give the block a title.');
    const r = await checkBlock({ title: title.trim(), task_id, start, end, status: 'planned' }); if (r.errors.length) throw new Error(say(r.errors, 2));
    const [block] = await repo.addBlocks([{ title: title.trim(), task_id, start_at: iso(start), end_at: iso(end), source: 'manual' }]); return { block, warnings: r.warnings };
  };
  S.moveBlock = async (id, start, end) => {
    const cur = (await repo.listBlocks(iso(start - 14 * DAY), iso(end + 14 * DAY))).find(b => b.id === id); if (!cur) throw new Error('That block no longer exists.');
    const r = await checkBlock({ ...toBlock(cur), start, end }); if (r.errors.length) throw new Error(say(r.errors, 2));
    await repo.updateBlock(id, { start_at: iso(start), end_at: iso(end) }); return { warnings: r.warnings };
  };
  S.deleteBlock = id => repo.deleteBlock(id);

  // ---------- tasks & XP ----------
  S.createTask = async input => { const r = validateTask(input); if (!r.ok) throw new Error(r.errors.join(' ')); return repo.addTask({ ...r.value, ...(input.skill ? { skill: input.skill } : {}) }); };
  S.reviewTask = async id => {
    const zone = await tz(), nowMs = clock(), task = (await repo.listTasks()).find(t => t.id === id); if (!task) return { problems: [], needsReplan: false };
    const blocks = (await plannedBlocks(nowMs, nowMs + 60 * DAY)).filter(b => b.task_id === id), availability = await repo.getAvailability(), fixed = await fixedBetween(nowMs, nowMs + 60 * DAY, zone);
    const v = validateSchedule({ blocks, tasks: [task], availability, busy: fixed.map(f => ({ start: f.start, end: f.end })), tz: zone });
    return { problems: v.problems, needsReplan: v.problems.some(p => p.severity === 'error') };
  };
  S.updateTask = async (id, input) => { const r = validateTask(input); if (!r.ok) throw new Error(r.errors.join(' ')); await repo.updateTask(id, r.value); return S.reviewTask(id); };
  S.setTaskDone = async (id, done) => {
    await repo.updateTask(id, { status: done ? 'done' : 'todo' }); if (!done) return { award: null };
    const nowMs = clock(); let award = null, awardError = null;
    try { award = await repo.awardTaskXp(id); } catch (e) { awardError = e.message; }   // authoritative: the server/database decides if and how much
    for (const b of (await plannedBlocks(nowMs - 90 * DAY, nowMs + 90 * DAY)).filter(b => b.task_id === id)) await repo.updateBlock(b.id, { status: b.start <= nowMs ? 'done' : 'skipped' });
    return { award, awardError };
  };
  S.claimPendingXp = async () => { // retry awards that failed (offline etc.); idempotent on the server
    const got = new Set((await repo.listLedger()).map(l => l.source_id)), cutoff = clock() - 30 * DAY; let n = 0;
    for (const t of await repo.listTasks()) if (t.status === 'done' && t.completed_at && Date.parse(t.completed_at) >= cutoff && !got.has(t.id)) { const r = await repo.awardTaskXp(t.id); if (r.awarded) n++; } return n;
  };

  // ---------- planner ----------
  S.generateProposal = async text => {
    const c = await ctx(), res = await planWithAI(String(text || ''), c, provider); if (!res.ok) throw new Error(res.error);
    const alternatives = res.source === 'rules' ? compareAlternatives(text, c) : [];
    let draft_id = null, draftError = null; try { draft_id = (await repo.saveDraft({ input: String(text).slice(0, 2000), source: res.source, proposal: { blocks: res.blocks, unscheduled: res.unscheduled }, status: 'draft' })).id; } catch (e) { draftError = e.message; }
    return { proposal: { ...res, draft_id, text }, alternatives, draftError };
  };
  S.replanProposal = async (proposal, edits = {}) => { // user edited tasks in the preview; schedule + validation are recomputed, never trusted
    const c = await ctx(), tasks = proposal.tasks.map(t => ({ ...t, ...(edits[t.id] || {}) }));
    const re = proposal.replaces?.length ? { busy: (await plannedBlocks(c.nowMs - DAY, c.nowMs + 10 * DAY, new Set(proposal.replaces))).concat(await fixedBetween(c.nowMs - DAY, c.nowMs + 10 * DAY, c.tz)).map(x => ({ start: x.start, end: x.end })) } : {};
    return { ...proposeFromTasks({ tasks, fixed: proposal.fixed, questions: proposal.questions, source: proposal.source }, { ...c, ...re, settings: proposal.settings }), draft_id: proposal.draft_id, replaces: proposal.replaces, text: proposal.text, edited: true };
  };
  S.replanTask = async id => {
    const task = (await repo.listTasks()).find(t => t.id === id); if (!task) throw new Error('Task not found.');
    const nowMs = clock(), c = await ctx(), all = await repo.listBlocks(iso(nowMs - 90 * DAY), iso(nowMs + 60 * DAY)), mine = all.filter(b => b.task_id === id);
    const doneMin = mine.filter(b => b.status === 'done').reduce((a, b) => a + (Date.parse(b.end_at) - Date.parse(b.start_at)) / MIN, 0), replaces = mine.filter(b => b.status === 'planned' && Date.parse(b.start_at) >= nowMs).map(b => b.id);
    const left = Math.max(0, (task.est_minutes || DEFAULTS.defaultEst) - doneMin), skip = new Set(replaces);
    const busy = [...await fixedBetween(nowMs - DAY, nowMs + 12 * DAY, c.tz), ...await plannedBlocks(nowMs - DAY, nowMs + 12 * DAY, skip)].map(x => ({ start: x.start, end: x.end }));
    const p = proposeFromTasks({ tasks: [{ ...task, est_minutes: left || 5, status: 'todo', existing: true }], source: 'rules' }, { ...c, busy });
    return { ...(left ? p : { ...p, blocks: [] }), replaces, kind: 'replan' };
  };
  S.previewRecovery = async () => {
    const c = await ctx(), nowMs = c.nowMs, tasks = (await repo.listTasks()).filter(t => t.status !== 'done'), blocks = (await repo.listBlocks(iso(nowMs - 14 * DAY), iso(nowMs + 30 * DAY))).map(toBlock);
    const r = planRecovery({ blocks, tasks, availability: c.availability, busy: [...await fixedBetween(nowMs - DAY, nowMs + 12 * DAY, c.tz)].map(x => ({ start: x.start, end: x.end })), nowMs, tz: c.tz });
    const used = new Set(r.proposal.blocks.map(b => b.task_id)), t2 = tasks.filter(t => used.has(t.id)).map(t => ({ ...t, existing: true }));
    return { ...r.proposal, source: 'rules', kind: 'recovery', markMissed: r.markMissed, tasks: t2, fixed: [], questions: [], validation: validateSchedule({ blocks: r.proposal.blocks, tasks: t2, availability: c.availability, busy: [...await fixedBetween(nowMs, nowMs + 12 * DAY, c.tz)].map(x => ({ start: x.start, end: x.end })), tz: c.tz }) };
  };
  S.approveProposal = async proposal => {
    const c = await ctx(), replaces = new Set(proposal.replaces || []), blocks = proposal.blocks || [];
    if (!blocks.length && !(proposal.markMissed || []).length) throw new Error('There is nothing to apply.');
    const end = Math.max(...blocks.map(b => b.end), c.nowMs) + DAY, fixedNow = await fixedBetween(c.nowMs - DAY, end, c.tz), planned = await plannedBlocks(c.nowMs - DAY, end, replaces);
    const busy = [...fixedNow, ...planned, ...(proposal.fixed || [])].map(x => ({ start: x.start, end: x.end }));
    const v = validateSchedule({ blocks, tasks: proposal.tasks || [], availability: c.availability, busy, tz: c.tz, settings: proposal.settings });   // independent re-validation against CURRENT state
    if (!v.ok) throw new Error('This proposal no longer fits your calendar. ' + say(v.problems.filter(p => p.severity === 'error').map(p => p.message), 3) + ' Regenerate it to continue.');
    let events = 0; for (const f of proposal.fixed || []) { await S.addEvent({ title: f.title, start_at: iso(f.start), end_at: iso(f.end), tz: c.tz, rrule: null }); events++; }
    const ids = {}, created = []; for (const t of proposal.tasks || []) { if (t.existing) { ids[t.id] = t.id; continue; } const row = await repo.addTask({ title: t.title, est_minutes: t.est_minutes, due_at: t.due_at, priority: t.priority, quest_type: t.quest_type }); ids[t.id] = row.id; created.push(row.id); }
    const old = (await repo.listBlocks(iso(c.nowMs - DAY), iso(end))).filter(b => replaces.has(b.id));
    for (const id of replaces) await repo.deleteBlock(id);
    try { for (const id of proposal.markMissed || []) await repo.updateBlock(id, { status: 'missed' });
      if (blocks.length) await repo.addBlocks(blocks.map(b => ({ task_id: ids[b.task_id] ?? b.task_id, title: b.title, start_at: iso(b.start), end_at: iso(b.end), source: proposal.source === 'ai' ? 'ai' : 'rules', status: 'planned' }))); }
    catch (e) { if (old.length) await repo.addBlocks(old.map(({ id, ...rest }) => rest)).catch(() => {}); throw new Error('Could not apply the schedule: ' + e.message); }
    if (proposal.draft_id) await repo.updateDraft(proposal.draft_id, 'approved').catch(() => {});
    return { tasks: created.length, blocks: blocks.length, events };
  };
  S.rejectProposal = async proposal => { if (proposal?.draft_id) await repo.updateDraft(proposal.draft_id, 'rejected').catch(() => {}); return true; }; // nothing else is touched

  // ---------- settings ----------
  S.reminderSettings = async () => ({ ...DEFAULT_REMINDER_SETTINGS, ...(await repo.getReminderSettings() || {}) });
  S.saveReminderSettings = async v => {
    const ok = (x, a, b) => Number.isInteger(x) && x >= a && x <= b; if (!ok(v.lead_minutes, 0, 1440) || !ok(v.quiet_start_min, 0, 1439) || !ok(v.quiet_end_min, 0, 1439) || !ok(v.max_per_day, 1, 50)) throw new Error('Reminder settings are out of range.');
    await repo.saveReminderSettings({ enabled: !!v.enabled, lead_minutes: v.lead_minutes, quiet_start_min: v.quiet_start_min, quiet_end_min: v.quiet_end_min, max_per_day: v.max_per_day, paused_until: v.paused_until || null });
  };
  S.getAvailability = () => repo.getAvailability();
  S.saveAvailability = async rows => {
    const seen = new Set(); for (const r of rows) { if (!(Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6 && Number.isInteger(r.start_min) && Number.isInteger(r.end_min) && r.start_min >= 0 && r.end_min <= 1440 && r.end_min > r.start_min)) throw new Error('Each available window needs a start before its end.'); const k = `${r.weekday}:${r.start_min}`; if (seen.has(k)) throw new Error('Duplicate window.'); seen.add(k); }
    await repo.setAvailability(rows);
  };

  // ---------- read models for pages ----------
  const dayRange = (ms, zone, k = 0) => { const p = localParts(ms, zone); return [zonedToUtc(p.y, p.mo, p.d + k, 0, 0, zone), zonedToUtc(p.y, p.mo, p.d + k + 1, 0, 0, zone)]; };
  S.dashboard = async () => {
    const zone = await tz(), nowMs = clock(), [d0, d1] = dayRange(nowMs, zone), [tasks, ledger, avail, rs] = await Promise.all([repo.listTasks(), repo.listLedger(), repo.getAvailability(), S.reminderSettings()]);
    const open = tasks.filter(t => t.status !== 'done'), cal = await S.calendar(d0, d1), ahead = await S.calendar(nowMs, nowMs + DAY);
    const total = ledger.reduce((a, l) => a + l.xp, 0), dueKey = t => t.due_at && dateKey(localParts(Date.parse(t.due_at), zone)), today = dateKey(localParts(nowMs, zone));
    const items = [...ahead.blocks.filter(b => b.status === 'planned' && b.start > nowMs).map(b => ({ id: b.id, title: b.title, start: b.start })), ...ahead.fixed.filter(f => f.start > nowMs).map(f => ({ id: `${f.event_id}:${f.date}`, title: f.title, start: f.start }))];
    return { tz: zone, today: { fixed: cal.fixed, blocks: cal.blocks.filter(b => b.status !== 'skipped'), conflicts: cal.conflicts },
      deadlines: open.filter(t => t.due_at && Date.parse(t.due_at) <= nowMs + 7 * DAY).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)).map(t => ({ ...t, pastDue: Date.parse(t.due_at) < nowMs })),
      quests: open.filter(t => t.quest_type === 'habit' || (t.due_at && dueKey(t) <= today)), openCount: open.length, xp: levelFromXp(total), availabilityMissing: avail.length === 0,
      reminders: applyPolicy(remindersFor(items, rs.lead_minutes), rs, zone, nowMs).send.filter(r => r.at >= nowMs - 60000).slice(0, 5) };
  };
  S.character = async () => {
    const [ledger, unlocked, tasks] = await Promise.all([repo.listLedger(), repo.listAchievements(), repo.listTasks()]), total = ledger.reduce((a, l) => a + l.xp, 0), got = new Set(unlocked);
    return { xp: levelFromXp(total), history: ledger.slice(0, 20), skills: Object.entries(SKILLS).map(([k, name]) => { const xp = ledger.filter(l => l.skill === k).reduce((a, l) => a + l.xp, 0); return { key: k, name, xp, ...skillRank(xp) }; }),
      achievements: Object.entries(ACHIEVEMENTS).map(([k, a]) => ({ key: k, name: a.name, unlocked: got.has(k) })), completed: tasks.filter(t => t.status === 'done').sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at)).slice(0, 10) };
  };
  S.progress = async () => {
    const zone = await tz(), nowMs = clock(), days = [...Array(7).keys()].map(i => dayRange(nowMs, zone, i - 6)), from = days[0][0], to = days[6][1];
    const [tasks, cats, blocks] = await Promise.all([repo.listTasks(), repo.listCategories(), repo.listBlocks(iso(from), iso(to))]);
    const done = tasks.filter(t => t.status === 'done' && t.completed_at && Date.parse(t.completed_at) >= from && Date.parse(t.completed_at) < to), name = id => cats.find(c => c.id === id)?.name ?? 'Uncategorised';
    const perDay = days.map(([a, b]) => ({ date: dateKey(localParts(a, zone)), completed: done.filter(t => Date.parse(t.completed_at) >= a && Date.parse(t.completed_at) < b).length }));
    const mins = s => blocks.filter(b => b.status === s).reduce((a, b) => a + (Date.parse(b.end_at) - Date.parse(b.start_at)) / MIN, 0), byCat = {}; for (const t of done) byCat[name(t.category_id)] = (byCat[name(t.category_id)] || 0) + 1;
    const missed = blocks.filter(b => b.status === 'missed').length, overdue = tasks.filter(t => t.status !== 'done' && t.due_at && Date.parse(t.due_at) < nowMs).length, tips = [];
    if (missed) tips.push(`${missed} planned session${missed > 1 ? 's were' : ' was'} missed. That happens: re-plan them from the Planner whenever you’re ready.`);
    if (overdue) tips.push(`${overdue} task${overdue > 1 ? 's are' : ' is'} past due. Pick the smallest one, or move its deadline.`);
    if (!done.length && tasks.some(t => t.status !== 'done')) tips.push('Nothing completed yet this week. One small quest is a fine place to start.');
    return { weekStart: perDay[0].date, perDay, completed: done.length, sessions: { planned: blocks.filter(b => b.status === 'planned').length, done: blocks.filter(b => b.status === 'done').length, missed }, minutes: { planned: mins('planned'), done: mins('done') }, byCategory: byCat, tips };
  };
  S.exportAll = async () => ({ exported_at: iso(clock()), profile: await repo.getProfile(), categories: await repo.listCategories(), tasks: await repo.listTasks(), events: await repo.listEvents(), schedule_blocks: await repo.listBlocks('1970-01-01T00:00:00Z', '2100-01-01T00:00:00Z'),
    availability: await repo.getAvailability(), reminder_settings: await repo.getReminderSettings(), xp_ledger: await repo.listLedger(), achievements: await repo.listAchievements() });
  S.getReview = w => repo.getReview(w);
  S.saveReview = async (w, notes) => { if (String(notes).length > 2000) throw new Error('Reflections are limited to 2000 characters.'); return repo.saveReview(w, notes); };
  return S;
}
