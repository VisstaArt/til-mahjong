// Режим "Грамматика": тема = одно правило (памятка на экран + упражнения), по методике
// рабочей тетради Yeni Hitit — сначала смысл, потом форма: во фразе из наших же «Фраз»
// и «Диалогов» пропуск на месте слова, время/падеж подсказывает сама фраза и перевод.
//
// Два упражнения на пропуск:
//  • «Выбери форму» — 3 целых слова (как İşaretleyelim): для новых пропусков;
//  • «Собери слово» — тайлы-кусочки по рядам (основа / время / лицо / падеж): когда
//    пропуск уже знаком. Ошибка в ряду показывает, какое именно правило сломалось.
//
// Приложение само ничего не склоняет: все формы, кусочки, обманки и пояснения готовит
// офлайн tools/grammar/build.py (генератор tools/grammar/morph.py) в
// assets/grammar/items.json. Переиспользует speak()/muted/setScreen() из script.js,
// shuffle()/ящики Лейтнера (bumpPhraseStreak и др.) из phrases.js — со своим хранилищем.

const GRAMMAR_ITEMS_URL = "assets/grammar/items.json";
const GRAMMAR_PROGRESS_KEY = "mahjong-grammar-progress";
const GRAMMAR_RULES_KEY = "mahjong-grammar-rules";

// Сколько последних ответов помнить по каждому правилу — по ним цвет «плашки правила»
// и то, насколько чаще такие пропуски попадаются.
const RULE_HISTORY = 20;
const WEAK_RULE_BONUS = 2;
const MAX_NEW_GRAMMAR_PER_SESSION = 15;
// Повторение открывается, когда по каждой теме набрано столько ответов.
const REVIEW_UNLOCK_ANSWERS = 20;

