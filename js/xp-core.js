// Provisional/preview XP rules. The AUTHORITATIVE award happens server-side (migration 0004); this mirrors it for display and tests.
export const DAILY_TASK_XP_CAP = 300;
export const xpForNext = level => 100 + 50 * (level - 1);
export function levelFromXp(total) { let level = 1, left = Math.max(0, Math.floor(total)); while (left >= xpForNext(level)) { left -= xpForNext(level); level++; } const need = xpForNext(level); return { level, into: left, needed: need, pct: Math.round(left / need * 100), total: Math.max(0, Math.floor(total)) }; }
export const taskXp = t => ({ 1: 10, 2: 20, 3: 30 }[t.priority] ?? 20) * (t.quest_type === 'main' ? 2 : 1);
export const applyDailyCap = (todayXp, amount) => Math.max(0, Math.min(amount, DAILY_TASK_XP_CAP - todayXp));
export const SKILLS = { scholar: 'Scholar', builder: 'Builder', artist: 'Artist', musician: 'Musician', athlete: 'Athlete', explorer: 'Explorer' };
export const SKILL_NODES = [[0, 'Novice'], [100, 'Apprentice'], [300, 'Adept'], [700, 'Expert'], [1500, 'Master']];
export const skillRank = xp => { let i = 0; while (i + 1 < SKILL_NODES.length && xp >= SKILL_NODES[i + 1][0]) i++; const nxt = SKILL_NODES[i + 1]; return { rank: SKILL_NODES[i][1], next: nxt ? { name: nxt[1], xpNeeded: nxt[0] - xp } : null }; };
export const ACHIEVEMENTS = { 'first-quest': { name: 'First Step', test: s => s.completed >= 1 }, 'ten-quests': { name: 'Ten Quests', test: s => s.completed >= 10 }, 'level-5': { name: 'Level 5', test: s => levelFromXp(s.totalXp).level >= 5 } };
export const unlockedAchievements = stats => Object.entries(ACHIEVEMENTS).filter(([, a]) => a.test(stats)).map(([k]) => k);
