// Игры со словами, кроме маджонга: «Слова падают», «Найди слова» (сетка букв),
// «Кроссворд» и «Слушай и найди». Слова — те же, что выбраны для маджонга
// (getActiveDeck: галочки + «Уровень слов»), невыученные попадаются чаще. Каждый ответ
// идёт в общий прогресс слов (bumpWordStreak) — как пара, собранная в маджонге.
// Подсказка к слову — картинка, если она есть, цвет, цифра или русский перевод
// (как лицевая сторона плитки маджонга). Классический <script> после script.js.

const WG_BEST_KEY = "mahjong-wordgames-best";
let wg = null; // текущая игра: {id, token, score, ...}
let wgToken = 0;
let wgRaf = 0;

const WORD_GAMES = [
  { id: "rain", emoji: "🌧", title: "Слова падают", hint: "лови нужное слово, пока не упало", min: 6 },
  { id: "search", emoji: "🔎", title: "Найди слова", hint: "слова спрятаны в сетке букв", min: 6 },
  { id: "cross", emoji: "✏️", title: "Кроссворд", hint: "вписать слова по подсказкам", min: 6 },
  { id: "listen", emoji: "👂", title: "Слушай и найди", hint: "услышала слово — найди его", min: 6 },
];

// --- общее ---
function wgUpper(s) {
  return s.toLocaleUpperCase("tr").replace(/Â/g, "A").replace(/Î/g, "İ").replace(/Û/g, "U");
}
// Одно слово только из турецких букв — для сетки и кроссворда.
function wgLetters(w, min, max) {
  const s = wgUpper(w.tr);
  return /^[A-ZÇĞIİÖŞÜ]+$/.test(s) && s.length >= min && s.length <= max ? s : null;
}
// n разных слов: чем хуже выучено, тем вероятнее (взвешенная случайная выборка).
function wgPick(n, filter = () => true) {
  const seen = new Set();
  const deck = getActiveDeck().filter((w) => filter(w) && !seen.has(w.tr) && seen.add(w.tr));
  return deck
    .map((w) => ({ w, k: Math.random() ** (1 / Math.max(0.4, getWordBox(w.tr).weight)) }))
    .sort((a, b) => b.k - a.k)
    .slice(0, n)
    .map((x) => x.w);
}
// Подсказка к слову: картинка / цвет / цифра + русский перевод.
function wgClue(w, cls = "") {
  const el = document.createElement("div");
  el.className = `wg-clue ${cls}`;
  if (COLOR_WORDS[w.tr]) {
    el.innerHTML = `<span class="wg-swatch" style="background:${COLOR_WORDS[w.tr]}"></span>`;
  } else if (NUMBER_VALUES[w.tr]) {
    el.innerHTML = `<span class="wg-num">${NUMBER_VALUES[w.tr]}</span>`;
  } else if (w.icon) {
    const img = document.createElement("img");
    img.src = w.icon;
    img.alt = "";
    el.appendChild(img);
  }
  const ru = document.createElement("span");
  ru.className = "wg-ru";
  ru.textContent = w.ru;
  el.appendChild(ru);
  return el;
}
function wgAlive(token) {
  return wg && wg.token === token && document.body.dataset.screen === "word-game";
}
function wgBest(id) {
  try {
    return JSON.parse(localStorage.getItem(WG_BEST_KEY) || "{}")[id] || 0;
  } catch {
    return 0;
  }
}
function wgSaveBest(id, score) {
  let all = {};
  try {
    all = JSON.parse(localStorage.getItem(WG_BEST_KEY) || "{}");
  } catch {}
  const isBest = score > (all[id] || 0);
  if (isBest) {
    all[id] = score;
    try {
      localStorage.setItem(WG_BEST_KEY, JSON.stringify(all));
    } catch {}
  }
  return isBest;
}
function wgTime(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function wgOpen(id) {
  cancelAnimationFrame(wgRaf);
  clearInterval(wg && wg.timer);
  const game = WORD_GAMES.find((g) => g.id === id);
  wgToken++;
  wg = { id, token: wgToken, score: 0, combo: 0, bestCombo: 0 };
  document.getElementById("wg-title").textContent = `${game.emoji} ${game.title}`;
  document.getElementById("wg-overlay").classList.add("hidden");
  document.getElementById("wg-main").innerHTML = "";
  document.getElementById("wg-main").className = `wg-main wg-${id}`;
  document.getElementById("wg-lives").innerHTML = "";
  document.getElementById("wg-hint-btn").classList.add("hidden");
  document.getElementById("wg-mute-btn").textContent = muted ? "🔇" : "🔊";
  setScreen("word-game");
  return wg;
}
function wgStat(label, value) {
  document.getElementById("wg-score-label").textContent = label;
  document.getElementById("wg-score").textContent = value;
}
function wgProgress(label, value) {
  document.getElementById("wg-progress-label").textContent = label;
  document.getElementById("wg-progress").textContent = value;
}
function wgLives(n, max) {
  document.getElementById("wg-lives").innerHTML = "❤️".repeat(Math.max(0, n)) + '<span class="dim">🤍</span>'.repeat(Math.max(0, max - n));
}
function wgHintButton(count, onUse) {
  const btn = document.getElementById("wg-hint-btn");
  btn.classList.remove("hidden");
  btn.textContent = `💡 ${count}`;
  btn.disabled = count <= 0;
  btn.onclick = onUse;
}
function wgFinish({ emoji, title, text, extra = "" }) {
  cancelAnimationFrame(wgRaf);
  clearInterval(wg && wg.timer);
  const id = wg.id;
  const ov = document.getElementById("wg-overlay");
  document.getElementById("wg-card-emoji").textContent = emoji;
  document.getElementById("wg-card-title").textContent = title;
  document.getElementById("wg-card-text").textContent = text;
  document.getElementById("wg-card-extra").innerHTML = extra;
  document.getElementById("wg-again-btn").onclick = () => startWordGame(id);
  ov.classList.remove("hidden");
  wg.over = true;
}
function wgNotEnough(game) {
  wgOpen(game.id);
  wgFinish({
    emoji: "🗂",
    title: "Мало слов для игры",
    text: `Нужно хотя бы ${game.min} подходящих слов. Отметь категории в каталоге слов (и проверь «Уровень слов») — игры берут те же слова, что маджонг.`,
  });
  document.getElementById("wg-again-btn").onclick = wgBack;
}
function wgBack() {
  cancelAnimationFrame(wgRaf);
  clearInterval(wg && wg.timer);
  wgToken++;
  wg = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  renderCatalog();
  renderWordGamesStrip();
  setScreen("catalog");
}
function wgCombo(ok) {
  if (ok) {
    wg.combo++;
    wg.bestCombo = Math.max(wg.bestCombo, wg.combo);
  } else wg.combo = 0;
}

function startWordGame(id) {
  ({ rain: startRain, search: startSearch, cross: startCross, listen: startListenGame })[id]();
}

// =====================================================================
// 🌧 «Слова падают»: внизу — что поймать (картинка / перевод, иногда только на слух),
// сверху падают турецкие слова. Тапнуть нужное, пока оно не упало. Ошибка или
// упавшее нужное слово — минус жизнь; с каждым пойманным слова падают быстрее.
// =====================================================================
const RAIN_TARGETS = 20;
const RAIN_LIVES = 3;

function startRain() {
  const game = WORD_GAMES[0];
  const words = wgPick(40, (w) => w.tr.length <= 18);
  if (words.length < game.min) return wgNotEnough(game);
  const g = wgOpen("rain");
  const main = document.getElementById("wg-main");
  main.innerHTML =
    '<div class="rain-field"></div>' +
    '<div class="rain-target"><span class="rain-label">Поймай:</span><div class="rain-clue"></div></div>';
  Object.assign(g, {
    words,
    field: main.querySelector(".rain-field"),
    clueEl: main.querySelector(".rain-clue"),
    drops: [],
    target: null,
    caught: 0,
    lives: RAIN_LIVES,
    speed: 46,
    spawnEvery: 1.3,
    sinceSpawn: 1,
    spawnsWithoutTarget: 0,
    targetIdx: 0,
    last: performance.now(),
  });
  wgStat("Счёт", 0);
  wgProgress("Поймано", `0/${RAIN_TARGETS}`);
  wgLives(g.lives, RAIN_LIVES);
  rainNextTarget(g);
  const token = g.token;
  const loop = (now) => {
    if (!wgAlive(token) || g.over) return;
    rainTick(g, Math.min(0.05, (now - g.last) / 1000));
    g.last = now;
    wgRaf = requestAnimationFrame(loop);
  };
  wgRaf = requestAnimationFrame(loop);
}

function rainNextTarget(g) {
  g.target = g.words[g.targetIdx++ % g.words.length];
  g.spawnsWithoutTarget = 2; // нужное слово появится почти сразу
  // Каждое третье слово — только на слух (если звук есть).
  g.listenOnly = g.targetIdx % 3 === 0 && !muted && "speechSynthesis" in window;
  g.clueEl.innerHTML = "";
  if (g.listenOnly) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rain-listen";
    b.textContent = "👂 на слух — 🔊 ещё раз";
    b.addEventListener("click", () => speak(g.target.tr));
    g.clueEl.appendChild(b);
    speak(g.target.tr);
  } else {
    g.clueEl.appendChild(wgClue(g.target, "small"));
  }
}

