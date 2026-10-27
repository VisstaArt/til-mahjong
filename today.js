// «Занятие дня» по этапам A1 (assets/stages.json, собирает tools/stages/build_stages.py):
// этап ≈ юнит учебника Yeni Hitit 1 — своя грамматика, фразы, слова и диалоги. Занятие
// идёт порциями по ~30 минут: слова этапа (игра) → фразы этапа (рейсы, новых не больше
// DAY_NEW_PHRASES) → ступень грамматики этапа → ступень диалога этапа. Прошла порцию —
// можно взять ещё (до DAY_MAX_PORTIONS в день): по порции в день A1 — это 4–5 месяцев,
// по четыре (≈ 2 часа) — полтора-два.
// Этап пройден, когда каждая его фраза хоть раз запомнилась (🟡) и сыграны все ступени
// его грамматики. С какого этапа начать — подсказывает входной тест (placement.js).
// Классический <script> после grammar.js: пользуется функциями остальных режимов.

const DAY_META_KEY = "__day"; // в прогрессе фраз — синхронизируется с облаком
const STAGE_META_KEY = "__stage"; // {placed, at, warm: [темы грамматики на разминку]} — тоже
const STAGES_URL = "assets/stages.json";
const DAY_PHRASE_VOYAGES = 2;
const DAY_NEW_PHRASES = 6; // новых фраз за порцию
const DAY_DECK_SIZE = 20; // слов в игре порции…
const DAY_NEW_WORDS = 5; // …из них совсем новых
const DAY_MIN_DECK = 10; // в самом начале знакомых нет — новых столько, чтобы игра сложилась
const DAY_MAX_PORTIONS = 4; // ≈ 2 часа — дальше внимание уже не то
const DAY_WORD_ROUNDS = { search: 2 }; // «Найди слова» короткая — две сетки
const DAY_BLOCKS = ["words", "phrases", "grammar", "dialogue"];

let dayRun = null; // {block, warm?} — какой шаг занятия сейчас идёт
let stagesData = null; // [{n, title, unit, emoji, grammar, phraseTopics, words, phrases, dialogues}]

// Игра для слов этапа меняется по дням; на шаге можно выбрать другую.
const DAY_WORD_GAMES = [
  { id: "mahjong", emoji: "🀄", title: "Маджонг" },
  { id: "rain", emoji: "🌧", title: "Слова падают" },
  { id: "search", emoji: "🔎", title: "Найди слова" },
  { id: "listen", emoji: "👂", title: "Слушай и найди" },
  { id: "cross", emoji: "✏️", title: "Кроссворд" },
];
function dayWordGame(dateStr, portion = 1) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayNum = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return DAY_WORD_GAMES[(dayNum + portion - 1) % DAY_WORD_GAMES.length];
}

async function fetchStages() {
  if (stagesData) return stagesData;
  try {
    const resp = await fetch(STAGES_URL);
    stagesData = resp.ok ? (await resp.json()).stages : [];
  } catch {
    stagesData = [];
  }
  return stagesData;
}

function getStageMeta() {
  return { placed: null, at: null, warm: [], ...(phraseProgress[STAGE_META_KEY] || {}) };
}
function saveStageMeta(meta) {
  phraseProgress[STAGE_META_KEY] = meta;
  savePhraseProgress();
}
function getDayMeta() {
  return { streak: 0, lastFull: null, done: {}, voyages: 0, portion: 1, newLeft: DAY_NEW_PHRASES, wordRounds: 0, ...(phraseProgress[DAY_META_KEY] || {}) };
}
function saveDayMeta(meta) {
  phraseProgress[DAY_META_KEY] = meta;
  savePhraseProgress();
}
// Новый день — первая порция заново.
function todayPlan() {
  const meta = getDayMeta();
  const today = todayStr();
  if (meta.date !== today) {
    Object.assign(meta, { date: today, portion: 1, done: {}, voyages: 0, newLeft: DAY_NEW_PHRASES, wordRounds: 0 });
    saveDayMeta(meta);
  }
  return meta;
}
function nextPortion() {
  const meta = todayPlan();
  Object.assign(meta, { portion: meta.portion + 1, done: {}, voyages: 0, newLeft: DAY_NEW_PHRASES, wordRounds: 0 });
  saveDayMeta(meta);
}

