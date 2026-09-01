// Тил Маджонг — прототип
// 20 турецких слов (существительные, глаголы действия, прилагательные)
// каждое слово даёт пару плиток: картинка (SVG-иконка из icons.js) + турецкое слово

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

const WORDS = [
  { tr: "kitap", ru: "книга", pos: "noun", theme: "Школа и канцтовары" },
  { tr: "çay", ru: "чай / речка", pos: "noun", theme: "Еда и напитки" },
  { tr: "ekmek", ru: "хлеб", pos: "noun", theme: "Еда и напитки" },
  { tr: "su", ru: "вода", pos: "noun", theme: "Еда и напитки" },
  { tr: "ev", ru: "дом", pos: "noun", theme: "Дом и мебель" },
  { tr: "araba", ru: "машина", pos: "noun", theme: "Транспорт и вождение" },
  { tr: "kedi", ru: "кошка", pos: "noun", theme: "Животные" },
  { tr: "köpek", ru: "собака", pos: "noun", theme: "Животные" },
  { tr: "güneş", ru: "солнце", pos: "noun", theme: "Природа и погода" },
  { tr: "ay", ru: "луна", pos: "noun", theme: "Природа и погода" },
  { tr: "koşmak", ru: "бежать", pos: "verb", theme: "Глаголы — действия" },
  { tr: "yüzmek", ru: "плавать", pos: "verb", theme: "Глаголы — действия" },
  { tr: "okumak", ru: "читать", pos: "verb", theme: "Глаголы — действия" },
  { tr: "yazmak", ru: "писать", pos: "verb", theme: "Глаголы — действия" },
  { tr: "uyumak", ru: "спать", pos: "verb", theme: "Глаголы — действия" },
  { tr: "yürümek", ru: "идти", pos: "verb", theme: "Глаголы — действия" },
  { tr: "büyük", ru: "большой", pos: "adjective", theme: "Прилагательные и сравнения" },
  { tr: "küçük", ru: "маленький", pos: "adjective", theme: "Прилагательные и сравнения" },
  { tr: "kırmızı", ru: "красный", pos: "adjective", theme: "Цвета" },
  { tr: "mavi", ru: "синий", pos: "adjective", theme: "Цвета" },
];

// Эмодзи-иконки плиток каталога — порядок вывода плиток соответствует порядку
// CATEGORIES (см. wordbank.js, грузится раньше этого файла).
const CATEGORY_EMOJI = {
  "Фрукты": "🍎",
  "Овощи": "🥕",
  "Животные": "🐾",
  "Цвета": "🎨",
  "Числительные": "🔢",
  "Одежда и аксессуары": "👕",
  "Глаголы — действия": "🏃",
  "Направления и предлоги": "🧭",
  "Природа и погода": "🌦️",
  "Дом и мебель": "🛋️",
  "Кухня и посуда": "🍽️",
  "Ванная и гигиена": "🛁",
  "Профессии": "👷",
  "Транспорт и вождение": "🚗",
  "Спорт и игры": "⚽",
  "Эмоции и чувства": "😊",
  "Покупки и магазины": "🛍️",
  "Город и места": "🏙️",
  "Еда и напитки": "🍲",
  "Страны и национальности": "🌍",
  "Прилагательные и сравнения": "📏",
  "Части тела": "🖐️",
  "Школа и канцтовары": "✏️",
  "Календарь и время": "📅",
  "Семья и отношения": "👨‍👩‍👧",
  "Предметы и вещи": "📦",
  "Служебные слова": "🔤",
  "Птицы": "🐦",
  "Насекомые": "🐛",
  "Цветы и растения": "🌸",
  "Геометрические фигуры": "🔷",
  "Водитель": "🚦",
  "Косметика": "💄",
  "Офис": "🗂️",
  "Здоровье": "❤️‍🩹",
  "Бизнес": "💼",
};

// Свои картинки для плиток каталога (если есть — показываем вместо эмодзи).
const CATEGORY_IMAGE = {
  "Фрукты": "assets/categories/fruits.jpg",
  "Овощи": "assets/categories/vegetables.jpg",
  "Животные": "assets/categories/animals.jpg",
  "Цвета": "assets/categories/colors.jpg",
  "Числительные": "assets/categories/numbers.jpg",
  "Одежда и аксессуары": "assets/categories/clothing.jpg",
  "Глаголы — действия": "assets/categories/verbs.jpg",
  "Направления и предлоги": "assets/categories/directions.jpg",
  "Природа и погода": "assets/categories/nature.jpg",
  "Дом и мебель": "assets/categories/home.jpg",
  "Кухня и посуда": "assets/categories/kitchen.jpg",
  "Ванная и гигиена": "assets/categories/bathroom.jpg",
  "Профессии": "assets/categories/professions.jpg",
  "Транспорт и вождение": "assets/categories/transport.jpg",
  "Спорт и игры": "assets/categories/sports.jpg",
  "Эмоции и чувства": "assets/categories/emotions.jpg",
  "Покупки и магазины": "assets/categories/shopping.jpg",
  "Город и места": "assets/categories/city.jpg",
  "Еда и напитки": "assets/categories/food.jpg",
  "Страны и национальности": "assets/categories/countries.jpg",
  "Прилагательные и сравнения": "assets/categories/adjectives.jpg",
  "Части тела": "assets/categories/body.jpg",
  "Школа и канцтовары": "assets/categories/school.jpg",
  "Календарь и время": "assets/categories/calendar.jpg",
  "Семья и отношения": "assets/categories/family.jpg",
  "Предметы и вещи": "assets/categories/objects.jpg",
  "Служебные слова": "assets/categories/function-words.jpg",
  "Птицы": "assets/categories/birds.jpg",
  "Насекомые": "assets/categories/insects.jpg",
  "Цветы и растения": "assets/categories/plants.jpg",
  "Геометрические фигуры": "assets/categories/shapes.jpg",
  "Водитель": "assets/categories/driver.jpg",
  "Косметика": "assets/categories/cosmetics.jpg",
  "Офис": "assets/categories/office.jpg",
  "Здоровье": "assets/categories/health.jpg",
};