function rainSpawn(g) {
  const fieldW = g.field.clientWidth;
  const targetFalling = g.drops.some((d) => d.w.tr === g.target.tr);
  let w;
  if (!targetFalling && g.spawnsWithoutTarget >= 2) {
    w = g.target;
    g.spawnsWithoutTarget = 0;
  } else {
    const busy = new Set(g.drops.map((d) => d.w.tr));
    const pool = g.words.filter((x) => x.tr !== g.target.tr && !busy.has(x.tr));
    w = pool[Math.floor(Math.random() * pool.length)] || g.target;
    g.spawnsWithoutTarget++;
  }
  const el = document.createElement("button");
  el.type = "button";
  el.className = "rain-drop";
  el.textContent = w.tr;
  g.field.appendChild(el);
  // Три полосы — чтобы слова не налезали друг на друга.
  const lanes = 3;
  const used = g.drops.filter((d) => d.y < 60).map((d) => d.lane);
  const free = [0, 1, 2].filter((l) => !used.includes(l));
  const lane = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * lanes);
  const laneW = fieldW / lanes;
  const x = Math.max(4, Math.min(fieldW - el.offsetWidth - 4, laneW * lane + (laneW - el.offsetWidth) / 2 + (Math.random() - 0.5) * 20));
  const drop = { w, el, x, y: -44, lane };
  el.style.transform = `translate(${x}px, ${drop.y}px)`;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    rainTap(g, drop);
  });
  g.drops.push(drop);
}

