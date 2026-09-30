// Режим "Грамматика": тема = одно правило (памятка на экран + игра), по методике
// рабочей тетради Yeni Hitit — сначала смысл, потом форма: во фразе пропуск, время/падеж
// подсказывают сама фраза и перевод.
//
// Игра «Собери из кучки»: под фразой высыпана кучка плашек в стиле маджонга — корни,
// окончания, целые слова, среди них «почти правильные» (другое лицо, другая гармония,
// другой падеж). Тапом по порядку собираешь пропуск; не та плашка вздрагивает, и внизу
// появляется подсказка правила. Сложность растёт ступенями (GRAMMAR_LEVELS): одно слово →
// два → три → вся фраза по переводу → фразы «из жизни».
//
// Игровая цель — спасти кошку Памук (кошка Лейлы, см. LEGEND.md): она застряла на
// дереве/крыше/мачте…, каждая собранная фраза — кирпич пирамиды, по которой до неё
// добраться. Ошибиться можно level.mistakes раз (на кирпичах трещины), следующая ошибка —
// пирамида взрывается, раунд заново. Спасла — открыта следующая ступень, звёзды — за
// то, сколько трещин осталось. Звуки синтезируются WebAudio (sfx), без файлов.
//
// Приложение само ничего не склоняет: все формы, кусочки, обманки и пояснения готовит
// офлайн tools/grammar/build.py (генератор tools/grammar/morph.py) в
// assets/grammar/items.json. Переиспользует speak()/muted/setScreen() из script.js и
// shuffle() из phrases.js.

const GRAMMAR_ITEMS_URL = "assets/grammar/items.json";
const GRAMMAR_LEVELS_KEY = "mahjong-grammar-levels";
const GRAMMAR_RULES_KEY = "mahjong-grammar-rules";

// Сколько последних ответов помнить по каждому правилу — по ним цвет «плашки правила»
// и то, насколько чаще такие фразы попадаются.
const RULE_HISTORY = 20;

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
        <tr><th>гласная<br>основы</th><th>суффикс</th><th>пример</th></tr>
        <tr><td>a, ı</td><td>-ıyor</td><td>yap<b>ıyor</b></td></tr>
        <tr><td>e, i</td><td>-iyor</td><td>gel<b>iyor</b></td></tr>
        <tr><td>o, u</td><td>-uyor</td><td>dur<b>uyor</b></td></tr>
        <tr><td>ö, ü</td><td>-üyor</td><td>gör<b>üyor</b></td></tr>
      </table>
      <ul>
        <li>Основа на <b>-a/-e</b>: гласная выпадает — bekle → bekl<b>iyor</b>, ağla → ağl<b>ıyor</b>, oyna → oyn<b>uyor</b>.</li>
        <li>Основа на <b>ı/i/u/ü</b>: просто +yor — oku → oku<b>yor</b>.</li>
        <li><b>git, et</b>: t → d — <b>gid</b>iyor, <b>ed</b>iyor. Исключения: de → <b>di</b>yor, ye → <b>yi</b>yor.</li>
      </ul>
      <table class="memo-table">
        <tr><th>кто</th><th>окончание</th><th>пример</th></tr>
        <tr><td>ben</td><td>-um</td><td>geliyor<b>um</b></td></tr>
        <tr><td>sen</td><td>-sun</td><td>geliyor<b>sun</b></td></tr>
        <tr><td>o</td><td>—</td><td>geliyor</td></tr>
        <tr><td>biz</td><td>-uz</td><td>geliyor<b>uz</b></td></tr>
        <tr><td>siz</td><td>-sunuz</td><td>geliyor<b>sunuz</b></td></tr>
        <tr><td>onlar</td><td>-lar</td><td>geliyor<b>lar</b></td></tr>
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
        <tr><td>где?<br>nerede?</td><td>-de<br>-da</td><td>ev<b>de</b><br>okul<b>da</b></td></tr>
        <tr><td>откуда?<br>nereden?</td><td>-den<br>-dan</td><td>ev<b>den</b><br>okul<b>dan</b></td></tr>
        <tr><td>куда?<br>nereye?</td><td>-e<br>-a</td><td>ev<b>e</b><br>okul<b>a</b></td></tr>
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

