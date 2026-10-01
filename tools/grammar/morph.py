"""Генератор турецких форм — единственный источник правды для раздела «Грамматика».

Приложение само ничего не склоняет: build.py прогоняет этот генератор офлайн и кладёт
в assets/grammar/*.json уже готовые кусочки-тайлы, варианты и пояснения. Поэтому любое
новое правило (время, падеж, притяжание) добавляется здесь, а в JS меняется только
отрисовка.

Каждая форма возвращается как список частей Part: сам кусочек (как он пишется в
слове), какой это слот (stem/neg/tense/person/case/…), варианты-обманки для тайлов и
короткое объяснение, почему именно так — его показываем после ошибки в этом ряду.
"""

from dataclasses import dataclass, field

BACK = set("aıou")
FRONT = set("eiöü")
VOWELS = BACK | FRONT
ROUNDED = set("oöuü")
# Глухие согласные: после них -da/-dan превращается в -ta/-tan («fıstıkçı şahap»).
VOICELESS = set("çfhkpsşt")
# Озвончение последней согласной перед гласной: kitap → kitabı, git → gidiyor.
SOFTEN = {"p": "b", "ç": "c", "t": "d", "k": "ğ"}

I4 = {"a": "ı", "ı": "ı", "o": "u", "u": "u", "e": "i", "i": "i", "ö": "ü", "ü": "ü"}
A2 = {v: ("a" if v in BACK else "e") for v in VOWELS}

PERSONS = ["ben", "sen", "o", "biz", "siz", "onlar"]
PERSON_RU = {"ben": "я", "sen": "ты", "o": "он/она", "biz": "мы", "siz": "вы", "onlar": "они"}
# Личные окончания после -yor неизменны: у -yor всегда «o», гармонировать не с чем.
YOR_PERSON = {"ben": "um", "sen": "sun", "o": "", "biz": "uz", "siz": "sunuz", "onlar": "lar"}
# Вопрос после -yor: окончание лица переезжает на частицу mu.
YOR_QUESTION = {"ben": "muyum", "sen": "musun", "o": "mu", "biz": "muyuz", "siz": "musunuz", "onlar": "mı"}

# Глаголы, у которых t озвончается перед гласной (gitmek → gidiyor). Остальные
# односложные на -t не меняются (bitmek → bitiyor, atmak → atıyor).
SOFTENING_VERBS = {"gitmek", "etmek", "tatmak", "gütmek", "didmek"}
# Два особых глагола: у них и основа меняется (de → di, ye → yi).
IRREGULAR_YOR = {"demek": "di", "yemek": "yi"}

CASES = ["loc", "abl", "dat"]
CASE_RU = {"loc": "где? (-de)", "abl": "откуда? (-den)", "dat": "куда? (-e)"}


def last_vowel(word):
    for ch in reversed(word):
        if ch in VOWELS:
            return ch
    return "e"


def i4(word):
    return I4[last_vowel(word)]


def a2(word):
    return A2[last_vowel(word)]


@dataclass
class Part:
    text: str
    slot: str
    options: list = field(default_factory=list)  # включая верный, без повторов
    why: str = ""


@dataclass
class Form:
    word: str
    parts: list
    tags: list  # правила, которые сработали — по ним считается прогресс


def _uniq(seq):
    out = []
    for s in seq:
        if s not in out:
            out.append(s)
    return out


def _is_softening_verb(infinitive):
    if infinitive in {"yetmek"}:
        return False
    return infinitive in SOFTENING_VERBS or infinitive.endswith(" etmek") or (
        infinitive.endswith("etmek") and len(infinitive) > 5 and infinitive[:-5][-1] not in VOWELS
    )


def verb_stem(infinitive):
    return infinitive[:-3]


