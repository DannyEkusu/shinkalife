import test from 'node:test'; import assert from 'node:assert/strict';
import { zonedToUtc } from '../js/recur-core.js';
import { createMockRepo } from '../js/repo-mock.js';
import { createService } from '../js/service.js';
import { repo as proxy, setRepo, repoKind } from '../js/repo.js';
import * as Theme from '../js/theme.js';
const L = 'Europe/London', loc = (y, mo, d, h = 0, mi = 0) => zonedToUtc(y, mo, d, h, mi, L), NOW = loc(2026, 10, 13, 8), clock = () => NOW, iso = ms => new Date(ms).toISOString(), DAY = 864e5;
const fresh = (seed = true) => { const repo = createMockRepo({ clock, tz: L, seed }); return { repo, svc: createService(repo, { clock }) }; };
const allBlocks = repo => repo.listBlocks(iso(NOW - 30 * DAY), iso(NOW + 60 * DAY));
const task = (o = {}) => ({ title: 'Chemistry report', quest_type: 'main', priority: 3, est_minutes: 120, due_at: iso(loc(2026, 10, 16, 17)), ...o });

test('1. a created task reaches the dashboard and the scheduler', async () => {
  const { svc } = fresh(); const t = await svc.createTask(task({ est_minutes: 90, due_at: iso(loc(2026, 10, 15, 17)) }));
  const d = await svc.dashboard(); assert.ok(d.deadlines.some(x => x.id === t.id)); assert.equal(d.availabilityMissing, false);
  const p = await svc.replanTask(t.id); assert.equal(p.blocks.reduce((a, b) => a + (b.end - b.start) / 60000, 0), 90); assert.ok(p.validation.ok);
  await assert.rejects(svc.createTask({ title: '', quest_type: 'side', priority: 2 }), /Title/); });

test('2. editing a deadline gives a reviewable re-plan that explains a shortfall', async () => {
  const { svc, repo } = fresh(); const t = await svc.createTask(task());
  await svc.approveProposal(await svc.replanTask(t.id)); const before = (await allBlocks(repo)).filter(b => b.task_id === t.id); assert.equal(before.length, 2);
  const review = await svc.updateTask(t.id, task({ due_at: iso(loc(2026, 10, 13, 10, 30)) })); assert.equal(review.needsReplan, true);
  const p = await svc.replanTask(t.id); assert.equal(p.replaces.length, 2); assert.equal(p.unscheduled.length, 1); assert.match(p.unscheduled[0].explain, /deadline/);
  assert.equal((await allBlocks(repo)).length, 2, 'proposal alone changes nothing');
  await svc.approveProposal(p); const after = await allBlocks(repo); assert.equal(after.length, 1); assert.ok(Date.parse(after[0].end_at) <= loc(2026, 10, 13, 10, 30)); });

test('3. rejecting a proposal leaves the schedule unchanged', async () => {
  const { svc, repo } = fresh(); const before = await allBlocks(repo), tasksBefore = (await repo.listTasks()).length;
  const { proposal } = await svc.generateProposal('study chemistry for 2 hours on Friday, practise guitar three times this week');
  assert.equal(proposal.source, 'rules'); assert.ok(proposal.blocks.length >= 4); await svc.rejectProposal(proposal);
  assert.deepEqual(await allBlocks(repo), before); assert.equal((await repo.listTasks()).length, tasksBefore); assert.equal(repo._db.drafts[0].status, 'rejected'); });

test('4. approving a valid proposal applies tasks, commitments and blocks without conflicts', async () => {
  const { svc, repo } = fresh(); const { proposal } = await svc.generateProposal('Sunday music session at 3pm for 1 hour, study chemistry for 2 hours on Friday');
  assert.equal(proposal.fixed.length, 1); const tasksBefore = (await repo.listTasks()).length, eventsBefore = (await repo.listEvents()).length;
  const r = await svc.approveProposal(proposal); assert.deepEqual([r.tasks, r.events], [1, 1]); assert.equal(r.blocks, proposal.blocks.length);
  assert.equal((await repo.listTasks()).length, tasksBefore + 1); assert.equal((await repo.listEvents()).length, eventsBefore + 1);
  const cal = await svc.calendar(NOW, NOW + 8 * DAY); assert.equal(cal.conflicts.length, 0); assert.equal(repo._db.drafts[0].status, 'approved');
  assert.ok((await allBlocks(repo)).every(b => b.source === 'rules')); });

