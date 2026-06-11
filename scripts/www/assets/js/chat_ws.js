var Chat = Chat || {};

// ============ WebSocket 状态 ============
Chat.ws = null;
Chat.wsConnected = false;
Chat.wsReconnectTimer = null;
Chat.wsReconnectDelay = 1000;
Chat.heartbeatTimer = null;
Chat.sessionPollTimer = null;

// ============ WebSocket ============
Chat.connectWebSocket = function() {
    if (Chat.wsReconnectTimer) { clearTimeout(Chat.wsReconnectTimer); Chat.wsReconnectTimer = null; }

    var apiUrl = API.getActiveUrl();
    var wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws';

    try {
        Chat.ws = new WebSocket(wsUrl);
    } catch(e) {
        Chat.scheduleReconnect();
        return;
    }

    Chat.ws.onopen = function() {
        Chat.wsConnected = true;
        Chat.wsReconnectDelay = 1000;

        // 断线重连后，重置处理状态，避免前面卡住的 isProcessing 堵塞新消息
        Chat.isProcessing = false;
        Chat.pendingRequest = null;
        var headerStatus = Chat.dom.headerStatus;
        headerStatus.textContent = 'WebSocket 已连接';
        headerStatus.style.color = 'var(--accent)';

        // 认证
        Chat.sendWS({ type: 'auth', token: Chat.authToken });

        // 断线重连后自动拉最新状态
        Chat._reconnected = true;
        Chat.sendWS({ type: 'sessions' });
        Chat.sendWS({ type: 'status' });

        // === 心跳：每 30 秒发 ping（纯 WebSocket 层，不涉及 AI）===
        if (Chat.heartbeatTimer) clearInterval(Chat.heartbeatTimer);
        Chat.heartbeatTimer = setInterval(function() {
            Chat.sendWS({ type: 'ping' });
        }, 30000);

        // 不再使用轮询，完全依赖 WebSocket 推送实现多端同步
    };

    Chat.ws.onmessage = function(event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch(e) { return; }
        Chat.handleWSMessage(msg);
    };

    Chat.ws.onclose = function() {
        Chat.wsConnected = false;
        var headerStatus = Chat.dom.headerStatus;
        headerStatus.textContent = 'WebSocket 断开 · 重连中...';
        headerStatus.style.color = 'var(--danger)';

        // 断开时清理定时器，重连后重新建立
        if (Chat.heartbeatTimer) { clearInterval(Chat.heartbeatTimer); Chat.heartbeatTimer = null; }
        if (Chat.sessionPollTimer) { clearInterval(Chat.sessionPollTimer); Chat.sessionPollTimer = null; }

        Chat.scheduleReconnect();
    };

    Chat.ws.onerror = function(e) {
        // 不主动关闭，让 onclose 处理重连
        console.log('[WS] Error, will reconnect via onclose');
    };
};

Chat.sendWS = function(data) {
    if (Chat.ws && Chat.ws.readyState === WebSocket.OPEN) {
        Chat.ws.send(JSON.stringify(data));
    }
};

Chat.scheduleReconnect = function() {
    if (Chat.wsReconnectTimer) return;
    Chat.wsReconnectTimer = setTimeout(function() {
        Chat.wsReconnectTimer = null;
        Chat.wsReconnectDelay = Math.min(Chat.wsReconnectDelay * 2, 30000);
        Chat.connectWebSocket();
    }, Chat.wsReconnectDelay);
};

