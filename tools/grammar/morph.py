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


# --- прошедшее -dı: geldim, yaptın, gitti, gelmedik, gördünüz mü? ---
DI_PERSON = {"ben": "m", "sen": "n", "o": "", "biz": "k", "siz": "n{v}z", "onlar": "l{a}r"}


def _di_person(base, person):
    return DI_PERSON[person].format(v=i4(base), a=a2(base))


def di(infinitive, person, negative=False, question=False):
    """gel → geldim; yap → yaptım (после глухой — t); gel+me → gelmedim; geldin mi?"""
    stem = verb_stem(infinitive)
    tags = ["di", f"p.{person}"]
    parts = [Part(stem, "stem", [stem], "")]
    base = stem
    if negative:
        neg = "m" + a2(stem)
        parts.append(Part(neg, "neg", _uniq([neg, "m" + ("e" if neg[-1] == "a" else "a"), "m" + i4(stem)]),
                          f"«не» → -ma / -me; последняя гласная «{last_vowel(stem)}» → {neg}"))
        base = stem + neg
        tags.append("neg")
    d = "t" if base[-1] in VOICELESS else "d"
    v = i4(base)
    tense = d + v
    why = f"прошедшее → -dı; последняя гласная «{last_vowel(base)}» → {v}"
    if d == "t":
        why += f"; после глухой «{base[-1]}» d → t"
        tags.append("voiceless")
    opts = _uniq([tense] + [d + x for x in "ıiuü"] + [("d" if d == "t" else "t") + v])
    parts.append(Part(tense, "tense", opts, why))
    end = _di_person(base + tense, person)
    if end:
        parts.append(Part(end, "person", _uniq([end] + [_di_person(base + tense, p) for p in PERSONS if _di_person(base + tense, p)]),
                          f"{person} ({PERSON_RU[person]}) → -{end}"))
    if question:
        q = "m" + i4(base + tense + end)
        parts.append(Part(" " + q, "question", _uniq([" " + q] + [" m" + x for x in "ıiuü"]),
                          f"вопрос — частица после лица: «{last_vowel(base + tense + end)}» → {q}"))
        tags.append("question")
    return Form("".join(p.text for p in parts), parts, tags)


# --- хочу / надо / сделайте: içmek istiyorum, gitmeliyim, oturun!, gitme! ---
def infinitive_form(infinitive):
    """iç → içmek, yap → yapmak — инфинитив перед istemek."""
    stem = verb_stem(infinitive)
    suf = "m" + a2(stem) + "k"
    why = f"«делать» → -mak / -mek; последняя гласная «{last_vowel(stem)}» → {suf}"
    parts = [Part(stem, "stem", [stem], ""), Part(suf, "tense", ["mak", "mek", "ma", "me"], why)]
    return Form("".join(p.text for p in parts), parts, ["want", "inf"])


def meli(infinitive, person, negative=False):
    """git → gitmeliyim (надо), gitmemeliyim (нельзя); лицо — как у «быть»."""
    stem = verb_stem(infinitive)
    parts = [Part(stem, "stem", [stem], "")]
    tags = ["want", "meli", f"p.{person}"]
    base = stem
    if negative:
        neg = "m" + a2(stem)
        parts.append(Part(neg, "neg", _uniq([neg, "m" + ("e" if neg[-1] == "a" else "a")]),
                          f"«нельзя» → -ma / -me перед -malı; последняя гласная «{last_vowel(stem)}» → {neg}"))
        base += neg
        tags.append("neg")
    a = a2(base)
    m = "m" + a + "l" + ("ı" if a == "a" else "i")
    parts.append(Part(m, "tense", _uniq([m, "malı", "meli", "mak", "mek"]),
                      f"«надо» → -malı / -meli; последняя гласная «{last_vowel(base)}» → {m}"))
    end = _cop_suffix(base + m, person)
    if end:
        parts.append(_cop_person_part(base + m, person, "лицо — как у «быть»: "))
    return Form("".join(p.text for p in parts), parts, tags)


