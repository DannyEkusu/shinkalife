import * as T from './theme.js';
import * as A from './auth.js';
import * as Quests from './quests.js';
import { setRepo, repoKind, repo } from './repo.js';
import { supabaseRepo } from './repo-supabase.js';
import { createMockRepo } from './repo-mock.js';
import { createService } from './service.js';
import { createServerProvider } from './planner-ai.js';
import { CONFIG } from './config.js';
import { checkDatabase } from './dbcheck.js';
import { state } from './state.js';
import * as Pages from './pages.js';
const $ = s => document.querySelector(s);
const show = id => document.querySelectorAll('.view').forEach(e => { e.hidden = e.id !== id; });
const note = (el, text, ok) => { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); };
let recovering = /[#&?]type=recovery/.test(location.hash + location.search);   // captured before supabase-js clears the URL
let user = null, preview = false, theme = T.loadLocal();
T.applyTheme(theme);

function renderTheme() {
  const mk = (root, items, key, cur) => { root.replaceChildren(...Object.entries(items).map(([n, c]) => {
    const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.type = 'button';
    b.setAttribute('aria-label', n); b.setAttribute('aria-pressed', String(c === cur));
    b.onclick = () => change({ [key]: c, preset: 'custom', ...(key === 'bg' ? { mode: T.lum(c) >= .4 ? 'light' : 'dark' } : {}) }, true); return b; })); };
  mk($('#bgs'), T.BGS, 'bg', theme.bg); mk($('#accents'), T.ACCENTS, 'accent', theme.accent);
  $('#presets').replaceChildren(...Object.entries(T.PRESETS).map(([id, p]) => {
    const b = document.createElement('button'); b.className = 'btn ghost'; b.type = 'button'; b.textContent = p.label;
    b.setAttribute('aria-pressed', String(theme.preset === id));
    b.onclick = () => change({ preset: id, bg: p.bg, accent: p.accent, mode: T.lum(p.bg) >= .4 ? 'light' : 'dark' }, true); return b; }));
  $('#modes').replaceChildren(...['dark', 'light'].map(m => { const b = document.createElement('button'); b.className = 'btn ghost'; b.type = 'button'; b.textContent = m === 'dark' ? 'Dark' : 'Light'; b.setAttribute('aria-pressed', String(theme.mode === m)); b.onclick = () => change({ mode: m }, true); return b; }));
  $('#c-bg').value = theme.bg; $('#c-ac').value = theme.accent; $('#c-motion').checked = theme.reducedMotion;
}
async function change(patch, save) {
  theme = T.sanitizeTheme({ ...theme, ...patch }); T.applyTheme(theme); T.saveLocal(theme); renderTheme();
  if (save && user && repoKind() === 'supabase') { try { await A.saveTheme(user.id, theme); note($('#theme-msg'), 'Theme saved to your account.', true); }
    catch (e) { note($('#theme-msg'), 'Saved on this device only. Account sync failed: ' + e.message); } }
}
$('#c-bg').oninput = e => change({ bg: e.target.value, preset: 'custom', mode: T.lum(e.target.value) >= .4 ? 'light' : 'dark' }, false);
$('#c-bg').onchange = e => change({ bg: e.target.value, preset: 'custom', mode: T.lum(e.target.value) >= .4 ? 'light' : 'dark' }, true);
$('#c-ac').oninput = e => change({ accent: e.target.value, preset: 'custom' }, false);
$('#c-ac').onchange = e => change({ accent: e.target.value, preset: 'custom' }, true);
$('#c-motion').onchange = e => change({ reducedMotion: e.target.checked }, true);
$('#c-reset').onclick = () => change({ ...T.DEFAULT_THEME }, true);

const PAGES = ['dashboard', 'calendar', 'planner', 'reminders', 'quests', 'character', 'progress', 'settings'];
const LOAD = { dashboard: Pages.dashboard, calendar: Pages.calendar, planner: Pages.planner, reminders: Pages.reminders, quests: () => Quests.show(user), character: Pages.character, progress: Pages.progress, settings: Pages.settingsExtras };
function route() {
  const want = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard', cur = PAGES.includes(want) ? want : 'dashboard';
  for (const p of PAGES) $('#page-' + p).hidden = p !== cur;
  const sec = $('#page-' + cur); sec.classList.remove('page-enter'); void sec.offsetWidth; sec.classList.add('page-enter');
  document.querySelectorAll('nav a').forEach(a => a.dataset.page === cur ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  $('#date-line').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  if (user || state.mock) LOAD[cur]?.(); else for (const r of ['#dash-dyn', '#cal-root', '#plan-root', '#rem-root', '#char-root', '#prog-root', '#set-dyn']) $(r)?.replaceChildren();
}
addEventListener('hashchange', route);

function greet(name) {
  const h = new Date().getHours(), t = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('#greeting').textContent = name ? `${t}, ${name}` : t;
}
const tzs = [...new Set(['UTC', ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [])])];
$('#p-tz').replaceChildren(...tzs.map(z => { const o = document.createElement('option'); o.value = o.textContent = z; return o; }));

async function enterApp(session) {
  user = session.user; preview = false; state.mock = false; $('#mock-banner').hidden = true;
  const provider = CONFIG.AI_ENDPOINT ? createServerProvider({ endpoint: CONFIG.AI_ENDPOINT, getToken: async () => (await A.sb.auth.getSession()).data.session?.access_token }) : null;
  setRepo(supabaseRepo, 'supabase'); state.svc = createService(repo, { provider }); $('#preview-banner').hidden = true; show('view-app'); route();
  try {
    const { profile, theme: remote } = await A.loadAccount(user.id);
    if (remote && Object.keys(remote).length) { theme = T.sanitizeTheme(remote); T.applyTheme(theme); T.saveLocal(theme); }
    $('#p-name').value = profile?.display_name ?? ''; $('#p-tz').value = profile?.timezone ?? 'UTC'; state.tz = profile?.timezone ?? 'UTC';
    greet(profile?.display_name);
  } catch (e) { note($('#prof-msg'), 'Could not load your profile: ' + e.message); greet(); }
  renderTheme(); route();
  checkDatabase(A.sb).then(r => { const b = $('#db-banner'); b.hidden = r.ok; if (r.unreachable) b.textContent = 'Can’t reach Supabase right now. Check your connection; nothing has been lost.'; else if (r.missing.length) b.textContent = `Your Supabase database isn’t fully set up. Missing: ${r.missing.map(m => m.name).join(', ')}. Run migration${r.migrations.length > 1 ? 's' : ''} ${r.migrations.join(', ')} in the Supabase SQL Editor (see README), then reload.`; }).catch(() => {});
}
$('#f-prof').onsubmit = async e => {
  e.preventDefault(); if (!user) return note($('#prof-msg'), 'Log in to save a profile.');
  const name = $('#p-name').value.trim();
  try { const v = { display_name: name || null, timezone: $('#p-tz').value }; if (repoKind() === 'mock') await repo.saveProfile(v); else await A.saveProfile(user.id, v); state.tz = v.timezone; greet(name); note($('#prof-msg'), 'Profile saved.', true); }
  catch (err) { note($('#prof-msg'), 'Could not save: ' + err.message); }
};

const tab = t => { $('#f-in').hidden = t !== 'in'; $('#f-up').hidden = t !== 'up'; note($('#auth-msg'), '', true);
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t))); };
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
const guard = async (el, fn) => { try { await fn(); } catch (e) { note(el, e.message); } };
$('#f-in').onsubmit = e => { e.preventDefault(); note($('#auth-msg'), 'Logging in…', true);
  guard($('#auth-msg'), async () => { await A.signIn($('#in-email').value.trim(), $('#in-pw').value); $('#in-pw').value = ''; }); };
