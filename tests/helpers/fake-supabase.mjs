// A small STATEFUL fake supabase-js (auth + tables + rpc) so the REAL app.js, offline layer and Supabase repository code can run in jsdom.
// It proves our logic, not Supabase itself. log.prefReads counts only the account-load query (select 'theme'), not background cache priming.
export function installFake({ goodPassword = 'goodpass1' } = {}) {
  const listeners = [], log = { profileReads: 0, prefReads: 0, signOuts: 0, writes: [], rpcs: [] }, db = {}; let session = null, seq = 0;
  const emit = (ev, s = session) => listeners.forEach(cb => cb(ev, s)), table = t => (db[t] ||= []), ts = () => new Date(Date.now() + (++seq)).toISOString();
  const from = t => {
    let op = null, payload = null, cols = '*', single = false; const filters = [], match = r => filters.every(([c, v]) => r[c] === v);
    const run = () => { const rows = table(t);
      if (op === 'insert') { const items = [].concat(payload).map(x => ({ id: x.id ?? 'srv-' + (++seq), created_at: ts(), updated_at: ts(), ...x })); for (const it of items) { if (rows.some(r => r.id === it.id)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }; rows.unshift(it); } log.writes.push([t, 'insert', items.length]); return { data: single ? items[0] : items, error: null }; }
      if (op === 'update') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, payload, { updated_at: ts() })); log.writes.push([t, 'update', hit.length]); return { data: single ? (hit[0] ?? null) : hit, error: null }; }
      if (op === 'upsert') { const x = payload, ex = rows.find(r => r.id === x.id || (t === 'preferences' && r.user_id === x.user_id)); if (ex) Object.assign(ex, x); else rows.unshift({ id: x.id ?? 'srv-' + (++seq), ...x }); log.writes.push([t, 'upsert', 1]); return { data: null, error: null }; }
      if (op === 'delete') { const keep = rows.filter(r => !match(r)); db[t] = keep; log.writes.push([t, 'delete', rows.length - keep.length]); return { data: null, error: null }; }
      if (t === 'profiles') { log.profileReads++; return { data: single ? { display_name: 'Ada', timezone: 'Europe/London' } : [{ display_name: 'Ada', timezone: 'Europe/London' }], error: null }; }
      if (t === 'preferences') { if (cols === 'theme') log.prefReads++; const v = cols === 'theme' ? { theme: {} } : { assistant_name: null, ai_opt_in: false, ai_share_data: false, chat_history: true }; return { data: single ? v : [v], error: null }; }
      const out = rows.filter(match).map(r => ({ ...r, ...(t === 'tasks' ? { subtasks: r.subtasks || [] } : {}) })); return { data: single ? (out[0] ?? null) : out, error: null, count: out.length }; };
    const o = { select: c => { if (typeof c === 'string') cols = c; return o; }, eq: (c, v) => { filters.push([c, v]); return o; }, limit: () => o, order: () => o, gte: () => o, lt: () => o, gt: () => o,
      insert: v => { op = 'insert'; payload = v; return o; }, update: v => { op = 'update'; payload = v; return o; }, upsert: v => { op = 'upsert'; payload = v; return o; }, delete: () => { op = 'delete'; return o; },
      single: () => { single = true; return Promise.resolve(run()); }, maybeSingle: () => { single = true; return Promise.resolve(run()); }, then: (res, rej) => Promise.resolve(run()).then(res, rej) };
    return o; };
  const auth = { onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: {} } }; },
    signInWithPassword: async ({ email, password }) => { if (password !== goodPassword) return { data: {}, error: { message: 'Invalid login credentials' } }; session = { user: { id: 'u1', email } }; setTimeout(() => emit('SIGNED_IN'), 0); return { data: { session }, error: null }; },
    signUp: async () => ({ data: { user: { id: 'u2' }, session: null }, error: null }), resetPasswordForEmail: async () => ({ data: {}, error: null }), updateUser: async () => { setTimeout(() => emit('USER_UPDATED'), 0); return { data: {}, error: null }; },
    signOut: async () => { log.signOuts++; session = null; setTimeout(() => emit('SIGNED_OUT', null), 0); return { error: null }; }, getSession: async () => ({ data: { session } }) };
  const rpc = async (name, args) => { log.rpcs.push([name, args]); return args?.p_task_id === '00000000-0000-0000-0000-000000000000' ? { data: null, error: { message: 'task not found' } } : { data: { awarded: true, xp: 20, total_xp: 20, level: 1 }, error: null }; };
  globalThis.supabase = { createClient: () => ({ auth, from, rpc }) };
  return { emit, log, db, setSession: s => { session = s; } };
}
