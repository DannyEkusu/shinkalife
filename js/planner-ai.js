// Optional AI layer. The model may only DECOMPOSE text into tasks; scheduling and validation always run locally.
// Secrets live in a server-side function (never in the browser); this module only calls that endpoint.
import { validateTask } from './tasks-core.js';
import { buildProposal, proposeFromTasks } from './planner-core.js';
export const MAX_INPUT = 2000;
export function sanitizeAITasks(json) {
  if (!json || !Array.isArray(json.tasks)) return { ok: false, error: 'The response had no task list.' };
  if (json.tasks.length === 0 || json.tasks.length > 30) return { ok: false, error: 'Unexpected number of tasks.' };
  const tasks = [];
  for (const [i, t] of json.tasks.entries()) {
    if (!t || typeof t !== 'object') return { ok: false, error: `Task ${i + 1} was malformed.` };
    const r = validateTask({ title: t.title, quest_type: t.quest_type ?? 'side', priority: t.priority ?? 2, due_at: t.due_at ?? '', est_minutes: t.est_minutes ?? '', notes: t.notes ?? '' });
    if (!r.ok) return { ok: false, error: `Task ${i + 1}: ${r.errors[0]}` };
    tasks.push({ id: `ai${i}`, status: 'todo', ...r.value, est_minutes: r.value.est_minutes ?? 30, assumptions: [] });
  }
  return { ok: true, tasks };
}
export function createServerProvider({ endpoint, getToken, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  return { name: 'server', async proposeTasks(text) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    try { const res = await fetchImpl(endpoint, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(`AI service returned ${res.status}.`); return await res.json(); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'The AI service timed out.' : e.message); } finally { clearTimeout(timer); } } };
}
export async function planWithAI(text, ctx, provider) {
  if (String(text).length > MAX_INPUT) return { ok: false, error: `Please keep it under ${MAX_INPUT} characters.` };
  if (!provider) return { ok: true, ...buildProposal(text, ctx), aiAvailable: false };
  try {
    const s = sanitizeAITasks(await provider.proposeTasks(text)); if (!s.ok) throw new Error('AI returned unusable data: ' + s.error);
    return { ok: true, ...proposeFromTasks({ tasks: s.tasks, source: 'ai' }, ctx), aiAvailable: true };
  } catch (e) { return { ok: true, ...buildProposal(text, ctx), aiAvailable: true, aiError: e.message }; }
}
