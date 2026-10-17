# Reminders and notifications: what works today
| Layer | Status |
|---|---|
| **In-app reminders** (Due now cards on Dashboard and Reminders page, toasts) | Implemented. Work while ShinkaLife is open. Tested in automated UI tests. |
| **System notifications** (browser/OS) | Implemented. Only after the user presses **Enable notifications** (never on page load). Work while ShinkaLife is open in a tab or installed as an app. Not tested on real phones/laptops yet. Blocked/unsupported states are explained in Settings. |
| **Notifications while the site is CLOSED** (background push) | **Not implemented.** Needs VAPID keys, a push-subscription flow, and a scheduled server job (Supabase Edge Function + cron). Do not rely on it. The `push_subscriptions` table from migration 0003 is reserved for it. |
Reminders you create are saved in your account (`reminders` table, migration 0006, owner-only RLS): types task, deadline, study, habit, activity, custom; one-off or daily/weekly; times kept in your timezone (wall-clock times survive daylight-saving changes). Actions: done, dismiss, snooze 10 min/1 h, edit (restarts the reminder), delete. Recurring reminders: handling one occurrence leaves the series running; days missed collapse into one "Due now" card.
Alerts respect: master switch, pause, quiet hours (alerts are held until quiet hours end, not lost), daily maximum, and per-category switches (Settings). Each alert is announced once (remembered on this device for 3 days).
**Limits to know:** the "already announced" memory and the daily maximum are per device/browser, so two devices open at once can each announce the same reminder. Automatic reminders for planned sessions and calendar events use the same switches.
