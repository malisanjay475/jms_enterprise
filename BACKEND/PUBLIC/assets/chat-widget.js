// JMS Chat widget: floating chat button (bottom-right) with an unread badge that opens
// a WhatsApp-style panel. Loaded on every page by app.js. Needs a login session; with
// none, it stays hidden. Message text is always set with textContent (never HTML).
// Phase 2: groups, attachments, delivered/read ticks, typing, search, edit and delete.
// Phase 4: desktop notifications (page + Web Push via /sw.js -> /sw-chat.js), mute,
// sound on/off, @mentions, open a chat from ?chat=<id> (bell, notifications page, push).
// Phase 5: "messages may be reviewed" notice on first open; messages emptied by the
// retention job show as removed.
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
  var soundOn = readPref('jmsChatSound', '1') === '1';
  var swReg = null; // service worker registration, when the page may use one

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
    '.jc-root{--jc-g:#00a884;--jc-gd:#008069;--jc-bg:#fff;--jc-bg2:#f0f2f5;--jc-chat:#efeae2;--jc-out:#d9fdd3;--jc-in:#fff;--jc-tx:#111b21;--jc-mu:#667781;--jc-bd:#e9edef;font-family:inherit;font-size:14px;color:var(--jc-tx)}',
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
    '.jc-err{background:#fde8e8;color:#b42318;font-size:12px;padding:6px 10px;display:none}',
    '.jc-back{display:none}',
    '.jc-toast{position:fixed;right:20px;bottom:86px;z-index:9992;max-width:300px;background:#fff;border-left:4px solid var(--jc-g);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:10px 12px;cursor:pointer}',
    '.jc-toast b{display:block;margin-bottom:2px}',
    '.jc-toast span{color:var(--jc-mu);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // The AI assistant button sits at right/bottom 30px: stack above it, open the panel beside it.
    '.jc-root.jc-stack .jc-fab{right:34px;bottom:108px}',
    '.jc-root.jc-stack .jc-toast{right:108px;bottom:30px}',
    '.jc-root.jc-stack .jc-panel{right:108px;bottom:20px;max-width:calc(100vw - 128px);max-height:calc(100vh - 40px)}',
    '@media (max-width:640px){.jc-panel{z-index:100001;right:0;bottom:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}.jc-side{width:100%;border:0}.jc-main{display:none}.jc-panel.jc-conv .jc-side{display:none}.jc-panel.jc-conv .jc-main{display:flex}.jc-back{display:inline-block}.jc-fab{right:16px;bottom:16px}.jc-panel.jc-open~.jc-fab{display:none}.jc-root.jc-stack .jc-panel{right:0;bottom:0;max-width:100vw;max-height:100vh}.jc-opt{display:block}}'
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
    sh.appendChild(bellBtn); sh.appendChild(groupBtn); sh.appendChild(newBtn); sh.appendChild(closeBtn);
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
    mh.appendChild(back); mh.appendChild(mAv); mh.appendChild(mTitle); mh.appendChild(mMute); mh.appendChild(mInfo); mh.appendChild(mClose);
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
    fileIn.accept = 'image/jpeg,image/png,image/gif,image/webp,application/pdf,.pdf,.xlsx,audio/*';
    fileIn.style.display = 'none';
    var ta = el('textarea');
    ta.rows = 1;
    ta.placeholder = 'Type a message';
    ta.maxLength = 4000;
    var send = el('button', 'jc-send');
    send.innerHTML = ICON_SEND;
    send.title = 'Send';
    comp.appendChild(attach); comp.appendChild(fileIn); comp.appendChild(ta); comp.appendChild(send);
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

    root.appendChild(panel); root.appendChild(fab);
    document.body.appendChild(root);
    var stack = function () { root.classList.toggle('jc-stack', !!document.querySelector('.ai-chat-widget')); };
    stack();
    setTimeout(stack, 2000);
    setTimeout(stack, 6000);

    els = { panel: panel, list: list, sIn: sIn, tabs: tabs, tMine: tMine, tAll: tAll, err: err,
      main: main, mh: mh, mAv: mAv, mName: mName, mSub: mSub, mTitle: mTitle, mInfo: mInfo, msgs: msgs, ro: ro,
      comp: comp, ta: ta, send: send, ph: ph, badge: badge, newBtn: newBtn, fileIn: fileIn,
      editBar: editBar, editTxt: editTxt, ment: ment, mMute: mMute, side: side };

    fab.addEventListener('click', function () { toggle(!open); });
    closeBtn.addEventListener('click', function () { toggle(false); });
    mClose.addEventListener('click', function () { toggle(false); });
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
    var shown = convs.filter(function (c) {
      return !q || c.title.toLowerCase().indexOf(q) !== -1 || (c.members || []).join(' ').toLowerCase().indexOf(q) !== -1;
    });
    shown.forEach(function (c) {
      var it = el('div', 'jc-item' + (current && current.sync_id === c.sync_id ? ' jc-sel' : ''));
      var av = el('div', 'jc-av' + (c.online ? ' jc-on' : ''), isGroup(c) ? '👥' : initials(c.title));
      av.style.background = avatarColor(c.title);
      var mid = el('div', 'jc-mid');
      var r1 = el('div', 'jc-row');
      var nm = el('div', 'jc-name', c.title);
      if (isMuted(c)) { var mi = el('span', 'jc-mute', '🔕'); mi.title = muteLabel(c); nm.appendChild(mi); }
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
    els.mInfo.style.display = isGroup(c) && !readOnly ? '' : 'none';
    els.mTitle.classList.toggle('jc-mh-click', isGroup(c) && !readOnly);
    var typing = typingText(c.sync_id);
    if (typing) { els.mSub.textContent = typing; els.mSub.className = 'jc-prev jc-typing'; return; }
    els.mSub.className = 'jc-prev';
    if (readOnly || isGroup(c)) els.mSub.textContent = (c.members || []).join(', ');
    else els.mSub.textContent = c.online ? 'online' : '';
    if (isMuted(c)) els.mSub.textContent = '🔕 ' + muteLabel(c) + (els.mSub.textContent ? ' · ' + els.mSub.textContent : '');
    els.mMute.style.display = readOnly ? 'none' : '';
    els.mMute.textContent = isMuted(c) ? '🔕' : '🔔';
    els.mMute.title = isMuted(c) ? muteLabel(c) + ' (click to change)' : 'Mute notifications';
    els.mAv.textContent = isGroup(c) ? '👥' : initials(c.title);
    els.mAv.style.background = avatarColor(c.title);
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
    else { els.main.appendChild(els.editBar); els.main.appendChild(els.comp); }
    els.editBar.style.display = 'none';
    els.panel.classList.add('jc-conv');
    convHeader();
    els.msgs.textContent = '';
    loaded = [];
    if (!els.sIn.value.trim()) renderList();
    loadMessages(false, focusId);
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
      img.addEventListener('click', function () { window.open(fileUrl(a), '_blank', 'noopener'); });
      return img;
    }
    if (a.kind === 'audio') {
      var wrap = el('div');
      var au = el('audio', 'jc-audio');
      au.controls = true;
      au.preload = 'none';
      au.src = fileUrl(a);
      wrap.appendChild(au);
      return wrap;
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
    return link;
  }

  var openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }

  function messageMenu(m, bub) {
    closeMenu();
    var menu = el('div', 'jc-menu');
    var canEdit = (m.kind === 'text' || m.attachment) && Date.now() - new Date(m.server_ts).getTime() < EDIT_MS;
    if (canEdit) {
      var eb = el('button', null, m.kind === 'text' ? 'Edit' : 'Edit caption');
      eb.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); startEdit(m); });
      menu.appendChild(eb);
    }
    if (m.kind === 'text' && navigator.clipboard) {
      var cp = el('button', null, 'Copy');
      cp.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); navigator.clipboard.writeText(m.body).catch(function () { }); });
      menu.appendChild(cp);
    }
    var db = el('button', null, 'Delete for everyone');
    db.style.color = '#d93025';
    db.addEventListener('click', function (e) {
      e.stopPropagation();
      closeMenu();
      if (!window.confirm('Delete this message for everyone?')) return;
      api('DELETE', API + '/messages/' + encodeURIComponent(m.sync_id)).then(function (d) {
        applyUpdate(d.message);
        loadConvs();
      }).catch(function (e2) { showErr(e2.message); });
    });
    menu.appendChild(db);
    bub.appendChild(menu);
    openMenu = menu;
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
        var sys = el('div', 'jc-sys');
        sys.appendChild(el('span', null, m.body));
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
        if (m.attachment) b.appendChild(attachmentEl(m));
        else if (m.localFile) b.appendChild(el('div', 'jc-prev', '📎 ' + m.localFile.name + ' · ' + fmtSize(m.localFile.size)));
        if (m.body) appendBody(b, m.body);
      }
      var meta = el('span', 'jc-meta', (m.edited_at && !m.deleted ? 'edited ' : '') + (m.pending ? '' : fmtTime(m.server_ts)));
      if (mine && !adminView && !m.deleted && !m.purged) {
        var tk = tickFor(m);
        var tick = el('span', 'jc-tick' + tk.cls, tk.t);
        if (tk.title) tick.title = tk.title;
        meta.appendChild(tick);
      }
      b.appendChild(meta);
      if (mine && !adminView && !m.deleted && !m.purged && !m.pending && !m.failed) {
        var opt = el('button', 'jc-opt', '▾');
        opt.title = 'Message options';
        opt.addEventListener('click', function (e) { e.stopPropagation(); messageMenu(m, b); });
        b.appendChild(opt);
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
    var m = { sync_id: uuid(), conversation_sync_id: current.sync_id, sender: me, body: text, kind: 'text',
      server_ts: new Date().toISOString(), pending: true };
    loaded.push(m);
    els.ta.value = '';
    els.ta.style.height = 'auto';
    redraw();
    els.msgs.scrollTop = els.msgs.scrollHeight;
    postMessage(m);
  }

  function postMessage(m) {
    api('POST', API + '/messages', { sync_id: m.sync_id, conversation_sync_id: m.conversation_sync_id,
      body: m.body, client_ts: m.server_ts }).then(function (d) {
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
      server_ts: new Date().toISOString(), pending: true, localFile: f };
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
    var admin = c.my_role === 'admin';

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
      var label = { image: '📷 Photo', pdf: '📄 PDF', xlsx: '📊 Excel file', audio: '🎤 Audio' }[m.attachment.kind] || '📎 File';
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
      var alert = !mine && !ev.adminCopy && m.kind !== 'system' && !m.deleted &&
        (!isMuted(convById(m.conversation_sync_id)) || mentionsMe(m.body));
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

  function start() {
    api('GET', API + '/me').then(function (d) {
      me = d.username;
      isAdmin = d.isSuperadmin;
      build();
      if (isAdmin) els.tabs.style.display = 'flex';
      updateBadge();
      connect();
      setupServiceWorker();
      // ?chat=<id>: opened from the bell, the notifications page or a push notification.
      var want = /[?&]chat=([0-9a-f-]{36})/i.exec(location.search);
      if (want) openChatById(want[1]);
    }).catch(function () { /* no session: no chat button */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
