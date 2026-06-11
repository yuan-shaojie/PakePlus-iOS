var Chat = Chat || {};

// ============ DOM 引用 ============
Chat.dom = {
    chatInner: document.getElementById('chatInner'),
    welcomeScreen: document.getElementById('welcomeScreen'),
    messageInput: document.getElementById('messageInput'),
    btnSend: document.getElementById('btnSend'),
    btnVoice: document.getElementById('btnVoice'),
    btnFile: document.getElementById('btnFile'),
    fileInput: document.getElementById('fileInput'),
    filePreviewBar: document.getElementById('filePreviewBar'),
    voiceOverlay: document.getElementById('voiceOverlay'),
    voiceText: document.getElementById('voiceText'),
    voiceCancel: document.getElementById('voiceCancel'),
    voiceSend: document.getElementById('voiceSend'),
    typingIndicator: document.getElementById('typingIndicator'),
    headerStatus: document.getElementById('headerStatus'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    btnSettings: document.getElementById('btnSettings'),
    settingsClose: document.getElementById('settingsClose'),
    settingsSave: document.getElementById('settingsSave'),
    temperatureInput: document.getElementById('temperature'),
    tempValueEl: document.getElementById('tempValue'),
    btnNewChat: document.getElementById('btnNewChat'),
    btnHistory: document.getElementById('btnHistory'),
    aiMascot: document.getElementById('aiMascot'),
    aiMascotBubble: document.getElementById('aiMascotBubble'),
    aiMascotText: document.getElementById('aiMascotText'),
    aiBackdrop: document.getElementById('aiBackdrop'),
    headerAvatar: document.getElementById('headerAvatar'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    sidebarClose: document.getElementById('sidebarClose'),
    sessionList: document.getElementById('sessionList'),
    btnNewSession: document.getElementById('btnNewSession')
};

// ============ 状态 ============
Chat.isProcessing = false;
Chat.selectedFiles = [];
Chat.recognition = null;
Chat.isRecording = false;
Chat.chatMessages = [];
Chat.sessions = [];
Chat.currentSessionId = null;
Chat.authToken = null;
Chat.pendingRequest = null;

// ============ 初始化 ============
Chat.init = function() {
    Chat.authToken = localStorage.getItem('xlx_auth_token');
    if (!Chat.authToken) {
        window.location.href = '/login.html';
        return;
    }

    // 初始化 API 模块（检测域名连通性，完成后再连 WSS）
    API.init(function() {
        Chat.renderApiServers();
        Chat.connectWebSocket();
    });

    var cached = localStorage.getItem('xlx_chat_cache');
    if (cached) {
        try {
            var cd = JSON.parse(cached);
            if (cd && cd.messages && cd.messages.length > 0) {
                Chat.chatMessages = cd.messages;
                Chat.dom.chatInner.innerHTML = '';
                Chat.hideWelcome();
                for (var i = 0; i < Chat.chatMessages.length; i++) {
                    Chat.addMessage(Chat.chatMessages[i].role === 'user' ? 'user' : 'bot', Chat.chatMessages[i].content);
                }
                Chat.scrollToBottom();
            }
        } catch(e) {}
    }

    var savedTemp = localStorage.getItem('xlx_temperature');
    if (savedTemp) { Chat.dom.temperatureInput.value = savedTemp; Chat.dom.tempValueEl.textContent = savedTemp; }

    Chat.setupEventListeners();
    Chat.initMascotDrag();
    if (typeof Chat.initVoiceList === 'function') Chat.initVoiceList();
    Chat.updateSendButton();
    Chat.setAIState('idle');
    // connectWebSocket 移到 API.init 回调中，等域名检测完成后再连

    // === 在首次用户交互时解锁 AudioContext（iOS 自动播放限制）===
    var _unlockEvents = ['touchstart', 'touchend', 'click', 'keydown', 'mousedown'];
    function _onUserInteract() {
        Chat._unlockAudio();
        for (var k = 0; k < _unlockEvents.length; k++) {
            document.removeEventListener(_unlockEvents[k], _onUserInteract);
        }
    }
    for (var k = 0; k < _unlockEvents.length; k++) {
        document.addEventListener(_unlockEvents[k], _onUserInteract, { once: false, passive: true });
    }

    document.addEventListener('click', function(e) {
        if (e.target.closest('.msg-speak-btn')) return;
        if (window._xlx_utterance) {
            speechSynthesis.cancel();
            window._xlx_utterance = null;
        }
    }, true);

    var unlocked = false;
    document.addEventListener('touchstart', function once() {
        if (unlocked) return;
        unlocked = true;
        if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); }
    }, { once: true });
    document.addEventListener('click', function once() {
        if (unlocked) return;
        unlocked = true;
        if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); }
    }, { once: true });
};

