/*
 * LiveTemplate 서비스 워커
 *  - 앱 화면(HTML/JS/CSS)만 캐시해 설치형 앱처럼 빠르게 열고, 오프라인에서도 화면이 뜨게 한다.
 *  - 데이터(/api, /socket.io)는 절대 캐시하지 않는다. 오프라인 편집 내용은 IndexedDB(Yjs)가 보관한다.
 */
const CACHE = 'lt-app-v2';
// GitHub Pages(/저장소이름/)처럼 하위 경로에 배포돼도 동작하도록 등록 범위를 기준으로 한다
const BASE = new URL(self.registration.scope).pathname;
const SHELL = ['', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'].map((p) => BASE + p);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(`${BASE}api/`) || url.pathname.startsWith(`${BASE}socket.io/`)) return;

  // 페이지 이동: 항상 최신 화면을 먼저 받고, 오프라인이면 저장된 화면
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === BASE) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(BASE, copy));
          }
          return res;
        })
        .catch(() => caches.match(BASE)),
    );
    return;
  }

  // 빌드 결과물은 파일명에 해시가 있어 내용이 바뀌지 않으므로 캐시 우선
  if (url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 아이콘 등: 캐시를 바로 쓰고 뒤에서 갱신
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