const GRAMMAR_TOPICS = [
  {
    id: "yor",
    emoji: "⏳",
    title: "Настоящее время -yor",
    rules: [
      ["cons", "основа на согласную"],
      ["drop", "основа на -a/-e (выпадает)"],
      ["vowel", "основа на ı/i/u/ü"],
      ["soften", "t → d (gidiyor)"],
      ["irregular", "diyor / yiyor"],
      ["neg", "отрицание -mıyor"],
      ["question", "вопрос mu…"],
      ["p.ben", "ben -um"],
      ["p.sen", "sen -sun"],
      ["p.o", "o —"],
      ["p.biz", "biz -uz"],
      ["p.siz", "siz -sunuz"],
      ["p.onlar", "onlar -lar"],
    ],
    memo: `
      <h3>Şimdiki zaman — делаю сейчас / вообще</h3>
      <p class="memo-formula">основа + <b>(ı/i/u/ü)yor</b> + лицо</p>
      <table class="memo-table">
        <tr><th>последняя гласная основы</th><th>суффикс</th><th>пример</th></tr>
        <tr><td>a, ı</td><td>-ıyor</td><td>yap → yap<b>ıyor</b></td></tr>
        <tr><td>e, i</td><td>-iyor</td><td>gel → gel<b>iyor</b></td></tr>
        <tr><td>o, u</td><td>-uyor</td><td>dur → dur<b>uyor</b></td></tr>
        <tr><td>ö, ü</td><td>-üyor</td><td>gör → gör<b>üyor</b></td></tr>
      </table>
      <ul>
        <li>Основа на <b>-a/-e</b>: гласная выпадает — bekle → bekl<b>iyor</b>, ağla → ağl<b>ıyor</b>, oyna → oyn<b>uyor</b>.</li>
        <li>Основа на <b>ı/i/u/ü</b>: просто +yor — oku → oku<b>yor</b>.</li>
        <li><b>git, et</b>: t → d — <b>gid</b>iyor, <b>ed</b>iyor. Исключения: de → <b>di</b>yor, ye → <b>yi</b>yor.</li>
      </ul>
      <table class="memo-table">
        <tr><td>ben</td><td>-um</td><td>sen</td><td>-sun</td><td>o</td><td>—</td></tr>
        <tr><td>biz</td><td>-uz</td><td>siz</td><td>-sunuz</td><td>onlar</td><td>-lar</td></tr>
      </table>
      <ul>
        <li>Отрицание: <b>m</b> + узкая гласная — bil<b>mi</b>yorum, anla<b>mı</b>yorum.</li>
        <li>Вопрос: лицо уходит на частицу — çalışıyor <b>musunuz</b>?</li>
      </ul>
      <div class="memo-examples" data-examples="Türkçe öğreniyorum.|Я учу турецкий.;Ne yapıyorsun?|Что ты делаешь?;Kahve içmiyorum.|Я не пью кофе.;Nerede çalışıyorsunuz?|Где вы работаете?"></div>
    `,
  },
  {
    id: "case",
    emoji: "📍",
    title: "Где? Откуда? Куда? -de / -den / -e",
    rules: [
      ["c.loc", "где? -de"],
      ["c.abl", "откуда? -den"],
      ["c.dat", "куда? -e"],
      ["voiceless", "после глухой d → t"],
      ["buffer", "-ya/-ye после гласной"],
      ["soften", "k → ğ, p → b…"],
      ["plural", "с -ler/-lar"],
      ["proper", "имена: İstanbul'da"],
    ],
    memo: `
      <h3>Где? Откуда? Куда?</h3>
      <table class="memo-table">
        <tr><th>вопрос</th><th>суффикс</th><th>пример</th></tr>
        <tr><td>где? nerede?</td><td>-de / -da</td><td>ev<b>de</b>, okul<b>da</b></td></tr>
        <tr><td>откуда? nereden?</td><td>-den / -dan</td><td>ev<b>den</b>, okul<b>dan</b></td></tr>
        <tr><td>куда? nereye?</td><td>-e / -a</td><td>ev<b>e</b>, okul<b>a</b></td></tr>
      </table>
      <ul>
        <li>Гармония: последняя гласная <b>a, ı, o, u → a</b>; <b>e, i, ö, ü → e</b>.</li>
        <li>После глухих <b>ç f h k p s ş t</b> («fıstıkçı şahap») d → <b>t</b>: sokak<b>ta</b>, kitap<b>tan</b>.</li>
        <li>-e после гласной — со связкой <b>y</b>: masa<b>ya</b>, taksi<b>ye</b>.</li>
        <li>Перед -e конечные <b>k → ğ, p → b, ç → c, t → d</b>: soka<b>ğa</b>, kita<b>ba</b>.</li>
        <li>Имена — через апостроф: İstanbul<b>'da</b>, Ankara<b>'dan</b>, Rusya<b>'ya</b>.</li>
        <li>bura / şura / ora / nere: bura<b>da</b>, ora<b>dan</b>, nere<b>ye</b>.</li>
      </ul>
      <div class="memo-examples" data-examples="Otelde kalıyorum.|Я живу в отеле.;Moskova'dan geliyorum.|Я еду из Москвы.;Otobüse biniyoruz.|Мы садимся в автобус.;Kitap rafta.|Книга на полке."></div>
    `,
  },
];
const GRAMMAR_REVIEW = { id: "review", emoji: "🔀", title: "Повторение вперемешку" };

// Подписи рядов в «Собери слово».
const PART_LABELS = {
  stem: "основа",
  neg: "отрицание",
  tense: "время",
  person: "лицо",
  plural: "мн. число",
  case: "падеж",
};

let grammarItems = null;