def imperative(infinitive, person="siz", negative=False):
    """siz: otur → oturun, bekle → bekleyin, git → gidin; не: gelmeyin. sen: только «не» — gelme!"""
    stem = verb_stem(infinitive)
    tags = ["want", "imp", f"p.{person}"]
    base = stem
    soft = _is_softening_verb(infinitive) and person == "siz" and not negative
    if soft:
        base = stem[:-1] + SOFTEN[stem[-1]]
        parts = [Part(base, "stem", [base, stem], f"{infinitive}: t → d перед гласной ({stem} → {base})")]
        tags.append("soften")
    else:
        parts = [Part(stem, "stem", [stem], "")]
    if negative:
        neg = "m" + a2(stem)
        parts.append(Part(neg, "neg", _uniq([neg, "m" + ("e" if neg[-1] == "a" else "a")]),
                          f"«не делай» → -ma / -me; последняя гласная «{last_vowel(stem)}» → {neg}"))
        base = stem + neg
        tags.append("neg")
    if person == "siz":
        y = "y" if base[-1] in VOWELS else ""
        suf = y + i4(base) + "n"
        why = f"«сделайте» → -ın; последняя гласная «{last_vowel(base)}» → {i4(base)}"
        if y:
            why += "; после гласной — связка y"
            tags.append("buffer")
        parts.append(Part(suf, "person", _uniq([suf, ("" if y else "y") + i4(base) + "n", suf.translate(str.maketrans("ıiuü", "iıüu")), "sın", "in"]), why))
    return Form("".join(p.text for p in parts), parts, tags)


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


# --- «быть» (ek-fiil): öğretmenim, hastayım, evdeyim, yorgun değilim, hasta mısın? ---
def _cop_suffix(base, person):
    """Окончание «быть» по последнему звуку base. У «o» окончания нет (Olga Rus.)."""
    v = i4(base)
    y = "y" if base[-1] in VOWELS else ""
    return {
        "ben": y + v + "m",
        "sen": "s" + v + "n",
        "o": "",
        "biz": y + v + "z",
        "siz": "s" + v + "n" + v + "z",
        "onlar": "l" + a2(base) + "r",
    }[person]


def _cop_person_part(base, person, intro=""):
    suf = _cop_suffix(base, person)
    opts = [_cop_suffix(base, p) for p in PERSONS if _cop_suffix(base, p)]
    # «Почти правильные»: другая гласная, лишняя/пропущенная связка y.
    wrong_vowel = suf.translate(str.maketrans("ıiuü", "iıüu"))
    no_y = suf[1:] if suf.startswith("y") else "y" + suf if suf[0] in "ıiuü" else suf
    why = intro + f"{person} ({PERSON_RU[person]}) → -{suf}"
    if suf.startswith("y"):
        why += "; после гласной нужна связка y"
    elif person != "onlar":
        why += f"; последняя гласная «{last_vowel(base)}» → {i4(base)}"
    return Part(suf, "person", _uniq([suf] + opts + [wrong_vowel, no_y]), why)