test('5. a stale proposal is re-validated and refused', async () => {
  const { svc, repo } = fresh(); const { proposal } = await svc.generateProposal('study chemistry for 2 hours');
  await svc.addEvent({ title: 'Dentist', start_at: iso(loc(2026, 10, 13, 9)), end_at: iso(loc(2026, 10, 13, 10)), tz: L, rrule: null });
  await assert.rejects(svc.approveProposal(proposal), /no longer fits/); assert.equal((await allBlocks(repo)).length, 0); });

test('6. conflicting and invalid events are rejected; recurring events expand', async () => {
  const { svc } = fresh(); const { proposal } = await svc.generateProposal('study chemistry for 2 hours'); await svc.approveProposal(proposal);
  const ev = (o) => ({ title: 'X', start_at: iso(loc(2026, 10, 20, 9)), end_at: iso(loc(2026, 10, 20, 10)), tz: L, rrule: null, ...o });
  await assert.rejects(svc.addEvent(ev({ start_at: iso(loc(2026, 10, 13, 9, 30)), end_at: iso(loc(2026, 10, 13, 10, 30)) })), /Conflicting commitment/);
  await assert.rejects(svc.addEvent(ev({ start_at: iso(loc(2026, 10, 14, 10)), end_at: iso(loc(2026, 10, 14, 10, 30)) })), /Conflicting commitment/);
  for (const [bad, re] of [[{ end_at: iso(loc(2026, 10, 20, 8)) }, /end after/], [{ end_at: iso(loc(2026, 10, 22, 9)) }, /24 hours/], [{ tz: 'Mars/Base' }, /timezone/], [{ rrule: { freq: 'monthly' } }, /daily or weekly/], [{ title: ' ' }, /Title/]]) await assert.rejects(svc.addEvent(ev(bad)), re);
  await svc.addEvent(ev({ title: 'Club', start_at: iso(loc(2026, 10, 15, 18)), end_at: iso(loc(2026, 10, 15, 19)), rrule: { freq: 'weekly', days: [4] } }));
  const cal = await svc.calendar(NOW, NOW + 22 * DAY); assert.equal(cal.fixed.filter(f => f.title === 'Club').length, 3); });

test('7. one occurrence can be skipped or moved without touching the series', async () => {
  const { svc, repo } = fresh(); const id = (await repo.listEvents())[0].id, lec = c => c.fixed.filter(f => f.event_id === id);
  assert.equal(lec(await svc.calendar(NOW, NOW + 22 * DAY)).length, 3); await svc.skipOccurrence(id, '2026-10-21'); assert.equal(lec(await svc.calendar(NOW, NOW + 22 * DAY)).length, 2);
  await svc.addEvent({ title: 'Club', start_at: iso(loc(2026, 10, 29, 18)), end_at: iso(loc(2026, 10, 29, 19)), tz: L, rrule: null });
  await assert.rejects(svc.moveOccurrence(id, '2026-10-28', loc(2026, 10, 29, 18, 30), loc(2026, 10, 29, 19, 30)), /overlaps/);
  await svc.moveOccurrence(id, '2026-10-28', loc(2026, 10, 29, 12), loc(2026, 10, 29, 13)); const m = lec(await svc.calendar(NOW, NOW + 22 * DAY));
  assert.equal(m.length, 2); assert.equal(m.filter(x => x.moved).length, 1); assert.equal(m.find(x => x.moved).start, loc(2026, 10, 29, 12)); });