const boardEl = document.getElementById("board");
const boardFrameEl = document.getElementById("board-frame");
const pairsLeftEl = document.getElementById("pairs-left");
const movesEl = document.getElementById("moves");
const timerEl = document.getElementById("timer");
const muteBtn = document.getElementById("mute-btn");
const restartBtn = document.getElementById("restart-btn");
const popupEl = document.getElementById("match-popup");
const winScreenEl = document.getElementById("win-screen");
const winStatsEl = document.getElementById("win-stats");
const playAgainBtn = document.getElementById("play-again-btn");
const voiceSelect = document.getElementById("voice-select");
const testVoiceBtn = document.getElementById("test-voice-btn");
const replayBtn = document.getElementById("replay-btn");
const layoutBackBtn = document.getElementById("layout-back-btn");
const layoutPlayBtn = document.getElementById("layout-play-btn");
const backToSetupBtn = document.getElementById("back-to-setup-btn");
const apiKeyInput = document.getElementById("api-key-input");
const wordInput = document.getElementById("word-input");
const generateWordsBtn = document.getElementById("generate-words-btn");
const generateProgressEl = document.getElementById("generate-progress");
const tileCountSlider = document.getElementById("tile-count-slider");
const tileCountLabel = document.getElementById("tile-count-label");
const deckSummaryEl = document.getElementById("deck-summary");
const shapeButtons = document.querySelectorAll(".shape-btn");
const catalogGridEl = document.getElementById("catalog-grid");
const catalogSelectedCountEl = document.getElementById("catalog-selected-count");
const catalogTotalCountEl = document.getElementById("catalog-total-count");
const catalogAvailableCountEl = document.getElementById("catalog-available-count");
const catalogMasteredCountEl = document.getElementById("catalog-mastered-count");
const openAddWordsBtn = document.getElementById("open-add-words-btn");
const catalogNextBtn = document.getElementById("catalog-next-btn");
const categoryBackBtn = document.getElementById("category-back-btn");
const categoryDoneBtn = document.getElementById("category-done-btn");
const categoryNextBtn = document.getElementById("category-next-btn");
const categoryTitleEl = document.getElementById("category-title");
const categoryWordListEl = document.getElementById("category-word-list");
const categorySelectAllBtn = document.getElementById("category-select-all-btn");
const categorySelectNoneBtn = document.getElementById("category-select-none-btn");
const addWordsBackBtn = document.getElementById("add-words-back-btn");
const selectAllBtn = document.getElementById("select-all-btn");
const selectNoneBtn = document.getElementById("select-none-btn");
const reclassifyBtn = document.getElementById("reclassify-btn");
const compressIconsBtn = document.getElementById("compress-icons-btn");
const topicInput = document.getElementById("topic-input");
const topicCountInput = document.getElementById("topic-count-input");
const suggestTopicBtn = document.getElementById("suggest-topic-btn");
const topicSuggestionsEl = document.getElementById("topic-suggestions");
const topicSuggestionsListEl = document.getElementById("topic-suggestions-list");
const approveSuggestionsBtn = document.getElementById("approve-suggestions-btn");
const cancelSuggestionsBtn = document.getElementById("cancel-suggestions-btn");

let tiles = [];
let selected = null;
let pairsLeft = 0;
let moves = 0;
let seconds = 0;
let timerHandle = null;
let muted = false;
let inputLocked = false;
let allVoices = [];
let lastSpokenWord = null;
let customWords = [];
let categoryManifest = [];
let manifestByTheme = new Map();
let currentSuggestions = [];

const VOICE_STORAGE_KEY = "mahjong-tts-voice";
const EXCLUDED_STORAGE_KEY = "mahjong-excluded-words";

function getExcludedWords() {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXCLUDED_STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveExcludedWords(set) {
  localStorage.setItem(EXCLUDED_STORAGE_KEY, JSON.stringify([...set]));
}

let excludedWords = getExcludedWords();

// Система "выученности" слов: streak = сколько раз подряд слово было собрано в пару
// БЕЗ единой ошибки (см. onTileClick) — любая ошибка с участием этого слова сбрасывает
// streak в 0. Чем выше streak, тем реже слово попадает в новую раскладку, а после
// 10 чистых повторов оно считается выученным и из обычной ротации исключается.
const PROGRESS_STORAGE_KEY = "mahjong-word-progress";

function getWordProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveWordProgress() {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(wordProgress));
}

let wordProgress = getWordProgress();

// weight — во сколько раз чаще слово из этого "ящика" попадает в новую раскладку
// относительно других ящиков; у "выученного" вес 0 — оно перестаёт появляться.
const PROGRESS_BOXES = [
  { id: "new", max: 2, label: "новое", emoji: "🔴", weight: 3 },
  { id: "learning", max: 5, label: "учится", emoji: "🟡", weight: 2 },
  { id: "almost", max: 9, label: "почти выучено", emoji: "🟢", weight: 1 },
  { id: "mastered", max: Infinity, label: "выучено", emoji: "⭐", weight: 0 },
];

function getWordStreak(tr) {
  return (wordProgress[tr] && wordProgress[tr].streak) || 0;
}

function getWordBox(tr) {
  const streak = getWordStreak(tr);
  return PROGRESS_BOXES.find((b) => streak <= b.max);
}

