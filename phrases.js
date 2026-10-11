// Режим "Фразы": каталог тем (ленивая загрузка по манифесту — по аналогии с каталогом
// слов в wordbank.js/script.js) → экран темы с выбором фраз (чекбоксы + "✓ Знаю",
// как buildWordRow) → игра «Пароход до Каракёя» (рейсы по 10 фраз, разные типы вопросов). Переиспользует speak()/muted/setScreen()
// из script.js (общий глобальный скоуп классических <script>, без модулей).
//
// Квиз может идти по ОДНОЙ теме (кнопка "Играть" на экране темы) или сразу по НЕСКОЛЬКИМ
// темам вперемешку (чекбоксы на плитках каталога + "▶ Играть вместе") — перемешивание
// между темами не даёт фразам "примелькаться" по порядку внутри одной темы.

const PHRASES_MANIFEST_URL = "assets/phrases/manifest.json";
const PHRASES_DIR = "assets/phrases";

const PHRASE_PROGRESS_KEY = "mahjong-phrase-progress";
const PHRASE_EXCLUDED_KEY = "mahjong-phrase-excluded";
const PHRASE_LOADED_KEY = "mahjong-phrase-loaded-topics";

// Тот же принцип "ящиков", что и для слов (см. PROGRESS_BOXES в script.js), но отдельное
// хранилище — прогресс по фразам не должен смешиваться с прогрессом по словам маджонга.
// В отличие от слов, переход между ящиками здесь разнесён по времени (см. ниже,
// система Лейтнера) — не через "N подряд правильных за один присест".
const PHRASE_BOXES = [
  { id: "new", label: "новое", emoji: "🔴", weight: 3 },
  { id: "learning", label: "учится", emoji: "🟡", weight: 2 },
  { id: "almost", label: "почти выучено", emoji: "🟢", weight: 1 },
  { id: "mastered", label: "выучено", emoji: "⭐", weight: 0 },
];
const PHRASE_BOX_ORDER = PHRASE_BOXES.map((b) => b.id);

// Не больше стольки совсем новых фраз "в работе" одновременно (см. MAX_NEW_WORDS_PER_GAME
// в script.js — тот же принцип): открыть свежую тему и сразу получить только незнакомые
// фразы подряд — тяжело и не запоминается. Остальные места в раскладке добираются
// повторами уже отобранных фраз и/или более простыми (учится/почти выучено/выучено).
const MAX_NEW_PHRASES_PER_SESSION = 15;

let phraseManifest = []; // [{id, title, source, count, sizeKB}]

// Уровни A1…B2 — assets/phrases/levels.json (собирает tools/phrases/build_levels.py):
// порядок тем по уровням и уровень каждой фразы. «Уровень фраз» — потолок, как у слов
// маджонга: фразы выше него в рейс не попадают.
const PHRASE_LEVEL_ORDER = ["A1", "A2", "B1", "B2"];
const PHRASE_LEVEL_LABELS = { A1: "самая база", A2: "бытовое", B1: "шире повседневного", B2: "специальное" };
const PHRASE_LEVEL_CAP_KEY = "mahjong-phrase-level";
let phraseLevels = null; // {order: [id], topics: {id: {level, counts}}, phrases: {id: {tr: level}}}
let phraseLevelCap = localStorage.getItem(PHRASE_LEVEL_CAP_KEY) || "B2";
let quizMaxLevel = null; // потолок текущего рейса («весь A1» — только A1)
let quizExactLevel = false;

async function fetchPhraseLevels() {
  if (phraseLevels) return phraseLevels;
  try {
    const resp = await fetch("assets/phrases/levels.json");
    phraseLevels = resp.ok ? await resp.json() : { order: [], topics: {}, phrases: {} };
  } catch {
    phraseLevels = { order: [], topics: {}, phrases: {} };
  }
  return phraseLevels;
}
function topicLevel(topicId) {
  return (phraseLevels && phraseLevels.topics[topicId] && phraseLevels.topics[topicId].level) || "B1";
}
function phraseLevel(topicId, p) {
  if (p.level) return p.level;
  const map = phraseLevels && phraseLevels.phrases[topicId];
  return (map && map[p.tr]) || topicLevel(topicId);
}
function levelAtMost(level, cap) {
  return PHRASE_LEVEL_ORDER.indexOf(level) <= PHRASE_LEVEL_ORDER.indexOf(cap);
}
let phraseTopicCache = new Map(); // id → {id, title, source, phrases: [...]}
let selectedForQuiz = new Set(); // id тем, отмеченных чекбоксом в каталоге для общего квиза

let currentTopics = []; // темы, участвующие в текущей сессии квиза (1 или несколько)
let currentQueue = []; // очередь элементов {phrase, topicId, id}
let allowedNewIds = null; // Set id — какие "новые" фразы допущены в этой сессии (фиксируется один раз при старте)
let currentItem = null; // {phrase, topicId, id} — текущий вопрос
let hintUsed = false;
let questionAnswered = false;

