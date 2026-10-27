// Входной тест: с какого этапа A1 начинать «Занятие дня» (этапы — assets/stages.json).
// Идём по этапам с первого, на каждый — PLACEMENT_PER_STAGE вопросов из его же материала:
// форма в грамматике (пропуск во фразе, варианты — «почти правильные» формы из
// items.json), понять фразу, понять фразу на слух, слова. Есть «Не знаю» — чтобы угадывание
// не завышало результат. Этап засчитан, если ошибок не больше PLACEMENT_MAX_MISSES; на
// первом незасчитанном тест останавливается — с него и начинаем.
// Пройденное тестом не выбрасывается, а уходит в повторение: фразы — на проверку в рейсах
// ближайшие PLACEMENT_SPREAD_DAYS дней (ошиблась — вернётся в изучение), слова — в 🟢,
// ступени грамматики открываются, а «Всё вместе» каждой темы придёт разминкой.
// Классический <script> после today.js: пользуется функциями остальных режимов.

const PLACEMENT_PER_STAGE = 8;
const PLACEMENT_MAX_MISSES = 1;
const PLACEMENT_OPTIONS = 4;
const PLACEMENT_SPREAD_DAYS = 21;
const PLACEMENT_WORD_STREAK = 6; // 🟢 «почти выучено» — слово ещё встретится, но реже

let placement = null; // {stage, questions, i, misses, passed: [n], token}
let placementToken = 0;

async function openPlacement() {
  endDayRun();
  setScreen("today");
  await Promise.all([fetchStages(), fetchPhraseLevels(), loadGrammarItems()]);
  const root = document.getElementById("today-root");
  root.innerHTML =
    `<div class="today-card placement">` +
    `<div class="today-head"><span>🧭 Входной тест</span><span class="today-level">A1</span></div>` +
    `<p>Около 10 минут. Вопросы идут по этапам учебника — от самых простых к сложным: грамматика, фразы, фраза на слух, слова.</p>` +
    `<p><b>Не угадывай.</b> Не знаешь — жми «Не знаю»: так тест точнее, а пройденное всё равно придёт на повторение.</p>` +
    `<p>Тест остановится на этапе, где начнутся трудности, — с него и начнём.</p>` +
    `<button type="button" id="placement-go-btn">Начать ▶</button>` +
    `<button type="button" class="secondary" id="placement-cancel-btn">Не сейчас</button>` +
    `</div>`;
  document.getElementById("placement-go-btn").addEventListener("click", () => {
    unlockSpeech();
    placement = { passed: [], token: ++placementToken };
    startPlacementStage(stagesData[0]);
  });
  document.getElementById("placement-cancel-btn").addEventListener("click", openToday);
}

// --- вопросы ---
function placementPick(list, n) {
  return shuffle(list).slice(0, n);
}
function placementOptions(correct, pool) {
  const seen = new Set([correct]);
  const wrong = shuffle(pool).filter((x) => x && !seen.has(x) && seen.add(x));
  return shuffle([correct, ...wrong.slice(0, PLACEMENT_OPTIONS - 1)]);
}

// Пропуск во фразе: правильная форма и «почти правильные» — та же форма с одним другим
// кусочком (лицо, гармония, падеж), как обманки в «Собери из кучки».
function grammarQuestions(stage, n) {
  const gates = new Map(stage.grammar.map((id) => [id, (topicLevels(id).find((l) => l.gate) || { stage: 99 }).stage]));
  const items = grammarItems.filter((it) => it.tier === "base" && gates.has(it.topic) && it.stage <= gates.get(it.topic));
  return placementPick(items, n * 3)
    .map((it) => {
      const slot = it.slots.find((s) => s.topic === it.topic) || it.slots.find((s) => s.tags.includes("question")) || it.slots[0];
      const correct = it.tr.slice(slot.start, slot.end);
      const near = [];
      slot.parts.forEach((part, i) =>
        part.options.forEach((opt) => {
          if (opt === part.text) return;
          near.push(slot.parts.map((p, j) => (j === i ? opt : p.text)).join(""));
        })
      );
      const options = placementOptions(correct, near.filter((x) => x.trim()));
      if (options.length < PLACEMENT_OPTIONS) return null;
      return {
        kind: "grammar",
        prompt: "Вставь подходящую форму",
        html: `<div class="pq-phrase">${escapeHtml(it.tr.slice(0, slot.start))}<span class="pq-gap">…</span>${escapeHtml(it.tr.slice(slot.end))}</div><div class="pq-ru">${escapeHtml(it.ru)}</div>`,
        options,
        correct,
      };
    })
    .filter(Boolean)
    .slice(0, n);
}