function bumpWordStreak(tr, correct) {
  const streak = correct ? Math.min(getWordStreak(tr) + 1, 15) : 0;
  wordProgress[tr] = { streak };
  saveWordProgress();
}

// Ручная пометка "уже знаю это слово" — сразу переводит слово в ящик "выучено"
// (см. PROGRESS_BOXES), не дожидаясь 10 чистых повторов в игре. Найти порог "mastered"
// динамически, а не хардкодить число — чтобы не разъехалось, если пороги поменяются.
function markWordKnown(tr) {
  const masteredBox = PROGRESS_BOXES.find((b) => b.id === "mastered");
  const threshold = PROGRESS_BOXES[PROGRESS_BOXES.indexOf(masteredBox) - 1].max + 1;
  wordProgress[tr] = { streak: threshold };
  saveWordProgress();
}

// Сколько слов всего дошло до статуса "выучено" (⭐) — по всем словам, что вообще
// встречались в игре или были отмечены "✓ Знаю", не только из текущей подборки.
function getMasteredCount() {
  return Object.keys(wordProgress).filter((tr) => getWordBox(tr).id === "mastered").length;
}

// Не больше стольки совсем новых слов в одной раскладке — если открыть свежую
// категорию целиком из незнакомых слов, играть было бы невозможно тяжело.
// Остальные места в раскладке добираются повторами уже отобранных слов и/или
// словами, которые попроще (учатся/почти выучены/выучены).
const MAX_NEW_WORDS_PER_GAME = 10;

// Строит колоду ровно из pairsNeeded слов, взвешенно по тому, насколько слово ещё
// не выучено (см. PROGRESS_BOXES) — так недавно ошибочные/новые слова встречаются
// в раскладке чаще, а хорошо выученные постепенно пропадают из ротации.
function buildWeightedDeck(deck, pairsNeeded) {
  const newWords = deck.filter((w) => getWordBox(w.tr).id === "new");
  const shuffledNew = [...newWords];
  for (let i = shuffledNew.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledNew[i], shuffledNew[j]] = [shuffledNew[j], shuffledNew[i]];
  }
  const allowedNew = new Set(shuffledNew.slice(0, MAX_NEW_WORDS_PER_GAME).map((w) => w.tr));
  const eligible = deck.filter((w) => getWordBox(w.tr).id !== "new" || allowedNew.has(w.tr));

  const pool = [];
  eligible.forEach((w) => {
    const weight = getWordBox(w.tr).weight;
    for (let i = 0; i < weight; i++) pool.push(w);
  });
  if (!pool.length) pool.push(...(eligible.length ? eligible : deck)); // всё выучено — всё равно даём поиграть

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const result = [];
  for (let i = 0; i < pairsNeeded; i++) result.push(pool[i % pool.length]);
  return result;
}

