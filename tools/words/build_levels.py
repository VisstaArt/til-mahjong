"""Собирает assets/words/levels.json ({tr: "A1"|"A2"|"B1"|"B2"}) из tools/words/levels.txt.

Запуск: python3 tools/words/build_levels.py
Слова, упомянутые в levels.txt, но отсутствующие в assets/words/<категория>.json,
печатаются как предупреждения — это опечатки или слова, которые удалили из словаря.
"""

import glob
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(os.path.dirname(__file__), "levels.txt")
OUT = os.path.join(ROOT, "assets", "words", "levels.json")
ORDER = ["A1", "A2", "B1", "B2"]


def parse():
    cats = {}
    cur = None
    for line in open(SRC, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip() or line.startswith("#"):
            continue
        m = re.match(r"\[(.+?)\]\s+default=(A1|A2|B1|B2)", line)
        if m:
            cur = {"default": m.group(2), "words": {}}
            cats[m.group(1)] = cur
            continue
        m = re.match(r"(A1|A2|B1|B2):\s*(.*)", line)
        if m and cur is not None:
            for w in m.group(2).split(" | "):
                w = w.strip()
                if w:
                    cur["words"][w] = m.group(1)
    return cats


def main():
    cats = parse()
    levels = {}
    warnings = []
    counts = {lv: 0 for lv in ORDER}
    # Слово из списка может лежать в соседней категории (su — и в «Еде», и в «Природе»).
    all_words = set()
    for f in glob.glob(os.path.join(ROOT, "assets", "words", "*.json")):
        if os.path.basename(f) not in ("manifest.json", "levels.json"):
            all_words.update(w["tr"] for w in json.load(open(f, encoding="utf-8")))
    for f in sorted(glob.glob(os.path.join(ROOT, "assets", "words", "*.json"))):
        name = os.path.basename(f)[:-5]
        if name in ("manifest", "levels"):
            continue
        spec = cats.get(name)
        if not spec:
            warnings.append(f"нет раздела [{name}] — все слова будут B1")
            spec = {"default": "B1", "words": {}}
        words = json.load(open(f, encoding="utf-8"))
        for w in spec["words"]:
            if w not in all_words:
                warnings.append(f"[{name}] нет слова «{w}» ни в одной категории")
        for w in words:
            lv = spec["words"].get(w["tr"], spec["default"])
            # Одно слово в двух категориях — берём более простой уровень.
            if w["tr"] in levels and ORDER.index(levels[w["tr"]]) <= ORDER.index(lv):
                continue
            levels[w["tr"]] = lv
    for lv in levels.values():
        counts[lv] += 1
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(levels, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"слов: {len(levels)} · " + " · ".join(f"{k}: {v}" for k, v in counts.items()))
    for w in warnings:
        print("  !", w)


if __name__ == "__main__":
    main()
