import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync, existsSync } from 'node:fs'; import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, read = p => readFileSync(join(root, p), 'utf8'), man = JSON.parse(read('manifest.webmanifest')), sw = read('sw.js'), index = read('index.html');
const precache = [...sw.match(/PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const png = p => { const b = readFileSync(join(root, p)); assert.equal(b.slice(1, 4).toString(), 'PNG', p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
test('manifest is installable and uses relative paths (GitHub Pages sub-path safe)', () => {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']) assert.ok(man[k], k); assert.equal(man.display, 'standalone');
  for (const v of [man.start_url, man.scope, ...man.icons.map(i => i.src)]) assert.ok(!v.startsWith('/') && !v.startsWith('http'), 'relative: ' + v);
  assert.ok(man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.sizes === '512x512' && i.purpose === 'any') && man.icons.some(i => i.purpose === 'maskable'));
  for (const i of man.icons) { const [w, h] = png(i.src); assert.equal(`${w}x${h}`, i.sizes, i.src); } });
test('index links the manifest, icon and local (vendored) Supabase library', () => { assert.match(index, /rel="manifest" href="manifest.webmanifest"/); assert.match(index, /src="vendor\/supabase.js"/); assert.ok(!/https?:\/\/[^"']*(cdn|unpkg|jsdelivr)/.test(index)); assert.ok(!/(href|src)="\//.test(index)); });
test('every precached file exists, and every module reachable from app.js is precached', () => {
  for (const f of precache) if (f !== './') assert.ok(existsSync(join(root, f)), 'missing ' + f);
  const seen = new Set(), walk = f => { if (seen.has(f)) return; seen.add(f); for (const m of read(f).matchAll(/from '\.\/([\w-]+\.js)'/g)) walk('js/' + m[1]); }; walk('js/app.js');
  for (const f of seen) assert.ok(precache.includes(f), 'not precached: ' + f); });
test('service worker never caches non-GET, cross-origin or authorised requests, and has an offline fallback', () => {
  assert.match(sw, /req\.method !== 'GET'/); assert.match(sw, /url\.origin !== self\.location\.origin/); assert.match(sw, /headers\.has\('authorization'\)/); assert.match(sw, /offline\.html/); assert.ok(precache.includes('offline.html'));
  assert.ok(!/supabase\.co|api\/|rest\/v1/.test(sw.replace(/\/\/.*$/gm, ''))); assert.match(sw, /SKIP_WAITING/); });
test('no secrets in committed config', () => { const c = read('js/config.js'); assert.match(c, /AI_ENDPOINT: ''/); assert.ok(!/sb_secret_|service_role/.test(c.replace(/\/\/.*$/gm, '')), 'no privileged key text in config'); for (const f of ['index.html', 'sw.js', 'js/app.js', 'js/auth.js', 'js/service.js']) assert.ok(!/service_role|sk-[A-Za-z0-9]{20}/.test(read(f)), f); });
