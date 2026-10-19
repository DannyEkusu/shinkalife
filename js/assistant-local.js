// The built-in, rule-based assistant "brain": intent detection and plain-language answers computed from the user's OWN ShinkaLife data.
// Pure functions (no network, no DOM). Works offline. Never labelled as AI.
export function detectIntent(text) {
  const t = String(text).toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").trim();   // phones and the prompt buttons use curly apostrophes
  if (/^(help|hi|hello|hey)( there)?[\s!?.]*$|\bwhat can you (do|help)\b|\bwho are you\b|\bhow do(es)? (this|shinkalife) work\b/.test(t)) return 'help';
  if (/\bbreak(ing)?\b.{0,12}\bdown\b|\bsplit\b.{0,20}\b(into|up)\b|\bsmaller steps?\b|\bsteps? (for|to)\b|\bhow (do|should) i (approach|start|tackle)\b/.test(t)) return 'breakdown';
  if (/\b(why|explain|reasoning|how did you)\b/.test(t) && /\b(schedule|plan|order|suggest|put|placed|this)\b/.test(t)) return 'explain';
  if (/\b(missed|fell behind|falling behind|behind on|catch up|recover|reschedule)\b/.test(t)) return 'recover';
  if (/\b(xp|level|achievement|achievements|skills?|progress|streak)\b/.test(t) && !/\b(plan|schedule)\b/.test(t)) return 'progress';
  if (/\b(what('?s| is| are)|show|list|anything)\b.{0,30}\b(due|deadlines?|today|upcoming|on my plate|next)\b|\bwhat do i have\b/.test(t) && !/\b\d+\s*(h|hr|hrs|hours?|min|mins|minutes?)\b/.test(t)) return 'overview';
  if (/\b(plan|schedule|timetable)\b/.test(t)) return 'plan';
  return 'other';
}
// Is this message a to-do/planning request (as opposed to a question or chit-chat)? The rule-based parser would happily turn ANY sentence into a task,
// so we only plan when the text actually looks like things to do.
export const isQuestion = text => /^(how|what|why|can|could|should|would|is|are|do|does|did|when|where|which|who|tell|give|explain|suggest|recommend)\b/i.test(String(text).trim()) || /\?\s*$/.test(String(text));
export function looksLikePlan(text) {
  const t = String(text).toLowerCase(); if (isQuestion(t)) return false;
  return /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\btomorrow\b|\btoday\b|\btonight\b|\bthis week\b|\bnext week\b|\bdue\b|\bdeadline\b|\bexam\b|\btest\b|\bquiz\b|\bessay\b|\bassignment\b|\bhomework\b|\bproject\b|\d+\s*(h|hr|hrs|hours?|min|mins|minutes?)\b|\btimes? (a|per|this|each) week\b|\bevery\b|\b(study|revise|practi[sc]e|write|read|finish|complete|submit|build|work on|learn|exercise|train|draw|paint|code|prepare|review|clean|call|email|need to|have to|want to|must|should)\b/.test(t);
}
// "plan my week" with nothing else to plan: ask for details instead of inventing a task called "Plan my week".
export const isBareDirective = text => /^(please\s+)?(can you\s+|could you\s+)?(help me\s+)?(plan|schedule|organi[sz]e|make (me )?a (plan|timetable|schedule)|create a (plan|timetable|schedule))( my| the| a)?( (day|week|weekend|month|time|tomorrow|today))?[\s.!?]*$/i.test(String(text).trim());
export const extractSubject = text => String(text).replace(/^(please\s+)?(can|could) you\s+/i, '').replace(/\b(help me\s+)?(to\s+)?break(ing)?\s+(it\s+|this\s+|that\s+)?down\b:?/i, '').replace(/\b(split|divide)\b\s*(it|this|that)?\s*(up|into (smaller )?(steps|parts))?/i, '').replace(/\b(steps? (for|to)|how (do|should) i (approach|start|tackle))\b/i, '').replace(/^[\s:,.-]+|[\s?.!]+$/g, '').trim() || String(text).trim();
const TEMPLATES = [
  [/essay|report|paper|assignment|write|article|thesis|dissertation/, ['Clarify the question and the requirements', 'Gather sources and make notes', 'Outline the main points', 'Write a first draft', 'Revise and tighten', 'Proofread and submit']],
  [/exam|test|quiz|revise|revision|study|learn|homework/, ['List the topics to cover', 'Review notes for the first topic', 'Practise questions or past papers', 'Review mistakes and weak spots', 'Do a timed mock run', 'Light recap before the day']],
  [/code|program|website|app\b|project|build|develop|portfolio/, ['Define what “done” looks like', 'List the features and pick the first one', 'Build the smallest working version', 'Test it and fix problems', 'Polish and write it up', 'Share or deploy it']],
  [/draw|sketch|paint|art|illustrat|design/, ['Gather references', 'Rough thumbnails', 'Refine the best sketch', 'Add detail and shading', 'Final touches and review']],
  [/music|guitar|piano|practi[sc]e|song|instrument|sing/, ['Warm up and review the basics', 'Work the hardest passage slowly', 'Play sections at tempo', 'Run the whole piece', 'Note what to improve next time']],
  [/exercise|workout|fitness|run|gym|train/, ['Choose the sessions for the week', 'Warm-up routine', 'Main workout', 'Cool-down and stretch', 'Log how it went']]];
export function breakdownSteps(subject) {
  const hit = TEMPLATES.find(([re]) => re.test(String(subject).toLowerCase()));
  return { steps: hit ? hit[1] : ['Define the goal in one sentence', 'List what is needed to finish', 'Do the first small step (15–25 minutes)', 'Review progress and adjust', 'Finish and check it off'], generic: !hit };
}
export const helpText = (name, a) => `I’m ${name}, the planning assistant built into ShinkaLife. I can: turn what you need to do into a schedule you can review (“maths test Thursday, draw 3 times this week”); break a task into steps (“break down my essay”); explain a plan (“why this order?”); recover missed sessions (“I fell behind”); and summarise what’s due or your XP and level. I only know what is in your ShinkaLife account, I can’t browse the web or see other apps, and I never change your schedule until you approve it. Right now I’m using ${a.aiActive ? 'AI for open-ended questions and task breakdown, with local rules for scheduling' : 'built-in rules (no AI)'}.`;
export const scopeText = (name, a, offlineNote = '') => `I can only help with ShinkaLife planning and productivity: schedules, tasks and deadlines, study plans, reminders, XP and progress. Try “plan my week: …”, “break down …”, or “what’s due?”.${a.aiConfigured && !a.aiOptIn ? ' For open-ended advice, turn on AI assistance in the panel above.' : !a.aiConfigured ? ' Open-ended chat needs an AI service, which isn’t set up for this site yet.' : ''}${offlineNote}`;
const when = (ms, tz) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz });
export function overviewText(d) {
  const tz = d.tz, lines = [], pastDue = d.deadlines.filter(t => t.pastDue), soon = d.deadlines.filter(t => !t.pastDue).slice(0, 4), today = [...d.today.fixed.map(f => `${f.title} (${when(f.start, tz).split(', ').pop()})`), ...d.today.blocks.map(b => `${b.title} (${when(b.start, tz).split(', ').pop()})`)];
  lines.push(today.length ? `Today: ${today.join('; ')}.` : 'Nothing is scheduled for today.');
  lines.push(soon.length ? `Coming up: ${soon.map(t => `${t.title} (due ${when(Date.parse(t.due_at), tz)})`).join('; ')}.` : 'No deadlines in the next 7 days.');
  if (pastDue.length) lines.push(`Past due: ${pastDue.map(t => t.title).join('; ')}. Say “I fell behind” and I’ll draft a catch-up plan.`);
  if (d.due.length) lines.push(`${d.due.length} reminder${d.due.length > 1 ? 's are' : ' is'} due now.`);
  return lines.join(' ');
}
export const progressText = c => `You’re level ${c.xp.level} with ${c.xp.into}/${c.xp.needed} XP towards level ${c.xp.level + 1} (${c.xp.total} XP in total). ${c.achievements.filter(a => a.unlocked).length}/${c.achievements.length} achievements unlocked.${c.skills.some(s => s.xp) ? ' Strongest skill: ' + [...c.skills].sort((a, b) => b.xp - a.xp)[0].name + '.' : ' Tag quests with a skill to grow your skill ranks.'} XP only comes from completed quests, recorded by the server.`;
export function explainText(p) {
  if (!p) return 'Ask me for a plan first, then ask why and I’ll explain how it was put together.';
  const out = [p.source === 'ai' ? 'The tasks were broken down by an AI model; the times were placed and checked by ShinkaLife’s built-in scheduler.' : 'This plan was built with fixed rules (no AI): tasks are sorted by deadline, then priority, and each session goes into the earliest free time inside your available hours.', 'Sessions are capped in length, breaks are left between them, and nothing overlaps your fixed commitments or exceeds your daily limit.', ...(p.explanations || []).slice(0, 4)];
  for (const t of p.tasks || []) if (t.assumptions?.length) out.push(`“${t.title}”: ${t.assumptions[0]}`);
  for (const u of p.unscheduled || []) out.push(`Not everything fits: ${u.explain}`);
  return out.join(' ');
}