// --- хранилища ---
function loadJSONKey(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}
let grammarProgress = loadJSONKey(GRAMMAR_PROGRESS_KEY, {});
function saveGrammarProgress() {
  localStorage.setItem(GRAMMAR_PROGRESS_KEY, JSON.stringify(grammarProgress));
}
let grammarRuleStats = loadJSONKey(GRAMMAR_RULES_KEY, {}); // tag → [1,0,1,…] последние ответы
function recordRule(tag, ok) {
  const hist = grammarRuleStats[tag] || [];
  hist.push(ok ? 1 : 0);
  grammarRuleStats[tag] = hist.slice(-RULE_HISTORY);
  localStorage.setItem(GRAMMAR_RULES_KEY, JSON.stringify(grammarRuleStats));
}
function ruleAccuracy(tag) {
  const hist = grammarRuleStats[tag] || [];
  if (hist.length < 3) return null;
  return hist.reduce((a, b) => a + b, 0) / hist.length;
}
function isWeakRule(tag) {
  const acc = ruleAccuracy(tag);
  return acc !== null && acc < 0.7;
}
function slotKey(item, slot) {
  return `${item.tr}::${slot.start}`;
}

async function loadGrammarItems() {
  if (grammarItems) return grammarItems;
  try {
    const resp = await fetch(GRAMMAR_ITEMS_URL);
    grammarItems = resp.ok ? await resp.json() : [];
  } catch {
    grammarItems = [];
  }
  return grammarItems;
}

function topicSlots(topicId) {
  const out = [];
  grammarItems.forEach((item) => item.slots.forEach((slot) => slot.topic === topicId && out.push({ item, slot })));
  return out;
}

// Ответов по теме в истории правил всего RULE_HISTORY, поэтому для порога
// «открыть повторение» держим отдельный неограниченный счётчик.
function bumpTopicCounter(topicId) {
  grammarRuleStats[`${topicId}.total`] = (grammarRuleStats[`${topicId}.total`] || 0) + 1;
  localStorage.setItem(GRAMMAR_RULES_KEY, JSON.stringify(grammarRuleStats));
}
function isReviewUnlocked() {
  return GRAMMAR_TOPICS.every((t) => (grammarRuleStats[`${t.id}.total`] || 0) >= REVIEW_UNLOCK_ANSWERS);
}

// --- каталог ---
async function renderGrammarCatalog() {
  const grid = document.getElementById("grammar-catalog-grid");
  const loadingEl = document.getElementById("grammar-catalog-loading");
  loadingEl.classList.remove("hidden");
  grid.innerHTML = "";
  await loadGrammarItems();
  loadingEl.classList.add("hidden");

  GRAMMAR_TOPICS.forEach((t) => {
    const slots = topicSlots(t.id);
    const mastered = slots.filter(({ item, slot }) => getPhraseBox(slotKey(item, slot), grammarProgress).id === "mastered").length;
    grid.appendChild(buildGrammarTile(t.emoji, t.title, `${mastered}/${slots.length}`, () => openGrammarTopic(t.id)));
  });

  const unlocked = isReviewUnlocked();
  const reviewTile = buildGrammarTile(
    unlocked ? GRAMMAR_REVIEW.emoji : "🔒",
    GRAMMAR_REVIEW.title,
    unlocked ? "все темы вместе" : `откроется после ${REVIEW_UNLOCK_ANSWERS} ответов в каждой теме`,
    () => unlocked && startGrammarDrill("review")
  );
  if (!unlocked) reviewTile.classList.add("not-loaded");
  grid.appendChild(reviewTile);
}

function buildGrammarTile(emoji, title, count, onClick) {
  const tile = document.createElement("div");
  tile.className = "catalog-tile";
  tile.innerHTML =
    `<span class="emoji">${emoji}</span>` +
    `<div class="tile-overlay"><span class="name">${title}</span><span class="count">${count}</span></div>`;
  tile.addEventListener("click", onClick);
  return tile;
}

// --- экран темы: памятка + плашки правил ---
let currentGrammarTopicId = null;

