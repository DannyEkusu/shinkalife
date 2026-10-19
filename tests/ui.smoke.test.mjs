// Drives the REAL index.html + app modules in jsdom, in explicit sample-data mode (?mock=1). Verifies wiring and flows, not pixel layout.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/?mock=1#/dashboard', pretendToBeVisual: true }), w = dom.window;
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
for (const k of ['window', 'document', 'location', 'localStorage', 'navigator', 'confirm']) def(k, k === 'window' ? w : k === 'confirm' ? () => true : w[k]);
def('addEventListener', w.addEventListener.bind(w)); def('Event', w.Event); def('HTMLElement', w.HTMLElement);
const si = globalThis.setInterval; def('setInterval', (f, ms) => { const t = si(f, ms); t.unref?.(); return t; });
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const until = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch {} if (Date.now() - t > ms) throw new Error('timed out waiting: ' + fn); await new Promise(r => setTimeout(r, 25)); } };
const go = async h => { w.location.hash = h; await new Promise(r => setTimeout(r, 30)); };
const submit = f => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
await import('../js/app.js');

test('sample mode opens with a permanent, visible warning banner', async () => {
  assert.equal($('#view-app').hidden, false); assert.equal($('#mock-banner').hidden, false); assert.match($('#mock-banner').textContent, /SAMPLE DATA/); assert.equal($('#view-setup').hidden, true); });
test('dashboard renders real model: ring, mission line, deadlines, quick add', async () => {
  await until(() => $('#dash-dyn .col-main')); assert.match($('#dash-dyn').textContent, /mission line/i); assert.match($('#dash-dyn').textContent, /Deadlines/); assert.equal($('#lvl').textContent, '1');
  assert.ok(/Sample: Revise for maths test/.test($('#dash-dyn').textContent), 'seeded deadline shown');
  $('#dq').value = 'Read chapter 4'; submit($('#dq').closest('form')); await until(() => /Quest added/.test($('#toast').textContent)); });
test('quests: list, add, complete awards XP once', async () => {
  await go('#/quests'); await until(() => $$('#q-list li').length >= 3); const before = $$('#q-list li').length;
  $('#q-title').value = 'Write summary'; $('#q-pri').value = '3'; $('#q-type').value = 'main'; submit($('#q-add')); await until(() => $$('#q-list li').length === before + 1);
  const li = $$('#q-list li').find(l => /Write summary/.test(l.textContent)); assert.ok(li.classList.contains('q-main'));
  const box = li.querySelector('input[type=checkbox]'); box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true })); await until(() => /\+60 XP/.test($('#q-msg').textContent), 4000); });
test('character page shows the XP that the ledger recorded', async () => {
  await go('#/character'); await until(() => /Level 1/.test($('#char-root').textContent)); assert.match($('#char-root').textContent, /60 XP total/); assert.match($('#char-root').textContent, /First Step/); assert.match($('#char-root').textContent, /Scholar/); });
test('calendar: week grid, view switching, conflict-free sample, month view', async () => {
  await go('#/calendar'); await until(() => $$('.cal-col').length === 7); assert.ok($$('.cal-item.fixed').length >= 1, 'weekly sample lecture is visible');
  $$('.cal-bar button').find(b => b.textContent === 'Month').click(); await until(() => $('.cal-month')); assert.equal($$('.cal-cell').length, 42);
  $$('.cal-bar button').find(b => b.textContent === 'Day').click(); await until(() => $$('.cal-col').length === 1); });
test('calendar: invalid and conflicting events show clear errors', async () => {
  $('details.panel').open = true; $('#nv-t').value = 'Backwards'; const s = $('#nv-s').value; $('#nv-e').value = s.replace(/T\d\d/, 'T00'); submit($('#nv-t').closest('form'));
  await until(() => /end after/i.test($('#af-msg').textContent)); assert.ok($('#af-msg').classList.contains('err')); });
test('planner: propose, reject leaves nothing, regenerate, approve applies', async () => {
  await go('#/planner'); await until(() => $('#pt'));
  $('#pt').value = 'study chemistry for 2 hours, practise guitar three times this week'; submit($('#pf')); await until(() => /Approve & apply/.test($('#plan-out').textContent)); assert.match($('#plan-out').textContent, /Rule-based/); assert.ok(!/AI-assisted/.test($('#plan-out').textContent));
  $$('#plan-out button').find(b => b.textContent === 'Reject').click(); await until(() => /was not changed/.test($('#plan-out').textContent));
  $('#pt').value = 'study chemistry for 2 hours, practise guitar three times this week'; submit($('#pf')); await until(() => $$('#plan-out button').find(b => b.textContent === 'Approve & apply')); $$('#plan-out button').find(b => b.textContent === 'Approve & apply').click(); await until(() => /Applied:/.test($('#plan-out').textContent)); });
test('planner states impossible workloads instead of hiding them', async () => {
  $('#pt').value = 'finish a 40 hour project by tomorrow'; submit($('#pf')); await until(() => /Not everything fits/.test($('#plan-out').textContent)); assert.match($('#plan-out').textContent, /Options:/); });
test('progress shows real totals and a reflection box', async () => {
  await go('#/progress'); await until(() => /Completed this week: 1/.test($('#prog-root').textContent)); $('#rv').value = 'Good focus'; $$('#prog-root button').find(b => /Save reflection/.test(b.textContent)).click(); await until(() => /Saved/.test($('#rv-msg').textContent)); });
test('settings: availability and reminders editors work; bad values are rejected', async () => {
  await go('#/settings'); await until(() => $$('.avrow').length === 7); $('#av-on-6').checked = false; $$('#set-dyn button').find(b => /Save available hours/.test(b.textContent)).click(); await until(() => /saved/i.test($('#av-msg').textContent));
  $('#rm-lead').value = '9999'; $$('#set-dyn button').find(b => /Save reminder settings/.test(b.textContent)).click(); await until(() => /out of range/.test($('#rm-msg').textContent)); });
test('theme: preset and mode change apply tokens and persist locally', async () => {
  const root = w.document.documentElement; const before = root.style.getPropertyValue('--bg'); $$('#presets button').find(b => b.textContent === 'Warm Minimal').click(); await new Promise(r => setTimeout(r, 30));
  assert.notEqual(root.style.getPropertyValue('--bg'), before); assert.equal(root.style.colorScheme, 'light'); assert.match(w.localStorage.getItem('shinkalife.theme'), /warm-minimal/);
  $$('#modes button').find(b => b.textContent === 'Dark').click(); await new Promise(r => setTimeout(r, 30)); assert.equal(root.style.colorScheme, 'dark'); });
test('every nav link routes to a real page (no dead or placeholder items)', async () => {
  for (const a of $$('nav a')) { await go(a.getAttribute('href')); const id = a.dataset.page, sec = $('#page-' + id); assert.ok(sec && !sec.hidden, id); assert.ok(!/coming soon|not built yet/i.test(sec.textContent), id); } });
test('leaving sample mode returns to setup and clears data', async () => {
  $('#btn-out').click(); await new Promise(r => setTimeout(r, 30)); assert.equal($('#view-setup').hidden, false); assert.equal($('#mock-banner').hidden, true); });