test('8. XP: correct amount, once only, ledger and level consistent, retry after failure', async () => {
  const { svc, repo } = fresh(); const a = await svc.createTask(task({ est_minutes: 30 })), b = await svc.createTask({ title: 'Small', quest_type: 'side', priority: 2 });
  const r1 = await svc.setTaskDone(a.id, true); assert.equal(r1.award.xp, 60); assert.equal(r1.award.awarded, true);
  await svc.setTaskDone(a.id, false); const r2 = await svc.setTaskDone(a.id, true); assert.equal(r2.award.awarded, false);
  await Promise.all([svc.setTaskDone(b.id, true), svc.setTaskDone(b.id, true)]);
  const c = await svc.character(), ledgerSum = (await repo.listLedger()).reduce((x, l) => x + l.xp, 0); assert.equal(c.xp.total, 80); assert.equal(ledgerSum, 80); assert.equal((await repo.listLedger()).length, 2);
  assert.equal(c.xp.level, 1); assert.ok(c.achievements.find(x => x.key === 'first-quest').unlocked); assert.ok(!c.achievements.find(x => x.key === 'level-5').unlocked); assert.equal((await svc.dashboard()).xp.total, 80);
  const flaky = createService({ ...repo, awardTaskXp: async () => { throw new Error('offline'); } }, { clock }), t = await flaky.createTask({ title: 'Later', quest_type: 'main', priority: 3 });
  const r3 = await flaky.setTaskDone(t.id, true); assert.equal(r3.award, null); assert.equal(r3.awardError, 'offline');
  assert.equal(await svc.claimPendingXp(), 1); assert.equal(await svc.claimPendingXp(), 0); assert.equal((await svc.character()).xp.total, 140); });

test('9. repository errors surface; nothing silently falls back to mock', async () => {
  const { repo } = fresh(); await assert.rejects(createService({ ...repo, listTasks: async () => { throw new Error('network down'); } }, { clock }).dashboard(), /network down/);
  assert.equal(repoKind(), 'none'); assert.throws(() => proxy.listTasks(), /No data source/); setRepo(repo, 'mock'); assert.equal(typeof proxy.listTasks, 'function'); setRepo(null, 'none'); assert.throws(() => proxy.listTasks(), /No data source/); });

test('10. missed work is recovered once, without duplicates', async () => {
  const { svc, repo } = fresh(); const t = await svc.createTask({ title: 'Read', quest_type: 'side', priority: 2, est_minutes: 60 });
  const [past] = await repo.addBlocks([{ task_id: t.id, title: 'Read', start_at: iso(loc(2026, 10, 12, 9)), end_at: iso(loc(2026, 10, 12, 10)) }]);
  const p = await svc.previewRecovery(); assert.deepEqual(p.markMissed, [past.id]); assert.equal(p.blocks.reduce((a, b) => a + (b.end - b.start) / 60000, 0), 60); await svc.approveProposal(p);
  const bs = await allBlocks(repo); assert.equal(bs.find(b => b.id === past.id).status, 'missed'); assert.equal(bs.filter(b => b.status === 'planned').length, 1);
  const again = await svc.previewRecovery(); assert.equal(again.markMissed.length, 0); assert.equal(again.blocks.length, 0); assert.equal((await svc.progress()).sessions.missed, 1); });

test('11. manual blocks: overlaps rejected, availability is a warning, moves are validated', async () => {
  const { svc } = fresh(); const { block } = await svc.addBlock({ title: 'Deep work', start: loc(2026, 10, 13, 12), end: loc(2026, 10, 13, 13) });
  await assert.rejects(svc.addBlock({ title: 'Clash', start: loc(2026, 10, 13, 12, 30), end: loc(2026, 10, 13, 13, 30) }), /overlaps/);
  await assert.rejects(svc.addBlock({ title: 'In lecture', start: loc(2026, 10, 14, 10), end: loc(2026, 10, 14, 10, 30) }), /fixed commitment/);
  const night = await svc.addBlock({ title: 'Night owl', start: loc(2026, 10, 17, 3), end: loc(2026, 10, 17, 4) }); assert.ok(night.warnings.some(w => /available hours/.test(w)));
  await assert.rejects(svc.moveBlock(night.block.id, loc(2026, 10, 13, 12, 15), loc(2026, 10, 13, 12, 45)), /overlaps/); const ok = await svc.moveBlock(night.block.id, loc(2026, 10, 13, 15), loc(2026, 10, 13, 16)); assert.ok(Array.isArray(ok.warnings));
  assert.equal((await svc.calendar(NOW, NOW + DAY)).conflicts.length, 0); assert.ok(block.id); });