def copula(word, person, negative=False, question=False, pre=None):
    """Именное сказуемое: слово (или готовая падежная форма — pre=Form) + «быть».
    ben öğretmen → öğretmenim; ben ev+de → evdeyim; yorgun değil+im; hasta mı+sın."""
    parts = list(pre.parts) if pre else [Part(word, "stem", [word], "")]
    tags = ["cop", f"p.{person}"] + (["loc"] if pre and "c.loc" in pre.tags else [])
    base = "".join(p.text for p in parts).replace("'", "")
    if negative:
        parts.append(Part(" değil", "neg", [" değil"], "«не» при «быть» — отдельное слово değil"))
        if person != "o":
            parts.append(_cop_person_part("değil", person, "окончание лица — на değil: "))
        tags.append("neg")
    elif question:
        if person == "onlar":
            suf = _cop_suffix(base, "onlar")
            parts.append(Part(suf, "person", ["lar", "ler"], f"onlar (они) → -{suf} на самом слове"))
            base = base + suf
        q = "m" + i4(base)
        parts.append(Part(" " + q, "question", _uniq([" " + q] + [" m" + x for x in "ıiuü"]),
                          f"вопрос — отдельная частица m + гласная по гармонии: «{last_vowel(base)}» → {q}"))
        if person not in ("o", "onlar"):
            parts.append(_cop_person_part(q, person, "лицо — на частице: "))
        tags.append("question")
    else:
        if person == "o":
            raise ValueError("у «o» нет окончания — пропуска не будет")
        part = _cop_person_part(base, person)
        parts.append(part)
        if part.text.startswith("y"):
            tags.append("buffer")
    return Form("".join(p.text for p in parts), parts, tags)


# --- «чей?»: evim, araban, arabası, evimiz, Olga'nın; с падежом: evimde, arabasında ---
POSS_RU = {"ben": "мой", "sen": "твой", "o": "его/её", "biz": "наш", "siz": "ваш", "onlar": "их"}


def _syllables(word):
    return sum(1 for ch in word if ch in VOWELS)


def _poss_suffix(base, person):
    v = i4(base)
    if base[-1] in VOWELS:
        return {"ben": "m", "sen": "n", "o": "s" + v, "biz": "m" + v + "z", "siz": "n" + v + "z",
                "onlar": "l" + a2(base) + "r" + i4("l" + a2(base) + "r")}[person]
    return {"ben": v + "m", "sen": v + "n", "o": v, "biz": v + "m" + v + "z", "siz": v + "n" + v + "z",
            "onlar": "l" + a2(base) + "r" + i4(a2(base))}[person]


def possessive(noun, person, case=None):
    """ev → evim / evin / evi / evimiz / eviniz / evleri; kitap → kitabım (p→b, ç→c, k→ğ —
    только у многосложных; t не трогаем: bilet → biletim). case — падеж после: evimde,
    3-е лицо с n: evinde, arabasında."""
    tags = ["poss", f"p.{person}"]
    parts = []
    suf = _poss_suffix(noun, person)
    stem = noun
    if suf[0] in VOWELS and noun[-1] in "pçk" and _syllables(noun) > 1:
        stem = noun[:-1] + SOFTEN[noun[-1]]
        parts.append(Part(stem, "stem", [stem, noun], f"{noun[-1]} → {SOFTEN[noun[-1]]} перед гласной ({noun} → {stem})"))
        tags.append("soften")
    else:
        parts.append(Part(noun, "stem", [noun], ""))
    opts = [_poss_suffix(noun, p) for p in PERSONS]
    wrong = suf.translate(str.maketrans("ıiuü", "iıüu"))
    why = f"{POSS_RU[person]} ({person}) → -{suf}"
    if noun[-1] in VOWELS and person in ("ben", "sen", "biz", "siz"):
        why += "; после гласной — без своей гласной"
    elif noun[-1] in VOWELS and person == "o":
        why += "; после гласной — связка s"
        tags.append("buffer")
    elif person != "onlar":
        why += f"; последняя гласная «{last_vowel(noun)}» → {i4(noun)}"
    parts.append(Part(suf, "poss", _uniq([suf] + opts + [wrong]), why))
    if case:
        base = stem + suf
        third = person in ("o", "onlar")
        cs = _case_suffix(base, case)
        if third:
            # После -ı / -sı / -ları перед падежом встаёт n: evi → evinde, evine.
            cs = "n" + (a2(base) if case == "dat" else "d" + a2(base) + ("n" if case == "abl" else ""))
            cwhy = f"после «его/её/их» перед падежом — n: {noun}{suf} → {noun}{suf}{cs}"
            tags.append("n-buffer")
        else:
            cwhy = {"loc": "где? → -de/-da", "abl": "откуда? → -den/-dan", "dat": "куда? → -e/-a"}[case]
            cwhy += f"; последняя гласная «{last_vowel(base)}» → {a2(base)}"
        copts = _uniq([cs] + [("n" if third else "") + x for x in ("da", "de", "dan", "den", "a", "e")] + _case_options(base, case))
        parts.append(Part(cs, "case", copts, cwhy))
        tags += ["case", f"c.{case}"]
    return Form("".join(p.text for p in parts), parts, tags)


