# Android / Google Play preparation (NOT built or tested)
**Assessment:** Capacitor suits this project: static vanilla HTML/JS, relative paths, no framework or build step. Copy the site files to `site/` (see the Pages workflow) and point `webDir` at it. The web app stays the primary product.
**Nothing here has been built.** No Android SDK/JDK exists in the dev sandbox, so there is no APK/AAB, no device test, and the project is **not Play-ready**.
## Steps (to do on a machine with Android Studio + JDK 17)
1. `npm i @capacitor/core @capacitor/cli @capacitor/android`; copy `android/capacitor.config.template.json` to `capacitor.config.json`; **choose a permanent appId** (reverse-domain you control; cannot change after publishing). `npx cap add android`, `npx cap sync`.
2. Icons/splash: source icon is only 192 px (upscaled copies exist). Supply a 1024 px original; generate adaptive icon + splash with `@capacitor/assets`. Play listing needs a 512 px icon and feature graphic.
3. Auth redirects: `auth.js` uses `location.origin + pathname` as the email redirect, which inside Capacitor is `https://localhost/`. Add a deep link / Android App Link, handle `@capacitor/app` `appUrlOpen`, and add that URL to Supabase Redirect URLs. Test sign-up confirmation and password reset on a device.
4. Notifications: the Web Notification API and service workers are unreliable in Android WebView. Add `@capacitor/local-notifications` and branch `notify.js`; request `POST_NOTIFICATIONS` (Android 13+). Background FCM push needs a Firebase project and server work.
5. Storage/session: Supabase stores the session in WebView localStorage (not hardware-backed). Consider `@capacitor/preferences`/secure storage; document in the privacy policy.
6. Permissions: INTERNET only by default; add exact-alarm/notification permissions only if used.
7. Layout: test the bottom nav, safe-area insets, keyboard overlap on datetime inputs, back-button behaviour (`@capacitor/app` backButton).
8. Signing: create an upload keystore locally, **never commit it or its passwords**; use Play App Signing.
9. Play Console: developer-account verification and eligibility, privacy-policy URL (see `docs/PRIVACY.md`), Data safety form, content rating, target-API requirement, and the testing-track requirements for new personal accounts. **Check current Google requirements; they change.**
10. Test on a real device (install, offline start, login persistence, reminders, rotation, low-memory kill) before any release.