# --- настоящее время -yor ---
def yor(infinitive, person, negative=False, question=False):
    """bekle + iyor + um → bekliyorum. Возвращает Form с частями для тайлов."""
    stem = verb_stem(infinitive)
    tags = ["yor", f"p.{person}"]
    parts = []

    if negative:
        # Отрицание -me/-ma тоже гласное на конце → перед -yor ведёт себя как bekle:
        # гласная сужается, bil + me → bilmi + yor.
        neg_vowel = i4(stem)
        parts.append(Part(stem, "stem", [stem], ""))
        parts.append(
            Part(
                "m" + neg_vowel,
                "neg",
                _uniq(["m" + neg_vowel, "m" + a2(stem), "m" + ("ı" if neg_vowel != "ı" else "i")]),
                f"отрицание -ma/-me перед -yor сужается: последняя гласная основы «{last_vowel(stem)}» → m{neg_vowel}",
            )
        )
        parts.append(Part("yor", "tense", ["yor", "iyor", "ıyor"], "после гласной -yor присоединяется сразу"))
        tags.append("neg")
    elif infinitive in IRREGULAR_YOR:
        new = IRREGULAR_YOR[infinitive]
        parts.append(Part(new, "stem", [new, stem], f"{infinitive} — исключение: {stem} → {new}yor"))
        parts.append(Part("yor", "tense", ["yor", "iyor", "ıyor"], "после гласной -yor присоединяется сразу"))
        tags.append("irregular")
    elif stem[-1] in "ae":
        # Широкая гласная на конце выпадает, её место занимает узкая по гармонии
        # предыдущей гласной: bekle → bekl + iyor, ağla → ağl + ıyor.
        cut = stem[:-1]
        v = i4(cut)
        parts.append(Part(cut, "stem", [cut, stem], f"основа на -{stem[-1]}: гласная выпадает, {stem} → {cut}"))
        parts.append(
            Part(v + "yor", "tense", _uniq([v + "yor", "yor", stem[-1] + "yor"] + [x + "yor" for x in "ıiuü"]),
                 f"после выпавшей гласной — узкая по гармонии: «{last_vowel(cut)}» → {v}yor")
        )
        tags.append("drop")
    elif stem[-1] in VOWELS:
        parts.append(Part(stem, "stem", [stem], ""))
        parts.append(Part("yor", "tense", _uniq(["yor"] + [x + "yor" for x in "ıiuü"]),
                          f"основа уже на узкую гласную «{stem[-1]}» — просто +yor"))
        tags.append("vowel")
    else:
        v = i4(stem)
        base = stem
        if _is_softening_verb(infinitive):
            base = stem[:-1] + SOFTEN[stem[-1]]
            parts.append(Part(base, "stem", [base, stem], f"{infinitive}: t → d перед гласной ({stem} → {base})"))
            tags.append("soften")
        else:
            parts.append(Part(stem, "stem", [stem], ""))
        parts.append(
            Part(v + "yor", "tense", _uniq([v + "yor"] + [x + "yor" for x in "ıiuü"] + ["yor"]),
                 f"последняя гласная основы «{last_vowel(stem)}» → {v}yor")
        )
        tags.append("cons")

    if question and person == "onlar":
        # «Они» — исключение: -lar остаётся на глаголе, а частица по гармонии с -lar: mı.
        parts.append(Part("lar", "person", _uniq(["lar"] + [YOR_PERSON[p] for p in PERSONS if YOR_PERSON[p]]),
                          "onlar (они) → -lar остаётся на глаголе"))
        parts.append(Part(" mı", "person", [" mı", " mu", " mi", " musunuz"],
                          "после -lar частица вопроса по гармонии: lar → mı"))
        tags.append("question")
    elif question:
        q = YOR_QUESTION[person]
        opts = _uniq([q] + [YOR_QUESTION[p] for p in PERSONS if p != "onlar"])
        parts.append(Part(" " + q, "person", [" " + o for o in opts],
                          f"в вопросе лицо переезжает на частицу: {person} → {q}"))
        tags.append("question")
    else:
        end = YOR_PERSON[person]
        parts.append(Part(end, "person", _uniq([end] + [YOR_PERSON[p] for p in PERSONS]),
                          f"{person} ({PERSON_RU[person]}) → -{end or '∅ (без окончания)'}"))

    word = "".join(p.text for p in parts)
    return Form(word, parts, tags)


# --- падежи -de / -den / -e ---
def _case_suffix(base, case, proper=False):
    last = base[-1]
    if case == "dat":
        if last in VOWELS:
            return "y" + a2(base)
        return a2(base)
    d = "t" if last in VOICELESS else "d"
    s = d + a2(base)
    return s + "n" if case == "abl" else s


def _case_options(base, case):
    """Тайлы падежа: все три падежа в правильной гармонии + неправильный вариант
    своего падежа — чтобы выбирать и по смыслу, и по звучанию."""
    right = _case_suffix(base, case)
    others = [_case_suffix(base, c) for c in CASES if c != case]
    wrong_harmony = right.translate(str.maketrans("ae", "ea"))
    wrong_consonant = right.translate(str.maketrans("dt", "td")) if case != "dat" else (
        right[1:] if right.startswith("y") else "y" + right
    )
    return _uniq([right] + others + [wrong_harmony, wrong_consonant])


