// JMS Chat widget: floating chat button (bottom-right) with an unread badge that opens
// a WhatsApp-style panel. Loaded on every page by app.js. Needs a login session; with
// none, it stays hidden. Message text is always set with textContent (never HTML).
(function () {
  'use strict';
  if (window.__jmsChatLoaded) return;
  window.__jmsChatLoaded = true;
  var path = (window.location.pathname || '').toLowerCase();
  if (/login\.html$/.test(path) || path.indexOf('/vendor/') !== -1) return;

  var API = '/api/chat';
  var me = null, isAdmin = false;
  var convs = [], current = null, users = [];
  var adminAll = false, open = false, es = null, retry = 0;
  var oldestTs = null, hasMore = false, othersReadAt = null;
  var root, els = {};

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
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

  // ---------------- styles ----------------
  var CSS = [
    '.jc-root{--jc-g:#00a884;--jc-gd:#008069;--jc-bg:#fff;--jc-bg2:#f0f2f5;--jc-chat:#efeae2;--jc-out:#d9fdd3;--jc-in:#fff;--jc-tx:#111b21;--jc-mu:#667781;--jc-bd:#e9edef;font-family:inherit;font-size:14px;color:var(--jc-tx)}',
    '.jc-fab{position:fixed;right:20px;bottom:20px;z-index:9990;width:56px;height:56px;border-radius:50%;border:0;background:var(--jc-g);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.jc-fab:hover{background:var(--jc-gd)}',
    '.jc-fab svg{width:28px;height:28px;fill:#fff}',
    '.jc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#e53935;color:#fff;font-size:11px;font-weight:700;line-height:20px;text-align:center;display:none}',
    '.jc-panel{position:fixed;right:20px;bottom:86px;z-index:9991;width:760px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 110px);background:var(--jc-bg);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:none;overflow:hidden}',
    '.jc-panel.jc-open{display:flex}',
    '.jc-side{width:300px;border-right:1px solid var(--jc-bd);display:flex;flex-direction:column;min-width:0}',
    '.jc-head{height:56px;flex:none;background:var(--jc-bg2);display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--jc-bd)}',
    '.jc-head h3{margin:0;font-size:16px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.jc-ibtn{border:0;background:none;cursor:pointer;color:var(--jc-mu);padding:6px;border-radius:50%;font-size:18px;line-height:1}',
    '.jc-ibtn:hover{background:rgba(0,0,0,.06)}',
    '.jc-search{padding:8px 10px;border-bottom:1px solid var(--jc-bd)}',
    '.jc-search input{width:100%;box-sizing:border-box;border:0;border-radius:8px;background:var(--jc-bg2);padding:8px 12px;font:inherit;outline:none}',
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
    '.jc-unr{flex:none;min-width:18px;height:18px;border-radius:9px;background:#25d366;color:#fff;font-size:11px;font-weight:700;text-align:center;line-height:18px;padding:0 5px}',
    '.jc-empty{padding:30px 16px;text-align:center;color:var(--jc-mu);font-size:13px}',
    '.jc-main{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--jc-chat)}',
    '.jc-msgs{flex:1;overflow-y:auto;padding:12px 6%}',
    '.jc-day{text-align:center;margin:10px 0}',
    '.jc-day span{background:#fff;border-radius:7px;padding:4px 10px;font-size:12px;color:var(--jc-mu);box-shadow:0 1px .5px rgba(0,0,0,.13)}',
    '.jc-msg{display:flex;margin:2px 0}',
    '.jc-msg.jc-out{justify-content:flex-end}',
    '.jc-bub{max-width:70%;padding:6px 8px 4px;border-radius:8px;background:var(--jc-in);box-shadow:0 1px .5px rgba(0,0,0,.13);white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
    '.jc-out .jc-bub{background:var(--jc-out)}',
    '.jc-snd{font-size:12px;font-weight:600;color:var(--jc-gd);margin-bottom:2px}',
    '.jc-meta{float:right;margin:6px 0 -2px 10px;font-size:11px;color:var(--jc-mu);white-space:nowrap}',
    '.jc-tick{margin-left:3px;font-size:12px;letter-spacing:-3px}',
    '.jc-tick.jc-read{color:#53bdeb}',
    '.jc-pend{opacity:.6}',
    '.jc-del{font-style:italic;color:var(--jc-mu)}',
    '.jc-more{display:block;margin:4px auto 10px;border:0;border-radius:14px;padding:4px 12px;background:#fff;cursor:pointer;font:inherit;font-size:12px}',
    '.jc-comp{flex:none;display:flex;align-items:flex-end;gap:8px;padding:8px 10px;background:var(--jc-bg2)}',
    '.jc-comp textarea{flex:1;resize:none;border:0;border-radius:8px;padding:9px 12px;font:inherit;max-height:120px;min-height:20px;outline:none;line-height:20px}',
    '.jc-send{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:var(--jc-g);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.jc-send:disabled{opacity:.5;cursor:default}',
    '.jc-send svg{width:20px;height:20px;fill:#fff}',
    '.jc-ro{flex:none;padding:10px;text-align:center;font-size:12px;color:#8a6d00;background:#fff8d6}',
    '.jc-ph{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--jc-mu);text-align:center;padding:20px;background:var(--jc-bg2)}',
    '.jc-ph b{font-size:18px;color:var(--jc-tx);margin:8px 0}',
    '.jc-err{background:#fde8e8;color:#b42318;font-size:12px;padding:6px 10px;display:none}',
    '.jc-back{display:none}',
    '.jc-toast{position:fixed;right:20px;bottom:86px;z-index:9992;max-width:300px;background:#fff;border-left:4px solid var(--jc-g);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:10px 12px;cursor:pointer}',
    '.jc-toast b{display:block;margin-bottom:2px}',
    '.jc-toast span{color:var(--jc-mu);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // The AI assistant button sits at right/bottom 30px: stack above it, open the panel beside it.
    '.jc-root.jc-stack .jc-fab{right:34px;bottom:108px}',
    '.jc-root.jc-stack .jc-toast{right:108px;bottom:30px}',
    '.jc-root.jc-stack .jc-panel{right:108px;bottom:20px;max-width:calc(100vw - 128px);max-height:calc(100vh - 40px)}',
    '@media (max-width:640px){.jc-panel{z-index:100001;right:0;bottom:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}.jc-side{width:100%;border:0}.jc-main{display:none}.jc-panel.jc-conv .jc-side{display:none}.jc-panel.jc-conv .jc-main{display:flex}.jc-back{display:inline-block}.jc-fab{right:16px;bottom:16px}.jc-panel.jc-open~.jc-fab{display:none}.jc-root.jc-stack .jc-panel{right:0;bottom:0;max-width:100vw;max-height:100vh}}'
  ].join('\n');

  var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.03 2 11c0 2.4 1.05 4.58 2.75 6.19L4 22l4.6-2.1c1.05.3 2.19.46 3.4.46 5.52 0 10-4.03 10-9S17.52 2 12 2z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';

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
    var newBtn = el('button', 'jc-ibtn', '✎');
    newBtn.title = 'New chat';
    var closeBtn = el('button', 'jc-ibtn', '✕');
    closeBtn.title = 'Close';
    sh.appendChild(newBtn); sh.appendChild(closeBtn);
    var search = el('div', 'jc-search');
    var sIn = el('input');
    sIn.placeholder = 'Search or start a new chat';
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
    var mClose = el('button', 'jc-ibtn', '✕');
    mClose.title = 'Close';
    mh.appendChild(back); mh.appendChild(mAv); mh.appendChild(mTitle); mh.appendChild(mClose);
    var msgs = el('div', 'jc-msgs');
    var ro = el('div', 'jc-ro', 'Superadmin view: read-only. Your viewing is logged.');
    var comp = el('div', 'jc-comp');
    var ta = el('textarea');
    ta.rows = 1;
    ta.placeholder = 'Type a message';
    ta.maxLength = 4000;
    var send = el('button', 'jc-send');
    send.innerHTML = ICON_SEND;
    send.title = 'Send';
    comp.appendChild(ta); comp.appendChild(send);
    var ph = el('div', 'jc-ph');
    ph.appendChild(el('div', null, '💬'));
    ph.appendChild(el('b', null, 'JMS Chat'));
    ph.appendChild(el('div', null, 'Pick a chat on the left, or press ✎ to message anyone.'));
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
      main: main, mh: mh, mAv: mAv, mName: mName, mSub: mSub, msgs: msgs, ro: ro, comp: comp,
      ta: ta, send: send, ph: ph, badge: badge, newBtn: newBtn };

    fab.addEventListener('click', function () { toggle(!open); });
    closeBtn.addEventListener('click', function () { toggle(false); });
    mClose.addEventListener('click', function () { toggle(false); });
    back.addEventListener('click', function () { current = null; panel.classList.remove('jc-conv'); renderList(); });
    newBtn.addEventListener('click', function () { sIn.value = ''; sIn.focus(); showPeople(''); });
    sIn.addEventListener('input', function () { sIn.value.trim() || !els.peopleMode ? renderList() : showPeople(sIn.value); });
    tMine.addEventListener('click', function () { setAdminAll(false); });
    tAll.addEventListener('click', function () { setAdminAll(true); });
    send.addEventListener('click', sendMessage);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    ta.addEventListener('input', function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) toggle(false); });
  }

  function showErr(msg) {
    els.err.textContent = msg || '';
    els.err.style.display = msg ? 'block' : 'none';
  }

  function toggle(v) {
    open = v;
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
      renderList();
      updateBadge();
    }).catch(function (e) { showErr(e.message); });
  }

  function renderList() {
    els.peopleMode = false;
    var q = els.sIn.value.trim().toLowerCase();
    var list = els.list;
    list.textContent = '';
    var shown = convs.filter(function (c) {
      return !q || c.title.toLowerCase().indexOf(q) !== -1 || (c.members || []).join(' ').toLowerCase().indexOf(q) !== -1;
    });
    shown.forEach(function (c) {
      var it = el('div', 'jc-item' + (current && current.sync_id === c.sync_id ? ' jc-sel' : ''));
      var av = el('div', 'jc-av' + (c.online ? ' jc-on' : ''), initials(c.title));
      av.style.background = avatarColor(c.title);
      var mid = el('div', 'jc-mid');
      var r1 = el('div', 'jc-row');
      r1.appendChild(el('div', 'jc-name', c.title));
      r1.appendChild(el('div', 'jc-time', fmtListTime(c.last_message_at)));
      var r2 = el('div', 'jc-row');
      var prefix = adminAll ? (c.last_sender ? c.last_sender + ': ' : '') : (same(c.last_sender, me) ? 'You: ' : '');
      r2.appendChild(el('div', 'jc-prev', prefix + (c.last_body || '')));
      if (c.unread && c.is_member) r2.appendChild(el('div', 'jc-unr', String(c.unread)));
      mid.appendChild(r1); mid.appendChild(r2);
      it.appendChild(av); it.appendChild(mid);
      it.addEventListener('click', function () { openConv(c); });
      list.appendChild(it);
    });
    if (q && !adminAll) {
      // Also offer people matching the search who have no chat yet.
      appendPeople(q, shown);
    } else if (!shown.length) {
      list.appendChild(el('div', 'jc-empty', adminAll ? 'No chats yet.' : 'No chats yet. Press ✎ to message someone.'));
    }
  }

  function loadUsers() {
    if (users.length) return Promise.resolve(users);
    return api('GET', API + '/users').then(function (d) { users = d.users || []; return users; });
  }

  function appendPeople(q, shownConvs) {
    loadUsers().then(function () {
      if (els.sIn.value.trim().toLowerCase() !== q) return;
      var have = {};
      shownConvs.forEach(function (c) { (c.members || []).forEach(function (m) { have[m.toLowerCase()] = true; }); });
      var ppl = users.filter(function (u) { return u.username.toLowerCase().indexOf(q) !== -1 && !have[u.username.toLowerCase()]; });
      if (!ppl.length && !shownConvs.length) { els.list.appendChild(el('div', 'jc-empty', 'Nobody found.')); return; }
      if (ppl.length) els.list.appendChild(el('div', 'jc-empty', 'Other people'));
      ppl.slice(0, 50).forEach(function (u) { els.list.appendChild(personRow(u)); });
    }).catch(function (e) { showErr(e.message); });
  }

  function personRow(u) {
    var it = el('div', 'jc-item');
    var av = el('div', 'jc-av' + (u.online ? ' jc-on' : ''), initials(u.username));
    av.style.background = avatarColor(u.username);
    var mid = el('div', 'jc-mid');
    mid.appendChild(el('div', 'jc-name', u.username));
    mid.appendChild(el('div', 'jc-prev', [u.role, u.line].filter(Boolean).join(' · ')));
    it.appendChild(av); it.appendChild(mid);
    it.addEventListener('click', function () { startChat(u.username); });
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

  function startChat(username) {
    api('POST', API + '/conversations', { username: username }).then(function (d) {
      els.sIn.value = '';
      var c = d.conversation;
      var existing = convs.filter(function (x) { return x.sync_id === c.sync_id; })[0];
      openConv(existing || { sync_id: c.sync_id, title: c.title, members: c.members, online: c.online, is_member: true });
      renderList();
    }).catch(function (e) { showErr(e.message); });
  }

  // ---------------- conversation ----------------
  function showPlaceholder() {
    els.main.textContent = '';
    els.main.appendChild(els.ph);
    els.panel.classList.remove('jc-conv');
  }

  function openConv(c) {
    current = c;
    oldestTs = null; hasMore = false; othersReadAt = null;
    els.main.textContent = '';
    els.main.appendChild(els.mh);
    els.main.appendChild(els.msgs);
    var readOnly = c.is_member === false;
    els.main.appendChild(readOnly ? els.ro : els.comp);
    els.panel.classList.add('jc-conv');
    els.mName.textContent = c.title;
    els.mSub.textContent = readOnly ? (c.members || []).join(', ') : (c.online ? 'online' : '');
    els.mAv.textContent = initials(c.title);
    els.mAv.style.background = avatarColor(c.title);
    els.msgs.textContent = '';
    renderList();
    loadMessages(false);
    if (!readOnly) { els.ta.focus(); markRead(c.sync_id); }
  }

  function loadMessages(older) {
    var c = current;
    if (!c) return;
    var url = API + '/conversations/' + encodeURIComponent(c.sync_id) + '/messages' +
      (older && oldestTs ? '?before=' + encodeURIComponent(oldestTs) : '');
    api('GET', url).then(function (d) {
      if (current !== c) return;
      hasMore = d.has_more;
      var ra = (d.others_read_at || []).map(function (o) { return o.last_read_at; }).filter(Boolean);
      othersReadAt = ra.length ? ra.sort()[0] : null;
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
    }).catch(function (e) { showErr(e.message); });
  }

  var loaded = []; // messages in the open chat, oldest first
  function renderMessages(ms, prepend) {
    loaded = prepend ? ms.concat(loaded) : ms.slice();
    redraw();
  }

  function redraw() {
    var box = els.msgs;
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.textContent = '';
    if (hasMore) {
      var more = el('button', 'jc-more', 'Load older messages');
      more.addEventListener('click', function () { loadMessages(true); });
      box.appendChild(more);
    }
    var lastDay = '', group = current && current.members && current.members.length > 2;
    var adminView = current && current.is_member === false;
    loaded.forEach(function (m) {
      var day = new Date(m.server_ts).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        var dd = el('div', 'jc-day');
        dd.appendChild(el('span', null, fmtDay(m.server_ts)));
        box.appendChild(dd);
      }
      var mine = same(m.sender, me);
      var row = el('div', 'jc-msg' + (mine ? ' jc-out' : '') + (m.pending ? ' jc-pend' : ''));
      var b = el('div', 'jc-bub');
      if (!mine && (group || adminView)) b.appendChild(el('div', 'jc-snd', m.sender));
      if (m.deleted) b.appendChild(el('span', 'jc-del', 'This message was deleted'));
      else b.appendChild(document.createTextNode(m.body));
      var meta = el('span', 'jc-meta', m.pending ? '' : fmtTime(m.server_ts));
      if (mine && !adminView) {
        var read = !m.pending && othersReadAt && new Date(othersReadAt) >= new Date(m.server_ts);
        var tick = el('span', 'jc-tick' + (read ? ' jc-read' : ''), m.pending ? '🕓' : (m.failed ? '!' : (read ? '✓✓' : '✓')));
        if (m.failed) tick.title = 'Not sent. Tap to retry.';
        meta.appendChild(tick);
      }
      b.appendChild(meta);
      if (m.failed) {
        b.style.cursor = 'pointer';
        b.addEventListener('click', function () { m.failed = false; m.pending = true; redraw(); postMessage(m); });
      }
      row.appendChild(b);
      box.appendChild(row);
    });
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function sendMessage() {
    var text = els.ta.value.trim();
    if (!text || !current || current.is_member === false) return;
    var m = { sync_id: uuid(), conversation_sync_id: current.sync_id, sender: me, body: text,
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

  function markRead(convId) {
    var c = convs.filter(function (x) { return x.sync_id === convId; })[0];
    if (c && c.is_member === false) return;
    api('POST', API + '/read', { conversation_sync_id: convId }).then(function () {
      if (c) c.unread = 0;
      updateBadge();
      renderListIfIdle();
    }).catch(function () { });
  }

  function renderListIfIdle() { if (!els.peopleMode && !els.sIn.value.trim()) renderList(); }

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
  function toast(m) {
    if (toastEl) toastEl.remove();
    toastEl = el('div', 'jc-toast');
    toastEl.appendChild(el('b', null, m.sender));
    toastEl.appendChild(el('span', null, m.body));
    toastEl.addEventListener('click', function () {
      toastEl.remove(); toastEl = null;
      toggle(true);
      loadConvs().then(function () {
        var c = convs.filter(function (x) { return x.sync_id === m.conversation_sync_id; })[0];
        if (c) openConv(c);
      });
    });
    root.appendChild(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) { toastEl.remove(); toastEl = null; } }, 5000);
    beep();
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

  function onEvent(ev) {
    if (ev.type === 'message') {
      var m = ev.message;
      var mine = same(m.sender, me);
      if (current && current.sync_id === m.conversation_sync_id) {
        var exists = loaded.some(function (x) { return x.sync_id === m.sync_id; });
        if (!exists) { loaded.push(m); redraw(); }
        if (open && !document.hidden && !ev.adminCopy) markRead(m.conversation_sync_id);
      } else if (!mine && !ev.adminCopy) {
        toast(m);
      }
      if (open) loadConvs(); else updateBadge();
    } else if (ev.type === 'read') {
      if (current && current.sync_id === ev.conversation_sync_id && !same(ev.username, me)) {
        othersReadAt = ev.last_read_at;
        redraw();
      }
    }
  }

  function connect() {
    if (typeof EventSource === 'undefined') return;
    if (es) es.close();
    es = new EventSource(API + '/stream');
    es.onmessage = function (e) {
      retry = 0;
      try { onEvent(JSON.parse(e.data)); } catch (_e) { }
    };
    es.onerror = function () {
      if (es.readyState === EventSource.CLOSED) {
        es = null;
        retry = Math.min(retry + 1, 6);
        setTimeout(connect, 2000 * retry);
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
    }).catch(function () { /* no session: no chat button */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
