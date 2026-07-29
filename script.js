// Тил Маджонг — прототип
// 20 турецких слов (существительные, глаголы действия, прилагательные)
// каждое слово даёт пару плиток: картинка (SVG-иконка из icons.js) + турецкое слово

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

const WORDS = [
  { tr: "kitap", ru: "книга", pos: "noun", theme: "Учёба" },
  { tr: "çay", ru: "чай", pos: "noun", theme: "Еда и напитки" },
  { tr: "ekmek", ru: "хлеб", pos: "noun", theme: "Еда и напитки" },
  { tr: "su", ru: "вода", pos: "noun", theme: "Еда и напитки" },
  { tr: "ev", ru: "дом", pos: "noun", theme: "Дом" },
  { tr: "araba", ru: "машина", pos: "noun", theme: "Транспорт" },
  { tr: "kedi", ru: "кошка", pos: "noun", theme: "Животные" },
  { tr: "köpek", ru: "собака", pos: "noun", theme: "Животные" },
  { tr: "güneş", ru: "солнце", pos: "noun", theme: "Природа" },
  { tr: "ay", ru: "луна", pos: "noun", theme: "Природа" },
  { tr: "koşmak", ru: "бежать", pos: "verb", theme: "Движение" },
  { tr: "yüzmek", ru: "плавать", pos: "verb", theme: "Движение" },
  { tr: "okumak", ru: "читать", pos: "verb", theme: "Учёба" },
  { tr: "yazmak", ru: "писать", pos: "verb", theme: "Учёба" },
  { tr: "uyumak", ru: "спать", pos: "verb", theme: "Повседневные действия" },
  { tr: "yürümek", ru: "идти", pos: "verb", theme: "Движение" },
  { tr: "büyük", ru: "большой", pos: "adjective", theme: "Размер" },
  { tr: "küçük", ru: "маленький", pos: "adjective", theme: "Размер" },
  { tr: "kırmızı", ru: "красный", pos: "adjective", theme: "Цвета" },
  { tr: "mavi", ru: "синий", pos: "adjective", theme: "Цвета" },
];

const POS_LABELS = {
  noun: "Существительные",
  verb: "Глаголы",
  adjective: "Прилагательные",
  adverb: "Наречия",
  pronoun: "Местоимения",
  preposition: "Предлоги/послелоги",
  numeral: "Числительные",
  other: "Другое",
};
const POS_ORDER = ["noun", "verb", "adjective", "adverb", "pronoun", "preposition", "numeral", "other"];

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
const wordsNextBtn = document.getElementById("words-next-btn");
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
const wordSelectListEl = document.getElementById("word-select-list");
const selectedCountEl = document.getElementById("selected-count");
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
  if (COLOR_WORDS[tile.tr]) {
    container.style.background = COLOR_WORDS[tile.tr];
    return;
  }
  container.style.background = "";
  const img = document.createElement("img");
  img.src = tile.icon || IMAGE_FILES[tile.tr];
  img.alt = tile.tr;
  container.appendChild(img);
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
      renderIcon(el, tile);
    } else {
      el.textContent = tile.tr;
    }
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