test('12. empty accounts show honest empty states, not fabricated data', async () => {
  const { svc } = fresh(false), d = await svc.dashboard(); assert.equal(d.xp.total, 0); assert.equal(d.xp.level, 1); assert.deepEqual(d.deadlines, []); assert.equal(d.availabilityMissing, true);
  const p = await svc.progress(); assert.equal(p.completed, 0); assert.equal(p.perDay.length, 7); assert.ok(p.perDay.every(x => x.completed === 0)); assert.deepEqual(p.byCategory, {});
  await assert.rejects(svc.generateProposal('study'), /available hours/); const c = await svc.character(); assert.equal(c.history.length, 0); assert.ok(c.achievements.every(a => !a.unlocked)); });

test('13. progress, reminders and settings use real data', async () => {
  const { svc, repo } = fresh(); const t = await svc.createTask(task({ category_id: (await repo.listCategories())[0].id })); await svc.setTaskDone(t.id, true);
  const p = await svc.progress(); assert.equal(p.completed, 1); assert.equal(p.perDay[6].completed, 1); assert.equal(p.byCategory.Study, 1);
  await svc.addBlock({ title: 'Focus', start: loc(2026, 10, 13, 14), end: loc(2026, 10, 13, 15) }); const d = await svc.dashboard(); assert.ok(d.reminders.some(r => r.title === 'Focus' && r.at === loc(2026, 10, 13, 13, 50)));
  assert.equal(d.today.blocks.length, 1); await svc.saveReminderSettings({ enabled: true, lead_minutes: 30, quiet_start_min: 1320, quiet_end_min: 420, max_per_day: 5 }); assert.equal((await svc.reminderSettings()).lead_minutes, 30);
  await assert.rejects(svc.saveReminderSettings({ enabled: true, lead_minutes: 9999, quiet_start_min: 0, quiet_end_min: 0, max_per_day: 5 }), /out of range/);
  await assert.rejects(svc.saveAvailability([{ weekday: 1, start_min: 600, end_min: 500 }]), /before its end/); await svc.saveAvailability([{ weekday: 1, start_min: 540, end_min: 1020 }]); assert.equal((await svc.getAvailability()).length, 1);
  await assert.rejects(svc.saveReview('2026-10-12', 'x'.repeat(2001)), /2000/); await svc.saveReview('2026-10-12', 'Good week'); assert.equal(await svc.getReview('2026-10-12'), 'Good week'); });

test('14. theme persistence: local storage mode, corruption and storage failure', () => {
  const store = {}; globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const t = { preset: 'midnight-blue', bg: '#0c1a2b', accent: '#6aa7ff', mode: 'dark', reducedMotion: true }; Theme.saveLocal(t); assert.deepEqual(Theme.loadLocal(), t);
  store['shinkalife.theme'] = '{bad json'; assert.deepEqual(Theme.loadLocal(), Theme.sanitizeTheme(Theme.DEFAULT_THEME)); store['shinkalife.theme'] = JSON.stringify({ bg: 'url(evil)', accent: '#6aa7ff' }); assert.equal(Theme.loadLocal().bg, Theme.DEFAULT_THEME.bg);
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }; assert.doesNotThrow(() => Theme.saveLocal(t)); assert.equal(Theme.loadLocal().bg, Theme.DEFAULT_THEME.bg); delete globalThis.localStorage; });
