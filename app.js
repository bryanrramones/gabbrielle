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
    pending: [],      // documents waiting to be sent
    sending: false,
    staff: false,     // firm staff (Bryan, Paul, firm account)
    items: [],        // this business's "Needs immediate action" list
    staffItems: { forStaff: [], waiting: [] },
    role: 'client',   // client | staff | owner
    overview: null,   // owner's clients overview
    nickname: store('get', 'gab.nick') || ''
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
    ['viewLogin', 'viewHome', 'viewNick'].forEach(function (v) { $(v).hidden = v !== view; });
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
      setNick(r.nickname);
      enterHome(r.clients, r.staff, r.role);
    });
  }

  function logout(silent, reason) {
    if (state.token && !silent) call('logout', { token: state.token });
    state.token = null; state.clients = []; state.client = null; state.staff = false;
    state.nickname = ''; store('del', 'gab.nick');
    state.items = []; state.staffItems = { forStaff: [], waiting: [] }; setBadge(0);
    store('del', KEY.token); store('del', KEY.client);
    $('formCode').hidden = true; $('formEmail').hidden = false;
    $('email').value = state.email || '';
    msg($('loginMsg'), reason || '');
    show('viewLogin');
  }

  // ------------------------------------------------------------------ home
  function enterHome(clients, staff, role) {
    state.clients = clients || [];
    state.staff = !!staff;
    state.role = role || (staff ? 'staff' : 'client');
    var saved = store('get', KEY.client);
    var link = deepLink();
    state.client = state.clients.filter(function (c) { return c.code === (link.c || saved); })[0] || state.clients[0];
    renderBusiness();
    renderGreeting();
    renderCategories();
    if (!state.nickname) { askNick(); } else show('viewHome');
    loadHistory();
    refreshItems().then(function () { openDeepLink(link); });
    setupNotifCard();
  }

  // ------------------------------------------------------------------ nickname + greeting
  function setNick(n) { if (n) { state.nickname = n; store('set', 'gab.nick', n); } }
  function renderGreeting() { $('greetHi').textContent = state.nickname ? 'Hi, ' + state.nickname + '!' : 'Hi!'; }
  function askNick() {
    $('nickFirm').textContent = state.cfg.firmName;
    $('nick').value = state.nickname || '';
    msg($('nickMsg'), '');
    show('viewNick');
    setTimeout(function () { $('nick').focus(); }, 50);
  }
  $('formNick').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('nick').value.trim();
    if (!n) { msg($('nickMsg'), 'Please type what I should call you.'); return; }
    busy($('btnNick'), true, 'Saving…');
    call('setNickname', { token: state.token, nickname: n }).then(function (r) {
      busy($('btnNick'), false);
      if (!r.ok) { if (r.code === 'LOGGED_OUT') return logout(true, r.error); msg($('nickMsg'), r.error); return; }
      setNick(r.nickname); renderGreeting(); show('viewHome');
      toast('Nice to meet you, ' + r.nickname + '!');
    });
  });

  function renderBusiness() {
    $('businessName').textContent = state.client ? state.client.name : (state.staff ? 'Firm staff' : '—');
    $('businessCaret').hidden = state.clients.length < 2;
    $('sendSection').hidden = !state.client;
    $('historyCard').hidden = !state.client;
    if (state.client) store('set', KEY.client, state.client.code);
  }

  function loadHistory(quiet) {
    if (!state.client) return Promise.resolve();
    var ul = $('history');
    if (quiet !== true) ul.innerHTML = '<li class="muted">Loading…</li>';
    return call('history', { token: state.token, clientCode: state.client.code }).then(function (r) {
      if (quiet === true && !r.ok) return;
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
        var waiting = /waiting to be read/i.test(it.docType);
        var chose = waiting ? String(it.docType).split(' – ').slice(1).join(' – ') : '';
        main.appendChild(el('div', 'h-title', (waiting ? '🕗 Being read tonight' + (chose ? ' · ' + chose : '') : it.docType + (it.docNo ? ' No. ' + it.docNo : '')) + ' · ' + monthLabel(it.period)));
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
      b.addEventListener('click', function () { state.client = c; renderBusiness(); closeSheet('sheetMenu'); loadHistory(); refreshItems(); });
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
    var nk = el('button', 'menu-item'); nk.type = 'button';
    nk.innerHTML = '<span>✏️ Change what I call you<small>Right now: ' + (state.nickname || '—').replace(/[<>&]/g, '') + '</small></span>';
    nk.addEventListener('click', function () { closeSheet('sheetMenu'); askNick(); });
    body.appendChild(nk);
    body.appendChild(install);
    if (notifState() === 'off' || notifState() === 'ask') {
      var nb = el('button', 'menu-item'); nb.type = 'button';
      nb.innerHTML = '<span>🔔 Turn on notifications<small>Know right away when the firm needs something</small></span>';
      nb.addEventListener('click', function () { closeSheet('sheetMenu'); enableNotifications(); });
      body.appendChild(nb);
    } else if (notifState() === 'on') body.appendChild(el('div', 'menu-note', '🔔 Notifications are on for this phone.'));
    body.appendChild(out); body.appendChild(who);
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

  // ------------------------------------------------------------------ the buttons: what are you sending?
  var CAT_GROUPS = [
    { title: 'Money in', cls: 'g-in', items: [
      { key: 'sales', ico: '🧾', label: 'Sales Invoices', desc: 'Cash & charge invoices you issued, delivery receipts' },
      { key: 'collections', ico: '💵', label: 'Collections', desc: 'Official / collection receipts you issued' } ] },
    { title: 'Money out', cls: 'g-out', items: [
      { key: 'purchases', ico: '🛒', label: 'Purchases', desc: 'Supplier invoices & receipts for things you bought' },
      { key: 'bills', ico: '💡', label: 'Bills & Utilities', desc: 'Electric, water, phone, internet, rent, billing statements' },
      { key: 'expenses', ico: '📝', label: 'Other Expenses', desc: 'Cash vouchers, fuel, transport, repairs, other receipts' },
      { key: 'payroll', ico: '👥', label: 'Payroll', desc: 'Salaries, payslips, SSS / PhilHealth / Pag-IBIG', cls: 'g-pay' } ] },
    { title: 'BIR & bank', cls: 'g-tax', items: [
      { key: 'f2307', ico: '🏛️', label: 'BIR 2307', desc: 'Certificate of tax withheld',
        subs: [{ key: 'received', label: 'Received from my customers', desc: 'A customer withheld tax from their payment to you' },
               { key: 'issued', label: 'Issued to my suppliers', desc: 'You withheld tax from your payment to a supplier' }] },
      { key: 'bir', ico: '📑', label: 'BIR Forms & Payments', desc: 'Filed returns, payment forms, BIR letters' },
      { key: 'bank', ico: '🏦', label: 'Bank', desc: 'Bank statements, deposit slips', cls: 'g-bank' } ] }
  ];
  var CAT_UNSURE = { key: 'unsure', ico: '❓', label: 'Not sure? Just send it', desc: 'The firm will sort it out', cls: 'g-unsure' };

  function catByKey(k) {
    var found = k === CAT_UNSURE.key ? CAT_UNSURE : null;
    CAT_GROUPS.forEach(function (g) { g.items.forEach(function (c) { if (c.key === k) found = Object.assign({ cls: g.cls }, c, { cls: c.cls || g.cls }); }); });
    return found;
  }

  function renderCategories() {
    var box = $('catGrid'); box.innerHTML = '';
    CAT_GROUPS.forEach(function (g) {
      box.appendChild(el('div', 'cat-group-title', g.title));
      var grid = el('div', 'cat-grid');
      g.items.forEach(function (c) { grid.appendChild(catTile(Object.assign({}, c, { cls: c.cls || g.cls }))); });
      box.appendChild(grid);
    });
    var u = catTile(CAT_UNSURE); u.classList.add('wide'); box.appendChild(u);
  }

  function catTile(c) {
    var b = el('button', 'cat-tile ' + c.cls); b.type = 'button';
    b.appendChild(el('span', 'cat-ico', c.ico));
    b.appendChild(el('span', 'cat-label', c.label));
    b.appendChild(el('span', 'cat-desc', c.desc));
    b.addEventListener('click', function () { openCategory(c.key); });
    return b;
  }

  function openCategory(key) {
    if (!state.client) { toast('Choose a business first.'); return; }
    var c = catByKey(key);
    state.cat = { key: key, sub: null, label: c.label, ico: c.ico, cls: c.cls };
    $('catHead').className = 'cat-head ' + c.cls;
    $('catIco').textContent = c.ico; $('catTitle').textContent = c.label; $('catDesc').textContent = c.desc;
    var subs = $('catSubs'); subs.innerHTML = '';
    if (c.subs) {
      subs.appendChild(el('p', 'cat-sub-q', 'Which one is it?'));
      c.subs.forEach(function (s) {
        var b = el('button', 'cat-sub'); b.type = 'button';
        b.appendChild(el('b', '', s.label)); b.appendChild(el('span', '', s.desc));
        b.addEventListener('click', function () {
          state.cat.sub = s.key; state.cat.label = c.label + ' – ' + s.label.toLowerCase();
          subs.querySelectorAll('.cat-sub').forEach(function (x) { x.classList.toggle('on', x === b); });
          $('catActions').hidden = false;
        });
        subs.appendChild(b);
      });
    }
    subs.hidden = !c.subs;
    $('catActions').hidden = !!c.subs;
    openSheet('sheetCat');
  }

  // ------------------------------------------------------------------ choosing files
  ['inCamera', 'inFiles', 'inMore'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      addFiles(this.files);
      this.value = '';
    });
  });

  function addFiles(list) {
    if (!state.client) { toast('Choose a business first.'); return; }
    var maxBytes = (state.cfg.maxFileMb || 15) * 1024 * 1024;
    var skipped = 0;
    Array.prototype.forEach.call(list || [], function (f) {
      var okType = /^image\//i.test(f.type) || /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
      if (!okType) { skipped++; return; }
      if (/pdf/i.test(f.type) && f.size > maxBytes) { skipped++; return; }
      state.pending.push({ file: f, id: Math.random().toString(36).slice(2), status: 'ready' });
    });
    if (skipped) toast(skipped + ' file(s) skipped — only photos and PDFs up to ' + state.cfg.maxFileMb + ' MB.');
    if (!state.pending.length) return;
    if (!$('sheetCat').hidden) closeSheet('sheetCat');
    if ($('sheetSend').hidden) openSend(); else renderDocs();
  }

  function openSend() {
    var c = state.cat || catByKey('unsure');
    $('sendTitle').innerHTML = '';
    $('sendTitle').appendChild(el('span', 'send-chip ' + (c.cls || 'g-unsure'), c.ico + ' ' + c.label));
    renderPeriods();
    msg($('sendMsg'), '');
    renderDocs();
    openSheet('sheetSend');
  }

  function renderDocs() {
    var box = $('docs'); box.innerHTML = '';
    $('readIntro').textContent = 'The firm reads everything tonight — no need to type anything. If something is unclear, it will show up under “Needs immediate action”.';
    state.pending.forEach(function (p) { box.appendChild(docCard(p)); });
    updateSendButton();
  }

  function docCard(p) {
    var st = p.status;
    var card = el('div', 'doc ' + (st === 'sent' ? 's-sure' : st === 'error' ? 's-err' : ''));
    var th;
    if (/^image\//.test(p.file.type)) { th = document.createElement('img'); th.className = 'doc-thumb'; if (!p.url) p.url = URL.createObjectURL(p.file); th.src = p.url; th.alt = ''; }
    else th = el('div', 'doc-thumb', '📄');
    card.appendChild(th);
    var body = el('div', 'doc-body');
    card.appendChild(body);
    if (st === 'sending') {
      var s2 = el('div', 'doc-status'); s2.innerHTML = '<span class="spin"></span>Sending…'; body.appendChild(s2);
    } else if (st === 'sent') {
      body.appendChild(el('div', 'doc-status', '✓ Sent'));
    } else if (st === 'error') {
      body.appendChild(el('div', 'doc-status', '✕ Not sent'));
      body.appendChild(el('div', 'doc-sub', p.error || 'Something went wrong.'));
    } else {
      body.appendChild(el('div', 'doc-status', /^image\//.test(p.file.type) ? 'Photo' : 'PDF file'));
    }
    if (st !== 'sending' && st !== 'sent') body.appendChild(el('div', 'doc-sub', p.file.name));
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
    var b = $('btnSend');
    b.textContent = state.sending ? 'Sending…' : 'Send ' + todo.length + ' document' + (todo.length === 1 ? '' : 's');
    b.disabled = state.sending || !todo.length;
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

  // ------------------------------------------------------------------ sending
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
      var p = queue[i]; p.status = 'sending'; renderDocs();
      prepare(p.file).then(function (f) {
        return call('submit', { token: state.token, clientCode: state.client.code, fileName: f.name, mimeType: f.type, data: f.data, period: period, note: note,
                                category: state.cat ? state.cat.key : 'unsure', sub: state.cat ? state.cat.sub : null });
      }, function () { return { ok: false, error: 'This file could not be opened.' }; }).then(function (r) {
        if (r.ok) { p.status = 'sent'; sent++; }
        else { p.status = 'error'; failed++; p.error = r.error; if (r.code === 'LOGGED_OUT') loggedOut = r.error; }
        renderDocs(); next(i + 1);
      });
    };

    var finish = function () {
      state.sending = false;
      if (loggedOut) { closeSheet('sheetSend'); clearPending(); return logout(true, loggedOut); }
      if (failed) {
        renderDocs();
        var firstErr = queue.filter(function (p) { return p.status === 'error'; })[0];
        msg($('sendMsg'), (sent ? sent + ' sent. ' : '') + failed + ' could not be sent: ' + (firstErr && firstErr.error || '') + ' Tap Send to try again.');
        return;
      }
      closeSheet('sheetSend');
      $('doneTitle').textContent = 'Received!';
      $('doneText').textContent = sent + ' document' + (sent === 1 ? '' : 's') + ' sent to ' + state.cfg.firmName +
        '. The firm will read ' + (sent === 1 ? 'it' : 'them') + ' tonight. If anything is unclear, you\'ll see it under “Needs immediate action”.';
      clearPending();
      openSheet('sheetDone');
      loadHistory();
    };
    next(0);
  }

  $('btnDone').addEventListener('click', function () { closeSheet('sheetDone'); maybeAskNotifications(); });

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
        var max = 2200, w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return reject(new Error('no size'));
        var s = Math.min(1, max / Math.max(w, h));
        if (s === 1 && file.size < 1.5 * 1024 * 1024 && /jpe?g/i.test(file.type)) return resolve(file);
        var c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob')); }, 'image/jpeg', 0.85);
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

  // ------------------------------------------------------------------ "Needs immediate action" (client) + "To check" (staff)
  function refreshItems() {
    var jobs = [];
    if (state.client) jobs.push(call('items', { token: state.token, clientCode: state.client.code }).then(function (r) {
      if (r.ok) state.items = r.items || [];
      else if (r.code === 'LOGGED_OUT') return logout(true, r.error);
    }));
    if (state.staff) jobs.push(call('items', { token: state.token, scope: 'staff' }).then(function (r) {
      if (r.ok) state.staffItems = { forStaff: r.forStaff || [], waiting: r.waiting || [] };
    }));
    if (state.role === 'owner') jobs.push(call('ownerOverview', { token: state.token }).then(function (r) { if (r.ok) state.overview = r; }));
    return Promise.all(jobs).then(renderCounts);
  }

  function renderCounts() {
    var n = state.items.length;
    $('btnAction').hidden = !n;
    $('actionCount').textContent = n;
    $('staffCard').hidden = !state.staff;
    var owner = state.role === 'owner';
    $('staffTitle').textContent = owner ? 'Owner' : 'Firm staff';
    $('staffSheetTitle').textContent = owner ? 'Owner – to check' : 'Firm staff';
    $('btnOwner').hidden = !owner;
    var tp = owner && state.overview ? (state.overview.toPost || 0) : 0;
    $('btnToPost').hidden = !owner;
    $('toPostCount').textContent = tp; $('toPostCount').classList.toggle('zero', !tp);
    var quiet = owner && state.overview ? state.overview.clients.filter(function (c) { return c.quiet; }).length : 0;
    $('ownerQuietCount').textContent = quiet; $('ownerQuietCount').hidden = !quiet;
    if (owner && !$('sheetOwner').hidden) renderOwnerSheet();
    var a = state.staffItems.forStaff.length, w = state.staffItems.waiting.length;
    $('staffCheckCount').textContent = a; $('staffCheckCount').classList.toggle('zero', !a);
    $('staffWaitCount').textContent = w;
    $('staffSummary').textContent = a ? a + ' detail' + (a === 1 ? '' : 's') + ' from Claude to check.' : 'Nothing to check right now.';
    setBadge(n + (state.staff ? a : 0) + tp);
    if (!$('sheetAction').hidden) renderActionSheet();
    if (!$('sheetStaff').hidden) renderStaffSheet();
  }

  function setBadge(n) {
    try { if (navigator.setAppBadge) { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } } catch (e) {}
  }

  $('btnAction').addEventListener('click', function () { renderActionSheet(); openSheet('sheetAction'); });
  $('btnStaffCheck').addEventListener('click', function () { state.staffTab = 'check'; renderStaffSheet(); openSheet('sheetStaff'); });
  $('btnStaffWait').addEventListener('click', function () { state.staffTab = 'wait'; renderStaffSheet(); openSheet('sheetStaff'); });
  $('tabCheck').addEventListener('click', function () { state.staffTab = 'check'; renderStaffSheet(); });
  $('tabWait').addEventListener('click', function () { state.staffTab = 'wait'; renderStaffSheet(); });

  function renderActionSheet() {
    var box = $('actionList'); box.innerHTML = '';
    $('actionIntro').textContent = state.items.length
      ? 'The firm needs your help with ' + (state.items.length === 1 ? 'this' : 'these') + ' for ' + (state.client ? state.client.name : '') + '. Look at your copy of the document, then answer.'
      : 'All done — nothing needs your action. Thank you!';
    state.items.forEach(function (it) { box.appendChild(itemCard(it, 'client')); });
  }

  function renderStaffSheet() {
    var tab = state.staffTab || 'check';
    $('tabCheck').setAttribute('aria-pressed', tab === 'check'); $('tabWait').setAttribute('aria-pressed', tab === 'wait');
    $('tabCheck').textContent = 'To check (' + state.staffItems.forStaff.length + ')';
    $('tabWait').textContent = 'Waiting for client (' + state.staffItems.waiting.length + ')';
    var list = tab === 'check' ? state.staffItems.forStaff : state.staffItems.waiting;
    var box = $('staffList'); box.innerHTML = '';
    if (!list.length) box.appendChild(el('p', 'muted', tab === 'check' ? 'Nothing to check. 🎉' : 'No client is being asked right now.'));
    list.forEach(function (it) { box.appendChild(itemCard(it, tab === 'check' ? 'staff' : 'waiting')); });
  }

  /** One question. mode: client | staff | waiting */
  function itemCard(it, mode) {
    var card = el('div', 'qa');
    var head = el('div', 'qa-head');
    if (mode !== 'client') head.appendChild(el('div', 'qa-client', it.client + (mode === 'waiting' ? ' · waiting ' + it.daysWaiting + ' day' + (it.daysWaiting === 1 ? '' : 's') : '')));
    head.appendChild(el('div', 'qa-doc', it.doc));
    card.appendChild(head);
    card.appendChild(el('div', 'qa-q', it.question));
    if (it.note && mode !== 'staff') card.appendChild(el('div', 'qa-note', (mode === 'client' ? 'Note from the firm: ' : 'Your note: ') + it.note));

    var photo = el('button', 'link qa-photo', '📷 See the photo'); photo.type = 'button';
    photo.addEventListener('click', function () { showPhoto(it, photo); });
    card.appendChild(photo);

    var hasGuess = it.guess !== null && it.guess !== undefined && it.guess !== '';
    var shown = hasGuess ? (it.kind === 'money' ? peso(it.guess) : it.kind === 'date' ? niceDate(String(it.guess)) : String(it.guess)) : '';
    var actions = el('div', 'qa-actions');
    if (hasGuess) {
      var guess = el('div', 'qa-guess'); guess.appendChild(el('span', '', (mode === 'client' ? 'We read: ' : 'Claude read: '))); guess.appendChild(el('b', '', shown));
      card.appendChild(guess);
      var yes = el('button', 'btn ok small', '✓ That\'s correct'); yes.type = 'button';
      yes.addEventListener('click', function () { answer(it, { accept: true }, card, yes); });
      actions.appendChild(yes);
    }
    // input for the right value
    var row = el('div', 'qa-input');
    var inp;
    if (it.kind === 'type') {
      inp = document.createElement('select');
      var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Choose…'; inp.appendChild(o0);
      (it.choices || state.cfg.docTypes || []).forEach(function (d) { var o = document.createElement('option'); o.value = d; o.textContent = d; inp.appendChild(o); });
    } else {
      inp = document.createElement('input');
      inp.type = it.kind === 'date' ? 'date' : 'text';
      if (it.kind === 'money') { inp.inputMode = 'decimal'; inp.placeholder = 'Amount, e.g. 2350.00'; }
      else if (it.kind === 'note') inp.placeholder = mode === 'client' ? 'Type your answer' : 'Type the answer or what was done';
      else { var lbl = /^[A-Z]+$/.test(it.label) ? it.label : it.label.toLowerCase(); inp.placeholder = hasGuess ? 'Or type the right ' + lbl : 'Type the ' + lbl; }
    }
    var save = el('button', 'btn primary small', mode === 'client' ? 'Send answer' : 'Save'); save.type = 'button';
    save.addEventListener('click', function () {
      if (!String(inp.value).trim()) { inp.focus(); return; }
      answer(it, { value: inp.value }, card, save);
    });
    row.appendChild(inp); row.appendChild(save);
    card.appendChild(actions);
    card.appendChild(row);

    if (mode !== 'client') {
      var more = el('div', 'qa-staff');
      if (mode === 'staff') {
        var ask = el('button', 'btn ghost small', '💬 Ask client further'); ask.type = 'button';
        ask.addEventListener('click', function () {
          if (card.querySelector('.qa-ask')) return;
          var box = el('div', 'qa-ask');
          var ta = document.createElement('textarea'); ta.rows = 2; ta.maxLength = 300;
          ta.placeholder = 'Optional note to the client, e.g. “Please check your copy of the receipt.”';
          var go = el('button', 'btn primary small', 'Send to ' + it.client); go.type = 'button';
          go.addEventListener('click', function () {
            busy(go, true, 'Sending…');
            call('askClient', { token: state.token, id: it.id, note: ta.value.trim() }).then(function (r) {
              if (!r.ok) { busy(go, false); toast(r.error); return; }
              toast(r.notified ? 'Sent to the client — their phone was notified.' : 'Sent. The client will see it when they open Gabbrielle.');
              done(card); refreshItems();
            });
          });
          box.appendChild(ta); box.appendChild(go);
          more.appendChild(box);
        });
        more.appendChild(ask);
      }
      var skip = el('button', 'link muted-link', 'No answer needed'); skip.type = 'button';
      skip.addEventListener('click', function () {
        busy(skip, true, 'Please wait…');
        call('dismiss', { token: state.token, id: it.id }).then(function (r) {
          if (!r.ok) { busy(skip, false); toast(r.error); return; }
          done(card); refreshItems();
        });
      });
      more.appendChild(skip);
      if (it.link) { var open = document.createElement('a'); open.className = 'link'; open.href = it.link; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open in Drive'; more.appendChild(open); }
      card.appendChild(more);
    }
    return card;
  }

  function answer(it, payload, card, btn) {
    payload.token = state.token; payload.id = it.id;
    busy(btn, true, 'Saving…');
    call('answer', payload).then(function (r) {
      if (!r.ok) { busy(btn, false); toast(r.error); return; }
      toast('Thank you! Saved: ' + r.text);
      done(card); refreshItems();
    });
  }

  function done(card) { card.classList.add('qa-done'); setTimeout(function () { card.remove(); }, 350); }

  function showPhoto(it, btn) {
    if (it._img) return openViewer(it._img);
    busy(btn, true, 'Loading photo…');
    call('itemImage', { token: state.token, id: it.id }).then(function (r) {
      busy(btn, false);
      if (!r.ok) { toast(r.error || 'Photo not available.'); return; }
      it._img = 'data:' + r.mime + ';base64,' + r.data;
      openViewer(it._img);
    });
  }
  // ---- photo viewer: pinch to zoom, drag to move, double-tap to zoom, ✕ / Back to close
  var VZ = { s: 1, tx: 0, ty: 0, pts: {}, pinch: null, pan: null, moved: false, lastTap: 0 };
  var VZ_MAX = 5;
  function vzApply() { $('viewerImg').style.transform = 'translate(' + VZ.tx + 'px,' + VZ.ty + 'px) scale(' + VZ.s + ')'; $('viewer').classList.toggle('zoom', VZ.s > 1.01); }
  function vzClamp() {
    var img = $('viewerImg'), v = $('viewer'), W = img.offsetWidth * VZ.s, H = img.offsetHeight * VZ.s, bx = img.offsetLeft, by = img.offsetTop, vw = v.clientWidth, vh = v.clientHeight;
    VZ.tx = W <= vw ? (vw - W) / 2 - bx : Math.min(-bx, Math.max(vw - W - bx, VZ.tx));
    VZ.ty = H <= vh ? (vh - H) / 2 - by : Math.min(-by, Math.max(vh - H - by, VZ.ty));
  }
  /** Zoom to scale s keeping the screen point (px, py) still. */
  function vzZoomAt(s, px, py) {
    var img = $('viewerImg'), r = $('viewer').getBoundingClientRect();
    s = Math.max(1, Math.min(VZ_MAX, s));
    var bx = img.offsetLeft, by = img.offsetTop, x = px - r.left, y = py - r.top;
    var u = (x - bx - VZ.tx) / VZ.s, w = (y - by - VZ.ty) / VZ.s;
    VZ.s = s; VZ.tx = x - bx - u * s; VZ.ty = y - by - w * s;
    vzClamp(); vzApply();
  }
  function vzReset() { VZ.s = 1; VZ.tx = 0; VZ.ty = 0; VZ.pts = {}; VZ.pinch = null; VZ.pan = null; vzApply(); }

  function openViewer(src) {
    var v = $('viewer'), img = $('viewerImg'), pdf = /^data:application\/pdf/.test(src);
    if (pdf) { var w = window.open(); if (w) w.document.write('<iframe src="' + src + '" style="border:0;width:100%;height:100%"></iframe>'); return; }
    img.src = src; vzReset(); v.hidden = false;
    try { history.pushState({ viewer: 1 }, ''); } catch (e) {}
  }
  function closeViewer(fromBack) {
    var v = $('viewer'); if (v.hidden) return;
    v.hidden = true; vzReset(); $('viewerImg').src = '';
    if (!fromBack) { try { if (history.state && history.state.viewer) history.back(); } catch (e) {} }
  }
  $('viewerClose').addEventListener('click', function (e) { e.stopPropagation(); closeViewer(false); });
  (function () {
    var v = $('viewer');
    var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
    v.addEventListener('pointerdown', function (e) {
      if (e.target === $('viewerClose')) return;
      try { v.setPointerCapture(e.pointerId); } catch (x) {}
      VZ.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(VZ.pts);
      if (ids.length === 1) { VZ.moved = false; VZ.pan = { x: e.clientX, y: e.clientY, tx: VZ.tx, ty: VZ.ty }; VZ.downOn = e.target; }
      if (ids.length === 2) {
        var a = VZ.pts[ids[0]], b = VZ.pts[ids[1]];
        VZ.pinch = { d: dist(a, b), s: VZ.s }; VZ.pan = null; VZ.moved = true;
      }
    });
    v.addEventListener('pointermove', function (e) {
      if (!VZ.pts[e.pointerId]) return;
      VZ.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(VZ.pts);
      if (ids.length >= 2 && VZ.pinch) {
        var a = VZ.pts[ids[0]], b = VZ.pts[ids[1]];
        vzZoomAt(VZ.pinch.s * dist(a, b) / VZ.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (VZ.pan) {
        var dx = e.clientX - VZ.pan.x, dy = e.clientY - VZ.pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) VZ.moved = true;
        if (VZ.s > 1) { VZ.tx = VZ.pan.tx + dx; VZ.ty = VZ.pan.ty + dy; vzClamp(); vzApply(); }
      }
    });
    var up = function (e) {
      if (!VZ.pts[e.pointerId]) return;
      delete VZ.pts[e.pointerId];
      var left = Object.keys(VZ.pts);
      if (left.length === 1) { var p = VZ.pts[left[0]]; VZ.pinch = null; VZ.pan = { x: p.x, y: p.y, tx: VZ.tx, ty: VZ.ty }; return; }
      if (left.length) return;
      VZ.pinch = null; VZ.pan = null;
      if (VZ.moved || e.type === 'pointercancel') return;
      // a tap
      var now = Date.now();
      if (VZ.downOn === $('viewerImg')) {
        if (now - VZ.lastTap < 320) { VZ.lastTap = 0; if (VZ.s > 1.01) { vzReset(); } else vzZoomAt(2.5, e.clientX, e.clientY); }
        else VZ.lastTap = now;
      } else if (VZ.s <= 1.01) closeViewer(false);   // tap on the dark area closes (only when not zoomed)
    };
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', function (e) { e.preventDefault(); vzZoomAt(VZ.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
    window.addEventListener('resize', function () { if (!v.hidden) { vzClamp(); vzApply(); } });
  })();
  window.addEventListener('popstate', function () { closeViewer(true); });             // phone Back button
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeViewer(false); });

  $('btnRefresh').addEventListener('click', refreshItems);

  // ------------------------------------------------------------------ keeping the screen fresh
  /** Every minute while the app is open on the home screen (and no window is open on top), check for news quietly. */
  function quietRefresh() {
    if (!state.token || $('viewHome').hidden || document.visibilityState !== 'visible' || !navigator.onLine) return Promise.resolve();
    return Promise.all([refreshItems(), loadHistory(true)]);
  }
  setInterval(function () {
    var sheetOpen = Array.prototype.some.call(document.querySelectorAll('.sheet-wrap'), function (w) { return !w.hidden; });
    if (!sheetOpen && !state.sending) quietRefresh();
  }, 60000);

  /** Pull down to refresh (phones switch this off for home-screen apps, so Gabbrielle does it itself). */
  (function pullToRefresh() {
    var startY = null, dist = 0, busyNow = false, ptr = $('ptr'), LIMIT = 70;
    function canPull() { return !busyNow && !$('viewHome').hidden && document.body.style.overflow !== 'hidden' && (window.scrollY || document.documentElement.scrollTop) <= 0; }
    window.addEventListener('touchstart', function (e) { startY = canPull() && e.touches.length === 1 ? e.touches[0].clientY : null; dist = 0; }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (startY === null) return;
      dist = Math.max(0, e.touches[0].clientY - startY);
      if (dist < 8) { ptr.hidden = true; return; }
      ptr.hidden = false;
      var d = Math.min(dist, LIMIT * 1.4);
      ptr.style.transform = 'translate(-50%, ' + (d * 0.6) + 'px)';
      ptr.textContent = dist > LIMIT ? '↻ Release to refresh' : '↓ Pull to refresh';
    }, { passive: true });
    window.addEventListener('touchend', function () {
      if (startY === null) return;
      startY = null;
      if (dist <= LIMIT) { ptr.hidden = true; return; }
      busyNow = true; ptr.textContent = 'Refreshing…'; ptr.classList.add('spin-on');
      quietRefresh().then(function () {
        busyNow = false; ptr.classList.remove('spin-on'); ptr.hidden = true; toast('Up to date ✓');
      });
    });
  })();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.token && !$('viewHome').hidden) { refreshItems(); }
  });

  // ------------------------------------------------------------------ owner: clients overview + tools
  $('btnOwner').addEventListener('click', function () { renderOwnerSheet(); openSheet('sheetOwner'); refreshItems(); });

  var QUIET_CHOICES = [0, 3, 5, 7, 10, 14, 21, 30];
  function ownerDo(payload, btn, after) {
    payload.token = state.token;
    if (btn) busy(btn, true, 'Please wait…');
    return call('ownerDo', payload).then(function (r) {
      if (btn) busy(btn, false);
      toast(r.ok ? r.text : r.error);
      if (r.ok) { if (after) after(r); refreshItems(); }
      return r;
    });
  }

  function renderOwnerSheet() {
    var ov = state.overview, box = $('ownerBody'); box.innerHTML = '';
    if (!ov) { box.appendChild(el('p', 'muted', 'Loading…')); return; }
    var quiet = ov.clients.filter(function (c) { return c.quiet; }).length;
    var open = ov.clients.reduce(function (t, c) { return t + c.withStaff + c.withClient; }, 0);
    var sum = el('div', 'own-sum');
    [[ov.clients.filter(function (c) { return c.active; }).length, 'active clients'], [quiet, 'quiet'], [open, 'open questions']].forEach(function (x, i) {
      var t = el('div', 'own-tile' + (i === 1 && x[0] ? ' warn' : '')); t.appendChild(el('b', '', String(x[0]))); t.appendChild(el('span', '', x[1])); sum.appendChild(t);
    });
    box.appendChild(sum);

    box.appendChild(el('h4', 'own-h', 'Clients'));
    ov.clients.forEach(function (c) { box.appendChild(clientCard(c)); });

    // add a client
    var add = el('details', 'own-more'); add.appendChild(el('summary', '', '＋ Add a client'));
    var f = el('div', 'own-form');
    var code = inputEl('Client code (e.g. C021)'), name = inputEl('Business name'), mail = inputEl('Client\'s Gmail', 'email');
    var go = el('button', 'btn primary small', 'Add client'); go.type = 'button';
    go.addEventListener('click', function () { ownerDo({ what: 'addClient', code: code.value, name: name.value, email: mail.value }, go, function () { code.value = name.value = mail.value = ''; }); });
    [code, name, mail, go].forEach(function (x) { f.appendChild(x); });
    f.appendChild(el('p', 'hint', 'Tip: same code + another Gmail gives a second person access to the same business.'));
    add.appendChild(f); box.appendChild(add);

    // staff
    var st = el('details', 'own-more'); st.appendChild(el('summary', '', '👥 Staff (' + ov.staff.length + ')'));
    var sf = el('div', 'own-form');
    ov.staff.forEach(function (e) {
      var row = el('div', 'own-row'); row.appendChild(el('span', '', e));
      var rm = el('button', 'link danger-link', 'Remove'); rm.type = 'button';
      rm.addEventListener('click', function () { if (confirmTwice(rm)) ownerDo({ what: 'removeStaff', email: e }, rm); });
      row.appendChild(rm); sf.appendChild(row);
    });
    var sm = inputEl('Staff Gmail to add', 'email'), sg = el('button', 'btn ghost small', 'Add staff'); sg.type = 'button';
    sg.addEventListener('click', function () { ownerDo({ what: 'addStaff', email: sm.value }, sg, function () { sm.value = ''; }); });
    sf.appendChild(sm); sf.appendChild(sg); st.appendChild(sf); box.appendChild(st);

    // log someone out
    var lo = el('details', 'own-more'); lo.appendChild(el('summary', '', '🔒 Log someone out (lost phone)'));
    var lf = el('div', 'own-form');
    var sel = document.createElement('select');
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Choose who…'; sel.appendChild(o0);
    ov.loggedIn.filter(function (e) { return e !== ov.owner; }).forEach(function (e) { var o = document.createElement('option'); o.value = e; o.textContent = e; sel.appendChild(o); });
    var lg = el('button', 'btn ghost small', 'Log out on all devices'); lg.type = 'button';
    lg.addEventListener('click', function () { if (sel.value) ownerDo({ what: 'logout', email: sel.value }, lg); });
    lf.appendChild(sel); lf.appendChild(lg); lo.appendChild(lf); box.appendChild(lo);
  }

  function clientCard(c) {
    var card = el('div', 'own-client' + (c.quiet ? ' quiet' : '') + (c.active ? '' : ' off'));
    var head = el('div', 'own-head');
    head.appendChild(el('b', '', c.name));
    head.appendChild(el('span', 'own-code', c.code + (c.active ? '' : ' · access off')));
    card.appendChild(head);
    card.appendChild(el('div', 'own-line' + (c.quiet ? ' red' : ''),
      c.neverSent ? 'Nothing sent yet' + (c.daysQuiet != null ? ' (added ' + c.daysQuiet + ' day' + (c.daysQuiet === 1 ? '' : 's') + ' ago)' : '')
                  : 'Last sent: ' + c.lastSent + ' · ' + (c.daysQuiet === 0 ? 'today' : c.daysQuiet + ' day' + (c.daysQuiet === 1 ? '' : 's') + ' ago')));
    card.appendChild(el('div', 'own-line', 'This month: ' + c.thisMonth + ' document' + (c.thisMonth === 1 ? '' : 's')));
    if (c.withStaff || c.withClient) {
      var bits = [];
      if (c.withStaff) bits.push(c.withStaff + ' to check');
      if (c.withClient) bits.push(c.withClient + ' waiting for client' + (c.oldestAsk ? ' (' + c.oldestAsk + ' day' + (c.oldestAsk === 1 ? '' : 's') + ')' : ''));
      card.appendChild(el('div', 'own-line amber', 'Open questions: ' + bits.join(' · ')));
    }
    var ctr = el('div', 'own-ctrls');
    var rem = el('button', 'btn ghost small', '🔔 Remind to send'); rem.type = 'button';
    rem.disabled = !c.active;
    rem.addEventListener('click', function () { ownerDo({ what: 'remind', code: c.code }, rem); });
    ctr.appendChild(rem);
    var ql = el('label', 'own-quiet'); ql.appendChild(document.createTextNode('Alert if quiet'));
    var qs = document.createElement('select');
    var choices = QUIET_CHOICES.indexOf(c.quietDays) === -1 ? QUIET_CHOICES.concat([c.quietDays]).sort(function (a, b) { return a - b; }) : QUIET_CHOICES;
    choices.forEach(function (d) { var o = document.createElement('option'); o.value = d; o.textContent = d ? d + ' days' : 'Never'; qs.appendChild(o); });
    qs.value = String(c.quietDays);
    qs.addEventListener('change', function () { ownerDo({ what: 'quietDays', code: c.code, days: Number(qs.value) }); });
    ql.appendChild(qs); ctr.appendChild(ql);
    var acc = el('button', 'link ' + (c.active ? 'danger-link' : ''), c.active ? 'Switch off access' : 'Switch access on'); acc.type = 'button';
    acc.addEventListener('click', function () { if (!c.active || confirmTwice(acc)) ownerDo({ what: 'access', code: c.code, on: !c.active }, acc); });
    ctr.appendChild(acc);
    card.appendChild(ctr);
    return card;
  }

  // ------------------------------------------------------------------ owner: to post in Cl@ud
  $('btnToPost').addEventListener('click', function () { openPostSheet(); });
  function openPostSheet() {
    var box = $('postList'); box.innerHTML = ''; box.appendChild(el('p', 'muted', 'Loading…'));
    openSheet('sheetPost');
    return call('toPost', { token: state.token }).then(function (r) {
      box.innerHTML = '';
      if (!r.ok) { if (r.code === 'LOGGED_OUT') return logout(true, r.error); box.appendChild(el('p', 'muted', r.error || 'Could not load the list.')); return; }
      var items = r.items || [];
      if (!items.length) { box.appendChild(el('p', 'muted', 'Nothing to post. Cl@ud has everything. 🎉')); return; }
      items.forEach(function (it) { box.appendChild(postCard(it)); });
    });
  }

  function acctText(a) { return a ? a[0] + (a[1] ? ' ' + a[1] : '') : '—'; }

  /** One draft from Cl@ud. */
  var BOOK_NAMES = { CDJ: 'Cash Disbursements', CRJ: 'Cash Receipts', GJ: 'General Journal', Certificates: '2307 Register' };
  function bookName(b) {
    var k = String(b || '').split(/\s*[–-]\s*/)[0].trim();
    var rest = String(b || '').slice(k.length).replace(/^\s*[–-]\s*/, '');
    return (BOOK_NAMES[k] || k || 'Entry') + (rest ? ' · ' + rest : '');
  }
  function money(v) { return peso(v).replace('₱', ''); }
  function r2(v) { return Math.round(v * 100) / 100; }

  /** The full entry, the way Cl@ud will post it. chosen = [code, name] for the side the owner picks. */
  function draftLines(it, chosen) {
    var gross = Number(it.amount) || 0, lines = [], book = String(it.book || '');
    var tax = it.tax || { vatClient: Number(it.vat) > 0, docVat: Number(it.vat) || 0, ivat: ['1300', 'Input VAT'], ovat: ['2100', 'Output VAT'] };
    var dr = it.debit, cr = it.credit;
    if (chosen) { if (/^CRJ/.test(book)) cr = chosen; else dr = chosen; }
    if (/^CDJ/.test(book) && !it.manual) {
      var personal = dr && /^3/.test(dr[0]);
      if (tax.vatClient && tax.docVat > 0 && !personal) {
        var net = r2(gross / 1.12);
        lines.push({ a: dr, d: net }, { a: tax.ivat, d: r2(gross - net) });
      } else lines.push({ a: dr, d: gross });
      lines.push({ a: cr, c: gross });
    } else if (/^CRJ/.test(book) && !it.manual) {
      lines.push({ a: dr, d: gross });
      if (tax.vatClient) { var n2 = r2(gross / 1.12); lines.push({ a: cr, c: n2 }, { a: tax.ovat, c: r2(gross - n2) }); }
      else lines.push({ a: cr, c: gross });
    } else {
      if (dr) lines.push({ a: dr, d: gross });
      if (cr) lines.push({ a: cr, c: gross });
    }
    return lines;
  }

  function entryTable(lines) {
    var t = document.createElement('table'); t.className = 'je';
    var h = t.createTHead().insertRow();
    ['Account', 'Debit', 'Credit'].forEach(function (x) { var th = document.createElement('th'); th.textContent = x; h.appendChild(th); });
    var b = t.createTBody(), td = 0, tc = 0;
    lines.forEach(function (l) {
      var row = b.insertRow(); row.className = l.c ? 'cr' : 'dr';
      var c0 = row.insertCell(), c1 = row.insertCell(), c2 = row.insertCell();
      if (l.a) { c0.appendChild(el('span', 'je-code', l.a[0])); c0.appendChild(document.createTextNode(' ' + (l.a[1] || ''))); }
      else c0.appendChild(el('span', 'je-pick', 'Choose the account below'));
      c1.textContent = l.d ? money(l.d) : ''; c2.textContent = l.c ? money(l.c) : '';
      td += l.d || 0; tc += l.c || 0;
    });
    var f = t.createTFoot().insertRow();
    f.insertCell().textContent = 'Total'; f.insertCell().textContent = money(td); f.insertCell().textContent = money(tc);
    return t;
  }

  function accountSelect(opts, cur, label) {
    var sel = document.createElement('select');
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = label + ' — choose…'; sel.appendChild(o0);
    var groups = { '1': 'Assets', '2': 'Liabilities', '3': 'Owner\'s equity', '4': 'Income', '5': 'Cost of sales', '6': 'Expenses' }, made = {};
    opts.forEach(function (a) {
      var g = groups[String(a[0]).charAt(0)] || 'Other';
      if (!made[g]) { made[g] = document.createElement('optgroup'); made[g].label = g; sel.appendChild(made[g]); }
      var o = document.createElement('option'); o.value = a[0]; o.textContent = acctText(a); if (cur && cur[0] === a[0]) o.selected = true;
      made[g].appendChild(o);
    });
    return sel;
  }

  function postCard(it) {
    var card = el('div', 'pc');
    // header: client + date
    var top = el('div', 'pc-top');
    top.appendChild(el('span', 'pc-chip', it.code));
    top.appendChild(el('span', 'pc-client', it.client));
    top.appendChild(el('span', 'pc-date', it.date ? niceDate(it.date) : 'no date'));
    card.appendChild(top);
    // document
    var doc = el('div', 'pc-doc');
    doc.appendChild(el('div', 'pc-type', (it.docType || 'Document') + (it.docNo ? ' · No. ' + it.docNo : '')));
    if (it.party) doc.appendChild(el('div', 'pc-party', it.party));
    if (it.partyTin) doc.appendChild(el('div', 'pc-tin', 'TIN ' + it.partyTin));
    card.appendChild(doc);
    if (it.amount != null && it.amount !== '') {
      var amt = el('div', 'pc-amount');
      amt.appendChild(el('span', 'pc-amount-label', 'Total'));
      amt.appendChild(el('span', 'pc-amount-val', peso(it.amount)));
      card.appendChild(amt);
    }
    if (it.why) { var why = el('div', 'pc-why'); why.appendChild(el('span', 'pc-why-ico', '⚠')); why.appendChild(el('span', '', it.why)); card.appendChild(why); }

    // the proposed entry
    var box = el('div', 'pc-entrybox');
    var eh = el('div', 'pc-entryhead');
    eh.appendChild(el('span', '', it.state === 'approved' ? 'Approved entry' : 'Proposed entry'));
    eh.appendChild(el('span', 'pc-book', bookName(it.book) + (it.rule ? ' · Rule ' + it.rule : '')));
    box.appendChild(eh);
    var tableWrap = el('div', 'pc-tablewrap');
    box.appendChild(tableWrap);
    card.appendChild(box);
    var side = /^CRJ/.test(it.book) ? 'credit' : 'debit';
    var opts = (it.options || []).slice(), cur = side === 'credit' ? it.credit : it.debit;
    if (it.state === 'approved' && it.decision && it.decision[side]) {
      var dc = it.decision[side]; cur = opts.filter(function (o) { return o[0] === dc; })[0] || [dc, ''];
    }
    function redraw(chosen) { tableWrap.innerHTML = ''; tableWrap.appendChild(entryTable(draftLines(it, chosen))); }
    redraw(cur);
    if (it.atc || (/withh|ATC/i.test(it.why || ''))) box.appendChild(el('div', 'pc-note', 'Withholding tax (EWT) is worked out by Cl@ud when it posts.'));

    var actions = el('div', 'pc-actions');
    if (it.state === 'approved') {
      card.appendChild(el('div', 'pc-state', '✓ Approved — Cl@ud will post it within the hour.'));
    } else if (it.manual) {
      card.appendChild(el('div', 'pc-note', 'Cl@ud can\'t post this kind by itself yet. Encode it in the client\'s workbook, then tap “I encoded it”.'));
      var did = el('button', 'btn ok small', '✓ I encoded it'); did.type = 'button';
      did.addEventListener('click', function () { decide(it, { choice: 'done' }, card, did); });
      actions.appendChild(did);
    } else {
      if (it.state === 'hold') card.appendChild(el('div', 'pc-state hold', '⏸ On hold'));
      if (cur && !opts.some(function (o) { return o[0] === cur[0]; })) opts.unshift(cur);
      var pick = el('label', 'pc-pick');
      pick.appendChild(el('span', 'pc-pick-label', side === 'credit' ? 'Credit account' : 'Debit account'));
      var sel = accountSelect(opts, cur, side === 'credit' ? 'Credit account' : 'Debit account');
      sel.addEventListener('change', function () {
        var a = opts.filter(function (o) { return o[0] === sel.value; })[0] || null; redraw(a);
      });
      pick.appendChild(sel);
      var atc = null;
      if (/withh|ATC/i.test(it.why || '')) { atc = inputEl('ATC, e.g. WC158 (leave blank if none)'); pick.appendChild(atc); }
      card.appendChild(pick);
      var go = el('button', 'btn ok small', '✓ Post'); go.type = 'button';
      go.addEventListener('click', function () {
        if (!sel.value) { sel.focus(); toast('Please choose the account first.'); return; }
        var p = { choice: 'post' }; p[side] = sel.value; if (atc && atc.value.trim()) p.atc = atc.value.trim();
        decide(it, p, card, go);
      });
      actions.appendChild(go);
      if (it.state !== 'hold') {
        var hold = el('button', 'btn ghost small', '⏸ Hold'); hold.type = 'button';
        hold.addEventListener('click', function () { decide(it, { choice: 'hold' }, card, hold, true); });
        actions.appendChild(hold);
      }
    }
    if (actions.childNodes.length) card.appendChild(actions);

    // links
    var links = el('div', 'pc-links');
    var photo = el('button', 'link', '📷 See the photo'); photo.type = 'button';
    photo.addEventListener('click', function () {
      if (it._img) return openViewer(it._img);
      busy(photo, true, '⏳ Loading photo…');
      call('postImage', { token: state.token, row: it.row }).then(function (r) {
        busy(photo, false);
        if (!r.ok) { toast(r.error || 'Photo not available.'); return; }
        it._img = 'data:' + r.mime + ';base64,' + r.data; openViewer(it._img);
      });
    });
    links.appendChild(photo);
    if (it.link) { var open = document.createElement('a'); open.className = 'link'; open.href = it.link; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open in Drive'; links.appendChild(open); }
    if (!it.manual && it.state !== 'approved') {
      var mine = el('button', 'link muted-link', 'I\'ll encode it myself'); mine.type = 'button';
      mine.addEventListener('click', function () { if (confirmTwice(mine)) decide(it, { choice: 'done' }, card, mine); });
      links.appendChild(mine);
    }
    card.appendChild(links);
    return card;
  }

  function decide(it, payload, card, btn, keep) {
    payload.token = state.token; payload.row = it.row; payload.fileId = it.fileId;
    busy(btn, true, 'Saving…');
    call('postDecide', payload).then(function (r) {
      busy(btn, false);
      toast(r.ok ? r.text : r.error);
      if (!r.ok) return;
      refreshItems();
      if (keep || payload.choice === 'post') { openPostSheet(); } else done(card);
    });
  }

  function inputEl(ph, type) { var i = document.createElement('input'); i.type = type || 'text'; i.placeholder = ph; if (type === 'email') i.inputMode = 'email'; return i; }
  /** Risky buttons need a second tap. */
  function confirmTwice(btn) {
    if (btn.dataset.sure) return true;
    btn.dataset.sure = '1'; var old = btn.textContent; btn.textContent = 'Tap again to confirm';
    setTimeout(function () { delete btn.dataset.sure; btn.textContent = old; }, 3000);
    return false;
  }

  // ------------------------------------------------------------------ opening from a notification
  function deepLink(url) {
    var q = (url || location.search).replace(/^[^?]*\?/, ''), o = {};
    q.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) o[p[0]] = decodeURIComponent(p[1] || ''); });
    return o;
  }
  function openDeepLink(link) {
    if (!link) return;
    if (link.post && state.role === 'owner') { openPostSheet(); }
    else if (link.owner && state.role === 'owner') { renderOwnerSheet(); openSheet('sheetOwner'); }
    else if (link.staff && state.staff) { state.staffTab = 'check'; renderStaffSheet(); openSheet('sheetStaff'); }
    else if (link.action && state.items.length) { renderActionSheet(); openSheet('sheetAction'); }
    if ((link.staff || link.action || link.owner || link.post) && history.replaceState) history.replaceState(null, '', location.pathname);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type !== 'open' || !state.token) return;
    var link = deepLink(d.url || '');
    var c = link.c && state.clients.filter(function (x) { return x.code === link.c; })[0];
    if (c && (!state.client || c.code !== state.client.code)) { state.client = c; renderBusiness(); loadHistory(); }
    refreshItems().then(function () { openDeepLink(link); });
  });

  // ------------------------------------------------------------------ phone notifications
  function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

  /** on | off (blocked) | ask | install (iPhone not yet on Home Screen) | none */
  function notifState() {
    if (DEMO) return store('get', 'gab.demoPush') ? 'on' : 'ask';
    if (!state.cfg.pushKey) return 'none';
    if (!pushSupported()) return isIos() && !isStandalone() ? 'install' : 'none';
    if (Notification.permission === 'granted') return 'on';
    if (Notification.permission === 'denied') return 'off';
    return 'ask';
  }

  function setupNotifCard() {
    var st = notifState(), card = $('notifCard');
    card.hidden = !(st === 'ask' || st === 'install') || store('get', 'gab.pushLater') === new Date().toDateString();
    $('notifText').textContent = st === 'install'
      ? 'To get notifications on iPhone, first add Gabbrielle to your Home Screen, then open it from there.'
      : (state.staff ? 'Get a notification when there are details to check.' : 'Get a notification when the firm needs something from you.');
    $('btnNotif').textContent = st === 'install' ? 'Show me how' : 'Turn on notifications';
    if (st === 'on') ensureSubscribed(false);
  }
  function maybeAskNotifications() { if (notifState() === 'ask') $('notifCard').hidden = false; }

  $('btnNotif').addEventListener('click', function () { if (notifState() === 'install') installHelp(); else enableNotifications(); });
  $('btnNotifLater').addEventListener('click', function () { store('set', 'gab.pushLater', new Date().toDateString()); $('notifCard').hidden = true; });

  function enableNotifications() {
    if (DEMO) { store('set', 'gab.demoPush', '1'); $('notifCard').hidden = true; toast('Notifications are on ✓ (demo)'); return; }
    var st = notifState();
    if (st === 'install') return installHelp();
    if (st === 'off') { toast('Notifications are blocked. Turn them on in your phone\'s settings for Gabbrielle.'); return; }
    if (st === 'none') { toast('This phone or browser can\'t show notifications.'); return; }
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { $('notifCard').hidden = true; toast('Okay — notifications stay off. You can turn them on later from the ⋮ menu.'); return; }
      $('notifCard').hidden = true;
      ensureSubscribed(true);
    });
  }

  function keyBytes(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function ensureSubscribed(announce) {
    if (!pushSupported() || !state.cfg.pushKey) return;
    var key = keyBytes(state.cfg.pushKey);
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && sub.options && sub.options.applicationServerKey) {
          var a = new Uint8Array(sub.options.applicationServerKey);
          if (a.length !== key.length || a.some(function (b, i) { return b !== key[i]; })) return sub.unsubscribe().then(function () { return null; });
        }
        return sub;
      }).then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); });
    }).then(function (sub) {
      var j = JSON.stringify(sub) + '|' + (store('get', KEY.email) || '');
      if (!announce && store('get', 'gab.sub') === j) return;
      return call('subscribe', { token: state.token, sub: sub.toJSON(), device: (isIos() ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : 'Computer') + ' · ' + navigator.userAgent.slice(0, 90) })
        .then(function (r) {
          if (r.ok) { store('set', 'gab.sub', j); if (announce) toast('Notifications are on ✓'); }
          else if (announce) toast(r.error || 'Could not turn on notifications.');
        });
    }).catch(function () { if (announce) toast('Could not turn on notifications on this phone.'); });
  }

  // ------------------------------------------------------------------ demo engine (no real data)
  function demoEngine(p) {
    var now = function () { return new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    var db = demoEngine.db || (demoEngine.db = {
      access: { 'demo@gmail.com': [{ code: 'C000', name: 'Dummy Client (for testing)' }, { code: 'C000B', name: 'Dummy Client – Branch' }] },
      staff: { 'staff@gmail.com': true, 'owner@gmail.com': true },
      sessions: {}, items: [
        { clientCode: 'C000', received: 'Oct 1, 2026 9:12 AM', docType: 'Sales Invoice', docNo: '0012345', total: 11200, party: 'ABC Construction Corp.', period: '2026-09', note: '', fileName: 'invoice.jpg', status: 'Encoded', remarks: '' },
        { clientCode: 'C000', received: 'Oct 2, 2026 4:40 PM', docType: 'Waiting to be read', period: '2026-10', note: 'Gas receipts', fileName: 'IMG_2231.jpg', status: 'New', remarks: '' }
      ],
      q: [
        { id: 'Q1', clientCode: 'C000', client: 'Dummy Client (for testing)', doc: 'Supplier Invoice / Receipt 88231 – Petron Cabarroguis', field: 'total', label: 'Total amount', kind: 'money',
          question: 'The total looks like ₱2,850.00 but the lines add up to ₱2,350.00. What is the correct total?', guess: 2850, note: 'Please check your copy of the receipt.', status: 'client', days: 1 },
        { id: 'Q2', clientCode: 'C000', client: 'Dummy Client (for testing)', doc: 'Sales Invoice 0451', field: 'docNo', label: 'Document number', kind: 'text',
          question: 'The invoice number could be 0451 or 0457.', guess: '0451', note: '', status: 'staff', days: 0 },
        { id: 'Q3', clientCode: 'C017', client: 'Juan Dela Cruz Hardware', doc: 'Supplier Invoice / Receipt', field: 'partyTin', label: 'TIN', kind: 'text',
          question: 'The supplier\'s TIN is cut off in the photo.', guess: null, note: '', status: 'staff', days: 0 },
        { id: 'Q4', clientCode: 'C020', client: 'Other Store', doc: 'Photo', field: 'retake', label: 'Clearer photo', kind: 'note',
          question: 'The photo is too blurry to read. Please send a clearer photo.', guess: null, note: 'Take it near a window, flat on the table.', status: 'client', days: 4 }
      ]
    });
    var reply = function (o) { return new Promise(function (res) { setTimeout(function () { res(o); }, 400); }); };
    var who = function () { return db.sessions[p.token]; };
    var isStaff = function (e) { return !!db.staff[e]; };
    var allowed = function (email) {
      if (isStaff(email)) return [{ code: 'C000', name: 'Dummy Client (for testing)' }, { code: 'C017', name: 'Juan Dela Cruz Hardware' }, { code: 'C020', name: 'Other Store' }];
      return db.access[email] || (/@/.test(email) && email !== 'notregistered@gmail.com' ? [{ code: 'C000', name: 'Dummy Client (for testing)' }] : null);
    };
    var out = function (q) { var o = Object.assign({}, q); o.daysWaiting = q.days; return o; };
    var find = function (id) { return db.q.filter(function (q) { return q.id === id; })[0]; };
    if (p.action !== 'config' && p.action !== 'requestCode' && p.action !== 'verifyCode' && p.action !== 'logout' && !who())
      return reply({ ok: false, code: 'LOGGED_OUT', error: 'Please log in again.' });
    switch (p.action) {
      case 'config': return reply({ ok: true, phone: '0900 000 0000', email: 'firm@example.com', address: 'Quirino, Philippines', pushKey: 'demo' });
      case 'requestCode': return allowed(p.email) ? reply({ ok: true }) : reply({ ok: false, code: 'NOT_REGISTERED', error: 'This Gmail address isn\'t registered. Please contact B.R. Ramones Accounting Firm.' });
      case 'verifyCode':
        if (p.code !== '123456') return reply({ ok: false, error: 'Wrong code. Please check your email and try again.' });
        var t = 'demo' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxxxxxxxxxx';
        db.sessions[t] = p.email;
        return reply({ ok: true, token: t, email: p.email, nickname: (db.nick || {})[p.email] || '', clients: allowed(p.email), staff: isStaff(p.email), role: p.email === 'owner@gmail.com' ? 'owner' : isStaff(p.email) ? 'staff' : 'client' });
      case 'me': return reply({ ok: true, email: who(), nickname: (db.nick || {})[who()] || '', clients: allowed(who()), staff: isStaff(who()), role: who() === 'owner@gmail.com' ? 'owner' : isStaff(who()) ? 'staff' : 'client' });
      case 'ownerOverview':
        return reply({ ok: true, owner: 'owner@gmail.com', toPost: 1, staff: ['staff@gmail.com'], loggedIn: ['demo@gmail.com', 'staff@gmail.com'], clients: [
          { code: 'C020', name: 'Other Store', active: true, lastSent: 'Sep 27, 2026', daysQuiet: 10, quietDays: 7, quiet: true, thisMonth: 0, withStaff: 0, withClient: 1, oldestAsk: 4 },
          { code: 'C000', name: 'Dummy Client (for testing)', active: true, lastSent: 'Oct 2, 2026', daysQuiet: 5, quietDays: 7, quiet: false, thisMonth: 2, withStaff: 1, withClient: 1, oldestAsk: 1 },
          { code: 'C017', name: 'Juan Dela Cruz Hardware', active: true, lastSent: 'Oct 6, 2026', daysQuiet: 1, quietDays: 14, quiet: false, thisMonth: 6, withStaff: 1, withClient: 0, oldestAsk: 0 },
          { code: 'C030', name: 'New Bakery', active: true, lastSent: '', neverSent: true, daysQuiet: 2, quietDays: 7, quiet: false, thisMonth: 0, withStaff: 0, withClient: 0, oldestAsk: 0 }] });
      case 'ownerDo': return reply({ ok: true, text: 'Done (demo).' });
      case 'toPost':
        db.posts = db.posts || [
          { row: 5, fileId: 'demo1', code: 'C000', client: 'Dummy Client (for testing)', label: 'Supplier Invoice / Receipt 1123 – ACME Office Supply', amount: 1120, date: '2026-10-03',
            docType: 'Supplier Invoice / Receipt', docNo: '1123', party: 'ACME Office Supply Inc.', partyTin: '123-456-789-00000', vat: 120,
            tax: { vatClient: true, docVat: 120, ivat: ['1300', 'Input VAT'], ovat: ['2100', 'Output VAT'] },
            why: 'First time for this supplier – choose the account.', rule: 'P3', book: 'CDJ – Purchase', debit: null, credit: ['1000', 'Cash on Hand'],
            options: [['1200', 'Merchandise Inventory'], ['3010', 'Owners Drawings'], ['5000', 'Purchases'], ['6070', 'Office Supplies'], ['6060', 'Repairs and Maintenance'], ['6200', 'Miscellaneous Expense']], manual: false, state: 'new' },
          { row: 6, fileId: 'demo2', code: 'C017', client: 'Juan Dela Cruz Hardware', label: 'Payroll / Contributions', amount: 18500, date: '2026-10-05', docType: 'Payroll / Contributions',
            why: 'Payroll – encode in Cash Disbursements.', rule: 'W1', book: 'CDJ – Payroll', debit: ['6000', 'Salaries and Wages'], credit: ['1000', 'Cash on Hand'], options: [], manual: true, state: 'new' }];
        return reply({ ok: true, items: db.posts });
      case 'postDecide':
        var pp = (db.posts || []).filter(function (x) { return x.row === p.row; })[0];
        if (pp) { if (p.choice === 'done') db.posts = db.posts.filter(function (x) { return x !== pp; }); else { pp.state = p.choice === 'post' ? 'approved' : 'hold'; pp.decision = { debit: p.debit, credit: p.credit }; } }
        return reply({ ok: true, text: p.choice === 'post' ? 'Approved. Cl@ud will post it within the hour.' : p.choice === 'hold' ? 'On hold.' : 'Marked as encoded.' });
      case 'postImage': return reply({ ok: true, mime: 'image/svg+xml', data: btoa('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#fff"/><text x="40" y="80" font-size="34" font-family="Arial">SAMPLE INVOICE</text></svg>') });
      case 'setNickname': db.nick = db.nick || {}; db.nick[who()] = String(p.nickname).trim(); return reply({ ok: !!db.nick[who()], nickname: db.nick[who()], error: 'Please type a name.' });
      case 'history': return reply({ ok: true, items: db.items.filter(function (i) { return i.clientCode === p.clientCode; }).slice().reverse() });
      case 'submit':
        db.items.push({ clientCode: p.clientCode, received: now(), docType: 'Waiting to be read' + (p.category && p.category !== 'unsure' ? ' – ' + catByKey(p.category).label : ''), period: p.period, note: p.note, fileName: p.fileName, status: 'New', remarks: '' });
        return new Promise(function (res) { setTimeout(function () { res({ ok: true }); }, 700); });
      case 'items':
        if (p.scope === 'staff') {
          if (!isStaff(who())) return reply({ ok: false, error: 'Staff only.' });
          return reply({ ok: true, forStaff: db.q.filter(function (q) { return q.status === 'staff'; }).map(out), waiting: db.q.filter(function (q) { return q.status === 'client'; }).map(out) });
        }
        return reply({ ok: true, items: db.q.filter(function (q) { return q.status === 'client' && q.clientCode === p.clientCode; }).map(function (q) { var o = out(q); delete o.client; return o; }) });
      case 'itemImage':
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#fff"/><text x="40" y="80" font-size="34" font-family="Arial">SAMPLE RECEIPT</text>' +
          '<text x="40" y="160" font-size="26" font-family="Arial">Petron Cabarroguis</text><text x="40" y="600" font-size="40" font-family="Comic Sans MS">Total 2,?50.00</text></svg>';
        return reply({ ok: true, mime: 'image/svg+xml', data: btoa(svg) });
      case 'answer':
        var q = find(p.id); if (!q || q.status === 'done') return reply({ ok: false, error: 'This item was already answered.' });
        var v = p.accept ? q.guess : p.value;
        if (q.kind === 'money') { v = Number(String(v).replace(/[₱,\s]/g, '')); if (isNaN(v)) return reply({ ok: false, error: 'Please type the amount, e.g. 11200.00' }); }
        q.status = 'done';
        return reply({ ok: true, text: q.kind === 'money' ? peso(v) : String(v) });
      case 'askClient': var a = find(p.id); a.status = 'client'; a.note = p.note || ''; a.days = 0; return reply({ ok: true, notified: 1 });
      case 'dismiss': find(p.id).status = 'done'; return reply({ ok: true });
      case 'subscribe': return reply({ ok: true });
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
        if (r.ok) { setNick(r.nickname); enterHome(r.clients, r.staff, r.role); }
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