function showHint() {
  const free = tiles.filter((t) => !t.matched && t.free);
  for (const t of free) {
    const partner = free.find((p) => p.pairId === t.pairId && p.id !== t.id);
    if (partner) {
      [t, partner].forEach((h) => {
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
    setScreen("words");
    return;
  }
  tiles = buildLayeredBoard(deck, Number(tileCountSlider.value));
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

// ---- Флоу: слова → тип расклада → игра ----

wordsNextBtn.addEventListener("click", () => setScreen("layout"));
layoutBackBtn.addEventListener("click", () => setScreen("words"));
layoutPlayBtn.addEventListener("click", () => {
  setScreen("game");
  newGame();
});
backToSetupBtn.addEventListener("click", () => setScreen("words"));

apiKeyInput.value = getApiKey();
apiKeyInput.addEventListener("change", () => setApiKey(apiKeyInput.value));

tileCountSlider.addEventListener("input", () => {
  tileCountLabel.textContent = tileCountSlider.value;
  updateDeckSummary();
});

selectAllBtn.addEventListener("click", () => {
  excludedWords = new Set();
  saveExcludedWords(excludedWords);
  renderWordSelectList();
});

selectNoneBtn.addEventListener("click", () => {
  excludedWords = new Set(getAllAvailableWords().map((w) => w.tr));
  saveExcludedWords(excludedWords);
  renderWordSelectList();
});

reclassifyBtn.addEventListener("click", async () => {
  reclassifyBtn.disabled = true;
  try {
    await reclassifyAllWords((msg) => {
      generateProgressEl.textContent = msg;
    });
    customWords = await getAllCustomWords();
    renderWordSelectList();
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
    renderWordSelectList();
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
    renderWordSelectList();
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
  const tileCount = Number(tileCountSlider.value);
  const pairsNeeded = Math.floor(tileCount / 2);
  if (!deck.length) {
    deckSummaryEl.textContent = "Слова не выбраны — игра не сформируется.";
    return;
  }
  const base = Math.floor(pairsNeeded / deck.length);
  const extra = pairsNeeded % deck.length;
  const summary =
    extra === 0
      ? `Каждое из ${deck.length} слов повторится ${base} раз(а).`
      : `${deck.length} слов: ${extra} из них повторятся ${base + 1} раз(а), остальные — ${base} раз(а).`;
  deckSummaryEl.textContent = summary;
}

function buildWordRow(w) {
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
    selectedCountEl.textContent = getAllAvailableWords().filter((x) => !excludedWords.has(x.tr)).length;
    updateDeckSummary();
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
      renderWordSelectList();
    });
    row.appendChild(delBtn);
  }

  return row;
}

function buildGroupHeader(labelText, groupWords) {
  const header = document.createElement("div");
  header.className = "word-group-header";
  const title = document.createElement("span");
  title.textContent = labelText;
  header.appendChild(title);
  const toggle = document.createElement("button");
  toggle.textContent = "вкл/выкл";
  toggle.addEventListener("click", () => {
    const allSelected = groupWords.every((w) => !excludedWords.has(w.tr));
    groupWords.forEach((w) => {
      if (allSelected) excludedWords.add(w.tr);
      else excludedWords.delete(w.tr);
    });
    saveExcludedWords(excludedWords);
    renderWordSelectList();
  });
  header.appendChild(toggle);
  return header;
}

// Единый список: и выбор слов для игры (чекбокс), и управление своими словами
// (превью, перерисовка, удаление). Внутри каждой части речи слова дополнительно
// подгруппированы по теме (Кухня, Животные, Овощи...), если она проставлена.
function renderWordSelectList() {
  const words = getAllAvailableWords();
  const selected = words.filter((w) => !excludedWords.has(w.tr));
  selectedCountEl.textContent = selected.length;
  wordSelectListEl.innerHTML = "";

  const groups = new Map(POS_ORDER.map((pos) => [pos, []]));
  words.forEach((w) => {
    const pos = groups.has(w.pos) ? w.pos : "other";
    groups.get(pos).push(w);
  });

  POS_ORDER.forEach((pos) => {
    const groupWords = groups.get(pos);
    if (!groupWords.length) return;

    const section = document.createElement("div");
    section.className = "word-group";
    section.appendChild(buildGroupHeader(`${POS_LABELS[pos]} (${groupWords.length})`, groupWords));

    const byTheme = new Map();
    const untheme = [];
    groupWords.forEach((w) => {
      if (w.theme) {
        if (!byTheme.has(w.theme)) byTheme.set(w.theme, []);
        byTheme.get(w.theme).push(w);
      } else {
        untheme.push(w);
      }
    });

    if (untheme.length) {
      const list = document.createElement("div");
      list.className = "word-select-list-inner";
      untheme.forEach((w) => list.appendChild(buildWordRow(w)));
      section.appendChild(list);
    }

    [...byTheme.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru")).forEach(([theme, themeWords]) => {
      const subsection = document.createElement("div");
      subsection.className = "word-subgroup";
      subsection.appendChild(buildGroupHeader(`${theme} (${themeWords.length})`, themeWords));
      const list = document.createElement("div");
      list.className = "word-select-list-inner";
      themeWords.forEach((w) => list.appendChild(buildWordRow(w)));
      subsection.appendChild(list);
      section.appendChild(subsection);
    });

    wordSelectListEl.appendChild(section);
  });

  updateDeckSummary();
}

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
    renderWordSelectList();
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
    renderWordSelectList();
    wordInput.value = "";
    generateProgressEl.textContent += "Готово! Можно нажать «Новая игра».";
  } catch (e) {
    generateProgressEl.textContent += `Ошибка: ${e.message}`;
  } finally {
    generateWordsBtn.disabled = false;
  }
});

(async function init() {
  customWords = await getAllCustomWords();
  renderWordSelectList();
  setScreen("words");
})();
