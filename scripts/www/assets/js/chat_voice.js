var Chat = Chat || {};

// ============ 发送消息 ============
Chat.sendMessage = function() {
    Chat.stopSpeaking();
    if (Chat.isProcessing || !Chat.wsConnected) return;

    // 解锁音频（iOS 需要用户手势后才能播放 AudioContext）
    Chat._unlockAudio();

    var messageInput = Chat.dom.messageInput;
    var text = messageInput.value.trim();
    if (!text && Chat.selectedFiles.length === 0) return;

    Chat.unlockSpeech();

    if (Chat.selectedFiles.length > 0) {
        Chat.sendWithFiles(text);
        return;
    }

    Chat.isProcessing = true;
    Chat.pendingRequest = 'chat';
    Chat.hideWelcome();
    messageInput.value = '';
    messageInput.style.height = 'auto';
    Chat.updateSendButton();

    Chat.addMessage('user', text);
    Chat.chatMessages.push({ role: 'user', content: text });
    Chat.showTyping();
    Chat.setAIState('thinking');
    Chat.scrollToBottom();

    Chat.sendWS({
        type: 'chat',
        message: text,
        sessionKey: Chat.currentSessionId || 'agent:main:main',
        temperature: parseFloat(localStorage.getItem('xlx_temperature')) || 0.7
    });
};

