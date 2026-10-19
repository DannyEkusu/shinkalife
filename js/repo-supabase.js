import { sb } from './auth.js';
const run = async p => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
const TASK = '*, subtasks(id,title,done,position)';
const patchOnly = (t, id, v) => run(sb.from(t).update(v).eq('id', id));
export const supabaseRepo = {
  getProfile: () => run(sb.from('profiles').select('display_name,timezone').maybeSingle()),
  saveProfile: v => run(sb.from('profiles').update(v).eq('id', v.id ?? undefined)),
  listCategories: () => run(sb.from('categories').select('id,name,color').order('name')),
  addCategory: (name, id) => run(sb.from('categories').insert({ ...(id ? { id } : {}), name }).select('id,name,color').single()),
  listTasks: () => run(sb.from('tasks').select(TASK).order('created_at', { ascending: false }).limit(500)),
  addTask: v => run(sb.from('tasks').insert(v).select(TASK).single()),
  updateTask: (id, v) => run(sb.from('tasks').update(v).eq('id', id).select('updated_at').maybeSingle()),   // returns { updated_at } (null if the row is gone)
  async updateTaskIf(id, v, base) { const r = await run(sb.from('tasks').update(v).eq('id', id).eq('updated_at', base).select('updated_at').maybeSingle()); return r ? { ok: true, updated_at: r.updated_at } : { ok: false }; },   // optimistic concurrency: only if nobody changed it since `base`
  deleteTask: id => run(sb.from('tasks').delete().eq('id', id)),
  addSubtask: (task_id, title, position, id) => run(sb.from('subtasks').insert({ ...(id ? { id } : {}), task_id, title, position })),
  setSubtask: (id, done) => patchOnly('subtasks', id, { done }),
  deleteSubtask: id => run(sb.from('subtasks').delete().eq('id', id)),
  async listEvents() { const rows = await run(sb.from('events').select('*, event_exceptions(occurrence_date,action,new_start,new_end)').limit(500));
    return rows.map(({ event_exceptions, ...e }) => ({ ...e, exceptions: (event_exceptions || []).map(x => ({ date: x.occurrence_date, action: x.action, new_start: x.new_start, new_end: x.new_end })) })); },
  addEvent: v => run(sb.from('events').insert(v).select().single()),
  updateEvent: (id, v) => patchOnly('events', id, v),
  deleteEvent: id => run(sb.from('events').delete().eq('id', id)),
  addException: (event_id, occurrence_date, action, new_start = null, new_end = null) => run(sb.from('event_exceptions').upsert({ event_id, occurrence_date, action, new_start, new_end }, { onConflict: 'event_id,occurrence_date' })),
  listBlocks: (fromIso, toIso) => run(sb.from('schedule_blocks').select('*').lt('start_at', toIso).gt('end_at', fromIso).order('start_at')),
  addBlocks: rows => run(sb.from('schedule_blocks').insert(rows).select()),
  updateBlock: (id, v) => patchOnly('schedule_blocks', id, v),
  deleteBlock: id => run(sb.from('schedule_blocks').delete().eq('id', id)),
  getAvailability: () => run(sb.from('availability').select('weekday,start_min,end_min').order('weekday').order('start_min')),
  async setAvailability(rows) { await run(sb.from('availability').delete().gte('weekday', 0)); if (rows.length) await run(sb.from('availability').insert(rows)); }, // not atomic: re-save if it fails midway
  getReminderSettings: () => run(sb.from('reminder_settings').select('*').maybeSingle()),
  saveReminderSettings: v => run(sb.from('reminder_settings').upsert(v, { onConflict: 'user_id' })),
  listLedger: () => run(sb.from('xp_ledger').select('id,xp,skill,note,created_at,source_type,source_id').order('created_at', { ascending: false }).limit(500)),
  async listAchievements() { return (await run(sb.from('achievements_unlocked').select('key'))).map(r => r.key); },
  awardTaskXp: id => run(sb.rpc('award_task_xp', { p_task_id: id })),   // the ONLY way XP is written; enforced by the database
  saveDraft: d => run(sb.from('planner_drafts').insert(d).select('id').single()),
  updateDraft: (id, status) => patchOnly('planner_drafts', id, { status }),
  async getReview(week) { return (await run(sb.from('weekly_reviews').select('notes').eq('week_start', week).maybeSingle()))?.notes ?? ''; },
  saveReview: (week_start, notes) => run(sb.from('weekly_reviews').upsert({ week_start, notes }, { onConflict: 'user_id,week_start' })),
  // assistant name + AI opt-in live in the existing `preferences` row (owner-only RLS); only the changed columns are sent
  async getAssistantPrefs() {   // works before AND after migration 0007 (falls back to the older columns if the new ones don't exist yet)
    const base = { assistant_name: null, ai_opt_in: false, ai_share_data: false, chat_history: true };
    try { return { ...base, ...(await run(sb.from('preferences').select('assistant_name,ai_opt_in,ai_share_data,chat_history').maybeSingle())) }; }
    catch (e) { if (!/does not exist|could not find/i.test(e.message)) throw e; return { ...base, ...(await run(sb.from('preferences').select('assistant_name,ai_opt_in').maybeSingle())) }; } },
  saveAssistantPrefs: v => run(sb.from('preferences').upsert(v, { onConflict: 'user_id' })),
  listReminders: () => run(sb.from('reminders').select('*').order('remind_at').limit(500)),
  addReminder: v => run(sb.from('reminders').insert(v).select().single()),   // v.id may be supplied by the client so retries are idempotent
  updateReminder: (id, v) => patchOnly('reminders', id, v),
  deleteReminder: id => run(sb.from('reminders').delete().eq('id', id)),
  listMessages: (limit = 60) => run(sb.from('assistant_messages').select('id,role,source,content,created_at').order('created_at', { ascending: false }).limit(limit)).then(r => r.reverse()),
  addMessage: v => run(sb.from('assistant_messages').insert(v)),
  clearMessages: () => run(sb.from('assistant_messages').delete().gte('created_at', '1970-01-01')),
};
