// «Занятие дня»: одна тема на все режимы — сначала слова темы (маджонг), потом фразы
// этой темы (рейсы), грамматика (следующая ступень своего пути — правила идут по
// порядку и к темам не привязаны) и в конце диалог этой же темы: к диалогу слова и
// фразы уже натренированы. Тема дня — тема причала, у которого сейчас пароход на
// карте пути «Фраз» (journeyLevel), и она фиксируется на весь день.
// Классический <script> после grammar.js: пользуется функциями остальных режимов.

const DAY_META_KEY = "__day"; // в прогрессе фраз — синхронизируется с облаком
const DAY_PHRASE_VOYAGES = 2;
const DAY_MIN_WORDS = 10; // меньше слов уровня в категориях темы — добираем следующий уровень

// Категории слов маджонга под каждую тему фраз.
const DAY_TOPIC_WORDS = {
  privetstvie: ["Календарь и время", "Эмоции и чувства"],
  znakomstvo: ["Страны и национальности", "Профессии"],
  "voprositelnye-slova": ["Служебные слова"],
  "obscheprinyatye-slova": ["Служебные слова"],
  semya: ["Семья и отношения"],
  "moy-den": ["Глаголы — действия", "Дом и мебель"],
  vremya: ["Календарь и время", "Числительные"],
  restoran: ["Еда и напитки", "Кухня и посуда"],
  "pokupki-servis": ["Покупки и магазины", "Одежда и аксессуары", "Цвета"],
  "v-gorode": ["Город и места", "Транспорт и вождение", "Направления и предлоги"],
  puteshestvie: ["Транспорт и вождение", "Страны и национальности"],
  "v-otele": ["Дом и мебель", "Ванная и гигиена"],
  zdorove: ["Части тела", "Здоровье"],
  "o-pogode": ["Природа и погода"],
  "kak-pomenyat-dengi": ["Числительные", "Покупки и магазины"],
  "na-tamozhne": ["Предметы и вещи"],
  "osmotr-dostoprimechatelnostey": ["Город и места"],
  "razvlecheniya-otdyh": ["Спорт и игры"],
  "kak-deystvovat-v-ekstrennoy-situacii": ["Здоровье", "Части тела"],
  "nekotorye-poleznye-nadpisi-i-vyveski": ["Город и места", "Направления и предлоги"],
  "zhaloby-problemy": ["Дом и мебель", "Предметы и вещи"],
  rabota: ["Профессии", "Офис"],
  mneniya: ["Прилагательные и сравнения", "Эмоции и чувства"],
  "biznes-vstrechi-i-ofis": ["Офис", "Бизнес"],
};

let dayRun = null; // {block} — какой шаг занятия сейчас идёт

function getDayMeta() {
  return { streak: 0, lastFull: null, done: {}, voyages: 0, ...(phraseProgress[DAY_META_KEY] || {}) };
}
function saveDayMeta(meta) {
  phraseProgress[DAY_META_KEY] = meta;
  savePhraseProgress();
}
function currentJourneyTopic(level) {
  const stops = journeyStops(levelTopicIds(level), level, true, level);
  const st = journeyState(stops);
  const stop = stops[st.current < 0 ? stops.length - 1 : st.current];
  return { topicId: stop ? stop.topicId : levelTopicIds(level)[0], stop };
}
// План на сегодня: тема фиксируется при первом открытии за день.
function todayPlan() {
  const meta = getDayMeta();
  const today = todayStr();
  if (meta.date !== today) {
    Object.assign(meta, { date: today, topic: null, level: null, done: {}, voyages: 0 });
  }
  if (!meta.topic) {
    meta.level = journeyLevel;
    meta.topic = currentJourneyTopic(journeyLevel).topicId;
    saveDayMeta(meta);
  }
  return meta;
}

// Грамматика: первая открытая тема, где есть непройденная ступень; всё пройдено — повторение.
function grammarDayTarget() {
  let last = null;
  for (const t of GRAMMAR_TOPICS) {
    if (!isTopicUnlocked(t.id)) break;
    last = t;
    if (topicLevels(t.id).some((l) => levelStars(t.id, l.n) === 0)) {
      const n = nextToPlay(t.id);
      return { topic: t, level: topicLevels(t.id).find((l) => l.n === n) };
    }
  }
  if (isReviewUnlocked()) return { topic: GRAMMAR_REVIEW, level: null };
  const topic = last || GRAMMAR_TOPICS[0];
  const n = nextToPlay(topic.id);
  return { topic, level: topicLevels(topic.id).find((l) => l.n === n) };
}

