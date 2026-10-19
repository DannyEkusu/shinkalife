import test from 'node:test'; import assert from 'node:assert/strict';
import { zonedToUtc } from '../js/recur-core.js'; import { createMockRepo } from '../js/repo-mock.js'; import { createService } from '../js/service.js';
import { detectIntent, extractSubject, breakdownSteps, overviewText, progressText, explainText, scopeText } from '../js/assistant-local.js'; import { createServerProvider, sanitizeReply, askAI } from '../js/planner-ai.js';
const L = 'Europe/London', loc = (y, mo, d, h = 0, mi = 0) => zonedToUtc(y, mo, d, h, mi, L), iso = ms => new Date(ms).toISOString();
const rig = ({ provider = null, online = true, seed = true } = {}) => { const st = { now: loc(2026, 10, 13, 8), online }, clock = () => st.now, repo = createMockRepo({ clock, tz: L, seed }); return { st, repo, svc: createService(repo, { clock, provider, isOnline: () => st.online }) }; };
const fake = (o = {}) => { const calls = { plan: [], chat: [] }; return { calls, proposeTasks: async (...a) => { calls.plan.push(a); return { tasks: [{ title: 'Read chapter 3', est_minutes: 60, priority: 2, quest_type: 'side' }] }; }, chat: async (...a) => { calls.chat.push(a); return { reply: 'Start with the hardest topic while you are fresh.' }; }, ...o }; };

test('intent detection routes requests sensibly', () => {
  const cases = { help: ['help', 'hi there', 'what can you do?'], breakdown: ['break down my essay', 'can you break this down into smaller steps', 'how should I approach learning piano'], explain: ['why did you schedule it this way?', 'explain this plan'], recover: ['I fell behind this week', 'help me catch up', 'reschedule my missed sessions'], progress: ['what is my level?', 'show my xp'], overview: ['what is due today?', 'show my upcoming deadlines', 'what do I have next'],
    plan: ['plan my week', 'make me a timetable'],
 other: ['tell me a joke', 'maths test Thursday and draw 3 times a week', 'finish a 40 hour project by tomorrow'] };
  for (const [intent, texts] of Object.entries(cases)) for (const t of texts) assert.equal(detectIntent(t), intent, t); });
test('local breakdown templates and subject extraction', () => {
  assert.equal(extractSubject('Can you break down my history essay?'), 'my history essay'); assert.ok(breakdownSteps('write my essay').steps.includes('Outline the main points')); assert.ok(breakdownSteps('piano practice').steps.length >= 4); assert.equal(breakdownSteps('zzz').generic, true);
  assert.match(scopeText('Nova', { aiConfigured: false, aiOptIn: false }), /isn’t set up/); assert.match(scopeText('Nova', { aiConfigured: true, aiOptIn: false }), /turn on AI/i); });
test('local assistant text is built from the user’s own data only', async () => {
  const { svc } = rig(); const d = await svc.dashboard(); assert.match(overviewText(d), /Sample: Revise for maths test/); assert.match(progressText(await svc.character()), /level 1 with 0\/100 XP/); assert.match(explainText(null), /Ask me for a plan first/); });
test('provider client: shared call path, status mapping, reply sanitising', async () => {
  const mk = (status, body) => createServerProvider({ endpoint: 'https://x/fn', getToken: async () => 't', headers: { apikey: 'pk' }, fetchImpl: async (u, o) => ({ ok: status === 200, status, json: async () => body, _o: o }) });
  assert.deepEqual(await mk(200, { reply: 'ok' }).chat([{ role: 'user', content: 'hi' }], { tz: 'UTC' }), { reply: 'ok' });
  for (const [st, re] of [[429, /daily AI limit/], [403, /turned off/], [401, /sign in again/], [500, /500/]]) assert.match((await askAI(mk(st, {}), [{ role: 'user', content: 'x' }], {})).error, re);
  assert.equal(sanitizeReply({ reply: '   ' }).ok, false); assert.equal(sanitizeReply({ reply: 'a'.repeat(3000) }).reply.length, 1500); assert.equal(sanitizeReply(null).ok, false);
  let seen; const p = createServerProvider({ endpoint: 'https://x/fn', getToken: async () => 'tok', headers: { apikey: 'pk' }, fetchImpl: async (u, o) => { seen = o; return { ok: true, status: 200, json: async () => ({ reply: 'r' }) }; } }); await p.chat([{ role: 'user', content: 'hi' }], { today: '2026-10-13', tz: 'UTC' });
  assert.equal(seen.headers.Authorization, 'Bearer tok'); assert.equal(seen.headers.apikey, 'pk'); assert.equal(JSON.parse(seen.body).mode, 'chat'); });