Chat.sendWithFiles = function(text) {
    Chat.stopSpeaking();
    var messageInput = Chat.dom.messageInput;

    Chat.isProcessing = true;
    Chat.pendingRequest = 'file';
    Chat.hideWelcome();

    var fileNames = [];
    var fileContents = [];

    var readPromises = Chat.selectedFiles.map(function(file) {
        return new Promise(function(resolve) {
            fileNames.push(file.name);
            var reader = new FileReader();
            reader.onload = function(e) {
                var content = e.target.result;
                if (file.type.match(/^text\//) || file.name.match(/\.(txt|md|json|js|css|html|xml|yaml|yml|py|java|c|cpp|h|ts|tsx|jsx)$/i)) {
                    fileContents.push('=== ' + file.name + ' ===\n' + content);
                } else {
                    fileContents.push('[文件: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)]');
                }
                resolve();
            };
            reader.onerror = function() { fileContents.push('[文件: ' + file.name + ' - 无法读取]'); resolve(); };
            if (file.type.match(/^image\//)) {
                fileContents.push('[图片: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)]');
                resolve();
            } else {
                reader.readAsText(file);
            }
        });
    });

    Promise.all(readPromises).then(function() {
        var displayText = text || '发送了文件';
        if (fileNames.length > 0) displayText += '\n[附件: ' + fileNames.join(', ') + ']';
        Chat.addMessage('user', displayText);

        var fullMessage = text;
        if (fileContents.length > 0) fullMessage = (text ? text + '\n\n' : '') + fileContents.join('\n\n');

        Chat.chatMessages.push({ role: 'user', content: fullMessage });
        Chat.saveHistory();

        messageInput.value = '';
        messageInput.style.height = 'auto';
        Chat.clearFiles();
        Chat.updateSendButton();
        Chat.showTyping();
        Chat.setAIState('thinking');
        Chat.showMascotBubble('正在分析文件...');
        Chat.scrollToBottom();

        Chat.sendWS({
            type: 'chat',
            message: fullMessage,
            sessionKey: Chat.currentSessionId || 'agent:main:main',
            temperature: parseFloat(localStorage.getItem('xlx_temperature')) || 0.7
        });
    });
};

// ============ 文件处理 ============
Chat.handleFileSelect = function(e) {
    var files = Array.from(e.target.files);
    if (files.length === 0) return;
    Chat.selectedFiles = Chat.selectedFiles.concat(files);
    Chat.renderFilePreviews();
    Chat.updateSendButton();
    Chat.dom.fileInput.value = '';
};

Chat.renderFilePreviews = function() {
    var filePreviewBar = Chat.dom.filePreviewBar;
    filePreviewBar.innerHTML = '';
    Chat.selectedFiles.forEach(function(file, index) {
        var item = document.createElement('div');
        item.className = 'file-preview-item';
        var icon = file.type.match(/^image\//) ? '&#128247;' : '&#128196;';
        item.innerHTML = '<span>' + icon + '</span><span>' + Chat.truncate(file.name, 20) + '</span><span class="file-remove" data-index="' + index + '">×</span>';
        filePreviewBar.appendChild(item);
    });
    filePreviewBar.querySelectorAll('.file-remove').forEach(function(el) {
        el.addEventListener('click', function() {
            Chat.selectedFiles.splice(parseInt(el.getAttribute('data-index')), 1);
            Chat.renderFilePreviews();
            Chat.updateSendButton();
        });
    });
};

Chat.clearFiles = function() { Chat.selectedFiles = []; Chat.dom.filePreviewBar.innerHTML = ''; };

// ============ 语音识别 ============
Chat._voiceFinalText = '';

Chat.toggleVoice = function() {
    Chat.stopSpeaking();
    if (Chat.isRecording) { Chat.stopVoice(); return; }

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { Chat.showToast('浏览器不支持语音识别'); return; }

    // iOS Safari 修复：确保上一个实例完全销毁后创建全新的
    if (Chat.recognition) {
        try { Chat.recognition.abort(); } catch(e) {}
        Chat.recognition = null;
    }

    Chat.recognition = new SpeechRecognition();
    Chat.recognition.lang = 'zh-CN';
    Chat.recognition.continuous = false;   // iOS 兼容性更好，避免 restart 导致后续识别不准
    Chat.recognition.interimResults = true;
    Chat.recognition.maxAlternatives = 1;

    var voiceOverlay = Chat.dom.voiceOverlay;
    var btnVoice = Chat.dom.btnVoice;
    var voiceText = Chat.dom.voiceText;
    var messageInput = Chat.dom.messageInput;

    Chat._voiceFinalText = '';
    Chat.recognition.onstart = function() {
        Chat.isRecording = true;
        voiceOverlay.classList.add('active');
        btnVoice.classList.add('recording');
        voiceText.textContent = '正在聆听...';
    };

    Chat.recognition.onresult = function(event) {
        var interim = '';
        var newFinal = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                newFinal += event.results[i][0].transcript;
            } else {
                interim += event.results[i][0].transcript;
            }
        }
        if (newFinal) {
            Chat._voiceFinalText += (Chat._voiceFinalText ? '' : '') + newFinal;
            voiceText.textContent = Chat._voiceFinalText;
            messageInput.value = Chat._voiceFinalText;
            Chat.updateSendButton();
            Chat.autoResizeTextarea();
        } else if (interim) {
            voiceText.textContent = Chat._voiceFinalText + (Chat._voiceFinalText ? '' : '') + interim;
            messageInput.value = Chat._voiceFinalText + (Chat._voiceFinalText ? '' : '') + interim;
            Chat.updateSendButton();
            Chat.autoResizeTextarea();
        }
    };

    Chat.recognition.onerror = function(event) {
        if (event.error === 'no-speech') {
            voiceText.textContent = '未检测到语音...';
        } else if (event.error !== 'aborted') {
            voiceText.textContent = '识别错误: ' + event.error;
            Chat.showToast('语音识别错误: ' + event.error);
        }
    };

    Chat.recognition.onend = function() {
        // continuous=false 时，onend 表示语音结束，自动停止录音
        if (Chat.isRecording) {
            Chat.stopVoice();
        }
    };

    Chat.recognition.start();
};

Chat.stopVoice = function() {
    Chat.isRecording = false;
    if (Chat.recognition) {
        // iOS Safari 修复：用 abort() 替代 stop()，清理更彻底
        try { Chat.recognition.abort(); } catch(e) {}
        Chat.recognition = null;
    }
    var voiceOverlay = Chat.dom.voiceOverlay;
    var btnVoice = Chat.dom.btnVoice;
    if (voiceOverlay) voiceOverlay.classList.remove('active');
    if (btnVoice) btnVoice.classList.remove('recording');
};

// ============ TTS 语音朗读 ============
Chat.unlockSpeech = function() {
    if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); }
};