function rainTick(g, dt) {
  const h = g.field.clientHeight;
  g.sinceSpawn += dt;
  if (g.sinceSpawn >= g.spawnEvery) {
    g.sinceSpawn = 0;
    rainSpawn(g);
  }
  for (const d of [...g.drops]) {
    d.y += g.speed * dt;
    d.el.style.transform = `translate(${d.x}px, ${d.y}px)`;
    if (d.y > h - 8) {
      rainRemove(g, d);
      if (d.w.tr === g.target.tr) rainMiss(g, `Упало: ${g.target.tr} — ${g.target.ru}`);
    }
  }
}
function rainRemove(g, d, cls = "") {
  g.drops = g.drops.filter((x) => x !== d);
  if (cls) {
    d.el.classList.add(cls);
    setTimeout(() => d.el.remove(), 350);
  } else d.el.remove();
}
function rainTap(g, d) {
  if (g.over || !g.drops.includes(d)) return;
  if (d.w.tr === g.target.tr) {
    wgCombo(true);
    bumpWordStreak(d.w.tr, true);
    g.caught++;
    g.score += 10 * (1 + Math.floor(wg.combo / 3));
    speak(d.w.tr);
    rainRemove(g, d, "caught");
    g.speed = Math.min(150, g.speed * 1.06);
    g.spawnEvery = Math.max(0.6, g.spawnEvery * 0.97);
    wgStat("Счёт", g.score);
    wgProgress("Поймано", `${g.caught}/${RAIN_TARGETS}`);
    if (g.caught >= RAIN_TARGETS) return rainEnd(g, true);
    rainNextTarget(g);
  } else {
    rainRemove(g, d, "wrong");
    rainMiss(g, `Нужно было: ${g.target.tr} — ${g.target.ru}`);
  }
}
function rainMiss(g, text) {
  wgCombo(false);
  bumpWordStreak(g.target.tr, false);
  g.lives--;
  wgLives(g.lives, RAIN_LIVES);
  const note = document.createElement("div");
  note.className = "rain-note";
  note.textContent = text;
  g.field.appendChild(note);
  setTimeout(() => note.remove(), 1800);
  if (g.lives <= 0) return rainEnd(g, false);
  rainNextTarget(g);
}
function rainEnd(g, won) {
  const best = wgSaveBest("rain", g.score);
  wgFinish({
    emoji: won ? "🌈" : "☔",
    title: won ? "Ливень пережит!" : "Три промаха — раунд окончен",
    text: `Поймано ${g.caught} из ${RAIN_TARGETS}. Счёт: ${g.score}${best ? " — новый рекорд" : ` (рекорд ${wgBest("rain")})`}. Лучшая серия: 🔥 ${wg.bestCombo}.`,
  });
}

// =====================================================================
// 🔎 «Найди слова»: сетка букв, в ней спрятаны слова (→, ↓, ↘). Подсказки — картинки
// и перевод, само турецкое слово надо вспомнить. Выделить — провести пальцем от
// первой буквы до последней (или тапнуть первую и последнюю).
// =====================================================================
const SEARCH_SIZE = 8;
const SEARCH_WORDS = 6;
const SEARCH_DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
];
const TR_FILL = "AAAAEEEEİİİLLLRRRNNNKKMMUUTTSSDDYYOOBBIIÜŞÇGHZPCVFĞÖ";

