# Upload manifest
Compared with the previous ZIP I gave you (`shinkalife.zip`). **Simplest safe method:** copy the whole contents of this ZIP over your repository folder (keep your hidden `.git` folder), letting files be replaced. Everything below is what actually differs. Every file keeps the same folder path as in the ZIP.

**Keep your own values:** `js/config.js` holds your Supabase URL/key and (if you set it up) `AI_ENDPOINT`. This ZIP's copy has your Supabase URL and publishable key and an empty `AI_ENDPOINT`. If you already filled in `AI_ENDPOINT`/`AI_PROVIDER_LABEL`, re-enter them after replacing.

## REPLACE these existing files

### Website files (the published site) (12)
- `css/app.css`
- `index.html`
- `js/app.js`
- `js/dbcheck.js`
- `js/pages.js`
- `js/planner-ai.js`
- `js/planner-core.js`
- `js/quests.js`
- `js/repo-mock.js`
- `js/repo-supabase.js`
- `js/service.js`
- `sw.js`

### Supabase: migrations, checks, Edge Function (2)
- `supabase/functions/plan/core.mjs`
- `supabase/functions/plan/index.ts`

### Tests and package files (not published; for checking your work) (9)
- `package-lock.json`
- `package.json`
- `tests/ai-function.test.mjs`
- `tests/config.test.mjs`
- `tests/db/rls.sql`
- `tests/dbcheck.lib.test.mjs`
- `tests/helpers/fake-supabase.mjs`
- `tests/ui.features.test.mjs`
- `tests/ui.smoke.test.mjs`

### Documentation, workflow and tooling (5)
- `README.md`
- `docs/AI_SETUP.md`
- `docs/NOTIFICATIONS.md`
- `docs/STATUS.md`
- `scripts/build-plan-function.mjs`

## ADD these new files

### Website files (the published site) (5)
- `.nojekyll`
- `js/assistant-local.js`
- `js/kv.js`
- `js/offline.js`
- `js/support.js`

### Supabase: migrations, checks, Edge Function (1)
- `supabase/migrations/0007_assistant_history.sql`

### Tests and package files (not published; for checking your work) (6)
- `tests/assistant.chat.test.mjs`
- `tests/db/rls5.sql`
- `tests/offline.test.mjs`
- `tests/pages-base.test.mjs`
- `tests/ui.chat.test.mjs`
- `tests/ui.offline.test.mjs`

### Documentation, workflow and tooling (2)
- `docs/OFFLINE.md`
- `docs/UPLOAD_MANIFEST.md`

## Do NOT upload
`node_modules/`, any `.env` file, any AI key, any `service_role`/`sb_secret_` key, signing keystores. None are in this ZIP.

## Supabase side (not files in the site)
Run migrations `0001` to `0007` in order in the SQL Editor (only the ones not yet applied: see README). Deploy the `plan` Edge Function only if you decide to enable AI (see `docs/AI_SETUP.md`).
