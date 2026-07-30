// Управление своими словами: перевод + генерация иконки прямо из браузера через OpenAI API.
// Ключ и сгенерированные слова хранятся локально (localStorage + IndexedDB), никуда не уходят кроме api.openai.com.

const API_KEY_STORAGE = "mahjong-openai-key";
const CUSTOM_DB_NAME = "mahjong-custom-words";
const CUSTOM_STORE = "words";

// Держать в синхроне со script.js:POS_ORDER (wordbank.js грузится раньше script.js).
const POS_VALUES = ["noun", "verb", "adjective", "adverb", "pronoun", "preposition", "numeral", "other"];

// Фиксированный список категорий (тем) — каталог строится строго по нему, а не по
// свободным темам, которые ИИ придумывал бы каждый раз заново (так раньше получалось
// больше сотни мелких почти повторяющихся тем). Держать в синхроне со
// script.js:CATEGORY_EMOJI (там же порядок вывода плиток каталога).
const CATEGORIES = [
  "Фрукты", "Овощи", "Животные", "Цвета", "Числительные",
  "Одежда и аксессуары", "Глаголы — действия", "Направления и предлоги",
  "Природа и погода", "Дом и мебель", "Кухня и посуда", "Ванная и гигиена",
  "Профессии", "Транспорт и вождение", "Спорт", "Эмоции и чувства",
  "Покупки и магазины", "Город и места", "Еда и напитки",
  "Мясо и молочные продукты", "Крупы, специи и масла",
  "Страны и национальности", "Прилагательные и сравнения", "Части тела",
  "Школа и канцтовары", "Календарь и время", "Семья и отношения",
  "Разное / служебные слова",
];
const FALLBACK_CATEGORY = "Разное / служебные слова";

function normalizeCategory(theme) {
  return CATEGORIES.includes(theme) ? theme : FALLBACK_CATEGORY;
}

const ICON_STYLE =
  ", adorable kawaii-inspired illustration style, soft rounded shapes, detailed premium rendering, " +
  "soft cel-shading, rich fine texture, vibrant warm color palette, glossy soft highlights, " +
  "gentle soft shadow beneath the subject, elegant premium quality, no text, no watermark, " +
  "no people or characters unless the word itself is a person, action performed by someone, or animal";

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

function openWordDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CUSTOM_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(CUSTOM_STORE, { keyPath: "tr" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllCustomWords() {
  const db = await openWordDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_STORE, "readonly");
    const req = tx.objectStore(CUSTOM_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putCustomWord(entry) {
  const db = await openWordDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_STORE, "readwrite");
    tx.objectStore(CUSTOM_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Записать много слов одной транзакцией — открывать соединение с IndexedDB и ждать
// отдельную транзакцию на каждое слово (как делает putCustomWord в цикле) при 50+
// словах ощутимо медленно (наблюдалось ~6-8 секунд на 51 слово при первом заходе
// на сайт — каталог всё это время выглядел пустым). Один batch-put — доли секунды.
async function putCustomWordsBatch(entries) {
  if (!entries.length) return;
  const db = await openWordDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_STORE, "readwrite");
    const store = tx.objectStore(CUSTOM_STORE);
    entries.forEach((entry) => store.put(entry));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteCustomWord(tr) {
  const db = await openWordDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_STORE, "readwrite");
    tx.objectStore(CUSTOM_STORE).delete(tr);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Экспорт всех своих слов (включая картинки) в один JSON-файл — можно перенести
// на другой компьютер/браузер и загрузить через importWordBankFile, не тратя API повторно.
async function exportWordBank() {
  const words = await getAllCustomWords();
  const blob = new Blob([JSON.stringify({ version: 1, words }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `til-majong-slova-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return words.length;
}

async function importWordBankFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const words = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(words)) throw new Error("Файл не похож на экспорт словаря");
  let imported = 0;
  for (const w of words) {
    if (w && w.tr && w.ru && w.icon) {
      await putCustomWord({
        tr: w.tr,
        ru: w.ru,
        icon: w.icon,
        visual: w.visual || null,
        pos: w.pos || "other",
        theme: normalizeCategory(w.theme),
      });
      imported++;
    }
  }
  return imported;
}

// Стартовый набор слов, который копится по мере того, как их добавляют через игру
// (см. assets/seed/seed-words.json) — при первом заходе в браузере он подгружается
// автоматически, чтобы новые пользователи сразу получали не только базовые 20 слов,
// но и всё, что уже наработано другими. Флаг в localStorage — чтобы это случилось
// только один раз и не мешало, если пользователь потом сам удалит какие-то слова.
const SEEDED_FLAG_KEY = "mahjong-seeded-v1";

async function seedBaseWordsIfNeeded() {
  if (localStorage.getItem(SEEDED_FLAG_KEY)) return;
  localStorage.setItem(SEEDED_FLAG_KEY, "1");
  try {
    const resp = await fetch("assets/seed/seed-words.json");
    if (!resp.ok) return;
    const data = await resp.json();
    const words = Array.isArray(data.words) ? data.words : [];
    const existing = await getAllCustomWords();
    const existingTr = new Set(existing.map((w) => w.tr));
    const toInsert = words
      .filter((w) => w && w.tr && w.ru && w.icon && !existingTr.has(w.tr))
      .map((w) => ({
        tr: w.tr,
        ru: w.ru,
        icon: w.icon,
        visual: w.visual || null,
        pos: w.pos || "other",
        theme: normalizeCategory(w.theme),
      }));
    await putCustomWordsBatch(toInsert);
  } catch (e) {
    // тихо игнорируем — не критично, просто у пользователя не будет стартового набора
  }
}

async function translateAndDescribe(words, apiKey) {
  const prompt =
    `Для каждого турецкого слова сначала определи его начальную (словарную) форму (поле "base") — ` +
    `инфинитив на -mak/-mek для глаголов, именительный падеж единственного числа для существительных, ` +
    `основная форма для прилагательных. Если слово УЖЕ в спряжённой/склонённой/деепричастной форме ` +
    `(например "yiyerek" вместо "yemek", "arabalar" вместо "araba", "gidiyorum" вместо "gitmek") — ` +
    `в поле "base" укажи начальную форму. Если слово уже в начальной форме — "base" совпадает с самим словом. ` +
    `Дальше переведи на русский, определи часть речи, тематическую группу и дай короткое ` +
    `визуальное описание на английском для рисования простой понятной иконки — ВСЁ ЭТО для начальной формы ` +
    `(поля "ru"/"pos"/"theme"/"visual" описывают слово из поля "base", а не исходную форму). ` +
    `Правила для описания (поле "visual"):\n` +
    `- Если слово — конкретный предмет (стол, чайник) — опиши сам предмет крупным планом.\n` +
    `- Если слово — природа/место/пейзаж (лес, озеро, дом, гора) — опиши сцену БЕЗ людей и персонажей, ` +
    `только природа/объект (например для "озеро": "a small calm lake surrounded by a few trees, no people").\n` +
    `- Если слово — действие, которое совершает человек, или сам человек/животное — покажи персонажа, который это делает.\n` +
    `- Если слово абстрактное и его physически нельзя нарисовать напрямую (например порядковое числительное ` +
    `"первый", отношение "друг", состояние "умерший") — придумай простую тактичную визуальную метафору ` +
    `(например "первый" → золотая медаль с цифрой 1; "друг" → два маленьких милых персонажа держатся за руки; ` +
    `для деликатных тем — мягкий нейтральный символ без шокирующих деталей).\n` +
    `Часть речи (поле "pos") — строго одно из: ${POS_VALUES.map((p) => `"${p}"`).join(", ")}. ` +
    `("preposition" — и предлоги, и турецкие послелоги; "other" — только если совсем не подходит ничего из списка). ` +
    `Тематическая группа (поле "theme") — выбери РОВНО ОДНУ категорию из этого фиксированного списка ` +
    `(название категории строго как написано, ничего не придумывай своё): ` +
    `${CATEGORIES.map((c) => `"${c}"`).join(", ")}. ` +
    `Если слово не подходит ни под одну тематическую категорию (служебное слово, местоимение, союз) — ` +
    `используй "${FALLBACK_CATEGORY}". ` +
    `Ответь ТОЛЬКО валидным JSON без пояснений, в формате ` +
    `{"слово": {"base": "yemek", "ru": "перевод", "pos": "noun", "theme": "Овощи", "visual": "short english visual description"}, ...}. ` +
    `Турецкие слова: ${words.join(", ")}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`Ошибка перевода: HTTP ${resp.status}`);
  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

// Модель отдаёт PNG 1024x1024 (сотни КБ - под мегабайт каждая), а на плитке картинка
// показывается ~60x80px — из-за этого на телефоне иконки заметно тормозят загрузку.
// Пережимаем в компактный JPEG нужного размера сразу после генерации (фон непрозрачный,
// прозрачность не нужна, поэтому JPEG безопасен и в разы легче PNG).
const ICON_MAX_SIZE = 260; // с запасом под retina-плитки (~60-96px CSS) и попап при совпадении
const ICON_QUALITY = 0.85;

function compressDataUrl(dataUrl, maxSize = ICON_MAX_SIZE, quality = ICON_QUALITY) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Не удалось обработать картинку"));
    img.src = dataUrl;
  });
}

async function generateIconDataUrl(visual, apiKey) {
  const prompt = `${visual}${ICON_STYLE}`;
  // gpt-image-1 не умеет генерировать меньше 1024x1024 (маленьких размеров вроде
  // старого DALL-E у неё нет) — зато quality:"low" ощутимо экономит токены/стоимость
  // на генерации, а разницу всё равно не видно: результат потом сжимается для плитки
  // (см. compressDataUrl) до ~260px.
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", quality: "low", background: "opaque", n: 1 }),
  });
  if (!resp.ok) throw new Error(`Ошибка генерации картинки: HTTP ${resp.status}`);
  const data = await resp.json();
  const raw = `data:image/png;base64,${data.data[0].b64_json}`;
  return compressDataUrl(raw);
}

// Разово сжать уже сохранённые картинки (актуально для слов, добавленных до того,
// как генерация начала сжимать иконки сама). Пропускает то, что уже компактный JPEG.
async function compressAllStoredIcons(onProgress) {
  const all = await getAllCustomWords();
  const toCompress = all.filter((w) => w.icon && w.icon.startsWith("data:image/png"));
  if (!toCompress.length) {
    onProgress("Сжимать нечего — все картинки уже компактные.");
    return { compressed: 0 };
  }
  let compressed = 0;
  for (const w of toCompress) {
    onProgress(`Сжимаю ${compressed + 1}/${toCompress.length}: ${w.tr}...`);
    try {
      const icon = await compressDataUrl(w.icon);
      await putCustomWord({ ...w, icon });
      compressed++;
    } catch (e) {
      onProgress(`Не удалось сжать «${w.tr}»: ${e.message}`);
    }
  }
  onProgress(`Готово: сжато ${compressed} из ${toCompress.length}.`);
  return { compressed };
}

// rawWords: массив турецких слов (без перевода). onProgress(text) — коллбек для лога прогресса.
async function addCustomWords(rawWords, onProgress) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Сначала укажи API-ключ OpenAI");

  const existing = await getAllCustomWords();
  const existingSet = new Set(existing.map((w) => w.tr));
  const uniqueInput = [...new Set(rawWords.map((w) => w.trim().toLowerCase()).filter(Boolean))];
  const skipped = uniqueInput.filter((w) => existingSet.has(w) || w in IMAGE_FILES || w in COLOR_WORDS);
  const words = uniqueInput.filter((w) => !skipped.includes(w));

  if (skipped.length) {
    onProgress(`Уже есть в словаре, пропускаю: ${skipped.join(", ")}`);
  }

  if (!words.length) {
    onProgress("Новых слов нет — все уже были переведены и нарисованы раньше.");
    return { added: 0 };
  }

  onProgress(`Перевожу ${words.length} новых слов...`);
  const meta = await translateAndDescribe(words, apiKey);

  let added = 0;
  const seenBases = new Set(existingSet);
  for (const word of words) {
    const info = meta[word];
    if (!info || !info.ru) {
      onProgress(`Пропуск «${word}» — не удалось перевести`);
      continue;
    }

    const base = (info.base || word).trim().toLowerCase();
    if (base !== word && (seenBases.has(base) || base in IMAGE_FILES || base in COLOR_WORDS)) {
      onProgress(`«${word}» — это форма слова «${base}», которое уже есть в словаре — пропускаю`);
      continue;
    }
    if (base !== word) {
      onProgress(`«${word}» — не начальная форма, привожу к «${base}»`);
    }

    onProgress(`Рисую иконку ${added + 1}/${words.length}: ${base}...`);
    try {
      const visual = info.visual || base;
      const pos = POS_VALUES.includes(info.pos) ? info.pos : "other";
      const theme = normalizeCategory((info.theme || "").trim());
      const icon = await generateIconDataUrl(visual, apiKey);
      await putCustomWord({ tr: base, ru: info.ru, icon, visual, pos, theme });
      seenBases.add(base);
      added++;
      onProgress(`Готово: ${base} — ${info.ru}`);
    } catch (e) {
      onProgress(`Ошибка на «${base}»: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 9000)); // пауза, чтобы не упереться в лимит скорости API
  }
  return { added };
}

// Заново определить часть речи и тему для ВСЕХ своих слов (не только тех, где не проставлено) —
// модель иногда ошибается или раньше категорий/тем не было вовсе. Разбивает на пачки по 20 слов —
// в одном большом запросе модель иногда молча пропускает часть слов в ответе; если слово
// отсутствует в ответе, оно просто не трогается (а не сбрасывается в "other").
async function reclassifyAllWords(onProgress) {
  const all = await getAllCustomWords();
  if (!all.length) {
    onProgress("Своих слов пока нет.");
    return { updated: 0 };
  }
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Сначала укажи API-ключ OpenAI");

  const CHUNK_SIZE = 20;
  let updated = 0;
  let missing = [];

  for (let i = 0; i < all.length; i += CHUNK_SIZE) {
    const chunk = all.slice(i, i + CHUNK_SIZE);
    onProgress(`Определяю часть речи и тему: ${Math.min(i + CHUNK_SIZE, all.length)}/${all.length}...`);

    const prompt =
      `Определи часть речи и категорию для турецких слов. Часть речи — строго одно из: ` +
      `${POS_VALUES.map((p) => `"${p}"`).join(", ")} ("preposition" — и предлоги, и послелоги; ` +
      `"other" — только если совсем не подходит ничего). Категория (тема) — выбери РОВНО ОДНУ из ` +
      `этого фиксированного списка (строго как написано, ничего своего не придумывай): ` +
      `${CATEGORIES.map((c) => `"${c}"`).join(", ")}. Если слово не подходит ни под одну тематическую ` +
      `категорию (служебное слово, местоимение, союз) — используй "${FALLBACK_CATEGORY}". ` +
      `Верни запись для КАЖДОГО слова из списка, ни одного не пропускай. ` +
      `Ответь ТОЛЬКО валидным JSON вида {"слово": {"pos": "noun", "theme": "Овощи"}, ...}. ` +
      `Слова: ${chunk.map((w) => w.tr).join(", ")}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) throw new Error(`Ошибка определения категорий: HTTP ${resp.status}`);
    const data = await resp.json();
    const result = JSON.parse(data.choices[0].message.content);

    for (const w of chunk) {
      const info = result[w.tr];
      if (!info) {
        missing.push(w.tr);
        continue; // модель пропустила слово — не трогаем то, что уже было
      }
      const pos = POS_VALUES.includes(info.pos) ? info.pos : w.pos || "other";
      const theme = normalizeCategory((info.theme || "").trim());
      if (pos !== w.pos || theme !== (w.theme || null)) {
        await putCustomWord({ ...w, pos, theme });
        updated++;
      }
    }

    if (i + CHUNK_SIZE < all.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  onProgress(
    `Готово: изменено у ${updated} из ${all.length} слов.` +
      (missing.length ? ` Модель пропустила: ${missing.join(", ")} — попробуй нажать кнопку ещё раз.` : "")
  );
  return { updated };
}

// Предложить слова по теме — только текст, без картинок. Пользователь одобряет список,
// и лишь потом генерируются иконки (generateApprovedWords), чтобы не тратить API впустую.
async function suggestWordsForTopic(topic, count, apiKey) {
  const existing = await getAllCustomWords();
  const existingTr = new Set([...existing.map((w) => w.tr), ...Object.keys(IMAGE_FILES), ...Object.keys(COLOR_WORDS)]);

  const prompt =
    `Предложи ${count} турецких слов уровня A1-A2 по теме "${topic}" для языковой игры-маджонга ` +
    `(словарные карточки турецкий → русский). Только в начальной (словарной) форме — инфинитив на -mak/-mek ` +
    `для глаголов, именительный падеж единственного числа для существительных, НЕ спряжённые/склонённые формы. ` +
    `Не предлагай слова, которые уже есть в этом списке: ` +
    `${[...existingTr].join(", ") || "(пусто)"}. Для каждого слова дай перевод на русский, часть речи ` +
    `(строго одно из: ${POS_VALUES.map((p) => `"${p}"`).join(", ")}), категорию — выбери РОВНО ОДНУ из ` +
    `этого фиксированного списка (строго как написано): ${CATEGORIES.map((c) => `"${c}"`).join(", ")} ` +
    `(используй "${FALLBACK_CATEGORY}", если совсем не подходит ничего), и короткое визуальное описание ` +
    `на английском для рисования милой иконки — конкретный предмет крупным планом, без лишних персонажей, ` +
    `если слово не про человека/животное/действие. Ответь ТОЛЬКО валидным JSON: ` +
    `{"words": [{"tr": "...", "ru": "...", "pos": "noun", "theme": "...", "visual": "..."}]}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`Ошибка подбора слов: HTTP ${resp.status}`);
  const data = await resp.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return Array.isArray(parsed.words) ? parsed.words : [];
}

// Сгенерировать иконки и сохранить только одобренный пользователем список слов
// (каждое уже содержит tr/ru/pos/theme/visual из suggestWordsForTopic).
async function generateApprovedWords(words, onProgress) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Сначала укажи API-ключ OpenAI");
  let added = 0;
  for (const w of words) {
    onProgress(`Рисую иконку ${added + 1}/${words.length}: ${w.tr}...`);
    try {
      const pos = POS_VALUES.includes(w.pos) ? w.pos : "other";
      const theme = normalizeCategory((w.theme || "").trim());
      const icon = await generateIconDataUrl(w.visual || w.tr, apiKey);
      await putCustomWord({ tr: w.tr, ru: w.ru, icon, visual: w.visual, pos, theme });
      added++;
      onProgress(`Готово: ${w.tr} — ${w.ru}`);
    } catch (e) {
      onProgress(`Ошибка на «${w.tr}»: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 9000));
  }
  return { added };
}

// Перерисовать иконку уже существующего слова заново (если картинка не понравилась).
async function regenerateWordIcon(tr, ru, visual, pos, theme) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Сначала укажи API-ключ OpenAI");
  const icon = await generateIconDataUrl(visual || `${tr} (${ru})`, apiKey);
  await putCustomWord({ tr, ru, icon, visual: visual || null, pos: pos || "other", theme: theme || null });
  return icon;
}
