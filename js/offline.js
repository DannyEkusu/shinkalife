// Offline-first wrapper around the real repository (same interface, so pages and service are unchanged).
//  * Reads: network first; on failure the per-user local copy is returned (marked offline). Pending changes are layered on top.
//  * Writes that are safe to replay (quests, steps, categories, reminders, XP claims, preferences) are queued with CLIENT-GENERATED ids,
//    so retries can never create duplicates. Writes that need live server checks (calendar, schedule blocks, availability...) stay online-only.
//  * Task edits use optimistic concurrency: if the task changed on another device meanwhile, your offline edit is NOT applied and is
//    listed as a conflict you can keep or discard. The database (RLS, constraints, XP function) remains the authority.
export const NEEDS_NET = 'This needs an internet connection.';
const MISSING = 'You’re offline, and this hasn’t been saved on this device yet.';
const NET = /failed to fetch|networkerror|network request failed|fetch failed|load failed|timed? ?out|econn|enotfound/i;   // real fetch-failure wording only (Chrome, Firefox, Safari, Node)
export const isNetworkError = e => NET.test(String(e?.message ?? e));
const isAuthError = e => /jwt|not authenticated|invalid (token|refresh)|sign in again/i.test(String(e?.message ?? e));
const isDuplicate = e => /duplicate key|already exists/i.test(String(e?.message ?? e));
const clone = x => JSON.parse(JSON.stringify(x));
const uuid = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

export function applyOp(s, op, nowIso) {   // pure: how a queued change looks in the local copy
  const T = id => s.tasks?.find(t => t.id === id);
  switch (op.type) {
    case 'task.add': if (s.tasks && !T(op.id)) s.tasks.unshift({ id: op.id, status: 'todo', quest_type: 'side', priority: 2, notes: null, category_id: null, due_at: null, est_minutes: null, skill: null, created_at: nowIso, completed_at: null, ...op.values, subtasks: [] }); break;
    case 'task.update': { const t = T(op.id); if (t) { Object.assign(t, op.patch); if (op.patch.status) t.completed_at = op.patch.status === 'done' ? (t.completed_at || nowIso) : null; } break; }
    case 'task.delete': if (s.tasks) s.tasks = s.tasks.filter(t => t.id !== op.id); break;
    case 'subtask.add': { const t = T(op.task_id); if (t && !(t.subtasks ||= []).some(x => x.id === op.id)) t.subtasks.push({ id: op.id, title: op.title, done: false, position: op.position }); break; }
    case 'subtask.set': for (const t of s.tasks || []) for (const x of t.subtasks || []) if (x.id === op.id) x.done = op.done; break;
    case 'subtask.delete': for (const t of s.tasks || []) t.subtasks = (t.subtasks || []).filter(x => x.id !== op.id); break;
    case 'category.add': if (s.categories && !s.categories.some(c => c.id === op.id)) s.categories.push({ id: op.id, name: op.name, color: null }); break;
    case 'reminder.add': if (s.reminders && !s.reminders.some(r => r.id === op.id)) s.reminders.push({ status: 'active', skip_until: null, snoozed_until: null, notes: null, task_id: null, rrule: null, created_at: nowIso, ...op.values, id: op.id }); break;
    case 'reminder.update': { const r = s.reminders?.find(r => r.id === op.id); if (r) Object.assign(r, op.patch); break; }
    case 'reminder.delete': if (s.reminders) s.reminders = s.reminders.filter(r => r.id !== op.id); break;
  }
}
export const describeOp = op => ({ 'task.add': `Add quest “${op.values?.title}”`, 'task.update': 'Edit a quest', 'task.delete': 'Delete a quest', 'subtask.add': `Add step “${op.title}”`, 'subtask.set': 'Tick a step', 'subtask.delete': 'Remove a step', 'category.add': `Add category “${op.name}”`,
  'reminder.add': `Add reminder “${op.values?.title}”`, 'reminder.update': 'Change a reminder', 'reminder.delete': 'Delete a reminder', 'xp.claim': 'Record XP for a completed quest', prefs: 'Save assistant settings', remsettings: 'Save reminder settings' }[op.type] || op.type);