// ============ 会话管理 ============
Chat.renderSessionList = function() {
    var sessionList = Chat.dom.sessionList;
    if (!sessionList) return;
    sessionList.innerHTML = '';
    if (Chat.sessions.length === 0) {
        sessionList.innerHTML = '<div class="session-empty">暂无会话</div>';
        return;
    }
    for (var i = 0; i < Chat.sessions.length; i++) {
        var s = Chat.sessions[i];
        var item = document.createElement('div');
        item.className = 'session-item';
        if (s.key === Chat.currentSessionId) item.classList.add('active');
        var name = s.name || s.key || '';
        var msgCount = s.messageCount || 0;
        item.innerHTML = '<div class="session-item-info">' +
            '<div class="session-item-name">' + Chat.escapeHtml(name) + '</div>' +
            '<div class="session-item-preview">' + Chat.escapeHtml(msgCount + ' 条消息') + '</div>' +
            '</div>' +
            '<button class="session-item-delete" title="删除">×</button>';

        (function(session) {
            item.querySelector('.session-item-delete').addEventListener('click', function(e) {
                e.stopPropagation();
                Chat.sendWS({ type: 'delete_session', sessionKey: session.key });
            });
            item.addEventListener('click', function() {
                if (session.key === Chat.currentSessionId) return;
                Chat.currentSessionId = session.key;
                Chat.sendWS({ type: 'session_messages', sessionKey: session.key });
                Chat.renderSessionList();
                Chat.closeSidebar();
                Chat.setAIState('idle');
                Chat.hideMascotBubble();
            });
        })(s);
        sessionList.appendChild(item);
    }
};

Chat.createSession = function() {
    var newUuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
    Chat.currentSessionId = 'agent:main:openai:' + newUuid;
    Chat.chatMessages = [];
    Chat.dom.chatInner.innerHTML = '';
    Chat.showWelcome();
    Chat.renderSessionList();
    Chat.closeSidebar();
    Chat.setAIState('idle');
    Chat.hideMascotBubble();
};