function fillMemo(container, topic) {
  container.innerHTML = topic.memo;
  container.querySelectorAll(".memo-examples").forEach((box) => {
    box.dataset.examples.split(";").forEach((pair) => {
      const [tr, ru] = pair.split("|");
      const row = document.createElement("button");
      row.type = "button";
      row.className = "memo-example";
      row.innerHTML = `<span class="memo-tr">🔊 ${tr}</span><span class="memo-ru">${ru}</span>`;
      row.addEventListener("click", () => speak(tr));
      box.appendChild(row);
    });
  });
}

function renderRuleChips(container, topic) {
  container.innerHTML = "";
  topic.rules.forEach(([tag, label]) => {
    const acc = ruleAccuracy(tag);
    const chip = document.createElement("span");
    chip.className = "grammar-rule";
    if (acc === null) chip.classList.add("rule-none");
    else if (acc >= 0.85) chip.classList.add("rule-good");
    else if (acc >= 0.6) chip.classList.add("rule-mid");
    else chip.classList.add("rule-weak");
    chip.textContent = acc === null ? label : `${label} · ${Math.round(acc * 100)}%`;
    container.appendChild(chip);
  });
}

async function openGrammarTopic(id) {
  currentGrammarTopicId = id;
  const topic = GRAMMAR_TOPICS.find((t) => t.id === id);
  document.getElementById("grammar-topic-title").textContent = `${topic.emoji} ${topic.title}`;
  fillMemo(document.getElementById("grammar-topic-memo"), topic);
  renderRuleChips(document.getElementById("grammar-topic-rules"), topic);
  setScreen("grammar-topic");
}

// --- очередь упражнений ---
let drillMode = null; // id темы или "review"
let drillQueue = [];
let drillAllowedNew = null;
let drillQuestion = null; // {item, slots: [...], index}

// Кандидаты: {item, slots} — в теме один пропуск своей темы, в повторении все пропуски
// фразы (не больше двух), чтобы в одной фразе встречались разные правила.
function drillCandidates() {
  if (drillMode === "review") {
    return grammarItems.map((item) => ({ item, slots: shuffle(item.slots).slice(0, 2).sort((a, b) => a.start - b.start) }));
  }
  const out = [];
  grammarItems.forEach((item) => {
    const own = item.slots.filter((s) => s.topic === drillMode);
    if (own.length) out.push({ item, slots: [own[Math.floor(Math.random() * own.length)]] });
  });
  return out;
}

function candidateKey(c) {
  return slotKey(c.item, c.slots[0]);
}

