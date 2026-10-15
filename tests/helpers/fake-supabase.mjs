// A fake supabase-js (auth + a tiny query builder) so the REAL app.js boot/auth logic can run in jsdom. Not a substitute for a live test.
export function installFake({ goodPassword = 'goodpass1' } = {}) {
  const listeners = [], log = { profileReads: 0, prefReads: 0, signOuts: 0 }; let session = null;
  const emit = (ev, s = session) => listeners.forEach(cb => cb(ev, s));
  const from = t => { const o = { select: () => o, eq: () => o, limit: () => o, order: () => o, gte: () => o, lt: () => o, gt: () => o,
    maybeSingle: async () => { if (t === 'profiles') log.profileReads++; if (t === 'preferences') log.prefReads++; return { data: t === 'profiles' ? { display_name: 'Ada', timezone: 'Europe/London' } : { theme: {} }, error: null }; },
    then: res => res({ data: [], error: null, count: 0 }) }; return o; };
  const auth = { onAuthStateChange: cb => { listeners.push(cb); return { data: { subscription: {} } }; },
    signInWithPassword: async ({ email, password }) => { if (password !== goodPassword) return { data: {}, error: { message: 'Invalid login credentials' } }; session = { user: { id: 'u1', email } }; setTimeout(() => emit('SIGNED_IN'), 0); return { data: { session }, error: null }; },
    signUp: async () => ({ data: { user: { id: 'u2' }, session: null }, error: null }), resetPasswordForEmail: async () => ({ data: {}, error: null }), updateUser: async () => { setTimeout(() => emit('USER_UPDATED'), 0); return { data: {}, error: null }; },
    signOut: async () => { log.signOuts++; session = null; setTimeout(() => emit('SIGNED_OUT', null), 0); return { error: null }; }, getSession: async () => ({ data: { session } }) };
  globalThis.supabase = { createClient: () => ({ auth, from, rpc: async () => ({ data: null, error: { message: 'task not found' } }) }) };
  return { emit, log, setSession: s => { session = s; } };
}