// --- этапы ---
function stageGrammarSteps(stage) {
  return stage.grammar.flatMap((id) => {
    const topic = GRAMMAR_TOPICS.find((t) => t.id === id);
    return topic ? topicLevels(id).map((level) => ({ topic, level })) : [];
  });
}
function stageStatus(stage) {
  const ids = stage.phrases.filter((id) => !excludedPhrases.has(id));
  const learned = ids.filter((id) => phraseEverLearned(id)).length;
  const steps = stageGrammarSteps(stage);
  const stepsDone = steps.filter((s) => levelStars(s.topic.id, s.level.n) > 0).length;
  return {
    ids,
    learned,
    steps,
    stepsDone,
    done: learned >= ids.length && stepsDone >= steps.length,
    portions: Math.max(Math.ceil((ids.length - learned) / DAY_NEW_PHRASES), steps.length - stepsDone),
  };
}
// Текущий этап — первый непройденный, начиная с того, что подсказал входной тест.
// Всё пройдено — «этап» повторения всего A1.
function currentStage() {
  const from = getStageMeta().placed || 1;
  const st = stagesData.find((s) => s.n >= from && !stageStatus(s).done);
  if (st) return st;
  return {
    n: stagesData.length + 1,
    final: true,
    title: "A1 пройден — повторение",
    emoji: "🏆",
    unit: "",
    grammar: [],
    phrases: [],
    dialogues: [],
    words: stagesData.flatMap((s) => s.words),
  };
}
function stagesUpTo(stage) {
  return stagesData.filter((s) => s.n <= stage.n);
}

// Грамматика: разминка темы, пройденной входным тестом (раз в день, в первой порции), иначе —
// следующая ступень тем этапа; всё сыграно — повторение.
function grammarDayTarget(stage, meta) {
  const warm = getStageMeta().warm || [];
  if (meta.portion === 1 && warm.length) {
    const topic = GRAMMAR_TOPICS.find((t) => t.id === warm[0]);
    const level = topic && topicLevels(topic.id).find((l) => l.gate);
    if (level) return { topic, level, warm: topic.id };
  }
  for (const id of stage.grammar) {
    const topic = GRAMMAR_TOPICS.find((t) => t.id === id);
    if (!topic || !isTopicUnlocked(id)) continue;
    if (topicLevels(id).some((l) => levelStars(id, l.n) === 0)) {
      const n = nextToPlay(id);
      return { topic, level: topicLevels(id).find((l) => l.n === n) };
    }
  }
  if (isReviewUnlocked()) return { topic: GRAMMAR_REVIEW, level: null };
  const lastId = (stage.grammar.length ? stage.grammar : GRAMMAR_TOPICS.map((t) => t.id)).slice(-1)[0];
  const topic = GRAMMAR_TOPICS.find((t) => t.id === lastId);
  return { topic, level: topicLevels(topic.id).find((l) => l.gate) || topicLevels(topic.id)[0] };
}

// Диалог: сначала диалоги этапа (от коротких к длинным), потом недоделанные прошлых этапов.
// Один диалог проходится лесенкой за свою роль, потом следующий; вторые роли — после.
async function dayDialogue(stage) {
  await fetchDialogueManifest();
  const pools = [stage, ...stagesData.filter((s) => s.n < stage.n).reverse()];
  const refs = pools.flatMap((s) => s.dialogues);
  for (const role of ["a", "b"]) {
    for (const ref of refs) {
      const topic = await loadDialogueTopic(ref.topic);
      const dialogue = topic.dialogues.find((d) => d.id === ref.id);
      if (dialogue && getDialogueStep(dialogue, role) < 5) return { topic, dialogue, role, step: getDialogueStep(dialogue, role) };
    }
  }
  return null;
}

