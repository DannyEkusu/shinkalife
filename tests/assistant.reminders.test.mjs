import test from 'node:test'; import assert from 'node:assert/strict';
import { zonedToUtc } from '../js/recur-core.js'; import { createMockRepo } from '../js/repo-mock.js'; import { createService, normalizeAssistantName, DEFAULT_ASSISTANT_NAME } from '../js/service.js';
import { parsePlan } from '../js/planner-core.js'; import { reminderAlerts, validateReminder, dueAlerts } from '../js/reminders-core.js';
const L = 'Europe/London', loc = (y, mo, d, h = 0, mi = 0) => zonedToUtc(y, mo, d, h, mi, L), iso = ms => new Date(ms).toISOString(), M = 60000;
const rig = ({ seed = false, provider = null } = {}) => { const st = { now: loc(2026, 10, 13, 8) }, clock = () => st.now, repo = createMockRepo({ clock, tz: L, seed }); return { st, repo, svc: createService(repo, { clock, provider }) }; };
const rem = (o = {}) => ({ title: 'Revise maths', kind: 'study', remind_at: iso(loc(2026, 10, 13, 14)), ...o });
const SETTINGS = { enabled: true, lead_minutes: 10, quiet_start_min: 1320, quiet_end_min: 420, max_per_day: 8 };

test('assistant name: normalisation rules', () => {
  assert.equal(normalizeAssistantName('  Nova  '), 'Nova'); assert.equal(normalizeAssistantName('Zoë  Ann-Marie'), 'Zoë Ann-Marie'); assert.equal(normalizeAssistantName(''), null); assert.equal(normalizeAssistantName('   '), null); assert.equal(normalizeAssistantName(undefined), null);
  for (const bad of ['x'.repeat(31), '<b>Bot</b>', 'A&B', 'say "hi"', 'tick`s', 'bell\u0007']) assert.throws(() => normalizeAssistantName(bad), bad); assert.equal(normalizeAssistantName('x'.repeat(30)).length, 30); });
test('assistant name: default, save, persist, reset, invalid input leaves it unchanged', async () => {
  const { svc, repo } = rig(); let a = await svc.assistant(); assert.deepEqual([a.name, a.isDefault, a.aiConfigured, a.aiOptIn, a.aiActive], [DEFAULT_ASSISTANT_NAME, true, false, false, false]);
  assert.equal(await svc.saveAssistantName('  Nova '), 'Nova'); a = await svc.assistant(); assert.deepEqual([a.name, a.isDefault], ['Nova', false]); assert.equal((await repo.getAssistantPrefs()).assistant_name, 'Nova');
  await assert.rejects(svc.saveAssistantName('<script>'), /avoid/); assert.equal((await svc.assistant()).name, 'Nova');
  assert.equal(await svc.saveAssistantName(''), DEFAULT_ASSISTANT_NAME); assert.equal((await repo.getAssistantPrefs()).assistant_name, null); assert.equal((await svc.assistant()).isDefault, true); });
test('assistant name belongs to one account only (separate data stores never mix)', async () => {
  const a = rig(), b = rig(); await a.svc.saveAssistantName('Nova'); assert.equal((await b.svc.assistant()).name, DEFAULT_ASSISTANT_NAME); });

test('AI is only used when configured AND the user opted in; context sent is minimal', async () => {
  const calls = []; const provider = { proposeTasks: async (...args) => { calls.push(args); return { tasks: [{ title: 'Read chapter', est_minutes: 60, priority: 2, quest_type: 'side' }] }; } };
  const { svc } = rig({ seed: true, provider });
  let a = await svc.assistant(); assert.deepEqual([a.aiConfigured, a.aiOptIn, a.aiActive], [true, false, false]);
  let r = await svc.generateProposal('read my book'); assert.equal(r.proposal.source, 'rules'); assert.equal(calls.length, 0, 'no data sent before opt-in');
  await svc.setAiOptIn(true); r = await svc.generateProposal('read my book'); assert.equal(r.proposal.source, 'ai'); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'read my book'); assert.deepEqual(Object.keys(calls[0][1]).sort(), ['today', 'tz']); assert.match(calls[0][1].today, /^\d{4}-\d\d-\d\d$/); assert.ok(r.proposal.validation.ok);
  await svc.setAiOptIn(false); assert.equal((await svc.generateProposal('read my book')).proposal.source, 'rules'); assert.equal(calls.length, 1); });