function startSearch() {
  const game = WORD_GAMES[1];
  const cands = wgPick(40, (w) => wgLetters(w, 3, SEARCH_SIZE));
  if (cands.length < game.min) return wgNotEnough(game);
  // Расставить: длинные первыми, пересечения только по одинаковым буквам.
  const grid = Array.from({ length: SEARCH_SIZE }, () => Array(SEARCH_SIZE).fill(""));
  const placed = [];
  const order = cands.map((w) => ({ w, s: wgLetters(w, 3, SEARCH_SIZE) })).sort((a, b) => b.s.length - a.s.length);
  for (const item of order) {
    if (placed.length >= SEARCH_WORDS) break;
    if (placed.some((p) => p.s === item.s)) continue;
    for (let attempt = 0; attempt < 150; attempt++) {
      const [dr, dc] = SEARCH_DIRS[Math.floor(Math.random() * SEARCH_DIRS.length)];
      const r0 = Math.floor(Math.random() * (SEARCH_SIZE - dr * (item.s.length - 1)));
      const c0 = Math.floor(Math.random() * (SEARCH_SIZE - dc * (item.s.length - 1)));
      const cells = [...item.s].map((ch, i) => [r0 + dr * i, c0 + dc * i, ch]);
      if (cells.every(([r, c, ch]) => grid[r][c] === "" || grid[r][c] === ch)) {
        cells.forEach(([r, c, ch]) => (grid[r][c] = ch));
        placed.push({ ...item, cells: cells.map(([r, c]) => `${r},${c}`), found: false });
        break;
      }
    }
  }
  if (placed.length < 4) return wgNotEnough(game);
  for (let r = 0; r < SEARCH_SIZE; r++)
    for (let c = 0; c < SEARCH_SIZE; c++) if (!grid[r][c]) grid[r][c] = TR_FILL[Math.floor(Math.random() * TR_FILL.length)];

  const g = wgOpen("search");
  Object.assign(g, { grid, placed, sec: 0, hints: 2, hinted: new Set() });
  const main = document.getElementById("wg-main");
  main.innerHTML = '<div class="search-grid"></div><div class="search-clues"></div>';
  const gridEl = main.querySelector(".search-grid");
  gridEl.style.gridTemplateColumns = `repeat(${SEARCH_SIZE}, 1fr)`;
  grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      const cell = document.createElement("div");
      cell.className = "search-cell";
      cell.dataset.rc = `${r},${c}`;
      cell.textContent = ch;
      gridEl.appendChild(cell);
    })
  );
  const cluesEl = main.querySelector(".search-clues");
  placed.forEach((p, i) => {
    const chip = document.createElement("div");
    chip.className = "search-clue";
    chip.appendChild(wgClue(p.w, "small"));
    const word = document.createElement("span");
    word.className = "search-word";
    word.textContent = "?".repeat(p.s.length);
    chip.appendChild(word);
    p.chip = chip;
    p.color = i % 6;
    cluesEl.appendChild(chip);
  });
  wgStat("Время", "0:00");
  wgProgress("Найдено", `0/${placed.length}`);
  wgHintButton(g.hints, () => searchHint(g));
  g.timer = setInterval(() => {
    if (!wgAlive(g.token) || g.over) return clearInterval(g.timer);
    g.sec++;
    wgStat("Время", wgTime(g.sec));
  }, 1000);
  searchSelection(g, gridEl);
}

// Выделение: провести пальцем по прямой или тапнуть первую и последнюю букву.
function searchSelection(g, gridEl) {
  let start = null;
  let anchor = null; // первая буква, выбранная тапом
  let path = [];
  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.classList && el.classList.contains("search-cell") ? el.dataset.rc.split(",").map(Number) : null;
  };
  const line = (a, b) => {
    const dr = Math.sign(b[0] - a[0]);
    const dc = Math.sign(b[1] - a[1]);
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    if (b[0] - a[0] !== dr * n || b[1] - a[1] !== dc * n) return null; // не прямая
    return Array.from({ length: n + 1 }, (_, i) => `${a[0] + dr * i},${a[1] + dc * i}`);
  };
  const paint = () => {
    gridEl.querySelectorAll(".search-cell.sel").forEach((c) => c.classList.remove("sel"));
    path.forEach((rc) => gridEl.querySelector(`[data-rc="${rc}"]`).classList.add("sel"));
  };
  gridEl.addEventListener("pointerdown", (e) => {
    const rc = cellAt(e.clientX, e.clientY);
    if (!rc || g.over) return;
    e.preventDefault();
    start = anchor || rc;
    path = line(start, rc) || [rc.join(",")];
    paint();
  });
  gridEl.addEventListener("pointermove", (e) => {
    if (!start) return;
    const rc = cellAt(e.clientX, e.clientY);
    if (!rc) return;
    const p = line(start, rc);
    if (p) {
      path = p;
      paint();
    }
  });
  const finish = () => {
    if (!start) return;
    if (path.length === 1 && !anchor) {
      anchor = start; // тап по первой букве — ждём вторую
      start = null;
      return;
    }
    const hit = searchCheck(g, path);
    anchor = null;
    start = null;
    path = [];
    paint();
    if (!hit) {
      gridEl.classList.add("shake");
      setTimeout(() => gridEl.classList.remove("shake"), 300);
    }
  };
  gridEl.addEventListener("pointerup", finish);
  gridEl.addEventListener("pointercancel", () => {
    start = null;
    anchor = null;
    path = [];
    paint();
  });
}
function searchCheck(g, path) {
  const key = path.join(";");
  const back = [...path].reverse().join(";");
  const p = g.placed.find((x) => !x.found && (x.cells.join(";") === key || x.cells.join(";") === back));
  if (!p) return path.length < 2; // короткий тап — не ошибка
  p.found = true;
  p.cells.forEach((rc) => document.querySelector(`.search-cell[data-rc="${rc}"]`).classList.add("found", `c${p.color}`));
  p.chip.classList.add("found", `c${p.color}`);
  p.chip.querySelector(".search-word").textContent = p.w.tr;
  if (!g.hinted.has(p.s)) bumpWordStreak(p.w.tr, true);
  speak(p.w.tr);
  const n = g.placed.filter((x) => x.found).length;
  wgProgress("Найдено", `${n}/${g.placed.length}`);
  if (n === g.placed.length) {
    const score = Math.max(10, 300 - g.sec - (2 - g.hints) * 30);
    const best = wgSaveBest("search", score);
    wgFinish({
      emoji: "🔎",
      title: "Все слова найдены!",
      text: `Время: ${wgTime(g.sec)}, подсказок: ${2 - g.hints}. Очки: ${score}${best ? " — новый рекорд" : ""}.`,
    });
  }
  return true;
}
// Подсказка: мигает первая буква одного из ненайденных слов.
function searchHint(g) {
  if (g.hints <= 0 || g.over) return;
  const left = g.placed.filter((p) => !p.found && !g.hinted.has(p.s));
  const p = left[0] || g.placed.find((x) => !x.found);
  if (!p) return;
  g.hints--;
  g.hinted.add(p.s);
  wgHintButton(g.hints, () => searchHint(g));
  const cell = document.querySelector(`.search-cell[data-rc="${p.cells[0]}"]`);
  cell.classList.add("hint");
  p.chip.classList.add("hint");
  setTimeout(() => cell.classList.remove("hint"), 2400);
}