async function openToday() {
  endDayRun();
  setScreen("today");
  const root = document.getElementById("today-root");
  root.innerHTML = '<div class="catalog-loading">⏳ Собираем занятие…</div>';
  await Promise.all([fetchStages(), fetchPhraseManifest(), fetchPhraseLevels(), loadGrammarItems()]);
  if (!stagesData.length) {
    root.innerHTML = '<div class="catalog-loading">Не удалось загрузить этапы — проверь интернет и открой ещё раз.</div>';
    return;
  }
  const meta = todayPlan();
  const stage = currentStage();
  const status = stage.final ? null : stageStatus(stage);
  const gram = grammarDayTarget(stage, meta);
  const dlg = await dayDialogue(stage);
  if (document.body.dataset.screen !== "today") return;
  const placed = getStageMeta().placed;

  const game = dayWordGame(meta.date, meta.portion);
  const rounds = DAY_WORD_ROUNDS[game.id] || 1;
  const phrasesSub = stage.final
    ? "повторяем фразы всего A1"
    : status.learned >= status.ids.length
      ? "новые фразы этапа пройдены — повторяем"
      : `новых — до ${DAY_NEW_PHRASES}, остальное повторение` + (meta.voyages && !meta.done.phrases ? ` · пройдено ${meta.voyages} из ${DAY_PHRASE_VOYAGES}` : "");
  const steps = [
    {
      id: "words",
      icon: game.emoji,
      title: `Слова этапа — ${game.title}` + (rounds > 1 ? ` ×${rounds}` : ""),
      sub: `${stage.words.slice(0, 3).join(", ")}${stage.words.length > 3 ? "…" : ""} · ${DAY_DECK_SIZE} слов, новых до ${DAY_NEW_WORDS}` + (meta.wordRounds && !meta.done.words ? ` · сыграно ${meta.wordRounds} из ${rounds}` : ""),
      start: () => startDayWords(stage, game.id),
      alt: true,
    },
    {
      id: "phrases",
      icon: "💬",
      title: `Фразы этапа — ${DAY_PHRASE_VOYAGES} ${ferryPlural(DAY_PHRASE_VOYAGES, "рейс", "рейса", "рейсов")}`,
      sub: phrasesSub,
      start: () => startDayPhrases(stage),
    },
    {
      id: "grammar",
      icon: "🧩",
      title: gram.warm ? "Грамматика — разминка" : "Грамматика — раунд",
      sub: gram.level
        ? `«${gram.topic.title}», ступень ${gram.level.n}: ${gram.level.title}` + (gram.warm ? " (тема пройдена тестом)" : "")
        : "Повторение вперемешку",
      start: () => startDayGrammar(gram),
    },
    {
      id: "dialogue",
      icon: "🎭",
      title: "Диалог",
      sub: dlg ? `«${dlg.dialogue.title}» — роль ${dlg.dialogue.speakers[dlg.role]}, ступень ${Math.min(4, dlg.step)} из 4` : "Диалогов для этого этапа пока нет",
      start: dlg ? () => startDayDialogue(dlg) : null,
    },
  ];
  // Шаг без содержимого (нет диалога) не держит порцию.
  steps.filter((s) => !s.start).forEach((s) => (meta.done[s.id] = true));
  const doneCount = steps.filter((s) => meta.done[s.id]).length;
  const portionDone = doneCount === steps.length;
  const currentId = (steps.find((s) => !meta.done[s.id]) || {}).id;
  const streakText = meta.streak ? ` · 🔥 ${meta.streak} ${ferryPlural(meta.streak, "день", "дня", "дней")} подряд` : "";

  let stageHtml = `<div class="today-topic">${stage.final ? "" : `Этап ${stage.n} из ${stagesData.length} · `}${stage.emoji} <b>${escapeHtml(stage.title)}</b>`;
  if (stage.unit) stageHtml += `<small>по учебнику: ${escapeHtml(stage.unit)}</small>`;
  stageHtml += `</div>`;
  if (status) {
    const share = (status.learned + status.stepsDone) / Math.max(1, status.ids.length + status.steps.length);
    stageHtml +=
      `<div class="today-stage-bar"><span style="width:${Math.round(share * 100)}%"></span></div>` +
      `<div class="today-progress">фразы ${status.learned} из ${status.ids.length} · грамматика ${status.stepsDone} из ${status.steps.length}` +
      ` · до следующего этапа ≈ ${status.portions} ${ferryPlural(status.portions, "порция", "порции", "порций")}</div>`;
  }

  root.innerHTML =
    `<div class="today-card">` +
    `<div class="today-head"><span>📅 Занятие на сегодня</span><span class="today-level">A1</span></div>` +
    (placed
      ? ""
      : `<div class="today-placement"><b>🧭 С чего начать?</b><span>Входной тест (~10 минут) покажет, какие этапы ты уже знаешь, — их не придётся проходить с нуля.</span>` +
        `<div class="today-placement-btns"><button type="button" id="today-test-btn">Пройти тест ▶</button><button type="button" class="secondary" id="today-from-start-btn">Начать с начала</button></div></div>`) +
    stageHtml +
    `<div class="today-progress">Порция ${meta.portion}${meta.portion > 1 ? ` из ${DAY_MAX_PORTIONS}` : ""}: <span class="today-dots">${steps.map((s) => (meta.done[s.id] ? "●" : "○")).join(" ")}</span> ${doneCount} из ${steps.length}${streakText}</div>` +
    `<ol class="today-steps">` +
    steps
      .map(
        (s, i) =>
          `<li class="${meta.done[s.id] ? "done" : s.id === currentId ? "current" : ""}">` +
          `<span class="ts-icon">${meta.done[s.id] ? "✓" : s.icon}</span>` +
          `<div class="ts-text"><b>${i + 1}. ${s.title}</b><small>${escapeHtml(s.sub)}</small>` +
          (s.alt
            ? `<span class="ts-alt">или: ${DAY_WORD_GAMES.filter((x) => x.id !== game.id)
                .map((x) => `<button type="button" class="ts-alt-btn" data-game="${x.id}" title="${x.title}">${x.emoji}</button>`)
                .join("")}</span>`
            : "") +
          `</div>` +
          (s.start ? `<button type="button" data-step="${s.id}">${meta.done[s.id] ? "Ещё" : "▶"}</button>` : "") +
          `</li>`
      )
      .join("") +
    `</ol>` +
    (portionDone
      ? `<div class="today-finish">🎉 Порция ${meta.portion} готова!${meta.streak > 1 ? ` Серия: ${meta.streak} ${ferryPlural(meta.streak, "день", "дня", "дней")} подряд.` : ""}` +
        (meta.portion < DAY_MAX_PORTIONS
          ? `<button type="button" id="today-more-btn">Ещё порция ▶</button><small>≈ 30 минут: новые слова и фразы, следующая ступень грамматики и диалога</small>`
          : `<small>На сегодня хватит: ${DAY_MAX_PORTIONS} порции — это около двух часов. Завтра продолжим!</small>`) +
        `</div>`
      : "") +
    `<p class="today-note">Порция ≈ 30 минут. Этапы идут по учебнику Yeni Hitit 1: фраза приходит, когда пройдена её грамматика, диалоги — от коротких к длинным. Одна порция в день — A1 за 4–5 месяцев, четыре — за 1,5–2.</p>` +
    (placed ? `<button type="button" class="today-retest" id="today-test-btn">🧭 Пройти входной тест заново</button>` : "") +
    `</div>`;

  root.querySelectorAll(".ts-alt-btn").forEach((b) =>
    b.addEventListener("click", () => {
      b.disabled = true;
      startDayWords(stage, b.dataset.game);
    })
  );
  root.querySelectorAll("button[data-step]").forEach((b) => {
    const step = steps.find((s) => s.id === b.dataset.step);
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "⏳";
      await step.start();
    });
  });
  const more = document.getElementById("today-more-btn");
  if (more) more.addEventListener("click", () => (nextPortion(), updateTodayBanner(), openToday()));
  const test = document.getElementById("today-test-btn");
  if (test) test.addEventListener("click", () => openPlacement());
  const fromStart = document.getElementById("today-from-start-btn");
  if (fromStart) fromStart.addEventListener("click", () => (saveStageMeta({ ...getStageMeta(), placed: 1, at: todayStr() }), openToday()));
}