// Ступени темы — сложность растёт тем, сколько фразы собираешь сама, и высотой пирамиды.
// rows — ряды пирамиды снизу вверх (сумма = bricks, число фраз в раунде).
const GRAMMAR_LEVELS = [
  { n: 1, title: "Одно слово", hint: "собери слово с правилом", words: 1, tier: "base", pile: 12,
    bricks: 8, rows: [4, 3, 1], mistakes: 2, place: "🌳", where: "на дереве" },
  { n: 2, title: "Два слова", hint: "слово с правилом и соседнее", words: 2, tier: "base", pile: 14,
    bricks: 10, rows: [4, 3, 2, 1], mistakes: 2, place: "🏠", where: "на крыше" },
  { n: 3, title: "Три слова", hint: "почти вся фраза", words: 3, tier: "base", pile: 16,
    bricks: 10, rows: [4, 3, 2, 1], mistakes: 3, place: "⛴️", where: "на мачте парохода" },
  { n: 4, title: "Вся фраза", hint: "только перевод — собери по-турецки", words: 99, tier: "base", pile: 18,
    bricks: 12, rows: [5, 4, 2, 1], mistakes: 3, place: "🗼", where: "на Галатской башне" },
  { n: 5, title: "В жизни", hint: "фразы из «Фраз» и «Диалогов»", words: 2, tier: "life", pile: 16,
    bricks: 12, rows: [5, 4, 2, 1], mistakes: 3, place: "🎡", where: "на колесе обозрения" },
];
// Ступень открывается, когда на предыдущей Памук спасена (хоть с одной звездой).
const STARS_TO_UNLOCK = 1;

let grammarItems = null;

