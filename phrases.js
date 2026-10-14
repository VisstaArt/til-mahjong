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
// Переход между ящиками разнесён по дням (система Лейтнера, см. bumpPhraseStreak).
const PHRASE_BOXES = [
  { id: "new", label: "в работе", emoji: "🔴" },
  { id: "learning", label: "запомнилась", emoji: "🟡" },
  { id: "almost", label: "почти выучена", emoji: "🟢" },
  { id: "mastered", label: "выучена", emoji: "⭐" },
];

// «В работе» одновременно столько начатых фраз; запомнилась одна — её место тут же
// занимает следующая по пути. Так фразы «кружатся», а новые всё время добавляются.
const PHRASE_WORKING_SET = 20;

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

// Как фраза учится:
// 🔴 «в работе» — NEW_HITS_TO_LEARN верных ответов (не обязательно подряд и не обязательно
//    за один день) → 🟡 «запомнилась», повтор завтра;
// 🟡 → 🟢 — вспомнила на следующий день (один верный ответ), повтор через 3 дня;
// 🟢 → ⭐ — вспомнила через 3 дня; дальше контрольные проверки через неделю, месяц,
//    3 месяца, полгода. Десять верных ответов за один вечер не значат, что фраза
//    запомнилась надолго, — поэтому ⭐ нельзя получить за один день.
// Пока срок повтора не подошёл, фраза в рейсы не попадает — место отдаётся новым.
// Ошибка: у фразы «в работе» минус один верный ответ; запомнившаяся — снова в работу.
const NEW_HITS_TO_LEARN = 3;
const PHRASE_BOX_INTERVAL_DAYS = { learning: 1, almost: 3 };
const MASTERED_REVIEW_INTERVALS_DAYS = [7, 30, 90, 180];

// Верные ответы фразы «в работе» (todayCorrect — поле старых записей).
function phraseHits(id, store = phraseProgress) {
  const p = store[id];
  if (!p || (p.box || "new") !== "new") return 0;
  return p.hits ?? p.todayCorrect ?? 0;
}
// Хоть раз дошла до 🟡 — для карты пути: пароход не плывёт назад, если фраза
// потом забылась и вернулась в работу.
function phraseEverLearned(id, store = phraseProgress) {
  const p = store[id];
  return !!p && (!!p.ever || (p.box || "new") !== "new");
}
// Подошёл ли срок повтора у запомнившейся / выученной фразы.
function isPhraseDue(id, store = phraseProgress) {
  const p = store[id];
  if (!p || (p.box || "new") === "new") return false;
  return !p.dueDay || todayStr() >= p.dueDay;
}

// Возвращает, что случилось, — для плашки после ответа: hit (ещё в работе), learned (🟡),
// almost (🟢), mastered (⭐), kept (⭐ подтверждена), practice (срок не подошёл — без
// счёта), miss (минус верный ответ), back (забылась — снова в работе).
function bumpPhraseStreak(id, correct, store = phraseProgress, save = savePhraseProgress) {
  const today = todayStr();
  const prev = store[id];
  const box = (prev && prev.box) || "new";
  const ever = phraseEverLearned(id, store);
  const write = (fields) => {
    store[id] = { box: "new", dueDay: null, todayDay: today, hits: 0, reviewStage: 0, ever, ...fields };
    save();
  };

  if (!correct) {
    if (box === "new") {
      const hits = Math.max(0, phraseHits(id, store) - 1);
      write({ hits });
      return { kind: "miss", hits };
    }
    write({});
    return { kind: "back" };
  }

  if (box === "new") {
    const hits = phraseHits(id, store) + 1;
    if (hits >= NEW_HITS_TO_LEARN) {
      write({ box: "learning", dueDay: addDaysStr(today, PHRASE_BOX_INTERVAL_DAYS.learning), ever: true });
      return { kind: "learned" };
    }
    write({ hits });
    return { kind: "hit", hits };
  }

  if (!isPhraseDue(id, store)) return { kind: "practice", dueDay: prev.dueDay };
  if (box === "learning") {
    write({ box: "almost", dueDay: addDaysStr(today, PHRASE_BOX_INTERVAL_DAYS.almost), ever: true });
    return { kind: "almost", days: PHRASE_BOX_INTERVAL_DAYS.almost };
  }
  const stage = box === "almost" ? 0 : Math.min((prev.reviewStage || 0) + 1, MASTERED_REVIEW_INTERVALS_DAYS.length - 1);
  write({ box: "mastered", dueDay: addDaysStr(today, MASTERED_REVIEW_INTERVALS_DAYS[stage]), reviewStage: stage, ever: true });
  return { kind: box === "almost" ? "mastered" : "kept", days: MASTERED_REVIEW_INTERVALS_DAYS[stage] };
}

// Ручная пометка "уже знаю эту фразу" — сразу переводит в ящик "выучено", как markWordKnown,
// но тоже ставится на контрольную проверку через неделю, а не выпадает из ротации навсегда.
function markPhraseKnown(id) {
  const today = todayStr();
  phraseProgress[id] = {
    box: "mastered",
    dueDay: addDaysStr(today, MASTERED_REVIEW_INTERVALS_DAYS[0]),
    todayDay: today,
    hits: 0,
    reviewStage: 0,
    ever: true,
  };
  savePhraseProgress();
}

// «завтра», «через 3 дня», «через месяц»… — для плашек и списка темы.
function inDaysText(days) {
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === 30) return "через месяц";
  if (days === 90) return "через 3 месяца";
  if (days === 180) return "через полгода";
  if (days === 7) return "через неделю";
  return `через ${days} ${ferryPlural(days, "день", "дня", "дней")}`;
}
function daysUntil(dayStr) {
  const [y, m, d] = dayStr.split("-").map(Number);
  const [ty, tm, td] = todayStr().split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
}