// --- запуск шагов ---
// Колода порции: до DAY_NEW_WORDS совсем новых слов этапа, остальное — то, что учится
// (сначала хуже выученное), включая слова прошлых этапов, и немного выученного на проверку.
// В кроссворде слова пишут по буквам — туда только уже встречавшиеся.
async function buildDayDeck(stage, gameId) {
  const themes = new Set([...stagesUpTo(stage).flatMap((s) => s.words), ...stage.words]);
  const loaded = getLoadedCategories();
  for (const theme of themes) if (!loaded.has(theme)) await loadCategoryWords(theme);
  customWords = await getAllCustomWords();
  const seen = new Set();
  const all = customWords.filter((w) => themes.has(w.theme) && wordLevel(w) === "A1" && !seen.has(w.tr) && seen.add(w.tr));
  const current = new Set(stage.words);
  const unseen = (w) => !wordProgress[w.tr];
  const fresh = shuffle(all.filter((w) => unseen(w) && current.has(w.theme)));
  const open = shuffle(all.filter((w) => !unseen(w) && getWordBox(w.tr).id !== "mastered")).sort((a, b) => getWordStreak(a.tr) - getWordStreak(b.tr));
  const known = shuffle(all.filter((w) => !unseen(w) && getWordBox(w.tr).id === "mastered"));
  const newCount = gameId === "cross" ? 0 : DAY_NEW_WORDS;
  let deck = [...fresh.slice(0, newCount), ...open, ...known].slice(0, DAY_DECK_SIZE);
  // Знакомых слов пока мало (самое начало) — добираем новыми, чтобы было во что играть.
  if (deck.length < DAY_MIN_DECK) deck = [...deck, ...fresh.slice(newCount)].slice(0, DAY_MIN_DECK);
  return deck;
}
async function startDayWords(stage, gameId = "mahjong") {
  dayDeckOverride = await buildDayDeck(stage, gameId);
  dayRun = { block: "words", game: gameId };
  activateMode("mahjong");
  if (gameId !== "mahjong") return startWordGame(gameId);
  setScreen("game");
  newGame();
}
// Рейсы по фразам этапа и всех прошлых (их повторы); новые — только этого этапа.
async function startDayPhrases(stage) {
  const meta = todayPlan();
  const ids = (stage.final ? stagesData : stagesUpTo(stage)).flatMap((s) => s.phrases);
  const topicIds = [...new Set(ids.map((id) => id.split("::")[0]))];
  const topics = await Promise.all(topicIds.map((id) => loadPhraseTopic(id)));
  dayRun = { block: "phrases" };
  activateMode("phrases");
  startQuiz(topics, null, false, ids, stage.final ? 0 : meta.newLeft);
  document.getElementById("quiz-topic-title").textContent = stage.final ? "Повторение A1" : `Этап ${stage.n} · ${stage.title}`;
}
async function startDayGrammar(target) {
  dayRun = { block: "grammar", warm: target.warm || null };
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
  let pillText = null;
  if (block === "phrases") {
    meta.voyages = (meta.voyages || 0) + 1;
    if (quizNewLeft !== null) meta.newLeft = Math.max(0, quizNewLeft);
    if (meta.voyages >= DAY_PHRASE_VOYAGES) meta.done.phrases = true;
    else pillText = `📅 Рейс ${meta.voyages} из ${DAY_PHRASE_VOYAGES} — к занятию ›`;
  } else if (block === "words") {
    const rounds = DAY_WORD_ROUNDS[dayRun.game] || 1;
    meta.wordRounds = (meta.wordRounds || 0) + 1;
    if (meta.wordRounds >= rounds) meta.done.words = true;
    else pillText = `📅 Сыграно ${meta.wordRounds} из ${rounds} — сыграй ещё раз или к занятию ›`;
  } else {
    meta.done[block] = true;
    if (block === "grammar" && dayRun.warm) {
      const sm = getStageMeta();
      saveStageMeta({ ...sm, warm: (sm.warm || []).filter((id) => id !== dayRun.warm) });
    }
  }
  const all = DAY_BLOCKS.every((b) => meta.done[b]);
  if (all && meta.lastFull !== meta.date) {
    meta.streak = meta.lastFull === addDaysStr(meta.date, -1) ? (meta.streak || 0) + 1 : 1;
    meta.lastFull = meta.date;
  }
  saveDayMeta(meta);
  updateTodayBanner();
  const pill = document.getElementById("today-pill");
  pill.textContent = pillText || (all ? "🎉 Порция готова — посмотреть ›" : "✓ Шаг готов — к занятию дня ›");
  pill.classList.remove("hidden");
}

