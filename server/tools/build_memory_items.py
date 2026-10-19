"""
«Меморі: кольоровий хаос» — optimised copies of the item pictures.

Reads server/data/memoryItems.json and, for every item, writes
client/public/assets/minigames/items/web/<id>.webp: trimmed to the visible
pixels, at most 480 px on the long side, transparency kept. The originals are
never touched. Run it after adding a picture:

    python server/tools/build_memory_items.py

(needs Pillow: pip install pillow). Without the copy the game still works —
it falls back to the original file, just heavier for the phones.
"""
import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "server" / "data" / "memoryItems.json"
ITEMS_DIR = ROOT / "client" / "public" / "assets" / "minigames" / "items"
OUT_DIR = ITEMS_DIR / "web"
MAX_SIDE = 480


def main() -> int:
    items = json.loads(REGISTRY.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(exist_ok=True)
    bad = 0
    for it in items:
        src = ITEMS_DIR / it["image"]
        if not src.exists():
            print(f"!! {it['id']}: no file {src.name}")
            bad += 1
            continue
        im = Image.open(src).convert("RGBA")
        box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
        if box:
            im = im.crop(box)
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        out = OUT_DIR / f"{it['id']}.webp"
        im.save(out, "WEBP", quality=90, method=6)
        print(f"ok {it['id']:<10} {src.name} -> web/{out.name} {im.size[0]}x{im.size[1]}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
