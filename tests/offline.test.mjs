import test from 'node:test'; import assert from 'node:assert/strict'; import { IDBFactory } from 'fake-indexeddb';
import { createMockRepo } from '../js/repo-mock.js'; import { createOfflineRepo, NEEDS_NET, applyOp, isNetworkError } from '../js/offline.js'; import { openStore } from '../js/kv.js'; import { detectSupport, supportRows } from '../js/support.js';
const T0 = Date.UTC(2026, 9, 15, 9);
async function rig({ store, userId = 'u1', seed = false } = {}) {
  const st = { now: T0 }, net = { up: true }, hooks = {}, clock = () => st.now, mock = createMockRepo({ clock, tz: 'UTC', seed });
  const inner = new Proxy(mock, { get: (t, k) => typeof t[k] === 'function' ? async (...a) => { if (!net.up) throw new Error('TypeError: Failed to fetch'); return hooks[k] ? hooks[k](t[k], a) : t[k](...a); } : t[k] });
  const s = store || await openStore(undefined), off = createOfflineRepo({ inner, store: s, userId, isOnline: () => net.up, clock, autoSync: false });
  return { st, net, hooks, mock, inner, off, repo: off.repo, store: s };
}
const task = (title, o = {}) => ({ title, quest_type: 'side', priority: 2, ...o });

test('online writes pass straight through; offline reads, writes and completions are queued and visible immediately', async () => {
  const { net, mock, off, repo } = await rig(); const a = await repo.addTask(task('A')); assert.equal(mock._db.tasks.length, 1); assert.equal(mock._db.tasks[0].id, a.id, 'client id is kept');
  await repo.listTasks(); net.up = false;
  const b = await repo.addTask(task('B')); await repo.updateTask(a.id, { status: 'done' }); const award = await repo.awardTaskXp(a.id);
  assert.deepEqual([award.queued, award.awarded, award.xp], [true, false, 0]); let s = off.state(); assert.deepEqual([s.status, s.pending], ['offline', 3]); assert.equal(mock._db.tasks.length, 1, 'nothing reached the server yet');
  const list = await repo.listTasks(); assert.deepEqual(list.map(t => t.title).sort(), ['A', 'B']); assert.equal(list.find(t => t.id === a.id).status, 'done'); assert.ok(list.find(t => t.id === a.id).completed_at);
  net.up = true; const r = await off.sync(); assert.equal(r.applied, 3); s = off.state(); assert.deepEqual([s.status, s.pending, s.failed.length, s.conflicts.length], ['online', 0, 0, 0]);
  assert.equal(mock._db.tasks.length, 2); assert.ok(mock._db.tasks.some(t => t.id === b.id)); assert.equal(mock._db.ledger.length, 1); assert.equal(mock._db.ledger[0].xp, 20); await off.sync(); assert.equal(mock._db.ledger.length, 1, 'syncing again changes nothing'); });
test('a lost response never creates duplicates (replay is idempotent)', async () => {
  const { hooks, mock, off, repo } = await rig(); let first = true; hooks.addTask = async (orig, a) => { const r = await orig(...a); if (first) { first = false; throw new Error('Failed to fetch'); } return r; };
  await repo.addTask(task('Once')); assert.equal(off.state().pending, 1, 'treated as unsent'); assert.equal(mock._db.tasks.length, 1, 'but the server did get it');
  await off.sync(); assert.equal(mock._db.tasks.length, 1); assert.equal(off.state().pending, 0); assert.equal(off.state().failed.length, 0); });
test('editing offline after someone changed it elsewhere is NOT applied: reported as a conflict you can keep or discard', async () => {
  const { st, net, mock, off, repo } = await rig(); const a = await repo.addTask(task('Original')); await repo.listTasks(); net.up = false; await repo.updateTask(a.id, { title: 'Mine' });
  st.now += 5000; await mock.updateTask(a.id, { title: 'Theirs' }); net.up = true; await off.sync();
  const s = off.state(); assert.equal(s.conflicts.length, 1); assert.equal(s.status, 'error'); assert.equal(mock._db.tasks[0].title, 'Theirs'); assert.match(s.conflicts[0].message, /another device/);
  await off.resolveConflict(s.conflicts[0].id, false); assert.equal(off.state().conflicts.length, 0); assert.equal(mock._db.tasks[0].title, 'Theirs');
  net.up = false; await repo.listTasks().catch(() => {}); net.up = true; await repo.listTasks(); net.up = false; await repo.updateTask(a.id, { title: 'Mine2' }); st.now += 5000; await mock.updateTask(a.id, { notes: 'x' }); net.up = true; await off.sync();
  await off.resolveConflict(off.state().conflicts[0].id, true); assert.equal(mock._db.tasks[0].title, 'Mine2', '"keep mine" applies it deliberately'); });
