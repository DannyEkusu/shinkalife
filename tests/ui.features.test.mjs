// Real index.html + real page modules in jsdom, sample-data mode. Proves wiring and flows; it does NOT test real Supabase, a real AI provider or real OS notifications.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/?mock=1#/dashboard', pretendToBeVisual: true }), w = dom.window;
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
for (const k of ['window', 'document', 'location', 'localStorage', 'navigator']) def(k, k === 'window' ? w : w[k]); def('confirm', () => true); def('addEventListener', w.addEventListener.bind(w)); def('Event', w.Event);
const si = globalThis.setInterval; def('setInterval', (f, ms) => { const t = si(f, ms); t.unref?.(); return t; });
let reqCalls = 0; const shown = []; class FakeN { constructor(t, o) { shown.push([t, o?.body]); } static permission = 'default'; static async requestPermission() { reqCalls++; FakeN.permission = 'granted'; return 'granted'; } } def('Notification', FakeN);
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch {} if (Date.now() - t > ms) throw new Error('timed out: ' + fn); await sleep(25); } };
const go = async h => { w.location.hash = h; await sleep(40); }, submit = f => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const btn = (root, re) => $$(root + ' button').find(b => re.test(b.textContent));
await import('../js/app.js'); const Pages = await import('../js/pages.js'), { state } = await import('../js/state.js'), { repo } = await import('../js/repo.js'), { createService } = await import('../js/service.js'), { toInput } = await import('../js/ui.js');

test('Instagram links: exact URLs, clear labels, safe new-tab attributes', async () => {
  await go('#/settings'); await until(() => $('#about a')); const [a, b] = $$('#about a');
  assert.equal(a.getAttribute('href'), 'https://www.instagram.com/danny_ekusu?obrf=dXBhbWM2bnhuZW5x'); assert.equal(b.getAttribute('href'), 'https://www.instagram.com/shinkadev.io?psln=MjdhNzYyN2dkdWxn');
  assert.match(a.textContent, /^Personal Instagram/); assert.match(b.textContent, /^ShinkaDev/); for (const l of [a, b]) { assert.equal(l.target, '_blank'); assert.match(l.rel, /noopener/); assert.match(l.rel, /noreferrer/); assert.match(l.textContent, /new tab/); }
  assert.equal($$('#about a').length, 2); assert.ok(!/follower|likes/i.test($('#about').textContent), 'no fabricated social stats'); });
test('navigation has the new Reminders page and every item has a visible label', () => { const links = $$('nav a'); assert.equal(links.length, 8); assert.ok(links.every(l => l.textContent.trim().length > 2)); assert.ok(links.some(l => l.getAttribute('href') === '#/reminders')); });
test('notification permission is never requested by loading pages', async () => { for (const h of ['#/dashboard', '#/reminders', '#/planner', '#/settings']) { await go(h); await sleep(80); } assert.equal(reqCalls, 0); });

test('assistant name: save, show in planner, persist, reject bad input, reset', async () => {
  await go('#/settings'); await until(() => $('#as-name')); assert.equal($('#as-name').placeholder, 'Shinka');
  $('#as-name').value = '  Nova '; submit($('#as-name').closest('form')); await until(() => /now called Nova/.test($('#as-msg').textContent)); assert.ok($('#as-msg').classList.contains('ok'));
  await go('#/planner'); await until(() => $('#plan-title').textContent === 'Ask Nova'); assert.match($('#plan-root').textContent, /Hi, I’m Nova/); assert.match($('#plan-root').textContent, /Nova” is the name you chose/);
  await go('#/settings'); await until(() => $('#as-name')); assert.equal($('#as-name').value, 'Nova', 'persisted through the repository');
  $('#as-name').value = '<b>x</b>'; submit($('#as-name').closest('form')); await until(() => /avoid/.test($('#as-msg').textContent)); assert.ok($('#as-msg').classList.contains('err')); assert.equal((await state.svc.assistant()).name, 'Nova');
  $('#as-name').value = 'x'.repeat(30); submit($('#as-name').closest('form')); await until(() => /now called x/.test($('#as-msg').textContent));
  $('#as-name').value = '   '; submit($('#as-name').closest('form')); await until(() => /reset to the default/.test($('#as-msg').textContent)); assert.equal((await state.svc.assistant()).name, 'Shinka');
  await go('#/planner'); await until(() => $('#plan-title').textContent === 'Ask Shinka'); });
test('planner is honest when AI is not configured', async () => { await go('#/planner'); await until(() => /Rule-based/.test($('#plan-root').textContent)); assert.match($('#plan-root').textContent, /AI isn’t set up for this site yet/); assert.ok(!btn('#plan-root', /Turn on AI/)); assert.ok(!/AI-assisted/.test($('#plan-root').textContent.replace(/Optional: AI assistance/, ''))); });
test('with a provider configured: AI stays OFF until opted in, then is used and labelled', async () => {
  let calls = 0; state.svc = createService(repo, { provider: { proposeTasks: async () => { calls++; return { tasks: [{ title: 'Read chapter 3', est_minutes: 60, priority: 2, quest_type: 'side' }] }; } } });
  await Pages.planner(); assert.match($('#plan-root').textContent, /Optional: AI assistance \(off\)/); assert.ok(btn('#plan-root', /Turn on AI assistance/));
  $('#pt').value = 'read my book'; submit($('#pf')); await until(() => /Approve & apply/.test($('#plan-out').textContent)); assert.equal(calls, 0, 'nothing sent before opt-in'); assert.match($('#plan-out').textContent, /Rule-based plan/);
  btn('#plan-root', /Turn on AI assistance/).click(); await until(() => /AI is on/.test($('#plan-root').textContent)); assert.match($('#plan-root').textContent, /Your tasks and calendar are NOT shared/);
  $('#pt').value = 'read my book'; submit($('#pf')); await until(() => /AI-assisted: tasks were broken down/.test($('#plan-out').textContent)); assert.equal(calls, 1); assert.match($('#plan-out').textContent, /Read chapter 3/);
  btn('#plan-root', /Turn off AI/).click(); await until(() => /Optional: AI assistance \(off\)/.test($('#plan-root').textContent)); state.svc = createService(repo, {}); });