def noun_case(lemma, case, plural=False, soften=False, proper=False):
    """ev + de → evde; kitab + a → kitaba (soften=True); İstanbul + 'da."""
    tags = ["case", f"c.{case}"]
    parts = []
    base = lemma
    if plural:
        pl = "l" + a2(lemma) + "r"
        parts.append(Part(lemma, "stem", [lemma], ""))
        parts.append(Part(pl, "plural", ["ler", "lar"], f"множественное: последняя гласная «{last_vowel(lemma)}» → {pl}"))
        base = lemma + pl
        tags.append("plural")
    elif soften and case == "dat" and lemma[-1] in SOFTEN:
        soft = lemma[:-1] + SOFTEN[lemma[-1]]
        parts.append(Part(soft, "stem", [soft, lemma], f"{lemma[-1]} → {SOFTEN[lemma[-1]]} перед гласной ({lemma} → {soft})"))
        base = soft
        tags.append("soften")
    else:
        parts.append(Part(lemma, "stem", [lemma], ""))

    suffix = _case_suffix(base, case)
    why = {
        "loc": "где? → -de/-da",
        "abl": "откуда? → -den/-dan",
        "dat": "куда? → -e/-a",
    }[case]
    why += f"; последняя гласная «{last_vowel(base)}» → {a2(base)}"
    if case != "dat" and base[-1] in VOICELESS:
        why += f"; после глухой «{base[-1]}» d → t"
        tags.append("voiceless")
    if case == "dat" and base[-1] in VOWELS:
        why += "; после гласной нужна связка y"
        tags.append("buffer")
    if proper:
        tags.append("proper")
    opts = _case_options(base, case)
    if proper:
        suffix = "'" + suffix
        opts = ["'" + o for o in opts]
    parts.append(Part(suffix, "case", opts, why))
    return Form("".join(p.text for p in parts), parts, tags)


if __name__ == "__main__":
    # Сверка с таблицей из книги (durmak, duygulanmak) и с типовыми случаями.
    checks = {
        ("durmak", "ben"): "duruyorum",
        ("durmak", "siz"): "duruyorsunuz",
        ("durmak", "onlar"): "duruyorlar",
        ("duygulanmak", "sen"): "duygulanıyorsun",
        ("duygulanmak", "o"): "duygulanıyor",
        ("beklemek", "ben"): "bekliyorum",
        ("ağlamak", "o"): "ağlıyor",
        ("okumak", "biz"): "okuyoruz",
        ("gitmek", "ben"): "gidiyorum",
        ("seyretmek", "o"): "seyrediyor",
        ("bitmek", "o"): "bitiyor",
        ("demek", "ben"): "diyorum",
        ("yemek", "biz"): "yiyoruz",
        ("görmek", "sen"): "görüyorsun",
        ("söylemek", "o"): "söylüyor",
    }
    bad = 0
    for (inf, p), want in checks.items():
        got = yor(inf, p).word
        if got != want:
            bad += 1
            print("FAIL", inf, p, got, "!=", want)
    for args, want in [
        (("bilmek", "ben", True), "bilmiyorum"),
        (("anlamak", "ben", True), "anlamıyorum"),
        (("görmek", "o", True), "görmüyor"),
    ]:
        got = yor(*args).word
        if got != want:
            bad += 1
            print("FAIL neg", args, got)
    got = yor("oynamak", "onlar", question=True).word
    if got != "oynuyorlar mı":
        bad += 1
        print("FAIL q onlar", got)
    got = yor("çalışmak", "siz", question=True).word
    if got != "çalışıyor musunuz":
        bad += 1
        print("FAIL q", got)
    for args, kw, want in [
        (("ev", "loc"), {}, "evde"),
        (("okul", "abl"), {}, "okuldan"),
        (("sokak", "loc"), {}, "sokakta"),
        (("ev", "dat"), {}, "eve"),
        (("masa", "dat"), {}, "masaya"),
        (("kitap", "dat"), {"soften": True}, "kitaba"),
        (("otel", "loc"), {"plural": True}, "otellerde"),
        (("İstanbul", "loc"), {"proper": True}, "İstanbul'da"),
        (("Türkiye", "dat"), {"proper": True}, "Türkiye'ye"),
    ]:
        got = noun_case(*args, **kw).word
        if got != want:
            bad += 1
            print("FAIL case", args, got)
    print("ok" if not bad else f"{bad} failures")