Chat.handleWSMessage = function(msg) {
    switch (msg.type) {
        case 'pong':
            // 心跳响应，不需要做任何事
            break;

        case 'authed':
            // 认证成功
            break;

        case 'sessions':
            var newSessions = msg.data || [];
            // 检查会话列表是否发生变化
            var sessionsChanged = false;
            if (Chat.sessions.length !== newSessions.length) {
                sessionsChanged = true;
            } else {
                for (var i = 0; i < Chat.sessions.length; i++) {
                    if (Chat.sessions[i].key !== newSessions[i].key ||
                        Chat.sessions[i].updatedAt !== newSessions[i].updatedAt) {
                        sessionsChanged = true;
                        break;
                    }
                }
            }
            Chat.sessions = newSessions;
            if (Chat.sessions.length > 0) {
                if (!Chat.currentSessionId) {
                    Chat.currentSessionId = Chat.sessions[0].key;
                    // 首次加载时更新聊天记录
                    Chat.sendWS({ type: 'session_messages', sessionKey: Chat.currentSessionId });
                } else {
                    var hasCurrentSession = false;
                    for (var i = 0; i < Chat.sessions.length; i++) {
                        if (Chat.sessions[i].key === Chat.currentSessionId) {
                            hasCurrentSession = true;
                            break;
                        }
                    }
                    if (!hasCurrentSession) {
                        Chat.currentSessionId = Chat.sessions[0].key;
                        // 当前会话被删除时更新聊天记录
                        Chat.sendWS({ type: 'session_messages', sessionKey: Chat.currentSessionId });
                    } else if (sessionsChanged || Chat._reconnected) {
                        // 会话列表发生变化时或重连后更新聊天记录，实现多端同步
                        Chat.sendWS({ type: 'session_messages', sessionKey: Chat.currentSessionId });
                    }
                }
            } else {
                Chat.currentSessionId = 'agent:main:main';
                if (Chat.chatMessages.length === 0) Chat.showWelcome();
            }
            Chat._reconnected = false;
            Chat.renderSessionList();
            break;

        case 'session_messages':
            Chat.chatMessages = msg.messages || [];
            Chat.dom.chatInner.innerHTML = '';
            if (Chat.chatMessages.length > 0) {
                Chat.hideWelcome();
                for (var i = 0; i < Chat.chatMessages.length; i++) {
                    Chat.addMessage(Chat.chatMessages[i].role === 'user' ? 'user' : 'bot', Chat.chatMessages[i].content);
                }
            } else {
                Chat.showWelcome();
            }
            Chat.scrollToBottom();
            break;

        case 'status':
            Chat.updateStatus(msg.data);
            break;

        case 'delta':
            // 流式文字块 - 所有客户端都能收到，实现多端同步
            if (!msg.content) return;
            if (!window._streamContent) window._streamContent = '';

            if (!window._streamStarted) {
                window._streamStarted = true;
                Chat.hideTyping();
                if (Chat.dom.aiMascotText) Chat.dom.aiMascotText.textContent = '';
                // 浏览器通知
                Chat.notifyNewMessage();
                // 初始化流式 TTS 队列
                Chat.initStreamTTS();
            }

            // 每次 delta 都确保气泡可见，即使用户之前点外面关掉了
            Chat.setAIState('answering');
            if (Chat.dom.aiMascotBubble) { Chat.dom.aiMascotBubble.classList.add('visible', 'answering'); }

            window._streamContent += msg.content;
            if (Chat.dom.aiMascotText) {
                Chat.dom.aiMascotText.textContent = window._streamContent;
                if (Chat.dom.aiMascotBubble) Chat.dom.aiMascotBubble.scrollTop = Chat.dom.aiMascotBubble.scrollHeight;
            }
            Chat.triggerKeywordAnimation(window._streamContent);

            // === 流式 TTS：基于 _streamContent 绝对位置分割，避免两个 buffer 不同步 ===
            Chat._tryFlushTTSChunk();
            break;

        case 'done':
            // 流式结束 - 所有客户端都能收到，实现多端同步
            var fullContent = window._streamContent || '';

            if (fullContent) {
                Chat.addMessage('bot', fullContent);
                Chat.chatMessages.push({ role: 'assistant', content: fullContent });
                Chat.saveHistory();
                Chat.scrollToBottom();
            }
            Chat.isProcessing = false;
            Chat.pendingRequest = null;
            Chat.sendWS({ type: 'sessions' });
            Chat.sendWS({ type: 'status' });
            // 流式 TTS：发送剩余文字（_streamContent 还在，flushStreamTTS 从中读取）
            Chat.flushStreamTTS(function() { Chat.finishAnswering(); });
            // 最后再清除 _streamContent
            window._streamContent = '';
            window._streamStarted = false;
            break;

        case 'error':
            Chat.pendingRequest = null;
            window._streamContent = '';
            window._streamStarted = false;
            Chat.hideTyping();
            if (Chat.dom.aiMascotBubble) Chat.dom.aiMascotBubble.classList.remove('visible');
            Chat.setAIState('idle');
            Chat.addMessage('bot', '错误: ' + (msg.message || '未知错误'));
            Chat.isProcessing = false;
            break;

        case 'deleted':
        case 'session_deleted':
            // 其他客户端删除会话时，同步更新列表
            for (var i = 0; i < Chat.sessions.length; i++) {
                if (Chat.sessions[i].key === msg.sessionKey) { Chat.sessions.splice(i, 1); break; }
            }
            if (msg.sessionKey === Chat.currentSessionId) {
                if (Chat.sessions.length > 0) {
                    Chat.currentSessionId = Chat.sessions[0].key;
                    Chat.sendWS({ type: 'session_messages', sessionKey: Chat.currentSessionId });
                } else {
                    Chat.currentSessionId = 'agent:main:main';
                    Chat.chatMessages = [];
                    Chat.dom.chatInner.innerHTML = '';
                    Chat.showWelcome();
                }
            }
            Chat.renderSessionList();
            Chat.sendWS({ type: 'status' });
            break;

        case 'file_response':
            Chat.pendingRequest = null;
            Chat.hideTyping();
            if (msg.error) {
                Chat.finishAnswering();
                Chat.addMessage('bot', '错误: ' + msg.error);
            } else if (msg.content) {
                Chat.setAIState('answering');
                Chat.typeBotMessage(msg.content);
            } else {
                Chat.finishAnswering();
                Chat.addMessage('bot', '无响应内容');
            }
            Chat.isProcessing = false;
            break;
    }
};