// =====================================================================
// ✏️ «Кроссворд»: 5–7 слов, пересекаются по общим буквам. Подсказки — картинки и
// перевод. Буквы — своей клавиатурой с турецкими буквами (ç ğ ı i ö ş ü).
// Слово вписано целиком — проверяется сразу: зелёное — верно, красное — ещё раз.
// =====================================================================
const CROSS_MAX = 7;
const CROSS_KEYS = ["ERTYUIOPĞÜ", "ASDFGHJKLŞİ", "ZCVBNMÖÇ⌫"];

function buildCrossword(items) {
  const cells = new Map(); // "r,c" → {ch, across, down}
  const placed = [];
  const fits = (s, r, c, dir) => {
    const [dr, dc] = dir === "across" ? [0, 1] : [1, 0];
    const at = (rr, cc) => cells.get(`${rr},${cc}`);
    if (at(r - dr, c - dc) || at(r + dr * s.length, c + dc * s.length)) return -1;
    let cross = 0;
    for (let i = 0; i < s.length; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      const cell = at(rr, cc);
      if (cell) {
        if (cell.ch !== s[i] || cell[dir]) return -1;
        cross++;
      } else {
        // Рядом с новой буквой по бокам не должно быть чужих букв.
        if (at(rr + dc, cc + dr) || at(rr - dc, cc - dr)) return -1;
      }
    }
    return cross;
  };
  const put = (item, r, c, dir) => {
    const [dr, dc] = dir === "across" ? [0, 1] : [1, 0];
    const wordCells = [];
    for (let i = 0; i < item.s.length; i++) {
      const key = `${r + dr * i},${c + dc * i}`;
      const cell = cells.get(key) || { ch: item.s[i] };
      cell[dir] = true;
      cells.set(key, cell);
      wordCells.push(key);
    }
    placed.push({ ...item, r, c, dir, cells: wordCells });
  };
  const bounds = () => {
    const rs = [...cells.keys()].map((k) => +k.split(",")[0]);
    const cs = [...cells.keys()].map((k) => +k.split(",")[1]);
    return { h: Math.max(...rs) - Math.min(...rs) + 1, w: Math.max(...cs) - Math.min(...cs) + 1 };
  };
  const sorted = [...items].sort((a, b) => b.s.length - a.s.length);
  put(sorted[0], 0, 0, "across");
  for (const item of sorted.slice(1)) {
    if (placed.length >= CROSS_MAX) break;
    let best = null;
    for (const p of placed) {
      p.cells.forEach((key, pi) => {
        const [pr, pc] = key.split(",").map(Number);
        for (let i = 0; i < item.s.length; i++) {
          if (item.s[i] !== p.s[pi]) continue;
          const dir = p.dir === "across" ? "down" : "across";
          const r = dir === "down" ? pr - i : pr;
          const c = dir === "across" ? pc - i : pc;
          const cross = fits(item.s, r, c, dir);
          if (cross < 1) continue;
          // Компактнее — лучше: телефон узкий.
          put(item, r, c, dir);
          const b = bounds();
          placed.pop();
          item.s.split("").forEach((_, k) => {
            const key2 = dir === "across" ? `${r},${c + k}` : `${r + k},${c}`;
            const cell = cells.get(key2);
            if (cell) {
              delete cell[dir];
              if (!cell.across && !cell.down) cells.delete(key2);
            }
          });
          const score = cross * 10 - Math.max(b.w, b.h) - (b.w > 11 ? 50 : 0) + Math.random();
          if (!best || score > best.score) best = { r, c, dir, score };
        }
      });
    }
    if (best) put(item, best.r, best.c, best.dir);
  }
  // Сдвинуть к (0,0) и пронумеровать начала слов.
  const rs = [...cells.keys()].map((k) => +k.split(",")[0]);
  const cs = [...cells.keys()].map((k) => +k.split(",")[1]);
  const r0 = Math.min(...rs);
  const c0 = Math.min(...cs);
  const shift = (key) => {
    const [r, c] = key.split(",").map(Number);
    return `${r - r0},${c - c0}`;
  };
  placed.forEach((p) => {
    p.cells = p.cells.map(shift);
    p.r -= r0;
    p.c -= c0;
  });
  const grid = new Map([...cells.entries()].map(([k, v]) => [shift(k), v.ch]));
  const starts = [...new Set(placed.map((p) => p.cells[0]))].sort((a, b) => {
    const [ar, ac] = a.split(",").map(Number);
    const [br, bc] = b.split(",").map(Number);
    return ar - br || ac - bc;
  });
  placed.forEach((p) => (p.num = starts.indexOf(p.cells[0]) + 1));
  placed.sort((a, b) => a.num - b.num || (a.dir === "across" ? -1 : 1));
  return { placed, grid, h: Math.max(...rs) - r0 + 1, w: Math.max(...cs) - c0 + 1 };
}

