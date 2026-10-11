"""Порядок тем «Фраз» по уровням и уровень каждой фразы → assets/phrases/levels.json.

Запуск: python3 tools/phrases/build_levels.py
Уровень фразы: поле "level" из файла темы (его ставит сессия диалогов), иначе оценка по
грамматике (tools/grammar/levels.py), но не ниже уровня самой темы и не ниже A2 для
длинных фраз (больше 8 слов).
"""

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "grammar"))
import levels  # noqa: E402

ORDER = ["A1", "A2", "B1", "B2"]

# Путь тем: уровень темы и порядок внутри уровня — от самого нужного в первые дни.
PATH = [
    ("A1", ["privetstvie", "znakomstvo", "voprositelnye-slova", "obscheprinyatye-slova", "semya", "moy-den",
            "vremya", "restoran", "pokupki-servis", "v-gorode"]),
    ("A2", ["puteshestvie", "v-otele", "zdorove", "o-pogode", "kak-pomenyat-dengi", "na-tamozhne",
            "osmotr-dostoprimechatelnostey", "razvlecheniya-otdyh", "kak-deystvovat-v-ekstrennoy-situacii",
            "nekotorye-poleznye-nadpisi-i-vyveski"]),
    ("B1", ["zhaloby-problemy", "rabota", "mneniya", "biznes-vstrechi-i-ofis"]),
    ("B2", ["biznes-peregovory", "biznes-marketing", "biznes-upravlenie-personalom", "biznes-strategiya-i-politika",
            "biznes-investicii", "biznes-buhgalteriya", "biznes-nalogi", "biznes-yurisprudenciya",
            "ustoychivye-vyrazheniya-so-slovom-allah"]),
]


def main():
    manifest = json.load(open(os.path.join(ROOT, "assets", "phrases", "manifest.json"), encoding="utf-8"))
    ids = [m["id"] for m in manifest]
    placed = {tid for _, tids in PATH for tid in tids}
    missing = [t for t in ids if t not in placed]
    out = {"order": [], "topics": {}, "phrases": {}}
    for level, tids in PATH + ([("B1", missing)] if missing else []):
        for tid in tids:
            if tid not in ids:
                continue
            data = json.load(open(os.path.join(ROOT, "assets", "phrases", f"{tid}.json"), encoding="utf-8"))
            phrases = data if isinstance(data, list) else data.get("phrases", [])
            counts = {lv: 0 for lv in ORDER}
            per = {}
            for p in phrases:
                lv = p.get("level")
                if not lv:
                    est = levels.classify(p["tr"])[0]
                    if len(p["tr"].split()) > 8:
                        est = max(est, "A2", key=ORDER.index)
                    lv = max(est, level, key=ORDER.index)
                per[p["tr"]] = lv
                counts[lv] += 1
            out["order"].append(tid)
            out["topics"][tid] = {"level": level, "counts": counts}
            out["phrases"][tid] = per
    with open(os.path.join(ROOT, "assets", "phrases", "levels.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    total = {lv: sum(t["counts"][lv] for t in out["topics"].values()) for lv in ORDER}
    print("фраз по уровням:", total)
    if missing:
        print("ВНИМАНИЕ: темы без места в пути (поставлены в B1):", missing)


if __name__ == "__main__":
    main()
