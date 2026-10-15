# ShinkaLife
*Plan. Progress. Evolve.* A personal growth planner: quests, a timezone-aware calendar, a deterministic scheduler, a rule-based planner (optional AI layer), XP and skills. Static HTML/CSS/vanilla ES modules + Supabase. No build step. Installable PWA. See `docs/STATUS.md` for exactly what is verified.

## Try it now (no Supabase needed)
    npm install                      # dev-only: jsdom for UI tests
    python3 -m http.server 8080      # open http://localhost:8080  then "Open with sample data"
Sample mode (or `?mock=1`) uses an in-memory mock repository with a permanent banner. Nothing is saved and it is never used automatically.

## Tests
    npm test          # 79 tests: scheduler, recurrence/DST, XP, planner, AI fallback, reminders, service flows, UI flows (jsdom), PWA, theme contrast
    npm run test:db   # 63 database checks on a throwaway local PostgreSQL 15+ (Supabase auth is shimmed): RLS isolation, constraints, XP ledger, overlap exclusion
`test:db` needs PostgreSQL binaries (e.g. `apt install postgresql`). It is **not** a substitute for testing on your real Supabase project.

## Connect Supabase (step by step)
Your project's **public** URL and **publishable key** are already in `js/config.js`. The publishable key is not a password: it only says "this app talks to this project". What protects your data is Row Level Security inside the database. Never put a `service_role` key, an `sb_secret_` key or your database password in any file of this project (the app refuses to start if it finds one).

**1. Create the database tables (once, in order).** Supabase dashboard > *SQL Editor* > *New query*. For each file below: open it, copy everything, paste, press *Run*. Expect "Success. No rows returned". If you see "already exists", you ran it before: skip it.
   `0001_profiles_preferences.sql` then `0002_categories_tasks_subtasks.sql` then `0003_calendar_planner_reminders.sql` then `0004_xp_ledger.sql` then `0005_backfill_profiles.sql` (all in `supabase/migrations/`). **Before running anything**, you can see what already exists: paste the queries from `supabase/checks/verify_setup.sql` one at a time (they only read, never change anything). Only run the migrations that are missing, always in number order. 0005 gives accounts you created *before* the tables existed their profile row; it is safe to run more than once.
**2. Tell Auth where your app lives.** *Authentication > URL Configuration*: set **Site URL** to `http://localhost:8080`, and add these **Redirect URLs**: `http://localhost:8080/**` and, once deployed, `https://<your-github-username>.github.io/<repo-name>/**`. Without this, confirmation and reset links in emails will not bring you back to the app.
**3. Email confirmation.** *Authentication > Sign In / Providers > Email*. "Confirm email" ON is recommended and the app handles both settings. Supabase's built-in email sender allows only a few emails per hour; for heavy testing confirm test users by hand in *Authentication > Users*, or add your own SMTP later.
**4. Passwords.** Set the minimum length to 8 or more (the app requires 8).
**5. Run the app** (`python3 -m http.server 8080`, open http://localhost:8080). After you log in, the app checks your database. A red banner lists any missing tables and which migration to run. No banner = migrations 0001-0004 are in place (run `verify_setup.sql` query 5 to confirm 0005 too).

### Verify after connecting (tell me the results)
- Sign up, confirm the email (if enabled), log in, **reload the page** (you should stay logged in), log out, request a password reset and use the link.
- *Table Editor*: your user has a row in `profiles` and `preferences`, and every table shows RLS enabled.
- Make two accounts, A and B. Add a quest as A. B must not see it. Do not use the SQL Editor to test this: it runs as an admin and bypasses RLS.
- Complete a quest: Character shows the XP. Reopen and complete again: no extra XP.
- Change the theme on one device, log in on another: the theme follows you.
- Calendar: an overlapping event is rejected; a planner proposal can be rejected without changing anything, and approved.
- Advanced (optional) RLS check as user A inside the SQL editor: `begin; set local role authenticated; select set_config('request.jwt.claim.sub', '<A-user-uuid>', true); select count(*) from tasks; rollback;`

## Deploy (GitHub Pages)
The frontend is fully static and uses relative paths, so it works on a project sub-path. Push to `main`; `.github/workflows/pages.yml` runs the tests and publishes (untested until first push; enable Pages > Source: GitHub Actions). `js/config.js` (public URL + publishable key) is committed with the site: safe only because RLS is on, then add the Pages URL to Supabase Redirect URLs. Pages cannot run server code: AI calls, push delivery and account deletion need a separate backend (see `docs/ARCHITECTURE.md`).

## Docs
`docs/ARCHITECTURE.md` trust model and layers · `docs/NOTIFICATIONS.md` reminder tiers · `docs/ANDROID.md` Capacitor plan (not built) · `docs/PRIVACY.md` draft · `docs/STATUS.md` progress and next action.

## Troubleshooting
- *"Could not find the table 'public.profiles' in the schema cache" or a banner about `award_task_xp()`:* the migrations haven't been run on THIS Supabase project (check the project ref in the dashboard URL matches `js/config.js`). Run `supabase/checks/verify_setup.sql` query 1, then apply the missing migrations in order. Only if every row says `present = true` and the error persists, run `notify pgrst, 'reload schema';` in the SQL Editor and wait 10 seconds.
- *Setup screen even though config is filled:* hard-reload; check the browser console for a failed `vendor/supabase.js` load.
- *"Set your available hours":* Settings > Available hours, then the planner works.
- *Sign-up email links go to the wrong place:* fix Site URL / Redirect URLs in Supabase.
- *Stale app after deploy:* bump `VERSION` in `sw.js`; the app prompts to reload.
- *XP missing after completing offline:* it is retried (`claimPendingXp`); XP is only ever written by the server function.
- *Permission denied on a table:* you skipped a migration or ran them out of order.