def genitive(name):
    """Чей? Olga'nın, Deniz'in, Pamuk'un — имя + 'nın после гласной, 'ın после согласной."""
    v = i4(name.lower())
    suf = ("n" + v + "n") if name[-1].lower() in VOWELS else (v + "n")
    opts = ["'" + x for x in _uniq([suf] + ["n" + x + "n" for x in "ıiuü"] + [x + "n" for x in "ıiuü"])]
    why = f"чей? → -ın; после гласной — -nın; последняя гласная «{last_vowel(name.lower())}» → {v}"
    parts = [Part(name, "stem", [name], ""), Part("'" + suf, "gen", opts, why)]
    return Form("".join(p.text for p in parts), parts, ["poss", "gen"] + (["buffer"] if name[-1].lower() in VOWELS else []))


# --- кого? что? винительный -(y)ı: kitabı, arabayı, Leyla'yı, seni, annemi, kedisini ---
PRONOUN_ACC = {"ben": "beni", "sen": "seni", "o": "onu", "biz": "bizi", "siz": "sizi", "onlar": "onları"}


def _acc_suffix(base):
    v = i4(base)
    return ("y" + v) if base[-1] in VOWELS else v


def accusative(noun, proper=False, poss=None):
    """kitap → kitabı, araba → arabayı, Pamuk → Pamuk'u; poss — чей: annem → annemi,
    kedisi → kedisini (после «его» перед -ı встаёт n)."""
    tags = ["acc"]
    if poss:
        f = possessive(noun, poss)
        parts = list(f.parts)
        tags += ["poss-acc", f"p.{poss}"] + [t for t in f.tags if t == "soften"]
        base = f.word
        if poss in ("o", "onlar"):
            suf = "n" + i4(base)
            why = f"после «его/её» перед -ı — n: {base} → {base}{suf}"
            tags.append("n-buffer")
        else:
            suf = _acc_suffix(base)
            why = f"кого? что? → -ı; последняя гласная «{last_vowel(base)}» → {i4(base)}"
        opts = _uniq([suf, "n" + i4(base), i4(base), "y" + i4(base), suf.translate(str.maketrans("ıiuü", "iıüu")),
                      "d" + a2(base), a2(base)])
        parts.append(Part(suf, "acc", opts, why))
        return Form("".join(p.text for p in parts), parts, tags)
    parts = []
    base = noun
    suf = _acc_suffix(noun)
    if not proper and suf[0] in VOWELS and noun[-1] in "pçk" and _syllables(noun) > 1:
        base = noun[:-1] + SOFTEN[noun[-1]]
        parts.append(Part(base, "stem", [base, noun], f"{noun[-1]} → {SOFTEN[noun[-1]]} перед гласной ({noun} → {base})"))
        tags.append("soften")
    else:
        parts.append(Part(noun, "stem", [noun], ""))
    why = f"кого? что? (этот, конкретный) → -ı; последняя гласная «{last_vowel(noun.lower())}» → {i4(noun.lower())}"
    if suf.startswith("y"):
        why += "; после гласной — связка y"
        tags.append("buffer")
    opts = _uniq([suf, "y" + i4(noun.lower()) if not suf.startswith("y") else suf[1:],
                  suf.translate(str.maketrans("ıiuü", "iıüu")),
                  _case_suffix(noun.lower(), "loc"), _case_suffix(noun.lower(), "dat"), _case_suffix(noun.lower(), "abl")])
    if proper:
        suf = "'" + suf
        opts = ["'" + o for o in opts]
        tags.append("proper")
    parts.append(Part(suf, "acc", opts, why))
    return Form("".join(p.text for p in parts), parts, tags)


