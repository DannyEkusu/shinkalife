// Pure validation of the browser config. Refuses privileged keys so they can never be used (or committed) by accident.
const decode = s => { try { return JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };
export function validateConfig(c) {
  const url = String(c?.SUPABASE_URL ?? '').trim(), key = String(c?.SUPABASE_ANON_KEY ?? '').trim();
  if (!url && !key) return 'Supabase is not configured yet.';
  if (!/^https:\/\/[a-z0-9]{10,30}\.supabase\.co$/.test(url)) return 'SUPABASE_URL must look like https://<project-ref>.supabase.co (https, no trailing slash, no path).';
  if (!key) return 'The publishable key is missing from js/config.js.';
  if (/^sb_secret_/.test(key)) return 'That is a SECRET key. Never use it in browser code. Use the publishable key (sb_publishable_...).';
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) return null;
  const parts = key.split('.');
  if (parts.length === 3) { const role = decode(parts[1])?.role; if (role === 'service_role') return 'That is a service_role key. Never use it in browser code.'; if (role === 'anon') return null; }
  return 'The key is not recognised as a publishable key (sb_publishable_...) or a legacy anon key.';
}