// ============ 事件监听 ============
Chat.setupEventListeners = function() {
    var btnSend = Chat.dom.btnSend;
    var messageInput = Chat.dom.messageInput;
    var btnFile = Chat.dom.btnFile;
    var fileInput = Chat.dom.fileInput;
    var btnVoice = Chat.dom.btnVoice;
    var voiceCancel = Chat.dom.voiceCancel;
    var voiceSend = Chat.dom.voiceSend;
    var btnSettings = Chat.dom.btnSettings;
    var settingsClose = Chat.dom.settingsClose;
    var settingsSave = Chat.dom.settingsSave;
    var settingsOverlay = Chat.dom.settingsOverlay;
    var btnNewChat = Chat.dom.btnNewChat;
    var headerAvatar = Chat.dom.headerAvatar;
    var btnHistory = Chat.dom.btnHistory;
    var sidebarClose = Chat.dom.sidebarClose;
    var sidebarOverlay = Chat.dom.sidebarOverlay;
    var btnNewSession = Chat.dom.btnNewSession;
    var temperatureInput = Chat.dom.temperatureInput;
    var tempValueEl = Chat.dom.tempValueEl;
    var aiMascot = Chat.dom.aiMascot;
    var aiMascotBubble = Chat.dom.aiMascotBubble;

    if (btnSend) btnSend.addEventListener('click', function() { Chat.stopSpeaking(); Chat.sendMessage(); });
    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Chat.stopSpeaking(); Chat.sendMessage(); }
        });
        messageInput.addEventListener('focus', function() { Chat.stopSpeaking(); });
        messageInput.addEventListener('input', function() { Chat.updateSendButton(); Chat.autoResizeTextarea(); });
    }
    if (btnFile && fileInput) { btnFile.addEventListener('click', function() { fileInput.click(); }); fileInput.addEventListener('change', Chat.handleFileSelect); }
    if (btnVoice) btnVoice.addEventListener('click', function() { Chat.stopSpeaking(); Chat.toggleVoice(); });
    if (voiceCancel) voiceCancel.addEventListener('click', Chat.stopVoice);
    if (voiceSend) voiceSend.addEventListener('click', function() { Chat.stopVoice(); Chat.sendMessage(); setTimeout(function() { Chat.dom.messageInput.value = ''; Chat.updateSendButton(); }, 1500); });
    if (btnSettings) btnSettings.addEventListener('click', Chat.openSettings);
    if (settingsClose) settingsClose.addEventListener('click', Chat.closeSettings);
    if (settingsSave) settingsSave.addEventListener('click', Chat.saveSettings);
    if (settingsOverlay) settingsOverlay.addEventListener('click', function(e) { if (e.target === settingsOverlay) Chat.closeSettings(); });
    if (btnNewChat) btnNewChat.addEventListener('click', function() { if (Chat.isProcessing) return; Chat.createSession(); });
    if (headerAvatar) headerAvatar.addEventListener('click', Chat.openSidebar);
    if (btnHistory) btnHistory.addEventListener('click', Chat.openSidebar);
    if (sidebarClose) sidebarClose.addEventListener('click', Chat.closeSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', function(e) { if (e.target === sidebarOverlay) Chat.closeSidebar(); });
    if (btnNewSession) btnNewSession.addEventListener('click', function() { if (Chat.isProcessing) return; Chat.createSession(); });
    if (temperatureInput && tempValueEl) temperatureInput.addEventListener('input', function() { tempValueEl.textContent = this.value; });
    var rateSlider = document.getElementById('rateSlider');
    var rateValue = document.getElementById('rateValue');
    if (rateSlider && rateValue) rateSlider.addEventListener('input', function() { rateValue.textContent = this.value; });

    // 清除缓存并刷新（PWA 专用）
    var clearCacheBtn = document.getElementById('clearCache');
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', function() {
        // 清除所有缓存
        localStorage.clear();
        // 清除 Service Worker 缓存
        if ('caches' in window) {
            caches.keys().then(function(keys) {
                keys.forEach(function(key) { caches.delete(key); });
            });
        }
        // 卸载所有 Service Worker 后刷新
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
                regs.forEach(function(reg) { reg.unregister(); });
                setTimeout(function() { location.reload(true); }, 300);
            });
        } else {
            location.reload(true);
        }
    });

    // 检测 API 服务器按钮
    var btnCheckServers = document.getElementById('btnCheckServers');
    if (btnCheckServers) btnCheckServers.addEventListener('click', function() {
        Chat.refreshApiServers();
    });

    var hints = document.querySelectorAll('.welcome-hints span');
    hints.forEach(function(hint) {
        hint.addEventListener('click', function() {
            if (messageInput) messageInput.value = this.textContent;
            Chat.updateSendButton();
            Chat.autoResizeTextarea();
            Chat.sendMessage();
        });
    });

    document.addEventListener('click', function(e) {
        if (!aiMascot || !aiMascot.classList.contains('answering')) return;
        var el = e.target;
        while (el) {
            if (el === messageInput || el === btnSend || el === btnFile || el === btnVoice ||
                el === headerAvatar || el === sidebarPanel || el === settingsPanel ||
                el === btnNewSession || el === btnNewChat || el === btnSettings || el === btnHistory ||
                el === aiMascotBubble || el.closest('.ai-mascot-bubble') ||
                el.closest('.input-container') || el.closest('.sidebar-panel') || el.closest('.settings-panel') ||
                el.closest('.ai-mascot') || el.closest('.msg-speak-btn')) { return; }
            el = el.parentElement;
        }
        Chat.stopSpeaking();
        Chat.hideMascotBubble();
        Chat.setAIState('idle');
    });
};

// ============ UI 辅助 ============
Chat.showWelcome = function() {
    var chatInner = Chat.dom.chatInner;
    var messageInput = Chat.dom.messageInput;
    chatInner.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'welcome-screen';
    div.id = 'welcomeScreen';
    div.innerHTML = '<div class="welcome-icon"><svg viewBox="0 0 80 80" width="80" height="80">' +
        '<defs><linearGradient id="welcomeGrad2" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" style="stop-color:#00f0ff"/><stop offset="100%" style="stop-color:#8b5cf6"/></linearGradient></defs>' +
        '<circle cx="40" cy="40" r="38" fill="none" stroke="url(#welcomeGrad2)" stroke-width="2"/>' +
        '<circle cx="28" cy="30" r="6" fill="#00f0ff" opacity="0.8"/><circle cx="52" cy="30" r="6" fill="#00f0ff" opacity="0.8"/>' +
        '<path d="M22 52 Q40 62 58 52" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round"/>' +
        '<line x1="40" y1="38" x2="40" y2="48" stroke="#00f0ff" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="40" cy="36" r="2.5" fill="#00f0ff"/></svg></div>' +
        '<h2 class="welcome-title">小龙虾 AI</h2>' +
        '<p class="welcome-desc">WebSocket 实时通信 · 流式响应</p>' +
        '<div class="welcome-hints"><span>提问编程问题</span><span>分析文档内容</span><span>创意写作辅助</span></div>';
    chatInner.appendChild(div);
    Chat.dom.welcomeScreen = document.getElementById('welcomeScreen');
    var hints = div.querySelectorAll('.welcome-hints span');
    hints.forEach(function(hint) {
        hint.addEventListener('click', function() {
            messageInput.value = this.textContent;
            Chat.updateSendButton();
            Chat.autoResizeTextarea();
            Chat.sendMessage();
        });
    });
};