def pronoun_acc(person):
    """beni, seni, onu, bizi, sizi, onları — местоимение + -ı (у o — onu)."""
    word = PRONOUN_ACC[person]
    stem = {"o": "on"}.get(person, person)
    suf = word[len(stem):]
    why = f"кого? {person} → {word}" + ("; у o — с n: onu" if person == "o" else "")
    parts = [Part(stem, "stem", [stem], ""), Part(suf, "acc", _uniq([suf, "i", "ı", "u", "e", "a", "de", "den"]), why)]
    return Form(word, parts, ["acc", "pronoun"])


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
    for args, kw, want in [
        (("öğretmen", "ben"), {}, "öğretmenim"),
        (("hasta", "ben"), {}, "hastayım"),
        (("Rus", "biz"), {}, "Rusuz"),
        (("nazik", "siz"), {}, "naziksiniz"),
        (("mutlu", "onlar"), {}, "mutlular"),
        (("güzel", "sen"), {}, "güzelsin"),
        (("yorgun", "ben"), {"negative": True}, "yorgun değilim"),
        (("Türk", "o"), {"negative": True}, "Türk değil"),
        (("aç", "onlar"), {"negative": True}, "aç değiller"),
        (("yorgun", "sen"), {"question": True}, "yorgun musun"),
        (("hazır", "biz"), {"question": True}, "hazır mıyız"),
        (("öğretmen", "siz"), {"question": True}, "öğretmen misiniz"),
        (("evde", "onlar"), {"question": True}, "evdeler mi"),
        (("aç", "o"), {"question": True}, "aç mı"),
    ]:
        got = copula(*args, **kw).word
        if got != want:
            bad += 1
            print("FAIL cop", args, kw, got)
    for args, kw, want in [
        (("ev", "ben"), {}, "evim"), (("ev", "sen"), {}, "evin"), (("ev", "o"), {}, "evi"),
        (("ev", "biz"), {}, "evimiz"), (("ev", "siz"), {}, "eviniz"), (("ev", "onlar"), {}, "evleri"),
        (("araba", "ben"), {}, "arabam"), (("araba", "o"), {}, "arabası"), (("araba", "biz"), {}, "arabamız"),
        (("araba", "onlar"), {}, "arabaları"), (("kitap", "ben"), {}, "kitabım"), (("sokak", "o"), {}, "sokağı"),
        (("bilet", "ben"), {}, "biletim"), (("top", "ben"), {}, "topum"), (("ad", "ben"), {}, "adım"),
        (("telefon", "siz"), {}, "telefonunuz"), (("köpek", "o"), {}, "köpeği"),
        (("ev", "ben"), {"case": "loc"}, "evimde"), (("ev", "o"), {"case": "loc"}, "evinde"),
        (("araba", "o"), {"case": "loc"}, "arabasında"), (("ev", "biz"), {"case": "dat"}, "evimize"),
        (("iş", "o"), {"case": "dat"}, "işine"), (("oda", "o"), {"case": "abl"}, "odasından"),
        (("okul", "onlar"), {"case": "dat"}, "okullarına"), (("çanta", "ben"), {"case": "loc"}, "çantamda"),
    ]:
        got = possessive(*args, **kw).word
        if got != want:
            bad += 1
            print("FAIL poss", args, kw, got)
    for name, want in [("Olga", "Olga'nın"), ("Deniz", "Deniz'in"), ("Pamuk", "Pamuk'un"), ("Tuba", "Tuba'nın"), ("Bey", "Bey'in")]:
        got = genitive(name).word
        if got != want:
            bad += 1
            print("FAIL gen", name, got)
    for args, kw, want in [
        (("kitap",), {}, "kitabı"), (("araba",), {}, "arabayı"), (("ev",), {}, "evi"), (("su",), {}, "suyu"),
        (("çay",), {}, "çayı"), (("müzik",), {}, "müziği"), (("top",), {}, "topu"), (("otobüs",), {}, "otobüsü"),
        (("Leyla",), {"proper": True}, "Leyla'yı"), (("Pamuk",), {"proper": True}, "Pamuk'u"), (("Deniz",), {"proper": True}, "Deniz'i"),
        (("anne",), {"poss": "ben"}, "annemi"), (("kitap",), {"poss": "ben"}, "kitabımı"), (("kedi",), {"poss": "o"}, "kedisini"),
        (("araba",), {"poss": "biz"}, "arabamızı"), (("pasaport",), {"poss": "siz"}, "pasaportunuzu"), (("kardeş",), {"poss": "o"}, "kardeşini"),
    ]:
        got = accusative(*args, **kw).word
        if got != want:
            bad += 1
            print("FAIL acc", args, kw, got)
    for person, want in PRONOUN_ACC.items():
        if pronoun_acc(person).word != want:
            bad += 1
            print("FAIL pron acc", person)
    for args, kw, want in [
        (("gelmek", "ben"), {}, "geldim"), (("yapmak", "sen"), {}, "yaptın"), (("gitmek", "o"), {}, "gitti"),
        (("okumak", "biz"), {}, "okuduk"), (("görmek", "siz"), {}, "gördünüz"), (("içmek", "onlar"), {}, "içtiler"),
        (("konuşmak", "ben"), {}, "konuştum"), (("beklemek", "o"), {}, "bekledi"), (("yemek", "o"), {}, "yedi"),
        (("gelmek", "biz"), {"negative": True}, "gelmedik"), (("yapmak", "ben"), {"negative": True}, "yapmadım"),
        (("gelmek", "sen"), {"question": True}, "geldin mi"), (("görmek", "siz"), {"question": True}, "gördünüz mü"),
        (("gitmek", "o"), {"question": True}, "gitti mi"), (("okumak", "onlar"), {"question": True}, "okudular mı"),
    ]:
        got = di(*args, **kw).word
        if got != want:
            bad += 1
            print("FAIL di", args, kw, got)
    for fn, args, kw, want in [
        (infinitive_form, ("içmek",), {}, "içmek"), (infinitive_form, ("yapmak",), {}, "yapmak"),
        (meli, ("gitmek", "ben"), {}, "gitmeliyim"), (meli, ("çalışmak", "sen"), {}, "çalışmalısın"),
        (meli, ("öğrenmek", "o"), {}, "öğrenmeli"), (meli, ("kalkmak", "onlar"), {}, "kalkmalılar"),
        (meli, ("içmek", "sen"), {"negative": True}, "içmemelisin"), (meli, ("kalmak", "ben"), {"negative": True}, "kalmamalıyım"),
        (imperative, ("oturmak",), {}, "oturun"), (imperative, ("beklemek",), {}, "bekleyin"), (imperative, ("okumak",), {}, "okuyun"),
        (imperative, ("gitmek",), {}, "gidin"), (imperative, ("tekrar etmek",), {}, "tekrar edin"),
        (imperative, ("içmek",), {"negative": True}, "içmeyin"), (imperative, ("gitmek", "sen"), {"negative": True}, "gitme"),
        (imperative, ("ağlamak", "sen"), {"negative": True}, "ağlama"),
    ]:
        got = fn(*args, **kw).word
        if got != want:
            bad += 1
            print("FAIL want", fn.__name__, args, kw, got)
    got = copula("", "ben", pre=noun_case("ev", "loc")).word
    if got != "evdeyim":
        bad += 1
        print("FAIL cop loc", got)
    got = copula("", "ben", pre=noun_case("İstanbul", "loc", proper=True)).word
    if got != "İstanbul'dayım":
        bad += 1
        print("FAIL cop proper", got)
    print("ok" if not bad else f"{bad} failures")