// --- прогресс (отдельно от слов) ---
function getPhraseProgress() {
  try {
    return JSON.parse(localStorage.getItem(PHRASE_PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}
let phraseProgress = getPhraseProgress();
function savePhraseProgress() {
  localStorage.setItem(PHRASE_PROGRESS_KEY, JSON.stringify(phraseProgress));
}
function phraseId(topicId, phrase) {
  return `${topicId}::${phrase.tr}`;
}
// Локальный календарный день (не UTC — иначе для восточных часовых поясов "день" менялся
// бы посреди вечера, а не в полночь по местному времени пользователя).
function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayStr() {
  return dateToStr(new Date());
}
function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return dateToStr(new Date(y, m - 1, d + days));
}

// store/save — чтобы те же ящики Лейтнера переиспользовал раздел «Грамматика»
// (grammar.js) со своим хранилищем, не смешивая прогресс с фразами.
function getPhraseBoxId(id, store = phraseProgress) {
  return (store[id] && store[id].box) || "new";
}
function getPhraseBox(id, store = phraseProgress) {
  return PHRASE_BOXES.find((b) => b.id === getPhraseBoxId(id, store));
}

// Система Лейтнера: у каждого ящика — свой интервал в днях, раньше которого фраза не
// "созрела" для перехода на следующий уровень (0 для "new" — учить можно сразу).
// Даже пока фраза не созрела, она всё равно попадается в квизе по весу ящика (см.
// buildPhraseQueue) — это просто тренировка, без продвижения вперёд.
const PHRASE_BOX_INTERVAL_DAYS = { new: 0, learning: 1, almost: 3 };
// Сколько верных ответов нужно набрать за ОДИН календарный день (когда интервал уже
// прошёл), чтобы фраза перешла на следующий уровень — одного-двух мало, могло быть
// случайное угадывание; после DAILY_CORRECT_TO_ADVANCE подряд за день это уже
// настоящее подтверждение. Комбинация даёт то, что и требовалось: выучить фразу
// "за один присест" физически невозможно — нужно обязательно вернуться к ней в другой
// день, но сам переход внутри созревшего дня не растягивается на неделю ответов.
const DAILY_CORRECT_TO_ADVANCE = 4;

// "Выучено" — не тупик: фраза уходит из ротации, но периодически возвращается на
// контрольную проверку по нарастающим интервалам (неделя → месяц → квартал →
// полгода, дальше повторяется раз в полгода). Верный ответ на контрольной проверке —
// это ОДИН ответ, а не DAILY_CORRECT_TO_ADVANCE: тут не учим заново, а просто
// подтверждаем, что не забыла, и просто отодвигаем следующую проверку дальше.
// Ошиблась — сразу назад в 🔴 "новое", как и при любой другой ошибке.
const MASTERED_REVIEW_INTERVALS_DAYS = [7, 30, 90, 180];

function bumpPhraseStreak(id, correct, store = phraseProgress, save = savePhraseProgress) {
  const today = todayStr();
  const prev = store[id] || { box: "new", dueDay: null, todayDay: null, todayCorrect: 0, reviewStage: 0 };

  if (!correct) {
    store[id] = { box: "new", dueDay: null, todayDay: today, todayCorrect: 0, reviewStage: 0 };
    save();
    return;
  }

  if (prev.box === "mastered") {
    const stage = Math.min((prev.reviewStage || 0) + 1, MASTERED_REVIEW_INTERVALS_DAYS.length - 1);
    store[id] = {
      box: "mastered",
      dueDay: addDaysStr(today, MASTERED_REVIEW_INTERVALS_DAYS[stage]),
      todayDay: today,
      todayCorrect: 0,
      reviewStage: stage,
    };
    save();
    return;
  }

  // Ящик ещё не "созрел" для перехода — засчитываем как практику, без движения вперёд.
  if (prev.dueDay && today < prev.dueDay) return;

  const todayCorrect = (prev.todayDay === today ? prev.todayCorrect || 0 : 0) + 1;

  if (todayCorrect >= DAILY_CORRECT_TO_ADVANCE) {
    const nextBox = PHRASE_BOX_ORDER[Math.min(PHRASE_BOX_ORDER.indexOf(prev.box || "new") + 1, PHRASE_BOX_ORDER.length - 1)];
    const dueDay =
      nextBox === "mastered" ? addDaysStr(today, MASTERED_REVIEW_INTERVALS_DAYS[0]) : addDaysStr(today, PHRASE_BOX_INTERVAL_DAYS[nextBox]);
    store[id] = { box: nextBox, dueDay, todayDay: today, todayCorrect: 0, reviewStage: 0 };
  } else {
    store[id] = { box: prev.box || "new", dueDay: prev.dueDay || null, todayDay: today, todayCorrect, reviewStage: prev.reviewStage || 0 };
  }
  save();
}

// Сколько сегодняшних верных ответов уже засчитано в счётчик перехода (0, если фраза
// ещё не созрела для перехода или сегодня по ней ещё не отвечали) — для подсказки в
// списке темы.
function getPhraseTodayCorrect(id) {
  const p = phraseProgress[id];
  if (!p) return 0;
  const today = todayStr();
  if (p.dueDay && today < p.dueDay) return 0;
  return p.todayDay === today ? p.todayCorrect || 0 : 0;
}

// "Созрела" ли выученная фраза для контрольной проверки — используется, чтобы решить,
// брать ли её в пул квиза (см. buildPhraseQueue): пока не назрел срок, она в квизе не
// участвует вообще, экономя место для того, что реально нужно повторять.
function isPhraseMasteredDue(id, store = phraseProgress) {
  const p = store[id];
  if (!p || p.box !== "mastered") return false;
  return !p.dueDay || todayStr() >= p.dueDay;
}

// Ручная пометка "уже знаю эту фразу" — сразу переводит в ящик "выучено", как markWordKnown,
// но тоже ставится на контрольную проверку через неделю, а не выпадает из ротации навсегда.
function markPhraseKnown(id) {
  const today = todayStr();
  phraseProgress[id] = {
    box: "mastered",
    dueDay: addDaysStr(today, MASTERED_REVIEW_INTERVALS_DAYS[0]),
    todayDay: today,
    todayCorrect: 0,
    reviewStage: 0,
  };
  savePhraseProgress();
}

// --- исключённые из практики фразы (аналог excludedWords) ---
function getExcludedPhrases() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PHRASE_EXCLUDED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
let excludedPhrases = getExcludedPhrases();
function saveExcludedPhrases() {
  localStorage.setItem(PHRASE_EXCLUDED_KEY, JSON.stringify([...excludedPhrases]));
}

// --- какие темы уже подгружены (аналог getLoadedCategories) ---
function getLoadedPhraseTopics() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PHRASE_LOADED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveLoadedPhraseTopics(set) {
  localStorage.setItem(PHRASE_LOADED_KEY, JSON.stringify([...set]));
}

// --- загрузка манифеста (лёгкий — только id/title/count/sizeKB, без текстов фраз) ---
async function fetchPhraseManifest() {
  if (phraseManifest.length) return phraseManifest;
  try {
    const resp = await fetch(PHRASES_MANIFEST_URL);
    phraseManifest = resp.ok ? await resp.json() : [];
  } catch {
    phraseManifest = [];
  }
  return phraseManifest;
}

// Подгружает фразы ОДНОЙ темы по требованию — при открытии темы в каталоге.
async function loadPhraseTopic(id) {
  if (phraseTopicCache.has(id)) return phraseTopicCache.get(id);
  const resp = await fetch(`${PHRASES_DIR}/${id}.json`);
  const topic = await resp.json();
  phraseTopicCache.set(id, topic);
  const loaded = getLoadedPhraseTopics();
  loaded.add(id);
  saveLoadedPhraseTopics(loaded);
  return topic;
}

function formatSizeKB(kb) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} МБ`;
  return `${Math.round(kb)} КБ`;
}

// --- каталог тем: по уровням A1 → B2, в каждом — «▶ весь уровень» ---
async function renderPhrasesCatalog() {
  const grid = document.getElementById("phrases-catalog-grid");
  const loadingEl = document.getElementById("phrases-catalog-loading");
  loadingEl.classList.remove("hidden");
  grid.innerHTML = "";
  await Promise.all([fetchPhraseManifest(), fetchPhraseLevels()]);
  loadingEl.classList.add("hidden");
  renderFerryMap();
  renderPhraseLevelPicker();

  const loaded = getLoadedPhraseTopics();
  let totalPhrases = 0;
  let totalMastered = 0;
  const byId = new Map(phraseManifest.map((m) => [m.id, m]));
  const ordered = [...phraseLevels.order.filter((id) => byId.has(id)), ...phraseManifest.map((m) => m.id).filter((id) => !phraseLevels.order.includes(id))];

  PHRASE_LEVEL_ORDER.forEach((level) => {
    const ids = ordered.filter((id) => topicLevel(id) === level);
    if (!ids.length) return;
    const above = !levelAtMost(level, phraseLevelCap);
    const section = document.createElement("div");
    section.className = "phrase-level-section" + (above ? " locked" : "");
    const levelCount = Object.values(phraseLevels.phrases).reduce(
      (n, map) => n + Object.values(map).filter((lv) => lv === level).length,
      0
    );
    const head = document.createElement("div");
    head.className = "phrase-level-head";
    head.innerHTML =
      `<span class="phrase-level-title">${level} · ${PHRASE_LEVEL_LABELS[level]}</span>` +
      `<span class="phrase-level-sub">${ids.length} ${ferryPlural(ids.length, "тема", "темы", "тем")} · ${levelCount} ${ferryPlural(levelCount, "фраза", "фразы", "фраз")}${above ? " · выше выбранного уровня" : ""}</span>`;
    const playAll = document.createElement("button");
    playAll.type = "button";
    playAll.className = "phrase-level-play";
    playAll.textContent = `▶ Весь ${level}`;
    playAll.title = `Рейс по всем фразам уровня ${level} из всех тем — не нужно выбирать темы вручную`;
    playAll.addEventListener("click", async () => {
      playAll.disabled = true;
      playAll.textContent = "⏳ Загружаем…";
      const topicIds = Object.keys(phraseLevels.phrases).filter((id) =>
        Object.values(phraseLevels.phrases[id]).some((lv) => lv === level)
      );
      const topics = await Promise.all(topicIds.map((id) => loadPhraseTopic(id)));
      startQuiz(topics, level, true);
    });
    head.appendChild(playAll);
    section.appendChild(head);

    const sectionGrid = document.createElement("div");
    sectionGrid.className = "catalog-grid";
    ids.forEach((id) => {
      const m = byId.get(id);
      totalPhrases += m.count;
      const isLoaded = loaded.has(m.id) && phraseTopicCache.has(m.id);
      let masteredHere = 0;
      if (isLoaded) {
        const topic = phraseTopicCache.get(m.id);
        masteredHere = topic.phrases.filter((p) => getPhraseBox(phraseId(m.id, p)).id === "mastered").length;
      }
      totalMastered += masteredHere;
      sectionGrid.appendChild(buildPhraseTopicTile(m, isLoaded, masteredHere));
    });
    section.appendChild(sectionGrid);
    grid.appendChild(section);
  });

  document.getElementById("phrases-mastered-count").textContent = totalMastered;
  document.getElementById("phrases-total-count").textContent = totalPhrases;
  document.getElementById("phrases-topic-count").textContent = phraseManifest.length;
  updatePlaySelectedButton();
}

function buildPhraseTopicTile(m, isLoaded, masteredHere) {
  const tile = document.createElement("div");
  tile.className = "catalog-tile" + (isLoaded ? "" : " not-loaded") + (selectedForQuiz.has(m.id) ? " selected-for-quiz" : "");
  const emoji = m.source === "allah" ? "☪️" : "💬";
  const countLabel = isLoaded ? `${masteredHere}/${m.count}` : `⬇ ${m.count} фраз`;
  const sizeLabel = !isLoaded ? `<span class="size">${formatSizeKB(m.sizeKB)}</span>` : "";
  tile.innerHTML =
    `<span class="emoji">${emoji}</span>` +
    `<div class="tile-overlay">` +
    `<span class="name">${m.title}</span>` +
    `<span class="count">${countLabel}</span>` +
    sizeLabel +
    `</div>`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "tile-select";
  checkbox.checked = selectedForQuiz.has(m.id);
  checkbox.title = "Взять эту тему в общий рейс вперемешку с другими";
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedForQuiz.add(m.id);
    else selectedForQuiz.delete(m.id);
    tile.classList.toggle("selected-for-quiz", checkbox.checked);
    updatePlaySelectedButton();
  });
  tile.appendChild(checkbox);
  tile.addEventListener("click", () => openPhraseTopic(m.id));
  return tile;
}

// Переключатель «Уровень фраз»: A1 → до A2 → до B1 → все (как у слов маджонга).
function renderPhraseLevelPicker() {
  const el = document.getElementById("phrase-level-buttons");
  if (!el) return;
  el.innerHTML = "";
  PHRASE_LEVEL_ORDER.forEach((lv, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "level-btn" + (lv === phraseLevelCap ? " active" : "");
    btn.textContent = i === 0 ? "A1" : i === PHRASE_LEVEL_ORDER.length - 1 ? "все" : `до ${lv}`;
    btn.addEventListener("click", () => {
      phraseLevelCap = lv;
      localStorage.setItem(PHRASE_LEVEL_CAP_KEY, lv);
      renderPhrasesCatalog();
    });
    el.appendChild(btn);
  });
}

function updatePlaySelectedButton() {
  const btn = document.getElementById("phrases-catalog-play-btn");
  document.getElementById("phrases-selected-count").textContent = selectedForQuiz.size;
  btn.disabled = selectedForQuiz.size === 0;
}

document.getElementById("phrases-catalog-play-btn").addEventListener("click", async () => {
  const ids = [...selectedForQuiz];
  if (!ids.length) return;
  const btn = document.getElementById("phrases-catalog-play-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Загружаем…";
  const topics = await Promise.all(ids.map((id) => loadPhraseTopic(id)));
  startQuiz(topics);
});

// --- экран темы: список фраз, чекбоксы "брать в работу", кнопка "✓ Знаю" ---
let currentTopicId = null;

async function openPhraseTopic(id) {
  currentTopicId = id;
  await fetchPhraseLevels();
  const manifestEntry = phraseManifest.find((m) => m.id === id);
  document.getElementById("phrase-topic-title").textContent = manifestEntry ? manifestEntry.title : "";
  setScreen("phrase-topic");
  const listEl = document.getElementById("phrase-topic-list");
  listEl.innerHTML = `<div class="catalog-loading">⏳ Загружаем фразы…</div>`;
  const topic = await loadPhraseTopic(id);
  renderPhraseTopicList(topic);
}

function buildPhraseRow(topic, p) {
  const id = phraseId(topic.id, p);
  const row = document.createElement("div");
  row.className = "word-select-row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !excludedPhrases.has(id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) excludedPhrases.delete(id);
    else excludedPhrases.add(id);
    saveExcludedPhrases();
  });
  row.appendChild(checkbox);

  const text = document.createElement("span");
  text.className = "row-text";
  text.textContent = `${p.tr} — ${p.ru}`;
  row.appendChild(text);

  const box = getPhraseBox(id);
  const badge = document.createElement("span");
  badge.className = "row-progress-badge";
  badge.textContent = box.emoji;
  badge.title = phraseStatusLabel(id);
  row.appendChild(badge);

  if (box.id !== "mastered") {
    const knowBtn = document.createElement("button");
    knowBtn.textContent = "✓ Знаю";
    knowBtn.title = "Отметить, что уже знаю эту фразу — она перестанет часто появляться";
    knowBtn.addEventListener("click", () => {
      markPhraseKnown(id);
      const newBox = getPhraseBox(id);
      badge.textContent = newBox.emoji;
      badge.title = phraseStatusLabel(id);
      knowBtn.remove();
    });
    row.appendChild(knowBtn);
  }

  return row;
}

// Текст подсказки над бейджем прогресса: сколько сегодняшних верных ответов уже
// засчитано к переходу на следующий уровень, или с какого дня фраза снова "созреет".
function phraseStatusLabel(id) {
  const box = getPhraseBox(id);
  const p = phraseProgress[id];
  if (box.id === "mastered") {
    if (p && p.dueDay) return `${box.label} — контрольная проверка с ${p.dueDay}`;
    return box.label;
  }
  const today = todayStr();
  if (p && p.dueDay && today < p.dueDay) return `${box.label} — повторить можно с ${p.dueDay}`;
  const todayCorrect = getPhraseTodayCorrect(id);
  return `${box.label} — ${todayCorrect}/${DAILY_CORRECT_TO_ADVANCE} верных сегодня`;
}

// Фразы темы — группами по уровню, у группы своя кнопка «включить / выключить» (как
// группы слов в маджонге): освоила A1 — подключаешь A2.
function renderPhraseTopicList(topic) {
  const listEl = document.getElementById("phrase-topic-list");
  listEl.innerHTML = "";
  PHRASE_LEVEL_ORDER.forEach((level) => {
    const group = topic.phrases.filter((p) => phraseLevel(topic.id, p) === level);
    if (!group.length) return;
    const above = !levelAtMost(level, phraseLevelCap);
    const section = document.createElement("div");
    section.className = "word-level-group" + (above ? " locked" : "");
    const header = document.createElement("div");
    header.className = "word-level-header";
    const on = group.filter((p) => !excludedPhrases.has(phraseId(topic.id, p))).length;
    header.innerHTML =
      `<span class="word-level-title">${level} · ${PHRASE_LEVEL_LABELS[level]}</span>` +
      `<span class="word-level-count">${on}/${group.length} включено${above ? " · выше выбранного уровня — в рейс не попадут" : ""}</span>`;
    const actions = document.createElement("span");
    actions.className = "word-level-actions";
    [
      ["Включить группу", (id) => excludedPhrases.delete(id)],
      ["Выключить", (id) => excludedPhrases.add(id)],
    ].forEach(([label, apply]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        group.forEach((p) => apply(phraseId(topic.id, p)));
        saveExcludedPhrases();
        renderPhraseTopicList(topic);
      });
      actions.appendChild(btn);
    });
    header.appendChild(actions);
    section.appendChild(header);
    const inner = document.createElement("div");
    inner.className = "word-select-list-inner";
    group.forEach((p) => inner.appendChild(buildPhraseRow(topic, p)));
    section.appendChild(inner);
    listEl.appendChild(section);
  });
}

document.getElementById("phrase-topic-select-all-btn").addEventListener("click", () => {
  const topic = phraseTopicCache.get(currentTopicId);
  if (!topic) return;
  topic.phrases.forEach((p) => excludedPhrases.delete(phraseId(topic.id, p)));
  saveExcludedPhrases();
  renderPhraseTopicList(topic);
});
document.getElementById("phrase-topic-select-none-btn").addEventListener("click", () => {
  const topic = phraseTopicCache.get(currentTopicId);
  if (!topic) return;
  topic.phrases.forEach((p) => excludedPhrases.add(phraseId(topic.id, p)));
  saveExcludedPhrases();
  renderPhraseTopicList(topic);
});
document.getElementById("phrase-topic-back-btn").addEventListener("click", () => {
  renderPhrasesCatalog();
  setScreen("phrases-catalog");
});
document.getElementById("phrase-topic-done-btn").addEventListener("click", () => {
  renderPhrasesCatalog();
  setScreen("phrases-catalog");
});
document.getElementById("phrase-topic-play-btn").addEventListener("click", () => {
  const topic = phraseTopicCache.get(currentTopicId);
  if (!topic) return;
  startQuiz([topic]);
});

// --- квиз ---
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Плоский список {phrase, topicId, id} по всем темам сессии, за вычетом снятых
// галочкой на экране темы (если так вышло, что снято всё — играем всё равно всем).
function collectItems(topics) {
  const items = [];
  const cap = quizMaxLevel || phraseLevelCap;
  // «▶ Весь A1» — ровно этот уровень; обычный рейс — всё до потолка.
  const fits = (topicId, p) => (quizExactLevel ? phraseLevel(topicId, p) === cap : levelAtMost(phraseLevel(topicId, p), cap));
  topics.forEach((topic) => {
    topic.phrases.forEach((p) => {
      const id = phraseId(topic.id, p);
      if (!excludedPhrases.has(id) && fits(topic.id, p)) items.push({ phrase: p, topicId: topic.id, id });
    });
  });
  if (items.length) return items;
  const all = [];
  topics.forEach((topic) => {
    topic.phrases.forEach((p) => all.push({ phrase: p, topicId: topic.id, id: phraseId(topic.id, p) }));
  });
  return all;
}

// Не больше MAX_NEW_PHRASES_PER_SESSION совсем новых фраз "в работе" одновременно —
// но это скользящее окно, а не разовая фиксация: как только фраза из allowedNewIds
// набирает DAILY_CORRECT_TO_ADVANCE верных ответов за день (см. bumpPhraseStreak) и
// покидает ящик "new" (переходит в "learning"), освобождённое место тут же занимает
// следующая ещё непройденная фраза темы. Иначе (как было раньше) набор фиксировался
// один раз на всю сессию и остальной массив темы не попадал в ротацию, пока первая
// партия не дойдёт до полного мастерства.
function topUpAllowedNew(items) {
  if (!allowedNewIds) allowedNewIds = new Set();
  for (const id of allowedNewIds) {
    if (getPhraseBox(id).id !== "new") allowedNewIds.delete(id);
  }
  if (allowedNewIds.size >= MAX_NEW_PHRASES_PER_SESSION) return;
  const candidates = shuffle(items.filter((it) => getPhraseBox(it.id).id === "new" && !allowedNewIds.has(it.id)));
  for (const it of candidates) {
    if (allowedNewIds.size >= MAX_NEW_PHRASES_PER_SESSION) break;
    allowedNewIds.add(it.id);
  }
}

// Насколько редко "выученная, но созревшая для проверки" фраза попадается в квизе —
// как и "почти выучено" (weight 1), не чаще, это просто сверка, а не заучивание.
const MASTERED_REVIEW_WEIGHT = 1;

// Взвешенная колода — как buildWeightedDeck в script.js: невыученное встречается чаще,
// выученное постепенно пропадает из ротации — и полностью выпадает из неё, пока не
// назреет срок контрольной проверки (см. isPhraseMasteredDue). Фразы разных тем
// перемешиваются в одном пуле.
function buildPhraseQueue(topics) {
  const items = collectItems(topics);
  topUpAllowedNew(items);

  const eligible = items.filter((it) => {
    const boxId = getPhraseBox(it.id).id;
    if (boxId === "new") return allowedNewIds.has(it.id);
    if (boxId === "mastered") return isPhraseMasteredDue(it.id);
    return true;
  });

  const pool = [];
  eligible.forEach((it) => {
    const box = getPhraseBox(it.id);
    const weight = box.id === "mastered" ? MASTERED_REVIEW_WEIGHT : box.weight;
    for (let i = 0; i < weight; i++) pool.push(it);
  });
  if (!pool.length) pool.push(...(eligible.length ? eligible : items));
  return shuffle(pool);
}

// Дистракторы предпочтительно из той же темы, что и правильный ответ (REQ-010) —
// правдоподобнее, чем случайные фразы из всей сессии. Если в теме фраз мало, добираем
// сначала из остальных тем сессии, потом из уже подгруженных ранее тем.
function pickDistractors(topics, correctItem, n) {
  const sameTopic = topics.find((t) => t.id === correctItem.topicId);
  let pool = shuffle((sameTopic ? sameTopic.phrases : []).filter((p) => p !== correctItem.phrase));
  if (pool.length < n) {
    const otherSessionTopics = topics.filter((t) => t.id !== correctItem.topicId);
    pool = pool.concat(shuffle(otherSessionTopics.flatMap((t) => t.phrases)));
  }
  if (pool.length < n) {
    const otherCached = [...phraseTopicCache.values()].filter((t) => !topics.some((x) => x.id === t.id));
    pool = pool.concat(shuffle(otherCached.flatMap((t) => t.phrases)));
  }
  return pool.slice(0, n);
}

// --- «Пароход до Каракёя»: игровой слой поверх квиза ---
// Рейс = FERRY_ROUND фраз = столько же препятствий на пути (скалы, волны, лодки): верный
// ответ — пароход проходит препятствие, ошибка — пробоина в корпусе, FERRY_GLASSES пробоин —
// пароход тонет, рейс заново. Серия верных подряд — 🔥, каждые FERRY_REFILL_EVERY подряд
// заделывают пробоину. Причалила — звёзды по целому корпусу и счётчик рейсов, по которому на карте Стамбула открываются места
// из жизни Ольги (см. assets/dialogues/LEGEND.md). Ящики Лейтнера (bumpPhraseStreak)
// работают как раньше: каждый ответ засчитывается в прогресс фразы, даже если рейс сорвался.
const FERRY_ROUND = 10;
const FERRY_GLASSES = 3;
const FERRY_HINTS = 1;
const FERRY_REFILL_EVERY = 5;
const FERRY_OPTIONS = 4;
// Мета хранится прямо в объекте прогресса фраз (ключ не может совпасть с id фразы вида
// «тема::текст»), чтобы синхронизироваться через уже существующую колонку phrase_progress.
const FERRY_META_KEY = "__ferry";

const FERRY_PLACES = [
  { at: 1, emoji: "⚓", name: "Пристань Кадыкёй", tr: "Kadıköy İskelesi" },
  { at: 3, emoji: "🌳", name: "Мода", tr: "Moda" },
  { at: 6, emoji: "☕", name: "Каракёй", tr: "Karaköy" },
  { at: 10, emoji: "🗼", name: "Галатская башня", tr: "Galata Kulesi" },
  { at: 15, emoji: "🚋", name: "Истикляль", tr: "İstiklal Caddesi" },
  { at: 21, emoji: "🐟", name: "Эминёню", tr: "Eminönü" },
  { at: 28, emoji: "🕌", name: "Айя-София", tr: "Ayasofya" },
  { at: 36, emoji: "🌉", name: "Босфорский мост", tr: "Boğaziçi Köprüsü" },
  { at: 45, emoji: "⚽", name: "Стадион Фенербахче", tr: "Fenerbahçe Stadı" },
  { at: 55, emoji: "🏡", name: "Ускюдар", tr: "Üsküdar" },
  { at: 66, emoji: "🚲", name: "Бююкада", tr: "Büyükada" },
];

// «Фразы» — чтобы выучить фразу ЦЕЛИКОМ: узнать, вспомнить по-турецки, понять на слух.
// Вставлять слова и собирать фразу по кусочкам — это работа «Грамматики», не здесь.
const QUESTION_TYPES = {
  tr2ru: "Что это значит?",
  ru2tr: "Как сказать по-турецки?",
  listen: "Послушай и выбери перевод",
};
// Препятствия на пути парохода — по одному на фразу рейса.
const FERRY_OBSTACLES = ["🪨", "🌊", "⛵", "🪨", "🛥️", "🌊", "🪨", "⛵", "🌊", "🪨"];

let ferry = null; // {done, glasses, combo, bestCombo, hints, token, asked}
let ferryToken = 0; // отменяет отложенные колбэки (таймер плашки) брошенного рейса
let lastQuestionType = null;

function getFerryMeta() {
  const m = phraseProgress[FERRY_META_KEY];
  return { voyages: 0, stars: 0, bestCombo: 0, ...(m || {}) };
}
function saveFerryMeta(meta) {
  phraseProgress[FERRY_META_KEY] = meta;
  savePhraseProgress();
}

// --- звуки «Фраз»: свой маленький синтез WebAudio, без файлов ---
let ferrySfxCtx = null;
function ferrySfx(kind) {
  if (muted) return;
  try {
    ferrySfxCtx = ferrySfxCtx || new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  const ctx = ferrySfxCtx;
  const t0 = ctx.currentTime;
  const tone = (freq, start, dur, type = "sine", vol = 0.18, freqEnd = null) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0 + start);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + start + dur);
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.05);
  };
  if (kind === "ok") {
    tone(660, 0, 0.12, "triangle", 0.15);
    tone(990, 0.08, 0.18, "triangle", 0.12);
  } else if (kind === "combo") {
    [660, 830, 990, 1320].forEach((f, i) => tone(f, i * 0.07, 0.16, "triangle", 0.12));
  } else if (kind === "spill") {
    tone(420, 0, 0.35, "sawtooth", 0.08, 120);
  } else if (kind === "horn") {
    tone(147, 0, 0.9, "sawtooth", 0.07);
    tone(220, 0, 0.9, "sine", 0.06);
  } else if (kind === "sink") {
    [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.18, 0.3, "triangle", 0.12));
  } else if (kind === "tap") {
    tone(700, 0, 0.06, "triangle", 0.08);
  }
}

// Чем лучше фраза выучена — тем труднее тип вопроса: новые чаще узнаём (тур → рус),
// почти выученные — собираем сами.
function pickQuestionType(item) {
  const box = getPhraseBoxId(item.id);
  const canListen = !muted && "speechSynthesis" in window;
  // Новую фразу сначала узнаём, знакомую — вспоминаем по-турецки и ловим на слух.
  const byBox = {
    new: ["tr2ru", "tr2ru", "listen"],
    learning: ["tr2ru", "ru2tr", "listen"],
    almost: ["ru2tr", "ru2tr", "listen"],
    mastered: ["ru2tr", "listen"],
  };
  let options = (byBox[box] || byBox.new).filter((t) => (t === "listen" ? canListen : true));
  if (!options.length) options = ["tr2ru"];
  const varied = options.filter((t) => t !== lastQuestionType);
  const pickFrom = varied.length ? varied : options;
  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}

function startQuiz(topics, maxLevel = null, exact = false) {
  currentTopics = topics;
  quizMaxLevel = maxLevel;
  quizExactLevel = exact;
  allowedNewIds = null; // новая сессия — заново решаем, какие новые фразы пустить в оборот
  currentQueue = buildPhraseQueue(currentTopics);
  setScreen("quiz");
  document.getElementById("quiz-topic-title").textContent = quizHeaderTitle(topics);
  updateQuizProgressLabel();
  showVoyageIntro();
}

function quizHeaderTitle(topics) {
  if (quizExactLevel && quizMaxLevel) return `Весь ${quizMaxLevel}`;
  if (topics.length === 1) return topics[0].title;
  if (topics.length === 2) return topics.map((t) => t.title).join(" + ");
  return `${topics.length} тем вместе`;
}

function updateQuizProgressLabel() {
  // Только фразы, которые реально участвуют в рейсе (с учётом уровня и снятых галочек).
  const items = collectItems(currentTopics);
  const total = items.length;
  const mastered = items.filter((it) => getPhraseBox(it.id).id === "mastered").length;
  document.getElementById("quiz-progress").textContent = `${mastered}/${total}`;
}

function showFerryOverlay({ emoji, title, text, extra = "", goLabel, onGo }) {
  const ov = document.getElementById("ferry-overlay");
  document.getElementById("ferry-card-emoji").textContent = emoji;
  document.getElementById("ferry-card-title").textContent = title;
  document.getElementById("ferry-card-text").textContent = text;
  document.getElementById("ferry-card-extra").innerHTML = extra;
  const go = document.getElementById("ferry-go-btn");
  go.textContent = goLabel;
  go.onclick = () => {
    ov.classList.add("hidden");
    onGo();
  };
  ov.classList.remove("hidden");
  go.focus();
}

function showVoyageIntro() {
  ferryToken++;
  ferry = {
    done: 0, glasses: FERRY_GLASSES, combo: 0, bestCombo: 0, hints: FERRY_HINTS, token: ferryToken, asked: new Set(),
    obstacles: shuffle(FERRY_OBSTACLES).slice(0, FERRY_ROUND),
  };
  renderFerryBar();
  clearQuestionArea();
  const meta = getFerryMeta();
  showFerryOverlay({
    emoji: "⛴️",
    title: `Рейс №${meta.voyages + 1}: Кадыкёй → Каракёй`,
    text: `${FERRY_ROUND} фраз — ${FERRY_ROUND} препятствий на пути: скалы, волны, лодки. Верный ответ — проходишь мимо. Ошибка — пробоина в корпусе. ${FERRY_GLASSES} пробоины — пароход тонет.`,
    extra: `<span class="ferry-chip">🔥 ${FERRY_REFILL_EVERY} подряд — заделать пробоину 🔧</span><span class="ferry-chip">💡 ${FERRY_HINTS} подсказка на рейс</span>`,
    goLabel: "Отчалить ▶",
    onGo: () => {
      ferrySfx("horn");
      nextQuestion();
    },
  });
}

function renderFerryBar() {
  if (!ferry) return;
  // Корпус: целые доски и пробоины.
  const glassesEl = document.getElementById("ferry-glasses");
  glassesEl.innerHTML = '<span class="ferry-hull-label">Корпус</span>';
  for (let i = 0; i < FERRY_GLASSES; i++) {
    const g = document.createElement("span");
    g.className = "ferry-hull" + (i < ferry.glasses ? "" : " broken");
    glassesEl.appendChild(g);
  }
  // Препятствия на пути: пройденные бледнеют, следующее — впереди парохода.
  const track = document.getElementById("ferry-track");
  track.querySelectorAll(".ferry-obstacle").forEach((o) => o.remove());
  ferry.obstacles.forEach((emoji, i) => {
    const o = document.createElement("span");
    o.className = "ferry-obstacle" + (i < ferry.done ? " passed" : i === ferry.done ? " next" : "");
    o.textContent = emoji;
    o.style.left = `${((i + 0.6) / FERRY_ROUND) * 100}%`;
    track.appendChild(o);
  });
  const comboEl = document.getElementById("ferry-combo");
  comboEl.textContent = ferry.combo >= 2 ? `🔥 ${ferry.combo}` : "";
  comboEl.classList.toggle("hot", ferry.combo >= 3);
  document.getElementById("ferry-count").textContent = `${ferry.done}/${FERRY_ROUND}`;
  const boat = document.getElementById("ferry-boat");
  boat.style.left = `${(ferry.done / FERRY_ROUND) * 100}%`;
  boat.classList.toggle("fast", ferry.combo >= 3);
  document.getElementById("quiz-hint-count").textContent = ferry.hints;
  document.getElementById("quiz-hint-btn").disabled = ferry.hints <= 0;
}

function clearQuestionArea() {
  document.getElementById("quiz-direction").textContent = "";
  document.getElementById("quiz-prompt").textContent = "";
  document.getElementById("quiz-subprompt").textContent = "";
  document.getElementById("quiz-options").innerHTML = "";
}

function nextQuestion() {
  if (!ferry) return;
  currentItem = takeFreshItem();
  ferry.asked.add(currentItem.id);
  hintUsed = false;
  questionAnswered = false;
  clearQuestionArea();

  const type = pickQuestionType(currentItem);
  lastQuestionType = type;
  currentItem.type = type;
  document.getElementById("quiz-direction").textContent = QUESTION_TYPES[type];
  renderChoiceQuestion(type);
  renderFerryBar();
  updateQuizProgressLabel();
}

// Следующая фраза из очереди, которой ещё не было в этом рейсе (в колоде новые фразы лежат
// по три копии — без этого одна и та же могла попасться дважды за рейс). Если в теме
// фраз меньше, чем отрезков рейса, повторы неизбежны — тогда берём любую.
function takeFreshItem() {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!currentQueue.length) currentQueue = buildPhraseQueue(currentTopics);
    for (let i = currentQueue.length - 1; i >= 0; i--) {
      if (!ferry.asked.has(currentQueue[i].id)) return currentQueue.splice(i, 1)[0];
    }
    currentQueue = [];
  }
  if (!currentQueue.length) currentQueue = buildPhraseQueue(currentTopics);
  return currentQueue.pop();
}

function speakButton(text, big = false) {
  const b = document.createElement("button");
  b.className = "quiz-speak" + (big ? " big" : "");
  b.type = "button";
  b.textContent = big ? "🔊 Послушать ещё раз" : "🔊";
  b.title = "Послушать";
  b.addEventListener("click", () => speak(text));
  return b;
}

function renderChoiceQuestion(type) {
  const phrase = currentItem.phrase;
  const promptEl = document.getElementById("quiz-prompt");
  const subEl = document.getElementById("quiz-subprompt");
  let correctText;
  let distractorTexts;

  {
    const showRu = type === "tr2ru" || type === "listen";
    correctText = showRu ? phrase.ru : phrase.tr;
    const seen = new Set([correctText]);
    distractorTexts = [];
    for (const p of pickDistractors(currentTopics, currentItem, 12)) {
      const t = showRu ? p.ru : p.tr;
      if (seen.has(t)) continue;
      seen.add(t);
      distractorTexts.push(t);
      if (distractorTexts.length >= FERRY_OPTIONS - 1) break;
    }
    if (type === "listen") {
      promptEl.appendChild(speakButton(phrase.tr, true));
      speak(phrase.tr);
    } else if (type === "tr2ru") {
      promptEl.textContent = phrase.tr + " ";
      promptEl.appendChild(speakButton(phrase.tr));
    } else {
      promptEl.textContent = phrase.ru;
    }
  }

  const optionsEl = document.getElementById("quiz-options");
  shuffle([correctText, ...distractorTexts]).forEach((text) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = text;
    btn.dataset.correct = text === correctText ? "1" : "0";
    btn.addEventListener("click", () => onAnswerClick(btn));
    optionsEl.appendChild(btn);
  });
}

function onAnswerClick(btn) {
  if (questionAnswered || btn.disabled || !ferry) return;
  if (btn.dataset.correct === "1") {
    btn.classList.add("correct");
    onCorrect();
  } else {
    btn.classList.add("wrong");
    btn.disabled = true;
    setTimeout(() => btn.classList.remove("wrong"), 300);
    onWrong(() => {
      const right = document.querySelector('#quiz-options .quiz-option[data-correct="1"]');
      if (right) right.classList.add("correct");
    });
  }
}

// --- общий исход ответа ---
function onCorrect() {
  questionAnswered = true;
  const token = ferry.token;
  if (!hintUsed) {
    bumpPhraseStreak(currentItem.id, true);
    ferry.combo++;
    ferry.bestCombo = Math.max(ferry.bestCombo, ferry.combo);
  } else {
    ferry.combo = 0;
  }
  ferry.done++;
  let refilled = false;
  if (!hintUsed && ferry.combo > 0 && ferry.combo % FERRY_REFILL_EVERY === 0 && ferry.glasses < FERRY_GLASSES) {
    ferry.glasses++;
    refilled = true;
  }
  ferrySfx(ferry.combo >= 3 && ferry.combo % FERRY_REFILL_EVERY === 0 ? "combo" : "ok");
  renderFerryBar();
  if (refilled) flashFerryNote("🔥 Серия! Пробоину заделали 🔧");
  updateQuizProgressLabel();
  showPhraseMatchPopup(currentItem.phrase, () => {
    if (!ferry || ferry.token !== token) return;
    if (ferry.done >= FERRY_ROUND) finishVoyage();
    else nextQuestion();
  });
}

function onWrong(revealCorrect) {
  if (!hintUsed) bumpPhraseStreak(currentItem.id, false);
  ferry.combo = 0;
  ferry.glasses--;
  ferrySfx("spill");
  renderFerryBar();
  // Удар о препятствие: пароход вздрагивает, препятствие вспыхивает, доска трескается.
  const holes = document.querySelectorAll("#ferry-glasses .ferry-hull.broken");
  const last = holes[holes.length - 1];
  if (last) last.classList.add("just-broken");
  const boat = document.getElementById("ferry-boat");
  boat.classList.remove("crash");
  void boat.offsetWidth;
  boat.classList.add("crash");
  const next = document.querySelector("#ferry-track .ferry-obstacle.next");
  if (next) next.classList.add("hit");
  if (ferry.glasses > 0) return;
  questionAnswered = true;
  if (revealCorrect) revealCorrect();
  const token = ferry.token;
  const phrase = currentItem.phrase;
  setTimeout(() => {
    if (!ferry || ferry.token !== token) return;
    sinkVoyage(phrase);
  }, 1100);
}

function flashFerryNote(text) {
  const bar = document.getElementById("ferry-bar");
  const note = document.createElement("div");
  note.className = "ferry-note";
  note.textContent = text;
  bar.appendChild(note);
  setTimeout(() => note.remove(), 2200);
}

function starsHtml(n) {
  return `<div class="ferry-stars">${"⭐".repeat(n)}${'<span class="dim">⭐</span>'.repeat(FERRY_GLASSES - n)}</div>`;
}

function finishVoyage() {
  const stars = Math.max(1, ferry.glasses);
  const meta = getFerryMeta();
  const before = FERRY_PLACES.filter((p) => p.at <= meta.voyages).length;
  meta.voyages += 1;
  meta.stars += stars;
  meta.bestCombo = Math.max(meta.bestCombo || 0, ferry.bestCombo);
  saveFerryMeta(meta);
  const unlocked = FERRY_PLACES.filter((p) => p.at <= meta.voyages).slice(before);
  ferrySfx("horn");
  let extra = starsHtml(stars) + `<div class="ferry-small">Лучшая серия в рейсе: 🔥 ${ferry.bestCombo}</div>`;
  if (unlocked.length) {
    extra += unlocked
      .map((p) => `<div class="ferry-unlock">Новое место на карте: <b>${p.emoji} ${p.name}</b> <i>${p.tr}</i></div>`)
      .join("");
  } else {
    const next = FERRY_PLACES.find((p) => p.at > meta.voyages);
    if (next) extra += `<div class="ferry-small">До следующего места (${next.emoji} ${next.name}): ещё ${voyagesWord(next.at - meta.voyages)}.</div>`;
  }
  ferry = null;
  showFerryOverlay({
    emoji: "⚓",
    title: "Причалили в Каракёе!",
    text: `Рейс №${meta.voyages} пройден. Корпус цел: ${stars} из ${FERRY_GLASSES}.`,
    extra,
    goLabel: "Следующий рейс ▶",
    onGo: showVoyageIntro,
  });
}

function sinkVoyage(phrase) {
  ferrySfx("sink");
  const done = ferry.done;
  ferry = null;
  showFerryOverlay({
    emoji: "🌊",
    title: "Пароход затонул",
    text: `${FERRY_GLASSES} пробоины на отрезке ${done + 1} из ${FERRY_ROUND}. Ответы в этом рейсе всё равно засчитаны в прогресс фраз.`,
    extra: `<div class="ferry-small">Запомни: <b>${escapeHtml(phrase.tr)}</b> — ${escapeHtml(phrase.ru)}</div>`,
    goLabel: "Новый рейс ↻",
    onGo: showVoyageIntro,
  });
}

function ferryPlural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const voyagesWord = (n) => `${n} ${ferryPlural(n, "рейс", "рейса", "рейсов")}`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Плашка "нашлась пара" — тот же принцип, что и в маджонге (см. showMatchPopup в
// script.js), но без иконки и с переходом дальше: автоматически через 3,5 сек или сразу —
// тапом по свободному полю. Даёт сфокусироваться на фразе, даже если ответ угадан.
function showPhraseMatchPopup(phrase, onDone) {
  const popupEl = document.getElementById("match-popup");
  const card = popupEl.querySelector(".match-card");
  card.classList.add("no-icon");
  popupEl.querySelector(".match-tr").textContent = phrase.tr;
  popupEl.querySelector(".match-ru").textContent = phrase.ru;
  popupEl.classList.remove("hidden");
  clearTimeout(popupEl._hideTimer);

  let advanced = false;
  const advance = () => {
    if (advanced) return;
    advanced = true;
    clearTimeout(popupEl._hideTimer);
    popupEl.classList.add("hidden");
    card.classList.remove("no-icon");
    popupEl.removeEventListener("click", onBackgroundClick);
    onDone();
  };
  function onBackgroundClick(e) {
    if (e.target === popupEl) advance();
  }
  popupEl.addEventListener("click", onBackgroundClick);
  popupEl._hideTimer = setTimeout(advance, 3500);

  speak(phrase.tr);
}

// Подсказка — одна на рейс. В выборе гасит половину неверных вариантов, в «собери» ставит
// следующее слово. Ответ после подсказки не идёт в прогресс (REQ-004) и обнуляет серию.
function useHint() {
  if (hintUsed || questionAnswered || !ferry || ferry.hints <= 0) return;
  hintUsed = true;
  ferry.hints--;
  renderFerryBar();
  const optionsEl = document.getElementById("quiz-options");
  const wrongButtons = shuffle(Array.from(optionsEl.children).filter((b) => b.dataset.correct === "0" && !b.disabled));
  wrongButtons.slice(0, Math.ceil(wrongButtons.length / 2)).forEach((b) => {
    b.classList.add("dimmed");
    b.disabled = true;
  });
}

// --- карта Стамбула в каталоге фраз ---
function renderFerryMap() {
  const el = document.getElementById("ferry-map");
  if (!el) return;
  const meta = getFerryMeta();
  const places = FERRY_PLACES.map((p) => {
    const open = p.at <= meta.voyages;
    return `<span class="ferry-place${open ? " open" : ""}" title="${open ? `${p.name} — ${p.tr}` : `откроется после ${p.at}-го рейса`}">${open ? p.emoji : "🔒"}</span>`;
  }).join("");
  const next = FERRY_PLACES.find((p) => p.at > meta.voyages);
  const nextText = next ? `Дальше: ${next.name} — ещё ${voyagesWord(next.at - meta.voyages)}.` : "Весь Стамбул открыт!";
  el.innerHTML =
    `<div class="ferry-map-head">🗺️ Твой Стамбул · ⛴️ ${voyagesWord(meta.voyages)} · ⭐ ${meta.stars}</div>` +
    `<div class="ferry-map-places">${places}</div>` +
    `<div class="ferry-map-next">${nextText}</div>`;
}

function initPhrasesMode() {
  document.getElementById("quiz-hint-btn").addEventListener("click", useHint);
  const leaveQuiz = () => {
    ferryToken++;
    ferry = null;
    document.getElementById("ferry-overlay").classList.add("hidden");
    currentTopics = [];
    allowedNewIds = null;
    renderPhrasesCatalog();
    setScreen("phrases-catalog");
  };
  document.getElementById("quiz-back-btn").addEventListener("click", leaveQuiz);
  document.getElementById("ferry-exit-btn").addEventListener("click", leaveQuiz);
  document.getElementById("quiz-mute-btn").addEventListener("click", () => {
    muted = !muted;
    document.getElementById("quiz-mute-btn").textContent = muted ? "🔇" : "🔊";
    document.getElementById("mute-btn").textContent = muted ? "🔇" : "🔊";
    if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
  });

  const mahjongBtn = document.getElementById("mode-mahjong-btn");
  const phrasesBtn = document.getElementById("mode-phrases-btn");
  mahjongBtn.addEventListener("click", () => {
    activateMode("mahjong");
    setScreen("catalog");
  });
  phrasesBtn.addEventListener("click", () => {
    activateMode("phrases");
    renderPhrasesCatalog();
    setScreen("phrases-catalog");
  });
}

// Общий переключатель трёх вкладок режима (Маджонг/Фразы/Диалоги) — используется из
// phrases.js и dialogues.js, чтобы при переключении в любую сторону подсвечивалась
// ровно одна кнопка, а не оставалась "залипшая" активной от предыдущего режима.
function activateMode(mode) {
  const buttons = {
    mahjong: document.getElementById("mode-mahjong-btn"),
    phrases: document.getElementById("mode-phrases-btn"),
    dialogues: document.getElementById("mode-dialogues-btn"),
    grammar: document.getElementById("mode-grammar-btn"),
  };
  Object.entries(buttons).forEach(([key, btn]) => btn.classList.toggle("active", key === mode));
}

initPhrasesMode();
