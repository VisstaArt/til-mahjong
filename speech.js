// Голосовые ответы: распознавание турецкой речи (Web Speech API — встроено в браузер,
// бесплатно) и мягкая сверка сказанного с эталонной фразой. Общее для «Фраз» и (дальше)
// «Диалогов». Классический <script>: функции в общем глобальном скоупе, как у остальных.
//
// Пользовательница решила: голос — только когда удобно. Перед рейсом спрашиваем
// «Сейчас можно говорить вслух?» (один раз в день), без «да» голосовых заданий нет.
// Включить диктовку на iPhone программно нельзя — если распознавание отказало
// (нет интернета, выключена диктовка, нет доступа к микрофону), голос выключается
// до перезагрузки страницы и задания идут обычным выбором.

const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const SAY_CHOICE_KEY = "mahjong-say-choice"; // {day, on} — ответ на «можно говорить?» сегодня
let sayBroken = ""; // почему голос сейчас не работает (пусто — работает)

function sayDay() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function saySupported() {
  return !!SpeechRecognitionApi;
}
// null — сегодня ещё не спрашивали; true/false — ответ.
function sayChoiceToday() {
  try {
    const v = JSON.parse(localStorage.getItem(SAY_CHOICE_KEY) || "null");
    return v && v.day === sayDay() ? !!v.on : null;
  } catch {
    return null;
  }
}
function setSayChoice(on) {
  try {
    localStorage.setItem(SAY_CHOICE_KEY, JSON.stringify({ day: sayDay(), on: !!on }));
  } catch {}
  if (on) sayBroken = "";
}
// Можно ли прямо сейчас давать задание «скажи вслух».
function sayEnabled() {
  return saySupported() && !sayBroken && navigator.onLine !== false && sayChoiceToday() === true;
}