Chat.cleanTextForSpeech = function(text) {
    var cleaned = text;
    cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1');
    cleaned = cleaned.replace(/~~(.+?)~~/g, '$1').replace(/`{1,3}(.+?)`{1,3}/g, '$1').replace(/^#{1,6}\s+/gm, '');
    cleaned = cleaned.replace(/\n-{3,}\n/g, '\n').replace(/\[(.+?)\]\(.+?\)/g, '$1').replace(/!\[.*?\]\(.+?\)/g, '');
    cleaned = cleaned.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').replace(/\s{2,}/g, ' ');
    return cleaned.trim();
};

// 通过 server.py 中转调 3060 TTS
Chat._speakViaTTSProxy = function(cleanText, onDone) {
    var voice = localStorage.getItem('xlx_tts_voice') || 'zh-CN-XiaoxiaoNeural';
    var url = API.getTTSUrl(cleanText, voice);

    fetch(url, { method: 'GET', cache: 'no-cache' }).then(function(resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.blob();
    }).then(function(blob) {
        Chat._playBlob(blob, function() {
            // onEnd
            Chat.setAIState('answering');
            if (onDone) onDone();
        }, function() {
            // onError
            Chat.setAIState('answering');
            if (onDone) onDone();
        });
    }).catch(function() {
        Chat.setAIState('answering');
        if (onDone) onDone();
    });
};

// 回退：用浏览器原生 speechSynthesis 朗读
Chat._fallbackSpeak = function(cleanText, onDone) {
    if (!window.speechSynthesis) { if (onDone) onDone(); return; }
    var utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'zh-CN';
    utterance.rate = parseFloat(localStorage.getItem('xlx_speech_rate')) || 1.6;
    utterance.pitch = 1.0;
    utterance.onend = function() { window._xlx_utterance = null; Chat.setAIState('answering'); if (onDone) onDone(); else Chat.finishAnswering(); };
    utterance.onerror = function() { window._xlx_utterance = null; Chat.setAIState('answering'); if (onDone) onDone(); else Chat.finishAnswering(); };
    window._xlx_utterance = utterance;
    var voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
        speechSynthesis.onvoiceschanged = function() { voices = speechSynthesis.getVoices(); Chat.setBestVoice(utterance, voices); speechSynthesis.speak(utterance); };
    } else { Chat.setBestVoice(utterance, voices); speechSynthesis.speak(utterance); }
};

Chat.speakText = function(text, onDone) {
    Chat.stopSpeaking();
    var cleanText = Chat.cleanTextForSpeech(text);
    if (!cleanText) { if (onDone) onDone(); return; }
    Chat.setAIState('speaking');

    if (Chat.dom.aiMascotText) Chat.dom.aiMascotText.textContent = cleanText;
    if (Chat.dom.aiMascotBubble) {
        Chat.dom.aiMascotBubble.classList.remove('visible', 'answering');
        void Chat.dom.aiMascotBubble.offsetHeight;
        Chat.dom.aiMascotBubble.classList.add('visible', 'answering');
    }

    // 优先走 3060 TTS 中转，失败回退浏览器 speechSynthesis
    Chat._speakViaTTSProxy(cleanText, onDone);
};

Chat.setBestVoice = function(utterance, voices) {
    var preferred = null, fallback = null;
    for (var i = 0; i < voices.length; i++) {
        if (voices[i].lang === 'zh-CN' || voices[i].lang.indexOf('zh-CN') >= 0) {
            if (voices[i].name.indexOf('Xiaoxiao') >= 0 || voices[i].name.indexOf('Yunyang') >= 0 ||
                voices[i].name.indexOf('HuiHui') >= 0 || voices[i].name.indexOf('Xiaoyi') >= 0) { preferred = voices[i]; break; }
            if (!fallback) fallback = voices[i];
        }
    }
    if (preferred) utterance.voice = preferred; else if (fallback) utterance.voice = fallback;
};