// --- Карта пути: уровень = маршрут по Стамбулу, причал = ~15 фраз подряд ---
// Фразы уровня идут по темам в порядке пути (levels.json) и внутри темы — по порядку
// файла; рейсы вводят новые фразы в этом же порядке, поэтому пароход на карте плывёт
// от причала к причалу. Причал пройден, когда каждая его фраза хоть раз запомнилась (🟡).
const JOURNEY_STOP_SIZE = 15;
const JOURNEY_LEVEL_KEY = "mahjong-phrase-journey";
let journeyLevel = localStorage.getItem(JOURNEY_LEVEL_KEY) || "A1";
// A1 — Кадыкёй и старый город, A2 — Босфор, B1 — Золотой Рог и острова, B2 — деловой Стамбул.
const JOURNEY_ROUTES = {
  A1: [
    "Kadıköy ⚓", "Moda 🌳", "Yeldeğirmeni 🎨", "Haydarpaşa 🚉", "Harem 🚌", "Salacak 🌅", "Kız Kulesi 🏝️",
    "Üsküdar 🕌", "Kuzguncuk 🏘️", "Karaköy ☕", "Galata Kulesi 🏰", "Tünel 🚃", "İstiklal 🚋", "Taksim 🏙️",
    "Cihangir 🐈", "Tophane 🫖", "Kabataş ⛴️", "Dolmabahçe 👑", "Beşiktaş ⚽", "Ortaköy 🥔", "Eminönü 🐟",
    "Sirkeci 🚆", "Mısır Çarşısı 🌶️", "Süleymaniye 🕌", "Kapalıçarşı 🛍️", "Beyazıt 🎓", "Sultanahmet 🏛️",
    "Ayasofya 🕌", "Topkapı 👑", "Yerebatan 💧", "Gülhane 🌷", "Kumkapı 🦐", "Samatya 🏘️", "Yedikule 🏰",
    "Balat 🎨", "Fener ⛪", "Ayvansaray 🧱", "Eyüp 🕌", "Pierre Loti 🌄", "Hasköy ⚓", "Kasımpaşa ⚓", "Şişhane 🎭",
  ],
  A2: [
    "Beylerbeyi 🏛️", "Çengelköy 🥒", "Kuleli 🏫", "Vaniköy 🏡", "Kandilli 🔭", "Göksu 🛶", "Küçüksu 🏰",
    "Anadolu Hisarı 🏰", "Kanlıca 🥣", "Çubuklu 🌲", "Paşabahçe 🥃", "Beykoz 🌳", "Anadolu Kavağı ⛰️",
    "Rumeli Kavağı 🎣", "Sarıyer 🥐", "Büyükdere ⛵", "Kireçburnu 🎣", "Tarabya ⛵", "Yeniköy 🏡", "İstinye ⚓", "Emirgan 🌷", "Rumeli Hisarı 🏰",
    "Bebek 🌊", "Arnavutköy 🏘️", "Kuruçeşme 🎶", "Çırağan 🏨", "Yıldız Parkı 🌳", "Nişantaşı 👜", "Maçka 🌲",
    "Harbiye 🎼", "Şişli 🏢", "Mecidiyeköy 🚇", "Levent 🏙️", "Etiler 🍽️", "Ulus 🌇", "Hisarüstü 🎓",
    "Fenerbahçe 🏟️", "Kalamış ⛵", "Caddebostan 🏖️", "Bağdat Caddesi 🛒", "Suadiye 🌊", "Bostancı ⛴️",
    "Erenköy 🏡", "Göztepe 🌳", "Kozyatağı 🏢", "Ataşehir 🏙️", "Acıbadem 🏥", "Altunizade 🌉", "Çamlıca ⛰️",
    "Boğaziçi Köprüsü 🌉",
  ],
  B1: [
    "Bakırköy 🛍️", "Yeşilköy ✈️", "Florya 🏖️", "Kınalıada 🏝️", "Burgazada 🏝️", "Heybeliada 🌲", "Büyükada 🚲",
    "Sedef Adası 🐚", "Maltepe 🎡", "Kartal ⛴️", "Pendik 🚤", "Tuzla ⚓", "Şile 🗼", "Ağva 🛶", "Polonezköy 🌲",
  ],
  B2: [
    "Maslak 🏢", "Zincirlikuyu 🛣️", "Esentepe 🏢", "Gayrettepe 🏦", "Fulya 🏙️", "Kağıthane 🏭", "Vadistanbul 🏬",
    "Göktürk 🏡", "Belgrad Ormanı 🌳", "Kilyos 🏖️", "Rumelifeneri 🗼", "Garipçe 🎣", "Poyrazköy ⚓", "Riva 🏖️",
    "Kumburgaz 🏖️", "Büyükçekmece 🌉", "Çatalca 🍒", "Silivri 🧀", "Kemerburgaz 🌲", "Eyüp Sultan 🕌",
    "Ortaköy Camii 🕌", "Rüstem Paşa 🕌", "Mihrimah Sultan 🕌",
  ],
};

function orderIndex(topicId) {
  const i = phraseLevels ? phraseLevels.order.indexOf(topicId) : -1;
  return i < 0 ? 999 : i;
}
// Темы, где есть фразы ровно этого уровня, — в порядке пути.
function levelTopicIds(level) {
  if (!phraseLevels) return [];
  return phraseLevels.order.filter((tid) => Object.values(phraseLevels.phrases[tid] || {}).includes(level));
}

// Причалы маршрута: каждая тема режется на равные куски примерно по JOURNEY_STOP_SIZE фраз.
// routeLevel — чьи названия мест брать; без него (рейс по одной теме) — «Причал 1, 2…».
function journeyStops(topicIds, level, exact, routeLevel = null) {
  const stops = [];
  [...topicIds].sort((a, b) => orderIndex(a) - orderIndex(b)).forEach((tid) => {
    const map = (phraseLevels && phraseLevels.phrases[tid]) || {};
    const ids = Object.keys(map)
      .filter((tr) => (exact ? map[tr] === level : levelAtMost(map[tr], level)))
      .map((tr) => `${tid}::${tr}`)
      .filter((id) => !excludedPhrases.has(id));
    if (!ids.length) return;
    const k = Math.max(1, Math.round(ids.length / JOURNEY_STOP_SIZE));
    for (let i = 0; i < k; i++) {
      const from = Math.round((i * ids.length) / k);
      const to = Math.round(((i + 1) * ids.length) / k);
      stops.push({ topicId: tid, ids: ids.slice(from, to) });
    }
  });
  const route = (routeLevel && JOURNEY_ROUTES[routeLevel]) || [];
  stops.forEach((s, i) => {
    if (route.length) {
      const place = route[i % route.length];
      const cut = place.lastIndexOf(" ");
      s.name = place.slice(0, cut) + (i >= route.length ? ` ${Math.floor(i / route.length) + 1}` : "");
      s.emoji = place.slice(cut + 1);
    } else {
      s.name = `Причал ${i + 1}`;
      s.emoji = "⚓";
    }
  });
  return stops;
}