$('#f-up').onsubmit = e => { e.preventDefault(); const pw = $('#up-pw').value;
  if (pw.length < 8) return note($('#auth-msg'), 'Password must be at least 8 characters.');
  note($('#auth-msg'), 'Creating account…', true);
  guard($('#auth-msg'), async () => { const d = await A.signUp($('#up-email').value.trim(), pw, $('#up-name').value.trim());
    if (!d.session) note($('#auth-msg'), 'Check your email to confirm your account, then log in.', true); }); };
$('#btn-forgot').onclick = () => { const em = $('#in-email').value.trim(); if (!em) return note($('#auth-msg'), 'Enter your email first.');
  guard($('#auth-msg'), async () => { await A.sendReset(em); note($('#auth-msg'), 'If that email has an account, a reset link is on its way.', true); }); };
$('#f-rec').onsubmit = e => { e.preventDefault(); const pw = $('#rec-pw').value;
  if (pw.length < 8) return note($('#rec-msg'), 'Password must be at least 8 characters.');
  guard($('#rec-msg'), async () => { await A.updatePassword(pw); note($('#rec-msg'), 'Password updated.', true); setTimeout(async () => { recovering = false; location.hash = '#/dashboard'; const { data } = await A.sb.auth.getSession(); if (data.session) enterApp(data.session); else show('view-auth'); }, 800); }); };