test('opt-in without any provider stays honestly rule-based; provider errors fall back with the reason', async () => {
  const none = rig({ seed: true }); await none.svc.setAiOptIn(true); assert.equal((await none.svc.assistant()).aiActive, false); assert.equal((await none.svc.generateProposal('study')).proposal.source, 'rules');
  const bad = rig({ seed: true, provider: { proposeTasks: async () => { throw new Error('The daily AI limit has been reached.'); } } }); await bad.svc.setAiOptIn(true);
  const r = await bad.svc.generateProposal('study chemistry'); assert.equal(r.proposal.source, 'rules'); assert.match(r.proposal.aiError, /daily AI limit/); assert.ok(r.proposal.blocks.length > 0); });
test('rule-based goal breakdown splits big tasks only', () => {
  const ctx = { nowMs: loc(2026, 10, 13, 8), tz: L }, p = parsePlan('work on the website for 6 hours', ctx); assert.equal(p.tasks.length, 3); assert.ok(p.tasks.every(t => t.est_minutes === 120 && /part \d\/3/.test(t.title) && /Split into 3/.test(t.assumptions.join(' '))));
  assert.equal(parsePlan('work on the website for 2 hours', ctx).tasks.length, 1); assert.equal(parsePlan('practise guitar for 5 hours three times this week', ctx).tasks.length, 3); assert.equal(parsePlan('write the thesis for 20 hours', ctx).tasks.length, 1); });

test('reminder validation', () => {
  assert.ok(validateReminder({ ...rem(), tz: L }).ok); for (const [bad, re] of [[{ title: ' ' }, /Title/], [{ kind: 'x' }, /type/], [{ remind_at: 'soon' }, /date/], [{ tz: 'Mars/Base' }, /timezone/], [{ rrule: { freq: 'monthly' } }, /daily or weekly/], [{ notes: 'n'.repeat(501) }, /500/]]) assert.match(validateReminder({ ...rem(), tz: L, ...bad }).errors.join(' '), re); });
test('one-off reminder lifecycle: due -> snooze -> due again -> done', async () => {
  const { svc, st } = rig(); const r = await svc.createReminder(rem()); assert.equal(r.status, 'active'); assert.equal((await svc.dueReminders()).length, 0);
  st.now = loc(2026, 10, 13, 14, 5); let due = await svc.dueReminders(); assert.equal(due.length, 1); assert.equal(due[0].snooze, false);
  await svc.handleReminder(due[0], 'snooze', 10); assert.equal((await svc.dueReminders()).length, 0, 'snoozed: hidden'); assert.equal((await svc.listReminders())[0].status, 'active');
  st.now = loc(2026, 10, 13, 14, 16); due = await svc.dueReminders(); assert.equal(due.length, 1); assert.equal(due[0].snooze, true);
  await svc.handleReminder(due[0], 'done'); assert.equal((await svc.listReminders())[0].status, 'done'); assert.equal((await svc.dueReminders()).length, 0);
  await assert.rejects(svc.handleReminder(due[0], 'snooze', 2), /between 5 minutes/); await assert.rejects(svc.handleReminder(due[0], 'explode'), /Unknown action/); });
test('dismiss, edit (starts afresh) and delete', async () => {
  const { svc, st } = rig(); const r = await svc.createReminder(rem()); st.now = loc(2026, 10, 13, 15); const [a] = await svc.dueReminders(); await svc.handleReminder(a, 'dismiss'); assert.equal((await svc.listReminders())[0].status, 'dismissed');
  await svc.updateReminder(r.id, rem({ title: 'Revise physics', remind_at: iso(loc(2026, 10, 13, 18)) })); let x = (await svc.listReminders())[0]; assert.deepEqual([x.status, x.title, x.skip_until, x.snoozed_until], ['active', 'Revise physics', null, null]);
  await svc.deleteReminder(r.id); assert.equal((await svc.listReminders()).length, 0); await assert.rejects(svc.handleReminder(a, 'done'), /no longer exists/); });
