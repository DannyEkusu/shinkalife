import { state } from './state.js';
import { repo } from './repo.js';
import { h, $, fmtTime, fmtDay, toInput, fromInput, dayStart, minToInput, inputToMin, note, failure, needData, toast } from './ui.js';
import { localParts } from './recur-core.js';
import * as N from './notify.js';
const DAY = 864e5, svc = () => state.svc;
const guard = (root, fn) => async () => { try { await fn(); } catch (e) { failure(root, e, guard(root, fn)); } };
const tag = (t, c = '') => h('span', { class: 'tag ' + c }, t);

// ---------- Dashboard ----------
export async function dashboard() {
  const root = $('#dash-dyn'); if (!svc()) return needData(root);
  await guard(root, async () => {
    const d = await svc().dashboard(), tz = d.tz;
    $('#ring').setAttribute('stroke-dasharray', `${d.xp.pct} 100`); $('#lvl').textContent = d.xp.level; $('#lvl-note').textContent = `${d.xp.into} / ${d.xp.needed} XP to level ${d.xp.level + 1}`;
    const line = [...d.today.fixed.map(f => ({ t: f.start, el: item(f.title, `${fmtTime(f.start, tz)}–${fmtTime(f.end, tz)}`, 'Fixed')})), ...d.today.blocks.map(b => ({ t: b.start, el: item(b.title, `${fmtTime(b.start, tz)}–${fmtTime(b.end, tz)}`, b.status === 'done' ? 'Done' : 'Planned') }))].sort((a, b) => a.t - b.t);
    const done = async (t, ok) => { try { const r = await svc().setTaskDone(t.id, ok); toast(r.award?.awarded ? `+${r.award.xp} XP` : 'Updated'); dashboard(); } catch (e) { toast(e.message); } };
    root.replaceChildren(
      d.availabilityMissing ? h('div', { class: 'banner' }, 'Set your available hours in ', h('a', { href: '#/settings' }, 'Settings'), ' so the planner can respect your real time.') : null,
      h('div', { class: 'grid' },
        h('div', { class: 'col-main' }, h('h2', { class: 'eyebrow' }, 'Today’s mission line'),
          line.length ? h('ol', { class: 'timeline' }, line.map(x => x.el)) : h('p', { class: 'muted' }, 'Nothing scheduled today. ', h('a', { href: '#/planner' }, 'Plan your week'), ' or ', h('a', { href: '#/calendar' }, 'add a block'), '.'),
          d.today.conflicts.length ? h('p', { class: 'msg err' }, 'Overlap: ' + d.today.conflicts.map(c => c.join(' ↔ ')).join('; ')) : null,
          h('h2', { class: 'eyebrow', style: 'margin-top:24px' }, 'Quests for today'),
          d.quests.length ? h('ul', { class: 'steps' }, d.quests.map(t => h('li', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => done(t, e.target.checked) }), t.title), tag(t.quest_type)))) : h('p', { class: 'muted' }, 'No quests due today.'),
          h('form', { class: 'addrow', style: 'margin-top:16px', onsubmit: async e => { e.preventDefault(); const v = $('#dq').value.trim(); if (!v) return; try { await svc().createTask({ title: v, quest_type: 'side', priority: 2 }); toast('Quest added'); dashboard(); } catch (x) { toast(x.message); } } },
            h('div', {}, h('label', { for: 'dq' }, 'Quick add'), h('input', { id: 'dq', type: 'text', maxlength: '120', placeholder: 'A new quest…' })), h('button', { class: 'btn', type: 'submit' }, 'Add'))),
        h('aside', { class: 'col-side' }, h('h2', { class: 'eyebrow' }, 'Deadlines'),
          d.deadlines.length ? h('ul', { class: 'plain' }, d.deadlines.slice(0, 6).map(t => h('li', {}, h('strong', {}, t.title), h('br'), h('span', { class: 'small ' + (t.pastDue ? 'due-past' : 'muted') }, (t.pastDue ? 'Past due · ' : 'Due ') + fmtDay(Date.parse(t.due_at), tz) + ' ' + fmtTime(Date.parse(t.due_at), tz))))) : h('p', { class: 'muted' }, 'No deadlines in the next 7 days.'),
          h('h2', { class: 'eyebrow' }, 'Reminders (next 24h)'), d.reminders.length ? h('ul', { class: 'plain' }, d.reminders.map(r => h('li', {}, `${fmtTime(r.at, tz)} · ${r.title}`))) : h('p', { class: 'muted' }, 'None upcoming. Reminders appear while the app is open.'),
          h('p', { class: 'muted small' }, `${d.openCount} open quest${d.openCount === 1 ? '' : 's'}`))));
  })();
}
function item(title, time, kind) { return h('li', {}, h('span', { class: 'node' }), h('h3', {}, title), h('p', { class: 'muted small' }, time + '  ', tag(kind, kind === 'Fixed' ? 'fixed' : ''))); }

