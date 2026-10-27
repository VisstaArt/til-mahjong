// Облачный прогресс через Supabase: экран входа/регистрации блокирует остальное
// приложение (см. window.authReady, которого дожидается init() в script.js), пока не
// подтверждена сессия. После входа: (1) тянем прогресс пользователя из таблицы
// user_progress и кладём поверх localStorage — если что-то реально изменилось,
// перезагружаем страницу ОДИН раз (см. sessionStorage-флаг), потому что все игровые
// модули (script.js/phrases.js/wordbank.js) читают localStorage в свои переменные один
// раз при загрузке скрипта, и "на лету" их не подменить; (2) дальше периодически и при
// уходе со страницы выгружаем localStorage обратно в облако.
//
// Без интернета: войти заново нельзя (токен живёт час, обновить его можно только
// онлайн), но если на этом телефоне уже входили — пускаем играть на прогрессе из
// телефона (startOffline). Сыгранное офлайн помечается (UNSYNCED_KEY) и при следующей
// связи уходит в облако, а не затирается более старой облачной копией.
//
// Облако может и вовсе не отвечать при живом интернете: бесплатный проект Supabase
// засыпает после недели без заходов (адрес перестаёт существовать). Тогда на экране
// входа — «Играть на этом телефоне» (startLocal), а при следующем входе берём ту копию
// прогресса, где его больше: Safari сам стирает данные сайта, которым неделю не
// пользовались, и пустой телефон не должен затереть облако.
//
// Схема таблицы — см. SQL, который пользователь выполнил в Supabase SQL Editor
// (assets тут не хранится — это одноразовая настройка на стороне Supabase).

const SUPABASE_URL = "https://orrdqcjqeprccpzicfmb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Bn7h4TJ6KYe8o60ySPSOTA_AbLz8SEB";

// Библиотека с CDN; офлайн её может не оказаться в кеше — тогда играем без облака.
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
const SUPABASE_AUTH_KEY = "sb-orrdqcjqeprccpzicfmb-auth-token"; // где supabase-js хранит вход
const UNSYNCED_KEY = "til-unsynced"; // id пользователя, чей прогресс ещё не дошёл до облака
const SYNCED_SIG_KEY = "til-synced-sig"; // отпечаток прогресса, который точно есть в облаке
const NETWORK_WAIT_MS = 4000; // дольше слабую сеть не ждём — играем офлайн
const LOCAL_PLAY_KEY = "til-local-play"; // играли без входа, пока облако не отвечало
const WANT_LOGIN_KEY = "til-want-login"; // нажала «Войти» в игре без облака — показать форму

// Ключи localStorage <-> колонки таблицы user_progress — единственное место, где это
// сопоставление описано; если появится новый вид прогресса (например, для диалогов),
// достаточно добавить сюда одну строку и добавить колонку в таблице.
const SYNCED_KEYS = {
  "mahjong-word-progress": "word_progress",
  "mahjong-excluded-words": "excluded_words",
  "mahjong-loaded-categories": "loaded_categories",
  "mahjong-phrase-progress": "phrase_progress",
  "mahjong-phrase-excluded": "excluded_phrases",
  "mahjong-phrase-loaded-topics": "loaded_phrase_topics",
};

let authReadyResolve;
window.authReady = new Promise((resolve) => {
  authReadyResolve = resolve;
});

let currentUserId = null;
let pushTimer = null;

function defaultForKey(key) {
  return key.includes("excluded") || key.includes("loaded") ? [] : {};
}

// Тянем прогресс из облака поверх localStorage. Если для этого пользователя на этом
// устройстве уже делали (флаг переживает reload, но не переживает закрытие вкладки —
// так на каждый новый визит данные подтягиваются заново, а не зависают навсегда).
async function hydrateFromCloud(userId) {
  if (sessionStorage.getItem("til-hydrated") === userId) return;

  // В прошлый раз играли без сети и прогресс не дошёл до облака — сначала отправляем
  // своё; облачная копия старее, тянуть её поверх нельзя.
  if (localStorage.getItem(UNSYNCED_KEY) === userId) {
    await pushToCloud(userId);
    sessionStorage.setItem("til-hydrated", userId);
    return;
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), NETWORK_WAIT_MS);
  const { data, error } = await supabaseClient
    .from("user_progress")
    .select("*")
    .eq("user_id", userId)
    .abortSignal(abort.signal)
    .maybeSingle();
  clearTimeout(timer);
  if (error) {
    console.error("[supabase-sync] не удалось загрузить прогресс из облака", error);
    sessionStorage.setItem("til-hydrated", userId);
    return;
  }

  // Играли без входа: если на телефоне прогресса не меньше, чем в облаке, — он новее,
  // отправляем его. Меньше — телефон, видимо, всё забыл, берём облако.
  if (localStorage.getItem(LOCAL_PLAY_KEY)) {
    localStorage.removeItem(LOCAL_PLAY_KEY);
    if (progressSize(progressPayload(userId)) >= progressSize(data || {})) {
      await pushToCloud(userId);
      sessionStorage.setItem("til-hydrated", userId);
      return;
    }
  }

  let changed = false;
  for (const [localKey, column] of Object.entries(SYNCED_KEYS)) {
    const value = (data && data[column]) ?? defaultForKey(localKey);
    const newStr = JSON.stringify(value);
    if (localStorage.getItem(localKey) !== newStr) {
      localStorage.setItem(localKey, newStr);
      changed = true;
    }
  }

  if (!data) {
    // Первый вход этого пользователя — заводим ему строку в таблице.
    await supabaseClient.from("user_progress").insert({ user_id: userId });
  }

  sessionStorage.setItem("til-hydrated", userId);
  localStorage.setItem(SYNCED_SIG_KEY, progressSig(progressPayload(userId)));
  if (changed) location.reload();
}

