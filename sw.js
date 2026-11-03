/*
 * Service worker: сайт открывается без интернета и быстрее загружается.
 * При изменении файлов сайта увеличьте номер версии — пользователи получат обновление.
 */
const VERSION = 'ukropchik-v18';
const ASSETS = [
  './', 'index.html', 'calculator.html', 'diet.html', 'recipes.html', 'diary.html', 'shopping.html',
  'scanner.html', 'forum.html', 'account.html', 'login.html', 'admin.html', 'profile.html', 'messages.html',
  'css/style.css',
  'js/theme.js', 'js/config.js', 'js/db.js', 'js/data.js', 'js/recipes-data.js', 'js/plan.js', 'js/main.js',
  'js/home.js', 'js/calculator.js', 'js/diet.js', 'js/recipes.js', 'js/diary.js', 'js/shopping.js',
  'js/scanner.js', 'js/forum.js', 'js/account.js', 'js/auth.js', 'js/admin.js', 'js/profile.js', 'js/messages.js', 'js/user-search.js', 'js/vendor/supabase.js',
  'img/logo.svg', 'img/family.jpg', 'img/plate.jpg', 'img/icon-192.png', 'img/icon-512.png',
  'manifest.webmanifest', 'fonts/inter-cyrillic-wght-normal.woff2', 'fonts/inter-latin-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // база данных, API продуктов и прочие внешние запросы — всегда из сети
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(sb|off|dns)\//.test(url.pathname)) return;

  // страницы: сначала сеть (свежая версия), без сети — из кэша
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // скрипты и стили: сначала сеть, чтобы после обновления сайта не смешивались старые и новые файлы
  if (/\.(js|css|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // картинки и шрифты: из кэша, параллельно обновляем
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// нажатие на напоминание открывает сайт
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.includes(self.registration.scope));
      if (open) return open.focus().then((c) => c.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
