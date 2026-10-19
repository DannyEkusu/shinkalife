# ShinkaLife
*Plan. Progress. Evolve.* A personal growth planner: quests, a timezone-aware calendar, a deterministic scheduler, an assistant (built-in rules, optional AI), reminders, XP and skills, offline mode, installable as an app. Static HTML/CSS/vanilla JS + Supabase. No build step.
Live site: https://dannyekusu.github.io/ShinkaLife/ · Exact status of every feature: `docs/STATUS.md` · What to upload: `docs/UPLOAD_MANIFEST.md`

## 1. Try it locally (no Supabase needed)
    npm install                      # dev-only (jsdom, fake-indexeddb)
    python3 -m http.server 8080      # open http://localhost:8080 then "Open with sample data"
Sample mode is in-memory, clearly bannered, and never used automatically.

## 2. Tests
    npm test          # 167 tests: scheduler/DST, XP, planner, assistant, AI function (incl. chat security), offline engine + IndexedDB, reminders, real-page UI flows (jsdom), auth flow, PWA, GitHub Pages base path
    npm run test:db   # 116 database checks on a throwaway local PostgreSQL 15+ (RLS isolation, constraints, XP, history)
`test:db` needs PostgreSQL binaries (`apt install postgresql`). Both use fakes/local databases: they do not replace testing on your real Supabase project and real devices.

## 3. Supabase setup (migrations are additive: they never delete data or disable RLS)
Dashboard > **SQL Editor** > New query. Run each file below **once, in this order, only the ones you haven't run yet** (paste the whole file, press Run; "Success. No rows returned" is right; "already exists" means you ran it before, skip it):
`supabase/migrations/` **0001** profiles, **0002** quests, **0003** calendar/reminders, **0004** XP, **0005** profile backfill (for accounts created before the tables existed; safe to repeat), **0006** assistant name/AI opt-in/reminders/AI usage, **0007** assistant history + sharing flags.
Not sure which you've run? Paste the queries in `supabase/checks/verify_setup.sql` one at a time (read-only). The app also shows a red banner after login listing missing tables/columns and which migration to run. If one fails with another error, stop and send me the message; a failed run should leave nothing half-applied (re-run query 1 to confirm).
Then: **Authentication > URL Configuration**: Site URL and Redirect URLs = the **exact** address you open the site at, e.g. `https://dannyekusu.github.io/ShinkaLife/**` (and `http://localhost:8080/**` for local). **Providers > Email**: keep "Confirm email" on (the app handles both); password minimum 8.
`js/config.js` already holds your project URL and *publishable* key (public by design; RLS protects data). Never put a `service_role`/`sb_secret_` key, database password or AI key in any file here (the app refuses to start with a secret key).

## 4. Deploy to GitHub Pages
The site is static and uses only relative paths (tested against the `/ShinkaLife/` sub-path), so it works at whatever address Pages gives it. **Check the exact address** in your repo > Settings > Pages (my tools couldn't load the live site, and your earlier screenshot used lowercase `/shinkalife/` while your latest message uses `/ShinkaLife/`: if one gives 404, use the other, and use that exact casing in the Supabase redirect URLs).
- **Upload:** copy the ZIP's contents over your repo (replace files, keep `.git`), commit, push to `main`. (`docs/UPLOAD_MANIFEST.md` lists what changed.)
- **Pages source:** either *GitHub Actions* (the included `.github/workflows/pages.yml` runs the tests, then publishes only site files; untested until its first run) or *Deploy from a branch* (root). Both work.
- After deploy: hard-reload; the app shows "A new version is ready, reload?" because the service worker updates (cache `shinkalife-v4`). Bump `VERSION` in `sw.js` on future releases.

## 5. Assistant, AI, offline, reminders
- **Assistant** (Planner page): name it in Settings. Works with built-in rules, labelled "Rule-based", also offline. **AI is OFF** until you deploy the Edge Function and each user opts in: `docs/AI_SETUP.md` (costs depend on the provider you choose; nothing is enabled without your approval).
- **Offline:** `docs/OFFLINE.md`. **Reminders/notifications:** `docs/NOTIFICATIONS.md` (in-app and while-open system notifications work; **background push when the site is closed is NOT implemented**). **Android/Play:** `docs/ANDROID.md` (plan only, not built). Privacy draft: `docs/PRIVACY.md`.

## 6. Troubleshooting
- *Red banner "database isn't fully set up", or "Could not find the table ... in the schema cache"*: run the listed migrations (section 3). Only if everything is present and it persists: `notify pgrst, 'reload schema';` then wait 10 s.
- *Setup screen though config is filled*: hard-reload; check the console for a failed `vendor/supabase.js`.
- *Login emails go to the wrong place / "redirect not allowed"*: fix Site URL / Redirect URLs (exact casing).
- *Stale site after deploy*: hard-reload or accept the update prompt.
- *"AI isn't set up"*: expected until `docs/AI_SETUP.md` is done.
- *Changes made offline "needs attention"*: Settings > Offline & sync shows each one with the reason.