// Вернуться к занятию: аккуратно закрыть текущий режим.
function leaveDayBlock() {
  const screen = document.body.dataset.screen;
  if (screen === "quiz") document.getElementById("quiz-back-btn").click();
  else if (screen === "dialogue-player") document.getElementById("dialogue-back-btn").click();
  else if (screen === "grammar-drill") document.getElementById("grammar-round-end").classList.add("hidden");
  else if (screen === "word-game") wgBack();
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
  const fresh = meta.date === todayStr();
  const done = fresh ? DAY_BLOCKS.filter((b) => (meta.done || {})[b]).length : 0;
  const portion = fresh && meta.portion > 1 ? ` · порция ${meta.portion}` : "";
  banner.innerHTML = `📅 Занятие дня${portion} <span class="today-banner-dots">${"●".repeat(done)}${"○".repeat(4 - done)}</span>${done === 4 ? " ✓" : ""}`;
}

function initToday() {
  document.getElementById("today-banner").addEventListener("click", () => {
    activateMode(null);
    openToday();
  });
  document.getElementById("today-pill").addEventListener("click", leaveDayBlock);
  // Ушла в любой режим сама — занятие больше не ведём.
  document.querySelectorAll(".mode-switch .mode-btn").forEach((b) => b.addEventListener("click", endDayRun));
  // Из маджонга занятия ушла в настройки слов — дальше своя подборка, не слова этапа.
  document.getElementById("back-to-setup-btn").addEventListener("click", () => dayRun && endDayRun());
  updateTodayBanner();
}

initToday();
