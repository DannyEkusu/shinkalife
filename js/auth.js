import { CONFIG } from './config.js';
import { validateConfig } from './config-check.js';
export const configIssue = validateConfig(CONFIG);   // null when the config is valid
export const configured = !configIssue && !!globalThis.supabase;
export const sb = configured ? globalThis.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
const back = () => location.origin + location.pathname;
const run = async p => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
export const signUp = (email, password, name) => run(sb.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: back() } }));
export const signIn = (email, password) => run(sb.auth.signInWithPassword({ email, password }));
export const signOut = () => run(sb.auth.signOut());
export const sendReset = email => run(sb.auth.resetPasswordForEmail(email, { redirectTo: back() }));
export const updatePassword = password => run(sb.auth.updateUser({ password }));
export async function loadAccount(uid) {
  const [p, f] = await Promise.all([
    run(sb.from('profiles').select('display_name,timezone').eq('id', uid).maybeSingle()),
    run(sb.from('preferences').select('theme').eq('user_id', uid).maybeSingle())]);
  return { profile: p, theme: f?.theme ?? {} };
}
export const saveProfile = (uid, v) => run(sb.from('profiles').update(v).eq('id', uid));
export const saveTheme = (uid, theme) => run(sb.from('preferences').upsert({ user_id: uid, theme }, { onConflict: 'user_id' }));