function buildDrillQueue() {
  const cands = drillCandidates();
  if (!drillAllowedNew) drillAllowedNew = new Set();
  for (const k of drillAllowedNew) if (getPhraseBox(k, grammarProgress).id !== "new") drillAllowedNew.delete(k);
  shuffle(cands.filter((c) => getPhraseBox(candidateKey(c), grammarProgress).id === "new" && !drillAllowedNew.has(candidateKey(c)))).some((c) => {
    if (drillAllowedNew.size >= MAX_NEW_GRAMMAR_PER_SESSION) return true;
    drillAllowedNew.add(candidateKey(c));
    return false;
  });

  const pool = [];
  cands.forEach((c) => {
    const key = candidateKey(c);
    const box = getPhraseBox(key, grammarProgress);
    if (box.id === "new" && !drillAllowedNew.has(key)) return;
    if (box.id === "mastered" && !isPhraseMasteredDue(key, grammarProgress)) return;
    let weight = box.id === "mastered" ? 1 : box.weight;
    // Слабые правила — чаще, на любых фразах, где они встречаются.
    if (c.slots.some((s) => s.tags.some(isWeakRule))) weight += WEAK_RULE_BONUS;
    if (drillMode === "review" && c.slots.length > 1) weight += 1;
    for (let i = 0; i < weight; i++) pool.push(c);
  });
  if (!pool.length) pool.push(...shuffle(cands).slice(0, 20));
  // Одна и та же фраза два раза подряд — скучно; раскидываем повторы.
  const shuffled = shuffle(pool);
  for (let i = 1; i < shuffled.length; i++) {
    if (candidateKey(shuffled[i]) === candidateKey(shuffled[i - 1])) {
      const j = Math.floor(Math.random() * shuffled.length);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
  return shuffled;
}

async function startGrammarDrill(mode) {
  await loadGrammarItems();
  drillMode = mode;
  drillAllowedNew = null;
  drillQueue = buildDrillQueue();
  const title = mode === "review" ? GRAMMAR_REVIEW.title : GRAMMAR_TOPICS.find((t) => t.id === mode).title;
  document.getElementById("grammar-drill-title").textContent = title;
  setScreen("grammar-drill");
  nextGrammarQuestion();
}

function updateDrillProgress() {
  const slots = drillMode === "review" ? GRAMMAR_TOPICS.flatMap((t) => topicSlots(t.id)) : topicSlots(drillMode);
  const mastered = slots.filter(({ item, slot }) => getPhraseBox(slotKey(item, slot), grammarProgress).id === "mastered").length;
  document.getElementById("grammar-drill-progress").textContent = `${mastered}/${slots.length}`;
}

function nextGrammarQuestion() {
  if (!drillQueue.length) drillQueue = buildDrillQueue();
  const c = drillQueue.pop();
  drillQuestion = { item: c.item, slots: c.slots, index: 0, done: [] };
  updateDrillProgress();
  renderSlotStep();
}

// --- отрисовка фразы с пропусками ---
function renderSentence() {
  const { item, slots, index } = drillQuestion;
  const el = document.getElementById("grammar-sentence");
  el.innerHTML = "";
  let pos = 0;
  slots.forEach((slot, i) => {
    el.appendChild(document.createTextNode(item.tr.slice(pos, slot.start)));
    const gap = document.createElement("span");
    gap.className = "grammar-gap";
    if (i < index) {
      gap.classList.add("gap-done");
      gap.textContent = slot.word;
    } else if (i === index) {
      gap.classList.add("gap-active");
      const built = drillQuestion.built;
      gap.textContent = built && built.some((t) => t !== null) ? built.map((t) => (t === null ? "…" : t)).join("") : `(${slot.lemma})`;
    } else {
      gap.textContent = `(${slot.lemma})`;
    }
    el.appendChild(gap);
    pos = slot.end;
  });
  el.appendChild(document.createTextNode(item.tr.slice(pos)));
}

function renderSlotStep() {
  const { item, slots, index } = drillQuestion;
  const slot = slots[index];
  const key = slotKey(item, slot);
  // Новое — сначала узнать форму среди трёх; знакомое — собрать самой из кусочков.
  const isNew = getPhraseBox(key, grammarProgress).id === "new";
  drillQuestion.mode = isNew ? "choose" : "build";
  drillQuestion.mistake = false;
  drillQuestion.failedRows = new Set();
  drillQuestion.built = drillQuestion.mode === "build" ? slot.parts.map((p) => (p.options.length > 1 ? null : p.text)) : null;

  document.getElementById("grammar-direction").textContent =
    drillQuestion.mode === "choose" ? "Выбери форму" : "Собери слово из кусочков";
  document.getElementById("grammar-ru").textContent = item.ru;
  document.getElementById("grammar-gloss").textContent = slot.gloss ? `${slot.lemma} — ${slot.gloss}` : "";
  document.getElementById("grammar-why").textContent = "";
  renderSentence();

  const answerEl = document.getElementById("grammar-answer");
  answerEl.innerHTML = "";
  if (drillQuestion.mode === "choose") renderChoose(answerEl, slot);
  else renderBuild(answerEl, slot);
}

function renderChoose(answerEl, slot) {
  const opts = shuffle([slot.word, ...shuffle(slot.alts.filter((a) => a !== slot.word)).slice(0, 2)]);
  const wrap = document.createElement("div");
  wrap.className = "quiz-options grammar-choose";
  opts.forEach((o) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = o;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (o === slot.word) {
        btn.classList.add("correct");
        wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
        finishSlot(slot);
      } else {
        drillQuestion.mistake = true;
        btn.classList.add("wrong");
        btn.disabled = true;
        document.getElementById("grammar-why").textContent = explainChoice(slot);
        setTimeout(() => btn.classList.remove("wrong"), 300);
      }
    });
    wrap.appendChild(btn);
  });
  answerEl.appendChild(wrap);
}

