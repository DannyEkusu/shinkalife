// The REAL app (index.html + app.js + offline layer + Supabase repository) in jsdom against a stateful fake Supabase. Proves our wiring, not real Supabase or real browsers.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom'; import { installFake } from './helpers/fake-supabase.mjs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/#/dashboard', pretendToBeVisual: true }), w = dom.window; let online = true, confirmAnswer = true;
Object.defineProperty(w.navigator, 'onLine', { get: () => online, configurable: true });
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
for (const k of ['window', 'document', 'location', 'localStorage', 'navigator']) def(k, k === 'window' ? w : w[k]); def('confirm', () => confirmAnswer); def('addEventListener', w.addEventListener.bind(w)); def('Event', w.Event);
const si = globalThis.setInterval; def('setInterval', (f, ms) => { const t = si(f, ms); t.unref?.(); return t; });
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms)), visible = id => !$('#' + id).hidden;
const until = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { try { if (fn()) return; } catch {} if (Date.now() - t > ms) throw new Error('timed out: ' + fn); await sleep(25); } };
const submit = f => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })), go = async h => { w.location.hash = h; await sleep(50); };
const fake = installFake(); await import('../js/app.js'); const { state } = await import('../js/state.js');
const setNet = async up => { online = up; w.dispatchEvent(new w.Event(up ? 'online' : 'offline')); await sleep(60); };

test('sign in: the connection indicator appears and says Online', async () => {
  fake.emit('INITIAL_SESSION', null); await until(() => visible('view-auth')); $('#in-email').value = 'a@b.co'; $('#in-pw').value = 'goodpass1'; submit($('#f-in')); await until(() => visible('view-app'));
  await until(() => /Online/.test($('#net-status').textContent)); assert.equal($('#net-status').hidden, false); assert.equal($('#net-status').dataset.status, 'online'); assert.ok(state.offline, 'offline layer is active for real accounts'); assert.ok(w.localStorage.getItem('shinkalife.lastUser')); });
test('going offline is shown clearly; quests can still be added and completed, and are queued', async () => {
  await setNet(false); await until(() => $('#net-status').dataset.status === 'offline'); assert.match($('#net-status').textContent, /Offline/);
  await go('#/quests'); await until(() => $('#q-title')); $('#q-title').value = 'Read chapter 5'; submit($('#q-add')); await until(() => $$('#q-list li').some(l => /Read chapter 5/.test(l.textContent)));
  assert.equal(fake.db.tasks?.length ?? 0, 0, 'nothing sent while offline'); assert.match($('#net-status').textContent, /1 waiting/);
  const li = $$('#q-list li').find(l => /Read chapter 5/.test(l.textContent)), box = li.querySelector('input[type=checkbox]'); box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => /XP will be recorded when you’re back online/.test($('#q-msg').textContent), 4000); assert.equal(fake.log.rpcs.filter(r => r[0] === 'award_task_xp' && r[1].p_task_id !== '00000000-0000-0000-0000-000000000000').length, 0); });
test('the Settings sync panel lists exactly what is waiting', async () => {
  await go('#/settings'); await until(() => $('#offline-panel')); const t = $('#offline-panel').textContent; assert.match(t, /Offline: changes are saved on this device/); assert.match(t, /Add quest “Read chapter 5”/); assert.match(t, /Edit a quest/); assert.match(t, /Record XP for a completed quest/);
  assert.match(t, /Needs internet/); assert.match($('#set-dyn').textContent, /This browser/); assert.match($('#set-dyn').textContent, /Notifications when the app is closed/); });
test('reconnecting syncs each change exactly once; XP is awarded by the server function once', async () => {
  await setNet(true); await until(() => $('#net-status').dataset.status === 'online' && !/waiting/.test($('#net-status').textContent), 5000);
  assert.equal(fake.db.tasks.length, 1); assert.equal(fake.db.tasks[0].title, 'Read chapter 5'); assert.equal(fake.db.tasks[0].status, 'done'); assert.equal(fake.log.writes.filter(([t, op]) => t === 'tasks' && op === 'insert').length, 1);
  assert.equal(fake.log.rpcs.filter(r => r[0] === 'award_task_xp' && r[1].p_task_id === fake.db.tasks[0].id).length, 1); await setNet(true); await sleep(100); assert.equal(fake.log.rpcs.filter(r => r[1]?.p_task_id === fake.db.tasks[0].id).length, 1, 'a second online event does not repeat anything');
  await go('#/settings'); await until(() => /Nothing is waiting to sync/.test($('#offline-panel').textContent)); });
test('signing out with unsynced changes asks first; confirming discards them and wipes this device’s copy', async () => {
  await setNet(false); await go('#/quests'); await until(() => $('#q-title')); $('#q-title').value = 'Unsynced idea'; submit($('#q-add')); await until(() => /1 waiting/.test($('#net-status').textContent));
  confirmAnswer = false; $('#btn-out').click(); await sleep(100); assert.ok(visible('view-app'), 'declined: still signed in'); assert.equal(fake.log.signOuts, 0);
  confirmAnswer = true; await setNet(true); $('#btn-out').click(); await until(() => visible('view-auth')); assert.equal(w.localStorage.getItem('shinkalife.lastUser'), null); assert.equal($('#net-status').hidden, true); assert.equal($('#dash-dyn').childElementCount, 0); });