function loadVoices() {
  allVoices = speechSynthesis.getVoices();
  if (!allVoices.length) return;

  const trVoices = allVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("tr"));
  const otherVoices = allVoices.filter((v) => !trVoices.includes(v));
  const ordered = [...trVoices, ...otherVoices];

  const savedName = localStorage.getItem(VOICE_STORAGE_KEY);
  voiceSelect.innerHTML = "";
  ordered.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})${trVoices.includes(v) ? " ★" : ""}`;
    voiceSelect.appendChild(opt);
  });

  if (savedName && ordered.some((v) => v.name === savedName)) {
    voiceSelect.value = savedName;
  } else if (trVoices.length) {
    voiceSelect.value = trVoices[0].name;
  }
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function getSelectedVoice() {
  const name = voiceSelect.value;
  return allVoices.find((v) => v.name === name) || null;
}

function speak(text) {
  lastSpokenWord = text;
  if (muted || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = getSelectedVoice();
  u.lang = voice ? voice.lang : "tr-TR";
  if (voice) u.voice = voice;
  u.rate = 0.85;
  u.pitch = 1;
  speechSynthesis.speak(u);
}

voiceSelect.addEventListener("change", () => {
  localStorage.setItem(VOICE_STORAGE_KEY, voiceSelect.value);
});

testVoiceBtn.addEventListener("click", () => speak("Merhaba, nasılsın?"));

replayBtn.addEventListener("click", () => {
  if (lastSpokenWord) speak(lastSpokenWord);
});

// Все доступные слова (базовые + свои), без учёта выбора. Кастомное слово
// перекрывает базовое, если совпадает по написанию.
function getAllAvailableWords() {
  const byTr = new Map();
  WORDS.forEach((w) => byTr.set(w.tr, { ...w, icon: null }));
  customWords.forEach((w) => byTr.set(w.tr, w));
  return [...byTr.values()];
}

// Колода для игры — только отмеченные чекбоксом слова.
function getActiveDeck() {
  return getAllAvailableWords().filter((w) => !excludedWords.has(w.tr));
}

const TILE_W = 64;
const TILE_H = 84;
const UNIT_X = TILE_W / 2;
const UNIT_Y = TILE_H / 2;
const LAYER_SHIFT = 7; // px смещения на слой — создаёт эффект приподнятой стопки

function renderIcon(container, tile) {
  container.innerHTML = "";
  container.classList.remove("svg-icon");
  if (COLOR_WORDS[tile.tr]) {
    container.style.display = "";
    container.style.background = COLOR_WORDS[tile.tr];
    return;
  }
  const src = tile.icon || IMAGE_FILES[tile.tr];
  if (!src) {
    container.style.display = "none";
    return;
  }
  container.style.display = "";
  container.style.background = "";
  if (src.startsWith("data:image/svg+xml") || src.endsWith(".svg")) {
    container.classList.add("svg-icon");
  }
  const img = document.createElement("img");
  img.src = src;
  img.alt = tile.tr;
  container.appendChild(img);
}

// Лицо игровой плитки со стороны "картинки": если для слова есть иллюстрация — показываем
// её, как и раньше (понятные существительные/глаголы учатся по образу); если иллюстрации
// нет — показываем русское слово текстом на светло-зелёном фоне. Так словам, которые трудно
// нарисовать однозначно (служебные слова, абстрактные понятия), не нужна картинка вовсе —
// они всегда учатся прямым переводом.
function renderTileFace(el, tile) {
  el.innerHTML = "";
  el.style.background = "";
  el.classList.remove("has-icon", "has-number", "svg-icon");
  if (COLOR_WORDS[tile.tr]) {
    el.classList.add("has-icon");
    el.style.background = COLOR_WORDS[tile.tr];
    return;
  }
  if (NUMBER_VALUES[tile.tr]) {
    el.classList.add("has-number");
    el.textContent = NUMBER_VALUES[tile.tr];
    return;
  }
  if (DIRECTION_LETTERS[tile.tr]) {
    el.classList.add("has-number");
    el.textContent = DIRECTION_LETTERS[tile.tr];
    return;
  }
  const src = tile.icon || IMAGE_FILES[tile.tr];
  if (src) {
    el.classList.add("has-icon");
    if (src.startsWith("data:image/svg+xml") || src.endsWith(".svg")) {
      el.classList.add("svg-icon");
    }
    const img = document.createElement("img");
    img.src = src;
    img.alt = tile.tr;
    el.appendChild(img);
    return;
  }
  el.classList.remove("has-icon");
  el.textContent = tile.ru;
}

// Значок категории в уголке плитки — помогает увидеть, что два слова из одной
// тематической группы, даже когда сами плитки — это просто текст без картинки.
function renderCategoryBadge(el, tile) {
  const emoji = CATEGORY_EMOJI[tile.theme];
  if (!emoji) return;
  const badge = document.createElement("span");
  badge.className = "tile-badge";
  badge.textContent = emoji;
  el.appendChild(badge);
}

function refreshFreeStates() {
  tiles.forEach((t) => {
    if (t.matched) return;
    t.free = isTileFree(t, tiles);
    const el = tileEl(t.id);
    if (el) el.classList.toggle("blocked", !t.free);
  });
}

let boardNaturalW = 0;
let boardNaturalH = 0;

// Поле строится в реальных px под координаты пирамиды (см. mahjong-layout.js) и может
// оказаться крупнее экрана телефона при большом числе плиток — масштабируем весь board
// целиком через transform, а board-frame занимает ровно видимый (уменьшенный) размер,
// чтобы страница не расползалась вбок/вниз и не требовала скролла.
function fitBoardToViewport() {
  if (!boardNaturalW || !boardNaturalH) return;
  const mainEl = boardFrameEl.parentElement;
  const mainStyle = getComputedStyle(mainEl);
  const mainRect = mainEl.getBoundingClientRect();
  const padTop = parseFloat(mainStyle.paddingTop) || 0;
  const padBottom = parseFloat(mainStyle.paddingBottom) || 0;
  const padLeft = parseFloat(mainStyle.paddingLeft) || 0;
  const padRight = parseFloat(mainStyle.paddingRight) || 0;
  const maxW = mainRect.width - padLeft - padRight;
  const maxH = window.innerHeight - mainRect.top - padTop - padBottom - 8;
  const scale = Math.min(1, maxW / boardNaturalW, maxH / boardNaturalH);
  boardEl.style.transform = `scale(${scale})`;
  boardFrameEl.style.width = `${boardNaturalW * scale}px`;
  boardFrameEl.style.height = `${boardNaturalH * scale}px`;
}

window.addEventListener("resize", fitBoardToViewport);
// На части мобильных браузеров (особенно Android Chrome) innerWidth/innerHeight
// в момент самого события поворота ещё старые, а адресная строка выезжает/уезжает
// с задержкой — поэтому пересчитываем несколько раз с разной задержкой на всякий случай.
window.addEventListener("orientationchange", () => {
  [50, 200, 500, 1000].forEach((delay) => setTimeout(fitBoardToViewport, delay));
});
// Самый надёжный способ: следить за реальным изменением размера контейнера поля,
// а не гадать по событиям — сработает независимо от их точности/задержек.
if (window.ResizeObserver) {
  new ResizeObserver(() => fitBoardToViewport()).observe(boardFrameEl.parentElement);
}

// Флоу: слова → тип расклада → игра. Только один экран виден за раз (см. body[data-screen] в style.css).
function setScreen(name) {
  document.body.dataset.screen = name;
  if (name === "game") fitBoardToViewport();
}

function render() {
  boardEl.innerHTML = "";
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  tiles.forEach((t) => {
    maxX = Math.max(maxX, t.x);
    maxY = Math.max(maxY, t.y);
    maxZ = Math.max(maxZ, t.z);
  });
  const naturalW = (maxX + 2) * UNIT_X + maxZ * LAYER_SHIFT + TILE_W / 2;
  const naturalH = (maxY + 2) * UNIT_Y + maxZ * LAYER_SHIFT + TILE_H / 2;
  boardEl.style.width = `${naturalW}px`;
  boardEl.style.height = `${naturalH}px`;
  boardNaturalW = naturalW;
  boardNaturalH = naturalH;

  tiles.forEach((tile) => {
    const el = document.createElement("div");
    el.className = `tile type-${tile.type}`;
    el.dataset.id = tile.id;
    el.title = `${tile.tr} — ${tile.ru}`;
    el.style.left = `${tile.x * UNIT_X + tile.z * LAYER_SHIFT}px`;
    el.style.top = `${tile.y * UNIT_Y - tile.z * LAYER_SHIFT}px`;
    el.style.zIndex = tile.z * 1000 + tile.y * 10 + tile.x + 1;
    if (tile.type === "image") {
      renderTileFace(el, tile);
    } else {
      el.textContent = tile.tr;
    }
    renderCategoryBadge(el, tile);
    if (tile.matched) el.classList.add("matched");
    el.addEventListener("click", () => onTileClick(tile.id));
    boardEl.appendChild(el);
  });

  refreshFreeStates();
  fitBoardToViewport();
}

function tileEl(id) {
  return boardEl.querySelector(`[data-id="${id}"]`);
}

function onTileClick(id) {
  if (inputLocked) return;
  const tile = tiles.find((t) => t.id === id);
  if (!tile || tile.matched || !tile.free) return;

  if (selected === null) {
    selected = tile;
    tileEl(id).classList.add("selected");
    return;
  }

  if (selected.id === id) {
    tileEl(id).classList.remove("selected");
    selected = null;
    return;
  }

  moves++;
  movesEl.textContent = moves;

  const isMatch = selected.pairId === tile.pairId && selected.type !== tile.type;

  if (isMatch) {
    inputLocked = true;
    const a = tileEl(selected.id);
    const b = tileEl(id);
    a.classList.remove("selected");
    a.classList.add("matched");
    b.classList.add("matched");
    tile.matched = true;
    selected.matched = true;

    showMatchPopup(tile);
    speak(tile.tr);
    refreshFreeStates();
    // Пара, собранная по подсказке, не считается самостоятельным правильным ответом —
    // иначе слово выглядело бы "выученным", хотя игрок его на самом деле не вспомнил.
    if (!selected.hinted && !tile.hinted) bumpWordStreak(tile.tr, true);

    pairsLeft--;
    pairsLeftEl.textContent = pairsLeft;
    selected = null;

    setTimeout(() => {
      inputLocked = false;
      if (pairsLeft === 0) endGame();
    }, 900);
  } else {
    inputLocked = true;
    const a = tileEl(selected.id);
    const b = tileEl(id);
    a.classList.add("mismatch");
    b.classList.add("mismatch");
    bumpWordStreak(selected.tr, false);
    bumpWordStreak(tile.tr, false);
    selected = null;
    setTimeout(() => {
      a.classList.remove("mismatch", "selected");
      b.classList.remove("mismatch");
      inputLocked = false;
    }, 400);
  }
}

function showMatchPopup(tile) {
  renderIcon(popupEl.querySelector(".match-icon"), tile);
  popupEl.querySelector(".match-tr").textContent = tile.tr;
  popupEl.querySelector(".match-ru").textContent = tile.ru;
  popupEl.classList.remove("hidden");
  clearTimeout(popupEl._hideTimer);
  popupEl._hideTimer = setTimeout(() => popupEl.classList.add("hidden"), 4500);
}

// Клик по свободному фону (не по самой карточке) сразу закрывает плашку —
// не нужно ждать 4.5 секунды, если слово и так понятно.
popupEl.addEventListener("click", (e) => {
  if (e.target === popupEl) {
    clearTimeout(popupEl._hideTimer);
    popupEl.classList.add("hidden");
  }
});

function showHint() {
  const free = tiles.filter((t) => !t.matched && t.free);
  for (const t of free) {
    const partner = free.find(
      (p) => p.pairId === t.pairId && p.type !== t.type
    );
    if (partner) {
      [t, partner].forEach((h) => {
        h.hinted = true; // запоминаем на самой плитке — переживает подсветку и её таймаут
        const el = tileEl(h.id);
        if (el) {
          el.classList.add("hint");
          setTimeout(() => el.classList.remove("hint"), 1800);
        }
      });
      return;
    }
  }
}

// Перемешать оставшиеся (ещё не собранные) плитки — полезно, если раскладка зашла
// в тупик (среди свободных плиток нет ни одной подходящей пары для хода). Форма и
// количество плиток не меняются — просто заново раздаём слова по тем же местам
// через тот же алгоритм гарантированной решаемости, что и при старте игры.
function shuffleTiles() {
  if (inputLocked) return;
  const matchedTiles = tiles.filter((t) => t.matched);
  const remaining = tiles.filter((t) => !t.matched);
  if (remaining.length < 2) return;

  const positions = remaining.map((t) => ({ x: t.x, y: t.y, z: t.z }));
  const order = computeRemovalOrder(positions);
  const contentDeck = remaining
    .filter((t) => t.type === "image")
    .map((t) => ({ tr: t.tr, ru: t.ru, icon: t.icon }));
  for (let i = contentDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [contentDeck[i], contentDeck[j]] = [contentDeck[j], contentDeck[i]];
  }

  let nextId = Math.max(-1, ...tiles.map((t) => t.id)) + 1;
  const rebuilt = [];
  order.forEach(([posA, posB], i) => {
    const w = contentDeck[i % contentDeck.length];
    const isImageFirst = Math.random() < 0.5;
    const imagePos = isImageFirst ? posA : posB;
    const wordPos = isImageFirst ? posB : posA;
    rebuilt.push({
      id: nextId++,
      pairId: w.tr,
      type: "image",
      tr: w.tr,
      ru: w.ru,
      icon: w.icon,
      x: imagePos.x,
      y: imagePos.y,
      z: imagePos.z,
      matched: false,
    });
    rebuilt.push({
      id: nextId++,
      pairId: w.tr,
      type: "word",
      tr: w.tr,
      ru: w.ru,
      icon: w.icon,
      x: wordPos.x,
      y: wordPos.y,
      z: wordPos.z,
      matched: false,
    });
  });

  tiles = [...matchedTiles, ...rebuilt];
  selected = null;
  render();
}

function startTimer() {
  stopTimer();
  seconds = 0;
  timerEl.textContent = "00:00";
  timerHandle = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function endGame() {
  stopTimer();
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  winStatsEl.textContent = `Время: ${m}:${s} · Ходы: ${moves}`;
  winScreenEl.classList.remove("hidden");
}

function newGame() {
  const deck = getActiveDeck();
  if (!deck.length) {
    generateProgressEl.textContent = "Нет слов для игры — включи базовый набор или добавь свои слова.";
    renderCatalog();
    setScreen("catalog");
    return;
  }
  const tileCount = Number(tileCountSlider.value);
  const pairsNeeded = Math.max(1, Math.floor(tileCount / 2));
  const weightedDeck = buildWeightedDeck(deck, pairsNeeded);
  tiles = buildLayeredBoard(weightedDeck, tileCount, selectedShape);
  selected = null;
  pairsLeft = tiles.length / 2;
  moves = 0;
  inputLocked = false;
  pairsLeftEl.textContent = pairsLeft;
  movesEl.textContent = moves;
  winScreenEl.classList.add("hidden");
  popupEl.classList.add("hidden");
  render();
  startTimer();
}

muteBtn.addEventListener("click", () => {
  muted = !muted;
  muteBtn.textContent = muted ? "🔇" : "🔊";
  if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
});

restartBtn.addEventListener("click", newGame);
playAgainBtn.addEventListener("click", newGame);
document.getElementById("hint-btn").addEventListener("click", showHint);
document.getElementById("shuffle-btn").addEventListener("click", shuffleTiles);

// ---- Флоу: каталог/категория/добавить слова → тип расклада → игра ----

layoutBackBtn.addEventListener("click", () => {
  renderCatalog();
  setScreen("catalog");
});
layoutPlayBtn.addEventListener("click", () => {
  setScreen("game");
  newGame();
});
backToSetupBtn.addEventListener("click", () => {
  renderCatalog();
  setScreen("catalog");
});

apiKeyInput.value = getApiKey();
apiKeyInput.addEventListener("change", () => setApiKey(apiKeyInput.value));

tileCountSlider.addEventListener("input", () => {
  tileCountLabel.textContent = tileCountSlider.value;
  updateDeckSummary();
});

// ---- Форма расклада ----

const SHAPE_STORAGE_KEY = "mahjong-shape";
let selectedShape = localStorage.getItem(SHAPE_STORAGE_KEY) || "pyramid";

function renderShapeButtons() {
  shapeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.shape === selectedShape);
  });
}
renderShapeButtons();

shapeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedShape = btn.dataset.shape;
    localStorage.setItem(SHAPE_STORAGE_KEY, selectedShape);
    renderShapeButtons();
  });
});

selectAllBtn.addEventListener("click", () => {
  excludedWords = new Set();
  saveExcludedWords(excludedWords);
  renderCatalog();
});

selectNoneBtn.addEventListener("click", () => {
  excludedWords = new Set(getAllAvailableWords().map((w) => w.tr));
  saveExcludedWords(excludedWords);
  renderCatalog();
});

reclassifyBtn.addEventListener("click", async () => {
  reclassifyBtn.disabled = true;
  try {
    await reclassifyAllWords((msg) => {
      generateProgressEl.textContent = msg;
    });
    customWords = await getAllCustomWords();
    renderCatalog();
  } catch (e) {
    generateProgressEl.textContent = `Ошибка: ${e.message}`;
  } finally {
    reclassifyBtn.disabled = false;
  }
});

compressIconsBtn.addEventListener("click", async () => {
  compressIconsBtn.disabled = true;
  try {
    await compressAllStoredIcons((msg) => {
      generateProgressEl.textContent = msg;
    });
    customWords = await getAllCustomWords();
    renderCatalog();
  } catch (e) {
    generateProgressEl.textContent = `Ошибка: ${e.message}`;
  } finally {
    compressIconsBtn.disabled = false;
  }
});

// ---- Подбор слов по теме: сначала список текстом (дёшево), генерация иконок — только для одобренных ----

suggestTopicBtn.addEventListener("click", async () => {
  const topic = topicInput.value.trim();
  if (!topic) return;
  if (apiKeyInput.value.trim()) setApiKey(apiKeyInput.value);
  const apiKey = getApiKey();
  if (!apiKey) {
    alert("Сначала укажи API-ключ OpenAI");
    return;
  }
  const count = Math.min(30, Math.max(3, Number(topicCountInput.value) || 10));
  suggestTopicBtn.disabled = true;
  suggestTopicBtn.textContent = "Подбираю…";
  try {
    currentSuggestions = await suggestWordsForTopic(topic, count, apiKey);
    renderTopicSuggestions();
  } catch (e) {
    alert(`Не удалось подобрать слова: ${e.message}`);
  } finally {
    suggestTopicBtn.disabled = false;
    suggestTopicBtn.textContent = "Предложить слова";
  }
});

function renderTopicSuggestions() {
  topicSuggestionsListEl.innerHTML = "";
  if (!currentSuggestions.length) {
    topicSuggestionsEl.classList.add("hidden");
    return;
  }
  topicSuggestionsEl.classList.remove("hidden");
  currentSuggestions.forEach((w, i) => {
    const row = document.createElement("label");
    row.className = "word-select-row";
    row.title = `${w.tr} — ${w.ru}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      currentSuggestions[i]._excluded = !checkbox.checked;
    });
    row.appendChild(checkbox);
    const span = document.createElement("span");
    span.className = "row-text";
    span.textContent = `${w.tr} — ${w.ru}`;
    row.appendChild(span);
    topicSuggestionsListEl.appendChild(row);
  });
}

