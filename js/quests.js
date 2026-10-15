import { repo as D } from './repo.js';
import { state } from './state.js';
import { TYPES, PRIORITIES, validateTask, dueState, filterTasks, sortTasks, subtaskProgress } from './tasks-core.js';
const $ = s => document.querySelector(s);
let tasks = [], cats = [], open = null, ready = false, flash = '';
const f = { q: '', status: 'active', category: '' };

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el[k] = v; else if (k === 'class') el.className = v;
    else if (k === 'checked' || k === 'value') el[k] = v; else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter(x => x != null && x !== false)); return el;
}
const msg = (t, ok) => { const m = $('#q-msg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); };
const local = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const when = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const opts = (obj, cur) => Object.entries(obj).map(([v, l]) => h('option', { value: v }, l)).map(o => (o.selected = o.value === String(cur), o));
const catSelect = (id, cur) => h('select', { id }, h('option', { value: '' }, 'No category'), cats.map(c => { const o = h('option', { value: c.id }, c.name); o.selected = c.id === cur; return o; }));

async function refresh() {
  try { [tasks, cats] = await Promise.all([D.listTasks(), D.listCategories()]); msg(flash, true); flash = ''; }
  catch (e) { msg('Could not load quests: ' + e.message); }
  render();
}
const guard = async fn => { try { await fn(); await refresh(); } catch (e) { msg(e.message); } };

function render() {
  const fill = (id, label, cur) => { const s = $(id); s.replaceChildren(h('option', { value: '' }, label), ...cats.map(c => { const o = h('option', { value: c.id }, c.name); o.selected = c.id === cur; return o; })); };
  fill('#q-cat', 'No category', $('#q-cat').value); fill('#qf-cat', 'All categories', f.category);
  const list = sortTasks(filterTasks(tasks, f)), el = $('#q-list');
  $('#q-empty').hidden = list.length > 0;
  $('#q-empty').textContent = tasks.length ? 'No quests match these filters.' : 'No quests yet. Add your first one above. A single small step is a fine start.';
  el.replaceChildren(...list.map(card));
}

function card(t) {
  const ds = dueState(t), sp = subtaskProgress(t), cat = cats.find(c => c.id === t.category_id);
  const meta = [PRIORITIES[t.priority] + ' priority', t.due_at && (ds === 'past' ? 'Past due · ' : 'Due ') + when(t.due_at), t.est_minutes && `~${t.est_minutes} min`, cat?.name, sp.total && `${sp.done}/${sp.total} steps`].filter(Boolean).join('  ·  ');
  const li = h('li', { class: `q q-${t.quest_type}${t.status === 'done' ? ' done' : ''}` },
    h('div', { class: 'q-head' },
      h('input', { type: 'checkbox', checked: t.status === 'done', 'aria-label': `Mark “${t.title}” ${t.status === 'done' ? 'not done' : 'done'}`,
        onchange: e => { e.target.closest('li').classList.add('pop'); setTimeout(() => guard(async () => { const r = await state.svc.setTaskDone(t.id, t.status !== 'done'); flash = r.award?.awarded ? `+${r.award.xp} XP earned.` : r.awardError ? `Completed. XP could not be recorded yet (${r.awardError}); it will be retried.` : ''; }), 300); } }),
      h('button', { class: 'q-title', type: 'button', 'aria-expanded': String(open === t.id), onclick: () => { open = open === t.id ? null : t.id; render(); } }, t.title),
      h('span', { class: 'tag' }, TYPES[t.quest_type])),
    h('p', { class: `q-meta small ${ds === 'past' ? 'due-past' : 'muted'}` }, meta));
  if (open === t.id) li.append(editor(t)); return li;
}

function editor(t) {
  const id = k => `e-${k}`, g = k => $('#' + id(k)).value;
  const row = (label, input, k) => h('div', {}, h('label', { for: id(k) }, label), input);
  const subs = [...(t.subtasks ?? [])].sort((a, b) => a.position - b.position);
  return h('div', { class: 'q-edit' },
    h('div', { class: 'addrow' }, row('Title', h('input', { id: id('title'), type: 'text', maxlength: '120', value: t.title }), 'title'),
      row('Type', h('select', { id: id('type') }, opts(TYPES, t.quest_type)), 'type'), row('Priority', h('select', { id: id('pri') }, opts(PRIORITIES, t.priority)), 'pri')),
    h('div', { class: 'addrow' }, row('Due', h('input', { id: id('due'), type: 'datetime-local', value: local(t.due_at) }), 'due'),
      row('Estimate (min)', h('input', { id: id('est'), type: 'number', min: '5', max: '1440', value: t.est_minutes ?? '' }), 'est'), row('Category', catSelect(id('cat'), t.category_id), 'cat')),
    row('Notes', h('textarea', { id: id('notes'), rows: '3', maxlength: '2000', value: t.notes ?? '' }), 'notes'),
    h('h3', { class: 'eyebrow', style: 'margin-top:16px' }, 'Steps'),
    h('ul', { class: 'steps' }, subs.map(s => h('li', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.done, onchange: () => guard(() => D.setSubtask(s.id, !s.done)) }), s.title),
      h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Remove step ${s.title}`, onclick: () => guard(() => D.deleteSubtask(s.id)) }, 'Remove')))),
    h('form', { class: 'addrow', onsubmit: e => { e.preventDefault(); const v = $('#e-step').value.trim(); if (v) guard(() => D.addSubtask(t.id, v.slice(0, 120), subs.length)); } },
      h('div', {}, h('label', { for: 'e-step' }, 'Add a step'), h('input', { id: 'e-step', type: 'text', maxlength: '120' })), h('button', { class: 'btn ghost', type: 'submit' }, 'Add step')),
    h('p', { class: 'addrow', style: 'margin-top:16px' },
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const r = validateTask({ title: g('title'), notes: g('notes'), quest_type: g('type'), priority: g('pri'), due_at: g('due'), est_minutes: g('est'), category_id: g('cat') });
        if (!r.ok) return msg(r.errors.join(' ')); guard(async () => { const rv = await state.svc.updateTask(t.id, r.value); state.replanTaskId = rv.needsReplan ? t.id : null; flash = rv.needsReplan ? 'Saved. Scheduled sessions no longer fit this deadline: open the Planner to review a new plan.' : 'Saved.'; }); } }, 'Save changes'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { if (confirm(`Delete “${t.title}”? This can’t be undone.`)) { open = null; guard(() => D.deleteTask(t.id)); } } }, 'Delete quest')));
}

function wire() {
  $('#q-add').onsubmit = e => { e.preventDefault();
    const r = validateTask({ title: $('#q-title').value, quest_type: $('#q-type').value, priority: $('#q-pri').value, due_at: $('#q-due').value, est_minutes: $('#q-est').value, category_id: $('#q-cat').value });
    if (!r.ok) return msg(r.errors.join(' '));
    guard(async () => { await D.addTask(r.value); $('#q-title').value = ''; $('#q-due').value = ''; $('#q-est').value = ''; msg('Quest added.', true); }); };
  $('#q-newcat').onclick = () => { const n = $('#q-catname').value.trim(); if (!n || n.length > 40) return msg('Category names are 1–40 characters.');
    guard(async () => { await D.addCategory(n); $('#q-catname').value = ''; }); };
  $('#qf-q').oninput = e => { f.q = e.target.value; render(); };
  $('#qf-status').onchange = e => { f.status = e.target.value; render(); };
  $('#qf-cat').onchange = e => { f.category = e.target.value; render(); };
}
export function show(user) {
  $('#q-guest').hidden = !!user; $('#q-app').hidden = !user; if (!user) return;
  if (!ready) { wire(); ready = true; } refresh();
}
export function reset() { tasks = []; cats = []; open = null; }
