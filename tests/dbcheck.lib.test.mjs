// Runs checkDatabase through the REAL vendored supabase-js with a fake network that behaves like PostgREST:
// GET on a missing table -> 404 + JSON error PGRST205; HEAD -> 404 with NO body (HEAD responses never have one).
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import { checkDatabase, REQUIRED } from '../js/dbcheck.js';
const mod = { exports: {} }, hadDoc = 'document' in globalThis;   // the bundle computes a script base-URL at load; give it a minimal page while loading
if (!hadDoc) globalThis.document = { currentScript: { tagName: 'SCRIPT', src: 'http://localhost/vendor/supabase.js' }, getElementsByTagName: () => [] };
new Function('module', 'exports', 'self', readFileSync(new URL('../vendor/supabase.js', import.meta.url), 'utf8'))(mod, mod.exports, globalThis);
if (!hadDoc) delete globalThis.document;
const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const client = ({ present, fnInstalled }) => mod.exports.createClient('https://abcdefghij1.supabase.co', 'sb_publishable_abcdefghijklmnop1234', { auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init = {}) => { const u = new URL(String(input)), m = (init.method || 'GET').toUpperCase(), name = u.pathname.split('/').pop();
    if (u.pathname.includes('/rpc/')) return fnInstalled ? json(404, { code: 'P0001', message: 'task not found' }) : json(404, { code: 'PGRST202', message: `Could not find the function public.${name}(p_task_id) in the schema cache` });
    if (present.has(name)) return m === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-range': '*/0' } }) : json(200, []);
    return m === 'HEAD' ? new Response(null, { status: 404 }) : json(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` }); } } });
const all = REQUIRED.map(r => r[0]);
test('reports EVERY missing table (the original probe only ever reported the function)', async () => {
  const r = await checkDatabase(client({ present: new Set(), fnInstalled: false })); assert.equal(r.ok, false); assert.equal(r.missing.length, 16); assert.deepEqual(r.migrations, ['0001', '0002', '0003', '0004']); assert.ok(r.missing.some(m => m.name === 'profiles')); });
test('reports a partly applied setup precisely', async () => {
  const r = await checkDatabase(client({ present: new Set(all.filter(t => ['profiles', 'preferences', 'categories', 'tasks', 'subtasks'].includes(t))), fnInstalled: false })); assert.deepEqual(r.migrations, ['0003', '0004']); assert.ok(!r.missing.some(m => m.name === 'tasks')); });
test('a complete setup passes', async () => { const r = await checkDatabase(client({ present: new Set(all), fnInstalled: true })); assert.equal(r.ok, true); assert.deepEqual(r.missing, []); });