// --- хранилища ---
function loadJSONKey(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}
let grammarLevels = loadJSONKey(GRAMMAR_LEVELS_KEY, {}); // {topicId: {levelN: лучшие звёзды}}
function saveGrammarLevels() {
  localStorage.setItem(GRAMMAR_LEVELS_KEY, JSON.stringify(grammarLevels));
}
function levelStars(topicId, n) {
  return (grammarLevels[topicId] && grammarLevels[topicId][n]) || 0;
}
function isLevelUnlocked(topicId, n) {
  return n === 1 || levelStars(topicId, n - 1) >= STARS_TO_UNLOCK;
}
function highestUnlocked(topicId) {
  let best = 1;
  GRAMMAR_LEVELS.forEach((l) => {
    if (isLevelUnlocked(topicId, l.n)) best = l.n;
  });
  return best;
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

// Повторение вперемешку — когда в каждой теме пройдена ступень «Три слова».
function isReviewUnlocked() {
  return GRAMMAR_TOPICS.every((t) => levelStars(t.id, 3) >= STARS_TO_UNLOCK);
}

function starsText(n) {
  return "★".repeat(n) + "☆".repeat(3 - n);
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
    const top = highestUnlocked(t.id);
    grid.appendChild(buildGrammarTile(t.emoji, t.title, `ступень ${top} из ${GRAMMAR_LEVELS.length}`, () => openGrammarTopic(t.id)));
  });

  const unlocked = isReviewUnlocked();
  const reviewTile = buildGrammarTile(
    unlocked ? GRAMMAR_REVIEW.emoji : "🔒",
    GRAMMAR_REVIEW.title,
    unlocked ? "все темы вместе" : "откроется после ступени «Три слова» в каждой теме",
    () => unlocked && startGrammarRound("review", 3)
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

// --- экран темы: памятка + ступени + плашки правил ---
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

function renderTopicLevels(topic) {
  const el = document.getElementById("grammar-topic-stages");
  el.innerHTML = "";
  GRAMMAR_LEVELS.forEach((level) => {
    const unlocked = isLevelUnlocked(topic.id, level.n);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "grammar-stage" + (unlocked ? "" : " locked");
    const stars = levelStars(topic.id, level.n);
    row.innerHTML =
      `<span class="stage-n">${unlocked ? level.n : "🔒"}</span>` +
      `<span class="stage-text"><b>${level.place} ${level.title}</b><small>${unlocked ? `${level.hint} · Памук ${level.where}` : `откроется, когда спасёшь Памук на ступени ${level.n - 1}`}</small></span>` +
      `<span class="stage-stars">${unlocked ? starsText(stars) : ""}</span>`;
    if (unlocked) row.addEventListener("click", () => startGrammarRound(topic.id, level.n));
    el.appendChild(row);
  });
}

async function openGrammarTopic(id) {
  currentGrammarTopicId = id;
  await loadGrammarItems();
  const topic = GRAMMAR_TOPICS.find((t) => t.id === id);
  document.getElementById("grammar-topic-title").textContent = `${topic.emoji} ${topic.title}`;
  fillMemo(document.getElementById("grammar-topic-memo"), topic);
  renderRuleChips(document.getElementById("grammar-topic-rules"), topic);
  renderTopicLevels(topic);
  setScreen("grammar-topic");
}

// --- фраза → «единицы» (слова) и кусочки для кучки ---
const TOKEN_RE = /[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû']+/g;

// Слово с правилом (пропуск из items.json) разбивается на свои кусочки: основа, время,
// лицо…; обычное слово — одна плашка целиком. Слово с правилом ДРУГОЙ темы в теме тоже
// приходит целиком — его ещё не учили (в повторении вперемешку разбиваются все).
// Пустых кусочков (у «o» нет окончания) в кучке нет — слово просто заканчивается.
function sentenceUnits(item, topicId) {
  const units = [];
  const slotAt = new Map(item.slots.map((s) => [s.start, s]));
  let m;
  TOKEN_RE.lastIndex = 0;
  let skipUntil = -1;
  while ((m = TOKEN_RE.exec(item.tr))) {
    if (m.index < skipUntil) continue;
    const slot = slotAt.get(m.index);
    if (slot) {
      const split = topicId === "review" || slot.topic === topicId;
      units.push({
        start: slot.start,
        end: slot.end,
        slot: split ? slot : null,
        lemma: slot.lemma,
        pieces: split
          ? slot.parts.filter((p) => p.text.trim()).map((p) => ({ text: p.text.trim(), space: p.text.startsWith(" "), part: p }))
          : [{ text: item.tr.slice(slot.start, slot.end), space: false, part: null }],
      });
      skipUntil = slot.end;
    } else {
      units.push({ start: m.index, end: m.index + m[0].length, slot: null, pieces: [{ text: m[0], space: false, part: null }] });
    }
  }
  return units;
}

// Какие слова фразы превращаются в пропуски: слово с правилом темы + соседи слева
// (в турецком глагол в конце — соседи обычно перед ним).
function chooseGapUnits(units, topicId, words) {
  let center = units.findIndex((u) => u.slot && (topicId === "review" || u.slot.topic === topicId));
  if (center < 0) center = units.length - 1;
  if (words >= units.length) return units.map((_, i) => i);
  let from = center;
  let to = center;
  while (to - from + 1 < words) {
    if (from > 0) from--;
    else if (to < units.length - 1) to++;
    else break;
  }
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

// Обычные слова для кучки-обманки: из других фраз той же темы.
function randomWords(n, exclude) {
  const pool = [];
  for (let i = 0; i < 40 && pool.length < n * 3; i++) {
    const it = grammarItems[Math.floor(Math.random() * grammarItems.length)];
    (it.tr.match(TOKEN_RE) || []).forEach((w) => {
      if (!exclude.has(w) && !exclude.has(w.toLowerCase()) && w.length > 1) pool.push(w);
    });
  }
  return shuffle([...new Set(pool)]).slice(0, n);
}

function buildPile(units, gapIdx, pileSize) {
  const needed = [];
  gapIdx.forEach((i) => units[i].pieces.forEach((p) => needed.push(p.text)));
  const neededSet = new Set(needed);
  const distractors = [];
  // Сначала — «почти правильные» кусочки: другие лица, гармония, падежи. На них и учимся.
  gapIdx.forEach((i) => {
    units[i].pieces.forEach((p) => {
      if (!p.part) return;
      shuffle(p.part.options.map((o) => o.trim()).filter((o) => o && !neededSet.has(o))).slice(0, 3).forEach((o) => distractors.push(o));
    });
  });
  const uniqueDistr = [...new Set(distractors)];
  const fill = Math.max(0, pileSize - needed.length - uniqueDistr.length);
  const extra = randomWords(fill, new Set([...neededSet, ...uniqueDistr]));
  return shuffle([...needed, ...uniqueDistr.slice(0, Math.max(0, pileSize - needed.length)), ...extra]);
}

// --- звуки: синтез WebAudio, без файлов ---
let sfxCtx = null;
function sfx(kind) {
  if (muted) return;
  try {
    sfxCtx = sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  const ctx = sfxCtx;
  const t0 = ctx.currentTime;
  const tone = (freq, start, dur, type = "sine", vol = 0.2, freqEnd = null) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0 + start);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + start + dur);
    gain.gain.setValueAtTime(vol, t0 + start);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.05);
  };
  const noise = (dur, vol, filterType, fStart, fEnd) => {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(fStart, t0);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  };
  if (kind === "tap") tone(700, 0, 0.07, "triangle", 0.12);
  else if (kind === "brick") {
    tone(160, 0, 0.18, "sine", 0.35, 60);
    noise(0.12, 0.15, "lowpass", 900, 200);
  } else if (kind === "crack") {
    noise(0.18, 0.35, "highpass", 2500, 900);
    tone(220, 0, 0.12, "square", 0.05, 110);
  } else if (kind === "boom") {
    noise(1.4, 0.8, "lowpass", 1200, 40);
    tone(90, 0, 1.0, "sine", 0.6, 30);
  } else if (kind === "win") {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.25, "triangle", 0.18));
  }
}

