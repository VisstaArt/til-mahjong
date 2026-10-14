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

// --- Лесенка: каждый новый проход диалога за ту же роль — ступенью выше ---
// 1 «Понять» — выбираешь свою реплику из вариантов (как было);
// 2 «Выбрать голосом» — варианты на экране, но не нажимаешь, а говоришь нужный вслух
//   (телефону надо понять только, какой из трёх сказан, — «окрас» фразы не мешает);
// 3 «Вспомнить с подсказкой» — видно по-русски, что сказать, и первые буквы слов;
// 4 «Живой разговор» — собеседник говорит, подсказок нет, отвечаешь сама.
// Сверка на 3–4 — по главным словам (без «lütfen», «efendim», имён), плюс допустимые
// варианты реплики (turn.alts), а если не совпало — видно, что услышал телефон, и
// человек сам решает: «сказала по-другому, но правильно» засчитывается, а сам ответ
// сохраняется (DIALOGUE_SAID_KEY), чтобы потом добавить его в допустимые варианты.
// Без голоса (нет «можно говорить» сегодня) ступени 2–4 — вспомнить про себя,
// открыть ответ и честно отметить, совпало ли (как в методе Пимслера).
// Ступень растёт, если ошибок не больше четверти своих реплик (минимум одна прощается).
const DIALOGUE_STEPS = [
  null,
  { name: "Понять", hint: "выбери свою реплику из вариантов" },
  { name: "Выбрать голосом", hint: "варианты на экране — скажи нужный вслух" },
  { name: "Вспомнить с подсказкой", hint: "видно по-русски, что сказать, и первые буквы слов" },
  { name: "Живой разговор", hint: "собеседник говорит — отвечаешь сама, без подсказок" },
];
const DIALOGUE_STEPS_NO_VOICE = [
  null,
  DIALOGUE_STEPS[1],
  { name: "Вспомнить с подсказкой", hint: "по-русски и первые буквы — вспомни, потом проверь себя" },
  { name: "Вспомнить по-русски", hint: "видно только, что сказать по-русски, — вспомни и проверь себя" },
  { name: "Живой разговор", hint: "без подсказок — вспомни сама, потом проверь себя" },
];
const DIALOGUE_META_KEY = "__dialogues"; // внутри прогресса фраз — синхронизируется с облаком
const DIALOGUE_SAID_KEY = "mahjong-dialogue-said";
const DIALOGUE_IGNORE = new Set(["lütfen", "efendim", "bey", "hanım", "hanımefendi", "beyefendi", "peki", "yani", "ya", "şey", "acaba", "ama", "ve", "de", "da", "ki", "mi", "mı", "mu", "mü"]);
const DIALOGUE_TRIES = 3;

let dialogueRun = null; // {step, voice, own, misses}
let dialogueStopListening = null;

