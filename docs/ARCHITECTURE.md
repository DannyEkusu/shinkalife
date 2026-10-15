# Architecture and trust model
```
index.html / css  ->  pages.js, quests.js (views)  ->  service.js (rules)  ->  repo.js (proxy)  ->  repo-supabase.js  | repo-mock.js (explicit dev only)
                                   engines (pure, no DOM/network): recur-core, schedule-core, planner-core, planner-ai, xp-core, reminders-core, tasks-core, theme
```
- **Views** only render and call the service. **Service** holds the app rules (conflict checks, proposal approve/reject, re-plan, XP claim, read models). **Repo** is the only data boundary. If the real repo fails the error is shown with a Retry; there is **no automatic fallback to mock**. Sample mode is opt-in (`?mock=1` or the setup-screen button) and shows a permanent banner.
- **Trust model:** the browser proposes; the database decides. Ownership = RLS on every private table; overlap = exclusion constraint on `schedule_blocks`; completion time = trigger; XP = `award_task_xp()` (security definer, idempotent per task, 300 XP/day cap, no client write access to `xp_ledger`/`achievements_unlocked`). JS rules mirror these for UX only.
- **Independent validator:** `validateSchedule` re-checks every proposal (rules or AI) against current calendar state at approval time.
- **AI boundary:** `planner-ai.js` can only decompose text into tasks (validated by `sanitizeAITasks`); placement + validation stay local. The provider calls YOUR server-side endpoint (`CONFIG.AI_ENDPOINT`); provider keys must live in that function's environment. **The server function itself is not written** (spec: POST {text} with a Supabase JWT, verify the user, rate-limit, call the model, return `{tasks:[{title,est_minutes,due_at,priority,quest_type}]}`, max 2000 chars in, 30 tasks out).
- **Needs server-side privilege (not implemented):** account deletion (service-role Edge Function that deletes the auth user; all data cascades), background push delivery, AI provider calls.
## Migrations (run in order, once)
0001 profiles+preferences · 0002 categories/tasks/subtasks · 0003 availability, events(+exceptions), schedule_blocks, planner_drafts, reminder_settings, push_subscriptions, weekly_reviews · 0004 xp_ledger, achievements, `tasks.skill`, `award_task_xp()`. Never edit an applied migration; add 0005+.
## Known design limits
Recurrence supports daily/weekly (+interval, weekdays, until); weeks are counted from the start date. Ambiguous fall-back local times resolve to the later instant; nonexistent spring-forward times move forward. Occurrence conflict checks look 90 days ahead. `setAvailability` is delete-then-insert (not atomic). No per-user row caps yet.
