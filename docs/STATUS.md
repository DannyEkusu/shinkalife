# ShinkaLife status (updated: Supabase integration session)
## Supabase integration (this session)
- **Done:** your project URL + publishable key are in `js/config.js`; `.env.example` documents the names (static site: no runtime env vars). `js/config-check.js` refuses `sb_secret_`/`service_role` keys and malformed URLs, and the setup screen now says exactly what is wrong.
- **Done:** `js/dbcheck.js` + red banner after login that lists missing tables/function and which migrations (0001-0004) to run. This is how we learn whether migrations are applied remotely. I could **not** check from here.
- **Fixed (auth review):** token-refresh/duplicate sign-in events no longer reload the whole app; recovery links now show the new-password screen *before* any private data loads and then enter the app; sign-out wipes private data from the page.
- **Tested (fake Supabase client + real app code in jsdom):** loading state, signed-out view, wrong password, login, no reload on refresh events, sign-out wipe, sign-up (no assumption that confirmation is off), reset request, recovery flow.
- **NOT tested, and cannot be from my sandbox (host unreachable, outbound network allowlist):** the real connection, real sign-up/login/email links, the supabase-js version with `sb_publishable_` keys (vendored 2.45.4, should treat the key as opaque; if login fails with an API-key error, upgrade `vendor/supabase.js`), migrations on your project, RLS through the real API, `award_task_xp` RPC from the browser, cross-device sync.
- Unchanged: no AI provider added, no paid service, no privileged key anywhere, mock data only via explicit sample mode.

## Test results (executed and observed)
- `npm test`: **79/79 pass** (scheduler, DST recurrence, XP, planner + AI fallback, reminders, service flows, jsdom UI flows, auth flow + recovery (fake Supabase), config guard, DB self-check, PWA checks, theme contrast)
- `npm run test:db`: **63/63 checks pass** on real PostgreSQL 16 with a Supabase-auth shim (migrations 0001-0004)
- Syntax check of all modules; every static element ID referenced by JS exists
## Feature audit
**Implemented and verified (automated, no live Supabase):** theme engine (presets, custom colours, light/dark, contrast guard, local persistence) · timezone-aware recurrence incl. DST, exceptions (skip/move one occurrence) · deterministic scheduler + independent validator · missed-work recovery without duplicates · rule-based planner with assumptions/questions/alternatives · AI boundary (sanitising, fallback, honest labelling) · reminder policy (quiet hours, cap, pause) · XP rules and **database-enforced** award (idempotent, daily cap, no client writes) · RLS ownership + cross-account isolation on all tables · overlap exclusion constraint · service flows (create->plan, deadline edit->reviewable re-plan, reject changes nothing, approve applies, stale proposal refused, conflicting events rejected) · manifest/icons/service-worker rules.
**Implemented, verified only in jsdom/sample mode (no real browser, no layout/visual check):** Dashboard, Quests, Calendar (day/week/month, edit, recurring, conflicts), Planner, Character, Progress, Settings (availability, reminders, export), navigation, theme studio, toasts.
**Implemented, NOT verified (needs your Supabase project):** `repo-supabase.js` (every query), sign-up/login/logout/reset/session restore, profile + theme sync across devices, `award_task_xp` via RPC from the browser, real RLS through PostgREST.
**Implemented, NOT verified on devices:** service-worker install/offline in a real browser, install prompt, browser notifications, in-app reminder ticker timing.
**Not implemented:** server-side AI function (client boundary exists) · background push (needs VAPID + scheduled server job) · account deletion (needs service-role function; not offered in UI) · recurring *tasks* (events recur; tasks do not) · projects/milestones tables · drag-and-drop rescheduling (form-based editing instead) · Capacitor project (docs + template only; **not Play-ready**) · skill assignment UI for quests (column exists; skills stay at 0 until quests are tagged) · weekly quests · monthly/yearly recurrence.
**Blocked by external config:** Supabase project + keys (yours), redirect URLs, AI provider + server function, VAPID keys, Firebase (Android push), Play Console, Android SDK.
## Findings to decide
- **Unreferenced duplicate modules:** `js/recurrence.js`, `js/reminders.js`, `js/scheduler.js`, `js/xp.js` (timestamped before this session's modules; origin unknown to me). Not imported by anything, no tests, different data shapes, and `xp.js` constants **disagree** with the tested SQL (e.g. main/high = 60 XP in SQL vs a different formula there). Left untouched. Recommend deleting them; do so only if you recognise them as superseded.
- `js/data.js` removed (superseded by `repo-supabase.js`, unreferenced).
- Source icon is 192 px; Play needs a 512+ original.
- Quests page datetime inputs use the browser timezone; Calendar/Planner use the profile timezone (minor inconsistency).
## Changed this session
New: migrations 0003, 0004; tests/db/rls2.sql; tests/{engines,flows,ui.smoke,pwa}.test.mjs; js/{recur-core,schedule-core,planner-core,planner-ai,xp-core,reminders-core,repo,repo-supabase,repo-mock,service,state,ui,pages,notify}.js; manifest.webmanifest, sw.js, offline.html, vendor/supabase.js (pinned 2.45.4, MIT), assets/icon-*.png; .github/workflows/pages.yml; android/capacitor.config.template.json; docs/{ARCHITECTURE,NOTIFICATIONS,ANDROID,PRIVACY}.md.
Edited: index.html, css/app.css, js/{app,quests,config}.js, tests/db/{rls.sql,run.sh}, package.json, README.md. Removed: js/data.js.
## Next actions
1. **You (about 15 minutes):** README > *Connect Supabase*: run migrations 0001-0004 in order, set Auth URLs, then run the app and do the verification list. Send me any red banner text, error message, or what you saw.
2. **Me, after your results:** fix whatever the live test reveals, then verify cross-account isolation and XP through the real API.
3. **Independent work still open:** recurring tasks + projects/milestones (migration 0005), skill tagging UI, drag-and-drop, AI Edge Function (needs your provider decision and approval), real-browser visual QA, decide on the unreferenced duplicate files listed above.
