// Tells you which migrations are missing in the connected Supabase project (read-only probes; writes nothing).
export const REQUIRED = [['profiles', '0001'], ['preferences', '0001'], ['categories', '0002'], ['tasks', '0002'], ['subtasks', '0002'], ['availability', '0003'], ['events', '0003'], ['event_exceptions', '0003'],
  ['schedule_blocks', '0003'], ['planner_drafts', '0003'], ['reminder_settings', '0003'], ['push_subscriptions', '0003'], ['weekly_reviews', '0003'], ['xp_ledger', '0004'], ['achievements_unlocked', '0004']];
const gone = e => !!e && (['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code) || /could not find|does not exist/i.test(e.message || ''));
const offline = e => !!e && /failed to fetch|network|fetch failed|load failed/i.test(e.message || '');
export async function checkDatabase(sb) {
  const probes = REQUIRED.map(async ([name, mig]) => ({ name, mig, error: (await sb.from(name).select('*', { count: 'exact', head: true }).limit(0)).error }));
  probes.push((async () => ({ name: 'award_task_xp()', mig: '0004', error: (await sb.rpc('award_task_xp', { p_task_id: '00000000-0000-0000-0000-000000000000' })).error }))()); // raises "task not found" if installed; writes nothing
  const res = await Promise.all(probes), missing = res.filter(r => gone(r.error)).map(({ name, mig }) => ({ name, mig }));
  return { ok: !missing.length && !res.some(r => offline(r.error)), unreachable: res.some(r => offline(r.error)), missing, migrations: [...new Set(missing.map(m => m.mig))].sort() };
}
