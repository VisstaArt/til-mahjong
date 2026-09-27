"""Собирает упражнения раздела «Грамматика» из фраз и диалогов приложения.

Запуск:  python3 tools/grammar/build.py
Пишет:   assets/grammar/items.json  — фразы с размеченными «пропусками»
         tools/grammar/unmatched.txt — формы на -yor, для которых не нашёлся глагол
                                       в словаре (кандидаты в extra-verbs.txt)

Разметка проверяется генератором: слово попадает в упражнение, только если morph.py
из (инфинитив, лицо / падеж) получает ровно такое же написание, как во фразе. Всё, что
не сошлось, в упражнения не идёт — лучше меньше фраз, чем неверная «правильная» форма.
"""

import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import morph  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "grammar", "items.json")
UNMATCHED = os.path.join(os.path.dirname(__file__), "unmatched.txt")
EXTRA_VERBS = os.path.join(os.path.dirname(__file__), "extra-verbs.txt")

# Служебные слова, которые случайно совпадают с падежной формой какого-нибудь
# существительного из словаря (il → ile, an → ana…). Их не трогаем.
STOP = {
    "ile", "ama", "ana", "bana", "sana", "ona", "gece", "öte", "bile", "yine", "daha",
    "önce", "sonra", "göre", "kadar", "beri", "işte", "belki", "keşke", "hala", "hâlâ",
    "şimdi", "yarın", "dün", "bugün", "hepsi", "neden", "nereden", "birde", "bende",
    "sende", "bizde", "sizde", "onda", "bunda", "şunda", "buna", "şuna", "kime", "neye",
    "tane", "tamam", "banka", "ekleme", "güle", "evet", "hayır", "yani", "aslında", "yeter", "kere", "defa",
}
# Слова-«места»: bura/şura/ora/nere — сами по себе не встречаются, только с падежом.
PLACE_WORDS = {"bura": "здесь/сюда", "şura": "там (рядом)", "ora": "там/туда", "nere": "где/куда"}

WORD_RE = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû']+")


def tr_lower(s):
    return s.replace("I", "ı").replace("İ", "i").lower()


def load_lexicon():
    verbs, nouns, all_words = {}, {}, set()
    for f in glob.glob(os.path.join(ROOT, "assets", "words", "*.json")):
        for w in json.load(open(f, encoding="utf-8")):
            tr = tr_lower((w.get("tr") or "").strip())
            if not tr:
                continue
            all_words.add(tr)
            if " " in tr or "/" in tr or "," in tr:
                continue
            if w.get("pos") == "verb" and re.search(r"m[ae]k$", tr):
                verbs.setdefault(tr, w.get("ru", ""))
            elif w.get("pos") == "noun":
                nouns.setdefault(tr, w.get("ru", ""))
    if os.path.exists(EXTRA_VERBS):
        for line in open(EXTRA_VERBS, encoding="utf-8"):
            line = line.split("#")[0].strip()
            if not line:
                continue
            inf, _, ru = line.partition("=")
            verbs.setdefault(tr_lower(inf.strip()), ru.strip())
    return verbs, nouns, all_words


def load_sources():
    """Фразы и реплики диалогов в одном виде: {id, ru, tr, src}."""
    out = []
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
                out.append({"ru": p["ru"], "tr": p["tr"], "src": f"Фразы · {titles.get(tid, tid)}"})
    for f in sorted(glob.glob(os.path.join(ROOT, "assets", "dialogues", "*.json"))):
        if f.endswith("manifest.json"):
            continue
        topic = json.load(open(f, encoding="utf-8"))
        for d in topic.get("dialogues", []):
            for t in d.get("turns", []):
                if t.get("tr") and t.get("ru"):
                    out.append({"ru": t["ru"], "tr": t["tr"], "src": f"Диалоги · {d['title']}"})
    seen, uniq = set(), []
    for it in out:
        key = it["tr"].strip()
        if key in seen:
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


# --- падежи ---
def build_case_index(nouns, all_words):
    idx = {}

    def add(form, lemma, case, **kw):
        w = tr_lower(form.word)
        if w in STOP or w in all_words:
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
    case = "abl" if suf.endswith("n") else ("loc" if suf[0] in "dt" else "dat")
    form = morph.noun_case(tr_lower(name), case, proper=True)
    if tr_lower(form.word) != tr_lower(token):
        return None
    form.parts[0].text = name
    form.parts[0].options = [name]
    form.word = token
    return name, case, form


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
    sources = load_sources()
    items, unmatched = [], {}

    for n, src in enumerate(sources):
        tr = src["tr"]
        tokens = [(m.group(0), m.start(), m.end()) for m in WORD_RE.finditer(tr)]
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
            pr = match_proper(raw)
            if pr:
                name, case, form = pr
                slot = form_to_slot(form, s, e, name, "case", "")
                slot["case"] = case
                slot["alts"] = case_alternatives(tr_lower(name), case, {}, True, name)
                slots.append(slot)
            elif low in case_idx and raw[0].islower():
                lemma, case, kw, form = case_idx[low]
                # Перевод леммы для падежей не показываем: у существительных в словаре
                # бывает не тот смысл (sağ → «право»), а смысл и так есть во фразе.
                slot = form_to_slot(form, s, e, lemma, "case", "")
                slot["case"] = case
                slot["alts"] = case_alternatives(lemma, case, kw, False)
                slots.append(slot)
            i += 1
        if slots:
            items.append({"id": f"g{n}", "ru": src["ru"], "tr": tr, "src": src["src"], "slots": slots})

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
    with open(UNMATCHED, "w", encoding="utf-8") as f:
        f.write("# основа до -yor → фразы; глагола нет в словаре (assets/words) или форма не сошлась\n")
        for base, trs in sorted(unmatched.items(), key=lambda kv: -len(kv[1])):
            f.write(f"{base}\t{len(trs)}\t{trs[0]}\n")

    by_topic = {}
    for it in items:
        for s in it["slots"]:
            by_topic[s["topic"]] = by_topic.get(s["topic"], 0) + 1
    print(f"источников: {len(sources)}, фраз с пропусками: {len(items)}, пропусков по темам: {by_topic}")
    print(f"не распознано основ на -yor: {len(unmatched)} (см. {os.path.relpath(UNMATCHED, ROOT)})")


if __name__ == "__main__":
    main()