// Диалог темы: первый ещё не освоенный этого уровня; у темы нет диалогов — ближайшая следующая.
async function dayDialogue(topicId, level) {
  await fetchDialogueManifest();
  const ids = dialogueManifest.map((m) => m.id);
  const order = phraseLevels.order;
  const from = Math.max(0, order.indexOf(topicId));
  const candidates = [...order.slice(from), ...order.slice(0, from)].filter((id) => ids.includes(id));
  for (const id of candidates) {
    const topic = await loadDialogueTopic(id);
    const fits = topic.dialogues.filter((d) => (d.level || topicLevel(id)) === level);
    const pool = fits.length ? fits : id === candidates[0] ? topic.dialogues : [];
    for (const d of pool) {
      const role = getDialogueStep(d, "a") < 5 ? "a" : getDialogueStep(d, "b") < 5 ? "b" : null;
      if (role) return { topic, dialogue: d, role, step: getDialogueStep(d, role) };
    }
  }
  return null;
}

async function openToday() {
  endDayRun();
  setScreen("today");
  const root = document.getElementById("today-root");
  root.innerHTML = '<div class="catalog-loading">⏳ Собираем занятие…</div>';
  await Promise.all([fetchPhraseManifest(), fetchPhraseLevels(), loadGrammarItems()]);
  const meta = todayPlan();
  const level = meta.level;
  const titles = new Map(phraseManifest.map((m) => [m.id, m.title]));
  const topicTitle = titles.get(meta.topic) || meta.topic;
  const { stop } = currentJourneyTopic(level);
  const words = DAY_TOPIC_WORDS[meta.topic] || ["Служебные слова"];
  const gram = grammarDayTarget();
  const dlg = await dayDialogue(meta.topic, level);
  if (document.body.dataset.screen !== "today") return;

  const steps = [
    {
      id: "words",
      icon: "🀄",
      title: "Слова темы",
      sub: `Маджонг: ${words.join(", ")} — слова уровня ${level}`,
      start: () => startDayWords(words, level),
    },
    {
      id: "phrases",
      icon: "💬",
      title: `Фразы темы — ${DAY_PHRASE_VOYAGES} ${ferryPlural(DAY_PHRASE_VOYAGES, "рейс", "рейса", "рейсов")}`,
      sub: `«${topicTitle}», фразы ${level}` + (meta.voyages && !meta.done.phrases ? ` · пройдено ${meta.voyages} из ${DAY_PHRASE_VOYAGES}` : ""),
      start: () => startDayPhrases(meta.topic, level),
    },
    {
      id: "grammar",
      icon: "🧩",
      title: "Грамматика — раунд",
      sub: gram.level ? `«${gram.topic.title}», ступень ${gram.level.n}: ${gram.level.title}` : "Повторение вперемешку",
      start: () => startDayGrammar(gram),
    },
    {
      id: "dialogue",
      icon: "🎭",
      title: "Диалог темы",
      sub: dlg ? `«${dlg.dialogue.title}» — роль ${dlg.dialogue.speakers[dlg.role]}, ступень ${Math.min(4, dlg.step)} из 4` : "Диалогов для этой темы пока нет",
      start: dlg ? () => startDayDialogue(dlg) : null,
    },
  ];
  const doneCount = steps.filter((s) => meta.done[s.id]).length;
  const currentId = (steps.find((s) => !meta.done[s.id]) || {}).id;
  const streakText = meta.streak ? ` · 🔥 ${meta.streak} ${ferryPlural(meta.streak, "день", "дня", "дней")} подряд` : "";

  root.innerHTML =
    `<div class="today-card">` +
    `<div class="today-head"><span>📅 Занятие на сегодня</span><span class="today-level">${level}</span></div>` +
    `<div class="today-topic">Тема дня: <b>${escapeHtml(topicTitle)}</b>` +
    (stop ? `<small>⛴️ причал ${stop.emoji} ${escapeHtml(stop.name)} на карте фраз</small>` : "") +
    `</div>` +
    `<div class="today-progress"><span class="today-dots">${steps.map((s) => (meta.done[s.id] ? "●" : "○")).join(" ")}</span> ${doneCount} из ${steps.length}${streakText}</div>` +
    `<ol class="today-steps">` +
    steps
      .map(
        (s, i) =>
          `<li class="${meta.done[s.id] ? "done" : s.id === currentId ? "current" : ""}">` +
          `<span class="ts-icon">${meta.done[s.id] ? "✓" : s.icon}</span>` +
          `<div class="ts-text"><b>${i + 1}. ${s.title}</b><small>${escapeHtml(s.sub)}</small></div>` +
          (s.start ? `<button type="button" data-step="${s.id}">${meta.done[s.id] ? "Ещё" : "▶"}</button>` : "") +
          `</li>`
      )
      .join("") +
    `</ol>` +
    (doneCount === steps.length
      ? `<div class="today-finish">🎉 Сегодня всё! Ты молодец.${meta.streak > 1 ? ` Серия: ${meta.streak} ${ferryPlural(meta.streak, "день", "дня", "дней")} подряд.` : ""}</div>`
      : "") +
    `<p class="today-note">Порядок такой, чтобы к диалогу слова и фразы темы были уже натренированы. Грамматика идёт своим путём — правило за правилом. Тема дня — та, у которой сейчас пароход на карте фраз; уровень меняется там же.</p>` +
    `</div>`;
  root.querySelectorAll("button[data-step]").forEach((b) => {
    const step = steps.find((s) => s.id === b.dataset.step);
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "⏳";
      await step.start();
    });
  });
}

