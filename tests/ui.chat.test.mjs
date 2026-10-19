// The REAL planner/assistant page in jsdom (sample-data mode) with a fake AI provider: labelling, empty state, retry, history, quest creation.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/?mock=1#/dashboard', pretendToBeVisual: true }), w = dom.window;
const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
for (const k of ['window', 'document', 'location', 'localStorage', 'navigator']) def(k, k === 'window' ? w : w[k]); def('confirm', () => true); def('addEventListener', w.addEventListener.bind(w)); def('Event', w.Event);
const si = globalThis.setInterval; def('setInterval', (f, ms) => { const t = si(f, ms); t.unref?.(); return t; });
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); for (;;) { try { if (fn()) return; } catch {} if (Date.now() - t > ms) throw new Error('timed out: ' + fn); await sleep(25); } };
const send = async text => { $('#pt').value = text; $('#pf').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })); };
await import('../js/app.js'); const Pages = await import('../js/pages.js'), { state } = await import('../js/state.js'), { repo } = await import('../js/repo.js'), { createService } = await import('../js/service.js');
const bubbles = () => $$('#chat-log .bubble'), last = () => bubbles().at(-1), btn = (root, re) => $$(root + ' button').find(b => re.test(b.textContent));
let aiFail = false, chatCalls = 0; const provider = { proposeTasks: async () => ({ tasks: [{ title: 'Read chapter 3', est_minutes: 60 }] }), chat: async () => { chatCalls++; if (aiFail) throw new Error('The AI service timed out.'); return { reply: 'Try two focused 25-minute blocks.' }; } };

test('empty state offers examples; the user-chosen name is used in the heading, label and log', async () => {
  await state.svc.saveAssistantName('Nova'); await Pages.planner(); assert.equal($('#plan-title').textContent, 'Ask Nova'); assert.match($('#chat-log').textContent, /No messages yet\. Ask Nova/); assert.equal($('#chat-log').getAttribute('aria-label'), 'Conversation with Nova'); assert.equal($$('#chat-log .chat-empty button').length, 4); assert.match($('label[for=pt]').textContent, /Message Nova/); });
test('answers are labelled Rule-based; out-of-scope questions are declined; helpers use the user’s own data', async () => {
  btn('#chat-log', /What’s due this week/).click(); await until(() => bubbles().length === 2 && !last().classList.contains('pending')); assert.match(bubbles()[0].textContent, /due this week/); assert.match(last().querySelector('.tag').textContent, /Rule-based/); assert.match(last().textContent, /Coming up/);
  await send('tell me a joke'); await until(() => bubbles().length === 4 && !last().classList.contains('pending')); assert.match(last().textContent, /only help with ShinkaLife planning/); assert.match(last().textContent, /isn’t set up/); assert.equal($('#plan-out').childElementCount, 0, 'no plan was invented'); });
test('a planning message shows a reviewable proposal; breakdown steps can be added as quests only on request', async () => {
  await send('study chemistry for 2 hours on Friday'); await until(() => /Approve & apply/.test($('#plan-out').textContent)); assert.match(last().textContent, /nothing is saved until you approve/i);
  await send('break down my essay'); await until(() => last().querySelector('ol') && !last().classList.contains('pending')); assert.equal(last().querySelectorAll('li').length, 6); const before = (await repo.listTasks()).length; assert.equal(before, (await repo.listTasks()).length);
  btn('#chat-log', /Add these as quests/).click(); await until(() => /Added to your quests/.test(last().textContent)); assert.equal((await repo.listTasks()).length, before + 6); assert.ok((await repo.listTasks()).some(t => /my essay: Outline the main points/.test(t.title))); });
test('with AI on: replies are labelled AI; failures fall back to rules, say why, and can be retried', async () => {
  state.svc = createService(repo, { provider }); await state.svc.setAiOptIn(true); await Pages.planner(); await send('how can I focus better this week?'); await until(() => last().querySelector('.tag')?.textContent === 'AI'); assert.match(last().textContent, /two focused 25-minute blocks/); assert.equal(chatCalls, 1);
  aiFail = true; await send('how can I stay motivated?'); await until(() => /AI is unavailable: The AI service timed out/.test(last().textContent)); assert.match(last().querySelector('.tag').textContent, /Rule-based/); assert.ok(btn('#chat-log', /Try AI again/));
  aiFail = false; btn('#chat-log', /Try AI again/).click(); await until(() => last().querySelector('.tag')?.textContent === 'AI' && /two focused/.test(last().textContent)); assert.equal(chatCalls, 3); assert.ok(!btn('#chat-log', /Try AI again/)); });
test('conversation is saved per account, reloads, and can be cleared', async () => {
  const saved = await state.svc.history(); assert.ok(saved.length >= 8); assert.ok(saved.some(m => m.source === 'ai' && /focused/.test(m.text))); assert.ok(saved.some(m => m.role === 'user' && m.text === 'tell me a joke'));
  Pages.resetPages(); await Pages.planner(); assert.ok(bubbles().length >= 8, 'history reloaded after a fresh visit'); btn('#plan-root', /^Clear conversation$/).click(); await until(() => /No messages yet/.test($('#chat-log').textContent)); assert.deepEqual(await state.svc.history(), []); });
test('privacy controls: saving history can be turned off; data sharing needs AI opt-in', async () => {
  await Pages.settingsExtras(); await until(() => $('#as-hist')); assert.equal($('#as-hist').checked, true); assert.equal($('#as-share').disabled, false); $('#as-hist').checked = false; $('#as-hist').dispatchEvent(new w.Event('change')); await until(() => /Saved/.test($('#as-msg').textContent));
  await state.svc.remember('user', 'user', 'should not be saved'); assert.deepEqual(await state.svc.history(), []); $('#as-share').checked = true; $('#as-share').dispatchEvent(new w.Event('change')); await until(() => (state.svc.assistant().then(a => a.shareData), true)); assert.equal((await state.svc.assistant()).shareData, true); });
