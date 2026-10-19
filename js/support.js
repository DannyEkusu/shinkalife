// What does THIS browser support? Used to show honest explanations instead of silent failures.
export function detectSupport(g = globalThis) {
  const nav = g.navigator || {}, ua = nav.userAgent || '', ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return { serviceWorker: 'serviceWorker' in nav, indexedDB: !!g.indexedDB, notifications: typeof g.Notification !== 'undefined', push: 'PushManager' in g, ios, firefoxDesktop: /Firefox\//.test(ua) && !/Android|Mobile/.test(ua), standalone: !!(g.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone) };
}
export function supportRows(s, installReady = false) {
  return [
    { label: 'Works offline (app files)', ok: s.serviceWorker, text: s.serviceWorker ? 'ShinkaLife can start without a connection after your first visit.' : 'This browser can’t keep the app files, so ShinkaLife needs internet to start.' },
    { label: 'Saved data on this device', ok: s.indexedDB, text: s.indexedDB ? 'Your quests, reminders and schedule are kept locally so you can read them offline. (Some private/incognito windows block this; ShinkaLife will tell you.)' : 'Local storage is blocked here, so nothing can be read or queued offline.' },
    { label: 'System notifications', ok: s.notifications && !(s.ios && !s.standalone), text: s.ios && !s.standalone ? 'On iPhone/iPad they only work after you add ShinkaLife to your Home Screen (iOS 16.4 or newer). In a normal Safari tab they are unavailable.' : !s.notifications ? 'Not supported by this browser. Reminders still appear inside ShinkaLife.' : 'Available once you press “Enable notifications”. They show while ShinkaLife is open.' },
    { label: 'Notifications when the app is closed', ok: false, text: (s.push ? 'Your browser supports push, but' : 'Your browser may not support push, and') + ' ShinkaLife’s push server isn’t set up yet, so these are not available.' },
    { label: 'Install as an app', ok: s.standalone || installReady, text: s.standalone ? 'Already installed.' : installReady ? 'Ready: use the Install button.' : s.ios ? 'In Safari tap Share, then “Add to Home Screen”.' : s.firefoxDesktop ? 'Firefox on desktop can’t install web apps. Bookmark the page instead.' : 'Use your browser’s menu (“Install app” / “Add to Home screen”) if it is offered.' }];
}
