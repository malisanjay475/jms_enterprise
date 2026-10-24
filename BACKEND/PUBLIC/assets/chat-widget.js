// JMS Chat widget: floating chat button (bottom-right) with an unread badge that opens
// a WhatsApp-style panel. Loaded on every page by app.js. Needs a login session; with
// none, it stays hidden. Message text is always set with textContent (never HTML).
// Phase 2: groups, attachments, delivered/read ticks, typing, search, edit and delete.
// Phase 4: desktop notifications (page + Web Push via /sw.js -> /sw-chat.js), mute,
// sound on/off, @mentions, open a chat from ?chat=<id> (bell, notifications page, push).
// Phase 5: "messages may be reviewed" notice on first open; messages emptied by the
// retention job show as removed.
// Share to chat: mark a spot on any JMS page and send it as a link card; the link opens
// the page, finds the spot again and offers Start work / Mark done. Replies like WhatsApp.
(function () {
  'use strict';
  if (window.__jmsChatLoaded) return;
  window.__jmsChatLoaded = true;
  var path = (window.location.pathname || '').toLowerCase();
  if (/login\.html$/.test(path) || path.indexOf('/vendor/') !== -1) return;

  var API = '/api/chat';
  var MAX_FILE = 10 * 1024 * 1024;
  var EDIT_MS = 15 * 60 * 1000;
  var me = null, isAdmin = false;
  var convs = [], current = null, users = [];
  var adminAll = false, open = false, es = null, retry = 0;
  var oldestTs = null, hasMore = false;
  var editing = null, typingSentAt = 0, typingTimer = null, searchTimer = null;
  var root, els = {};
  var stopped = false; // chat switched off while the page was open
  var replying = null; // message being replied to
  var serverInfo = { server_type: 'MAIN', factory_id: null };
  var soundOn = readPref('jmsChatSound', '1') === '1';
  var swReg = null; // service worker registration, when the page may use one
  // JMS Chat app (chat_app.html, Android app, iPhone home screen): the chat is the whole
  // page — always open, full screen, no floating buttons; ✕ becomes Sign out.
  var appMode = window.__jmsChatAppMode === true;

  function readPref(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (_e) { return d; } }
  function writePref(k, v) { try { localStorage.setItem(k, v); } catch (_e) { } }

  function api(method, url, body) {
    var isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false }; }).then(function (d) {
        if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status));
        return d;
      });
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function same(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }

  function initials(name) {
    var p = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }

  function avatarColor(name) {
    var h = 0, s = String(name || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ',55%,45%)';
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtListTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(ts);
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  }

  function fmtDay(ts) {
    var d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function isGroup(c) { return !!c && c.type === 'group'; }

  // Avatar: profile photo when the person has one, else coloured initials.
  function setAvatar(av, name, photoV, group) {
    av.textContent = group ? '👥' : initials(name);
    av.style.background = avatarColor(name);
    if (!group && photoV && name) {
      var im = document.createElement('img');
      im.alt = '';
      im.loading = 'lazy';
      im.src = API + '/avatars/' + encodeURIComponent(name) + '?v=' + encodeURIComponent(photoV);
      im.onerror = function () { im.remove(); };
      av.appendChild(im);
    }
  }

  function lastSeenText(online, iso) {
    if (online) return 'online';
    if (!iso) return '';
    var t = new Date(iso), now = new Date();
    var days = Math.round((new Date(now.toDateString()) - new Date(t.toDateString())) / 86400000);
    var at = fmtTime(iso);
    if (days === 0) return 'last seen today at ' + at;
    if (days === 1) return 'last seen yesterday at ' + at;
    if (days < 7) return 'last seen ' + t.toLocaleDateString(undefined, { weekday: 'long' }) + ' at ' + at;
    return 'last seen ' + t.toLocaleDateString();
  }

  // Small dialog: { body, close }.
  function modal(title) {
    var wrap = document.createElement('div');
    wrap.className = 'jc-modal';
    var box = document.createElement('div');
    if (title) { var h = document.createElement('h4'); h.textContent = title; box.appendChild(h); }
    var body = document.createElement('div');
    box.appendChild(body);
    wrap.appendChild(box);
    function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    return { box: box, body: body, close: close };
  }

  var QUICK_RX = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  var folders = [];
  var listFilter = 'all', showArchived = false, showStarred = false, showTodos = false, showApprovals = false;

  function convById(id) { return convs.filter(function (x) { return x.sync_id === id; })[0] || (current && current.sync_id === id ? current : null); }

  function isMuted(c) { return !!(c && c.muted_until && new Date(c.muted_until) > new Date()); }

  function escapeRe(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // @me, @all or @everyone as a whole word (same rule as chat_mentions() on the server).
  function mentionsMe(body) {
    var re = new RegExp('(^|[^\\w.@])@(all|everyone|' + escapeRe(me) + ')(?![\\w])', 'i');
    return re.test(String(body || ''));
  }

  function muteLabel(c) {
    if (!isMuted(c)) return '';
    var until = new Date(c.muted_until);
    if (until.getFullYear() > 9000) return 'Muted';
    return 'Muted until ' + until.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ---------------- styles ----------------
  var CSS = [
    '.jc-tr{margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(0,168,132,.08);font-size:13px;white-space:pre-wrap}.jc-tr small{display:block;opacity:.65;font-size:11px}.jc-trbtn{border:0;background:transparent;color:#027eb5;cursor:pointer;font-size:12px;padding:2px 0}',
    '.jc-ack{display:inline-block;margin-top:6px;border:0;border-radius:14px;padding:4px 12px;background:#e53935;color:#fff;cursor:pointer;font-size:12px}.jc-acked{display:block;margin-top:4px;font-size:12px;color:#12a66a;font-weight:600}.jc-esc{display:block;font-size:11px;color:#e53935}',
    '.jc-bot{background:#eef6ff !important;border-left:3px solid #3b82f6}.jc-botl{font-size:11px;font-weight:700;color:#2563eb;margin-bottom:2px}',
    '.jc-appr{padding:10px 14px;border-bottom:1px solid var(--jc-bd)}.jc-appr b{display:block}.jc-appr small{opacity:.75}.jc-appr .jc-act{justify-content:flex-start;margin-top:6px}',
    '.jc-poll{min-width:230px;margin:2px 0}.jc-poll b{display:block;margin-bottom:6px}.jc-popt{position:relative;border:1px solid var(--jc-bd);border-radius:8px;padding:6px 8px;margin:4px 0;cursor:pointer;overflow:hidden;background:rgba(255,255,255,.5)}.jc-popt i{position:absolute;left:0;top:0;bottom:0;background:rgba(0,168,132,.18);font-style:normal}.jc-popt span{position:relative;display:flex;justify-content:space-between;gap:8px}.jc-popt.jc-mine{border-color:#00a884;font-weight:600}.jc-poll small{opacity:.7}',
    '.jc-ann{border-left:4px solid #f59e0b;background:#fff8e6 !important}.jc-annl{font-size:11px;font-weight:700;color:#b45309;margin-bottom:2px}',
    '.jc-urg{border:1.5px solid #e53935 !important}.jc-urgl{font-size:11px;font-weight:700;color:#e53935;margin-bottom:2px}',
    '.jc-pinbar{display:flex;align-items:center;gap:8px;padding:6px 14px;background:var(--jc-bg);border-bottom:1px solid var(--jc-bd);cursor:pointer;font-size:13px}.jc-pinbar span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.jc-todo{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--jc-bd)}.jc-todo.jc-done{opacity:.55;text-decoration:line-through}.jc-todo small{display:block;opacity:.7;text-decoration:none}',
    '.jc-app .jc-side{width:32%;min-width:320px;max-width:440px}',
    '.jc-dl{display:inline-block;margin-top:3px;font-size:12px;color:#027eb5;text-decoration:none}.jc-dl:hover{text-decoration:underline}',
    '.jc-av img{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover}',
    '.jc-chips{display:flex;gap:6px;padding:6px 10px;flex-wrap:wrap}.jc-chip{border:1px solid var(--jc-bd);background:transparent;border-radius:16px;padding:3px 12px;font-size:12px;cursor:pointer;color:inherit}.jc-chip.jc-on{background:rgba(0,168,132,.15);border-color:#00a884;color:#00785f}',
    '.jc-arch{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;font-weight:600;color:#00a884}',
    '.jc-pin{font-size:11px;margin-left:4px;opacity:.7}',
    '.jc-rx{display:flex;gap:3px;margin-top:3px;flex-wrap:wrap}.jc-rx span{border:1px solid var(--jc-bd);border-radius:10px;padding:0 6px;font-size:12px;cursor:pointer;background:rgba(127,127,127,.08)}',
    '.jc-emo{display:flex;gap:2px;padding:4px 6px;border-bottom:1px solid var(--jc-bd)}.jc-emo button{font-size:18px;padding:2px 4px;border:0;background:transparent;cursor:pointer;border-radius:50%}.jc-emo button.jc-on{background:rgba(0,168,132,.2)}',
    '.jc-fwd{font-size:11px;font-style:italic;opacity:.7;margin-bottom:2px}',
    '.jc-modal{position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}.jc-modal>div{background:var(--jc-bg);color:inherit;border-radius:12px;width:min(420px,92vw);max-height:80vh;overflow:auto;padding:14px;box-shadow:0 10px 40px rgba(0,0,0,.4)}.jc-modal h4{margin:0 0 10px}.jc-modal .jc-row2{display:flex;align-items:center;gap:10px;padding:6px 4px;cursor:pointer}.jc-modal .jc-act{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.jc-modal .jc-primary{background:#00a884;color:#fff;border:0;border-radius:18px;padding:6px 16px;cursor:pointer}.jc-modal .jc-plain{background:transparent;border:1px solid var(--jc-bd);border-radius:18px;padding:6px 14px;cursor:pointer;color:inherit}.jc-modal small{opacity:.7}',
    '.jc-call{position:fixed;inset:0;z-index:100020;background:#0b141a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}.jc-call .jc-av{width:110px;height:110px;font-size:40px}.jc-call h2{margin:0;font-weight:600}.jc-call p{margin:0;opacity:.8}.jc-cbtns{display:flex;gap:28px;margin-top:30px}.jc-cbtns button{width:64px;height:64px;border-radius:50%;border:0;font-size:24px;cursor:pointer;color:#fff;background:rgba(255,255,255,.15)}.jc-cbtns .jc-red{background:#e53935}.jc-cbtns .jc-green{background:#00a884}.jc-cbtns .jc-on{background:rgba(255,255,255,.4)}',
    '.jc-app .jc-panel{position:fixed;inset:0;right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0;z-index:100001}.jc-app .jc-fab,.jc-app .jc-sharefab{display:none !important}',
    // the share sheet, mark bar and target banner live outside .jc-root: same colours
    '.jc-root,.jc-sheet-bg,.jc-tbanner,.jc-markbar{--jc-g:#00a884;--jc-gd:#008069;--jc-bg:#fff;--jc-bg2:#f0f2f5;--jc-chat:#efeae2;--jc-out:#d9fdd3;--jc-in:#fff;--jc-tx:#111b21;--jc-mu:#667781;--jc-bd:#e9edef;font-family:inherit;font-size:14px;color:var(--jc-tx)}',
    '.jc-fab{position:fixed;right:20px;bottom:20px;z-index:9990;width:56px;height:56px;border-radius:50%;border:0;background:var(--jc-g);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.jc-fab:hover{background:var(--jc-gd)}',
    '.jc-fab svg{width:28px;height:28px;fill:#fff}',
    '.jc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#e53935;color:#fff;font-size:11px;font-weight:700;line-height:20px;text-align:center;display:none}',
    '.jc-panel{position:fixed;right:20px;bottom:86px;z-index:9991;width:760px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 110px);background:var(--jc-bg);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:none;overflow:hidden}',
    '.jc-panel.jc-open{display:flex}',
    '.jc-side{position:relative;width:300px;border-right:1px solid var(--jc-bd);display:flex;flex-direction:column;min-width:0}',
    '.jc-head{height:56px;flex:none;background:var(--jc-bg2);display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--jc-bd)}',
    '.jc-head h3{margin:0;font-size:16px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.jc-ibtn{border:0;background:none;cursor:pointer;color:var(--jc-mu);padding:6px;border-radius:50%;font-size:18px;line-height:1}',
    '.jc-ibtn:hover{background:rgba(0,0,0,.06)}',
    '.jc-search{padding:8px 10px;border-bottom:1px solid var(--jc-bd)}',
    '.jc-search input,.jc-field{width:100%;box-sizing:border-box;border:0;border-radius:8px;background:var(--jc-bg2);padding:8px 12px;font:inherit;outline:none}',
    '.jc-tabs{display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid var(--jc-bd)}',
    '.jc-tab{border:0;border-radius:14px;padding:4px 12px;background:var(--jc-bg2);cursor:pointer;font:inherit;font-size:12px;color:var(--jc-mu)}',
    '.jc-tab.jc-on{background:#d8fdd2;color:var(--jc-gd);font-weight:600}',
    '.jc-list{flex:1;overflow-y:auto}',
    '.jc-item{display:flex;gap:10px;align-items:center;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--jc-bd)}',
    '.jc-item:hover,.jc-item.jc-sel{background:var(--jc-bg2)}',
    '.jc-av{flex:none;width:40px;height:40px;border-radius:50%;color:#fff;font-weight:600;display:flex;align-items:center;justify-content:center;position:relative;font-size:14px}',
    '.jc-av.jc-on::after{content:"";position:absolute;right:0;bottom:0;width:10px;height:10px;border-radius:50%;background:#25d366;border:2px solid #fff}',
    '.jc-mid{flex:1;min-width:0}',
    '.jc-row{display:flex;justify-content:space-between;gap:6px}',
    '.jc-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.jc-time{font-size:11px;color:var(--jc-mu);flex:none}',
    '.jc-prev{font-size:13px;color:var(--jc-mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.jc-typing{color:var(--jc-gd)}',
    '.jc-unr{flex:none;min-width:18px;height:18px;border-radius:9px;background:#25d366;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:18px;padding:0 5px}',
    '.jc-empty{padding:30px 16px;text-align:center;color:var(--jc-mu);font-size:13px}',
    '.jc-sect{padding:8px 12px 4px;font-size:12px;font-weight:600;color:var(--jc-gd);text-transform:uppercase}',
    '.jc-main{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;background:var(--jc-chat)}',
    '.jc-mh-click{cursor:pointer}',
    '.jc-msgs{flex:1;overflow-y:auto;padding:12px 6%}',
    '.jc-day{text-align:center;margin:10px 0}',
    '.jc-day span,.jc-sys span{background:#fff;border-radius:7px;padding:4px 10px;font-size:12px;color:var(--jc-mu);box-shadow:0 1px .5px rgba(0,0,0,.13)}',
    '.jc-sys{text-align:center;margin:8px 0}',
    '.jc-sys span{background:#fff8d6;color:#5f5300;display:inline-block;max-width:85%}',
    '.jc-msg{display:flex;margin:2px 0;align-items:flex-start}',
    '.jc-msg.jc-out{justify-content:flex-end}',
    '.jc-msg.jc-flash .jc-bub{box-shadow:0 0 0 3px #ffd54f}',
    '.jc-bub{position:relative;max-width:70%;padding:6px 8px 4px;border-radius:8px;background:var(--jc-in);box-shadow:0 1px .5px rgba(0,0,0,.13);white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
    '.jc-out .jc-bub{background:var(--jc-out)}',
    '.jc-snd{font-size:12px;font-weight:600;margin-bottom:2px}',
    '.jc-meta{float:right;margin:6px 0 -2px 10px;font-size:11px;color:var(--jc-mu);white-space:nowrap}',
    '.jc-tick{margin-left:3px;font-size:12px;letter-spacing:-3px}',
    '.jc-tick.jc-read{color:#53bdeb}',
    '.jc-pend{opacity:.6}',
    '.jc-del{font-style:italic;color:var(--jc-mu)}',
    '.jc-opt{position:absolute;top:2px;right:2px;display:none;border:0;border-radius:50%;width:22px;height:22px;background:rgba(255,255,255,.9);cursor:pointer;color:var(--jc-mu);font-size:12px;line-height:22px;padding:0}',
    '.jc-bub:hover .jc-opt{display:block}',
    '.jc-menu{position:absolute;z-index:3;top:26px;right:2px;background:#fff;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.2);padding:4px 0;min-width:150px;white-space:nowrap}',
    '.jc-menu button{display:block;width:100%;border:0;background:none;text-align:left;padding:7px 14px;font:inherit;cursor:pointer}',
    '.jc-menu button:hover{background:var(--jc-bg2)}',
    '.jc-img{display:block;max-width:240px;max-height:240px;border-radius:6px;margin-bottom:4px;cursor:zoom-in;background:#ddd;min-width:80px;min-height:60px}',
    '.jc-file{display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;background:rgba(0,0,0,.05);margin-bottom:4px;text-decoration:none;color:inherit;min-width:180px}',
    '.jc-file b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}',
    '.jc-file small{color:var(--jc-mu)}',
    '.jc-file i{font-style:normal;font-size:24px}',
    '.jc-audio{display:block;width:240px;max-width:100%;margin-bottom:4px}',
    '.jc-more{display:block;margin:4px auto 10px;border:0;border-radius:14px;padding:4px 12px;background:#fff;cursor:pointer;font:inherit;font-size:12px}',
    '.jc-editbar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 12px;background:#fff;border-left:4px solid var(--jc-g);font-size:12px;color:var(--jc-mu)}',
    '.jc-editbar span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.jc-comp{flex:none;display:flex;align-items:flex-end;gap:8px;padding:8px 10px;background:var(--jc-bg2)}',
    '.jc-comp textarea{flex:1;resize:none;border:0;border-radius:8px;padding:9px 12px;font:inherit;max-height:120px;min-height:20px;outline:none;line-height:20px}',
    '.jc-attach{flex:none;height:40px}',
    '.jc-send{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:var(--jc-g);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.jc-send:disabled{opacity:.5;cursor:default}',
    '.jc-send svg{width:20px;height:20px;fill:#fff}',
    '.jc-ro{flex:none;padding:10px;text-align:center;font-size:12px;color:#8a6d00;background:#fff8d6}',
    '.jc-ph{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--jc-mu);text-align:center;padding:20px;background:var(--jc-bg2)}',
    '.jc-ph b{font-size:18px;color:var(--jc-tx);margin:8px 0}',
    '.jc-info{flex:1;overflow-y:auto;background:var(--jc-bg)}',
    '.jc-info section{padding:12px 16px;border-bottom:1px solid var(--jc-bd)}',
    '.jc-info h4{margin:0 0 8px;font-size:13px;color:var(--jc-gd)}',
    '.jc-irow{display:flex;gap:8px;align-items:center}',
    '.jc-btn{border:0;border-radius:18px;padding:7px 16px;background:var(--jc-g);color:#fff;font:inherit;font-weight:600;cursor:pointer}',
    '.jc-btn:disabled{opacity:.5;cursor:default}',
    '.jc-btn.jc-danger{background:none;color:#d93025;padding-left:0}',
    '.jc-role{font-size:11px;color:var(--jc-gd);border:1px solid var(--jc-g);border-radius:8px;padding:0 6px;flex:none}',
    '.jc-chk{flex:none;width:18px;height:18px;accent-color:var(--jc-g)}',
    '.jc-at{color:#027eb5;font-weight:600}',
    '.jc-at.jc-me{background:#fff3c4;border-radius:3px;padding:0 2px}',
    '.jc-mute{font-size:12px;margin-left:4px;color:var(--jc-mu)}',
    '.jc-pop{position:absolute;z-index:5;background:#fff;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.22);padding:4px 0;min-width:200px}',
    '.jc-pop button{display:block;width:100%;border:0;background:none;text-align:left;padding:8px 14px;font:inherit;cursor:pointer;white-space:nowrap}',
    '.jc-pop button:hover,.jc-pop button.jc-on{background:var(--jc-bg2)}',
    '.jc-pop .jc-sub{padding:6px 14px 2px;font-size:11px;color:var(--jc-mu)}',
    '.jc-ment{position:absolute;left:10px;bottom:58px;z-index:4;background:#fff;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.22);max-height:180px;overflow-y:auto;min-width:200px;display:none}',
    '.jc-ment div{padding:7px 12px;cursor:pointer}',
    '.jc-ment div:hover,.jc-ment div.jc-on{background:var(--jc-bg2)}',
    '.jc-notice{display:flex;gap:8px;align-items:flex-start;background:#fff8d6;color:#5f5300;font-size:12px;padding:8px 10px;border-bottom:1px solid var(--jc-bd)}',
    '.jc-notice span{flex:1}',
    '.jc-notice button{border:0;border-radius:12px;background:#5f5300;color:#fff;font:inherit;font-size:11px;padding:3px 10px;cursor:pointer}',
    '.jc-ph small{display:block;margin-top:14px;font-size:11px}',
    // share button, mark mode, compose sheet, link cards, target banner
    '.jc-sharefab{position:fixed;right:86px;bottom:28px;z-index:9990;width:40px;height:40px;border-radius:50%;border:0;background:#fff;color:var(--jc-gd);box-shadow:0 3px 10px rgba(0,0,0,.22);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center}',
    '.jc-sharefab:hover{background:#e7fce3}',
    '.jc-root.jc-stack .jc-sharefab{right:42px;bottom:176px}',
    '.jc-markbar{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:100003;background:#0f172a;color:#fff;border-radius:10px;padding:10px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.35);font-size:14px;max-width:calc(100vw - 32px);flex-wrap:wrap}',
    '.jc-markbar button{border:0;border-radius:6px;padding:6px 10px;font:inherit;font-size:13px;cursor:pointer;background:#334155;color:#fff}',
    '.jc-markbar button.jc-pri{background:var(--jc-g)}',
    '.jc-markbox{position:fixed;z-index:100002;pointer-events:none;border:2px solid #f59e0b;background:rgba(245,158,11,.12);border-radius:4px;transition:all .06s}',
    '.jc-sheet-bg{position:fixed;inset:0;z-index:100004;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.jc-sheet{background:#fff;border-radius:12px;width:460px;max-width:100%;max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden}',
    '.jc-sheet h3{margin:0;padding:14px 16px;font-size:16px;border-bottom:1px solid var(--jc-bd);display:flex;justify-content:space-between;align-items:center}',
    '.jc-sheet .jc-sbody{padding:12px 16px;overflow-y:auto;flex:1}',
    '.jc-sheet .jc-sfoot{padding:10px 16px;border-top:1px solid var(--jc-bd);display:flex;gap:8px;justify-content:flex-end;align-items:center}',
    '.jc-sheet textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font:inherit;min-height:60px;resize:vertical}',
    '.jc-sheet .jc-slabel{font-size:12px;font-weight:700;color:var(--jc-mu);margin:12px 0 6px;text-transform:uppercase}',
    '.jc-prio{display:flex;gap:8px}',
    '.jc-prio label{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;cursor:pointer;display:flex;gap:6px;align-items:center}',
    '.jc-prio label.jc-urg.jc-sel{border-color:#dc2626;background:#fef2f2;color:#b91c1c}',
    '.jc-prio label.jc-sel{border-color:var(--jc-g);background:#ecfdf5}',
    '.jc-linkcard{display:block;border-left:4px solid var(--jc-g);background:rgba(0,0,0,.04);border-radius:6px;padding:7px 9px;margin-bottom:4px;cursor:pointer;min-width:200px}',
    '.jc-linkcard.jc-urgent{border-left-color:#dc2626}',
    '.jc-linkcard b{display:block;font-size:13px}',
    '.jc-linkcard .jc-lx{font-size:12px;color:var(--jc-mu);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}',
    '.jc-linkcard .jc-lrow{display:flex;gap:6px;align-items:center;margin-top:5px;flex-wrap:wrap}',
    '.jc-badge2{font-size:10px;font-weight:700;border-radius:8px;padding:1px 7px;text-transform:uppercase;letter-spacing:.02em}',
    '.jc-st-open{background:#e0f2fe;color:#0369a1}',
    '.jc-st-in_progress{background:#fef3c7;color:#92400e}',
    '.jc-st-done{background:#dcfce7;color:#15803d}',
    '.jc-urg-b{background:#fee2e2;color:#b91c1c}',
    '.jc-ackbtn{border:0;border-radius:6px;padding:4px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;background:#dc2626;color:#fff}',
    '.jc-ackbtn:disabled{opacity:.6;cursor:default}',
    '.jc-target{outline:3px solid #f59e0b !important;outline-offset:2px;border-radius:3px;animation:jcPulse 1.2s ease-in-out 4}',
    '@keyframes jcPulse{0%,100%{outline-color:#f59e0b;box-shadow:0 0 0 0 rgba(245,158,11,.6)}50%{outline-color:#dc2626;box-shadow:0 0 0 10px rgba(245,158,11,0)}}',
    '.jc-tbanner{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:100001;background:#fff;border:1px solid #fcd34d;border-left:5px solid #f59e0b;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:10px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 32px);width:640px;font-size:14px}',
    '.jc-tbanner .jc-tmsg{flex:1;min-width:200px}',
    '.jc-tbanner .jc-tmsg small{display:block;color:var(--jc-mu);font-size:12px;margin-top:2px}',
    '.jc-tbanner button{border:0;border-radius:6px;padding:6px 10px;font:inherit;font-size:13px;cursor:pointer;background:#e2e8f0;color:#0f172a}',
    '.jc-tbanner button.jc-pri{background:var(--jc-g);color:#fff}',
    '.jc-ctxpill{position:fixed;z-index:100003;background:#0f172a;color:#fff;border:0;border-radius:16px;padding:7px 12px;font:inherit;font-size:13px;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.3)}',
    // replies
    '.jc-quote{border-left:3px solid var(--jc-g);background:rgba(0,0,0,.05);border-radius:5px;padding:4px 8px;margin-bottom:4px;cursor:pointer;display:flex;gap:6px;align-items:center;max-width:100%}',
    '.jc-quote div{min-width:0}',
    '.jc-quote b{display:block;font-size:12px;color:var(--jc-gd)}',
    '.jc-quote span{display:block;font-size:12px;color:var(--jc-mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.jc-quote img{width:34px;height:34px;object-fit:cover;border-radius:4px;flex:none}',
    '.jc-rbtn{position:absolute;top:50%;transform:translateY(-50%);display:none;border:0;border-radius:50%;width:26px;height:26px;background:rgba(255,255,255,.95);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:pointer;font-size:13px;color:var(--jc-mu);padding:0}',
    '.jc-msg:hover .jc-rbtn{display:block}',
    '.jc-msg .jc-rbtn{right:-32px}',
    '.jc-msg.jc-out .jc-rbtn{right:auto;left:-32px}',
    '.jc-replybar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 12px;background:#fff;border-left:4px solid var(--jc-g)}',
    '.jc-replybar .jc-rb{flex:1;min-width:0}',
    '.jc-replybar b{display:block;font-size:12px;color:var(--jc-gd)}',
    '.jc-replybar span{display:block;font-size:12px;color:var(--jc-mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.jc-replybar img{width:34px;height:34px;object-fit:cover;border-radius:4px}',
    '.jc-sys.jc-sysr span{cursor:pointer;text-decoration:underline dotted}',
    '@media (max-width:640px){.jc-panel.jc-open~.jc-sharefab{display:none}.jc-sharefab{right:80px;bottom:24px}}',
    // image viewer
    '.jc-iv{position:fixed;inset:0;z-index:100010;background:rgba(8,12,18,.94);display:flex;flex-direction:column;color:#fff;font-family:inherit;touch-action:none;user-select:none}',
    '.jc-iv-head{flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,0))}',
    '.jc-iv-who{flex:1;min-width:0}',
    '.jc-iv-who b{display:block;font-size:15px}',
    '.jc-iv-who span{font-size:12px;color:#cbd5e1}',
    '.jc-iv-count{font-size:13px;color:#cbd5e1}',
    '.jc-iv-btn{border:0;background:rgba(255,255,255,.12);color:#fff;width:40px;height:40px;border-radius:50%;font-size:20px;line-height:40px;text-align:center;cursor:pointer;text-decoration:none;padding:0;flex:none}',
    '.jc-iv-btn:hover,.jc-iv-btn:focus-visible,.jc-iv-nav:hover,.jc-iv-nav:focus-visible{background:rgba(255,255,255,.28);outline:2px solid #00a884;outline-offset:1px}',
    '.jc-iv-btn:disabled{opacity:.35;cursor:default}',
    '.jc-iv-stage{flex:1;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:zoom-out}',
    '.jc-iv-img{max-width:calc(100% - 24px);max-height:100%;object-fit:contain;transform-origin:center center;cursor:zoom-in;will-change:transform;transition:opacity .15s}',
    '.jc-iv.jc-iv-zoomed .jc-iv-img{cursor:grab}',
    '.jc-iv.jc-iv-zoomed .jc-iv-img:active{cursor:grabbing}',
    '.jc-iv-spin{position:absolute;left:50%;top:50%;width:42px;height:42px;margin:-21px 0 0 -21px;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:jcSpin .8s linear infinite}',
    '@keyframes jcSpin{to{transform:rotate(360deg)}}',
    '.jc-iv-err{position:absolute;display:none;color:#fecaca;font-size:14px}',
    '.jc-iv-nav{position:absolute;top:50%;transform:translateY(-50%);border:0;width:46px;height:64px;border-radius:8px;background:rgba(255,255,255,.12);color:#fff;font-size:36px;cursor:pointer;z-index:2}',
    '.jc-iv-prev{left:12px}',
    '.jc-iv-next{right:12px}',
    '.jc-iv-tools{flex:none;display:flex;gap:10px;align-items:center;justify-content:center;padding:10px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.55))}',
    '.jc-iv-pct{min-width:52px;text-align:center;font-size:13px;color:#e2e8f0}',
    '@media (max-width:640px){.jc-iv-nav{display:none !important}.jc-iv-head{padding:8px 10px}}',
    '.jc-err{background:#fde8e8;color:#b42318;font-size:12px;padding:6px 10px;display:none}',
    '.jc-back{display:none}',
    '.jc-toast{position:fixed;right:20px;bottom:86px;z-index:9992;max-width:300px;background:#fff;border-left:4px solid var(--jc-g);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:10px 12px;cursor:pointer}',
    '.jc-toast b{display:block;margin-bottom:2px}',
    '.jc-toast span{color:var(--jc-mu);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // The AI assistant button sits at right/bottom 30px: stack above it, open the panel beside it.
    '.jc-root.jc-stack .jc-fab{right:34px;bottom:108px}',
    '.jc-root.jc-stack .jc-toast{right:108px;bottom:30px}',
    '.jc-root.jc-stack .jc-panel{right:108px;bottom:20px;max-width:calc(100vw - 128px);max-height:calc(100vh - 40px)}',
    '@media (max-width:640px){.jc-panel{z-index:100001;right:0;bottom:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}.jc-side{width:100%;border:0}.jc-main{display:none}.jc-panel.jc-conv .jc-side{display:none}.jc-panel.jc-conv .jc-main{display:flex}.jc-back{display:inline-block}.jc-fab{right:16px;bottom:16px}.jc-panel.jc-open~.jc-fab{display:none}.jc-root.jc-stack .jc-panel{right:0;bottom:0;max-width:100vw;max-height:100vh}.jc-opt{display:block}}',
    '/* premium look for the full-window chat (JMS Chat page) */ .jc-app{font-family:\'Segoe UI\',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif}',
    '.jc-app .jc-head{height:60px;background:linear-gradient(135deg,#075e54,#0b7c6e);color:#fff;border-bottom:0;box-shadow:0 1px 3px rgba(0,0,0,.12)}',
    '.jc-app .jc-head h3,.jc-app .jc-head .jc-name{color:#fff}.jc-app .jc-head .jc-prev{color:rgba(255,255,255,.82)}',
    '.jc-app .jc-head .jc-ibtn{color:#fff;border-radius:50%;transition:background .15s}.jc-app .jc-head .jc-ibtn:hover{background:rgba(255,255,255,.14)}',
    '.jc-app .jc-search{padding:8px 12px;background:var(--jc-bg)}.jc-app .jc-search input{border-radius:20px;background:var(--jc-bg2);border:1px solid transparent;transition:border-color .15s,background .15s}.jc-app .jc-search input:focus{background:#fff;border-color:#00a884}',
    '.jc-app .jc-item{transition:background .12s}.jc-app .jc-item:hover{background:#f5f6f6}.jc-app .jc-item.jc-sel{background:#e9f5f2}',
    '.jc-app .jc-unr{background:#25d366;box-shadow:0 1px 2px rgba(0,0,0,.15)}',
    '.jc-app .jc-msgs{background-color:#efeae2;background-image:radial-gradient(rgba(107,91,69,.09) 1.2px,transparent 1.4px);background-size:22px 22px;padding:16px 7%}',
    '.jc-app .jc-bub{border-radius:10px;box-shadow:0 1px .5px rgba(11,20,26,.13),0 2px 6px rgba(11,20,26,.04)}',
    '.jc-app .jc-day span{box-shadow:0 1px .5px rgba(11,20,26,.13);border-radius:8px}',
    '.jc-app .jc-comp{background:#f0f2f5;padding:10px 16px;gap:10px}.jc-app .jc-comp textarea{border-radius:22px;padding:11px 16px;box-shadow:0 1px 2px rgba(0,0,0,.06)}',
    '.jc-app .jc-send{border-radius:50%;box-shadow:0 2px 6px rgba(0,168,132,.35);transition:transform .1s}.jc-app .jc-send:active{transform:scale(.94)}',
    '.jc-app .jc-chip{transition:all .12s}.jc-app .jc-chip:hover{border-color:#00a884}',
    '.jc-app ::-webkit-scrollbar{width:7px;height:7px}.jc-app ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.18);border-radius:4px}.jc-app ::-webkit-scrollbar-track{background:transparent}'
  ].join('\n');

  var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.03 2 11c0 2.4 1.05 4.58 2.75 6.19L4 22l4.6-2.1c1.05.3 2.19.46 3.4.46 5.52 0 10-4.03 10-9S17.52 2 12 2z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';
  var FILE_ICON = { pdf: '📄', xlsx: '📊', audio: '🎤', image: '📷' };

  // ---------------- build ----------------
  function build() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    root = el('div', 'jc-root');
    var panel = el('div', 'jc-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat');

    // side
    var side = el('div', 'jc-side');
    var sh = el('div', 'jc-head');
    sh.appendChild(el('h3', null, 'Chats'));
    var bellBtn = el('button', 'jc-ibtn', '🔔');
    bellBtn.title = 'Notifications and sound';
    var groupBtn = el('button', 'jc-ibtn', '👥');
    groupBtn.title = 'New group';
    var newBtn = el('button', 'jc-ibtn', '✎');
    newBtn.title = 'New chat';
    var closeBtn = el('button', 'jc-ibtn', '✕');
    closeBtn.title = 'Close';
    var starBtn = el('button', 'jc-ibtn', '⭐');
    starBtn.title = 'Starred messages';
    var todoBtn = el('button', 'jc-ibtn', '📋');
    todoBtn.title = 'My tasks';
    var apprBtn = el('button', 'jc-ibtn', '✅');
    apprBtn.title = 'Approvals waiting for me';
    sh.appendChild(apprBtn);
    sh.appendChild(todoBtn);
    sh.appendChild(starBtn); sh.appendChild(bellBtn); sh.appendChild(groupBtn); sh.appendChild(newBtn); sh.appendChild(closeBtn);
    var search = el('div', 'jc-search');
    var sIn = el('input');
    sIn.placeholder = 'Search chats, people and messages';
    search.appendChild(sIn);
    var tabs = el('div', 'jc-tabs');
    var tMine = el('button', 'jc-tab jc-on', 'My chats');
    var tAll = el('button', 'jc-tab', 'All chats (admin)');
    tabs.appendChild(tMine); tabs.appendChild(tAll);
    tabs.style.display = 'none';
    var err = el('div', 'jc-err');
    var list = el('div', 'jc-list');
    side.appendChild(sh); side.appendChild(search); side.appendChild(tabs); side.appendChild(err); side.appendChild(list);

    // main
    var main = el('div', 'jc-main');
    var mh = el('div', 'jc-head');
    var back = el('button', 'jc-ibtn jc-back', '←');
    back.title = 'Back';
    var mAv = el('div', 'jc-av');
    var mTitle = el('div', 'jc-mid');
    var mName = el('div', 'jc-name');
    var mSub = el('div', 'jc-prev');
    mTitle.appendChild(mName); mTitle.appendChild(mSub);
    var mMute = el('button', 'jc-ibtn', '🔕');
    mMute.title = 'Mute notifications';
    var mInfo = el('button', 'jc-ibtn', 'ⓘ');
    mInfo.title = 'Group info';
    var mClose = el('button', 'jc-ibtn', '✕');
    mClose.title = 'Close';
    var mCall = el('button', 'jc-ibtn', '📞');
    mCall.title = 'Voice call';
    mh.appendChild(back); mh.appendChild(mAv); mh.appendChild(mTitle); mh.appendChild(mCall); mh.appendChild(mMute); mh.appendChild(mInfo); mh.appendChild(mClose);
    var msgs = el('div', 'jc-msgs');
    var ro = el('div', 'jc-ro', 'Superadmin view: read-only. Your viewing is logged.');
    var editBar = el('div', 'jc-editbar');
    var editTxt = el('span');
    var editX = el('button', 'jc-ibtn', '✕');
    editX.title = 'Cancel edit';
    editBar.appendChild(el('b', null, '✎ Editing')); editBar.appendChild(editTxt); editBar.appendChild(editX);
    var comp = el('div', 'jc-comp');
    var attach = el('button', 'jc-ibtn jc-attach', '📎');
    attach.title = 'Send a photo, PDF, Excel or audio file (max 10 MB)';
    var fileIn = el('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/jpeg,image/png,image/gif,image/webp,application/pdf,.pdf,.xlsx,audio/*,video/mp4';
    fileIn.style.display = 'none';
    var ta = el('textarea');
    ta.rows = 1;
    ta.placeholder = 'Type a message  ( /help for JMS commands )';
    ta.maxLength = 4000;
    var send = el('button', 'jc-send');
    send.innerHTML = ICON_SEND;
    send.title = 'Send';
    var moreBtn = el('button', 'jc-ibtn jc-attach', '➕');
    moreBtn.title = 'Poll, announcement, urgent, schedule';
    moreBtn.addEventListener('click', function (e) { e.stopPropagation(); composeMore(moreBtn); });
    comp.appendChild(moreBtn); comp.appendChild(attach); comp.appendChild(fileIn); comp.appendChild(ta); comp.appendChild(send);
    var ment = el('div', 'jc-ment');
    var ph = el('div', 'jc-ph');
    ph.appendChild(el('div', null, '💬'));
    ph.appendChild(el('b', null, 'JMS Chat'));
    ph.appendChild(el('div', null, 'Pick a chat on the left, press ✎ to message anyone, or 👥 to make a group.'));
    ph.appendChild(el('small', null, 'Messages may be reviewed by administrators.'));
    main.appendChild(ph);

    panel.appendChild(side); panel.appendChild(main);

    var fab = el('button', 'jc-fab');
    fab.innerHTML = ICON_CHAT;
    fab.title = 'Chat';
    fab.setAttribute('aria-label', 'Open chat');
    var badge = el('span', 'jc-badge');
    fab.appendChild(badge);

    // Share to chat: mark something on this page and send it to people.
    var shareFab = el('button', 'jc-sharefab', '🔗');
    shareFab.title = 'Share to chat: mark a problem on this page and send it';
    shareFab.setAttribute('aria-label', 'Share to chat');
    shareFab.addEventListener('click', function () { startMark(); });
    var replyBar = el('div', 'jc-replybar');
    replyBar.style.display = 'none';
    root.appendChild(panel); root.appendChild(fab); root.appendChild(shareFab);
    document.body.appendChild(root);
    var stack = function () { root.classList.toggle('jc-stack', !!document.querySelector('.ai-chat-widget')); };
    stack();
    setTimeout(stack, 2000);
    setTimeout(stack, 6000);

    els = { panel: panel, list: list, sIn: sIn, tabs: tabs, tMine: tMine, tAll: tAll, err: err,
      main: main, mh: mh, mAv: mAv, mName: mName, mSub: mSub, mTitle: mTitle, mInfo: mInfo, msgs: msgs, ro: ro,
      comp: comp, ta: ta, send: send, ph: ph, badge: badge, newBtn: newBtn, fileIn: fileIn,
      editBar: editBar, editTxt: editTxt, replyBar: replyBar, ment: ment, mMute: mMute, side: side, mCall: mCall };
    starBtn.addEventListener('click', function () { showStarred = !showStarred; showTodos = false; sIn.value = ''; renderList(); });
    todoBtn.addEventListener('click', function () { showTodos = !showTodos; showStarred = false; showApprovals = false; sIn.value = ''; renderList(); });
    apprBtn.addEventListener('click', function () { showApprovals = !showApprovals; showTodos = false; showStarred = false; sIn.value = ''; renderList(); });
    mCall.addEventListener('click', function () { if (current && !isGroup(current)) webCall.start(current.title); });

    fab.addEventListener('click', function () { toggle(!open); });
    if (appMode) {
      root.classList.add('jc-app');
      var inJms = !!(window.JMSChatApp && window.JMSChatApp.backToJms);
      closeBtn.textContent = inJms ? '⌂' : '⎋';
      closeBtn.title = inJms ? 'Back to JMS' : 'Sign out';
      mClose.style.display = 'none';
      closeBtn.addEventListener('click', function () {
        if (inJms) { window.JMSChatApp.backToJms(); return; }
        if (!confirm('Sign out of JMS Chat?')) return;
        if (window.JMSChatApp && window.JMSChatApp.signOut) window.JMSChatApp.signOut();
      });
    } else {
      closeBtn.addEventListener('click', function () { toggle(false); });
      mClose.addEventListener('click', function () { toggle(false); });
    }
    back.addEventListener('click', function () { current = null; cancelEdit(); panel.classList.remove('jc-conv'); renderList(); });
    newBtn.addEventListener('click', function () { sIn.value = ''; sIn.focus(); showPeople(''); });
    groupBtn.addEventListener('click', function () { showNewGroup(); });
    sIn.addEventListener('input', function () {
      if (sIn.value.trim() || !els.peopleMode) renderList(); else showPeople(sIn.value);
    });
    tMine.addEventListener('click', function () { setAdminAll(false); });
    tAll.addEventListener('click', function () { setAdminAll(true); });
    send.addEventListener('click', sendMessage);
    attach.addEventListener('click', function () { fileIn.click(); });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (f) sendFile(f);
    });
    mTitle.addEventListener('click', function () { if (isGroup(current)) showGroupInfo(); });
    bellBtn.addEventListener('click', function (e) { e.stopPropagation(); showSettings(bellBtn); });
    mMute.addEventListener('click', function (e) { e.stopPropagation(); showMuteMenu(mMute); });
    mInfo.addEventListener('click', function () { if (isGroup(current)) showGroupInfo(); });
    editX.addEventListener('click', cancelEdit);
    ta.addEventListener('keydown', function (e) {
      if (mentionOpen() && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(0); return; }
      if (mentionOpen() && e.key === 'Escape') { e.stopPropagation(); hideMention(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      else if (e.key === 'Escape' && editing) { e.stopPropagation(); cancelEdit(); }
    });
    ta.addEventListener('input', function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
      sendTyping();
      updateMention();
    });
    ta.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.files) || [];
      if (items.length) { e.preventDefault(); sendFile(items[0]); }
    });
    msgs.addEventListener('dragover', function (e) { e.preventDefault(); });
    msgs.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) sendFile(f);
    });
    document.addEventListener('click', function (e) {
      if (openMenu && !openMenu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) toggle(false); });
  }

  function showErr(msg) {
    els.err.textContent = msg || '';
    els.err.style.display = msg ? 'block' : 'none';
    if (msg) { clearTimeout(showErr.t); showErr.t = setTimeout(function () { showErr(''); }, 8000); }
  }

  // Shown once per person on this browser, the first time they open chat.
  function showNoticeOnce() {
    var key = 'jmsChatNotice:' + String(me).toLowerCase();
    if (readPref(key, '') || els.notice) return;
    var n = el('div', 'jc-notice');
    n.setAttribute('role', 'note');
    n.appendChild(el('span', null, '🛈 Messages may be reviewed by administrators. Keep chat for work.'));
    var okBtn = el('button', null, 'OK');
    okBtn.addEventListener('click', function () { writePref(key, String(Date.now())); n.remove(); els.notice = null; });
    n.appendChild(okBtn);
    els.list.parentNode.insertBefore(n, els.list);
    els.notice = n;
  }

  function toggle(v) {
    open = v;
    if (v) showNoticeOnce();
    els.panel.classList.toggle('jc-open', v);
    if (v) {
      loadConvs();
      if (current) markRead(current.sync_id);
    }
  }

  function setAdminAll(v) {
    adminAll = v;
    els.tMine.classList.toggle('jc-on', !v);
    els.tAll.classList.toggle('jc-on', v);
    current = null;
    showPlaceholder();
    loadConvs();
  }

  // ---------------- list ----------------
  function loadConvs() {
    return api('GET', API + '/conversations' + (adminAll ? '?all=1' : '')).then(function (d) {
      convs = d.conversations || [];
      showErr('');
      if (!els.groupMode) renderList();
      updateBadge();
    }).catch(function (e) { showErr(e.message); });
  }

  var typingIn = {}; // conversation sync_id -> { name, until }
  function typingText(convId) {
    var t = typingIn[convId];
    if (!t || t.until < Date.now()) return '';
    var c = convs.filter(function (x) { return x.sync_id === convId; })[0] || current;
    return isGroup(c) ? t.name + ' is typing…' : 'typing…';
  }

  function renderList() {
    els.peopleMode = false;
    els.groupMode = false;
    var q = els.sIn.value.trim().toLowerCase();
    var list = els.list;
    list.textContent = '';
    if (showStarred && !q) { renderStarred(list); return; }
    if (showTodos && !q) { renderTodos(list); return; }
    if (showApprovals && !q) { renderApprovals(list); return; }
    if (!q && !adminAll) {
      var chips = el('div', 'jc-chips');
      [['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups']].concat(folders.map(function (f) { return ['f:' + f.id, '📁 ' + f.name]; }))
        .forEach(function (f) {
          var b = el('button', 'jc-chip' + (listFilter === f[0] ? ' jc-on' : ''), f[1]);
          b.addEventListener('click', function () { listFilter = f[0]; renderList(); });
          if (f[0].indexOf('f:') === 0) {
            b.title = 'Right-click: rename or delete';
            b.addEventListener('contextmenu', function (e) { e.preventDefault(); folderMenu(f[0].slice(2)); });
          }
          chips.appendChild(b);
        });
      var nf = el('button', 'jc-chip', '＋ Folder');
      nf.title = 'New chat folder';
      nf.addEventListener('click', function () { folderDialog(null); });
      chips.appendChild(nf);
      list.appendChild(chips);
      var archived = convs.filter(function (c) { return c.archived; }).length;
      if (archived || showArchived) {
        var ar = el('div', 'jc-arch', showArchived ? '← Back to chats' : '🗄 Archived (' + archived + ')');
        ar.addEventListener('click', function () { showArchived = !showArchived; renderList(); });
        list.appendChild(ar);
      }
    }
    var shown = convs.filter(function (c) {
      if (q) return c.title.toLowerCase().indexOf(q) !== -1 || (c.members || []).join(' ').toLowerCase().indexOf(q) !== -1;
      if (adminAll) return true;
      if (Boolean(c.archived) !== showArchived) return false;
      if (listFilter === 'unread') return c.unread > 0;
      if (listFilter === 'groups') return isGroup(c);
      if (listFilter.indexOf('f:') === 0) {
        var fo = folders.filter(function (f) { return 'f:' + f.id === listFilter; })[0];
        return !fo || fo.conversations.indexOf(c.sync_id) !== -1;
      }
      return true;
    });
    shown.forEach(function (c) {
      var it = el('div', 'jc-item' + (current && current.sync_id === c.sync_id ? ' jc-sel' : ''));
      var av = el('div', 'jc-av' + (c.online ? ' jc-on' : ''));
      setAvatar(av, c.title, c.photo_v, isGroup(c));
      var mid = el('div', 'jc-mid');
      var r1 = el('div', 'jc-row');
      var nm = el('div', 'jc-name', c.title);
      if (isMuted(c)) { var mi = el('span', 'jc-mute', '🔕'); mi.title = muteLabel(c); nm.appendChild(mi); }
      if (c.pinned) nm.appendChild(el('span', 'jc-pin', '📌'));
      r1.appendChild(nm);
      r1.appendChild(el('div', 'jc-time', fmtListTime(c.last_message_at)));
      var r2 = el('div', 'jc-row');
      var typing = typingText(c.sync_id);
      var prefix = '';
      if (c.last_sender) {
        if (same(c.last_sender, me) && !adminAll) prefix = 'You: ';
        else if (adminAll || isGroup(c)) prefix = c.last_sender + ': ';
      }
      r2.appendChild(el('div', 'jc-prev' + (typing ? ' jc-typing' : ''), typing || (prefix + (c.last_body || ''))));
      if (c.unread && c.is_member) r2.appendChild(el('div', 'jc-unr', String(c.unread)));
      mid.appendChild(r1); mid.appendChild(r2);
      it.appendChild(av); it.appendChild(mid);
      it.addEventListener('click', function () { openConv(c); });
      if (!adminAll && c.is_member !== false) {
        it.addEventListener('contextmenu', function (e) { e.preventDefault(); chatMenu(c); });
        it.title = 'Right-click: pin or archive';
      }
      list.appendChild(it);
    });
    if (q && !adminAll) {
      // Also offer people matching the search who have no chat yet, then matching messages.
      appendPeople(q, shown);
      scheduleSearch(q);
    } else if (!shown.length) {
      list.appendChild(el('div', 'jc-empty', adminAll ? 'No chats yet.' : 'No chats yet. Press ✎ to message someone.'));
    }
  }

  function chatMenu(c) {
    var m = modal(c.title);
    [[c.pinned ? '📌 Unpin chat' : '📌 Pin chat', 'pin', !c.pinned], [c.archived ? '🗄 Unarchive chat' : '🗄 Archive chat', 'archive', !c.archived]]
      .forEach(function (o) {
        var r = el('div', 'jc-row2', o[0]);
        r.addEventListener('click', function () {
          m.close();
          api('POST', API + '/conversations/' + encodeURIComponent(c.sync_id) + '/' + o[1], { on: o[2] })
            .then(function () { loadConvs(); }).catch(function (e) { showErr(e.message); });
        });
        m.body.appendChild(r);
      });
    folders.forEach(function (f) {
      var inIt = f.conversations.indexOf(c.sync_id) !== -1;
      var r = el('div', 'jc-row2', (inIt ? '✓ In folder ' : '📁 Add to folder ') + f.name);
      r.addEventListener('click', function () {
        m.close();
        var list = inIt ? f.conversations.filter(function (x) { return x !== c.sync_id; }) : f.conversations.concat([c.sync_id]);
        saveFolder(f.id, { conversations: list });
      });
      m.body.appendChild(r);
    });
    if (canSecure(c)) {
      var d = el('div', 'jc-row2', '⏳ Disappearing messages: ' + disappearLabel(c.disappear_seconds) + '…');
      d.addEventListener('click', function () { m.close(); disappearDialog(c); });
      m.body.appendChild(d);
      var p = el('div', 'jc-row2', c.protected ? '🔓 Turn off protected chat' : '🔒 Make protected (no screenshots, downloads, forwarding)');
      p.addEventListener('click', function () { m.close(); setSecurity(c, { protected: !c.protected }); });
      m.body.appendChild(p);
    }
  }

  // ---------------- phase D: folders, disappearing, protected chats, devices ----------------
  var DISAPPEAR = [[0, 'Off'], [86400, '24 hours'], [604800, '7 days'], [7776000, '90 days']];
  function disappearLabel(s) { var o = DISAPPEAR.filter(function (x) { return x[0] === (s || 0); })[0]; return o ? o[1] : 'Off'; }
  function canSecure(c) {
    return !!c && c.is_member !== false && (!isGroup(c) || c.my_role === 'admin' || isAdmin);
  }
  function isProtected(convId) { var c = convById(convId); return !!(c && c.protected); }

  function loadFolders() {
    return api('GET', API + '/folders').then(function (d) { folders = d.folders || []; renderListIfIdle(); }).catch(function () {});
  }
  function saveFolder(id, body) {
    api(id ? 'PUT' : 'POST', API + '/folders' + (id ? '/' + encodeURIComponent(id) : ''), body)
      .then(loadFolders).catch(function (e) { showErr(e.message); });
  }
  function folderDialog(f) {
    var dlg = modal(f ? 'Rename folder' : '📁 New chat folder');
    var n = field('Folder name', 'text', f ? f.name : '');
    dlg.body.appendChild(n.wrap);
    if (!f) dlg.body.appendChild(el('small', null, 'Then right-click a chat → "Add to folder".'));
    dialogButtons(dlg, f ? 'Save' : 'Create', function () {
      var name = n.input.value.trim();
      if (!name) return;
      dlg.close();
      saveFolder(f ? f.id : null, { name: name });
    });
    setTimeout(function () { n.input.focus(); }, 30);
  }
  function folderMenu(id) {
    var f = folders.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var m = modal('📁 ' + f.name);
    var r1 = el('div', 'jc-row2', '✎ Rename');
    r1.addEventListener('click', function () { m.close(); folderDialog(f); });
    var r2 = el('div', 'jc-row2', '🗑 Delete folder (chats stay)');
    r2.addEventListener('click', function () {
      m.close();
      api('DELETE', API + '/folders/' + encodeURIComponent(id)).then(function () {
        if (listFilter === 'f:' + id) listFilter = 'all';
        loadFolders();
      }).catch(function (e) { showErr(e.message); });
    });
    m.body.appendChild(r1); m.body.appendChild(r2);
  }

  function setSecurity(c, body) {
    api('PUT', API + '/conversations/' + encodeURIComponent(c.sync_id) + '/security', body)
      .then(function (d) { c.disappear_seconds = d.disappear_seconds; c.protected = d.protected; loadConvs(); if (current && current.sync_id === c.sync_id) redraw(); })
      .catch(function (e) { showErr(e.message); });
  }
  function disappearDialog(c) {
    var m = modal('⏳ Disappearing messages');
    m.body.appendChild(el('small', null, 'New messages are deleted for everyone after this time.'));
    DISAPPEAR.forEach(function (o) {
      var r = el('div', 'jc-row2', ((c.disappear_seconds || 0) === o[0] ? '● ' : '○ ') + o[1]);
      r.addEventListener('click', function () { m.close(); setSecurity(c, { disappear_seconds: o[0] }); });
      m.body.appendChild(r);
    });
  }

  function devicesDialog() {
    var dlg = modal('📱 My devices');
    function draw() {
      dlg.body.textContent = '';
      api('GET', API + '/devices').then(function (d) {
        var ds = d.devices || [];
        if (!ds.length) dlg.body.appendChild(el('div', 'jc-empty', 'No chat-app sign-ins yet.'));
        ds.forEach(function (x) {
          var r = el('div', 'jc-row2');
          r.appendChild(el('div', 'jc-name', (x.platform === 'android-app' ? '📱 ' : '💻 ') + (x.name || 'Device') + (x.current ? ' (this one)' : '')));
          r.appendChild(el('small', null, (x.approved ? (x.signed_in ? 'Signed in' : 'Signed out') : '⏳ Waiting for approval') +
            (x.last_seen_at ? ' · last used ' + fmtListTime(x.last_seen_at) : '')));
          if (x.signed_in && !x.current) {
            var b = el('button', 'jc-plain', 'Sign out');
            b.addEventListener('click', function () {
              api('POST', API + '/devices/' + encodeURIComponent(x.id) + '/signout').then(draw).catch(function (e) { showErr(e.message); });
            });
            r.appendChild(b);
          }
          dlg.body.appendChild(r);
        });
        var all = el('button', 'jc-plain', 'Sign out all other devices');
        all.style.color = '#d33';
        all.addEventListener('click', function () {
          api('POST', API + '/devices/signout-others').then(function (r) { toastText('Signed out ' + r.signed_out + ' device(s)'); draw(); })
            .catch(function (e) { showErr(e.message); });
        });
        dlg.body.appendChild(all);
      }).catch(function (e) { showErr(e.message); });
    }
    draw();
  }

  function renderStarred(list) {
    var hd = el('div', 'jc-arch', '← Starred messages');
    hd.addEventListener('click', function () { showStarred = false; renderList(); });
    list.appendChild(hd);
    api('GET', API + '/starred').then(function (d) {
      var rs = d.results || [];
      if (!rs.length) list.appendChild(el('div', 'jc-empty', 'No starred messages. Use ▾ on a message and choose Star.'));
      rs.forEach(function (r) {
        var it = el('div', 'jc-item');
        var mid = el('div', 'jc-mid');
        var r1 = el('div', 'jc-row');
        r1.appendChild(el('div', 'jc-name', (same(r.message.sender, me) ? 'You' : r.message.sender) + ' → ' + r.conversation_title));
        r1.appendChild(el('div', 'jc-time', fmtListTime(r.message.server_ts)));
        mid.appendChild(r1);
        mid.appendChild(el('div', 'jc-prev', '★ ' + (r.message.body || (r.message.attachment ? r.message.attachment.file_name : ''))));
        it.appendChild(mid);
        it.addEventListener('click', function () {
          var c = convById(r.message.conversation_sync_id);
          showStarred = false;
          if (c) openConv(c, r.message.sync_id);
        });
        list.appendChild(it);
      });
    }).catch(function (e) { showErr(e.message); });
  }

  function loadUsers() {
    if (users.length) return Promise.resolve(users);
    return api('GET', API + '/users').then(function (d) { users = d.users || []; return users; });
  }

  var peopleBox = null, msgBox = null;
  function appendPeople(q, shownConvs) {
    peopleBox = el('div');
    msgBox = el('div');
    els.list.appendChild(peopleBox);
    els.list.appendChild(msgBox);
    var box = peopleBox;
    loadUsers().then(function () {
      if (els.sIn.value.trim().toLowerCase() !== q) return;
      var have = {};
      shownConvs.forEach(function (c) {
        if (!isGroup(c)) (c.members || []).forEach(function (m) { have[m.toLowerCase()] = true; });
      });
      var ppl = users.filter(function (u) { return u.username.toLowerCase().indexOf(q) !== -1 && !have[u.username.toLowerCase()]; });
      if (ppl.length) box.appendChild(el('div', 'jc-sect', 'Other people'));
      ppl.slice(0, 50).forEach(function (u) { box.appendChild(personRow(u)); });
    }).catch(function (e) { showErr(e.message); });
  }

  function scheduleSearch(q) {
    clearTimeout(searchTimer);
    if (q.length < 2) return;
    var box = msgBox;
    searchTimer = setTimeout(function () {
      api('GET', API + '/search?q=' + encodeURIComponent(q)).then(function (d) {
        if (els.sIn.value.trim().toLowerCase() !== q || box !== msgBox) return;
        var rs = d.results || [];
        if (!rs.length) return;
        box.appendChild(el('div', 'jc-sect', 'Messages'));
        rs.forEach(function (r) { box.appendChild(searchRow(r, q)); });
      }).catch(function (e) { showErr(e.message); });
    }, 300);
  }

  function searchRow(r, q) {
    var m = r.message;
    var it = el('div', 'jc-item');
    var mid = el('div', 'jc-mid');
    var r1 = el('div', 'jc-row');
    r1.appendChild(el('div', 'jc-name', r.conversation_title));
    r1.appendChild(el('div', 'jc-time', fmtListTime(m.server_ts)));
    var body = String(m.body || '');
    var at = body.toLowerCase().indexOf(q);
    var snip = at > 30 ? '…' + body.slice(at - 20) : body;
    var prev = el('div', 'jc-prev', (same(m.sender, me) ? 'You: ' : m.sender + ': ') + snip);
    mid.appendChild(r1); mid.appendChild(prev);
    it.appendChild(mid);
    it.addEventListener('click', function () {
      var c = convs.filter(function (x) { return x.sync_id === m.conversation_sync_id; })[0];
      if (c) openConv(c, m.sync_id);
    });
    return it;
  }

  function personRow(u, checkbox) {
    var it = el('div', 'jc-item');
    if (checkbox) it.appendChild(checkbox);
    var av = el('div', 'jc-av' + (u.online ? ' jc-on' : ''), initials(u.username));
    av.style.background = avatarColor(u.username);
    var mid = el('div', 'jc-mid');
    mid.appendChild(el('div', 'jc-name', u.username));
    mid.appendChild(el('div', 'jc-prev', [u.role, u.line].filter(Boolean).join(' · ')));
    it.appendChild(av); it.appendChild(mid);
    if (checkbox) it.addEventListener('click', function (e) { if (e.target !== checkbox) checkbox.click(); });
    else it.addEventListener('click', function () { startChat(u.username); });
    return it;
  }

  function showPeople(q) {
    if (adminAll) setAdminAll(false);
    els.peopleMode = true;
    els.list.textContent = '';
    els.list.appendChild(el('div', 'jc-empty', 'Loading people…'));
    loadUsers().then(function () {
      els.list.textContent = '';
      var ql = String(q || '').toLowerCase();
      var ppl = users.filter(function (u) { return !ql || u.username.toLowerCase().indexOf(ql) !== -1; });
      if (!ppl.length) els.list.appendChild(el('div', 'jc-empty', 'Nobody found.'));
      ppl.forEach(function (u) { els.list.appendChild(personRow(u)); });
    }).catch(function (e) { showErr(e.message); });
  }

  // A people picker with checkboxes, used by "new group" and "add people".
  function picker(container, exclude, onChange) {
    var chosen = {};
    var filter = el('input', 'jc-field');
    filter.placeholder = 'Search people';
    var box = el('div');
    container.appendChild(filter);
    container.appendChild(box);
    function draw() {
      box.textContent = '';
      var ql = filter.value.trim().toLowerCase();
      var ppl = users.filter(function (u) {
        return !exclude[u.username.toLowerCase()] && (!ql || u.username.toLowerCase().indexOf(ql) !== -1);
      });
      if (!ppl.length) box.appendChild(el('div', 'jc-empty', 'Nobody found.'));
      ppl.slice(0, 200).forEach(function (u) {
        var cb = el('input', 'jc-chk');
        cb.type = 'checkbox';
        cb.checked = !!chosen[u.username];
        cb.addEventListener('change', function () {
          if (cb.checked) chosen[u.username] = true; else delete chosen[u.username];
          onChange(Object.keys(chosen));
        });
        box.appendChild(personRow(u, cb));
      });
    }
    filter.addEventListener('input', draw);
    loadUsers().then(draw).catch(function (e) { showErr(e.message); });
    return function () { return Object.keys(chosen); };
  }

  function showNewGroup() {
    if (adminAll) setAdminAll(false);
    els.groupMode = true;
    els.peopleMode = false;
    var list = els.list;
    list.textContent = '';
    var top = el('div');
    top.style.padding = '10px';
    var name = el('input', 'jc-field');
    name.placeholder = 'Group name';
    name.maxLength = 80;
    var row = el('div', 'jc-irow');
    row.style.marginTop = '8px';
    var count = el('div', 'jc-prev', 'Pick at least one person');
    count.style.flex = '1';
    var cancel = el('button', 'jc-btn jc-danger', 'Cancel');
    var create = el('button', 'jc-btn', 'Create');
    create.disabled = true;
    row.appendChild(count); row.appendChild(cancel); row.appendChild(create);
    top.appendChild(name); top.appendChild(row);
    list.appendChild(top);
    var pick = el('div');
    pick.style.padding = '0 10px';
    list.appendChild(pick);
    var excl = {}; excl[String(me).toLowerCase()] = true;
    var chosen = [];
    function check() {
      count.textContent = chosen.length ? chosen.length + ' selected' : 'Pick at least one person';
      create.disabled = !chosen.length || !name.value.trim();
    }
    picker(pick, excl, function (c) { chosen = c; check(); });
    name.addEventListener('input', check);
    cancel.addEventListener('click', function () { renderList(); });
    create.addEventListener('click', function () {
      create.disabled = true;
      api('POST', API + '/groups', { title: name.value.trim(), members: chosen }).then(function (d) {
        els.sIn.value = '';
        var c = d.conversation;
        return loadConvs().then(function () {
          openConv(convs.filter(function (x) { return x.sync_id === c.sync_id; })[0] || c);
        });
      }).catch(function (e) { showErr(e.message); check(); });
    });
    name.focus();
  }

  function startChat(username) {
    api('POST', API + '/conversations', { username: username }).then(function (d) {
      els.sIn.value = '';
      var c = d.conversation;
      var existing = convs.filter(function (x) { return x.sync_id === c.sync_id; })[0];
      openConv(existing || { sync_id: c.sync_id, type: 'direct', title: c.title, members: c.members, online: c.online, is_member: true });
      renderList();
    }).catch(function (e) { showErr(e.message); });
  }

  // ---------------- conversation ----------------
  function showPlaceholder() {
    els.main.textContent = '';
    els.main.appendChild(els.ph);
    els.panel.classList.remove('jc-conv');
  }

  function convHeader() {
    var c = current;
    var readOnly = c.is_member === false;
    els.mName.textContent = c.title;
    els.mInfo.style.display = isGroup(c) && (!readOnly || isAdmin) ? '' : 'none';
    els.mTitle.classList.toggle('jc-mh-click', isGroup(c) && (!readOnly || isAdmin));
    var typing = typingText(c.sync_id);
    if (typing) { els.mSub.textContent = typing; els.mSub.className = 'jc-prev jc-typing'; return; }
    els.mSub.className = 'jc-prev';
    if (readOnly || isGroup(c)) els.mSub.textContent = (c.members || []).join(', ');
    else els.mSub.textContent = lastSeenText(c.online, c.last_seen_at);
    if (isMuted(c)) els.mSub.textContent = '🔕 ' + muteLabel(c) + (els.mSub.textContent ? ' · ' + els.mSub.textContent : '');
    els.mMute.style.display = readOnly ? 'none' : '';
    els.mMute.textContent = isMuted(c) ? '🔕' : '🔔';
    els.mMute.title = isMuted(c) ? muteLabel(c) + ' (click to change)' : 'Mute notifications';
    setAvatar(els.mAv, c.title, c.photo_v, isGroup(c));
    if (els.mCall) els.mCall.style.display = !isGroup(c) && !readOnly && serverInfo.server_type !== 'LOCAL' ? '' : 'none';
  }

  function openConv(c, focusId) {
    current = c;
    cancelEdit();
    oldestTs = null; hasMore = false;
    els.main.textContent = '';
    els.main.appendChild(els.mh);
    els.main.appendChild(els.msgs);
    var readOnly = c.is_member === false;
    if (readOnly) els.main.appendChild(els.ro);
    else { els.main.appendChild(els.editBar); els.main.appendChild(els.replyBar); els.main.appendChild(els.comp); }
    cancelReply();
    els.editBar.style.display = 'none';
    els.panel.classList.add('jc-conv');
    convHeader();
    els.msgs.textContent = '';
    loaded = [];
    if (!els.sIn.value.trim()) renderList();
    loadMessages(false, focusId);
    loadPins(c);
    if (!readOnly) { els.ta.focus(); markRead(c.sync_id); }
  }

  function loadMessages(older, focusId) {
    var c = current;
    if (!c) return;
    var url = API + '/conversations/' + encodeURIComponent(c.sync_id) + '/messages' +
      (older && oldestTs ? '?before=' + encodeURIComponent(oldestTs) : '');
    api('GET', url).then(function (d) {
      if (current !== c) return;
      hasMore = d.has_more;
      c.type = d.type || c.type;
      if (d.title && isGroup(c)) c.title = d.title;
      c.members = d.members || c.members;
      c.member_roles = d.member_roles || [];
      c.my_role = d.my_role;
      convHeader();
      var ms = d.messages || [];
      if (ms.length) oldestTs = ms[0].server_ts;
      var box = els.msgs;
      if (older) {
        var prevH = box.scrollHeight;
        renderMessages(ms, true);
        box.scrollTop = box.scrollHeight - prevH;
      } else {
        renderMessages(ms, false);
        box.scrollTop = box.scrollHeight;
      }
      if (focusId) flash(focusId);
    }).catch(function (e) { showErr(e.message); });
  }

  // Scroll to a message found by search, loading older pages until it shows up.
  var flashTries = 0;
  function flash(id) {
    var row = els.msgs.querySelector('[data-id="' + id + '"]');
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('jc-flash');
      setTimeout(function () { row.classList.remove('jc-flash'); }, 2000);
      flashTries = 0;
    } else if (hasMore && flashTries++ < 10) {
      loadMessages(true, id);
    } else {
      flashTries = 0;
    }
  }

  var loaded = []; // messages in the open chat, oldest first
  function renderMessages(ms, prepend) {
    loaded = prepend ? ms.concat(loaded) : ms.slice();
    redraw();
  }

  function recipients() {
    return (current && current.members || []).filter(function (n) { return !same(n, me); });
  }

  // ✓ sent, grey ✓✓ delivered to everyone, blue ✓✓ read by everyone.
  function tickFor(m) {
    if (m.pending) return { t: '🕓', cls: '' };
    if (m.failed) return { t: '!', cls: '', title: 'Not sent. Tap to retry.' };
    var who = recipients();
    var read = m.read_by || [], del = m.delivered_to || [];
    var all = function (arr) { return who.length && who.every(function (n) { return arr.some(function (x) { return same(x, n); }); }); };
    var title = '';
    if (isGroup(current)) {
      title = 'Read by: ' + (read.join(', ') || 'nobody yet') + '\nDelivered to: ' + (del.join(', ') || 'nobody yet');
    }
    if (all(read)) return { t: '✓✓', cls: ' jc-read', title: title || 'Read' };
    if (all(del)) return { t: '✓✓', cls: '', title: title || 'Delivered' };
    return { t: '✓', cls: '', title: title || 'Sent' };
  }

  function fileUrl(a, download) {
    return API + '/files/' + encodeURIComponent(a.sync_id) + (download ? '?download=1' : '');
  }

  function attachmentEl(m) {
    var a = m.attachment;
    if (a.kind === 'image') {
      var img = el('img', 'jc-img');
      img.alt = a.file_name;
      img.loading = 'lazy';
      img.src = fileUrl(a);
      img.addEventListener('load', function () {
        var box = els.msgs;
        if (box.scrollHeight - box.scrollTop - box.clientHeight < 300) box.scrollTop = box.scrollHeight;
      });
      img.addEventListener('click', function (e) { e.stopPropagation(); openViewerFor(m); });
      return withDownload(img, a);
    }
    if (a.kind === 'video') {
      var vwrap = el('div');
      var vid = el('video', 'jc-audio');
      vid.controls = true;
      vid.preload = 'metadata';
      vid.style.maxWidth = '260px';
      vid.style.borderRadius = '8px';
      vid.src = fileUrl(a);
      vwrap.appendChild(vid);
      return withDownload(vwrap, a);
    }
    if (a.kind === 'audio') {
      var wrap = el('div');
      var au = el('audio', 'jc-audio');
      au.controls = true;
      au.preload = 'none';
      au.src = fileUrl(a);
      wrap.appendChild(au);
      return withDownload(wrap, a);
    }
    var link = el('a', 'jc-file');
    link.href = fileUrl(a, a.kind === 'xlsx');
    link.target = '_blank';
    link.rel = 'noopener';
    link.appendChild(el('i', null, FILE_ICON[a.kind] || '📎'));
    var t = el('div');
    t.appendChild(el('b', null, a.file_name));
    t.appendChild(el('small', null, (a.kind === 'xlsx' ? 'Excel' : 'PDF') + ' · ' + fmtSize(a.size)));
    link.appendChild(t);
    return a.kind === 'pdf' ? withDownload(link, a) : link;
  }

  // ⬇ Download under a photo / video / voice note (files already download on click).
  function withDownload(node, a) {
    if (current && isProtected(current.sync_id)) return node;
    var box = el('div', 'jc-dlwrap');
    box.appendChild(node);
    var dl = el('a', 'jc-dl', '⬇ Download');
    dl.href = fileUrl(a, true);
    dl.setAttribute('download', a.file_name || '');
    dl.title = 'Download ' + (a.file_name || 'file') + ' (' + fmtSize(a.size) + ')';
    dl.addEventListener('click', function (e) { e.stopPropagation(); });
    box.appendChild(dl);
    return box;
  }

  var openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }

  function messageMenu(m, bub) {
    closeMenu();
    var mine = same(m.sender, me);
    var menu = el('div', 'jc-menu');
    var emo = el('div', 'jc-emo');
    var myRx = (m.reactions || []).filter(function (r) { return r.users.some(function (u) { return same(u, me); }); })[0];
    QUICK_RX.forEach(function (e) {
      var b = el('button', myRx && myRx.emoji === e ? 'jc-on' : '', e);
      b.addEventListener('click', function (ev) { ev.stopPropagation(); closeMenu(); react(m, myRx && myRx.emoji === e ? '' : e); });
      emo.appendChild(b);
    });
    menu.appendChild(emo);
    function item(label, fn, color) {
      var b = el('button', null, label);
      if (color) b.style.color = color;
      b.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); fn(); });
      menu.appendChild(b);
    }
    item('↩ Reply', function () { startReply(m); });
    if (!isProtected(m.conversation_sync_id)) item('↪ Forward', function () { forwardDialog(m); });
    item('📋 Make task', function () { taskDialog(m); });
    item('🔧 Raise maintenance ticket', function () { ticketDialog(m); });
    if (m.body && !m.poll) {
      item('🌐 Translate → English', function () { translate(m, 'en'); });
      item('🌐 हिंदी में', function () { translate(m, 'hi'); });
      item('🌐 ગુજરાતીમાં', function () { translate(m, 'gu'); });
    }
    item('📌 Pin / unpin', function () {
      var pinned = (current && current.pins || []).some(function (p) { return p.sync_id === m.sync_id; });
      api(pinned ? 'DELETE' : 'POST', API + '/messages/' + encodeURIComponent(m.sync_id) + '/pin', {})
        .then(function () { loadPins(current); }).catch(function (e) { showErr(e.message); });
    });
    item(m.starred ? '☆ Unstar' : '★ Star', function () {
      var on = !m.starred;
      api('POST', API + '/messages/' + encodeURIComponent(m.sync_id) + '/star', { on: on })
        .then(function () { m.starred = on; redraw(); }).catch(function (e) { showErr(e.message); });
    });
    if (m.kind === 'text' && navigator.clipboard) item('Copy', function () { navigator.clipboard.writeText(m.body).catch(function () { }); });
    if (!mine && isAdmin) {
      item('Delete for everyone (superadmin)', function () {
        if (!window.confirm('Delete this message for everyone?')) return;
        api('DELETE', API + '/messages/' + encodeURIComponent(m.sync_id)).then(function (d) { applyUpdate(d.message); loadConvs(); })
          .catch(function (e2) { showErr(e2.message); });
      }, '#d93025');
    }
    if (mine) {
      item('ⓘ Info', function () { infoDialog(m); });
      var canEdit = (m.kind === 'text' || m.attachment) && Date.now() - new Date(m.server_ts).getTime() < EDIT_MS;
      if (canEdit) item(m.kind === 'text' ? 'Edit' : 'Edit caption', function () { startEdit(m); });
      item('Delete for everyone', function () {
        if (!window.confirm('Delete this message for everyone?')) return;
        api('DELETE', API + '/messages/' + encodeURIComponent(m.sync_id)).then(function (d) {
          applyUpdate(d.message);
          loadConvs();
        }).catch(function (e2) { showErr(e2.message); });
      }, '#d93025');
    }
    bub.appendChild(menu);
    openMenu = menu;
  }

  function rxEl(m) {
    var box = el('div', 'jc-rx');
    m.reactions.forEach(function (r) {
      var sp = el('span', null, r.emoji + (r.users.length > 1 ? ' ' + r.users.length : ''));
      sp.title = r.users.map(function (u) { return same(u, me) ? 'You' : u; }).join(', ');
      sp.addEventListener('click', function (e) {
        e.stopPropagation();
        var mineHere = r.users.some(function (u) { return same(u, me); });
        react(m, mineHere ? '' : r.emoji);
      });
      box.appendChild(sp);
    });
    return box;
  }

  function react(m, emoji) {
    api('POST', API + '/messages/' + encodeURIComponent(m.sync_id) + '/react', { emoji: emoji })
      .then(function (d) { m.reactions = d.reactions; redraw(); })
      .catch(function (e) { showErr(e.message); });
  }

  function forwardDialog(m) {
    var dlg = modal('Forward to… (up to 5)');
    var picked = [];
    convs.filter(function (c) { return c.is_member !== false; }).forEach(function (c) {
      var r = el('label', 'jc-row2');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', function () {
        if (cb.checked) { if (picked.length >= 5) { cb.checked = false; return; } picked.push(c.sync_id); }
        else picked = picked.filter(function (x) { return x !== c.sync_id; });
        send.textContent = 'Send' + (picked.length ? ' (' + picked.length + ')' : '');
      });
      var av = el('div', 'jc-av');
      av.style.width = av.style.height = '32px';
      setAvatar(av, c.title, c.photo_v, isGroup(c));
      r.appendChild(cb); r.appendChild(av); r.appendChild(el('span', null, c.title));
      dlg.body.appendChild(r);
    });
    var act = el('div', 'jc-act');
    var cancel = el('button', 'jc-plain', 'Cancel');
    var send = el('button', 'jc-primary', 'Send');
    cancel.addEventListener('click', dlg.close);
    send.addEventListener('click', function () {
      if (!picked.length) return;
      send.disabled = true;
      api('POST', API + '/forward', { message_sync_id: m.sync_id, to: picked })
        .then(function () { dlg.close(); loadConvs(); })
        .catch(function (e) { send.disabled = false; showErr(e.message); });
    });
    act.appendChild(cancel); act.appendChild(send);
    dlg.box.appendChild(act);
  }

  function infoDialog(m) {
    var dlg = modal('Message info');
    dlg.body.textContent = 'Loading…';
    api('GET', API + '/messages/' + encodeURIComponent(m.sync_id) + '/info').then(function (d) {
      dlg.body.textContent = '';
      function sect(title, rows) {
        dlg.body.appendChild(el('b', null, title));
        if (!rows.length) dlg.body.appendChild(el('div', 'jc-row2', '—'));
        rows.forEach(function (r) {
          var row = el('div', 'jc-row2');
          row.appendChild(el('span', null, r.username));
          if (r.at) row.appendChild(el('small', null, ' · ' + fmtDay(r.at) + ' ' + fmtTime(r.at)));
          dlg.body.appendChild(row);
        });
      }
      sect('✓✓ Read by', d.read || []);
      sect('✓✓ Delivered to', d.delivered || []);
      if ((d.pending || []).length) sect('✓ Not delivered yet', d.pending);
    }).catch(function (e) { dlg.body.textContent = e.message; });
  }

  function redraw() {
    var box = els.msgs;
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    closeMenu();
    box.textContent = '';
    if (hasMore) {
      var more = el('button', 'jc-more', 'Load older messages');
      more.addEventListener('click', function () { loadMessages(true); });
      box.appendChild(more);
    }
    var lastDay = '';
    var adminView = current && current.is_member === false;
    var showNames = isGroup(current) || adminView;
    loaded.forEach(function (m) {
      var day = new Date(m.server_ts).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        var dd = el('div', 'jc-day');
        dd.appendChild(el('span', null, fmtDay(m.server_ts)));
        box.appendChild(dd);
      }
      if (m.kind === 'system') {
        var sys = el('div', 'jc-sys' + (m.reply_to ? ' jc-sysr' : ''));
        var sysText = el('span', null, m.body);
        if (m.reply_to) {
          sysText.title = 'Show the shared item';
          sysText.addEventListener('click', function () { flash(m.reply_to.sync_id); });
        }
        sys.appendChild(sysText);
        box.appendChild(sys);
        return;
      }
      var mine = same(m.sender, me);
      var row = el('div', 'jc-msg' + (mine ? ' jc-out' : '') + (m.pending ? ' jc-pend' : ''));
      row.setAttribute('data-id', m.sync_id);
      var b = el('div', 'jc-bub');
      if (!mine && showNames) {
        var sn = el('div', 'jc-snd', m.sender);
        sn.style.color = avatarColor(m.sender);
        b.appendChild(sn);
      }
      if (m.purged) {
        b.appendChild(el('span', 'jc-del', '🕓 Removed after the retention period'));
      } else if (m.deleted) {
        b.appendChild(el('span', 'jc-del', '🚫 This message was deleted'));
      } else {
        if (m.forwarded) b.appendChild(el('div', 'jc-fwd', '↪ Forwarded'));
        if (m.announcement) { b.classList.add('jc-ann'); b.appendChild(el('div', 'jc-annl', '📢 ANNOUNCEMENT')); }
        if (m.urgent) { b.classList.add('jc-urg'); b.appendChild(el('div', 'jc-urgl', '⚠ URGENT')); }
        if (m.bot) { b.classList.add('jc-bot'); b.appendChild(el('div', 'jc-botl', '🤖 JMS BOT')); }
        if (m.reply_to) b.appendChild(quoteEl(m.reply_to));
        if (m.kind === 'link' && m.link) b.appendChild(linkCardEl(m));
        if (m.attachment) b.appendChild(attachmentEl(m));
        else if (m.localFile) b.appendChild(el('div', 'jc-prev', '📎 ' + m.localFile.name + ' · ' + fmtSize(m.localFile.size)));
        if (m.poll) b.appendChild(pollEl(m));
        else if (m.body) appendBody(b, m.body);
        if (m.alert) b.appendChild(alertEl(m));
        if (m.attachment && m.attachment.kind === 'audio' && !m._transcript) {
          var tb = el('button', 'jc-trbtn', '📝 Show as text');
          tb.addEventListener('click', function (e) { e.stopPropagation(); transcribe(m, tb); });
          b.appendChild(tb);
        }
        if (m._transcript) { var tt = el('div', 'jc-tr', m._transcript); tt.insertBefore(el('small', null, '📝 Voice message as text'), tt.firstChild); b.appendChild(tt); }
        if (m._tr) { var tr = el('div', 'jc-tr', m._tr.text); tr.insertBefore(el('small', null, '🌐 ' + m._tr.label), tr.firstChild); b.appendChild(tr); }
      }
      if (m.reactions && m.reactions.length && !m.deleted) b.appendChild(rxEl(m));
      var meta = el('span', 'jc-meta', (m.scheduled ? '🕒 ' : '') + (m.starred ? '★ ' : '') + (m.edited_at && !m.deleted ? 'edited ' : '') + (m.pending ? '' : fmtTime(m.server_ts)));
      if (mine && !adminView && !m.deleted && !m.purged) {
        var tk = tickFor(m);
        var tick = el('span', 'jc-tick' + tk.cls, tk.t);
        if (tk.title) tick.title = tk.title;
        meta.appendChild(tick);
      }
      b.appendChild(meta);
      if (!adminView && !m.deleted && !m.purged && !m.pending && !m.failed && current && current.is_member !== false) {
        var opt = el('button', 'jc-opt', '▾');
        opt.title = 'Message options';
        opt.addEventListener('click', function (e) { e.stopPropagation(); messageMenu(m, b); });
        b.appendChild(opt);
      }
      if (!adminView && !m.deleted && !m.purged && !m.pending && !m.failed && current && current.is_member !== false) {
        var rb = el('button', 'jc-rbtn', '↩');
        rb.title = 'Reply';
        rb.addEventListener('click', function (e) { e.stopPropagation(); startReply(m); });
        b.appendChild(rb);
        addSwipe(row, b, m);
      }
      if (m.failed) {
        b.style.cursor = 'pointer';
        b.addEventListener('click', function () {
          m.failed = false; m.pending = true; redraw();
          if (m.localFile) postFile(m); else postMessage(m);
        });
      }
      row.appendChild(b);
      box.appendChild(row);
    });
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function startEdit(m) {
    cancelReply();
    editing = m;
    els.editTxt.textContent = m.body || '';
    els.editBar.style.display = 'flex';
    els.ta.value = m.body || '';
    els.ta.focus();
    els.ta.dispatchEvent(new Event('input'));
  }

  function cancelEdit() {
    if (!editing) return;
    editing = null;
    if (els.editBar) els.editBar.style.display = 'none';
    els.ta.value = '';
    els.ta.style.height = 'auto';
  }

  function applyUpdate(msg) {
    var ex = loaded.filter(function (x) { return x.sync_id === msg.sync_id; })[0];
    if (!ex) return;
    var keep = { delivered_to: ex.delivered_to, read_by: ex.read_by };
    Object.assign(ex, msg);
    if (!msg.delivered_to) { ex.delivered_to = keep.delivered_to; ex.read_by = keep.read_by; }
    if (editing && editing.sync_id === msg.sync_id && msg.deleted) cancelEdit();
    redraw();
  }

  function sendMessage() {
    var text = els.ta.value.trim();
    if (!current || current.is_member === false) return;
    if (editing) {
      var m0 = editing;
      if (!text && m0.kind === 'text') return;
      api('PATCH', API + '/messages/' + encodeURIComponent(m0.sync_id), { body: text }).then(function (d) {
        cancelEdit();
        applyUpdate(d.message);
        loadConvs();
      }).catch(function (e) { showErr(e.message); });
      return;
    }
    if (!text) return;
    if (/^\/\w+/.test(text)) {
      els.ta.value = '';
      api('POST', API + '/command', { conversation_sync_id: current.sync_id, text: text })
        .then(function (d) { if (!loaded.some(function (x) { return x.sync_id === d.message.sync_id; })) loaded.push(d.message); redraw(); els.msgs.scrollTop = els.msgs.scrollHeight; loadConvs(); })
        .catch(function (e) { els.ta.value = text; showErr(e.message); });
      return;
    }
    var m = { sync_id: uuid(), conversation_sync_id: current.sync_id, sender: me, body: text, kind: 'text',
      server_ts: new Date().toISOString(), pending: true, reply_to: replyQuote(), reply_to_sync_id: replying && replying.sync_id };
    cancelReply();
    loaded.push(m);
    els.ta.value = '';
    els.ta.style.height = 'auto';
    redraw();
    els.msgs.scrollTop = els.msgs.scrollHeight;
    postMessage(m);
  }

  function postMessage(m) {
    api('POST', API + '/messages', { sync_id: m.sync_id, conversation_sync_id: m.conversation_sync_id,
      body: m.body, client_ts: m.server_ts, reply_to_sync_id: m.reply_to_sync_id || undefined }).then(function (d) {
      Object.assign(m, d.message, { pending: false, failed: false });
      redraw();
      loadConvs();
    }).catch(function (e) {
      m.pending = false; m.failed = true;
      redraw();
      showErr(e.message);
    });
  }

  // Attachments: the server checks the real file type; this only catches the obvious.
  function sendFile(f) {
    if (!current || current.is_member === false || editing) return;
    if (f.size > MAX_FILE) { showErr('File is too big (max 10 MB).'); return; }
    var okType = /^image\/(jpeg|png|gif|webp)$/.test(f.type) || /^audio\//.test(f.type) ||
      f.type === 'application/pdf' || /\.(pdf|xlsx)$/i.test(f.name);
    if (!okType) { showErr('Only photos, PDF, Excel (.xlsx) and audio files can be sent.'); return; }
    var caption = els.ta.value.trim();
    els.ta.value = '';
    els.ta.style.height = 'auto';
    var m = { sync_id: uuid(), conversation_sync_id: current.sync_id, sender: me, body: caption, kind: 'file',
      server_ts: new Date().toISOString(), pending: true, localFile: f, reply_to: replyQuote(), reply_to_sync_id: replying && replying.sync_id };
    cancelReply();
    loaded.push(m);
    redraw();
    els.msgs.scrollTop = els.msgs.scrollHeight;
    postFile(m);
  }

  function postFile(m) {
    var fd = new FormData();
    fd.append('conversation_sync_id', m.conversation_sync_id);
    fd.append('sync_id', m.sync_id);
    fd.append('body', m.body || '');
    if (m.reply_to_sync_id) fd.append('reply_to_sync_id', m.reply_to_sync_id);
    fd.append('file', m.localFile, m.localFile.name || 'file');
    api('POST', API + '/attachments', fd).then(function (d) {
      Object.assign(m, d.message, { pending: false, failed: false, localFile: null });
      redraw();
      loadConvs();
    }).catch(function (e) {
      m.pending = false; m.failed = true;
      redraw();
      showErr(e.message);
    });
  }

  function sendTyping() {
    if (!current || current.is_member === false || editing || !els.ta.value.trim()) return;
    var now = Date.now();
    if (now - typingSentAt < 3000) return;
    typingSentAt = now;
    api('POST', API + '/typing', { conversation_sync_id: current.sync_id }).catch(function () { });
  }

  function markRead(convId) {
    var c = convs.filter(function (x) { return x.sync_id === convId; })[0];
    if ((c && c.is_member === false) || (current && current.sync_id === convId && current.is_member === false)) return;
    api('POST', API + '/read', { conversation_sync_id: convId }).then(function () {
      if (c) c.unread = 0;
      updateBadge();
      if (typeof window.checkUnread === 'function') { try { window.checkUnread(); } catch (_e) { } }
      renderListIfIdle();
    }).catch(function () { });
  }

  function renderListIfIdle() { if (!els.peopleMode && !els.groupMode && !els.sIn.value.trim()) renderList(); }

  // ---------------- group info ----------------
  function showGroupInfo() {
    var c = current;
    if (!c) return;
    cancelEdit();
    els.main.textContent = '';
    var head = el('div', 'jc-head');
    var bk = el('button', 'jc-ibtn', '←');
    bk.title = 'Back to chat';
    head.appendChild(bk);
    head.appendChild(el('h3', null, 'Group info'));
    var info = el('div', 'jc-info');
    els.main.appendChild(head);
    els.main.appendChild(info);
    bk.addEventListener('click', function () { openConv(c); });
    var admin = c.my_role === 'admin' || isAdmin; // superadmins manage every group

    // name
    var s1 = el('section');
    s1.appendChild(el('h4', null, 'Group name'));
    var r1 = el('div', 'jc-irow');
    var name = el('input', 'jc-field');
    name.value = c.title;
    name.maxLength = 80;
    var save = el('button', 'jc-btn', 'Rename');
    r1.appendChild(name); r1.appendChild(save);
    s1.appendChild(r1);
    info.appendChild(s1);
    save.addEventListener('click', function () {
      var t = name.value.trim();
      if (!t || t === c.title) return;
      api('PATCH', API + '/groups/' + encodeURIComponent(c.sync_id), { title: t }).then(function (d) {
        c.title = d.title;
        loadConvs();
        openConv(c);
      }).catch(function (e) { showErr(e.message); });
    });

    // members
    var s2 = el('section');
    var roles = c.member_roles || [];
    s2.appendChild(el('h4', null, roles.length + ' members'));
    roles.forEach(function (r) {
      var row = el('div', 'jc-item');
      row.style.cursor = 'default';
      var av = el('div', 'jc-av' + (r.online ? ' jc-on' : ''), initials(r.username));
      av.style.background = avatarColor(r.username);
      var mid = el('div', 'jc-mid');
      mid.appendChild(el('div', 'jc-name', same(r.username, me) ? r.username + ' (you)' : r.username));
      row.appendChild(av); row.appendChild(mid);
      if (r.role === 'admin') row.appendChild(el('span', 'jc-role', 'admin'));
      if (admin && !same(r.username, me)) {
        var mk = el('button', 'jc-ibtn', r.role === 'admin' ? '☆' : '★');
        mk.title = r.role === 'admin' ? 'Remove as group admin' : 'Make group admin';
        mk.addEventListener('click', function () {
          api('POST', API + '/groups/' + encodeURIComponent(c.sync_id) + '/members/' + encodeURIComponent(r.username) + '/admin',
            { admin: r.role !== 'admin' })
            .then(function () { refreshInfo(c); })
            .catch(function (e) { showErr(e.message); });
        });
        row.appendChild(mk);
      }
      if (admin && !same(r.username, me)) {
        var rm = el('button', 'jc-ibtn', '✕');
        rm.title = 'Remove ' + r.username;
        rm.addEventListener('click', function () {
          if (!window.confirm('Remove ' + r.username + ' from the group?')) return;
          api('DELETE', API + '/groups/' + encodeURIComponent(c.sync_id) + '/members/' + encodeURIComponent(r.username))
            .then(function () { refreshInfo(c); })
            .catch(function (e) { showErr(e.message); });
        });
        row.appendChild(rm);
      }
      s2.appendChild(row);
    });
    info.appendChild(s2);

    // add people
    if (admin) {
      var s3 = el('section');
      s3.appendChild(el('h4', null, 'Add people'));
      var excl = {};
      roles.forEach(function (r) { excl[r.username.toLowerCase()] = true; });
      excl[String(me).toLowerCase()] = true;
      var addBtn = el('button', 'jc-btn', 'Add');
      addBtn.disabled = true;
      var chosen = [];
      var pick = el('div');
      picker(pick, excl, function (ch) { chosen = ch; addBtn.disabled = !ch.length; addBtn.textContent = ch.length ? 'Add ' + ch.length : 'Add'; });
      s3.appendChild(pick);
      var ar = el('div', 'jc-irow');
      ar.style.marginTop = '8px';
      ar.appendChild(addBtn);
      s3.appendChild(ar);
      addBtn.addEventListener('click', function () {
        addBtn.disabled = true;
        api('POST', API + '/groups/' + encodeURIComponent(c.sync_id) + '/members', { members: chosen })
          .then(function () { refreshInfo(c); })
          .catch(function (e) { showErr(e.message); addBtn.disabled = false; });
      });
      info.appendChild(s3);
    }

    // leave
    var s4 = el('section');
    var leave = el('button', 'jc-btn jc-danger', '⎋ Leave group');
    leave.addEventListener('click', function () {
      if (!window.confirm('Leave "' + c.title + '"?')) return;
      api('POST', API + '/groups/' + encodeURIComponent(c.sync_id) + '/leave').then(function () {
        current = null;
        showPlaceholder();
        loadConvs();
      }).catch(function (e) { showErr(e.message); });
    });
    s4.appendChild(leave);
    info.appendChild(s4);
  }

  function refreshInfo(c) {
    api('GET', API + '/conversations/' + encodeURIComponent(c.sync_id) + '/messages').then(function (d) {
      c.members = d.members; c.member_roles = d.member_roles; c.my_role = d.my_role;
      if (d.title) c.title = d.title;
      if (current === c) showGroupInfo();
      loadConvs();
    }).catch(function (e) { showErr(e.message); });
  }

  // ---------------- badge, toast, live ----------------
  function updateBadge() {
    api('GET', API + '/unread').then(function (d) {
      var n = d.unread || 0;
      els.badge.textContent = n > 99 ? '99+' : String(n);
      els.badge.style.display = n ? 'block' : 'none';
      var base = document.title.replace(/^\(\d+\+?\) /, '');
      document.title = n ? '(' + (n > 99 ? '99+' : n) + ') ' + base : base;
    }).catch(function () { });
  }

  var toastEl = null, toastTimer = null;
  function previewOf(m) {
    if (m.attachment) {
      var label = { image: '📷 Photo', pdf: '📄 PDF', xlsx: '📊 Excel file', audio: '🎤 Audio', video: '🎥 Video' }[m.attachment.kind] || '📎 File';
      return m.body ? label + ': ' + m.body : label;
    }
    return m.body;
  }

  function toast(m) {
    if (toastEl) toastEl.remove();
    toastEl = el('div', 'jc-toast');
    var c = convs.filter(function (x) { return x.sync_id === m.conversation_sync_id; })[0];
    toastEl.appendChild(el('b', null, c && isGroup(c) ? m.sender + ' @ ' + c.title : m.sender));
    toastEl.appendChild(el('span', null, previewOf(m)));
    toastEl.addEventListener('click', function () {
      toastEl.remove(); toastEl = null;
      toggle(true);
      loadConvs().then(function () {
        var cc = convs.filter(function (x) { return x.sync_id === m.conversation_sync_id; })[0];
        if (cc) openConv(cc);
      });
    });
    root.appendChild(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) { toastEl.remove(); toastEl = null; } }, 5000);
    if (soundOn) beep();
  }

  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = beep.ctx || (beep.ctx = new Ctx());
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.12);
    } catch (_e) { }
  }

  // ---------------- mentions ----------------
  function appendBody(b, text) {
    var parts = String(text).split(/(@[\w.\-]+)/);
    parts.forEach(function (part) {
      if (/^@[\w.\-]+$/.test(part)) {
        var name = part.slice(1);
        var known = /^(all|everyone)$/i.test(name) || (current && (current.members || []).some(function (n) { return same(n, name); }));
        if (known) { b.appendChild(el('span', 'jc-at' + (same(name, me) || /^(all|everyone)$/i.test(name) ? ' jc-me' : ''), part)); return; }
      }
      if (part) b.appendChild(document.createTextNode(part));
    });
  }

  var mentionList = [];
  function mentionOpen() { return els.ment && els.ment.style.display === 'block' && mentionList.length; }
  function hideMention() { if (els.ment) els.ment.style.display = 'none'; mentionList = []; }

  // "@ra" just before the caret in a group: suggest members.
  function updateMention() {
    if (!current || !isGroup(current) || current.is_member === false) return hideMention();
    var ta = els.ta, upto = ta.value.slice(0, ta.selectionStart);
    var mm = /(^|\s)@([\w.\-]*)$/.exec(upto);
    if (!mm) return hideMention();
    var q = mm[2].toLowerCase();
    mentionList = (current.members || []).filter(function (n) { return !same(n, me) && n.toLowerCase().indexOf(q) === 0; });
    if ('all'.indexOf(q) === 0) mentionList.push('all');
    if (!mentionList.length) return hideMention();
    var box = els.ment;
    box.textContent = '';
    mentionList.slice(0, 8).forEach(function (n, i) {
      var d = el('div', i === 0 ? 'jc-on' : null, '@' + n + (n === 'all' ? '  (everyone in the group)' : ''));
      d.addEventListener('mousedown', function (e) { e.preventDefault(); pickMention(i); });
      box.appendChild(d);
    });
    if (!box.parentNode) els.main.appendChild(box);
    box.style.display = 'block';
  }

  function pickMention(i) {
    var name = mentionList[i];
    if (!name) return hideMention();
    var ta = els.ta, pos = ta.selectionStart;
    var before = ta.value.slice(0, pos).replace(/@[\w.\-]*$/, '@' + name + ' ');
    ta.value = before + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = before.length;
    hideMention();
    ta.focus();
  }

  // ---------------- menus: mute, settings ----------------
  var popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } }
  document.addEventListener('click', function (e) { if (popEl && !popEl.contains(e.target)) closePop(); });

  function popup(anchor, host, items) {
    closePop();
    var pop = el('div', 'jc-pop');
    items.forEach(function (it) {
      if (it.sub) { pop.appendChild(el('div', 'jc-sub', it.sub)); return; }
      var b = el('button', it.on ? 'jc-on' : null, it.label);
      b.addEventListener('click', function (e) { e.stopPropagation(); closePop(); it.run(); });
      pop.appendChild(b);
    });
    var hr = host.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    pop.style.top = (ar.bottom - hr.top + 4) + 'px';
    pop.style.right = Math.max(4, hr.right - ar.right) + 'px';
    host.appendChild(pop);
    popEl = pop;
  }

  function showMuteMenu(anchor) {
    var c = current;
    if (!c || c.is_member === false) return;
    var setMute = function (how) {
      api('POST', API + '/conversations/' + encodeURIComponent(c.sync_id) + '/mute', { 'for': how }).then(function (d) {
        c.muted_until = d.muted_until;
        var lc = convs.filter(function (x) { return x.sync_id === c.sync_id; })[0];
        if (lc) lc.muted_until = d.muted_until;
        convHeader();
        renderListIfIdle();
      }).catch(function (e) { showErr(e.message); });
    };
    var items = [{ sub: isMuted(c) ? muteLabel(c) + '. @mentions still notify you.' : 'Mute notifications. @mentions still notify you.' },
      { label: 'For 8 hours', run: function () { setMute('8h'); } },
      { label: 'For 1 week', run: function () { setMute('1w'); } },
      { label: 'Always', run: function () { setMute('always'); } }];
    if (isMuted(c)) items.push({ label: '🔔 Unmute', run: function () { setMute('off'); } });
    popup(anchor, els.main, items);
  }

  function notifState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // default | granted | denied
  }

  function showSettings(anchor) {
    var st = notifState();
    var items = [{ sub: 'Pop-ups when JMS is in the background' }];
    if (st === 'granted') items.push({ label: '✓ Desktop notifications are on', on: true, run: function () { ensurePush(); } });
    else if (st === 'denied') items.push({ label: 'Desktop notifications are blocked in this browser', run: function () { showErr('Allow notifications for this site in the browser settings (padlock icon), then try again.'); } });
    else if (st === 'unsupported') items.push({ label: 'This browser cannot show notifications', run: function () { } });
    else items.push({ label: 'Turn on desktop notifications', run: enableNotifications });
    items.push({ sub: 'Quiet hours' });
    items.push({ label: '🌙 Quiet hours (no notifications at night)…', run: quietDialog });
    items.push({ sub: 'Security' });
    items.push({ label: '📱 My devices (sign out a phone)…', run: devicesDialog });
    items.push({ sub: 'Sound' });
    items.push({ label: soundOn ? '🔊 Sound on (click to turn off)' : '🔇 Sound off (click to turn on)', on: soundOn, run: function () {
      soundOn = !soundOn;
      writePref('jmsChatSound', soundOn ? '1' : '0');
      if (soundOn) beep();
    } });
    popup(anchor, els.side, items);
  }

  function enableNotifications() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') { ensurePush(); return; }
      showErr('Notifications were not allowed.');
    });
  }

  function urlB64ToUint8Array(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  // Web Push (closed tabs) where the server offers it (MAIN over HTTPS). Quietly does
  // nothing elsewhere: background-tab pop-ups still work there.
  function ensurePush() {
    if (!swReg || !('PushManager' in window) || notifState() !== 'granted') return;
    api('GET', API + '/push/config').then(function (cfg) {
      if (!cfg.enabled || !cfg.publicKey) return;
      return swReg.pushManager.getSubscription().then(function (sub) {
        return sub || swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(cfg.publicKey) });
      }).then(function (sub) {
        return api('POST', API + '/push/subscribe', { subscription: sub.toJSON() });
      });
    }).catch(function (e) { if (window.console) console.warn('[chat] push not set up:', e.message); });
  }

  function desktopNotify(m) {
    if (notifState() !== 'granted') return;
    var c = convById(m.conversation_sync_id);
    var title = c && isGroup(c) ? m.sender + ' in ' + c.title : m.sender;
    var opts = { body: (mentionsMe(m.body) ? '@ ' : '') + previewOf(m), tag: 'jms-chat-' + m.conversation_sync_id,
      renotify: true, icon: '/assets/icon-192.png', data: { chat: m.conversation_sync_id }, silent: !soundOn };
    if (swReg && swReg.showNotification) { swReg.showNotification(title, opts).catch(function () { }); return; }
    try {
      var n = new Notification(title, opts);
      n.onclick = function () { window.focus(); openChatById(m.conversation_sync_id); n.close(); };
    } catch (_e) { }
  }

  function openChatById(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return;
    toggle(true);
    loadConvs().then(function () {
      var c = convs.filter(function (x) { return x.sync_id === id; })[0];
      if (c) openConv(c);
    });
  }

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var secure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      swReg = reg;
      ensurePush();
    }).catch(function () { });
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'jms-open-chat') openChatById(e.data.chat);
    });
  }

  // Superadmins get a copy of every message: refresh only the open All-chats list,
  // at most every 3 s, and never the badge (copies are not unread messages).
  var adminRefreshTimer = null;
  function adminCopy(ev) {
    var m = ev.message;
    if (m && current && current.sync_id === m.conversation_sync_id && current.is_member === false) {
      if (ev.type === 'message' && !loaded.some(function (x) { return x.sync_id === m.sync_id; })) { loaded.push(m); redraw(); }
      else if (ev.type === 'message_update') applyUpdate(m);
    }
    if (!open || !adminAll || adminRefreshTimer) return;
    adminRefreshTimer = setTimeout(function () { adminRefreshTimer = null; if (open && adminAll) loadConvs(); }, 3000);
  }

  function onEvent(ev) {
    if (ev.adminCopy) return adminCopy(ev);
    if (ev.type === 'message') {
      var m = ev.message;
      var mine = same(m.sender, me);
      if (typingIn[m.conversation_sync_id] && same(typingIn[m.conversation_sync_id].name, m.sender)) {
        delete typingIn[m.conversation_sync_id];
        if (current && current.sync_id === m.conversation_sync_id) convHeader();
      }
      // a reply to my message reaches me even in a muted chat, like an @mention
      var alert = !mine && !ev.adminCopy && m.kind !== 'system' && !m.deleted &&
        (!isMuted(convById(m.conversation_sync_id)) || mentionsMe(m.body) || (m.reply_to && same(m.reply_to.sender, me)));
      if (current && current.sync_id === m.conversation_sync_id) {
        var exists = loaded.some(function (x) { return x.sync_id === m.sync_id; });
        if (!exists) { loaded.push(m); redraw(); }
        if (open && !document.hidden && !ev.adminCopy) markRead(m.conversation_sync_id);
      } else if (alert) {
        toast(m);
      }
      if (alert && document.hidden) desktopNotify(m);
      if (open) loadConvs(); else updateBadge();
    } else if (ev.type === 'message_update') {
      if (current && current.sync_id === ev.message.conversation_sync_id) applyUpdate(ev.message);
      if (open) loadConvs();
    } else if (ev.type === 'task') {
      // Start work / Mark done on a shared item: update its card (and the banner here)
      loaded.forEach(function (x) { if (x.sync_id === ev.message_sync_id) x.task = { status: ev.status, by: ev.by }; });
      if (current && current.sync_id === ev.conversation_sync_id) redraw();
      if (targetBanner && targetBanner.msgId === ev.message_sync_id) targetBanner.update(ev.status, ev.by);
    } else if (ev.type === 'reaction') {
      loaded.forEach(function (x) { if (x.sync_id === ev.message_sync_id) x.reactions = ev.reactions; });
      if (current && current.sync_id === ev.conversation_sync_id) redraw();
    } else if (ev.type === 'call') {
      webCall.incoming(ev.call_id, ev.caller);
    } else if (ev.type === 'call_end') {
      webCall.remoteEnded(ev.call_id, ev.reason);
    } else if (ev.type === 'receipt') {
      if (current && current.sync_id === ev.conversation_sync_id && !same(ev.username, me)) {
        var ids = {};
        (ev.message_sync_ids || []).forEach(function (id) { ids[id] = true; });
        var changed = false;
        loaded.forEach(function (x) {
          if (!ids[x.sync_id] || !same(x.sender, me)) return;
          var add = function (key) {
            x[key] = x[key] || [];
            if (!x[key].some(function (n) { return same(n, ev.username); })) { x[key].push(ev.username); changed = true; }
          };
          add('delivered_to');
          if (ev.kind === 'read') add('read_by');
        });
        if (changed) redraw();
      }
    } else if (ev.type === 'typing') {
      typingIn[ev.conversation_sync_id] = { name: ev.username, until: Date.now() + 4000 };
      if (current && current.sync_id === ev.conversation_sync_id) convHeader();
      renderListIfIdle();
      clearTimeout(typingTimer);
      typingTimer = setTimeout(function () {
        if (current) convHeader();
        renderListIfIdle();
      }, 4100);
    } else if (ev.type === 'conversation') {
      // Group created, renamed, or people added/removed/left.
      var cid = ev.conversation_sync_id;
      var p = open ? loadConvs() : Promise.resolve(updateBadge());
      p.then(function () {
        if (!current || current.sync_id !== cid || current.is_member === false) return;
        var still = convs.filter(function (x) { return x.sync_id === cid; })[0];
        if (!still) { current = null; showPlaceholder(); showErr('You are no longer in that group.'); return; }
        if (els.main.contains(els.msgs)) loadMessages(false);
        else refreshInfo(current);
      });
    }
  }

  function connect() {
    if (stopped || typeof EventSource === 'undefined') return;
    if (es) es.close();
    es = new EventSource(API + '/stream');
    es.onmessage = function (e) {
      retry = 0;
      var ev;
      try { ev = JSON.parse(e.data); } catch (_e) { return; }
      try { onEvent(ev); } catch (_e) { }
    };
    es.onerror = function () {
      if (es.readyState === EventSource.CLOSED) {
        es = null;
        retry = Math.min(retry + 1, 6);
        // Chat switched off (or not on for this factory yet): remove the widget
        // instead of retrying for ever.
        fetch(API + '/me', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
          if (r.status === 404) { stopped = true; if (root) root.remove(); return; }
          setTimeout(connect, 2000 * retry);
        }).catch(function () { setTimeout(connect, 2000 * retry); });
      }
    };
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      if (!es || es.readyState === EventSource.CLOSED) connect();
      updateBadge();
      if (open && current && current.is_member !== false) markRead(current.sync_id);
    }
  });

  // ================= Image viewer (WhatsApp-style) =================
  // Full screen over a dark backdrop. Close: backdrop click/tap, Esc, ✕, or the phone's
  // Back button (a history entry is pushed while open). Zoom 1x-5x: wheel, pinch, + / -,
  // double-click/double-tap toggles fit <-> 2.5x; drag to pan when zoomed (a click that
  // ends a drag never closes). Arrows / swipe step through this chat's images.
  var viewer = null;

  function chatImages() {
    return loaded.filter(function (x) { return x.attachment && x.attachment.kind === 'image' && !x.deleted && !x.purged; })
      .map(function (x) {
        return { id: x.attachment.sync_id, src: fileUrl(x.attachment), download: fileUrl(x.attachment, true),
          name: x.attachment.file_name, sender: x.sender, ts: x.server_ts };
      });
  }

  function openViewerFor(m) {
    var list = chatImages();
    var i = list.map(function (x) { return x.id; }).indexOf(m.attachment.sync_id);
    if (i === -1) { list = [{ id: m.attachment.sync_id, src: fileUrl(m.attachment), download: fileUrl(m.attachment, true), name: m.attachment.file_name, sender: m.sender, ts: m.server_ts }]; i = 0; }
    openViewer(list, i);
  }

  function openViewer(list, index) {
    if (viewer) viewer.close(true);
    var MIN = 1, MAX = 5, DOUBLE = 2.5;
    var st = { i: index, s: 1, tx: 0, ty: 0 };
    var lastFocus = document.activeElement;

    var ov = el('div', 'jc-iv');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Image viewer');
    var head = el('div', 'jc-iv-head');
    var who = el('div', 'jc-iv-who');
    var whoName = el('b');
    var whoTime = el('span');
    who.appendChild(whoName); who.appendChild(whoTime);
    var count = el('span', 'jc-iv-count');
    var dl = el('a', 'jc-iv-btn', '⤓');
    dl.title = 'Download'; dl.setAttribute('aria-label', 'Download image');
    dl.setAttribute('download', '');
    var xBtn = el('button', 'jc-iv-btn', '✕');
    xBtn.title = 'Close (Esc)'; xBtn.setAttribute('aria-label', 'Close image viewer');
    head.appendChild(who); head.appendChild(count); head.appendChild(dl); head.appendChild(xBtn);

    var stage = el('div', 'jc-iv-stage');
    var img = el('img', 'jc-iv-img');
    img.alt = '';
    img.draggable = false;
    var spin = el('div', 'jc-iv-spin');
    spin.setAttribute('aria-label', 'Loading');
    var errBox = el('div', 'jc-iv-err', 'Could not load this image.');
    stage.appendChild(img); stage.appendChild(spin); stage.appendChild(errBox);

    var prev = el('button', 'jc-iv-nav jc-iv-prev', '‹');
    prev.title = 'Previous image (←)'; prev.setAttribute('aria-label', 'Previous image');
    var next = el('button', 'jc-iv-nav jc-iv-next', '›');
    next.title = 'Next image (→)'; next.setAttribute('aria-label', 'Next image');

    var tools = el('div', 'jc-iv-tools');
    var zOut = el('button', 'jc-iv-btn', '−'); zOut.title = 'Zoom out (−)'; zOut.setAttribute('aria-label', 'Zoom out');
    var zPct = el('span', 'jc-iv-pct', '100%');
    var zIn = el('button', 'jc-iv-btn', '+'); zIn.title = 'Zoom in (+)'; zIn.setAttribute('aria-label', 'Zoom in');
    var zFit = el('button', 'jc-iv-btn', '⤢'); zFit.title = 'Fit (0)'; zFit.setAttribute('aria-label', 'Reset zoom');
    [zOut, zPct, zIn, zFit].forEach(function (n) { tools.appendChild(n); });

    [head, stage, prev, next, tools].forEach(function (n) { ov.appendChild(n); });
    document.body.appendChild(ov);

    // ---- transform ----
    function clampPan() {
      var r = stage.getBoundingClientRect();
      var w = img.offsetWidth * st.s, h = img.offsetHeight * st.s;
      var mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
      st.tx = Math.max(-mx, Math.min(mx, st.tx));
      st.ty = Math.max(-my, Math.min(my, st.ty));
    }
    function apply(animate) {
      if (st.s <= MIN) { st.s = MIN; st.tx = 0; st.ty = 0; }
      clampPan();
      img.style.transition = animate ? 'transform .18s ease-out' : 'none';
      img.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.s + ')';
      zPct.textContent = Math.round(st.s * 100) + '%';
      zOut.disabled = st.s <= MIN; zIn.disabled = st.s >= MAX;
      ov.classList.toggle('jc-iv-zoomed', st.s > MIN);
    }
    // zoom to `to`, keeping the screen point (cx, cy) still
    function zoomAt(to, cx, cy, animate) {
      var s0 = st.s;
      var s1 = Math.max(MIN, Math.min(MAX, to));
      if (s1 === s0) return;
      var r = stage.getBoundingClientRect();
      var px = (cx == null ? r.left + r.width / 2 : cx) - (r.left + r.width / 2);
      var py = (cy == null ? r.top + r.height / 2 : cy) - (r.top + r.height / 2);
      st.tx = px - (px - st.tx) * (s1 / s0);
      st.ty = py - (py - st.ty) * (s1 / s0);
      st.s = s1;
      apply(animate);
    }

    // ---- showing an image ----
    function show(i) {
      st.i = (i + list.length) % list.length;
      var it = list[st.i];
      st.s = 1; st.tx = 0; st.ty = 0; apply(false);
      whoName.textContent = same(it.sender, me) ? 'You' : it.sender;
      whoTime.textContent = it.ts ? fmtDay(it.ts) + ', ' + fmtTime(it.ts) : '';
      count.textContent = list.length > 1 ? (st.i + 1) + ' / ' + list.length : '';
      dl.href = it.download;
      img.alt = it.name || 'Image';
      prev.style.display = next.style.display = list.length > 1 ? '' : 'none';
      spin.style.display = 'block';
      errBox.style.display = 'none';
      img.style.opacity = '0';
      img.onload = function () { spin.style.display = 'none'; img.style.opacity = '1'; };
      img.onerror = function () { spin.style.display = 'none'; errBox.style.display = 'block'; };
      img.src = it.src;
    }

    // ---- closing (and the phone Back button) ----
    var pushed = false;
    try { history.pushState({ jcViewer: true }, ''); pushed = true; } catch (_e) { }
    function onPop() { close(true); }
    window.addEventListener('popstate', onPop);
    function close(fromHistory) {
      if (!viewer) return;
      viewer = null;
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
      if (pushed && !fromHistory) { try { history.back(); } catch (_e) { } }
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_e) { } }
    }

    // ---- keyboard ----
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft' && list.length > 1 && st.s === 1) { e.preventDefault(); show(st.i - 1); }
      else if (e.key === 'ArrowRight' && list.length > 1 && st.s === 1) { e.preventDefault(); show(st.i + 1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(st.s * 1.5, null, null, true); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(st.s / 1.5, null, null, true); }
      else if (e.key === '0') { e.preventDefault(); st.s = 1; apply(true); }
      else if (e.key === 'Tab') {
        // keep focus inside the viewer
        var f = Array.prototype.filter.call(ov.querySelectorAll('button, a[href]'), function (n) { return n.offsetParent && !n.disabled; });
        if (!f.length) return;
        var at = f.indexOf(document.activeElement);
        if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && at === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);

    // ---- buttons ----
    xBtn.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    prev.addEventListener('click', function (e) { e.stopPropagation(); show(st.i - 1); });
    next.addEventListener('click', function (e) { e.stopPropagation(); show(st.i + 1); });
    zIn.addEventListener('click', function (e) { e.stopPropagation(); zoomAt(st.s * 1.5, null, null, true); });
    zOut.addEventListener('click', function (e) { e.stopPropagation(); zoomAt(st.s / 1.5, null, null, true); });
    zFit.addEventListener('click', function (e) { e.stopPropagation(); st.s = 1; apply(true); });
    dl.addEventListener('click', function (e) { e.stopPropagation(); });
    [head, tools].forEach(function (n) { n.addEventListener('click', function (e) { e.stopPropagation(); }); });

    // ---- wheel zoom ----
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(st.s * Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY, false);
    }, { passive: false });

    // ---- pointer: drag to pan, pinch, swipe, tap / double-tap, backdrop close ----
    var pts = new Map();
    var gesture = null; // { kind: 'pan'|'pinch'|'swipe', ... }
    var moved = false;
    var lastTap = { t: 0, x: 0, y: 0 };
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    stage.addEventListener('pointerdown', function (e) {
      try { stage.setPointerCapture(e.pointerId); } catch (_e) { /* capture is a nicety; gestures work without it */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pts.size === 2) {
        var p = Array.from(pts.values());
        gesture = { kind: 'pinch', d0: dist(p[0], p[1]), s0: st.s, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
      } else {
        gesture = { kind: st.s > 1 ? 'pan' : 'swipe', x0: e.clientX, y0: e.clientY, tx0: st.tx, ty0: st.ty };
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId) || !gesture) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture.kind === 'pinch' && pts.size === 2) {
        var p = Array.from(pts.values());
        moved = true;
        zoomAt(gesture.s0 * dist(p[0], p[1]) / gesture.d0, gesture.cx, gesture.cy, false);
      } else if (gesture.kind === 'pan') {
        var dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        st.tx = gesture.tx0 + dx; st.ty = gesture.ty0 + dy;
        apply(false);
      } else if (gesture.kind === 'swipe') {
        var sx = e.clientX - gesture.x0;
        if (Math.abs(sx) > 6) moved = true;
        img.style.transition = 'none';
        img.style.transform = 'translateX(' + sx + 'px)';
      }
    });
    function endPointer(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'swipe') {
        var sx = e.clientX - gesture.x0;
        if (list.length > 1 && Math.abs(sx) > 60 && Math.abs(e.clientY - gesture.y0) < 80) show(st.i + (sx < 0 ? 1 : -1));
        else apply(true);
      }
      if (gesture.kind === 'pinch' && pts.size === 1) {
        // one finger left after a pinch: carry on as a pan from here
        var rest = Array.from(pts.values())[0];
        gesture = { kind: st.s > 1 ? 'pan' : 'swipe', x0: rest.x, y0: rest.y, tx0: st.tx, ty0: st.ty };
        return;
      }
      if (!pts.size) gesture = null;
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', function (e) { pts.delete(e.pointerId); gesture = null; apply(true); });

    // click: double-click/tap toggles zoom; a single click on the backdrop closes,
    // unless it ended a drag, pinch or swipe.
    var tapTimer = null;
    stage.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }
      var now = Date.now();
      var isDouble = now - lastTap.t < 300 && Math.abs(e.clientX - lastTap.x) < 30 && Math.abs(e.clientY - lastTap.y) < 30;
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (isDouble) {
        clearTimeout(tapTimer); tapTimer = null;
        if (st.s > 1) { st.s = 1; apply(true); } else zoomAt(DOUBLE, e.clientX, e.clientY, true);
        lastTap.t = 0;
        return;
      }
      if (e.target === img) return; // a single tap on the picture does nothing
      // wait a moment so a double-tap on the backdrop is not taken as "close"
      tapTimer = setTimeout(function () { tapTimer = null; close(); }, 260);
    });

    viewer = { close: close };
    show(index);
    xBtn.focus();
  }

  // ================= Replies =================
  function lineOf(m) {
    if (m.deleted || m.purged) return '';
    var label = { image: '📷 Photo', pdf: '📄 PDF', xlsx: '📊 Excel file', audio: '🎤 Audio', video: '🎥 Video' }[m.attachment ? m.attachment.kind : ''];
    if (m.kind === 'link' && m.link) return '🔗 ' + (m.link.title || 'Shared page') + (m.body ? ': ' + m.body : '');
    var t = String(m.body || '').replace(/\s+/g, ' ').trim();
    return label ? (t ? label + ': ' + t : label) : t;
  }

  function replyQuote() {
    if (!replying) return null;
    var m = replying;
    return { sync_id: m.sync_id, sender: m.sender, text: lineOf(m), kind: m.kind,
      image: m.attachment && m.attachment.kind === 'image' ? m.attachment.sync_id : null };
  }

  function startReply(m) {
    if (!current || current.is_member === false) return;
    cancelEdit();
    replying = m;
    var bar = els.replyBar;
    bar.textContent = '';
    var q = replyQuote();
    if (q.image) { var im = el('img'); im.src = API + '/files/' + encodeURIComponent(q.image); im.alt = ''; bar.appendChild(im); }
    var t = el('div', 'jc-rb');
    t.appendChild(el('b', null, '↩ ' + (same(m.sender, me) ? 'You' : m.sender)));
    t.appendChild(el('span', null, q.text || (m.attachment ? m.attachment.file_name : '')));
    bar.appendChild(t);
    var x = el('button', 'jc-ibtn', '✕');
    x.title = 'Cancel reply';
    x.addEventListener('click', cancelReply);
    bar.appendChild(x);
    bar.style.display = 'flex';
    els.ta.focus();
  }

  function cancelReply() {
    replying = null;
    if (els.replyBar) els.replyBar.style.display = 'none';
  }

  function quoteEl(q) {
    var d = el('div', 'jc-quote');
    if (q.image && !q.deleted) {
      var im = el('img');
      im.src = API + '/files/' + encodeURIComponent(q.image);
      im.alt = '';
      d.appendChild(im);
    }
    var t = el('div');
    t.appendChild(el('b', null, q.deleted ? '' : (same(q.sender, me) ? 'You' : q.sender)));
    t.appendChild(el('span', null, q.deleted ? 'Original message deleted' : (q.text || '…')));
    d.appendChild(t);
    d.title = 'Show the original message';
    d.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!q.deleted) flash(q.sync_id);
    });
    return d;
  }

  // Swipe a message to the right on a phone to reply to it.
  function addSwipe(row, bub, m) {
    var x0 = null, y0 = 0, dx = 0;
    row.addEventListener('touchstart', function (e) { var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; }, { passive: true });
    row.addEventListener('touchmove', function (e) {
      if (x0 === null) return;
      var t = e.touches[0];
      if (Math.abs(t.clientY - y0) > 30) { x0 = null; bub.style.transform = ''; return; }
      dx = Math.max(0, Math.min(80, t.clientX - x0));
      bub.style.transform = 'translateX(' + dx + 'px)';
    }, { passive: true });
    row.addEventListener('touchend', function () {
      bub.style.transition = 'transform .15s';
      bub.style.transform = '';
      setTimeout(function () { bub.style.transition = ''; }, 160);
      if (x0 !== null && dx > 55) startReply(m);
      x0 = null;
    });
  }

  // ================= Share to chat =================
  var markState = null;
  var targetBanner = null;

  // window.CSS: this file has its own CSS variable (the stylesheet text).
  function cssEsc(v) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(String(v));
    return String(v).replace(/[^a-zA-Z0-9_-]/g, function (c) { return "\\" + c; });
  }

  function isOurs(node) { return !!(node && node.closest && node.closest('.jc-root, .jc-sheet-bg, .jc-markbar, .jc-tbanner, .jc-ctxpill')); }

  // Codes people quote on the floor: machine, job card, mould, order numbers.
  function findCodes(text) {
    var out = [];
    var re = /\b(?:[A-Z]{1,5}[-\/]?\d{1,6}(?:[-\/][A-Z0-9]{1,8})*|\d{2,4}[-\/][A-Z0-9]{2,10})\b/g;
    var m2;
    while ((m2 = re.exec(text)) && out.length < 4) if (out.indexOf(m2[0]) === -1) out.push(m2[0]);
    return out;
  }

  function textOf(node) { return String((node && (node.innerText || node.textContent)) || '').replace(/\s+/g, ' ').trim(); }

  // The element worth pointing at: the nearest row, card or element with an id / data-* key.
  function anchorOf(node) {
    var n = node, steps = 0;
    while (n && n !== document.body && steps < 8) {
      if (n.id && !/^\d|jc-/.test(n.id)) return n;
      var hasData = Array.prototype.some.call(n.attributes || [], function (a) { return /^data-(?!bs-|toggle|target|dismiss)/i.test(a.name) && a.value && a.value.length < 120; });
      if (hasData) return n;
      if (/^(TR|LI)$/.test(n.tagName) || /\b(card|tile|machine|row|item)\b/i.test(n.className || '')) return n;
      n = n.parentElement; steps += 1;
    }
    return node;
  }

  function cssPath(node) {
    var parts = [];
    var n = node;
    while (n && n.nodeType === 1 && n !== document.body && parts.length < 7) {
      if (n.id && !/^\d/.test(n.id)) { parts.unshift('#' + cssEsc(n.id)); break; }
      var tag = n.tagName.toLowerCase();
      var i = 1, sib = n;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === n.tagName) i += 1;
      parts.unshift(tag + ':nth-of-type(' + i + ')');
      n = n.parentElement;
    }
    return parts.join(' > ');
  }

  function locatorFor(node) {
    var a = anchorOf(node);
    var data = {};
    Array.prototype.forEach.call(a.attributes || [], function (at) {
      if (/^data-(?!bs-|toggle|target|dismiss)/i.test(at.name) && at.value && at.value.length < 120 && Object.keys(data).length < 4) data[at.name] = at.value;
    });
    var text = textOf(a).slice(0, 150);
    return { el: a, locator: { id: a.id && !/^\d/.test(a.id) ? a.id : undefined, data: data, path: cssPath(a), tag: a.tagName.toLowerCase(), text: text, codes: findCodes(text) } };
  }

  // Find the marked element again on the opened page (the page may still be loading).
  function resolveLocator(loc) {
    if (!loc) return null;
    var byText = function (cand) {
      var want = (loc.codes && loc.codes.length) ? loc.codes : (loc.text ? [loc.text.slice(0, 40)] : []);
      if (!want.length) return null;
      var best = null;
      Array.prototype.forEach.call(cand, function (c) {
        if (isOurs(c)) return;
        var t = textOf(c);
        if (want.every(function (w) { return t.indexOf(w) !== -1; }) && (!best || t.length < textOf(best).length)) best = c;
      });
      return best;
    };
    try {
      if (loc.id) { var e1 = document.getElementById(loc.id); if (e1) return e1; }
      var keys = Object.keys(loc.data || {});
      if (keys.length) {
        var sel = keys.map(function (k) { return '[' + k + '="' + cssEsc(loc.data[k]) + '"]'; }).join('');
        var e2 = document.querySelector(sel);
        if (e2) return e2;
      }
      if (loc.path) {
        var e3 = document.querySelector(loc.path);
        if (e3 && (!loc.text || textOf(e3).slice(0, 30) === loc.text.slice(0, 30))) return e3;
      }
      if (loc.tag) { var e4 = byText(document.getElementsByTagName(loc.tag)); if (e4) return e4; }
      return byText(document.querySelectorAll('tr, li, td, [class*="card"], [class*="tile"]'));
    } catch (_e) { return null; }
  }

  function currentFactory() {
    if (serverInfo.server_type === 'LOCAL') return { id: serverInfo.factory_id, name: 'Factory ' + serverInfo.factory_id };
    var id = null, name = '';
    try { id = localStorage.getItem('jpsms_factory_id'); name = localStorage.getItem('jpsms_factory_name') || ''; } catch (_e) { }
    if (!id || id === 'all') return { id: null, name: id === 'all' ? 'All factories' : '' };
    return { id: parseInt(id, 10), name: name };
  }

  function pageTitle() {
    var h = document.querySelector('h1, .page-title, .am-header h1, .ca-header h1, header h1');
    var t = (h && textOf(h)) || document.title || location.pathname;
    return t.replace(/^\(\d+\+?\)\s*/, '').replace(/^JMS OCEAN\s*-\s*/i, '').slice(0, 100);
  }

  function startMark() {
    if (markState) return;
    toggle(false);
    var bar = el('div', 'jc-markbar');
    bar.appendChild(el('span', null, '🔗 Click the problem on the page to mark it'));
    var whole = el('button', 'jc-pri', 'Share whole page');
    var cancel = el('button', null, 'Cancel');
    bar.appendChild(whole); bar.appendChild(cancel);
    var box = el('div', 'jc-markbox');
    box.style.display = 'none';
    document.body.appendChild(bar);
    document.body.appendChild(box);
    var hover = null;
    function onMove(e) {
      var t = e.target;
      if (isOurs(t)) { box.style.display = 'none'; hover = null; return; }
      hover = anchorOf(t);
      var rc = hover.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = rc.left - 3 + 'px'; box.style.top = rc.top - 3 + 'px';
      box.style.width = rc.width + 6 + 'px'; box.style.height = rc.height + 6 + 'px';
    }
    function onClick(e) {
      if (isOurs(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      var pick = e.target;
      finish();
      openShareSheet(pick);
    }
    function onKey(e) { if (e.key === 'Escape') finish(); }
    function finish() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      bar.remove(); box.remove();
      markState = null;
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    whole.addEventListener('click', function (e) { e.stopPropagation(); finish(); openShareSheet(null); });
    cancel.addEventListener('click', function (e) { e.stopPropagation(); finish(); });
    markState = { finish: finish };
  }

  // Right-click (Shift+right-click keeps the browser menu) or long-press on a row, card
  // or tile offers "Share to chat" for that spot.
  function setupContextShare() {
    var pill = null;
    function hide() { if (pill) { pill.remove(); pill = null; } }
    function offer(target, x, y) {
      hide();
      pill = el('button', 'jc-ctxpill', '🔗 Share to chat');
      pill.style.left = Math.min(x, window.innerWidth - 170) + 'px';
      pill.style.top = Math.min(y, window.innerHeight - 50) + 'px';
      pill.addEventListener('click', function (e) { e.stopPropagation(); hide(); openShareSheet(target); });
      document.body.appendChild(pill);
    }
    function shareable(t) {
      if (!t || isOurs(t) || stopped || /^(INPUT|TEXTAREA|SELECT|A|BUTTON)$/.test(t.tagName) || t.isContentEditable) return false;
      return !!(t.closest && t.closest('tr, li, [data-machine], [data-id], [data-job], [data-mould], [class*="card"], [class*="tile"]'));
    }
    document.addEventListener('contextmenu', function (e) {
      if (e.shiftKey || !shareable(e.target)) return;
      e.preventDefault();
      offer(e.target, e.clientX, e.clientY);
    });
    var lp = null;
    document.addEventListener('touchstart', function (e) {
      var t = e.target;
      if (!shareable(t)) return;
      var touch = e.touches[0];
      lp = setTimeout(function () { offer(t, touch.clientX, touch.clientY); }, 650);
    }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach(function (n) {
      document.addEventListener(n, function () { if (lp) { clearTimeout(lp); lp = null; } }, { passive: true });
    });
    document.addEventListener('click', function (e) { if (pill && !pill.contains(e.target)) hide(); });
    window.addEventListener('scroll', hide, true);
  }

  function openShareSheet(node) {
    var picked = node ? locatorFor(node) : null;
    if (picked) picked.el.classList.add('jc-target');
    var fac = currentFactory();
    var link = {
      url: location.pathname + location.search.replace(/([?&])(jmsChatTarget|chat)=[^&#]*&?/gi, '$1').replace(/[?&]$/, '') + location.hash.replace(/#?jmsChatTarget=[0-9a-f-]+/i, ''),
      title: pageTitle(),
      factory_id: fac.id,
      factory_name: fac.name || null,
      locator: picked ? picked.locator : null,
      excerpt: picked ? picked.locator.text : ''
    };
    var bg = el('div', 'jc-sheet-bg');
    var sh = el('div', 'jc-sheet');
    var h = el('h3', null, '🔗 Share to chat');
    var x = el('button', 'jc-ibtn', '✕');
    h.appendChild(x);
    var body = el('div', 'jc-sbody');
    var prev = el('div', 'jc-linkcard');
    prev.style.cursor = 'default';
    prev.appendChild(el('b', null, link.title + (fac.name ? ' · ' + fac.name : '')));
    prev.appendChild(el('div', 'jc-lx', picked ? link.excerpt || '(marked item)' : 'Whole page'));
    body.appendChild(prev);
    body.appendChild(el('div', 'jc-slabel', 'Note'));
    var note = el('textarea');
    note.placeholder = 'Problem: …';
    note.maxLength = 2000;
    body.appendChild(note);
    body.appendChild(el('div', 'jc-slabel', 'Priority'));
    var prio = el('div', 'jc-prio');
    var priority = 'normal';
    [['normal', 'Normal'], ['urgent', '⚠ Urgent']].forEach(function (pv) {
      var lb = el('label', pv[0] === 'urgent' ? 'jc-urg' : 'jc-sel');
      var rd = el('input'); rd.type = 'radio'; rd.name = 'jcprio'; rd.checked = pv[0] === 'normal';
      rd.addEventListener('change', function () {
        priority = pv[0];
        Array.prototype.forEach.call(prio.children, function (c) { c.classList.toggle('jc-sel', c === lb); });
      });
      lb.appendChild(rd); lb.appendChild(document.createTextNode(pv[1]));
      prio.appendChild(lb);
    });
    body.appendChild(prio);
    body.appendChild(el('div', 'jc-slabel', 'Send to'));
    var count = el('span', 'jc-prev', 'Pick people or groups');
    var groupsBox = el('div');
    var chosenGroups = {};
    loadConvs().then(function () {
      var groups = convs.filter(function (c) { return isGroup(c) && c.is_member !== false; });
      if (!groups.length) return;
      groupsBox.appendChild(el('div', 'jc-sect', 'Groups'));
      groups.forEach(function (g) {
        var it = el('div', 'jc-item');
        var cb = el('input', 'jc-chk'); cb.type = 'checkbox';
        cb.addEventListener('change', function () { if (cb.checked) chosenGroups[g.sync_id] = true; else delete chosenGroups[g.sync_id]; check(); });
        it.appendChild(cb);
        var av = el('div', 'jc-av', '👥'); av.style.background = avatarColor(g.title);
        it.appendChild(av);
        it.appendChild(el('div', 'jc-name', g.title));
        it.addEventListener('click', function (e) { if (e.target !== cb) cb.click(); });
        groupsBox.appendChild(it);
      });
    });
    body.appendChild(groupsBox);
    body.appendChild(el('div', 'jc-sect', 'People'));
    var people = el('div');
    var chosenPeople = [];
    var excl = {}; excl[String(me).toLowerCase()] = true;
    picker(people, excl, function (c) { chosenPeople = c; check(); });
    body.appendChild(people);
    var foot = el('div', 'jc-sfoot');
    var send = el('button', 'jc-btn', 'Send');
    send.disabled = true;
    var cancel = el('button', 'jc-btn jc-danger', 'Cancel');
    foot.appendChild(count); count.style.flex = '1';
    foot.appendChild(cancel); foot.appendChild(send);
    sh.appendChild(h); sh.appendChild(body); sh.appendChild(foot);
    bg.appendChild(sh);
    document.body.appendChild(bg);
    note.focus();
    function check() {
      var n = chosenPeople.length + Object.keys(chosenGroups).length;
      count.textContent = n ? n + ' selected' : 'Pick people or groups';
      send.disabled = !n;
    }
    function close() { bg.remove(); if (picked) setTimeout(function () { picked.el.classList.remove('jc-target'); }, 1500); }
    x.addEventListener('click', close);
    cancel.addEventListener('click', close);
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    send.addEventListener('click', function () {
      send.disabled = true;
      api('POST', API + '/share', { users: chosenPeople, conversations: Object.keys(chosenGroups), note: note.value.trim(), priority: priority, link: link })
        .then(function (d) {
          close();
          var n = d.sent.length;
          toastText('Shared', 'Sent to ' + n + ' chat' + (n === 1 ? '' : 's') + '.');
        })
        .catch(function (e) { send.disabled = false; count.textContent = e.message; });
    });
  }

  function toastText(title, text) {
    var t = el('div', 'jc-toast');
    t.appendChild(el('b', null, title));
    t.appendChild(el('span', null, text));
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  // ---- link cards ----
  var STATUS = { open: 'Open', in_progress: 'In progress', done: 'Done' };

  function linkCardEl(m) {
    var L = m.link;
    var urgent = L.priority === 'urgent';
    var c = el('div', 'jc-linkcard' + (urgent ? ' jc-urgent' : ''));
    c.appendChild(el('b', null, (urgent ? '⚠ ' : '🔗 ') + (L.title || 'Shared page') + (L.factory_name ? ' · ' + L.factory_name : '')));
    if (L.excerpt) c.appendChild(el('div', 'jc-lx', L.excerpt));
    var rowx = el('div', 'jc-lrow');
    var st = (m.task && m.task.status) || 'open';
    if (L.alert) {
      // Machine-stop alert: Acknowledge button instead of the work status.
      if (st === 'done') {
        rowx.appendChild(el('span', 'jc-badge2 jc-st-done', '✓ Acknowledged' + (m.task && m.task.by ? ' · ' + m.task.by : '')));
      } else {
        var ack = el('button', 'jc-ackbtn', '✓ Acknowledge');
        ack.addEventListener('click', function (e) {
          e.stopPropagation();
          ack.disabled = true;
          api('POST', API + '/tasks/' + encodeURIComponent(m.sync_id), { status: 'done' })
            .then(function (d) {
              m.task = { status: d.task.status, by: d.task.by || me };
              var badge = el('span', 'jc-badge2 jc-st-done', '✓ Acknowledged · ' + m.task.by);
              ack.replaceWith(badge);
            })
            .catch(function (er) { ack.disabled = false; showErr(er.message || 'Could not acknowledge.'); });
        });
        rowx.appendChild(ack);
      }
      rowx.appendChild(el('span', 'jc-prev', 'Open DPR ›'));
      c.appendChild(rowx);
      c.title = 'Open ' + L.url;
      c.addEventListener('click', function (e) { e.stopPropagation(); openLink(m); });
      return c;
    }
    rowx.appendChild(el('span', 'jc-badge2 jc-st-' + st, STATUS[st] || st));
    if (urgent) rowx.appendChild(el('span', 'jc-badge2 jc-urg-b', 'Urgent'));
    rowx.appendChild(el('span', 'jc-prev', 'Tap to open ›'));
    c.appendChild(rowx);
    c.title = 'Open ' + L.url;
    c.addEventListener('click', function (e) { e.stopPropagation(); openLink(m); });
    return c;
  }

  // Same-origin relative paths only (the server already refuses anything else).
  function safeUrl(u) { return typeof u === 'string' && /^\/(?!\/)/.test(u) && !/[\\\s]/.test(u) ? u : null; }

  function withTarget(u, id) {
    var hashAt = u.indexOf('#');
    var base = hashAt === -1 ? u : u.slice(0, hashAt);
    var hash = hashAt === -1 ? '' : u.slice(hashAt);
    return base + (base.indexOf('?') === -1 ? '?' : '&') + 'jmsChatTarget=' + id + hash;
  }

  // On the main site, switch to the link's factory when this user may see it.
  // Returns 'ok', 'switched', 'denied' or 'other-server'.
  function ensureFactory(L) {
    if (!L || L.factory_id == null) return 'ok';
    if (serverInfo.server_type === 'LOCAL') return Number(serverInfo.factory_id) === Number(L.factory_id) ? 'ok' : 'other-server';
    var cur = currentFactory();
    if (cur.id == null && cur.name === 'All factories') return 'ok';
    if (Number(cur.id) === Number(L.factory_id)) return 'ok';
    var allowed = [];
    try { allowed = JSON.parse(localStorage.getItem('jpsms_allowed_factories') || '[]'); } catch (_e) { allowed = []; }
    var f = allowed.filter(function (a) { return Number(a && typeof a === 'object' ? a.id : a) === Number(L.factory_id); })[0];
    var canAll = localStorage.getItem('jpsms_can_all_factories') === 'true';
    if (!f && !canAll) return 'denied';
    try {
      var oldView = localStorage.getItem('jpsms_factory_id');
      localStorage.setItem('jpsms_factory_id', String(L.factory_id));
      localStorage.setItem('jpsms_factory_name', (f && f.name) || L.factory_name || ('Factory ' + L.factory_id));
      if (localStorage.getItem('jpsms_write_factory_id') === oldView) {
        localStorage.setItem('jpsms_write_factory_id', String(L.factory_id));
        localStorage.setItem('jpsms_write_factory_name', (f && f.name) || L.factory_name || ('Factory ' + L.factory_id));
      }
    } catch (_e) { return 'denied'; }
    return 'switched';
  }

  function openLink(m) {
    var u = safeUrl(m.link && m.link.url);
    if (!u) { showErr('This link cannot be opened.'); return; }
    var f = ensureFactory(m.link);
    if (f === 'other-server') {
      showErr('This was shared from ' + (m.link.factory_name || 'another factory') + '. Open it on the main JMS site.');
      return;
    }
    try { sessionStorage.setItem('jmsChatReopen', m.conversation_sync_id); } catch (_e) { }
    window.location.href = withTarget(u, m.sync_id);
  }

  // ---- landing on a shared spot ----
  // The link opened this page with jmsChatTarget=<id>. Once handled, take it out of the
  // address bar (no reload), so a refresh shows the plain page instead of the banner again.
  function clearTargetParam() {
    try {
      var q = location.search.replace(/([?&])jmsChatTarget=[^&#]*(&|$)/i, function (_m, pre, post) { return post ? pre : ""; });
      if (q === "?") q = "";
      var h = location.hash.replace(/[#&]?jmsChatTarget=[0-9a-f-]+/i, "");
      history.replaceState(history.state, "", location.pathname + q + (h === "#" ? "" : h));
    } catch (_e) { }
  }

  function landOnTarget(id) {
    api('GET', API + '/messages/' + encodeURIComponent(id)).then(function (d) {
      var m = d.message;
      if (!m || m.kind !== 'link' || !m.link) { clearTargetParam(); return; }
      var f = ensureFactory(m.link);
      if (f === 'switched') {
        // the page loaded with another factory selected: load it again for the right one
        var guard = 'jmsChatSwitched:' + id;
        var again = true;
        try { again = !sessionStorage.getItem(guard); sessionStorage.setItem(guard, '1'); } catch (_e) { }
        if (again) { window.location.reload(); return; }
      }
      clearTargetParam();
      showTargetBanner(m, f);
    }).catch(function (e) { clearTargetParam(); toastText('Shared link', e.message || 'This shared item is not available.'); });
  }

  function showTargetBanner(m, factoryState) {
    var L = m.link;
    var bn = el('div', 'jc-tbanner');
    var msg = el('div', 'jc-tmsg');
    var head = el('b', null, (L.priority === 'urgent' ? '⚠ Urgent · ' : '🔗 ') + 'Shared by ' + m.sender + (m.body ? ': ' + m.body : ''));
    var sub = el('small', null, 'Finding the marked item…');
    msg.appendChild(head); msg.appendChild(sub);
    var stEl = el('span', 'jc-badge2');
    var startBtn = el('button', 'jc-pri', '▶ Start work');
    var doneBtn = el('button', null, '✓ Mark done');
    var chatBtn = el('button', null, '💬 Open chat');
    var closeBtn = el('button', null, '✕');
    closeBtn.title = 'Close';
    [msg, stEl, startBtn, doneBtn, chatBtn, closeBtn].forEach(function (n) { bn.appendChild(n); });
    document.body.appendChild(bn);
    if (L.alert) doneBtn.textContent = '✓ Acknowledge';
    function update(status, by) {
      stEl.className = 'jc-badge2 jc-st-' + status;
      stEl.textContent = (L.alert && status === 'done' ? 'Acknowledged' : (STATUS[status] || status)) + (by && status !== 'open' ? ' · ' + by : '');
      startBtn.style.display = status === 'open' && !L.alert ? '' : 'none';
      doneBtn.style.display = status === 'done' ? 'none' : '';
    }
    update((m.task && m.task.status) || 'open', m.task && m.task.by);
    function setStatus(status) {
      startBtn.disabled = doneBtn.disabled = true;
      api('POST', API + '/tasks/' + encodeURIComponent(m.sync_id), { status: status })
        .then(function (d) { update(d.task.status, d.task.by || me); })
        .catch(function (e) { sub.textContent = e.message; })
        .then(function () { startBtn.disabled = doneBtn.disabled = false; });
    }
    startBtn.addEventListener('click', function () { setStatus('in_progress'); });
    doneBtn.addEventListener('click', function () { setStatus('done'); });
    chatBtn.addEventListener('click', function () { openChatById(m.conversation_sync_id); });
    closeBtn.addEventListener('click', function () { bn.remove(); targetBanner = null; });
    targetBanner = { msgId: m.sync_id, update: update };

    if (factoryState === 'other-server') { sub.textContent = 'Shared from ' + (L.factory_name || 'another factory') + ': this factory server cannot show it. Open it on the main JMS site.'; return; }
    if (factoryState === 'denied') { sub.textContent = 'Shared from ' + (L.factory_name || 'another factory') + ', which your login cannot open.'; return; }
    if (!L.locator) { sub.textContent = 'The whole page was shared.' + (L.excerpt ? '' : ''); return; }
    // the page may still be loading its data: keep looking for a while
    var tries = 0;
    (function look() {
      var found = resolveLocator(L.locator);
      if (found) {
        found.scrollIntoView({ block: 'center', behavior: 'smooth' });
        found.classList.add('jc-target');
        sub.textContent = 'The marked item is highlighted below.';
        return;
      }
      if (++tries < 24) { setTimeout(look, 500); return; }
      sub.textContent = 'Could not find the marked item on this page (it may have changed or moved).' + (L.excerpt ? ' It was: "' + L.excerpt.slice(0, 120) + '"' : '');
    })();
  }


  // ---------------- voice calls in the browser (WebRTC audio, same server set-up as the app) ----------------
  var webCall = (function () {
    var st = null; // { id, peer, incoming, pc, stream, audio, seq, timer, poll, ui, answeredAt, muted }
    var ring = null;

    function ui(peer, status, buttons) {
      if (!st) return;
      if (!st.ui) { st.ui = el('div', 'jc-call'); document.body.appendChild(st.ui); }
      var u = st.ui;
      u.textContent = '';
      var av = el('div', 'jc-av');
      var c = convs.filter(function (x) { return !isGroup(x) && same(x.title, peer); })[0];
      setAvatar(av, peer, c && c.photo_v, false);
      u.appendChild(av);
      u.appendChild(el('h2', null, peer));
      st.statusEl = el('p', null, status);
      u.appendChild(st.statusEl);
      var row = el('div', 'jc-cbtns');
      buttons.forEach(function (b) {
        var btn = el('button', b[2] || '', b[0]);
        btn.title = b[1];
        btn.addEventListener('click', b[3]);
        row.appendChild(btn);
      });
      u.appendChild(row);
    }

    function startRing() {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        var ctx = new AC();
        var on = true;
        ring = { ctx: ctx, timer: setInterval(function () {
          if (!on) return;
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = 440; g.gain.value = 0.15;
          o.connect(g); g.connect(ctx.destination);
          o.start(); setTimeout(function () { o.stop(); }, 700);
        }, 1600) };
      } catch (_e) { ring = null; }
    }
    function stopRing() { if (ring) { clearInterval(ring.timer); try { ring.ctx.close(); } catch (_e) { } ring = null; } }

    function controls() {
      return [
        [st && st.muted ? '🔇' : '🎤', st && st.muted ? 'Unmute' : 'Mute', st && st.muted ? 'jc-on' : '', function () {
          st.muted = !st.muted;
          st.stream.getAudioTracks().forEach(function (t) { t.enabled = !st.muted; });
          ui(st.peer, st.statusEl.textContent, controls());
        }],
        ['📵', 'Hang up', 'jc-red', function () { hangUp(); }]
      ];
    }

    function connect(ice) {
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
        st.stream = stream;
        var pc = new RTCPeerConnection({ iceServers: ice || [] });
        st.pc = pc;
        stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
        st.audio = new Audio();
        st.audio.autoplay = true;
        pc.ontrack = function (e) { st.audio.srcObject = e.streams[0]; };
        pc.onicecandidate = function (e) {
          if (e.candidate) signal('ice', JSON.stringify({ sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex, candidate: e.candidate.candidate }));
        };
        pc.onconnectionstatechange = function () {
          if (!st) return;
          if (pc.connectionState === 'connected' && !st.answeredAt) {
            st.answeredAt = Date.now();
            st.timer = setInterval(function () {
              if (!st) return;
              var s = Math.floor((Date.now() - st.answeredAt) / 1000);
              st.statusEl.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
            }, 1000);
          } else if (pc.connectionState === 'failed') { hangUp('Connection lost'); }
        };
        return pc;
      });
    }

    function signal(kind, data) {
      if (!st) return Promise.resolve();
      return api('POST', API + '/calls/' + st.id + '/signal', { kind: kind, data: data }).catch(function () { });
    }

    var pendingIce = [], remoteSet = false;
    function poll() {
      if (!st) return;
      api('GET', API + '/calls/' + st.id + '/signals?after=' + st.seq).then(function (d) {
        if (!st) return;
        var chain = Promise.resolve();
        (d.signals || []).forEach(function (sg) {
          st.seq = Math.max(st.seq, sg.seq);
          chain = chain.then(function () { return onSignal(sg.kind, JSON.parse(sg.data)); }).catch(function () { });
        });
        if (['ended', 'declined', 'missed', 'cancelled'].indexOf(d.status) !== -1) { finish(d.status === 'declined' ? 'Declined' : d.status === 'missed' ? 'No answer' : 'Call ended'); return; }
        if (d.status === 'accepted' && !st.incoming && !st.answeredAt) st.statusEl.textContent = 'Connecting…';
        st.poll = setTimeout(poll, st.answeredAt ? 2000 : 700);
      }).catch(function () { if (st) st.poll = setTimeout(poll, 1500); });
    }

    function onSignal(kind, j) {
      var pc = st && st.pc;
      if (!pc) return Promise.resolve();
      if (kind === 'offer') {
        return pc.setRemoteDescription({ type: 'offer', sdp: j.sdp }).then(function () {
          remoteSet = true; pendingIce.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(function () { }); });
          return pc.createAnswer();
        }).then(function (a) { return pc.setLocalDescription(a).then(function () { return signal('answer', JSON.stringify({ type: 'answer', sdp: a.sdp })); }); });
      }
      if (kind === 'answer') {
        return pc.setRemoteDescription({ type: 'answer', sdp: j.sdp }).then(function () {
          remoteSet = true; pendingIce.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(function () { }); });
        });
      }
      if (kind === 'ice') {
        var c = { sdpMid: j.sdpMid, sdpMLineIndex: j.sdpMLineIndex, candidate: j.candidate };
        if (remoteSet) return pc.addIceCandidate(c).catch(function () { });
        pendingIce.push(c);
      }
      return Promise.resolve();
    }

    function startCall(peer) {
      if (st) return;
      if (!window.RTCPeerConnection || !navigator.mediaDevices) { showErr('This browser cannot make calls.'); return; }
      st = { peer: peer, incoming: false, seq: 0 };
      remoteSet = false; pendingIce = [];
      ui(peer, 'Calling…', [['📵', 'Cancel', 'jc-red', function () { hangUp(); }]]);
      api('POST', API + '/calls', { to: peer }).then(function (d) {
        if (!st) return;
        st.id = d.call.id;
        return connect(d.ice).then(function (pc) {
          ui(peer, 'Ringing…', controls());
          return pc.createOffer({ offerToReceiveAudio: true }).then(function (o) {
            return pc.setLocalDescription(o).then(function () { return signal('offer', JSON.stringify({ type: 'offer', sdp: o.sdp })); });
          });
        }).then(poll);
      }).catch(function (e) { finish(e.message || 'Call failed'); });
    }

    function incoming(id, caller) {
      if (st) return; // already on a call; the server marks it missed after the ring time
      st = { id: id, peer: caller, incoming: true, seq: 0 };
      remoteSet = false; pendingIce = [];
      startRing();
      if (document.hidden && window.Notification && Notification.permission === 'granted') {
        try { new Notification(caller, { body: 'Incoming voice call · JMS Chat', tag: 'jms-call' }); } catch (_e) { }
      }
      ui(caller, 'Incoming voice call', [
        ['📵', 'Decline', 'jc-red', function () { api('POST', API + '/calls/' + id + '/decline', {}).catch(function () { }); finish('Declined'); }],
        ['📞', 'Answer', 'jc-green', function () { answer(); }]
      ]);
    }

    function answer() {
      stopRing();
      if (!st) return;
      ui(st.peer, 'Connecting…', controls());
      api('POST', API + '/calls/' + st.id + '/accept', {}).then(function (d) {
        return connect(d.ice).then(poll);
      }).catch(function (e) { finish(e.message || 'The call has ended.'); });
    }

    function hangUp(msg) {
      if (st && st.id) api('POST', API + '/calls/' + st.id + '/end', {}).catch(function () { });
      finish(msg || 'Call ended');
    }

    function remoteEnded(id, reason) {
      if (!st || st.id !== id) return;
      finish(reason === 'declined' ? 'Declined' : reason === 'missed' ? 'No answer' : 'Call ended');
    }

    function finish(msg) {
      stopRing();
      if (!st) return;
      clearTimeout(st.poll); clearInterval(st.timer);
      try { if (st.pc) st.pc.close(); } catch (_e) { }
      if (st.stream) st.stream.getTracks().forEach(function (t) { t.stop(); });
      if (st.audio) st.audio.srcObject = null;
      var u = st.ui;
      if (u && st.statusEl) { st.statusEl.textContent = msg; u.querySelector('.jc-cbtns').textContent = ''; }
      st = null;
      setTimeout(function () { if (u) u.remove(); }, 1500);
      if (current) loadMessages(false);
    }

    return { start: startCall, incoming: incoming, remoteEnded: remoteEnded };
  }());

  // ---------------- phase A: polls, announcements, urgent, schedule, tasks, pins, quiet hours ----------------
  function pollEl(m) {
    var p = m.poll;
    var box = el('div', 'jc-poll');
    box.appendChild(el('b', null, '📊 ' + p.question));
    var max = Math.max(1, p.total);
    p.options.forEach(function (o, i) {
      var mine = (p.mine || []).indexOf(i) !== -1;
      var row = el('div', 'jc-popt' + (mine ? ' jc-mine' : ''));
      var bar = el('i');
      bar.style.width = Math.round(o.votes * 100 / max) + '%';
      var lab = el('span');
      lab.appendChild(el('span', null, (mine ? '✓ ' : '') + o.text));
      lab.appendChild(el('small', null, String(o.votes)));
      row.title = o.voters.join(', ');
      row.appendChild(bar); row.appendChild(lab);
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        var picks = p.multi ? (mine ? p.mine.filter(function (x) { return x !== i; }) : (p.mine || []).concat([i])) : (mine ? [] : [i]);
        api('POST', API + '/messages/' + encodeURIComponent(m.sync_id) + '/vote', { options: picks })
          .then(function (d) { Object.assign(m, d.message); redraw(); }).catch(function (e2) { showErr(e2.message); });
      });
      box.appendChild(row);
    });
    box.appendChild(el('small', null, p.total + ' voted' + (p.multi ? ' · more than one answer allowed' : '')));
    return box;
  }

  function composeMore(anchor) {
    if (!current || current.is_member === false) return;
    var items = [
      { label: '📊 Poll', run: pollDialog },
      { label: '⚠ Send as URGENT (rings even if muted)', run: function () { sendSpecial({ urgent: true }); } },
      { label: '🕒 Schedule message…', run: scheduleDialog },
      { label: '🔁 Shift handover note…', run: handoverDialog },
      { label: '📍 Check in (share my location)', run: checkIn }
    ];
    if (isGroup(current) && (current.my_role === 'admin' || isAdmin)) items.splice(1, 0, { label: '📢 Send as announcement', run: function () { sendSpecial({ announcement: true }); } });
    popup(anchor, els.main, items);
  }

  function sendSpecial(extra) {
    var text = els.ta.value.trim();
    if (!text) { showErr('Type the message first, then choose this.'); return; }
    els.ta.value = '';
    api('POST', API + '/messages', Object.assign({ sync_id: uuid(), conversation_sync_id: current.sync_id, body: text, client_ts: new Date().toISOString() }, extra))
      .then(function (d) { if (!loaded.some(function (x) { return x.sync_id === d.message.sync_id; })) loaded.push(d.message); redraw(); loadConvs(); })
      .catch(function (e) { els.ta.value = text; showErr(e.message); });
  }

  function field(label, type, value) {
    var wrap = el('label', 'jc-row2');
    wrap.style.display = 'block';
    wrap.appendChild(el('small', null, label));
    var inp = document.createElement('input');
    inp.type = type || 'text';
    inp.className = 'jc-field';
    inp.style.width = '100%';
    if (value != null) inp.value = value;
    wrap.appendChild(inp);
    return { wrap: wrap, input: inp };
  }

  function dialogButtons(dlg, okLabel, onOk) {
    var act = el('div', 'jc-act');
    var cancel = el('button', 'jc-plain', 'Cancel');
    var ok = el('button', 'jc-primary', okLabel);
    cancel.addEventListener('click', dlg.close);
    ok.addEventListener('click', onOk);
    act.appendChild(cancel); act.appendChild(ok);
    dlg.box.appendChild(act);
  }

  function pollDialog() {
    var dlg = modal('📊 New poll');
    var q = field('Question');
    dlg.body.appendChild(q.wrap);
    var opts = [];
    function addOpt() { var f = field('Option ' + (opts.length + 1)); opts.push(f.input); dlg.body.insertBefore(f.wrap, more); }
    var more = el('button', 'jc-plain', '+ Add option');
    more.addEventListener('click', function () { if (opts.length < 10) addOpt(); });
    dlg.body.appendChild(more);
    addOpt(); addOpt();
    var multiL = el('label', 'jc-row2');
    var multi = document.createElement('input'); multi.type = 'checkbox';
    multiL.appendChild(multi); multiL.appendChild(el('span', null, 'Allow more than one answer'));
    dlg.body.appendChild(multiL);
    dialogButtons(dlg, 'Send poll', function () {
      var options = opts.map(function (i) { return i.value.trim(); }).filter(Boolean);
      if (!q.input.value.trim() || options.length < 2) { showErr('Write a question and at least 2 options.'); return; }
      api('POST', API + '/messages', { sync_id: uuid(), conversation_sync_id: current.sync_id, body: q.input.value.trim(),
        poll: { question: q.input.value.trim(), options: options, multi: multi.checked } })
        .then(function (d) { dlg.close(); loaded.push(d.message); redraw(); loadConvs(); })
        .catch(function (e) { showErr(e.message); });
    });
    setTimeout(function () { q.input.focus(); }, 50);
  }

  function localInputValue(d) {
    var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 16);
  }

  function scheduleDialog() {
    var dlg = modal('🕒 Schedule message');
    var text = field('Message', 'text', els.ta.value.trim());
    var when = field('Send at', 'datetime-local', localInputValue(new Date(Date.now() + 3600000)));
    dlg.body.appendChild(text.wrap); dlg.body.appendChild(when.wrap);
    var list = el('div');
    dlg.body.appendChild(list);
    api('GET', API + '/scheduled?conversation=' + encodeURIComponent(current.sync_id)).then(function (d) {
      if (!(d.scheduled || []).length) return;
      list.appendChild(el('b', null, 'Already scheduled here'));
      d.scheduled.forEach(function (s2) {
        var r = el('div', 'jc-row2');
        r.appendChild(el('span', null, fmtDay(s2.send_at) + ' ' + fmtTime(s2.send_at) + ' · ' + s2.body.slice(0, 60)));
        var x = el('button', 'jc-plain', 'Cancel');
        x.addEventListener('click', function () { api('DELETE', API + '/scheduled/' + s2.id).then(function () { r.remove(); }); });
        r.appendChild(x);
        list.appendChild(r);
      });
    }).catch(function () { });
    dialogButtons(dlg, 'Schedule', function () {
      var at = new Date(when.input.value);
      if (!text.input.value.trim() || isNaN(at.getTime())) { showErr('Write the message and pick a time.'); return; }
      api('POST', API + '/scheduled', { conversation_sync_id: current.sync_id, body: text.input.value.trim(), send_at: at.toISOString() })
        .then(function () { dlg.close(); els.ta.value = ''; toastText('🕒 Scheduled for ' + fmtDay(at.toISOString()) + ' ' + fmtTime(at.toISOString())); })
        .catch(function (e) { showErr(e.message); });
    });
  }

  function taskDialog(m) {
    var dlg = modal('📋 Make task');
    var title = field('Task', 'text', (m.body || (m.attachment ? m.attachment.file_name : '')).slice(0, 300));
    dlg.body.appendChild(title.wrap);
    var who = el('label', 'jc-row2'); who.style.display = 'block';
    who.appendChild(el('small', null, 'Assign to'));
    var sel = document.createElement('select'); sel.className = 'jc-field'; sel.style.width = '100%';
    (current.members || []).forEach(function (u) { var o = document.createElement('option'); o.value = u; o.textContent = same(u, me) ? u + ' (me)' : u; sel.appendChild(o); });
    sel.value = same(m.sender, me) ? me : m.sender;
    who.appendChild(sel);
    dlg.body.appendChild(who);
    var due = field('Due (optional)', 'datetime-local', '');
    dlg.body.appendChild(due.wrap);
    dialogButtons(dlg, 'Create task', function () {
      var at = due.input.value ? new Date(due.input.value) : null;
      api('POST', API + '/todos', { conversation_sync_id: current.sync_id, message_sync_id: m.sync_id, title: title.input.value.trim(),
        assignee: sel.value, due_at: at ? at.toISOString() : undefined })
        .then(function () { dlg.close(); loadMessages(false); })
        .catch(function (e) { showErr(e.message); });
    });
  }

  function renderTodos(list) {
    var hd = el('div', 'jc-arch', '← My tasks');
    hd.addEventListener('click', function () { showTodos = false; renderList(); });
    list.appendChild(hd);
    api('GET', API + '/todos').then(function (d) {
      var ts = d.todos || [];
      if (!ts.length) list.appendChild(el('div', 'jc-empty', 'No tasks. Use ▾ on a message → Make task.'));
      ts.forEach(function (t) {
        var row = el('div', 'jc-todo' + (t.done_at ? ' jc-done' : ''));
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!t.done_at;
        cb.addEventListener('change', function () {
          api('POST', API + '/todos/' + t.id + '/done', { done: cb.checked }).then(function () { renderList(); }).catch(function (e) { showErr(e.message); });
        });
        var mid = el('div');
        mid.appendChild(el('div', null, t.title));
        var overdue = !t.done_at && t.due_at && new Date(t.due_at) < new Date();
        mid.appendChild(el('small', null, (same(t.assignee, me) ? 'For me' : 'For ' + t.assignee) + (t.due_at ? ' · due ' + fmtDay(t.due_at) + ' ' + fmtTime(t.due_at) + (overdue ? ' ⚠ overdue' : '') : '') + ' · ' + (t.conv_title || 'chat')));
        mid.style.cursor = 'pointer';
        mid.addEventListener('click', function () { var c = convById(t.conversation_sync_id); showTodos = false; if (c) openConv(c); });
        row.appendChild(cb); row.appendChild(mid);
        list.appendChild(row);
      });
    }).catch(function (e) { showErr(e.message); });
  }

  function loadPins(c) {
    if (!c || c.is_member === false && !isAdmin) return;
    api('GET', API + '/conversations/' + encodeURIComponent(c.sync_id) + '/pins').then(function (d) {
      if (current !== c) return;
      c.pins = d.pins || [];
      var old = els.main.querySelector('.jc-pinbar');
      if (old) old.remove();
      if (!c.pins.length) return;
      var i = 0;
      var bar = el('div', 'jc-pinbar');
      var txt = el('span');
      function show() { var p = c.pins[i]; txt.textContent = '📌 ' + (c.pins.length > 1 ? (i + 1) + '/' + c.pins.length + ' · ' : '') + (p.body || (p.attachment ? p.attachment.file_name : '')); }
      show();
      bar.appendChild(txt);
      bar.title = 'Pinned message — click to see it';
      bar.addEventListener('click', function () { flash(c.pins[i].sync_id); i = (i + 1) % c.pins.length; show(); });
      els.main.insertBefore(bar, els.msgs);
    }).catch(function () { });
  }

  function quietDialog() {
    var dlg = modal('🌙 Quiet hours');
    dlg.body.appendChild(el('small', null, 'No notifications in this time, except URGENT messages and @mentions. Leave empty to switch off.'));
    var from = field('From', 'time', ''), to = field('To', 'time', '');
    dlg.body.appendChild(from.wrap); dlg.body.appendChild(to.wrap);
    api('GET', API + '/settings').then(function (d) { from.input.value = d.quiet_from || ''; to.input.value = d.quiet_to || ''; }).catch(function () { });
    dialogButtons(dlg, 'Save', function () {
      api('PUT', API + '/settings', { quiet_from: from.input.value, quiet_to: to.input.value })
        .then(function (d) { dlg.close(); toastText(d.quiet_from ? '🌙 Quiet ' + d.quiet_from + '–' + d.quiet_to : 'Quiet hours off'); })
        .catch(function (e) { showErr(e.message); });
    });
  }

  // ---------------- phase B: JMS Bot, alerts, maintenance, approvals ----------------
  function alertEl(m) {
    var box = el('div');
    var a = m.alert || {};
    if (a.acked_by) box.appendChild(el('span', 'jc-acked', a.kind === 'handover'
      ? '✓ Read by ' + (same(a.acked_by, me) ? 'you' : a.acked_by)
      : '✋ ' + (same(a.acked_by, me) ? 'You are' : a.acked_by + ' is') + ' on it'));
    else {
      var isHand = a.kind === 'handover';
      var btn = el('button', 'jc-ack', isHand ? '✓ I read it' : '✋ I\'m on it');
      if (isHand) btn.style.background = '#00a884';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        btn.disabled = true;
        api('POST', API + '/messages/' + encodeURIComponent(m.sync_id) + '/ack', {})
          .then(function (d) { m.alert.acked_by = d.acked_by; m.alert.acked_at = d.acked_at; redraw(); })
          .catch(function (e2) { btn.disabled = false; showErr(e2.message); });
      });
      box.appendChild(btn);
      if (a.escalated) box.appendChild(el('span', 'jc-esc', '⏫ Escalated to ' + (a.escalated > 1 ? 'superadmins' : 'managers')));
    }
    return box;
  }

  function ticketDialog(m) {
    var dlg = modal('🔧 Raise maintenance ticket');
    var mach = field('Machine (e.g. M-07)', 'text', ((m.body || '').match(/\bM[- ]?\d+\b/i) || [''])[0]);
    var prob = field('Problem', 'text', (m.body || '').slice(0, 500));
    dlg.body.appendChild(mach.wrap); dlg.body.appendChild(prob.wrap);
    var pr = el('label', 'jc-row2'); pr.style.display = 'block';
    pr.appendChild(el('small', null, 'Priority'));
    var sel = document.createElement('select'); sel.className = 'jc-field'; sel.style.width = '100%';
    [['breakdown', '🛑 Breakdown (machine stopped)'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
    });
    sel.value = 'high';
    pr.appendChild(sel);
    dlg.body.appendChild(pr);
    dialogButtons(dlg, 'Raise ticket', function () {
      api('POST', API + '/maintenance', { conversation_sync_id: current.sync_id, message_sync_id: m.sync_id,
        machine: mach.input.value.trim(), problem: prob.input.value.trim(), priority: sel.value })
        .then(function (d) { dlg.close(); toastText('🔧 Ticket ' + d.ticket.ticket_no + ' raised'); loadMessages(false); })
        .catch(function (e) { showErr(e.message); });
    });
  }

  function renderApprovals(list) {
    var hd = el('div', 'jc-arch', '← Approvals waiting for me');
    hd.addEventListener('click', function () { showApprovals = false; renderList(); });
    list.appendChild(hd);
    list.appendChild(el('div', 'jc-empty', 'Loading…'));
    api('GET', API + '/approvals').then(function (d) {
      list.removeChild(list.lastChild);
      if (!d.allowed) { list.appendChild(el('div', 'jc-empty', 'Approvals from chat need full JMS access (global login). Use the Planning page.')); return; }
      var items = (d.items || []).filter(function (x) { return x.can_approve !== false; });
      if (!items.length) { list.appendChild(el('div', 'jc-empty', 'Nothing waiting for you. ✅')); return; }
      items.forEach(function (p) {
        var row = el('div', 'jc-appr');
        row.appendChild(el('b', null, (p.job_card_no ? 'JC ' + p.job_card_no + ' · ' : '') + (p.plan_id || '')));
        row.appendChild(el('small', null, [p.item_name || p.product_name, p.machine && 'Machine ' + p.machine, p.order_no && 'Order ' + p.order_no,
          p.approval_stage_label || p.jc_approval_status].filter(Boolean).join(' · ')));
        var act = el('div', 'jc-act');
        var rej = el('button', 'jc-plain', 'Reject');
        var ok = el('button', 'jc-primary', 'Approve');
        function doIt(action) {
          var remarks = '';
          if (action === 'REJECTED') { remarks = window.prompt('Reason for rejecting (required):') || ''; if (!remarks.trim()) return; }
          ok.disabled = rej.disabled = true;
          api('POST', API + '/approvals/' + encodeURIComponent(p.id) + '/action', { action: action, remarks: remarks })
            .then(function () { row.remove(); toastText(action === 'APPROVED' ? '✅ Approved' : '❌ Rejected'); })
            .catch(function (e) { ok.disabled = rej.disabled = false; showErr(e.message); });
        }
        rej.addEventListener('click', function () { doIt('REJECTED'); });
        ok.addEventListener('click', function () { doIt('APPROVED'); });
        act.appendChild(rej); act.appendChild(ok);
        row.appendChild(act);
        list.appendChild(row);
      });
    }).catch(function (e) { showErr(e.message); });
  }

  // ---------------- phase C: handover, check-in, translate, voice-to-text ----------------
  function handoverDialog() {
    var dlg = modal('🔁 Shift handover note');
    var f1 = field('▶ Running jobs'), f2 = field('⚠ Problems'), f3 = field('🧪 Pending QC'), f4 = field('📝 Notes');
    [f1, f2, f3, f4].forEach(function (f) { dlg.body.appendChild(f.wrap); });
    dlg.body.appendChild(el('small', null, 'The next shift taps "✓ I read it".'));
    dialogButtons(dlg, 'Post handover', function () {
      api('POST', API + '/handover', { conversation_sync_id: current.sync_id, running: f1.input.value, problems: f2.input.value,
        pending_qc: f3.input.value, notes: f4.input.value })
        .then(function (d) { dlg.close(); loaded.push(d.message); redraw(); loadConvs(); })
        .catch(function (e) { showErr(e.message); });
    });
  }

  function checkIn() {
    if (!navigator.geolocation) { showErr('This browser cannot share location.'); return; }
    var conv = current;
    navigator.geolocation.getCurrentPosition(function (p) {
      api('POST', API + '/checkin', { conversation_sync_id: conv.sync_id, lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy })
        .then(function (d) { if (current === conv) { loaded.push(d.message); redraw(); } loadConvs(); })
        .catch(function (e) { showErr(e.message); });
    }, function () { showErr('Location was not allowed.'); }, { enableHighAccuracy: true, timeout: 15000 });
  }

  function translate(m, to) {
    var label = { en: 'English', hi: 'हिंदी', gu: 'ગુજરાતી' }[to];
    m._tr = { text: 'Translating…', label: label };
    redraw();
    api('POST', API + '/messages/' + encodeURIComponent(m.sync_id) + '/translate', { to: to })
      .then(function (d) { m._tr = { text: d.text, label: label }; redraw(); })
      .catch(function (e) { m._tr = null; redraw(); showErr(e.message); });
  }

  function transcribe(m, btn) {
    btn.textContent = '📝 Writing it down…';
    btn.disabled = true;
    api('POST', API + '/messages/' + encodeURIComponent(m.sync_id) + '/transcribe', {})
      .then(function (d) { m._transcript = d.text; redraw(); })
      .catch(function (e) { btn.textContent = '📝 Show as text'; btn.disabled = false; showErr(e.message); });
  }

  function start() {
    api('GET', API + '/me').then(function (d) {
      me = d.username;
      isAdmin = d.isSuperadmin;
      serverInfo = { server_type: d.server_type || 'MAIN', factory_id: d.factory_id == null ? null : d.factory_id };
      build();
      if (!appMode) setupContextShare();
      if (isAdmin) els.tabs.style.display = 'flex';
      loadFolders();
      updateBadge();
      connect();
      setupServiceWorker();
      // ?chat=<id>: opened from the bell, the notifications page or a push notification.
      var want = /[?&]chat=([0-9a-f-]{36})/i.exec(location.search);
      if (want) openChatById(want[1]);
      // Opened from a shared link card: find the marked spot, and keep the chat open.
      var target = /[?&#]jmsChatTarget=([0-9a-f-]{36})/i.exec(location.search + location.hash);
      if (target) landOnTarget(target[1]);
      var reopen = null;
      try { reopen = sessionStorage.getItem('jmsChatReopen'); sessionStorage.removeItem('jmsChatReopen'); } catch (_e) { }
      if (reopen && !want) openChatById(reopen);
      if (appMode) toggle(true);
      if (window.JMSChatApp && window.JMSChatApp.onReady) window.JMSChatApp.onReady(me);
    }).catch(function () {
      /* no session: no chat button */
      if (window.JMSChatApp && window.JMSChatApp.onNoSession) window.JMSChatApp.onNoSession();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