test('no AI configured: free-form chat is honestly refused as out of scope; plans and helpers still work, all labelled rules', async () => {
  const { svc } = rig(); let r = await svc.assistantReply('tell me a joke'); assert.equal(r.source, 'rules'); assert.match(r.text, /only help with ShinkaLife planning/); assert.match(r.text, /isn’t set up/);
  r = await svc.assistantReply('maths test Thursday and draw three times this week'); assert.equal(r.source, 'rules'); assert.ok(r.proposal.blocks.length > 3); assert.match(r.text, /nothing is saved until you approve/);
  r = await svc.assistantReply('break down my essay'); assert.equal(r.source, 'rules'); assert.ok(r.steps.length >= 5); assert.match((await svc.assistantReply('help')).text, /built-in rules \(no AI\)/);
  r = await svc.assistantReply('what is due this week?'); assert.match(r.text, /Coming up/); r = await svc.assistantReply('plan my week'); assert.match(r.text, /Tell me what you need to do/); });
test('AI only after opt-in AND while online; offline falls back to rules with a clear note and no provider call', async () => {
  const p = fake(), { svc, st } = rig({ provider: p }); let r = await svc.assistantReply('how can I focus better this week?'); assert.equal(r.source, 'rules'); assert.match(r.text, /turn on AI/i); assert.equal(p.calls.chat.length, 0);
  await svc.setAiOptIn(true); r = await svc.assistantReply('how can I focus better this week?'); assert.equal(r.source, 'ai'); assert.match(r.text, /hardest topic/); assert.equal(p.calls.chat.length, 1); assert.equal(p.calls.chat[0][0].at(-1).content, 'how can I focus better this week?');
  r = await svc.assistantReply('read my book'); assert.equal(r.source, 'ai'); assert.equal(p.calls.plan.length, 1); assert.equal(r.proposal.source, 'ai');
  st.online = false; r = await svc.assistantReply('how can I focus better this week?'); assert.equal(r.source, 'rules'); assert.match(r.text, /offline/i); assert.equal(p.calls.chat.length, 1);
  r = await svc.assistantReply('read my book'); assert.equal(r.proposal.source, 'rules'); assert.equal(p.calls.plan.length, 1, 'no AI call while offline'); assert.match(r.text, /offline/i); });
test('AI failures fall back to rules, say why, and are retryable', async () => {
  const p = fake({ chat: async () => { throw new Error('The AI service timed out.'); }, proposeTasks: async () => { throw new Error('The daily AI limit has been reached.'); } }), { svc } = rig({ provider: p }); await svc.setAiOptIn(true);
  let r = await svc.assistantReply('how can I focus better this week?'); assert.deepEqual([r.source, r.retryable], ['rules', true]); assert.match(r.text, /AI is unavailable: The AI service timed out/);
  r = await svc.assistantReply('read my book'); assert.equal(r.source, 'rules'); assert.equal(r.retryable, true); assert.match(r.text, /AI was unavailable/); assert.ok(r.proposal.blocks.length > 0);
  r = await svc.assistantReply('break down my essay'); assert.equal(r.source, 'rules'); assert.ok(r.steps.length && r.retryable); });
