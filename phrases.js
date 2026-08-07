// Режим "Фразы": каталог тем (ленивая загрузка по манифесту — по аналогии с каталогом
// слов в wordbank.js/script.js) → экран темы с выбором фраз (чекбоксы + "✓ Знаю",
// как buildWordRow) → квиз "выбери перевод". Переиспользует speak()/muted/setScreen()
// из script.js (общий глобальный скоуп классических <script>, без модулей).

const PHRASES_MANIFEST_URL = "assets/phrases/manifest.json";
const PHRASES_DIR = "assets/phrases";

const PHRASE_PROGRESS_KEY = "mahjong-phrase-progress";
const PHRASE_EXCLUDED_KEY = "mahjong-phrase-excluded";
const PHRASE_LOADED_KEY = "mahjong-phrase-loaded-topics";

// Тот же принцип "ящиков", что и для слов (см. PROGRESS_BOXES в script.js), но отдельное
// хранилище — прогресс по фразам не должен смешиваться с прогрессом по словам маджонга.
const PHRASE_BOXES = [
  { id: "new", max: 2, label: "новое", emoji: "🔴", weight: 3 },
  { id: "learning", max: 5, label: "учится", emoji: "🟡", weight: 2 },
  { id: "almost", max: 9, label: "почти выучено", emoji: "🟢", weight: 1 },
  { id: "mastered", max: Infinity, label: "выучено", emoji: "⭐", weight: 0 },
];

let phraseManifest = []; // [{id, title, source, count, sizeKB}]
let phraseTopicCache = new Map(); // id → {id, title, source, phrases: [...]}
let currentTopic = null;
let currentQueue = [];
let currentPhrase = null;
let currentDirectionRuToTr = true;
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
function getPhraseStreak(id) {
  return (phraseProgress[id] && phraseProgress[id].streak) || 0;
}
function getPhraseBox(id) {
  const streak = getPhraseStreak(id);
  return PHRASE_BOXES.find((b) => streak <= b.max);
}
function bumpPhraseStreak(id, correct) {
  const streak = correct ? Math.min(getPhraseStreak(id) + 1, 15) : 0;
  phraseProgress[id] = { streak };
  savePhraseProgress();
}
// Ручная пометка "уже знаю эту фразу" — сразу переводит в ящик "выучено", как markWordKnown.
function markPhraseKnown(id) {
  const masteredBox = PHRASE_BOXES.find((b) => b.id === "mastered");
  const threshold = PHRASE_BOXES[PHRASE_BOXES.indexOf(masteredBox) - 1].max + 1;
  phraseProgress[id] = { streak: threshold };
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

// --- каталог тем ---
async function renderPhrasesCatalog() {
  const grid = document.getElementById("phrases-catalog-grid");
  const loadingEl = document.getElementById("phrases-catalog-loading");
  loadingEl.classList.remove("hidden");
  grid.innerHTML = "";
  await fetchPhraseManifest();
  loadingEl.classList.add("hidden");

  const loaded = getLoadedPhraseTopics();
  let totalPhrases = 0;
  let totalMastered = 0;

  phraseManifest.forEach((m) => {
    totalPhrases += m.count;
    const isLoaded = loaded.has(m.id) && phraseTopicCache.has(m.id);
    let masteredHere = 0;
    if (isLoaded) {
      const topic = phraseTopicCache.get(m.id);
      masteredHere = topic.phrases.filter((p) => getPhraseBox(phraseId(m.id, p)).id === "mastered").length;
    }
    totalMastered += masteredHere;

    const tile = document.createElement("div");
    tile.className = "catalog-tile" + (isLoaded ? "" : " not-loaded");
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
    tile.addEventListener("click", () => openPhraseTopic(m.id));
    grid.appendChild(tile);
  });

  document.getElementById("phrases-mastered-count").textContent = totalMastered;
  document.getElementById("phrases-total-count").textContent = totalPhrases;
  document.getElementById("phrases-topic-count").textContent = phraseManifest.length;
}

// --- экран темы: список фраз, чекбоксы "брать в работу", кнопка "✓ Знаю" ---
let currentTopicId = null;

async function openPhraseTopic(id) {
  currentTopicId = id;
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
  badge.title = `${box.label} (${getPhraseStreak(id)} подряд без ошибок)`;
  row.appendChild(badge);

  if (box.id !== "mastered") {
    const knowBtn = document.createElement("button");
    knowBtn.textContent = "✓ Знаю";
    knowBtn.title = "Отметить, что уже знаю эту фразу — она перестанет часто появляться";
    knowBtn.addEventListener("click", () => {
      markPhraseKnown(id);
      const newBox = getPhraseBox(id);
      badge.textContent = newBox.emoji;
      badge.title = `${newBox.label} (${getPhraseStreak(id)} подряд без ошибок)`;
      knowBtn.remove();
    });
    row.appendChild(knowBtn);
  }

  return row;
}

function renderPhraseTopicList(topic) {
  const listEl = document.getElementById("phrase-topic-list");
  listEl.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "word-select-list-inner";
  topic.phrases.forEach((p) => inner.appendChild(buildPhraseRow(topic, p)));
  listEl.appendChild(inner);
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
  startQuiz(topic);
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

// Взвешенная колода — как buildWeightedDeck в script.js: невыученное встречается чаще,
// выученное (weight 0) постепенно пропадает из ротации. Фразы, снятые галочкой на
// экране темы, в практику не попадают вовсе (но остаются доступны как дистракторы).
function buildPhraseQueue(topic) {
  const included = topic.phrases.filter((p) => !excludedPhrases.has(phraseId(topic.id, p)));
  const source = included.length ? included : topic.phrases; // всё выключено — играем всё равно
  const pool = [];
  source.forEach((p) => {
    const weight = getPhraseBox(phraseId(topic.id, p)).weight;
    for (let i = 0; i < weight; i++) pool.push(p);
  });
  if (!pool.length) pool.push(...source);
  return shuffle(pool);
}

// Дистракторы берём из той же темы (REQ-010, включая исключённые из практики — как
// "фон" они всё ещё годятся). Если фраз меньше 8, добираем из уже подгруженных тем.
function pickDistractors(topic, correct, n) {
  let pool = shuffle(topic.phrases.filter((p) => p !== correct));
  if (pool.length < n) {
    const otherTopics = [...phraseTopicCache.values()].filter((t) => t.id !== topic.id);
    const others = shuffle(otherTopics.flatMap((t) => t.phrases));
    pool = pool.concat(others);
  }
  return pool.slice(0, n);
}

function startQuiz(topic) {
  currentTopic = topic;
  currentQueue = buildPhraseQueue(topic);
  setScreen("quiz");
  document.getElementById("quiz-topic-title").textContent = topic.title;
  nextQuestion();
}

function updateQuizProgressLabel() {
  const mastered = currentTopic.phrases.filter((p) => getPhraseBox(phraseId(currentTopic.id, p)).id === "mastered").length;
  document.getElementById("quiz-progress").textContent = `${mastered}/${currentTopic.phrases.length}`;
}

function nextQuestion() {
  if (!currentQueue.length) currentQueue = buildPhraseQueue(currentTopic);
  currentPhrase = currentQueue.pop();
  currentDirectionRuToTr = Math.random() < 0.5;
  hintUsed = false;
  questionAnswered = false;

  const promptEl = document.getElementById("quiz-prompt");
  const dirEl = document.getElementById("quiz-direction");
  const optionsEl = document.getElementById("quiz-options");

  promptEl.textContent = currentDirectionRuToTr ? currentPhrase.ru : currentPhrase.tr;
  dirEl.textContent = currentDirectionRuToTr ? "Выбери перевод на турецкий" : "Выбери перевод на русский";

  const distractors = pickDistractors(currentTopic, currentPhrase, 7);
  const options = shuffle([currentPhrase, ...distractors]);

  optionsEl.innerHTML = "";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = currentDirectionRuToTr ? opt.tr : opt.ru;
    btn.dataset.correct = opt === currentPhrase ? "1" : "0";
    btn.addEventListener("click", () => onAnswerClick(btn));
    optionsEl.appendChild(btn);
  });

  updateQuizProgressLabel();
}

