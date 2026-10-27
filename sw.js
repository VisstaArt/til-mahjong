// App-shell кеш для PWA. Стратегия network-first: пока есть сеть, всегда берём свежую
// версию (и обновляем кеш) — это на время активной разработки, чтобы не словить
// залипание на старой версии, как уже бывало с обычным браузерным кешем.
// Офлайн/при обрыве сети — отдаём то, что лежит в кеше.
//
// Чтобы приложение работало без интернета целиком, при установке кладём в кеш не
// только код, но и все данные (слова, фразы, диалоги, грамматику) — списки файлов
// берём из их manifest.json, так что новые темы попадают в кеш сами.
const CACHE_NAME = "til-mahjong-v34";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./supabase-sync.js",
  "./icons.js",
  "./wordbank.js",
  "./mahjong-layout.js",
  "./script.js",
  "./speech.js",
  "./phrases.js",
  "./dialogues.js",
  "./grammar.js",
  "./today.js",
  "./wordgames.js",
  "./manifest.json",
  "./assets/pwa/icon-192-v2.png",
  "./assets/pwa/icon-512-v2.png",
  "./assets/pwa/apple-touch-icon-v2.png",
];

// Библиотека входа/синхронизации — с CDN. Без неё офлайн не открылся бы экран игры.
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

const DATA_FILES = [
  "./assets/words/levels.json",
  "./assets/words/manifest.json",
  "./assets/phrases/levels.json",
  "./assets/phrases/manifest.json",
  "./assets/dialogues/manifest.json",
  "./assets/grammar/items.json",
  "./assets/grammar/path.json",
];
const DATA_LISTS = [
  ["./assets/words/manifest.json", (m) => m.map((c) => `./assets/words/${c.slug}.json`)],
  ["./assets/phrases/manifest.json", (m) => m.map((t) => `./assets/phrases/${t.id}.json`)],
  ["./assets/dialogues/manifest.json", (m) => m.map((t) => `./assets/dialogues/${t.id}.json`)],
];

// Если сеть «есть, но еле живая» (метро, роуминг) — не ждём дольше этого, отдаём копию.
const SLOW_NETWORK_MS = 4000;

function reload(url) {
  return new Request(url, { cache: "reload" });
}

// Данные — по возможности: один битый файл не должен ломать установку всего кеша.
// Темы, которые уже лежат в кеше прошлой версии, заново не качаем (~10 МБ на каждое
// обновление по мобильному интернету — слишком) — их перенесёт activate, а свежими
// они станут при первом же открытии с сетью (network-first).
async function precacheData(cache) {
  const lists = await Promise.all(
    DATA_LISTS.map(([url, files]) =>
      fetch(reload(url))
        .then((r) => r.json())
        .then(files)
        .catch(() => [])
    )
  );
  const missing = async (u) => !(await caches.match(u));
  const topics = lists.flat();
  const need = await Promise.all(topics.map(missing));
  const urls = [...DATA_FILES, ...topics.filter((_, i) => need[i])];
  await Promise.allSettled(urls.map((u) => cache.add(reload(u))));
  if (await missing(SUPABASE_JS)) {
    await fetch(SUPABASE_JS, { mode: "cors", cache: "reload" })
      .then((r) => r.ok && cache.put(SUPABASE_JS, r))
      .catch(() => {});
  }
}

// Что было в старом кеше и не попало в новый (картинки категорий и т.п.) — переносим,
// а не выбрасываем: иначе после каждого обновления офлайн терял бы половину файлов.
async function carryOver(cache, oldKey) {
  const old = await caches.open(oldKey);
  const reqs = await old.keys();
  await Promise.all(
    reqs.map(async (req) => {
      if (await cache.match(req)) return;
      const res = await old.match(req);
      if (res) await cache.put(req, res);
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL.map(reload));
      await precacheData(cache);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const old = (await caches.keys()).filter((k) => k !== CACHE_NAME);
      for (const key of old) {
        await carryOver(cache, key).catch(() => {});
        await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const own = url.origin === self.location.origin;
  // Запросы к Supabase/OpenAI — мимо кеша: прогресс из облака нельзя подсовывать
  // старой копией (офлайн она перезаписала бы то, что сыграно на телефоне).
  if (!own && url.href !== SUPABASE_JS) return;

  // GitHub Pages отдаёт файлы с Cache-Control: max-age=600 — обычный fetch() тихо
  // подставил бы ответ из HTTP-кеша браузера вместо похода в сеть, и "network-first"
  // работал бы только на бумаге. cache: "reload" заставляет реально ходить в сеть.
  const network = fetch(new Request(event.request, { cache: "reload" })).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return res;
  });
  const cached = () =>
    caches
      .match(event.request, { ignoreSearch: own })
      .then((res) => res || (event.request.mode === "navigate" ? caches.match("./index.html") : undefined));

  event.waitUntil(network.catch(() => {}));
  event.respondWith(
    Promise.race([
      network.catch(cached),
      new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_MS))
        .then(cached)
        .then((res) => res || network),
    ])
  );
});