// ---------- Calendar ----------
const cal = { view: 'week', anchor: null, sel: null };
export async function calendar() {
  const root = $('#cal-root'); if (!svc()) return needData(root);
  await guard(root, async () => {
    const tz = (await repo.getProfile()).timezone || 'UTC'; state.tz = tz; cal.anchor ??= Date.now(); const a = cal.anchor;
    const wd = localParts(a, tz).wd, monday = dayStart(a, tz, -((wd + 6) % 7)), first = (() => { const p = localParts(a, tz); return dayStart(a, tz, 1 - p.d); })();
    const days = cal.view === 'day' ? [dayStart(a, tz)] : cal.view === 'week' ? [...Array(7).keys()].map(i => dayStart(monday, tz, i)) : (() => { const m = dayStart(first, tz, -((localParts(first, tz).wd + 6) % 7)); return [...Array(42).keys()].map(i => dayStart(m, tz, i)); })();
    const from = days[0], to = dayStart(days[days.length - 1], tz, 1), data = await svc().calendar(from, to), conflictKeys = data.conflictTitles;
    const nav = k => { const p = localParts(a, tz); cal.anchor = cal.view === 'month' ? dayStart(a, tz, k * 28 > 0 ? 32 - p.d : -p.d) : dayStart(a, tz, k * (cal.view === 'week' ? 7 : 1)); calendar(); };
    const items = [...data.fixed.map(f => ({ ...f, kind: 'fixed', key: `${f.event_id}:${f.date}` })), ...data.blocks.filter(b => b.status !== 'skipped').map(b => ({ ...b, kind: 'block', key: b.id }))];
    const title = cal.view === 'month' ? new Date(first + DAY * 2).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: tz }) : fmtDay(days[0], tz) + (days.length > 1 ? ' – ' + fmtDay(days[6], tz) : '');
    const body = cal.view === 'month' ? month(days, items, tz, first) : grid(days, items, tz, conflictKeys);
    root.replaceChildren(
      h('div', { class: 'addrow cal-bar' }, h('button', { class: 'btn ghost', onclick: () => nav(-1), 'aria-label': 'Previous' }, '‹'), h('button', { class: 'btn ghost', onclick: () => { cal.anchor = Date.now(); calendar(); } }, 'Today'), h('button', { class: 'btn ghost', onclick: () => nav(1), 'aria-label': 'Next' }, '›'),
        h('strong', { class: 'cal-title', 'aria-live': 'polite' }, title), h('span', { class: 'spacer' }), ['day', 'week', 'month'].map(v => h('button', { class: 'btn ghost', 'aria-pressed': String(cal.view === v), onclick: () => { cal.view = v; calendar(); } }, v[0].toUpperCase() + v.slice(1)))),
      data.conflicts.length ? h('p', { class: 'msg err', role: 'alert' }, 'Overlaps in this view: ' + data.conflicts.map(c => c.join(' ↔ ')).join('; ')) : null,
      h('p', { class: 'small muted' }, h('span', { class: 'sw-key fixed' }), ' Fixed commitment  ', h('span', { class: 'sw-key block' }), ' Movable block'), body, h('div', { id: 'cal-edit' }), addForms(tz));
    if (cal.sel) editor(cal.sel, tz);
  })();
}
function grid(days, items, tz, conflicts) {
  const H0 = 6, H1 = 22, PX = 36, w = h('div', { class: 'cal-grid', style: `grid-template-columns:44px repeat(${days.length},minmax(0,1fr))` });
  w.append(h('div', {}), ...days.map(d => h('div', { class: 'cal-head' }, fmtDay(d, tz))));
  w.append(h('div', { class: 'cal-axis', style: `height:${(H1 - H0) * PX}px` }, [...Array(H1 - H0).keys()].map(i => h('div', { style: `height:${PX}px` }, String(H0 + i).padStart(2, '0') + ':00'))));
  for (const d of days) {
    const end = dayStart(d, tz, 1), mine = items.filter(x => x.start < end && x.end > d).sort((a, b) => a.start - b.start), lanes = [];
    for (const x of mine) { let l = lanes.findIndex(e => e <= x.start); if (l < 0) l = lanes.length; lanes[l] = x.end; x.lane = l; }
    const col = h('div', { class: 'cal-col', style: `height:${(H1 - H0) * PX}px;background-size:100% ${PX}px` });
    for (const x of mine) { const s = Math.max(x.start, d), e = Math.min(x.end, end), top = ((s - d) / 6e4 / 60 - H0) * PX, ht = Math.max(18, (e - s) / 6e4 / 60 * PX), n = Math.max(1, lanes.length);
      col.append(h('button', { type: 'button', class: `cal-item ${x.kind} ${x.status || ''}${conflicts.has(x.kind === 'fixed' ? x.key : x.id) ? ' conflict' : ''}`, style: `top:${Math.max(0, top)}px;height:${ht}px;left:${x.lane * 100 / n}%;width:${100 / n}%`, title: x.title, onclick: () => { cal.sel = x; calendar(); } }, `${fmtTime(x.start, tz)} ${x.title}`)); }
    w.append(col);
  }
  return h('div', { class: 'cal-scroll' }, w);
}
function month(days, items, tz, first) {
  const m = localParts(first, tz).mo, g = h('div', { class: 'cal-month' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => h('div', { class: 'cal-head' }, x)));
  for (const d of days) { const end = dayStart(d, tz, 1), mine = items.filter(x => x.start < end && x.end > d).sort((a, b) => a.start - b.start), p = localParts(d, tz);
    g.append(h('button', { type: 'button', class: 'cal-cell' + (p.mo === m ? '' : ' off'), 'aria-label': `${fmtDay(d, tz)}, ${mine.length} items`, onclick: () => { cal.view = 'day'; cal.anchor = d; calendar(); } }, h('b', {}, String(p.d)), mine.slice(0, 3).map(x => h('span', { class: 'mi ' + x.kind }, x.title)), mine.length > 3 ? h('span', { class: 'small muted' }, `+${mine.length - 3} more`) : null)); }
  return g;
}
async function editor(x, tz) {
  const box = $('#cal-edit'), done = async fn => { try { await fn(); cal.sel = null; calendar(); } catch (e) { note($('#ce-msg'), e.message); } };
  const f = (id, label, input) => h('div', {}, h('label', { for: id }, label), input), msg = h('div', { id: 'ce-msg', class: 'msg', role: 'status', 'aria-live': 'polite' });
  const close = h('button', { class: 'btn ghost', type: 'button', onclick: () => { cal.sel = null; calendar(); } }, 'Close');
  if (x.kind === 'block') {
    box.replaceChildren(h('div', { class: 'panel' }, h('h3', {}, x.title), h('div', { class: 'addrow' }, f('ce-s', 'Start', h('input', { id: 'ce-s', type: 'datetime-local', value: toInput(x.start, tz) })), f('ce-e', 'End', h('input', { id: 'ce-e', type: 'datetime-local', value: toInput(x.end, tz) }))),
      h('p', { class: 'addrow' }, h('button', { class: 'btn', type: 'button', onclick: () => done(async () => { const r = await svc().moveBlock(x.id, fromInput($('#ce-s').value, tz), fromInput($('#ce-e').value, tz)); if (r.warnings.length) toast(r.warnings[0]); }) }, 'Save time'),
        x.status === 'planned' ? h('button', { class: 'btn ghost', type: 'button', onclick: () => done(() => repo.updateBlock(x.id, { status: 'done' })) }, 'Mark done') : null, h('button', { class: 'btn ghost', type: 'button', onclick: () => done(() => svc().deleteBlock(x.id)) }, 'Delete block'), close), msg));
  } else {
    const ev = (await repo.listEvents()).find(e => e.id === x.event_id); if (!ev) { box.replaceChildren(h('p', { class: 'msg err' }, 'That event no longer exists.')); return; }
    const rec = !!ev.rrule, rep = !ev.rrule ? 'none' : ev.rrule.freq;
    const series = () => ({ title: $('#ce-t').value, tz: ev.tz, rrule: $('#ce-r').value === 'none' ? null : $('#ce-r').value === 'daily' ? { freq: 'daily' } : { freq: 'weekly', days: ev.rrule?.days ?? [localParts(Date.parse(ev.start_at), ev.tz).wd] } });
    box.replaceChildren(h('div', { class: 'panel' }, h('h3', {}, x.title, ' ', tag(rec ? 'Repeats' : 'One-off', 'fixed')), h('div', { class: 'addrow' }, f('ce-t', 'Title', h('input', { id: 'ce-t', type: 'text', maxlength: '120', value: ev.title })), f('ce-r', 'Repeat', h('select', { id: 'ce-r' }, ['none', 'daily', 'weekly'].map(o => h('option', { value: o, selected: o === rep }, o[0].toUpperCase() + o.slice(1)))))),
      h('div', { class: 'addrow' }, f('ce-s', rec ? 'This occurrence: start' : 'Start', h('input', { id: 'ce-s', type: 'datetime-local', value: toInput(x.start, tz) })), f('ce-e', rec ? 'This occurrence: end' : 'End', h('input', { id: 'ce-e', type: 'datetime-local', value: toInput(x.end, tz) }))),
      h('p', { class: 'addrow' },
        rec ? [h('button', { class: 'btn', type: 'button', onclick: () => done(() => svc().updateEvent(ev.id, { ...series(), start_at: ev.start_at, end_at: ev.end_at })) }, 'Save title/repeat (whole series)'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => done(() => svc().moveOccurrence(ev.id, x.date, fromInput($('#ce-s').value, tz), fromInput($('#ce-e').value, tz))) }, 'Move only this one'), h('button', { class: 'btn ghost', type: 'button', onclick: () => done(() => svc().skipOccurrence(ev.id, x.date)) }, 'Skip only this one')]
          : h('button', { class: 'btn', type: 'button', onclick: () => done(() => svc().updateEvent(ev.id, { ...series(), start_at: new Date(fromInput($('#ce-s').value, tz)).toISOString(), end_at: new Date(fromInput($('#ce-e').value, tz)).toISOString() })) }, 'Save changes'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => confirm(rec ? 'Delete this event and all its repeats?' : 'Delete this event?') && done(() => svc().deleteEvent(ev.id)) }, 'Delete event'), close), msg));
  }
}
function addForms(tz) {
  const t0 = Math.ceil(Date.now() / 36e5) * 36e5, f = (id, label, input) => h('div', {}, h('label', { for: id }, label), input), run = (fn) => async e => { e.preventDefault(); try { await fn(); calendar(); } catch (x) { note($('#af-msg'), x.message); } };
  return h('div', {}, h('details', { class: 'panel' }, h('summary', {}, 'New fixed event'), h('form', { class: 'addrow', onsubmit: run(async () => { const s = fromInput($('#nv-s').value, tz), r = $('#nv-r').value; await svc().addEvent({ title: $('#nv-t').value, start_at: new Date(s).toISOString(), end_at: new Date(fromInput($('#nv-e').value, tz)).toISOString(), tz, rrule: r === 'none' ? null : r === 'daily' ? { freq: 'daily' } : { freq: 'weekly', days: [localParts(s, tz).wd] } }); }) },
    f('nv-t', 'Title', h('input', { id: 'nv-t', type: 'text', maxlength: '120' })), f('nv-s', 'Start', h('input', { id: 'nv-s', type: 'datetime-local', value: toInput(t0, tz) })), f('nv-e', 'End', h('input', { id: 'nv-e', type: 'datetime-local', value: toInput(t0 + 36e5, tz) })), f('nv-r', 'Repeat', h('select', { id: 'nv-r' }, ['none', 'daily', 'weekly'].map(o => h('option', { value: o }, o[0].toUpperCase() + o.slice(1))))), h('button', { class: 'btn', type: 'submit' }, 'Add event'))),
    h('details', { class: 'panel' }, h('summary', {}, 'New movable block'), h('form', { class: 'addrow', onsubmit: run(async () => { await svc().addBlock({ title: $('#nb-t').value, start: fromInput($('#nb-s').value, tz), end: fromInput($('#nb-e').value, tz) }); }) },
    f('nb-t', 'Title', h('input', { id: 'nb-t', type: 'text', maxlength: '120' })), f('nb-s', 'Start', h('input', { id: 'nb-s', type: 'datetime-local', value: toInput(t0, tz) })), f('nb-e', 'End', h('input', { id: 'nb-e', type: 'datetime-local', value: toInput(t0 + 36e5, tz) })), h('button', { class: 'btn', type: 'submit' }, 'Add block'))), h('div', { id: 'af-msg', class: 'msg', role: 'status', 'aria-live': 'polite' }));
}