Chat.stopSpeaking = function() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    window._xlx_utterance = null;
    if (window._xlx_tts_audio) { window._xlx_tts_audio.pause(); window._xlx_tts_audio = null; }
    Chat.stopTTSQueue();
};

// ============ 语音列表：从后端动态获取 ============
Chat.initVoiceList = function() {
    var select = document.getElementById('ttsVoiceSelect');
    if (!select) return;

    API.getTTSVoices()
        .then(function(voices) {
            if (!Array.isArray(voices) || voices.length === 0) {
                console.warn('[Voice] No voices returned from server, keeping defaults');
                return;
            }

            var savedVoice = localStorage.getItem('xlx_tts_voice') || 'zh-CN-XiaoxiaoNeural';
            if (!localStorage.getItem('xlx_tts_voice')) {
                localStorage.setItem('xlx_tts_voice', savedVoice);
            }
            select.innerHTML = '';
            var found = false;

            voices.forEach(function(v) {
                var opt = document.createElement('option');
                opt.value = v.name;
                opt.textContent = v.display || v.name;
                if (v.name === savedVoice) {
                    opt.selected = true;
                    found = true;
                }
                select.appendChild(opt);
            });

            // 已保存的声音不在列表中（可能是自定义/旧数据），追加保留
            if (!found && savedVoice) {
                var opt = document.createElement('option');
                opt.value = savedVoice;
                opt.textContent = savedVoice;
                opt.selected = true;
                select.appendChild(opt);
            }

            // 监听选择变化，保存到 localStorage
            select.addEventListener('change', function() {
                localStorage.setItem('xlx_tts_voice', select.value);
                console.log('[Voice] Switched to:', select.value);
            });

            console.log('[Voice] Loaded ' + voices.length + ' voices, selected: ' + (savedVoice));
        })
        .catch(function(err) {
            console.error('[Voice] Failed to fetch voice list:', err);
        });
};

// ============ TTS 朗读 + 打字机效果 ============
Chat.speakTextWithTyping = function(text) {
    Chat.stopSpeaking();
    var cleanText = Chat.cleanTextForSpeech(text);
    if (!cleanText) return;

    // 先显示气泡和机器人
    Chat.setAIState('speaking');

    // 设置气泡内容并强制显示
    if (Chat.dom.aiMascotText) Chat.dom.aiMascotText.textContent = '';
    if (Chat.dom.aiMascotBubble) {
        Chat.dom.aiMascotBubble.classList.remove('visible', 'answering');
        // 强制回流后重新添加类，确保动画触发
        void Chat.dom.aiMascotBubble.offsetHeight;
        Chat.dom.aiMascotBubble.classList.add('visible', 'answering');
        Chat.dom.aiMascotBubble.style.display = '';
    }

    // 打字机效果：逐字显示
    var index = 0;
    var _typingTimer = null;
    function typeChar() {
        if (index >= cleanText.length) return;
        if (Chat.dom.aiMascotText) {
            Chat.dom.aiMascotText.textContent = cleanText.substring(0, index + 1);
        }
        index++;
        if (Chat.dom.aiMascotBubble) {
            Chat.dom.aiMascotBubble.scrollTop = Chat.dom.aiMascotBubble.scrollHeight;
        }
        _typingTimer = setTimeout(typeChar, 30);
    }
    // 延迟一点开始打字，让气泡先显示出来
    setTimeout(typeChar, 200);

    // 优先走 3060 TTS 中转，失败回退浏览器 speechSynthesis
    function _onTTSDone() {
        clearTimeout(_typingTimer);
        if (Chat.dom.aiMascotText) Chat.dom.aiMascotText.textContent = cleanText;
        Chat.setAIState('answering');
        Chat.finishAnswering();
    }
    Chat._speakViaTTSProxy(cleanText, _onTTSDone);
};

// ============ 流式 TTS 队列播放 ============

// AudioContext 单例（用于绕过 iOS 自动播放限制）
Chat._getAudioCtx = function() {
    if (!Chat._audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
            Chat._audioCtx = new AC();
            // 尝试立即恢复（如果之前已通过用户手势解锁）
            if (Chat._audioCtx.state === 'suspended') {
                Chat._audioCtx.resume();
            }
        }
    }
    return Chat._audioCtx;
};

