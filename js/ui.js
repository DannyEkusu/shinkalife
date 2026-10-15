import { localParts, zonedToUtc } from './recur-core.js';
export const $ = s => document.querySelector(s);
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (v == null || v === false) continue; if (k.startsWith('on')) el[k] = v; else if (k === 'class') el.className = v; else if (k === 'checked' || k === 'value' || k === 'selected' || k === 'disabled') el[k] = v; else el.setAttribute(k, v === true ? '' : v); }
  el.append(...kids.flat(2).filter(x => x != null && x !== false)); return el;
}
const pad = n => String(n).padStart(2, '0');
export const fmtTime = (ms, tz) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
export const fmtDay = (ms, tz, o = {}) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz, ...o });
export const toInput = (ms, tz) => { const p = localParts(ms, tz); return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; };
export const fromInput = (s, tz) => { const m = String(s).match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); return m ? zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz) : NaN; };
export const dayStart = (ms, tz, k = 0) => { const p = localParts(ms, tz); return zonedToUtc(p.y, p.mo, p.d + k, 0, 0, tz); };
export const minToInput = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; export const inputToMin = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + (b || 0); };
export function note(el, text, ok) { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); }
// Explicit error state with an intentional retry (never silently replaced by other data)
export function failure(root, e, retry) { root.replaceChildren(h('div', { class: 'msg err', role: 'alert' }, `Couldn’t load this: ${e.message}`), h('p', {}, h('button', { class: 'btn ghost', type: 'button', onclick: retry }, 'Try again'))); }
export const needData = root => root.replaceChildren(h('p', { class: 'muted' }, 'This page works with your account data. Log in, or open the app with sample data from the setup screen.'));
let timer; export function toast(text) { const t = $('#toast'); if (!t) return; t.textContent = text; t.hidden = false; clearTimeout(timer); timer = setTimeout(() => { t.hidden = true; }, 5000); }
