/* Gabbrielle — phone app for clients of B.R. Ramones Accounting Firm */
(function () {
  'use strict';

  var CFG = window.GABBRIELLE_CONFIG || {};
  var DEMO = !CFG.ENGINE_URL || /[?&]demo=1/.test(location.search);
  var KEY = { token: 'gab.token', email: 'gab.email', client: 'gab.client', cfg: 'gab.cfg' };

  var state = {
    cfg: { appName: 'Gabbrielle', firmName: 'B.R. Ramones Accounting Firm', docTypes: ['Sales Invoice', 'Official Receipt', 'Expense Receipt', 'BIR Form 2307', 'Bank Statement', 'Other'], maxFileMb: 15 },
    token: store('get', KEY.token),
    email: store('get', KEY.email),
    clients: [],
    client: null,
    pending: [],      // documents being read / waiting to be sent
    sending: false
  };

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------ storage
  function store(op, k, v) {
    try {
      if (op === 'get') return localStorage.getItem(k);
      if (op === 'set') localStorage.setItem(k, v);
      if (op === 'del') localStorage.removeItem(k);
    } catch (e) { /* private mode: app still works, just won't remember login */ }
    return null;
  }

  // ------------------------------------------------------------------ engine
  function call(action, payload) {
    payload = payload || {};
    payload.action = action;
    if (DEMO) return demoEngine(payload);
    return fetch(CFG.ENGINE_URL, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function () {
        return { ok: false, network: true, error: navigator.onLine ? 'Could not reach the firm\'s server. Please try again.' : 'No internet connection. Please try again when you have a signal.' };
      });
  }

  // ------------------------------------------------------------------ views
  function show(view) {
    ['viewLogin', 'viewHome'].forEach(function (v) { $(v).hidden = v !== view; });
  }
  function openSheet(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet(id) { $(id).hidden = true; document.body.style.overflow = ''; }
  function msg(el, text, ok) { el.textContent = text || ''; el.hidden = !text; el.classList.toggle('ok', !!ok); }
  function toast(text) {
    var t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Please wait…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  function applyConfig(cfg) {
    if (cfg) {
      Object.keys(cfg).forEach(function (k) { if (cfg[k] !== undefined && cfg[k] !== '') state.cfg[k] = cfg[k]; });
      store('set', KEY.cfg, JSON.stringify(state.cfg));
    }
    var c = state.cfg;
    document.querySelectorAll('[data-app-name]').forEach(function (el) { el.textContent = c.appName; });
    document.title = c.appName;
    $('loginFirm').textContent = 'by ' + c.firmName;
    var lines = [c.firmName];
    if (c.phone) lines.push('📞 ' + c.phone);
    if (c.email) lines.push('✉ ' + c.email);
    if (c.address) lines.push('📍 ' + c.address);
    if (lines.length === 1) lines.push('Message the firm directly if something isn\'t working.');
    $('contactText').textContent = lines.join('\n');
  }

  // ------------------------------------------------------------------ login
  var resendTimer = null;

  $('formEmail').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg($('loginMsg'), 'Please enter a valid Gmail address.'); return; }
    sendCode(email, $('btnSendCode'));
  });

  function sendCode(email, btn) {
    msg($('loginMsg'), '');
    busy(btn, true, 'Sending code…');
    call('requestCode', { email: email }).then(function (r) {
      busy(btn, false);
      if (!r.ok) { msg($('loginMsg'), r.error); return; }
      state.email = email;
      $('sentTo').textContent = email;
      $('formEmail').hidden = true;
      $('formCode').hidden = false;
      $('code').value = '';
      $('code').focus();
      startResendCountdown();
    });
  }

  function startResendCountdown() {
    var left = 30, b = $('btnResend');
    b.disabled = true;
    clearInterval(resendTimer);
    b.textContent = 'Send a new code (' + left + ')';
    resendTimer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(resendTimer); b.disabled = false; b.textContent = 'Send a new code'; }
      else b.textContent = 'Send a new code (' + left + ')';
    }, 1000);
  }

  $('btnResend').addEventListener('click', function () { sendCode(state.email, $('btnResend')); });
  $('btnChangeEmail').addEventListener('click', function () {
    clearInterval(resendTimer);
    $('formCode').hidden = true; $('formEmail').hidden = false; msg($('loginMsg'), ''); $('email').focus();
  });

  $('code').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 6);
    if (this.value.length === 6) $('formCode').requestSubmit ? $('formCode').requestSubmit() : verify();
  });
  $('formCode').addEventListener('submit', function (e) { e.preventDefault(); verify(); });

  function verify() {
    var code = $('code').value.trim();
    if (code.length !== 6) { msg($('loginMsg'), 'Please enter the 6-digit code from your email.'); return; }
    if (state._verifying) return;
    state._verifying = true;
    msg($('loginMsg'), '');
    busy($('btnVerify'), true, 'Checking…');
    call('verifyCode', { email: state.email, code: code }).then(function (r) {
      state._verifying = false;
      busy($('btnVerify'), false);
      if (!r.ok) { msg($('loginMsg'), r.error); $('code').select(); return; }
      clearInterval(resendTimer);
      state.token = r.token;
      store('set', KEY.token, r.token);
      store('set', KEY.email, r.email);
      enterHome(r.clients);
    });
  }

  function logout(silent, reason) {
    if (state.token && !silent) call('logout', { token: state.token });
    state.token = null; state.clients = []; state.client = null;
    store('del', KEY.token); store('del', KEY.client);
    $('formCode').hidden = true; $('formEmail').hidden = false;
    $('email').value = state.email || '';
    msg($('loginMsg'), reason || '');
    show('viewLogin');
  }

  // ------------------------------------------------------------------ home
  function enterHome(clients) {
    state.clients = clients || [];
    var saved = store('get', KEY.client);
    state.client = state.clients.filter(function (c) { return c.code === saved; })[0] || state.clients[0];
    renderBusiness();
    show('viewHome');
    loadHistory();
  }

  function renderBusiness() {
    $('businessName').textContent = state.client ? state.client.name : '—';
    $('businessCaret').hidden = state.clients.length < 2;
    if (state.client) store('set', KEY.client, state.client.code);
  }

  function loadHistory() {
    if (!state.client) return;
    var ul = $('history');
    ul.innerHTML = '<li class="muted">Loading…</li>';
    call('history', { token: state.token, clientCode: state.client.code }).then(function (r) {
      if (!r.ok) {
        if (r.code === 'LOGGED_OUT') return logout(true, r.error);
        ul.innerHTML = ''; var li = document.createElement('li'); li.className = 'muted'; li.textContent = r.error; ul.appendChild(li); return;
      }
      ul.innerHTML = '';
      if (!r.items.length) {
        ul.innerHTML = '<li class="muted">Nothing sent yet. Your documents will appear here.</li>';
        return;
      }
      r.items.forEach(function (it) {
        var li = document.createElement('li');
        var ico = el('div', 'h-ico', /pdf$/i.test(it.fileName) ? '📄' : '🧾');
        var main = el('div', 'h-main');
        main.appendChild(el('div', 'h-title', it.docType + (it.docNo ? ' No. ' + it.docNo : '') + ' · ' + monthLabel(it.period)));
        if (it.total != null && it.total !== '') main.appendChild(el('div', 'h-amt', peso(it.total) + (it.party ? ' · ' + it.party : '')));
        main.appendChild(el('div', 'h-sub', it.received + (it.note ? ' — ' + it.note : '')));
        if (it.remarks) main.appendChild(el('div', 'h-remark', 'Firm: ' + it.remarks));
        var status = String(it.status || 'New');
        var badge = el('span', 'badge ' + status.split(' ')[0], status);
        li.appendChild(ico); li.appendChild(main); li.appendChild(badge);
        ul.appendChild(li);
      });
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  $('btnRefresh').addEventListener('click', loadHistory);

  $('btnBusiness').addEventListener('click', function () {
    if (state.clients.length < 2) return;
    var body = $('menuBody'); body.innerHTML = '';
    $('menuTitle').textContent = 'Choose business';
    state.clients.forEach(function (c) {
      var b = el('button', 'menu-item' + (state.client && c.code === state.client.code ? ' active' : ''));
      b.type = 'button';
      b.appendChild(el('span', '', c.name));
      b.addEventListener('click', function () { state.client = c; renderBusiness(); closeSheet('sheetMenu'); loadHistory(); });
      body.appendChild(b);
    });
    openSheet('sheetMenu');
  });

  $('btnMenu').addEventListener('click', function () {
    var body = $('menuBody'); body.innerHTML = '';
    $('menuTitle').textContent = 'Menu';
    var who = el('div', 'menu-note', 'Logged in as ' + (store('get', KEY.email) || state.email || ''));
    var install = el('button', 'menu-item');
    install.type = 'button';
    install.innerHTML = '<span>📲 Add to Home Screen<small>Put Gabbrielle on your phone like an app</small></span>';
    install.addEventListener('click', function () { closeSheet('sheetMenu'); installHelp(); });
    var out = el('button', 'menu-item danger', 'Log out');
    out.type = 'button';
    out.addEventListener('click', function () { closeSheet('sheetMenu'); logout(false); });
    body.appendChild(install); body.appendChild(out); body.appendChild(who);
    openSheet('sheetMenu');
  });

  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeSheet(b.closest('.sheet-wrap').id); });
  });
  document.querySelectorAll('.sheet-wrap').forEach(function (w) {
    w.addEventListener('click', function (e) { if (e.target === w && w.id !== 'sheetDone' && !state.sending) closeSheet(w.id); });
  });

  // ------------------------------------------------------------------ install
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });
  function installHelp() {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; return; }
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var body = $('menuBody'); body.innerHTML = '';
    $('menuTitle').textContent = 'Add to Home Screen';
    var p = el('div', 'menu-note');
    p.style.fontSize = '15px'; p.style.color = 'inherit';
    p.textContent = ios
      ? 'In Safari, tap the Share button (square with an arrow), then tap “Add to Home Screen”.'
      : 'In Chrome, tap the ⋮ menu at the top right, then tap “Add to Home screen” or “Install app”.';
    body.appendChild(p);
    openSheet('sheetMenu');
  }

  // ------------------------------------------------------------------ choosing files
  ['inCamera', 'inFiles', 'inMore'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      addFiles(this.files);
      this.value = '';
    });
  });

  function addFiles(list) {
    var maxBytes = (state.cfg.maxFileMb || 15) * 1024 * 1024;
    var skipped = 0, added = [];
    Array.prototype.forEach.call(list || [], function (f) {
      var okType = /^image\//i.test(f.type) || /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
      if (!okType) { skipped++; return; }
      if (/pdf/i.test(f.type) && f.size > maxBytes) { skipped++; return; }
      var item = { file: f, id: Math.random().toString(36).slice(2), status: 'queued', edits: {}, docType: '', ack: false, open: false };
      state.pending.push(item); added.push(item);
    });
    if (skipped) toast(skipped + ' file(s) skipped — only photos and PDFs up to ' + state.cfg.maxFileMb + ' MB.');
    if (!state.pending.length) return;
    if ($('sheetSend').hidden) openSend(); else renderDocs();
    readQueue();
  }

  function openSend() {
    renderPeriods();
    msg($('sendMsg'), '');
    renderDocs();
    openSheet('sheetSend');
  }

  // ------------------------------------------------------------------ reading (OCR on the firm's side)
  var reading = false;
  function readQueue() {
    if (reading) return;
    var item = state.pending.filter(function (p) { return p.status === 'queued'; })[0];
    if (!item) { renderDocs(); return; }
    reading = true; item.status = 'reading'; renderDocs();
    prepare(item.file).then(function (f) {
      return call('analyze', { token: state.token, clientCode: state.client.code, fileName: f.name, mimeType: f.type, data: f.data });
    }, function () { return { ok: false, error: 'This file could not be opened.' }; }).then(function (r) {
      reading = false;
      if (!state.pending.includes(item)) return readQueue();
      if (r.code === 'LOGGED_OUT') { closeSheet('sheetSend'); clearPending(); return logout(true, r.error); }
      if (!r.ok) { item.status = 'error'; item.error = r.error; }
      else {
        item.pendingId = r.pendingId; item.analysis = r.analysis;
        item.status = !r.analysis ? 'manual' : r.analysis.sure ? 'sure' : 'ask';
        item.docType = r.analysis ? r.analysis.docType : '';
      }
      renderDocs(); readQueue();
    });
  }

  var FIELD_LABEL = { docNo: 'Document no.', docDate: 'Date', total: 'Total amount (₱)', taxWithheld: 'Tax withheld (₱)', docType: 'Type of document' };

  function renderDocs() {
    var box = $('docs'); box.innerHTML = '';
    var busy = state.pending.some(function (p) { return p.status === 'queued' || p.status === 'reading'; });
    $('readIntro').textContent = busy ? 'Gabbrielle is reading your documents…'
      : state.pending.some(function (p) { return p.status === 'ask' || p.status === 'manual'; }) ? 'Please check the highlighted items, then send.'
      : 'All documents read. Please review, then send.';
    state.pending.forEach(function (p) { box.appendChild(docCard(p)); });
    updateSendButton();
  }

  function docCard(p) {
    var an = p.analysis, st = p.status;
    var cls = st === 'sure' || st === 'sent' ? 's-sure' : st === 'ask' || st === 'manual' ? 's-ask' : st === 'error' ? 's-err' : '';
    var card = el('div', 'doc ' + cls);
    var th;
    if (/^image\//.test(p.file.type)) { th = document.createElement('img'); th.className = 'doc-thumb'; if (!p.url) p.url = URL.createObjectURL(p.file); th.src = p.url; th.alt = ''; }
    else th = el('div', 'doc-thumb', '📄');
    card.appendChild(th);
    var body = el('div', 'doc-body');
    card.appendChild(body);

    if (st === 'queued' || st === 'reading') {
      var s1 = el('div', 'doc-status'); s1.innerHTML = '<span class="spin"></span>' + (st === 'reading' ? 'Reading…' : 'Waiting…');
      body.appendChild(s1); body.appendChild(el('div', 'doc-sub', p.file.name));
    } else if (st === 'sending') {
      var s2 = el('div', 'doc-status'); s2.innerHTML = '<span class="spin"></span>Sending…'; body.appendChild(s2);
    } else if (st === 'sent') {
      body.appendChild(el('div', 'doc-status', '✓ Sent')); body.appendChild(el('div', 'doc-sub', p.sentName || ''));
    } else if (st === 'error') {
      body.appendChild(el('div', 'doc-status', '✕ Not read'));
      body.appendChild(el('div', 'doc-sub', p.error || 'Something went wrong.'));
      var retry = el('button', 'link', 'Try again'); retry.type = 'button';
      retry.addEventListener('click', function () { p.status = 'queued'; renderDocs(); readQueue(); });
      body.appendChild(retry);
    } else {
      // sure / ask / manual
      var title = st === 'sure' ? '✓ ' + (an ? an.docType + (an.fields.docNo ? ' No. ' + an.fields.docNo : '') : '')
                : st === 'manual' ? 'Please choose the document type' : '⚠ Please check';
      body.appendChild(el('div', 'doc-status', title));
      if (an) body.appendChild(el('div', 'doc-sub', subLine(an)));
      var asks = an ? an.ask : [{ field: 'docType' }];
      if (st === 'ask' && an && an.ask.length) {
        var ul = el('ul', 'doc-why');
        an.ask.forEach(function (a) { if (a.reason) ul.appendChild(el('li', '', a.reason)); });
        body.appendChild(ul);
      }
      var showFields = st !== 'sure' || p.open;
      if (showFields) body.appendChild(fieldsFor(p, asks));
      else {
        var ed = el('button', 'link doc-edit', 'Edit details'); ed.type = 'button';
        ed.addEventListener('click', function () { p.open = true; renderDocs(); });
        body.appendChild(ed);
      }
    }
    if (st !== 'sending' && st !== 'sent' && !state.sending) {
      var x = el('button', 'x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Remove');
      x.addEventListener('click', function () {
        state.pending = state.pending.filter(function (q) { return q !== p; });
        if (p.url) URL.revokeObjectURL(p.url);
        if (!state.pending.length) closeSheet('sheetSend'); else renderDocs();
      });
      card.appendChild(x);
    }
    return card;
  }

  function subLine(an) {
    var F = an.fields, bits = [];
    if (F.docDate) bits.push(niceDate(F.docDate));
    var amt = an.typeKey === 'F2307' ? F.taxWithheld : F.total;
    if (amt != null) bits.push((an.typeKey === 'F2307' ? 'tax withheld ' : '') + peso(amt));
    if (F.partyName) bits.push((an.side === 'own' ? 'to ' : 'from ') + F.partyName);
    return bits.join(' · ') || 'Some details could not be read';
  }

  function fieldsFor(p, asks) {
    var an = p.analysis, F = (an && an.fields) || {};
    var need = {}; (asks || []).forEach(function (a) { need[a.field] = true; });
    var is2307 = (p.docType || '') === 'BIR Form 2307';
    var amtKey = is2307 ? 'taxWithheld' : 'total';
    var grid = el('div', 'doc-fields');

    // type
    var tl = el('label', 'full' + (need.docType || !p.docType ? ' need' : '')); tl.appendChild(document.createTextNode(FIELD_LABEL.docType));
    var sel = document.createElement('select');
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Choose…'; sel.appendChild(o0);
    state.cfg.docTypes.forEach(function (d) { var o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o); });
    sel.value = p.docType || '';
    sel.addEventListener('change', function () { p.docType = sel.value; p.touched = true; renderDocs(); });
    tl.appendChild(sel); grid.appendChild(tl);

    if (!an && p.status === 'manual') return grid;   // not read: type is enough (firm will review)

    addInput('docNo', 'text', F.docNo || '');
    addInput('docDate', 'date', F.docDate || '');
    addInput(amtKey, 'text', F[amtKey] != null ? Number(F[amtKey]).toFixed(2) : '', 'decimal');
    if (p.status === 'ask' || p.touched) {
      var ck = el('label', 'doc-check full');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!p.ack;
      cb.addEventListener('change', function () { p.ack = cb.checked; updateSendButton(); });
      ck.appendChild(cb);
      ck.appendChild(document.createTextNode(need.duplicate ? 'Yes, this is a different document — send it' : 'I checked — these details match the document'));
      grid.appendChild(ck);
    }
    return grid;

    function addInput(key, type, val, mode) {
      var lab = el('label', (need[key] ? 'need' : '') + (key === 'total' || key === 'taxWithheld' ? ' full' : '')); lab.appendChild(document.createTextNode(FIELD_LABEL[key]));
      var inp = document.createElement('input'); inp.type = type; if (mode) inp.inputMode = mode;
      inp.value = p.edits[key] != null ? p.edits[key] : val;
      inp.addEventListener('input', function () { p.edits[key] = inp.value; var first = !p.touched; p.touched = true; p.ack = false; if (first && p.status === 'sure') { p.focusKey = key; renderDocs(); } else updateSendButton(); });
      lab.appendChild(inp); grid.appendChild(lab);
      if (p.focusKey === key) { p.focusKey = null; setTimeout(function () { inp.focus(); try { var n = inp.value.length; inp.setSelectionRange(n, n); } catch (e) {} }, 0); }
    }
  }

  /** A document is ready when it was read with certainty, or the client filled in every question. */
  function itemReady(p) {
    if (p.status === 'manual') return !!p.docType;
    if (p.status === 'sure') return !!p.docType && (!p.touched || p.ack);
    if (p.status !== 'ask' || !p.docType || !p.ack) return false;
    var F = p.analysis.fields;
    return p.analysis.ask.every(function (a) {
      if (a.field === 'duplicate' || a.field === 'docType' || a.field === 'vat') return true;
      var v = p.edits[a.field] != null ? p.edits[a.field] : F[a.field];
      if (a.field === 'total' || a.field === 'taxWithheld') {
        var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
        return !isNaN(n) && n > 0;
      }
      return v != null && String(v).trim() !== '';
    });
  }

  function niceDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
  }
  function peso(v) {
    var s = Number(v).toFixed(2).split('.');
    return '₱' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
  }

  function renderPeriods() {
    var sel = $('period'); var keep = sel.value; sel.innerHTML = '';
    var d = new Date(); d.setDate(1);
    for (var i = 0; i < 13; i++) {
      var v = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      var o = document.createElement('option'); o.value = v; o.textContent = monthLabel(v) + (i === 0 ? ' (this month)' : i === 1 ? ' (last month)' : '');
      sel.appendChild(o);
      d.setMonth(d.getMonth() - 1);
    }
    if (keep) sel.value = keep;
  }

  function monthLabel(v) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
    if (!m) return String(v || '');
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1];
  }

  function updateSendButton() {
    var todo = state.pending.filter(function (p) { return p.status !== 'sent'; });
    var busy = todo.some(function (p) { return p.status === 'queued' || p.status === 'reading'; });
    var notReady = todo.filter(function (p) { return !itemReady(p); }).length;
    var b = $('btnSend');
    b.textContent = state.sending ? 'Sending…' : busy ? 'Reading…' : notReady ? 'Check ' + notReady + ' item' + (notReady > 1 ? 's' : '') + ' above'
      : 'Send ' + todo.length + ' document' + (todo.length === 1 ? '' : 's');
    b.disabled = state.sending || busy || !todo.length || notReady > 0;
  }

  $('btnCloseSend').addEventListener('click', function () {
    if (state.sending) return;
    closeSheet('sheetSend');
    clearPending();
  });

  function clearPending() {
    state.pending.forEach(function (p) { if (p.url) URL.revokeObjectURL(p.url); });
    state.pending = []; $('note').value = '';
  }

  // ------------------------------------------------------------------ sending (confirm each read document)
  $('btnSend').addEventListener('click', function () {
    if (!navigator.onLine && !DEMO) { msg($('sendMsg'), 'No internet connection. Please try again when you have a signal.'); return; }
    sendAll();
  });

  function sendAll() {
    state.sending = true; msg($('sendMsg'), '');
    var queue = state.pending.filter(function (p) { return p.status !== 'sent'; });
    var period = $('period').value, note = $('note').value.trim();
    var failed = 0, loggedOut = null, sent = 0;

    var next = function (i) {
      if (i >= queue.length || loggedOut) return finish();
      var p = queue[i], before = p.status; p.prev = before; p.status = 'sending'; renderDocs();
      var edits = {};
      Object.keys(p.edits).forEach(function (k) { if (String(p.edits[k]).trim() !== '') edits[k] = p.edits[k]; });
      var req = p.pendingId
        ? call('confirm', { token: state.token, clientCode: state.client.code, pendingId: p.pendingId, docType: p.docType, period: period, note: note,
                            edits: edits, clientVerified: before === 'ask' || before === 'manual' || !!p.touched })
        : Promise.resolve({ ok: false, error: 'Not read yet.' });
      req.then(function (r) {
        if (r.ok) { p.status = 'sent'; p.sentName = r.fileName; sent++; }
        else { p.status = before; failed++; p.error = r.error; if (r.code === 'LOGGED_OUT') loggedOut = r.error; }
        renderDocs(); next(i + 1);
      });
    };

    var finish = function () {
      state.sending = false;
      if (loggedOut) { closeSheet('sheetSend'); clearPending(); return logout(true, loggedOut); }
      if (failed) {
        renderDocs();
        var firstErr = queue.filter(function (p) { return p.status !== 'sent'; })[0];
        msg($('sendMsg'), (sent ? sent + ' sent. ' : '') + failed + ' could not be sent: ' + (firstErr && firstErr.error || '') + ' Tap Send to try again.');
        return;
      }
      closeSheet('sheetSend');
      $('doneTitle').textContent = 'Received!';
      $('doneText').textContent = sent + ' document' + (sent === 1 ? '' : 's') + ' sent to ' + state.cfg.firmName +
        '. Gabbrielle filed ' + (sent === 1 ? 'it' : 'them') + ' for you — see “Recently sent”.';
      clearPending();
      openSheet('sheetDone');
      loadHistory();
    };
    next(0);
  }

  $('btnDone').addEventListener('click', function () { closeSheet('sheetDone'); });

  /** Photos are shrunk (max 2000px, JPEG) so they send quickly on mobile data; PDFs go as-is. */
  function prepare(file) {
    var isImg = /^image\//i.test(file.type);
    if (!isImg) return readB64(file).then(function (d) { return { name: file.name, type: 'application/pdf', data: d }; });
    return shrink(file).catch(function () { return file; }).then(function (blob) {
      var name = blob === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg';
      var type = blob.type || file.type || 'image/jpeg';
      return readB64(blob).then(function (d) { return { name: name, type: type, data: d }; });
    });
  }

  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var max = 2000, w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return reject(new Error('no size'));
        var s = Math.min(1, max / Math.max(w, h));
        if (s === 1 && file.size < 1.5 * 1024 * 1024 && /jpe?g/i.test(file.type)) return resolve(file);
        var c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function readB64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ------------------------------------------------------------------ demo engine (no real data)
  function demoEngine(p) {
    var db = demoEngine.db || (demoEngine.db = {
      access: { 'demo@gmail.com': [{ code: 'C000', name: 'Dummy Client (for testing)' }, { code: 'C000B', name: 'Dummy Client – Branch' }] },
      sessions: {}, items: [
        { clientCode: 'C000', received: 'Oct 1, 2026 9:12 AM', docType: 'Sales Invoice', period: '2026-09', note: '', fileName: 'invoice-booklet.jpg', status: 'Encoded', remarks: '' },
        { clientCode: 'C000', received: 'Oct 2, 2026 4:40 PM', docType: 'BIR Form 2307', period: '2026-09', note: 'From Municipal Treasurer', fileName: '2307.pdf', status: 'Returned to client', remarks: 'Blurred — please retake the photo' }
      ]
    });
    var reply = function (o) { return new Promise(function (res) { setTimeout(function () { res(o); }, 450); }); };
    var who = function () { return db.sessions[p.token]; };
    var allowed = function (email) { return db.access[email] || (/@/.test(email) && email !== 'notregistered@gmail.com' ? [{ code: 'C000', name: 'Dummy Client (for testing)' }] : null); };
    switch (p.action) {
      case 'config': return reply({ ok: true, phone: '0900 000 0000', email: 'firm@example.com', address: 'Quirino, Philippines' });
      case 'requestCode': return allowed(p.email) ? reply({ ok: true }) : reply({ ok: false, code: 'NOT_REGISTERED', error: 'This Gmail address isn\'t registered. Please contact B.R. Ramones Accounting Firm.' });
      case 'verifyCode':
        if (p.code !== '123456') return reply({ ok: false, error: 'Wrong code. Please check your email and try again.' });
        var t = 'demo' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxxxxxxxxxx';
        db.sessions[t] = p.email;
        return reply({ ok: true, token: t, email: p.email, clients: allowed(p.email) });
      case 'me': return who() ? reply({ ok: true, email: who(), clients: allowed(who()) }) : reply({ ok: false, code: 'LOGGED_OUT', error: 'Please log in again.' });
      case 'history':
        if (!who()) return reply({ ok: false, code: 'LOGGED_OUT', error: 'Please log in again.' });
        return reply({ ok: true, items: db.items.filter(function (i) { return i.clientCode === p.clientCode; }).slice().reverse() });
      case 'upload':
        if (!who()) return reply({ ok: false, code: 'LOGGED_OUT', error: 'Please log in again.' });
        db.items.push({ clientCode: p.clientCode, received: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), docType: p.docType, period: p.period, note: p.note, fileName: p.fileName, status: 'New', remarks: '' });
        return reply({ ok: true });
      case 'analyze':
        if (!who()) return reply({ ok: false, code: 'LOGGED_OUT', error: 'Please log in again.' });
        db.n = (db.n || 0) + 1;
        var pid = 'pend' + db.n; db.pend = db.pend || {};
        var sample = db.n % 3 === 1
          ? { typeKey: 'SI', docType: 'Sales Invoice', sure: true, ask: [], side: 'own', fields: { docNo: '00' + (12344 + db.n), docDate: '2026-10-05', total: 11200, vatable: 10000, vat: 1200, partyName: 'ABC Construction Corp.' } }
          : db.n % 3 === 2
          ? { typeKey: 'SI', docType: 'Sales Invoice', sure: false, side: 'own', fields: { docNo: '0001523' },
              ask: [{ field: 'total', reason: 'We could not read the total amount.' }, { field: 'docDate', reason: 'We could not read the date.' }] }
          : { typeKey: 'F2307', docType: 'BIR Form 2307', sure: true, ask: [], side: 'received', fields: { docDate: '2026-09-30', taxWithheld: 500, total: 50000, partyName: 'Municipality of Aglipay', atc: 'WI640' } };
        db.pend[pid] = sample;
        return new Promise(function (res) { setTimeout(function () { res({ ok: true, pendingId: pid, analysis: sample }); }, 900); });
      case 'confirm':
        if (!who()) return reply({ ok: false, code: 'LOGGED_OUT', error: 'Please log in again.' });
        var an = (db.pend || {})[p.pendingId]; if (!an) return reply({ ok: false, error: 'This document was already sent or has expired.' });
        delete db.pend[p.pendingId];
        var F = Object.assign({}, an.fields, p.edits || {});
        db.items.push({ clientCode: p.clientCode, received: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
          docType: p.docType, period: (F.docDate || p.period).slice(0, 7), note: p.note, fileName: 'scan.jpg', status: 'New', remarks: '', docNo: F.docNo || '',
          total: an.typeKey === 'F2307' ? F.taxWithheld : F.total, party: F.partyName || '' });
        return reply({ ok: true, fileName: (F.docDate || p.period) + ' – ' + (F.docNo || '') + '.jpg' });
      case 'logout': delete db.sessions[p.token]; return reply({ ok: true });
    }
    return reply({ ok: false, error: 'Unknown action.' });
  }

  // ------------------------------------------------------------------ start
  function updateOnline() { $('offline').hidden = navigator.onLine || DEMO; }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);

  function start() {
    $('demoBanner').hidden = !DEMO;
    updateOnline();
    try { var saved = JSON.parse(store('get', KEY.cfg) || 'null'); if (saved) state.cfg = saved; } catch (e) {}
    applyConfig();
    call('config').then(function (r) { if (r.ok) { delete r.ok; applyConfig(r); } });

    if (DEMO && state.token && state.token.indexOf('demo') !== 0) state.token = null;
    if (state.token) {
      // Show home right away; confirm the login is still valid in the background.
      call('me', { token: state.token }).then(function (r) {
        if (r.ok) enterHome(r.clients);
        else if (r.network) { show('viewLogin'); msg($('loginMsg'), r.error); }
        else logout(true, r.error);
      });
    } else {
      $('email').value = state.email || '';
      show('viewLogin');
    }

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  start();
})();
