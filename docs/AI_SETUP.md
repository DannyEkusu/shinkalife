# ShinkaLife AI setup (optional; live AI stays off until you configure it)

## What is already in the project?

The project already contains:
- `supabase/functions/plan/index.ts`: the Supabase Edge Function that calls the AI provider.
- `supabase/functions/plan/core.mjs`: the source logic used to generate the function.
- `js/planner-ai.js`: the website-side client that calls your Edge Function.
- `js/config.js`: the public website configuration.
- A rule-based assistant that continues to work when AI is not configured, is turned off, or fails.

The AI connection has **not** been verified against your live Supabase project or a real provider. Do not describe it as connected until you complete the test below.

## Important: “no research” does not automatically mean “free”

ShinkaLife does not give the model web-search, browsing, or research tools. It sends a limited request to the AI provider and receives a response. A hosted provider still processes that request outside your website/Supabase.

Google Gemini API may offer a free tier for eligible models, but limits and terms can change. On Google's current pricing page, the free tier states that submitted content may be used to improve Google products; paid-tier terms differ. Do not send passwords, authentication tokens, highly sensitive information, or information you do not want the provider to process. Check the current official terms before enabling it.

- Gemini API pricing and free/paid data-use distinction: https://ai.google.dev/gemini-api/docs/pricing
- Gemini OpenAI-compatible API: https://ai.google.dev/gemini-api/docs/openai
- Supabase Edge Functions pricing: https://supabase.com/pricing
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets

No Google Search grounding or other research tool is configured by the ShinkaLife function. Do not add provider tools or search grounding.

## What data is sent?

**Task breakdown mode:** the text the user types, today's date, and timezone are sent to the provider. The app validates the provider's returned tasks and performs scheduling locally.

**Assistant Planner chat:** the recent chat messages the user sends to the assistant are sent to the provider. If the user separately enables `ai_share_data`, the app may also send a limited summary of up to 20 deadline titles/times and up to 20 items from today's schedule. The function checks this sharing preference on the server. Keep this option off unless the user knowingly agrees.

The function does not intentionally send the whole database, email address, password, access token, or full profile. Chat history saved to `assistant_messages` is stored in the ShinkaLife Supabase database according to the user's history setting; this is separate from provider processing.

The AI's job is limited by the server prompts to ShinkaLife planning and productivity. This is a scope instruction, not a guarantee that every model response will obey perfectly. The application must continue to validate output, keep scheduling logic local, and require approval before applying proposed changes.

## Recommended initial provider configuration

For a low-cost trial, you can consider a Gemini model that is currently available on the free tier, such as `gemini-2.5-flash-lite`. Confirm availability, quotas, and terms in Google's current documentation before choosing it. Do not enable paid billing just to follow these instructions.

The function expects an OpenAI-compatible chat-completions API. Use these values for Gemini:

- `AI_BASE_URL`: `https://generativelanguage.googleapis.com/v1beta/openai`
- `AI_API_KEY`: your Gemini API key (secret; do not paste it into chat, source files, or GitHub)
- `AI_MODEL`: `gemini-2.5-flash-lite`
- `AI_DAILY_LIMIT`: `5` for an initial personal test, or another small positive limit
- `ALLOWED_ORIGINS`: `https://dannyekusu.github.io`

The function appends `/chat/completions` to `AI_BASE_URL`, so do not add `/chat/completions` to the secret value.

**Free-tier caution:** a free tier is not a promise of unlimited use, permanent availability, or private/no-training processing. If Google's current terms do not fit your privacy needs, leave AI disabled and keep using the built-in rule-based assistant.

## Supabase setup from an Android phone

### 1. Check the database migrations first

Open the Supabase dashboard for your ShinkaLife project:
`https://supabase.com/dashboard/project/khaskedbnuyznhaeqcxi`

Open **SQL Editor**. Check whether migrations `0006_assistant_reminders_ai_usage.sql` and `0007_assistant_history.sql` have already been applied. The project includes `supabase/checks/verify_setup.sql`; use its checks to identify missing objects.

