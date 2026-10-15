import test from 'node:test'; import assert from 'node:assert/strict';
import { zonedToUtc, localParts, expandOccurrences } from '../js/recur-core.js';
import { schedule, validateSchedule, findConflicts, planRecovery } from '../js/schedule-core.js';
import { levelFromXp, xpForNext, taskXp, applyDailyCap, skillRank, unlockedAchievements } from '../js/xp-core.js';
import { inQuietHours, applyPolicy, remindersFor } from '../js/reminders-core.js';
import { parsePlan, buildProposal, compareAlternatives } from '../js/planner-core.js';
import { planWithAI, sanitizeAITasks, createServerProvider } from '../js/planner-ai.js';
const L = 'Europe/London', loc = (y, mo, d, h, mi = 0, tz = L) => zonedToUtc(y, mo, d, h, mi, tz), M = 60000;
const avail = [1, 2, 3, 4, 5].map(w => ({ weekday: w, start_min: 540, end_min: 1020 }));
const now = loc(2026, 10, 13, 8, 0); // Tuesday 08:00 London
const ctx = { nowMs: now, tz: L, availability: avail };

test('timezone conversion incl. DST edges', () => {
  assert.equal(loc(2026, 10, 13, 9), Date.UTC(2026, 9, 13, 8)); assert.equal(loc(2026, 1, 13, 9), Date.UTC(2026, 0, 13, 9));
  assert.equal(loc(2026, 3, 29, 1, 30), Date.UTC(2026, 2, 29, 1, 30)); // nonexistent 01:30 moves forward to 02:30 BST
  assert.equal(localParts(loc(2026, 10, 13, 9), L).h, 9); });
test('weekly event keeps local wall time across DST', () => {
  const ev = { id: 'e', title: 'Class', tz: L, start_at: new Date(loc(2026, 3, 23, 9)).toISOString(), end_at: new Date(loc(2026, 3, 23, 10)).toISOString(), rrule: { freq: 'weekly', days: [1] } };
  const o = expandOccurrences(ev, loc(2026, 3, 20, 0), loc(2026, 4, 10, 0)); assert.equal(o.length, 3);
  assert.equal(o[0].start, Date.UTC(2026, 2, 23, 9)); assert.equal(o[1].start, Date.UTC(2026, 2, 30, 8)); assert.equal(o[2].end - o[2].start, 3600000); });
test('daily event across US DST start keeps 20:00 local', () => {
  const ev = { id: 'n', tz: 'America/New_York', start_at: new Date(loc(2026, 3, 7, 20, 0, 'America/New_York')).toISOString(), end_at: new Date(loc(2026, 3, 7, 21, 0, 'America/New_York')).toISOString(), rrule: { freq: 'daily' } };
  const o = expandOccurrences(ev, Date.UTC(2026, 2, 7), Date.UTC(2026, 2, 10)); assert.equal(o[1].start - o[0].start, 23 * 3600000); });
test('exceptions change one occurrence only; until/interval respected', () => {
  const base = { id: 'm', title: 'Music', tz: L, start_at: new Date(loc(2026, 10, 4, 15)).toISOString(), end_at: new Date(loc(2026, 10, 4, 16)).toISOString(), rrule: { freq: 'weekly', days: [0] } };
  const w = (ev) => expandOccurrences(ev, loc(2026, 10, 1, 0), loc(2026, 11, 2, 0));
  assert.equal(w(base).length, 5); // Oct 4,11,18,25 and Nov 1
  const moved = w({ ...base, exceptions: [{ date: '2026-10-11', action: 'move', new_start: new Date(loc(2026, 10, 11, 17)).toISOString(), new_end: new Date(loc(2026, 10, 11, 18)).toISOString() }] });
  assert.equal(moved.filter(x => x.moved).length, 1); assert.equal(moved.length, 5); assert.equal(moved[2].start, loc(2026, 10, 18, 15));
  assert.equal(w({ ...base, exceptions: [{ date: '2026-10-18', action: 'skip' }] }).length, 4);
  assert.equal(w({ ...base, rrule: { ...base.rrule, until: new Date(loc(2026, 10, 12, 0)).toISOString() } }).length, 2);
  assert.equal(w({ ...base, rrule: { ...base.rrule, interval: 2 } }).length, 3); });

const meeting = { start: loc(2026, 10, 13, 10), end: loc(2026, 10, 13, 11) };
const T = [{ id: 'a', title: 'Maths revision', est_minutes: 120, due_at: new Date(loc(2026, 10, 15, 8)).toISOString(), priority: 3, status: 'todo' }, { id: 'b', title: 'Website', est_minutes: 60, due_at: null, priority: 1, status: 'todo' }];
test('scheduler: valid, no overlaps, respects busy/availability/deadline/breaks', () => {
  const r = schedule({ tasks: T, availability: avail, busy: [meeting], nowMs: now, tz: L });
  assert.equal(r.unscheduled.length, 0); assert.equal(r.blocks[0].start, loc(2026, 10, 13, 9)); assert.equal(findConflicts(r.blocks).length, 0);
  for (const b of r.blocks) assert.ok(!(b.start < meeting.end && meeting.start < b.end));
  assert.ok(r.blocks.filter(b => b.task_id === 'a').every(b => b.end <= loc(2026, 10, 15, 8)));
  const v = validateSchedule({ blocks: r.blocks, tasks: T, availability: avail, busy: [meeting], tz: L }); assert.ok(v.ok, JSON.stringify(v.problems));
  assert.equal(v.problems.filter(p => p.type === 'missing_break').length, 0); assert.ok(r.explanations.length >= 1); });
