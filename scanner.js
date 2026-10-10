/* Gabbrielle Scanner — in-app document camera (CamScanner-style)
 * - Live camera with an outline that follows the document's edges
 * - After the shot: drag the 4 corners to adjust
 * - Flattens the page and cleans it up (whiter paper, sharper text)
 * - Scan several pages, then they go to the normal "Send" screen
 * Hooks onto the "Take a photo" button; falls back to the phone camera app if needed.
 */
(function () {
  'use strict';

  var CSS = [
    '.scn{position:fixed;inset:0;z-index:60;background:#000;color:#fff;display:flex;flex-direction:column;font-family:inherit;touch-action:none}',
    '.scn-top{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top));gap:8px}',
    '.scn-top h3{margin:0;font-size:16px;font-weight:600;flex:1;text-align:center}',
    '.scn-ib{appearance:none;background:rgba(255,255,255,.12);border:0;color:#fff;width:44px;height:44px;border-radius:22px;font-size:20px;cursor:pointer}',
    '.scn-ib[aria-pressed=true]{background:#ffd54a;color:#000}',
    '.scn-stage{position:relative;flex:1;min-height:0;overflow:hidden}',
    '.scn-stage video,.scn-stage canvas{position:absolute;inset:0;width:100%;height:100%}',
    '.scn-stage video{object-fit:contain}',
    '.scn-hint{position:absolute;left:50%;top:14px;transform:translateX(-50%);background:rgba(0,0,0,.55);padding:6px 12px;border-radius:16px;font-size:13px;white-space:nowrap;pointer-events:none}',
    '.scn-hint.ok{background:rgba(30,142,90,.85)}',
    '.scn-bot{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;padding-bottom:max(14px,env(safe-area-inset-bottom));gap:12px}',
    '.scn-shutter{appearance:none;width:72px;height:72px;border-radius:50%;border:5px solid #fff;background:#1d9bd7;cursor:pointer;flex:none}',
    '.scn-shutter:active{transform:scale(.94)}',
    '.scn-thumb{width:56px;height:56px;border-radius:8px;background:#222 center/cover no-repeat;border:2px solid #fff;position:relative;flex:none}',
    '.scn-thumb span{position:absolute;top:-8px;right:-8px;background:#1d9bd7;border-radius:11px;min-width:22px;height:22px;font-size:12px;font-weight:700;display:grid;place-items:center;padding:0 5px}',
    '.scn-thumb.empty{visibility:hidden}',
    '.scn-btn{appearance:none;border:0;border-radius:12px;padding:12px 16px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;min-height:48px}',
    '.scn-btn.pri{background:#1d9bd7;color:#fff}',
    '.scn-btn.sec{background:rgba(255,255,255,.14);color:#fff}',
    '.scn-btn[disabled]{opacity:.45}',
    '.scn-row{display:flex;gap:10px;width:100%}',
    '.scn-row .scn-btn{flex:1}',
    '.scn-chips{display:flex;gap:8px;justify-content:center;padding:10px 12px 0}',
    '.scn-chip{appearance:none;border:1.5px solid rgba(255,255,255,.4);background:none;color:#fff;border-radius:20px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer}',
    '.scn-chip[aria-pressed=true]{background:#fff;color:#000;border-color:#fff}',
    '.scn-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font-size:15px;line-height:1.5}',
    '.scn-busy{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.45);font-weight:600}'
  ].join('\n');

  var supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;

  // ------------------------------------------------------------------ state
  var S = { root: null, stream: null, video: null, overlay: null, timer: 0, quad: null, conf: 0, stable: 0,
            pages: [], shot: null, shotQuad: null, filter: 'clean', mode: '' };

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  // ------------------------------------------------------------------ open / close
  // ------------------------------------------------------------------ phone held sideways
  // The app stays upright, so a photo taken with the phone turned sideways would come out lying down.
  // The phone's motion sensor tells which way it is turned; the page is then turned upright automatically.
  var IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  function onMotion(e) { var g = e.accelerationIncludingGravity; if (g && g.x != null) { S.gx = g.x * (IOS ? -1 : 1); S.gy = g.y * (IOS ? -1 : 1); } }
  function tiltNow() {
    var x = S.gx || 0, y = S.gy || 0;
    if (Math.abs(x) < 5 || Math.abs(x) < Math.abs(y) * 1.2) return 0;   // upright (or flat): leave as is
    return x > 0 ? -1 : 1;                                                // -1 = turned left, 1 = turned right
  }
  function listenTilt(on) {
    if (on) {
      S.gx = 0; S.gy = 0;
      try {
        if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
          DeviceMotionEvent.requestPermission().then(function (p) { if (p === 'granted') window.addEventListener('devicemotion', onMotion); }).catch(function () {});
        } else window.addEventListener('devicemotion', onMotion);
      } catch (e) {}
    } else window.removeEventListener('devicemotion', onMotion);
  }
  function rotateLeft(c) {
    var r = document.createElement('canvas'); r.width = c.height; r.height = c.width;
    var g = r.getContext('2d'); g.translate(0, r.height); g.rotate(-Math.PI / 2); g.drawImage(c, 0, 0); return r;
  }

  function open() {
    listenTilt(true);
    if (!document.getElementById('scn-css')) document.head.appendChild(h('style', { id: 'scn-css', text: CSS }));
    S.pages = []; S.filter = 'clean';
    S.root = h('div', { class: 'scn', role: 'dialog', 'aria-label': 'Document scanner' });
    document.body.appendChild(S.root);
    document.body.style.overflow = 'hidden';
    showCamera();
  }

  function close(deliver) {
    listenTilt(false);
    stopCamera();
    var pages = S.pages.slice();
    if (S.root) S.root.remove();
    S.root = null; S.pages = []; S.shot = null;
    document.body.style.overflow = '';
    if (deliver && pages.length) handOff(pages);
  }

  /** Gives the scanned pages to the app exactly as if they were picked with the camera button. */
  function handOff(pages) {
    var input = document.getElementById('inCamera');
    var dt = new DataTransfer();
    var stamp = new Date();
    var base = 'scan-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds());
    pages.forEach(function (p, i) { dt.items.add(new File([p.blob], base + '-p' + (i + 1) + '.jpg', { type: 'image/jpeg' })); });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function pad(n) { return ('0' + n).slice(-2); }

  // ------------------------------------------------------------------ camera view
  function showCamera() {
    S.mode = 'camera';
    S.root.innerHTML = '';
    var torch = h('button', { class: 'scn-ib', type: 'button', 'aria-label': 'Flash', 'aria-pressed': 'false', hidden: '', text: '⚡' });
    var top = h('div', { class: 'scn-top' }, [
      h('button', { class: 'scn-ib', type: 'button', 'aria-label': 'Close', text: '✕', onclick: function () {
        if (S.pages.length && !confirmDiscard()) return; close(false); } }),
      h('h3', { text: 'Scan documents' }),
      torch
    ]);
    S.video = h('video', { playsinline: '', muted: '', autoplay: '' });
    S.video.muted = true;
    S.overlay = h('canvas');
    var hint = h('div', { class: 'scn-hint', text: 'Starting camera…' });
    var stage = h('div', { class: 'scn-stage' }, [S.video, S.overlay, hint]);
    var thumb = h('div', { class: 'scn-thumb empty' }, [h('span')]);
    var done = h('button', { class: 'scn-btn pri', type: 'button', disabled: '', text: 'Done', onclick: function () { close(true); } });
    var shutter = h('button', { class: 'scn-shutter', type: 'button', 'aria-label': 'Take picture', onclick: capture });
    var bot = h('div', { class: 'scn-bot' }, [thumb, shutter, done]);
    S.root.appendChild(top); S.root.appendChild(stage); S.root.appendChild(bot);
    S.ui = { hint: hint, thumb: thumb, done: done, torch: torch, stage: stage, shutter: shutter };
    updateThumb();
    startCamera().catch(function (err) { cameraError(err); });
  }

  function confirmDiscard() {
    // No browser pop-ups: use an in-screen question instead.
    if (S._askDiscard) { S._askDiscard = false; return true; }
    S._askDiscard = true;
    hint('Tap ✕ again to discard ' + S.pages.length + ' scanned page' + (S.pages.length > 1 ? 's' : ''), false);
    setTimeout(function () { S._askDiscard = false; }, 3000);
    return false;
  }

  function startCamera() {
    if (S.stream && S.stream.active) { S.video.srcObject = S.stream; return S.video.play().then(afterStart); }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }
    }).then(function (stream) {
      S.stream = stream;
      S.video.srcObject = stream;
      return S.video.play();
    }).then(afterStart);
  }

  function afterStart() {
    hint('Place the document inside the screen', false);
    var track = S.stream.getVideoTracks()[0];
    try {
      var caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) {
        S.ui.torch.hidden = false;
        S.ui.torch.onclick = function () {
          var on = S.ui.torch.getAttribute('aria-pressed') !== 'true';
          track.applyConstraints({ advanced: [{ torch: on }] }).then(function () { S.ui.torch.setAttribute('aria-pressed', String(on)); }).catch(function () {});
        };
      }
    } catch (e) {}
    S.quad = null; S.conf = 0; S.stable = 0;
    clearInterval(S.timer);
    S.timer = setInterval(liveDetect, 180);
  }

  function stopCamera() {
    clearInterval(S.timer);
    if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); });
    S.stream = null;
  }

  function cameraError(err) {
    stopCamera();
    var blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    var msg = h('div', { class: 'scn-msg' }, [
      h('div', { style: 'font-size:40px', text: '📷' }),
      h('div', { text: blocked
        ? 'Gabbrielle is not allowed to use the camera. To fix: tap the lock or settings icon beside the web address (or open your phone Settings → Apps → Chrome → Permissions) and allow Camera.'
        : 'The camera could not be started on this device.' }),
      h('button', { class: 'scn-btn pri', type: 'button', text: 'Use phone camera instead', onclick: function () {
        close(false); nativeCamera(); } }),
      h('button', { class: 'scn-btn sec', type: 'button', text: 'Close', onclick: function () { close(false); } })
    ]);
    if (S.ui && S.ui.stage) { S.ui.stage.innerHTML = ''; S.ui.stage.appendChild(msg); S.ui.shutter.disabled = true; }
  }

  function nativeCamera() {
    var input = document.getElementById('inCamera');
    S.bypass = true; input.click(); S.bypass = false;
  }

  function hint(text, ok) { if (S.ui && S.ui.hint) { S.ui.hint.textContent = text; S.ui.hint.classList.toggle('ok', !!ok); } }

  function updateThumb() {
    var t = S.ui && S.ui.thumb; if (!t) return;
    var n = S.pages.length;
    t.classList.toggle('empty', !n);
    t.querySelector('span').textContent = n;
    if (n) t.style.backgroundImage = 'url(' + S.pages[n - 1].url + ')';
    S.ui.done.disabled = !n;
    S.ui.done.textContent = n ? 'Done (' + n + ')' : 'Done';
  }

  // ------------------------------------------------------------------ live outline
  function liveDetect() {
    var v = S.video;
    if (!v || !v.videoWidth || S.mode !== 'camera') return;
    var r = detectQuad(v, v.videoWidth, v.videoHeight);
    if (r.ok) {
      if (S.quad && S.conf > 0) {
        var moved = 0;
        S.quad = S.quad.map(function (p, i) {
          moved = Math.max(moved, Math.abs(p[0] - r.quad[i][0]) + Math.abs(p[1] - r.quad[i][1]));
          return [p[0] * 0.55 + r.quad[i][0] * 0.45, p[1] * 0.55 + r.quad[i][1] * 0.45];
        });
        S.stable = moved < 0.03 ? S.stable + 1 : 0;
      } else { S.quad = r.quad; S.stable = 0; }
      S.conf = Math.min(S.conf + 1, 4);
    } else {
      S.conf = Math.max(S.conf - 1, 0);
      if (!S.conf) { S.quad = null; S.stable = 0; }
    }
    drawLive();
    if (S.conf && S.stable >= 3) hint('Document found — hold steady and tap the button', true);
    else if (S.conf) hint('Document found', true);
    else hint('Place the document on a darker surface', false);
  }

  /** Where the video picture sits inside the stage (it is letter-boxed). */
  function videoBox() {
    var cw = S.overlay.clientWidth, ch = S.overlay.clientHeight, vw = S.video.videoWidth, vh = S.video.videoHeight;
    var s = Math.min(cw / vw, ch / vh);
    return { x: (cw - vw * s) / 2, y: (ch - vh * s) / 2, w: vw * s, h: vh * s, cw: cw, ch: ch };
  }

  function drawLive() {
    var c = S.overlay, dpr = window.devicePixelRatio || 1;
    var b = videoBox();
    if (c.width !== Math.round(b.cw * dpr)) { c.width = Math.round(b.cw * dpr); c.height = Math.round(b.ch * dpr); }
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, b.cw, b.ch);
    if (!S.quad || !S.conf) {
      // guide frame
      g.setLineDash([10, 8]); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
      g.strokeRect(b.x + b.w * 0.08, b.y + b.h * 0.06, b.w * 0.84, b.h * 0.88);
      g.setLineDash([]);
      return;
    }
    var pts = S.quad.map(function (p) { return [b.x + p[0] * b.w, b.y + p[1] * b.h]; });
    poly(g, pts);
    g.fillStyle = 'rgba(29,155,215,.22)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = S.stable >= 3 ? '#3ddc84' : '#1d9bd7'; g.stroke();
    pts.forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 7, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); });
  }

  function poly(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }

  // ------------------------------------------------------------------ capture
  function capture() {
    var v = S.video;
    if (!v || !v.videoWidth) return;
    var c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    S.shot = c; S.shotTilt = tiltNow();
    var r = detectQuad(c, c.width, c.height);
    var q = r.ok ? r.quad : (S.quad && S.conf ? S.quad : [[0.06, 0.05], [0.94, 0.05], [0.94, 0.95], [0.06, 0.95]]);
    S.shotQuad = q.map(function (p) { return [p[0] * c.width, p[1] * c.height]; });
    clearInterval(S.timer);
    showEditor();
  }

  // ------------------------------------------------------------------ corner editor
  function showEditor() {
    S.mode = 'edit';
    S.root.innerHTML = '';
    var cv = h('canvas');
    var stage = h('div', { class: 'scn-stage' }, [cv, h('div', { class: 'scn-hint', text: 'Drag the corners to the edges of the document' })]);
    var top = h('div', { class: 'scn-top' }, [
      h('button', { class: 'scn-ib', type: 'button', 'aria-label': 'Back to camera', text: '←', onclick: backToCamera }),
      h('h3', { text: 'Adjust corners' }),
      h('button', { class: 'scn-ib', type: 'button', 'aria-label': 'Use whole photo', title: 'Use whole photo', text: '⛶', onclick: function () {
        var w = S.shot.width, hh = S.shot.height; S.shotQuad = [[0, 0], [w, 0], [w, hh], [0, hh]]; draw(); } })
    ]);
    var bot = h('div', { class: 'scn-bot' }, [h('div', { class: 'scn-row' }, [
      h('button', { class: 'scn-btn sec', type: 'button', text: 'Retake', onclick: backToCamera }),
      h('button', { class: 'scn-btn pri', type: 'button', text: 'Next ✓', onclick: function () { process(); } })
    ])]);
    S.root.appendChild(top); S.root.appendChild(stage); S.root.appendChild(bot);

    var dpr = window.devicePixelRatio || 1, box, drag = -1;
    function layout() {
      var cw = stage.clientWidth, ch = stage.clientHeight, pad = 22;
      var s = Math.min((cw - pad * 2) / S.shot.width, (ch - pad * 2) / S.shot.height);
      box = { s: s, x: (cw - S.shot.width * s) / 2, y: (ch - S.shot.height * s) / 2, cw: cw, ch: ch };
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      draw();
    }
    function toScreen(p) { return [box.x + p[0] * box.s, box.y + p[1] * box.s]; }
    function draw() {
      var g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, box.cw, box.ch);
      g.drawImage(S.shot, box.x, box.y, S.shot.width * box.s, S.shot.height * box.s);
      var pts = S.shotQuad.map(toScreen);
      // dim outside the document
      g.save(); g.beginPath(); g.rect(0, 0, box.cw, box.ch); poly2(g, pts); g.fillStyle = 'rgba(0,0,0,.5)'; g.fill('evenodd'); g.restore();
      poly(g, pts); g.lineWidth = 2.5; g.strokeStyle = '#1d9bd7'; g.stroke();
      pts.forEach(function (p, i) {
        g.beginPath(); g.arc(p[0], p[1], drag === i ? 16 : 12, 0, Math.PI * 2);
        g.fillStyle = 'rgba(29,155,215,.35)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      });
      if (drag >= 0) magnifier(g, pts[drag], S.shotQuad[drag]);
    }
    function magnifier(g, sp, ip) {
      var r = 48, z = 2.5, mx = sp[0] < box.cw / 2 ? box.cw - r - 14 : r + 14, my = r + 14;
      g.save(); g.beginPath(); g.arc(mx, my, r, 0, Math.PI * 2); g.clip();
      var sw = (r * 2) / (box.s * z);
      g.drawImage(S.shot, ip[0] - sw / 2, ip[1] - sw / 2, sw, sw, mx - r, my - r, r * 2, r * 2);
      g.restore();
      g.beginPath(); g.arc(mx, my, r, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.moveTo(mx - 8, my); g.lineTo(mx + 8, my); g.moveTo(mx, my - 8); g.lineTo(mx, my + 8); g.strokeStyle = '#1d9bd7'; g.lineWidth = 2; g.stroke();
    }
    function local(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    cv.addEventListener('pointerdown', function (e) {
      var p = local(e), best = -1, bd = 44;
      S.shotQuad.map(toScreen).forEach(function (q, i) { var d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { drag = best; cv.setPointerCapture(e.pointerId); draw(); e.preventDefault(); }
    });
    cv.addEventListener('pointermove', function (e) {
      if (drag < 0) return;
      var p = local(e);
      var x = Math.max(0, Math.min(S.shot.width, (p[0] - box.x) / box.s));
      var y = Math.max(0, Math.min(S.shot.height, (p[1] - box.y) / box.s));
      S.shotQuad[drag] = [x, y]; draw();
    });
    function end() { if (drag >= 0) { drag = -1; draw(); } }
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    window.addEventListener('resize', function onR() { if (S.mode !== 'edit') return window.removeEventListener('resize', onR); layout(); });
    requestAnimationFrame(layout);
  }
  function poly2(g, pts) { g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }

  function backToCamera() { S.shot = null; showCamera(); }

  // ------------------------------------------------------------------ flatten + clean
  function process() {
    var busy = h('div', { class: 'scn-busy', text: 'Processing…' });
    S.root.querySelector('.scn-stage').appendChild(busy);
    setTimeout(function () {
      try {
        S.flat = warp(S.shot, orderQuad(S.shotQuad));
        if (S.shotTilt === -1) S.flat = rotateLeft(S.flat);        // phone was turned left: turn the page upright
        else if (S.shotTilt === 1) S.flat = rotate(S.flat);         // phone was turned right
        showReview();
      } catch (e) { busy.textContent = 'Could not process this photo. Tap Retake.'; }
    }, 30);
  }

  function showReview() {
    S.mode = 'review';
    S.root.innerHTML = '';
    var img = h('img', { alt: 'Scanned page', style: 'position:absolute;inset:12px;width:calc(100% - 24px);height:calc(100% - 24px);object-fit:contain' });
    var stage = h('div', { class: 'scn-stage' }, [img]);
    var chips = h('div', { class: 'scn-chips' });
    [['clean', 'Clean'], ['color', 'Original'], ['bw', 'Black & white']].forEach(function (f) {
      chips.appendChild(h('button', { class: 'scn-chip', type: 'button', 'aria-pressed': String(S.filter === f[0]), text: f[1], onclick: function () {
        S.filter = f[0]; chips.querySelectorAll('.scn-chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.textContent === f[1])); }); render(); } }));
    });
    var top = h('div', { class: 'scn-top' }, [
      h('button', { class: 'scn-ib', type: 'button', 'aria-label': 'Back', text: '←', onclick: showEditor }),
      h('h3', { text: 'Page ' + (S.pages.length + 1) }),
      h('button', { class: 'scn-ib', type: 'button', 'aria-label': 'Rotate', text: '⟳', onclick: function () { S.flat = rotate(S.flat); render(); } })
    ]);
    var bot = h('div', { class: 'scn-bot' }, [h('div', { class: 'scn-row' }, [
      h('button', { class: 'scn-btn sec', type: 'button', text: 'Retake', onclick: backToCamera }),
      h('button', { class: 'scn-btn sec', type: 'button', text: '+ Next page', onclick: function () { keep(function () { backToCamera(); }); } }),
      h('button', { class: 'scn-btn pri', type: 'button', text: 'Finish', onclick: function () { keep(function () { close(true); }); } })
    ])]);
    S.root.appendChild(top); S.root.appendChild(chips); S.root.appendChild(stage); S.root.appendChild(bot);
    var out = null;
    function render() { out = applyFilter(S.flat, S.filter); img.src = out.toDataURL('image/jpeg', 0.8); }
    function keep(next) {
      out.toBlob(function (blob) {
        S.pages.push({ blob: blob, url: URL.createObjectURL(blob) });
        S.shot = null; next();
      }, 'image/jpeg', 0.85);
    }
    render();
  }

  function rotate(c) {
    var r = document.createElement('canvas'); r.width = c.height; r.height = c.width;
    var g = r.getContext('2d'); g.translate(r.width, 0); g.rotate(Math.PI / 2); g.drawImage(c, 0, 0); return r;
  }

  /** Sort corners as top-left, top-right, bottom-right, bottom-left. */
  function orderQuad(q) {
    var cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    var s = q.slice().sort(function (a, b) { return Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx); });
    // after sorting by angle: starts near top-left going clockwise (canvas y points down)
    var tl = 0, best = Infinity;
    s.forEach(function (p, i) { var v = p[0] + p[1]; if (v < best) { best = v; tl = i; } });
    return [s[tl], s[(tl + 1) % 4], s[(tl + 2) % 4], s[(tl + 3) % 4]];
  }

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /** Straightens the 4-corner area into a flat rectangle (perspective correction). */
  function warp(src, q) {
    var W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
    var H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    var k = Math.min(1, 2000 / Math.max(W, H));
    W = Math.max(50, Math.round(W * k)); H = Math.max(50, Math.round(H * k));
    var m = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
    var sw = src.width, sh = src.height;
    var sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    var out = document.createElement('canvas'); out.width = W; out.height = H;
    var og = out.getContext('2d'), od = og.createImageData(W, H), o = od.data;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var d = m[6] * x + m[7] * y + 1;
        var sx = (m[0] * x + m[1] * y + m[2]) / d, sy = (m[3] * x + m[4] * y + m[5]) / d;
        var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        if (x0 < 0) { x0 = 0; fx = 0; } if (y0 < 0) { y0 = 0; fy = 0; }
        if (x0 >= sw - 1) { x0 = sw - 2; fx = 1; } if (y0 >= sh - 1) { y0 = sh - 2; fy = 1; }
        var i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4, oi = (y * W + x) * 4;
        for (var c = 0; c < 3; c++) {
          o[oi + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
        }
        o[oi + 3] = 255;
      }
    }
    og.putImageData(od, 0, 0);
    return out;
  }

  /** 3x3 projective map taking points "from" to points "to" (8 unknowns, solved directly). */
  function homography(from, to) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = from[i][0], y = from[i][1], u = to[i][0], v = to[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return solve(A, b);
  }
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      for (r = 0; r < n; r++) {
        if (r === c) continue;
        var f = M[r][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(function (r, i) { return r[n] / r[i]; });
  }

  /** "Clean": evens out shadows and makes the paper white so text stands out. */
  function applyFilter(src, mode) {
    var W = src.width, H = src.height;
    var out = document.createElement('canvas'); out.width = W; out.height = H;
    var g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    if (mode === 'color') return out;
    // background light estimate: shrink a lot, spread the brightest values, blur, enlarge
    var sw = Math.max(8, Math.round(W / 24)), sh = Math.max(8, Math.round(H / 24));
    var small = document.createElement('canvas'); small.width = sw; small.height = sh;
    var sg = small.getContext('2d'); sg.drawImage(src, 0, 0, sw, sh);
    var sd = sg.getImageData(0, 0, sw, sh), s = sd.data, tmp = new Uint8ClampedArray(s);
    for (var pass = 0; pass < 2; pass++) {
      for (var y = 0; y < sh; y++) for (var x = 0; x < sw; x++) {
        var i = (y * sw + x) * 4;
        for (var c = 0; c < 3; c++) {
          var mx = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            var xx = Math.min(sw - 1, Math.max(0, x + dx)), yy = Math.min(sh - 1, Math.max(0, y + dy));
            mx = Math.max(mx, s[(yy * sw + xx) * 4 + c]);
          }
          tmp[i + c] = mx;
        }
      }
      s.set(tmp);
    }
    sg.putImageData(sd, 0, 0);
    var bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    var bgg = bg.getContext('2d'); bgg.imageSmoothingQuality = 'high';
    bgg.filter = 'blur(' + Math.round(Math.max(W, H) / 60) + 'px)';
    bgg.drawImage(small, 0, 0, W, H);
    var B = bgg.getImageData(0, 0, W, H).data;
    var img = g.getImageData(0, 0, W, H), d = img.data;
    for (var p = 0; p < d.length; p += 4) {
      var r = d[p] / Math.max(40, B[p]), gg = d[p + 1] / Math.max(40, B[p + 1]), bb = d[p + 2] / Math.max(40, B[p + 2]);
      if (mode === 'bw') {
        var l = (0.299 * r + 0.587 * gg + 0.114 * bb);
        l = curve(l, 1.6);
        d[p] = d[p + 1] = d[p + 2] = l;
      } else {
        d[p] = curve(r, 1.25); d[p + 1] = curve(gg, 1.25); d[p + 2] = curve(bb, 1.25);
      }
    }
    g.putImageData(img, 0, 0);
    return out;
  }
  // ratio 1 = paper → white; darker ratios get extra contrast
  function curve(ratio, k) { var v = 255 - (1 - Math.min(1, ratio)) * 255 * k; return v < 0 ? 0 : v > 255 ? 255 : v; }

  // ------------------------------------------------------------------ document finder
  /**
   * Looks for the biggest bright, roughly 4-sided shape (paper is usually lighter than the table).
   * Returns corners as fractions of the picture (0..1).
   */
  var dcan = document.createElement('canvas');
  function detectQuad(source, sw, sh) {
    var W = 180, H = Math.max(40, Math.round(W * sh / sw));
    if (sh > sw) { H = 180; W = Math.max(40, Math.round(H * sw / sh)); }
    dcan.width = W; dcan.height = H;
    var g = dcan.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, W, H);
    var d = g.getImageData(0, 0, W, H).data, n = W * H;
    var gray = new Float32Array(n);
    for (var i = 0; i < n; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    gray = boxBlur(boxBlur(gray, W, H, 2), W, H, 2);

    // Otsu threshold
    var hist = new Array(256).fill(0);
    for (i = 0; i < n; i++) hist[gray[i] | 0]++;
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, t = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sB += i * hist[i];
      var mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; t = i; }
    }
    var spread = Math.sqrt(best / (n * n));
    if (spread < 12) return { ok: false };   // not enough contrast between paper and table

    // biggest bright blob
    var lab = new Int32Array(n), bestId = 0, bestSize = 0, id = 0, stack = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (lab[i] || gray[i] <= t) continue;
      id++; var sp = 0, size = 0; stack[sp++] = i; lab[i] = id;
      while (sp) {
        var k = stack[--sp]; size++;
        var x = k % W, y = (k / W) | 0;
        if (x > 0 && !lab[k - 1] && gray[k - 1] > t) { lab[k - 1] = id; stack[sp++] = k - 1; }
        if (x < W - 1 && !lab[k + 1] && gray[k + 1] > t) { lab[k + 1] = id; stack[sp++] = k + 1; }
        if (y > 0 && !lab[k - W] && gray[k - W] > t) { lab[k - W] = id; stack[sp++] = k - W; }
        if (y < H - 1 && !lab[k + W] && gray[k + W] > t) { lab[k + W] = id; stack[sp++] = k + W; }
      }
      if (size > bestSize) { bestSize = size; bestId = id; }
    }
    var frac = bestSize / n;
    if (frac < 0.08 || frac > 0.97) return { ok: false };

    // corners: extreme points along the two diagonals
    var tl = [0, 0, Infinity], tr = [0, 0, -Infinity], br = [0, 0, -Infinity], bl = [0, 0, Infinity];
    for (i = 0; i < n; i++) {
      if (lab[i] !== bestId) continue;
      x = i % W; y = (i / W) | 0;
      var s1 = x + y, s2 = x - y;
      if (s1 < tl[2]) tl = [x, y, s1];
      if (s1 > br[2]) br = [x, y, s1];
      if (s2 > tr[2]) tr = [x, y, s2];
      if (s2 < bl[2]) bl = [x, y, s2];
    }
    var quad = [tl, tr, br, bl].map(function (p) { return [(p[0] + 0.5) / W, (p[1] + 0.5) / H]; });
    var qa = area(quad) * n;
    if (qa < 1 || bestSize / qa < 0.78) return { ok: false };   // blob isn't paper-shaped
    return { ok: true, quad: quad };
  }

  function area(q) {
    var a = 0; for (var i = 0; i < 4; i++) { var j = (i + 1) % 4; a += q[i][0] * q[j][1] - q[j][0] * q[i][1]; }
    return Math.abs(a) / 2;
  }

  function boxBlur(src, W, H, r) {
    var tmp = new Float32Array(src.length), out = new Float32Array(src.length), x, y, acc, cnt;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      acc = 0; cnt = 0;
      for (var dx = -r; dx <= r; dx++) { var xx = x + dx; if (xx >= 0 && xx < W) { acc += src[y * W + xx]; cnt++; } }
      tmp[y * W + x] = acc / cnt;
    }
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      acc = 0; cnt = 0;
      for (var dy = -r; dy <= r; dy++) { var yy = y + dy; if (yy >= 0 && yy < H) { acc += tmp[yy * W + x]; cnt++; } }
      out[y * W + x] = acc / cnt;
    }
    return out;
  }

  // ------------------------------------------------------------------ hook onto "Take a photo"
  function hook() {
    var input = document.getElementById('inCamera');
    if (!input) return;
    var label = input.closest('label');
    (label || input).addEventListener('click', function (e) {
      if (S.bypass || !supported) return;          // let the phone's own camera open
      e.preventDefault();
      open();
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();

  window.GabbrielleScanner = { open: open, detectQuad: detectQuad, _orderQuad: orderQuad };
})();
