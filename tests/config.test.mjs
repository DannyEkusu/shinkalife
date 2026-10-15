import test from 'node:test'; import assert from 'node:assert/strict';
import { validateConfig } from '../js/config-check.js'; import { CONFIG } from '../js/config.js'; import { checkDatabase, REQUIRED } from '../js/dbcheck.js';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'), jwt = role => `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`, URL_OK = 'https://khaskedbnuyznhaeqcxi.supabase.co';
test('the committed config is valid and public-only', () => { assert.equal(validateConfig(CONFIG), null); assert.match(CONFIG.SUPABASE_ANON_KEY, /^sb_publishable_/); });
test('accepts publishable and legacy anon keys', () => { assert.equal(validateConfig({ SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnop1234' }), null); assert.equal(validateConfig({ SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: jwt('anon') }), null); });
test('refuses privileged keys', () => { for (const k of ['sb_secret_abcdefghijklmnop1234', jwt('service_role')]) assert.match(validateConfig({ SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: k }), /never use it in browser code/i); });
test('clear errors for missing or malformed config (never a silent success)', () => {
  assert.match(validateConfig({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }), /not configured/); assert.match(validateConfig({ SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: '' }), /missing/);
  for (const u of ['http://khaskedbnuyznhaeqcxi.supabase.co', URL_OK + '/', URL_OK + '/rest/v1', 'https://example.com', 'khaskedbnuyznhaeqcxi.supabase.co']) assert.match(validateConfig({ SUPABASE_URL: u, SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnop1234' }), /SUPABASE_URL/, u);
  assert.match(validateConfig({ SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: 'hello' }), /not recognised/); assert.equal(validateConfig(undefined), 'Supabase is not configured yet.'); });
const sbFake = ({ missing = [], fn = 'task not found', net = false } = {}) => ({
  from: t => ({ select: () => ({ limit: async () => ({ error: net ? { message: 'TypeError: Failed to fetch' } : missing.includes(t) ? { code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` } : null }) }) }),
  rpc: async () => ({ error: net ? { message: 'TypeError: Failed to fetch' } : fn === 'missing' ? { code: 'PGRST202', message: 'Could not find the function public.award_task_xp' } : { message: fn } }) });
test('database self-check: complete setup', async () => { const r = await checkDatabase(sbFake()); assert.equal(r.ok, true); assert.deepEqual(r.missing, []); assert.equal(REQUIRED.length, 15); });
test('database self-check names the missing migrations', async () => {
  const r = await checkDatabase(sbFake({ missing: ['events', 'xp_ledger', 'tasks'], fn: 'missing' })); assert.equal(r.ok, false); assert.deepEqual(r.migrations, ['0002', '0003', '0004']); assert.ok(r.missing.some(m => m.name === 'award_task_xp()'));
  assert.deepEqual((await checkDatabase(sbFake({ missing: REQUIRED.map(x => x[0]), fn: 'missing' }))).migrations, ['0001', '0002', '0003', '0004']); });
test('database self-check distinguishes "offline" from "not set up"', async () => { const r = await checkDatabase(sbFake({ net: true })); assert.equal(r.unreachable, true); assert.equal(r.ok, false); assert.deepEqual(r.missing, []); });
