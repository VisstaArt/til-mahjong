// Режим "Диалоги": каталог тем (та же ленивая загрузка по манифесту, что у фраз) →
// список готовых диалогов внутри темы, каждый — на двух ролях (говорящий A/Б) →
// проигрыватель: реплики второй роли просто показываются и озвучиваются, реплики СВОЕЙ
// роли — это выбор из нескольких вариантов (ровно один верный, остальные — реплики из
// других мест этого же диалога, не подходящие здесь по контексту, а не синонимы —
// иначе у "неверного" варианта был бы шанс тоже оказаться приемлемым). Переиспользует
// speak()/muted/setScreen()/shuffle()/formatSizeKB() из script.js/phrases.js (общий
// глобальный скоуп классических <script>, без модулей).

const DIALOGUES_MANIFEST_URL = "assets/dialogues/manifest.json";
const DIALOGUES_DIR = "assets/dialogues";

let dialogueManifest = []; // [{id, title, count, sizeKB}]
let dialogueTopicCache = new Map(); // id → {id, title, dialogues: [...]}

let currentDialogueTopicId = null;
let currentDialogue = null; // {id, title, speakers: {a, b}, turns: [...]}
let currentDialogueRole = null; // "a" | "b" — за кого играет пользователь
let currentTurnIndex = 0;
let dialogueAdvanceTimer = null; // таймер автопродолжения — чистим при уходе с экрана,
// иначе просроченный колбэк может подмешаться в уже другой открытый диалог.
// Метка текущей "сессии" диалога — растёт на каждый старт/выход. speechSynthesis.cancel()
// сам по себе вызывает onend/onerror у ОБРЫВАЕМОЙ реплики, а не просто молча замолкает —
// без этой метки такой запоздалый колбэк планировал бы переход уже в новом диалоге,
// из-за чего он "проскакивал" реплики или на нём всплывала чужая табличка "Завершён".
let dialogueSession = 0;

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

async function fetchDialogueManifest() {
  if (dialogueManifest.length) return dialogueManifest;
  try {
    const resp = await fetch(DIALOGUES_MANIFEST_URL);
    dialogueManifest = resp.ok ? await resp.json() : [];
  } catch {
    dialogueManifest = [];
  }
  return dialogueManifest;
}

async function loadDialogueTopic(id) {
  if (dialogueTopicCache.has(id)) return dialogueTopicCache.get(id);
  const resp = await fetch(`${DIALOGUES_DIR}/${id}.json`);
  const topic = await resp.json();
  dialogueTopicCache.set(id, topic);
  return topic;
}

// --- каталог тем ---
async function renderDialoguesCatalog() {
  const grid = document.getElementById("dialogues-catalog-grid");
  const loadingEl = document.getElementById("dialogues-catalog-loading");
  loadingEl.classList.remove("hidden");
  grid.innerHTML = "";
  await fetchDialogueManifest();
  loadingEl.classList.add("hidden");

  dialogueManifest.forEach((m) => {
    const tile = document.createElement("div");
    tile.className = "catalog-tile";
    tile.innerHTML =
      `<span class="emoji">🎭</span>` +
      `<div class="tile-overlay">` +
      `<span class="name">${m.title}</span>` +
      `<span class="count">${m.count} ${pluralRu(m.count, "диалог", "диалога", "диалогов")}</span>` +
      `</div>`;
    tile.addEventListener("click", () => openDialogueTopic(m.id));
    grid.appendChild(tile);
  });
}

// --- экран темы: список готовых диалогов, у каждого — прослушать + выбор роли ---
async function openDialogueTopic(id) {
  currentDialogueTopicId = id;
  const manifestEntry = dialogueManifest.find((m) => m.id === id);
  document.getElementById("dialogue-topic-title").textContent = manifestEntry ? manifestEntry.title : "";
  setScreen("dialogue-topic");
  const listEl = document.getElementById("dialogue-topic-list");
  listEl.innerHTML = `<div class="catalog-loading">⏳ Загружаем диалоги…</div>`;
  const topic = await loadDialogueTopic(id);
  renderDialogueTopicList(topic);
}