function startCross() {
  const game = WORD_GAMES[2];
  const cands = wgPick(30, (w) => wgLetters(w, 3, 9));
  if (cands.length < game.min) return wgNotEnough(game);
  let cw = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const items = shuffle(cands)
      .slice(0, 12)
      .map((w) => ({ w, s: wgLetters(w, 3, 9) }))
      .filter((x, i, arr) => arr.findIndex((y) => y.s === x.s) === i);
    const res = buildCrossword(items);
    if (res.placed.length >= 5 && res.w <= 12 && (!cw || res.placed.length > cw.placed.length)) cw = res;
    if (cw && cw.placed.length >= CROSS_MAX) break;
  }
  if (!cw) return wgNotEnough(game);

  const g = wgOpen("cross");
  Object.assign(g, cw, { entry: new Map(), locked: new Set(), cur: 0, pos: 0, sec: 0, hints: 3, mistakes: 0, missed: new Set() });
  const main = document.getElementById("wg-main");
  main.innerHTML =
    '<div class="cross-grid"></div>' +
    '<div class="cross-current"></div>' +
    '<div class="cross-keys"></div>' +
    '<div class="cross-clues"></div>';
  const gridEl = main.querySelector(".cross-grid");
  const size = Math.min(40, Math.floor((Math.min(window.innerWidth, 640) - 32) / cw.w));
  gridEl.style.gridTemplateColumns = `repeat(${cw.w}, ${size}px)`;
  gridEl.style.gridAutoRows = `${size}px`;
  gridEl.style.fontSize = `${Math.round(size * 0.55)}px`;
  for (let r = 0; r < cw.h; r++)
    for (let c = 0; c < cw.w; c++) {
      const key = `${r},${c}`;
      const cell = document.createElement("div");
      if (cw.grid.has(key)) {
        cell.className = "cross-cell";
        cell.dataset.rc = key;
        const num = cw.placed.find((p) => p.cells[0] === key);
        if (num) cell.innerHTML = `<span class="cross-num">${num.num}</span>`;
        cell.appendChild(document.createElement("b"));
        cell.addEventListener("click", () => crossTapCell(g, key));
      } else cell.className = "cross-empty";
      gridEl.appendChild(cell);
    }
  const cluesEl = main.querySelector(".cross-clues");
  cw.placed.forEach((p, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cross-clue";
    row.innerHTML = `<span class="cross-clue-num">${p.num} ${p.dir === "across" ? "→" : "↓"}</span>`;
    row.appendChild(wgClue(p.w, "small"));
    row.addEventListener("click", () => crossSelect(g, i, 0));
    p.row = row;
    cluesEl.appendChild(row);
  });
  const keysEl = main.querySelector(".cross-keys");
  CROSS_KEYS.forEach((line) => {
    const row = document.createElement("div");
    row.className = "cross-key-row";
    [...line].forEach((ch) => {
      const k = document.createElement("button");
      k.type = "button";
      k.className = "cross-key" + (ch === "⌫" ? " wide" : "");
      k.textContent = ch;
      k.addEventListener("click", () => crossKey(g, ch));
      row.appendChild(k);
    });
    keysEl.appendChild(row);
  });
  wgStat("Время", "0:00");
  wgProgress("Слов", `0/${cw.placed.length}`);
  wgHintButton(g.hints, () => crossHint(g));
  g.timer = setInterval(() => {
    if (!wgAlive(g.token) || g.over) return clearInterval(g.timer);
    g.sec++;
    wgStat("Время", wgTime(g.sec));
  }, 1000);
  crossSelect(g, 0, 0);
}
function crossWordDone(g, p) {
  return p.cells.every((k) => g.locked.has(k));
}
function crossSelect(g, idx, pos) {
  g.cur = idx;
  const p = g.placed[idx];
  g.pos = Math.max(0, Math.min(pos, p.cells.length - 1));
  // Курсор — на первую пустую клетку слова.
  if (pos === 0) {
    const free = p.cells.findIndex((k) => !g.locked.has(k) && !g.entry.get(k));
    if (free >= 0) g.pos = free;
  }
  crossPaint(g);
}
// Тап по клетке: выбрать слово, в котором она есть; повторный тап по клетке под
// курсором на пересечении — сменить направление (→ / ↓).
function crossTapCell(g, key) {
  const idxs = g.placed.map((p, i) => (p.cells.includes(key) ? i : -1)).filter((i) => i >= 0);
  let idx = idxs[0];
  if (idxs.includes(g.cur)) {
    const onCursor = g.placed[g.cur].cells[g.pos] === key;
    idx = onCursor && idxs.length > 1 ? idxs.find((i) => i !== g.cur) : g.cur;
  }
  g.cur = idx;
  g.pos = g.placed[idx].cells.indexOf(key);
  crossPaint(g);
}
function crossPaint(g) {
  const p = g.placed[g.cur];
  document.querySelectorAll(".cross-cell").forEach((cell) => {
    const key = cell.dataset.rc;
    cell.querySelector("b").textContent = g.entry.get(key) || "";
    cell.classList.toggle("in-word", p.cells.includes(key));
    cell.classList.toggle("cursor", p.cells[g.pos] === key);
    cell.classList.toggle("locked", g.locked.has(key));
  });
  g.placed.forEach((x, i) => {
    x.row.classList.toggle("current", i === g.cur);
    x.row.classList.toggle("done", crossWordDone(g, x));
  });
  const curEl = document.querySelector(".cross-current");
  curEl.innerHTML = `<span class="cross-clue-num">${p.num} ${p.dir === "across" ? "→" : "↓"}</span>`;
  curEl.appendChild(wgClue(p.w, "small"));
  curEl.insertAdjacentHTML("beforeend", `<span class="cross-len">${p.cells.length} букв</span>`);
}
function crossKey(g, ch) {
  if (g.over) return;
  const p = g.placed[g.cur];
  if (ch === "⌫") {
    const key = p.cells[g.pos];
    if (!g.locked.has(key) && g.entry.get(key)) g.entry.delete(key);
    else if (g.pos > 0) {
      g.pos--;
      if (!g.locked.has(p.cells[g.pos])) g.entry.delete(p.cells[g.pos]);
    }
    return crossPaint(g);
  }
  const key = p.cells[g.pos];
  if (!g.locked.has(key)) g.entry.set(key, ch);
  // Дальше — следующая незапертая клетка.
  let next = g.pos + 1;
  while (next < p.cells.length && g.locked.has(p.cells[next])) next++;
  if (next < p.cells.length) g.pos = next;
  crossPaint(g);
  crossCheck(g, p);
}
function crossCheck(g, p) {
  if (!p.cells.every((k) => g.locked.has(k) || g.entry.get(k))) return;
  const typed = p.cells.map((k) => (g.locked.has(k) ? g.grid.get(k) : g.entry.get(k))).join("");
  if (typed === p.s) {
    p.cells.forEach((k) => {
      g.locked.add(k);
      g.entry.set(k, g.grid.get(k));
    });
    if (!g.missed.has(p.s)) bumpWordStreak(p.w.tr, true);
    speak(p.w.tr);
    const done = g.placed.filter((x) => crossWordDone(g, x)).length;
    wgProgress("Слов", `${done}/${g.placed.length}`);
    if (done === g.placed.length) return crossEnd(g);
    const nextIdx = g.placed.findIndex((x) => !crossWordDone(g, x));
    crossSelect(g, nextIdx, 0);
  } else {
    g.mistakes++;
    if (!g.missed.has(p.s)) {
      g.missed.add(p.s);
      bumpWordStreak(p.w.tr, false);
    }
    p.cells.forEach((k) => {
      const cell = document.querySelector(`.cross-cell[data-rc="${k}"]`);
      cell.classList.add("bad");
      setTimeout(() => cell.classList.remove("bad"), 700);
    });
  }
}
// Подсказка — верная буква в клетке под курсором.
function crossHint(g) {
  if (g.hints <= 0 || g.over) return;
  const p = g.placed[g.cur];
  let pos = g.pos;
  if (g.locked.has(p.cells[pos])) pos = p.cells.findIndex((k) => !g.locked.has(k));
  if (pos < 0) return;
  g.hints--;
  wgHintButton(g.hints, () => crossHint(g));
  const key = p.cells[pos];
  g.locked.add(key);
  g.entry.set(key, g.grid.get(key));
  g.missed.add(p.s);
  crossPaint(g);
  crossCheck(g, p);
}
function crossEnd(g) {
  crossPaint(g);
  const score = Math.max(10, 400 - g.sec - g.mistakes * 15 - (3 - g.hints) * 30);
  const best = wgSaveBest("cross", score);
  wgFinish({
    emoji: "✏️",
    title: "Кроссворд решён!",
    text: `Время: ${wgTime(g.sec)}, ошибок: ${g.mistakes}, подсказок: ${3 - g.hints}. Очки: ${score}${best ? " — новый рекорд" : ""}.`,
  });
}

