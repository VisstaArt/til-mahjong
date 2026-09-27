"""Грубая оценка уровня (A1…B2) реплик диалогов по грамматике — по окончаниям слов.

Запуск:  python3 tools/grammar/levels.py [--detail]
Это эвристика по регуляркам, а не разбор: годится для сводки «насколько диалоги
выходят за A1», но не для автоматической блокировки контента.
"""

import glob
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LEVELS = ["A1", "A2", "B1", "B2"]

V = "[ıiuü]"
A = "[ae]"
# (правило, уровень, регулярка по слову в нижнем регистре). Порядок — от сложного к
# простому не важен: уровень реплики = максимум найденных.
RULES = [
    ("-yor", "A1", rf"{V}?yor"),
    ("-di (прош.)", "A1", rf"[dt]{V}(m|n|k|n{V}z|l{A}r)?$"),
    ("-ecek (буд.)", "A1", rf"{A}c{A}(k|ğ){V}?[mnz]?"),
    ("-meli", "A1", rf"m{A}l{V}(y{V}m|s{V}n|y{V}z|s{V}n{V}z|l{A}r)?$"),
    ("-ir (широкое)", "A2", rf"\w{{2,}}([ae]r|{V}r)(\s|$)(m{V}s{V}n{V}z|m{V}s{V}n|m{V}y{V}m)"),
    ("-ir (широкое)", "A2", rf"\w{{2,}}([ae]r|{V}r)({V}m|s{V}n|{V}z|s{V}n{V}z)$"),
    ("-maz (не-широкое)", "A2", rf"m{A}z(s{V}n|l{A}r|s{V}n{V}z)?$|m{A}m$"),
    ("-miş", "A2", rf"m{V}ş"),
    ("-ebil / -eme (могу)", "A2", rf"{A}bil|y{A}m{V}(yor|y{A}c|d{V}|z)"),
    ("-ken", "A2", r"\w{3,}ken$"),
    ("-ince", "A2", rf"{V}nc{A}$"),
    ("-meden / -ip", "A2", rf"m{A}d{A}n$"),
    ("причастие -dığı", "B1", rf"[dt]{V}ğ{V}|[dt]{V}k{V}"),
    # ödeyeceğim — это просто будущее «я заплачу», поэтому -ğim/-ğiz не считаем.
    ("причастие -eceği", "B1", rf"{A}c{A}ğ{V}(n{V}|n{A}|nd{A}n?)?$"),
    ("условное -se", "B1", rf"([ıiuüae]r|{A}z|^var|^yok|^değil|^mümkün)s{A}(m|n|k|n{V}z|l{A}r)?$"),
    ("залог -dır/-t (понуд.)", "B1", rf"[dt]{V}r(m{A}k|{V}yor|d{V}|{A}c{A}k)"),
    ("страд. залог -ıl/-in", "B1", rf"\w{{3,}}[^aeıioöuü]{V}l(m{A}k|{V}yor|d{V}|{A}c{A}k|m{V}ş)"),
    ("-mış gibi / -dıkça", "B2", rf"[dt]{V}kç{A}|m{V}ş gibi"),
]
COMPILED = [(n, lv, re.compile(rx)) for n, lv, rx in RULES]
WORD_RE = re.compile(r"[a-zçğıöşüâîû']+")
# Частые слова, на которые ложно срабатывают правила (не глагольные формы).
FALSE = {
    "iyi", "şimdi", "kadar", "bir", "biri", "birisi", "var", "yok", "sonra", "önce", "size",
    "bize", "kendi", "belki", "işte", "tabii", "peki", "hadi", "evet", "gibi", "değil", "yardım",
    "lütfen", "teşekkürler", "sağol", "rica", "iyiyim", "burası", "orası", "nasılsın", "nasılsınız",
    "bence", "sence", "herkes", "şeker", "kahve", "süper", "ister", "cuma", "salı", "kızım",
    "oğlum", "adım", "adın", "yardımcı", "arkadaşım", "arkadaşın", "annem", "babam", "kardeşim",
    "kilo", "metro", "daha", "yeni", "hepsi", "ne", "nerede", "neden", "niye", "bugün", "yarın",
    "dün", "hafta", "akşam", "sabah", "geçmiş", "olsun", "misafir", "mutlu", "tatlı", "tuzlu",
    "pazar", "kira", "ara", "kiralık", "fakir", "sıra", "doktor", "sigara", "yüzde", "hazır",
    "tamam", "yılmaz", "bekarım", "memnunum", "yoksa", "yaramaz", "yetmiş", "müşteri",
    # Застывшие формулы учатся целиком, как слово, — это A1, хоть форма и широкое время.
    "ederim", "dilerim", "görüşürüz", "ederiz",
}


def tr_lower(s):
    return s.replace("I", "ı").replace("İ", "i").lower()


def classify(text):
    low = tr_lower(text)
    words = WORD_RE.findall(low)
    found = []
    for i, w in enumerate(words):
        if w in FALSE or len(w) < 4:
            continue
        pair = w + " " + (words[i + 1] if i + 1 < len(words) else "")
        for name, lv, rx in COMPILED:
            if rx.search(pair if "\\s" in rx.pattern else w):
                found.append((lv, name, w))
    level = max((LEVELS.index(lv) for lv, _, _ in found), default=0)
    return LEVELS[level], found


def main():
    detail = "--detail" in sys.argv
    total = Counter()
    rule_count = Counter()
    for f in sorted(glob.glob(os.path.join(ROOT, "assets", "dialogues", "*.json"))):
        if f.endswith("manifest.json"):
            continue
        topic = json.load(open(f, encoding="utf-8"))
        tlevels = Counter()
        rows = []
        for d in topic["dialogues"]:
            lv_counts = Counter()
            top_rules = Counter()
            for t in d["turns"]:
                lv, found = classify(t["tr"])
                lv_counts[lv] += 1
                for flv, name, _ in found:
                    top_rules[(flv, name)] += 1
                    rule_count[(flv, name)] += 1
            dlv = max(lv_counts, key=LEVELS.index)
            tlevels[dlv] += 1
            rows.append((d["title"], dlv, lv_counts, top_rules))
            total.update(lv_counts)
        print(f"\n## {topic['title']} — диалогов {len(rows)}; по максимуму: " + ", ".join(f"{l} {tlevels[l]}" for l in LEVELS if tlevels[l]))
        if detail:
            for title, dlv, lvc, rules in rows:
                hard = [n for (l, n), _ in rules.most_common() if LEVELS.index(l) >= 1][:4]
                print(f"  {dlv}  {title}  реплики: " + " ".join(f"{l}:{lvc[l]}" for l in LEVELS if lvc[l]) + (f"  ← {', '.join(hard)}" if hard else ""))
    s = sum(total.values())
    print("\nВсе реплики: " + ", ".join(f"{l} {total[l]} ({100 * total[l] // s}%)" for l in LEVELS))
    print("Правила выше A1 (сколько раз встречаются):")
    for (lv, name), n in sorted(rule_count.items(), key=lambda kv: (-LEVELS.index(kv[0][0]), -kv[1])):
        if lv != "A1":
            print(f"  {lv} {name}: {n}")


if __name__ == "__main__":
    main()