$('#btn-out').onclick = async () => { if (state.mock) { state.mock = false; setRepo(null, 'none'); state.svc = null; state.assistantName = null; user = null; Quests.reset(); $('#mock-banner').hidden = true; $('#btn-out').textContent = 'Log out'; show('view-setup'); return; } if (preview) { show('view-setup'); return; } try { await A.signOut(); } catch (e) { note($('#theme-msg'), e.message); } };
function enterMock() { // explicit, visibly-labelled development mode; never entered automatically after an error
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; setRepo(createMockRepo({ tz }), 'mock'); state.svc = createService(repo, {}); state.mock = true; state.tz = tz; user = { id: 'mock' }; preview = false;
  $('#mock-banner').hidden = false; $('#preview-banner').hidden = true; show('view-app'); $('#p-name').value = 'Sample user'; $('#p-tz').value = tz; $('#p-save').disabled = false; $('#btn-out').textContent = 'Exit sample mode'; greet('Sample user'); renderTheme(); route();
}
$('#btn-preview').onclick = enterMock;

Pages.startTicker();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').then(reg => {
  reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller && confirm('A new version of ShinkaLife is ready. Reload now?')) { navigator.serviceWorker.addEventListener('controllerchange', () => location.reload()); w.postMessage({ type: 'SKIP_WAITING' }); } }); });
}).catch(() => {});
if (new URLSearchParams(location.search).get('mock') === '1') enterMock();
else if (!A.configured) { show('view-setup'); const i = $('#setup-issue'); i.textContent = A.configIssue || (globalThis.supabase ? '' : 'The Supabase library (vendor/supabase.js) failed to load.'); i.hidden = !i.textContent; }
else {
  const clearPrivate = () => { for (const s of ['#dash-dyn', '#cal-root', '#plan-root', '#rem-root', '#char-root', '#prog-root', '#set-dyn', '#q-list']) $(s)?.replaceChildren(); $('#p-name').value = ''; $('#db-banner').hidden = true; };
  A.sb.auth.onAuthStateChange((ev, session) => setTimeout(() => {      // deferred: supabase-js must not be re-entered from inside its own callback
    if (ev === 'PASSWORD_RECOVERY') { recovering = true; return show('view-recovery'); }
    if (session) {
      if (recovering) return show('view-recovery');                      // recovery link: ask for a new password before showing the app
      if (user && session.user.id === user.id) { user = session.user; return; }   // TOKEN_REFRESHED / USER_UPDATED / duplicate SIGNED_IN: don't reload the whole app
      return enterApp(session);
    }
    if (!recovering) { user = null; setRepo(null, 'none'); state.svc = null; state.assistantName = null; Quests.reset(); clearPrivate(); show('view-auth'); }   // signed out: wipe private data from the page
  }, 0));
}
