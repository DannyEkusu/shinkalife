import test from 'node:test'; import assert from 'node:assert/strict';
import * as T from '../js/theme.js';
const check = (th, label) => { const v = T.deriveTokens(th);
  const ok = (a, b) => assert.ok(T.contrast(v[a], v[b]) >= 4.5, `${label}: ${a} on ${b} = ${T.contrast(v[a], v[b]).toFixed(2)}`);
  for (const s of ['--bg', '--surface', '--surface-2']) ok('--text', s);
  ok('--muted', '--surface-2'); ok('--accent', '--surface-2'); ok('--accent-2', '--surface-2'); ok('--on-accent', '--accent'); };
test('hex validation', () => { assert.ok(T.HEX.test('#a1B2c3')); for (const b of ['red', '#fff', '#12345', 'javascript:1', '']) assert.ok(!T.HEX.test(b)); });
test('sanitize rejects bad input', () => { const s = T.sanitizeTheme({ bg: 'url(x)', accent: 5, reducedMotion: 'yes' });
  assert.equal(s.bg, T.DEFAULT_THEME.bg); assert.equal(s.accent, T.DEFAULT_THEME.accent); assert.equal(s.reducedMotion, false); assert.equal(T.sanitizeTheme(null).bg, T.DEFAULT_THEME.bg); });
test('all presets are readable', () => { for (const [k, p] of Object.entries(T.PRESETS)) check(p, k); });
test('all swatch combinations are readable', () => { for (const b of Object.values(T.BGS)) for (const a of Object.values(T.ACCENTS)) check({ bg: b, accent: a }, `${b}/${a}`); });
test('adversarial colors stay readable', () => { for (const b of ['#000000', '#ffffff', '#777777', '#808080', '#7f7f7f', '#888888']) for (const a of ['#000000', '#ffffff', '#808080', b]) check({ bg: b, accent: a }, `${b}/${a}`); });
test('300 pseudo-random pairs stay readable', () => { let s = 12345; const r = () => (s = (s * 1664525 + 1013904223) % 4294967296);
  const h = () => '#' + (r() % 16777216).toString(16).padStart(6, '0'); for (let i = 0; i < 300; i++) check({ bg: h(), accent: h() }, 'rand' + i); });

test('light and dark modes are honoured and readable', () => { for (const b of Object.values(T.BGS)) for (const a of Object.values(T.ACCENTS)) for (const mode of ['light', 'dark']) {
  check({ bg: b, accent: a, mode }, `${mode}:${b}/${a}`); const l = T.lum(T.deriveTokens({ bg: b, accent: a, mode })['--bg']);
  assert.ok(mode === 'light' ? l >= .4 : l < .4, `${mode} ${b} gave lum ${l.toFixed(2)}`); } });
test('legacy theme without mode infers it from background', () => { assert.equal(T.sanitizeTheme({ bg: '#efe6d2' }).mode, 'light'); assert.equal(T.sanitizeTheme({ bg: '#16191a' }).mode, 'dark'); });