test('data sharing: nothing about the user is sent unless they opt in to sharing; then titles and times only', async () => {
  const p = fake(), { svc } = rig({ provider: p }); await svc.setAiOptIn(true); await svc.assistantReply('how can I focus better?'); assert.deepEqual(Object.keys(p.calls.chat[0][1]).sort(), ['today', 'tz']);
  await svc.setAssistantFlag('ai_share_data', true); await svc.assistantReply('how can I focus better?'); const ctx = p.calls.chat[1][1].context; assert.ok(ctx.deadlines.some(d => /maths test/.test(d.title))); assert.deepEqual(Object.keys(ctx.deadlines[0]).sort(), ['due', 'est', 'title']);
  await assert.rejects(svc.setAssistantFlag('assistant_name', true), /Unknown setting/); });
test('missed-session recovery and plan explanations come from local rules and the real schedule', async () => {
  const { svc, repo } = rig(); const t = await svc.createTask({ title: 'Read', quest_type: 'side', priority: 2, est_minutes: 60 }); await repo.addBlocks([{ task_id: t.id, title: 'Read', start_at: iso(loc(2026, 10, 12, 9)), end_at: iso(loc(2026, 10, 12, 10)) }]);
  let r = await svc.assistantReply('I fell behind'); assert.match(r.text, /1 missed session/); assert.ok(r.proposal.blocks.length); assert.equal(r.proposal.kind, 'recovery');
  const plan = (await svc.assistantReply('study chemistry for 2 hours on Friday')).proposal; r = await svc.assistantReply('why this order?', { lastProposal: plan }); assert.match(r.text, /no AI/); assert.match(r.text, /earliest free time/); });
test('conversation history: saved per account, can be turned off and cleared; failures never block chatting', async () => {
  const { svc, repo } = rig(); assert.deepEqual(await svc.history(), []); assert.equal(await svc.remember('user', 'user', 'Plan my week'), true); await svc.remember('assistant', 'rules', 'Here is a draft'); const h = await svc.history();
  assert.deepEqual(h.map(m => [m.role, m.source]), [['user', 'user'], ['assistant', 'rules']]); await svc.setAssistantFlag('chat_history', false); assert.equal(await svc.remember('user', 'user', 'private'), false); assert.deepEqual(await svc.history(), []);
  await svc.setAssistantFlag('chat_history', true); assert.equal((await svc.history()).length, 2); await svc.clearHistory(); assert.deepEqual(await svc.history(), []);
  const broken = createService({ ...repo, addMessage: async () => { throw new Error('network'); } }, {}); assert.equal(await broken.remember('user', 'user', 'x'), false); const other = rig(); assert.deepEqual(await other.svc.history(), [], 'a different account has its own history'); });
test('message validation; approving a schedule offline is refused without changing anything', async () => {
  const { svc, st, repo } = rig(); await assert.rejects(svc.assistantReply('   '), /Type a message/); await assert.rejects(svc.assistantReply('x'.repeat(2001)), /under 2000/);
  const plan = (await svc.assistantReply('study chemistry for 2 hours')).proposal; st.online = false; await assert.rejects(svc.approveProposal(plan), /needs an internet connection/); assert.equal((await repo.listBlocks(iso(0), iso(4e12))).length, 0);
  const t = await svc.createTask({ title: 'Quiz', quest_type: 'main', priority: 3 }); const broken = createService({ ...repo, updateBlock: async () => { throw new Error('Failed to fetch'); }, listBlocks: async () => { throw new Error('Failed to fetch'); } }, { clock: () => st.now, isOnline: () => false });
  const r = await broken.setTaskDone(t.id, true); assert.equal(r.award.awarded, true, 'completion and XP survive best-effort schedule tidying failing'); });

test('curly apostrophes (phone keyboards, prompt buttons) are understood like straight ones', () => { for (const t of ['What’s due this week?', 'what’s due today', 'What\u2019s on my plate']) assert.equal(detectIntent(t), 'overview', t); assert.equal(detectIntent('What\'s due this week?'), 'overview'); });