// Сколько ответов осталось фразе до ⭐, если отвечать верно: 3 в работе + завтра + через 3 дня.
function answersToMaster(id) {
  const box = getPhraseBoxId(id);
  if (box === "mastered") return 0;
  if (box === "almost") return 1;
  if (box === "learning") return 2;
  return NEW_HITS_TO_LEARN - phraseHits(id) + 2;
}

// Состояние маршрута: где пароход, сколько запомнилось / выучено, сколько рейсов осталось.
function journeyState(stops) {
  const st = { stops, total: 0, learned: 0, mastered: 0, answersLeft: 0, current: -1 };
  stops.forEach((s, i) => {
    s.ever = 0;
    s.learned = 0;
    s.mastered = 0;
    s.back = 0;
    s.hitsLeft = 0;
    s.ids.forEach((id) => {
      const box = getPhraseBoxId(id);
      const ever = phraseEverLearned(id);
      if (ever) s.ever++;
      if (box !== "new") s.learned++;
      if (box === "mastered") s.mastered++;
      if (box === "new" && ever) s.back++;
      if (!ever) s.hitsLeft += NEW_HITS_TO_LEARN - phraseHits(id);
      st.answersLeft += answersToMaster(id);
    });
    st.total += s.ids.length;
    st.learned += s.learned;
    st.mastered += s.mastered;
    s.passed = s.ever === s.ids.length;
    s.gold = s.mastered === s.ids.length;
    if (st.current < 0 && !s.passed) st.current = i;
  });
  st.rounds = Math.ceil(st.answersLeft / FERRY_ROUND);
  return st;
}
// Примерно 7 из 10 вопросов рейса уходят на фразы в работе, остальные — на повторы.
function roundsForHits(hits) {
  return Math.max(1, Math.ceil(hits / 7));
}
function roundsText(n) {
  return `≈ ${voyagesWord(n)}`;
}
function levelEtaText(st, level) {
  if (!st.answersLeft) return `Весь ${level} выучен ⭐`;
  const days = Math.ceil(st.rounds / 10);
  const daysPart = st.rounds > 10 ? ` — по 10 рейсов в день это ${days} ${ferryPlural(days, "день", "дня", "дней")}` : "";
  return `До конца ${level}: ${roundsText(st.rounds)}${daysPart}, если почти всегда отвечать верно`;
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
  renderJourneyMap();
  renderPhraseLevelPicker();

  const loaded = getLoadedPhraseTopics();
  let totalPhrases = 0;
  let totalMastered = 0;
  let totalLearned = 0;
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
    playAll.addEventListener("click", () => startLevelVoyage(level, playAll));
    head.appendChild(playAll);
    section.appendChild(head);

    const sectionGrid = document.createElement("div");
    sectionGrid.className = "catalog-grid";
    ids.forEach((id) => {
      const m = byId.get(id);
      totalPhrases += m.count;
      const isLoaded = loaded.has(m.id) && phraseTopicCache.has(m.id);
      // Счёт — по ключам levels.json, файл темы для этого не нужен.
      const keys = Object.keys(phraseLevels.phrases[m.id] || {}).map((tr) => `${m.id}::${tr}`);
      const learnedHere = keys.filter((k) => getPhraseBoxId(k) !== "new").length;
      totalLearned += learnedHere;
      totalMastered += keys.filter((k) => getPhraseBoxId(k) === "mastered").length;
      sectionGrid.appendChild(buildPhraseTopicTile(m, isLoaded, learnedHere));
    });
    section.appendChild(sectionGrid);
    grid.appendChild(section);
  });

  document.getElementById("phrases-learned-count").textContent = totalLearned;
  document.getElementById("phrases-mastered-count").textContent = totalMastered;
  document.getElementById("phrases-total-count").textContent = totalPhrases;
  document.getElementById("phrases-topic-count").textContent = phraseManifest.length;
  updatePlaySelectedButton();
}

function buildPhraseTopicTile(m, isLoaded, learnedHere) {
  const tile = document.createElement("div");
  tile.className = "catalog-tile" + (isLoaded ? "" : " not-loaded") + (selectedForQuiz.has(m.id) ? " selected-for-quiz" : "");
  const emoji = m.source === "allah" ? "☪️" : "💬";
  const countLabel = isLoaded || learnedHere ? `🟡 ${learnedHere}/${m.count}` : `⬇ ${m.count} фраз`;
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

// Рейс по всему уровню — с карты пути и из кнопок «▶ Весь A1».
async function startLevelVoyage(level, btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Загружаем…";
  }
  const topics = await Promise.all(levelTopicIds(level).map((id) => loadPhraseTopic(id)));
  startQuiz(topics, level, true);
}

// Карта пути (как в Duolingo): причалы уровня зигзагом, пароход — где ты сейчас,
// сверху — куда плывёшь и сколько рейсов осталось до причала и до конца уровня.
const JOURNEY_W = 320;
const JOURNEY_STEP = 76;
const JOURNEY_BANNER = 46;
const JOURNEY_OFFSETS = [0, 45, 70, 45, 0, -45, -70, -45];