test('scheduler is deterministic', () => { const a = schedule({ tasks: T, availability: avail, busy: [meeting], nowMs: now, tz: L }), b = schedule({ tasks: [...T].reverse(), availability: avail, busy: [meeting], nowMs: now, tz: L }); assert.deepEqual(a.blocks, b.blocks); });
test('unrealistic workload is reported, not hidden', () => {
  const r = schedule({ tasks: [{ id: 'x', title: 'Huge', est_minutes: 2400, due_at: new Date(loc(2026, 10, 14, 17)).toISOString(), priority: 3, status: 'todo' }], availability: avail, nowMs: now, tz: L });
  assert.equal(r.unscheduled.length, 1); assert.equal(r.unscheduled[0].reason, 'no_time_before_deadline'); assert.ok(r.unscheduled[0].minutes_short > 0 && /deadline/.test(r.unscheduled[0].explain)); });
test('daily limit is enforced', () => {
  const r = schedule({ tasks: [{ id: 'y', title: 'Big', est_minutes: 600, due_at: null, priority: 2, status: 'todo' }], availability: avail, nowMs: now, tz: L, settings: { maxDailyMin: 240 } });
  const per = {}; for (const b of r.blocks) { const k = new Date(b.start).toISOString().slice(0, 10); per[k] = (per[k] || 0) + (b.end - b.start) / M; } assert.ok(Object.values(per).every(m => m <= 240)); assert.equal(r.unscheduled.length, 0); });
test('validator independently catches bad schedules', () => {
  const t = T[0], mk = (s, e, id = 'a') => ({ task_id: id, title: 'T', start: s, end: e }), run = blocks => validateSchedule({ blocks, tasks: [t], availability: avail, busy: [meeting], tz: L });
  const types = r => r.problems.map(p => p.type);
  assert.ok(types(run([mk(loc(2026, 10, 13, 12), loc(2026, 10, 13, 13)), mk(loc(2026, 10, 13, 12, 30), loc(2026, 10, 13, 13, 30))])).includes('overlap'));
  assert.ok(types(run([mk(loc(2026, 10, 13, 6), loc(2026, 10, 13, 7))])).includes('outside_availability'));
  assert.ok(types(run([mk(loc(2026, 10, 13, 10, 30), loc(2026, 10, 13, 11, 30))])).includes('busy_overlap'));
  assert.ok(types(run([mk(loc(2026, 10, 15, 9), loc(2026, 10, 15, 10))])).includes('after_deadline'));
  assert.ok(types(run([mk(loc(2026, 10, 17, 10), loc(2026, 10, 17, 11))])).includes('outside_availability')); // Saturday has no hours
  assert.equal(run([mk(loc(2026, 10, 13, 12), loc(2026, 10, 13, 13))]).ok, true); });
test('missed-task recovery re-plans only the shortfall (no duplicates)', () => {
  const t = { id: 'a', title: 'Maths', est_minutes: 120, due_at: null, priority: 2, status: 'todo' }, n = loc(2026, 10, 13, 14);
  const blocks = [{ id: 'b1', task_id: 'a', title: 'Maths', start: loc(2026, 10, 13, 9), end: loc(2026, 10, 13, 10), status: 'planned' }, { id: 'b2', task_id: 'a', title: 'Maths', start: loc(2026, 10, 14, 9), end: loc(2026, 10, 14, 10), status: 'planned' }];
  const r = planRecovery({ blocks, tasks: [t], availability: avail, nowMs: n, tz: L }); assert.deepEqual(r.markMissed, ['b1']);
  assert.equal(r.proposal.blocks.reduce((a, b) => a + (b.end - b.start) / M, 0), 60); assert.ok(r.proposal.blocks.every(b => b.start >= n && !(b.start < blocks[1].end && blocks[1].start < b.end)));
  assert.equal(planRecovery({ blocks: [{ ...blocks[0], status: 'done' }], tasks: [t], availability: avail, nowMs: n, tz: L }).proposal.blocks.length, 0); });