// =====================================================================
// 👂 «Слушай и найди»: звучит турецкое слово — найти его среди 6 картинок/переводов.
// Ответила быстро (до 3 секунд) — бонус. 3 ошибки — раунд окончен.
// =====================================================================
const LISTEN_ROUND = 15;
const LISTEN_LIVES = 3;

function startListenGame() {
  const game = WORD_GAMES[3];
  if (!("speechSynthesis" in window)) {
    wgOpen("listen");
    return wgFinish({ emoji: "🔇", title: "Нет озвучки", text: "Этот браузер не умеет произносить слова — игра на слух недоступна." });
  }
  // Картинка запоминается лучше перевода — если слов с картинками хватает, только они.
  const hasPic = (w) => w.icon || COLOR_WORDS[w.tr] || NUMBER_VALUES[w.tr];
  const pics = getActiveDeck().filter(hasPic);
  const usePics = new Set(pics.map((w) => w.ru)).size >= 12;
  const words = wgPick(LISTEN_ROUND, (w) => w.ru && (!usePics || hasPic(w)));
  const all = usePics ? pics : getActiveDeck();
  if (words.length < game.min) return wgNotEnough(game);
  if (muted) {
    muted = false;
    document.getElementById("mute-btn").textContent = "🔊";
  }
  const g = wgOpen("listen");
  Object.assign(g, { words, all, idx: 0, lives: LISTEN_LIVES, right: 0 });
  document.getElementById("wg-main").innerHTML =
    '<button type="button" class="listen-play">🔊 Послушать ещё раз</button><div class="listen-options"></div>';
  document.querySelector(".listen-play").addEventListener("click", () => speak(g.target.tr));
  wgStat("Счёт", 0);
  wgLives(g.lives, LISTEN_LIVES);
  listenNext(g);
}
function listenNext(g) {
  if (g.idx >= g.words.length || g.lives <= 0) return listenEnd(g);
  g.target = g.words[g.idx++];
  g.answered = false;
  g.started = performance.now();
  wgProgress("Слово", `${g.idx}/${g.words.length}`);
  // Обманки — по возможности из той же темы, с другим переводом.
  const same = shuffle(g.all.filter((w) => w.theme === g.target.theme && w.ru !== g.target.ru && w.tr !== g.target.tr));
  const other = shuffle(g.all.filter((w) => w.theme !== g.target.theme && w.ru !== g.target.ru));
  const opts = [g.target];
  for (const w of [...same, ...other]) {
    if (opts.length >= 6) break;
    if (!opts.some((o) => o.ru === w.ru)) opts.push(w);
  }
  const box = document.querySelector(".listen-options");
  box.innerHTML = "";
  shuffle(opts).forEach((w) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "listen-option";
    b.appendChild(wgClue(w));
    b.addEventListener("click", () => listenAnswer(g, w, b));
    box.appendChild(b);
  });
  setTimeout(() => wgAlive(g.token) && speak(g.target.tr), 250);
}
function listenAnswer(g, w, btn) {
  if (g.answered || g.over) return;
  const ok = w.tr === g.target.tr;
  const right = [...document.querySelectorAll(".listen-option")].find((b) => b.querySelector(".wg-ru").textContent === g.target.ru);
  if (right) {
    right.classList.add("correct");
    right.insertAdjacentHTML("beforeend", `<span class="listen-tr">${escapeHtml(g.target.tr)}</span>`);
  }
  if (ok) {
    g.answered = true;
    wgCombo(true);
    g.right++;
    const fast = performance.now() - g.started < 3000;
    g.score += 10 + (fast ? 5 : 0) + Math.floor(wg.combo / 3) * 5;
    wgStat("Счёт", g.score);
    bumpWordStreak(g.target.tr, true);
    setTimeout(() => wgAlive(g.token) && listenNext(g), 900);
  } else {
    g.answered = true;
    btn.classList.add("wrong");
    wgCombo(false);
    bumpWordStreak(g.target.tr, false);
    g.lives--;
    wgLives(g.lives, LISTEN_LIVES);
    speak(g.target.tr);
    setTimeout(() => wgAlive(g.token) && listenNext(g), 1600);
  }
}
function listenEnd(g) {
  const best = wgSaveBest("listen", g.score);
  wgFinish({
    emoji: g.lives > 0 ? "👂" : "🙉",
    title: g.lives > 0 ? "Раунд пройден!" : "Три ошибки — раунд окончен",
    text: `Узнала на слух ${g.right} из ${g.idx}. Счёт: ${g.score}${best ? " — новый рекорд" : ""}. Лучшая серия: 🔥 ${wg.bestCombo}.`,
  });
}

