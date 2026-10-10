// Keeps the app's screens on the phone so it opens instantly, even on a weak signal.
// Documents sent with no internet wait on the phone (outbox.js) and are sent from here
// in the background once the signal is back (Android), with a "sent" notification.
importScripts('outbox.js?v=1');
const CACHE = 'gabbrielle-v17';
const SHELL = [
  './', './index.html', './app.css', './app.js', './scanner.js', './config.js', './outbox.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/emblem.png', './icons/logo-full.png', './icons/favicon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // engine calls go straight to Google
  // Network first (so updates show up), fall back to the saved copy when offline.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});

// ---------- Phone notifications ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Gabbrielle';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: d.body || 'Open Gabbrielle to see what\'s new.',
      icon: 'icons/icon-192.png', badge: 'icons/favicon.png',
      tag: d.tag || 'gabbrielle', renotify: true,
      data: { url: d.url || './' }
    }),
    self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : null
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ type: 'open', url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});

// ---------- Documents waiting to send ----------
self.addEventListener('sync', e => {
  if (e.tag === 'gab-outbox') e.waitUntil(sendWaiting());
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'flush') e.waitUntil(sendWaiting());
});

function sendWaiting() {
  return self.GabOutbox.flush().then(res => {
    if (res.busy) return;                                   // the open app is already sending
    return Promise.all([self.GabOutbox.getMeta(), self.clients.matchAll({ type: 'window', includeUncontrolled: true })]).then(([me, wins]) => {
      const appOpen = wins.some(w => w.visibilityState === 'visible');
      wins.forEach(w => w.postMessage({ type: 'outbox', sent: res.sent, failed: res.newlyFailed, waiting: res.waiting }));
      const jobs = [];
      if (!appOpen && res.sent) jobs.push(note('Documents sent ✅',
        'Your ' + res.sent + ' document' + (res.sent === 1 ? ' was' : 's were') + ' sent to ' + (me.firmName || 'the firm') + '.', 'gab-sent', './'));
      if (!appOpen && res.newlyFailed) jobs.push(note('A document could not be sent',
        'Please open Gabbrielle and try again.', 'gab-failed', './?outbox=1'));
      if (!appOpen && res.loggedOut && res.waiting) jobs.push(note('Please open Gabbrielle',
        'Log in again so your saved documents can be sent.', 'gab-login', './'));
      return Promise.all(jobs);
    }).then(() => { if (res.network && res.waiting) throw new Error('still offline'); });   // the phone will try again later
  });
}

function note(title, body, tag, url) {
  if (!self.registration.showNotification || (self.Notification && Notification.permission !== 'granted')) return null;
  return self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/favicon.png', tag, data: { url } });
}
