// DEVELOPMENT-ONLY in-memory repository (explicitly opt-in via ?mock=1 or the setup-screen button; the UI shows a permanent banner).
// It imitates the database rules (ownership is moot, but overlap exclusion, completion stamping and the XP ledger rules are mirrored).
import { taskXp, applyDailyCap, levelFromXp } from './xp-core.js';
import { localParts, zonedToUtc, dateKey } from './recur-core.js';
const fail = m => { throw new Error(m); };
export function createMockRepo({ clock = Date.now, tz = 'UTC', seed = true } = {}) {
  let n = 0; const id = () => `mock-${++n}`, iso = () => new Date(clock()).toISOString();
  const db = { cats: [], tasks: [], subs: [], events: [], exc: [], blocks: [], avail: [], rem: null, ledger: [], ach: new Set(), drafts: [], reviews: new Map(), profile: { display_name: 'Sample user', timezone: tz } };
  const clone = x => JSON.parse(JSON.stringify(x));
  const overlap = (a, b) => Date.parse(a.start_at) < Date.parse(b.end_at) && Date.parse(b.start_at) < Date.parse(a.end_at);
  const checkBlock = (b, selfId) => { if (!(Date.parse(b.end_at) > Date.parse(b.start_at))) fail('block must end after it starts');
    if ((b.status ?? 'planned') === 'planned' && db.blocks.some(o => o.id !== selfId && o.status === 'planned' && overlap(o, b))) fail('conflicting key value violates exclusion constraint (overlapping planned block)'); };
  const stamp = (t, prev) => { if (t.status === 'done') t.completed_at = prev?.status === 'done' ? prev.completed_at : iso(); else t.completed_at = null; };
  const r = {
    kind: 'mock',
    getProfile: async () => clone(db.profile), saveProfile: async v => { Object.assign(db.profile, v); },
    listCategories: async () => clone(db.cats), addCategory: async name => { if (!name || name.length > 40) fail('invalid category name'); if (db.cats.some(c => c.name === name)) fail('duplicate category'); const c = { id: id(), name, color: null }; db.cats.push(c); return clone(c); },
    listTasks: async () => clone(db.tasks.map(t => ({ ...t, subtasks: db.subs.filter(s => s.task_id === t.id) }))).reverse(),
    addTask: async v => { if (!v.title || v.title.length > 120) fail('invalid title'); const t = { id: id(), status: 'todo', quest_type: 'side', priority: 2, notes: null, category_id: null, due_at: null, est_minutes: null, skill: null, created_at: iso(), ...v }; stamp(t); db.tasks.push(t); return clone({ ...t, subtasks: [] }); },
    updateTask: async (tid, v) => { const t = db.tasks.find(x => x.id === tid); if (!t) return; const prev = { ...t }; Object.assign(t, v); delete t.subtasks; stamp(t, prev); },
    deleteTask: async tid => { db.tasks = db.tasks.filter(t => t.id !== tid); db.subs = db.subs.filter(s => s.task_id !== tid); db.blocks = db.blocks.filter(b => b.task_id !== tid); },
    addSubtask: async (task_id, title, position) => { db.subs.push({ id: id(), task_id, title, done: false, position }); }, setSubtask: async (sid, done) => { db.subs.find(s => s.id === sid).done = done; }, deleteSubtask: async sid => { db.subs = db.subs.filter(s => s.id !== sid); },
    listEvents: async () => clone(db.events.map(e => ({ ...e, exceptions: db.exc.filter(x => x.event_id === e.id).map(({ date, action, new_start, new_end }) => ({ date, action, new_start, new_end })) }))),
    addEvent: async v => { if (!(Date.parse(v.end_at) > Date.parse(v.start_at))) fail('event must end after it starts'); const e = { id: id(), tz: 'UTC', rrule: null, ...v }; db.events.push(e); return clone(e); },
    updateEvent: async (eid, v) => { Object.assign(db.events.find(e => e.id === eid), v); }, deleteEvent: async eid => { db.events = db.events.filter(e => e.id !== eid); db.exc = db.exc.filter(x => x.event_id !== eid); },
    addException: async (event_id, date, action, new_start = null, new_end = null) => { db.exc = db.exc.filter(x => !(x.event_id === event_id && x.date === date)); db.exc.push({ event_id, date, action, new_start, new_end }); },
    listBlocks: async (f, t) => clone(db.blocks.filter(b => Date.parse(b.start_at) < Date.parse(t) && Date.parse(b.end_at) > Date.parse(f)).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))),
    addBlocks: async rows => { const snapshot = [...db.blocks], out = []; try { for (const x of rows) { const b = { id: id(), status: 'planned', source: 'manual', task_id: null, ...x }; checkBlock(b); db.blocks.push(b); out.push(b); } } catch (e) { db.blocks = snapshot; throw e; } return clone(out); },
    updateBlock: async (bid, v) => { const b = db.blocks.find(x => x.id === bid); const next = { ...b, ...v }; checkBlock(next, bid); Object.assign(b, v); }, deleteBlock: async bid => { db.blocks = db.blocks.filter(b => b.id !== bid); },
    getAvailability: async () => clone(db.avail), setAvailability: async rows => { db.avail = clone(rows); },
    getReminderSettings: async () => clone(db.rem), saveReminderSettings: async v => { db.rem = { ...db.rem, ...clone(v) }; },
    listLedger: async () => clone([...db.ledger].reverse()), listAchievements: async () => [...db.ach],
    awardTaskXp: async tid => { const t = db.tasks.find(x => x.id === tid); if (!t) fail('task not found'); if (t.status !== 'done' || !t.completed_at) fail('task is not completed');
      const total = () => db.ledger.reduce((a, l) => a + l.xp, 0);
      if (db.ledger.some(l => l.source_id === tid)) return { awarded: false, xp: 0, total_xp: total(), level: levelFromXp(total()).level };
      const today = dateKey(localParts(clock(), db.profile.timezone)), used = db.ledger.filter(l => dateKey(localParts(Date.parse(l.created_at), db.profile.timezone)) === today).reduce((a, l) => a + l.xp, 0);
      const xp = applyDailyCap(used, taskXp(t)); db.ledger.push({ id: id(), source_type: 'task', source_id: tid, xp, skill: t.skill, note: t.title.slice(0, 120), created_at: iso() });
      const cnt = db.ledger.length; if (cnt >= 1) db.ach.add('first-quest'); if (cnt >= 10) db.ach.add('ten-quests'); if (levelFromXp(total()).level >= 5) db.ach.add('level-5');
      return { awarded: true, xp, total_xp: total(), level: levelFromXp(total()).level }; },
    saveDraft: async d => { const x = { id: id(), ...clone(d) }; db.drafts.push(x); return { id: x.id }; }, updateDraft: async (did, status) => { db.drafts.find(d => d.id === did).status = status; },
    getReview: async w => db.reviews.get(w) ?? '', saveReview: async (w, notes) => { db.reviews.set(w, notes); },
    _db: db,
  };
  if (seed) { // realistic sample data, relative to "now"; clearly labelled as sample in the UI
    const p = localParts(clock(), tz), at = (dd, h, m = 0) => { const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + dd)); return new Date(zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, tz)).toISOString(); };
    db.avail = [1, 2, 3, 4, 5].map(w => ({ weekday: w, start_min: 540, end_min: 1020 })).concat([{ weekday: 6, start_min: 600, end_min: 840 }, { weekday: 0, start_min: 600, end_min: 840 }]);
    db.cats = [{ id: id(), name: 'Study', color: null }, { id: id(), name: 'Projects', color: null }, { id: id(), name: 'Creative', color: null }];
    const T = (title, extra) => { const t = { id: id(), status: 'todo', quest_type: 'side', priority: 2, notes: null, category_id: null, due_at: null, est_minutes: null, skill: null, created_at: iso(), completed_at: null, ...extra, title }; db.tasks.push(t); };
    T('Sample: Revise for maths test', { quest_type: 'main', priority: 3, due_at: at(3, 8), est_minutes: 120, category_id: db.cats[0].id, skill: 'scholar' });
    T('Sample: Sketch practice', { quest_type: 'habit', est_minutes: 45, category_id: db.cats[2].id, skill: 'artist' });
    T('Sample: Work on website', { est_minutes: 90, due_at: at(5, 23), category_id: db.cats[1].id, skill: 'builder' });
    db.events = [{ id: id(), title: 'Sample: Weekly lecture', start_at: at(1, 10), end_at: at(1, 11), tz, rrule: { freq: 'weekly' } }];
  }
  return r;
}
