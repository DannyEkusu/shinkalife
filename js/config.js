// PUBLIC browser configuration. Safe to commit ONLY because every table has Row Level Security.
// The publishable key identifies your project; it is NOT a password and grants no extra permissions.
// NEVER put a service_role key, an sb_secret_ key, a database password or an AI provider key in this file.
export const CONFIG = {
  SUPABASE_URL: 'https://khaskedbnuyznhaeqcxi.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_zacLyPiq2Sw1vPoxm43N4w_sTMB6iaM',   // name kept for compatibility; holds the publishable key
  SOME_EXISTING_SETTING: true,
  AI_ENDPOINT: 'https://khaskedbnuyznhaeqcxi.supabase.co/functions/v1/plan',        // URL of YOUR deployed Edge Function, e.g. https://<ref>.supabase.co/functions/v1/plan (never a provider API key). Empty = rule-based planner only.
  AI_PROVIDER_LABEL: 'Google Gemini' };  // plain-English name shown in the consent notice, e.g. 'Google Gemini'