// --- сверка сказанного с эталоном ---
const TR_ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TR_TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
function trNumberWords(n) {
  if (n === 0) return ["sıfır"];
  const out = [];
  if (n >= 1000) {
    const k = Math.floor(n / 1000);
    if (k > 1) out.push(...trNumberWords(k));
    out.push("bin");
    n %= 1000;
  }
  if (n >= 100) {
    const h = Math.floor(n / 100);
    if (h > 1) out.push(TR_ONES[h]);
    out.push("yüz");
    n %= 100;
  }
  if (n >= 10) out.push(TR_TENS[Math.floor(n / 10)]);
  if (n % 10) out.push(TR_ONES[n % 10]);
  return out;
}
// «10'da» → ["onda"], «38» → ["otuz", "sekiz"].
function expandDigits(tok) {
  const m = tok.match(/^(\d{1,4})([a-zçğıöşüâîû]*)$/);
  if (!m) return [tok];
  const words = trNumberWords(Number(m[1]));
  words[words.length - 1] += m[2];
  return words;
}
function trLower(s) {
  return s.toLocaleLowerCase("tr").replace(/[’'`ʼ]/g, "");
}
// Слова сказанного: нижний регистр по-турецки, без знаков, цифры — словами.
function spokenWords(s) {
  return trLower(s)
    .replace(/[.,!?;:«»"“”…—–\-/()]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(expandDigits);
}
// Слоты эталона: «oğlunuz/kızınız» — любое из двух, «(eşiniz)» — необязательно,
// «istiyorsun(uz)» — с окончанием и без, «…» — место для своего слова (не проверяется).
function referenceSlots(tr) {
  const slots = [];
  trLower(tr)
    .replace(/[.,!?;:«»"“”…—–\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((tok) => {
      if (/^\(.*\)$/.test(tok)) return; // необязательное слово
      const alts = tok
        .split("/")
        .filter(Boolean)
        .flatMap((a) => (/\(.+\)/.test(a) ? [a.replace(/[()]/g, ""), a.replace(/\(.+?\)/g, "")] : [a.replace(/[()]/g, "")]))
        .filter(Boolean);
      if (!alts.length) return;
      if (alts.length === 1 && /^\d/.test(alts[0])) expandDigits(alts[0]).forEach((w) => slots.push([w]));
      else slots.push(alts);
    });
  return slots;
}
function foldTr(w) {
  return w
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
// Слова «похожи»: без учёта точек над буквами и с допуском на одну-две буквы —
// телефон не всегда точно слышит акцент, а нам важно, что фраза вспомнилась.
function wordsClose(a, b) {
  const x = foldTr(a);
  const y = foldTr(b);
  if (x === y) return true;
  const n = Math.max(x.length, y.length);
  const tol = n >= 7 ? 2 : n >= 4 ? 1 : 0;
  return tol > 0 && editDistance(x, y) <= tol;
}
// {ok, score, words: [{w, hit}]} — ok, если узнаны все слова короткой фразы
// (до двух слов) или три четверти длинной; порядок слов и лишние слова не важны.
// opts.ignore — слова-«вежливость», которые не проверяем (lütfen, efendim…),
// opts.threshold — своя доля для длинных фраз (в живом разговоре мягче).
function matchSpoken(referenceTr, heard, opts = {}) {
  let slots = referenceSlots(referenceTr);
  if (opts.ignore) {
    const kept = slots.filter((alts) => !alts.every((a) => opts.ignore.has(a)));
    if (kept.length) slots = kept;
  }
  const words = spokenWords(heard);
  const used = new Set();
  let hit = 0;
  slots.forEach((alts) => {
    const i = words.findIndex((w, j) => !used.has(j) && alts.some((a) => wordsClose(a, w)));
    if (i >= 0) {
      used.add(i);
      hit++;
    }
  });
  const need = slots.length;
  const score = need ? hit / need : 1;
  const ok = need <= 2 ? hit === need : score >= (opts.threshold || 0.75);
  return { ok, score, words: words.map((w, j) => ({ w, hit: used.has(j) })) };
}
// Лучший из нескольких вариантов, которые услышал телефон; references — одна фраза
// или список допустимых вариантов.
function bestSpokenMatch(references, transcripts, opts = {}) {
  let best = null;
  [].concat(references).forEach((ref) => {
    transcripts.forEach((t) => {
      const m = { ...matchSpoken(ref, t, opts), text: t, ref };
      if (!best || m.ok > best.ok || (m.ok === best.ok && m.score > best.score)) best = m;
    });
  });
  return best;
}
// Подсказка первыми буквами: «Nasılsınız?» → «N________?»
function initialsHint(tr) {
  return tr.replace(/[A-Za-zÇĞİÖŞÜçğıöşüâîû]+/g, (w) => w[0] + "_".repeat(Math.max(1, w.length - 1)));
}

// --- одна попытка «скажи» ---
// handlers: {onStart, onResult(transcripts), onNothing(), onFail(reason)}.
// Возвращает функцию остановки.
function listenTurkish(handlers) {
  const rec = new SpeechRecognitionApi();
  rec.lang = "tr-TR";
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 5;
  let got = false;
  let failed = false;
  rec.onstart = () => handlers.onStart && handlers.onStart();
  rec.onresult = (e) => {
    got = true;
    const res = e.results[0];
    const transcripts = [];
    for (let i = 0; i < res.length; i++) transcripts.push(res[i].transcript);
    handlers.onResult(transcripts);
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    failed = true;
    const reasons = {
      "not-allowed": "нет доступа к микрофону — разреши его браузеру",
      "service-not-allowed": "распознавание речи выключено — на iPhone включи диктовку: Настройки → Основные → Клавиатура → Диктовка",
      network: "нет интернета",
      "audio-capture": "микрофон не найден",
      "language-not-supported": "телефон не распознаёт турецкий",
    };
    sayBroken = reasons[e.error] || `распознавание не сработало (${e.error})`;
    handlers.onFail(sayBroken);
  };
  rec.onend = () => {
    if (!got && !failed) handlers.onNothing();
  };
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  try {
    rec.start();
  } catch (err) {
    failed = true;
    sayBroken = "распознавание не запустилось";
    handlers.onFail(sayBroken);
  }
  // iPhone иногда не заканчивает слушать сам — через 10 секунд останавливаем
  // (stop, а не abort: сказанное при этом всё равно распознаётся).
  const autoStop = setTimeout(() => {
    try {
      rec.stop();
    } catch {}
  }, 10000);
  const stop = (finish = false) => {
    clearTimeout(autoStop);
    try {
      if (finish) rec.stop();
      else rec.abort();
    } catch {}
  };
  stop.finish = () => stop(true);
  return stop;
}
