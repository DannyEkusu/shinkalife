# ShinkaLife status: FINAL for this delivery (assistant, offline, reminders, deployment)
## Automated results (actually run)
- `npm test`: **167 tests: 167 pass, 0 fail, 0 skipped.**  `npm run test:db`: **116 checks: 116 pass, 0 fail** (real PostgreSQL 16, Supabase auth shimmed). Migrations 0001-0007 apply cleanly in order.
## Implemented AND tested (automated; fakes, not your live services)
Assistant (intents, plans, breakdown, explanations, recovery, XP/overview, out-of-scope refusal, curly-apostrophe input, name + opt-in + data-sharing flags, history save/clear, rule-based fallback when AI fails or you're offline, retry); AI Edge Function core (login, server-side opt-in, daily limit, validation, scope prompt, injection handling, output sanitising, no secret leakage); offline engine (cache, queue, idempotent replay incl. lost responses, conflicts, permanent errors, auth expiry, per-user wipe, IndexedDB + memory fallback); real-page offline cycle (offline add/complete -> queued -> sync once -> server XP once -> sign-out guard); reminders (CRUD, snooze/dismiss/done, recurrence across DST, quiet hours, caps, de-dup, categories); in-app/system-notification permission flow; Instagram links; PWA files; GitHub Pages sub-path and exact-case file names; RLS/ownership/constraints/XP/history in the database.
## Implemented, REQUIRES YOUR CONFIGURATION (cannot work until you do it)
- Supabase migrations 0001-0007 on your project (run in order; verify with `supabase/checks/verify_setup.sql`).
- Supabase Auth redirect URLs for the exact live address.
- AI: deploy `supabase/functions/plan/index.ts`, add provider secrets, set `AI_ENDPOINT`: your decision on a provider and its cost (`docs/AI_SETUP.md`). Without it the assistant is rule-based and says so.
## NOT verified (needs real browsers/devices/accounts)
Live Supabase sign-in/sign-up/reset emails and RLS through the real API; the Edge Function deployed and talking to a real provider; the Supabase JS session behaviour on an offline app start; service-worker install/update and offline start in real browsers; system notifications on real devices; phone layout of the 8-item bottom nav; the GitHub Actions workflow; the live site address/casing (my tools could not load it).
## NOT implemented
Background push when the site is closed; account deletion; recurring tasks/projects; Capacitor/Android build; drag-and-drop calendar editing. The unreferenced files `js/recurrence.js`, `js/reminders.js`, `js/scheduler.js`, `js/xp.js` (origin unknown, unused, XP constants differ from the tested SQL) are still present: delete them when you're sure.
## Bugs found and fixed in this stretch (by tests)
Conflict messages were mistaken for network errors (sync stalled); iOS notification text; AI task/context caps counted invalid entries; reminders list rendered as "[object HTMLDivElement]"; the rule parser turned any sentence into a task and ignored "X and Y"; "help me ..." was read as bare "help"; curly apostrophes broke intent detection; sample-lecture seed was invisible on Sundays; test-helper syntax slip.
## Next actions
1. **You:** run missing migrations; upload files; set Auth URLs; verify per README; tell me any errors.
2. **You, optional:** approve an AI provider and follow `docs/AI_SETUP.md`.
3. **Me after your results:** live fixes; background push (needs VAPID + scheduled function); account deletion function; real-device checks.
---
## Earlier history
## Latest session summary
- **Found:** migration 0006 and its DB tests already existed but NO app code used them. Reviewed and verified 0006 (103 DB checks pass, 34 for 0006) rather than writing a competing migration.
- **Built:** assistant name + AI opt-in (service, repos, Settings, Planner), real reminders (create/edit/snooze/done/dismiss/delete, recurrence, categories, quiet hours, cap, dedupe) with Reminders page + dashboard cards + in-app ticker + opt-in system notifications, rule-based goal splitting, Planner check-in, Instagram links, AI Edge Function (`supabase/functions/plan`, not deployed), DB self-check extended for 0006.
- **Fixed:** two dbcheck tests (expectations updated after inspecting them; added a missing-column test); AI task cap counted malformed entries; reminders list rendered as "[object HTMLDivElement]" (caught by UI test).
- **Tested (run, passing):** `npm test` 120/120; `npm run test:db` 103/103; migrations 0001-0006 + verify_setup.sql on scratch Postgres.
- **NOT tested:** real Supabase (sign-in, RLS via API, 0006 on your project), the Edge Function against a real provider or deployed, real OS/browser notifications, real phone layout (8-item mobile nav uses small labels: check it on your Android), GitHub Pages deploy of this build.
- **Not implemented:** background push (site closed), account deletion, AI provider account (needs your approval), recurring tasks/projects.
## Earlier sections
## Diagnosis: "database isn't fully set up" + "Could not find table public.profiles" (15 Oct)
- **Cause (verified by simulation, not by access to your live project):** migrations were not applied on the project the site points to. The deployed `dbcheck.js` had a bug (HEAD request: supabase-js reports a bodiless 404 as success), so it reported only `award_task_xp()` and hid every missing table. Reproduced: a project with nothing installed gives exactly the two messages in the screenshot with the deployed code, and a correct list of 16 missing objects with the fixed code.
- **Fixes in this copy:** `js/dbcheck.js` (GET probe), `js/auth.js` (`saveProfile` upserts), `sw.js` (v2 so browsers fetch the new files), migration `0005_backfill_profiles.sql`, `supabase/checks/verify_setup.sql`, tests. Migrations 0001-0004 are unchanged and identical to the ones in the deployed zip.
- **Tested:** 82 unit/UI tests; 69 local database checks; repair procedure on a scratch Postgres (wrong order fails cleanly, correct order works, re-runs are harmless, backfill works).
- **Not verified:** your live project's actual state (run verify_setup.sql query 1), and the Supabase SQL Editor's own transaction behaviour (assumed to match a single simple query; always re-run query 1 after any error).

## Supabase integration (earlier session)
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
1. **You:** in Supabase SQL Editor run any missing migrations in order (0001-0006; check with `supabase/checks/verify_setup.sql` query 1 first), copy the update files into your repo, push, then follow the verification list in README. Tell me what happens (errors, screenshots).
2. **You, only if you want AI:** approve a provider, then follow `docs/AI_SETUP.md`. Nothing sends text to any AI service until you do and each user opts in.
3. **Me, after your results:** fix live issues; real-device notification and mobile-nav checks; then background push (needs VAPID keys + scheduled function), account deletion function, recurring tasks/projects (migration 0007).
