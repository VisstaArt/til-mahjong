// Простой app-shell кеш для PWA. Стратегия network-first: пока есть сеть, всегда
// берём свежую версию (и обновляем кеш) — это на время активной разработки, чтобы
// не словить залипание на старой версии, как уже бывало с обычным браузерным кешем.
// Офлайн/при обрыве сети — отдаём то, что успело закешироваться.
const CACHE_NAME = "til-mahjong-v4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./wordbank.js",
  "./mahjong-layout.js",
  "./icons.js",
  "./manifest.json",
  "./assets/seed/seed-words.json",
  "./assets/pwa/icon-192.png",
  "./assets/pwa/icon-512.png",
  "./assets/pwa/apple-touch-icon.png",
  "./assets/icons/araba.jpg",
  "./assets/icons/ay.jpg",
  "./assets/icons/buyuk.jpg",
  "./assets/icons/cay.jpg",
  "./assets/icons/ekmek.svg",
  "./assets/icons/ev.svg",
  "./assets/icons/gunes.svg",
  "./assets/icons/kedi.svg",
  "./assets/icons/kitap.jpg",
  "./assets/icons/kopek.svg",
  "./assets/icons/kosmak.jpg",
  "./assets/icons/kucuk.jpg",
  "./assets/icons/okumak.jpg",
  "./assets/icons/su.jpg",
  "./assets/icons/uyumak.jpg",
  "./assets/icons/yazmak.jpg",
  "./assets/icons/yurumek.jpg",
  "./assets/icons/yuzmek.jpg",
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