// Пояснение к ошибке в «Выбери»: всё, что определяет форму этого пропуска.
function explainChoice(slot) {
  return slot.parts.map((p) => p.why).filter(Boolean).join(" · ");
}

function tileLabel(text) {
  const t = text.trim();
  return t === "" ? "∅" : t;
}

function renderBuild(answerEl, slot) {
  slot.parts.forEach((part, rowIdx) => {
    if (part.options.length < 2) return;
    const row = document.createElement("div");
    row.className = "grammar-row";
    const label = document.createElement("span");
    label.className = "grammar-row-label";
    label.textContent = part.slot === "person" && part.text.startsWith(" ") ? "частица" : PART_LABELS[part.slot] || part.slot;
    row.appendChild(label);
    const tiles = document.createElement("div");
    tiles.className = "grammar-tiles";
    const wrong = shuffle(part.options.filter((o) => o !== part.text)).slice(0, 3);
    shuffle([part.text, ...wrong]).forEach((opt) => {
      const tile = document.createElement("button");
      tile.className = "grammar-tile";
      tile.textContent = tileLabel(opt);
      tile.addEventListener("click", () => onTileClick(slot, rowIdx, part, opt, tile, tiles));
      tiles.appendChild(tile);
    });
    row.appendChild(tiles);
    answerEl.appendChild(row);
  });
}

function onTileClick(slot, rowIdx, part, opt, tile, tilesEl) {
  if (tile.disabled || drillQuestion.built[rowIdx] !== null) return;
  if (opt === part.text) {
    tile.classList.add("correct");
    tilesEl.querySelectorAll("button").forEach((b) => (b.disabled = true));
    drillQuestion.built[rowIdx] = part.text;
    renderSentence();
    if (drillQuestion.built.every((t) => t !== null)) finishSlot(slot);
  } else {
    drillQuestion.mistake = true;
    drillQuestion.failedRows.add(rowIdx);
    tile.classList.add("wrong");
    tile.disabled = true;
    document.getElementById("grammar-why").textContent = part.why;
    setTimeout(() => tile.classList.remove("wrong"), 300);
  }
}

// Какие правила проверял ряд — чтобы ошибка в «лице» не портила статистику «гармонии».
function rowTags(slot, part) {
  const t = slot.tags;
  switch (part.slot) {
    case "person":
      return t.filter((x) => x.startsWith("p.") || x === "question");
    case "neg":
      return t.filter((x) => x === "neg");
    case "stem":
      return t.filter((x) => ["drop", "soften", "irregular"].includes(x));
    case "tense":
      return t.filter((x) => ["cons", "drop", "vowel", "irregular"].includes(x));
    case "plural":
      return t.filter((x) => x === "plural");
    case "case":
      return t.filter((x) => x.startsWith("c.") || ["voiceless", "buffer", "proper"].includes(x));
    default:
      return [];
  }
}

function recordSlotStats(slot) {
  const ok = !drillQuestion.mistake;
  recordRule(slot.topic, ok);
  bumpTopicCounter(slot.topic);
  if (drillQuestion.mode === "choose") {
    slot.tags.filter((t) => t !== slot.topic).forEach((t) => recordRule(t, ok));
    return;
  }
  const seen = new Set();
  slot.parts.forEach((part, i) => {
    if (part.options.length < 2) return;
    rowTags(slot, part).forEach((tag) => {
      if (seen.has(tag)) return;
      seen.add(tag);
      recordRule(tag, !drillQuestion.failedRows.has(i));
    });
  });
}

