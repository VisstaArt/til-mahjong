"""Этапы A1 для «Занятия дня» и входного теста → assets/stages.json.

Запуск:  python3 tools/stages/build_stages.py

Этап ≈ юнит учебника Yeni Hitit 1 (юниты 1–6 = A1): своя грамматика, свои темы фраз,
категории слов и диалоги. Порядок грамматики — как в GRAMMAR_TOPICS (grammar.js): пути
тем написаны так, что каждая тема опирается только на предыдущие.

Фраза попадает на этап своей темы, но не раньше, чем пройдена её грамматика (по
разметке tools/grammar/build.py в assets/grammar/items.json, для неразмеченных — по
окончаниям, tools/grammar/levels.py). Фразы из одного-двух слов («Anladım», «Memnun
oldum») — готовые формулы: их учат целиком, на грамматику не смотрим.

Диалог — на этапе, где понятны три четверти его реплик (на первой ступени лесенки их
выбирают из вариантов — остальное понятно по переводу), и не раньше этапа его темы;
внутри этапа — от коротких к длинным. Перезапускать после правок фраз, диалогов и
items.json.
"""

import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "grammar"))
import levels  # noqa: E402

OUT = os.path.join(ROOT, "assets", "stages.json")

STAGES = [
    {
        "title": "Знакомство",
        "unit": "Hitit 1 · Merhaba",
        "emoji": "👋",
        "grammar": ["cop"],
        "phraseTopics": ["privetstvie", "znakomstvo", "voprositelnye-slova", "obscheprinyatye-slova"],
        "words": ["Числительные", "Страны и национальности", "Служебные слова", "Профессии", "Эмоции и чувства"],
    },
    {
        "title": "Мой день",
        "unit": "Hitit 2 · Günlük hayat",
        "emoji": "☀️",
        "grammar": ["yor", "case"],
        "phraseTopics": ["moy-den", "vremya"],
        "words": ["Глаголы — действия", "Календарь и время", "Направления и предлоги", "Дом и мебель"],
    },
    {
        "title": "Семья и город",
        "unit": "Hitit 3 · Yakın çevremiz",
        "emoji": "🏘️",
        "grammar": ["poss", "acc"],
        "phraseTopics": ["semya", "v-gorode"],
        "words": ["Семья и отношения", "Город и места", "Транспорт и вождение", "Школа и канцтовары"],
    },
    {
        "title": "Вчера и в кафе",
        "unit": "Hitit 4–5 · Zaman geçiyor, Afiyet olsun",
        "emoji": "☕",
        "grammar": ["di", "want"],
        "phraseTopics": ["restoran"],
        "words": ["Еда и напитки", "Кухня и посуда", "Фрукты", "Овощи", "Природа и погода"],
    },
    {
        "title": "Покупки и планы",
        "unit": "Hitit 5–6 · Afiyet olsun, Bürokrasi",
        "emoji": "🛍️",
        "grammar": ["ecek", "with", "deg"],
        "phraseTopics": ["pokupki-servis"],
        "words": ["Покупки и магазины", "Одежда и аксессуары", "Цвета", "Предметы и вещи", "Ванная и гигиена"],
    },
    {
        "title": "Свободнее",
        "unit": "Hitit 6 · Bürokrasi",
        "emoji": "🎓",
        "grammar": ["qw", "two", "li"],
        "phraseTopics": [],
        "words": ["Прилагательные и сравнения", "Части тела", "Здоровье", "Спорт и игры", "Животные"],
    },
]

# Какая грамматика нужна, чтобы понять фразу: тема разметки → этап. var/yok и -lı/-sız
# во фразах — как слова («есть», «с молоком»), их понимают с первого этапа.
SLOT_STAGE = {"cop": 1, "deg": 1, "li": 1, "yor": 2, "case": 2, "poss": 3, "acc": 3, "di": 4, "want": 4, "with": 5, "ecek": 5}
# Неразмеченные фразы — по окончаниям (levels.py).
RULE_STAGE = {"-yor": 2, "-di (прош.)": 4, "-meli": 4, "-ecek (буд.)": 5}
CHUNK_WORDS = 2
DIALOGUE_COVER = 0.75


def load(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return json.load(f)


def main():
    items = load("assets/grammar/items.json")
    slot_topics = {}
    for it in items:
        if it.get("tier") == "life":
            slot_topics.setdefault(it["tr"], set()).update(s["topic"] for s in it["slots"])

    def grammar_stage(tr):
        if len([w for w in tr.split() if w.strip("….,!?/")]) <= CHUNK_WORDS:
            return 1
        topics = slot_topics.get(tr)
        if topics:
            st = max(SLOT_STAGE.get(t, 1) for t in topics)
        else:
            st = 1
        level, found = levels.classify(tr)
        for _lv, name, _w in found:
            st = max(st, RULE_STAGE.get(name, 1))
        return st

    theme_stage = {t: i + 1 for i, s in enumerate(STAGES) for t in s["phraseTopics"]}
    plevels = load("assets/phrases/levels.json")
    phrases = {i + 1: [] for i in range(len(STAGES))}
    for tid in plevels["order"]:
        lv_map = plevels["phrases"].get(tid, {})
        if tid not in theme_stage:
            continue
        topic = load(f"assets/phrases/{tid}.json")
        for p in topic["phrases"]:
            if lv_map.get(p["tr"]) != "A1":
                continue
            st = max(theme_stage[tid], grammar_stage(p["tr"]))
            phrases[st].append(f"{tid}::{p['tr']}")

    dialogues = {i + 1: [] for i in range(len(STAGES))}
    for m in load("assets/dialogues/manifest.json"):
        topic = load(f"assets/dialogues/{m['id']}.json")
        topic_level = plevels["topics"].get(m["id"], {}).get("level", "A1")
        for d in topic["dialogues"]:
            if (d.get("level") or topic_level) != "A1":
                continue
            turn_stages = sorted(grammar_stage(t["tr"]) for t in d["turns"])
            cover = turn_stages[max(0, math.ceil(len(turn_stages) * DIALOGUE_COVER) - 1)]
            st = max(cover, theme_stage.get(m["id"], 1))
            dialogues[st].append({"topic": m["id"], "id": d["id"], "turns": len(d["turns"])})

    out = []
    for i, s in enumerate(STAGES):
        n = i + 1
        dl = sorted(dialogues[n], key=lambda d: d["turns"])
        out.append({"n": n, **s, "phrases": phrases[n], "dialogues": dl})
        print(f"{n}. {s['title']:16s} фраз {len(phrases[n]):3d} · диалогов {len(dl):2d} "
              f"({', '.join(str(d['turns']) for d in dl[:8])}{'…' if len(dl) > 8 else ''}) · грамматика {', '.join(s['grammar'])}")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"stages": out}, f, ensure_ascii=False, indent=1)
    print(f"→ {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