Chat.hideWelcome = function() { if (Chat.dom.welcomeScreen) Chat.dom.welcomeScreen.style.display = 'none'; };
Chat.showTyping = function() { Chat.dom.typingIndicator.classList.add('active'); };
Chat.hideTyping = function() { Chat.dom.typingIndicator.classList.remove('active'); };
Chat.updateSendButton = function() { Chat.dom.btnSend.disabled = !(Chat.dom.messageInput.value.trim().length > 0 || Chat.selectedFiles.length > 0); };
Chat.autoResizeTextarea = function() { Chat.dom.messageInput.style.height = 'auto'; Chat.dom.messageInput.style.height = Math.min(Chat.dom.messageInput.scrollHeight, 120) + 'px'; };
Chat.scrollToBottom = function() { setTimeout(function() { if (Chat.dom.chatInner) Chat.dom.chatInner.scrollTop = Chat.dom.chatInner.scrollHeight; }, 50); };
Chat.getTimeStr = function() { var now = new Date(); return ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2); };
Chat.saveHistory = function() { try { localStorage.setItem('xlx_chat_cache', JSON.stringify({ messages: Chat.chatMessages })); } catch(e) {} };
Chat.updateStatus = function(data) {
    var headerStatus = Chat.dom.headerStatus;
    if (data.gateway === 'offline') {
        headerStatus.textContent = '网关离线 · 端口 ' + data.gatewayPort;
        headerStatus.style.color = 'var(--danger)';
    } else if (data.transcriptFile) {
        headerStatus.textContent = '已同步 · ' + (data.sessionKey || '');
        headerStatus.style.color = 'var(--accent)';
    } else {
        headerStatus.textContent = 'WebSocket 就绪';
        headerStatus.style.color = 'var(--accent)';
    }
};

// ============ 侧边栏 ============
Chat.openSidebar = function() { Chat.renderSessionList(); Chat.dom.sidebarOverlay.classList.add('open'); };
Chat.closeSidebar = function() { Chat.dom.sidebarOverlay.classList.remove('open'); };

// ============ 设置 ============
Chat.openSettings = function() {
    var settingsOverlay = Chat.dom.settingsOverlay;
    settingsOverlay.classList.add('active');
    // 加载 3060 TTS 语音列表
    Chat._loadTTSVoices();
    var ttsToggle = document.getElementById('ttsToggle');
    if (ttsToggle) ttsToggle.checked = localStorage.getItem('xlx_tts_enabled') !== 'false';
    var rateSlider = document.getElementById('rateSlider');
    var rateValue = document.getElementById('rateValue');
    if (rateSlider && rateValue) { rateSlider.value = localStorage.getItem('xlx_speech_rate') || '1.6'; rateValue.textContent = rateSlider.value; }
    // 刷新 API 服务器列表
    Chat.renderApiServers();
};

Chat._loadTTSVoices = function() {
    var ttsVoiceSelect = document.getElementById('ttsVoiceSelect');
    if (!ttsVoiceSelect) return;
    var saved = localStorage.getItem('xlx_tts_voice') || 'zh-CN-XiaoxiaoNeural';
    API.getTTSVoices().then(function(voices) {
        if (Array.isArray(voices)) {
            ttsVoiceSelect.innerHTML = '';
            voices.forEach(function(v) {
                var opt = document.createElement('option');
                opt.value = v.name;
                opt.textContent = v.display || v.name;
                ttsVoiceSelect.appendChild(opt);
            });
            if (voices.some(function(v) { return v.name === saved; })) {
                ttsVoiceSelect.value = saved;
            }
        }
    }).catch(function() { /* 静默失败 */ });
    // 语音选择时播放本地试听
    ttsVoiceSelect.onchange = function() {
        var audio = new Audio('/assets/audio/preview/' + this.value + '.mp3');
        audio.volume = 0.5;
        audio.play().catch(function() {});
    };
};

