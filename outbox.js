/* Gabbrielle — documents waiting to send (works with no internet).
 * Shared by the app page and the service worker (importScripts), so the phone can finish
 * sending in the background on Android once the signal comes back.
 * Each document is saved on the phone (already shrunk) with a unique id; the engine ignores
 * a document id it has already received, so a retry can never create a duplicate. */
(function (root) {
  var DB = 'gabbrielle', VER = 1, OUT = 'outbox', META = 'meta';
  var MAX_TRIES = 3;
  var PERMANENT = /too large|only photos|empty|could not be read|no longer have access/i;

  function open() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(OUT)) db.createObjectStore(OUT, { keyPath: 'uid' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out;
        out = fn(s);
        t.oncomplete = function () { db.close(); resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = t.onabort = function () { db.close(); reject(t.error); };
      });
    });
  }

  var O = {
    /** Remember who is logged in and where to send (written by the page). */
    setMeta: function (m) { return tx(META, 'readwrite', function (s) { return s.put(m, 'me'); }); },
    getMeta: function () { return tx(META, 'readonly', function (s) { return s.get('me'); }).then(function (m) { return m || {}; }); },

    add: function (item) {
      item.uid = item.uid || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      item.created = item.created || Date.now();
      item.tries = 0; item.failed = false; item.error = '';
      return tx(OUT, 'readwrite', function (s) { return s.put(item); }).then(function () { return item.uid; });
    },
    list: function () {
      return tx(OUT, 'readonly', function (s) { return s.getAll(); }).then(function (a) {
        return (a || []).sort(function (x, y) { return x.created - y.created; });
      });
    },
    remove: function (uid) { return tx(OUT, 'readwrite', function (s) { return s.delete(uid); }); },
    put: function (item) { return tx(OUT, 'readwrite', function (s) { return s.put(item); }); },
    /** Let failed documents be tried again (the client tapped "Send now"). */
    retryFailed: function () {
      return O.list().then(function (a) {
        return Promise.all(a.filter(function (i) { return i.failed; }).map(function (i) { i.failed = false; i.tries = 0; i.error = ''; return O.put(i); }));
      });
    },

    /** Only one sender at a time (the page and the background may both try). */
    lock: function () {
      return tx(META, 'readwrite', function (s) {
        var req = s.get('lock'), res = { ok: false };
        req.onsuccess = function () {
          var t = req.result || 0;
          if (Date.now() - t > 120000) { s.put(Date.now(), 'lock'); res.ok = true; }
        };
        return res;
      }).then(function (res) { return res.ok; });
    },
    unlock: function () { return tx(META, 'readwrite', function (s) { return s.delete('lock'); }); },

    /**
     * Sends everything waiting for the logged-in person. onEach(item, result) is called after each one.
     * Returns { sent, failed, waiting, loggedOut, network, sentNames }.
     */
    flush: function (onEach) {
      var res = { sent: 0, failed: 0, waiting: 0, loggedOut: false, network: false, newlyFailed: 0, busy: false };
      return O.lock().then(function (got) {
        if (!got) { res.busy = true; return res; }
        return O.getMeta().then(function (me) {
          return O.list().then(function (items) {
            var mine = items.filter(function (i) { return !i.failed && i.email === me.email; });
            res.failed = items.filter(function (i) { return i.failed; }).length;
            if (!me.token || !me.engineUrl) { res.waiting = mine.length; res.loggedOut = !me.token; return res; }
            var next = function (k) {
              if (k >= mine.length || res.loggedOut || res.network) {
                res.waiting = mine.length - res.sent - res.newlyFailed;
                return res;
              }
              var it = mine[k];
              var body = { action: 'submit', token: me.token, uid: it.uid, clientCode: it.clientCode, fileName: it.fileName, mimeType: it.mimeType,
                           data: it.data, period: it.period, note: it.note, category: it.category, sub: it.sub, savedAt: it.created };
              return fetch(me.engineUrl, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(function (r) {
                  if (r.ok) { res.sent++; return O.remove(it.uid).then(function () { if (onEach) onEach(it, r); }); }
                  if (r.retry) { res.network = true; if (onEach) onEach(it, { ok: false, network: true }); return; }   // still being received — try later
                  if (r.code === 'LOGGED_OUT' && !PERMANENT.test(r.error || '')) { res.loggedOut = true; if (onEach) onEach(it, r); return; }
                  it.tries = (it.tries || 0) + 1; it.error = r.error || 'Could not be sent.';
                  if (it.tries >= MAX_TRIES || PERMANENT.test(it.error)) { it.failed = true; res.newlyFailed++; res.failed++; }
                  return O.put(it).then(function () { if (onEach) onEach(it, r); });
                }, function () { res.network = true; if (onEach) onEach(it, { ok: false, network: true }); })
                .then(function () { return next(k + 1); });
            };
            return next(0);
          });
        }).then(function (r) { return O.unlock().then(function () { return r; }); },
                function (e) { return O.unlock().then(function () { throw e; }); });
      });
    }
  };
  root.GabOutbox = O;
})(typeof self !== 'undefined' ? self : this);