// --- раунд ---
let round = null; // {topicId, level, queue, index, mistakes, over, current}

function roundCandidates(topicId, level) {
  return grammarItems.filter((item) => {
    if (item.tier !== level.tier) return false;
    const hasTopic = item.slots.some((s) => topicId === "review" || s.topic === topicId);
    if (!hasTopic) return false;
    // «Вся фраза» — только короткие фразы, иначе кучка превращается в свалку.
    if (level.words >= 99 && (item.tr.match(TOKEN_RE) || []).length > 5) return false;
    return true;
  });
}

// Раунд = столько фраз, сколько кирпичей в пирамиде; «слабые» правила попадаются чаще.
function buildRoundQueue(topicId, level) {
  const cands = roundCandidates(topicId, level);
  const weighted = [];
  cands.forEach((item) => {
    const weak = item.slots.some((s) => s.tags.some(isWeakRule));
    weighted.push(item);
    if (weak) weighted.push(item, item);
  });
  const out = [];
  const seen = new Set();
  for (const item of shuffle(weighted)) {
    if (seen.has(item.tr)) continue;
    seen.add(item.tr);
    out.push(item);
    if (out.length >= level.bricks) break;
  }
  return out;
}

async function startGrammarRound(topicId, levelN) {
  await loadGrammarItems();
  const level = GRAMMAR_LEVELS.find((l) => l.n === levelN);
  round = { topicId, level, queue: buildRoundQueue(topicId, level), index: 0, mistakes: 0, clean: 0, over: false };
  const title = topicId === "review" ? GRAMMAR_REVIEW.title : GRAMMAR_TOPICS.find((t) => t.id === topicId).title;
  document.getElementById("grammar-drill-title").textContent = title;
  document.getElementById("grammar-drill-progress").textContent = `${level.n}. ${level.title}`;
  document.getElementById("grammar-round-end").classList.add("hidden");
  setScreen("grammar-drill");
  if (!round.queue.length) {
    document.getElementById("grammar-ru").textContent = "Для этой ступени пока нет фраз.";
    return;
  }
  buildScene();
  document.getElementById("grammar-direction").textContent =
    `Памук застряла ${level.where}! Собери ${round.queue.length} фраз — построй пирамиду. Ошибиться можно ${level.mistakes} раза.`;
  startSentence(true);
}