cancelSuggestionsBtn.addEventListener("click", () => {
  currentSuggestions = [];
  topicSuggestionsEl.classList.add("hidden");
  topicInput.value = "";
});

approveSuggestionsBtn.addEventListener("click", async () => {
  const approved = currentSuggestions.filter((w) => !w._excluded);
  if (!approved.length) return;
  approveSuggestionsBtn.disabled = true;
  generateProgressEl.textContent = "";
  try {
    await generateApprovedWords(approved, (msg) => {
      generateProgressEl.textContent += msg + "\n";
      generateProgressEl.scrollTop = generateProgressEl.scrollHeight;
    });
    customWords = await getAllCustomWords();
    renderCatalog();
    currentSuggestions = [];
    topicSuggestionsEl.classList.add("hidden");
    topicInput.value = "";
    generateProgressEl.textContent += "Готово! Можно нажать «Новая игра».";
  } catch (e) {
    generateProgressEl.textContent += `Ошибка: ${e.message}`;
  } finally {
    approveSuggestionsBtn.disabled = false;
  }
});

function updateDeckSummary() {
  const deck = getActiveDeck();
  if (!deck.length) {
    deckSummaryEl.textContent = "Слова не выбраны — игра не сформируется.";
    return;
  }
  const masteredCount = deck.filter((w) => getWordBox(w.tr).id === "mastered").length;
  let summary = `${deck.length} слов в игре — новые и недавно ошибочные будут появляться чаще, выученные — реже.`;
  if (masteredCount === deck.length) {
    summary = `Все ${deck.length} слов уже выучены 🎉 — раскладка всё равно составится из них для повторения.`;
  } else if (masteredCount) {
    summary += ` Полностью выучено: ${masteredCount} ⭐ (в обычной раскладке почти не участвуют, пока не появятся новые ошибки).`;
  }
  deckSummaryEl.textContent = summary;
}