Chat.closeSettings = function() { Chat.dom.settingsOverlay.classList.remove('active'); };

Chat.saveSettings = function() {
    localStorage.setItem('xlx_temperature', Chat.dom.temperatureInput.value);
    Chat.dom.tempValueEl.textContent = Chat.dom.temperatureInput.value;
    var ttsToggle = document.getElementById('ttsToggle');
    if (ttsToggle) localStorage.setItem('xlx_tts_enabled', ttsToggle.checked ? 'true' : 'false');
    var ttsVoiceSelect = document.getElementById('ttsVoiceSelect');
    if (ttsVoiceSelect) localStorage.setItem('xlx_tts_voice', ttsVoiceSelect.value);
    var rateSlider = document.getElementById('rateSlider');
    if (rateSlider) localStorage.setItem('xlx_speech_rate', rateSlider.value);
    Chat.closeSettings();
    Chat.showToast('配置已保存');
};

// ============ API 服务器管理 ============

Chat.renderApiServers = function() {
    var listEl = document.getElementById('apiServerList');
    if (!listEl) return;

    var servers = API.SERVERS;
    var activeIdx = API.getActiveIndex();

    var html = '';
    for (var i = 0; i < servers.length; i++) {
        var s = servers[i];
        var isActive = (i === activeIdx);
        var ok = API._healthy[i];
        var statusDot = (ok === true) ? '<span style="color:var(--success);">●</span>'
                     : (ok === false) ? '<span style="color:var(--danger);">●</span>'
                     : '<span style="color:var(--text-secondary);">●</span>';
        var tag = (i === 0) ? '主' : '备';
        var tagColor = (i === 0) ? 'var(--accent-cyan)' : 'var(--accent-purple)';

        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;margin:4px 0;border-radius:8px;background:var(--bg-tertiary);border:1px solid ' + (isActive ? 'var(--accent-cyan)' : 'var(--border-color)') + ';">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
            statusDot +
            '<span style="font-size:11px;background:' + tagColor + ';color:#000;padding:1px 6px;border-radius:4px;font-weight:600;">' + tag + '</span>' +
            '<span style="font-size:12px;">' + Chat.escapeHtml(s.name) + '</span>' +
            '<span style="font-size:11px;color:var(--text-secondary);">' + Chat.escapeHtml(s.url) + '</span>' +
            '</div>' +
            (isActive
                ? '<span style="font-size:11px;color:var(--accent-cyan);font-weight:600;">当前</span>'
                : '<button data-idx="' + i + '" style="background:transparent;border:1px solid var(--border-color);color:var(--text-secondary);padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;">切换</button>'
            ) +
            '</div>';
    }
    listEl.innerHTML = html;

    // 绑定切换事件
    var btns = listEl.querySelectorAll('button[data-idx]');
    for (var j = 0; j < btns.length; j++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(btn.getAttribute('data-idx'));
                API.switchTo(idx);
                Chat.renderApiServers();
                Chat.showToast('已切换到: ' + API.SERVERS[idx].name);
                API.checkAllServers().then(function() {
                    Chat.renderApiServers();
                });
            });
        })(btns[j]);
    }
};

Chat.refreshApiServers = function() {
    var listEl = document.getElementById('apiServerList');
    if (listEl) listEl.innerHTML = '<span style="color:var(--text-secondary);">正在检测...</span>';

    API.checkAllServers().then(function() {
        Chat.renderApiServers();
        var active = API.getActiveUrl();
        Chat.showToast('当前: ' + active);
    });
};

// ============ 工具函数 ============
Chat.escapeHtml = function(text) { var div = document.createElement('div'); div.textContent = text; return div.innerHTML; };
Chat.truncate = function(str, maxLen) { return str.length <= maxLen ? str : str.substring(0, maxLen) + '...'; };
Chat.showToast = function(message, duration) {
    duration = duration || 2500;
    var toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, duration);
};

// ============ 浏览器通知 ============
Chat.notifyPermission = 'default';
Chat.notifyNewMessage = function() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        try { new Notification('小龙虾 AI', { body: '收到新回复...', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23ff6b6b"/></svg>' }); } catch(e) {}
    } else if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
};

// 由 index.html 中的脚本加载器在所有 JS 加载完成后调用 Chat.init()