// --- сцена: пирамида, кошка, трещины ---
function buildScene() {
  const { level, queue } = round;
  const pyramid = document.getElementById("scene-pyramid");
  pyramid.innerHTML = "";
  pyramid.className = "scene-pyramid";
  // Ряды снизу вверх; если фраз меньше, чем кирпичей, срезаем сверху.
  let left = queue.length;
  const rows = level.rows.map((w) => {
    const take = Math.min(w, left);
    left -= take;
    return take;
  }).filter(Boolean);
  round.bricks = [];
  rows.forEach((w) => {
    const row = document.createElement("div");
    row.className = "pyramid-row";
    for (let i = 0; i < w; i++) {
      const brick = document.createElement("span");
      brick.className = "brick";
      row.appendChild(brick);
      round.bricks.push(brick);
    }
    pyramid.appendChild(row);
  });
  document.getElementById("scene-place").textContent = level.place;
  const cat = document.getElementById("scene-cat");
  cat.textContent = "🐱";
  cat.className = "scene-cat";
  cat.style.transform = "";
  document.getElementById("scene-boom").classList.add("hidden");
  document.getElementById("grammar-scene").classList.remove("shake", "blown");
  updateSceneStatus();
}

function updateSceneStatus() {
  const built = round.index;
  document.getElementById("scene-bricks").textContent = `🧱 ${built}/${round.queue.length}`;
  const left = round.level.mistakes - round.mistakes;
  document.getElementById("scene-cracks").textContent =
    left > 0 ? `можно ошибиться: ${"⚠️".repeat(left)}` : "ещё одна ошибка — и всё рухнет!";
  document.getElementById("scene-cracks").classList.toggle("danger", left <= 0);
}

function shakeScene() {
  const scene = document.getElementById("grammar-scene");
  scene.classList.remove("shake");
  void scene.offsetWidth;
  scene.classList.add("shake");
}

function startSentence(first = false) {
  const item = round.queue[round.index];
  const units = sentenceUnits(item, round.topicId);
  const gapIdx = chooseGapUnits(units, round.topicId, round.level.words);
  const expected = [];
  gapIdx.forEach((ui) => units[ui].pieces.forEach((p, pi) => expected.push({ ui, pi, ...p })));
  round.current = { item, units, gapIdx: new Set(gapIdx), expected, pos: 0, mistake: false, failedParts: new Set(), filled: new Map() };

  if (!first) {
    const whole = gapIdx.length === units.length;
    document.getElementById("grammar-direction").textContent = whole ? "Собери фразу по-турецки" : "Собери пропуск из кучки";
  }
  document.getElementById("grammar-ru").textContent = item.ru;
  document.getElementById("grammar-why").textContent = "";
  renderGapSentence();
  renderPileTiles(buildPile(units, gapIdx, round.level.pile));
}

// Фраза: пропуски по словам; в каждом — уже найденные кусочки, у слова с правилом до
// начала сборки — подсказка-инфинитив (кроме «Вся фраза»: там только перевод).
function renderGapSentence() {
  const { item, units, gapIdx, filled, expected, pos } = round.current;
  const el = document.getElementById("grammar-sentence");
  el.innerHTML = "";
  const activeUi = pos < expected.length ? expected[pos].ui : -1;
  const whole = gapIdx.size === units.length;
  let cursor = 0;
  units.forEach((u, ui) => {
    el.appendChild(document.createTextNode(whole ? " " : item.tr.slice(cursor, u.start)));
    cursor = u.end;
    if (!gapIdx.has(ui)) {
      el.appendChild(document.createTextNode(item.tr.slice(u.start, u.end)));
      return;
    }
    const gap = document.createElement("span");
    gap.className = "grammar-gap";
    const got = filled.get(ui) || [];
    if (got.length === u.pieces.length) gap.classList.add("gap-done");
    else if (ui === activeUi) gap.classList.add("gap-active");
    if (got.length) {
      gap.textContent = got.map((p) => (p.space ? " " : "") + p.text).join("");
    } else {
      gap.textContent = u.lemma && !whole && round.level.tier === "base" ? `(${u.lemma})` : "…";
    }
    el.appendChild(gap);
  });
  if (!whole) el.appendChild(document.createTextNode(item.tr.slice(cursor)));
}

// Кучка: плашки в стиле маджонга, вразброс, чуть повёрнуты — как высыпали на стол.
function renderPileTiles(texts) {
  const pile = document.getElementById("grammar-answer");
  pile.innerHTML = "";
  pile.className = "grammar-pile";
  texts.forEach((text) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pile-tile";
    tile.textContent = text;
    tile.style.setProperty("--rot", `${(Math.random() * 12 - 6).toFixed(1)}deg`);
    tile.style.setProperty("--dx", `${Math.round(Math.random() * 10 - 5)}px`);
    tile.style.setProperty("--dy", `${Math.round(Math.random() * 10 - 5)}px`);
    tile.addEventListener("click", () => onPileTile(tile, text));
    pile.appendChild(tile);
  });
}