function buildWordRow(w, onChange) {
  const isCustom = customWords.some((cw) => cw.tr === w.tr);
  const row = document.createElement("div");
  row.className = "word-select-row";
  row.title = `${w.tr} — ${w.ru}`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !excludedWords.has(w.tr);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) excludedWords.delete(w.tr);
    else excludedWords.add(w.tr);
    saveExcludedWords(excludedWords);
    updateDeckSummary();
    if (onChange) onChange();
  });
  row.appendChild(checkbox);

  const thumb = document.createElement("img");
  thumb.className = "row-thumb";
  thumb.src = w.icon || IMAGE_FILES[w.tr] || "";
  thumb.alt = w.tr;
  row.appendChild(thumb);

  const text = document.createElement("span");
  text.className = "row-text";
  text.textContent = `${w.tr} — ${w.ru}`;
  row.appendChild(text);

  const box = getWordBox(w.tr);
  const badge = document.createElement("span");
  badge.className = "row-progress-badge";
  badge.textContent = box.emoji;
  badge.title = `${box.label} (${getWordStreak(w.tr)} подряд без ошибок)`;
  row.appendChild(badge);

  if (box.id !== "mastered") {
    const knowBtn = document.createElement("button");
    knowBtn.textContent = "✓ Знаю";
    knowBtn.title = "Отметить, что уже знаю это слово — оно перестанет часто появляться";
    knowBtn.addEventListener("click", () => {
      markWordKnown(w.tr);
      const newBox = getWordBox(w.tr);
      badge.textContent = newBox.emoji;
      badge.title = `${newBox.label} (${getWordStreak(w.tr)} подряд без ошибок)`;
      knowBtn.remove();
    });
    row.appendChild(knowBtn);
  }

  if (isCustom) {
    const redoBtn = document.createElement("button");
    redoBtn.textContent = "🔄";
    redoBtn.title = "Перерисовать иконку";
    redoBtn.addEventListener("click", async () => {
      redoBtn.disabled = true;
      redoBtn.textContent = "…";
      try {
        const icon = await regenerateWordIcon(w.tr, w.ru, w.visual, w.pos, w.theme);
        w.icon = icon;
        thumb.src = icon;
      } catch (e) {
        alert(`Не удалось перерисовать «${w.tr}»: ${e.message}`);
      } finally {
        redoBtn.disabled = false;
        redoBtn.textContent = "🔄";
      }
    });
    row.appendChild(redoBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.title = "Удалить слово";
    delBtn.addEventListener("click", async () => {
      await deleteCustomWord(w.tr);
      customWords = customWords.filter((cw) => cw.tr !== w.tr);
      excludedWords.delete(w.tr);
      saveExcludedWords(excludedWords);
      if (onChange) onChange();
    });
    row.appendChild(delBtn);
  }

  return row;
}