async function stagePhraseObjects(stage) {
  const topicIds = [...new Set(stage.phrases.map((id) => id.split("::")[0]))];
  const topics = await Promise.all(topicIds.map((id) => loadPhraseTopic(id)));
  const byId = new Map();
  topics.forEach((t) => t.phrases.forEach((p) => byId.set(phraseId(t.id, p), p)));
  return stage.phrases.map((id) => byId.get(id)).filter((p) => p && p.ru && !/[…/]/.test(p.tr));
}
function phraseQuestions(phrases, n, listen) {
  // Для проверки понимания — фразы хотя бы из трёх слов: «Merhaba» знают все.
  const pool = phrases.filter((p) => p.tr.split(" ").length >= 3);
  return placementPick(pool.length >= n ? pool : phrases, n).map((p) => ({
    kind: listen ? "listen" : "phrase",
    prompt: listen ? "Послушай: что сказали?" : "Что значит фраза?",
    html: listen
      ? `<button type="button" class="pq-speak" data-say="${escapeHtml(p.tr)}">🔊 Ещё раз</button>`
      : `<div class="pq-phrase">${escapeHtml(p.tr)}</div>`,
    say: listen ? p.tr : null,
    options: placementOptions(p.ru, phrases.map((x) => x.ru)),
    correct: p.ru,
  }));
}

