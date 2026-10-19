// GitHub Pages project-site compatibility: the site lives under https://dannyekusu.github.io/ShinkaLife/ (a sub-path, case-sensitive file names).
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'; import { join, dirname } from 'node:path';
const root = new URL('..', import.meta.url).pathname, read = p => readFileSync(join(root, p), 'utf8'), BASE = 'https://dannyekusu.github.io/ShinkaLife/';
const exists = rel => { const parts = rel.split('/'); let dir = root; for (const p of parts) { if (!readdirSync(dir).includes(p)) return false; dir = join(dir, p); } return true; };   // exact-case check, like GitHub Pages
test('every resource referenced by index.html resolves inside the site base path and exists with exact case', () => {
  const html = read('index.html'), refs = [...html.matchAll(/<(?:link|script|img|source|iframe)\b[^>]*?(?:href|src)="([^"#]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('data:'));   // resources the page LOADS (outbound <a> links like Instagram are navigation, checked separately)
  assert.ok(refs.length >= 6); for (const a of [...html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/g)]) assert.match(a[0], /rel="noopener noreferrer"/, 'external link must be rel=noopener noreferrer: ' + a[1]); for (const r of refs) { assert.ok(!/^https?:/.test(r) || r.startsWith(BASE), 'external dependency: ' + r); assert.ok(!r.startsWith('/'), 'root-absolute path breaks sub-path hosting: ' + r); const u = new URL(r, BASE); assert.ok(u.href.startsWith(BASE), r); if (!/^https?:/.test(r) && !r.startsWith('#')) assert.ok(exists(u.pathname.slice('/ShinkaLife/'.length)), 'missing or wrong case: ' + r); } });
test('manifest, service worker and precache entries are relative, in scope and exact-case', () => {
  const man = JSON.parse(read('manifest.webmanifest')); assert.equal(new URL(man.start_url, BASE).href, BASE); assert.equal(new URL(man.scope, BASE).href, BASE); assert.equal(new URL(man.id, BASE).href, BASE);
  for (const i of man.icons) assert.ok(exists(i.src), i.src); const sw = read('sw.js'), list = [...sw.match(/PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of list) { assert.ok(!f.startsWith('/'), f); if (f !== './') assert.ok(exists(f), 'precache entry missing/wrong case: ' + f); }
  assert.match(read('js/app.js'), /serviceWorker\.register\('sw\.js'\)/, 'registered with a relative URL so the scope is /ShinkaLife/'); assert.ok(exists('sw.js') && exists('offline.html')); });
test('no JavaScript hard-codes a root path, and every import resolves to an exact-case file', () => {
  const files = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js'));
  for (const f of files) { const src = read('js/' + f); assert.ok(!/(fetch|import|new URL)\(\s*['"`]\/[^/]/.test(src), `root-absolute URL in ${f}`); assert.ok(!/location\.(href|replace|assign)\s*=\s*['"`]\//.test(src), `root redirect in ${f}`);
    for (const m of src.matchAll(/from '(\.\/[^']+)'/g)) assert.ok(exists('js/' + m[1].slice(2)), `${f} imports ${m[1]} (wrong case or missing)`); }
  const auth = read('js/auth.js'); assert.match(auth, /origin \+ location\.pathname/, 'auth redirects are computed from the real address, so they follow the actual sub-path'); });
test('nothing that must stay private is inside the published site files', () => {
  const published = ['index.html', 'offline.html', 'sw.js', 'manifest.webmanifest', 'css', 'js', 'assets', 'vendor']; const walk = p => statSync(join(root, p)).isDirectory() ? readdirSync(join(root, p)).flatMap(c => walk(join(p, c))) : [p];
  for (const f of published.flatMap(walk).filter(f => /\.(js|html|css|webmanifest)$/.test(f) && !f.startsWith('vendor/'))) { const s = read(f); assert.ok(!/sb_secret_[A-Za-z0-9]|SERVICE_ROLE_KEY|sk-[A-Za-z0-9]{20}|AI_API_KEY\s*[:=]\s*['"][^'"]/.test(s), 'secret-like text in ' + f); }
  assert.ok(!exists('.env')); });
test('workflow publishes only site files (not tests, functions or docs)', () => { const y = read('.github/workflows/pages.yml'); assert.match(y, /cp -r index\.html offline\.html manifest\.webmanifest sw\.js css js assets vendor site\//); assert.ok(!/supabase|tests/.test(y.match(/cp -r[^\n]*/)[0])); });