// Каталог: плитки по фиксированным категориям (см. CATEGORIES в wordbank.js) —
// открываешь плитку и внутри видишь список слов этой категории, как раздел
// в интернет-магазине. Пустые категории (нет ни одного слова) не показываются.
let currentCategoryTheme = null;

function wordsByCategory() {
  const words = getAllAvailableWords();
  const byTheme = new Map();
  words.forEach((w) => {
    const theme = normalizeCategory(w.theme);
    if (!byTheme.has(theme)) byTheme.set(theme, []);
    byTheme.get(theme).push(w);
  });
  return byTheme;
}

function formatSize(kb) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} МБ`;
  return `${Math.round(kb)} КБ`;
}

function renderCatalog() {
  document.getElementById("catalog-loading").classList.add("hidden");
  const words = getAllAvailableWords();
  const selectedCount = words.filter((w) => !excludedWords.has(w.tr)).length;
  catalogSelectedCountEl.textContent = selectedCount;
  catalogTotalCountEl.textContent = words.length;
  catalogAvailableCountEl.textContent = categoryManifest.reduce((s, m) => s + m.count, 0);
  catalogMasteredCountEl.textContent = getMasteredCount();

  const byTheme = wordsByCategory();
  const loaded = getLoadedCategories();
  catalogGridEl.innerHTML = "";
  CATEGORIES.forEach((theme) => {
    const manifestEntry = manifestByTheme.get(theme);
    const manifestCount = manifestEntry ? manifestEntry.count : 0;
    const themeWords = byTheme.get(theme) || [];
    if (!manifestCount && !themeWords.length) return; // категория пока без слов

    const isLoaded = loaded.has(theme);
    const themeSelected = themeWords.filter((w) => !excludedWords.has(w.tr)).length;

    const tile = document.createElement("div");
    tile.className = "catalog-tile" + (isLoaded ? "" : " not-loaded");
    const image = CATEGORY_IMAGE[theme];
    const visual = image
      ? `<img class="tile-image" src="${image}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'emoji',textContent:'${CATEGORY_EMOJI[theme] || "🔤"}'}))" />`
      : `<span class="emoji">${CATEGORY_EMOJI[theme] || "🔤"}</span>`;
    const countLabel = isLoaded
      ? `${themeSelected}/${themeWords.length || manifestCount}`
      : `⬇ ${manifestCount} слов`;
    const sizeLabel =
      !isLoaded && manifestEntry ? `<span class="size">${formatSize(manifestEntry.sizeKB)}</span>` : "";
    tile.innerHTML =
      visual +
      `<div class="tile-overlay">` +
      `<span class="name">${theme}</span>` +
      `<span class="count">${countLabel}</span>` +
      sizeLabel +
      `</div>`;
    tile.addEventListener("click", () => openCategory(theme));
    catalogGridEl.appendChild(tile);
  });

  updateDeckSummary();
}

async function openCategory(theme) {
  currentCategoryTheme = theme;
  categoryTitleEl.textContent = `${CATEGORY_EMOJI[theme] || "🔤"} ${theme}`;
  setScreen("category");
  if (!getLoadedCategories().has(theme)) {
    categoryWordListEl.innerHTML = `<div class="catalog-loading">⏳ Загружаем слова…</div>`;
    await loadCategoryWords(theme);
    customWords = await getAllCustomWords();
  }
  renderCategoryWordList();
}

function renderCategoryWordList() {
  const byTheme = wordsByCategory();
  const words = (byTheme.get(currentCategoryTheme) || []).sort((a, b) => a.tr.localeCompare(b.tr, "tr"));
  categoryWordListEl.innerHTML = "";
  const list = document.createElement("div");
  list.className = "word-select-list-inner";
  words.forEach((w) => list.appendChild(buildWordRow(w, renderCategoryWordList)));
  categoryWordListEl.appendChild(list);
  updateDeckSummary();
}

categorySelectAllBtn.addEventListener("click", () => {
  const byTheme = wordsByCategory();
  (byTheme.get(currentCategoryTheme) || []).forEach((w) => excludedWords.delete(w.tr));
  saveExcludedWords(excludedWords);
  renderCategoryWordList();
});

categorySelectNoneBtn.addEventListener("click", () => {
  const byTheme = wordsByCategory();
  (byTheme.get(currentCategoryTheme) || []).forEach((w) => excludedWords.add(w.tr));
  saveExcludedWords(excludedWords);
  renderCategoryWordList();
});

categoryBackBtn.addEventListener("click", () => {
  renderCatalog();
  setScreen("catalog");
});
categoryDoneBtn.addEventListener("click", () => {
  renderCatalog();
  setScreen("catalog");
});
categoryNextBtn.addEventListener("click", () => setScreen("layout"));
catalogNextBtn.addEventListener("click", () => setScreen("layout"));
openAddWordsBtn.addEventListener("click", () => setScreen("add-words"));
addWordsBackBtn.addEventListener("click", () => {
  renderCatalog();
  setScreen("catalog");
});

document.getElementById("export-words-btn").addEventListener("click", async () => {
  const n = await exportWordBank();
  if (!n) alert("Пока нечего экспортировать — сначала добавь свои слова.");
});

const importInput = document.getElementById("import-words-input");
document.getElementById("import-words-btn").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    const n = await importWordBankFile(file);
    customWords = await getAllCustomWords();
    renderCatalog();
    generateProgressEl.textContent = `Импортировано слов: ${n}`;
  } catch (e) {
    alert(`Ошибка импорта: ${e.message}`);
  }
  importInput.value = "";
});

generateWordsBtn.addEventListener("click", async () => {
  const raw = wordInput.value
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
  if (!raw.length) return;
  if (apiKeyInput.value.trim()) setApiKey(apiKeyInput.value);
  generateWordsBtn.disabled = true;
  generateProgressEl.textContent = "";
  try {
    await addCustomWords(raw, (msg) => {
      generateProgressEl.textContent += msg + "\n";
      generateProgressEl.scrollTop = generateProgressEl.scrollHeight;
    });
    customWords = await getAllCustomWords();
    renderCatalog();
    wordInput.value = "";
    generateProgressEl.textContent += "Готово! Можно нажать «Новая игра».";
  } catch (e) {
    generateProgressEl.textContent += `Ошибка: ${e.message}`;
  } finally {
    generateWordsBtn.disabled = false;
  }
});

(async function init() {
  await seedBaseWordsIfNeeded();
  await restoreAiIconsIfNeeded();
  categoryManifest = await fetchCategoryManifest();
  manifestByTheme = new Map(categoryManifest.map((m) => [m.theme, m]));
  customWords = await getAllCustomWords();
  renderCatalog();
  setScreen("catalog");
  // Проверка правок в уже открытых категориях — не блокирует показ каталога.
  syncLoadedCategories().then(async (n) => {
    if (n > 0) {
      customWords = await getAllCustomWords();
      renderCatalog();
    }
  });
})();