test('recurring reminder: missed days collapse to one card; handling one occurrence keeps the series', async () => {
  const { svc, st } = rig(); await svc.createReminder(rem({ title: 'Sketch', kind: 'habit', remind_at: iso(loc(2026, 10, 13, 9)), rrule: { freq: 'daily' } }));
  st.now = loc(2026, 10, 15, 10); let due = await svc.dueReminders(); assert.equal(due.length, 1); assert.equal(due[0].at, loc(2026, 10, 15, 9));
  await svc.handleReminder(due[0], 'done'); const x = (await svc.listReminders())[0]; assert.equal(x.status, 'active'); assert.equal((await svc.dueReminders()).length, 0);
  st.now = loc(2026, 10, 16, 8); assert.equal((await svc.dueReminders()).length, 0); st.now = loc(2026, 10, 16, 9, 30); due = await svc.dueReminders(); assert.equal(due.length, 1); assert.equal(due[0].at, loc(2026, 10, 16, 9));
  await svc.handleReminder(due[0], 'snooze', 30); st.now = loc(2026, 10, 16, 10, 5); due = await svc.dueReminders(); assert.equal(due.length, 1); assert.equal(due[0].snooze, true);
  await svc.handleReminder(due[0], 'dismiss'); st.now = loc(2026, 10, 17, 9, 1); assert.equal((await svc.dueReminders())[0].at, loc(2026, 10, 17, 9)); });
test('recurring reminders keep local wall time across daylight-saving changes', () => {
  const r = { id: 'r', title: 'Gym', kind: 'habit', status: 'active', tz: L, remind_at: iso(loc(2026, 3, 23, 9)), rrule: { freq: 'weekly', days: [1] }, skip_until: null, snoozed_until: null };
  const a = reminderAlerts(r, loc(2026, 3, 20), loc(2026, 4, 10)); assert.deepEqual(a.map(x => x.at), [Date.UTC(2026, 2, 23, 9), Date.UTC(2026, 2, 30, 8), Date.UTC(2026, 3, 6, 8)]);
  const ny = { ...r, tz: 'America/New_York', remind_at: iso(zonedToUtc(2026, 3, 6, 9, 0, 'America/New_York')), rrule: { freq: 'daily' } }; const d = reminderAlerts(ny, Date.UTC(2026, 2, 6), Date.UTC(2026, 2, 10)); assert.equal(d[2].at - d[1].at, 23 * 36e5, 'US spring-forward night is 23h long'); });
test('muted categories hide reminders and stop notifications; invalid categories rejected', async () => {
  const { svc, st } = rig(); await svc.createReminder(rem({ kind: 'task', title: 'Task one' })); await svc.createReminder(rem({ kind: 'custom', title: 'Custom one' })); st.now = loc(2026, 10, 13, 14, 2);
  assert.equal((await svc.dueReminders()).length, 2); await svc.saveReminderSettings({ ...SETTINGS, muted_categories: ['task'] });
  assert.deepEqual((await svc.dueReminders()).map(a => a.title), ['Custom one']); assert.deepEqual((await svc.notificationsDue()).map(i => i.title), ['Custom one']); assert.equal((await svc.upcomingReminders(1)).length, 0);
  await assert.rejects(svc.saveReminderSettings({ ...SETTINGS, muted_categories: ['bogus'] }), /Unknown reminder category/); assert.deepEqual((await svc.reminderSettings()).muted_categories, ['task']); });