// --- полоса игр в каталоге слов ---
function renderWordGamesStrip() {
  const el = document.getElementById("wg-buttons");
  if (!el) return;
  el.innerHTML = "";
  const mahjong = document.createElement("button");
  mahjong.type = "button";
  mahjong.className = "wg-card";
  mahjong.innerHTML = '<span class="wg-card-emoji">🀄</span><b>Маджонг</b><small>пары: слово и картинка</small>';
  mahjong.addEventListener("click", () => document.getElementById("catalog-next-btn").click());
  el.appendChild(mahjong);
  WORD_GAMES.forEach((game) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wg-card";
    const best = wgBest(game.id);
    b.innerHTML = `<span class="wg-card-emoji">${game.emoji}</span><b>${game.title}</b><small>${game.hint}${best ? ` · рекорд ${best}` : ""}</small>`;
    b.addEventListener("click", () => startWordGame(game.id));
    el.appendChild(b);
  });
}

function initWordGames() {
  document.getElementById("wg-back-btn").addEventListener("click", wgBack);
  document.getElementById("wg-exit-btn").addEventListener("click", wgBack);
  document.getElementById("wg-mute-btn").addEventListener("click", () => {
    muted = !muted;
    document.getElementById("wg-mute-btn").textContent = muted ? "🔇" : "🔊";
    document.getElementById("mute-btn").textContent = muted ? "🔇" : "🔊";
    if (muted && "speechSynthesis" in window) speechSynthesis.cancel();
  });
  renderWordGamesStrip();
}

initWordGames();
