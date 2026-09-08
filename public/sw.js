const CACHE_NAME = 'shiba-money-v29';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // 내 오리진의 GET 만 다룬다.
  // 예전엔 모든 요청을 가로챘다. 시트(script.google.com) 호출까지 워커를 거치면서
  // 302 리다이렉트가 얽히면 원장 동기화가 그대로 멈췄고, 캐시에도 없으니
  // respondWith(undefined) 로 네트워크 오류가 됐다. 교차 오리진은 브라우저에 맡긴다.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // API 응답은 캐시하지 않는다. 오래된 잔액·원장을 되돌려주면 안 된다.
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const hit = await caches.match(event.request);
      if (hit) return hit;
      throw new Error('offline: ' + url.pathname);
    })
  );
});