function onAnswerClick(btn) {
  if (questionAnswered || btn.disabled) return;
  const correct = btn.dataset.correct === "1";

  if (correct) {
    questionAnswered = true;
    btn.classList.add("correct");
    if (!hintUsed) bumpPhraseStreak(phraseId(currentTopic.id, currentPhrase), true);
    updateQuizProgressLabel();
    showPhraseMatchPopup(currentPhrase);
  } else {
    btn.classList.add("wrong");
    btn.disabled = true;
    if (!hintUsed) bumpPhraseStreak(phraseId(currentTopic.id, currentPhrase), false);
    setTimeout(() => btn.classList.remove("wrong"), 300);
  }
}

// Плашка "нашлась пара" — тот же принцип, что и в маджонге (см. showMatchPopup в
// script.js), но без иконки (у фраз её нет) и с переходом к следующему вопросу вместо
// простого закрытия: 4,5 сек автоматически, или сразу — тапом по свободному полю.
// Даёт сфокусироваться на фразе, даже если ответ угадан случайно.
function showPhraseMatchPopup(phrase) {
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
    popupEl.classList.add("hidden");
    card.classList.remove("no-icon");
    popupEl.removeEventListener("click", onBackgroundClick);
    nextQuestion();
  };
  function onBackgroundClick(e) {
    if (e.target === popupEl) advance();
  }
  popupEl.addEventListener("click", onBackgroundClick);
  popupEl._hideTimer = setTimeout(advance, 4500);

  speak(phrase.tr);
}

// Подсказка гасит половину неверных вариантов (оставляет верный + половину неверных).
// Ответ после подсказки не идёт в прогресс (REQ-004).
function useHint() {
  if (hintUsed || questionAnswered) return;
  hintUsed = true;
  const optionsEl = document.getElementById("quiz-options");
  const wrongButtons = shuffle(
    Array.from(optionsEl.children).filter((b) => b.dataset.correct === "0" && !b.disabled)
  );
  const toDim = wrongButtons.slice(0, Math.ceil(wrongButtons.length / 2));
  toDim.forEach((b) => {
    b.classList.add("dimmed");
    b.disabled = true;
  });
}

function initPhrasesMode() {
  document.getElementById("quiz-hint-btn").addEventListener("click", useHint);
  document.getElementById("quiz-back-btn").addEventListener("click", () => {
    renderPhrasesCatalog();
    setScreen("phrases-catalog");
  });
  document.getElementById("quiz-mute-btn").addEventListener("click", () => {
    muted = !muted;
    document.getElementById("quiz-mute-btn").textContent = muted ? "🔇" : "🔊";
    document.getElementById("mute-btn").textContent = muted ? "🔇" : "🔊";
    if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
  });

  const mahjongBtn = document.getElementById("mode-mahjong-btn");
  const phrasesBtn = document.getElementById("mode-phrases-btn");
  mahjongBtn.addEventListener("click", () => {
    mahjongBtn.classList.add("active");
    phrasesBtn.classList.remove("active");
    setScreen("catalog");
  });
  phrasesBtn.addEventListener("click", () => {
    phrasesBtn.classList.add("active");
    mahjongBtn.classList.remove("active");
    renderPhrasesCatalog();
    setScreen("phrases-catalog");
  });
}

initPhrasesMode();
