var Chat = Chat || {};

// ============ AI Mascot 状态 ============
Chat._keywordAnimations = [
    { keywords: ['你好', 'hello', 'hi', '嗨'], anim: 'wave' },
    { keywords: ['跳', '蹦', '开心', '高兴', '太好了', '哈哈', '嘿嘿', '嘻嘻'], anim: 'jump' },
    { keywords: ['跳舞', '舞蹈', '扭', '摇摆'], anim: 'dance' },
    { keywords: ['对', '是的', '没错', '正确', '嗯', '好', 'ok'], anim: 'nod' },
    { keywords: ['不对', '不行', '不是', '错了', '错误', 'no'], anim: 'shake' }
];
Chat._triggeredAnims = {};

// ============ 消息渲染 ============
Chat.addMessage = function(sender, content) {
    var chatInner = Chat.dom.chatInner;
    var msgDiv = document.createElement('div');
    msgDiv.className = 'message ' + (sender === 'user' ? 'user-message' : 'bot-message');
    var time = Chat.getTimeStr();

    if (sender === 'user') {
        msgDiv.innerHTML = '<div class="msg-avatar">' +
            '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="8" r="4" fill="white"/>' +
            '<ellipse cx="12" cy="18" rx="8" ry="5" fill="white"/></svg></div>' +
            '<div class="msg-bubble user-bubble"><span class="msg-text">' + Chat.escapeHtml(content) + '</span><span class="msg-time">' + time + '</span></div>';
    } else {
        msgDiv.innerHTML = '<div class="msg-avatar">' +
            '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="none" stroke="white" stroke-width="1.5"/>' +
            '<circle cx="9" cy="10" r="2" fill="white"/><circle cx="15" cy="10" r="2" fill="white"/>' +
            '<path d="M8 15 Q12 18 16 15" fill="none" stroke="white" stroke-width="1.2"/></svg></div>' +
            '<div class="msg-bubble bot-bubble"><span class="msg-text">' + Chat.formatMessage(content) + '</span><span class="msg-time">' + time + '</span></div>';
    }

    chatInner.appendChild(msgDiv);
    Chat.scrollToBottom();

    if (sender === 'bot') {
        msgDiv.addEventListener('click', function(e) {
            var existing = document.querySelector('.msg-speak-btn');
            if (existing) existing.remove();
            var btn = document.createElement('button');
            btn.className = 'msg-speak-btn';
            btn.textContent = '🔊 朗读';
            btn.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;z-index:9999';
            document.body.appendChild(btn);
            btn.addEventListener('click', function(ev) {
                ev.stopPropagation(); btn.remove();
                if (content && window.speechSynthesis) Chat.speakTextWithTyping(content);
            });
            function removeBtn(ev2) { if (ev2.target !== btn) { btn.remove(); document.removeEventListener('click', removeBtn); } }
            setTimeout(function() { document.addEventListener('click', removeBtn); }, 0);
        });
    }
};