// 在用户首次交互时解锁 AudioContext（iOS 要求）
Chat._unlockAudio = function() {
    if (Chat._audioUnlocked) return;
    var ctx = Chat._getAudioCtx();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(function() {
            Chat._audioUnlocked = true;
        }).catch(function() {});
    } else if (ctx) {
        Chat._audioUnlocked = true;
    }
};

// 用 AudioContext 播放 blob（兼容 iOS）
Chat._playBlob = function(blob, onEnd, onError) {
    var ctx = Chat._getAudioCtx();
    if (!ctx) {
        // 无 AudioContext，回退到 <audio>（非 iOS 设备）
        var blobUrl = URL.createObjectURL(blob);
        var audio = new Audio(blobUrl);
        audio.onended = function() { URL.revokeObjectURL(blobUrl); if (onEnd) onEnd(); };
        audio.onerror = function() { URL.revokeObjectURL(blobUrl); if (onError) onError(); };
        audio.play().catch(function() { URL.revokeObjectURL(blobUrl); if (onError) onError(); });
        return;
    }

    // 用 FileReader 读取 blob 为 ArrayBuffer
    var reader = new FileReader();
    reader.onload = function() {
        ctx.decodeAudioData(reader.result, function(buffer) {
            var source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.onended = function() { if (onEnd) onEnd(); };
            source.start(0);
        }, function() { if (onError) onError(); });
    };
    reader.onerror = function() { if (onError) onError(); };
    reader.readAsArrayBuffer(blob);
};

// 初始化流式 TTS 状态
Chat.initStreamTTS = function() {
    Chat.stopTTSQueue();
    Chat._ttsLastSentPos = 0;
    Chat._ttsQueue = [];
    Chat._ttsIsPlaying = false;
    Chat._ttsStreamDone = false;
    Chat._ttsOnStreamDone = null;
    Chat._ttsChunkIndex = 0;
    Chat._ttsNextPlayIndex = 0;
};

// 停止并清理流式 TTS 队列
Chat.stopTTSQueue = function() {
    Chat._ttsIsPlaying = false;
    Chat._ttsStreamDone = false;
    Chat._ttsOnStreamDone = null;
    Chat._ttsLastSentPos = 0;
    Chat._ttsQueue = [];
    Chat._ttsChunkIndex = 0;
    Chat._ttsNextPlayIndex = 0;
    // 停止 AudioContext 中的播放
    if (Chat._audioCtx) {
        try { Chat._audioCtx.close(); } catch(e) {}
        Chat._audioCtx = null;
    }
    Chat._audioUnlocked = false;
};

// 尝试发送 TTS 缓冲区块：基于 _streamContent 绝对位置分割，绝不重复
Chat._tryFlushTTSChunk = function() {
    var fullText = window._streamContent || '';
    var pos = Chat._ttsLastSentPos || 0;
    var remaining = fullText.substring(pos);
    var MIN_CHUNK = 15;
    var MAX_CHUNK = 50;

    if (remaining.length < MIN_CHUNK) return;

    var cutIdx = -1;
    var boundaries = ['。', '！', '？', '\n', '.', '!', '?', '；', ';'];
    var lastBoundary = -1;
    var searchEnd = Math.min(remaining.length, MAX_CHUNK);

    for (var i = 0; i < searchEnd; i++) {
        if (boundaries.indexOf(remaining[i]) >= 0) {
            if (i + 1 >= MIN_CHUNK) { cutIdx = i + 1; break; }
            lastBoundary = i + 1;
        }
    }
    if (cutIdx < 0 && lastBoundary > 0) {
        cutIdx = lastBoundary;
    }

    if (cutIdx < 0 && remaining.length >= MAX_CHUNK) {
        cutIdx = MAX_CHUNK;
        for (var j = MAX_CHUNK - 1; j >= 0; j--) {
            if (remaining[j] === ' ' || remaining[j] === '，' || remaining[j] === ',') {
                cutIdx = j + 1; break;
            }
        }
    }

    if (cutIdx > 0) {
        var chunk = remaining.substring(0, cutIdx);
        // 绝对位置推进，绝不产生重叠
        Chat._ttsLastSentPos = pos + cutIdx;
        Chat.streamTTSChunk(chunk);
    }
};

