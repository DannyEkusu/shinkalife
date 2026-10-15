// Runs the REAL app.js boot + auth handlers in jsdom against a fake supabase-js. Proves our logic, not Supabase itself.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom'; import { installFake } from './helpers/fake-supabase.mjs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/#/dashboard', pretendToBeVisual: true }), w = dom.window;
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
for (const k of ['window', 'document', 'location', 'localStorage', 'navigator']) def(k, k === 'window' ? w : w[k]); def('confirm', () => true); def('addEventListener', w.addEventListener.bind(w)); def('Event', w.Event);
const si = globalThis.setInterval; def('setInterval', (f, ms) => { const t = si(f, ms); t.unref?.(); return t; });
const $ = s => w.document.querySelector(s), sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); for (;;) { try { if (fn()) return; } catch {} if (Date.now() - t > ms) throw new Error('timed out: ' + fn); await sleep(20); } };
const submit = f => f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const fake = installFake(); await import('../js/app.js');
const visible = id => !$('#' + id).hidden;

test('while auth is unresolved only the loading view shows (no private UI)', () => { assert.ok(visible('view-boot')); assert.ok(!visible('view-app')); assert.ok(!visible('view-setup')); });
test('no stored session -> signed-out experience', async () => { fake.emit('INITIAL_SESSION', null); await until(() => visible('view-auth')); assert.ok(!visible('view-app')); });
test('wrong password shows a clear error and stays signed out', async () => {
  $('#in-email').value = 'a@b.co'; $('#in-pw').value = 'nope'; submit($('#f-in')); await until(() => /Invalid login credentials/.test($('#auth-msg').textContent)); assert.ok($('#auth-msg').classList.contains('err')); assert.ok(!visible('view-app')); });
test('valid login enters the app and loads the profile', async () => {
  $('#in-pw').value = 'goodpass1'; submit($('#f-in')); await until(() => visible('view-app')); await until(() => /Ada/.test($('#greeting').textContent)); assert.equal(fake.log.prefReads, 1, 'account loaded exactly once'); assert.ok(!visible('view-auth')); });
test('token refresh and duplicate sign-in events do not reload the app', async () => {
  const s = { user: { id: 'u1' } }; fake.emit('TOKEN_REFRESHED', s); fake.emit('SIGNED_IN', s); fake.emit('USER_UPDATED', s); await sleep(150); assert.equal(fake.log.prefReads, 1); assert.ok(visible('view-app')); });
test('database self-check ran and found nothing missing', async () => { await sleep(100); assert.equal($('#db-banner').hidden, true); });
test('sign-out returns to login and wipes private data from the page', async () => {
  $('#dash-dyn').append(w.document.createElement('p')); $('#p-name').value = 'Ada'; $('#btn-out').click(); await until(() => visible('view-auth')); assert.equal($('#dash-dyn').childElementCount, 0); assert.equal($('#p-name').value, ''); assert.ok(!visible('view-app')); assert.equal(fake.log.signOuts, 1); });
test('sign-up validates locally, then explains email confirmation (does not assume it is off)', async () => {
  w.document.querySelector('[data-tab=up]').click(); $('#up-email').value = 'new@b.co'; $('#up-pw').value = 'short'; submit($('#f-up')); await until(() => /at least 8/.test($('#auth-msg').textContent));
  $('#up-pw').value = 'longenough1'; submit($('#f-up')); await until(() => /Check your email/.test($('#auth-msg').textContent)); assert.ok($('#auth-msg').classList.contains('ok')); assert.ok(!visible('view-app')); });
test('password reset request gives a non-revealing confirmation', async () => {
  w.document.querySelector('[data-tab=in]').click(); $('#in-email').value = 'a@b.co'; $('#btn-forgot').click(); await until(() => /If that email has an account/.test($('#auth-msg').textContent)); });