// --- запуск шагов ---
async function startDayWords(themes, level) {
  const loaded = getLoadedCategories();
  for (const theme of themes) if (!loaded.has(theme)) await loadCategoryWords(theme);
  customWords = await getAllCustomWords();
  const inThemes = customWords.filter((w) => themes.includes(w.theme) && wordLevel(w));
  let deck = [];
  for (const lv of WORD_LEVEL_ORDER.slice(WORD_LEVEL_ORDER.indexOf(level))) {
    deck = inThemes.filter((w) => WORD_LEVEL_ORDER.indexOf(wordLevel(w)) <= WORD_LEVEL_ORDER.indexOf(lv));
    if (deck.length >= DAY_MIN_WORDS) break;
  }
  if (!deck.length) deck = inThemes;
  dayDeckOverride = deck;
  dayRun = { block: "words" };
  activateMode("mahjong");
  setScreen("game");
  newGame();
}
async function startDayPhrases(topicId, level) {
  const topic = await loadPhraseTopic(topicId);
  dayRun = { block: "phrases" };
  activateMode("phrases");
  startQuiz([topic], level, true);
}
async function startDayGrammar(target) {
  dayRun = { block: "grammar" };
  activateMode("grammar");
  await startGrammarRound(target.topic.id, target.level ? target.level.n : null);
}
function startDayDialogue(dlg) {
  dayRun = { block: "dialogue" };
  activateMode("dialogues");
  startDialogue(dlg.topic, dlg.dialogue, dlg.role);
}

// Шаг закончен (вызывают режимы: конец игры, рейса, раунда, диалога).
function dayBlockDone(block) {
  if (!dayRun || dayRun.block !== block) return;
  const meta = todayPlan();
  if (block === "phrases") {
    meta.voyages = (meta.voyages || 0) + 1;
    if (meta.voyages >= DAY_PHRASE_VOYAGES) meta.done.phrases = true;
  } else {
    meta.done[block] = true;
  }
  const all = ["words", "phrases", "grammar", "dialogue"].every((b) => meta.done[b]);
  if (all && meta.lastFull !== meta.date) {
    meta.streak = meta.lastFull === addDaysStr(meta.date, -1) ? (meta.streak || 0) + 1 : 1;
    meta.lastFull = meta.date;
  }
  saveDayMeta(meta);
  updateTodayBanner();
  const pill = document.getElementById("today-pill");
  pill.textContent =
    block === "phrases" && !meta.done.phrases
      ? `📅 Рейс ${meta.voyages} из ${DAY_PHRASE_VOYAGES} — к занятию ›`
      : all
        ? "🎉 Занятие дня готово — посмотреть ›"
        : "✓ Шаг готов — к занятию дня ›";
  pill.classList.remove("hidden");
}

// Вернуться к занятию: аккуратно закрыть текущий режим.
function leaveDayBlock() {
  const screen = document.body.dataset.screen;
  if (screen === "quiz") document.getElementById("quiz-back-btn").click();
  else if (screen === "dialogue-player") document.getElementById("dialogue-back-btn").click();
  else if (screen === "grammar-drill") document.getElementById("grammar-round-end").classList.add("hidden");
  else if (screen === "game") {
    stopTimer();
    winScreenEl.classList.add("hidden");
  }
  document.getElementById("match-popup").classList.add("hidden");
  openToday();
}
function endDayRun() {
  dayRun = null;
  dayDeckOverride = null;
  document.getElementById("today-pill").classList.add("hidden");
}

function updateTodayBanner() {
  const banner = document.getElementById("today-banner");
  const meta = getDayMeta();
  const done = meta.date === todayStr() ? ["words", "phrases", "grammar", "dialogue"].filter((b) => (meta.done || {})[b]).length : 0;
  banner.innerHTML = `📅 Занятие дня <span class="today-banner-dots">${"●".repeat(done)}${"○".repeat(4 - done)}</span>${done === 4 ? " ✓" : ""}`;
}

function initToday() {
  document.getElementById("today-banner").addEventListener("click", () => {
    activateMode(null);
    openToday();
  });
  document.getElementById("today-pill").addEventListener("click", leaveDayBlock);
  // Ушла в любой режим сама — занятие больше не ведём.
  document.querySelectorAll(".mode-switch .mode-btn").forEach((b) => b.addEventListener("click", endDayRun));
  updateTodayBanner();
}

initToday();