// ---------- AI Planner ----------
let cur = null, alts = [];
export async function planner() {
  const root = $('#plan-root'); if (!svc()) return needData(root);
  root.replaceChildren(h('form', { class: 'panel', id: 'pf', onsubmit: e => { e.preventDefault(); gen($('#pt').value); } }, h('label', { for: 'pt' }, 'Describe what you need to do'),
    h('textarea', { id: 'pt', rows: '4', maxlength: '2000', placeholder: 'e.g. Maths test on Thursday, practise drawing three times this week, Sunday music session at 3pm, work on my website' }),
    h('p', { class: 'addrow' }, h('button', { class: 'btn', type: 'submit' }, 'Generate proposal'), h('button', { class: 'btn ghost', type: 'button', onclick: recover }, 'Recover missed sessions')),
    h('p', { class: 'muted small' }, 'Uses your available hours, fixed commitments and deadlines. Nothing is saved to your schedule until you approve it.')), h('div', { id: 'plan-out' }));
  if (state.replanTaskId) { const id = state.replanTaskId; state.replanTaskId = null; run(() => svc().replanTask(id).then(p => ({ proposal: p, alternatives: [] }))); }
}
const out = () => $('#plan-out');
async function run(fn) { try { note0('Working…'); const r = await fn(); cur = r.proposal; alts = r.alternatives || []; if (r.draftError) toast('Draft not saved: ' + r.draftError); show(); } catch (e) { out().replaceChildren(h('div', { class: 'msg err', role: 'alert' }, e.message), /available hours/.test(e.message) ? h('p', {}, h('a', { href: '#/settings' }, 'Open Settings')) : null); } }
const note0 = t => out().replaceChildren(h('p', { class: 'muted' }, t));
const gen = text => run(() => svc().generateProposal(text));
const recover = () => run(async () => ({ proposal: await svc().previewRecovery() }));
function show() {
  const p = cur, tz = state.tz, byDay = new Map(); for (const b of p.blocks) { const k = fmtDay(b.start, tz); byDay.set(k, [...(byDay.get(k) || []), b]); }
  const label = p.kind === 'recovery' ? 'Missed-session recovery (rules)' : p.kind === 'replan' ? 'Re-plan after a change (rules)' : p.source === 'ai' ? 'AI-assisted: tasks were broken down by an AI model; times were placed and checked by local rules' : 'Rule-based plan: no AI was used';
  out().replaceChildren(h('div', { class: 'panel' }, h('p', {}, h('span', { class: 'tag ' + (p.source === 'ai' ? 'fixed' : '') }, p.source === 'ai' ? 'AI-assisted' : 'Rule-based'), ' ', label),
    p.aiError ? h('p', { class: 'msg err' }, `AI was unavailable (${p.aiError}). Showing the rule-based result instead.`) : null, p.aiAvailable === false ? h('p', { class: 'muted small' }, 'No AI provider is configured, so this plan uses deterministic rules only.') : null,
    p.questions?.length ? h('div', { class: 'banner' }, h('strong', {}, 'I need a little more information'), p.questions.map(q => h('p', {}, q)), h('p', { class: 'small' }, 'Add the time to your description and regenerate, or create the event on the Calendar.')) : null,
    alts.length ? h('div', { class: 'addrow' }, alts.map(a => h('button', { class: 'btn ghost', type: 'button', 'aria-pressed': String(a.proposal.settings.maxSession === cur.settings.maxSession && a.proposal.settings.breakMin === cur.settings.breakMin), onclick: () => { cur = { ...a.proposal, draft_id: cur.draft_id, text: cur.text }; show(); } }, `${a.name}: ${a.summary.sessions} sessions, ${a.summary.placedMin} min${a.summary.shortMin ? `, ${a.summary.shortMin} min short` : ''}`))) : null,
    h('h3', { class: 'eyebrow', style: 'margin-top:16px' }, 'Tasks (edit, then re-plan)'),
    h('ul', { class: 'steps' }, p.tasks.map(t => h('li', {}, h('input', { type: 'text', 'aria-label': 'Task title', value: t.title, id: `pt-${t.id}`, maxlength: '120', disabled: t.existing }), h('input', { type: 'number', 'aria-label': `Minutes for ${t.title}`, min: '5', max: '1440', value: t.est_minutes, id: `pm-${t.id}`, style: 'max-width:90px' }), t.assumptions?.length ? h('span', { class: 'small muted' }, t.assumptions[0]) : null))),
    h('p', {}, h('button', { class: 'btn ghost', type: 'button', onclick: replan }, 'Re-plan with my edits')),
    p.fixed?.length ? h('p', { class: 'small' }, 'Will also add fixed: ' + p.fixed.map(f => `${f.title} (${fmtDay(f.start, tz)} ${fmtTime(f.start, tz)})`).join(', ')) : null,
    h('h3', { class: 'eyebrow' }, 'Proposed schedule'), p.blocks.length ? [...byDay].map(([d, bs]) => h('div', {}, h('strong', {}, d), h('ul', { class: 'plain' }, bs.map(b => h('li', {}, `${fmtTime(b.start, tz)}–${fmtTime(b.end, tz)}  ${b.title}` + (b.of > 1 ? ` (${b.session}/${b.of})` : '')))))) : h('p', { class: 'muted' }, 'No sessions to place.'),
    p.unscheduled.length ? h('div', { class: 'msg err', role: 'alert' }, h('strong', {}, 'Not everything fits.'), p.unscheduled.map(u => h('p', {}, `“${u.title}”: ${u.explain}`)), h('p', { class: 'small' }, 'Options: shorten the estimate above, move the deadline, add available hours in Settings, or try the Focused plan.')) : null,
    p.validation.problems.length ? h('ul', { class: 'plain small' }, p.validation.problems.map(x => h('li', { class: x.severity === 'error' ? 'msg err' : 'muted' }, x.message))) : null,
    p.explanations?.length ? h('details', {}, h('summary', {}, 'Why this order?'), p.explanations.map(x => h('p', { class: 'small' }, x))) : null,
    h('p', { class: 'addrow' }, h('button', { class: 'btn', type: 'button', disabled: !p.validation.ok || (!p.blocks.length && !p.markMissed?.length), onclick: approve }, 'Approve & apply'), h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await svc().rejectProposal(cur); cur = null; out().replaceChildren(h('p', { class: 'msg ok' }, 'Rejected. Your schedule was not changed.')); } }, 'Reject'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => cur.kind === 'recovery' ? recover() : cur.kind === 'replan' ? note0('Open Quests to re-plan a task.') : gen(cur.text) }, 'Regenerate')), h('div', { id: 'pl-msg', class: 'msg', role: 'status' })));
}
async function replan() { const edits = {}; for (const t of cur.tasks) { const m = Number($(`#pm-${t.id}`).value), ti = $(`#pt-${t.id}`).value.trim(); edits[t.id] = { est_minutes: m, ...(t.existing ? {} : { title: ti }) }; } run(async () => ({ proposal: await svc().replanProposal(cur, edits), alternatives: [] })); }
async function approve() { try { const r = await svc().approveProposal(cur); cur = null; out().replaceChildren(h('p', { class: 'msg ok' }, `Applied: ${r.blocks} session${r.blocks === 1 ? '' : 's'}${r.tasks ? `, ${r.tasks} new quest${r.tasks === 1 ? '' : 's'}` : ''}${r.events ? `, ${r.events} fixed event${r.events === 1 ? '' : 's'}` : ''}.`), h('p', {}, h('a', { href: '#/calendar' }, 'View on the calendar'))); } catch (e) { note($('#pl-msg'), e.message); } }