test('XP levels, rewards, caps, skills, achievements', () => {
  assert.equal(xpForNext(1), 100); assert.equal(xpForNext(3), 200); assert.deepEqual(levelFromXp(0), { level: 1, into: 0, needed: 100, pct: 0, total: 0 });
  assert.equal(levelFromXp(100).level, 2); assert.equal(levelFromXp(249).into, 149); assert.equal(levelFromXp(250).level, 3); assert.equal(levelFromXp(-5).level, 1);
  assert.equal(taskXp({ priority: 3, quest_type: 'main' }), 60); assert.equal(taskXp({ priority: 1, quest_type: 'side' }), 10);
  assert.equal(applyDailyCap(280, 60), 20); assert.equal(applyDailyCap(300, 10), 0); assert.equal(skillRank(0).rank, 'Novice'); assert.equal(skillRank(300).rank, 'Adept'); assert.equal(skillRank(1e6).next, null);
  assert.deepEqual(unlockedAchievements({ completed: 1, totalXp: 0 }), ['first-quest']); });
test('reminders: quiet hours wrap midnight, deferral, limits, pause', () => {
  const q = { quiet_start_min: 1320, quiet_end_min: 420 }; assert.ok(inQuietHours(1400, q) && inQuietHours(60, q) && !inQuietHours(600, q) && !inQuietHours(420, q));
  const mk = (h, mi, startH) => ({ key: `${h}${mi}`, title: 'x', at: loc(2026, 10, 13, h, mi), start: loc(2026, 10, 13, startH, 0) });
  const r = applyPolicy([mk(6, 50, 9), mk(6, 55, 7), mk(12, 0, 12)], { quiet_start_min: 1320, quiet_end_min: 420 }, L);
  assert.equal(r.deferred.length, 1); assert.equal(r.deferred[0].at, loc(2026, 10, 13, 7, 0)); assert.equal(r.dropped[0].why, 'quiet_hours'); assert.equal(r.send.length, 2);
  const many = Array.from({ length: 5 }, (_, i) => mk(12 + i, 0, 13 + i)); assert.equal(applyPolicy(many, { max_per_day: 3 }, L).dropped.length, 2);
  assert.equal(applyPolicy(many, { paused_until: new Date(loc(2026, 10, 14, 0)).toISOString() }, L).send.length, 0); assert.equal(applyPolicy(many, { enabled: false }, L).send.length, 0);
  assert.equal(remindersFor([{ task_id: 't', start: 1e9, title: 'a' }], 10)[0].at, 1e9 - 600000); });

const TEXT = 'I have a mathematics test on Thursday, want to practise drawing three times this week, have a Sunday music session, and need time to work on my website.';
test('rule planner parses the example, asks for missing info, labels itself rules', () => {
  const p = parsePlan(TEXT, ctx); assert.equal(p.tasks.filter(t => t.quest_type === 'habit').length, 3); assert.ok(p.tasks.some(t => /Prepare: .*test/i.test(t.title) && t.priority === 3));
  assert.ok(p.tasks.some(t => /website/i.test(t.title))); assert.equal(p.questions.length, 1); assert.match(p.questions[0], /music session/i); assert.ok(p.tasks.every(t => t.assumptions.length));
  const withTime = parsePlan('Sunday music session at 3pm for 2 hours', ctx); assert.equal(withTime.fixed.length, 1); assert.equal((withTime.fixed[0].end - withTime.fixed[0].start) / M, 120);
  const prop = buildProposal(TEXT, ctx); assert.equal(prop.source, 'rules'); assert.ok(prop.validation.ok); assert.ok(prop.blocks.length > 3); });
test('alternatives differ and all validate', () => { const a = compareAlternatives(TEXT, ctx); assert.equal(a.length, 3); for (const x of a) assert.ok(x.proposal.validation.ok, x.name); });
test('AI layer: fallback, malformed output, errors, limits, honest labelling', async () => {
  const good = { name: 't', proposeTasks: async () => ({ tasks: [{ title: 'Read ch 3', est_minutes: 60, priority: 2, quest_type: 'side' }] }) };
  const ok = await planWithAI('read', ctx, good); assert.equal(ok.source, 'ai'); assert.ok(ok.validation.ok); assert.equal(ok.blocks.length, 1);
  assert.equal((await planWithAI('read my book', ctx, null)).source, 'rules'); assert.equal((await planWithAI('x', ctx, null)).aiAvailable, false);
  for (const bad of [async () => ({}), async () => ({ tasks: [{ title: '' }] }), async () => ({ tasks: [{ title: 'x', est_minutes: 99999 }] }), async () => ({ tasks: 'no' }), async () => { throw new Error('boom'); }]) {
    const r = await planWithAI('study maths on Friday', ctx, { proposeTasks: bad }); assert.equal(r.source, 'rules'); assert.ok(r.aiError); assert.ok(r.blocks.length > 0); }
  assert.equal((await planWithAI('x'.repeat(2001), ctx, good)).ok, false); assert.equal(sanitizeAITasks({ tasks: Array(31).fill({ title: 'a' }) }).ok, false);
  const prov = createServerProvider({ endpoint: 'https://example.invalid/plan', getToken: async () => 't', fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.match((await planWithAI('study', ctx, prov)).aiError, /503`?|503\./); });