function dialogueKey(dialogue, role) {
  return `${dialogue.id}:${role}`;
}
function getDialogueStep(dialogue, role) {
  const meta = phraseProgress[DIALOGUE_META_KEY] || {};
  return (meta[dialogueKey(dialogue, role)] || {}).step || 1;
}
function setDialogueStep(dialogue, role, step) {
  const meta = phraseProgress[DIALOGUE_META_KEY] || {};
  const prev = meta[dialogueKey(dialogue, role)] || {};
  meta[dialogueKey(dialogue, role)] = { step, best: Math.max(prev.best || 0, step - 1), day: todayStr() };
  phraseProgress[DIALOGUE_META_KEY] = meta;
  savePhraseProgress();
}
function dialogueStepInfo(step, voice) {
  return (voice ? DIALOGUE_STEPS : DIALOGUE_STEPS_NO_VOICE)[step];
}
function logSaidOtherwise(turn, heard) {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(DIALOGUE_SAID_KEY) || "[]");
  } catch {}
  list.push({ dialogue: currentDialogue.id, ref: turn.tr, heard, day: todayStr() });
  try {
    localStorage.setItem(DIALOGUE_SAID_KEY, JSON.stringify(list.slice(-300)));
  } catch {}
}
function getSaidOtherwise() {
  try {
    return JSON.parse(localStorage.getItem(DIALOGUE_SAID_KEY) || "[]");
  } catch {
    return [];
  }
}
// Имена (Olga, Metin'in…) в середине реплики не проверяем — их легко сказать иначе.
function dialogueKeyText(tr) {
  return tr.replace(/([^.!?\s]\s+)([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:['’][a-zçğıöşü]+)?)/g, (m, pre) => pre);
}

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
// «Мои ответы по-другому» — скопировать и прислать, чтобы добавить их в допустимые варианты.
function renderSaidOtherwiseButton() {
  const btn = document.getElementById("dialogue-said-btn");
  const list = getSaidOtherwise();
  btn.classList.toggle("hidden", !list.length);
  btn.textContent = `📋 Мои ответы «по-другому» (${list.length}) — скопировать`;
  btn.onclick = async () => {
    const text = list.map((x) => `${x.ref}  ⟶  ${x.heard}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "✓ Скопировано — пришли это в чат, добавлю как правильные варианты";
    } catch {
      window.prompt("Скопируй и пришли в чат:", text);
    }
  };
}

async function renderDialoguesCatalog() {
  renderSaidOtherwiseButton();
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
      const step = getDialogueStep(d, role);
      btn.textContent = `▶ Роль: ${d.speakers[role]} · ${step >= 5 ? "⭐" : `ступень ${step}`}`;
      btn.title = step >= 5 ? "Все 4 ступени пройдены" : `Ступень ${step} из 4: ${DIALOGUE_STEPS[step].name}`;
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
// Ступени 2–4 с голосом: сначала тот же вопрос, что во «Фразах», — раз в день.
function startDialogue(topic, dialogue, role) {
  const step = Math.min(4, getDialogueStep(dialogue, role));
  if (step >= 2 && saySupported() && navigator.onLine !== false && sayChoiceToday() === null) {
    askDialogueSay(() => startDialogue(topic, dialogue, role));
    return;
  }
  stopDialogueListening();
  dialogueRun = { step, voice: step >= 2 && sayEnabled(), own: 0, misses: 0, missedTurn: -1 };
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
  document.getElementById("dialogue-player-step").textContent = `${step}/4`;
  updateDialogueSayButton();
  const info = dialogueStepInfo(step, dialogueRun.voice);
  document.getElementById("dialogue-transcript").innerHTML =
    `<div class="dialogue-step-banner"><b>Ступень ${step} из 4 · ${info.name}</b><span>${info.hint}${dialogueRun.voice ? " 🎤" : ""}</span></div>`;
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
  // На мобильном Safari высота экрана (100vh/flex) иногда считается нестабильно —
  // одного scrollTop у внутреннего контейнера транскрипта недостаточно, страница
  // может не докрутиться сама. Подстраховываемся явным scrollIntoView новой реплики.
  requestAnimationFrame(() => bubble.scrollIntoView({ block: "end", behavior: "smooth" }));
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
    finishDialogueRun();
    return;
  }

  const turn = currentDialogue.turns[currentTurnIndex];
  if (turn.speaker === currentDialogueRole) {
    dialogueRun.own++;
    const step = dialogueRun.step;
    if (step === 1) renderDialogueChoices(turn);
    else if (step === 2 && dialogueRun.voice) renderVoiceChoice(turn);
    else renderRecallTurn(turn);
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
        countDialogueMiss();
      }
    });
    choicesEl.appendChild(btn);
  });

  requestAnimationFrame(() => choicesEl.scrollIntoView({ block: "end", behavior: "smooth" }));
}

// Одна ошибка на реплику — сколько бы раз ни промахнулась в ней.
function countDialogueMiss() {
  if (dialogueRun && dialogueRun.missedTurn !== currentTurnIndex) {
    dialogueRun.missedTurn = currentTurnIndex;
    dialogueRun.misses++;
  }
}
// Своя реплика сказана — пузырь, озвучка, дальше. said — что услышал телефон, если иначе.
function acceptOwnTurn(turn, said = "") {
  stopDialogueListening();
  const choicesEl = document.getElementById("dialogue-choices");
  choicesEl.classList.add("hidden");
  choicesEl.innerHTML = "";
  appendDialogueBubble(turn);
  if (said) {
    const bubbles = document.querySelectorAll("#dialogue-transcript .dialogue-bubble");
    const note = document.createElement("div");
    note.className = "bubble-said";
    note.textContent = `ты сказала: ${said}`;
    bubbles[bubbles.length - 1].appendChild(note);
  }
  currentTurnIndex++;
  speakThenAdvance(turn.tr, 300, advanceDialogue);
}
function stopDialogueListening() {
  if (dialogueStopListening) dialogueStopListening();
  dialogueStopListening = null;
}
function dialogueSayPanel(choicesEl, { prompt = "", hint = "" } = {}) {
  choicesEl.classList.remove("hidden");
  choicesEl.innerHTML =
    '<div class="say-box dialogue-say">' +
    (prompt ? `<div class="dialogue-say-prompt">${prompt}</div>` : "") +
    (hint ? `<div class="dialogue-say-hint">${hint}</div>` : "") +
    '<button type="button" class="say-mic">🎤 Нажми и скажи</button>' +
    '<div class="say-heard"></div><div class="say-actions"></div></div>';
  requestAnimationFrame(() => choicesEl.scrollIntoView({ block: "end", behavior: "smooth" }));
  const box = choicesEl.querySelector(".say-box");
  return {
    box,
    mic: box.querySelector(".say-mic"),
    heardEl: box.querySelector(".say-heard"),
    actions: box.querySelector(".say-actions"),
  };
}
function setDialogueActions(actions, buttons, alive) {
  actions.innerHTML = "";
  buttons.forEach(([label, cls, fn]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", () => alive() && fn());
    actions.appendChild(b);
  });
}
function showHeardWords(heardEl, m) {
  heardEl.innerHTML =
    '<span class="say-label">Услышал:</span> ' +
    (m.words.length ? m.words.map((x) => `<span class="${x.hit ? "hit" : "miss"}">${escapeHtml(x.w)}</span>`).join(" ") : "—");
}
// Запуск микрофона с общими состояниями кнопки; onHeard(transcripts).
function dialogueListen(mic, alive, onHeard) {
  mic.addEventListener("click", () => {
    if (!alive()) return;
    if (mic.classList.contains("listening")) {
      if (dialogueStopListening && dialogueStopListening.finish) dialogueStopListening.finish();
      return;
    }
    mic.classList.add("listening");
    mic.textContent = "🔴 Слушаю… нажми, когда скажешь";
    dialogueStopListening = listenTurkish({
      onResult: (transcripts) => {
        mic.classList.remove("listening");
        mic.textContent = "🎤 Сказать ещё раз";
        if (alive()) onHeard(transcripts);
      },
      onNothing: () => {
        mic.classList.remove("listening");
        mic.textContent = "🎤 Не расслышал — нажми и скажи";
      },
      onFail: (reason) => {
        mic.classList.remove("listening");
        if (!alive()) return;
        // Голос не работает — до перезагрузки вспоминаем без микрофона.
        dialogueRun.voice = false;
        updateDialogueSayButton();
        const turn = currentDialogue.turns[currentTurnIndex];
        if (dialogueRun.step === 2) renderDialogueChoices(turn);
        else renderRecallTurn(turn);
        const note = document.createElement("div");
        note.className = "dialogue-say-hint";
        note.textContent = `🎤 Голос выключен: ${reason}.`;
        document.getElementById("dialogue-choices").prepend(note);
      },
    });
  });
}

// Ступень 2: варианты на экране, нужный — сказать вслух.
function renderVoiceChoice(turn) {
  const choicesEl = document.getElementById("dialogue-choices");
  const ui = dialogueSayPanel(choicesEl, { hint: "Скажи вслух свою реплику:" });
  const options = shuffle([{ tr: turn.tr, correct: true }, ...turn.distractors.map((d) => ({ tr: d.tr, correct: false }))]);
  const list = document.createElement("div");
  list.className = "dialogue-voice-options";
  options.forEach((o) => {
    const el = document.createElement("div");
    el.className = "quiz-option voice-option";
    el.textContent = o.tr;
    o.el = el;
    list.appendChild(el);
  });
  ui.mic.before(list);
  const index = currentTurnIndex;
  const alive = () => currentDialogue && currentTurnIndex === index && dialogueRun;
  dialogueListen(ui.mic, alive, (transcripts) => {
    // Какой из вариантов сказан: у кого больше узнанных слов.
    const scored = options.map((o) => ({ o, m: bestSpokenMatch(o.tr, transcripts, { ignore: DIALOGUE_IGNORE }) }));
    scored.sort((a, b) => b.m.score - a.m.score);
    const top = scored[0];
    showHeardWords(ui.heardEl, top.m);
    if (top.m.score < 0.4 || (scored[1] && scored[1].m.score === top.m.score)) {
      ui.heardEl.insertAdjacentHTML("beforeend", '<div class="say-label">Не понял, какой вариант, — скажи ещё раз</div>');
      return;
    }
    if (top.o.correct) {
      top.o.el.classList.add("correct");
      acceptOwnTurn(turn);
    } else {
      top.o.el.classList.add("wrong");
      setTimeout(() => top.o.el.classList.remove("wrong"), 600);
      countDialogueMiss();
      ui.heardEl.insertAdjacentHTML("beforeend", '<div class="say-label">Это другой вариант — скажи нужный</div>');
    }
  });
  setDialogueActions(ui.actions, [["Выбрать нажатием", "secondary", () => renderDialogueChoices(turn)]], alive);
}

// Ступени 3–4 (и 2–4 без голоса): вспомнить свою реплику.
function renderRecallTurn(turn) {
  const step = dialogueRun.step;
  const voice = dialogueRun.voice;
  const choicesEl = document.getElementById("dialogue-choices");
  const ruPrompt = `Скажи: «${escapeHtml(turn.ru)}»`;
  // Без голоса ступень 2 — с первыми буквами, 3 — только по-русски; с голосом ступень 3 — с буквами.
  const withInitials = voice ? step === 3 : step === 2;
  const showRu = step < 4;
  const ui = dialogueSayPanel(choicesEl, {
    prompt: showRu ? ruPrompt : "Твоя реплика — ответь собеседнику",
    hint: withInitials ? `💡 ${escapeHtml(initialsHint(turn.tr))}` : "",
  });
  const index = currentTurnIndex;
  const alive = () => currentDialogue && currentTurnIndex === index && dialogueRun;
  let tries = 0;
  let lastHeard = "";

  // Открыть ответ: эталон + озвучка, человек сам решает, совпало ли.
  const reveal = (afterTry) => {
    stopDialogueListening();
    ui.mic.classList.add("hidden");
    const ref = document.createElement("div");
    ref.className = "say-reference";
    ref.innerHTML = `<span class="say-label">Как в диалоге:</span> <b>${escapeHtml(turn.tr)}</b>`;
    ui.heardEl.after(ref);
    speak(turn.tr);
    setDialogueActions(
      ui.actions,
      [
        [afterTry ? "✓ Сказала по-другому, но правильно" : "✓ Вспомнила так же", "", () => {
          if (afterTry && lastHeard) logSaidOtherwise(turn, lastHeard);
          acceptOwnTurn(turn, afterTry ? lastHeard : "");
        }],
        ["✗ Не вспомнила", "secondary", () => {
          countDialogueMiss();
          acceptOwnTurn(turn);
        }],
      ],
      alive
    );
  };

  // Если на ступени 4 совсем не вспоминается — можно подсмотреть смысл по-русски (не ошибка).
  const whatToSay = ["Что сказать? 💡", "secondary", () => {
    const p = ui.box.querySelector(".dialogue-say-prompt");
    if (p) p.innerHTML = ruPrompt;
  }];
  if (!voice) {
    ui.mic.classList.add("hidden");
    ui.heardEl.innerHTML = '<span class="say-label">Вспомни и скажи — вслух или про себя, потом проверь.</span>';
    setDialogueActions(ui.actions, [...(showRu ? [] : [whatToSay]), ["Проверить себя", "", () => reveal(false)]], alive);
    return;
  }
  const extra = [["Показать ответ", "secondary", () => reveal(lastHeard !== "")]];
  if (!showRu) extra.unshift(whatToSay);
  setDialogueActions(ui.actions, extra, alive);
  dialogueListen(ui.mic, alive, (transcripts) => {
    const refs = [turn.tr, ...(turn.alts || [])].map(dialogueKeyText);
    const m = bestSpokenMatch(refs, transcripts, { ignore: DIALOGUE_IGNORE, threshold: step >= 4 ? 0.6 : 0.75 });
    lastHeard = m.text;
    showHeardWords(ui.heardEl, m);
    if (m.ok) {
      acceptOwnTurn(turn, m.score < 1 ? m.text : "");
      return;
    }
    tries++;
    if (tries >= DIALOGUE_TRIES) reveal(true);
    else ui.heardEl.insertAdjacentHTML("beforeend", `<div class="say-label">Не совпало — скажи ещё раз (осталось ${DIALOGUE_TRIES - tries}) или открой ответ</div>`);
  });
}

// Конец диалога: сколько своих реплик сказано самой, и какая ступень дальше.
function finishDialogueRun() {
  stopDialogueListening();
  const run = dialogueRun;
  const allowed = Math.max(1, Math.floor(run.own / 4));
  const passed = run.misses <= allowed;
  const next = passed ? run.step + 1 : run.step;
  setDialogueStep(currentDialogue, currentDialogueRole, next);
  const self = run.own - run.misses;
  const title = document.querySelector("#dialogue-finished p");
  if (next >= 5) title.innerHTML = `⭐ Диалог освоен! Все 4 ступени в роли «${escapeHtml(currentDialogue.speakers[currentDialogueRole])}» пройдены.`;
  else if (passed)
    title.innerHTML = `🎉 Ступень ${run.step} пройдена: сама ${self} из ${run.own} реплик.<br>Дальше — ступень ${next}: «${DIALOGUE_STEPS[next].name}».`;
  else
    title.innerHTML = `Ступень ${run.step}: сама ${self} из ${run.own} реплик — ошибок больше ${allowed}. В следующий раз ещё раз эта ступень.`;
  document.getElementById("dialogue-replay-role-btn").textContent = next >= 5 ? "Ещё раз (живой разговор)" : `Дальше: ступень ${next} ▶`;
  document.getElementById("dialogue-next-btn").classList.toggle("hidden", !getNextDialogueInTopic());
  document.getElementById("dialogue-finished").classList.remove("hidden");
}

// «Сейчас можно говорить вслух?» — раз в день, общий ответ с «Фразами».
function askDialogueSay(next) {
  const ov = document.getElementById("dialogue-overlay");
  ov.classList.remove("hidden");
  const done = (on) => {
    ov.classList.add("hidden");
    setSayChoice(on);
    next();
  };
  document.getElementById("dialogue-say-yes").onclick = () => done(true);
  document.getElementById("dialogue-say-no").onclick = () => done(false);
}
function updateDialogueSayButton() {
  const btn = document.getElementById("dialogue-say-btn");
  btn.classList.toggle("hidden", !saySupported());
  btn.classList.toggle("off", !sayEnabled());
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

  document.getElementById("dialogue-say-btn").addEventListener("click", () => {
    setSayChoice(!sayEnabled());
    updateDialogueSayButton();
    // Новая настройка — со следующей реплики.
    if (dialogueRun) dialogueRun.voice = dialogueRun.step >= 2 && sayEnabled();
  });
  document.getElementById("dialogue-back-btn").addEventListener("click", () => {
    stopDialogueListening();
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
