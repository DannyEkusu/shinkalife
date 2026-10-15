// Pure task logic (no DOM, no network) so it can be unit-tested. The database re-validates everything.
export const TYPES = { main: 'Main quest', side: 'Side quest', habit: 'Habit' };
export const PRIORITIES = { 1: 'Low', 2: 'Normal', 3: 'High' };

export function validateTask(t) {
  const e = [], title = String(t.title ?? '').trim(), notes = String(t.notes ?? '').trim();
  if (!title || title.length > 120) e.push('Title must be 1–120 characters.');
  if (notes.length > 2000) e.push('Notes are limited to 2000 characters.');
  if (!(t.quest_type in TYPES)) e.push('Choose a quest type.');
  const priority = Number(t.priority); if (![1, 2, 3].includes(priority)) e.push('Choose a priority.');
  const est = t.est_minutes === '' || t.est_minutes == null ? null : Number(t.est_minutes);
  if (est !== null && (!Number.isInteger(est) || est < 5 || est > 1440)) e.push('Estimate must be 5–1440 minutes.');
  let due = null;
  if (t.due_at) { const d = new Date(t.due_at); if (isNaN(d)) e.push('That due date is not valid.'); else due = d.toISOString(); }
  return { ok: !e.length, errors: e, value: { title, notes: notes || null, quest_type: t.quest_type, priority, est_minutes: est, due_at: due, category_id: t.category_id || null } };
}

export function dueState(t, now = new Date()) {
  if (t.status === 'done' || !t.due_at) return 'none';
  const d = new Date(t.due_at), end = new Date(now); end.setHours(23, 59, 59, 999);
  if (d < now) return 'past'; if (d <= end) return 'today'; return d - now <= 3 * 864e5 ? 'soon' : 'later';
}

export function filterTasks(tasks, { q = '', status = 'active', category = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return tasks.filter(t => (status === 'all' || (status === 'done') === (t.status === 'done'))
    && (!category || t.category_id === category) && (!needle || (t.title + ' ' + (t.notes ?? '')).toLowerCase().includes(needle)));
}

export function sortTasks(tasks) {
  const k = t => (t.due_at ? new Date(t.due_at).getTime() : Infinity);
  return [...tasks].sort((a, b) => (a.status === 'done') - (b.status === 'done') || k(a) - k(b) || b.priority - a.priority || (a.created_at < b.created_at ? 1 : -1));
}
export const subtaskProgress = t => { const s = t.subtasks ?? []; return { done: s.filter(x => x.done).length, total: s.length }; };