test('notifications: de-duplicated, capped per day, paused, disabled, and quiet hours defer instead of lose', async () => {
  const { svc, st } = rig(); await svc.createReminder(rem({ title: 'A' })); st.now = loc(2026, 10, 13, 14, 1); let n = await svc.notificationsDue(); assert.equal(n.length, 1);
  assert.equal((await svc.notificationsDue(new Set([n[0].key]))).length, 0, 'same alert never fires twice');
  for (const t of ['B', 'C', 'D']) await svc.createReminder(rem({ title: t })); await svc.saveReminderSettings({ ...SETTINGS, max_per_day: 2 });
  assert.equal((await svc.notificationsDue(new Set(), 0)).length, 2); assert.equal((await svc.notificationsDue(new Set(), 1)).length, 1); assert.equal((await svc.notificationsDue(new Set(), 2)).length, 0);
  await svc.saveReminderSettings({ ...SETTINGS, paused_until: iso(loc(2026, 10, 13, 20)) }); assert.equal((await svc.notificationsDue()).length, 0); await svc.saveReminderSettings({ ...SETTINGS, enabled: false }); assert.equal((await svc.notificationsDue()).length, 0); });
test('quiet hours: a 23:00 reminder is held until quiet hours end (07:00), then delivered once', async () => {
  const { svc, st } = rig(); await svc.createReminder(rem({ title: 'Late', remind_at: iso(loc(2026, 10, 14, 23)) })); st.now = loc(2026, 10, 14, 23, 30); assert.equal((await svc.notificationsDue()).length, 0);
  assert.equal((await svc.dueReminders()).length, 1, 'still visible in the app'); st.now = loc(2026, 10, 15, 6, 59); assert.equal((await svc.notificationsDue()).length, 0); st.now = loc(2026, 10, 15, 7, 1); const n = await svc.notificationsDue(); assert.equal(n.length, 1); assert.equal(n[0].title, 'Late'); });
test('auto reminders for planned sessions and events respect their category switch', async () => {
  const { svc, st } = rig(); await svc.addBlock({ title: 'Focus block', start: loc(2026, 10, 13, 14), end: loc(2026, 10, 13, 15) }); await svc.addEvent({ title: 'Lecture', start_at: iso(loc(2026, 10, 13, 16)), end_at: iso(loc(2026, 10, 13, 17)), tz: L, rrule: null });
  st.now = loc(2026, 10, 13, 13, 55); assert.deepEqual((await svc.notificationsDue()).map(i => i.title), ['Focus block']); st.now = loc(2026, 10, 13, 15, 55); assert.deepEqual((await svc.notificationsDue()).map(i => i.title), ['Lecture']);
  await svc.saveReminderSettings({ ...SETTINGS, muted_categories: ['session', 'event'] }); st.now = loc(2026, 10, 13, 13, 55); assert.equal((await svc.notificationsDue()).length, 0); st.now = loc(2026, 10, 13, 15, 55); assert.equal((await svc.notificationsDue()).length, 0); });
test('reminders can only link to your own tasks, and appear on the dashboard', async () => {
  const { svc, st } = rig(); await assert.rejects(svc.createReminder(rem({ task_id: 'someone-elses-task' })), /foreign key/); const t = await svc.createTask({ title: 'Essay', quest_type: 'main', priority: 3 });
  await svc.createReminder(rem({ task_id: t.id, title: 'Start essay', kind: 'task', remind_at: iso(loc(2026, 10, 13, 9)) })); st.now = loc(2026, 10, 13, 8, 30); let d = await svc.dashboard(); assert.ok(d.reminders.some(r => r.title === 'Start essay')); assert.equal(d.due.length, 0);
  st.now = loc(2026, 10, 13, 9, 5); d = await svc.dashboard(); assert.equal(d.due.length, 1); assert.equal(dueAlerts([], 0).length, 0); });
test('assistant check-in counts missed sessions and overdue tasks', async () => {
  const { svc, repo, st } = rig(); const t = await svc.createTask({ title: 'Old', quest_type: 'side', priority: 2, due_at: iso(loc(2026, 10, 12, 9)) }); await repo.addBlocks([{ task_id: t.id, title: 'Old', start_at: iso(loc(2026, 10, 12, 9)), end_at: iso(loc(2026, 10, 12, 10)), status: 'missed' }]);
  assert.deepEqual(await svc.checkin(), { missed: 1, overdue: 1 }); });
