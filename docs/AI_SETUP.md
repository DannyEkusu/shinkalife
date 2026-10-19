# Turning on the AI assistant (optional, needs YOUR approval and a provider account)
**The assistant already works without AI** (built-in rules: planning, task breakdown, what's due, catch-up, XP summary, explanations, all labelled "Rule-based", also offline). AI adds open-ended advice and smarter task breakdown. This file covers switching the AI on.
**Today the planner is rule-based and free.** The website only offers AI after you finish the steps below, and each user must also switch it on themselves (off by default). I have **not** chosen a provider, created an account, or tested against a real AI service: that needs your decision, because AI providers charge by usage or have free tiers with limits.

## What gets sent, and where
Only what a user types in the assistant (and, if they opted in to sharing, deadline/schedule titles and times), today's date and their timezone go to the AI provider, through **your own Supabase Edge Function** (`plan`). Tasks, calendar, profile and email are never sent. The AI only turns text into a task list; the schedule is built and checked on the user's device, and nothing is saved until they approve it. The AI key lives only in Supabase's secret store, never in this website or on GitHub.
Safeguards in the function (all unit-tested): login required; user must have opted in (checked on the server, not just in the browser); 2000-character input limit; daily limit per user (default 20, atomic counter in the database); only your website's address is allowed; provider errors are never shown to users; the AI's answer is cleaned and re-validated before use.

## What the AI can and can't do
Two modes in the same function: *plan* (turn your text into tasks) and *chat* (short advice). The server prompt limits it to ShinkaLife-style planning/productivity and tells it not to claim web, device or data access it doesn't have. **Scope is enforced by instructions and cannot be guaranteed by code**: the app never lets the AI change your data; schedules are built and validated locally and applied only when you approve. Your name for the assistant is display-only and is not sent to the AI.
Optional sharing (off by default, per user, checked on the server too): *Let the AI see my deadlines and today's schedule* sends titles and times only (max 20 each), never notes, email or profile. Saved conversation history lives in your account (table `assistant_messages`, migration 0007) and can be turned off or cleared in Settings.

## Costs and terms (read before approving)
- Supabase Edge Functions: included in the free plan up to its limits (check your plan's current limits).
- AI provider: **separate bill or free-tier limits** and the provider's own terms about how submitted text may be used. Pick one, read its terms, and keep the daily limit low. Any provider that offers an OpenAI-compatible "chat completions" endpoint works (several have free tiers; check current terms yourself).

## Steps
1. Choose a provider and create an API key (keep it private: never paste it into a file in this project, an issue, or a chat).
2. Supabase dashboard > **Edge Functions** > create a function named exactly `plan`. Paste the whole content of `supabase/functions/plan/index.ts`. Turn **Verify JWT** OFF for this function (the function verifies the user itself, and browsers' preflight requests carry no login). Deploy.
3. Same page > **Secrets**, add: `AI_BASE_URL` (provider's base URL, e.g. ending in `/v1`, must start with https://), `AI_API_KEY`, `AI_MODEL`, and `ALLOWED_ORIGINS` = `https://dannyekusu.github.io` (the site address only: no path, no trailing slash). Optional: `AI_DAILY_LIMIT` (default 20). Do not add `SUPABASE_URL` or the service key: Supabase provides them to the function automatically.
4. Make sure migrations `0006` and `0007` have been run (usage counter, opt-in, history, sharing flags).
5. In `js/config.js` set `AI_ENDPOINT` to `https://khaskedbnuyznhaeqcxi.supabase.co/functions/v1/plan` and `AI_PROVIDER_LABEL` to the provider's name (shown in the consent notice). Commit and push.
6. In the app: **Planner > Turn on AI assistance**, then generate a plan. The result is labelled "AI-assisted". If AI fails or the daily limit is reached, the planner falls back to rules and says why.
If you change `core.mjs`, run `node scripts/build-plan-function.mjs` to regenerate `index.ts` (a test fails if they differ).
