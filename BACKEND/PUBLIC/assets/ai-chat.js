(function () {
  // --- Modern Styles (Glassmorphism + Animations) ---
  const style = document.createElement('style');
  style.innerHTML = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap');

    .ai-chat-widget {
      position: fixed; bottom: 30px; right: 30px;
      z-index: 100000; font-family: 'Outfit', sans-serif;
    }

    /* Floating Button */
    .ai-chat-btn {
      width: 64px; height: 64px;
      background: linear-gradient(135deg, #6366f1, #d946ef);
      border-radius: 50%;
      box-shadow: 0 10px 40px rgba(99, 102, 241, 0.4), 0 0 0 4px rgba(255, 255, 255, 0.1);
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 28px; cursor: pointer;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      position: relative;
    }
    .ai-chat-btn:hover { transform: scale(1.1) rotate(5deg); box-shadow: 0 15px 50px rgba(99, 102, 241, 0.5); }
    .ai-chat-btn::after {
      content: ''; position: absolute; inset: 0;
      border-radius: 50%; border: 2px solid white; opacity: 0.3;
      animation: pulse-border 2s infinite;
    }

    /* Chat Window */
    .ai-chat-window {
      position: absolute; bottom: 90px; right: 0;
      width: 400px; height: 600px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 24px;
      box-shadow: 0 25px 80px rgba(0,0,0,0.15), 0 10px 30px rgba(0,0,0,0.05);
      display: flex; flex-direction: column;
      transform-origin: bottom right;
      transform: scale(0.5) translateY(20px); opacity: 0; pointer-events: none;
      transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      overflow: hidden;
    }
    .ai-chat-window.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }

    /* Header */
    .ai-chat-header {
      padding: 20px; 
      background: linear-gradient(to right, rgba(238, 242, 255, 0.8), rgba(253, 244, 255, 0.8));
      border-bottom: 1px solid rgba(0,0,0,0.05);
      display: flex; justify-content: space-between; align-items: center;
    }
    .ai-chat-header-title { display: flex; align-items: center; gap: 10px; }
    .ai-avatar {
      width: 36px; height: 36px; background: linear-gradient(135deg, #818cf8, #c084fc);
      border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white;
      box-shadow: 0 4px 12px rgba(129, 140, 248, 0.3);
    }
    .ai-chat-header strong { font-weight: 600; font-size: 1.1rem; color: #1e293b; }
    .btn-close { 
      width: 32px; height: 32px; border-radius: 50%; border: none; background: transparent; 
      color: #64748b; cursor: pointer; transition: background 0.2s;
      display: flex; align-items: center; justify-content: center;
    }
    .btn-close:hover { background: rgba(0,0,0,0.05); color: #0f172a; }

    /* Body */
    .ai-chat-body {
      flex: 1; padding: 20px; overflow-y: auto;
      font-size: 0.95rem; display: flex; flex-direction: column; gap: 16px;
      background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.5));
    }

    /* Messages */
    .msg { 
      padding: 14px 18px; border-radius: 20px; max-width: 85%; line-height: 1.5; 
      position: relative; animation: msg-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      box-shadow: 0 2px 5px rgba(0,0,0,0.03);
    }
    .msg.user { 
      align-self: flex-end; background: linear-gradient(135deg, #6366f1, #8b5cf6); 
      color: white; border-bottom-right-radius: 4px; 
    }
    .msg.bot { 
      align-self: flex-start; background: white; color: #334155; 
      border-bottom-left-radius: 4px; border: 1px solid #f1f5f9;
    }
    .msg.error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

    /* Tables in Chat */
    .ai-table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #e2e8f0; background: white; }
    .ai-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .ai-table th { background: #f8fafc; text-align: left; padding: 10px; color: #64748b; font-weight: 600; }
    .ai-table td { padding: 8px 10px; border-top: 1px solid #f1f5f9; color: #334155; }
    .ai-table tr:hover td { background: #f1f5f9; }

    /* Input Area */
    .ai-chat-input-area {
      padding: 16px; border-top: 1px solid rgba(0,0,0,0.05);
      display: flex; gap: 10px; background: rgba(255,255,255,0.8);
    }
    .ai-input {
      flex: 1; padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 24px;
      outline: none; font-size: 0.95rem; transition: all 0.2s;
      background: rgba(255,255,255,0.9);
    }
    .ai-input:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1); }
    .ai-send {
      width: 48px; height: 48px; border-radius: 50%; border: none;
      background: #1e293b; color: white; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s;
    }
    .ai-send:hover { transform: scale(1.05); background: #0f172a; }
    .ai-send:active { transform: scale(0.95); }

    @keyframes pulse-border { 0% { opacity: 0.5; transform: scale(1); } 100% { opacity: 0; transform: scale(1.5); } }
    @keyframes msg-pop { from { opacity: 0; transform: translateY(10px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
  `;
  document.head.appendChild(style);

  // --- HTML Structure ---
  const widget = document.createElement('div');
  widget.className = 'ai-chat-widget';
  widget.innerHTML = `
    <div class="ai-chat-window" id="aiChatWindow">
      <div class="ai-chat-header">
        <div class="ai-chat-header-title">
          <div class="ai-avatar"><i class="bi bi-stars"></i></div>
          <strong>JOY AI</strong>
        </div>
        <button class="btn-close" onclick="toggleAiChat()"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="ai-chat-body" id="aiChatBody"></div>
      <div class="ai-chat-input-area">
        <input type="text" class="ai-input" id="aiChatInput" placeholder="Ask anything..." />
        <button class="ai-send" id="aiChatSend"><i class="bi bi-send-fill" style="margin-left:2px"></i></button>
      </div>
    </div>
    <div class="ai-chat-btn" onclick="toggleAiChat()">
      <i class="bi bi-chat-text-fill"></i>
    </div>
  `;
  document.body.appendChild(widget);

  // --- Greetings Dictionary ---
  const greetings = {
    'en': "Hi",
    'es': "Hola",
    'fr': "Bonjour",
    'de': "Hallo",
    'hi': "Namaste",
    'zh': "Ni hao",
    'ja': "Konnichiwa",
    'it': "Ciao",
    'pt': "Olá",
    'ru': "Privet"
  };

  function getGreeting() {
    const lang = (navigator.language || 'en').split('-')[0];
    const word = greetings[lang] || "Hello";
    return word;
  }

  // --- Logic ---
  window.toggleAiChat = () => {
    const w = document.getElementById('aiChatWindow');
    const input = document.getElementById('aiChatInput');

    // Initial Greeting with Logic
    if (!w.dataset.greeted) {
      const username = window.JPSMS?.store?.me?.username || '';
      const greetWord = getGreeting(); // e.g., "Namaste"
      const namePart = username ? ` ${username}` : '';
      const page = document.title.replace(/JMS OCEAN|JPSMS/gi, '').replace('–', '').replace('-', '').trim() || 'Dashboard';
      const cleanPage = page.charAt(0).toUpperCase() + page.slice(1);

      const body = document.getElementById('aiChatBody');
      body.innerHTML = `
          <div class="msg bot">
            ${greetWord}${namePart}! 👋<br>
            I see you're on <strong>${cleanPage}</strong>.<br>
            How can I help you with this screen?
          </div>
        `;
      w.dataset.greeted = 'true';
    }

    w.classList.toggle('open');
    if (w.classList.contains('open')) setTimeout(() => input.focus(), 200);
  };

  const sendMsg = async () => {
    const inp = document.getElementById('aiChatInput');
    const txt = inp.value.trim();
    if (!txt) return;

    addMsg(txt, 'user');
    inp.value = '';
    inp.disabled = true;

    // Typing Indicator
    const thinkId = addMsg('<div style="display:flex; gap:4px; align-items:center"><div style="width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:bounce 1s infinite"></div><div style="width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:bounce 1s infinite 0.2s"></div><div style="width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:bounce 1s infinite 0.4s"></div></div><style>@keyframes bounce {0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}</style>', 'bot');

    try {
      const username = window.JPSMS?.store?.me?.username || 'Friend';

      // Context Aware
      const context = {
        page: document.title,
        url: window.location.pathname
      };

      const res = await window.JPSMS.api.post('/ai/ask', { question: txt, username, context });
      removeMsg(thinkId);

      if (res.ok) {
        if (res.error) {
          addMsg(res.error, 'error');
        } else if (res.type === 'text') {
          addMsg(res.answer, 'bot');
        } else if (res.type === 'table') {
          if (!res.answer || res.answer.length === 0) {
            addMsg("No records found.", 'bot');
          } else {
            addMsg(`Found ${res.answer.length} results:`, 'bot');
            addTable(res.answer);
          }
        } else {
          addMsg("I couldn't understand the result.", 'error');
        }
      } else {
        removeMsg(thinkId);
        addMsg(res.error || 'Server error', 'error');
      }
    } catch (e) {
      removeMsg(thinkId);
      addMsg(e.message, 'error');
    } finally {
      inp.disabled = false;
      inp.focus();
    }
  };

  document.getElementById('aiChatSend').onclick = sendMsg;
  document.getElementById('aiChatInput').onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };

  function addMsg(html, type) {
    const d = document.createElement('div');
    d.className = `msg ${type}`;
    d.innerHTML = html;
    d.id = 'msg-' + Math.random().toString(36).substr(2, 9);
    const b = document.getElementById('aiChatBody');
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
    return d.id;
  }

  function removeMsg(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function addTable(rows) {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    let h = `<div class="ai-table-wrap"><table class="ai-table"><thead><tr>`;
    keys.forEach(k => h += `<th>${k}</th>`);
    h += `</tr></thead><tbody>`;
    rows.forEach(r => {
      h += `<tr>`;
      keys.forEach(k => h += `<td>${String(r[k] == null ? '-' : r[k])}</td>`);
      h += `</tr>`;
    });
    h += `</tbody></table></div>`;
    addMsg(h, 'bot');
  }

})();
