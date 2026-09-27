// Простой app-shell кеш для PWA. Стратегия network-first: пока есть сеть, всегда
// берём свежую версию (и обновляем кеш) — это на время активной разработки, чтобы
// не словить залипание на старой версии, как уже бывало с обычным браузерным кешем.
// Офлайн/при обрыве сети — отдаём то, что успело закешироваться.
const CACHE_NAME = "til-mahjong-v12";

// Раньше 20 "базовых" слов жили отдельными файлами-картинками и грузились всегда —
// теперь это обычные слова внутри своих категорий (assets/words/<slug>.json,
// картинка — прямо внутри слова), отдельно кешировать их тут больше не нужно.
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./supabase-sync.js",
  "./script.js",
  "./wordbank.js",
  "./mahjong-layout.js",
  "./icons.js",
  "./manifest.json",
  "./assets/pwa/icon-192-v2.png",
  "./assets/pwa/icon-512-v2.png",
  "./assets/pwa/apple-touch-icon-v2.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // GitHub Pages отдаёт файлы с Cache-Control: max-age=600 — обычный fetch() тихо
  // подставил бы ответ из HTTP-кеша браузера вместо похода в сеть, и "network-first"
  // работал бы только на бумаге. cache: "reload" заставляет реально ходить в сеть.
  const req = new Request(event.request, { cache: "reload" });
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
