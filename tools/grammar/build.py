"""Собирает упражнения раздела «Грамматика» из фраз и диалогов приложения.

Запуск:  python3 tools/grammar/build.py
Пишет:   assets/grammar/items.json  — фразы с размеченными «пропусками»
         tools/grammar/unmatched.txt — формы на -yor, для которых не нашёлся глагол
                                       в словаре (кандидаты в extra-verbs.txt)

Разметка проверяется генератором: слово попадает в упражнение, только если morph.py
из (инфинитив, лицо / падеж) получает ровно такое же написание, как во фразе. Всё, что
не сошлось, в упражнения не идёт — лучше меньше фраз, чем неверная «правильная» форма.
"""

import copy
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import levels  # noqa: E402
import morph  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "grammar", "items.json")
UNMATCHED = os.path.join(os.path.dirname(__file__), "unmatched.txt")
EXTRA_VERBS = os.path.join(os.path.dirname(__file__), "extra-verbs.txt")
EXTRA_NOUNS = os.path.join(os.path.dirname(__file__), "extra-nouns.txt")
# Пути тем — ступени со своими короткими фразами (path-<тема>.txt), в порядке прохождения.
PATH_TOPICS = ["yor", "case", "cop", "poss", "acc", "di", "want", "ecek", "with"]
PATH_OUT = os.path.join(ROOT, "assets", "grammar", "path.json")
# Фраза из разговорника/диалога идёт в ступень «В жизни» только если она короткая и по
# грамматике не выше этого уровня (оценка levels.py) — иначе для начинающих слишком сложно.
LIFE_MAX_WORDS = 8
LIFE_LEVELS = {"A1"}

# Служебные слова, которые случайно совпадают с падежной формой какого-нибудь
# существительного из словаря (il → ile, an → ana…). Их не трогаем.
STOP = {
    "ile", "ama", "ana", "bana", "sana", "ona", "gece", "öte", "bile", "yine", "daha",
    "önce", "sonra", "göre", "kadar", "beri", "işte", "belki", "keşke", "hala", "hâlâ",
    "şimdi", "yarın", "dün", "bugün", "hepsi", "neden", "nereden", "birde", "bende",
    "sende", "bizde", "sizde", "onda", "bunda", "şunda", "buna", "şuna", "kime", "neye",
    "tane", "tamam", "banka", "ekleme", "güle", "taksim", "evet", "hayır", "yani", "aslında", "yeter", "kere", "defa",
}
# Слова-«места»: bura/şura/ora/nere — сами по себе не встречаются, только с падежом.
PLACE_WORDS = {"bura": "здесь/сюда", "şura": "там (рядом)", "ora": "там/туда", "nere": "где/куда"}

WORD_RE = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû']+")


def tr_lower(s):
    return s.replace("I", "ı").replace("İ", "i").lower()


# Перевод отдельных слов фразы — для подсказки «что это за слово» в игре. Словарь
# маджонга + частые служебные слова, которых там нет (или они там с другим смыслом).
WORDS_RU = {}
WORD_PARTS = set()  # отдельные слова из многословных записей словаря (doğum günü → doğum)
WORD_PARTS_PAIRS = set()  # сами многословные записи (cep telefonu)
BASIC_GLOSS = {
    "ben": "я", "sen": "ты", "o": "он, она", "biz": "мы", "siz": "вы", "onlar": "они",
    "her": "каждый", "bir": "один, какой-то", "ve": "и", "de": "тоже", "da": "тоже",
    "ne": "что", "neden": "почему", "kim": "кто", "çok": "много, очень", "şimdi": "сейчас",
    "bugün": "сегодня", "yarın": "завтра", "akşam": "вечер, вечером", "sabah": "утро, утром",
    "erken": "рано", "geç": "поздно", "biraz": "немного", "hiç": "совсем (не)", "güzel": "красивый, хорошо",
    "hızlı": "быстро", "doğru": "правильно", "yazın": "летом", "gün": "день",
    "mu": "частица вопроса", "mı": "частица вопроса", "mi": "частица вопроса", "mü": "частица вопроса",
    "musun": "частица вопроса (ты)", "musunuz": "частица вопроса (вы)", "muyum": "частица вопроса (я)",
    "muyuz": "частица вопроса (мы)",
    "evet": "да", "hayır": "нет", "tamam": "хорошо, ладно", "merhaba": "привет",
    "teşekkürler": "спасибо", "teşekkür": "спасибо", "lütfen": "пожалуйста", "ama": "но",
    "çünkü": "потому что", "sonra": "потом", "şimdi": "сейчас", "değil": "не",
    "burada": "здесь", "orada": "там", "nerede": "где", "bu": "этот, это", "şu": "тот",
    "ya": "а (ты?)", "harika": "отлично", "peki": "ладно", "affedersiniz": "извините",
    "benim": "мой", "senin": "твой", "onun": "его, её", "bizim": "наш", "sizin": "ваш",
    "onların": "их", "kaç": "сколько", "yaşında": "лет (возраст)",
}
NAMES = {"olga", "leyla", "anya", "deniz", "tuba", "pamuk", "metin", "bey", "kemal"}
# Слова, которые могут быть сказуемым с «быть» (öğretmenim, yorgunum): существительные и
# прилагательные словаря + extra-nouns.txt. Заполняется в load_lexicon.
NOMINALS = {}
ADJECTIVES = set()


def gloss_for(word):
    low = tr_lower(word)
    if low in NAMES:
        return "имя"
    return BASIC_GLOSS.get(low) or WORDS_RU.get(low, "")


