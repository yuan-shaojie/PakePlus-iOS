// Service Worker for PWA - 缓存控制
var CACHE_NAME = 'xlx-chat-v2';

// 安装：预缓存关键资源
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll([
                '/',
                '/index.html',
                '/assets/css/style.css',
                '/assets/css/style_mascot.css',
                '/assets/js/api.js',
                '/assets/js/chat_ws.js',
                '/assets/js/chat_ui.js',
                '/assets/js/chat_voice.js',
                '/assets/js/chat.js',
                '/manifest.json'
            ]);
        })
    );
    self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(key) { return key !== CACHE_NAME; })
                    .map(function(key) { return caches.delete(key); })
            );
        })
    );
    self.clients.claim();
});

// 请求拦截：API 请求走网络，静态资源走缓存
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // API 请求：只用网络，不缓存
    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
        return;
    }

    // 静态资源：缓存优先，网络兜底
    event.respondWith(
        caches.match(event.request).then(function(cached) {
            if (cached) return cached;
            return fetch(event.request).then(function(response) {
                if (response && response.status === 200) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(function() {
                if (event.request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});