Chat.formatMessage = function(content) {
    var lines = content.split('\n');
    var result = [];
    var inCodeBlock = false;
    var codeContent = [];

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^```/.test(line)) {
            if (inCodeBlock) { result.push('<pre><code>' + Chat.escapeHtml(codeContent.join('\n')) + '</code></pre>'); codeContent = []; inCodeBlock = false; }
            else { inCodeBlock = true; }
            continue;
        }
        if (inCodeBlock) { codeContent.push(line); continue; }

        var processed = Chat.escapeHtml(line);
        processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');
        processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');
        processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, text, url) {
            // 防止 javascript: 等危险协议
            var safe = url.replace(/&amp;/g, '&');
            if (/^(https?:)?\/\//i.test(safe) || /^[#\/]/.test(safe)) {
                return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
            }
            return text;
        });
        if (/^### (.+)/.test(processed)) processed = processed.replace(/^### (.+)/, '<h3>$1</h3>');
        else if (/^## (.+)/.test(processed)) processed = processed.replace(/^## (.+)/, '<h2>$1</h2>');
        else if (/^# (.+)/.test(processed)) processed = processed.replace(/^# (.+)/, '<h1>$1</h1>');

        if (/^[\-\*] (.+)/.test(processed)) {
            var isFirst = i === 0 || !/^[\-\*] /.test(lines[i-1]);
            processed = processed.replace(/^[\-\*] (.+)/, function(m, item) { return (isFirst ? '<ul>' : '') + '<li>' + item + '</li>'; });
            var isLast = i === lines.length-1 || !/^[\-\*] /.test(lines[i+1]);
            if (isLast) processed += '</ul>';
        }
        if (/^\d+\. (.+)/.test(processed)) {
            var isFirstOl = i === 0 || !/^\d+\. /.test(lines[i-1]);
            processed = processed.replace(/^\d+\. (.+)/, function(m, item) { return (isFirstOl ? '<ol>' : '') + '<li>' + item + '</li>'; });
            var isLastOl = i === lines.length-1 || !/^\d+\. /.test(lines[i+1]);
            if (isLastOl) processed += '</ol>';
        }
        result.push(processed);
    }
    if (inCodeBlock) result.push('<pre><code>' + Chat.escapeHtml(codeContent.join('\n')) + '</code></pre>');
    return result.join('<br>');
};

Chat.typeBotMessage = function(fullText) {
    var chatInner = Chat.dom.chatInner;
    var aiMascotText = Chat.dom.aiMascotText;
    var aiMascotBubble = Chat.dom.aiMascotBubble;

    Chat.hideTyping();
    Chat.setAIState('answering');
    Chat.speakText(fullText);

    if (aiMascotText) aiMascotText.textContent = '';
    if (aiMascotBubble) { aiMascotBubble.classList.add('visible', 'answering'); }

    var index = 0, totalLen = fullText.length, baseDelay = 10, displayText = '';

    function typeChar() {
        if (index >= totalLen) {
            var now = new Date();
            var time = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
            var msgDiv = document.createElement('div');
            msgDiv.className = 'message bot-message';
            msgDiv.innerHTML = '<div class="msg-avatar"><svg viewBox="0 0 24 24" width="18" height="18">' +
                '<circle cx="12" cy="12" r="10" fill="none" stroke="white" stroke-width="1.5"/>' +
                '<circle cx="9" cy="10" r="2" fill="white"/><circle cx="15" cy="10" r="2" fill="white"/>' +
                '<path d="M8 15 Q12 18 16 15" fill="none" stroke="white" stroke-width="1.2"/></svg></div>' +
                '<div class="msg-bubble bot-bubble"><span class="msg-text">' + Chat.formatMessage(fullText) + '</span><span class="msg-time">' + time + '</span></div>';
            chatInner.appendChild(msgDiv);
            Chat.chatMessages.push({ role: 'assistant', content: fullText });
            Chat.saveHistory();
            Chat.scrollToBottom();
            Chat.isProcessing = false;
            Chat.sendWS({ type: 'sessions' });
            Chat.sendWS({ type: 'status' });
            return;
        }
        displayText += fullText.charAt(index); index++;
        if (aiMascotText) aiMascotText.textContent = displayText;
        if (aiMascotBubble) aiMascotBubble.scrollTop = aiMascotBubble.scrollHeight;
        var delay = baseDelay;
        if (index > 0 && fullText.charAt(index-1) === '\n') delay = baseDelay * 3;
        if (index < totalLen && fullText.charAt(index) === '\n') delay = baseDelay * 2;
        setTimeout(typeChar, delay);
    }
    typeChar();
};

// ============ AI Mascot ============
Chat._updateThinkBarPos = function() {
    var aiMascot = Chat.dom.aiMascot;
    if (!aiMascot) return;
    var rect = aiMascot.getBoundingClientRect();
    if (rect.left + rect.width / 2 > window.innerWidth / 2) { aiMascot.classList.add('think-left'); }
    else { aiMascot.classList.remove('think-left'); }
};

Chat._saveMascotPos = function() {
    var aiMascot = Chat.dom.aiMascot;
    if (!aiMascot || window._xlx_mascot_saved) return;
    var left = aiMascot.style.left, top = aiMascot.style.top, bottom = aiMascot.style.bottom;
    if ((left && left !== 'auto') || (top && top !== 'auto') || (bottom && bottom !== 'auto')) {
        window._xlx_mascot_saved = { left: left, top: top, bottom: bottom };
    }
};

Chat._restoreMascotPos = function() {
    var aiMascot = Chat.dom.aiMascot;
    if (!aiMascot) return;
    var saved = window._xlx_mascot_saved;
    if (saved && saved.left) {
        aiMascot.style.left = saved.left; aiMascot.style.top = saved.top; aiMascot.style.bottom = saved.bottom;
    } else {
        var raw = localStorage.getItem('xlx_mascot_pos');
        if (raw) {
            try {
                var pos = JSON.parse(raw);
                var vw = window.innerWidth, vh = window.innerHeight;
                if (pos.x >= -50 && pos.x <= vw - 50 && pos.y >= -50 && pos.y <= vh - 50) {
                    aiMascot.style.left = pos.x + 'px'; aiMascot.style.top = pos.y + 'px'; aiMascot.style.bottom = 'auto'; return;
                }
            } catch(e) {}
        }
        aiMascot.style.left = '20px'; aiMascot.style.bottom = '20px'; aiMascot.style.top = 'auto';
    }
};

Chat.setAIState = function(state) {
    var aiMascot = Chat.dom.aiMascot;
    var aiBackdrop = Chat.dom.aiBackdrop;
    var isAnim = (state === 'wave' || state === 'jump' || state === 'dance' || state === 'nod' || state === 'shake');
    
    if (!aiMascot) return;
    
    var currentAnims = [];
    if (aiMascot.classList.contains('wave')) currentAnims.push('wave');
    if (aiMascot.classList.contains('jump')) currentAnims.push('jump');
    if (aiMascot.classList.contains('dance')) currentAnims.push('dance');
    if (aiMascot.classList.contains('nod')) currentAnims.push('nod');
    if (aiMascot.classList.contains('shake')) currentAnims.push('shake');
    
    if (!isAnim) aiMascot.classList.remove('thinking', 'speaking', 'answering', 'wave', 'jump', 'dance', 'nod', 'shake');
    
    if (state === 'thinking') {
        aiMascot.classList.add('thinking');
        aiMascot.classList.add.apply(aiMascot.classList, currentAnims);
        Chat._saveMascotPos();
        Chat._updateThinkBarPos();
        if (aiBackdrop) aiBackdrop.classList.remove('active');
    } else if (state === 'speaking') {
        aiMascot.classList.remove('think-left');
        aiMascot.style.left = '50%';
        aiMascot.style.top = 'auto';
        aiMascot.style.bottom = '8%';
        aiMascot.style.transform = 'translate(-50%, 0)';
        aiMascot.classList.add('answering', 'speaking');
        aiMascot.classList.add.apply(aiMascot.classList, currentAnims);
        Chat._saveMascotPos();
        if (aiBackdrop) aiBackdrop.classList.add('active');
    } else if (state === 'answering') {
        aiMascot.classList.remove('think-left');
        aiMascot.style.left = '50%';
        aiMascot.style.top = 'auto';
        aiMascot.style.bottom = '8%';
        aiMascot.style.transform = 'translate(-50%, 0)';
        aiMascot.classList.add('answering');
        aiMascot.classList.add.apply(aiMascot.classList, currentAnims);
        Chat._saveMascotPos();
        if (aiBackdrop) aiBackdrop.classList.add('active');
    } else if (state === 'idle') {
        aiMascot.style.transform = '';
        aiMascot.classList.remove('think-left');
        aiMascot.classList.add.apply(aiMascot.classList, currentAnims);
        Chat._restoreMascotPos();
        window._xlx_mascot_saved = null;
        if (aiBackdrop) aiBackdrop.classList.remove('active');
    } else if (isAnim) {
        aiMascot.classList.remove('wave', 'jump', 'dance', 'nod', 'shake');
        aiMascot.classList.add(state);
        setTimeout(function(a) { if (aiMascot) aiMascot.classList.remove(a); }, 2000, state);
    }
};

Chat.triggerKeywordAnimation = function(text) {
    var tail = text.slice(-200).toLowerCase();
    for (var i = 0; i < Chat._keywordAnimations.length; i++) {
        for (var j = 0; j < Chat._keywordAnimations[i].keywords.length; j++) {
            if (tail.indexOf(Chat._keywordAnimations[i].keywords[j]) >= 0) {
                if (!Chat._triggeredAnims[Chat._keywordAnimations[i].anim]) {
                    Chat._triggeredAnims[Chat._keywordAnimations[i].anim] = true;
                    Chat.setAIState(Chat._keywordAnimations[i].anim);
                    setTimeout(function(a) { Chat._triggeredAnims[a] = false; }, 3000, Chat._keywordAnimations[i].anim);
                }
                return;
            }
        }
    }
};

Chat.initMascotDrag = function() {
    var aiMascot = Chat.dom.aiMascot;
    if (!aiMascot) return;
    var isDragging = false, startX, startY, origLeft, origTop, dragStartLeft, dragStartTop;

    aiMascot.style.display = ''; aiMascot.style.visibility = 'visible'; aiMascot.style.opacity = '1';

    var saved = localStorage.getItem('xlx_mascot_pos');
    var appliedPos = false;
    if (saved) {
        try {
            var pos = JSON.parse(saved);
            var vw = window.innerWidth, vh = window.innerHeight;
            if (pos.x >= 0 && pos.x <= vw - 50 && pos.y >= 0 && pos.y <= vh - 50) {
                aiMascot.style.left = pos.x + 'px'; aiMascot.style.top = pos.y + 'px'; aiMascot.style.bottom = 'auto'; appliedPos = true;
            }
        } catch(e) {}
    }
    if (!appliedPos) { localStorage.removeItem('xlx_mascot_pos'); aiMascot.style.left = '20px'; aiMascot.style.bottom = '20px'; aiMascot.style.top = 'auto'; }

    aiMascot.style.pointerEvents = 'auto'; aiMascot.style.cursor = 'grab';

    aiMascot.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    aiMascot.addEventListener('mousedown', function(e) {
        if (e.target.closest('.ai-mascot-bubble')) return;
        e.preventDefault();
        isDragging = true;
        aiMascot.style.cursor = 'grabbing';
        aiMascot.style.transition = 'none';
        var rect = aiMascot.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        origLeft = rect.left;
        origTop = rect.top;
        dragStartLeft = parseInt(aiMascot.style.left) || 0;
        dragStartTop = parseInt(aiMascot.style.top) || 0;
    });
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        var deltaX = e.clientX - startX;
        var deltaY = e.clientY - startY;
        var newLeft = dragStartLeft + deltaX;
        var newTop = dragStartTop + deltaY;
        var rect = aiMascot.getBoundingClientRect();
        var maxLeft = window.innerWidth - rect.width - 10;
        var maxTop = window.innerHeight - rect.height - 10;
        newLeft = Math.max(10, Math.min(newLeft, maxLeft));
        newTop = Math.max(10, Math.min(newTop, maxTop));
        aiMascot.style.left = newLeft + 'px';
        aiMascot.style.top = newTop + 'px';
        aiMascot.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function() {
        if (!isDragging) return;
        isDragging = false;
        aiMascot.style.cursor = 'grab';
        aiMascot.style.transition = '';
        var currentLeft = parseInt(aiMascot.style.left) || 0;
        var currentTop = parseInt(aiMascot.style.top) || 0;
        localStorage.setItem('xlx_mascot_pos', JSON.stringify({ x: currentLeft, y: currentTop }));
    });
    aiMascot.addEventListener('touchstart', function(e) {
        if (e.target.closest('.ai-mascot-bubble')) return;
        isDragging = true;
        aiMascot.style.transition = 'none';
        var rect = aiMascot.getBoundingClientRect();
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        origLeft = rect.left;
        origTop = rect.top;
        dragStartLeft = parseInt(aiMascot.style.left) || 0;
        dragStartTop = parseInt(aiMascot.style.top) || 0;
    }, { passive: false });
    document.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        e.preventDefault();
        var deltaX = e.touches[0].clientX - startX;
        var deltaY = e.touches[0].clientY - startY;
        var newLeft = dragStartLeft + deltaX;
        var newTop = dragStartTop + deltaY;
        var rect = aiMascot.getBoundingClientRect();
        var maxLeft = window.innerWidth - rect.width - 10;
        var maxTop = window.innerHeight - rect.height - 10;
        newLeft = Math.max(10, Math.min(newLeft, maxLeft));
        newTop = Math.max(10, Math.min(newTop, maxTop));
        aiMascot.style.left = newLeft + 'px';
        aiMascot.style.top = newTop + 'px';
        aiMascot.style.bottom = 'auto';
    }, { passive: false });
    document.addEventListener('touchend', function() {
        if (!isDragging) return;
        isDragging = false;
        aiMascot.style.transition = '';
        var currentLeft = parseInt(aiMascot.style.left) || 0;
        var currentTop = parseInt(aiMascot.style.top) || 0;
        localStorage.setItem('xlx_mascot_pos', JSON.stringify({ x: currentLeft, y: currentTop }));
    });
};

Chat.showMascotBubble = function(text) {
    var aiMascotBubble = Chat.dom.aiMascotBubble;
    var aiMascotText = Chat.dom.aiMascotText;
    if (!aiMascotBubble || !aiMascotText) return;
    aiMascotText.textContent = text; aiMascotBubble.classList.add('visible');
    if (Chat.dom.aiMascot && Chat.dom.aiMascot.classList.contains('answering')) aiMascotBubble.classList.add('answering');
};

Chat.hideMascotBubble = function() { if (Chat.dom.aiMascotBubble) { Chat.dom.aiMascotBubble.classList.remove('visible', 'answering'); } };

Chat.finishAnswering = function() {
    Chat.stopSpeaking();
    setTimeout(function() { Chat.hideMascotBubble(); Chat.setAIState('idle'); }, 2000);
};