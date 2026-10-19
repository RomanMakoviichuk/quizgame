"""Merge the curated list with reviewed Wiktionary titles into server/data/ukrainianAnimals.json."""
import io, json, os, re, sys
curated_path, wikt_path, review_path, out_path = sys.argv[1:5]
UA = re.compile(r"^[абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'-]+$")
def norm(w):
    return w.lower().strip().replace("’", "'").replace("ʼ", "'")
def fold(k):
    return k.replace("ґ", "г")
entries = {}
for line in io.open(curated_path, encoding="utf-8"):
    if "|" not in line or line.startswith("#"): continue
    cat, words = line.split("|", 1)
    for w in words.split():
        k = norm(w)
        if UA.match(k) and k not in entries:
            entries[k] = {"word": k, "category": cat.strip(), "sources": ["curated"]}
# Wiktionary: only titles a human accepted in the review file (word|category per line)
if os.path.exists(review_path):
    for line in io.open(review_path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "|" not in line: continue
        w, cat = [x.strip() for x in line.split("|", 1)]
        k = norm(w)
        if not UA.match(k): continue
        if k in entries:
            if "wiktionary" not in entries[k]["sources"]: entries[k]["sources"].append("wiktionary")
        else:
            entries[k] = {"word": k, "category": cat, "sources": ["wiktionary"]}
# cross-check curated words against Wiktionary titles (source tag only)
if os.path.exists(wikt_path):
    titles = set(norm(t) for t in json.load(io.open(wikt_path, encoding="utf-8"))["words"])
    for k, e in entries.items():
        if k in titles and "wiktionary" not in e["sources"]: e["sources"].append("wiktionary")
seen = set(); dedup = {}
for k, e in entries.items():
    if fold(k) in seen: continue
    seen.add(fold(k)); dedup[k] = e
entries = dedup
out = [{"word": e["word"], "category": e["category"], "accepted": True, "source": "+".join(e["sources"])} for e in sorted(entries.values(), key=lambda e: e["word"])]
json.dump(out, io.open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
by = {}
for e in out: by[e["category"]] = by.get(e["category"], 0) + 1
print(len(out), "animals", by)
print("confirmed by wiktionary:", sum(1 for e in out if "wiktionary" in e["source"]))