Only apply a migration if its objects are missing and you have checked the existing database state. Do not blindly rerun migrations: the `ADD COLUMN` statements are not written as repeatable migrations. Preserve existing data and RLS policies.

The AI function relies on the `ai_opt_in` preference and the `ai_consume` usage-limit function from migration 0006. The optional data-sharing and chat-history controls are from migration 0007.

### 2. Deploy the existing Edge Function

Use the Supabase dashboard's **Edge Functions** area to create/deploy a function named exactly `plan`, using the existing source file `supabase/functions/plan/index.ts` from the project.

If the dashboard editor cannot deploy the local project file directly, use Supabase CLI from a computer or a supported development environment; do not paste only a fragment of the function. The function has a generated source file: if you edit `supabase/functions/plan/core.mjs`, run `node scripts/build-plan-function.mjs` to regenerate `index.ts`.

The function verifies the user token itself. Follow the project's setup note to disable gateway JWT verification for this function only if necessary for its `OPTIONS` preflight flow; the function must still perform its own authenticated-user check. Never remove the authentication check inside the function.

### 3. Add server-side secrets

In Supabase Dashboard, open **Edge Functions → Secrets** and add the values listed under “Recommended initial provider configuration” above.

These are server-side secrets. Never put `AI_API_KEY` in `js/config.js`, HTML, GitHub, a screenshot, or this chat. Do not create a service-role key yourself for the browser. Supabase supplies its function environment variables to the deployed function.

Keep `AI_DAILY_LIMIT` small while testing. The function also requires Supabase's own environment values to authenticate users and enforce the database usage limit.

### 4. Point the website to the Edge Function, but keep consent off

In `js/config.js`, set:

```js
AI_ENDPOINT: 'https://khaskedbnuyznhaeqcxi.supabase.co/functions/v1/plan',
AI_PROVIDER_LABEL: 'Google Gemini'
```

These values identify the endpoint/provider in the UI; they are not provider secrets. Commit and push only the source/configuration changes. Never commit the Gemini API key.

Deploy the website update to GitHub Pages. Confirm the actual site URL and case-sensitive path before testing.

AI should remain off for each user until they explicitly enable it in the app. The server also checks `ai_opt_in`; do not bypass this setting.

### 5. Test carefully

1. Sign in to ShinkaLife.
2. Confirm the database setup screen/checks show the required tables and functions.
3. Confirm AI is off by default and the rule-based assistant works.
4. Read the consent notice and provider data-use terms before opting in.
5. For a small test, enable AI for your account only.
6. Try a harmless request such as `Break down practising guitar for 20 minutes`.
7. Confirm the response is labelled AI-assisted and the task/schedule still requires the app's normal validation and approval.
8. Test chat with a harmless question about planning.
9. Turn AI off and confirm rule-based assistance still works.
10. If it fails, check the Edge Function logs for status/error details, but do not log prompts, tokens, or provider secrets.

Do not test with private or sensitive data. A successful deployment is not proof of a successful provider connection; the harmless live request must succeed before calling the integration operational.

## Cost and safety checklist

- Supabase Edge Functions have plan-specific quotas and limits; check the current Supabase pricing page. Free-tier availability is subject to those limits.
- Gemini usage may be free within current eligible-model quotas, but limits, model access, and data-use terms can change. Check Google's current pricing before enabling it.
- No web search, browsing, grounding, or external research tool is configured.
- The daily call limit is enforced server-side using `ai_usage` and `ai_consume`.
- AI is optional; the rule-based assistant remains available without a provider.
- If you need a guarantee that user content never leaves infrastructure you control, do **not** use a hosted Gemini endpoint. That requires a model hosted on infrastructure you control and has its own computing/hosting costs.

## If something does not work

Keep AI disabled and use the rule-based assistant while diagnosing. Check the function name, secrets, exact allowed origin, migrations 0006/0007, `AI_ENDPOINT`, and the function logs. Never solve setup errors by exposing a key, disabling user authentication, granting browser access to the service-role key, or weakening RLS.