function renderJourneyMap() {
  const el = document.getElementById("phrase-journey");
  if (!el || !phraseLevels) return;
  const meta = getFerryMeta();
  const titles = new Map(phraseManifest.map((m) => [m.id, m.title]));
  const stops = journeyStops(levelTopicIds(journeyLevel), journeyLevel, true, journeyLevel);
  const st = journeyState(stops);
  const nextLevel = PHRASE_LEVEL_ORDER[PHRASE_LEVEL_ORDER.indexOf(journeyLevel) + 1];

  // Раскладка: баннер темы перед её первым причалом, причалы зигзагом.
  let y = 10;
  let lastTopic = null;
  const banners = [];
  const points = stops.map((s, i) => {
    if (s.topicId !== lastTopic) {
      const count = stops.filter((x) => x.topicId === s.topicId).reduce((n, x) => n + x.ids.length, 0);
      banners.push({ y, topicId: s.topicId, count });
      y += JOURNEY_BANNER;
      lastTopic = s.topicId;
    }
    const p = { x: JOURNEY_W / 2 + JOURNEY_OFFSETS[i % JOURNEY_OFFSETS.length], y: y + 28 };
    y += JOURNEY_STEP;
    return p;
  });
  const height = y + 50;
  const curve = (pts) =>
    pts.map((p, i) => (i === 0 ? `M${p.x} ${p.y}` : `C${pts[i - 1].x} ${pts[i - 1].y + 38} ${p.x} ${p.y - 38} ${p.x} ${p.y}`)).join(" ");
  const doneUpTo = st.current < 0 ? points.length : st.current + 1;

  const nodes = stops
    .map((s, i) => {
      const p = points[i];
      const state = i === st.current ? "current" : s.gold ? "gold" : s.passed ? "done" : "ahead";
      const pct = Math.round((s.ever / s.ids.length) * 100);
      const badge = s.back ? `<span class="jn-badge back">🔁${s.back}</span>` : s.gold ? '<span class="jn-badge">⭐</span>' : s.passed ? '<span class="jn-badge">✓</span>' : "";
      const sub = i === st.current ? `${s.ever} из ${s.ids.length}` : s.passed ? (s.gold ? "выучено" : `⭐ ${s.mastered}/${s.ids.length}`) : `${s.ids.length} фраз`;
      const side = p.x <= JOURNEY_W / 2 ? `left:${p.x + 36}px` : `left:${p.x - 36 - 120}px;text-align:right`;
      return (
        `<button type="button" class="journey-node ${state}" data-i="${i}" style="left:${p.x}px;top:${p.y}px;--p:${pct}%">` +
        `<span class="jn-emoji">${s.emoji}</span>${i === st.current ? '<span class="jn-ship">⛴️</span>' : ""}${badge}</button>` +
        `<span class="journey-label ${state}" style="top:${p.y}px;${side}">${escapeHtml(s.name)}<small>${sub}</small></span>`
      );
    })
    .join("");
  const bannerHtml = banners
    .map(
      (b) =>
        `<button type="button" class="journey-banner" data-topic="${b.topicId}" style="top:${b.y}px">` +
        `${escapeHtml(titles.get(b.topicId) || b.topicId)} · ${b.count} ${ferryPlural(b.count, "фраза", "фразы", "фраз")} ›</button>`
    )
    .join("");
  const finish = `<div class="journey-finish" style="top:${y - 6}px">🏁 Конец ${journeyLevel}${nextLevel ? ` — дальше ${nextLevel}` : ""}</div>`;

  let summary;
  if (!stops.length) {
    summary = `<div class="journey-line">В этом уровне нет фраз.</div>`;
  } else if (st.current < 0) {
    summary =
      `<div class="journey-here">🏁 Все причалы ${journeyLevel} пройдены!</div>` +
      `<div class="journey-line">Запомнилось <b>${st.learned}</b> из ${st.total} · ⭐ выучено <b>${st.mastered}</b></div>` +
      `<div class="journey-line">${levelEtaText(st, journeyLevel)}</div>`;
  } else {
    const cur = stops[st.current];
    const next = stops[st.current + 1];
    const left = cur.ids.length - cur.ever;
    summary =
      `<div class="journey-here">⛴️ Ты здесь: <b>${cur.emoji} ${escapeHtml(cur.name)}</b> — причал ${st.current + 1} из ${stops.length}, тема «${escapeHtml(titles.get(cur.topicId) || "")}»</div>` +
      `<div class="journey-progress"><span style="width:${(st.learned / st.total) * 100}%"></span></div>` +
      `<div class="journey-line">Запомнилось <b>${st.learned}</b> из ${st.total} · ⭐ выучено <b>${st.mastered}</b></div>` +
      `<div class="journey-line">${next ? `Курс на <b>${next.emoji} ${escapeHtml(next.name)}</b>` : "До финиша"}: запомнить ещё ${left} ${ferryPlural(left, "фразу", "фразы", "фраз")} — ${roundsText(roundsForHits(cur.hitsLeft))}</div>` +
      `<div class="journey-line dim">${levelEtaText(st, journeyLevel)}</div>`;
  }

  el.innerHTML =
    `<div class="journey-head"><span>🗺️ Путь по Стамбулу</span><span class="journey-meta">⛴️ ${voyagesWord(meta.voyages)} · ⭐ ${meta.stars}</span></div>` +
    `<div class="journey-tabs">${PHRASE_LEVEL_ORDER.map((lv) => `<button type="button" data-level="${lv}" class="${lv === journeyLevel ? "active" : ""}">${lv}</button>`).join("")}</div>` +
    `<div class="journey-summary">${summary}<button type="button" class="journey-go">▶ Плыть дальше — весь ${journeyLevel}</button></div>` +
    `<div class="journey-scroll"><div class="journey-path" style="width:${JOURNEY_W}px;height:${height}px">` +
    `<svg class="journey-svg" width="${JOURNEY_W}" height="${height}" aria-hidden="true">` +
    `<path class="journey-line-ahead" d="${curve(points)}"/>` +
    `<path class="journey-line-done" d="${curve(points.slice(0, doneUpTo))}"/></svg>` +
    bannerHtml + nodes + finish +
    `</div></div>` +
    `<div class="journey-info" id="journey-info">Нажми на причал — покажу, что там.</div>` +
    `<details class="journey-rules"><summary>Когда фраза считается выученной?</summary>` +
    `<p>🔴 <b>В работе</b> — ${NEW_HITS_TO_LEARN} верных ответа, и фраза <b>🟡 запомнилась</b>: её место тут же занимает новая.</p>` +
    `<p>🟡 → 🟢 — вспомнила на следующий день. 🟢 → ⭐ <b>выучена</b> — вспомнила ещё через 3 дня.</p>` +
    `<p>Дальше ⭐ проверяется через неделю, месяц, 3 месяца. Ошиблась — фраза снова в работе.</p>` +
    `<p>В работе одновременно до ${PHRASE_WORKING_SET} фраз. Пока не пришёл срок повтора, запомнившаяся фраза в рейсы не попадает.</p></details>`;

  el.querySelectorAll(".journey-tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      journeyLevel = b.dataset.level;
      localStorage.setItem(JOURNEY_LEVEL_KEY, journeyLevel);
      renderJourneyMap();
    })
  );
  const go = el.querySelector(".journey-go");
  go.disabled = !stops.length;
  go.addEventListener("click", () => startLevelVoyage(journeyLevel, go));
  el.querySelectorAll(".journey-banner").forEach((b) => b.addEventListener("click", () => openPhraseTopic(b.dataset.topic)));
  const info = el.querySelector("#journey-info");
  el.querySelectorAll(".journey-node").forEach((b) =>
    b.addEventListener("click", () => {
      const s = stops[Number(b.dataset.i)];
      const inWork = s.ids.filter((id) => phraseProgress[id] && getPhraseBoxId(id) === "new").length;
      info.innerHTML =
        `<b>${s.emoji} ${escapeHtml(s.name)}</b> · «${escapeHtml(titles.get(s.topicId) || "")}», ${s.ids.length} ${ferryPlural(s.ids.length, "фраза", "фразы", "фраз")}: ` +
        `🟡 запомнилось ${s.learned}, ⭐ выучено ${s.mastered}, 🔴 в работе ${inWork}` +
        (s.back ? `, 🔁 ${s.back} забылись — снова в работе` : "");
    })
  );
  // Прокрутить карту к пароходу (не всю страницу).
  const scroller = el.querySelector(".journey-scroll");
  const target = points[st.current < 0 ? points.length - 1 : st.current];
  if (target) requestAnimationFrame(() => (scroller.scrollTop = Math.max(0, target.y - 110)));
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
  badge.textContent = phraseBadgeText(id);
  badge.title = phraseStatusLabel(id);
  row.appendChild(badge);

  if (box.id !== "mastered") {
    const knowBtn = document.createElement("button");
    knowBtn.textContent = "✓ Знаю";
    knowBtn.title = "Отметить, что уже знаю эту фразу — она перестанет часто появляться";
    knowBtn.addEventListener("click", () => {
      markPhraseKnown(id);
      badge.textContent = phraseBadgeText(id);
      badge.title = phraseStatusLabel(id);
      knowBtn.remove();
    });
    row.appendChild(knowBtn);
  }

  return row;
}

