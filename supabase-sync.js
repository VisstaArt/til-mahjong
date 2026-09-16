// Облачный прогресс через Supabase: экран входа/регистрации блокирует остальное
// приложение (см. window.authReady, которого дожидается init() в script.js), пока не
// подтверждена сессия. После входа: (1) тянем прогресс пользователя из таблицы
// user_progress и кладём поверх localStorage — если что-то реально изменилось,
// перезагружаем страницу ОДИН раз (см. sessionStorage-флаг), потому что все игровые
// модули (script.js/phrases.js/wordbank.js) читают localStorage в свои переменные один
// раз при загрузке скрипта, и "на лету" их не подменить; (2) дальше периодически и при
// уходе со страницы выгружаем localStorage обратно в облако.
//
// Схема таблицы — см. SQL, который пользователь выполнил в Supabase SQL Editor
// (assets тут не хранится — это одноразовая настройка на стороне Supabase).

const SUPABASE_URL = "https://orrdqcjqeprccpzicfmb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Bn7h4TJ6KYe8o60ySPSOTA_AbLz8SEB";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

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

  const { data, error } = await supabaseClient.from("user_progress").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("[supabase-sync] не удалось загрузить прогресс из облака", error);
    sessionStorage.setItem("til-hydrated", userId);
    return;
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
  if (changed) location.reload();
}

async function pushToCloud(userId) {
  const payload = { user_id: userId };
  for (const [localKey, column] of Object.entries(SYNCED_KEYS)) {
    try {
      payload[column] = JSON.parse(localStorage.getItem(localKey) || "null") ?? defaultForKey(localKey);
    } catch {
      payload[column] = defaultForKey(localKey);
    }
  }
  const { error } = await supabaseClient.from("user_progress").upsert(payload);
  if (error) console.error("[supabase-sync] не удалось сохранить прогресс в облако", error);
}

function translateAuthError(message) {
  const map = {
    "Invalid login credentials": "Неверная почта или пароль",
    "User already registered": "Такая почта уже зарегистрирована — попробуй войти",
    "Password should be at least 6 characters": "Пароль должен быть не короче 6 символов",
    "Email not confirmed": "Почта ещё не подтверждена — проверь письмо со ссылкой",
  };
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
    }
  });

  document.getElementById("account-logout-btn").addEventListener("click", async () => {
    if (currentUserId) await pushToCloud(currentUserId); // финальная выгрузка перед выходом
    clearInterval(pushTimer);
    pushTimer = null;
    sessionStorage.removeItem("til-hydrated");
    await supabaseClient.auth.signOut();
    location.reload();
  });
}

function initSupabaseSync() {
  initAuthForm();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session && !currentUserId) onAuthenticated(session);
  });

  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) {
      onAuthenticated(data.session);
    } else {
      document.body.dataset.screen = "auth";
      // window.authReady осознанно остаётся неразрешённым — дальше игра не пойдёт,
      // пока не будет успешного входа (см. форму выше).
    }
  });

  // Выгружаем прогресс перед уходом со страницы/сворачиванием — не ждать следующего
  // 10-секундного тика, если человек как раз закрыл вкладку сразу после ответа.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentUserId) pushToCloud(currentUserId);
  });
}

initSupabaseSync();
