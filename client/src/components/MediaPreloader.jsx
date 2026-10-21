import { useEffect, useRef, useState } from "react";
import "./MediaPreloader.css";

/**
 * «Завантаження» — the TV downloads the whole game up front.
 *
 * Every video, sound and picture (GET /api/media/manifest) is fetched once into
 * the browser's "media" cache; public/media-sw.js then answers /assets/
 * requests from it, so nothing streams over the internet mid-game. Later
 * starts only fetch what changed (each file carries a version) and drop what
 * was removed, so a fully cached TV goes straight to the game.
 *
 * Needs a secure page (https or localhost) with service workers; anywhere else
 * — and on phones — the game just starts as before.
 */
const CACHE = "media";
const WORKERS = 3;
const SUPPORTED = typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "caches" in window;

const mb = (n) => (n / 1e6).toFixed(n >= 1e8 ? 0 : 1);
const keyOf = (p) => new URL(p, window.location.origin).pathname;

function eta(sec) {
  if (!isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `≈ ${Math.ceil(sec)} с`;
  return `≈ ${Math.ceil(sec / 60)} хв`;
}

async function ensureWorker() {
  await navigator.serviceWorker.register("/media-sw.js");
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  // first visit: wait until the worker takes this page over (clients.claim)
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 3000);
    navigator.serviceWorker.addEventListener("controllerchange", () => (clearTimeout(t), resolve()), { once: true });
  });
}

/** Files of the manifest that aren't cached in their current version; drops stale entries. */
async function plan(cache, files) {
  const wanted = new Map(files.map((f) => [keyOf(f.path), f]));
  for (const req of await cache.keys()) {
    const k = new URL(req.url).pathname;
    if (!wanted.has(k)) await cache.delete(req);
  }
  const missing = [];
  for (const [k, f] of wanted) {
    const hit = await cache.match(k);
    if (!hit || hit.headers.get("X-Media-Ver") !== f.ver) missing.push(f);
  }
  return missing;
}

async function download(cache, f, signal, onBytes) {
  const res = await fetch(`${f.path}?mv=${encodeURIComponent(f.ver)}`, { cache: "no-store", signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(value.length);
  }
  const type = res.headers.get("Content-Type") || "application/octet-stream";
  const blob = new Blob(chunks, { type });
  await cache.put(
    keyOf(f.path),
    new Response(blob, { headers: { "Content-Type": type, "Content-Length": String(blob.size), "X-Media-Ver": f.ver } })
  );
  return got;
}

export default function MediaPreloader({ children }) {
  const [phase, setPhase] = useState(SUPPORTED ? "check" : "done"); // check | load | failed | nospace | done
  const [stats, setStats] = useState({ done: 0, total: 0, files: 0, filesTotal: 0, failed: 0, speed: 0 });
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!SUPPORTED) return undefined;
    const ac = new AbortController();
    abortRef.current = ac;
    let ticker = null;
    (async () => {
      try {
        await ensureWorker();
        const manifest = await fetch("/api/media/manifest", { cache: "no-store", signal: ac.signal }).then((r) => r.json());
        const cache = await caches.open(CACHE);
        const missing = await plan(cache, manifest.files || []);
        if (ac.signal.aborted) return;
        if (!missing.length) return setPhase("done");

        const total = missing.reduce((n, f) => n + f.size, 0);
        if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
        if (navigator.storage?.estimate) {
          const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
          if (quota - usage < total * 1.1) {
            setStats((st) => ({ ...st, total }));
            return setPhase("nospace");
          }
        }

        const s = { done: 0, total, files: 0, filesTotal: missing.length, failed: 0, speed: 0 };
        const started = performance.now();
        setStats({ ...s });
        setPhase("load");
        ticker = setInterval(() => {
          s.speed = s.done / Math.max(0.5, (performance.now() - started) / 1000);
          setStats({ ...s });
        }, 250);

        const queue = [...missing];
        const worker = async () => {
          for (let f = queue.shift(); f; f = queue.shift()) {
            let ok = false;
            for (let tries = 0; tries < 2 && !ok && !ac.signal.aborted; tries++) {
              let part = 0;
              try {
                await download(cache, f, ac.signal, (n) => ((part += n), (s.done += n)));
                ok = true;
              } catch {
                s.done -= part; // count the retry from zero
              }
            }
            if (ac.signal.aborted) return;
            if (ok) s.files++;
            else s.failed++;
          }
        };
        await Promise.all(Array.from({ length: WORKERS }, worker));
        clearInterval(ticker);
        if (ac.signal.aborted) return;
        setStats({ ...s });
        setPhase(s.failed ? "failed" : "done");
      } catch {
        // no manifest / no worker / offline: just play, streaming as before
        if (!ac.signal.aborted) setPhase("done");
      }
    })();
    return () => {
      ac.abort();
      clearInterval(ticker);
    };
  }, [attempt]);

  if (phase === "done") return children;

  const skip = () => {
    abortRef.current?.abort();
    setPhase("done");
  };
  const pct = stats.total ? Math.min(100, (stats.done / stats.total) * 100) : 0;

  return (
    <div className="mp-screen">
      <div className="mp-card">
        <img className="mp-logo" src="/logo192.png" alt="" />
        <h1 className="mp-title">Хто є хто!</h1>

        {phase === "check" && <p className="mp-sub">Перевіряю файли гри…</p>}

        {phase === "load" && (
          <>
            <p className="mp-sub">Завантажую гру на цей пристрій, щоб відео й музика не підвисали</p>
            <div className="mp-bar">
              <div className="mp-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="mp-nums">
              <b>{Math.floor(pct)}%</b>
              <span>
                {mb(stats.done)} / {mb(stats.total)} МБ
              </span>
              <span>
                файли {stats.files}/{stats.filesTotal}
              </span>
              <span>
                {stats.speed > 0 ? `${mb(stats.speed)} МБ/с` : ""} {eta((stats.total - stats.done) / stats.speed)}
              </span>
            </div>
            <p className="mp-note">Це потрібно лише один раз — наступного разу гра відкриється одразу.</p>
          </>
        )}

        {phase === "failed" && (
          <p className="mp-sub">Не вдалося завантажити файлів: {stats.failed}. Решта вже на пристрої.</p>
        )}

        {phase === "nospace" && (
          <p className="mp-sub">На цьому пристрої замало місця для браузера ({mb(stats.total || 0)} МБ потрібно). Гра працюватиме як раніше — з підвантаженням.</p>
        )}

        <div className="mp-actions">
          {phase === "failed" && (
            <button type="button" className="mp-btn" onClick={() => (setPhase("check"), setAttempt((a) => a + 1))}>
              Спробувати ще
            </button>
          )}
          <button type="button" className="mp-btn ghost" onClick={skip}>
            {phase === "load" || phase === "check" ? "Пропустити" : "Грати"}
          </button>
        </div>
      </div>
    </div>
  );
}