def load_lexicon():
    verbs, nouns, all_words = {}, {}, set()
    for f in glob.glob(os.path.join(ROOT, "assets", "words", "*.json")):
        if os.path.basename(f) in ("manifest.json", "levels.json"):
            continue
        for w in json.load(open(f, encoding="utf-8")):
            tr = tr_lower((w.get("tr") or "").strip())
            if not tr:
                continue
            all_words.add(tr)
            if " " in tr or "/" in tr or "," in tr:
                WORD_PARTS.update(x for x in re.split(r"[\s/,()]+", tr) if x)
                WORD_PARTS_PAIRS.add(tr)
                continue
            WORDS_RU.setdefault(tr, w.get("ru", ""))
            if w.get("pos") in ("noun", "adjective"):
                NOMINALS.setdefault(tr, w.get("ru", ""))
                if w.get("pos") == "adjective":
                    ADJECTIVES.add(tr)
            if w.get("pos") == "verb" and re.search(r"m[ae]k$", tr):
                verbs.setdefault(tr, w.get("ru", ""))
            elif w.get("pos") == "noun":
                nouns.setdefault(tr, w.get("ru", ""))
    for path, target in ((EXTRA_NOUNS, nouns),):
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                line = line.split("#")[0].strip()
                if line:
                    word, _, ru = line.partition("=")
                    target.setdefault(tr_lower(word.strip()), ru.strip())
                    NOMINALS.setdefault(tr_lower(word.strip()), ru.strip())
    if os.path.exists(EXTRA_VERBS):
        for line in open(EXTRA_VERBS, encoding="utf-8"):
            line = line.split("#")[0].strip()
            if not line:
                continue
            inf, _, ru = line.partition("=")
            verbs.setdefault(tr_lower(inf.strip()), ru.strip())
    return verbs, nouns, all_words


def load_paths():
    """Читает path-<тема>.txt: ступени («## Название | подсказка | words=N | gate | life»)
    и их фразы. Возвращает (фразы как источники, описание пути для приложения)."""
    out, path = [], []
    for topic in PATH_TOPICS:
        stages = []
        fname = os.path.join(os.path.dirname(__file__), f"path-{topic}.txt")
        for line in open(fname, encoding="utf-8"):
            line = line.strip()
            if not line or (line.startswith("#") and not line.startswith("## ")):
                continue
            if line.startswith("## "):
                fields = [f.strip() for f in line[3:].split("|")]
                stage = {"title": fields[0], "hint": fields[1] if len(fields) > 1 else "", "words": 1, "count": 0}
                for f in fields[2:]:
                    if f.startswith("words="):
                        stage["words"] = int(f[6:])
                    elif f in ("gate", "life"):
                        stage[f] = True
                stages.append(stage)
                continue
            tr, _, ru = line.partition("|")
            stages[-1]["count"] += 1
            out.append({"ru": ru.strip(), "tr": tr.strip(), "src": "База", "tier": "base",
                        "baseTopic": topic, "stage": len(stages) - 1})
        path.append({"id": topic, "stages": stages})
    return out, path