export function createOfflineRepo({ inner, store, userId, isOnline = () => globalThis.navigator?.onLine !== false, clock = Date.now, newId = uuid, autoSync = true }) {
  const K = n => `${userId}:${n}`, nowIso = () => new Date(clock()).toISOString(), subs = new Set();
  let queue = [], failed = [], conflicts = [], snap = { tasks: null, reminders: null, categories: null }, cache = {}, blocks = null, loaded = false, syncing = null, netDown = false, lastError = null, lastSync = null, storageError = null;
  const state = () => ({ status: syncing ? 'syncing' : (!isOnline() || netDown) ? 'offline' : (failed.length || conflicts.length || lastError) ? 'error' : 'online', pending: queue.length, failed: clone(failed), conflicts: clone(conflicts), queue: queue.map(o => ({ qid: o.qid, text: describeOp(o) })), storage: store.mode, storageError, lastSync, lastError });
  const emit = () => subs.forEach(f => { try { f(state()); } catch { /* a listener must never break syncing */ } });
  const put = async (n, v) => { try { await store.set(K(n), v); storageError = null; } catch (e) { storageError = e?.message || 'Could not save on this device'; } };
  const persist = async () => { await put('queue', queue); await put('failed', failed); await put('conflicts', conflicts); await put('snap', snap); await put('cache', cache); await put('blocks', blocks); };
  async function load() { if (loaded) return; queue = (await store.get(K('queue'))) || []; failed = (await store.get(K('failed'))) || []; conflicts = (await store.get(K('conflicts'))) || []; snap = (await store.get(K('snap'))) || snap; cache = (await store.get(K('cache'))) || {}; blocks = (await store.get(K('blocks'))) || null; loaded = true; }
  const down = () => { netDown = true; emit(); };
  const withPending = col => { const s = clone(snap); for (const op of queue) applyOp(s, op, nowIso()); return s[col]; };

  async function readCol(col, fetcher) {
    await load();
    if (isOnline()) { try { snap[col] = await fetcher(); netDown = false; await put('snap', snap); emit(); return clone(withPending(col)); } catch (e) { if (!isNetworkError(e)) throw e; down(); } }
    if (snap[col] == null) throw new Error(MISSING); return clone(withPending(col));
  }
  async function readKeyed(name, args, fetcher, overlayTypes) {
    await load(); const key = name + JSON.stringify(args); let data, have = false;
    if (isOnline()) { try { data = await fetcher(); cache[key] = data; netDown = false; await put('cache', cache); emit(); have = true; } catch (e) { if (!isNetworkError(e)) throw e; down(); } }
    if (!have) { if (!(key in cache)) throw new Error(MISSING); data = cache[key]; }
    data = clone(data); if (overlayTypes) for (const op of queue) if (op.type === overlayTypes) data = { ...(data || {}), ...(op.patch || op.values) }; return data;
  }
  async function readBlocks(from, to) {
    await load(); const f = Date.parse(from), t = Date.parse(to), hit = b => Date.parse(b.start_at) < t && Date.parse(b.end_at) > f;
    if (isOnline()) { try { const fresh = await inner.listBlocks(from, to); blocks = [...(blocks || []).filter(b => !hit(b)), ...fresh]; netDown = false; await put('blocks', blocks); emit(); return clone(fresh); } catch (e) { if (!isNetworkError(e)) throw e; down(); } }
    if (!blocks) throw new Error(MISSING); return clone(blocks.filter(hit).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)));
  }

  const conflictErr = msg => Object.assign(new Error(msg), { conflict: true });
  async function runOp(op) {
    const dupOk = async fn => { try { return await fn(); } catch (e) { if (!isDuplicate(e)) throw e; } };   // replay of something that already succeeded = success
    switch (op.type) {
      case 'task.add': return dupOk(() => inner.addTask({ id: op.id, ...op.values }));
      case 'task.update': { if (!op.base) return inner.updateTask(op.id, op.patch); const r = await inner.updateTaskIf(op.id, op.patch, op.base); if (!r.ok) throw conflictErr('This quest was changed on another device (or deleted) after you edited it offline.'); return r; }
      case 'task.delete': return inner.deleteTask(op.id);
      case 'subtask.add': return dupOk(() => inner.addSubtask(op.task_id, op.title, op.position, op.id));
      case 'subtask.set': return inner.setSubtask(op.id, op.done); case 'subtask.delete': return inner.deleteSubtask(op.id);
      case 'category.add': return dupOk(() => inner.addCategory(op.name, op.id));
      case 'reminder.add': return dupOk(() => inner.addReminder({ id: op.id, ...op.values })); case 'reminder.update': return inner.updateReminder(op.id, op.patch); case 'reminder.delete': return inner.deleteReminder(op.id);
      case 'xp.claim': return inner.awardTaskXp(op.task_id);      // idempotent on the server: one reward per task, ever
      case 'prefs': return inner.saveAssistantPrefs(op.patch); case 'remsettings': return inner.saveReminderSettings(op.values);
    }
    throw new Error('Unknown queued change: ' + op.type);
  }
  function commit(op, res) { applyOp(snap, op, nowIso()); if (op.type === 'task.update' && res?.updated_at) { const t = snap.tasks?.find(x => x.id === op.id); if (t) t.updated_at = res.updated_at; } }

  async function enqueue(op) {
    await load(); op.qid = newId(); op.at = clock();
    if (isOnline() && !queue.length && !syncing) {
      try { const res = await runOp(op); commit(op, res); netDown = false; await persist(); emit(); return { direct: true, res }; }
      catch (e) { if (!isNetworkError(e)) throw e.conflict ? new Error('This quest was changed on another device. Reload to see the latest version.') : e; down(); }
    }
    queue.push(op); await persist(); emit(); if (autoSync && isOnline()) sync().catch(() => {}); return { queued: true };
  }
  async function sync() {
    await load(); if (syncing) return syncing; if (!isOnline() || !queue.length) { emit(); return { applied: 0 }; }
    syncing = (async () => { let applied = 0; emit();
      try {
        while (queue.length) {
          const op = queue[0];
          try { const res = await runOp(op); if (op.type === 'task.update' && res?.updated_at) for (const o of queue) if (o !== op && o.type === 'task.update' && o.id === op.id) o.base = res.updated_at; commit(op, res); queue.shift(); applied++; lastError = null; netDown = false; }
          catch (e) {
            if (!e.conflict && isNetworkError(e)) { netDown = true; break; }      // conflicts are checked first: their wording must never be mistaken for a network error
            if (!e.conflict && isAuthError(e)) { lastError = 'Please sign in again to sync your changes. They are saved on this device.'; break; }
            queue.shift(); if (e.conflict) conflicts.push({ id: op.qid, op: clone(op), text: describeOp(op), message: e.message }); else failed.push({ id: op.qid, op: clone(op), text: describeOp(op), message: e.message });
          }
          await persist(); emit();
        }
        if (!queue.length) { lastSync = clock(); if (!failed.length && !conflicts.length) lastError = null; }
      } finally { await persist(); syncing = null; emit(); }
      return { applied }; })();
    return syncing;
  }

  const taskBase = id => { const pend = queue.find(o => o.type === 'task.update' && o.id === id); return pend ? pend.base : snap.tasks?.find(t => t.id === id)?.updated_at; };
  const onlineOnly = name => async (...a) => { if (!isOnline()) throw new Error(NEEDS_NET); try { return await inner[name](...a); } catch (e) { if (isNetworkError(e)) { down(); throw new Error(NEEDS_NET); } throw e; } };
  const repo = {
    kind: inner.kind || 'supabase',
    listTasks: () => readCol('tasks', () => inner.listTasks()), listReminders: () => readCol('reminders', () => inner.listReminders()), listCategories: () => readCol('categories', () => inner.listCategories()),
    getProfile: () => readKeyed('getProfile', [], () => inner.getProfile()), listEvents: () => readKeyed('listEvents', [], () => inner.listEvents()), getAvailability: () => readKeyed('getAvailability', [], () => inner.getAvailability()),
    getReminderSettings: () => readKeyed('getReminderSettings', [], () => inner.getReminderSettings(), 'remsettings'), getAssistantPrefs: () => readKeyed('getAssistantPrefs', [], () => inner.getAssistantPrefs(), 'prefs'),
    listLedger: () => readKeyed('listLedger', [], () => inner.listLedger()), listAchievements: () => readKeyed('listAchievements', [], () => inner.listAchievements()), getReview: w => readKeyed('getReview', [w], () => inner.getReview(w)),
    listMessages: n => readKeyed('listMessages', [n], () => inner.listMessages(n)), listBlocks: readBlocks,
    async addTask(v) { const id = newId(), r = await enqueue({ type: 'task.add', id, values: v }); return r.direct && r.res ? r.res : { id, status: 'todo', ...v, subtasks: [] }; },
    async updateTask(id, patch) { const r = await enqueue({ type: 'task.update', id, patch, base: taskBase(id) }); return r.direct ? r.res : null; },
    async deleteTask(id) { await enqueue({ type: 'task.delete', id }); },
    async addSubtask(task_id, title, position) { await enqueue({ type: 'subtask.add', id: newId(), task_id, title, position }); },
    async setSubtask(id, done) { await enqueue({ type: 'subtask.set', id, done }); }, async deleteSubtask(id) { await enqueue({ type: 'subtask.delete', id }); },
    async addCategory(name) { const id = newId(); const r = await enqueue({ type: 'category.add', id, name }); return r.direct && r.res ? r.res : { id, name, color: null }; },
    async addReminder(v) { const id = newId(), r = await enqueue({ type: 'reminder.add', id, values: v }); return r.direct && r.res ? r.res : { id, status: 'active', skip_until: null, snoozed_until: null, ...v }; },
    async updateReminder(id, patch) { await enqueue({ type: 'reminder.update', id, patch }); }, async deleteReminder(id) { await enqueue({ type: 'reminder.delete', id }); },
    async awardTaskXp(task_id) { const r = await enqueue({ type: 'xp.claim', task_id }); return r.direct ? r.res : { awarded: false, queued: true, xp: 0, total_xp: null, level: null }; },
    async saveAssistantPrefs(patch) { await enqueue({ type: 'prefs', patch }); }, async saveReminderSettings(values) { await enqueue({ type: 'remsettings', values }); },
  };
  for (const n of ['saveProfile', 'addEvent', 'updateEvent', 'deleteEvent', 'addException', 'addBlocks', 'updateBlock', 'deleteBlock', 'setAvailability', 'saveDraft', 'updateDraft', 'saveReview', 'addMessage', 'clearMessages']) repo[n] = onlineOnly(n);
  return { repo, sync, state, subscribe: f => { subs.add(f); return () => subs.delete(f); }, notifyOnline: () => { netDown = false; emit(); if (autoSync) sync().catch(() => {}); }, notifyOffline: () => emit(),
    async retryFailed() { await load(); queue.push(...failed.map(f => f.op)); failed = []; await persist(); emit(); return sync(); },
    async discardFailed() { await load(); failed = []; await persist(); emit(); },
    async resolveConflict(id, keepMine) { await load(); const c = conflicts.find(x => x.id === id); if (!c) return; if (keepMine) { if (!isOnline()) throw new Error(NEEDS_NET); await inner.updateTask(c.op.id, c.op.patch); } conflicts = conflicts.filter(x => x.id !== id); await persist(); emit(); },
    async wipe() { for (const k of await store.keys()) if (String(k).startsWith(userId + ':')) await store.del(k); queue = []; failed = []; conflicts = []; snap = { tasks: null, reminders: null, categories: null }; cache = {}; blocks = null; loaded = true; emit(); },
    async load() { await load(); emit(); } };
}