function progressPayload(userId) {
  const payload = { user_id: userId };
  for (const [localKey, column] of Object.entries(SYNCED_KEYS)) {
    try {
      payload[column] = JSON.parse(localStorage.getItem(localKey) || "null") ?? defaultForKey(localKey);
    } catch {
      payload[column] = defaultForKey(localKey);
    }
  }
  return payload;
}
// Сколько всего записей прогресса (слов, фраз, тем) — чтобы сравнить две копии.
function progressSize(payload) {
  return Object.values(SYNCED_KEYS).reduce((n, column) => {
    const v = payload[column];
    return n + (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);
  }, 0);
}
// Короткий отпечаток (FNV-1a) — хранить вторую копию всего прогресса ради сравнения жалко.
function progressSig(payload) {
  const s = JSON.stringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${payload.user_id}:${s.length}:${(h >>> 0).toString(36)}`;
}

// true — облако получило прогресс.
async function pushToCloud(userId) {
  const payload = progressPayload(userId);
  const sig = progressSig(payload);
  const { error } = supabaseClient
    ? await supabaseClient.from("user_progress").upsert(payload)
    : { error: "нет библиотеки Supabase" };
  if (error) {
    console.error("[supabase-sync] не удалось сохранить прогресс в облако", error);
    // Нет сети, а прогресс менялся после последней синхронизации — запоминаем, чтобы
    // при следующем входе отправить его, а не затереть облачной копией.
    if (localStorage.getItem(SYNCED_SIG_KEY) !== sig) localStorage.setItem(UNSYNCED_KEY, userId);
    return false;
  }
  localStorage.setItem(SYNCED_SIG_KEY, sig);
  localStorage.removeItem(UNSYNCED_KEY);
  return true;
}

function translateAuthError(message) {
  const map = {
    "Invalid login credentials": "Неверная почта или пароль",
    "User already registered": "Такая почта уже зарегистрирована — попробуй войти",
    "Password should be at least 6 characters": "Пароль должен быть не короче 6 символов",
    "Email not confirmed": "Почта ещё не подтверждена — проверь письмо со ссылкой",
  };
  if (/fetch|load failed|network/i.test(message)) return "Нет связи с облаком";
  return map[message] || message;
}

async function onAuthenticated(session) {
  currentUserId = session.user.id;
  document.getElementById("account-email").textContent = session.user.email;
  document.getElementById("account-box").classList.remove("hidden");

  await hydrateFromCloud(currentUserId); // может перезагрузить страницу — тогда дальше не пойдём

  if (document.body.dataset.screen === "auth") document.body.dataset.screen = "catalog";
  authReadyResolve();

  if (!pushTimer) pushTimer = setInterval(() => pushToCloud(currentUserId), 10000);
}

function initAuthForm() {
  const form = document.getElementById("auth-form");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const errorEl = document.getElementById("auth-error");
  const statusEl = document.getElementById("auth-status");
  const submitBtn = document.getElementById("auth-submit-btn");
  const toggleBtn = document.getElementById("auth-toggle-btn");

  let mode = "login"; // | "register"

  toggleBtn.addEventListener("click", () => {
    mode = mode === "login" ? "register" : "login";
    submitBtn.textContent = mode === "login" ? "Войти" : "Зарегистрироваться";
    toggleBtn.textContent = mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти";
    errorEl.classList.add("hidden");
    statusEl.classList.add("hidden");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    statusEl.classList.add("hidden");
    submitBtn.disabled = true;

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
      if (mode === "login") {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          statusEl.textContent = "Проверь почту и перейди по ссылке для подтверждения — потом можно будет войти.";
          statusEl.classList.remove("hidden");
          submitBtn.disabled = false;
          return;
        }
      }
      // Дальше подхватит onAuthStateChange -> onAuthenticated.
    } catch (err) {
      errorEl.textContent = translateAuthError(err.message);
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      if (!(await cloudReachable())) showCloudDown();
    }
  });

  document.getElementById("auth-local-btn").addEventListener("click", startLocal);

  document.getElementById("account-logout-btn").addEventListener("click", async () => {
    if (!currentUserId) {
      // Играли без облака — эта кнопка «Войти».
      sessionStorage.setItem(WANT_LOGIN_KEY, "1");
      location.reload();
      return;
    }
    await pushToCloud(currentUserId); // финальная выгрузка перед выходом
    clearInterval(pushTimer);
    pushTimer = null;
    sessionStorage.removeItem("til-hydrated");
    await supabaseClient.auth.signOut();
    location.reload();
  });
}

// Кто входил на этом телефоне (supabase-js держит это в localStorage даже с протухшим токеном).
function storedUser() {
  try {
    const s = JSON.parse(localStorage.getItem(SUPABASE_AUTH_KEY) || "null");
    return (s && s.user && s.user.id && s.user) || null;
  } catch {
    return null;
  }
}

// Играем без облака на прогрессе из телефона. Выгрузка по таймеру продолжает
// пытаться — как только сеть вернётся, supabase-js сам обновит токен и прогресс уйдёт.
function startOffline(user) {
  currentUserId = user.id;
  const why = navigator.onLine === false ? "без сети" : "облако не отвечает";
  document.getElementById("account-email").textContent = `${user.email} · ${why}`;
  document.getElementById("account-box").classList.remove("hidden");
  authReadyResolve();
  if (!pushTimer) pushTimer = setInterval(() => pushToCloud(currentUserId), 10000);
}

// Облако вообще отвечает? Любой ответ сервера (кроме 5xx) — да; нет адреса или молчит — нет.
async function cloudReachable() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), NETWORK_WAIT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      signal: abort.signal,
    });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function showCloudDown() {
  document.getElementById("auth-cloud-down").classList.remove("hidden");
}

// Играем без входа на прогрессе из телефона: в облако ничего не уходит, пока не войдёшь.
function startLocal() {
  if (currentUserId) return;
  localStorage.setItem(LOCAL_PLAY_KEY, "1");
  document.getElementById("account-email").textContent = "без облака";
  document.getElementById("account-logout-btn").textContent = "Войти";
  document.getElementById("account-box").classList.remove("hidden");
  if (document.body.dataset.screen === "auth") document.body.dataset.screen = "catalog";
  authReadyResolve();
}

// Экран входа. Облако не отвечает — объясняем и даём играть; уже так играли — сразу пускаем.
async function showAuthScreen(wantLogin) {
  document.body.dataset.screen = "auth";
  if (await cloudReachable()) return;
  if (currentUserId) return;
  if (localStorage.getItem(LOCAL_PLAY_KEY) && !wantLogin) startLocal();
  else showCloudDown();
}

function initSupabaseSync() {
  const wantLogin = sessionStorage.getItem(WANT_LOGIN_KEY);
  sessionStorage.removeItem(WANT_LOGIN_KEY);
  const stored = storedUser();
  if (!supabaseClient) {
    // Библиотеки входа нет (офлайн и не успела закешироваться) — играем локально.
    if (stored) startOffline(stored);
    else authReadyResolve();
    return;
  }
  initAuthForm();

  // Выгружаем прогресс перед уходом со страницы/сворачиванием — не ждать следующего
  // 10-секундного тика, если человек как раз закрыл вкладку сразу после ответа.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentUserId) pushToCloud(currentUserId);
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && !currentUserId) onAuthenticated(session);
  });

  // Сети точно нет — не ждём: supabase-js полминуты пытался бы обновить токен, а всё
  // это время висел бы экран входа.
  if (stored && navigator.onLine === false) {
    startOffline(stored);
    return;
  }
  // Сеть «есть», но не отвечает — тоже не держим человека на экране входа.
  const slow = stored ? setTimeout(() => !currentUserId && startOffline(stored), NETWORK_WAIT_MS) : null;

  supabaseClient.auth.getSession().then(({ data, error }) => {
    clearTimeout(slow);
    if (currentUserId) return;
    if (data.session) {
      onAuthenticated(data.session);
    } else if (error && storedUser()) {
      // Токен не обновился из-за сети (при настоящей ошибке входа supabase-js стёр бы его).
      startOffline(storedUser());
    } else {
      // window.authReady осознанно остаётся неразрешённым — дальше игра не пойдёт,
      // пока не будет успешного входа (см. форму выше) или игры без облака.
      showAuthScreen(wantLogin);
    }
  });
}

initSupabaseSync();
