"""
Level the loudness of every sound and video under client/public/assets.

    python server/tools/normalize-media.py            # measure, then level what is off
    python server/tools/normalize-media.py --dry-run  # only show what would change

Targets (EBU R128 integrated loudness): the host / clips / effects -18 LUFS,
music beds and «Вгадай мелодію» songs -21 LUFS (a little under the voice).
A file within 1 dB of its target is left alone; silent clips are skipped.
Before a file is changed its original is copied once to
media-originals/assets/<same path> (not in git) and the new file is always
made from that original, so running this again never degrades anything.
Videos keep their picture (copied), only the sound is re-encoded.
Needs ffmpeg / ffprobe on PATH.
"""
import json, os, re, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ROOT = os.path.join(REPO, "client", "public", "assets")
BACKUP = os.path.join(REPO, "media-originals", "assets")
VOICE_SFX, MUSIC = -18.0, -21.0
MAX_LIMIT_DB = 6.0  # never squash peaks by more than this to reach the target
MEDIA = (".mp3", ".mp4", ".wav", ".ogg", ".m4a", ".webm")

def measure(p):
    """(path, {I: LUFS, TP: true peak dBFS, LRA, dur}) or (path, None) for no sound."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", p, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    err = r.stderr
    if "does not contain any stream" in err or "Output file does not contain" in err or "matches no streams" in err:
        return p, None
    s = err[err.rfind("Summary:"):]
    I = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", s)
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", s)
    lra = re.search(r"LRA:\s+(-?[\d.]+) LU", s)
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    d = int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3]) if dur else None
    return p, {"I": float(I[1]) if I and I[1] != "-inf" else None, "TP": float(tp[1]) if tp and tp[1] != "-inf" else None, "LRA": float(lra[1]) if lra else None, "dur": d}
def is_music(rel):
    return bool(re.search(r"(^|/)background\.mp3$|^menu/music\.mp3$|^intro/music\.mp3$|^final/(end-)?music\.mp3$|/songs/", rel))

def bitrate(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=bit_rate,sample_rate", "-of", "json", p], capture_output=True, text=True, encoding="utf-8")
    s = json.loads(r.stdout or "{}").get("streams", [{}])[0]
    br = int(s.get("bit_rate") or 0) or 192000
    return max(96000, min(320000, round(br / 1000) * 1000)), s.get("sample_rate")

def plan(rel, m):
    if not m or m["I"] is None or m["I"] < -45 or m["TP"] is None:
        return None, "silent/too short"
    target = MUSIC if is_music(rel) else VOICE_SFX
    g = target - m["I"]
    g = min(g, (-1.0 - m["TP"]) + MAX_LIMIT_DB)
    if abs(g) < 1.0:
        return None, f"ok ({m['I']})"
    return (g, target, m["TP"] + g > -1.0), None

def work(item):
    rel, m = item
    p, why = plan(rel, m)
    if not p:
        return rel, "skip " + why
    g, target, limit = p
    src = os.path.join(ROOT, rel.replace("/", os.sep))
    bak = os.path.join(BACKUP, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(bak), exist_ok=True)
    if not os.path.exists(bak):
        shutil.copy2(src, bak)          # the original is kept, untouched
    af = f"volume={g:.2f}dB" + (",alimiter=limit=0.891:attack=5:release=60:level=disabled" if limit else "")
    br, sr = bitrate(bak)
    ext = os.path.splitext(rel)[1].lower()
    tmp = src + ".tmp" + ext
    if ext == ".mp4":
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", bak, "-map", "0:v?", "-map", "0:a:0", "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", str(br), "-movflags", "+faststart", tmp]
    else:
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", bak, "-map", "0:a", "-af", af, "-c:a", "libmp3lame", "-b:a", str(br)] + (["-ar", sr] if sr else []) + [tmp]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) < 1000:
        if os.path.exists(tmp): os.remove(tmp)
        return rel, "FAIL " + r.stderr[-300:]
    os.replace(tmp, src)
    return rel, f"{m['I']:6.1f} -> {target} ({g:+.1f} dB{' +limit' if limit else ''})"


# short effects whose measured loudness says little (leveling them made them worse)
KEEP_AS_IS = {"minigames/hot-bomb/change player.mp3", "minigames/hot-bomb/timer.mp3"}


def main():
    dry = "--dry-run" in sys.argv
    force = "--force" in sys.argv  # level again the files done before (from their originals)
    todo = []
    for d, _, fs in os.walk(ROOT):
        for f in fs:
            if not f.lower().endswith(MEDIA) or ".tmp." in f:
                continue
            rel = os.path.relpath(os.path.join(d, f), ROOT).replace(os.sep, "/")
            bak = os.path.join(BACKUP, rel.replace("/", os.sep))
            if rel in KEEP_AS_IS or (os.path.exists(bak) and not force):
                continue  # left as is / already leveled from its original
            # the gain is always worked out on the original the new file is made from
            todo.append((rel, bak if os.path.exists(bak) else os.path.join(d, f)))
    with ThreadPoolExecutor(6) as ex:
        measured = dict(zip([r for r, _ in todo], [m for _, m in ex.map(measure, [p for _, p in todo])]))
    if dry:
        for rel, m in sorted(measured.items()):
            p, why = plan(rel, m)
            print(("skip " + why) if not p else f"{m['I']:6.1f} -> {p[1]} ({p[0]:+.1f} dB)", " ", rel)
        print(f"{len(measured)} file(s) checked")
        return
    with ThreadPoolExecutor(6) as ex:
        for rel, res in sorted(ex.map(work, measured.items())):
            print(f"{res:40}  {rel}")
    print(f"{len(measured)} file(s) checked")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