async function stageWords(stage) {
  const lists = await Promise.all(
    stage.words.map((theme) =>
      fetch(`assets/words/${CATEGORY_SLUG[theme]}.json`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  );
  return lists.flat().filter((w) => w && w.tr && w.ru && wordLevels[w.tr] === "A1");
}
function wordQuestions(words, n) {
  return placementPick(words, n).map((w) => ({
    kind: "word",
    prompt: "Что значит слово?",
    html: `<div class="pq-phrase">${escapeHtml(w.tr)}</div>`,
    options: placementOptions(w.ru, words.map((x) => x.ru)),
    correct: w.ru,
  }));
}

async function stageQuestions(stage) {
  const [phrases, words] = await Promise.all([stagePhraseObjects(stage), stageWords(stage)]);
  const canListen = "speechSynthesis" in window;
  let qs;
  if (phrases.length >= PLACEMENT_OPTIONS) {
    qs = [
      ...grammarQuestions(stage, 3),
      ...phraseQuestions(phrases, canListen ? 2 : 3, false),
      ...(canListen ? phraseQuestions(phrases, 1, true) : []),
      ...wordQuestions(words, 2),
    ];
  } else {
    qs = [...grammarQuestions(stage, 5), ...wordQuestions(words, 3)];
  }
  // Где-то не хватило (мало слов/фраз) — добираем грамматикой.
  if (qs.length < PLACEMENT_PER_STAGE) qs.push(...grammarQuestions(stage, PLACEMENT_PER_STAGE - qs.length));
  return shuffle(qs.slice(0, PLACEMENT_PER_STAGE));
}

// --- ход теста ---
async function startPlacementStage(stage) {
  const token = placement.token;
  const root = document.getElementById("today-root");
  root.innerHTML = `<div class="catalog-loading">⏳ Этап ${stage.n}: ${escapeHtml(stage.title)}…</div>`;
  const questions = await stageQuestions(stage);
  if (!placement || placement.token !== token || document.body.dataset.screen !== "today") return;
  Object.assign(placement, { stage, questions, i: 0, misses: 0 });
  renderPlacementQuestion();
}

function renderPlacementQuestion() {
  const { stage, questions, i } = placement;
  const q = questions[i];
  const root = document.getElementById("today-root");
  root.innerHTML =
    `<div class="today-card placement">` +
    `<div class="today-head"><span>🧭 Этап ${stage.n} из ${stagesData.length} · ${stage.emoji} ${escapeHtml(stage.title)}</span></div>` +
    `<div class="today-progress">вопрос ${i + 1} из ${questions.length}</div>` +
    `<div class="pq-prompt">${q.prompt}</div>` +
    q.html +
    `<div class="pq-options">${q.options.map((o, k) => `<button type="button" class="pq-opt" data-k="${k}">${escapeHtml(o)}</button>`).join("")}</div>` +
    `<button type="button" class="secondary pq-dunno">🤷 Не знаю</button>` +
    `<button type="button" class="today-retest pq-stop">Закончить тест здесь</button>` +
    `</div>`;
  if (q.say) {
    speak(q.say);
    root.querySelector(".pq-speak").addEventListener("click", () => speak(q.say));
  }
  const buttons = [...root.querySelectorAll(".pq-opt")];
  const answer = (k) => {
    buttons.forEach((b) => (b.disabled = true));
    root.querySelector(".pq-dunno").disabled = true;
    const ok = k !== null && q.options[k] === q.correct;
    buttons.forEach((b) => q.options[+b.dataset.k] === q.correct && b.classList.add("right"));
    if (k !== null && !ok) buttons[k].classList.add("wrong");
    if (!ok) placement.misses++;
    const token = placement.token;
    setTimeout(() => placement && placement.token === token && placementNext(), ok ? 500 : 1300);
  };
  buttons.forEach((b) => b.addEventListener("click", () => answer(+b.dataset.k)));
  root.querySelector(".pq-dunno").addEventListener("click", () => answer(null));
  root.querySelector(".pq-stop").addEventListener("click", () => finishPlacement(placement.stage.n));
}

function placementNext() {
  const { stage, questions } = placement;
  if (placement.misses > PLACEMENT_MAX_MISSES) return finishPlacement(stage.n);
  placement.i++;
  if (placement.i < questions.length) return renderPlacementQuestion();
  placement.passed.push(stage.n);
  const next = stagesData.find((s) => s.n === stage.n + 1);
  if (!next) return finishPlacement(stage.n + 1);
  const root = document.getElementById("today-root");
  root.innerHTML =
    `<div class="today-card placement"><div class="pq-pass">✓ Этап ${stage.n} «${escapeHtml(stage.title)}» — знаешь!</div>` +
    `<p>Дальше — этап ${next.n}: ${next.emoji} ${escapeHtml(next.title)}.</p>` +
    `<button type="button" id="placement-next-btn">Дальше ▶</button>` +
    `<button type="button" class="secondary" id="placement-here-btn">Хватит — начать с этапа ${next.n}</button></div>`;
  document.getElementById("placement-next-btn").addEventListener("click", () => startPlacementStage(next));
  document.getElementById("placement-here-btn").addEventListener("click", () => finishPlacement(next.n));
}

// Итог: начинаем с этапа start, всё до него — в повторение.
async function finishPlacement(start) {
  placementToken++;
  placement = null;
  const root = document.getElementById("today-root");
  root.innerHTML = '<div class="catalog-loading">⏳ Раскладываем пройденное по повторениям…</div>';
  const passed = stagesData.filter((s) => s.n < start);
  await applyPlacement(passed, start);
  const last = stagesData.length;
  const startStage = stagesData.find((s) => s.n === start);
  let text;
  if (!passed.length) {
    text = `Начинаем с самой базы — этап 1 ${stagesData[0].emoji} «${escapeHtml(stagesData[0].title)}».`;
  } else {
    text =
      (start > last ? `Весь A1 ты уже знаешь ✓` : `Этапы ${passed.length > 1 ? `1–${passed.length}` : "1"} ты уже знаешь ✓ Начинаем с этапа ${start} ${startStage.emoji} «${escapeHtml(startStage.title)}».`) +
      `<br><br>Фразы и слова пройденных этапов будут попадаться на проверку ближайшие три недели: ошибёшься — вернутся в изучение. Грамматика этих этапов открыта, а «Всё вместе» каждой её темы придёт разминкой.`;
  }
  root.innerHTML =
    `<div class="today-card placement"><div class="today-head"><span>🧭 Итог теста</span></div>` +
    `<p>${text}</p><button type="button" id="placement-done-btn">К занятию ▶</button></div>`;
  document.getElementById("placement-done-btn").addEventListener("click", openToday);
}

async function applyPlacement(passed, start) {
  const today = todayStr();
  // Фразы: ещё не запомнившиеся — сразу в 🟢 с проверкой в один из ближайших дней.
  const ids = shuffle(passed.flatMap((s) => s.phrases).filter((id) => !phraseEverLearned(id)));
  ids.forEach((id, i) => {
    phraseProgress[id] = {
      box: "almost",
      dueDay: addDaysStr(today, 1 + (i % PLACEMENT_SPREAD_DAYS)),
      todayDay: today,
      hits: 0,
      reviewStage: 0,
      ever: true,
    };
  });
  // Грамматика: все ступени тем открыты; на разминку — темы, где сыграно не всё.
  const warm = [];
  passed.forEach((s) =>
    s.grammar.forEach((id) => {
      const levels = topicLevels(id);
      if (levels.some((l) => levelStars(id, l.n) === 0)) warm.push(id);
      grammarLevels[id] = grammarLevels[id] || {};
      levels.forEach((l) => (grammarLevels[id][l.n] = Math.max(1, grammarLevels[id][l.n] || 0)));
    })
  );
  saveGrammarLevels();
  // Слова: 🟢 — встретятся реже, но встретятся.
  const words = (await Promise.all(passed.map(stageWords))).flat();
  words.forEach((w) => {
    if (getWordStreak(w.tr) < PLACEMENT_WORD_STREAK) wordProgress[w.tr] = { streak: PLACEMENT_WORD_STREAK };
  });
  saveWordProgress();
  const meta = getStageMeta();
  saveStageMeta({ ...meta, placed: Math.min(start, stagesData.length + 1), at: today, warm: [...new Set([...(meta.warm || []), ...warm])] });
}
