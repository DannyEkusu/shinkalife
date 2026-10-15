import test from 'node:test'; import assert from 'node:assert/strict';
import { validateTask, dueState, filterTasks, sortTasks, subtaskProgress } from '../js/tasks-core.js';
const base = { title: ' Study ', quest_type: 'main', priority: '3', due_at: '', est_minutes: '', category_id: '' };
test('valid task is trimmed and normalised', () => { const r = validateTask(base); assert.ok(r.ok); assert.equal(r.value.title, 'Study'); assert.equal(r.value.priority, 3); assert.equal(r.value.due_at, null); assert.equal(r.value.est_minutes, null); assert.equal(r.value.category_id, null); });
test('rejects bad input', () => { for (const bad of [{ title: '' }, { title: 'x'.repeat(121) }, { quest_type: 'epic' }, { priority: 7 }, { est_minutes: 2 }, { est_minutes: 2000 }, { est_minutes: 7.5 }, { due_at: 'not a date' }, { notes: 'n'.repeat(2001) }]) assert.equal(validateTask({ ...base, ...bad }).ok, false, JSON.stringify(bad)); });
test('due states', () => { const now = new Date('2026-10-13T12:00:00'); const d = s => ({ status: 'todo', due_at: s });
  assert.equal(dueState(d('2026-10-12T09:00:00'), now), 'past'); assert.equal(dueState(d('2026-10-13T18:00:00'), now), 'today'); assert.equal(dueState(d('2026-10-15T09:00:00'), now), 'soon');
  assert.equal(dueState(d('2026-11-01T09:00:00'), now), 'later'); assert.equal(dueState({ status: 'done', due_at: '2020-01-01' }, now), 'none'); assert.equal(dueState({ status: 'todo' }, now), 'none'); });
const T = [{ id: 1, title: 'Maths', status: 'todo', priority: 2, due_at: '2026-10-20T10:00:00Z', category_id: 'a', created_at: '1' }, { id: 2, title: 'Draw', notes: 'practice', status: 'todo', priority: 3, due_at: null, category_id: 'b', created_at: '2' },
  { id: 3, title: 'Old', status: 'done', priority: 1, due_at: '2026-10-01T10:00:00Z', created_at: '0' }, { id: 4, title: 'Soon', status: 'todo', priority: 1, due_at: '2026-10-14T10:00:00Z', created_at: '3' }];
test('filters', () => { assert.deepEqual(filterTasks(T, {}).map(t => t.id), [1, 2, 4]); assert.deepEqual(filterTasks(T, { status: 'done' }).map(t => t.id), [3]); assert.equal(filterTasks(T, { status: 'all' }).length, 4);
  assert.deepEqual(filterTasks(T, { q: 'PRACTICE' }).map(t => t.id), [2]); assert.deepEqual(filterTasks(T, { category: 'a' }).map(t => t.id), [1]); });
test('sort: active first, earliest due first, undated last, then priority', () => { assert.deepEqual(sortTasks(T).map(t => t.id), [4, 1, 2, 3]); });
test('subtask progress', () => { assert.deepEqual(subtaskProgress({ subtasks: [{ done: true }, { done: false }] }), { done: 1, total: 2 }); assert.deepEqual(subtaskProgress({}), { done: 0, total: 0 }); });
