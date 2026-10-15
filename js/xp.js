// XP rules. xpForTask() here is a PREVIEW only. The authoritative award is the database function award_task_xp (migration 0003);
// the client cannot grant XP. Keep the constants below identical to the SQL function (tests check both against the same table).
export const BASE = { main: 30, side: 15, habit: 10 }, PM = { 1: 80, 2: 100, 3: 125 };
export const xpForTask = (type, priority, est) => Math.floor((BASE[type] ?? 0) * (PM[priority] ?? 100) / 100) + Math.min(Math.floor((est ?? 0) / 15), 8);
export const xpToReach = level => 100 * (level - 1) + 25 * (level - 1) * (level - 2); // cumulative; next level costs 100 + 50*(level-1)
export function levelFromXp(total) {
  let l = 1, rem = Math.max(0, Math.floor(total));
  for (;;) { const need = 100 + 50 * (l - 1); if (rem < need) return { level: l, into: rem, needed: need, pct: Math.floor(rem * 100 / need) }; rem -= need; l++; }
}
export const balance = entries => entries.reduce((s, e) => s + e.xp, 0);
export const dedupeLedger = entries => [...new Map(entries.map(e => [`${e.source}:${e.source_id}`, e])).values()];
export const SKILLS = { scholar: 'Scholar', builder: 'Builder', artist: 'Artist', musician: 'Musician', athlete: 'Athlete', explorer: 'Explorer' };
export const SKILL_NODES = [{ xp: 50, name: 'Apprentice' }, { xp: 150, name: 'Adept' }, { xp: 350, name: 'Expert' }, { xp: 700, name: 'Master' }];
export const skillState = xpBySkill => Object.entries(SKILLS).map(([key, label]) => {
  const xp = xpBySkill[key] ?? 0, nodes = SKILL_NODES.map(n => ({ ...n, unlocked: xp >= n.xp })), nx = nodes.find(n => !n.unlocked);
  return { key, label, xp, nodes, next: nx ? { name: nx.name, remaining: nx.xp - xp } : null }; });
export const ACHIEVEMENTS = { first_quest: { title: 'First step', desc: 'Complete your first quest.' }, ten_quests: { title: 'Steady hands', desc: 'Complete ten quests.' },
  main_quest: { title: 'Mission accomplished', desc: 'Complete a main quest.' }, level_5: { title: 'Rising', desc: 'Reach level 5.' } };
export const earnedAchievements = s => [s.done >= 1 && 'first_quest', s.done >= 10 && 'ten_quests', s.mainDone >= 1 && 'main_quest', s.totalXp >= xpToReach(5) && 'level_5'].filter(Boolean);