Chat._ttsLastRequestTime = 0;

// 发送一段文字到 TTS，并将返回的音频加入队列
Chat.streamTTSChunk = function(text) {
    var cleanText = Chat.cleanTextForSpeech(text);
    if (!cleanText) return;

    var voice = localStorage.getItem('xlx_tts_voice') || 'zh-CN-XiaoxiaoNeural';
    var url = API.getTTSUrl(cleanText, voice);
    var chunkIndex = Chat._ttsChunkIndex++;

    // 限流：每条 TTS 请求间隔至少 500ms，避免 edge-tts 后端过载
    var now = Date.now();
    var minGap = 500;
    var timeSinceLast = now - (Chat._ttsLastRequestTime || 0);
    var delay = timeSinceLast < minGap ? (minGap - timeSinceLast) : 0;
    Chat._ttsLastRequestTime = now + delay;

    var doFetch = function() {
        fetch(url, { method: 'GET', cache: 'no-cache' }).then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.blob();
        }).then(function(blob) {
            Chat._ttsQueue.push({ blob: blob, index: chunkIndex });
            Chat._processTTSQueue();
        }).catch(function(err) {
            // 失败时推送 null，标记该 chunk 已处理，让队列继续前进
            Chat._ttsQueue.push({ blob: null, index: chunkIndex, failed: true });
            Chat._processTTSQueue();
        });
    };

    if (delay > 0) {
        setTimeout(doFetch, delay);
    } else {
        doFetch();
    }
};

// 处理队列：严格按 index 顺序播放，防止乱序
Chat._processTTSQueue = function() {
    if (Chat._ttsIsPlaying) return;

    // 队列为空
    if (!Chat._ttsQueue || Chat._ttsQueue.length === 0) {
        // 还有 chunk 在请求中（fetch 未返回），不要提前触发 done 回调
        if (Chat._ttsNextPlayIndex < Chat._ttsChunkIndex) return;

        if (Chat._ttsStreamDone && Chat._ttsOnStreamDone) {
            Chat.setAIState('answering');
            var cb = Chat._ttsOnStreamDone;
            Chat._ttsOnStreamDone = null;
            cb();
        }
        return;
    }

    // 按 index 排序
    Chat._ttsQueue.sort(function(a, b) { return a.index - b.index; });

    // 只有当队首的 index 等于期望的下一个 index 时才播放
    // 防止后到达的音频块抢先播放导致乱序
    if (Chat._ttsQueue[0].index !== Chat._ttsNextPlayIndex) {
        return;
    }

    var item = Chat._ttsQueue.shift();
    // 失败的 chunk：跳过，继续下一个
    if (!item.blob) {
        Chat._ttsIsPlaying = false;
        Chat._ttsNextPlayIndex++;
        Chat._processTTSQueue();
        return;
    }

    Chat._ttsNextPlayIndex++;
    Chat._ttsIsPlaying = true;
    Chat.setAIState('speaking');

    Chat._playBlob(item.blob, function() {
        // onEnd
        Chat._ttsIsPlaying = false;
        Chat._processTTSQueue();
    }, function() {
        // onError
        Chat._ttsIsPlaying = false;
        Chat._processTTSQueue();
    });
};

// 发送剩余缓冲区并标记流结束
Chat.flushStreamTTS = function(onDone) {
    var fullText = window._streamContent || '';
    var remaining = fullText.substring(Chat._ttsLastSentPos || 0);
    if (remaining.trim()) {
        Chat.streamTTSChunk(remaining);
        Chat._ttsLastSentPos = fullText.length;
    }
    Chat._ttsStreamDone = true;
    Chat._ttsOnStreamDone = onDone;
    Chat._processTTSQueue();
};