function onPileTile(tile, text) {
  const cur = round && round.current;
  if (!cur || round.over || cur.pos >= cur.expected.length || tile.classList.contains("taken")) return;
  const want = cur.expected[cur.pos];
  if (text === want.text) {
    sfx("tap");
    tile.classList.add("taken");
    const list = cur.filled.get(want.ui) || [];
    list.push(want);
    cur.filled.set(want.ui, list);
    cur.pos++;
    renderGapSentence();
    if (cur.pos >= cur.expected.length) finishSentence();
    return;
  }
  cur.mistake = true;
  if (want.part) cur.failedParts.add(want.part);
  tile.classList.remove("wrong");
  void tile.offsetWidth; // перезапуск анимации «не подходит»
  tile.classList.add("wrong");
  document.getElementById("grammar-why").textContent = want.part && want.part.why ? want.part.why : `Нужно слово: «${want.text[0]}…»`;
  onMistake();
}

// Ошибка: трещина на одном из уже построенных кирпичей (или дрожит земля, пока кирпичей
// нет). Сверх лимита — пирамида взрывается.
function onMistake() {
  round.mistakes++;
  if (round.mistakes > round.level.mistakes) {
    blowUp();
    return;
  }
  sfx("crack");
  shakeScene();
  const built = round.bricks.slice(0, round.index).filter((b) => !b.classList.contains("cracked"));
  if (built.length) built[Math.floor(Math.random() * built.length)].classList.add("cracked");
  updateSceneStatus();
}

function blowUp() {
  round.over = true;
  sfx("boom");
  const scene = document.getElementById("grammar-scene");
  scene.classList.add("blown");
  shakeScene();
  round.bricks.forEach((b) => {
    b.style.setProperty("--tx", `${Math.round(Math.random() * 240 - 120)}px`);
    b.style.setProperty("--ty", `${Math.round(-Math.random() * 160 - 20)}px`);
    b.style.setProperty("--tr", `${Math.round(Math.random() * 720 - 360)}deg`);
  });
  document.getElementById("scene-boom").classList.remove("hidden");
  document.getElementById("scene-cat").textContent = "🙀";
  document.querySelectorAll(".pile-tile").forEach((t) => (t.disabled = true));
  setTimeout(() => showRoundResult(false), 1300);
}

// Какие правила проверял кусочек — чтобы ошибка в «лице» не портила статистику «гармонии».
function partTags(slot, part) {
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

function recordSentenceStats() {
  const cur = round.current;
  cur.gapIdx.forEach((ui) => {
    const slot = cur.units[ui].slot;
    if (!slot) return;
    recordRule(slot.topic, !slot.parts.some((p) => cur.failedParts.has(p)));
    const seen = new Set();
    slot.parts.forEach((part) => {
      partTags(slot, part).forEach((tag) => {
        if (seen.has(tag)) return;
        seen.add(tag);
        recordRule(tag, !cur.failedParts.has(part));
      });
    });
  });
}

// Фраза собрана — кирпич ложится в пирамиду.
function finishSentence() {
  recordSentenceStats();
  if (!round.current.mistake) round.clean++;
  const brick = round.bricks[round.index];
  if (brick) brick.classList.add("placed");
  round.index++;
  sfx("brick");
  updateSceneStatus();
  const item = round.current.item;
  setTimeout(() => showGrammarDonePopup(item), 350);
}

// Та же плашка, что в квизе фраз (см. showPhraseMatchPopup) — целая фраза, озвучка,
// переход дальше сам через 2,5 сек или сразу тапом по фону.
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
    if (document.body.dataset.screen !== "grammar-drill" || !round) return;
    if (round.index >= round.queue.length) rescueCat();
    else startSentence();
  };
  function onBackgroundClick(e) {
    if (e.target === popupEl) advance();
  }
  popupEl.addEventListener("click", onBackgroundClick);
  popupEl._hideTimer = setTimeout(advance, 2500);

  speak(item.tr);
}

