// Antigravity Mobile Remote Client Logic

(function () {
  const state = {
    token: localStorage.getItem('ag_token') || '',
    pin: '',
    deviceId: localStorage.getItem('ag_device_id') || `mob_${Math.random().toString(36).substring(2, 9)}`,
    ws: null,
    connected: false,
    agentStatus: 'idle', // 'idle' | 'working' | 'waiting' | 'error'
    currentTab: 'chat',
    pendingApproval: null,
    messages: [],
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    wakeLock: null
  };

  localStorage.setItem('ag_device_id', state.deviceId);

  // NOTE: We do NOT auto-extract token from URL anymore.
  // Users must always authenticate via the 6-digit PIN for security.

  // DOM Elements
  const authOverlay = document.getElementById('auth-overlay');
  const pinInput = document.getElementById('pin-input');
  const pinSubmitBtn = document.getElementById('pin-submit-btn');
  const pinError = document.getElementById('pin-error');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const chatScroll = document.getElementById('chat-scroll');
  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');
  const interruptBtn = document.getElementById('interrupt-btn');
  const approvalBanner = document.getElementById('approval-banner');
  const approvalDesc = document.getElementById('approval-desc');
  const approveBtn = document.getElementById('approve-btn');
  const rejectBtn = document.getElementById('reject-btn');
  const fileTreeContainer = document.getElementById('file-tree-container');
  const diffsContainer = document.getElementById('diffs-container');
  const fileContentModal = document.getElementById('file-content-modal');
  const fileContentBody = document.getElementById('file-content-body');
  const fileContentTitle = document.getElementById('file-content-title');
  const closeFileModal = document.getElementById('close-file-modal');

  // Initialize
  function init() {
    setupNavigation();
    setupAuthListeners();
    setupChatListeners();
    setupFilesListeners();
    setupWakeLock();

    if (state.token) {
      // We have a saved token — try to connect with it
      connectWebSocket();
    } else {
      // No saved token — show PIN screen
      showAuthOverlay();
    }
  }

  // WakeLock API (keeps phone screen awake while watching agent)
  async function setupWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
      } catch {
        // ignore
      }
    }
  }

  // Auth Handling
  function showAuthOverlay(errorMsg) {
    authOverlay.style.display = 'flex';
    if (errorMsg) {
      pinError.textContent = errorMsg;
      pinError.style.display = 'block';
    } else {
      pinError.style.display = 'none';
    }
    // Clear old token when showing auth
    state.token = '';
    localStorage.removeItem('ag_token');
    pinInput.value = '';
    pinInput.focus();
  }

  function hideAuthOverlay() {
    authOverlay.style.display = 'none';
  }

  function setupAuthListeners() {
    pinSubmitBtn.addEventListener('click', function () {
      var pin = pinInput.value.trim();
      if (!pin) return;
      verifyPin(pin);
    });

    pinInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        var pin = pinInput.value.trim();
        if (pin) verifyPin(pin);
      }
    });
  }

  async function verifyPin(pin) {
    try {
      pinSubmitBtn.disabled = true;
      pinSubmitBtn.textContent = 'Verifying...';

      var res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: pin,
          deviceId: state.deviceId,
          userAgent: navigator.userAgent
        })
      });

      var data = await res.json();
      if (res.ok && data.token) {
        state.token = data.token;
        localStorage.setItem('ag_token', data.token);
        hideAuthOverlay();
        connectWebSocket();
        // Show success toast
        showToast('Connected successfully!', 'success');
      } else {
        showAuthOverlay(data.error || 'Incorrect PIN');
      }
    } catch (err) {
      showAuthOverlay('Network error. Check connection.');
    } finally {
      pinSubmitBtn.disabled = false;
      pinSubmitBtn.textContent = 'Connect to Antigravity';
    }
  }

  // Toast notification
  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast-notification ' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      setTimeout(function () { toast.remove(); }, 300);
    }, 2500);
  }

  // WebSocket Connection & Real-time protocol
  function connectWebSocket() {
    if (state.ws) {
      try { state.ws.close(); } catch (e) {}
    }

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + window.location.host + '/ws?token=' + encodeURIComponent(state.token) + '&deviceId=' + encodeURIComponent(state.deviceId);

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = function () {
      state.connected = true;
      state.reconnectAttempts = 0;
      updateStatus('idle', 'Online');
    };

    state.ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('Failed to parse WS message:', err);
      }
    };

    state.ws.onclose = function (event) {
      state.connected = false;
      // If closed due to auth failure (code 4001), show auth overlay
      if (event.code === 4001) {
        showAuthOverlay('Session expired. Please re-authenticate.');
        return;
      }
      if (state.reconnectAttempts < state.maxReconnectAttempts) {
        updateStatus('error', 'Reconnecting...');
        scheduleReconnect();
      } else {
        updateStatus('error', 'Disconnected');
        showToast('Connection lost. Please refresh.', 'error');
      }
    };

    state.ws.onerror = function (err) {
      console.warn('WebSocket error:', err);
    };
  }

  function scheduleReconnect() {
    state.reconnectAttempts++;
    var delay = Math.min(1000 * Math.pow(1.5, state.reconnectAttempts), 10000);
    setTimeout(function () {
      if (!state.connected && state.token) {
        connectWebSocket();
      }
    }, delay);
  }

  function sendWs(type, payload) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: type, payload: payload }));
    }
  }

  // Event Handling from Workstation Agent
  function handleServerMessage(msg) {
    var type = msg.type;
    var payload = msg.payload;

    switch (type) {
      case 'auth:required':
      case 'auth:error':
        showAuthOverlay(payload.error || payload.message);
        break;

      case 'auth:success':
        hideAuthOverlay();
        updateStatus('idle', 'Connected');
        showToast('Authenticated!', 'success');
        sendWs('client:request_models', {});
        break;

      case 'agent:status':
        updateStatus(payload.status, payload.label);
        break;

      case 'agent:models_list':
        var select = document.getElementById('model-selector');
        if (select && Array.isArray(payload)) {
          select.innerHTML = '';
          payload.forEach(function(model) {
            var option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name;
            select.appendChild(option);
          });
        }
        break;

      case 'agent:thought':
        appendOrUpdateThinking(payload.content);
        break;

      case 'agent:message':
        appendAssistantMessage(payload.content, payload.delta);
        break;

      case 'agent:tool_call':
        appendToolExecution(payload);
        break;

      case 'agent:approval_request':
        showApprovalRequest(payload);
        if (window.soundManager) {
          window.soundManager.playApprovalChime();
        }
        break;

      case 'agent:complete':
        updateStatus('idle', 'Task Finished');
        if (window.soundManager) {
          window.soundManager.playCompleteChime();
        }
        break;

      case 'ping':
        sendWs('pong', { time: Date.now() });
        break;
    }
  }

  function updateStatus(status, label) {
    state.agentStatus = status;
    statusBadge.className = 'status-badge ' + status;
    statusText.textContent = label || status;

    if (status === 'working') {
      interruptBtn.style.display = 'flex';
    } else {
      interruptBtn.style.display = 'none';
    }
  }

  // Chat Rendering
  function appendAssistantMessage(content, isDelta) {
    var lastMsg = chatScroll.querySelector('.message.assistant:last-child');
    if (!lastMsg || !isDelta) {
      lastMsg = document.createElement('div');
      lastMsg.className = 'message assistant';
      var bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.textContent = content;
      lastMsg.appendChild(bubble);
      chatScroll.appendChild(lastMsg);
    } else {
      var bubble = lastMsg.querySelector('.message-bubble');
      if (bubble) {
        bubble.textContent += content;
      }
    }
    scrollChatBottom();
  }

  function appendUserMessage(content) {
    var msg = document.createElement('div');
    msg.className = 'message user';
    var bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = content;
    msg.appendChild(bubble);
    chatScroll.appendChild(msg);
    scrollChatBottom();
  }

  function appendOrUpdateThinking(thoughtText) {
    var box = chatScroll.querySelector('.thinking-box:last-child');
    if (!box) {
      box = document.createElement('div');
      box.className = 'thinking-box';
      box.innerHTML =
        '<div class="thinking-header">' +
        '  <span>Thinking Process</span>' +
        '  <span style="font-size:10px;">▼</span>' +
        '</div>' +
        '<div class="thinking-content"></div>';
      var header = box.querySelector('.thinking-header');
      var contentDiv = box.querySelector('.thinking-content');
      header.addEventListener('click', function () {
        contentDiv.style.display = contentDiv.style.display === 'none' ? 'block' : 'none';
      });
      chatScroll.appendChild(box);
    }
    var content = box.querySelector('.thinking-content');
    if (content) {
      content.textContent = thoughtText;
    }
    scrollChatBottom();
  }

  function appendToolExecution(toolData) {
    var card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML =
      '<div class="tool-header">' +
      '  <span>⚡ ' + escapeHtml(toolData.name || 'Tool Execution') + '</span>' +
      '</div>' +
      '<div class="tool-logs">' + escapeHtml(toolData.detail || '') + '</div>';
    chatScroll.appendChild(card);
    scrollChatBottom();
  }

  function scrollChatBottom() {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Approvals
  function showApprovalRequest(req) {
    state.pendingApproval = req;
    approvalDesc.textContent = req.description || req.command || 'The agent requests permission to execute an action.';
    approvalBanner.style.display = 'block';
    updateStatus('waiting', 'Approval Needed');
  }

  function hideApproval() {
    approvalBanner.style.display = 'none';
    state.pendingApproval = null;
  }

  // Navigation Tabs
  function setupNavigation() {
    var navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });

    // Sub-tabs in Files view (Files / Diffs)
    var subTabBtns = document.querySelectorAll('.sub-tab-btn');
    subTabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        subTabBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var target = btn.getAttribute('data-subtab');
        if (target === 'files') {
          fileTreeContainer.style.display = 'block';
          diffsContainer.style.display = 'none';
          loadFiles();
        } else {
          fileTreeContainer.style.display = 'none';
          diffsContainer.style.display = 'block';
          loadDiffs();
        }
      });
    });
  }

  function switchTab(tabId) {
    state.currentTab = tabId;
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(function (pane) {
      pane.classList.toggle('active', pane.id === 'tab-' + tabId);
    });

    if (tabId === 'files') {
      loadFiles();
    }
  }

  // Chat Actions
  function setupChatListeners() {
    sendBtn.addEventListener('click', handleSendPrompt);

    promptInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendPrompt();
      }
    });

    interruptBtn.addEventListener('click', function () {
      sendWs('client:interrupt', { reason: 'User tapped pause on mobile' });
      updateStatus('idle', 'Interrupted');
    });

    approveBtn.addEventListener('click', function () {
      if (state.pendingApproval) {
        sendWs('client:approval_response', { id: state.pendingApproval.id, approved: true });
        hideApproval();
        updateStatus('working', 'Executing...');
      }
    });

    rejectBtn.addEventListener('click', function () {
      if (state.pendingApproval) {
        sendWs('client:approval_response', { id: state.pendingApproval.id, approved: false });
        hideApproval();
        updateStatus('idle', 'Rejected');
      }
    });
  }

  var newChatBtn = document.getElementById('newChatBtn');
  var isNewChat = true;

  if (newChatBtn) {
    newChatBtn.addEventListener('click', function() {
      // Clear chat UI
      document.getElementById('chat-scroll').innerHTML = '';
      isNewChat = true;
      showToast('New chat started', 'success');
      promptInput.focus();
    });
  }

  function handleSendPrompt() {
    var text = promptInput.value.trim();
    if (!text) return;

    if (!state.connected || !state.token) {
      showToast('Not connected. Reconnecting...', 'error');
      connectWebSocket();
      return;
    }

    var selectedModel = document.getElementById('model-selector')?.value || undefined;

    appendUserMessage(text);
    sendWs('client:prompt', { text: text, isNewChat: isNewChat, model: selectedModel });
    
    // After first prompt, continue chat
    isNewChat = false;

    promptInput.value = '';
    promptInput.style.height = 'auto';
    promptInput.focus();

    // Show a brief "Sending..." status
    updateStatus('working', 'Sending...');
    
    // Auto-reset status after 10 seconds if we don't get a definitive completion
    // from the IDE (since we aren't intercepting the raw agent stream yet).
    setTimeout(function() {
      if (state.agentStatus === 'working') {
        updateStatus('idle', 'Task dispatched');
      }
    }, 10000);
  }

  // Files & Git Diffs
  function setupFilesListeners() {
    if (closeFileModal) {
      closeFileModal.addEventListener('click', function () {
        fileContentModal.style.display = 'none';
      });
    }
  }

  async function loadFiles() {
    try {
      fileTreeContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>Loading workspace files...</span></div>';
      var res = await fetch('/api/files/tree?token=' + encodeURIComponent(state.token));
      var data = await res.json();
      if (res.ok && data.tree) {
        fileTreeContainer.innerHTML = '';
        renderFileTree(data.tree, fileTreeContainer, 0);
      } else {
        fileTreeContainer.innerHTML = '<div class="error-state">Failed to load files.</div>';
      }
    } catch (e) {
      fileTreeContainer.innerHTML = '<div class="error-state">Connection error.</div>';
    }
  }

  function renderFileTree(nodes, container, depth) {
    nodes.forEach(function (node) {
      var item = document.createElement('div');
      item.className = 'file-item';
      item.style.paddingLeft = (depth * 18 + 14) + 'px';

      var isDir = node.type === 'directory';
      var icon = isDir ? '📁' : getFileIcon(node.name);
      var sizeLabel = '';
      if (node.size) {
        if (node.size > 1024 * 1024) {
          sizeLabel = (node.size / 1024 / 1024).toFixed(1) + ' MB';
        } else if (node.size > 1024) {
          sizeLabel = (node.size / 1024).toFixed(1) + ' KB';
        } else {
          sizeLabel = node.size + ' B';
        }
      }

      item.innerHTML =
        '<span class="file-icon">' + icon + '</span>' +
        '<span class="file-name">' + escapeHtml(node.name) + '</span>' +
        (sizeLabel ? '<span class="file-size">' + sizeLabel + '</span>' : '');

      if (!isDir) {
        item.addEventListener('click', function () {
          openFileContent(node.relativePath);
        });
        item.classList.add('file-clickable');
      }

      container.appendChild(item);
      if (isDir && node.children && node.children.length > 0) {
        var subContainer = document.createElement('div');
        subContainer.className = 'file-subtree';
        renderFileTree(node.children, subContainer, depth + 1);
        container.appendChild(subContainer);
      }
    });
  }

  function getFileIcon(name) {
    var ext = name.split('.').pop().toLowerCase();
    var icons = {
      ts: '🔷', js: '🟡', json: '📋', html: '🌐', css: '🎨',
      md: '📝', py: '🐍', rs: '🦀', go: '🔵', java: '☕',
      cpp: '⚙️', c: '⚙️', sh: '🖥️', yaml: '📐', yml: '📐',
      svg: '🖼️', png: '🖼️', jpg: '🖼️', gif: '🖼️',
      lock: '🔒', gitignore: '🔒', env: '🔑'
    };
    return icons[ext] || '📄';
  }

  async function openFileContent(filePath) {
    try {
      fileContentTitle.textContent = filePath;
      fileContentBody.textContent = 'Loading...';
      fileContentModal.style.display = 'flex';

      var res = await fetch('/api/files/content?path=' + encodeURIComponent(filePath) + '&token=' + encodeURIComponent(state.token));
      var data = await res.json();
      if (res.ok && data.content) {
        fileContentBody.textContent = data.content;
      } else {
        fileContentBody.textContent = data.error || 'Failed to read file.';
      }
    } catch (e) {
      fileContentBody.textContent = 'Network error.';
    }
  }

  async function loadDiffs() {
    try {
      diffsContainer.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>Inspecting git changes...</span></div>';
      var res = await fetch('/api/git/diff?token=' + encodeURIComponent(state.token));
      var data = await res.json();
      if (res.ok && data.diffs) {
        if (data.diffs.length === 0) {
          diffsContainer.innerHTML = '<div class="empty-state">No modified files in workspace.</div>';
          return;
        }
        renderDiffs(data.diffs);
      }
    } catch (e) {
      diffsContainer.innerHTML = '<div class="error-state">Failed to inspect diffs.</div>';
    }
  }

  function renderDiffs(diffs) {
    diffsContainer.innerHTML = '';
    diffs.forEach(function (entry) {
      var box = document.createElement('div');
      box.className = 'diff-box';

      var statusColor = 'var(--accent-cyan)';
      if (entry.status === 'added') statusColor = 'var(--accent-emerald)';
      if (entry.status === 'deleted') statusColor = 'var(--accent-rose)';

      box.innerHTML =
        '<div class="diff-header">' +
        '  <span>' + escapeHtml(entry.file) + '</span>' +
        '  <span style="color:' + statusColor + ';text-transform:uppercase;">' + entry.status + '</span>' +
        '</div>' +
        '<div class="diff-content"></div>';

      var content = box.querySelector('.diff-content');
      if (entry.diff) {
        var lines = entry.diff.split('\n');
        lines.forEach(function (line) {
          var row = document.createElement('div');
          if (line.startsWith('+') && !line.startsWith('+++')) {
            row.className = 'diff-line-add';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            row.className = 'diff-line-del';
          }
          row.textContent = line;
          content.appendChild(row);
        });
      } else {
        content.textContent = 'Untracked or binary file';
      }

      diffsContainer.appendChild(box);
    });
  }

  // Start app on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', init);
})();
