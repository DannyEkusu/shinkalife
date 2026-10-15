// PUBLIC browser configuration. Safe to commit ONLY because every table has Row Level Security.
// The publishable key identifies your project; it is NOT a password and grants no extra permissions.
// NEVER put a service_role key, an sb_secret_ key, a database password or an AI provider key in this file.
export const CONFIG = {
  SUPABASE_URL: 'https://khaskedbnuyznhaeqcxi.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_zacLyPiq2Sw1vPoxm43N4w_sTMB6iaM',   // name kept for compatibility; holds the publishable key
  AI_ENDPOINT: '' };  // optional: URL of YOUR server-side AI function (never a provider API key)
