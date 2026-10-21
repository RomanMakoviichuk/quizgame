/**
 * «Легкий режим» for weak TV computers (a laptop that can't keep up with the
 * blur over the background videos and the glowing titles): <html class="lite">
 * switches the heaviest effects off (see "lite mode" at the end of App.css).
 *
 * On when the computer looks weak (4 or fewer CPU threads, or 4 GB of memory or
 * less), or when the screen runs under LOW_FPS for a few seconds during the first
 * minutes of play — then it's remembered for this browser. Force it with
 * ?lite=1 / ?lite=0 in the address (also remembered).
 */
const KEY = "quizgame_lite";
const LOW_FPS = 35;
const WINDOW_MS = 4000;
const WATCH_MS = 5 * 60 * 1000;

function store(v) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode: just for this visit */
  }
}

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function enable() {
  document.documentElement.classList.add("lite");
}

/** Watch the frame rate for a while; a slow stretch turns lite mode on for good. */
function watchFps() {
  const started = performance.now();
  let from = started;
  let frames = 0;
  const tick = (now) => {
    if (document.documentElement.classList.contains("lite") || now - started > WATCH_MS) return;
    frames++;
    if (now - from >= WINDOW_MS) {
      const fps = (frames * 1000) / (now - from);
      // a hidden tab gets no frames at all — that's not slowness
      if (fps < LOW_FPS && document.visibilityState === "visible") {
        store("auto");
        enable();
        return;
      }
      from = now;
      frames = 0;
    }
    requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", () => {
    from = performance.now();
    frames = 0;
  });
  requestAnimationFrame(tick);
}

export function installLiteMode() {
  const q = new URLSearchParams(window.location.search).get("lite");
  if (q === "1") store("on");
  if (q === "0") store("off");
  const pref = stored();
  if (pref === "off") return;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  if (pref === "on" || pref === "auto" || weak) return enable();
  watchFps();
}