def load_sources():
    """Фразы и реплики диалогов в одном виде: {id, ru, tr, src, tier}. Сначала «База»,
    чтобы при совпадении текста фраза считалась своей, а не из разговорника."""
    out = load_paths()[0]
    pm = json.load(open(os.path.join(ROOT, "assets", "phrases", "manifest.json"), encoding="utf-8"))
    titles = {m["id"]: m["title"] for m in pm}
    # Идиомы с Allah — застывшие выражения, часто со старой грамматикой: на них
    # правила не тренируют.
    skip = {m["id"] for m in pm if m.get("source") == "allah"}
    for f in sorted(glob.glob(os.path.join(ROOT, "assets", "phrases", "*.json"))):
        tid = os.path.basename(f)[:-5]
        if tid == "manifest" or tid in skip:
            continue
        data = json.load(open(f, encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("phrases", [])
        for p in items:
            if p.get("tr") and p.get("ru"):
                out.append({"ru": p["ru"], "tr": p["tr"], "src": f"Фразы · {titles.get(tid, tid)}", "tier": "life", "level": p.get("level")})
    for f in sorted(glob.glob(os.path.join(ROOT, "assets", "dialogues", "*.json"))):
        if f.endswith("manifest.json"):
            continue
        topic = json.load(open(f, encoding="utf-8"))
        for d in topic.get("dialogues", []):
            for t in d.get("turns", []):
                if t.get("tr") and t.get("ru"):
                    out.append({"ru": t["ru"], "tr": t["tr"], "src": f"Диалоги · {d['title']}", "tier": "life", "level": t.get("level") or d.get("level")})
    seen, uniq = set(), []
    for it in out:
        key = it["tr"].strip()
        if key in seen:
            if it.get("tier") == "base":
                print(f"ВНИМАНИЕ: фраза пути повторяется — второй раз пропущена: «{key}»")
            continue
        seen.add(key)
        uniq.append(it)
    return uniq


# --- -yor ---
YOR_RE = re.compile(r"^(.+?)yor(um|sun|uz|sunuz|lar)?$")
Q_PARTICLE = {v: k for k, v in morph.YOR_QUESTION.items() if k != "onlar"}
YOR_END = {v: k for k, v in morph.YOR_PERSON.items()}


def yor_candidates(base):
    """base — всё до «yor». Какие инфинитивы могли дать такую основу."""
    cands = []
    if base and base[-1] in "ıiuü":
        pre = base[:-1]
        cands.append((base, False))  # oku + yor
        cands.append((pre, False))  # çalış + ıyor
        for v in "ae":
            cands.append((pre + v, False))  # bekl + iyor ← bekle
        if pre.endswith("d"):
            cands.append((pre[:-1] + "t", False))  # gid → git
        if len(pre) >= 2 and pre[-1] == "m":
            cands.append((pre[:-1], True))  # bil + mi + yor
    if base in ("di", "yi"):
        cands.append((base[0] + "e", False))
    return cands


def match_yor(token, next_token, verbs):
    m = YOR_RE.match(token)
    if not m:
        return None
    base, end = m.group(1), m.group(2) or ""
    question = False
    if end == "" and next_token in Q_PARTICLE:
        question = True
        persons = [Q_PARTICLE[next_token]]
    elif end == "lar" and next_token == "mı":
        question = True
        persons = ["onlar"]
    else:
        persons = [YOR_END[end]]
    found = []
    for stem, neg in yor_candidates(base):
        for suf in ("mak", "mek"):
            inf = stem + suf
            if inf not in verbs:
                continue
            for person in persons:
                form = morph.yor(inf, person, negative=neg, question=question)
                target = token + (" " + next_token if question else "")
                if form.word == target:
                    found.append((inf, person, neg, question, form))
    # Однозначность: если подошли два разных глагола — не рискуем.
    if len({f[0] for f in found}) != 1:
        return None if found else ("unmatched", base)
    return found[0]


# --- прошедшее -dı ---
DI_ENDINGS = [("onlar", ("lar", "ler")), ("siz", ("nız", "niz", "nuz", "nüz")), ("ben", ("m",)), ("sen", ("n",)), ("biz", ("k",)), ("o", ("",))]
Q_PARTICLES = {"mı", "mi", "mu", "mü"}


def match_di(token, next_token, verbs, all_words):
    """geldim, yaptın, gitti, gelmedik, geldin mi — проверяется генератором."""
    if token in all_words or token in STOP:
        return None
    question = next_token in Q_PARTICLES
    found = []
    for person, ends in DI_ENDINGS:
        for end in ends:
            if end and not token.endswith(end):
                continue
            rest = token[: len(token) - len(end)] if end else token
            if len(rest) < 4 or rest[-2] not in "dt" or rest[-1] not in "ıiuü":
                continue
            base = rest[:-2]
            cands = [(base, False)]
            if base[-2:] in ("ma", "me") and len(base) > 3:
                cands.append((base[:-2], True))
            for stem, neg in cands:
                for suf in ("mak", "mek"):
                    inf = stem + suf
                    if inf not in verbs:
                        continue
                    f = morph.di(inf, person, negative=neg, question=question)
                    target = token + (" " + next_token if question else "")
                    if f.word == target:
                        found.append((inf, person, neg, question, f))
    if len({x[0] for x in found}) != 1:
        return None
    return found[0]


# --- хочу / надо / сделайте ---
MELI_RE = re.compile(r"^(.+?)(m[ae]l[ıi])(.*)$")
IMP_AMBIGUOUS = {"sorun", "yazın", "yakın", "alın", "gelin", "olun"}
IMP_RE = re.compile(r"^(.+?)(y?[ıiuü]n)$")


def match_want(tokens, i, tr, verbs, all_words, life):
    """içmek (istiyorum), gitmeliyim, oturun, gitme! — с проверкой генератором."""
    raw, s, e = tokens[i]
    low = tr_lower(raw)
    nxt = tr_lower(tokens[i + 1][0]) if i + 1 < len(tokens) else ""
    if low in STOP:
        return None
    # хочу + инфинитив
    if low in verbs and re.search(r"m[ae]k$", low) and nxt.startswith(("iste", "isti", "ister")):
        return morph.infinitive_form(low), low
    # надо / нельзя
    m = MELI_RE.match(low)
    if m:
        for stem, neg in ((m.group(1), False), (m.group(1)[:-2], True)):
            for suf in ("mak", "mek"):
                inf = stem + suf
                if inf not in verbs:
                    continue
                for person in morph.PERSONS:
                    f = morph.meli(inf, person, negative=neg)
                    if f.word == low:
                        return f, inf
    after = tr[e:].lstrip()[:1]
    # Повелительное, совпадающее с обычным словом (yakın — «близкий», yazın — «летом»,
    # sorun — «проблема», gelin — «невеста»), верим только в просьбе: lütfen или «!».
    if (low in all_words or low in WORD_PARTS or low in IMP_AMBIGUOUS) and not (
        "lütfen" in tr_lower(tr) or "!" in tr
    ):
        return None
    # сделайте: oturun, bekleyin, gidin, içmeyin
    m = IMP_RE.match(low)
    if m:
        base = m.group(1)
        cands = [(base, False)]
        if base.endswith("d"):
            cands.append((base[:-1] + "t", False))
        if base[-2:] in ("ma", "me"):
            cands.append((base[:-2], True))
        if base.endswith("y"):
            cands.append((base[:-1], False))
            if base[-3:-1] in ("ma", "me"):
                cands.append((base[:-3], True))
        for stem, neg in cands:
            for suf in ("mak", "mek"):
                inf = stem + suf
                if inf in verbs and morph.imperative(inf, "siz", negative=neg).word == low:
                    return morph.imperative(inf, "siz", negative=neg), inf
    # не делай: gitme!, ağlama!
    if low[-2:] in ("ma", "me") and (after == "!" or (not life and after in ",.")):
        for suf in ("mak", "mek"):
            inf = low[:-2] + suf
            if inf in verbs and morph.imperative(inf, "sen", negative=True).word == low:
                return morph.imperative(inf, "sen", negative=True), inf
    return None


# --- будущее -(y)ecek ---
ECEK_RE = re.compile(r"^(.+?)(y?)(acak|acağ|ecek|eceğ)(.*)$")
ECEK_Q = {}
for _v in "ıi":
    ECEK_Q.update({f"m{_v}y{_v}m": "ben", f"m{_v}s{_v}n": "sen", f"m{_v}": "o", f"m{_v}y{_v}z": "biz", f"m{_v}s{_v}n{_v}z": "siz"})


def match_ecek(token, next_token, verbs, all_words, life):
    m = ECEK_RE.match(token)
    if not m:
        return None
    question = next_token in ECEK_Q
    # gelecek — «будущий», içecek — «напиток»: во фразах из жизни глаголом не считаем.
    if life and token in all_words and not question:
        return None
    # «gelecek hafta» — «на следующей неделе», это прилагательное, а не «придёт».
    if not question and next_token in ("hafta", "ay", "yıl", "sene", "yaz", "kış", "sefer", "sefere", "gün"):
        return None
    base = m.group(1)
    cands = [(base, False)]
    if m.group(2):  # giy-ecek: y — часть основы, а не связка
        cands.append((base + m.group(2), False))
    if base[-2:] in ("ma", "me") and len(base) > 3:
        cands.append((base[:-2], True))
    if base.endswith("d"):
        cands.append((base[:-1] + "t", False))
    if base in ("yi", "di"):
        cands.append((base[0] + "e", False))
    persons = morph.PERSONS
    if question:
        persons = [ECEK_Q[next_token]]
        if token.endswith(("lar", "ler")) and next_token in ("mı", "mi"):
            persons = ["onlar"]
    found = []
    for stem, neg in cands:
        for suf in ("mak", "mek"):
            inf = stem + suf
            if inf not in verbs:
                continue
            for person in persons:
                f = morph.ecek(inf, person, negative=neg, question=question)
                if f.word == token + (" " + next_token if question else ""):
                    found.append((inf, person, neg, question, f))
    if len({x[0] for x in found}) != 1:
        return None
    return found[0]


# --- с кем? чем? -(y)la ---
WITH_PROPER_RE = re.compile(r"^([A-ZÇĞİÖŞÜ][\wçğıöşü]+)'(y?l[ae])$")
PRONOUN_WITH_WORDS = {"benimle": "ben", "seninle": "sen", "onunla": "o", "bizimle": "biz", "sizinle": "siz", "onlarla": "onlar"}


def build_with_index(nouns, all_words):
    idx = {}
    for lemma in nouns:
        if len(lemma) < 2 or " " in lemma:
            continue
        variants = [(None, morph.with_form(lemma))] + [(p, morph.with_form(lemma, poss=p)) for p in morph.PERSONS]
        for person, f in variants:
            w = tr_lower(f.word)
            if w in STOP or w in all_words or w in WORD_PARTS:
                continue
            idx.setdefault(w, []).append((lemma, person, f))
    return idx


def match_with(tokens, i, with_idx, sentence_words, life):
    raw = tokens[i][0]
    low = tr_lower(raw)
    if low in PRONOUN_WITH_WORDS:
        p = PRONOUN_WITH_WORDS[low]
        return p, morph.with_form("", pronoun=p)
    m = WITH_PROPER_RE.match(raw)
    if m:
        f = morph.with_form(m.group(1), proper=True)
        return (m.group(1), f) if f.word == raw else None
    cands = with_idx.get(low)
    if not cands:
        return None
    prev = tokens[i - 1][0] if i > 0 else ""
    prev_gen = tr_lower(prev) == "onun" or bool(GEN_RE.match(prev))
    for lemma, person, f in cands:
        if person == "sen" and "senin" not in sentence_words and (life or "sen" not in sentence_words):
            continue
        if person in ("o", "onlar") and life and not prev_gen:
            continue
        return lemma, f
    return None


# --- падежи ---
def build_case_index(nouns, all_words):
    idx = {}

    def add(form, lemma, case, **kw):
        w = tr_lower(form.word)
        # bura/şura/ora/nere — сами по себе в словаре (burada, nereye), но это и есть
        # падежи, которые тренируем; остальные совпадения со словарём — не трогаем.
        if lemma not in PLACE_WORDS and (w in STOP or w in all_words):
            return
        idx.setdefault(w, []).append((lemma, case, kw, form))

    for lemma in list(nouns) + list(PLACE_WORDS):
        if len(lemma) < 2:
            continue
        for case in morph.CASES:
            add(morph.noun_case(lemma, case), lemma, case)
            add(morph.noun_case(lemma, case, plural=True), lemma, case, plural=True)
            if case == "dat" and lemma[-1] in morph.SOFTEN and len([c for c in lemma if c in morph.VOWELS]) > 1:
                add(morph.noun_case(lemma, case, soften=True), lemma, case, soften=True)
    # Одинаковое написание у разных слов/падежей — неоднозначно, выбрасываем.
    return {w: v[0] for w, v in idx.items() if len({(x[0], x[1]) for x in v}) == 1}


PROPER_RE = re.compile(r"^([A-ZÇĞİÖŞÜ][\wçğıöşü]+)'(ya|ye|a|e|da|de|ta|te|dan|den|tan|ten)$")


def match_proper(token):
    m = PROPER_RE.match(token)
    if not m:
        return None
    name, suf = m.group(1), m.group(2)
    # Allah'a şükür, Allah'tan… — застывшие формулы (LEGEND.md, «Живая речь»), не падеж на тренировку.
    if name == "Allah":
        return None
    case = "abl" if suf.endswith("n") else ("loc" if suf[0] in "dt" else "dat")
    form = morph.noun_case(tr_lower(name), case, proper=True)
    if tr_lower(form.word) != tr_lower(token):
        return None
    form.parts[0].text = name
    form.parts[0].options = [name]
    form.word = token
    return name, case, form


# --- «быть»: öğretmenim, evdeyim, yorgun değilim, hasta mısın? ---
NEG_FORMS = {"değilim": "ben", "değilsin": "sen", "değil": "o", "değiliz": "biz", "değilsiniz": "siz", "değiller": "onlar"}
Q_FORMS = {}
for _v in "ıiuü":
    Q_FORMS.update({f"m{_v}y{_v}m": "ben", f"m{_v}s{_v}n": "sen", f"m{_v}": "o", f"m{_v}y{_v}z": "biz", f"m{_v}s{_v}n{_v}z": "siz"})
NOT_PREDICATE = {"var", "yok", "ne", "bu", "şu", "o"}


def _cop_base(raw, case_idx, verbs):
    """Чем может быть основа сказуемого: (lemma, pre-форма с падежом или None, перевод)."""
    low = tr_lower(raw)
    if "'" in raw:
        name, _, rest = raw.partition("'")
        if len(name) < 2 or not rest:
            return None
        for case in ("loc", "abl"):
            f = morph.noun_case(tr_lower(name), case, proper=True)
            if tr_lower(f.word) == low:
                f.parts[0].text = name
                f.parts[0].options = [name]
                return name, f, ""
        return None
    if low in case_idx:
        lemma, case, kw, f = case_idx[low]
        if case in ("loc", "abl"):
            return lemma, f, NOMINALS.get(lemma, "")
        return None
    if low in NOMINALS and low not in verbs and low not in STOP and low not in NOT_PREDICATE and len(low) >= 2:
        return raw, None, NOMINALS[low]
    return None


VERBISH_RE = re.compile(r"([ae]c[ae][kğ]|m[ıiuü]ş|[ıiuü]yor)$")


def _clause_ends_after(tr, pos):
    """После позиции — конец фразы/части (?, ., !, запятая) или конец строки. Иначе mı/değil
    стоит посреди глагольного предложения (Tatilden mi dönüyorsunuz?) — это не «быть»."""
    rest = tr[pos:].lstrip()
    return not rest or rest[0] in "?.!,;…"


def match_cop(tokens, i, tr, case_idx, verbs, sentence_words, all_words):
    """Возвращает (form, start, end, lemma, gloss, person, сколько токенов съели) или None."""
    raw, s, e = tokens[i]
    nxt_raw = tokens[i + 1][0] if i + 1 < len(tokens) else ""
    nxt = tr_lower(nxt_raw)
    if VERBISH_RE.search(tr_lower(raw)):
        return None
    clause_end = i + 1 < len(tokens) and _clause_ends_after(tr, tokens[i + 1][2])
    # отрицание: yorgun değilim
    if nxt in NEG_FORMS and clause_end:
        base = _cop_base(raw, case_idx, verbs)
        if base:
            lemma, pre, gloss = base
            person = NEG_FORMS[nxt]
            f = morph.copula(raw, person, negative=True, pre=pre)
            if tr_lower(f.word) == tr_lower(f"{raw} {nxt_raw}"):
                return f, s, tokens[i + 1][2], lemma, gloss, person, 2
    # вопрос: hasta mısın? / evdeler mi?
    if nxt in Q_FORMS and clause_end:
        person = Q_FORMS[nxt]
        cands = [(raw, person)]
        if person == "o" and tr_lower(raw)[-3:] in ("lar", "ler"):
            cands.append((raw[:-3], "onlar"))
        for word, pers in cands:
            base = _cop_base(word, case_idx, verbs)
            if not base:
                continue
            lemma, pre, gloss = base
            f = morph.copula(word, pers, question=True, pre=pre)
            if tr_lower(f.word) == tr_lower(f"{raw} {nxt_raw}"):
                return f, s, tokens[i + 1][2], lemma, gloss, pers, 2
    # утверждение: öğretmenim, hastayım, evdeyiz, İstanbul'dayım
    low = tr_lower(raw)
    if low in all_words:  # sekiz — это «восемь», а не «sek + iz»
        return None
    # ne yapayım / gideyim — желательное наклонение глагола, а не «я искусственный» (yapay+ım)
    if low[-4:] in ("ayım", "eyim", "yayım", "yeyim") and any(
        low[:k] + suf in verbs for k in (len(low) - 4, len(low) - 5) for suf in ("mak", "mek")
    ):
        return None
    for person in ("ben", "sen", "biz", "siz", "onlar"):
        for cut in range(2, min(6, len(raw) - 1)):
            word = raw[:-cut]
            base = _cop_base(word, case_idx, verbs)
            if not base:
                continue
            lemma, pre, gloss = base
            f = morph.copula(word, person, pre=pre)
            if tr_lower(f.word) != low:
                continue
            # «-ım» у существительного — чаще «мой» (adım — моё имя), «-lar» — просто
            # множественное: верим, только если рядом есть ben / onlar.
            plain_noun = pre is None and tr_lower(word) not in ADJECTIVES
            if plain_noun and person == "ben" and "ben" not in sentence_words:
                continue
            if plain_noun and person == "onlar" and "onlar" not in sentence_words:
                continue
            return f, s, e, lemma, gloss, person, 1
    return None


# --- «чей?»: evim, arabası, Olga'nın, evimde ---
PRONOUN_GEN = {"benim", "senin", "onun", "bizim", "sizin", "onların"}
GEN_RE = re.compile(r"^([A-ZÇĞİÖŞÜ][\wçğıöşü]+)'(n?[ıiuü]n)$")


def build_poss_index(nouns, all_words):
    idx = {}
    for lemma in nouns:
        if len(lemma) < 2 or " " in lemma:
            continue
        for person in morph.PERSONS:
            for case in (None, "loc", "abl", "dat"):
                f = morph.possessive(lemma, person, case=case)
                w = tr_lower(f.word)
                if w in STOP or w in PRONOUN_GEN:
                    continue
                # Совпадает со словом словаря (adım — «шаг», ailem, doğum) — верим, только
                # если рядом «чьё» местоимение: benim adım.
                homo = case is None and (w in all_words or w in WORD_PARTS)
                idx.setdefault(w, []).append((lemma, person, case, f, homo))
    return idx


def match_genitive(raw):
    m = GEN_RE.match(raw)
    if not m:
        return None
    f = morph.genitive(m.group(1))
    return f if f.word == raw else None


PERSON_GEN = {"ben": "benim", "sen": "senin", "o": "onun", "biz": "bizim", "siz": "sizin", "onlar": "onların"}


def match_poss(tokens, i, poss_idx, sentence_words, life):
    """Слово с притяжанием, если контекст снимает неоднозначность: evin — «твой дом» только
    при senin (иначе это «дома» в род. падеже); evi / kitabı — «его» только после onun /
    Olga'nın (иначе это винительный: «дом», «книгу»); -ları без падежа — только при onların."""
    raw = tokens[i][0]
    cands = poss_idx.get(tr_lower(raw))
    if not cands:
        return None
    prev = tr_lower(tokens[i - 1][0]) if i > 0 else ""
    prev_gen = prev == "onun" or bool(GEN_RE.match(tokens[i - 1][0])) if i > 0 else False
    ok = []
    for lemma, person, case, f, homo in cands:
        if homo and PERSON_GEN[person] not in sentence_words:
            continue
        # Во фразах «из жизни» 3-е лицо почти всегда — составное слово или послелог
        # (resepsiyonun yanında, trafik ışıkları), а не «его / их»: только после onun /
        # Olga'nın / onların.
        if life and person == "o" and not prev_gen:
            continue
        if life and person == "onlar" and "onların" not in sentence_words:
            continue
        # sorun — «проблема», öğlene — «к полудню»: «твой» во фразах из жизни — только при senin.
        if life and person == "sen" and "senin" not in sentence_words:
            continue
        consonant = lemma[-1] not in morph.VOWELS
        if person == "sen" and consonant and "senin" not in sentence_words:
            continue
        if person == "o":
            if case is None and not prev_gen:
                continue
            if case is not None and ("senin" in sentence_words or "sen" in sentence_words):
                continue
        if person == "onlar" and case is None and "onların" not in sentence_words:
            continue
        if person == "ben" and case is None and "ben" in sentence_words and "benim" not in sentence_words:
            continue
        ok.append((lemma, person, case, f))
    if not ok:
        return None
    # evinde: «у тебя дома» при senin, иначе «у него дома».
    ok.sort(key=lambda c: 0 if (c[1] == "sen") == ("senin" in sentence_words) else 1)
    return ok[0][:4]


# --- кого? что? винительный: kitabı, Leyla'yı, seni, annemi ---
ACC_PROPER_RE = re.compile(r"^([A-ZÇĞİÖŞÜ][\wçğıöşü]+)'(y?[ıiuü])$")
PRONOUN_ACC_WORDS = {v: k for k, v in morph.PRONOUN_ACC.items()}


def build_acc_index(nouns, all_words):
    idx = {}
    for lemma in nouns:
        if len(lemma) < 2 or " " in lemma:
            continue
        variants = [(None, morph.accusative(lemma))] + [(p, morph.accusative(lemma, poss=p)) for p in morph.PERSONS]
        for person, f in variants:
            w = tr_lower(f.word)
            if w in STOP or w in PRONOUN_GEN or w in all_words:
                continue
            idx.setdefault(w, []).append((lemma, person, f))
    return idx


VERB_FORM_RE = re.compile(r"(yor|[dt][ıiuü](m|n|k|n[ıiuü]z|l[ae]r)?|m[ae]l[ıi]\w*|m[ae]k|[ae]c[ae][kğ]\w*)$")


def _verb_later(tokens, i):
    """Винительный — дополнение при глаголе: дальше во фразе есть -yor или -dı."""
    return any("yor" in tr_lower(t[0]) or VERB_FORM_RE.search(tr_lower(t[0])) for t in tokens[i + 1:])


# Переходные глаголы (основа перед -yor): во фразах «из жизни» -ı считаем винительным только
# перед ними или перед инфинитивом (hesabı ödemek istiyorum) — иначе это чаще «его»:
# başı dönüyor, saat onu çeyrek geçiyor.
TRANSITIVE_STEMS = (
    "sev", "isti", "ar", "bekl", "bil", "oku", "yaz", "iç", "yi", "izl", "dinl", "gör", "al", "öd",
    "aç", "kapat", "temizl", "yık", "hazırl", "tanı", "anl", "özl", "bırak", "gönder", "sor", "duy",
    "unut", "söyl", "sat", "kullan", "yap", "bul", "getir", "götür", "ver", "tut", "giy", "seç",
    "öğren", "öğret", "ist", "çek", "değiştir", "kontrol", "rica", "ödü", "kaybed", "tamir",
)


def _transitive_later(tokens, i):
    for t in tokens[i + 1:]:
        low = tr_lower(t[0])
        if re.search(r"m[ae]k$", low):
            return True
        m = (re.match(r"^(.+?)[ıiuü]?yor", low) or re.match(r"^(.+?)[dt][ıiuü](m|n|k|n[ıiuü]z|l[ae]r)?$", low)
             or re.match(r"^(.+?)m[ae]l[ıi]", low) or re.match(r"^(.+?)y?[ae]c[ae][kğ]", low))
        if m and any(m.group(1).startswith(st) for st in TRANSITIVE_STEMS):
            return True
    return False


def match_acc(tokens, i, acc_idx, sentence_words, life):
    raw = tokens[i][0]
    low = tr_lower(raw)
    if not _verb_later(tokens, i):
        return None
    if life and not _transitive_later(tokens, i):
        return None
    prev_low = tr_lower(tokens[i - 1][0]) if i > 0 else ""
    # cep telefonu, balık ekmeği, finans müdürü — составное слово, -ı там «его», не винительный.
    if f"{prev_low} {low}" in WORD_PARTS_PAIRS or (life and prev_low in NOMINALS and prev_low not in ADJECTIVES):
        return None
    if low in PRONOUN_ACC_WORDS:
        return low, PRONOUN_ACC_WORDS[low], morph.pronoun_acc(PRONOUN_ACC_WORDS[low]), True
    m = ACC_PROPER_RE.match(raw)
    if m:
        f = morph.accusative(m.group(1), proper=True)
        return (m.group(1), None, f, False) if f.word == raw else None
    cands = acc_idx.get(low)
    if not cands:
        return None
    prev = tokens[i - 1][0] if i > 0 else ""
    prev_gen = tr_lower(prev) == "onun" or bool(GEN_RE.match(prev))
    for lemma, person, f in cands:
        if person == "sen" and "senin" not in sentence_words and (life or "sen" not in sentence_words):
            continue
        if person in ("o", "onlar"):
            if life and not prev_gen:
                continue
            if "sen" in sentence_words or "senin" in sentence_words:
                continue
        return lemma, person, f, False
    return None


# --- сборка ---
def form_to_slot(form, start, end, lemma, topic, gloss):
    return {
        "start": start,
        "end": end,
        "word": form.word,
        "lemma": lemma,
        "gloss": gloss,
        "topic": topic,
        "tags": form.tags,
        "parts": [{"text": p.text, "slot": p.slot, "options": p.options, "why": p.why} for p in form.parts],
    }


def yor_alternatives(inf, person, neg, question):
    """Целые формы для упражнения «Выбери»: тот же глагол, другие лица."""
    others = [p for p in morph.PERSONS if p != person]
    return [morph.yor(inf, p, negative=neg, question=question).word for p in others]


def case_alternatives(lemma, case, kw, proper, name=None):
    out = []
    for c in morph.CASES:
        if c == case:
            continue
        f = morph.noun_case(lemma, c, plural=kw.get("plural", False), soften=kw.get("soften", False) and c == "dat", proper=proper)
        w = f.word
        if proper:
            w = name + w[len(lemma):]
        out.append(w)
    # плюс «почти правильная» форма — с нарушенной гармонией
    right = morph.noun_case(lemma, case, **kw, proper=proper).parts[-1]
    wrong = [o for o in right.options if o != right.text and o not in
             [morph.noun_case(lemma, c, **kw, proper=proper).parts[-1].text for c in morph.CASES]]
    if wrong:
        stem = name if proper else "".join(p.text for p in morph.noun_case(lemma, case, **kw).parts[:-1])
        out.append(stem + wrong[0])
    return out


def main():
    verbs, nouns, all_words = load_lexicon()
    case_idx = build_case_index(nouns, all_words)
    poss_idx = build_poss_index(nouns, all_words)
    acc_idx = build_acc_index(nouns, all_words)
    with_idx = build_with_index(nouns, all_words)
    sources = load_sources()
    items, unmatched = [], {}
    base_problems, too_hard = [], 0

    for n, src in enumerate(sources):
        tr = src["tr"]
        tokens = [(m.group(0), m.start(), m.end()) for m in WORD_RE.finditer(tr)]
        sentence_words = {tr_lower(t[0]) for t in tokens}
        slots = []
        i = 0
        while i < len(tokens):
            raw, s, e = tokens[i]
            low = tr_lower(raw)
            nxt = tr_lower(tokens[i + 1][0]) if i + 1 < len(tokens) else ""
            got = match_yor(low, nxt, verbs)
            if isinstance(got, tuple) and got and got[0] == "unmatched":
                unmatched.setdefault(got[1], []).append(tr)
            elif got:
                inf, person, neg, question, form = got
                end = tokens[i + 1][2] if question else e
                if raw[0].isupper():
                    form.parts[0].text = raw[0] + form.parts[0].text[1:]
                    form.parts[0].options = [o[0].upper() + o[1:] for o in form.parts[0].options]
                slot = form_to_slot(form, s, end, inf, "yor", verbs[inf])
                slot["person"] = person
                slot["alts"] = yor_alternatives(inf, person, neg, question)
                if raw[0].isupper():
                    slot["alts"] = [a[0].upper() + a[1:] for a in slot["alts"]]
                slot["word"] = tr[s:end]
                slots.append(slot)
                i += 2 if question else 1
                continue
            dm = match_di(low, nxt, verbs, all_words)
            if dm:
                inf, person, neg, question, form = dm
                end = tokens[i + 1][2] if question else e
                if raw[0].isupper():
                    form = copy.deepcopy(form)
                    form.parts[0].text = raw[0] + form.parts[0].text[1:]
                    form.parts[0].options = [o[0].upper() + o[1:] for o in form.parts[0].options]
                slot = form_to_slot(form, s, end, inf, "di", verbs[inf])
                slot["person"] = person
                slot["alts"] = []
                slot["word"] = tr[s:end]
                slots.append(slot)
                i += 2 if question else 1
                continue
            em = match_ecek(low, nxt, verbs, all_words, src["tier"] == "life")
            if em:
                inf, person, neg, question, form = em
                end = tokens[i + 1][2] if question else e
                if raw[0].isupper():
                    form = copy.deepcopy(form)
                    form.parts[0].text = raw[0] + form.parts[0].text[1:]
                    form.parts[0].options = [o[0].upper() + o[1:] for o in form.parts[0].options]
                slot = form_to_slot(form, s, end, inf, "ecek", verbs[inf])
                slot["person"] = person
                slot["alts"] = []
                slot["word"] = tr[s:end]
                slots.append(slot)
                i += 2 if question else 1
                continue
            wm = match_want(tokens, i, tr, verbs, all_words, src["tier"] == "life")
            if wm:
                form, inf = wm
                if raw[0].isupper():
                    form = copy.deepcopy(form)
                    form.parts[0].text = raw[0] + form.parts[0].text[1:]
                    form.parts[0].options = [o[0].upper() + o[1:] for o in form.parts[0].options]
                    form.word = raw
                slot = form_to_slot(form, s, e, inf, "want", verbs.get(inf, ""))
                slot["alts"] = []
                slots.append(slot)
                i += 1
                continue
            cop = match_cop(tokens, i, tr, case_idx, verbs, sentence_words, all_words)
            if cop:
                form, cs, ce, lemma, gloss, person, used = cop
                slot = form_to_slot(form, cs, ce, lemma, "cop", gloss)
                slot["person"] = person
                slot["alts"] = []
                slot["word"] = tr[cs:ce]
                slots.append(slot)
                i += used
                continue
            gen = match_genitive(raw)
            if gen:
                slot = form_to_slot(gen, s, e, gen.parts[0].text, "poss", "")
                slot["alts"] = []
                slots.append(slot)
                i += 1
                continue
            ps = match_poss(tokens, i, poss_idx, sentence_words, src["tier"] == "life")
            if ps and (raw[0].islower() or s == 0 or tr[:s].rstrip()[-1:] in ".!?"):
                lemma, person, case, form = ps
                if raw[0].isupper():
                    form = copy.deepcopy(form)
                    form.parts[0].text = raw[0] + form.parts[0].text[1:]
                    form.parts[0].options = [o[0].upper() + o[1:] for o in form.parts[0].options]
                    form.word = raw
                slot = form_to_slot(form, s, e, lemma, "poss", nouns.get(lemma, ""))
                slot["person"] = person
                if case:
                    slot["case"] = case
                slot["alts"] = []
                slots.append(slot)
                i += 1
                continue
            ac = match_acc(tokens, i, acc_idx, sentence_words, src["tier"] == "life")
            # С заглавной посреди фразы — имя (Pamuk), кроме языков: Türkçeyi, Rusçayı.
            if ac and (raw[0].islower() or s == 0 or tr[:s].rstrip()[-1:] in ".!?" or "'" in raw or str(ac[0]).endswith(("çe", "ça"))):
                lemma, person, form, is_pronoun = ac
                if raw[0].isupper() and "'" not in raw:
                    form = copy.deepcopy(form)
                    form.parts[0].text = raw[0] + form.parts[0].text[1:]
                    form.parts[0].options = [o[0].upper() + o[1:] for o in form.parts[0].options]
                    form.word = raw
                slot = form_to_slot(form, s, e, lemma, "acc", nouns.get(lemma, "") if not is_pronoun else "")
                if person:
                    slot["person"] = person
                slot["alts"] = []
                slots.append(slot)
                i += 1
                continue
            wf = match_with(tokens, i, with_idx, sentence_words, src["tier"] == "life")
            if wf and (raw[0].islower() or s == 0 or tr[:s].rstrip()[-1:] in ".!?" or "'" in raw):
                lemma, form = wf
                if raw[0].isupper() and "'" not in raw:
                    form = copy.deepcopy(form)
                    form.parts[0].text = raw[0] + form.parts[0].text[1:]
                    form.parts[0].options = [o[0].upper() + o[1:] for o in form.parts[0].options]
                    form.word = raw
                slot = form_to_slot(form, s, e, lemma, "with", nouns.get(lemma, "") if isinstance(lemma, str) else "")
                slot["alts"] = []
                slots.append(slot)
                i += 1
                continue
            pr = match_proper(raw)
            if pr:
                name, case, form = pr
                slot = form_to_slot(form, s, e, name, "case", "")
                slot["case"] = case
                slot["alts"] = case_alternatives(tr_lower(name), case, {}, True, name)
                slots.append(slot)
            elif low in case_idx and (raw[0].islower() or s == 0 or tr[:s].rstrip()[-1:] in ".!?"):
                # С заглавной — только в начале предложения (иначе это имя собственное).
                lemma, case, kw, form = case_idx[low]
                if raw[0].isupper():
                    form = copy.deepcopy(form)
                    first = form.parts[0]
                    first.text = raw[0] + first.text[1:]
                    first.options = [o[0].upper() + o[1:] for o in first.options]
                    form.word = raw
                # Перевод леммы для падежей не показываем: у существительных в словаре
                # бывает не тот смысл (sağ → «право»), а смысл и так есть во фразе.
                slot = form_to_slot(form, s, e, lemma, "case", nouns.get(lemma) or PLACE_WORDS.get(lemma, ""))
                slot["case"] = case
                slot["alts"] = case_alternatives(lemma, case, kw, False)
                if raw[0].isupper():
                    slot["alts"] = [x[0].upper() + x[1:] for x in slot["alts"]]
                slots.append(slot)
            i += 1
        if src["tier"] == "base":
            if not any(s["topic"] == src["baseTopic"] for s in slots):
                base_problems.append(f"{src['baseTopic']}: {tr}")
                continue
            # Во фразе пути только пройденное: правила тем, идущих ПОЗЖЕ, — ошибка автора.
            later = PATH_TOPICS[PATH_TOPICS.index(src["baseTopic"]) + 1:]
            if any(s["topic"] in later for s in slots):
                base_problems.append(f"{src['baseTopic']}: правило следующей темы во фразе «{tr}»")
                continue
        else:
            # Уровень, проставленный вручную (агент диалогов), важнее эвристики levels.py.
            level = src.get("level") or levels.classify(tr)[0]
            if len(tr.split()) > LIFE_MAX_WORDS or level not in LIFE_LEVELS:
                too_hard += 1
                continue
        if slots:
            item = {"id": f"g{n}", "ru": src["ru"], "tr": tr, "src": src["src"], "tier": src["tier"], "slots": slots}
            # Переводы обычных слов (не пропусков) — для подсказки «что за слово».
            in_slots = [(sl["start"], sl["end"]) for sl in slots]
            gl = {}
            for raw, ts, _te in tokens:
                if any(a <= ts < b for a, b in in_slots):
                    continue
                g = gloss_for(raw)
                if g:
                    gl[raw] = g
            if gl:
                item["gl"] = gl
            if src["tier"] == "base":
                item["topic"] = src["baseTopic"]
                item["stage"] = src["stage"]
            items.append(item)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # В приложение — только то, чем пользуется игра (alts / src / id / word — для отладки).
    slim = []
    for it in items:
        x = {k: v for k, v in it.items() if k not in ("id", "src")}
        x["slots"] = [{k: v for k, v in sl.items() if k not in ("alts", "word")} for sl in it["slots"]]
        slim.append(x)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))
    with open(PATH_OUT, "w", encoding="utf-8") as f:
        json.dump(load_paths()[1], f, ensure_ascii=False, separators=(",", ":"))
    with open(UNMATCHED, "w", encoding="utf-8") as f:
        f.write("# основа до -yor → фразы; глагола нет в словаре (assets/words) или форма не сошлась\n")
        for base, trs in sorted(unmatched.items(), key=lambda kv: -len(kv[1])):
            f.write(f"{base}\t{len(trs)}\t{trs[0]}\n")

    by_topic = {}
    for it in items:
        for s in it["slots"]:
            by_topic[s["topic"]] = by_topic.get(s["topic"], 0) + 1
    print(f"источников: {len(sources)}, фраз с пропусками: {len(items)}, пропусков по темам: {by_topic}")
    tiers = {}
    for it in items:
        tiers[it["tier"]] = tiers.get(it["tier"], 0) + 1
    print(f"по ступеням: {tiers}; отброшено как слишком сложное для «В жизни»: {too_hard}")
    if base_problems:
        print("ВНИМАНИЕ: в «Базе» не нашёлся пропуск своей темы (генератор не распознал форму):")
        for p in base_problems:
            print("  ", p)
    print(f"не распознано основ на -yor: {len(unmatched)} (см. {os.path.relpath(UNMATCHED, ROOT)})")


if __name__ == "__main__":
    main()