test('several offline edits to the same task do not conflict with each other', async () => {
  const { st, net, mock, off, repo } = await rig(); const a = await repo.addTask(task('A')); await repo.listTasks(); net.up = false;
  await repo.updateTask(a.id, { title: 'A1' }); st.now += 1000; await repo.updateTask(a.id, { notes: 'n' }); await repo.updateTask(a.id, { priority: 3 }); net.up = true; st.now += 1000; await off.sync();
  assert.equal(off.state().conflicts.length, 0); const t = mock._db.tasks[0]; assert.deepEqual([t.title, t.notes, t.priority], ['A1', 'n', 3]); });
test('permanent errors are isolated: other changes still sync; failed items can be retried or discarded', async () => {
  const { net, mock, off, repo } = await rig(); await repo.listTasks(); await repo.listReminders(); net.up = false;
  await repo.addReminder({ title: '', kind: 'custom', remind_at: new Date(T0).toISOString(), tz: 'UTC' }); await repo.addTask(task('Fine')); net.up = true; await off.sync();
  let s = off.state(); assert.equal(s.failed.length, 1); assert.match(s.failed[0].message, /invalid title/); assert.equal(s.status, 'error'); assert.equal(mock._db.tasks.length, 1);
  await off.retryFailed(); assert.equal(off.state().failed.length, 1, 'still invalid, so it fails again rather than looping'); await off.discardFailed(); assert.deepEqual([off.state().failed.length, off.state().status], [0, 'online']); });
test('auth expiry keeps changes safely on the device and asks the user to sign in', async () => {
  const { net, hooks, mock, off, repo } = await rig(); await repo.listTasks(); net.up = false; await repo.addTask(task('Keep me')); net.up = true; hooks.addTask = async () => { throw new Error('JWT expired'); };
  await off.sync(); const s = off.state(); assert.equal(s.pending, 1); assert.match(s.lastError, /sign in again/i); assert.equal(s.status, 'error'); delete hooks.addTask; await off.sync(); assert.equal(off.state().pending, 0); assert.equal(mock._db.tasks.length, 1); });
test('calendar-type writes stay online-only with a clear message; uncached reads explain themselves', async () => {
  const { net, repo } = await rig(); net.up = false; for (const call of [() => repo.addBlocks([]), () => repo.addEvent({}), () => repo.saveProfile({}), () => repo.setAvailability([]), () => repo.addMessage({})]) await assert.rejects(call(), new RegExp(NEEDS_NET));
  await assert.rejects(repo.listTasks(), /hasn’t been saved on this device/); });
test('data survives an app restart: queue and local copy are reloaded for the same user only', async () => {
  const a = await rig(); await a.repo.listTasks(); a.net.up = false; await a.repo.addTask(task('Saved offline'));
  const again = createOfflineRepo({ inner: a.inner, store: a.store, userId: 'u1', isOnline: () => false, clock: () => T0, autoSync: false }); await again.load(); assert.equal(again.state().pending, 1); assert.deepEqual((await again.repo.listTasks()).map(t => t.title), ['Saved offline']);
  const other = createOfflineRepo({ inner: a.inner, store: a.store, userId: 'u2', isOnline: () => false, clock: () => T0, autoSync: false }); await other.load(); assert.equal(other.state().pending, 0); await assert.rejects(other.repo.listTasks(), /hasn’t been saved/);
  await again.wipe(); assert.equal(again.state().pending, 0); assert.ok((await a.store.keys()).every(k => !String(k).startsWith('u1:'))); });
test('status changes are announced: online -> offline -> syncing -> online', async () => {
  const { net, off, repo } = await rig(); const seen = []; off.subscribe(s => seen.push(s.status)); await repo.listTasks(); net.up = false; off.notifyOffline(); await repo.addTask(task('x')); net.up = true; await off.sync();
  assert.ok(seen.includes('offline') && seen.includes('syncing')); assert.equal(seen.at(-1), 'online'); });
