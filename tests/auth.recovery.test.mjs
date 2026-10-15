import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom'; import { installFake } from './helpers/fake-supabase.mjs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/#access_token=abc&refresh_token=def&type=recovery', pretendToBeVisual: true }), w = dom.window;
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
for (const k of ['window', 'document', 'location', 'localStorage', 'navigator']) def(k, k === 'window' ? w : w[k]); def('confirm', () => true); def('addEventListener', w.addEventListener.bind(w)); def('Event', w.Event);
const si = globalThis.setInterval; def('setInterval', (f, ms) => { const t = si(f, ms); t.unref?.(); return t; });
const $ = s => w.document.querySelector(s), sleep = ms => new Promise(r => setTimeout(r, ms)), visible = id => !$('#' + id).hidden;
const until = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { try { if (fn()) return; } catch {} if (Date.now() - t > ms) throw new Error('timed out: ' + fn); await sleep(20); } };
const fake = installFake(); await import('../js/app.js');
test('a recovery link shows the new-password screen, never the app', async () => {
  fake.setSession({ user: { id: 'u1' } }); fake.emit('INITIAL_SESSION'); fake.emit('SIGNED_IN'); fake.emit('PASSWORD_RECOVERY'); await until(() => visible('view-recovery')); await sleep(100);
  assert.ok(!visible('view-app')); assert.equal(fake.log.prefReads + fake.log.profileReads, 0, 'no private data loaded before the password is reset'); });
test('too-short new password is rejected; a valid one completes recovery and opens the app', async () => {
  $('#rec-pw').value = 'short'; $('#f-rec').dispatchEvent(new w.Event('submit', { cancelable: true })); await until(() => /at least 8/.test($('#rec-msg').textContent));
  $('#rec-pw').value = 'brandnewpass1'; $('#f-rec').dispatchEvent(new w.Event('submit', { cancelable: true })); await until(() => /Password updated/.test($('#rec-msg').textContent)); await until(() => visible('view-app'), 4000); assert.equal(fake.log.prefReads, 1); });
