export const HEX = /^#[0-9a-fA-F]{6}$/;
const LIGHT = '#f6f1e4', DARK = '#14171a', ACCENT2 = '#2f7d57';
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
export const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
export const contrast = (a, b) => { const [p, q] = [lum(a), lum(b)].sort((x, y) => y - x); return (p + .05) / (q + .05); };
export const readable = bg => contrast(bg, LIGHT) >= contrast(bg, DARK) ? LIGHT : DARK;

export const DEFAULT_THEME = { preset: 'shinka-dark', bg: '#16191a', accent: '#c9a24d', mode: 'dark', reducedMotion: false };
export const PRESETS = {
  'shinka-dark': { label: 'Shinka Dark', bg: '#16191a', accent: '#c9a24d' },
  'forest-focus': { label: 'Forest Focus', bg: '#0f1f17', accent: '#8fd19e' },
  'midnight-blue': { label: 'Midnight Blue', bg: '#0c1a2b', accent: '#6aa7ff' },
  'royal-purple': { label: 'Royal Purple', bg: '#1a1230', accent: '#b79cff' },
  'warm-minimal': { label: 'Warm Minimal', bg: '#efe6d2', accent: '#8a5a1c' },
};
export const BGS = { 'Midnight Charcoal': '#16191a', 'Deep Forest': '#0f1f17', 'Ocean Blue': '#0c1a2b', 'Royal Purple': '#1a1230', 'Burgundy': '#2a1118', 'Warm Sand': '#efe6d2', 'Pure Dark': '#000000' };
export const ACCENTS = { Gold: '#c9a24d', Moss: '#8fd19e', Sky: '#6aa7ff', Violet: '#b79cff', Rose: '#e58aa0', Ember: '#e2874a' };

export function sanitizeTheme(t) {
  t = t && typeof t === 'object' ? t : {};
  const ok = (v, d) => (typeof v === 'string' && HEX.test(v)) ? v.toLowerCase() : d;
  const bg = ok(t.bg, DEFAULT_THEME.bg);
  return { preset: typeof t.preset === 'string' && t.preset.length < 32 ? t.preset : 'custom', bg, accent: ok(t.accent, DEFAULT_THEME.accent),
    mode: t.mode === 'light' || t.mode === 'dark' ? t.mode : (lum(bg) >= .4 ? 'light' : 'dark'), reducedMotion: t.reducedMotion === true };
}

// Guarantees WCAG AA (4.5:1) for text, muted text, accent and on-accent text on every surface.
export function deriveTokens(th) {
  const s = sanitizeTheme(th);
  let bg = s.bg;
  if (s.mode === 'light' && lum(bg) < .4) bg = mix(bg, LIGHT, .9); else if (s.mode === 'dark' && lum(bg) >= .4) bg = mix(bg, '#000000', .88);
  let text = readable(bg), n = 0;
  const bad = () => contrast(text, mix(bg, text, .12)) < 4.5 || contrast(text, bg) < 4.5;
  while (bad() && n++ < 30) { bg = mix(bg, text === LIGHT ? '#000000' : '#ffffff', .1); text = readable(bg); }
  const surface = mix(bg, text, .06), surface2 = mix(bg, text, .12), border = mix(bg, text, .22);
  const fix = c => { let k = 0, x = c; while (contrast(x, surface2) < 4.5 && k++ < 60) x = mix(x, text, .08); return contrast(x, surface2) < 4.5 ? text : x; };
  let muted = mix(text, bg, .35), k = 0;
  while (contrast(muted, surface2) < 4.5 && k++ < 60) muted = mix(muted, text, .1);
  if (contrast(muted, surface2) < 4.5) muted = text;
  const accent = fix(s.accent);
  return { '--bg': bg, '--surface': surface, '--surface-2': surface2, '--border': border, '--text': text,
    '--muted': muted, '--accent': accent, '--accent-2': fix(ACCENT2), '--on-accent': readable(accent), '--focus': accent };
}

export function applyTheme(th) {
  const s = sanitizeTheme(th), v = deriveTokens(s), r = document.documentElement;
  for (const k in v) r.style.setProperty(k, v[k]);
  r.dataset.motion = s.reducedMotion ? 'reduce' : '';
  r.style.colorScheme = lum(v['--bg']) < .4 ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', v['--bg']);
}
const KEY = 'shinkalife.theme';
export const loadLocal = () => { try { return sanitizeTheme(JSON.parse(localStorage.getItem(KEY))); } catch { return { ...DEFAULT_THEME }; } };
export const saveLocal = t => { try { localStorage.setItem(KEY, JSON.stringify(sanitizeTheme(t))); } catch {} };