function renderDialogueTopicList(topic) {
  const listEl = document.getElementById("dialogue-topic-list");
  listEl.innerHTML = "";
  topic.dialogues.forEach((d) => {
    const row = document.createElement("div");
    row.className = "dialogue-list-row";

    const title = document.createElement("span");
    title.className = "dialogue-row-title";
    title.textContent = d.title;
    row.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "dialogue-row-actions";

    const previewBtn = document.createElement("button");
    previewBtn.className = "secondary";
    previewBtn.textContent = "🔊 Прослушать";
    previewBtn.title = "Прослушать весь диалог целиком, не играя";
    previewBtn.addEventListener("click", () => playLinesAloud(d.turns.map((t) => t.tr)));
    actions.appendChild(previewBtn);

    ["a", "b"].forEach((role) => {
      const btn = document.createElement("button");
      btn.textContent = `▶ За ${d.speakers[role]}`;
      btn.addEventListener("click", () => startDialogue(topic, d, role));
      actions.appendChild(btn);
    });

    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

document.getElementById("dialogue-topic-back-btn").addEventListener("click", () => {
  renderDialoguesCatalog();
  setScreen("dialogues-catalog");
});

// --- проигрыватель ---
function startDialogue(topic, dialogue, role) {
  clearTimeout(dialogueAdvanceTimer);
  dialogueSession++;
  linesPlaybackGeneration++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  currentDialogueTopicId = topic.id;
  currentDialogue = dialogue;
  currentDialogueRole = role;
  currentTurnIndex = 0;

  document.getElementById("dialogue-player-title").textContent = dialogue.title;
  document.getElementById("dialogue-player-role").textContent = dialogue.speakers[role];
  document.getElementById("dialogue-transcript").innerHTML = "";
  document.getElementById("dialogue-finished").classList.add("hidden");
  const choicesEl = document.getElementById("dialogue-choices");
  choicesEl.classList.add("hidden");
  choicesEl.innerHTML = "";

  setScreen("dialogue-player");
  advanceDialogue();
}

function appendDialogueBubble(turn) {
  const transcriptEl = document.getElementById("dialogue-transcript");
  const bubble = document.createElement("div");
  bubble.className = `dialogue-bubble bubble-${turn.speaker}`;
  bubble.innerHTML =
    `<div class="bubble-speaker">${currentDialogue.speakers[turn.speaker]}</div>` +
    `<div class="bubble-tr">${turn.tr}</div>` +
    `<div class="bubble-ru">${turn.ru}</div>`;
  transcriptEl.appendChild(bubble);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// Озвучивает реплику и вызывает callback только когда речь реально закончилась (плюс
// небольшая пауза для естественности) — ждём именно onend, без искусственной оценки
// по длине текста (та давала неестественные "притормаживания"). НЕ вызываем cancel()
// перед каждой репликой — играть в этот момент нечему, предыдущая уже дозвучала (мы её
// дожидаемся), а резкий cancel()+speak() подряд сам по себе известная точка сбоя в
// Safari/WebKit. cancel() остаётся только там, где мы осознанно прерываем речь —
// уход с экрана/рестарт диалога (см. startDialogue и кнопку "← Диалоги").
function speakThenAdvance(text, pauseAfter, callback) {
  const session = dialogueSession;
  const isCurrent = () => session === dialogueSession;
  const proceed = () => {
    dialogueAdvanceTimer = setTimeout(() => {
      if (isCurrent()) callback();
    }, pauseAfter);
  };

  if (muted || !("speechSynthesis" in window)) {
    proceed();
    return;
  }
  const voice = typeof getSelectedVoice === "function" ? getSelectedVoice() : null;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice ? voice.lang : "tr-TR";
  if (voice) u.voice = voice;
  u.rate = 1;
  let done = false;
  const onDone = () => {
    if (done || !isCurrent()) return;
    done = true;
    proceed();
  };
  u.onend = onDone;
  u.onerror = onDone;
  // Подстраховка: если движок вообще не пришлёт onend/onerror, диалог не зависнет молча.
  setTimeout(onDone, Math.max(4000, text.length * 120));
  speechSynthesis.speak(u);
}

// Следующий диалог ПОСЛЕ текущего в той же теме — по порядку в manifest/файле темы —
// или null, если текущий диалог последний.
function getNextDialogueInTopic() {
  const topic = dialogueTopicCache.get(currentDialogueTopicId);
  if (!topic || !currentDialogue) return null;
  const idx = topic.dialogues.findIndex((d) => d.id === currentDialogue.id);
  if (idx === -1 || idx + 1 >= topic.dialogues.length) return null;
  return topic.dialogues[idx + 1];
}

function advanceDialogue() {
  const choicesEl = document.getElementById("dialogue-choices");
  choicesEl.classList.add("hidden");
  choicesEl.innerHTML = "";

  if (currentTurnIndex >= currentDialogue.turns.length) {
    document.getElementById("dialogue-next-btn").classList.toggle("hidden", !getNextDialogueInTopic());
    document.getElementById("dialogue-finished").classList.remove("hidden");
    return;
  }

  const turn = currentDialogue.turns[currentTurnIndex];
  if (turn.speaker === currentDialogueRole) {
    renderDialogueChoices(turn);
  } else {
    appendDialogueBubble(turn);
    currentTurnIndex++;
    speakThenAdvance(turn.tr, 500, advanceDialogue);
  }
}

function renderDialogueChoices(turn) {
  const choicesEl = document.getElementById("dialogue-choices");
  choicesEl.classList.remove("hidden");
  choicesEl.innerHTML = "";

  // Общий на все варианты этого вопроса флаг (не только btn.disabled у конкретной
  // кнопки) — подстраховка от сдвоенного тач/клик события на мобильном, из-за которого
  // currentTurnIndex мог бы увеличиться дважды за одно нажатие и диалог "проскакивал".
  let answered = false;

  const options = shuffle([
    { tr: turn.tr, ru: turn.ru, correct: true },
    ...turn.distractors.map((d) => ({ ...d, correct: false })),
  ]);

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = opt.tr;
    btn.addEventListener("click", () => {
      if (answered || btn.disabled) return;
      if (opt.correct) {
        answered = true;
        Array.from(choicesEl.children).forEach((b) => (b.disabled = true));
        btn.classList.add("correct");
        appendDialogueBubble(turn);
        currentTurnIndex++;
        speakThenAdvance(turn.tr, 300, advanceDialogue);
      } else {
        btn.classList.add("wrong");
        btn.disabled = true;
        setTimeout(() => btn.classList.remove("wrong"), 300);
      }
    });
    choicesEl.appendChild(btn);
  });
}

// Прослушать список реплик подряд, одну за другой (в отличие от общего speak() —
// та обрывает текущую озвучку при каждом вызове, а тут нужно дождаться конца одной
// реплики перед следующей). Используется и для "прослушать превью" в списке тем,
// и для "прослушать весь диалог" в самом проигрывателе.
// Своя метка поколения (независимая от dialogueSession — прослушивание превью
// запускается и до старта диалога, из списка тем) — чтобы новый запуск прослушивания
// или уход с экрана обрывал предыдущую цепочку onend, а не дал ей доиграть поверх.
let linesPlaybackGeneration = 0;

function playLinesAloud(lines, index = 0, generation = null) {
  if (index === 0) {
    if (!("speechSynthesis" in window)) return;
    linesPlaybackGeneration++;
    generation = linesPlaybackGeneration;
    speechSynthesis.cancel();
  }
  if (generation !== linesPlaybackGeneration) return;
  if (muted || !("speechSynthesis" in window) || index >= lines.length) return;
  const voice = typeof getSelectedVoice === "function" ? getSelectedVoice() : null;
  const u = new SpeechSynthesisUtterance(lines[index]);
  u.lang = voice ? voice.lang : "tr-TR";
  if (voice) u.voice = voice;
  u.rate = 1;
  u.onend = () => setTimeout(() => playLinesAloud(lines, index + 1, generation), 300);
  speechSynthesis.speak(u);
}

function initDialoguesMode() {
  document.getElementById("mode-dialogues-btn").addEventListener("click", () => {
    activateMode("dialogues");
    renderDialoguesCatalog();
    setScreen("dialogues-catalog");
  });

  document.getElementById("dialogue-translate-btn").addEventListener("click", () => {
    document.querySelector(".dialogue-main").classList.toggle("show-translation");
  });

  document.getElementById("dialogue-replay-all-btn").addEventListener("click", () => {
    if (!currentDialogue) return;
    playLinesAloud(currentDialogue.turns.map((t) => t.tr));
  });

  document.getElementById("dialogue-mute-btn").addEventListener("click", () => {
    muted = !muted;
    document.getElementById("dialogue-mute-btn").textContent = muted ? "🔇" : "🔊";
    if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
  });

  document.getElementById("dialogue-back-btn").addEventListener("click", () => {
    clearTimeout(dialogueAdvanceTimer);
    dialogueSession++;
    linesPlaybackGeneration++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    renderDialogueTopicList(dialogueTopicCache.get(currentDialogueTopicId));
    setScreen("dialogue-topic");
  });

  document.getElementById("dialogue-replay-role-btn").addEventListener("click", () => {
    startDialogue(dialogueTopicCache.get(currentDialogueTopicId), currentDialogue, currentDialogueRole);
  });
  document.getElementById("dialogue-swap-role-btn").addEventListener("click", () => {
    const otherRole = currentDialogueRole === "a" ? "b" : "a";
    startDialogue(dialogueTopicCache.get(currentDialogueTopicId), currentDialogue, otherRole);
  });
  document.getElementById("dialogue-next-btn").addEventListener("click", () => {
    const next = getNextDialogueInTopic();
    const topic = dialogueTopicCache.get(currentDialogueTopicId);
    if (topic && next) startDialogue(topic, next, currentDialogueRole);
  });
}

initDialoguesMode();