test('reminder and preference changes made offline are applied on top of cached data and synced', async () => {
  const { net, mock, off, repo } = await rig(); await repo.listReminders(); await repo.getReminderSettings(); await repo.getAssistantPrefs(); net.up = false;
  const r = await repo.addReminder({ title: 'Call', kind: 'custom', remind_at: new Date(T0 + 3600e3).toISOString(), tz: 'UTC' }); await repo.saveAssistantPrefs({ assistant_name: 'Nova' }); await repo.saveReminderSettings({ enabled: true, lead_minutes: 20, quiet_start_min: 0, quiet_end_min: 0, max_per_day: 3 });
  assert.equal((await repo.listReminders()).length, 1); assert.equal((await repo.getAssistantPrefs()).assistant_name, 'Nova'); assert.equal((await repo.getReminderSettings()).lead_minutes, 20);
  net.up = true; await off.sync(); assert.equal(mock._db.reminders.length, 1); assert.equal(mock._db.reminders[0].id, r.id); assert.equal(mock._db.prefs.assistant_name, 'Nova'); assert.equal(mock._db.rem.lead_minutes, 20); });
test('schedule blocks cached online are readable offline by date range', async () => {
  const { net, mock, repo } = await rig(); await mock.addBlocks([{ title: 'Study', start_at: new Date(T0).toISOString(), end_at: new Date(T0 + 36e5).toISOString() }]);
  const iso = ms => new Date(ms).toISOString(); assert.equal((await repo.listBlocks(iso(T0 - 864e5), iso(T0 + 864e5))).length, 1); net.up = false; assert.equal((await repo.listBlocks(iso(T0 - 36e5), iso(T0 + 7200e3))).length, 1); assert.equal((await repo.listBlocks(iso(T0 + 864e5), iso(T0 + 2 * 864e5))).length, 0); });
test('pure reducer is idempotent for adds (no duplicates when a snapshot already contains the item)', () => { const s = { tasks: [{ id: 'x', subtasks: [] }], reminders: [], categories: [] }; applyOp(s, { type: 'task.add', id: 'x', values: { title: 'Z' } }, 'now'); assert.equal(s.tasks.length, 1); assert.ok(isNetworkError(new TypeError('Failed to fetch'))); assert.ok(!isNetworkError(new Error('permission denied'))); });

test('IndexedDB store: persistence, user separation and graceful fallback when storage is blocked', async () => {
  const f = new IDBFactory(), a = await openStore(f); assert.equal(a.mode, 'indexeddb'); await a.set('u1:x', { n: 1 }); assert.deepEqual(await (await openStore(f)).get('u1:x'), { n: 1 }, 'survives re-open'); assert.ok((await a.keys()).includes('u1:x'));
  const blocked = { open() { throw new Error('SecurityError'); } }; assert.equal((await openStore(blocked)).mode, 'memory'); assert.equal((await openStore(undefined)).mode, 'memory');
  const r = await rig({ store: a }); await r.repo.listTasks(); await r.repo.addTask(task('in idb')); assert.ok((await a.keys()).some(k => k === 'u1:snap')); });
test('browser capability explanations are honest per platform', () => {
  const rows = (g, ready) => Object.fromEntries(supportRows(detectSupport(g), ready).map(r => [r.label, r]));
  const iphone = rows({ navigator: { userAgent: 'iPhone', serviceWorker: {}, standalone: false }, indexedDB: {}, PushManager: {} }); assert.match(iphone['System notifications'].text, /Home Screen/); assert.equal(iphone['System notifications'].ok, false); assert.match(iphone['Install as an app'].text, /Add to Home Screen/);
  const ff = rows({ navigator: { userAgent: 'Mozilla/5.0 Firefox/130.0', serviceWorker: {} }, indexedDB: {}, Notification: function () {} }); assert.match(ff['Install as an app'].text, /Firefox on desktop/); assert.equal(ff['System notifications'].ok, true);
  const none = rows({ navigator: { userAgent: 'x' } }); assert.equal(none['Works offline (app files)'].ok, false); assert.equal(none['Saved data on this device'].ok, false); assert.match(none['Notifications when the app is closed'].text, /not available/); assert.equal(rows({ navigator: { userAgent: 'x' } }, true)['Install as an app'].ok, true); });