// Бейдж в строке фразы: «🔴 1/3» в работе, ящик — эмодзи, не встречалась — «○».
function phraseBadgeText(id) {
  if (!phraseProgress[id]) return "○";
  const box = getPhraseBox(id);
  return box.id === "new" ? `${box.emoji} ${phraseHits(id)}/${NEW_HITS_TO_LEARN}` : box.emoji;
}

// Подпись к бейджу прогресса: сколько верных ответов уже есть или когда следующий повтор.
function phraseStatusLabel(id) {
  const box = getPhraseBox(id);
  const p = phraseProgress[id];
  if (!p) return "ещё не встречалась";
  if (box.id === "new") return `${box.label} — ${phraseHits(id)} из ${NEW_HITS_TO_LEARN} верных`;
  if (!p.dueDay || isPhraseDue(id)) return `${box.label} — пора повторить`;
  const what = box.id === "mastered" ? "проверка" : "повтор";
  return `${box.label} — ${what} ${inDaysText(daysUntil(p.dueDay))}`;
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

// Плоский список {phrase, topicId, id} по всем темам сессии в порядке пути (тема за темой,
// внутри темы — по порядку файла), за вычетом снятых галочкой на экране темы (если так
// вышло, что снято всё — играем всё равно всем).
function collectItems(topics) {
  const items = [];
  const seen = new Set();
  const cap = quizMaxLevel || phraseLevelCap;
  // «▶ Весь A1» — ровно этот уровень; обычный рейс — всё до потолка.
  const fits = (topicId, p) => (quizExactLevel ? phraseLevel(topicId, p) === cap : levelAtMost(phraseLevel(topicId, p), cap));
  const ordered = [...topics].sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
  ordered.forEach((topic) => {
    topic.phrases.forEach((p) => {
      const id = phraseId(topic.id, p);
      if (seen.has(id)) return;
      seen.add(id);
      if (!excludedPhrases.has(id) && fits(topic.id, p)) items.push({ phrase: p, topicId: topic.id, id });
    });
  });
  if (items.length) return items;
  const all = [];
  ordered.forEach((topic) => {
    topic.phrases.forEach((p) => all.push({ phrase: p, topicId: topic.id, id: phraseId(topic.id, p) }));
  });
  return all;
}

// --- кто следующий в рейсе ---
// В работе — до PHRASE_WORKING_SET начатых фраз; они идут по кругу (дольше всех не
// встречавшаяся — первой), так что между встречами одной фразы проходит десяток других.
// Есть свободное место — добавляется следующая по пути новая фраза (не две новые подряд,
// если есть что крутить). Пришёл срок повтора 🟡/🟢/⭐ — примерно каждый третий вопрос
// отдаётся повтору. Не пришёл — фраза ждёт своего дня и место не занимает.
const PHRASE_MIN_GAP = 4; // фраза возвращается не раньше, чем через 3 других вопроса
const PHRASE_REVIEW_SHARE = 0.35;
let phraseAskSeq = 0;
const phraseLastAsked = new Map(); // id → номер вопроса (в пределах открытой страницы)
let lastWasFresh = false;

function pickNextItem() {
  const items = collectItems(currentTopics);
  const gap = (it) => (phraseLastAsked.has(it.id) ? phraseAskSeq - phraseLastAsked.get(it.id) : Infinity);
  const free = (it) => !ferry.asked.has(it.id);
  const due = [];
  const started = [];
  const unseen = [];
  items.forEach((it) => {
    const rec = phraseProgress[it.id];
    if (!rec) unseen.push(it);
    else if ((rec.box || "new") === "new") started.push(it);
    else if (isPhraseDue(it.id)) due.push(it);
  });
  const longestGap = (list) => {
    const sorted = shuffle(list).sort((a, b) => gap(b) - gap(a));
    return sorted[0];
  };
  const dueReady = due.filter((it) => free(it) && gap(it) >= PHRASE_MIN_GAP);
  // Начатая фраза может вернуться и в том же рейсе — так новая закрепляется быстрее.
  const startedReady = started.filter((it) => gap(it) >= PHRASE_MIN_GAP);
  const fresh = started.length < PHRASE_WORKING_SET ? unseen.find(free) : null;

  if (dueReady.length && (Math.random() < PHRASE_REVIEW_SHARE || (!startedReady.length && !fresh))) {
    return longestGap(dueReady);
  }
  if (fresh && (!startedReady.length || (!lastWasFresh && (startedReady.length < 3 || Math.random() < 0.5)))) {
    return fresh;
  }
  if (startedReady.length) return longestGap(startedReady);
  if (dueReady.length) return longestGap(dueReady);
  // Всё начатое только что было, повторов нет: берём хоть что-то не из этого рейса —
  // сначала начатые/новые, потом давно не встречавшиеся (тренировка без счёта).
  const fallback = [...started, ...unseen, ...due].filter(free);
  if (fallback.length) return longestGap(fallback);
  const rest = items.filter(free);
  return rest.length ? longestGap(rest) : items[Math.floor(Math.random() * items.length)];
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

// --- «Пароход»: игровой слой поверх квиза ---
// Рейс = FERRY_ROUND фраз = столько же препятствий на пути (скалы, волны, лодки): верный
// ответ — пароход проходит препятствие, ошибка — пробоина в корпусе, FERRY_GLASSES пробоин —
// пароход тонет, рейс заново. Ошибка на совсем новой фразе (видишь её впервые) корпус не
// ломает. Серия верных подряд — 🔥, каждые FERRY_REFILL_EVERY подряд заделывают пробоину.
// Рейс везёт по карте пути (journeyStops): слева причал, где пароход сейчас, справа —
// следующий. Каждый ответ засчитывается в прогресс фразы, даже если рейс сорвался.
const FERRY_ROUND = 10;
const FERRY_GLASSES = 3;
const FERRY_HINTS = 1;
const FERRY_REFILL_EVERY = 5;
const FERRY_OPTIONS = 6;
// Мета хранится прямо в объекте прогресса фраз (ключ не может совпасть с id фразы вида
// «тема::текст»), чтобы синхронизироваться через уже существующую колонку phrase_progress.
const FERRY_META_KEY = "__ferry";

// «Фразы» — чтобы выучить фразу ЦЕЛИКОМ: узнать, вспомнить по-турецки, понять на слух.
// Вставлять слова и собирать фразу по кусочкам — это работа «Грамматики», не здесь.
const QUESTION_TYPES = {
  tr2ru: "Что это значит?",
  ru2tr: "Как сказать по-турецки?",
  listen: "Послушай и выбери перевод",
};
// Препятствия на пути парохода — по одному на фразу рейса.
const FERRY_OBSTACLES = ["🪨", "🌊", "⛵", "🪨", "🛥️", "🌊", "🪨", "⛵", "🌊", "🪨"];

let ferry = null; // {done, glasses, combo, bestCombo, hints, token, asked, obstacles, stats, stopAt}
let ferryToken = 0; // отменяет отложенные колбэки (таймер плашки) брошенного рейса
let lastQuestionType = null;
let quizStops = []; // причалы текущего рейса (карта пути)

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

// Новую фразу сначала узнаём (тур → рус), с каждым верным ответом — труднее:
// на слух, потом вспомнить по-турецки. Повторы — в основном по-турецки.
function pickQuestionType(item) {
  const box = getPhraseBoxId(item.id);
  const hits = phraseHits(item.id);
  const canListen = !muted && "speechSynthesis" in window;
  let options;
  if (box === "new") options = hits === 0 ? ["tr2ru"] : hits === 1 ? ["tr2ru", "listen"] : ["ru2tr", "listen"];
  else if (box === "learning") options = ["ru2tr", "listen"];
  else options = ["ru2tr", "ru2tr", "listen"];
  options = options.filter((t) => (t === "listen" ? canListen : true));
  if (!options.length) options = ["tr2ru"];
  const varied = options.filter((t) => t !== lastQuestionType);
  const pickFrom = varied.length ? varied : options;
  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}

function startQuiz(topics, maxLevel = null, exact = false) {
  currentTopics = [...topics].sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
  quizMaxLevel = maxLevel;
  quizExactLevel = exact;
  quizStops = journeyStops(
    currentTopics.map((t) => t.id),
    maxLevel || phraseLevelCap,
    exact,
    exact ? maxLevel : null
  );
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
  const st = journeyState(quizStops);
  document.getElementById("quiz-progress").textContent = st.mastered ? `${st.learned}/${st.total} · ⭐${st.mastered}` : `${st.learned}/${st.total}`;
}

// Где пароход на карте пути: текущий причал и следующий.
function ferryCourse() {
  const st = journeyState(quizStops);
  const cur = st.current < 0 ? null : quizStops[st.current];
  const next = st.current < 0 ? null : quizStops[st.current + 1];
  return { st, cur, next, left: cur ? cur.ids.length - cur.ever : 0 };
}
function courseText(c) {
  if (!c.cur) return "Все причалы пройдены — рейсы на повторение ⭐";
  const target = c.next ? `${c.next.emoji} ${c.next.name}` : "🏁 финиша";
  return `Курс на ${target}: запомнить ещё ${c.left} ${ferryPlural(c.left, "фразу", "фразы", "фраз")} — ${roundsText(roundsForHits(c.cur.hitsLeft))}`;
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
  const course = ferryCourse();
  ferry = {
    done: 0, glasses: FERRY_GLASSES, combo: 0, bestCombo: 0, hints: FERRY_HINTS, token: ferryToken, asked: new Set(),
    obstacles: shuffle(FERRY_OBSTACLES).slice(0, FERRY_ROUND),
    stats: { learned: 0, reviewed: 0, fresh: 0, back: 0 },
    stopAt: course.st.current,
  };
  renderFerryBar();
  clearQuestionArea();
  const meta = getFerryMeta();
  const from = course.cur ? course.cur.name : "Kadıköy";
  const to = course.next ? course.next.name : course.cur ? "финиш" : "повторы";
  showFerryOverlay({
    emoji: "⛴️",
    title: `Рейс №${meta.voyages + 1}: ${from} → ${to}`,
    text: `${FERRY_ROUND} фраз — ${FERRY_ROUND} препятствий: верный ответ — проходишь мимо, ошибка — пробоина, ${FERRY_GLASSES} пробоины — пароход тонет. На совсем новой фразе ошибка корпус не ломает.`,
    extra:
      `<div class="ferry-small">${escapeHtml(courseText(course))}</div>` +
      `<span class="ferry-chip">🔥 ${FERRY_REFILL_EVERY} подряд — заделать пробоину 🔧</span><span class="ferry-chip">💡 ${FERRY_HINTS} подсказка на рейс</span>`,
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
  // Откуда и куда: причалы карты пути.
  const course = ferryCourse();
  document.getElementById("ferry-pier-from").textContent = course.cur ? course.cur.name : "⭐";
  document.getElementById("ferry-pier-to").textContent = course.next ? course.next.name : "🏁";
  document.getElementById("ferry-course").textContent = courseText(course);
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
  currentItem = { ...pickNextItem() };
  // Совсем новая фраза — видишь впервые: ошибка на ней не ломает корпус.
  currentItem.fresh = !phraseProgress[currentItem.id];
  currentItem.missed = false;
  lastWasFresh = currentItem.fresh;
  if (currentItem.fresh) ferry.stats.fresh++;
  ferry.asked.add(currentItem.id);
  phraseLastAsked.set(currentItem.id, ++phraseAskSeq);
  hintUsed = false;
  questionAnswered = false;
  clearQuestionArea();

  const type = pickQuestionType(currentItem);
  lastQuestionType = type;
  currentItem.type = type;
  document.getElementById("quiz-direction").textContent = (currentItem.fresh ? "🆕 Новая фраза · " : "") + QUESTION_TYPES[type];
  renderChoiceQuestion(type);
  renderFerryBar();
  updateQuizProgressLabel();
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
  const showRu = type === "tr2ru" || type === "listen";
  const correctText = showRu ? phrase.ru : phrase.tr;
  const seen = new Set([correctText]);
  const distractorTexts = [];
  for (const p of pickDistractors(currentTopics, currentItem, 20)) {
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

  const optionsEl = document.getElementById("quiz-options");
  const all = [correctText, ...distractorTexts];
  // Короткие варианты на телефоне — в две колонки, длинные — в одну.
  optionsEl.classList.toggle("short", all.every((t) => t.length <= 26));
  shuffle(all).forEach((text) => {
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

// Что сказать после ответа: сколько ещё до «запомнилась», когда повтор.
function outcomeText(out) {
  if (!out) return "";
  const left = NEW_HITS_TO_LEARN - (out.hits || 0);
  const dots = "●".repeat(out.hits || 0) + "○".repeat(Math.max(0, left));
  switch (out.kind) {
    case "hit":
      return `${dots}  ещё ${left} ${ferryPlural(left, "верный ответ", "верных ответа", "верных ответов")} — и фраза запомнится`;
    case "learned":
      return "🟡 Запомнилась! Повторим завтра, а её место в работе займёт новая фраза";
    case "almost":
      return `🟢 Помнишь! Следующий повтор ${inDaysText(out.days)}`;
    case "mastered":
      return `⭐ Выучена! Проверим ${inDaysText(out.days)}`;
    case "kept":
      return `⭐ Всё ещё помнишь — следующая проверка ${inDaysText(out.days)}`;
    case "practice":
      return out.dueDay ? `Тренировка — повтор по плану ${inDaysText(daysUntil(out.dueDay))}` : "Тренировка";
    case "hint":
      return "С подсказкой — в счёт не идёт";
    case "missed":
      return "После ошибки — в счёт не идёт, фраза ещё вернётся";
    default:
      return "";
  }
}

// --- общий исход ответа ---
function onCorrect() {
  questionAnswered = true;
  const token = ferry.token;
  let out;
  if (hintUsed) {
    out = { kind: "hint" };
    ferry.combo = 0;
  } else if (currentItem.missed) {
    out = { kind: "missed" };
  } else {
    out = bumpPhraseStreak(currentItem.id, true);
    if (out.kind === "learned") ferry.stats.learned++;
    if (out.kind === "almost" || out.kind === "mastered" || out.kind === "kept") ferry.stats.reviewed++;
    ferry.combo++;
    ferry.bestCombo = Math.max(ferry.bestCombo, ferry.combo);
  }
  ferry.done++;
  let refilled = false;
  if (!hintUsed && ferry.combo > 0 && ferry.combo % FERRY_REFILL_EVERY === 0 && ferry.glasses < FERRY_GLASSES) {
    ferry.glasses++;
    refilled = true;
  }
  ferrySfx(ferry.combo >= 3 && ferry.combo % FERRY_REFILL_EVERY === 0 ? "combo" : "ok");
  renderFerryBar();
  // Причалила к следующему причалу карты.
  const course = ferryCourse();
  const arrived = ferry.stopAt >= 0 && (course.st.current < 0 || course.st.current > ferry.stopAt);
  if (arrived) {
    const reached = quizStops[course.st.current < 0 ? quizStops.length - 1 : course.st.current];
    ferry.arrivedAt = reached;
    ferry.stopAt = course.st.current;
    flashFerryNote(`⚓ Причалили: ${reached.emoji} ${reached.name}!`);
    ferrySfx("combo");
  } else if (refilled) flashFerryNote("🔥 Серия! Пробоину заделали 🔧");
  updateQuizProgressLabel();
  showPhraseMatchPopup(currentItem.phrase, () => {
    if (!ferry || ferry.token !== token) return;
    if (ferry.done >= FERRY_ROUND) finishVoyage();
    else nextQuestion();
  }, outcomeText(out));
}

function onWrong(revealCorrect) {
  const firstMiss = !currentItem.missed;
  currentItem.missed = true;
  if (firstMiss && !hintUsed) {
    const out = bumpPhraseStreak(currentItem.id, false);
    if (out.kind === "back") {
      ferry.stats.back++;
      flashFerryNote("🔴 Забылась — фраза снова в работе");
    }
  }
  ferry.combo = 0;
  // Совсем новая фраза: её ещё не учили — корпус цел, просто выбери ещё раз.
  if (currentItem.fresh) {
    ferrySfx("tap");
    renderFerryBar();
    if (firstMiss) flashFerryNote("🆕 Новая фраза — без пробоины");
    return;
  }
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
  bar.querySelectorAll(".ferry-note").forEach((n) => n.remove());
  const note = document.createElement("div");
  note.className = "ferry-note";
  note.textContent = text;
  bar.appendChild(note);
  setTimeout(() => note.remove(), 2200);
}

function starsHtml(n) {
  return `<div class="ferry-stars">${"⭐".repeat(n)}${'<span class="dim">⭐</span>'.repeat(FERRY_GLASSES - n)}</div>`;
}

// Что дал рейс: сколько фраз запомнилось, повторено, новых; и где теперь пароход.
function voyageReportHtml(stats) {
  const chips = [];
  if (stats.learned) chips.push(`🟡 +${stats.learned} ${ferryPlural(stats.learned, "фраза запомнилась", "фразы запомнились", "фраз запомнились")}`);
  if (stats.reviewed) chips.push(`🔁 ${stats.reviewed} ${ferryPlural(stats.reviewed, "повтор", "повтора", "повторов")} пройдено`);
  if (stats.fresh) chips.push(`🆕 ${stats.fresh} ${ferryPlural(stats.fresh, "новая фраза", "новые фразы", "новых фраз")} в работе`);
  if (stats.back) chips.push(`🔴 ${stats.back} ${ferryPlural(stats.back, "забылась", "забылись", "забылись")}`);
  const course = ferryCourse();
  return (
    chips.map((c) => `<span class="ferry-chip">${c}</span>`).join("") +
    `<div class="ferry-small">${escapeHtml(courseText(course))}</div>` +
    (quizExactLevel && quizMaxLevel ? `<div class="ferry-small dim">${escapeHtml(levelEtaText(course.st, quizMaxLevel))}</div>` : "")
  );
}

function finishVoyage() {
  const stars = Math.max(1, ferry.glasses);
  const meta = getFerryMeta();
  meta.voyages += 1;
  meta.stars += stars;
  meta.bestCombo = Math.max(meta.bestCombo || 0, ferry.bestCombo);
  saveFerryMeta(meta);
  ferrySfx("horn");
  const arrived = ferry.arrivedAt;
  const best = ferry.bestCombo;
  let extra = starsHtml(stars);
  if (arrived) extra += `<div class="ferry-unlock">Новый причал на карте: <b>${arrived.emoji} ${escapeHtml(arrived.name)}</b></div>`;
  extra += voyageReportHtml(ferry.stats);
  ferry = null;
  showFerryOverlay({
    emoji: arrived ? arrived.emoji : "⚓",
    title: arrived ? `Причалили: ${arrived.name}!` : "Рейс пройден!",
    text: `Рейс №${meta.voyages}. Корпус цел: ${stars} из ${FERRY_GLASSES}. Лучшая серия: 🔥 ${best}`,
    extra,
    goLabel: "Следующий рейс ▶",
    onGo: showVoyageIntro,
  });
}

function sinkVoyage(phrase) {
  ferrySfx("sink");
  const done = ferry.done;
  const stats = ferry.stats;
  ferry = null;
  showFerryOverlay({
    emoji: "🌊",
    title: "Пароход затонул",
    text: `${FERRY_GLASSES} пробоины на отрезке ${done + 1} из ${FERRY_ROUND}. Ответы этого рейса всё равно засчитаны.`,
    extra: `<div class="ferry-small">Запомни: <b>${escapeHtml(phrase.tr)}</b> — ${escapeHtml(phrase.ru)}</div>` + voyageReportHtml(stats),
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
// status — что стало с фразой («ещё 1 верный — и запомнится», «🟡 Запомнилась!»).
function showPhraseMatchPopup(phrase, onDone, status = "") {
  const popupEl = document.getElementById("match-popup");
  const card = popupEl.querySelector(".match-card");
  card.classList.add("no-icon");
  popupEl.querySelector(".match-tr").textContent = phrase.tr;
  popupEl.querySelector(".match-ru").textContent = phrase.ru;
  let statusEl = card.querySelector(".match-status");
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "match-status";
    popupEl.querySelector(".match-ru").after(statusEl);
  }
  statusEl.textContent = status;
  popupEl.classList.remove("hidden");
  clearTimeout(popupEl._hideTimer);

  let advanced = false;
  const advance = () => {
    if (advanced) return;
    advanced = true;
    clearTimeout(popupEl._hideTimer);
    popupEl.classList.add("hidden");
    card.classList.remove("no-icon");
    statusEl.textContent = "";
    popupEl.removeEventListener("click", onBackgroundClick);
    onDone();
  };
  function onBackgroundClick(e) {
    if (e.target === popupEl) advance();
  }
  popupEl.addEventListener("click", onBackgroundClick);
  popupEl._hideTimer = setTimeout(advance, status ? 4000 : 3500);

  speak(phrase.tr);
}

// Подсказка — одна на рейс: гасит половину неверных вариантов. Ответ после подсказки
// не идёт в прогресс (REQ-004) и обнуляет серию.
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

function initPhrasesMode() {
  document.getElementById("quiz-hint-btn").addEventListener("click", useHint);
  const leaveQuiz = () => {
    ferryToken++;
    ferry = null;
    document.getElementById("ferry-overlay").classList.add("hidden");
    currentTopics = [];
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