function finishSlot(slot) {
  recordSlotStats(slot);
  bumpPhraseStreak(slotKey(drillQuestion.item, slot), !drillQuestion.mistake, grammarProgress, saveGrammarProgress);
  drillQuestion.index++;
  if (drillQuestion.index < drillQuestion.slots.length) {
    setTimeout(renderSlotStep, 500);
    return;
  }
  drillQuestion.built = null;
  renderSentence();
  updateDrillProgress();
  setTimeout(() => showGrammarDonePopup(drillQuestion.item), 350);
}

// Та же плашка, что в квизе фраз (см. showPhraseMatchPopup) — целая фраза, озвучка,
// переход дальше сам через 4,5 сек или сразу тапом по фону.
function showGrammarDonePopup(item) {
  const popupEl = document.getElementById("match-popup");
  const card = popupEl.querySelector(".match-card");
  card.classList.add("no-icon");
  popupEl.querySelector(".match-tr").textContent = item.tr;
  popupEl.querySelector(".match-ru").textContent = item.ru;
  popupEl.classList.remove("hidden");
  clearTimeout(popupEl._hideTimer);

  let advanced = false;
  const advance = () => {
    if (advanced) return;
    advanced = true;
    popupEl.classList.add("hidden");
    card.classList.remove("no-icon");
    popupEl.removeEventListener("click", onBackgroundClick);
    if (document.body.dataset.screen === "grammar-drill") nextGrammarQuestion();
  };
  function onBackgroundClick(e) {
    if (e.target === popupEl) advance();
  }
  popupEl.addEventListener("click", onBackgroundClick);
  popupEl._hideTimer = setTimeout(advance, 4500);

  speak(item.tr);
}

function openMemoOverlay() {
  const slot = drillQuestion && drillQuestion.slots[Math.min(drillQuestion.index, drillQuestion.slots.length - 1)];
  const topicId = drillMode === "review" && slot ? slot.topic : drillMode;
  const topic = GRAMMAR_TOPICS.find((t) => t.id === topicId);
  if (!topic) return;
  fillMemo(document.getElementById("grammar-memo-overlay-body"), topic);
  document.getElementById("grammar-memo-overlay").classList.remove("hidden");
}

function initGrammarMode() {
  document.getElementById("mode-grammar-btn").addEventListener("click", () => {
    activateMode("grammar");
    renderGrammarCatalog();
    setScreen("grammar-catalog");
  });
  const backToCatalog = () => {
    renderGrammarCatalog();
    setScreen("grammar-catalog");
  };
  document.getElementById("grammar-topic-back-btn").addEventListener("click", backToCatalog);
  document.getElementById("grammar-topic-done-btn").addEventListener("click", backToCatalog);
  document.getElementById("grammar-topic-play-btn").addEventListener("click", () => startGrammarDrill(currentGrammarTopicId));
  document.getElementById("grammar-back-btn").addEventListener("click", () => {
    drillMode = null;
    const popupEl = document.getElementById("match-popup");
    clearTimeout(popupEl._hideTimer);
    popupEl.classList.add("hidden");
    backToCatalog();
  });
  document.getElementById("grammar-mute-btn").addEventListener("click", () => {
    muted = !muted;
    document.getElementById("grammar-mute-btn").textContent = muted ? "🔇" : "🔊";
    document.getElementById("mute-btn").textContent = muted ? "🔇" : "🔊";
    if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
  });
  document.getElementById("grammar-memo-btn").addEventListener("click", openMemoOverlay);
  const overlay = document.getElementById("grammar-memo-overlay");
  document.getElementById("grammar-memo-close-btn").addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });
}

initGrammarMode();