// Пирамида достроена — Памук спрыгивает на вершину.
function rescueCat() {
  round.over = true;
  sfx("win");
  const cat = document.getElementById("scene-cat");
  cat.textContent = "😻";
  cat.classList.add("rescued");
  // Прыжок ровно на верхний кирпич — ширина сцены на разных телефонах разная.
  const top = round.bricks[round.bricks.length - 1];
  if (top) {
    const c = cat.getBoundingClientRect();
    const t = top.getBoundingClientRect();
    const dx = t.left + t.width / 2 - (c.left + c.width / 2);
    const dy = t.top - c.bottom + 4;
    cat.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(1.3)`;
  }
  setTimeout(() => showRoundResult(true), 1100);
}

// Итог раунда. Спасла — звёзды по оставшимся трещинам, лучшая оценка запоминается,
// открывается следующая ступень. Взорвалась — «Начать заново».
function showRoundResult(saved) {
  const { topicId, level } = round;
  const next = GRAMMAR_LEVELS.find((l) => l.n === level.n + 1);
  let stars = 0;
  let unlockedNow = false;
  if (saved) {
    stars = round.mistakes === 0 ? 3 : round.mistakes <= level.mistakes / 2 ? 2 : 1;
    if (topicId !== "review") {
      const before = isLevelUnlocked(topicId, level.n + 1);
      grammarLevels[topicId] = grammarLevels[topicId] || {};
      grammarLevels[topicId][level.n] = Math.max(levelStars(topicId, level.n), stars);
      saveGrammarLevels();
      unlockedNow = !before && level.n < GRAMMAR_LEVELS.length && isLevelUnlocked(topicId, level.n + 1);
    }
  }
  document.getElementById("grammar-round-title").textContent = saved ? "🐱 Памук спасена!" : "💥 Пирамида рухнула!";
  document.getElementById("grammar-round-stars").textContent = saved ? starsText(stars) : "🙀";
  document.getElementById("grammar-round-text").textContent = saved
    ? `Ошибок: ${round.mistakes}.` + (unlockedNow && next ? ` Открыта ступень «${next.title}» — Памук теперь ${next.where}!` : "")
    : `Памук всё ещё ${level.where}. Собрано ${round.index} из ${round.queue.length}. Попробуй ещё раз!`;
  const nextBtn = document.getElementById("grammar-round-next-btn");
  const canNext = saved && topicId !== "review" && next && isLevelUnlocked(topicId, next.n);
  nextBtn.classList.toggle("hidden", !canNext);
  nextBtn.onclick = () => canNext && startGrammarRound(topicId, next.n);
  const againBtn = document.getElementById("grammar-round-again-btn");
  againBtn.textContent = saved ? "Ещё раунд" : "Начать заново";
  againBtn.classList.toggle("secondary", saved);
  againBtn.onclick = () => startGrammarRound(topicId, level.n);
  document.getElementById("grammar-round-end").classList.remove("hidden");
}

function openMemoOverlay() {
  const cur = round && round.current;
  let topicId = round && round.topicId;
  if (topicId === "review" && cur) {
    const slotUnit = [...cur.gapIdx].map((i) => cur.units[i]).find((u) => u.slot);
    topicId = slotUnit ? slotUnit.slot.topic : GRAMMAR_TOPICS[0].id;
  }
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
  const leaveDrill = () => {
    const popupEl = document.getElementById("match-popup");
    clearTimeout(popupEl._hideTimer);
    popupEl.classList.add("hidden");
    document.getElementById("grammar-round-end").classList.add("hidden");
    const topicId = round && round.topicId;
    round = null;
    if (topicId && topicId !== "review") openGrammarTopic(topicId);
    else backToCatalog();
  };
  document.getElementById("grammar-topic-back-btn").addEventListener("click", backToCatalog);
  document.getElementById("grammar-topic-done-btn").addEventListener("click", backToCatalog);
  document.getElementById("grammar-topic-play-btn").addEventListener("click", () =>
    startGrammarRound(currentGrammarTopicId, highestUnlocked(currentGrammarTopicId))
  );
  document.getElementById("grammar-back-btn").addEventListener("click", leaveDrill);
  document.getElementById("grammar-round-exit-btn").addEventListener("click", leaveDrill);
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
