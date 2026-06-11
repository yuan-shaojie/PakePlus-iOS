/**
 * 统一 API 请求模块
 *
 * 打包成桌面端后，前端是独立文件，必须知道 API 域名才能发请求。
 * 配置方式：修改下方 API_SERVERS 数组，换公司只改这里。
 */
var API = API || {};

// ========== 域名配置（打包时修改这里） ==========
API.SERVERS = [
    { name: '主服务器',  url: 'https://openclawapi01.2frs.com' },
    { name: '备用服务器', url: 'https://openclawapi02.2frs.com' }
];

// ========== 状态 ==========
API._activeIndex = 0;         // 当前使用的服务器索引
API._healthy = {};            // 各服务器健康状态缓存
API._initialized = false;
API._onReady = null;

// ========== 工具 ==========

API.getToken = function() {
    return localStorage.getItem('xlx_auth_token') || '';
};

API.getActiveUrl = function() {
    return API.SERVERS[API._activeIndex].url;
};

API.getActiveIndex = function() {
    return API._activeIndex;
};

// ========== 域名健康检测 ==========

/**
 * 对一个服务器发 /api/ping，验证是否真的可用
 * @param {number} serverIndex
 * @returns {Promise<boolean>}
 */
API._pingServer = function(serverIndex) {
    var srv = API.SERVERS[serverIndex];
    return new Promise(function(resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', srv.url + '/api/ping', true);
        xhr.timeout = 5000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data && data.ok) {
                        resolve(true);
                        return;
                    }
                } catch(e) {}
            }
            resolve(false);
        };
        xhr.onerror = function() { resolve(false); };
        xhr.ontimeout = function() { resolve(false); };
        xhr.send();
    });
};

/**
 * 检测所有服务器，自动切到第一个可用的
 * @returns {Promise<object>} 检测结果
 */
API.checkAllServers = function() {
    var promises = [];
    for (var i = 0; i < API.SERVERS.length; i++) {
        (function(idx) {
            promises.push(
                API._pingServer(idx).then(function(ok) {
                    API._healthy[idx] = ok;
                    return { index: idx, ok: ok, name: API.SERVERS[idx].name };
                })
            );
        })(i);
    }
    return Promise.all(promises).then(function(results) {
        // 如果当前服务器不可用，自动切换到第一个可用的
        if (!API._healthy[API._activeIndex]) {
            for (var i = 0; i < API.SERVERS.length; i++) {
                if (API._healthy[i]) {
                    API._activeIndex = i;
                    localStorage.setItem('xlx_api_server_index', String(i));
                    console.log('[API] Auto-switched to: ' + API.SERVERS[i].name + ' (' + API.SERVERS[i].url + ')');
                    break;
                }
            }
        }
        return {
            results: results,
            activeIndex: API._activeIndex,
            activeUrl: API.getActiveUrl()
        };
    });
};

/**
 * 手动切换到指定服务器
 * @param {number} index
 * @returns {boolean}
 */
API.switchTo = function(index) {
    if (index >= 0 && index < API.SERVERS.length) {
        API._activeIndex = index;
        localStorage.setItem('xlx_api_server_index', String(index));
        return true;
    }
    return false;
};

// ========== 通用请求方法 ==========

API.get = function(path, options) {
    options = options || {};
    return API._request(path, {
        method: 'GET',
        headers: options.headers || {},
        responseType: options.responseType || 'json'
    });
};

API.post = function(path, data, options) {
    options = options || {};
    return API._request(path, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
        body: JSON.stringify(data),
        responseType: options.responseType || 'json'
    });
};

API._request = function(path, opts) {
    return new Promise(function(resolve, reject) {
        var url = API.getActiveUrl() + path;
        var xhr = new XMLHttpRequest();
        xhr.open(opts.method, url, true);

        if (opts.auth !== false) {
            var token = API.getToken();
            if (token) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            }
        }

        if (opts.headers) {
            Object.keys(opts.headers).forEach(function(key) {
                xhr.setRequestHeader(key, opts.headers[key]);
            });
        }

        if (opts.responseType && opts.responseType !== 'json') {
            xhr.responseType = opts.responseType;
        }

        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                if (opts.responseType === 'blob' || opts.responseType === 'arraybuffer') {
                    resolve(xhr.response);
                } else if (opts.responseType === 'text') {
                    resolve(xhr.responseText);
                } else {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    } catch(e) {
                        resolve(xhr.responseText);
                    }
                }
            } else if (xhr.status === 401) {
                localStorage.removeItem('xlx_auth_token');
                window.location.href = '/login.html';
                reject(new Error('Unauthorized'));
            } else {
                try {
                    reject(JSON.parse(xhr.responseText));
                } catch(e) {
                    reject(new Error('HTTP ' + xhr.status));
                }
            }
        };

        xhr.onerror = function() {
            reject(new Error('Network error'));
        };
        xhr.ontimeout = function() {
            reject(new Error('Request timeout'));
        };

        xhr.send(opts.body || null);
    });
};

// ========== 业务接口 ==========

API.login = function(username, password) {
    return API.post('/api/login', { username: username, password: password }, { auth: false });
};

API.logout = function() {
    return API.post('/api/logout', {});
};

API.getSessions = function() {
    return API.get('/api/sessions');
};

API.getSessionMessages = function(sessionKey) {
    return API.get('/api/sessions/' + encodeURIComponent(sessionKey) + '/messages');
};

API.deleteSession = function(sessionKey) {
    var url = API.getActiveUrl() + '/api/sessions/' + encodeURIComponent(sessionKey);
    return fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + API.getToken() }
    }).then(function(res) {
        if (res.status === 401) {
            localStorage.removeItem('xlx_auth_token');
            window.location.href = '/login.html';
            return;
        }
        return res.json();
    });
};

API.getStatus = function() {
    return API.get('/api/status');
};

API.getTTSVoices = function() {
    return API.get('/api/tts/voices');
};

API.getTTSUrl = function(text, voice) {
    return API.getActiveUrl() + '/api/tts?text=' + encodeURIComponent(text) +
        '&voice=' + encodeURIComponent(voice || 'zh-CN-XiaoxiaoNeural');
};

// ========== 初始化 ==========

/**
 * 初始化：恢复上次选择的服务器，验证连通性，必要时自动切换
 * @param {function} [callback]
 */
API.init = function(callback) {
    // 读取上次选择的服务器
    var saved = localStorage.getItem('xlx_api_server_index');
    if (saved !== null) {
        var idx = parseInt(saved);
        if (idx >= 0 && idx < API.SERVERS.length) {
            API._activeIndex = idx;
        }
    }

    // 检测所有服务器并自动切到可用的
    API.checkAllServers().then(function(result) {
        API._initialized = true;
        console.log('[API] Initialized, active: ' + API.getActiveUrl());
        if (callback) callback(result);
    });
};

/**
 * 启动后台健康检测（每30秒）
 */
API.startHealthCheck = function() {
    setInterval(function() {
        API.checkAllServers();
    }, 30000);
};