test('notification states: default, explicit enable, granted+test, blocked, unsupported', async () => {
  await state.svc.saveReminderSettings({ enabled: true, lead_minutes: 10, quiet_start_min: 0, quiet_end_min: 0, max_per_day: 8 });
  await go('#/dashboard'); await go('#/settings'); await until(() => /System notifications:/.test($('#set-dyn').textContent)); assert.match($('#set-dyn').textContent, /System notifications: off/); assert.equal(reqCalls, 0);
  btn('#set-dyn', /Enable notifications/).click(); await until(() => /System notifications: allowed/.test($('#set-dyn').textContent)); assert.equal(reqCalls, 1); assert.match($('#set-dyn').textContent, /NOT arrive while it is closed/);
  btn('#set-dyn', /Send a test notification/).click(); await until(() => shown.length === 1); assert.equal(shown[0][0], 'Shinka'); assert.match($('#rm-msg').textContent, /Test sent/);
  FakeN.permission = 'denied'; await Pages.settingsExtras(); assert.match($('#set-dyn').textContent, /blocked in your browser/); assert.match($('#set-dyn').textContent, /site settings/); assert.ok(!btn('#set-dyn', /Enable notifications/));
  delete globalThis.Notification; await Pages.settingsExtras(); assert.match($('#set-dyn').textContent, /not supported by this browser/); assert.match($('#set-dyn').textContent, /inside ShinkaLife/); def('Notification', FakeN); FakeN.permission = 'granted'; shown.length = 0; });

test('reminders page: validation, create, snooze, edit, delete', async () => {
  await go('#/reminders'); await until(() => $('#nr-title')); $('#nr-title').value = ''; submit($('#nr-title').closest('form')); await until(() => /Title/.test($('#nr-msg').textContent)); assert.ok($('#nr-msg').classList.contains('err'));
  $('#nr-title').value = 'Stretch'; $('#nr-kind').value = 'habit'; $('#nr-when').value = toInput(Date.now() - 5 * 60000, state.tz); $('#nr-rep').value = 'daily'; submit($('#nr-title').closest('form'));
  await until(() => /Reminder saved/.test($('#toast').textContent)); await until(() => $('#rem-root .due')); assert.match($('#rem-root').textContent, /Due now/); assert.match($('#rem-root .remrow').textContent, /Repeats daily/);
  btn('#rem-root .due', /Snooze 10 min/).click(); await until(() => !$('#rem-root .due')); assert.match($('#rem-root .remrow').textContent, /Next:/);
  btn('#rem-root .remrow', /Edit/).click(); await until(() => $('#er-title')); $('#er-title').value = 'Stretch more'; submit($('#er-title').closest('form')); await until(() => /Stretch more/.test($('#rem-root .remrow')?.textContent || ''));
  btn('#rem-root .remrow', /Delete/).click(); await until(() => /No reminders yet/.test($('#rem-root').textContent)); });
test('delivery: a due reminder notifies once (toast + system), is never repeated, and appears on the dashboard with actions', async () => {
  await state.svc.createReminder({ title: 'Drink water', kind: 'custom', remind_at: new Date(Date.now() - 60000).toISOString() });
  const first = await Pages.tick(); assert.equal(first.length, 1); assert.match($('#toast').textContent, /Shinka: Reminder: Drink water/); assert.equal(shown.length, 1); assert.equal(shown[0][1], 'Drink water');
  assert.equal((await Pages.tick()).length, 0); assert.equal(shown.length, 1, 'no duplicate alert'); assert.equal(Object.keys(JSON.parse(w.localStorage.getItem('shinkalife.fired'))).length, 1);
  await Pages.dashboard(); await until(() => /Drink water/.test($('#dash-dyn').textContent)); btn('#dash-dyn', /^Done$/).click(); await until(() => !/Drink water/.test($('#dash-dyn').textContent)); });
test('muting a category in Settings stops its alerts', async () => {
  await Pages.settingsExtras(); await until(() => $('#cat-custom')); $('#cat-custom').checked = false; btn('#set-dyn', /Save reminder settings/).click(); await until(() => /Saved/.test($('#rm-msg').textContent)); assert.deepEqual((await state.svc.reminderSettings()).muted_categories, ['custom']);
  await state.svc.createReminder({ title: 'Muted one', kind: 'custom', remind_at: new Date(Date.now() - 60000).toISOString() }); assert.equal((await Pages.tick()).length, 0); assert.equal(shown.length, 1); });