// ---------- Character ----------
export async function character() {
  const root = $('#char-root'); if (!svc()) return needData(root);
  await guard(root, async () => {
    const c = await svc().character(), tz = (await repo.getProfile()).timezone || 'UTC';
    root.replaceChildren(h('div', { class: 'hero', style: 'border:0;padding-top:0' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Level'), h('h1', {}, `Level ${c.xp.level}`), h('p', { class: 'lede' }, `${c.xp.into} / ${c.xp.needed} XP to level ${c.xp.level + 1} · ${c.xp.total} XP total`), h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': c.xp.pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${c.xp.pct}%` }))),
      h('p', { class: 'muted small' }, 'XP comes from completed quests and is recorded by the server ledger.')),
      h('div', { class: 'grid' }, h('div', { class: 'col-main' }, h('h2', { class: 'eyebrow' }, 'Skills'), h('div', { class: 'skills' }, c.skills.map(s => h('div', { class: 'skill' + (s.xp ? '' : ' locked') }, h('strong', {}, s.name), h('span', { class: 'small' }, `${s.rank} · ${s.xp} XP`), h('span', { class: 'small muted' }, s.next ? `${s.next.xpNeeded} XP to ${s.next.name}` : 'Mastered')))),
        h('p', { class: 'muted small' }, 'Skills grow when completed quests are tagged with a skill.'), h('h2', { class: 'eyebrow', style: 'margin-top:24px' }, 'Completed quests'), c.completed.length ? h('ul', { class: 'plain' }, c.completed.map(t => h('li', {}, `${t.title} · ${fmtDay(Date.parse(t.completed_at), tz)}`))) : h('p', { class: 'muted' }, 'Nothing completed yet.')),
        h('aside', { class: 'col-side' }, h('h2', { class: 'eyebrow' }, 'Achievements'), h('ul', { class: 'plain' }, c.achievements.map(a => h('li', { class: a.unlocked ? '' : 'muted' }, (a.unlocked ? '★ ' : '☆ ') + a.name + (a.unlocked ? '' : ' (locked)')))),
          h('h2', { class: 'eyebrow' }, 'XP history'), c.history.length ? h('ul', { class: 'plain small' }, c.history.map(l => h('li', {}, `+${l.xp} · ${l.note ?? l.source_type}`))) : h('p', { class: 'muted' }, 'No XP yet.'))));
  })();
}

// ---------- Progress ----------
export async function progress() {
  const root = $('#prog-root'); if (!svc()) return needData(root);
  await guard(root, async () => {
    const p = await svc().progress(), max = Math.max(1, ...p.perDay.map(d => d.completed)), review = await svc().getReview(p.weekStart);
    root.replaceChildren(h('div', { class: 'grid' }, h('div', { class: 'col-main' }, h('h2', { class: 'eyebrow' }, 'Completed this week: ' + p.completed), h('div', { class: 'bars', role: 'img', 'aria-label': 'Quests completed per day' }, p.perDay.map(d => h('div', { class: 'barcol' }, h('i', { style: `height:${d.completed / max * 100}%` }), h('span', { class: 'small' }, d.date.slice(5))))),
      h('h2', { class: 'eyebrow', style: 'margin-top:24px' }, 'Planned vs completed sessions'), h('p', {}, `${p.sessions.done} done · ${p.sessions.planned} still planned · ${p.sessions.missed} missed`), h('p', { class: 'muted small' }, `${Math.round(p.minutes.done)} min done, ${Math.round(p.minutes.planned)} min planned. Time worked isn’t a measure of your worth.`),
      h('h2', { class: 'eyebrow' }, 'By category'), Object.keys(p.byCategory).length ? h('ul', { class: 'plain' }, Object.entries(p.byCategory).map(([k, v]) => h('li', {}, `${k}: ${v}`))) : h('p', { class: 'muted' }, 'No completed quests this week.')),
      h('aside', { class: 'col-side' }, h('h2', { class: 'eyebrow' }, 'Suggestions'), p.tips.length ? h('ul', { class: 'plain' }, p.tips.map(t => h('li', {}, t))) : h('p', { class: 'muted' }, 'Nothing to flag. Rest counts too.'),
        h('h2', { class: 'eyebrow' }, 'Weekly reflection'), h('label', { for: 'rv' }, 'What went well? What would you change?'), h('textarea', { id: 'rv', rows: '4', maxlength: '2000', value: review }), h('p', {}, h('button', { class: 'btn', type: 'button', onclick: async () => { try { await svc().saveReview(p.weekStart, $('#rv').value); note($('#rv-msg'), 'Saved.', true); } catch (e) { note($('#rv-msg'), e.message); } } }, 'Save reflection')), h('div', { id: 'rv-msg', class: 'msg', role: 'status' }))));
  })();
}

// ---------- Settings extras: availability + reminders ----------
const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export async function settingsExtras() {
  const root = $('#set-dyn'); if (!svc()) { needData(root); return; }
  await guard(root, async () => {
    const av = await svc().getAvailability(), rs = await svc().reminderSettings(), by = d => av.find(a => a.weekday === d);
    const row = d => { const a = by(d); return h('div', { class: 'addrow avrow' }, h('label', { class: 'check', for: `av-on-${d}` }, h('input', { id: `av-on-${d}`, type: 'checkbox', checked: !!a }), DAYN[d]), h('input', { type: 'time', id: `av-s-${d}`, 'aria-label': `${DAYN[d]} start`, value: minToInput(a?.start_min ?? 540) }), h('input', { type: 'time', id: `av-e-${d}`, 'aria-label': `${DAYN[d]} end`, value: minToInput(a?.end_min ?? 1020) })); };
    root.replaceChildren(h('div', { class: 'panel' }, h('h2', {}, 'Available hours'), h('p', { class: 'muted' }, 'The planner only places work inside these windows (your timezone). Leave a day unticked for rest.'), [1, 2, 3, 4, 5, 6, 0].map(row),
      h('p', { class: 'addrow' }, h('button', { class: 'btn', type: 'button', onclick: async () => { try { const rows = []; for (let d = 0; d < 7; d++) if ($(`#av-on-${d}`).checked) rows.push({ weekday: d, start_min: inputToMin($(`#av-s-${d}`).value), end_min: inputToMin($(`#av-e-${d}`).value) }); await svc().saveAvailability(rows); note($('#av-msg'), 'Available hours saved.', true); } catch (e) { note($('#av-msg'), e.message); } } }, 'Save available hours')), h('div', { id: 'av-msg', class: 'msg', role: 'status' })),
      h('div', { class: 'panel' }, h('h2', {}, 'Reminders'), h('p', { class: 'muted' }, 'In-app reminders appear while ShinkaLife is open. Browser notifications work while a tab or the installed app is running. Reminders when the app is closed need server push, which isn’t set up yet.'),
        h('label', { class: 'check' }, h('input', { id: 'rm-on', type: 'checkbox', checked: rs.enabled }), 'Reminders on'),
        h('div', { class: 'addrow' }, h('div', {}, h('label', { for: 'rm-lead' }, 'Remind me (minutes before)'), h('input', { id: 'rm-lead', type: 'number', min: '0', max: '1440', value: rs.lead_minutes })), h('div', {}, h('label', { for: 'rm-qs' }, 'Quiet from'), h('input', { id: 'rm-qs', type: 'time', value: minToInput(rs.quiet_start_min) })), h('div', {}, h('label', { for: 'rm-qe' }, 'Quiet until'), h('input', { id: 'rm-qe', type: 'time', value: minToInput(rs.quiet_end_min) })), h('div', {}, h('label', { for: 'rm-max' }, 'Max per day'), h('input', { id: 'rm-max', type: 'number', min: '1', max: '50', value: rs.max_per_day }))),
        h('p', { class: 'muted small' }, rs.paused_until && Date.parse(rs.paused_until) > Date.now() ? `Paused until ${new Date(rs.paused_until).toLocaleString()}.` : 'Not paused.'),
        h('p', { class: 'addrow' }, h('button', { class: 'btn', type: 'button', onclick: () => saveRem(rs, null) }, 'Save reminder settings'), h('button', { class: 'btn ghost', type: 'button', onclick: () => saveRem(rs, new Date(Date.now() + DAY).toISOString()) }, 'Pause for 24 hours'), h('button', { class: 'btn ghost', type: 'button', onclick: () => saveRem(rs, 'clear') }, 'Resume')),
        h('p', { class: 'addrow' }, h('button', { class: 'btn ghost', type: 'button', disabled: N.permission() === 'granted' || !N.supported(), onclick: async () => { const r = await N.request(); note($('#rm-msg'), r === 'granted' ? 'Browser notifications enabled.' : 'Notifications were not enabled. Reminders will still appear inside the app.', r === 'granted'); } }, N.permission() === 'granted' ? 'Browser notifications on' : 'Enable browser notifications'), h('span', { class: 'small muted' }, N.supported() ? '' : 'This browser doesn’t support notifications.')), h('div', { id: 'rm-msg', class: 'msg', role: 'status' })),
      h('div', { class: 'panel' }, h('h2', {}, 'Your data'), h('p', { class: 'addrow' }, h('button', { class: 'btn ghost', type: 'button', onclick: async () => { try { const blob = new Blob([JSON.stringify(await svc().exportAll(), null, 2)], { type: 'application/json' }), a = h('a', { href: URL.createObjectURL(blob), download: 'shinkalife-export.json' }); a.click(); URL.revokeObjectURL(a.href); } catch (e) { toast(e.message); } } }, 'Export my data (JSON)')),
        h('p', { class: 'muted small' }, 'Account deletion needs a server-side function with elevated permissions, which isn’t set up yet, so it is not offered here. See docs/ARCHITECTURE.md.')));
  })();
}
async function saveRem(rs, pause) { try { await svc().saveReminderSettings({ enabled: $('#rm-on').checked, lead_minutes: Number($('#rm-lead').value), quiet_start_min: inputToMin($('#rm-qs').value), quiet_end_min: inputToMin($('#rm-qe').value), max_per_day: Number($('#rm-max').value), paused_until: pause === 'clear' ? null : pause ?? rs.paused_until }); note($('#rm-msg'), 'Saved.', true); if (pause) settingsExtras(); } catch (e) { note($('#rm-msg'), e.message); } }

// In-app reminder ticker (only while the app is open)
const fired = new Set();
export function startTicker() {
  setInterval(async () => { if (!svc()) return; try { const d = await svc().dashboard(), now = Date.now(); for (const r of d.reminders) if (r.at <= now && now < r.start && !fired.has(r.key)) { fired.add(r.key); toast(`Starting soon: ${r.title}`); N.show('ShinkaLife', `${r.title} starts at ${fmtTime(r.start, d.tz)}`); } } catch {} }, 30000);
}
